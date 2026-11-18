// The go / no go bar (NextStep) with the job's message box under it, as the quick look and a stack
// part's page use them: the three calls, what a click does (spinning, no double send, the sent line,
// 30 s with nothing, Try again, where the focus goes), Auto's words on the bar and the permission
// alert in the bar's place. Moved from the old job page's tests when that page went (plan Task 26);
// the page around the bar is gone, the bar and its card are the same. Invented jobs only; no model
// calls, no browser, no network.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import type { Gate, Job, JobDetail, Permission, ThreadItem } from '../api/types';
import { BRAND } from '../app/brand';
import { installKeyListener } from '../app/keyRegistry';
import { UiProvider } from '../app/ui';
import { clearAllSent } from '../lib/sentState';
import { writeStored } from '../lib/stored';
import { Composer, focusMessageBox } from '../panes/Foreman/Composer';
import { useJobConversation } from '../panes/Foreman/ForemanPane';
import { useKeptBoxWords } from '../panes/Foreman/GateCard';
import { clearGateSent } from '../panes/Foreman/gateSent';
import { jobBySlug } from '../state/reducer';
import { createStore, useWorkshopState, WorkshopContext, type Store } from '../state/store';
import { ev, job, permission, snapshot } from '../state/test-fixtures';
import { NextStep } from './NextStep';

const NOW = new Date().toISOString();

const GATE: Gate = {
  briefNumber: 2, briefFile: 'briefs/002-plan.md', headline: 'Plan v2 ready', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
  questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: '2026-10-21T09:00:00Z', runActive: false, parked: false,
  level: 1, suggestedLevel: null, levelReason: null, usage: null,
};

/** What the test's server knows (as GET /api/job/:slug returns it). */
const server = {
  store: null as Store | null, answered: [] as number[], gate: undefined as Gate | null | undefined, held: null as JobDetail['heldReply'], drive: undefined as JobDetail['drive'] | undefined,
  thread: [] as ThreadItem[],
};

/**
 * The bar and the job's message box under it, as a page with a message box draws them (onWrite: the
 * bar's Reply and its moved-words line), with the page's one call that moves a gone brief's words
 * into the message box (useKeptBoxWords; the old job page made it).
 */
function Bar({ job: j }: { job: Job }) {
  const conversation = useJobConversation(j);
  useKeptBoxWords(j, conversation.thread.detail ?? null);
  return (
    <main aria-label="Job">
      <NextStep job={j} conversation={conversation} now={new Date()} onWrite={() => focusMessageBox()} />
      <Composer key={j.slug} slug={j.slug} detail={conversation.thread.detail} run={conversation.run} />
    </main>
  );
}
function Host({ slug }: { slug: string }) {
  const j = jobBySlug(useWorkshopState(), slug);
  return j ? <Bar job={j} /> : null;
}

function setup({
  jobs = [job('alpha', 'idle', { stage: 'plan' })], permissions = [] as Permission[], auto = null as JobDetail['auto'] | null, gate = null as Gate | null, slug = 'alpha',
  play = 'subtle', drive = null as JobDetail['drive'], hosted = false, thread = [] as ThreadItem[], more = {} as Partial<JobDetail>,
  post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true })),
} = {}) {
  const store: Store = createStore();
  server.store = store;
  server.answered = [];
  server.gate = undefined;
  server.held = null;
  server.drive = undefined;
  server.thread = thread;
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, permissions, meta: { token: 't', settings: { play: { mode: play } }, models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }] } as never }) });
  const detail = (s: string): JobDetail => ({
    slug: s, thread: server.thread, threadMore: false, gate: server.gate === undefined ? gate : server.gate, answeredBriefs: [...server.answered], heldReply: server.held, options: { level: 1 }, auto,
    drive: server.drive === undefined ? drive : server.drive, ...more,
  } as JobDetail);
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path.endsWith('/evidence')) return { evidence: null, commit: null, wanted: false, why: '', recording: false, problem: null, folder: '', folderUrl: '' };
    if (path.endsWith('/docs')) return { docs: [] };
    if (path.endsWith('/decisions')) return { decisions: [] };
    if (path.startsWith('/api/review/')) return null;
    return detail(path.split('/')[3]);
  });
  const api = { get, post, ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><Host slug={slug} /></UiProvider></WorkshopContext.Provider>);
  return { ...utils, get, post, store };
}

let off = () => {};
beforeEach(() => { off = installKeyListener(); });
afterEach(() => { off(); cleanup(); clearAllSent(); clearGateSent(); localStorage.clear(); window.location.hash = ''; vi.useRealTimers(); });

/** A job that waits for his go-ahead on the plan. */
const waiting = (extra: Partial<Job> = {}) => [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', waitingFor: 'approval', headline: 'The plan is ready. Start building?', ...extra })];
/** The job's message box, under the bar. */
const messageBox = () => screen.getByRole('textbox', { name: /Your message to the Foreman/, hidden: true });

describe('the go / no go bar', () => {
  const waiting = () => [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', waitingFor: 'approval', headline: 'The plan is ready. Start building?' })];

  it('Go presses the gate card’s approve, and send back opens its box; the card’s own row is hidden', async () => {
    const { post } = setup({ jobs: waiting(), gate: GATE });
    await waitFor(() => expect(document.querySelector('[data-gate="approve"]')).not.toBeNull());
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    expect(go.querySelector('kbd')).toHaveTextContent('a');
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('Plan v2 ready');
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('Build step 1');
    expect(document.querySelector('.job-gate-body .gate-actions')).toHaveAttribute('hidden');
    fireEvent.click(screen.getByRole('button', { name: /^No go: send back/ }));
    expect(await screen.findByText(/What should change\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(go);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve' })));
  });

  const ASKING: Gate = { ...GATE, questions: [{ id: '1', text: 'Keep the old column?', recommendation: null, options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] }] } as Gate;

  it('the bar has Send back, Reply and Go', async () => {
    setup({ jobs: waiting(), gate: GATE });
    await screen.findByRole('button', { name: /^Go: approve/ });
    const calls = within(screen.getByRole('region', { name: 'Next step' })).getAllByRole('button').map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
    expect(calls).toEqual([expect.stringMatching(/^No go: send back/), 'Reply', expect.stringMatching(/^Go: approve/)]);
    // One way to do it: the card's own Other guidance is not shown under the bar.
    expect(document.querySelector('.job-gate-body .gate-actions')).toHaveAttribute('hidden');
  });

  it('the card’s help names the bar’s buttons, not the hidden ones', async () => {
    setup({ jobs: waiting(), gate: GATE });
    await screen.findByRole('button', { name: /^Go: approve/ });
    const help = document.querySelector('.job-gate-body .how-body')!;
    expect(help).toHaveTextContent('Reply');
    expect(help).toHaveTextContent('No go: send back');
    expect(help).not.toHaveTextContent('Other guidance');
    expect(help).not.toHaveTextContent('Revise with feedback');
  });

  it('Reply works with a question unanswered', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true, sent: true, text: 'sent' }));
    setup({ jobs: waiting(), gate: ASKING, post });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    expect(go).toBeDisabled();
    const reply = screen.getByRole('button', { name: 'Reply' });
    expect(reply).toBeEnabled();
    fireEvent.click(reply);
    const box = await screen.findByRole('textbox', { name: 'Your answers or a note for the Foreman. Nothing is approved.' });
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: 'What does the old column feed?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'message', note: 'What does the old column feed?' })));
    // Nothing was approved: the card stays open, and the bar says it was sent.
    await within(screen.getByRole('region', { name: 'Next step' })).findByText('Sent. Waiting for the Foreman to start.');
    expect(screen.getByRole('group', { name: /Keep the old column\?/ })).toBeInTheDocument();
    // m3: the reply was taken, so its box is cleared and closed: no second press sends it again.
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /Your answers or a note/ })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Send the reply' })).toBeNull();
    expect(post.mock.calls.filter(([, b]) => (b as { kind?: string })?.kind === 'approve')).toHaveLength(0);
  });

  it('Reply sends the answers typed so far', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true, sent: true, text: 'sent' }));
    setup({ jobs: waiting(), gate: ASKING, post });
    fireEvent.click(await screen.findByRole('radio', { name: /No/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'Not sure about the rest.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'message', answers: { 1: { choice: 'b' } } })));
  });

  it('Reply while its box is open keeps the box and puts the cursor in it', async () => {
    setup({ jobs: waiting(), gate: GATE });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const box = await screen.findByRole('textbox', { name: /Your answers or a note/ });
    screen.getByRole('button', { name: /^Go: approve/ }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(screen.getByRole('textbox', { name: /Your answers or a note/ })).toBe(box);
    expect(box).toHaveFocus();
  });

  // Deep review D, I2: a typed note is never thrown away.
  it('Go with the Reply box open and words in it sends the words with the approval', async () => {
    const { post } = setup({ jobs: waiting(), gate: GATE });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'Approved, but keep the icon small.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve', note: 'Approved, but keep the icon small.' })));
  });

  it('Go with the Send back box open and words in it is off, and says why', async () => {
    const { post } = setup({ jobs: waiting(), gate: GATE });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /^No go: send back/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: /What should change\?/ }), { target: { value: 'Use the small table.' } });
    await waitFor(() => expect(go).toBeDisabled());
    expect(go).toHaveAttribute('title', 'You wrote what should change. Send it back or cancel it first.');
    fireEvent.click(go);
    fireEvent.keyDown(document.body, { key: 'a' });
    await act(async () => {});
    expect(post.mock.calls.filter(([, b]) => (b as { kind?: string })?.kind === 'approve')).toHaveLength(0);
    // Cancel keeps nothing in the way: Go is on again.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(go).toBeEnabled());
  });

  // Final review A3: Send back never closes its own box, and change words never go with an approval.
  it('Send back pressed twice keeps the box open and its words', async () => {
    const { post } = setup({ jobs: waiting(), gate: GATE });
    const back = await screen.findByRole('button', { name: /^No go: send back/ });
    await waitFor(() => expect(back).toBeEnabled());
    fireEvent.click(back);
    const box = await screen.findByRole('textbox', { name: /What should change\?/ });
    fireEvent.change(box, { target: { value: 'Use the small table.' } });
    back.focus();
    fireEvent.click(back);
    await act(async () => {});
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toBe(box);
    expect(box).toHaveValue('Use the small table.');
    expect(box).toHaveFocus();
    expect(screen.getByRole('button', { name: /^Go: approve/ })).toBeDisabled();
    expect(post.mock.calls.filter(([p]) => p === '/api/job/alpha/gate')).toHaveLength(0);
  });

  it('the r key on an open box keeps it', async () => {
    setup({ jobs: waiting(), gate: GATE });
    await waitFor(() => expect(screen.getByRole('button', { name: /^No go: send back/ })).toBeEnabled());
    fireEvent.keyDown(document.body, { key: 'r' });
    const box = await screen.findByRole('textbox', { name: /What should change\?/ });
    fireEvent.change(box, { target: { value: 'Use the small table.' } });
    box.blur();
    fireEvent.keyDown(document.body, { key: 'r' });
    await act(async () => {});
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toBe(box);
    expect(box).toHaveValue('Use the small table.');
    expect(box).toHaveFocus();
    // The o key on an open Reply box keeps it too.
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const reply = await screen.findByRole('textbox', { name: /Your answers or a note/ });
    reply.blur();
    fireEvent.keyDown(document.body, { key: 'o' });
    await act(async () => {});
    expect(screen.getByRole('textbox', { name: /Your answers or a note/ })).toHaveFocus();
  });

  it('changes typed, then Reply, then Go: no approval carries those words', async () => {
    const { post } = setup({ jobs: waiting(), gate: GATE });
    const back = await screen.findByRole('button', { name: /^No go: send back/ });
    await waitFor(() => expect(back).toBeEnabled());
    fireEvent.click(back);
    fireEvent.change(await screen.findByRole('textbox', { name: /What should change\?/ }), { target: { value: 'Use the small table.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    // The Reply box has its own words: none yet.
    const reply = await screen.findByRole('textbox', { name: /Your answers or a note/ });
    expect(reply).toHaveValue('');
    // Back to Send back: its words are still its own.
    fireEvent.click(back);
    expect(await screen.findByRole('textbox', { name: /What should change\?/ })).toHaveValue('Use the small table.');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const go = screen.getByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve' })));
    for (const [, b] of post.mock.calls.filter(([p]) => p === '/api/job/alpha/gate')) {
      expect(JSON.stringify(b)).not.toContain('Use the small table.');
    }
  });

  it('with Play off the calls are the gate’s own words', async () => {
    setup({ jobs: waiting(), gate: GATE, play: 'off' });
    expect(await screen.findByRole('button', { name: /^Approve/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Send back/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Next step' })).not.toHaveTextContent('Go / no go');
  });
});

// Spec 1.2: a decision shows it is on its way (the pressed call spins and can't send twice), then
// that it was sent, until the job moves; after 30 seconds of nothing it says so and offers Try again.
describe('after a click on the go / no go bar', () => {
  const waiting = (extra = {}) => [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', waitingFor: 'approval', headline: 'The plan is ready. Start building?', ...extra })];
  const SENT_LINE = 'Sent. Waiting for the Foreman to start.';
  /** Once the run it started works (final review A6, calls Minor 1). */
  const AT_WORK_LINE = 'Sent. The Foreman is at work on it.';
  /** A POST to the gate that answers only when told to. */
  function held() {
    let answer: (v: unknown) => void = () => {};
    const post = vi.fn((path: string, _body?: unknown): Promise<unknown> => (path.endsWith('/gate') ? new Promise((res) => { answer = res; }) : Promise.resolve({ ok: true })));
    return { post, answer: (v: unknown = { ok: true, sent: true, text: 'sent' }) => act(async () => { answer(v); }) };
  }
  /**
   * The gate POST as the server answers it (dashboard/runner/index.js): `sent: true` always comes with a
   * started run, whose run event reaches the page, and a deciding answer (approve, changes) answers the
   * brief. `runEvent: false`: the run event never arrives (a lost event stream), so the sent line stays.
   */
  const sentPost = ({ runEvent = true, answers = true } = {}) => {
    let n = 0;
    return vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
      if (path !== '/api/job/alpha/gate') return { ok: true };
      const b = (body ?? {}) as { kind?: string; briefNumber?: number | null };
      if (answers && (b.kind === 'approve' || b.kind === 'changes') && typeof b.briefNumber === 'number') server.answered.push(b.briefNumber);
      const run = { id: `r_sent_${++n}`, slug: 'alpha', status: 'running' };
      if (runEvent) server.store?.dispatch({ type: 'event', event: ev(100 + n, 'run', 'alpha', run) });
      return { ok: true, sent: true, text: 'sent', run };
    });
  };
  /** Every call in the bar (Try again aside). */
  const calls = () => within(bar()).queryAllByRole('button').filter((b) => !/Try again/.test(b.textContent ?? ''));
  /** Watches the bar from the click on: once the sent line has shown, the old ask must never come back. */
  function watchBar() {
    const seen: string[] = [];
    let sent = false;
    const look = () => {
      const el = document.querySelector('.next-bar');
      const text = el?.textContent ?? '';
      if (text.includes(SENT_LINE)) sent = true;
      const greyed = [...(el?.querySelectorAll('button') ?? [])].some((b) => (b as HTMLButtonElement).disabled && !/Try again/.test(b.textContent ?? ''));
      if (sent && (/Say go and the Foreman goes ahead|Go \/ no go/i.test(text) || greyed)) seen.push(text);
    };
    const mo = new MutationObserver(look);
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    return { stop: () => { look(); mo.disconnect(); return { sent, comeBack: seen }; } };
  }
  const gatePosts = (post: ReturnType<typeof vi.fn>) => post.mock.calls.filter(([p]) => p === '/api/job/alpha/gate');
  const bar = () => screen.getByRole('region', { name: 'Next step' });
  /** The page's one live region for a decision on its way (always there, empty when idle). */
  const live = () => document.querySelector('[data-next-live]')!;
  /** No go: send back, a note, then the card's Send back. */
  async function sendBack(note = 'Use the small table.') {
    fireEvent.click(await screen.findByRole('button', { name: /^No go: send back/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: /What should change\?/ }), { target: { value: note } });
    return screen.getByRole('button', { name: 'Send back' });
  }

  afterEach(() => { vi.useRealTimers(); });

  // Fix round 1, I1: the words that go out leave the store at the press, so the brief showing as
  // answered before the send's own answer comes back never copies them into the message box.
  const MOVED = /was answered while you were writing|unsent words are in the message box/;
  async function answeredBeforeTheReply(store: Store) {
    server.answered = [2];
    act(() => { store.dispatch({ type: 'event', event: ev(250, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(within(bar()).queryByRole('button', { name: /^Go: approve/ })).toBeNull());
    await act(async () => {});
  }

  it('Send back, with the answer slow to come back: the words are not copied into the message box and the bar says nothing about it', async () => {
    const { post, answer } = held();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await sendBack('Use the small table.'));
    await waitFor(() => expect(gatePosts(post)).toHaveLength(1));
    await answeredBeforeTheReply(store);
    expect(messageBox()).toHaveValue('');
    expect(screen.queryByText(MOVED)).toBeNull();
    await answer();
    expect(messageBox()).toHaveValue('');
    expect(screen.queryByText(MOVED)).toBeNull();
    expect(localStorage.getItem('fw.gateBox.alpha')).toBeNull();
  });

  it('Reply words sent with Go, with the answer slow to come back: the words are not copied into the message box and the bar says nothing about it', async () => {
    const { post, answer } = held();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'Keep the icon small.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(gatePosts(post)).toHaveLength(1));
    expect(gatePosts(post)[0][1]).toEqual(expect.objectContaining({ kind: 'approve', note: 'Keep the icon small.' }));
    await answeredBeforeTheReply(store);
    expect(messageBox()).toHaveValue('');
    expect(screen.queryByText(MOVED)).toBeNull();
    await answer();
    expect(messageBox()).toHaveValue('');
    expect(screen.queryByText(MOVED)).toBeNull();
  });

  // Fix round 1, M5: when he answered the brief himself, the line says only where his unsent words are.
  it.each([['the laptop app', false], ['the website', true]] as const)('after his own Go the unsent change words move to the message box with a line that says so (%s)', async (_where, hosted) => {
    // The box is named for steering while the run his Go started works.
    const composerBox = () => document.querySelector<HTMLTextAreaElement>('[data-composer-input]')!;
    setup({ jobs: waiting(), gate: GATE, post: sentPost(), hosted });
    await sendBack('Use the small table.');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const go = screen.getByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await waitFor(() => expect(composerBox()).toHaveValue('Use the small table.'));
    expect(screen.getByText('Your unsent words are in the message box.')).toBeVisible();
    expect(screen.queryByText(/was answered while you were writing/)).toBeNull();
    // The same rule: it goes once he writes there.
    fireEvent.change(composerBox(), { target: { value: 'Use the small table. Later.' } });
    await waitFor(() => expect(screen.queryByText('Your unsent words are in the message box.')).toBeNull());
  });

  // Fix round 1, item 12 (browser fault 3): a send that never got an answer says so in plain words.
  it.each([['the laptop app', false], ['the website', true]] as const)('a send that never gets an answer says Couldn’t reach …, not the browser’s words (%s)', async (_where, hosted) => {
    const post = vi.fn(async (p: string): Promise<unknown> => { if (p.endsWith('/gate')) throw new TypeError('Failed to fetch'); return { ok: true }; });
    setup({ jobs: waiting(), gate: GATE, post, hosted });
    // Go, then Send back.
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    expect(await screen.findByText(`Couldn’t reach ${BRAND.name}. Try again.`)).toBeVisible();
    expect(screen.queryByText('Failed to fetch')).toBeNull();
    fireEvent.click(await sendBack('Use the small table.'));
    await waitFor(() => expect(gatePosts(post)).toHaveLength(2));
    expect(await screen.findByText(`Couldn’t reach ${BRAND.name}. Try again.`)).toBeVisible();
    expect(screen.queryByText('Failed to fetch')).toBeNull();
    // An answer from the server keeps its own words.
    post.mockImplementation(async (p: string) => { if (p.endsWith('/gate')) throw new ApiError(503, 'The laptop is away.'); return { ok: true }; });
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    expect(await screen.findByText('The laptop is away.')).toBeInTheDocument();
  });

  // Fix round 2, item 1 (R1): after the press, a card writes to the slot only while it is still its own.
  const composerBox = () => document.querySelector<HTMLTextAreaElement>('[data-composer-input]')!;
  const times = (text: string, words: string) => text.split(words).length - 1;
  /** Change words held in What should change?, then Reply words, then Go: Go carries the Reply words. */
  async function bothBoxesThenGo(change: string, reply: string) {
    await sendBack(change);
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: reply } });
    const go = screen.getByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
  }

  it('words in both boxes, the details arrive before the send’s answer: the other box’s words are in the message box once', async () => {
    const { post, answer } = held();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    await bothBoxesThenGo('Use the small table.', 'Keep the icon small.');
    await waitFor(() => expect(gatePosts(post)).toHaveLength(1));
    await answeredBeforeTheReply(store);
    await waitFor(() => expect(composerBox()).toHaveValue('Use the small table.'));
    await answer();
    await act(async () => {});
    await act(async () => {});
    expect(composerBox()).toHaveValue('Use the small table.');
    expect(screen.getByText('Your unsent words are in the message box.')).toBeVisible();
  });

  it('words in both boxes, the details arrive before the send fails: each box’s words are in the message box once', async () => {
    let refuse: (e: unknown) => void = () => {};
    const post = vi.fn((p: string): Promise<unknown> => (p.endsWith('/gate') ? new Promise((_res, rej) => { refuse = rej; }) : Promise.resolve({ ok: true })));
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    await bothBoxesThenGo('Use the small table.', 'Keep the icon small.');
    await waitFor(() => expect(gatePosts(post)).toHaveLength(1));
    await answeredBeforeTheReply(store);
    await waitFor(() => expect(composerBox()).toHaveValue('Use the small table.'));
    await act(async () => { refuse(new ApiError(503, 'The laptop is away.')); });
    // The sent words that did not go come to the message box once; the other box's are not added again.
    await waitFor(() => expect(times(composerBox().value, 'Keep the icon small.')).toBe(1));
    await act(async () => {});
    expect(times(composerBox().value, 'Use the small table.')).toBe(1);
    expect(times(composerBox().value, 'Keep the icon small.')).toBe(1);
  });

  it('a late answer for brief 2 leaves brief 3’s words in his box and in the store', async () => {
    const { post, answer } = held();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    await bothBoxesThenGo('Old change.', 'A note.');
    await waitFor(() => expect(gatePosts(post)).toHaveLength(1));
    // Brief 2 is answered and brief 3 is raised before the Go's answer comes back.
    server.answered = [2];
    server.gate = { ...GATE, briefNumber: 3, headline: 'Tests ready' };
    act(() => { store.dispatch({ type: 'event', event: ev(250, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(bar()).toHaveTextContent('Tests ready'));
    await waitFor(() => expect(composerBox()).toHaveValue('Old change.'));
    // While brief 2's Go is out this page's calls rest, so brief 3's words are typed elsewhere (the
    // Desk, another tab) and kept in the job's one slot.
    act(() => { writeStored('fw.gateBox.alpha', JSON.stringify({ gate: '#3', session: null, brief: 3, mode: 'changes', notes: { changes: 'Brief three words.', message: '' } })); });
    await answer();
    await act(async () => {});
    expect(localStorage.getItem('fw.gateBox.alpha')).toContain('Brief three words.');
    expect(composerBox()).toHaveValue('Old change.');
    // Drawn again, brief 3's card has his words in its box.
    cleanup();
    setup({ jobs: waiting(), gate: { ...GATE, briefNumber: 3, headline: 'Tests ready' } });
    expect(await screen.findByRole('textbox', { name: /What should change\?/ })).toHaveValue('Brief three words.');
    expect(composerBox()).toHaveValue('Old change.');
  });

  it('after his own Send back the unsent Reply words move to the message box with a line that says so', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A question for later.' } });
    fireEvent.click(await sendBack('Use the small table.'));
    await waitFor(() => expect(composerBox()).toHaveValue('A question for later.'));
    expect(screen.getByText('Your unsent words are in the message box.')).toBeVisible();
    expect(times(composerBox().value, 'Use the small table.')).toBe(0);
  });

  // Fix round 3: a call's error is always seen, and the focus is never lost to the page body.
  const THREE_QUESTIONS: Gate = {
    ...GATE,
    questions: ['Keep the old column?', 'Show it on the phone?', 'Log the merge?'].map((text, i) => ({ id: String(i + 1), text, recommendation: 'a', options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] })),
  } as Gate;
  /** As a browser does: a focused control that is disabled loses the focus to the page body. */
  function focusFixup() {
    const mo = new MutationObserver(() => {
      const at = document.activeElement as HTMLButtonElement | null;
      if (at && at !== document.body && at.disabled) at.blur();
    });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['disabled'] });
    return () => mo.disconnect();
  }
  function watchScrolls() {
    const seen = vi.fn();
    const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: seen });
    return { seen, restore: () => { if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had); else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; } };
  }
  const UNREACHABLE = `Couldn’t reach ${BRAND.name}. Try again.`;
  const cannotReach = () => vi.fn(async (p: string): Promise<unknown> => { if (p.endsWith('/gate')) throw new TypeError('Failed to fetch'); return { ok: true }; });

  it.each([['the laptop app', false], ['the website', true]] as const)('a failed Go on a brief with several questions brings the error into view (%s)', async (_where, hosted) => {
    const { seen, restore } = watchScrolls();
    try {
      const { store } = setup({ jobs: waiting(), gate: THREE_QUESTIONS, post: cannotReach(), hosted });
      const go = await screen.findByRole('button', { name: /^Go: approve/ });
      await waitFor(() => expect(go).toBeEnabled());
      fireEvent.click(go);
      const words = await screen.findByText(UNREACHABLE);
      await waitFor(() => expect(seen.mock.contexts.filter((c) => c === words)).toHaveLength(1));
      expect(seen).toHaveBeenCalledWith({ block: 'nearest' });
      // A redraw with the same words does not scroll again.
      act(() => { store.dispatch({ type: 'event', event: ev(260, 'thread', 'alpha', {}) }); });
      await act(async () => {});
      expect(screen.getByText(UNREACHABLE)).toBe(words);
      expect(seen.mock.contexts.filter((c) => c === words)).toHaveLength(1);
    } finally { restore(); }
  });

  it.each([['the laptop app', false], ['the website', true]] as const)('after a failed Go the focus is on Go, not the page body (%s)', async (_where, hosted) => {
    const undo = focusFixup();
    try {
      setup({ jobs: waiting(), gate: THREE_QUESTIONS, post: cannotReach(), hosted });
      const go = await screen.findByRole('button', { name: /^Go: approve/ });
      await waitFor(() => expect(go).toBeEnabled());
      go.focus();
      fireEvent.click(go);
      await screen.findByText(UNREACHABLE);
      await waitFor(() => expect(go).toHaveFocus());
      expect(document.activeElement).not.toBe(document.body);
    } finally { undo(); }
  });

  // The fourth browser pass: the focus coming back to Go scrolled the column to its top again and
  // took the error, just brought into view, back out of it. The focus comes back without a scroll.
  it('after a failed Go the focus comes back without scrolling the error away', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      setup({ jobs: waiting(), gate: THREE_QUESTIONS, post: cannotReach() });
      const go = await screen.findByRole('button', { name: /^Go: approve/ });
      await waitFor(() => expect(go).toBeEnabled());
      go.focus();
      fireEvent.click(go);
      // As a browser does while the call is off: the focus drops to the page body.
      go.blur();
      focus.mockClear();
      await screen.findByText(UNREACHABLE);
      await waitFor(() => expect(document.activeElement).not.toBe(document.body));
      const calls = focus.mock.calls.filter((_c, i) => focus.mock.contexts[i] === document.activeElement);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c[0]).toEqual({ preventScroll: true });
    } finally { focus.mockRestore(); }
  });

  it('a failed send never takes the focus from a box he is typing in', async () => {
    setup({ jobs: waiting(), gate: THREE_QUESTIONS, post: cannotReach() });
    fireEvent.click(await sendBack('Use the small table.'));
    await screen.findByText(UNREACHABLE);
    // He went on typing in the message box.
    composerBox().focus();
    await act(async () => {});
    expect(composerBox()).toHaveFocus();
  });

  it('a send that fails puts the words back in the box and in the store', async () => {
    let refuse: (e: unknown) => void = () => {};
    const post = vi.fn((p: string): Promise<unknown> => (p.endsWith('/gate') ? new Promise((_res, rej) => { refuse = rej; }) : Promise.resolve({ ok: true })));
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await sendBack('Use the small table.'));
    await waitFor(() => expect(gatePosts(post)).toHaveLength(1));
    // While it is out, the words are not kept to be moved.
    expect(localStorage.getItem('fw.gateBox.alpha') ?? '').not.toContain('Use the small table.');
    await act(async () => { refuse(new ApiError(503, 'The laptop is away.')); });
    expect(await screen.findByText('The laptop is away.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toHaveValue('Use the small table.');
    expect(localStorage.getItem('fw.gateBox.alpha')).toContain('Use the small table.');
  });

  it('Go spins on the click and cannot be pressed twice', async () => {
    const { post, answer } = held();
    setup({ jobs: waiting(), gate: GATE, post });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    const back = screen.getByRole('button', { name: /^No go: send back/ });
    go.focus();
    fireEvent.click(go);
    fireEvent.click(go);
    await waitFor(() => expect(go).toHaveAttribute('aria-busy', 'true'));
    // It can't be pressed, but it keeps the focus, and a screen reader hears that it is sending.
    expect(go).toHaveAttribute('aria-disabled', 'true');
    expect(go).toHaveFocus();
    expect(go).toHaveAccessibleName('Sending…');
    expect(go.querySelector('.spin-ring')).not.toBeNull();
    expect(back).toBeDisabled();
    expect(gatePosts(post)).toHaveLength(1);
    expect(gatePosts(post)[0][1]).toEqual(expect.objectContaining({ kind: 'approve' }));
    await answer();
  });

  // m2: the greyed calls say why while a decision is out, not "the card under this says why".
  it('while a Go is being sent the other calls say they are off for that', async () => {
    const { post, answer } = held();
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(live()).toHaveTextContent('Sending…'));
    const back = screen.getByRole('button', { name: /^No go: send back/ });
    const reply = screen.getByRole('button', { name: 'Reply' });
    await waitFor(() => expect(back).toBeDisabled());
    expect(back).toHaveAttribute('title', 'Off while your decision is being sent.');
    expect(reply).toBeDisabled();
    expect(reply).toHaveAttribute('title', 'Off while your decision is being sent.');
    await answer();
  });

  it('Reply spins on the click, cannot be pressed twice, and the focus ends on the sent line', async () => {
    const { post, answer } = held();
    setup({ jobs: waiting(), gate: GATE, post });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A note.' } });
    const send = screen.getByRole('button', { name: 'Send the reply' });
    send.focus();
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(send).toHaveAttribute('aria-busy', 'true'));
    expect(gatePosts(post)).toHaveLength(1);
    expect(gatePosts(post)[0][1]).toEqual(expect.objectContaining({ kind: 'message' }));
    expect(live()).toHaveTextContent('Sending…');
    await answer();
    await waitFor(() => expect(live()).toHaveTextContent(SENT_LINE));
    // The bar has no calls now, so no second press; the focus is on something still on screen.
    expect(within(bar()).queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.isConnected).toBe(true);
  });

  it('the page has one live region: empty before the click, then sending, then sent; the focus goes to what was sent', async () => {
    const { post, answer } = held();
    setup({ jobs: waiting(), gate: GATE, post });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    expect(live()).toHaveAttribute('role', 'status');
    expect(live()).toBeEmptyDOMElement();
    go.focus();
    fireEvent.click(go);
    await waitFor(() => expect(live()).toHaveTextContent('Sending…'));
    expect(go).toHaveFocus();
    await answer();
    await waitFor(() => expect(live()).toHaveTextContent(SENT_LINE));
    expect(document.querySelectorAll('[data-next-live]')).toHaveLength(1);
    // The card's note says what went (as before), and has the focus: it is not dropped.
    expect(document.activeElement).toHaveTextContent('Your approval went to the Foreman.');
  });

  it('before the job says the brief is answered, the card’s own a key sends nothing again', async () => {
    // The gap between the run starting and the job being fetched again: the card is still open.
    const post = sentPost({ answers: false });
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(AT_WORK_LINE);
    await act(async () => {});
    expect(document.querySelector('[data-gate="approve"]')).not.toBeNull();
    fireEvent.keyDown(document.body, { key: 'a' });
    await act(async () => {});
    expect(gatePosts(post)).toHaveLength(1);
  });

  it('a press while sent sends nothing', async () => {
    const post = sentPost();
    setup({ jobs: waiting(), gate: GATE, post });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    fireEvent.click(go);
    await within(bar()).findByText(AT_WORK_LINE);
    // The calls are gone from the bar; a second click or the a key sends nothing.
    expect(calls()).toHaveLength(0);
    fireEvent.click(go);
    fireEvent.keyDown(document.body, { key: 'a' });
    await act(async () => {});
    expect(gatePosts(post)).toHaveLength(1);
  });

  it('after the server accepts, the bar says it was sent and the Foreman is at work on it', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    expect(await within(bar()).findByText(AT_WORK_LINE)).toBeInTheDocument();
    expect(live()).toHaveTextContent(AT_WORK_LINE);
    // The calls are gone: nothing spins and nothing can be pressed again.
    expect(calls()).toHaveLength(0);
  });

  it('after 30 seconds with no change it says "Nothing has moved yet." and offers Try again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup({ jobs: waiting(), gate: GATE, post: sentPost({ runEvent: false }) });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    act(() => { vi.advanceTimersByTime(29_000); });
    expect(within(bar()).queryByText('Nothing has moved yet.')).toBeNull();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(within(bar()).getByText('Nothing has moved yet.')).toBeInTheDocument();
    expect(live()).toHaveTextContent('Nothing has moved yet.');
    expect(within(bar()).queryByText(SENT_LINE)).toBeNull();
    expect(within(bar()).getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  // m1: a send with no answer at all.
  it('a Go that gets no answer: after 30 seconds from the click, "Nothing has moved yet." with Try again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { post, answer } = held();
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(live()).toHaveTextContent('Sending…'));
    act(() => { vi.advanceTimersByTime(29_000); });
    expect(bar()).not.toHaveTextContent('Nothing has moved yet.');
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(within(bar()).getByText('Nothing has moved yet.')).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'Try again' })).toBeEnabled();
    await answer();
  });

  it('Try again sends the same decision once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = sentPost({ runEvent: false });
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    act(() => { vi.advanceTimersByTime(30_000); });
    const again = within(bar()).getByRole('button', { name: 'Try again' });
    fireEvent.click(again);
    fireEvent.click(again);
    expect(await within(bar()).findByText(SENT_LINE)).toBeInTheDocument();
    const sent = gatePosts(post);
    expect(sent).toHaveLength(2);
    expect(sent[1][1]).toEqual(sent[0][1]);
  });

  it('Try again shows the server’s refusal where errors show, and the bar goes back to how it was', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    const post = vi.fn(async (path: string): Promise<unknown> => {
      if (path.endsWith('/gate') && n++ > 0) throw new ApiError(409, 'The Foreman has moved on to brief 3 since this card was shown. Nothing was sent; decide on the new brief.', { code: 'stale-brief' });
      return { ok: true, sent: true, text: 'sent' };
    });
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    act(() => { vi.advanceTimersByTime(30_000); });
    fireEvent.click(within(bar()).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/moved on to brief 3/)).toHaveAttribute('role', 'alert');
    expect(within(bar()).queryByText('Nothing has moved yet.')).toBeNull();
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  // Fix round 2: focus after Try again, and the bar's calls while it is out.
  /** Sent at once the first time; later gate posts answer only when told to (or are refused). */
  function sentThenHeld() {
    let n = 0;
    let answer: (v: unknown) => void = () => {};
    let fail: (e: unknown) => void = () => {};
    const post = vi.fn((path: string, _body?: unknown): Promise<unknown> => {
      if (!path.endsWith('/gate')) return Promise.resolve({ ok: true });
      if (n++ === 0) return Promise.resolve({ ok: true, sent: true, text: 'sent' });
      return new Promise((res, rej) => { answer = res; fail = rej; });
    });
    return {
      post,
      answer: () => act(async () => { answer({ ok: true, sent: true, text: 'sent' }); }),
      refuse: () => act(async () => { fail(new ApiError(409, 'The Foreman has moved on to brief 3 since this card was shown. Nothing was sent; decide on the new brief.', { code: 'stale-brief' })); }),
    };
  }
  async function stuckThenTryAgain(post: (path: string, body?: unknown) => Promise<unknown>) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup({ jobs: waiting(), gate: GATE, post: vi.fn(post) });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    act(() => { vi.advanceTimersByTime(30_000); });
    const again = within(bar()).getByRole('button', { name: 'Try again' });
    again.focus();
    fireEvent.click(again);
    await waitFor(() => expect(again).toHaveAttribute('aria-busy', 'true'));
    expect(again).toHaveFocus();
    return again;
  }

  it('after Try again succeeds the focus is on the sent line, not the page', async () => {
    const { post, answer } = sentThenHeld();
    await stuckThenTryAgain(post);
    await answer();
    const line = await within(bar()).findByText(SENT_LINE);
    await waitFor(() => expect(within(bar()).queryByRole('button', { name: /Try again|Sending/ })).toBeNull());
    expect(line).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('after Try again is refused again the focus is on the server’s sentence, not the page', async () => {
    const { post, refuse } = sentThenHeld();
    await stuckThenTryAgain(post);
    await refuse();
    const said = await screen.findByText(/moved on to brief 3/);
    // Try again is gone (the bar is back to how it was), so the focus goes to why it sent nothing.
    expect(within(bar()).queryByRole('button', { name: /Try again|Sending/ })).toBeNull();
    expect(said).toHaveFocus();
  });

  it('while Try again is out, Go and Send back are not in the bar, and the a key sends nothing', async () => {
    const { post, answer } = sentThenHeld();
    await stuckThenTryAgain(post);
    expect(calls()).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: 'a' });
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(gatePosts(post)).toHaveLength(2);
    expect(screen.queryByText(/What should change\?/)).toBeNull();
    await answer();
  });

  it('when the job moves on, the bar clears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost({ runEvent: false }) });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    // The job moves on: its stage and what it waits for change, and its gate goes.
    server.gate = null;
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: waiting({ stage: 'implement', waitingFor: null, lane: 'working' }), meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(bar()).not.toHaveTextContent(SENT_LINE));
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(bar()).not.toHaveTextContent('Nothing has moved yet.');
  });

  it('Send back spins on the click and cannot be pressed twice', async () => {
    const { post, answer } = held();
    setup({ jobs: waiting(), gate: GATE, post });
    const back = await screen.findByRole('button', { name: /^No go: send back/ });
    const go = screen.getByRole('button', { name: /^Go: approve/ });
    const send = await sendBack();
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(send).toHaveAttribute('aria-busy', 'true'));
    expect(send).toHaveAccessibleName('Sending…');
    expect(send.querySelector('.spin-ring')).not.toBeNull();
    expect(back).toHaveAttribute('aria-busy', 'true');
    expect(go).toBeDisabled();
    expect(gatePosts(post)).toHaveLength(1);
    expect(gatePosts(post)[0][1]).toEqual(expect.objectContaining({ kind: 'changes', note: 'Use the small table.' }));
    await answer();
  });

  it('after the server accepts a send back, the bar says it was sent and the Foreman is at work on it', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    fireEvent.click(await sendBack());
    expect(await within(bar()).findByText(AT_WORK_LINE)).toBeInTheDocument();
    expect(bar()).toHaveTextContent('Sent back: the Foreman stays at Plan and revises. Nothing is approved.');
    expect(live()).toHaveTextContent(`${AT_WORK_LINE} Sent back: the Foreman stays at Plan and revises. Nothing is approved.`);
  });

  it('after the server accepts a reply, the bar says nothing is approved', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A note.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    expect(await within(bar()).findByText(AT_WORK_LINE)).toBeInTheDocument();
    expect(bar()).toHaveTextContent('Your reply reached the Foreman. Nothing is approved, so the card stays open.');
    expect(live()).toHaveTextContent(`${AT_WORK_LINE} Your reply reached the Foreman. Nothing is approved, so the card stays open.`);
  });

  it('after the Foreman answers a reply, Reply, Go and Send back can be pressed again', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A note.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await within(bar()).findByText(AT_WORK_LINE);
    // The Foreman picks the message up (the run the reply started): the bar keeps its words, no calls.
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ id: 'r_sent_1', status: 'running' }));
    expect(bar()).toHaveTextContent('Your reply reached the Foreman. Nothing is approved, so the card stays open.');
    expect(calls()).toHaveLength(0);
    // It answers: the gate is still waiting.
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_sent_1', slug: 'alpha', status: 'done' }) }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    expect(screen.getByRole('button', { name: /^Go: approve/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^No go: send back/ })).toBeEnabled();
    // The bar reads as waiting again.
    expect(bar()).toHaveTextContent('Say go and the Foreman goes ahead: Build step 1');
    expect(bar()).not.toHaveTextContent('Nothing is approved');
  });

  it('a reply with answers and no note is sent', async () => {
    const post = sentPost();
    setup({ jobs: waiting(), gate: { ...GATE, questions: [{ id: '1', text: 'Keep the old column?', recommendation: null, options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] }] } as Gate, post });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await screen.findByRole('textbox', { name: /Your answers or a note/ });
    expect(screen.getByRole('button', { name: 'Send the reply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send the reply' })).toHaveAttribute('title', 'Pick an answer or write a note first.');
    fireEvent.click(screen.getByRole('radio', { name: /No/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'message', answers: { 1: { choice: 'b' } } })));
  });

  it('after 30 seconds with no change to a send back it says "Nothing has moved yet."; Try again sends the same send back once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = sentPost({ runEvent: false });
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await sendBack());
    await within(bar()).findByText(SENT_LINE);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(within(bar()).getByText('Nothing has moved yet.')).toBeInTheDocument();
    const again = within(bar()).getByRole('button', { name: 'Try again' });
    fireEvent.click(again);
    fireEvent.click(again);
    await within(bar()).findByText(SENT_LINE);
    const sent = gatePosts(post);
    expect(sent).toHaveLength(2);
    expect(sent[1][1]).toEqual(sent[0][1]);
    expect(sent[1][1]).toEqual(expect.objectContaining({ kind: 'changes', note: 'Use the small table.' }));
  });

  it('when the job moves on after a send back, the bar clears', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost({ runEvent: false }) });
    fireEvent.click(await sendBack());
    await within(bar()).findByText(SENT_LINE);
    server.gate = null;
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: waiting({ waitingFor: null, lane: 'working' }), meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(bar()).not.toHaveTextContent(SENT_LINE));
  });

  // Deep review D, I1: the server answers `sent` with a started run, so the sent state clears at once;
  // the bar keeps its words after the run started, and the old ask never comes back.
  it('Go: after the run started the bar still says it was sent, with no calls', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    const watch = watchBar();
    fireEvent.click(go);
    await within(bar()).findByText(AT_WORK_LINE);
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ status: 'running' }));
    await act(async () => {});
    expect(within(bar()).getByText(AT_WORK_LINE)).toBeInTheDocument();
    expect(live()).toHaveTextContent(AT_WORK_LINE);
    expect(calls()).toHaveLength(0);
    expect(bar()).toHaveTextContent('Your go reached the Foreman. Build starts next.');
    expect(bar()).not.toHaveTextContent('Nothing is approved');
    expect(bar()).not.toHaveTextContent('rework');
    // A run is at work: no Try again.
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(watch.stop().comeBack).toEqual([]);
  });

  it('Send back: after the run started the bar says it was sent and that the Foreman stays at the step', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    const send = await sendBack();
    const watch = watchBar();
    fireEvent.click(send);
    await within(bar()).findByText(AT_WORK_LINE);
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ status: 'running' }));
    await act(async () => {});
    expect(within(bar()).getByText(AT_WORK_LINE)).toBeInTheDocument();
    expect(bar()).toHaveTextContent('Sent back: the Foreman stays at Plan and revises. Nothing is approved.');
    expect(calls()).toHaveLength(0);
    expect(watch.stop().comeBack).toEqual([]);
  });

  it('Reply: while the run it started works the bar says it was sent and that nothing is approved', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A note.' } });
    const watch = watchBar();
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await within(bar()).findByText(AT_WORK_LINE);
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ status: 'running' }));
    await act(async () => {});
    expect(within(bar()).getByText(AT_WORK_LINE)).toBeInTheDocument();
    expect(bar()).toHaveTextContent('Your reply reached the Foreman. Nothing is approved, so the card stays open.');
    expect(calls()).toHaveLength(0);
    expect(watch.stop().comeBack).toEqual([]);
  });

  it('an answered brief drawn again (the page opened later) says it was sent, with no calls and no Try again while a run works', async () => {
    server.answered = [];
    const { store } = setup({ jobs: waiting(), gate: GATE });
    server.answered.push(2);
    act(() => { store.dispatch({ type: 'event', event: ev(20, 'run', 'alpha', { id: 'r_x', slug: 'alpha', status: 'running' }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(21, 'thread', 'alpha', {}) }); });
    // The bar is drawn again once the job is fetched: look it up each time.
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    expect(calls()).toHaveLength(0);
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(bar()).not.toHaveTextContent('Say go and the Foreman goes ahead');
  });

  // Part 2: an answered brief that has stalled offers Try again; a held answer is not "sent".
  it('answered, and 30 s after the run ended with nothing new: "Nothing has moved yet." with Try again, which sends the same decision again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = sentPost();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(AT_WORK_LINE);
    // The run ends; the brief is still the answered one and nothing new starts.
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_sent_1', slug: 'alpha', status: 'done', endedAt: new Date().toISOString() }) }); });
    act(() => { vi.advanceTimersByTime(29_000); });
    // The run is over: the line waits for the Foreman again.
    expect(bar()).toHaveTextContent(SENT_LINE);
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
    act(() => { vi.advanceTimersByTime(2_000); });
    await waitFor(() => expect(bar()).toHaveTextContent('Nothing has moved yet.'));
    const again = within(bar()).getByRole('button', { name: 'Try again' });
    expect(calls()).toHaveLength(0);
    fireEvent.click(again);
    await waitFor(() => expect(gatePosts(post)).toHaveLength(2));
    expect(gatePosts(post)[1][1]).toEqual(gatePosts(post)[0][1]);
  });

  it('a page opened on an answered brief with no run and no decision of its own: "Nothing has moved yet.", write to the Foreman, no Try again', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE });
    server.answered.push(2);
    act(() => { store.dispatch({ type: 'event', event: ev(20, 'run', 'alpha', { id: 'r_old', slug: 'alpha', status: 'done', endedAt: new Date(Date.now() - 31_000).toISOString() }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(21, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(bar()).toHaveTextContent('Nothing has moved yet.'));
    // M2: no "below": at 1280 px and wider the message box is to the right.
    expect(bar()).toHaveTextContent('Write to the Foreman to move it on.');
    expect(bar()).not.toHaveTextContent('below');
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(calls()).toHaveLength(0);
  });

  it('an answer held for the usage limit says so, not "Sent", with no calls', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE });
    server.held = { kind: 'approve', gateBrief: 2, at: NOW };
    act(() => { store.dispatch({ type: 'event', event: ev(21, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(bar()).toHaveTextContent('Held until Claude’s usage limit resets.'));
    expect(bar()).not.toHaveTextContent(SENT_LINE);
    expect(calls()).toHaveLength(0);
    expect(live()).toHaveTextContent('Held until Claude’s usage limit resets.');
  });

  // Round 2, M6: a job started again under the same name is a new job: the old answer is forgotten.
  it('after the job is started again (a new session), its brief 2 asks again; the old answer is not kept', async () => {
    const post = sentPost();
    const { store } = setup({ jobs: waiting(), gate: GATE, post, drive: { sessionId: 's1', model: 'claude-opus-5-5' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    // Started again: a new Foreman session, the same brief number open again, nothing answered.
    server.answered = [];
    server.drive = { sessionId: 's2', model: 'claude-fable-5-2' };
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_new', slug: 'alpha', status: 'done', endedAt: new Date().toISOString() }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(201, 'thread', 'alpha', {}) }); });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    // Neither sent line (fix round 1, M2): the old answer is not kept.
    expect(bar()).not.toHaveTextContent(SENT_LINE);
    expect(bar()).not.toHaveTextContent(AT_WORK_LINE);
    fireEvent.click(go);
    await waitFor(() => expect(gatePosts(post)).toHaveLength(2));
  });

  // Round 2, M7: Try again sends a decision only, never a Reply's words.
  it('after a Reply, a brief decided elsewhere that stalls says to write to the Foreman, with no Try again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = sentPost();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A note.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    // Another page decided the brief; the reply's run ends and nothing new comes.
    server.answered.push(2);
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_sent_1', slug: 'alpha', status: 'done', endedAt: new Date().toISOString() }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(201, 'thread', 'alpha', {}) }); });
    act(() => { vi.advanceTimersByTime(31_000); });
    await waitFor(() => expect(bar()).toHaveTextContent('Nothing has moved yet.'));
    expect(bar()).toHaveTextContent('Write to the Foreman');
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(gatePosts(post)).toHaveLength(1);
  });

  // Round 2, N2: the stalled line is never said to a job that waits on something else, or has moved.
  const answeredAndEnded = (store: Store) => {
    server.answered.push(2);
    act(() => { store.dispatch({ type: 'event', event: ev(20, 'run', 'alpha', { id: 'r_old', slug: 'alpha', status: 'error', endedAt: new Date(Date.now() - 300_000).toISOString() }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(21, 'thread', 'alpha', {}) }); });
  };
  it('a job paused for the usage limit says so, in the page’s own words, never "Nothing has moved yet."', async () => {
    const { store } = setup({ jobs: waiting({ limitPaused: new Date(Date.now() + 3_600_000).toISOString(), group: 'paused', lane: 'working', laneReason: 'Paused for the usage limit; carries on at 15:00' }), gate: GATE });
    answeredAndEnded(store);
    await waitFor(() => expect(bar()).toHaveTextContent('Paused for the usage limit; carries on at 15:00'));
    await act(async () => {});
    expect(bar()).not.toHaveTextContent('Nothing has moved yet.');
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(calls()).toHaveLength(0);
  });

  it('a job cut off by a restart says it waits for Resume, never "Nothing has moved yet."', async () => {
    const { store } = setup({ jobs: waiting({ restartPaused: { how: 'crash' }, group: 'paused', lane: 'working', laneReason: 'Paused by a restart; waits for Resume' }), gate: GATE });
    answeredAndEnded(store);
    await waitFor(() => expect(bar()).toHaveTextContent('Paused by a restart; waits for Resume'));
    await act(async () => {});
    expect(bar()).not.toHaveTextContent('Nothing has moved yet.');
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('a stale page: when the run ends the job is fetched again, and the bar asks about the new brief, never "Nothing has moved yet."', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = sentPost();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    // The run ends; what the page reads then still shows brief 2 answered (the server's list lags).
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_sent_1', slug: 'alpha', status: 'done', endedAt: new Date().toISOString() }) }); });
    await act(async () => {});
    expect(bar()).toHaveTextContent(SENT_LINE);
    // Meanwhile the Foreman raised brief 3; no thread event reaches this page.
    server.gate = { ...GATE, briefNumber: 3, headline: 'Tests ready', nextProposed: 'Open PR #1' };
    act(() => { vi.advanceTimersByTime(31_000); });
    await waitFor(() => expect(bar()).toHaveTextContent('Say go and the Foreman goes ahead: Open PR #1'));
    expect(bar()).not.toHaveTextContent('Nothing has moved yet.');
    expect(gatePosts(post)).toHaveLength(1);
  });

  it('before it says "Nothing has moved yet." the page fetches the job once more', async () => {
    const { store, get } = setup({ jobs: waiting(), gate: GATE });
    server.answered.push(2);
    act(() => { store.dispatch({ type: 'event', event: ev(21, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(bar()).toHaveTextContent(SENT_LINE));
    const before = get.mock.calls.filter(([p]) => p === '/api/job/alpha').length;
    act(() => { store.dispatch({ type: 'event', event: ev(22, 'run', 'alpha', { id: 'r_old', slug: 'alpha', status: 'done', endedAt: new Date(Date.now() - 31_000).toISOString() }) }); });
    await waitFor(() => expect(bar()).toHaveTextContent('Nothing has moved yet.'));
    expect(get.mock.calls.filter(([p]) => p === '/api/job/alpha').length).toBeGreaterThan(before);
  });

  // Round 2, N1: a go / no go with no brief number (the reviewer's team-invites and audit-log).
  const UNNUMBERED: Gate = { ...GATE, briefNumber: null, briefFile: null } as unknown as Gate;
  it('no brief number: after Go the sent line shows and stays while the Foreman works; the old ask and its calls never come back', async () => {
    const { store } = setup({ jobs: waiting(), gate: UNNUMBERED, post: sentPost() });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    const watch = watchBar();
    fireEvent.click(go);
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ status: 'running' }));
    // The job is fetched again (a thread event): its gate still has the same words and no number.
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await act(async () => {});
    expect(bar()).toHaveTextContent(AT_WORK_LINE);
    expect(calls()).toHaveLength(0);
    expect(watch.stop().comeBack).toEqual([]);
  });

  it('no brief number: a second Go, by the button or the a key, sends nothing', async () => {
    const post = sentPost();
    const { store } = setup({ jobs: waiting(), gate: UNNUMBERED, post });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    fireEvent.click(go);
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await act(async () => {});
    fireEvent.click(go);
    for (const b of within(bar()).queryAllByRole('button')) fireEvent.click(b);
    document.querySelector<HTMLButtonElement>('[data-gate="approve"]')?.click();
    fireEvent.keyDown(document.body, { key: 'a' });
    await act(async () => {});
    expect(gatePosts(post)).toHaveLength(1);
  });

  it('no brief number: once the gate’s words change, it asks again', async () => {
    const { store } = setup({ jobs: waiting(), gate: UNNUMBERED, post: sentPost() });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_sent_1', slug: 'alpha', status: 'done', endedAt: new Date().toISOString() }) }); });
    server.gate = { ...UNNUMBERED, headline: 'Build done', nextProposed: 'Run the tests' } as Gate;
    act(() => { store.dispatch({ type: 'event', event: ev(301, 'thread', 'alpha', {}) }); });
    expect(await screen.findByRole('button', { name: /^Go: approve/ })).toBeEnabled();
    expect(bar()).toHaveTextContent('Say go and the Foreman goes ahead: Run the tests');
  });

  it('once the brief is answered and the gate goes, the bar without a gate still says it was sent', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost({ runEvent: false }) });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    // The same job, its page drawn again without its gate (the Foreman's status no longer waits on it).
    cleanup();
    setup({ jobs: waiting(), gate: null, post: sentPost({ runEvent: false }) });
    expect(within(bar()).getByText(SENT_LINE)).toBeInTheDocument();
  });
});

// Deep review D, C1: Auto is on the page the person answers on, not only in a header no page shows.
// The Auto words on the bar (moved from the old page's "Auto on the job page"; its header's switch went with the page).
describe('Auto on the bar', () => {
  const STOPPED = { on: true, by: 'you' as const, ran: true, stopped: { reason: 'a database change needs you.', rule: 'database', at: NOW } };

  it('a stopped Auto job says why it stopped in the bar, not "Say go and the Foreman goes ahead"', async () => {
    const reason = 'Auto stopped: a database change needs you.';
    setup({ jobs: [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', level: 1, waitingFor: 'approval', laneReason: reason, auto: STOPPED })], gate: GATE });
    await screen.findByRole('button', { name: /^Go: approve/ });
    const bar = screen.getByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent(reason);
    expect(bar).not.toHaveTextContent('Say go and the Foreman goes ahead');
  });

  it('while Auto is deciding the bar says so, the calls stay usable, and his own answer still counts', async () => {
    const { post } = setup({ jobs: [job('alpha', 'running', { stage: 'plan', lane: 'working', level: 1, waitingFor: 'approval', laneReason: 'Auto is deciding: the plan', auto: { on: true, by: 'you', ran: true } })], gate: GATE });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    const bar = screen.getByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Auto is deciding: the plan');
    expect(bar).not.toHaveTextContent('Say go and the Foreman goes ahead');
    expect(screen.getByText('Auto is deciding this step. Your own answer still counts.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^No go: send back/ })).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve' })));
  });

  it('an ordinary job never says Auto is deciding', async () => {
    setup({ jobs: [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', waitingFor: 'approval' })], gate: GATE });
    await screen.findByRole('button', { name: /^Go: approve/ });
    expect(screen.queryByText(/Auto is deciding/)).toBeNull();
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('Say go and the Foreman goes ahead: Build step 1');
  });
});

describe('the permission alert', () => {
  const ask = (id: string, at: string, extra: Partial<Permission> = {}): Permission => ({ ...permission(id, 'alpha'), createdAt: at, input: { command: 'npm test' }, ...extra });

  it('takes the bar’s place: what it wants, the exact step, Allow once (a) and Deny (d); the rest fold oldest first', async () => {
    const { post } = setup({ permissions: [ask('p2', '2026-10-21T10:05:00Z'), ask('p1', '2026-10-21T10:00:00Z', { agentType: 'feature-tester' }), ask('p3', '2026-10-21T10:09:00Z')] });
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
    const alert = screen.getByRole('region', { name: 'Permission: Run a command' });
    expect(alert).toHaveTextContent('The Tester wants to run a command');
    expect(alert).toHaveTextContent('npm test');
    expect(within(alert).getByRole('button', { name: /^Allow once/ }).querySelector('kbd')).toHaveTextContent('a');
    expect(screen.getByText('2 more waiting').closest('details')).not.toHaveAttribute('open');
    // Not offered: the dashboard can't keep a rule for one job here.
    expect(within(alert).queryByRole('button', { name: 'Always allow for this job' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'a' });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/p1', expect.objectContaining({ decision: 'allow' })));
  });

  it('a hard line: no key allows it, and it is never remembered', () => {
    const { post } = setup({ permissions: [ask('p1', '2026-10-21T10:00:00Z', { hardLine: { line: 'push', reason: 'It pushes to GitHub.' }, canAllowForJob: true } as Partial<Permission>)] });
    const alert = screen.getByRole('region', { name: 'Permission: Run a command' });
    expect(alert).toHaveTextContent('Hard line');
    expect(alert).toHaveTextContent('Why it asks: It pushes to GitHub.');
    expect(alert).toHaveTextContent('A key never allows a hard line.');
    expect(within(alert).getByRole('button', { name: /^Allow once/ }).querySelector('kbd')).toBeNull();
    expect(within(alert).queryByRole('button', { name: /Always allow/ })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(post).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'd' });
    expect(within(alert).getByRole('button', { name: /^Deny/ })).toBeInTheDocument();
  });

  it('offers Always allow for this job only where the dashboard can keep it', async () => {
    const { post } = setup({ permissions: [ask('p1', '2026-10-21T10:00:00Z', { canAllowForJob: true } as Partial<Permission>)] });
    fireEvent.click(screen.getByRole('button', { name: 'Always allow for this job' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/p1', expect.objectContaining({ decision: 'allow-job' })));
  });

  it('folds a long step', () => {
    setup({ permissions: [ask('p1', '2026-10-21T10:00:00Z', { input: { command: 'a\nb\nc\nd\ne' } })] });
    const step = screen.getByText(/The exact step/).closest('details')!;
    expect(step).not.toHaveAttribute('open');
    expect(step).toHaveTextContent('5 lines');
  });
});

// Words typed in the gate card's boxes: kept per key, through a refresh, and moved to the message
// box when the brief goes (moved from the old job page's tests).
describe('words typed in the card’s boxes', () => {
  const MODES = [['the laptop app', false], ['the website', true]] as const;
  /** A job that waits for him at the plan, with Auto on. */
  const AUTO_ON = job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', level: 1, waitingFor: 'approval', auto: { on: true, by: 'you', ran: true } });
  const bar = () => screen.getByRole('region', { name: 'Next step' });
  const changesBox = () => screen.findByRole('textbox', { name: /What should change\?/ });
  async function sendBackWith(words: string) {
    const back = await screen.findByRole('button', { name: /^No go: send back/ });
    await waitFor(() => expect(back).toBeEnabled());
    fireEvent.click(back);
    fireEvent.change(await changesBox(), { target: { value: words } });
  }

  // Fix round 1, item 10 (browser fault 5). No user-event here (it is not a dependency of web/), so
  // each key is one input event straight after the last, with no await between them.
  it.each(MODES)('typing with no gap between keys loses nothing (%s)', async (_where, hosted) => {
    const SENTENCE = 'Ask the office about closed tickets and the export.';
    setup({ jobs: waiting(), gate: GATE, hosted });
    for (const [call, name] of [[/^No go: send back/, /What should change\?/], ['Reply', /Your answers or a note/]] as const) {
      const open = await screen.findByRole('button', { name: call });
      await waitFor(() => expect(open).toBeEnabled());
      fireEvent.click(open);
      const box = await screen.findByRole('textbox', { name });
      for (let i = 1; i <= SENTENCE.length; i++) fireEvent.change(box, { target: { value: SENTENCE.slice(0, i) } });
      expect(screen.getByRole('textbox', { name })).toBe(box);
      expect(box).toHaveValue(SENTENCE);
      expect(localStorage.getItem('fw.gateBox.alpha')).toContain(SENTENCE);
      await act(async () => {});
      expect(box).toHaveValue(SENTENCE);
    }
    // Each box kept its own words.
    const kept = JSON.parse(localStorage.getItem('fw.gateBox.alpha')!) as { notes: { changes: string; message: string } };
    expect(kept.notes).toEqual({ changes: SENTENCE, message: SENTENCE });
  });

  it.each(MODES)('words typed in What should change? survive a refresh (%s)', async (_where, hosted) => {
    setup({ jobs: waiting(), gate: GATE, hosted });
    await sendBackWith('Use the small table.');
    cleanup();
    setup({ jobs: waiting(), gate: GATE, hosted });
    expect(await changesBox()).toHaveValue('Use the small table.');
    // Restored, it does not take the focus from the page.
    expect(await changesBox()).not.toHaveFocus();
  });

  it.each(MODES)('when Auto answers while he types, his words move to the message box and the bar says so (%s)', async (_where, hosted) => {
    const { store } = setup({ jobs: [AUTO_ON], gate: GATE, hosted, auto: { on: true, tag: null } });
    fireEvent.change(messageBox(), { target: { value: 'Earlier words.' } });
    await sendBackWith('Use the small table.');
    // Auto approves brief 2: the job is fetched again with the brief answered.
    server.answered = [2];
    server.thread = [{ id: 'you-auto', kind: 'you', at: NOW, text: 'Approved.', sendKind: 'approve', gateBrief: 2, by: 'auto' } as ThreadItem];
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(messageBox()).toHaveValue('Earlier words.\n\nUse the small table.'));
    const said = screen.getByText('Brief 2 was answered while you were writing. Your words are in the message box.');
    expect(said).toBeVisible();
    expect(screen.queryByRole('textbox', { name: /What should change\?/ })).toBeNull();
    // Once: a refresh does not move them again, and the line goes once he writes.
    fireEvent.change(messageBox(), { target: { value: 'Earlier words.\n\nUse the small table. And the icon.' } });
    await waitFor(() => expect(screen.queryByText(/was answered while you were writing/)).toBeNull());
    cleanup();
    setup({ jobs: [AUTO_ON], gate: GATE, hosted, auto: { on: true, tag: null } });
    server.answered = [2];
    await act(async () => {});
    expect(messageBox()).toHaveValue('Earlier words.\n\nUse the small table. And the icon.');
  });

  it.each(MODES)('the line about words moved to the message box goes when he dismisses it (%s)', async (_where, hosted) => {
    const { store } = setup({ jobs: waiting(), gate: GATE, hosted });
    await sendBackWith('Use the small table.');
    // A new brief replaces the card.
    server.gate = { ...GATE, briefNumber: 3, headline: 'Plan v3 ready' };
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(messageBox()).toHaveValue('Use the small table.'));
    expect(screen.getByText('Brief 2 was answered while you were writing. Your words are in the message box.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText(/was answered while you were writing/)).toBeNull();
  });

  // Fix round 1, M4: a gate with no brief number whose words change keeps the same card mounted.
  it.each(MODES)('a gate with no brief number whose words change: the moved words leave the card’s box too (%s)', async (_where, hosted) => {
    const NO_NUMBER = { ...GATE, briefNumber: null };
    const { store } = setup({ jobs: waiting(), gate: NO_NUMBER, hosted });
    await sendBackWith('Use the small table.');
    server.gate = { ...NO_NUMBER, headline: 'Plan v3 ready', nextProposed: 'Build step 2' };
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(messageBox()).toHaveValue('Use the small table.'));
    await waitFor(() => expect(bar()).toHaveTextContent('Plan v3 ready'));
    // The card for the new words: its box is closed, and opening it shows no old words.
    expect(screen.queryByRole('textbox', { name: /What should change\?/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^No go: send back/ }));
    expect(await changesBox()).toHaveValue('');
    await act(async () => {});
    expect(messageBox()).toHaveValue('Use the small table.');
  });

  it.each(MODES)('sent or cancelled words are not restored (%s)', async (_where, hosted) => {
    // Cancelled.
    setup({ jobs: waiting(), gate: GATE, hosted });
    await sendBackWith('Use the small table.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    cleanup();
    setup({ jobs: waiting(), gate: GATE, hosted });
    await screen.findByRole('button', { name: /^Go: approve/ });
    await act(async () => {});
    expect(screen.queryByRole('textbox', { name: /What should change\?/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^No go: send back/ }));
    expect(await changesBox()).toHaveValue('');
    cleanup();
    localStorage.clear();
    clearAllSent();
    clearGateSent();
    // Sent (a Reply: the brief stays open, so the card is drawn again).
    const post = vi.fn(async (p: string): Promise<unknown> => (p === '/api/job/alpha/gate' ? { ok: true, sent: true, text: 'sent' } : { ok: true }));
    setup({ jobs: waiting(), gate: GATE, hosted, post });
    await screen.findByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'What does the old column feed?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'message' })));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /Your answers or a note/ })).toBeNull());
    cleanup();
    clearAllSent();
    clearGateSent();
    setup({ jobs: waiting(), gate: GATE, hosted });
    await screen.findByRole('button', { name: /^Go: approve/ });
    await act(async () => {});
    expect(screen.queryByRole('textbox', { name: /Your answers or a note/ })).toBeNull();
    expect(messageBox()).toHaveValue('');
  });
});
