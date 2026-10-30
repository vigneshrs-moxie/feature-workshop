// Review rounds on the page (packet Q), against the approved wireframe: the Ship stop's bar and
// panel in each state (changes asked for, the Foreman fixing, ready to send back, sending, stopped,
// waiting, a failed check, a new comment, approved, merge asks, remind, no reviewer, closed, held
// in a terminal), Play full / subtle / off, the keys (a never merges; nothing fires while typing),
// the Desk card, the Jobs card's line, the GitHub line (Check now, Checking…, the failure words)
// and Settings → Workflow. A fake dashboard answers; nothing is sent anywhere, no model is called.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { FlowView, Job, Permission, ReviewList, ReviewView } from '../../api/types';
import { installKeyListener } from '../../app/keyRegistry';
import { UiProvider, useUi } from '../../app/ui';
import { setGuideFirstVisit } from '../../components/page/Page';
import { DeskView } from '../../home/DeskView';
import { deskQueue } from '../../home/homeModel';
import { JobsPage } from '../../home/JobsPage';
import { JobPage } from '../../job/JobPage';
import { createStore, WorkshopContext } from '../../state/store';
import { snapshot } from '../../state/test-fixtures';
import { WorkflowSettings } from '../Settings/WorkflowSettings';
import { GithubLine } from './GithubLine';
import { ReviewBar } from './ReviewBar';
import { ReviewPanel } from './ReviewPanel';
import { AT, flow, held, PR_URL, view } from './test-fixtures';
import { useReview } from './useReview';
import { pickOption } from '../../components/Select.testing';

const SLUG = 'feedback-api';
const JOB: Job = { slug: SLUG, title: 'Feedback API', group: 'needs-you', lane: 'needs-you', stage: 'pr2', permissions: 1 } as Job;

interface Setup { v?: ReviewView | null; after?: ReviewView | null; play?: 'full' | 'subtle' | 'off'; permissions?: Permission[]; jobs?: Job[]; f?: FlowView | null; list?: Partial<ReviewList>; settings?: Record<string, unknown>; fail?: string }

function setup(ui: ReactNode, { v = null, after = null, play = 'subtle', permissions = [], jobs = [JOB], f = flow(), list = {}, settings = {}, fail }: Setup = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, permissions, meta: { token: 't', settings: { policy: 'auto', play: { mode: play }, ...settings } } as never }) });
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path === `/api/review/${SLUG}`) return v ? { ...v, github: f?.github ?? null } : { slug: SLUG, state: null };
    if (path === '/api/review') return { jobs: v ? [v] : [], settings: { githubEveryMin: 1, mergeFollowUp: true }, github: null, ...list };
    if (path === '/api/flow') return f;
    if (path === `/api/job/${SLUG}`) return { slug: SLUG, thread: [], threadMore: false, gate: null, answeredBriefs: [], heldReply: null, options: { level: 1 } };
    if (path.endsWith('/docs')) return { docs: [] };
    if (path.endsWith('/decisions')) return { decisions: [] };
    return {};
  });
  const post = vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
    void body;
    if (fail) throw new Error(fail);
    if (path === '/api/flow/refresh') return { ...f, refreshing: true, github: { ...f!.github, checking: true } };
    if (path.startsWith('/api/permissions/')) return { ok: true };
    if (path === '/api/review/settings') return { settings: { githubEveryMin: 5, mergeFollowUp: true } };
    return { ...(after ?? v), github: null };
  });
  const api = { get, post } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><UiProvider>{ui}</UiProvider></WorkshopContext.Provider>);
  return { ...utils, get, post, store };
}

/** Which app sheet is open (the App draws it; here it is only named). */
function SheetProbe() {
  const { sheet } = useUi();
  return <p data-testid="sheet">{sheet ? `${sheet.kind} ${'slug' in sheet ? sheet.slug : ''}` : 'none'}</p>;
}

/** The Ship stop's next step and panel, as the Job page and the Ship Stage draw them. */
function Ship({ line = false }: { line?: boolean }) {
  const r = useReview(SLUG);
  return <>{r.view && <ReviewBar view={r.view} act={r.act} problem={r.problem} />}<ReviewPanel slug={SLUG} line={line} /></>;
}

const posted = (post: ReturnType<typeof vi.fn>) => post.mock.calls.map(([p, b]) => [p, b]);
const key = (k: string, target: EventTarget = document.body) => act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });

let off = () => {};
beforeEach(() => { off = installKeyListener(); });
afterEach(() => { off(); localStorage.clear(); window.location.hash = ''; });

describe('the Ship stop: changes asked for', () => {
  it('one bar with the one yes, and the round grouped by file with each kind, words, file:line and state in words', async () => {
    const { post } = setup(<Ship />, { v: view('asked'), play: 'subtle' });
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Raj asked for changes on PR #2 · 4 comments, 1 question');
    expect(bar).toHaveTextContent('And lint failed on the same commit. Untick anything to leave out, add a note if you like, then say go.');
    expect(within(bar).getByText('Go / no go')).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /Open the round/ })).toBeNull();
    const panel = screen.getByRole('region', { name: 'Round 1 · PR #2' });
    expect(within(panel).getByRole('heading', { name: 'Round 1 · PR #2' })).toBeInTheDocument();
    expect(panel).toHaveTextContent('5 of 5 included');
    expect(within(panel).getAllByRole('region').map((g) => g.getAttribute('aria-label'))).toEqual(['web/src/feedback/FeedbackForm.tsx', 'api/src/feedback/feedback.controller.ts', 'Checks on the same commit']);
    expect(panel).toHaveTextContent('FeedbackForm.tsx:42 · Raj · ');
    expect(panel).toHaveTextContent('the lint check');
    expect(panel).toHaveTextContent("'feedbackId' is not defined");
    expect(within(panel).getAllByText('To do')).toHaveLength(5);
    expect(within(panel).getAllByRole('link', { name: 'On GitHub ↗' })[0]).toHaveAttribute('href', `${PR_URL}#discussion_rc7001`);
    // a: Fix with the Foreman, with nothing else in the body (the note is saved on its own).
    fireEvent.click(within(bar).getByRole('button', { name: /fix with the Foreman/i }));
    await waitFor(() => expect(posted(post)).toEqual([[`/api/review/${SLUG}/fix`, {}]]));
  });

  it('Play full and subtle say Go / No go; Play off says Waiting for you with the plain words', async () => {
    setup(<Ship />, { v: view('asked'), play: 'full' });
    let bar = await screen.findByRole('region', { name: 'Next step' });
    expect(within(bar).getByRole('button', { name: 'Go: fix with the Foreman' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'No go: leave it for now' })).toBeInTheDocument();
    document.body.innerHTML = '';
    setup(<Ship />, { v: view('asked'), play: 'off' });
    bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Waiting for you');
    expect(within(bar).getByRole('button', { name: 'Fix with the Foreman' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Leave it for now' })).toBeInTheDocument();
  });

  it('untick to leave one out, pick another kind, and a note for the Foreman, saved as you leave the box', async () => {
    const { post } = setup(<Ship />, { v: view('asked') });
    const box = await screen.findByRole('checkbox', { name: /Included: Nit: `fbId`/ });
    fireEvent.click(box);
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/item`, { id: 'c7002', included: false }));
    pickOption(screen.getByRole('combobox', { name: /Kind of “Why 2,000 characters/ }), 'change');
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/item`, { id: 'c7004', kind: 'change' }));
    expect(screen.queryByRole('combobox', { name: /Kind of “lint/ })).toBeNull();
    const note = screen.getByRole('textbox', { name: 'A note for the Foreman (optional)' });
    fireEvent.change(note, { target: { value: 'Keep the old name as an alias.' } });
    // Keys never fire while you type: a in the box is a letter, not Go.
    key('a', note);
    expect(post).not.toHaveBeenCalledWith(`/api/review/${SLUG}/fix`, expect.anything());
    fireEvent.blur(note);
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/note`, { note: 'Keep the old name as an alias.' }));
  });

  it('the keys: a is the go, r the no go', async () => {
    const { post } = setup(<Ship />, { v: view('asked') });
    await screen.findByRole('region', { name: 'Next step' });
    key('r');
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/leave`, {}));
    key('a');
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/fix`, {}));
  });

  it('the first round ever opens the three pictures, once', async () => {
    setGuideFirstVisit(true);
    setup(<Ship />, { v: view('asked') });
    const guide = await screen.findByRole('dialog', { name: 'How review rounds work' });
    expect(guide).toHaveTextContent('A round is one review');
    expect(guide).toHaveTextContent('One yes fixes it');
    expect(guide).toHaveTextContent('One go sends it back');
    fireEvent.click(within(guide).getByRole('button', { name: 'Show me the round' }));
    expect(JSON.parse(localStorage.getItem('gc.guide.seen') ?? '[]')).toContain('review-round');
    fireEvent.click(screen.getByRole('button', { name: /How review rounds work/ }));
    expect(screen.getByRole('dialog', { name: 'How review rounds work' })).toBeInTheDocument();
  });
});

describe('on the Job page', () => {
  it('the round’s card is answered in the bar, not as a permission alert; the Ship tab holds the panel and the GitHub line', async () => {
    const p = { id: 'round-1', slug: SLUG, kind: 'question', roundCard: true, plain: { headline: 'Raj asked for changes on PR #2 · 4 comments, 1 question' } } as Permission;
    setup(<JobPage slug={SLUG} />, { v: view('asked'), permissions: [p] });
    const bar = await screen.findByText('Raj asked for changes on PR #2 · 4 comments, 1 question', { selector: '.next-head' });
    expect(bar.closest('.review-bar')).not.toBeNull();
    expect(document.querySelector('.perm-alert, [data-ask="permission"]')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Ship' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('region', { name: 'Round 1 · PR #2' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'GitHub' })).toHaveTextContent('GitHub checked 3 min ago');
    expect(screen.getByText('Review', { selector: '.state-chip' })).toBeInTheDocument();
  });
});

describe('the Foreman fixes it', () => {
  it('Send back waits, greyed, with the reason; the items tick over in words; the console line shows in Play full and subtle only', async () => {
    const v = view('fixing');
    v.round!.groups[0].items[0] = { ...v.round!.groups[0].items[0], state: 'fixed', stateWords: 'Fixed in 3f9c2e1', plan: 'fix', planText: 'turn Send off while it posts.' };
    v.round!.groups[0].items[1] = { ...v.round!.groups[0].items[1], state: 'working', stateWords: 'Working on it', plan: 'fix', planText: 'rename it.' };
    setup(<Ship />, { v, play: 'full' });
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(within(bar).getByRole('button', { name: /send back to Raj/ })).toBeDisabled();
    expect(screen.getByText('The Foreman is still on it.')).toBeInTheDocument();
    expect(screen.getByText('Fixed in 3f9c2e1')).toBeInTheDocument();
    expect(screen.getByText('Working on it').closest('li')).toHaveClass('is-working');
    expect(screen.getByText(/turn Send off while it posts/).closest('p')).toHaveTextContent('Done Fix: turn Send off while it posts.');
    expect(screen.getByText(/rename it\./).closest('p')).toHaveTextContent('Plan Fix: rename it.');
    expect(document.querySelector('.review-console')).toHaveTextContent('Now: the access check');
    expect(screen.getByRole('meter', { name: 'How far along' })).toHaveAttribute('aria-valuetext', '2 of 5 done · 2 commits so far');
    expect(screen.queryByRole('checkbox')).toBeNull();
    document.body.innerHTML = '';
    setup(<Ship />, { v, play: 'off' });
    await screen.findByRole('region', { name: 'Next step' });
    expect(document.querySelector('.review-console')).toBeNull();
  });

  it('a comment that joined while it works waits under New, marked, with Add it to the Foreman’s list (a)', async () => {
    const v = view('new-comment');
    v.round!.pending = [{ ...v.round!.groups[0].items[0], id: 'c7009', quote: 'One more: the empty list should say “No feedback yet”.', late: true, newWords: 'New · joined round 1' }];
    const { post } = setup(<Ship />, { v });
    expect(await screen.findByRole('region', { name: 'New while the Foreman works' })).toHaveTextContent('New · joined round 1');
    key('a');
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/add-new`, {}));
  });
});

describe('ready to send back', () => {
  it('every step listed first, in order, with the exact step under it; one go sends it all, with the follow-up choice', async () => {
    const { post } = setup(<Ship />, { v: view('ready'), after: view('sending') });
    const send = await screen.findByRole('region', { name: 'What Send back to Raj will do, in this order' });
    const rows = within(send).getAllByRole('listitem').filter((li) => li.classList.contains('review-step-row'));
    expect(rows.map((r) => r.querySelector('.review-step-words')?.textContent)).toEqual([
      'Push 4 commits to your fork', expect.stringContaining('open the follow-up PR #1'), 'Reply on GitHub to each of Raj’s 3 comments', 'Mark the 2 fixed comments resolved', 'Ask Raj to review PR #2 again',
    ]);
    expect(rows[0]).toHaveTextContent('git push origin feature/sample-job · never forced');
    expect(rows.every((r) => /Will do/.test(r.textContent ?? ''))).toBe(true);
    expect(screen.getByText('Nothing is written to GitHub before your go, and nothing is ever force-pushed.')).toBeInTheDocument();
    // One reply per comment, the check gets none.
    expect(within(rows[2]).getAllByRole('listitem')).toHaveLength(3);
    expect(rows[2]).not.toHaveTextContent('the lint check');
    // The round folds under it.
    expect(screen.getByText('Round 1 · PR #2', { selector: '.fold-name' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /send back to Raj/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/send`, { go: true, mergeFollowUp: true }));
    expect(await screen.findByText('Sending round 1 back: step 3 of 5')).toBeInTheDocument();
  });

  it('a reply: Edit opens it in place (Save with Enter), Drop strikes it through with Put it back', async () => {
    const { post } = setup(<Ship />, { v: view('ready') });
    const reply = (await screen.findByText(/Send is off while the request is in flight\./, { selector: '.review-reply-text, .review-reply-text *' })).closest('li')!;
    fireEvent.click(within(reply).getByRole('button', { name: /Edit/ }));
    const box = within(reply).getByRole('textbox');
    // Keys don't fire while you type in the reply.
    key('a', box);
    expect(post).not.toHaveBeenCalledWith(`/api/review/${SLUG}/send`, expect.anything());
    fireEvent.change(box, { target: { value: 'Fixed in 3f9c2e1: Send is off while it posts.' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/item`, { id: 'c7001', reply: 'Fixed in 3f9c2e1: Send is off while it posts.' }));
    fireEvent.click(within(reply).getByRole('button', { name: /Drop/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/item`, { id: 'c7001', replyDropped: true }));
  });

  it('a dropped reply is struck through, with Put it back', async () => {
    const v = view('ready');
    v.round!.groups[0].items[0] = { ...v.round!.groups[0].items[0], replyDropped: true, replyState: 'Dropped' };
    const { post } = setup(<Ship />, { v });
    const put = await screen.findByRole('button', { name: 'Put it back' });
    expect(put.closest('li')).toHaveClass('is-dropped');
    expect(put.closest('li')!.querySelector('s')).not.toBeNull();
    fireEvent.click(put);
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/item`, { id: 'c7001', replyDropped: false }));
  });

  it('“I’ll merge PR #1 myself” switches the follow-up off (remembered as the setting)', async () => {
    const { post } = setup(<Ship />, { v: view('ready') });
    fireEvent.click(await screen.findByRole('button', { name: 'I’ll merge PR #1 myself' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/review/settings', { mergeFollowUp: false }));
    expect(screen.getByRole('switch', { name: 'This go also merges PR #1 once its checks pass' })).toBeChecked();
  });

  it('a refusal comes back in words under the bar', async () => {
    setup(<Ship />, { v: view('ready'), fail: 'This job is being driven from a terminal.' });
    fireEvent.click(await screen.findByRole('button', { name: /send back to Raj/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This job is being driven from a terminal.');
  });
});

describe('sending, and when a step stops', () => {
  it('sending: each step ticks over in words; Stop after this step has no key', async () => {
    const { post } = setup(<Ship />, { v: view('sending') });
    const send = await screen.findByRole('region', { name: 'Sending round 1 back' });
    expect([...send.querySelectorAll('.review-step-state')].map((s) => s.textContent?.trim())).toEqual(['Done', 'Done', 'Working', 'Will do', 'Will do']);
    expect(within(send).getAllByText('Not posted yet').length).toBeGreaterThan(0);
    key('a');
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop after this step' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/stop-after-step`, {}));
  });

  it('stopped at step 3: says which and why, the reply that didn’t post, nothing after it ran; Try again from here (a)', async () => {
    const v = view('stopped');
    v.round!.groups[0].items[0] = { ...v.round!.groups[0].items[0], replyState: 'Posted' };
    v.round!.groups[0].items[1] = { ...v.round!.groups[0].items[1], replyState: 'Didn’t post' };
    const { post } = setup(<Ship />, { v });
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Stopped at step 3: reply 2 of 3 didn’t post');
    expect(bar.closest('.review-bar')).toHaveClass('is-fail');
    expect(screen.getByRole('alert')).toHaveTextContent('reply 2 of 3 didn’t post GitHub said: “502 Bad Gateway”. Nothing after it ran.');
    expect(screen.getByText('Posted')).toBeInTheDocument();
    expect(screen.getByText('Didn’t post').closest('li')).toHaveClass('is-fail');
    expect([...document.querySelectorAll('.review-step-state')].map((s) => s.textContent?.trim()).slice(2)).toEqual(['Stopped here', 'Not run', 'Not run']);
    key('a');
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/retry`, { go: true }));
  });

  it('held in a terminal: the bar says where and since when; every button is off with the reason beside it', async () => {
    const { post } = setup(<Ship />, { v: held('ready') });
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('This job is being driven from a terminal');
    expect(bar).toHaveTextContent('pid 4182, branch feature/sample-job');
    expect(within(bar).getByRole('button', { name: /send back to Raj/i })).toBeDisabled();
    expect(screen.getByText('Send back is off until the terminal lets go.')).toBeInTheDocument();
    expect(screen.getByText('Underneath: Round 1 is ready to send back.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
    key('a');
    expect(post).not.toHaveBeenCalled();
  });
});

describe('waiting, and the unhappy paths', () => {
  it('waiting on Raj: nothing to do, Open PR #2 (p) is the one action; the round start to end; the GitHub line by the panel', async () => {
    setup(<Ship line />, { v: view('waiting') });
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Waiting on Raj to review PR #2 again');
    expect(within(bar).getByRole('link', { name: /Open PR #2/ })).toHaveAttribute('href', PR_URL);
    expect(within(bar).getByRole('link', { name: /Open PR #2/ })).toHaveClass('btn-primary');
    expect(screen.getByRole('region', { name: 'Round 1, start to end' })).toHaveTextContent('14:02 You said go: send back to Raj');
    expect(screen.getByRole('status', { name: 'GitHub' })).toHaveTextContent('GitHub checked 3 min ago');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    key('p');
    expect(open).toHaveBeenCalledWith(PR_URL, '_blank', 'noopener');
    open.mockRestore();
  });

  it('the panel opens on one status line in words, with the one plain next action', async () => {
    const { post } = setup(<Ship />, { v: view('asked') });
    await screen.findByRole('region', { name: 'Next step' });
    const status = document.querySelector('.review-status-line')!;
    expect(status).toHaveTextContent('Round 1·4 comments to answer·checks failing');
    const panel = screen.getByRole('region', { name: 'Round 1 · PR #2' });
    fireEvent.click(within(panel.querySelector('.review-status') as HTMLElement).getByRole('button', { name: 'Fix with the Foreman' }));
    await waitFor(() => expect(posted(post)).toEqual([[`/api/review/${SLUG}/fix`, {}]]));
  });

  it('a new round says so in its own space; answered comments fold under Answered (n)', async () => {
    const v = view('asked', {
      rounds: [
        { round: 1, pr: 2, prLabel: 'PR #2', state: 'sent', items: 4, openedAt: AT, sentAt: AT },
        { round: 2, pr: 2, prLabel: 'PR #2', state: 'asked', items: 5, openedAt: AT, sentAt: null },
      ],
    });
    v.round = { ...v.round!, round: 2, title: 'Round 2 · PR #2', groups: v.round!.groups.map((g, n) => (n === 0 ? { ...g, items: g.items.map((i, k) => (k === 0 ? { ...i, state: 'fixed' as const, stateWords: 'Fixed in 3f9c2e1' } : i)) } : g)) };
    setup(<Ship />, { v });
    const fresh = await screen.findByRole('group', { name: 'New round: round 2' });
    expect(fresh).toHaveTextContent('New round: 4 changes requested');
    expect(fresh).toHaveTextContent('Round 1 went back at');
    const answered = screen.getByRole('region', { name: 'Answered' });
    expect(answered).toHaveTextContent('Fixed in 3f9c2e1');
    expect(within(answered).getByRole('button', { name: /Answered/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('a check failed after the push: which check, its log, Fix with the Foreman (a) sends the go', async () => {
    const { post } = setup(<Ship />, { v: view('check-failed') });
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('lint failed on the push for round 1');
    expect(bar.closest('.review-bar')).toHaveClass('is-fail');
    // Its own space in the panel: which check, the first line of its log, and where the whole log is.
    const failed = screen.getByRole('group', { name: 'Checks failing' });
    expect(failed).toHaveTextContent('lint failed');
    expect(within(failed).getByText(/'feedbackId' is not defined/)).toBeInTheDocument();
    expect(within(failed).getByRole('link', { name: /The whole log/ })).toHaveAttribute('href', expect.stringContaining(PR_URL));
    key('a');
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/fix-checks`, { go: true }));
  });

  it('staging moved and conflicts: Bring in staging with the Foreman (a)', async () => {
    const { post } = setup(<Ship />, { v: view('conflicts') });
    expect(await screen.findByRole('region', { name: 'Next step' })).toHaveTextContent('PR #2 conflicts with staging in 2 files');
    const conflicts = screen.getByRole('group', { name: 'Conflicts' });
    expect(conflicts).toHaveTextContent('Conflicts with staging');
    expect(within(conflicts).getByRole('link', { name: /Open PR #2/ })).toHaveAttribute('href', PR_URL);
    expect(screen.getByText('conflicts with staging')).toBeInTheDocument(); // in the status line, as words
    key('a');
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/sync`, { go: true }));
  });

  it('approval reset by your push: says so in words, nothing to do', async () => {
    setup(<Ship />, { v: view('approval-reset') });
    expect(await screen.findByRole('region', { name: 'Next step' })).toHaveTextContent('Approval reset by your push: waiting on Raj again');
  });

  it('no one asked to review: the route’s reviewer filled in, changeable; Ask for a review sends it', async () => {
    const { post } = setup(<Ship />, { v: view('no-reviewer') });
    const who = await screen.findByRole('textbox', { name: /Who to ask for a review/ });
    expect(who).toHaveValue('raj-moxie');
    fireEvent.change(who, { target: { value: 'someone-else' } });
    fireEvent.click(screen.getByRole('button', { name: /ask for a review/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/ask-review`, { go: true, login: 'someone-else' }));
  });

  it('closed without merging: Reopen PR #2 (a), or Mark the job dropped, which asks first and has no key', async () => {
    const { post } = setup(<><Ship /><SheetProbe /></>, { v: view('closed') });
    expect(await screen.findByRole('region', { name: 'Next step' })).toHaveTextContent('PR #2 was closed without merging');
    key('r');
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Mark the job dropped/ }));
    // The close sheet (the app's own, which asks first) is what opens; nothing is posted here.
    expect(screen.getByTestId('sheet')).toHaveTextContent(`close-job ${SLUG}`);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('approved, then merged', () => {
  it('you merge: Merge PR #2… (m) shows the ask with the exact step; the a key never merges; Esc is no go; Go merges with its confirm', async () => {
    const { post } = setup(<Ship />, { v: view('approved-you-merge'), play: 'full' });
    await screen.findByRole('region', { name: 'Ready to merge' });
    expect(screen.getByRole('region', { name: 'Ready to merge' })).toHaveTextContent('Raj approved PR #2 · round 1');
    expect(screen.getByRole('region', { name: 'Ready to merge' })).toHaveTextContent('6 checks passed');
    expect(screen.getByRole('region', { name: 'Ready to merge' })).toHaveTextContent('No conflicts with staging');
    expect(screen.getByRole('region', { name: 'Ready to merge' })).toHaveTextContent('Who merges PR #2You');
    key('a');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(post).not.toHaveBeenCalled();
    key('m');
    const ask = await screen.findByRole('dialog', { name: 'Merge PR #2 into staging?' });
    expect(ask).toHaveTextContent('gh pr merge 179 --repo acme/sample-repo --merge');
    expect(ask).toHaveTextContent('Hard line');
    expect(ask).toHaveTextContent('The a key never merges.');
    key('a', ask);
    expect(post).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Merge PR #2…/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Go: merge PR #2' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/merge`, { go: true, confirm: 'merge PR #2' }));
  });

  it('Raj merges: Remind Raj… is greyed with when it turns on; once on, the comment is shown and editable before it is posted', async () => {
    setup(<Ship />, { v: view('approved-they-merge') });
    const remind = await screen.findByRole('button', { name: /Remind Raj…/ });
    expect(remind).toBeDisabled();
    expect(screen.getByText('From 15:10, a day after the approval.')).toBeInTheDocument();
    document.body.innerHTML = '';
    const v = view('approved-they-merge');
    v.bar!.actions[0] = { ...v.bar!.actions[0], enabled: true, reason: null };
    v.remind!.can = true;
    const { post } = setup(<Ship />, { v });
    fireEvent.click(await screen.findByRole('button', { name: /Remind Raj…/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Remind Raj to merge PR #2?' });
    const text = within(sheet).getByRole('textbox', { name: 'The comment, as it will be posted' });
    expect(text).toHaveValue(v.remind!.text);
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(text, { target: { value: 'Hi Raj, could you merge PR #2 when you get a moment?' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Post the comment' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/review/${SLUG}/remind`, { go: true, text: 'Hi Raj, could you merge PR #2 when you get a moment?' }));
  });

  it('merged: says where it went, and the round folds below', async () => {
    setup(<Ship />, { v: view('merged') });
    expect(await screen.findByRole('region', { name: 'Next step' })).toHaveTextContent('PR #2 is merged into staging');
    expect(screen.getByRole('link', { name: /Open staging/ })).toHaveAttribute('href', 'https://github.com/acme/sample-repo/tree/staging');
  });
});

describe('the GitHub line', () => {
  it('GitHub checked 3 min ago · Check now (u): Checking GitHub…, then the new time', async () => {
    const { post, store } = setup(<GithubLine />);
    const line = await screen.findByRole('status', { name: 'GitHub' });
    expect(line).toHaveTextContent('GitHub checked 3 min ago');
    expect(line).toHaveAttribute('title', 'GitHub is read every minute while a job waits on someone, and right after any push or reply.');
    fireEvent.click(within(line).getByRole('button', { name: /Check now/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/flow/refresh', {}));
    expect(await screen.findByText('Checking GitHub…')).toBeInTheDocument();
    act(() => store.dispatch({ type: 'flow', flow: flow({ checkedAt: new Date().toISOString(), checking: false }) }));
    expect(await screen.findByText('GitHub checked just now')).toBeInTheDocument();
    key('u');
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  });

  it('when GitHub didn’t answer: the reason in words, the line to run, Copy and Try again', async () => {
    setup(<GithubLine />, { f: flow({ problem: { words: 'GitHub didn’t answer. gh isn’t signed in: run gh auth login', run: 'gh auth login' } }) });
    const line = await screen.findByRole('status', { name: 'GitHub' });
    expect(line).toHaveTextContent('GitHub didn’t answer. gh isn’t signed in: run');
    expect(within(line).getByText('gh auth login', { selector: 'code' })).toBeInTheDocument();
    expect(within(line).getByRole('button', { name: /Copy/ })).toBeInTheDocument();
    expect(within(line).getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('shows nothing until the dashboard has a GitHub line', async () => {
    setup(<GithubLine />, { f: null });
    await act(async () => {});
    expect(screen.queryByRole('status', { name: 'GitHub' })).toBeNull();
  });
});

describe('the Desk card and the Jobs card', () => {
  const card = (): Permission => ({
    id: 'round-1', slug: SLUG, kind: 'question', toolName: 'AskUserQuestion', createdAt: new Date().toISOString(),
    plain: { headline: 'Raj asked for changes on PR #2 · 4 comments, 1 question', detail: 'And lint failed on the same commit.' },
    input: { questions: [{ question: 'Raj asked for changes on PR #2 · 4 comments, 1 question', header: 'PR #2', multiSelect: false, options: [{ label: 'Fix with the Foreman', description: '' }, { label: 'Leave it for now', description: '' }] }] },
    roundCard: true, actions: [{ id: 'fix', label: 'Fix with the Foreman' }, { id: 'leave', label: 'Leave it for now' }], disabled: null,
    review: { slug: SLUG, state: 'asked', round: 1, pr: 179, prLabel: 'PR #2' },
  } as Permission);

  it('one short card: the headline, each item one line with its kind in words, Open the round, No go (r) and Go (a) answering the card', async () => {
    const p = card();
    const { post } = setup(<DeskView items={deskQueue([JOB], [p])} now={new Date()} layout="one" />, { v: view('asked'), permissions: [p], play: 'full' });
    const desk = await screen.findByRole('article', { name: 'Raj asked for changes on PR #2 · 4 comments, 1 question' });
    expect(desk).toHaveTextContent('Go / no go');
    expect(within(desk).getByRole('list', { name: 'What is in the round' })).toHaveTextContent('NitNit: fbId → feedbackId, to match the API.FeedbackForm.tsx:88');
    expect(within(desk).getByRole('link', { name: /Open the round/ })).toHaveAttribute('href', `#/job/${SLUG}`);
    expect(within(desk).getByRole('link', { name: /PR #2 on GitHub/ })).toHaveAttribute('href', PR_URL);
    expect(within(desk).getByRole('button', { name: /Go: fix with the Foreman/ })).toBeInTheDocument();
    key('a');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/round-1', { decision: 'allow', answers: { 'Raj asked for changes on PR #2 · 4 comments, 1 question': 'Fix with the Foreman' } }));
  });

  it('r answers the card with its no go; the queue names the round, not “a question”', async () => {
    const p = card();
    expect(deskQueue([JOB], [p])[0].what).toBe('Raj asked for changes on PR #2 · 4 comments, 1 question');
    const { post } = setup(<DeskView items={deskQueue([JOB], [p])} now={new Date()} layout="one" />, { v: view('asked'), permissions: [p], play: 'off' });
    expect(await screen.findByRole('button', { name: 'Leave it for now' })).toBeInTheDocument();
    key('r');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/round-1', { decision: 'allow', answers: { 'Raj asked for changes on PR #2 · 4 comments, 1 question': 'Leave it for now' } }));
  });

  it('a job with a round: the PR nudges it covers stay off the Desk', async () => {
    const p = card();
    const jobs = [{ ...JOB, nudges: [{ id: 'pr2-review', kind: 'ask', title: 'Ask Raj for a review?', text: '…', link: null, action: { send: '…' }, afterLine: true }] }] as Job[];
    setup(<DeskView items={deskQueue(jobs, [p])} now={new Date()} layout="one" />, { v: view('asked'), permissions: [p], jobs });
    await screen.findByRole('article', { name: /Raj asked for changes/ });
    await waitFor(() => expect(screen.getByText(/of 1/)).toBeInTheDocument());
    expect(screen.queryByText('Ask Raj for a review?')).toBeNull();
  });

  it('the Jobs card says who it waits on, since when and which round, with an hourglass and words; the GitHub line in the header only once it is over ten minutes old', async () => {
    const jobs = [{ ...JOB, group: 'shipping', lane: 'in-review', permissions: 0, laneReason: 'PR #2 waits on a review' }] as Job[];
    setup(<JobsPage />, { v: view('waiting'), jobs });
    expect(await screen.findByText('Waiting on Raj since 14:02 · round 2')).toBeInTheDocument();
    expect(screen.queryByText('PR #2 waits on a review')).toBeNull();
    const page = screen.getByRole('main', { name: 'Jobs' });
    // Checked 3 minutes ago: nothing to say in the header (u still checks).
    expect(within(page.querySelector('.page-head') as HTMLElement).queryByRole('status', { name: 'GitHub' })).toBeNull();
  });
});

describe('Settings → Workflow', () => {
  it('How often to check GitHub while waiting: 1, 5, 10 or 30 minutes, saved on the dashboard; who reviews and merges, from the route', async () => {
    const routes = [{ name: 'Sample shop', named: true, steps: [
      { pr: 1, from: 'your fork', into: 'moxie', reviews: 'You', merges: 'You' },
      { pr: 2, from: 'moxie', into: 'staging', reviews: 'Raj', merges: 'Raj' },
      { pr: 3, from: 'staging', into: 'main', reviews: 'the release owner', merges: 'the release owner' },
    ] }];
    const { post } = setup(<WorkflowSettings />, { list: { routes }, settings: { review: { githubEveryMin: 1 } } });
    const group = screen.getByRole('radiogroup', { name: 'How often to check GitHub while waiting' });
    expect(within(group).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['1', '5', '10', '30']);
    expect(within(group).getByRole('radio', { name: /1 min/ })).toBeChecked();
    fireEvent.click(within(group).getByRole('radio', { name: '5 min' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/review/settings', { githubEveryMin: 5 }));
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['PR #1your fork → moxieYouYou', 'PR #2moxie → stagingRajRaj', 'PR #3staging → mainthe release ownerthe release owner']);
  });

  it('says so when no repository has a profile yet', async () => {
    setup(<WorkflowSettings />, { list: { routes: [] } });
    expect(await screen.findByText(/No repository in Settings → Repos has a profile yet/)).toBeInTheDocument();
  });
});
