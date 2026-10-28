// Telemetry (#/telemetry): the five graphs drawn from the dashboard's own sums over the 30-day
// fixture (dashboard/test/fixtures/telemetry/usage.jsonl, through dashboard/lib/telemetry.js, so the
// page and the numbers its node tests worked out by hand are the same), the table views, the window
// picker, Read now, and the theme and colour rules for Telemetry.css. No model calls: the dashboard
// is a fake api.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { PlanUsage } from '../api/types';
import { hrefFor, parseHash, telemetryHref } from '../app/router';
import { createStore, WorkshopContext } from '../state/store';
import { LEVELS, snapshot } from '../state/test-fixtures';
import { THEMES } from '../theme/theme';
import { amountWords, fold, niceMax, TelemetryView, type TelemetryResponse, type TelemetryWindow } from './Telemetry';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const FIXTURE = readFileSync(here('../../../dashboard/test/fixtures/telemetry/usage.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const LIB = here('../../../dashboard/lib/telemetry.js');
type Sums = (lines: unknown[], opts: Record<string, unknown>) => Omit<TelemetryResponse, 'meters' | 'file'>;
const { telemetry } = (await import(/* @vite-ignore */ LIB)) as { telemetry: Sums };

const NOW = '2026-10-28T12:00:00.000Z';
const TITLES = { 'orbit-479-feedback-api': 'Feedback API', 'orbit-512-export': 'Export', 'tidy-logs': 'Tidy logs' };
const LAST = FIXTURE[FIXTURE.length - 1].meters;
const METERS_ON: PlanUsage = { enabled: true, fiveHour: LAST.fiveHour, week: LAST.week, checkedAt: '2026-10-28T11:59:00.000Z', error: null };
const METERS_OFF: PlanUsage = { enabled: false, fiveHour: null, week: null, checkedAt: null, error: null };

/** What GET /api/telemetry?window= answers for the fixture at NOW (as server.js builds it). */
const answer = (window: TelemetryWindow, meters: PlanUsage = METERS_ON): TelemetryResponse => ({
  ...telemetry(FIXTURE, { window, now: NOW, me: 'vignesh', meters: LAST, titles: TITLES, timeZone: 'UTC' }),
  meters,
  file: '/home/you/.ground-control/usage.jsonl',
});

function setup({ planUsage = null as PlanUsage | null, get }: { planUsage?: PlanUsage | null; get?: (path: string) => Promise<unknown> } = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', levels: LEVELS } }) });
  if (planUsage) store.dispatch({ type: 'plan-usage', planUsage });
  const getFn = vi.fn(get ?? (async (path: string) => {
    const w = new URLSearchParams(path.split('?')[1]).get('window') as TelemetryWindow;
    return answer(w, planUsage ?? METERS_OFF);
  }));
  const fresh: PlanUsage = { ...METERS_ON, week: { percent: 88, resetsAt: LAST.week.resetsAt }, checkedAt: '2026-10-28T12:00:00.000Z' };
  const post = vi.fn(async () => fresh);
  const api = { get: getFn, post, del: vi.fn() } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}><TelemetryView /></WorkshopContext.Provider>);
  return { get: getFn, post, store };
}
const card = (id: string) => document.querySelector(`[data-dataset="${id}"]`) as HTMLElement;

afterEach(() => { localStorage.clear(); });

describe('Telemetry', () => {
  it('is its own page at #/telemetry', () => {
    expect(parseHash('#/telemetry')).toEqual({ name: 'telemetry' });
    expect(parseHash('#/telemetry/')).toEqual({ name: 'telemetry' });
    expect(hrefFor({ name: 'telemetry' })).toBe('#/telemetry');
    expect(telemetryHref()).toBe('#/telemetry');
  });

  it('draws the five graphs from the 30-day fixture, each with its sentence and who it is for', async () => {
    const { get } = setup();
    await screen.findByText('At this pace, full on Thursday 03:48.');
    expect(get).toHaveBeenCalledWith('/api/telemetry?window=week');
    const cards = [...document.querySelectorAll('.tele-card')].map((c) => [c.getAttribute('data-dataset'), c.getAttribute('data-audience'), c.querySelector('h3')?.textContent, c.querySelector('.tele-audience')?.textContent]);
    expect(cards).toEqual([
      ['gauge', 'common', 'Weekly limit over time', 'Whole account'],
      ['by-day-job', 'private', 'Use by day, by job', 'Only yours'],
      ['cost', 'private', 'Cost per ticket and per stage', 'Only yours'],
      ['by-model', 'common', 'Share by model', 'Whole account'],
      ['people', 'common', 'People on the account', 'Whole account'],
    ]);
    for (const c of document.querySelectorAll('.tele-card')) expect(c.querySelector('.tele-fact')?.textContent?.length).toBeGreaterThan(20);
    expect(within(card('by-day-job')).getByText('Feedback API used the most this week: 51% of the week ($25.50).')).toBeInTheDocument();

    // 1. The weekly line, the thin five-hour one, the week's reset mark and the dotted forecast to full.
    const gauge = card('gauge');
    expect(gauge.querySelector('path.week')?.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+(L[\d.]+,[\d.]+)+$/);
    expect(gauge.querySelector('path.five')).not.toBeNull();
    expect(gauge.querySelector('path.forecast')).not.toBeNull();
    expect(gauge.querySelectorAll('line.reset')).toHaveLength(1);
    expect(within(gauge).getByText(/^Full \w{3} \d\d? Oct, \d\d:48$/)).toBeInTheDocument();
    expect(within(gauge).getByText('87% now')).toBeInTheDocument();
    expect(within(gauge).getByText('Forecast at the last day’s pace')).toBeInTheDocument();

    // 2. A column a day; every part is its job's link, with a colour and a pattern of its own.
    const days = card('by-day-job');
    expect(within(days).getByRole('link', { name: 'Feedback API' })).toHaveAttribute('href', '#/job/orbit-479-feedback-api');
    expect(within(days).getByRole('link', { name: 'Export' })).toHaveAttribute('href', '#/job/orbit-512-export');
    expect(within(days).queryByText('Tidy logs')).toBeNull(); // someone else's job: not in a private graph
    const segs = [...days.querySelectorAll('a.tele-seg')];
    expect(segs.length).toBeGreaterThan(5);
    expect(segs.every((a) => /tele-s\d/.test(a.className) && /tele-pat-\d/.test(a.className))).toBe(true);
    expect(new Set(segs.map((a) => a.className)).size).toBe(2);
    expect(segs[0]).toHaveAttribute('href', expect.stringMatching(/^#\/job\/orbit-/));
    expect(within(days).getAllByRole('listitem', { name: /^Tue 27 Oct: 12% of the week \(\$6\.00\) in all; / })).toHaveLength(1);

    // 3. Cost per ticket and per stage, last 30 days, in dollars and percent of a week.
    const cost = card('cost');
    expect(within(cost).getByRole('listitem', { name: 'ORBIT-479: 197% of a week ($98.50)' })).toBeInTheDocument();
    expect(within(cost).getByRole('listitem', { name: 'ORBIT-512: 66% of a week ($33.00)' })).toBeInTheDocument();
    expect(within(cost).getByRole('listitem', { name: 'Plan: 132% of a week ($66.00)' })).toBeInTheDocument();

    // 4. One bar per plan week, split by model, with a legend.
    const models = card('by-model');
    expect(within(models).getByText('Opus 5.5')).toBeInTheDocument();
    expect(within(models).getByRole('img', { name: /^22 Oct to 28 Oct, Opus 5\.5: 62% \(\$27\.00\)$/ })).toBeInTheDocument();

    // 5. One bar per person, names only.
    const people = card('people');
    expect(within(people).getByRole('listitem', { name: 'vignesh: 69% of the week ($34.50)' })).toBeInTheDocument();
    expect(within(people).getByRole('listitem', { name: 'sohum: 18% of the week ($9.00)' })).toBeInTheDocument();
  });

  it('shows each graph as a table and back', async () => {
    setup();
    await screen.findByText('At this pace, full on Thursday 03:48.');
    const people = card('people');
    const toggle = within(people).getByRole('button', { name: 'Show as a table' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    const rows = within(people).getAllByRole('row').map((r) => r.textContent);
    expect(rows).toEqual(['PersonCostShare of the week', 'vignesh$34.5069%', 'sohum$9.0018%']);
    expect(within(people).getByRole('button', { name: 'Show the graph' })).toHaveAttribute('aria-pressed', 'true');
    // The sentence stays under the table.
    expect(within(people).getByText(/^vignesh used the most this week/)).toBeInTheDocument();
    fireEvent.click(within(people).getByRole('button', { name: 'Show the graph' }));
    expect(within(people).queryByRole('table')).toBeNull();

    fireEvent.click(within(card('by-day-job')).getByRole('button', { name: 'Show as a table' }));
    const table = within(card('by-day-job')).getByRole('table');
    expect(within(table).getByRole('link', { name: 'Feedback API' })).toHaveAttribute('href', '#/job/orbit-479-feedback-api');
    expect(within(table).getByRole('row', { name: /^Wed 28 Oct/ }).textContent).toContain('6% of the week ($3.00)');

    fireEvent.click(within(card('gauge')).getByRole('button', { name: 'Show as a table' }));
    const readings = within(card('gauge')).getAllByRole('row');
    expect(readings).toHaveLength(1 + 23); // the head, and the week's 23 readings
    expect(readings.at(-1)?.textContent).toMatch(/87%30%$/);
  });

  it('the window picker refetches, keeps the old graphs while it does, and is remembered', async () => {
    let release: (() => void) | null = null;
    const { get } = setup({
      get: async (path) => {
        const w = new URLSearchParams(path.split('?')[1]).get('window') as TelemetryWindow;
        if (w === '30d') await new Promise<void>((r) => { release = r; });
        return answer(w, METERS_OFF);
      },
    });
    await screen.findByText('At this pace, full on Thursday 03:48.');
    const thirty = screen.getByRole('button', { name: '30 days' });
    fireEvent.click(thirty);
    expect(thirty).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /This week/ })).toHaveAttribute('aria-pressed', 'false');
    expect(get).toHaveBeenLastCalledWith('/api/telemetry?window=30d');
    expect(document.querySelector('.tele-grid')).toHaveClass('is-loading');
    expect(screen.getByText('Feedback API used the most this week: 51% of the week ($25.50).')).toBeInTheDocument();
    await act(async () => { release?.(); });
    await screen.findByText(/^Feedback API used the most in the last 30 days/);
    expect(document.querySelector('.tele-grid')).not.toHaveClass('is-loading');
    expect(card('gauge').querySelectorAll('line.reset')).toHaveLength(4);
    expect(localStorage.getItem('workshop.telemetryWindow')).toBe('30d');

    // Five hours: no forecast drawn (too short to show it); the fact stays in words.
    fireEvent.click(screen.getByRole('button', { name: 'This five hours' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/api/telemetry?window=5h'));
    await waitFor(() => expect(card('gauge').querySelector('path.forecast')).toBeNull());
    expect(within(card('gauge')).queryByText('Forecast at the last day’s pace')).toBeNull();
  });

  it('opens on the window chosen last time', async () => {
    localStorage.setItem('workshop.telemetryWindow', '30d');
    const { get } = setup();
    await screen.findByText(/^Feedback API used the most in the last 30 days/);
    expect(get).toHaveBeenCalledWith('/api/telemetry?window=30d');
  });

  it('keeps the meters and Read now at the top, and Read now reads the usage and the graphs again', async () => {
    const { get, post, store } = setup({ planUsage: METERS_ON });
    await screen.findByText('At this pace, full on Thursday 03:48.');
    const now = screen.getByRole('region', { name: 'Claude plan usage now' });
    const week = now.querySelector('[data-meter="Weekly limit"]') as HTMLElement;
    expect(week).toHaveClass('is-warn');
    expect(week.textContent).toContain('⚠ 87% used'); // not colour alone: a sign and the words
    expect(within(now).getByText('30% used')).toBeInTheDocument();
    const calls = get.mock.calls.length;
    fireEvent.click(within(now).getByRole('button', { name: 'Read now' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/usage/check', {}));
    await waitFor(() => expect(get.mock.calls.length).toBe(calls + 1));
    expect(store.getState().planUsage?.week?.percent).toBe(88);
    await waitFor(() => expect(week.textContent).toContain('⚠ 88% used'));
  });

  it('says so in words when the plan usage is not read', async () => {
    setup();
    expect(await screen.findByText(/The plan’s usage isn’t read on this dashboard/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read now' })).toBeNull();
  });

  it('says what went wrong and offers Try again', async () => {
    let fail = true;
    setup({ get: async () => { if (fail) throw new Error('The dashboard is not answering.'); return answer('week', METERS_OFF); } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t read the usage log: The dashboard is not answering.');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('At this pace, full on Thursday 03:48.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reads each point of the weekly line with the arrow keys', async () => {
    setup();
    await screen.findByText('At this pace, full on Thursday 03:48.');
    const svg = card('gauge').querySelector('svg.tele-svg') as SVGSVGElement;
    expect(svg).toHaveAttribute('tabindex', '0');
    expect(svg.getAttribute('aria-label')).toContain('At this pace, full on Thursday 03:48.');
    fireEvent.keyDown(svg, { key: 'End' });
    expect(svg.querySelector('line.cross')).not.toBeNull();
    expect(within(card('gauge')).getByText('weekly limit').parentElement?.textContent).toContain('87%');
    fireEvent.keyDown(svg, { key: 'ArrowLeft' });
    expect(within(card('gauge')).getByText('weekly limit').parentElement?.textContent).toContain('81%');
    fireEvent.keyDown(svg, { key: 'Escape' });
    expect(svg.querySelector('line.cross')).toBeNull();
  });

  it('words and small helpers', () => {
    expect(amountWords({ usd: 25.5, percent: 51 })).toBe('51% of the week ($25.50)');
    expect(amountWords({ usd: 3, percent: null })).toBe('$3.00');
    expect([0, 0.7, 7, 12, 26, 51, 130].map(niceMax)).toEqual([1, 1, 10, 20, 50, 100, 200]);
    const rows = Array.from({ length: 10 }, (_, i) => ({ key: `T-${i}`, label: `T-${i}`, usd: 10 - i, percent: 2 * (10 - i) }));
    const folded = fold(rows, 'Other tickets');
    expect(folded).toHaveLength(8);
    expect(folded[7]).toEqual({ key: null, label: 'Other tickets (3)', usd: 6, percent: 12 });
  });
});

describe('Telemetry.css: themes and colours', () => {
  const css = readFileSync(here('./Telemetry.css'), 'utf8');
  const block = (selector: RegExp) => css.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? '';

  it('has literal colours only in the --tele-* token blocks', () => {
    const literal = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i;
    const stray = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => literal.test(l) && !/^\s*--tele-[\w-]+:/.test(l));
    expect(stray).toEqual([]);
  });

  it('gives the eight series slots in dark, and the light steps to every light theme', () => {
    const dark = block(/^\.tele/m);
    for (let i = 1; i <= 8; i++) expect(dark).toMatch(new RegExp(`--tele-${i}: #[0-9a-f]{6};`));
    const lights = THEMES.filter((t) => t.scheme === 'light').map((t) => t.id);
    expect(lights.length).toBeGreaterThan(0);
    for (const id of lights) expect(css).toContain(`html[data-theme="${id}"] .tele`);
    const light = css.slice(css.indexOf('html[data-theme="light"] .tele'));
    const lightBlock = light.slice(light.indexOf('{') + 1, light.indexOf('}'));
    for (let i = 1; i <= 8; i++) expect(lightBlock).toMatch(new RegExp(`--tele-${i}: #[0-9a-f]{6};`));
    // A dark theme never gets the light steps.
    for (const t of THEMES.filter((x) => x.scheme === 'dark')) expect(css).not.toContain(`html[data-theme="${t.id}"] .tele`);
  });

  it('gives every series slot a fill and a pattern, so colour never works alone', () => {
    for (const s of [1, 2, 3, 4, 5, 6, 7, 8, 'other']) expect(css).toMatch(new RegExp(`\\.tele-s${s === 'other' ? 'other' : s}\\b[^{]*\\{[^}]*var\\(--tele-${s}\\)`));
    for (const s of [2, 3, 4, 5, 6, 7, 8, 'other']) expect(css).toMatch(new RegExp(`\\.tele-pat-${s}\\b[^{]*\\{[^}]*gradient`));
    expect(css).toMatch(/@media \(forced-colors: active\)/);
  });
});
