// Telemetry (#/telemetry): the page drawn from the dashboard's own sums (dashboard/lib/telemetry.js
// and lib/insights.js, over the 30-day fixture dashboard/test/fixtures/telemetry/usage.jsonl, so the
// page and the numbers its node tests worked out by hand are the same): the dials and who used the
// week (with Other use), the ten cards with Fold, Hide, Show again and Table ▸, the window picker,
// Read now, the empty state and the phone width; and the colour rules for Telemetry.css. No model
// calls: the dashboard is a fake api.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { PlanUsage, TelemetryResponse, TelemetryWindow } from '../api/types';
import { installKeyListener, KEYS } from '../app/keyRegistry';
import { hrefFor, parseHash, telemetryHref } from '../app/router';
import { KeyGroups } from './JobSheets/KeysSheet';
import { createStore, WorkshopContext } from '../state/store';
import { LEVELS, snapshot } from '../state/test-fixtures';
import { TelemetryView } from './Telemetry';
import { niceMax, parsePrefs, prefsKey, weekTick } from './Telemetry/words';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const FIXTURE = readFileSync(here('../../../dashboard/test/fixtures/telemetry/usage.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const LIB = here('../../../dashboard/lib/telemetry.js');
type Sums = (lines: unknown[], opts: Record<string, unknown>) => Omit<TelemetryResponse, 'meters' | 'file'>;
const { telemetry } = (await import(/* @vite-ignore */ LIB)) as { telemetry: Sums };

const NOW = '2026-10-28T12:00:00.000Z';
const TITLES = { 'orbit-479-feedback-api': 'Feedback API', 'orbit-512-export': 'Export', 'tidy-logs': 'Tidy logs' };
const LAST = FIXTURE[FIXTURE.length - 1].meters;
// The live reading at 11:59: 95 %, eight points over the last line's 87 % with no turn of this app
// between them, so those eight are Other use.
const METERS_ON: PlanUsage = { enabled: true, fiveHour: LAST.fiveHour, week: { percent: 95, resetsAt: LAST.week.resetsAt }, checkedAt: '2026-10-28T11:59:00.000Z', error: null };
const METERS_OFF: PlanUsage = { enabled: false, fiveHour: null, week: null, checkedAt: null, error: null };

/** What GET /api/telemetry?window= answers for the fixture at NOW (as the runner builds it). */
const answer = (window: TelemetryWindow, meters: PlanUsage = METERS_ON, lines: unknown[] = FIXTURE): TelemetryResponse => ({
  ...telemetry(lines, { window, now: NOW, me: 'vignesh', meters: meters.enabled ? meters : null, titles: TITLES, timeZone: 'UTC', shortStretch: 7 * 3600e3 }),
  meters,
  file: '/home/you/.ground-control/usage.jsonl',
});

function setup({ planUsage = METERS_ON as PlanUsage | null, get }: { planUsage?: PlanUsage | null; get?: (path: string) => Promise<unknown> } = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', levels: LEVELS } }) });
  if (planUsage) store.dispatch({ type: 'plan-usage', planUsage });
  const getFn = vi.fn(get ?? (async (path: string) => {
    const w = new URLSearchParams(path.split('?')[1]).get('window') as TelemetryWindow;
    return answer(w, planUsage ?? METERS_OFF);
  }));
  const post = vi.fn(async () => METERS_ON);
  const api = { get: getFn, post, del: vi.fn() } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}><TelemetryView /></WorkshopContext.Provider>);
  return { get: getFn, post, store };
}
const card = (id: string) => document.querySelector(`[data-graph="${id}"]`) as HTMLElement;
// The live reading's eight points make the last day's pace faster: full on Wednesday 17:43.
const ready = () => screen.findByRole('heading', { name: 'At this pace the week is full on Wednesday 17:43, mostly from this app’s jobs.' });

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('Telemetry', () => {
  it('is its own page at #/telemetry', () => {
    expect(parseHash('#/telemetry')).toEqual({ name: 'telemetry' });
    expect(hrefFor({ name: 'telemetry' })).toBe('#/telemetry');
    expect(telemetryHref()).toBe('#/telemetry');
  });

  it('draws the ten graphs in order, each headed by its finding, with What to do and who sees it', async () => {
    const { get } = setup();
    await ready();
    expect(get).toHaveBeenCalledWith('/api/telemetry?window=week');
    const cards = [...document.querySelectorAll('.tele-card')].map((c) => [c.getAttribute('data-graph'), c.querySelector('.tele-num')?.textContent, c.querySelector('.tele-card-name')?.textContent, c.querySelector('.tele-audience')?.textContent?.trim()]);
    expect(cards).toEqual([
      ['limit', '1', 'Weekly limit and forecast', 'Whole account'],
      ['ticket-cost', '2', 'Cost per finished ticket, by week', 'Only yours'],
      ['stages', '3', 'Where the spend goes, by stage', 'Only yours'],
      ['models', '4', 'Models: share and what a switch would save', 'Whole account'],
      ['people', '5', 'People on the account', 'Whole account'],
      ['rework', '6', 'Rework', 'Only yours'],
      ['waiting', '7', 'Waiting on you', 'Only yours'],
      ['pr1', '8', 'Time to PR #1, by job size', 'Only yours'],
      ['when', '9', 'When the limit goes', 'Whole account'],
      ['cache', '10', 'Cache reuse', 'Only yours'],
    ]);
    for (const c of document.querySelectorAll('.tele-card')) {
      expect(c.querySelector('.tele-headline')?.textContent).toMatch(/\.$/);
      expect(c.querySelector('.tele-todo')?.textContent?.trim()).toMatch(/^What to do .+\./);
    }
    expect(screen.getByText('Ten graphs')).toBeInTheDocument();
    // Too little to say: the finding says so instead of guessing.
    expect(within(card('pr1')).getByRole('heading', { level: 3 })).toHaveTextContent('Not enough jobs at PR #1 yet to say');
    expect(within(card('rework')).getByRole('heading', { level: 3 })).toHaveTextContent('Can’t see send-backs here yet.');
    // No product name in anything the page says.
    expect(document.body.textContent).not.toMatch(/Ground Control/);
  });

  it('shows who used this week’s limit: each person and Other use, with a name, a percent and a pattern, and what Other use means', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
    setup();
    await ready();
    const who = screen.getByRole('region', { name: 'Who used this week’s limit' });
    // vignesh $34.50 and sohum $9 at 2 % a dollar: 69 % and 18 %; the meter reads 95 %: 8 % other use; 5 % free.
    const legend = [...who.querySelectorAll('.tele-legend li')].map((li) => li.textContent);
    expect(legend).toEqual(['vignesh 69%', 'sohum 18%', 'Other use (estimated) 8%', 'Still free 5%']);
    const swatches = [...who.querySelectorAll('.tele-legend .tele-swatch')].map((s) => s.className);
    expect(swatches[0]).toContain('tele-s1');
    expect(swatches[2]).toContain('tele-s8');
    expect(who.textContent).toMatch(/claude\.ai, the Claude app, or someone’s own Claude Code/);
    expect(who.textContent).toMatch(/anyone using this app on another computer/);
    // Each segment opens People on the account.
    fireEvent.click(within(who).getByRole('button', { name: /^sohum: 18% of this week’s limit, in this app\. Show more\.$/ }));
    expect(scroll).toHaveBeenCalled();
    // The dials: the week, near the limit (⚠ and words, not colour alone), split into its two parts.
    const week = document.querySelector('[data-dial="Weekly limit"]') as HTMLElement;
    expect(week).toHaveClass('is-warn');
    expect(week.querySelector('.tele-dial-num')?.textContent).toBe('⚠ 95% used (near the limit)');
    expect(week.textContent).toContain('In this app 87%');
    expect(week.textContent).toContain('Other use 8%, estimated');
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('⚠ The week is at 95%');
    // People on the account has the Others row, estimated.
    fireEvent.click(within(card('people')).getByRole('button', { name: /^Table/ }));
    expect(within(card('people')).getByRole('row', { name: /Others \(outside this app, estimated\) 8%/ })).toBeInTheDocument();
  });

  it('folds a card to its headline and hides one, remembered per person; Show again brings it back', async () => {
    setup();
    await ready();
    fireEvent.click(within(card('stages')).getByRole('button', { name: /^Fold$/ }));
    expect(card('stages')).toHaveClass('is-folded');
    expect(card('stages').querySelector('.tele-todo')).toBeNull();
    expect(parsePrefs(localStorage.getItem(prefsKey('vignesh'))).folded.stages).toBe(true);
    // The folded headline is the way back too.
    fireEvent.click(within(card('stages')).getByRole('button', { name: /costs .* of your spend/ }));
    expect(card('stages')).not.toHaveClass('is-folded');
    fireEvent.click(within(card('people')).getByRole('button', { name: /^Hide$/ }));
    expect(card('people')).toBeNull();
    const fold = screen.getByText('Show hidden graphs (1)').closest('details') as HTMLDetailsElement;
    fold.open = true;
    expect(within(fold).getByText('5 · People on the account')).toBeInTheDocument();
    fireEvent.click(within(fold).getByRole('button', { name: 'Show again' }));
    expect(card('people')).not.toBeNull();
    expect(screen.queryByText(/Show hidden graphs/)).toBeNull();
    expect(screen.getByText(/Fold and Hide are remembered in this browser, for you only\./)).toBeInTheDocument();
  });

  it('Table ▸ shows the numbers under the graph', async () => {
    setup();
    await ready();
    const stages = card('stages');
    const btn = within(stages).getByRole('button', { name: 'Table' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(within(stages).getByRole('button', { name: 'Table' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(stages).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Stage', 'October', 'September', 'Change']);
  });

  it('the window picker asks for that window and remembers it; Read now reads the limits', async () => {
    const { get, post } = setup();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /30 days/ }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/telemetry?window=30d'));
    expect(screen.getByRole('button', { name: /30 days/ })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('workshop.telemetryWindow')).toBe('30d');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Read now/ })); });
    expect(post).toHaveBeenCalledWith('/api/usage/check', {});
  });

  it('r reads the limits now on this page; Settings → Keys lists Telemetry’s keys', async () => {
    const off = installKeyListener();
    try {
      const { post } = setup();
      await ready();
      expect(screen.getByRole('button', { name: /^Read now/ }).querySelector('kbd')?.textContent).toBe('r');
      await act(async () => { fireEvent.keyDown(document.body, { key: 'r' }); });
      expect(post).toHaveBeenCalledWith('/api/usage/check', {});
    } finally { off(); }
    expect(KEYS['tele-read'].keys).toEqual(['r']);
    expect(KEYS['tele-step'].keys).toEqual(['ArrowLeft', 'ArrowRight']);
    render(<KeyGroups />);
    expect(screen.getByText('Telemetry: read the limits now')).toBeInTheDocument();
    expect(screen.getByText('Telemetry: step through the weekly line’s readings, or the weekday map’s squares')).toBeInTheDocument();
  });

  it('says what went wrong and offers Try again', async () => {
    let fail = true;
    setup({ get: async () => { if (fail) throw new Error('The dashboard is not answering.'); return answer('week'); } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t read the usage log: The dashboard is not answering.');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await ready();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reads each reading of the weekly line with the arrow keys', async () => {
    setup();
    await ready();
    const svg = card('limit').querySelector('svg.tele-svg') as SVGSVGElement;
    expect(svg).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(svg, { key: 'End' });
    expect(svg.querySelector('line.cross')).not.toBeNull();
    expect(card('limit').querySelector('[aria-live="polite"]')?.textContent).toMatch(/week 95%/);
    fireEvent.keyDown(svg, { key: 'ArrowLeft' });
    expect(card('limit').querySelector('[aria-live="polite"]')?.textContent).toMatch(/week 87%/);
    fireEvent.keyDown(svg, { key: 'Escape' });
    expect(svg.querySelector('line.cross')).toBeNull();
  });

  it('with no line and no reading: the empty state, with Read now', async () => {
    const none = { ...METERS_ON, fiveHour: null, week: null, checkedAt: null };
    setup({ planUsage: none, get: async () => answer('week', none, []) });
    expect(await screen.findByRole('heading', { name: 'No readings yet' })).toBeInTheDocument();
    expect(screen.getByText(/The meters fill in after the first Foreman turn on this computer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Read now/ })).toBeEnabled();
  });

  it('without the limits read here (demo mode): says so, and Read now waits', async () => {
    setup({ planUsage: null });
    await screen.findByRole('region', { name: 'Next step' });
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('The limits aren’t read on this computer');
    expect(screen.getByRole('button', { name: /^Read now/ })).toBeDisabled();
  });

  it('at phone width the cards are folded to their headlines, all but the first', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width: 760px'), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
    setup();
    await ready();
    expect(card('limit')).not.toHaveClass('is-folded');
    for (const id of ['ticket-cost', 'stages', 'models', 'people', 'when', 'cache']) expect(card(id)).toHaveClass('is-folded');
    fireEvent.click(within(card('models')).getByRole('button', { name: /^Opus/ }));
    expect(card('models')).not.toHaveClass('is-folded');
  });

  it('small helpers', () => {
    expect([0, 0.7, 7, 12, 26, 51, 130].map(niceMax)).toEqual([1, 1, 10, 20, 50, 100, 200]);
    expect(weekTick('Week from Wed 28 Oct, 4 pm')).toBe('28 Oct');
    expect(parsePrefs('not json')).toEqual({ folded: {}, hidden: [] });
    expect(prefsKey('sohum')).not.toBe(prefsKey('vignesh'));
  });
});

// ---------- Telemetry.css: the same bar as the app's other stylesheets (theme/cssRules.test.ts) ----------

describe('Telemetry.css', () => {
  const css = readFileSync(here('./Telemetry.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) => m[2].split(';').map((d) => {
    const i = d.indexOf(':');
    return i < 0 ? null : { selector: m[1].trim().replace(/\s+/g, ' '), prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() };
  }).filter((d): d is { selector: string; prop: string; value: string } => d !== null));

  it('writes out no colour: every colour is a theme token (no --tele-* palette of its own)', () => {
    const literal = (v: string) => {
      const x = v.replace(/var\(--[\w-]+/g, 'var(');
      return /#[0-9a-f]{3,8}\b/i.test(x) || /\b(rgba?|hsla?|hwb|lab|lch|oklab)\(/i.test(x) || /\boklch\((?!\s*var\()/i.test(x)
        || /(^|[\s,(])(white|black|red|green|blue|gr[ae]y|orange|yellow|purple|pink|silver|gold|navy|teal)\b/i.test(x);
    };
    expect(decls.filter((d) => literal(d.value)).map((d) => `${d.selector} { ${d.prop}: ${d.value} }`)).toEqual([]);
    expect(css).not.toMatch(/--tele-\d/);
  });

  it('gives every series slot the chart token and its pattern, so colour never works alone', () => {
    for (let n = 1; n <= 8; n++) expect(css).toMatch(new RegExp(`\\.tele-s${n} \\{ background: var\\(--chart-pattern-${n}\\), var\\(--chart-${n}\\); \\}`));
    expect(css).toMatch(/@media \(forced-colors: active\)/);
  });

  it('no transition over 200 ms, and nothing you click shorter than 40 px', () => {
    const slow = decls.filter((d) => /^transition/.test(d.prop) && [...d.value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)].some((m) => (m[2] === 's' ? +m[1] * 1000 : +m[1]) > 200));
    expect(slow).toEqual([]);
    const clickable = /(^|[\s,.#:[(>+~-])(btn|button|summary|select|tab|chip|toggle|option|menu-item|seg)([\s,.:#[)>+~-]|$)/i;
    const short = decls.filter((d) => /^(min-)?height$/.test(d.prop) && clickable.test(d.selector) && /^(\d+(?:\.\d+)?)px$/.test(d.value) && parseFloat(d.value) < 40);
    expect(short).toEqual([]);
  });

  it('uses only tokens the theme defines', () => {
    const tokens = readFileSync(here('../theme/tokens.css'), 'utf8');
    const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = [...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].filter((t) => t !== '--heat');
    expect(used.filter((t) => !defined.has(t))).toEqual([]);
  });
});
