// The Job page (packet M): the seven stops linking to their Stages (faces in Play full), the one next
// step (the go / no go bar that presses the gate card's buttons, the permission alert in its place,
// or what is happening in words), the tabs opened at the current stop, documents opening where you
// are, Try it under Tests, the walkthrough under Review, the folded conversation and the message box.
// Invented jobs, documents and requests only; no model calls.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import type { Gate, JobDoc, JobDocEntry, JobDetail, Permission } from '../api/types';
import { installKeyListener } from '../app/keyRegistry';
import { UiProvider, useUi } from '../app/ui';
import { ServerHtml } from '../panes/Foreman/ServerHtml';
import { createStore, WorkshopContext, type Store } from '../state/store';
import { job, permission, snapshot } from '../state/test-fixtures';
import { JobPage, tabForStop } from './JobPage';

const NOW = new Date().toISOString();
const DOCS: JobDocEntry[] = [
  { file: 'spec', name: 'Product spec', group: 'plan', version: '0.3', updatedAt: NOW, size: 900, type: 'md' },
  { file: 'implementation-plan.md', name: 'Implementation plan', group: 'plan', version: '2', updatedAt: NOW, size: 2048, type: 'md' },
  { file: 'briefs/002-plan.md', name: 'Brief #2 · plan', group: 'briefs', version: null, updatedAt: NOW, size: 300, type: 'md' },
  { file: 'review.md', name: 'Review (combined)', group: 'review', version: null, updatedAt: NOW, size: 400, type: 'md' },
  { file: 'test-report.md', name: 'Test report', group: 'review', version: null, updatedAt: NOW, size: 400, type: 'md' },
];
const LINKED: JobDoc = {
  file: 'implementation-plan.md', name: 'Implementation plan', type: 'md', updatedAt: NOW, size: 2048, text: 'plan',
  html: '<h1 id="h-plan">Plan</h1><p><a href="#s1">Jump to S1</a> · <a href="review.md">The review</a> · <a href="other.md">Not a doc</a></p><h2 id="h-s1">S1</h2><p>Step one.</p>',
};
const docOf = (file: string): JobDoc => (file === 'implementation-plan.md' ? LINKED : { file, name: file, type: 'md', html: `<p>${file} body</p>`, text: file, updatedAt: NOW, size: 10 });

const GATE: Gate = {
  briefNumber: 2, briefFile: 'briefs/002-plan.md', headline: 'Plan v2 ready', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
  questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: '2026-10-21T09:00:00Z', runActive: false, parked: false,
  level: 1, suggestedLevel: null, levelReason: null, usage: null,
};

function setup({ jobs = [job('alpha', 'idle', { stage: 'plan' })], permissions = [] as Permission[], play = 'subtle', gate = null as Gate | null, slug = 'alpha', extra = null as React.ReactNode, post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true })) } = {}) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, permissions, meta: { token: 't', settings: { play: { mode: play } } } as never }) });
  const detail = (s: string): JobDetail => ({ slug: s, thread: [], threadMore: false, gate, answeredBriefs: [], heldReply: null, options: { level: 1 } } as JobDetail);
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path.endsWith('/docs')) return { docs: DOCS };
    const m = /\/doc\?file=(.+)$/.exec(path);
    if (m) return docOf(decodeURIComponent(m[1]));
    if (path.endsWith('/commits')) return { commits: [{ sha: 'a'.repeat(40), short: 'aaaaaaa', author: 'Ann', date: NOW, subject: 'Step 1: the form', step: '1' }] };
    if (/\/commit\//.test(path)) return { files: [{ path: 'app.js', added: 1, removed: 1 }], patchFiles: [{ path: 'app.js', lines: ['@@ -1 +1 @@', '-old', '+new'] }], truncated: false };
    if (path.endsWith('/decisions')) return { decisions: [] };
    if (path.endsWith('/evidence')) return { runs: [] };
    if (path.endsWith('/local')) return null;
    return detail(path.split('/')[3]);
  });
  const api = { get, post } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><UiProvider>{extra}<JobPage slug={slug} /></UiProvider></WorkshopContext.Provider>);
  return { ...utils, get, post, store };
}

let off = () => {};
beforeEach(() => { off = installKeyListener(); });
afterEach(() => { off(); cleanup(); localStorage.clear(); window.location.hash = ''; });

describe('the Job page', () => {
  it('names the job, maps its seven stops, each a link to its Stage', () => {
    setup();
    const page = screen.getByRole('main', { name: 'Job' });
    expect(within(page).getByRole('heading', { name: 'Job alpha' })).toBeInTheDocument();
    const map = within(page).getByRole('region', { name: 'The job’s stops' });
    const links = within(map).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship'].map((s) => `#/job/alpha/stage/${s}`));
    expect(map.querySelector('.stop-face')).toBeNull();
    expect(within(page).getByRole('button', { name: 'Job menu' })).toBeInTheDocument();
  });

  it('Play full puts the crew member’s face on each stop', () => {
    setup({ play: 'full' });
    expect(document.querySelectorAll('.job-map .stop-face')).toHaveLength(7);
    expect(document.querySelector('.job-map')).toHaveClass('has-grid');
  });

  it('a job that isn’t there says so', () => {
    setup({ slug: 'nobody' });
    expect(screen.getByText(/There’s no job called “nobody”/)).toBeInTheDocument();
  });

  it('with nothing waiting, says what is happening in words, with the stop’s call greyed', () => {
    setup({ jobs: [job('alpha', 'running', { stage: 'implement', lane: 'working', nowDoing: [{ who: 'feature-implementer', doing: 'Writing the form' }] })] });
    const bar = screen.getByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Nothing to do right now');
    expect(bar).toHaveTextContent('Writing the form');
    expect(within(bar).getByRole('button', { name: 'Approve the tests' })).toBeDisabled();
  });

  it('a question from the Foreman: Reply puts the cursor in the message box', () => {
    setup({ jobs: [job('alpha', 'needs-you', { stage: 'spec', lane: 'needs-you', headline: 'Which login page?' })] });
    const bar = screen.getByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('The Foreman asked you something');
    expect(bar).toHaveTextContent('Which login page?');
    fireEvent.click(within(bar).getByRole('button', { name: /^Reply/ }));
    expect(screen.getByRole('textbox', { name: /Your message to the Foreman/ })).toHaveFocus();
  });
});

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
  /** A POST to the gate that answers only when told to. */
  function held() {
    let answer: (v: unknown) => void = () => {};
    const post = vi.fn((path: string, _body?: unknown): Promise<unknown> => (path.endsWith('/gate') ? new Promise((res) => { answer = res; }) : Promise.resolve({ ok: true })));
    return { post, answer: (v: unknown = { ok: true, sent: true, text: 'sent' }) => act(async () => { answer(v); }) };
  }
  const sentPost = () => vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true, sent: true, text: 'sent' }));
  const gatePosts = (post: ReturnType<typeof vi.fn>) => post.mock.calls.filter(([p]) => p === '/api/job/alpha/gate');
  const bar = () => screen.getByRole('region', { name: 'Next step' });
  /** The page's one live region for a decision on its way (always there, empty when idle). */
  const live = () => document.querySelector('[data-next-live]')!;
  /** No go: send back, a note, then the card's Send the changes. */
  async function sendBack(note = 'Use the small table.') {
    fireEvent.click(await screen.findByRole('button', { name: /^No go: send back/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: /What should change\?/ }), { target: { value: note } });
    return screen.getByRole('button', { name: 'Send the changes' });
  }

  afterEach(() => { vi.useRealTimers(); });

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

  it('a press while sent sends nothing', async () => {
    const post = sentPost();
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    const go = screen.getByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeDisabled());
    expect(go).toHaveAccessibleName(/^Go: approve/);
    expect(screen.getByRole('button', { name: /^No go: send back/ })).toBeDisabled();
    fireEvent.click(go);
    fireEvent.keyDown(document.body, { key: 'a' });
    await act(async () => {});
    expect(gatePosts(post)).toHaveLength(1);
  });

  it('after the server accepts, the bar says "Sent. Waiting for the Foreman to start."', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    expect(await within(bar()).findByText(SENT_LINE)).toBeInTheDocument();
    expect(live()).toHaveTextContent(SENT_LINE);
    expect(screen.getByRole('button', { name: /^Go: approve/ })).not.toHaveAttribute('aria-busy');
  });

  it('after 30 seconds with no change it says "Nothing has moved yet." and offers Try again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
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

  it('Try again sends the same decision once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = sentPost();
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

  it('while Try again is out, Go and Send back are off', async () => {
    const { post, answer } = sentThenHeld();
    await stuckThenTryAgain(post);
    const go = screen.getByRole('button', { name: /^Go: approve/ });
    const back = screen.getByRole('button', { name: /^No go: send back/ });
    await waitFor(() => expect(go).toBeDisabled());
    expect(back).toBeDisabled();
    fireEvent.click(go);
    fireEvent.click(back);
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(gatePosts(post)).toHaveLength(2);
    expect(screen.queryByText(/What should change\?/)).toBeNull();
    await answer();
  });

  it('when the job moves on, the bar clears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: waiting({ stage: 'implement', waitingFor: null, lane: 'working' }), meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) }); });
    await waitFor(() => expect(within(bar()).queryByText(SENT_LINE)).toBeNull());
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(within(bar()).queryByText('Nothing has moved yet.')).toBeNull();
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

  it('after the server accepts a send back, the bar says "Sent. Waiting for the Foreman to start."', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    fireEvent.click(await sendBack());
    expect(await within(bar()).findByText(SENT_LINE)).toBeInTheDocument();
    expect(live()).toHaveTextContent(SENT_LINE);
  });

  it('after 30 seconds with no change to a send back it says "Nothing has moved yet."; Try again sends the same send back once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = sentPost();
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
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    fireEvent.click(await sendBack());
    await within(bar()).findByText(SENT_LINE);
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: waiting({ waitingFor: null, lane: 'working' }), meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) }); });
    await waitFor(() => expect(within(bar()).queryByText(SENT_LINE)).toBeNull());
  });

  it('once the brief is answered and the gate goes, the bar without a gate still says it was sent', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    // The same job, its page drawn again without its gate (the Foreman's status no longer waits on it).
    cleanup();
    setup({ jobs: waiting(), gate: null, post: sentPost() });
    expect(within(bar()).getByText(SENT_LINE)).toBeInTheDocument();
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

describe('the tabs', () => {
  it('opens at the current stop; a stop not reached yet is greyed; arrow keys move between tabs', async () => {
    setup({ jobs: [job('alpha', 'idle', { stage: 'plan' })] });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Brief', 'Spec', 'Plan', 'Code', 'Tests', 'Review', 'Decisions', 'Ship']);
    const plan = screen.getByRole('tab', { name: 'Plan' });
    expect(plan).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Code' })).toHaveClass('is-later');
    expect(screen.getByRole('tab', { name: 'Spec' })).not.toHaveClass('is-later');
    // The Plan tab lists the plan, not the spec (that's the Spec tab's).
    expect(await screen.findByRole('button', { name: /^Implementation plan/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Product spec/ })).toBeNull();
    fireEvent.keyDown(plan, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Code' })).toHaveFocus();
    expect(await screen.findByRole('button', { name: /Step 1: the form/ })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Code' }), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Plan' }), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Spec' }), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Brief' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Ship' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Nothing to ship yet');
  });

  it('tabForStop: each stop opens its kind of work', () => {
    expect(['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship', null].map((s) => tabForStop(s as never))).toEqual(['spec', 'plan', 'plan', 'code', 'tests', 'review', 'ship', 'brief']);
  });

  it('the Code tab shows a commit’s change with its + and − kept', async () => {
    setup({ jobs: [job('alpha', 'running', { stage: 'implement' })] });
    fireEvent.click(await screen.findByRole('button', { name: /Step 1: the form/ }));
    expect(await screen.findByText('app.js')).toBeInTheDocument();
    expect(screen.getByText('+new')).toHaveClass('is-add');
    expect(screen.getByText('-old')).toHaveClass('is-del');
  });

  it('a link in a document to another document opens it here; a #section link scrolls', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /^Implementation plan/ }));
    const reader = await screen.findByRole('article', { name: 'Implementation plan' });
    const jump = await within(reader).findByRole('link', { name: 'Jump to S1' });
    fireEvent.click(jump);
    expect(within(reader).getByRole('heading', { name: 'S1' })).toHaveFocus();
    fireEvent.click(within(reader).getByRole('link', { name: 'Not a doc' }));
    expect(await screen.findByText(/The link points to other\.md, which isn’t one of this job’s documents/)).toBeInTheDocument();
    fireEvent.click(within(reader).getByRole('link', { name: 'The review' }));
    expect(await screen.findByText('review.md body')).toBeInTheDocument();
  });

  it('a link to a document in a reply opens it in the Plan tab, from the Code tab too', async () => {
    setup({ jobs: [job('alpha', 'running', { stage: 'implement' })], extra: <ServerHtml html={'<p><a href="./notes.md">notes</a></p>'} /> });
    expect(screen.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByRole('button', { name: /Step 1: the form/ });
    fireEvent.click(screen.getByRole('link', { name: 'notes' }));
    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(/notes\.md, which isn’t one of this job’s documents/)).toBeInTheDocument();
  });

  it('⌘K Open docs from the Decisions tab: the Plan tab, focus on its first document', async () => {
    function Opener() { const ui = useUi(); return <button type="button" onClick={() => ui.openDocs()}>open docs</button>; }
    setup({ extra: <Opener /> });
    fireEvent.click(screen.getByRole('tab', { name: 'Decisions' }));
    fireEvent.click(screen.getByRole('button', { name: 'open docs' }));
    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Implementation plan/ })).toHaveFocus());
  });

  it('Try it on your computer: under Tests, opened by the job menu', async () => {
    function Try() { const ui = useUi(); return <button type="button" onClick={() => ui.openTry('alpha')}>try</button>; }
    setup({ extra: <Try /> });
    fireEvent.click(screen.getByRole('button', { name: 'try' }));
    expect(screen.getByRole('tab', { name: 'Tests' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Try it on your computer').closest('details')).toHaveAttribute('open');
  });

  it('the review walkthrough folds under Review, only when there is one', () => {
    const walk = { updatedAt: NOW, size: 10, url: null };
    setup({ jobs: [job('alpha', 'idle', { stage: 'review', walkthrough: walk })] });
    expect(document.querySelector('.fold-name')?.textContent).toBe('Review walkthrough');
    expect(document.querySelector('.fold')).not.toHaveAttribute('open');
    cleanup();
    setup({ jobs: [job('alpha', 'idle', { stage: 'review' })] });
    expect(screen.queryByText('Review walkthrough')).toBeNull();
  });

  it('a job with screens: the Spec tab links to them; the wireframes page in a list opens the Screens page', async () => {
    setup({ jobs: [job('alpha', 'idle', { stage: 'spec', wireframes: { version: '2' } })] });
    expect(screen.getByRole('tab', { name: 'Spec' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('link', { name: /Review the screens/ })).toHaveAttribute('href', '#/job/alpha/screens');
    expect(await screen.findByRole('button', { name: /^Product spec/ })).toBeInTheDocument();
  });
});

describe('the conversation', () => {
  it('folds the conversation and keeps the message box at the bottom', async () => {
    setup();
    const fold = screen.getByText('Conversation').closest('details')!;
    expect(fold).not.toHaveAttribute('open');
    const box = screen.getByRole('textbox', { name: /Your message to the Foreman/ });
    const all = [...document.querySelectorAll('.page-job .fold, .page-job textarea')];
    expect(all.indexOf(box)).toBeGreaterThan(all.indexOf(fold));
    await act(async () => {});
  });
});
