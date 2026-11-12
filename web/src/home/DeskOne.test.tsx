// The Desk's One at a time layout (packet M, the default): the dots and "1 of N", the queue in a
// drawer, the seven stops, the brief behind Details (b), and the three calls Reply (c), No go: send
// back (r) and Go (a), which press the gate card's own buttons. Play changes the words, never the keys.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Gate, Job, JobDetail, Permission } from '../api/types';
import { installKeyListener } from '../app/keyRegistry';
import { createStore, useWorkshopState, WorkshopContext, type Store } from '../state/store';
import { ev, job, permission, snapshot } from '../state/test-fixtures';
import { DeskView } from './DeskView';
import { UiProvider } from '../app/ui';
import { NextStep } from '../job/NextStep';
import { useJobConversation } from '../panes/Foreman/ForemanPane';
import { jobBySlug } from '../state/reducer';
import { deskQueue } from './homeModel';
import { clearDecisions } from './nudges';

const NOW = new Date('2026-10-21T12:00:00Z');
const GATE: Gate = {
  briefNumber: 2, briefFile: 'briefs/002-plan.md', headline: 'Plan v2 ready', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
  questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: '2026-10-21T09:00:00Z', runActive: false, parked: false,
  level: 1, suggestedLevel: null, levelReason: null, usage: null,
};
/** The briefs a deciding answer has answered, as the next GET of the job returns them. */
const answered: number[] = [];
const detail = (slug: string): JobDetail => ({
  slug, thread: [], threadMore: false, gate: GATE, answeredBriefs: [...answered], heldReply: null, options: { level: 1 },
  latestBrief: { html: '<p>The plan in full: two steps, one test.</p>', number: 2 },
});
const ALPHA = job('alpha', 'needs-you', { waitingFor: 'approval', stage: 'plan', lane: 'needs-you', laneReason: 'Waiting for your go-ahead on the plan', headline: 'The plan is ready. Start building?', waitingSince: '2026-10-21T09:00:00Z', level: 1 });

function setup({ jobs = [ALPHA], permissions = [] as Permission[], play = 'subtle', server = false }: { jobs?: Job[]; permissions?: Permission[]; play?: 'full' | 'subtle' | 'off'; /** Answer the gate as the server does: a started run, its event, the brief answered. */ server?: boolean } = {}) {
  answered.length = 0;
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, permissions, meta: { token: 't', settings: { play: { mode: play } } } as never }) });
  const get = vi.fn(async (path: string) => detail(path.split('/')[3]));
  const post = vi.fn(async (_path?: string, body?: unknown): Promise<unknown> => {
    if (!server) return { ok: true, sent: true, text: 'x' };
    const b = (body ?? {}) as { kind?: string; briefNumber?: number };
    if ((b.kind === 'approve' || b.kind === 'changes') && typeof b.briefNumber === 'number') answered.push(b.briefNumber);
    const run = { id: 'r_desk', slug: 'alpha', status: 'running' };
    store.dispatch({ type: 'event', event: ev(100, 'run', 'alpha', run) });
    return { ok: true, sent: true, text: 'x', run };
  });
  const api = { get, post } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}><DeskView items={deskQueue(jobs, permissions)} now={NOW} layout="one" /></WorkshopContext.Provider>);
  return { get, post, store, api };
}

const kbd = (el: HTMLElement) => el.querySelector('kbd')?.textContent ?? null;
let off = () => {};
beforeEach(() => { off = installKeyListener(); });
afterEach(() => { off(); cleanup(); clearDecisions(); localStorage.clear(); window.location.hash = ''; });

// Deep review D, C1: the Desk card for a stopped Auto job shows the same Auto line the Jobs card shows.
describe('the Desk card of an Auto job', () => {
  const reason = 'Auto stopped: a database change needs you.';
  const STOPPED = job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', laneReason: reason, level: 1, permissions: 1, auto: { on: true, by: 'you', ran: true, stopped: { reason: 'a database change needs you.', rule: 'database', at: '2026-10-21T10:00:00Z' } } });

  it('a permission on a stopped Auto job: the card says why Auto stopped, with What Auto decided', () => {
    setup({ jobs: [STOPPED], permissions: [{ ...permission('p1', 'alpha'), createdAt: '2026-10-21T10:00:00Z' }] });
    const card = screen.getByRole('region', { name: /^Job alpha:/ });
    expect(within(card).getByText(reason)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'What Auto decided' })).toBeInTheDocument();
  });

  it('a go-ahead on a stopped Auto job says it once', async () => {
    setup({ jobs: [{ ...STOPPED, permissions: 0, waitingFor: 'approval' }] });
    const card = screen.getByRole('region', { name: /^Job alpha:/ });
    await within(card).findByRole('button', { name: /^Go: approve/ });
    expect(within(card).getAllByText(reason)).toHaveLength(1);
  });

  it('an ordinary job has no Auto line', () => {
    setup({ permissions: [{ ...permission('p1', 'alpha'), createdAt: '2026-10-21T10:00:00Z' }] });
    expect(document.querySelector('.desk-auto')).toBeNull();
  });
});

// Part 2: the Desk's card says what was sent with the bar's own lines, and shows no greyed calls.
describe('the Desk card after a send', () => {
  it('Go: the card says it was sent, and the calls go, also once the run started', async () => {
    const { post, store } = setup({ server: true });
    const card = screen.getByRole('region', { name: /^Job alpha:/ });
    fireEvent.click(await within(card).findByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve' })));
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ status: 'running' }));
    expect(await within(card).findByText('Sent. Waiting for the Foreman to start.')).toBeInTheDocument();
    for (const name of [/^Go: /, /^No go/, /^Reply/]) expect(within(card).queryByRole('button', { name })).toBeNull();
    // M1: the card no longer asks for the go-ahead that was given.
    expect(card).not.toHaveTextContent('Go / no go');
    expect(card).not.toHaveTextContent('The plan is ready. Start building?');
    expect(card).not.toHaveTextContent('Waiting for your go-ahead on the plan');
  });

  // Round 2, M1: on the Desk there is no message box; the stalled line says to open the job.
  it('a stalled answered brief: "Open the job and write to the Foreman to move it on.", with the link', async () => {
    const { store } = setup({ server: true });
    answered.push(2);
    act(() => { store.dispatch({ type: 'event', event: ev(20, 'run', 'alpha', { id: 'r_old', slug: 'alpha', status: 'done', endedAt: new Date(Date.now() - 31_000).toISOString() }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(21, 'thread', 'alpha', {}) }); });
    const card = screen.getByRole('region', { name: /^Job alpha:/ });
    await waitFor(() => expect(card).toHaveTextContent('Nothing has moved yet.'));
    expect(card).toHaveTextContent('Open the job and write to the Foreman to move it on.');
    expect(card).not.toHaveTextContent('below');
    const links = within(card).getAllByRole('link', { name: 'Open the job' });
    expect(links.some((l) => l.closest('.desk-say'))).toBe(true);
    expect(links.every((l) => l.getAttribute('href') === '#/job/alpha')).toBe(true);
    expect(card).not.toHaveTextContent('Go / no go');
  });

  it('Send back: the card says the Foreman stays at the step', async () => {
    setup({ server: true });
    const card = screen.getByRole('region', { name: /^Job alpha:/ });
    fireEvent.click(await within(card).findByRole('button', { name: /^No go/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: /What should change\?/ }), { target: { value: 'Smaller.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    expect(await within(card).findByText('Sent. Waiting for the Foreman to start.')).toBeInTheDocument();
    expect(card).toHaveTextContent('Sent back: the Foreman stays at Plan and revises. Nothing is approved.');
  });
});

describe('the Desk, one at a time', () => {
  it('shows one decision: where it is in the queue, the seven stops in words, the headline, and the brief behind Details (b)', async () => {
    setup({ permissions: [{ ...permission('p1', 'alpha'), createdAt: '2026-10-21T10:00:00Z' }] });
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Waiting for your decision' })).toBeNull();
    const card = screen.getByRole('region', { name: 'Job alpha: Go-ahead on Plan' });
    const stops = within(card).getByRole('list', { name: 'Where the job is' });
    expect(within(stops).getAllByRole('listitem').map((li) => li.getAttribute('title'))).toEqual([
      'Spec: Done', 'Investigate: Done', 'Plan: Waiting for you', 'Build: Not yet', 'Test: Not yet', 'Review: Not yet', 'Ship: Not yet',
    ]);
    expect(await within(card).findByRole('heading', { name: 'The plan is ready. Start building?' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Waiting for your go-ahead on the plan');
    expect(card).toHaveTextContent('Go / no go');
    const details = within(card).getByRole('button', { name: /The Foreman’s brief/ });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(card).not.toHaveTextContent('The plan in full');
    fireEvent.keyDown(document.body, { key: 'b' });
    expect(card).toHaveTextContent('The plan in full');
  });

  it('Go (a) approves through the gate card; r opens send back, c opens a reply; the keys are printed on the calls', async () => {
    const { post } = setup();
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    expect(kbd(go)).toBe('a');
    expect(kbd(screen.getByRole('button', { name: /^No go: send back/ }))).toBe('r');
    expect(kbd(screen.getByRole('button', { name: /^Reply/ }))).toBe('c');
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(await screen.findByText(/What should change\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(await screen.findByText('Your answers or a note for the Foreman. Nothing is approved.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(go);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve' })));
  });

  it('the Desk has the same three calls, and Reply sends a message that approves nothing', async () => {
    const { post } = setup();
    await screen.findByRole('button', { name: /^Go: approve/ });
    expect(screen.getByRole('button', { name: /^No go: send back/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Reply/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A question.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'message', note: 'A question.' })));
  });

  it('with Play off the calls are ordinary buttons with the gate’s own words, and "Waiting for you"', async () => {
    setup({ play: 'off' });
    expect(await screen.findByRole('button', { name: /^Approve/ })).toHaveClass('btn-primary');
    expect(screen.getByRole('button', { name: /^Send back/ })).not.toHaveClass('btn-lg');
    expect(screen.getByText('Waiting for you')).toBeInTheDocument();
    expect(screen.queryByText('Go / no go')).toBeNull();
  });

  it('Queue opens the whole list in a drawer; picking one shows it; Escape closes it', async () => {
    setup({ permissions: [{ ...permission('p1', 'alpha'), createdAt: '2026-10-21T10:00:00Z' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    const drawer = screen.getByRole('dialog', { name: 'The queue' });
    const items = within(drawer).getAllByRole('button').filter((b) => b.classList.contains('desk-item'));
    expect(items.map((b) => b.querySelector('.desk-item-what')?.textContent)).toEqual(['Go-ahead on Plan', 'Run a command']);
    fireEvent.click(items[1]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('when nothing waits: Desk clear, See all jobs, and Decided today folded', () => {
    setup({ jobs: [job('beta', 'running')] });
    expect(screen.getByRole('heading', { name: 'Desk clear' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /See all jobs/ })).toHaveAttribute('href', '#/');
    const fold = screen.getByText('Decided today').closest('details')!;
    expect(fold.open).toBe(false);
    act(() => { fold.open = true; });
  });
});

// Task 7: the Desk's card and the job page's bar read one rule (job/sentView.ts), so they say the same lines.
describe('the Desk and the bar', () => {
  /** The job page's bar for the same job, drawn beside the Desk on the same store. */
  function Bar({ slug }: { slug: string }) {
    const j = jobBySlug(useWorkshopState(), slug)!;
    const conversation = useJobConversation(j);
    return <NextStep job={j} conversation={conversation} now={NOW} />;
  }

  it('the Desk’s card says the same sent lines as the bar', async () => {
    const { post, store, api } = setup({ server: true });
    render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><Bar slug="alpha" /></UiProvider></WorkshopContext.Provider>);
    const card = screen.getByRole('region', { name: /^Job alpha:/ });
    fireEvent.click(await within(card).findByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve' })));
    const bar = screen.getByRole('region', { name: 'Next step' });
    await within(card).findByText('Sent. Waiting for the Foreman to start.');
    await within(bar).findByText('Sent. Waiting for the Foreman to start.');
    const line = 'Your go reached the Foreman. Build starts next.';
    await waitFor(() => expect(card.querySelector('.desk-sub')).toHaveTextContent(new RegExp(`^${line}$`)));
    expect(bar.querySelector('.next-sub')).toHaveTextContent(new RegExp(`^${line}$`));
  });
});

// Task 7 fix round 1: Auto's own Go on a brief is never said to be his.
describe('the Desk card after Auto’s go', () => {
  it('a brief Auto approved: the card says it was sent, never “Your go reached the Foreman.”', async () => {
    const autoGo = { id: 'you-auto', kind: 'you', at: '2026-10-21T11:59:00Z', text: 'Approved.', sendKind: 'approve', gateBrief: 2, by: 'auto' };
    const { get, store } = setup({ jobs: [{ ...ALPHA, auto: { on: true, by: 'you', ran: true } }] });
    const card = screen.getByRole('region', { name: /^Job alpha:/ });
    await within(card).findByRole('button', { name: /^Go: approve/ });
    // Auto approved brief 2; the Foreman's run is at work.
    get.mockImplementation(async (path: string) => ({ ...detail(path.split('/')[3]), answeredBriefs: [2], thread: [autoGo] }) as JobDetail);
    act(() => { store.dispatch({ type: 'event', event: ev(20, 'run', 'alpha', { id: 'r_auto', slug: 'alpha', status: 'running' }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(21, 'thread', 'alpha', {}) }); });
    await within(card).findByText('Sent. Waiting for the Foreman to start.');
    expect(card).not.toHaveTextContent('Your go');
  });
});
