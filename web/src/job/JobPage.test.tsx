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
import { ev, job, permission, snapshot } from '../state/test-fixtures';
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

/** What the test's server knows: the store its events go to, and the briefs a deciding answer has answered (as GET /api/job/:slug returns them). */
const server = { store: null as Store | null, answered: [] as number[], gate: undefined as Gate | null | undefined, held: null as JobDetail['heldReply'] };

function setup({ jobs = [job('alpha', 'idle', { stage: 'plan' })], permissions = [] as Permission[], play = 'subtle', auto = null as { on: boolean; tag: string | null } | null, gate = null as Gate | null, slug = 'alpha', extra = null as React.ReactNode, drive = null as JobDetail['drive'], post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true })) } = {}) {
  const store: Store = createStore();
  server.store = store;
  server.answered = [];
  server.gate = undefined;
  server.held = null;
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, permissions, meta: { token: 't', settings: { play: { mode: play } }, models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }] } as never }) });
  const detail = (s: string): JobDetail => ({ slug: s, thread: [], threadMore: false, gate: server.gate === undefined ? gate : server.gate, answeredBriefs: [...server.answered], heldReply: server.held, options: { level: 1 }, auto, drive } as JobDetail);
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

  // m4: one Copy decisions in the head (and the Decisions tab's); none repeated in Details.
  it('has no Copy decisions in the job’s details: the head has the one', () => {
    setup();
    const all = screen.getAllByRole('button', { name: 'Copy decisions' });
    expect(all.filter((b) => b.closest('.job-details'))).toHaveLength(0);
    expect(all).toHaveLength(1);
  });
  it('says a job Auto start began was started by Auto, with the tag; a job you started says nothing', async () => {
    setup({ auto: { on: true, tag: 'nightly' } });
    expect(await screen.findByText('Started by Auto (tag: nightly)')).toBeInTheDocument();
    cleanup();
    setup({ auto: { on: true, tag: null } });
    await screen.findAllByRole('button', { name: 'Copy decisions' });
    expect(screen.queryByText(/Started by Auto/)).toBeNull();
  });
  it('also has Copy decisions in the page’s head, outside the folded Details', () => {
    setup();
    const inHead = screen.getAllByRole('button', { name: 'Copy decisions' }).filter((b) => !b.closest('.job-details'));
    expect(inHead).toHaveLength(1);
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
    expect(go).toHaveAttribute('title', 'You wrote what should change. Send the changes or cancel them first.');
    fireEvent.click(go);
    fireEvent.keyDown(document.body, { key: 'a' });
    await act(async () => {});
    expect(post.mock.calls.filter(([, b]) => (b as { kind?: string })?.kind === 'approve')).toHaveLength(0);
    // Cancel keeps nothing in the way: Go is on again.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(go).toBeEnabled());
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
  /**
   * The gate POST as the server answers it (dashboard/runner/index.js): `sent: true` always comes with a
   * started run, whose run event reaches the page, and a deciding answer (approve, changes) answers the
   * brief. `runEvent: false`: the run event never arrives (a lost event stream), so the sent line stays.
   */
  const sentPost = ({ runEvent = true } = {}) => {
    let n = 0;
    return vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
      if (path !== '/api/job/alpha/gate') return { ok: true };
      const b = (body ?? {}) as { kind?: string; briefNumber?: number | null };
      if ((b.kind === 'approve' || b.kind === 'changes') && typeof b.briefNumber === 'number') server.answered.push(b.briefNumber);
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

  it('a press while sent sends nothing', async () => {
    const post = sentPost();
    setup({ jobs: waiting(), gate: GATE, post });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    fireEvent.click(go);
    await within(bar()).findByText(SENT_LINE);
    // The calls are gone from the bar; a second click or the a key sends nothing.
    expect(calls()).toHaveLength(0);
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

  it('after the server accepts a send back, the bar says "Sent. Waiting for the Foreman to start."', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    fireEvent.click(await sendBack());
    expect(await within(bar()).findByText(SENT_LINE)).toBeInTheDocument();
    expect(bar()).toHaveTextContent('The Foreman will rework this step with your note.');
    expect(live()).toHaveTextContent(`${SENT_LINE} The Foreman will rework this step with your note.`);
  });

  it('after the server accepts a reply, the bar says nothing is approved', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A note.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    expect(await within(bar()).findByText(SENT_LINE)).toBeInTheDocument();
    expect(bar()).toHaveTextContent('Your reply is with the Foreman. Nothing is approved.');
    expect(live()).toHaveTextContent(`${SENT_LINE} Your reply is with the Foreman. Nothing is approved.`);
  });

  it('after the Foreman answers a reply, Reply, Go and Send back can be pressed again', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A note.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await within(bar()).findByText(SENT_LINE);
    // The Foreman picks the message up (the run the reply started): the bar keeps its words, no calls.
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ id: 'r_sent_1', status: 'running' }));
    expect(bar()).toHaveTextContent('Your reply is with the Foreman. Nothing is approved.');
    expect(calls()).toHaveLength(0);
    // It answers: the gate is still waiting.
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_sent_1', slug: 'alpha', status: 'done' }) }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    expect(screen.getByRole('button', { name: /^Go: approve/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^No go: send back/ })).toBeEnabled();
    // The bar reads as waiting again.
    expect(bar()).toHaveTextContent('Say go and the Foreman goes ahead: Build step 1');
    expect(bar()).not.toHaveTextContent('Nothing is approved.');
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
  it('Go: after the run started the bar still says it was sent, with no calls and no second line', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    const watch = watchBar();
    fireEvent.click(go);
    await within(bar()).findByText(SENT_LINE);
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ status: 'running' }));
    await act(async () => {});
    expect(within(bar()).getByText(SENT_LINE)).toBeInTheDocument();
    expect(live()).toHaveTextContent(SENT_LINE);
    expect(calls()).toHaveLength(0);
    expect(bar()).not.toHaveTextContent('Nothing is approved');
    expect(bar()).not.toHaveTextContent('rework');
    // A run is at work: no Try again.
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(watch.stop().comeBack).toEqual([]);
  });

  it('Send back: after the run started the bar says it was sent and that the Foreman will rework the step', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    const send = await sendBack();
    const watch = watchBar();
    fireEvent.click(send);
    await within(bar()).findByText(SENT_LINE);
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ status: 'running' }));
    await act(async () => {});
    expect(within(bar()).getByText(SENT_LINE)).toBeInTheDocument();
    expect(bar()).toHaveTextContent('The Foreman will rework this step with your note.');
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
    await within(bar()).findByText(SENT_LINE);
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ status: 'running' }));
    await act(async () => {});
    expect(within(bar()).getByText(SENT_LINE)).toBeInTheDocument();
    expect(bar()).toHaveTextContent('Your reply is with the Foreman. Nothing is approved.');
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
    await waitFor(() => expect(bar()).toHaveTextContent(SENT_LINE));
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
    await within(bar()).findByText(SENT_LINE);
    // The run ends; the brief is still the answered one and nothing new starts.
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_sent_1', slug: 'alpha', status: 'done', endedAt: new Date().toISOString() }) }); });
    act(() => { vi.advanceTimersByTime(29_000); });
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
    expect(bar()).toHaveTextContent('Write to the Foreman below to move it on.');
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
describe('Auto on the job page', () => {
  const STOPPED = { on: true, by: 'you' as const, ran: true, stopped: { reason: 'a database change needs you.', rule: 'database', at: NOW } };
  const head = () => document.querySelector('.page-head')!;

  it('an Auto job has the switch and What Auto decided in the page head, and the locked model line in Details', async () => {
    setup({ jobs: [job('alpha', 'running', { stage: 'plan', level: 1, auto: { on: true, by: 'you', ran: true } })], drive: { sessionId: 's1', model: 'claude-opus-5-5' } });
    const box = screen.getByRole('checkbox', { name: /Auto: run to PR #1/ });
    expect(box).toBeChecked();
    expect(box.closest('.job-details')).toBeNull();
    expect(head().contains(box)).toBe(true);
    const what = screen.getByRole('button', { name: 'What Auto decided' });
    expect(head().contains(what)).toBe(true);
    const model = await screen.findByText(/Foreman model: Opus 5\.5/);
    expect(model.closest('.job-details')).not.toBeNull();
    expect(model.querySelector('svg, .icon')).not.toBeNull();
  });

  it('a job without Auto still has the switch, off, so Auto can be turned on', () => {
    setup({ jobs: [job('alpha', 'idle', { stage: 'plan', level: 1 })] });
    expect(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'What Auto decided' })).toBeNull();
  });

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
