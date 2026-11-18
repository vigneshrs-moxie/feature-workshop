// The message box (Task 11, R8): one box, docked at the foot of the left pane. Words with Go are the
// approval's note, words with Send back are the change, words alone are a message; no Reply mode and
// no Steer. The draft is kept under the old page's key (fw.draft.<slug>). Built on the made-up long job.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { Job, Run } from '../../api/types';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { UiProvider } from '../../app/ui';
import { clearAllSent } from '../../lib/sentState';
import { draftKey as composerDraftKey } from '../../panes/Foreman/Composer';
import { clearGateSent, useGateSent } from '../../panes/Foreman/gateSent';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { LEVELS, snapshot } from '../../state/test-fixtures';
import { longJob } from '../fixtures/longJob';
import { browserDrafts, createJobStore, draftKey, type JobStore } from '../jobStore';
import { JobPage2 } from '../JobPage2';
import { forgetRecentPages } from '../recent';
import type { GateMove, JobBody, JobPagePayload, Move, PermissionMove } from '../types';
import { gateBody } from './gateBody';
import { forgetSentGo } from './YourMove';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const payload = () => clone(longJob.payload) as unknown as JobPagePayload;
const GATE = () => payload().move as GateMove;
const RUNNING = { id: 'run-now', status: 'running', startedAt: '2026-11-04T15:00:00.000Z', lastAction: null };
const PERMISSION: PermissionMove = {
  kind: 'permission', id: 'perm-1', card: 'permission', what: 'Run the unit tests', command: 'npm test', questions: null, risk: null,
  since: '2026-11-04T15:01:00.000Z', canAllowForRun: false, hardLine: false, defaultToNo: false, canAlwaysAllow: false,
};

const media = { width: 1512, heard: new Set<() => void>() };
function windowWidth(px: number) {
  media.width = px;
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    return {
      get matches() { return (!min || media.width >= Number(min[1])) && (!max || media.width <= Number(max[1])); },
      media: q,
      addEventListener(_: string, fn: () => void) { media.heard.add(fn); },
      removeEventListener(_: string, fn: () => void) { media.heard.delete(fn); },
    };
  });
}
const resizeTo = (px: number) => act(() => { media.width = px; for (const fn of [...media.heard]) fn(); });

type Post = ReturnType<typeof vi.fn>;
interface Opened { store: JobStore | null; app: Store; post: Post; serve(p: JobPagePayload): void; unmount(): void }

const okPost = () => vi.fn(async (path: string): Promise<unknown> => (path.endsWith('/gate') ? { ok: true, sent: true, text: 'ok', run: { id: 'r1' } } : { run: { id: 'r1' } }));

/**
 * The page with the long job (with `move` and `patch`), and a client whose post is `post`. `own`: the
 * page makes its own store (as App does), reading the payload through the client.
 */
function open({ move, patch = {}, post = okPost(), own = false, beside = null }: {
  move?: Move | null; patch?: Partial<JobPagePayload>; post?: Post; own?: boolean; beside?: React.ReactNode;
} = {}): Opened {
  let current = { ...payload(), ...patch };
  if (move !== undefined) current.move = move;
  window.history.replaceState(null, '', `/#/job/${SLUG}`);
  let served: JobPagePayload | null = null;
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path.includes('/page')) return served ?? current;
    const id = decodeURIComponent(/[?&]id=([^&]+)/.exec(path)?.[1] ?? '');
    const b = longJob.bodies[id];
    if (!b) throw new Error('Starbase answered 404.');
    return { ...b, version: String(b.meta.hash ?? b.id) } satisfies JobBody;
  });
  const store = own ? null : createJobStore(SLUG, {
    api: { page: async () => served ?? { same: true as const, v: current.v }, item: async (_slug, id) => { const b = longJob.bodies[id]; if (!b) throw new Error('Starbase answered 404.'); return { ...b, version: String(b.meta.hash ?? b.id) }; } },
    events: () => () => {}, viewer: () => null, initial: current, drafts: browserDrafts,
  });
  const app = createStore();
  app.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [], permissions: [], meta: { token: 't', levels: LEVELS } }) });
  const api = { get, post, hosted: () => false } as unknown as ApiClient;
  const utils = render(
    <WorkshopContext.Provider value={{ api, store: app }}>
      <UiProvider><JobPage2 slug={SLUG} job={null} store={store ?? undefined} />{beside}</UiProvider>
    </WorkshopContext.Provider>,
  );
  return {
    store, app, post, unmount: utils.unmount,
    serve: (next) => { served = next; current = next; },
  };
}

const box = () => screen.getByRole('textbox', { name: 'Message to the Foreman', hidden: true }) as HTMLTextAreaElement;
const type = (words: string) => act(() => { fireEvent.change(box(), { target: { value: words } }); });
const send = () => screen.getByRole('button', { name: /^(Send|Sent)$/ });
const foot = () => within(document.querySelector<HTMLElement>('.jp2-mbw')!);
const card = () => document.querySelector<HTMLElement>('.jp2-ym')!;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const key = (k: string, target: Element = document.body, mods: { metaKey?: boolean } = {}) => act(() => { fireEvent.keyDown(target, { key: k, ...mods }); });
const callsTo = (post: Post, end: string) => post.mock.calls.filter((c) => String(c[0]).endsWith(end));
/** The message waiting for the Foreman, under the box (Task 16). */
const waitRow = () => document.querySelector<HTMLElement>('.jp2-mb-wait');
/** A server that keeps a message while the Foreman works (202 { waiting }), stops, and cancels. */
const waitPost = () => vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
  if (path.endsWith('/stop')) return { ok: true };
  if (path.endsWith('/waiting/cancel')) return { ok: true, cancelled: true, text: 'x' };
  const b = (body ?? {}) as { queue?: boolean; text?: string };
  return b.queue ? { ok: true, waiting: { text: b.text, at: '2026-11-13T12:00:00.000Z', why: null } } : { run: { id: 'r1' } };
});
/** A server that takes a message into the running reply (POST /api/runs/:id/steer → { steer }). */
let steerN = 0;
const steerPost = () => vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
  if (path.endsWith('/steer')) return { steer: { id: `s${++steerN}`, runId: 'run-now', slug: SLUG, text: (body as { text: string }).text, state: 'queued', queuedAt: `2026-11-04T15:0${steerN % 10}:00.000Z` } };
  return { run: { id: 'r1' } };
});
/** What he sent into the reply, one row each (words, then where it is). */
const steerRows = () => [...document.querySelectorAll('.jp2-mb-steer')].map((r) => r.textContent!.replace(/(\S)(Sent|Read|The Foreman)/, '$1 $2'));
/** A steer event from the stream: where a message sent into the reply is now. */
const steerEvent = (app: Store, id: string, text: string, state: string) => act(() => { app.dispatch({ type: 'steer', steer: { id, runId: 'run-now', slug: SLUG, text, state } as never }); });
/** A page fetch with the payload as it now is (a refresh). */
async function refresh(o: Opened, next: JobPagePayload) {
  o.serve(next);
  await act(async () => { await o.store!.loadPage(); });
}

let offKeys: () => void = () => {};
beforeEach(() => { windowWidth(1512); localStorage.clear(); forgetRecentPages(); forgetSentGo(); offKeys = installKeyListener(); resetChord(); });
afterEach(() => { offKeys(); vi.unstubAllGlobals(); localStorage.clear(); clearAllSent(); clearGateSent(); window.history.replaceState(null, '', '/'); });

describe('the draft', () => {
  it('is kept under the old page’s key: the old page’s words show, every change is kept, and a reload finds them', async () => {
    expect(draftKey(SLUG)).toBe(composerDraftKey(SLUG));
    localStorage.setItem(`fw.draft.${SLUG}`, 'Typed on the old page');
    const first = open({ own: true, move: null });
    await settle();
    expect(box()).toHaveValue('Typed on the old page');
    type('Typed on the old page, then here');
    expect(localStorage.getItem(`fw.draft.${SLUG}`)).toBe('Typed on the old page, then here');
    first.unmount();
    open({ own: true, move: null });
    await settle();
    expect(box()).toHaveValue('Typed on the old page, then here');
  });

  it('survives a refresh, a step pick, a permission card and a width change, in the same box (across 1100 px it moves, with the draft)', async () => {
    const o = open();
    type('Keep the week picker as it is.');
    const el = box();
    const next = payload();
    next.v = 2;
    next.stateLine = 'Something else';
    await refresh(o, next);
    expect(box()).toBe(el);
    fireEvent.click([...document.querySelectorAll<HTMLButtonElement>('.jp2-st-row')].find((b) => b.textContent?.includes('Build'))!);
    expect(box()).toBe(el);
    const asked = payload();
    asked.v = 3;
    asked.move = PERMISSION;
    asked.run = { ...RUNNING, status: 'waiting_permission' };
    await refresh(o, asked);
    expect(within(card()).getByText('npm test')).toBeInTheDocument();
    // A laptop keeps the box at the foot of the conversation's column; under 1100 px it is at the foot
    // of the left pane: crossing 1100 px the box moves, and the draft goes with it.
    expect(el.closest('.jp2-convo')).not.toBeNull();
    resizeTo(900);
    const narrow = box();
    expect(narrow.closest('.jp2-left')).not.toBeNull();
    expect(narrow).toHaveValue('Keep the week picker as it is.');
    resizeTo(390);
    expect(box()).toBe(narrow);
    resizeTo(1512);
    expect(box().closest('.jp2-convo')).not.toBeNull();
    expect(box()).toHaveValue('Keep the week picker as it is.');
    expect(localStorage.getItem(`fw.draft.${SLUG}`)).toBe('Keep the week picker as it is.');
  });

  it('grows to eight lines, then scrolls (the stylesheet sizes it to its words)', () => {
    // vitest runs from web/ (jsdom gives import.meta.url an http scheme).
    const css = readFileSync(path.join(process.cwd(), 'src/jobpage/jobpage.css'), 'utf8');
    const rule = /\.jp2-mb-ta \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/field-sizing: content/);
    // Eight 20 px lines, the padding (5 + 5) and the edge (1 + 1).
    expect(rule).toMatch(/max-height: 172px/);
    expect(rule).toMatch(/overflow-y: auto/);
    open({ move: null });
    expect(box()).toHaveAttribute('rows', '1');
    expect(box()).toHaveClass('jp2-mb-ta');
  });
});

describe('words alone go as a message', () => {
  it('Send posts the words to /send, shows Sent at once and empties the box (and its kept copy)', async () => {
    let answer: (v: unknown) => void = () => {};
    const post = vi.fn((_path: string, _body?: unknown) => new Promise((r) => { answer = r; }));
    const o = open({ move: null, post });
    type('  Please also check the totals row.  ');
    fireEvent.click(send());
    expect(send()).toHaveTextContent('Sent');
    expect(box()).toHaveValue('');
    expect(localStorage.getItem(`fw.draft.${SLUG}`)).toBeNull();
    expect(callsTo(o.post, '/send').map((c) => [c[0], JSON.stringify(c[1])])).toEqual([
      [`/api/job/${SLUG}/send`, '{"kind":"message","text":"Please also check the totals row.","confirmNoTerminal":false}'],
    ]);
    // Once, however fast he clicks.
    fireEvent.click(send());
    await act(async () => { answer({ run: { id: 'r2' } }); });
    expect(callsTo(o.post, '/send')).toHaveLength(1);
    expect(send()).toHaveTextContent('Sent');
    expect(foot().queryByRole('alert')).toBeNull();
    // Typing again: Send is Send again.
    type('One more thing');
    expect(send()).toHaveTextContent(/^Send$/);
  });

  it('⌘↵ in the box sends when nothing waits for a Go', async () => {
    const o = open({ move: null });
    type('Carry on.');
    key('Enter', box(), { metaKey: true });
    await settle();
    expect(callsTo(o.post, '/send')).toHaveLength(1);
    expect(JSON.stringify(callsTo(o.post, '/send')[0][1])).toBe('{"kind":"message","text":"Carry on.","confirmNoTerminal":false}');
  });

  it.each([
    ['limited', new ApiError(409, 'Claude’s usage limit is reached.', { code: 'limited' }), /usage limit is reached/],
    ['terminal', new ApiError(409, 'This job’s Foreman was last used in a terminal.', { code: 'terminal' }), /last used in your terminal/],
    ['busy', new ApiError(409, 'The Foreman is still working on your last message. Wait for it to finish, or stop it.'), /Foreman is still working/],
    ['locked', new ApiError(409, 'Held.', { code: 'job-locked', lock: { owner: 'terminal' } }), /Another place is working on this job/],
    ['unreachable', new TypeError('Failed to fetch'), /Couldn’t reach Starbase/],
    ['restarting', new ApiError(409, 'This job is being started again on another model right now. Wait for that to finish.'), /being started again on another model/],
    ['closing', new ApiError(409, 'This job is being marked done right now. Wait a moment.'), /being marked done right now/],
  ])('a refusal (%s) puts the words back with the reason in plain words', async (_name, err, words) => {
    let refuse: (e: unknown) => void = () => {};
    const post = vi.fn(() => new Promise((_r, j) => { refuse = j; }));
    open({ move: null, post });
    type('Please also check the totals row.');
    fireEvent.click(send());
    expect(box()).toHaveValue('');
    // Typed while it was out: kept, under the words that come back.
    type('And the header.');
    await act(async () => { refuse(err); });
    expect(box()).toHaveValue('Please also check the totals row.\n\nAnd the header.');
    expect(foot().getByRole('alert')).toHaveTextContent(words);
    expect(foot().getByRole('alert')).toHaveTextContent(/^(Not sent|Couldn’t reach)/);
    expect(send()).toHaveTextContent(/^Send$/);
    expect(localStorage.getItem(`fw.draft.${SLUG}`)).toBe('Please also check the totals row.\n\nAnd the header.');
  });

  it('Claude Code open in a terminal: the box asks him to confirm none is this job’s Foreman, then sends with it', async () => {
    const post = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, 'Claude Code is open in a terminal.', { code: 'terminal-open', terminals: [] }))
      .mockResolvedValueOnce({ run: { id: 'r2' } });
    open({ move: null, post });
    type('Carry on.');
    fireEvent.click(send());
    await settle();
    fireEvent.click(screen.getByRole('checkbox', { name: /None of the open terminals is this job’s Foreman/ }));
    fireEvent.click(send());
    await settle();
    expect(post.mock.calls.map((c) => JSON.stringify(c[1]))).toEqual([
      '{"kind":"message","text":"Carry on.","confirmNoTerminal":false}',
      '{"kind":"message","text":"Carry on.","confirmNoTerminal":true}',
    ]);
  });

  it('an empty box: Send puts the cursor in it and sends nothing', () => {
    const o = open({ move: null });
    fireEvent.click(send());
    expect(document.activeElement).toBe(box());
    expect(o.post).not.toHaveBeenCalled();
  });

  it('has no Reply mode and no Steer', () => {
    open({ patch: { run: RUNNING } });
    expect(screen.queryByRole('button', { name: /^Reply/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Steer/ })).toBeNull();
  });
});

describe('words with Go and with Send back', () => {
  it('words typed in the box go with Go as the approval’s note; the box empties once Go is accepted', async () => {
    const o = open();
    type('Mind the totals row.');
    fireEvent.click(within(card()).getByRole('button', { name: /^Go/ }));
    await settle();
    const bodies = callsTo(o.post, '/gate').map((c) => JSON.stringify(c[1]));
    expect(bodies).toEqual([JSON.stringify(gateBody('approve', GATE(), { picks: {}, own: {} }, { note: 'Mind the totals row.' }))]);
    expect(JSON.parse(bodies[0]).note).toBe('Mind the totals row.');
    expect(box()).toHaveValue('');
    expect(localStorage.getItem(`fw.draft.${SLUG}`)).toBeNull();
    expect(callsTo(o.post, '/send')).toHaveLength(0);
  });

  it('Send back with an empty box sends nothing: the cursor goes to the box with a hint', () => {
    const o = open();
    fireEvent.click(within(card()).getByRole('button', { name: /^Send back/ }));
    expect(document.activeElement).toBe(box());
    expect(within(card()).getByRole('status')).toHaveTextContent('Write what should change in the message box, then press Send back.');
    expect(o.post).not.toHaveBeenCalled();
  });

  it('words with Send back are the change: the gate route gets kind changes with the words as the note; Sent at once', async () => {
    let answer: (v: unknown) => void = () => {};
    const post = vi.fn((_path: string, _body?: unknown) => new Promise((r) => { answer = r; }));
    open({ post });
    fireEvent.click(within(within(card()).getByRole('group', { name: /^2\./ })).getAllByRole('radio')[1]);
    type('Split the export into two files.');
    fireEvent.click(within(card()).getByRole('button', { name: /^Send back/ }));
    expect(card()).toHaveTextContent('Sent back · the Foreman is revising');
    expect(box()).toHaveValue('');
    expect(post.mock.calls.map((c) => [c[0], JSON.stringify(c[1])])).toEqual([
      [`/api/job/${SLUG}/gate`, JSON.stringify(gateBody('changes', GATE(), { picks: { 2: 'b' }, own: {} }, { note: 'Split the export into two files.' }))],
    ]);
    expect(JSON.parse(JSON.stringify(post.mock.calls[0][1]))).toMatchObject({ kind: 'changes', note: 'Split the export into two files.', verdicts: {} });
    await act(async () => { answer({ ok: true, sent: true, text: 'ok', run: { id: 'r1' } }); });
    expect(card()).toHaveTextContent('Sent back · the Foreman is revising');
  });

  it('r is Send back (not while typing); a refusal puts the words back with the reason', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown) => { throw new ApiError(409, 'Limited.', { code: 'limited' }); });
    open({ post });
    type('Split the export into two files.');
    key('r', box());
    expect(post).not.toHaveBeenCalled();
    act(() => { box().blur(); });
    key('r');
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.parse(JSON.stringify(post.mock.calls[0][1])).kind).toBe('changes');
    expect(box()).toHaveValue('Split the export into two files.');
    expect(within(card()).getByRole('alert')).toHaveTextContent(/usage limit is reached/);
    expect(within(card()).getByRole('button', { name: /^Send back/ })).toBeInTheDocument();
  });

  it('a Go or Send back already on its way from another place keeps Go and Send back off; pressing them sends nothing and leaves that send alone', async () => {
    // Today's card (or the Desk) for the same job, as the job stands on the page: it sends through the shared send.
    let other: ReturnType<typeof useGateSent> | null = null;
    const RUN = payload().run!;
    function Other() {
      const s = useGateSent({ slug: SLUG, waitingFor: null, stage: null } as unknown as Job, { id: RUN.id } as Run);
      useEffect(() => { other = s; });
      return <span data-testid="other">{s.state}</span>;
    }
    let answer: (v: unknown) => void = () => {};
    const theirs = { post: vi.fn(() => new Promise((r) => { answer = r; })) } as unknown as ApiClient;
    const o = open({ beside: <Other /> });
    let out: Promise<unknown> = Promise.resolve();
    act(() => { out = other!.send(theirs, gateBody('approve', GATE(), { picks: {}, own: {} })); });
    const goBtn = () => within(card()).getByRole('button', { name: /^Go/ });
    const backBtn = () => within(card()).getByRole('button', { name: /^Send back/ });
    expect(goBtn()).toBeDisabled();
    expect(backBtn()).toBeDisabled();
    expect(goBtn()).toHaveAttribute('title', expect.stringMatching(/already on its way/));
    key('Enter', document.body, { metaKey: true });
    key('a');
    type('Split it.');
    act(() => { box().blur(); });
    key('r');
    await settle();
    expect(callsTo(o.post, '/gate')).toHaveLength(0);
    expect(screen.getByTestId('other')).toHaveTextContent('sending');
    await act(async () => { answer({ ok: true, sent: true, text: 'ok', run: { id: 'r9' } }); await out; });
    expect(screen.getByTestId('other')).toHaveTextContent('sent');
    expect(goBtn()).toBeDisabled();
    expect(callsTo(o.post, '/gate')).toHaveLength(0);
    expect(box()).toHaveValue('Split it.');
  });
});

describe('while a reply runs', () => {
  it('the box says the Foreman reads it at its next step, with Stop it and send now beside it in the same row; Send goes into the reply (talk any time)', async () => {
    const o = open({ move: null, patch: { run: RUNNING }, post: steerPost() });
    expect(box()).toHaveAttribute('placeholder', 'Write to the Foreman… it reads this at its next step');
    expect(send()).toHaveAttribute('title', 'The Foreman is working: your message goes into this reply and it reads it at its next step.');
    expect(screen.getByRole('button', { name: 'Stop it and send now' }).parentElement).toBe(box().parentElement);
    type('Also the header.');
    fireEvent.click(send());
    await settle();
    expect(o.post.mock.calls.map((c) => [c[0], JSON.stringify(c[1])])).toEqual([['/api/runs/run-now/steer', '{"text":"Also the header."}']]);
    expect(box()).toHaveValue('');
    expect(send()).toHaveTextContent('Sent');
    expect(steerRows()).toEqual(['Also the header. Sent · the Foreman reads it at its next step']);
    expect(document.querySelector('.jp2-mb-line')).toBeNull();
  });

  it('Stop it and send now makes the words wait, then stops the reply: they go when it has stopped (Task 16)', async () => {
    const o = open({ move: null, patch: { run: RUNNING }, post: waitPost() });
    type('Stop, and use the old header.');
    fireEvent.click(screen.getByRole('button', { name: 'Stop it and send now' }));
    await settle();
    expect(o.post.mock.calls.map((c) => [c[0], JSON.stringify(c[1])])).toEqual([
      [`/api/job/${SLUG}/send`, '{"kind":"message","text":"Stop, and use the old header.","queue":true,"confirmNoTerminal":false}'],
      ['/api/runs/run-now/stop', '{"then":"send-waiting"}'],
    ]);
    expect(box()).toHaveValue('');
    expect(waitRow()).toHaveTextContent('Stop, and use the old header.');
  });

  it('Stop it and send now with an empty box puts the cursor in it and stops nothing', () => {
    const o = open({ move: null, patch: { run: RUNNING } });
    fireEvent.click(screen.getByRole('button', { name: 'Stop it and send now' }));
    expect(document.activeElement).toBe(box());
    expect(o.post).not.toHaveBeenCalled();
  });

  it('the app’s live run counts first: a run event that ends the reply wakes Send at once', async () => {
    const o = open({ move: null, patch: { run: RUNNING } });
    act(() => { o.app.dispatch({ type: 'event', event: { v: 2, type: 'run', job: SLUG, seq: 999999, data: { id: 'run-now', slug: SLUG, status: 'done' } } } as never); });
    expect(box()).toHaveAttribute('placeholder', 'Write to the Foreman…');
    expect(screen.queryByRole('button', { name: 'Stop it and send now' })).toBeNull();
  });
});

describe('Task 11 fix round 1', () => {
  const q = (id: string, state: string, words = 'Waiting for your laptop.') => ({ id, kind: 'approve', state, words, at: '2026-11-13T12:00:00Z', expiresAt: null, waiting: state === 'waiting', canCancel: state === 'waiting', permissionId: null });
  const withQueued = (v: number, decision: unknown) => { const p = payload(); p.v = v; p.queuedDecision = decision; return p; };

  it('a Go the website queues and then fails gives its note back to the box, after what was typed since', async () => {
    const o = open({ post: vi.fn(async () => ({ queued: q('g1', 'waiting') })) });
    type('Mind the totals row.');
    fireEvent.click(within(card()).getByRole('button', { name: /^Go/ }));
    await settle();
    expect(box()).toHaveValue('');
    await refresh(o, withQueued(2, q('g1', 'waiting')));
    type('And the header.');
    await refresh(o, withQueued(3, q('g1', 'failed', 'Your laptop couldn’t run it.')));
    expect(box()).toHaveValue('And the header.\nMind the totals row.');
    expect(within(card()).getByRole('button', { name: /^Go/ })).toBeEnabled();
  });

  it('a Send back the website queues and then puts away (the gate changed) gives the change back to an empty box', async () => {
    const o = open({ post: vi.fn(async () => ({ queued: q('b1', 'waiting') })) });
    type('Split the export into two files.');
    fireEvent.click(within(card()).getByRole('button', { name: /^Send back/ }));
    await settle();
    expect(box()).toHaveValue('');
    await refresh(o, withQueued(2, q('b1', 'changed', 'This changed on your laptop. Look again.')));
    expect(box()).toHaveValue('Split the export into two files.');
    expect(card()).toHaveTextContent('This changed on your laptop. Look again.');
  });

  it('a message the website queues comes back to the box when it is cancelled there; one that leaves the list after it showed does not (fix round 3)', async () => {
    const post = vi.fn().mockResolvedValueOnce({ queued: q('m1', 'waiting') }).mockResolvedValueOnce({ queued: q('m2', 'waiting') });
    const o = open({ move: null, post });
    type('Please also check the totals row.');
    fireEvent.click(send());
    await settle();
    expect(box()).toHaveValue('');
    expect(foot().getByRole('status')).toHaveTextContent('Queued for your laptop');
    await refresh(o, withQueued(2, q('m1', 'waiting')));
    expect(box()).toHaveValue('');
    await refresh(o, withQueued(3, q('m1', 'cancelled', 'Cancelled on the website.')));
    expect(box()).toHaveValue('Please also check the totals row.');
    expect(foot().getByRole('alert')).toHaveTextContent('Not sent: Cancelled on the website. Your words are back in the box.');
    fireEvent.click(send());
    await settle();
    await refresh(o, withQueued(4, q('m2', 'sent')));
    await refresh(o, withQueued(5, null));
    expect(box()).toHaveValue('');
    // Sent on the laptop: the words stay gone.
    const done = vi.fn().mockResolvedValueOnce({ queued: q('m3', 'waiting') });
    o.unmount();
    localStorage.clear();
    const o2 = open({ move: null, post: done });
    type('Ship it.');
    fireEvent.click(send());
    await settle();
    await refresh(o2, withQueued(2, q('m3', 'done', 'Sent on your laptop.')));
    expect(box()).toHaveValue('');
  });

  it('at a go-ahead the box says the prototype’s words, and ⌘↵ in it is Go with the words as its note (never a message)', async () => {
    const o = open();
    expect(box()).toHaveAttribute('placeholder', 'Your own answer, or a message to the Foreman…');
    type('Mind the totals row.');
    key('Enter', box(), { metaKey: true });
    await settle();
    expect(callsTo(o.post, '/gate').map((c) => JSON.stringify(c[1]))).toEqual([JSON.stringify(gateBody('approve', GATE(), { picks: {}, own: {} }, { note: 'Mind the totals row.' }))]);
    expect(callsTo(o.post, '/send')).toHaveLength(0);
    expect(box()).toHaveValue('');
  });

  it('on the website, Stop it and send now: the reply ending by itself while the stop is out sends the words and says nothing wrong', async () => {
    let refuseStop: (e: unknown) => void = () => {};
    const post = vi.fn((path: string, _body?: unknown) => (path.endsWith('/stop') ? new Promise((_r, j) => { refuseStop = j; }) : Promise.resolve({ run: { id: 'r2' } })));
    const o = open({ move: null, patch: { run: RUNNING, hosted: true }, post });
    type('Use the old header.');
    fireEvent.click(screen.getByRole('button', { name: 'Stop it and send now' }));
    const ended = payload();
    ended.v = 2;
    ended.move = null;
    ended.hosted = true;
    ended.run = { ...RUNNING, status: 'done' };
    await refresh(o, ended);
    await settle();
    await act(async () => { refuseStop(new ApiError(404, 'That reply already finished.')); });
    expect(callsTo(post, '/send')).toHaveLength(1);
    expect(foot().queryByRole('alert')).toBeNull();
    expect(box()).toHaveValue('');
  });

  it('on the website, Stop it and send now stops waiting after ten seconds with a plain line when the reply never shows as ended; the words stay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const o = open({ move: null, patch: { run: RUNNING, hosted: true } });
      type('Use the old header.');
      fireEvent.click(screen.getByRole('button', { name: 'Stop it and send now' }));
      await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
      expect(screen.getByRole('button', { name: /Stop it and send now|Stopping/ })).toHaveAttribute('aria-busy', 'true');
      await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
      expect(foot().getByRole('alert')).toHaveTextContent('The Foreman hasn’t stopped yet. Your words are still here');
      expect(box()).toHaveValue('Use the old header.');
      expect(callsTo(o.post, '/send')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('on the website, a send the server still calls busy right after an accepted stop is tried once more', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const post = vi.fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new ApiError(409, 'The Foreman is still working on your last message. Wait for it, or pause it first.'))
        .mockResolvedValueOnce({ run: { id: 'r2' } });
      const o = open({ move: null, patch: { run: RUNNING, hosted: true }, post });
      type('Use the old header.');
      fireEvent.click(screen.getByRole('button', { name: 'Stop it and send now' }));
      const stopped = payload();
      stopped.v = 2;
      stopped.move = null;
      stopped.hosted = true;
      stopped.run = { ...RUNNING, status: 'stopped' };
      await refresh(o, stopped);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(callsTo(post, '/send')).toHaveLength(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
      expect(callsTo(post, '/send')).toHaveLength(2);
      expect(foot().queryByRole('alert')).toBeNull();
      expect(box()).toHaveValue('');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Task 11 fix round 1: the phone', () => {
  it('on the phone the row has no room for Stop it and send now: it has its own line above the box (Task 15); Send goes into the reply (talk any time)', async () => {
    windowWidth(390);
    const o = open({ move: null, patch: { run: RUNNING }, post: steerPost() });
    expect(box()).toHaveAttribute('placeholder', 'Message the Foreman…');
    const stop = screen.getByRole('button', { name: 'Stop it and send now' });
    const row = box().closest('.jp2-mb')!;
    expect(row).not.toContainElement(stop);
    expect(stop.closest('.jp2-mb-stopline')!.nextElementSibling).toBe(row);
    type('Also the header.');
    fireEvent.click(send());
    await settle();
    expect(callsTo(o.post, '/steer')).toHaveLength(1);
    expect(box()).toHaveValue('');
    expect(steerRows()).toEqual(['Also the header. Sent · the Foreman reads it at its next step']);
  });
});

describe('Task 11 fix round 2', () => {
  const q = (id: string, state: string, words = 'Waiting for your laptop.', kind = 'approve') => ({ id, kind, state, words, at: '2026-11-13T12:00:00Z', expiresAt: null, waiting: state === 'waiting', canCancel: state === 'waiting', permissionId: null });
  /** The website's payload: every decision still shown for the job, newest first. */
  const withList = (v: number, list: unknown[], patch: Partial<JobPagePayload> = {}) => { const p = { ...payload(), ...patch }; p.v = v; p.queuedDecisions = list; p.queuedDecision = list[0] ?? null; return p; };

  it('a queued Send back put away because the Foreman moved to the next brief gives the change back (the card is for another gate by then)', async () => {
    const o = open({ post: vi.fn(async () => ({ queued: q('b1', 'waiting') })) });
    type('Split the export into two files.');
    fireEvent.click(within(card()).getByRole('button', { name: /^Send back/ }));
    await settle();
    await refresh(o, withList(2, [q('b1', 'waiting')]));
    expect(box()).toHaveValue('');
    await refresh(o, withList(3, [q('b1', 'changed', 'The Foreman has moved on to a newer brief.')], { move: { ...GATE(), brief: 16, ask: 'Brief 16 waits' } }));
    expect(card()).toHaveTextContent('Brief 16 waits');
    expect(box()).toHaveValue('Split the export into two files.');
    expect(foot().getByRole('alert')).toHaveTextContent('Not sent: The Foreman has moved on to a newer brief. Your words are back in the box.');
  });

  it('a queued Send back that fails after the job stops waiting at a gate gives the change back (no card is left)', async () => {
    const o = open({ post: vi.fn(async () => ({ queued: q('b2', 'waiting') })) });
    type('Split the export into two files.');
    fireEvent.click(within(card()).getByRole('button', { name: /^Send back/ }));
    await settle();
    await refresh(o, withList(2, [q('b2', 'waiting')]));
    await refresh(o, withList(3, [q('b2', 'failed', 'Your laptop couldn’t run it.')], { move: null }));
    expect(document.querySelector('.jp2-ym .jp2-card')).toBeNull();
    expect(box()).toHaveValue('Split the export into two files.');
  });

  it('a message, then a Go: the newer Go never hides the message still waiting, so nothing comes back and nothing wakes', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ queued: q('m1', 'waiting', 'Waiting for your laptop.', 'message') })
      .mockResolvedValueOnce({ queued: q('g1', 'waiting') });
    const o = open({ post });
    type('Please also check the totals row.');
    fireEvent.click(send());
    await settle();
    await refresh(o, withList(2, [q('m1', 'waiting', 'Waiting for your laptop.', 'message')]));
    fireEvent.click(within(card()).getByRole('button', { name: /^Go/ }));
    await settle();
    await refresh(o, withList(3, [q('g1', 'waiting'), q('m1', 'waiting', 'Waiting for your laptop.', 'message')]));
    await refresh(o, withList(4, [q('g1', 'sent'), q('m1', 'sent', 'On its way.', 'message')]));
    expect(box()).toHaveValue('');
    expect(foot().queryByRole('alert')).toBeNull();
    expect(card()).toHaveTextContent('Queued for your laptop');
    // The message ran on the laptop: still nothing back.
    await refresh(o, withList(5, [q('g1', 'sent'), q('m1', 'done', 'Sent on your laptop.', 'message')]));
    expect(box()).toHaveValue('');
  });

  it('a Go with a note, then a message: the newer message never hides the Go still waiting, so its note stays gone and Go stays queued', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ queued: q('g2', 'waiting') })
      .mockResolvedValueOnce({ queued: q('m2', 'waiting', 'Waiting for your laptop.', 'message') });
    const o = open({ post });
    type('Mind the totals row.');
    fireEvent.click(within(card()).getByRole('button', { name: /^Go/ }));
    await settle();
    await refresh(o, withList(2, [q('g2', 'waiting')]));
    type('And the header.');
    fireEvent.click(send());
    await settle();
    await refresh(o, withList(3, [q('m2', 'waiting', 'Waiting for your laptop.', 'message'), q('g2', 'waiting')]));
    expect(box()).toHaveValue('');
    expect(card()).toHaveTextContent('Queued for your laptop');
    expect(within(card()).queryByRole('button', { name: /^Go/ })).toBeNull();
    // Now the Go fails there: its note comes back, and the card wakes.
    await refresh(o, withList(4, [q('m2', 'waiting', 'Waiting for your laptop.', 'message'), q('g2', 'failed', 'Your laptop couldn’t run it.')]));
    expect(box()).toHaveValue('Mind the totals row.');
    expect(within(card()).getByRole('button', { name: /^Go/ })).toBeEnabled();
  });

  it('on the website, leaving the page while the retry after a stop waits ends it: nothing more is sent, and the words stay kept', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const post = vi.fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new ApiError(409, 'The Foreman is still working on your last message. Wait for it, or pause it first.'))
        .mockResolvedValueOnce({ run: { id: 'r2' } });
      const o = open({ move: null, patch: { run: RUNNING, hosted: true }, post });
      type('Use the old header.');
      fireEvent.click(screen.getByRole('button', { name: 'Stop it and send now' }));
      const stopped = payload();
      stopped.v = 2;
      stopped.move = null;
      stopped.hosted = true;
      stopped.run = { ...RUNNING, status: 'stopped' };
      await refresh(o, stopped);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(callsTo(post, '/send')).toHaveLength(1);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      o.unmount();
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(callsTo(post, '/send')).toHaveLength(1);
      expect(localStorage.getItem(`fw.draft.${SLUG}`)).toBe('Use the old header.');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Task 11 fix round 3', () => {
  const q = (id: string, state: string, words = 'Waiting for your laptop.') => ({ id, kind: 'message', state, words, at: '2026-11-13T12:00:00Z', expiresAt: null, waiting: state === 'waiting', canCancel: state === 'waiting', permissionId: null });
  const withList = (v: number, list: unknown[]) => { const p = payload(); p.v = v; p.move = null; p.queuedDecisions = list; p.queuedDecision = list[0] ?? null; return p; };

  it('words given back from an older send leave a newer send in flight as it is: still Sent', async () => {
    let answer: (v: unknown) => void = () => {};
    const post = vi.fn()
      .mockResolvedValueOnce({ queued: q('m1', 'waiting') })
      .mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const o = open({ move: null, post });
    type('First words.');
    fireEvent.click(send());
    await settle();
    await refresh(o, withList(2, [q('m1', 'waiting')]));
    type('Second words.');
    fireEvent.click(send());
    expect(send()).toHaveTextContent('Sent');
    await refresh(o, withList(3, [q('m1', 'failed', 'Your laptop couldn’t run it.')]));
    expect(box()).toHaveValue('First words.');
    expect(send()).toHaveTextContent('Sent');
    await act(async () => { answer({ run: { id: 'r2' } }); });
    expect(callsTo(post, '/send')).toHaveLength(2);
  });
});

describe('Task 16: a message waits for the Foreman', () => {
  const waiting = (text: string, why: string | null = null) => ({ text, at: '2026-11-13T12:00:00.000Z', why });
  const withWaiting = (v: number, w: ReturnType<typeof waiting> | null, patch: Partial<JobPagePayload> = {}) => { const p = { ...payload(), ...patch }; p.v = v; p.move = null; p.waiting = w; return p; };

  it('shows the waiting words (Stop it and send now) under the box with Cancel at once, before the server answers, and once when the payload has them', async () => {
    let answer: (v: unknown) => void = () => {};
    const post = vi.fn((_path: string, _body?: unknown) => new Promise((r) => { answer = r; }));
    const o = open({ move: null, patch: { run: RUNNING }, post });
    type('Also the header.');
    fireEvent.click(screen.getByRole('button', { name: 'Stop it and send now' }));
    const row = waitRow()!;
    expect(row).toHaveTextContent('Sends when the Foreman finishes');
    expect(row).toHaveTextContent('Also the header.');
    expect(within(row).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(row.previousElementSibling).toBe(box().closest('.jp2-mb'));
    expect(send()).toHaveTextContent('Send');
    await act(async () => { answer({ ok: true, waiting: waiting('Also the header.') }); });
    expect(waitRow()).toHaveTextContent('Also the header.');
    await refresh(o, withWaiting(2, waiting('Also the header.'), { run: RUNNING }));
    expect(document.querySelectorAll('.jp2-mb-wait')).toHaveLength(1);
    // It went: the payload says so, and nothing of it is left.
    await refresh(o, withWaiting(3, null, { run: { ...RUNNING, id: 'run-next' } }));
    expect(waitRow()).toBeNull();
  });

  it('Cancel removes it at once (POST …/waiting/cancel) and puts the words back in the box, before anything typed since', async () => {
    const post = waitPost();
    const o = open({ move: null, patch: { run: RUNNING, waiting: waiting('Use the old header.') }, post });
    expect(waitRow()).toHaveTextContent('Use the old header.');
    type('And the footer.');
    fireEvent.click(within(waitRow()!).getByRole('button', { name: 'Cancel' }));
    expect(waitRow()).toBeNull();
    await settle();
    expect(callsTo(post, '/waiting/cancel').map((c) => [c[0], JSON.stringify(c[1])])).toEqual([[`/api/job/${SLUG}/waiting/cancel`, '{}']]);
    expect(box()).toHaveValue('Use the old header.\n\nAnd the footer.');
    await refresh(o, withWaiting(2, null, { run: RUNNING }));
    expect(waitRow()).toBeNull();
  });

  it('Cancel after it already went says so, and gives nothing back', async () => {
    const post = vi.fn(async () => ({ ok: true, cancelled: false, text: null }));
    open({ move: null, patch: { run: RUNNING, waiting: waiting('Too late.') }, post });
    fireEvent.click(within(waitRow()!).getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(box()).toHaveValue('');
    expect(document.querySelector('.jp2-mb-line')).toHaveTextContent('It had already gone to the Foreman.');
  });

  it('a second message while one waits (the reply stopping): the words come back, the line names the first, and Replace it sends them in its place', async () => {
    const post = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, 'The reply is stopping.'))
      .mockRejectedValueOnce(new ApiError(409, 'A message is already waiting for the Foreman: “First words.” Replace it, or cancel it first.', { code: 'waiting', waiting: waiting('First words.') }))
      .mockResolvedValueOnce({ ok: true, waiting: waiting('Second words.') });
    open({ move: null, patch: { run: RUNNING, waiting: waiting('First words.') }, post });
    type('Second words.');
    fireEvent.click(send());
    await settle();
    expect(box()).toHaveValue('Second words.');
    const line = document.querySelector<HTMLElement>('.jp2-mb-line')!;
    expect(line).toHaveTextContent('Not sent: a message is already waiting for the Foreman: “First words.” Replace it with these words, or cancel it first.');
    fireEvent.click(within(line).getByRole('button', { name: 'Replace it' }));
    await settle();
    expect(post.mock.calls.map((c) => JSON.stringify(c[1]))).toEqual([
      '{"text":"Second words."}',
      '{"kind":"message","text":"Second words.","queue":true,"confirmNoTerminal":false}',
      '{"kind":"message","text":"Second words.","queue":true,"replace":true,"confirmNoTerminal":false}',
    ]);
    expect(box()).toHaveValue('');
    expect(waitRow()).toHaveTextContent('Second words.');
    expect(document.querySelector('.jp2-mb-line')).toBeNull();
  });

  it('Stop it and send now with an empty box and a message waiting stops the reply only: the waiting message goes', async () => {
    const post = waitPost();
    open({ move: null, patch: { run: RUNNING, waiting: waiting('Use the old header.') }, post });
    fireEvent.click(screen.getByRole('button', { name: 'Stop it and send now' }));
    await settle();
    expect(post.mock.calls.map((c) => [c[0], JSON.stringify(c[1])])).toEqual([['/api/runs/run-now/stop', '{"then":"send-waiting"}']]);
    expect(waitRow()).toHaveTextContent('Use the old header.');
  });

  it('a send refused when it was time to go says why under the box, with Cancel', async () => {
    open({ move: null, patch: { waiting: waiting('After the limit.', 'Claude’s 5-hour limit is reached (it resets around 7:19 PM).') } });
    const row = waitRow()!;
    expect(row).toHaveClass('is-problem');
    expect(row).toHaveTextContent('Not sent yet: Claude’s 5-hour limit is reached (it resets around 7:19 PM).');
    expect(row).toHaveTextContent('After the limit.');
    expect(within(row).getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('on the website the waiting message shows read-only (no Cancel), and Send while the Foreman works keeps the words as before', async () => {
    const o = open({ move: null, patch: { run: RUNNING, hosted: true, waiting: waiting('Sent from the laptop.') } });
    expect(waitRow()).toHaveTextContent('Sent from the laptop.');
    expect(within(waitRow()!).queryByRole('button', { name: 'Cancel' })).toBeNull();
    type('Also the header.');
    fireEvent.click(send());
    await settle();
    expect(o.post).not.toHaveBeenCalled();
    expect(box()).toHaveValue('Also the header.');
    expect(document.querySelector('.jp2-mb-line')).toHaveTextContent(/^Kept here, not sent. Press Send when the Foreman finishes, or Stop it and send now.$/);
  });

  it('a stop that is refused says so once, and the message still waits', async () => {
    const post = vi.fn(async (path: string) => {
      if (path.endsWith('/stop')) throw new ApiError(409, 'This reply can’t be stopped right now.');
      return { ok: true, waiting: waiting('Use the old header.') };
    });
    open({ move: null, patch: { run: RUNNING }, post });
    type('Use the old header.');
    fireEvent.click(screen.getByRole('button', { name: 'Stop it and send now' }));
    await settle();
    expect(foot().getByRole('alert')).toHaveTextContent(/^Not stopped: This reply can’t be stopped right now\. Your message still waits for the Foreman\.$/);
    expect(waitRow()).toHaveTextContent('Use the old header.');
  });

  it('a refused wait gives the words back with the reason, and shows nothing waiting', async () => {
    const post = vi.fn().mockRejectedValueOnce(new ApiError(409, 'This job is being started again on another model right now. Wait for that to finish.'));
    open({ move: null, patch: { run: RUNNING }, post });
    type('Also the header.');
    fireEvent.click(screen.getByRole('button', { name: 'Stop it and send now' }));
    await settle();
    expect(box()).toHaveValue('Also the header.');
    expect(waitRow()).toBeNull();
    expect(foot().getByRole('alert')).toHaveTextContent('Not sent: this job is being started again on another model right now.');
  });
});

describe('Task 16 fix round 1', () => {
  const waiting = (text: string, why: string | null = null, toBox = false) => ({ text, at: '2026-11-13T12:00:00.000Z', why, ...(toBox ? { toBox: true as const } : {}) });
  const KEPT_STOPPED = 'Kept: you stopped the reply. Press Send to send it.';

  it('a message kept after a plain stop shows Send and Cancel; Send posts …/waiting/send and the row says it is going', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown) => ({ ok: true, waiting: null }));
    open({ move: null, patch: { waiting: waiting('Use the old header.', KEPT_STOPPED) }, post });
    const row = waitRow()!;
    expect(row).toHaveTextContent(`Not sent yet: ${KEPT_STOPPED}`);
    expect(within(row).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    fireEvent.click(within(row).getByRole('button', { name: 'Send' }));
    expect(waitRow()).toHaveTextContent('Sending');
    await settle();
    expect(post.mock.calls.map((c) => [c[0], JSON.stringify(c[1])])).toEqual([[`/api/job/${SLUG}/waiting/send`, '{}']]);
  });

  it('Send on a kept message that is refused again says why on a line; the row stays', async () => {
    const post = vi.fn(async () => ({ ok: true, waiting: waiting('Use the old header.', 'Claude’s 5-hour limit is reached.') }));
    open({ move: null, patch: { waiting: waiting('Use the old header.', KEPT_STOPPED) }, post });
    fireEvent.click(within(waitRow()!).getByRole('button', { name: 'Send' }));
    await settle();
    expect(foot().getByRole('alert')).toHaveTextContent('Not sent: Claude’s 5-hour limit is reached.');
    expect(waitRow()).toHaveTextContent('Use the old header.');
  });

  it('the Foreman is asking him first: the waiting words move into the box (after what is there), the message is cancelled, and one line says so', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown) => ({ ok: true, cancelled: true, text: 'Also the footer.' }));
    const o = open({ move: null, patch: { run: RUNNING }, post });
    type('Typed already.');
    await refresh(o, { ...payload(), v: 2, run: { ...RUNNING, status: 'done' }, waiting: waiting('Also the footer.', 'The Foreman is asking you something first.', true) });
    await settle();
    expect(post.mock.calls.map((c) => c[0])).toEqual([`/api/job/${SLUG}/waiting/cancel`]);
    expect(box()).toHaveValue('Typed already.\nAlso the footer.');
    expect(waitRow()).toBeNull();
    expect(document.querySelector('.jp2-mb-line')).toHaveTextContent(/^Your waiting words are in the box: the Foreman is asking you something first\.$/);
    // The same payload again moves nothing twice.
    await refresh(o, { ...payload(), v: 3, run: { ...RUNNING, status: 'done' }, waiting: waiting('Also the footer.', 'The Foreman is asking you something first.', true) });
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(box()).toHaveValue('Typed already.\nAlso the footer.');
  });

  it('on the website words marked for the box stay read-only: nothing moves', async () => {
    const o = open({ move: null, patch: { hosted: true, waiting: waiting('Also the footer.', 'The Foreman is asking you something first.', true) } });
    await settle();
    expect(o.post).not.toHaveBeenCalled();
    expect(box()).toHaveValue('');
    expect(waitRow()).toHaveTextContent('Also the footer.');
    expect(within(waitRow()!).queryByRole('button')).toBeNull();
  });

  it('a payload that shows the message before the server answers is trusted: its why shows at once', async () => {
    let answer: (v: unknown) => void = () => {};
    const post = vi.fn((_path: string, _body?: unknown) => new Promise((r) => { answer = r; }));
    const o = open({ move: null, patch: { run: RUNNING }, post });
    type('Also the header.');
    fireEvent.click(send());
    await refresh(o, { ...payload(), v: 2, move: null, run: RUNNING, waiting: waiting('Also the header.', 'This job is open in a terminal.') });
    await act(async () => { answer({ ok: true, waiting: waiting('Also the header.') }); });
    expect(waitRow()).toHaveTextContent('Not sent yet: This job is open in a terminal.');
  });
});

describe('final W10: the website shows his waiting message without Cancel or Send', () => {
  const waiting = (text: string, why: string | null = null, toBox = false) => ({ text, at: '2026-11-13T12:00:00.000Z', why, ...(toBox ? { toBox: true as const } : {}) });
  it('held back with a reason: no Send and no Cancel; moved to the box at a question: nothing is posted from the website', async () => {
    const a = open({ move: null, patch: { hosted: true, waiting: waiting('Use the old header.', 'Claude’s 5-hour limit is reached.') } });
    await settle();
    expect(waitRow()).toHaveTextContent('Not sent yet: Claude’s 5-hour limit is reached.');
    expect(within(waitRow()!).queryAllByRole('button')).toEqual([]);
    a.unmount();
    const b = open({ move: null, patch: { hosted: true, waiting: waiting('Use the old header.', null, true) } });
    await settle();
    expect(within(waitRow()!).queryAllByRole('button')).toEqual([]);
    expect(b.post.mock.calls.filter((c: unknown[]) => String(c[0]).includes('/waiting/'))).toEqual([]);
  });
});

describe('talk any time: Send goes into the running reply', () => {
  it('a 404 finished (the reply ended meanwhile) sends the same words as a plain message, with no error', async () => {
    const post = vi.fn(async (path: string): Promise<unknown> => {
      if (path.endsWith('/steer')) throw new ApiError(404, 'That reply already finished. Send your message as a new one.', { code: 'finished' });
      return { run: { id: 'r1' } };
    });
    open({ move: null, patch: { run: RUNNING }, post });
    type('Also the header.');
    fireEvent.click(send());
    await settle();
    expect(post.mock.calls.map((c) => [c[0], JSON.stringify(c[1])])).toEqual([
      ['/api/runs/run-now/steer', '{"text":"Also the header."}'],
      [`/api/job/${SLUG}/send`, '{"kind":"message","text":"Also the header.","confirmNoTerminal":false}'],
    ]);
    expect(box()).toHaveValue('');
    expect(send()).toHaveTextContent('Sent');
    expect(document.querySelector('.jp2-mb-line')).toBeNull();
  });

  it('a 409 (the reply is stopping) makes the words wait for the Foreman instead', async () => {
    const post = vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
      if (path.endsWith('/steer')) throw new ApiError(409, 'The reply is stopping.');
      return { ok: true, waiting: { text: (body as { text: string }).text, at: '2026-11-13T12:00:00.000Z', why: null } };
    });
    open({ move: null, patch: { run: RUNNING }, post });
    type('Also the header.');
    fireEvent.click(send());
    await settle();
    expect(callsTo(post, '/send').map((c) => JSON.stringify(c[1]))).toEqual(['{"kind":"message","text":"Also the header.","queue":true,"confirmNoTerminal":false}']);
    expect(box()).toHaveValue('');
    expect(waitRow()).toHaveTextContent('Also the header.');
    expect(document.querySelector('.jp2-mb-line')).toBeNull();
  });

  it('any other refusal puts the words back with the reason', async () => {
    const post = vi.fn(async () => { throw new ApiError(500, 'Something broke.'); });
    open({ move: null, patch: { run: RUNNING }, post });
    type('Also the header.');
    fireEvent.click(send());
    await settle();
    expect(box()).toHaveValue('Also the header.');
    expect(foot().getByRole('alert')).toHaveTextContent('Not sent: Something broke.');
  });

  it('each message shows where it is: sent, read, being answered; a cancelled one shows no row; at most three, older ones folded', async () => {
    const o = open({ move: null, patch: { run: RUNNING }, post: steerPost() });
    steerEvent(o.app, 'a', 'One.', 'queued');
    expect(steerRows()).toEqual(['One. Sent · the Foreman reads it at its next step']);
    steerEvent(o.app, 'a', 'One.', 'delivered');
    expect(steerRows()).toEqual(['One. Read by the Foreman']);
    steerEvent(o.app, 'a', 'One.', 'acted-on');
    expect(steerRows()).toEqual(['One. The Foreman is answering it']);
    expect(document.querySelector('.jp2-mb-steer-words')).toHaveAttribute('title', 'One.');
    steerEvent(o.app, 'b', 'Two.', 'cancelled');
    expect(steerRows()).toHaveLength(1);
    for (const id of ['c', 'd', 'e']) steerEvent(o.app, id, `${id}.`, 'queued');
    expect(steerRows()).toHaveLength(3);
    expect(document.querySelector('.jp2-mb-steer-more')).toHaveTextContent('+1 earlier');
    // The reply ends: the rows go.
    act(() => { o.app.dispatch({ type: 'event', event: { v: 2, type: 'run', job: SLUG, seq: 999999, data: { id: 'run-now', slug: SLUG, status: 'done' } } } as never); });
    expect(document.querySelector('.jp2-mb-steers')).toBeNull();
  });

  it('unanswered: the words come back to the box once, with a line saying so', async () => {
    const o = open({ move: null, patch: { run: RUNNING }, post: steerPost() });
    type('Also the header.');
    fireEvent.click(send());
    await settle();
    const id = Object.keys(o.app.getState().steers)[0]!;
    type('And the footer.');
    act(() => { o.app.dispatch({ type: 'event', event: { v: 2, type: 'run', job: SLUG, seq: 999999, data: { id: 'run-now', slug: SLUG, status: 'done' } } } as never); });
    steerEvent(o.app, id, 'Also the header.', 'unanswered');
    expect(box()).toHaveValue('Also the header.\n\nAnd the footer.');
    expect(document.querySelector('.jp2-mb-line')).toHaveTextContent('The reply ended before the Foreman answered your last message. Its words are back in the box.');
    type('');
    steerEvent(o.app, 'other', 'x', 'queued');
    expect(box()).toHaveValue('');
  });

  it('a second fast click sends once', async () => {
    let answer: (v: unknown) => void = () => {};
    const post = vi.fn((_path: string, _body?: unknown) => new Promise((r) => { answer = r; }));
    open({ move: null, patch: { run: RUNNING }, post });
    type('Also the header.');
    fireEvent.click(send());
    fireEvent.click(send());
    type('More.');
    fireEvent.click(send());
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => { answer({ steer: { id: 'z', runId: 'run-now', slug: SLUG, text: 'Also the header.', state: 'queued' } }); });
  });
});
