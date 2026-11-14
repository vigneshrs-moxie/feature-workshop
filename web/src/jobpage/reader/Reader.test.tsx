// The reader and its text views (job page rebuild, Task 12): one thing at a time under the same thin
// title row, typeset for reading. Built against the made-up long job.
import { act, fireEvent, render, within } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { UiProvider } from '../../app/ui';
import { createStore, WorkshopContext } from '../../state/store';
import { longJob } from '../fixtures/longJob';
import { createJobStore, type JobStore } from '../jobStore';
import { JobPage2 } from '../JobPage2';
import { sinceWords } from '../left/YourMove';
import { forgetRecentPages } from '../recent';
import type { JobBody, JobPagePayload, ReaderTarget } from '../types';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const payload = () => clone(longJob.payload) as unknown as JobPagePayload;
const BRIEF15 = 'brief:briefs/015-review.md';
const REPLY = 'reply:d1f85412d52c';
const CSS = readFileSync(path.join(process.cwd(), 'src/jobpage/jobpage.css'), 'utf8');
/** The declarations of the first rule whose selector is exactly `sel`. */
const rule = (sel: string) => {
  const at = CSS.indexOf(`${sel} {`);
  return at < 0 ? '' : CSS.slice(at + sel.length + 2, CSS.indexOf('}', at));
};

const TICKET_BODY: JobBody = {
  id: 'ticket', kind: 'ticket', version: 't1', meta: { key: 'ORBIT-905' }, text: '## The ticket',
  html: '<h2 id="h-the-ticket">The ticket</h2><p><strong>Crew schedule export</strong></p><p>The office wants the week as a file.</p><h2 id="h-what-were-building">What we’re building</h2><p>A CSV of the week.</p><h2 id="h-what-to-check">What to check</h2><h3 id="h-it-works-when">It works when</h3><ol><li>The file opens.</li></ol>',
};
const DECISIONS_BODY: JobBody = {
  id: 'decisions', kind: 'decisions', version: 'd1', text: '- Keep the CSV columns in screen order — the printout does',
  html: '<ul><li>Keep the CSV columns in screen order — the printout does</li></ul>',
  meta: { rows: [
    { id: 'D-001', decision: 'Keep the CSV columns in screen order', reason: 'the printout does', where: 'plan v2', confirmed: true },
    { id: 'D-002', decision: 'Round hours to a quarter', reason: 'payroll rounds that way', where: 'spec v0.4', confirmed: false },
  ] },
};
const LATE_KEY_POINTS: JobBody = {
  id: 'test-plan.md', kind: 'doc', version: 'tp', text: '# Test plan',
  meta: { name: 'Test plan', version: '2', updatedAt: '2026-11-03T16:20:00.000Z', step: 'plan' },
  html: '<h1 id="h-test-plan-v2">Test plan v2</h1><h2 id="h-scope">Scope</h2><p>What the checks cover.</p><h2 id="h-key-points">Key points</h2><ul><li>Fourteen checks.</li></ul><h2 id="h-cases">Cases</h2><h3 id="h-the-week">The week</h3><p>A week with a night shift. See <a href="acceptance.md">the acceptance list</a> or <a href="notes/elsewhere.md">a note</a>.</p>',
};

const bodyOf = (id: string): JobBody | undefined => {
  if (id === 'ticket') return TICKET_BODY;
  if (id === 'decisions') return DECISIONS_BODY;
  const b = longJob.bodies[id];
  return b ? { ...b, version: String(b.meta.hash ?? b.id) } : undefined;
};

interface Opened { store: JobStore; item: ReturnType<typeof vi.fn>; release(id: string): void; unmount(): void }

/** The page with a store already holding the payload; bodies answer at once unless held. */
function open({ patch, bodies = {}, hold = [] }: { patch?: (p: JobPagePayload) => void; bodies?: Record<string, JobBody>; hold?: string[] } = {}): Opened {
  const p = payload();
  patch?.(p);
  window.history.replaceState(null, '', `/#/job/${SLUG}`);
  const waiting = new Map<string, () => void>();
  const item = vi.fn(async (_slug: string, id: string) => {
    if (hold.includes(id)) await new Promise<void>((r) => { waiting.set(id, r); });
    const b = bodies[id] ?? bodyOf(id);
    if (!b) throw new Error('Starbase answered 404.');
    return b;
  });
  const store = createJobStore(SLUG, { api: { page: async () => ({ same: true as const, v: p.v }), item }, events: () => () => {}, viewer: () => null, initial: p });
  const api = { get: vi.fn(), post: vi.fn(), hosted: () => false } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ api, store: createStore() }}><UiProvider><JobPage2 slug={SLUG} job={null} store={store} /></UiProvider></WorkshopContext.Provider>);
  return { store, item, release: (id) => waiting.get(id)?.(), unmount: utils.unmount };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const reader = () => document.querySelector<HTMLElement>('.jp2-reader')!;
const top = () => reader().querySelector<HTMLElement>('.jp2-rv-top')!;
const title = () => top().querySelector('h2')!.textContent;
const meta = () => top().querySelector('.jp2-rv-meta')?.textContent ?? '';
const views = () => reader().querySelectorAll<HTMLElement>('[data-view]');
const view = () => { const v = views(); expect(v).toHaveLength(1); return v[0]; };
const prose = () => view().querySelector<HTMLElement>('.jp2-prose');
const show = async (o: Opened, t: ReaderTarget) => { act(() => { o.store.setReader(t); }); await settle(); };
const headings = (el: Element) => [...el.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => h.textContent);
const navButton = (name: 'Previous' | 'Next') => within(top()).getByRole('button', { name: new RegExp(`^${name}`) });

let offKeys: () => void = () => {};
beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  forgetRecentPages(); offKeys = installKeyListener(); resetChord();
});
afterEach(() => { offKeys(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

describe('one thing at a time, under the same title row', () => {
  it('shows exactly one view for each kind, and every view has the same title row: what it is, previous and next', async () => {
    const o = open();
    const cases: [ReaderTarget, string, string][] = [
      [{ kind: 'brief', id: BRIEF15 }, 'brief', 'Brief #15 · Review · waiting'],
      [{ kind: 'message', id: REPLY }, 'message', 'The download button shows quotes inside a note when the week is empty.'],
      [{ kind: 'doc', id: 'spec' }, 'doc', 'Product spec'],
      [{ kind: 'doc', id: 'review.md' }, 'doc', 'Review (combined)'],
      [{ kind: 'ticket', id: 'ticket' }, 'ticket', 'Ticket and goal'],
      [{ kind: 'decisions', id: 'decisions' }, 'decisions', 'Decisions'],
      [{ kind: 'conversation', id: 'conversation' }, 'conversation', 'Conversation'],
      [{ kind: 'not-yet', id: 'ship' }, 'not-yet', 'Ship'],
    ];
    for (const [t, kind, words] of cases) {
      await show(o, t);
      expect(view()).toHaveAttribute('data-view', kind);
      expect(reader().querySelectorAll('.jp2-rv-top')).toHaveLength(1);
      expect(top().querySelectorAll('h2')).toHaveLength(1);
      expect(title()).toBe(words);
      expect(navButton('Previous')).toBeInTheDocument();
      expect(navButton('Next')).toBeInTheDocument();
    }
  });

  it('the title row says its version, its step and when', async () => {
    const o = open();
    await show(o, { kind: 'doc', id: 'implementation-plan.md' });
    const at = longJob.bodies['implementation-plan.md'].meta.updatedAt as string;
    expect(meta()).toBe(`v2 · Plan · ${sinceWords(at)}`);
    await show(o, { kind: 'message', id: REPLY });
    const line = payload().thread.find((l) => l.id === REPLY)!;
    expect(meta()).toBe(`Foreman · Review · ${sinceWords(line.at)}`);
    const mine = payload().thread.filter((l) => l.kind === 'you').at(-1)!;
    await show(o, { kind: 'message', id: mine.id });
    expect(meta()).toBe(`You · Review · ${sinceWords(mine.at)}`);
    await show(o, { kind: 'brief', id: BRIEF15 });
    expect(meta()).toBe(sinceWords(payload().thread.find((l) => l.id === BRIEF15)!.at));
  });

  it('previous and next walk what the steps made (and the job’s rows); a message walks the conversation; the address follows', async () => {
    const o = open();
    await show(o, { kind: 'doc', id: 'implementation-plan.md' });
    fireEvent.click(navButton('Next'));
    await settle();
    expect(title()).toBe('Test plan');
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/doc/test-plan.md`);
    fireEvent.click(navButton('Previous'));
    fireEvent.click(navButton('Previous'));
    await settle();
    expect(title()).toBe('Findings');
    await show(o, { kind: 'doc', id: 'spec' });
    expect(navButton('Previous')).toBeDisabled();
    await show(o, { kind: 'details', id: 'details' });
    expect(navButton('Next')).toBeDisabled();
    await show(o, { kind: 'brief', id: BRIEF15 });
    fireEvent.click(navButton('Next'));
    await settle();
    expect(title()).toBe(payload().thread.find((l) => l.id === REPLY)!.headline);
    expect(view()).toHaveAttribute('data-view', 'message');
  });
});

describe('set for reading', () => {
  it('body text is 15 px on a 24 px line and at most 80 characters wide; headings are one step above it', async () => {
    const body = rule('.jp2-prose');
    expect(body).toMatch(/font-size: 15px/);
    expect(body).toMatch(/line-height: 24px/);
    expect(body).toMatch(/max-width: min\(80ch, 610px\)/);
    const head = rule('.jp2-prose :is(h1, h2, h3, h4, h5, h6)');
    expect(head).toMatch(/font-size: 16px/);
    expect(head).toMatch(/line-height: 24px/);
    const o = open();
    await show(o, { kind: 'message', id: REPLY });
    expect(prose()).not.toBeNull();
    expect(headings(prose()!)).toEqual(['What I checked', 'Time zones']);
  });

  it('a message’s own headline is its title, not said again; a bold line alone is a heading; the part that asks him carries the left rule', async () => {
    expect(rule('.jp2-ask')).toMatch(/border-left: 3px solid var\(--border-3\)/);
    const o = open();
    await show(o, { kind: 'message', id: REPLY });
    expect(prose()!.textContent).not.toContain('The download button shows quotes inside a note when the week is empty.');
    expect(prose()!.textContent).toMatch(/^The row limit puts first one row per shift/);
    expect(prose()!.querySelector('.jp2-ask')).toBeNull();
    await show(o, { kind: 'brief', id: BRIEF15 });
    expect(headings(prose()!)).toEqual(['Crew schedule export · review 4 is ready: the week picker now writes the', 'What happened', 'Concerns', 'Decisions for you']);
    const ask = prose()!.querySelector('.jp2-ask')!;
    expect(ask).not.toBeNull();
    expect(headings(ask)).toEqual(['Decisions for you']);
    expect(ask.querySelectorAll('li')).toHaveLength(2);
    expect(ask.textContent).not.toContain('What happened');
  });

  it('a document shows Key points first, and an outline of its headings that moves the reading place', async () => {
    const o = open({ bodies: { 'test-plan.md': LATE_KEY_POINTS } });
    await show(o, { kind: 'doc', id: 'test-plan.md' });
    expect(headings(prose()!)).toEqual(['Test plan v2', 'Key points', 'Scope', 'Cases', 'The week']);
    const outline = within(view()).getByRole('navigation', { name: 'On this page' });
    expect(within(outline).getAllByRole('button').map((b) => b.textContent)).toEqual(['Key points', 'Scope', 'Cases', 'The week']);
    const to = vi.fn();
    const cases = prose()!.querySelector<HTMLElement>('#h-cases')!;
    cases.scrollIntoView = to;
    fireEvent.click(within(outline).getByRole('button', { name: 'Cases' }));
    expect(to).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(cases);
    // At the right edge only when the reader is wide enough (a container query on the reader's body).
    expect(rule('.jp2-doc-ol')).toMatch(/display: none/);
    expect(CSS).toMatch(/@container \(min-width: 850px\) \{\s*\.jp2-doc \{[^}]*grid-template-columns: minmax\(0, 610px\) 200px;[^}]*\}\s*\.jp2-doc-ol \{[^}]*display: flex;/);
    expect(rule('.jp2-rv-body')).toMatch(/container-type: inline-size/);
  });

  it('a link to another of the job’s documents opens it in the reader; one the job does not list says so', async () => {
    const o = open({ bodies: { 'test-plan.md': LATE_KEY_POINTS } });
    await show(o, { kind: 'doc', id: 'test-plan.md' });
    fireEvent.click(within(prose()!).getByText('a note'));
    expect(within(view()).getByRole('status')).toHaveTextContent('That document isn’t listed for this job, so it doesn’t open here.');
    fireEvent.click(within(prose()!).getByText('the acceptance list'));
    await settle();
    expect(title()).toBe('Acceptance criteria');
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/doc/acceptance.md`);
  });

  it('the ticket and goal and the decisions read as plain documents', async () => {
    const o = open();
    await show(o, { kind: 'ticket', id: 'ticket' });
    expect(meta()).toBe('ORBIT-905');
    expect(headings(prose()!)).toEqual(['The ticket', 'What we’re building', 'What to check', 'It works when']);
    await show(o, { kind: 'decisions', id: 'decisions' });
    expect(meta()).toBe('13 made for you');
    const items = view().querySelectorAll('.jp2-dec');
    expect([...items].map((li) => li.textContent)).toEqual([
      'D-001 · Keep the CSV columns in screen orderthe printout doesplan v2 · confirmed',
      'D-002 · Round hours to a quarterpayroll rounds that wayspec v0.4 · not confirmed yet',
    ]);
  });

  it('nothing decided for him says so', async () => {
    const o = open({ bodies: { decisions: { ...DECISIONS_BODY, meta: { rows: [] }, text: '', html: '' } } });
    await show(o, { kind: 'decisions', id: 'decisions' });
    expect(view()).toHaveTextContent('Nothing was decided for you on this job.');
  });
});

describe('older versions and rounds, from the title row', () => {
  it('the combined review’s Older lists its rounds and lenses; a pick opens it with its step', async () => {
    const o = open();
    await show(o, { kind: 'doc', id: 'review.md' });
    fireEvent.click(within(top()).getByRole('button', { name: 'Older' }));
    const menu = within(within(top()).getByRole('menu', { name: 'Older' })).getByRole('group', { name: 'Rounds and lenses' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.querySelector('.menu-label')!.textContent)).toContain('Review: db r2');
    expect(items.map((i) => i.querySelector('.menu-label')!.textContent)).toContain('Fable second look #2 · review');
    expect(items.map((i) => i.querySelector('.menu-label')!.textContent)).toContain('Review facts (round 1)');
    expect(within(menu).getByRole('menuitemradio', { name: /^Review \(combined\)/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /^Review: db r2/ }));
    await settle();
    expect(within(top()).queryByRole('menu')).toBeNull();
    expect(title()).toBe('Review: db r2');
    expect(meta()).toMatch(/^Review/);
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/doc/${encodeURIComponent('review/db-r2.md')}`);
    // Inside a round, previous and next walk the rounds.
    fireEvent.click(navButton('Previous'));
    await settle();
    expect(title()).toBe('Review: db');
  });

  it('a brief’s Older lists the earlier briefs of its step, newest first; Escape closes it; the first brief and a reply have none', async () => {
    const o = open();
    await show(o, { kind: 'brief', id: BRIEF15 });
    const older = within(top()).getByRole('button', { name: 'Older' });
    fireEvent.click(older);
    const menu = within(top()).getByRole('menu', { name: 'Older' });
    const briefs = payload().thread.filter((l) => l.kind === 'brief' && l.step === 'review');
    const group = within(menu).getByRole('group', { name: 'Earlier briefs of this step' });
    expect(within(group).getAllByRole('menuitemradio').map((i) => i.querySelector('.menu-label')!.textContent)).toEqual(briefs.slice(0, -1).reverse().map((l) => l.headline));
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(within(top()).queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(older);
    fireEvent.click(older);
    fireEvent.click(within(top()).getByRole('menuitemradio', { name: new RegExp(`^${briefs[0].headline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }));
    await settle();
    expect(title()).toBe(briefs[0].headline);
    expect(within(top()).queryByRole('button', { name: 'Older' })).toBeNull();
    await show(o, { kind: 'message', id: REPLY });
    expect(within(top()).queryByRole('button', { name: 'Older' })).toBeNull();
  });
});

describe('speed and calm', () => {
  it('each view keeps its own scroll place', async () => {
    const o = open();
    await show(o, { kind: 'doc', id: 'spec' });
    let body = view();
    body.scrollTop = 300;
    fireEvent.scroll(body);
    await show(o, { kind: 'doc', id: 'review.md' });
    body = view();
    expect(body.scrollTop).toBe(0);
    body.scrollTop = 120;
    fireEvent.scroll(body);
    await show(o, { kind: 'doc', id: 'spec' });
    expect(view().scrollTop).toBe(300);
    await show(o, { kind: 'doc', id: 'review.md' });
    expect(view().scrollTop).toBe(120);
  });

  it('a body not loaded yet shows the title row at once and an empty body; it lands in place', async () => {
    const o = open({ hold: ['test-plan.md'] });
    act(() => { o.store.setReader({ kind: 'doc', id: 'test-plan.md' }); });
    expect(title()).toBe('Test plan');
    expect(meta()).toBe('v2 · Plan');
    expect(view()).toHaveAttribute('data-view', 'doc');
    expect(view().childElementCount).toBe(0);
    expect(view().className).toBe('jp2-rv-body');
    o.release('test-plan.md');
    await settle();
    expect(prose()).not.toBeNull();
    expect(meta()).toMatch(/^v2 · Plan · /);
  });

  it('a pick whose body is held paints it in the same frame, with no second fetch', async () => {
    const o = open();
    await act(async () => { await o.store.loadBody('acceptance.md'); });
    o.item.mockClear();
    act(() => { o.store.setReader({ kind: 'doc', id: 'acceptance.md' }); });
    expect(prose()).not.toBeNull();
    expect(prose()!.textContent!.length).toBeGreaterThan(20);
    expect(o.item).not.toHaveBeenCalled();
  });
});

describe('Task 10 carry-forwards', () => {
  it('a step with nothing written says what it is doing: under way, done, not started, skipped', async () => {
    const o = open({ patch: (p) => {
      const review = p.steps.find((s) => s.id === 'review')!;
      review.main = { kind: 'not-yet', id: 'review' };
      p.steps.find((s) => s.id === 'investigate')!.state = 'skipped';
    } });
    await show(o, { kind: 'not-yet', id: 'review' });
    expect(meta()).toBe('under way');
    expect(view()).toHaveTextContent('Nothing written yet. The Foreman is on this step.');
    await show(o, { kind: 'not-yet', id: 'build' });
    expect(meta()).toBe('done');
    expect(view()).toHaveTextContent('This step wrote no document.');
    await show(o, { kind: 'not-yet', id: 'ship' });
    expect(meta()).toBe('not started');
    expect(view()).toHaveTextContent('Nothing yet. This step has not started.');
    await show(o, { kind: 'not-yet', id: 'investigate' });
    expect(meta()).toBe('skipped for this job');
    expect(view()).toHaveTextContent('This job skips this step.');
  });

  it('a payload whose steps carry no `more` still reads (an older Starbase)', async () => {
    const o = open({ patch: (p) => { for (const s of p.steps) delete (s as Partial<typeof s>).more; } });
    await show(o, { kind: 'doc', id: 'review.md' });
    expect(title()).toBe('Review (combined)');
    expect(within(top()).queryByRole('button', { name: 'Older' })).toBeNull();
    expect(prose()).not.toBeNull();
  });
});

describe('Task 12 fix round 1', () => {
  const V1 = 'versions/implementation-plan.v1.md';
  const V1_BODY: JobBody = { id: V1, kind: 'doc', version: 'v1', text: '# Implementation plan v1', html: '<h1 id="h-implementation-plan-v1">Implementation plan v1</h1><p>The first plan.</p>', meta: { name: 'Implementation plan v1', version: '1', of: 'implementation-plan.md', updatedAt: '2026-11-02T10:00:00.000Z' } };
  const withVersions = (p: JobPagePayload) => {
    const plan = p.steps.find((s) => s.id === 'plan')!;
    plan.outputs.find((o) => o.id === 'implementation-plan.md')!.versions = [{ n: '1', id: V1 }];
    plan.outputs.find((o) => o.id === 'acceptance.md')!.versions = [{ n: '2', id: 'versions/acceptance.v2.md' }, { n: '1', id: 'versions/acceptance.v1.md' }];
    p.steps.find((s) => s.id === 'review')!.outputs.find((o) => o.id === 'review.md')!.versions = [{ n: '1', id: 'versions/review.v1.md' }];
  };

  it('Older lists a document’s older versions, newest first, with the one now ticked; an older version opens in place and its previous goes back', async () => {
    const o = open({ patch: withVersions, bodies: { [V1]: V1_BODY } });
    await show(o, { kind: 'doc', id: 'acceptance.md' });
    fireEvent.click(within(top()).getByRole('button', { name: 'Older' }));
    const accept = within(top()).getByRole('group', { name: 'Older versions' });
    expect(within(accept).getAllByRole('menuitemradio').map((i) => i.querySelector('.menu-label')!.textContent)).toEqual(['v3', 'v2', 'v1']);
    expect(within(accept).getByRole('menuitemradio', { name: /^v3/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(accept, { key: 'Escape' });
    await show(o, { kind: 'doc', id: 'implementation-plan.md' });
    fireEvent.click(within(top()).getByRole('button', { name: 'Older' }));
    fireEvent.click(within(top()).getByRole('menuitemradio', { name: /^v1/ }));
    await settle();
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/doc/${encodeURIComponent(V1)}`);
    expect(title()).toBe('Implementation plan');
    expect(meta()).toBe(`v1 · an older version · Plan · ${sinceWords(V1_BODY.meta.updatedAt as string)}`);
    expect(prose()).toHaveTextContent('The first plan.');
    // The Plan step stays marked on the left while one of its older versions is read.
    expect(document.querySelector('.jp2-st-row.is-sel .jp2-st-name')?.textContent).toBe('Plan');
    expect(navButton('Next')).toBeDisabled();
    fireEvent.click(navButton('Previous'));
    await settle();
    expect(meta()).toMatch(/^v2 · Plan/);
  });

  it('the combined review keeps Rounds and lenses as its own list beside its older versions', async () => {
    const o = open({ patch: withVersions });
    await show(o, { kind: 'doc', id: 'review.md' });
    fireEvent.click(within(top()).getByRole('button', { name: 'Older' }));
    const menu = within(top()).getByRole('menu', { name: 'Older' });
    expect(within(menu).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Older versions', 'Rounds and lenses']);
  });

  it('a website decision (question, choice, why) reads as its question and its choice', async () => {
    const site: JobBody = { ...DECISIONS_BODY, meta: { rows: [{ id: 'q-1', question: 'Which week does the export start on?', options: ['Monday', 'Sunday'], choice: 'Monday', who: 'you', why: 'payroll weeks start on Monday' }] } };
    const o = open({ bodies: { decisions: site } });
    await show(o, { kind: 'decisions', id: 'decisions' });
    const row = view().querySelector('.jp2-dec')!;
    expect(row.querySelector('.jp2-dec-q')).toHaveTextContent('Which week does the export start on?');
    expect(row.querySelector('.jp2-dec-what')).toHaveTextContent('q-1 · Monday');
    expect(row).toHaveTextContent('payroll weeks start on Monday');
    expect(row).not.toHaveTextContent('A decision');
  });

  it('only the part that asks him is ruled: not a heading that merely starts with Decisions, and not past a labelled line', async () => {
    const doc: JobBody = { ...LATE_KEY_POINTS, html: '<h2 id="h-decisions-already-made">Decisions already made</h2><p>The week starts on Monday.</p><h2 id="h-decision-for-you">Decision for you</h2><p>Monday or Sunday?</p><p><strong>Next:</strong> the export.</p><hr><p>After the rule.</p>' };
    const o = open({ bodies: { 'test-plan.md': doc } });
    await show(o, { kind: 'doc', id: 'test-plan.md' });
    const asks = prose()!.querySelectorAll('.jp2-ask');
    expect(asks).toHaveLength(1);
    expect(headings(asks[0])).toEqual(['Decision for you']);
    expect(asks[0]).not.toHaveTextContent('Next:');
    await show(o, { kind: 'brief', id: BRIEF15 });
    expect(prose()!.querySelector('.jp2-ask')).not.toHaveTextContent('Next:');
  });

  it('a table’s first column keeps to one line only when it holds short ids', async () => {
    const doc: JobBody = { ...LATE_KEY_POINTS, html: '<table><thead><tr><th>Question</th><th>Answer</th></tr></thead><tbody><tr><td>Which week does it start on?</td><td>Monday</td></tr></tbody></table>' };
    const o = open({ bodies: { 'test-plan.md': doc } });
    await show(o, { kind: 'doc', id: 'review.md' });
    expect(prose()!.querySelector('table')).toHaveClass('jp2-idcol');
    await show(o, { kind: 'doc', id: 'test-plan.md' });
    expect(prose()!.querySelector('table')).not.toHaveClass('jp2-idcol');
    expect(CSS).toMatch(/\.jp2-prose \.jp2-idcol td:first-child \{ white-space: nowrap; \}/);
    expect(CSS).not.toMatch(/\.jp2-prose td:first-child/);
  });
});

describe('final fix W2: every target the page offers has a view', () => {
  const PLACEHOLDER = /later build/i;
  it('every output kind the payload can carry, and an old permission address, opens a view that is neither a placeholder nor an error', async () => {
    const kinds: ReaderTarget[] = [
      { kind: 'doc', id: 'test-plan.md' }, { kind: 'screens', id: 'screens' }, { kind: 'changes', id: 'changes' },
      // Checks, Recording and Your hand test (ChecksView) have their own tests (ChecksView.test.tsx).
      { kind: 'findings', id: 'findings' }, { kind: 'walkthrough', id: 'walkthrough' }, { kind: 'pr', id: '1' },
      { kind: 'ship', id: 'ship' }, { kind: 'permission', id: 'p1' },
    ];
    const o = open({ bodies: { 'test-plan.md': LATE_KEY_POINTS } });
    await settle();
    for (const t of kinds) {
      act(() => { o.store.setReader(t); });
      await settle();
      const text = reader().textContent ?? '';
      expect(text, t.kind).not.toMatch(PLACEHOLDER);
      expect(text, t.kind).not.toMatch(/Couldn’t load that part of the job/);
      expect(views().length, t.kind).toBeGreaterThan(0);
      if (t.kind === 'screens' || t.kind === 'walkthrough') expect(views()[0].dataset.view).toBe(t.kind);
      if (t.kind === 'permission') expect(title()).not.toBe('Permission');
    }
    expect(o.item.mock.calls.map((c) => c[1])).not.toContain('screens');
    o.unmount();
  });

  it('a job waiting on a permission opens on the current step’s main output, not a permission view', async () => {
    const o = open({ patch: (p) => { p.open = { kind: 'permission', id: 'p1' }; } });
    await settle();
    expect(title()).not.toBe('Permission');
    expect(reader().textContent ?? '').not.toMatch(PLACEHOLDER);
    o.unmount();
  });

  it('no “later build” words are left anywhere in the page’s code', () => {
    const root = path.join(process.cwd(), 'src/jobpage');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/later build/i);
  });
});
