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
import type { ClaudeCodeUse, PlanUsage, TelemetryResponse, TelemetryWindow } from '../api/types';
import { installKeyListener, KEYS } from '../app/keyRegistry';
import { hrefFor, parseHash, telemetryHref } from '../app/router';
import { setDefaultDetail } from '../app/detail';
import { KeyGroups } from './JobSheets/KeysSheet';
import { createStore, WorkshopContext } from '../state/store';
import { LEVELS, snapshot } from '../state/test-fixtures';
import { READING_MS, TelemetryView } from './Telemetry';
import { niceMax, parsePrefs, prefsKey, weekTick } from './Telemetry/words';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const FIXTURE = readFileSync(here('../../../dashboard/test/fixtures/telemetry/usage.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const LIB = here('../../../dashboard/lib/telemetry.js');
type Sums = (lines: unknown[], opts: Record<string, unknown>) => Omit<TelemetryResponse, 'meters' | 'file'>;
const { telemetry } = (await import(/* @vite-ignore */ LIB)) as { telemetry: Sums };
// The words the runner sends with claudeCode (dashboard/lib/claude-code-usage.js; nothing in it reads a log here).
const CC_LIB = here('../../../dashboard/lib/claude-code-usage.js');
const { CLAUDE_CODE_WORDS, CLAUDE_CODE_NOTE } = (await import(/* @vite-ignore */ CC_LIB)) as { CLAUDE_CODE_WORDS: Record<ClaudeCodeUse['state'], string>; CLAUDE_CODE_NOTE: string };

const NOW = '2026-10-28T12:00:00.000Z';
const TITLES = { 'orbit-479-feedback-api': 'Feedback API', 'orbit-512-export': 'Export', 'tidy-logs': 'Tidy logs' };
const LAST = FIXTURE[FIXTURE.length - 1].meters;
// The live reading at 11:59: 95 %, eight points over the last line's 87 % with no turn of this app
// between them, so those eight are Other use.
const METERS_ON: PlanUsage = { enabled: true, fiveHour: LAST.fiveHour, week: { percent: 95, resetsAt: LAST.week.resetsAt }, checkedAt: '2026-10-28T11:59:00.000Z', error: null };
const METERS_OFF: PlanUsage = { enabled: false, fiveHour: null, week: null, checkedAt: null, error: null };

/** What GET /api/telemetry?window= answers for the fixture at NOW (as the runner builds it). */
const answer = (window: TelemetryWindow, meters: PlanUsage = METERS_ON, lines: unknown[] = FIXTURE, outside: unknown[] | null = null): TelemetryResponse => ({
  ...telemetry(lines, { window, now: NOW, me: 'vignesh', meters: meters.enabled ? meters : null, titles: TITLES, timeZone: 'UTC', shortStretch: 7 * 3600e3, outside }),
  meters,
  file: '/home/you/.ground-control/usage.jsonl',
});
// vignesh's Claude Code outside this app, read from a made-up log: six replies of $0.50 between the
// last line (87 %, 07:00) and the live reading (95 %, 11:59). At 2 % a dollar that is 6 of the 8 points.
const OUTSIDE = Array.from({ length: 6 }, (_, i) => ({ t: new Date(Date.parse('2026-10-28T08:00:00Z') + i * 20 * 60e3).toISOString(), user: 'vignesh', usd: 0.5 }));
/** The answer with claudeCode in each of its states, as the runner adds it (counted only when ready). */
const answerCc = (state: ClaudeCodeUse['state'], window: TelemetryWindow = 'week'): TelemetryResponse => {
  const body = answer(window, METERS_ON, FIXTURE, state === 'ready' ? OUTSIDE : null);
  const sums = (body as TelemetryResponse & { claudeCode?: { usd: number; replies: number } }).claudeCode;
  return { ...body, claudeCode: { state, counted: state === 'ready', words: CLAUDE_CODE_WORDS[state], note: CLAUDE_CODE_NOTE, usd: sums?.usd ?? null, replies: sums?.replies ?? null, readAt: state === 'ready' ? '2026-10-28T11:58:00.000Z' : null } };
};

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

/** Open a card's ⋯ menu and pick one of its actions. */
function menu(el: HTMLElement, action: string) {
  fireEvent.click(within(el).getByRole('button', { name: /^More for / }));
  fireEvent.click(within(el).getByRole('menuitem', { name: action }));
}

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
    // Columns of their own (packet R): read them in their numbers' order.
    const cards = [...document.querySelectorAll('.tele-card')].sort((a, b) => Number(a.querySelector('.tele-num')?.textContent) - Number(b.querySelector('.tele-num')?.textContent)).map((c) => [c.getAttribute('data-graph'), c.querySelector('.tele-num')?.textContent, c.querySelector('.tele-card-name')?.textContent, c.querySelector('.tele-audience')?.textContent?.trim()]);
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
      // What to do shows only when there is something to do.
      const todo = c.querySelector('.tele-todo')?.textContent?.trim();
      if (todo) expect(todo).toMatch(/^What to do .+\./);
    }
    expect(document.querySelectorAll('.tele-todo').length).toBeGreaterThan(0);
    // Simple's first three graphs, then More graphs with the other seven (open in Full).
    expect(screen.getByRole('button', { name: /^More graphs \(7\)/ })).toHaveAttribute('aria-expanded', 'true');
    // Too little to say: the finding says so instead of guessing.
    expect(within(card('pr1')).getByRole('heading', { level: 3 })).toHaveTextContent('Not enough jobs at PR #1 yet to say');
    expect(within(card('rework')).getByRole('heading', { level: 3 })).toHaveTextContent('Can’t see send-backs here yet.');
    // No product name in anything the page says.
    expect(document.body.textContent).not.toMatch(/Ground Control/);
  });

  it('in Simple: the dials, Who used this week’s limit and three graphs, the rest behind More graphs (n), which opens them in place', async () => {
    setDefaultDetail('simple');
    try {
      setup();
      await screen.findByRole('region', { name: 'Who used this week’s limit' });
      expect(document.querySelectorAll('.tele-dial')).toHaveLength(2);
      const more = await screen.findByRole('button', { name: /^More graphs \(7\)/ });
      expect(more).toHaveAttribute('aria-expanded', 'false');
      const shown = () => [...document.querySelectorAll('.tele-card')];
      expect(shown()).toHaveLength(3);
      expect(shown().every((c) => !c.closest('.tele-more'))).toBe(true);
      fireEvent.click(more);
      expect(more).toHaveAttribute('aria-expanded', 'true');
      expect(shown()).toHaveLength(10);
      expect(document.querySelectorAll('.tele-more .tele-card')).toHaveLength(7);
      // The stages, by their stop's hue, each named beside its bar.
      const bars = [...card('stages').querySelectorAll('.tele-pair-row .tele-bar-track:first-child .tele-bar')];
      expect(bars.length).toBeGreaterThan(0);
      for (const bar of bars) expect(bar.className).toMatch(/tele-stop is-[a-z]+/);
      expect(bars.some((b) => /is-(spec|plan|build|test|review|investigate|ship)\b/.test(b.className))).toBe(true);
    } finally { setDefaultDetail('full'); }
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
    menu(card('people'), 'Show the table');
    expect(within(card('people')).getByRole('row', { name: /Others \(outside this app, estimated\) 8%/ })).toBeInTheDocument();
  });

  it('folds a card to its headline and hides one, remembered per person; Show again brings it back', async () => {
    setup();
    await ready();
    menu(card('stages'), 'Fold');
    expect(card('stages')).toHaveClass('is-folded');
    expect(card('stages').querySelector('.tele-todo')).toBeNull();
    expect(parsePrefs(localStorage.getItem(prefsKey('vignesh'))).folded.stages).toBe(true);
    // The folded headline is the way back too.
    fireEvent.click(within(card('stages')).getByRole('button', { name: /costs .* of your spend/ }));
    expect(card('stages')).not.toHaveClass('is-folded');
    menu(card('people'), 'Hide');
    expect(card('people')).toBeNull();
    // A slim line keeps its place, with Show.
    const slot = screen.getByRole('group', { name: 'People on the account, hidden' });
    fireEvent.click(within(slot).getByRole('button', { name: 'Show' }));
    expect(card('people')).not.toBeNull();
    expect(screen.queryByRole('group', { name: /, hidden$/ })).toBeNull();
    expect(screen.getByText(/Fold, Hide and More graphs are remembered in this browser, for you only\./)).toBeInTheDocument();
  });

  it('the ⋯ menu shows the numbers in place of the graph, and the graph again', async () => {
    setup();
    await ready();
    const stages = card('stages');
    menu(stages, 'Show the table');
    expect(stages.querySelector('.tele-table')).not.toBeNull();
    expect(within(stages).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Stage', 'October', 'September', 'Change']);
  });

  it('the window picker asks for that window and remembers it; Read now reads the limits', async () => {
    const { get, post } = setup();
    await ready();
    // The shared segmented choice (packet R): one radio group, the arrow keys move the pick.
    const windows = screen.getByRole('radiogroup', { name: /^Window/ });
    expect(within(windows).getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual(['5h', 'week', '30d']);
    expect(within(windows).getByRole('radio', { name: /This week/ })).toBeChecked();
    fireEvent.click(within(windows).getByRole('radio', { name: /30 days/ }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/telemetry?window=30d'));
    expect(within(windows).getByRole('radio', { name: /30 days/ })).toBeChecked();
    expect(within(windows).getByRole('radio', { name: /This week/ })).not.toBeChecked();
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

// ---------- Your Claude Code use outside this app (packet U) ----------

describe('Telemetry: your Claude Code use outside this app', () => {
  const who = () => screen.getByRole('region', { name: 'Who used this week’s limit' });
  const legend = (el: HTMLElement) => [...el.querySelectorAll('.tele-legend li')].map((li) => li.textContent);
  const weekDial = () => document.querySelector('[data-dial="Weekly limit"]') as HTMLElement;
  const how = () => within(who()).getByRole('region', { name: 'How this is worked out' });
  const setupCc = (state: ClaudeCodeUse['state'] | (() => ClaudeCodeUse['state'])) => setup({
    get: async (path: string) => answerCc(typeof state === 'function' ? state() : state, new URLSearchParams(path.split('?')[1]).get('window') as TelemetryWindow),
  });

  it('ready: each person splits into in the app and in Claude Code, each with its own pattern and words; Other use takes its new name', async () => {
    setupCc('ready');
    await screen.findByRole('region', { name: 'Who used this week’s limit' });
    await waitFor(() => expect(legend(who())).toEqual(['vignesh in the app 69%', 'vignesh in Claude Code 6%', 'sohum in the app 18%', 'Other use (claude.ai, the Claude app, other people), estimated 2%', 'Still free 5%']));
    // The two parts of a person: the same hue, the Claude Code one washed and dotted, never colour alone.
    const keys = [...who().querySelectorAll('.tele-legend .tele-swatch')].map((s) => s.className);
    expect(keys[0]).toContain('tele-s1');
    expect(keys[0]).not.toContain('tele-cc');
    expect(keys[1]).toContain('tele-s1');
    expect(keys[1]).toContain('tele-cc');
    expect(keys[3]).toContain('tele-s8');
    // Each segment says in words whose it is and where.
    expect(within(who()).getByRole('button', { name: 'vignesh: 69% of this week’s limit, in this app. Show more.' })).toHaveClass('tele-s1');
    expect(within(who()).getByRole('button', { name: 'vignesh: 6% of this week’s limit, in Claude Code outside this app. Show more.' })).toHaveClass('tele-cc');
    expect(within(who()).getByRole('img', { name: /^Who used this week’s limit: vignesh in the app 69%, vignesh in Claude Code 6%, sohum in the app 18%, Other use \(claude\.ai, the Claude app, other people\), estimated 2%, still free 5%\.$/ })).toBeInTheDocument();
    // The dial draws its slice and names it.
    expect(weekDial().querySelector('path.is-cc')).not.toBeNull();
    expect(weekDial().textContent).toContain('In this app 87%');
    expect(weekDial().textContent).toContain('In Claude Code 6%');
    expect(weekDial().textContent).toContain('Other use 2%, estimated');
    // Simple shows the line; the words and what it can't see sit behind How this is worked out.
    expect(how()).toHaveTextContent(CLAUDE_CODE_WORDS.ready);
    expect(how()).toHaveTextContent(/don’t explain: claude\.ai, the Claude app and other people/);
    expect(how()).toHaveTextContent(/Only this computer’s Claude Code logs are read, so a teammate’s Claude Code on their own computer is in it too/);
    expect(how()).not.toHaveTextContent(CLAUDE_CODE_NOTE); // said once, in Other use's note
    // Graph 5: the same parts, with each part's spend; graph 9 says the part in each square's words.
    const people = card('people');
    expect(within(people).getByRole('img', { name: /^Share of this week’s limit: vignesh in the app 69%, vignesh in Claude Code 6%, sohum in the app 18%, Other use \(claude\.ai, the Claude app, other people\), estimated 2%/ })).toBeInTheDocument();
    expect(people.querySelector('.tele-limit-part.tele-cc')).toHaveAttribute('title', 'vignesh in Claude Code · $3.00 · 6%');
    const when = card('when');
    expect(when.querySelectorAll('.tele-heat-cell.is-cc').length).toBeGreaterThan(1); // a square and the key
    expect(within(when).getByText('Mostly your Claude Code use outside this app')).toBeInTheDocument();
    expect([...when.querySelectorAll('.tele-heat-cell[title]')].some((c) => /your Claude Code [1-9]\d*%.*; mostly Claude Code$/.test(c.getAttribute('title') ?? ''))).toBe(true);
    expect(document.body.textContent).not.toMatch(/Ground Control/);
  });

  it('ready, the last 30 days: People shows each person’s dollars in the app and in Claude Code', async () => {
    localStorage.setItem('workshop.telemetryWindow', '30d');
    setupCc('ready');
    await waitFor(() => expect(card('people')?.querySelector('.tele-hbars')).not.toBeNull());
    const people = card('people');
    expect(legend(people)).toEqual(['In the app', 'In Claude Code, outside this app']);
    expect(within(people).getByRole('listitem', { name: /^vignesh: \$131\.50 in the app · \$3\.00 in Claude Code/ })).toBeInTheDocument();
    expect(people.querySelectorAll('.tele-bar-stack .tele-bar.tele-cc')).toHaveLength(1);
  });

  it('reading: the line for your Claude Code keeps its place and says so, the dial too, and the page asks again every 5 seconds until it is ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let state: ClaudeCodeUse['state'] = 'reading';
      const { get } = setupCc(() => state);
      await waitFor(() => expect(legend(who())).toEqual(['vignesh in the app 69%', 'vignesh in Claude Code · reading…vignesh in Claude Code: Reading Claude Code’s logs…', 'sohum in the app 18%', 'Other use, estimated (your Claude Code is in it until its logs are read) 8%', 'Still free 5%']));
      expect(within(who()).getByRole('status')).toHaveTextContent('Reading Claude Code’s logs…');
      expect(who().querySelector('.tele-legend .tele-reading')).not.toBeNull();
      // No segment for it yet: nothing is guessed.
      expect(who().querySelectorAll('.tele-limit-part.tele-cc')).toHaveLength(0);
      expect(weekDial().textContent).toContain('In Claude Code: reading…');
      expect(how()).toHaveTextContent(CLAUDE_CODE_NOTE);
      expect(how()).toHaveTextContent('Reading Claude Code’s logs…');
      expect(weekDial().querySelector('path.is-cc')).toBeNull();
      expect(READING_MS).toBe(5000);
      const asked = get.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(READING_MS); });
      expect(get.mock.calls.length).toBe(asked + 1);
      // Read: the line becomes the real part, in the same place, and the asking slows to every minute.
      state = 'ready';
      await act(async () => { await vi.advanceTimersByTimeAsync(READING_MS); });
      await waitFor(() => expect(legend(who())[1]).toBe('vignesh in Claude Code 6%'));
      const done = get.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(READING_MS * 3); });
      expect(get.mock.calls.length).toBe(done);
    } finally { vi.useRealTimers(); }
  });

  it('off: as before, and How this is worked out says where to turn it on', async () => {
    setupCc('off');
    await screen.findByRole('region', { name: 'Who used this week’s limit' });
    await waitFor(() => expect(legend(who())).toEqual(['vignesh 69%', 'sohum 18%', 'Other use (estimated) 8%', 'Still free 5%']));
    expect(how()).toHaveTextContent('Turn it on in Settings → Workflow → Count my Claude Code use outside the app.');
    expect(how()).not.toHaveTextContent(CLAUDE_CODE_NOTE);
    expect(weekDial().textContent).not.toContain('Claude Code');
  });

  it('demo: as before, and says the demo reads no Claude Code logs', async () => {
    setupCc('demo');
    await screen.findByRole('region', { name: 'Who used this week’s limit' });
    await waitFor(() => expect(how()).toHaveTextContent('The demo doesn’t read Claude Code’s logs.'));
    expect(legend(who())).toEqual(['vignesh 69%', 'sohum 18%', 'Other use (estimated) 8%', 'Still free 5%']);
  });

  it('error: says it couldn’t read them, with ⚠ and words, and counts this app’s own use only', async () => {
    setupCc('error');
    await screen.findByRole('region', { name: 'Who used this week’s limit' });
    const line = await within(who()).findByRole('status');
    expect(line).toHaveTextContent('Couldn’t read Claude Code’s logs, so they aren’t counted yet: this app’s own use only.');
    expect(line.querySelector('svg.icon')).not.toBeNull();
    expect(legend(who())).toEqual(['vignesh 69%', 'sohum 18%', 'Other use (estimated) 8%', 'Still free 5%']);
  });

  it('the old shape, from a dashboard without these fields: as before, no Claude Code anywhere on the top', async () => {
    setup({ get: async () => { const b = answer('week'); delete (b as Partial<TelemetryResponse>).claudeCode; delete b.limits.otherLabel; return b; } });
    await ready();
    expect(legend(who())).toEqual(['vignesh 69%', 'sohum 18%', 'Other use (estimated) 8%', 'Still free 5%']);
    expect(who().textContent).not.toMatch(/Claude Code’s logs/);
    expect(weekDial().textContent).not.toContain('In Claude Code');
    expect(document.querySelectorAll('.tele-cc')).toHaveLength(0);
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

  it('gives every categorical slot a status or stop hue and its pattern, so colour never works alone; Other use is grey', () => {
    for (let n = 1; n <= 7; n++) expect(css).toMatch(new RegExp(`\\.tele-s${n} \\{ background: var\\(--chart-pattern-${n}\\), var\\(--(status|stop)-[a-z]+\\); \\}`));
    expect(css).toMatch(/\.tele-s8 \{ background: var\(--chart-pattern-8\), var\(--text-3\); \}/);
    expect(css).toMatch(/@media \(forced-colors: active\)/);
  });

  it('draws a single series in the accent with grey for what it is compared with, and each stage in its stop’s hue', () => {
    expect(css).toMatch(/\.tele-one \{ background: var\(--accent\); \}/);
    expect(css).toMatch(/\.tele-svg \.week \{[^}]*stroke: var\(--accent\)/);
    expect(css).toMatch(/\.tele-svg \.five \{[^}]*stroke: var\(--text-3\)/);
    for (const stop of ['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship']) expect(css).toContain(`.tele-stop.is-${stop} { background: var(--stop-${stop}); }`);
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
