// Your move (Task 9): the card that asks him for a decision, with a fast yes (R1). Built on the
// made-up long job (a gate with two questions, the recommended options a and a, 13 decided for him,
// two of them still open). The body Go sends is compared with today's gate card's, rendered.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { DecidedItem, Gate, JobDetail, Permission } from '../../api/types';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { UiProvider } from '../../app/ui';
import { clearAllSent, useSent } from '../../lib/sentState';
import { GateSlot } from '../../panes/Foreman/GateCard';
import { clearGateSent, gateSentKey } from '../../panes/Foreman/gateSent';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job as jobRow, LEVELS, snapshot } from '../../state/test-fixtures';
import { longJob } from '../fixtures/longJob';
import { createJobStore, type JobStore } from '../jobStore';
import { JobPage2 } from '../JobPage2';
import { forgetRecentPages } from '../recent';
import type { GateMove, JobPagePayload, Move, PermissionMove, QuestionMove } from '../types';
import { forgetSentGo } from './YourMove';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const payload = () => clone(longJob.payload) as unknown as JobPagePayload;
const GATE = () => payload().move as GateMove;

interface Opened { store: JobStore; app: Store; post: ReturnType<typeof vi.fn>; unmount(): void; serve(p: JobPagePayload): void }

/** The page with a store already holding the payload (with `patch`), and a client whose post is `post`. */
function open({ move, patch = {}, post = vi.fn(async (): Promise<unknown> => ({ ok: true, sent: true, text: 'ok', run: { id: 'r1' } })), permissions = [], hosted = false }: {
  move?: Move | null; patch?: Partial<JobPagePayload>; post?: ReturnType<typeof vi.fn>; permissions?: Permission[]; hosted?: boolean;
} = {}): Opened {
  const p = { ...payload(), ...patch };
  if (move !== undefined) p.move = move;
  window.history.replaceState(null, '', `/#/job/${SLUG}`);
  let served: JobPagePayload | null = null;
  const store = createJobStore(SLUG, {
    api: { page: async () => served ?? { same: true as const, v: p.v }, item: async (_slug, id) => { const b = longJob.bodies[id]; if (!b) throw new Error('Starbase answered 404.'); return { ...b, version: String(b.meta.hash ?? b.id) }; } },
    events: () => () => {}, viewer: () => null, initial: p,
  });
  const app = createStore();
  app.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [], permissions }) });
  const api = { get: vi.fn(), post, hosted: () => hosted } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ api, store: app }}><JobPage2 slug={SLUG} job={null} store={store} /></WorkshopContext.Provider>);
  return { store, app, post, unmount: utils.unmount, serve: (next) => { served = next; } };
}

const card = () => document.querySelector<HTMLElement>('.jp2-ym')!;
const go = () => within(card()).getByRole('button', { name: /^Go/ });
const radios = (q: string) => within(within(card()).getByRole('group', { name: q })).getAllByRole('radio');
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const key = (k: string, target: Element = document.body, mods: { metaKey?: boolean } = {}) => act(() => { fireEvent.keyDown(target, { key: k, ...mods }); });
const goBodyOf = (post: ReturnType<typeof vi.fn>) => {
  const calls = post.mock.calls.filter((c) => String(c[0]).endsWith('/gate'));
  return calls.map((c) => JSON.stringify(c[1]));
};
const Q1 = '1. Open PR #1 now, or try the export on a copy of last week first?';
const Q2 = '2. Keep the commits as they are, or squash them into one?';

let offKeys: () => void = () => {};
beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  forgetRecentPages(); forgetSentGo(); offKeys = installKeyListener(); resetChord();
});
afterEach(() => { offKeys(); vi.unstubAllGlobals(); localStorage.clear(); clearAllSent(); clearGateSent(); window.history.replaceState(null, '', '/'); });

describe('a gate', () => {
  it('shows the ask once, each question with its options, recommended on the Foreman’s pick, Your own answer last; the recommended ones are picked and Go is awake', () => {
    open();
    const ask = GATE().ask;
    expect(screen.getAllByText(ask)).toHaveLength(1);
    for (const q of [Q1, Q2]) {
      const rows = radios(q);
      expect(rows.map((r) => r.closest('label')!.textContent)).toEqual(
        q === Q1 ? ['a. Open PR #1 nowrecommendedThe org branch has it today', 'b. Try last week firstAbout half a day later', 'Your own answer']
          : ['a. Keep themrecommended', 'b. Squash into oneOne commit to read', 'Your own answer'],
      );
      expect(rows[0]).toBeChecked();
      expect(rows[1]).not.toBeChecked();
    }
    expect(go()).toBeEnabled();
    expect(go()).toHaveTextContent('Go · all recommended');
  });

  it('a change says Go · 1 changed; picking the recommended one again says all recommended; Your own answer opens a line and needs words', () => {
    const { store } = open();
    fireEvent.click(radios(Q2)[1]);
    expect(go()).toHaveTextContent('Go · 1 changed');
    fireEvent.click(radios(Q1)[1]);
    expect(go()).toHaveTextContent('Go · 2 changed');
    fireEvent.click(radios(Q1)[0]);
    fireEvent.click(radios(Q2)[0]);
    expect(go()).toHaveTextContent('Go · all recommended');
    // Your own answer: a one-line field under the question; Go waits for words.
    fireEvent.click(radios(Q2)[2]);
    const field = within(card()).getByRole('textbox', { name: 'Your own answer to question 2' });
    expect(field).toHaveFocus();
    expect(go()).toBeDisabled();
    expect(card()).toHaveTextContent('Question 2 has no answer. Pick one, or write your own.');
    fireEvent.change(field, { target: { value: 'Squash the fixups only' } });
    expect(go()).toBeEnabled();
    expect(go()).toHaveTextContent('Go · 1 changed');
    // The picks live in the store, for this gate only.
    expect(store.getState().ui).toMatchObject({ picksFor: 'gate:15', picks: { 2: '__own' }, own: { 2: 'Squash the fixups only' } });
  });

  it('↑ ↓ move through the options and Space picks; ⌘↵ is Go from anywhere, the message box too; a is Go but never while typing', async () => {
    const { post } = open();
    key('ArrowDown');
    expect(radios(Q1)[0]).toHaveFocus();
    key('ArrowDown', document.activeElement!);
    key('ArrowDown', document.activeElement!);
    key('ArrowDown', document.activeElement!);
    expect(radios(Q2)[0]).toHaveFocus();
    key('ArrowDown', document.activeElement!);
    key(' ', document.activeElement!);
    expect(radios(Q2)[1]).toBeChecked();
    expect(go()).toHaveTextContent('Go · 1 changed');
    key('ArrowUp', document.activeElement!);
    expect(radios(Q2)[0]).toHaveFocus();
    // a in the message box is a letter.
    const box = screen.getByRole('textbox', { name: 'Message to the Foreman' });
    box.focus();
    key('a', box);
    expect(post).not.toHaveBeenCalled();
    // ⌘↵ in the message box is Go.
    key('Enter', box, { metaKey: true });
    await settle();
    expect(goBodyOf(post)).toHaveLength(1);
    expect(JSON.parse(goBodyOf(post)[0]).answers).toEqual({ 1: { choice: 'a' }, 2: { choice: 'b' } });
  });

  it('a from the page is Go', async () => {
    const { post } = open();
    key('a');
    await settle();
    expect(goBodyOf(post)).toHaveLength(1);
  });

  it('n decided for you · confirmed by Go, and Look opens the decisions in the reader', () => {
    const { store } = open();
    expect(card()).toHaveTextContent('13 decided for you · confirmed by Go');
    fireEvent.click(within(card()).getByRole('button', { name: 'Look' }));
    expect(store.getState().ui.reader).toEqual({ kind: 'decisions', id: 'decisions' });
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/decisions/decisions`);
  });

  it('Go shows Sent at once, sends once however fast he clicks, and carries the message box’s words as the note', async () => {
    let answer: (v: unknown) => void = () => {};
    const post = vi.fn(() => new Promise((r) => { answer = r; }));
    const { store } = open({ post });
    act(() => { store.setDraft('Mind the totals row.'); });
    const button = go();
    fireEvent.click(button);
    fireEvent.click(button);
    key('Enter', document.body, { metaKey: true });
    key('a');
    expect(card()).toHaveTextContent('Sent · the Foreman is reading your answers');
    expect(within(card()).queryByRole('button', { name: /^Go/ })).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.parse(goBodyOf(post)[0]).note).toBe('Mind the totals row.');
    // The words went with Go: the box is empty.
    expect(store.getState().ui.draft).toBe('');
    await act(async () => { answer({ ok: true, sent: true, text: 'ok', run: { id: 'r1' } }); });
    expect(card()).toHaveTextContent('Sent · the Foreman is reading your answers');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('a refusal puts the picks and the words back, with the reason in plain words', async () => {
    const cases: [unknown, RegExp][] = [
      [new ApiError(409, 'Claude’s five-hour limit is reached (it resets around 3:00 PM). …', { code: 'limited' }), /Not sent: Claude’s usage limit is reached/],
      [new ApiError(409, 'This job’s Foreman was last used in your terminal.', { code: 'terminal' }), /Not sent: this job’s Foreman was last used in your terminal/],
      [new ApiError(409, 'The spec or plan changed…', { code: 'stale-gate' }), /Not sent: the spec or plan changed since this was shown/],
      [new ApiError(409, 'The Foreman has moved on to brief 16…', { code: 'stale-brief', briefNumber: 16 }), /Not sent: the Foreman has moved on to a newer brief/],
      [new TypeError('Failed to fetch'), /Couldn’t reach Starbase\. Try again\./],
    ];
    for (const [err, words] of cases) {
      forgetSentGo();
      const post = vi.fn(async () => { throw err; });
      const { store, unmount } = open({ post });
      act(() => { store.setDraft('Mind the totals row.'); });
      fireEvent.click(radios(Q2)[1]);
      fireEvent.click(go());
      await settle();
      expect(card().textContent, String(err)).toMatch(words);
      expect(radios(Q2)[1]).toBeChecked();
      expect(go()).toHaveTextContent('Go · 1 changed');
      expect(store.getState().ui.draft).toBe('Mind the totals row.');
      unmount();
    }
  });

  it('the terminal open in the repository: a refusal asks him to confirm, and the next Go says so', async () => {
    const post = vi.fn()
      .mockRejectedValueOnce(new ApiError(409, 'Claude Code is open…', { code: 'terminal-open', terminals: 1 }))
      .mockResolvedValueOnce({ ok: true, sent: true, text: 'ok' });
    open({ post });
    fireEvent.click(go());
    await settle();
    fireEvent.click(within(card()).getByRole('checkbox', { name: 'None of the open terminals is this job’s Foreman' }));
    fireEvent.click(go());
    await settle();
    expect(JSON.parse(goBodyOf(post)[1]).confirmNoTerminal).toBe(true);
  });

  it('the Foreman still working, held for the limit, queued on the website: each says so in one line', async () => {
    const busy = open({ post: vi.fn(async () => ({ ok: true, sent: false, queued: false, text: 'x', message: 'The Foreman is still working on a reply, so nothing was sent. Send this text once the reply is done.' })) });
    fireEvent.click(go());
    await settle();
    // The page's own words: the server's "Send this text once the reply is done" names text this page never placed.
    expect(card()).toHaveTextContent('Not sent: the Foreman is still working on a reply. Your picks are kept; Go again when it finishes.');
    expect(card()).not.toHaveTextContent('Send this text');
    expect(go()).toBeEnabled();
    busy.unmount();
    forgetSentGo();
    const held = open({ post: vi.fn(async () => ({ ok: true, sent: false, held: true, resetsAt: '2026-11-13T15:00:00Z', message: 'Held: it goes to the Foreman when Claude’s usage limit resets (around 3:00 PM).' })) });
    fireEvent.click(go());
    await settle();
    expect(card()).toHaveTextContent('Held: it goes to the Foreman when Claude’s usage limit resets');
    expect(within(card()).queryByRole('button', { name: /^Go/ })).toBeNull();
    held.unmount();
    forgetSentGo();
    open({ hosted: true, post: vi.fn(async () => ({ queued: { id: 'q1' } })) });
    fireEvent.click(go());
    await settle();
    expect(card()).toHaveTextContent('Queued for your laptop: it goes to the Foreman when the laptop picks it up.');
  });

  it('a stale gate or a job held elsewhere keeps Go off and says why; with the limit reached, Go after the reset carries startAfterReset', async () => {
    const stale = open({ move: { ...GATE(), stale: true } });
    expect(go()).toBeDisabled();
    expect(card()).toHaveTextContent('The spec or plan changed since this was shown. Read the new version, then decide.');
    stale.unmount();
    const held = open({ patch: { lock: { owner: 'terminal', pid: 4242, acquiredAt: '2026-11-13T10:00:00Z' } as never } });
    expect(go()).toBeDisabled();
    expect(card()).toHaveTextContent('Another place is working on this job. Only one place can work on a job at a time.');
    held.unmount();
    const { post } = open({ patch: { usage: { limited: true, resetsAt: '2026-11-13T15:00:00Z', label: 'five-hour limit', line: null } } });
    fireEvent.click(within(card()).getByRole('button', { name: 'Go after the reset' }));
    await settle();
    expect(JSON.parse(goBodyOf(post)[0]).startAfterReset).toBe(true);
  });

  it('the job changing under him keeps his picks; a new brief starts from its own recommended picks', async () => {
    const { store, serve } = open();
    fireEvent.click(radios(Q2)[1]);
    const box = within(card()).getByRole('radio', { name: /Squash into one/ });
    // Same gate, a newer payload (a new line in the conversation): the pick stays, the row is the same element.
    const now = store.getState().payload!;
    serve({ ...now, v: now.v + 1, thread: [...now.thread, { ...now.thread[now.thread.length - 1], id: 'reply:new', hash: 'abcabcabcabc' }] });
    await act(async () => { await store.loadPage(); });
    expect(store.getState().payload!.v).toBe(now.v + 1);
    expect(radios(Q2)[1]).toBeChecked();
    expect(radios(Q2)[1]).toBe(box);
    expect(go()).toHaveTextContent('Go · 1 changed');
    // Brief 16 with the same question ids: the recommended ones again.
    serve({ ...now, v: now.v + 2, move: { ...GATE(), brief: 16, ask: 'Brief 16 waits' } });
    await act(async () => { await store.loadPage(); });
    expect(radios(Q2)[0]).toBeChecked();
    expect(go()).toHaveTextContent('Go · all recommended');
  });
});

describe('the body is byte for byte today’s card’s', () => {
  // Today's card, rendered with the same gate as status.json gives it: the old GateSlot, its own
  // radios and box, and its Approve button. Its post's body is compared with Go's for the same picks.
  function oldGate(move: GateMove): Gate {
    const open = new Set(move.openDecisions);
    const decided: DecidedItem[] = Array.from({ length: move.decided }, (_, i) => {
      const id = `D-${String(i + 1).padStart(3, '0')}`;
      return { id, decision: `Decision ${i + 1}`, reason: null, where: null, confirmed: !open.has(id) };
    });
    return {
      briefNumber: move.brief, briefFile: 'briefs/015-review.md', headline: move.ask, stage: move.stage, nextStage: move.nextStage, nextProposed: null,
      questions: move.questions.map((q) => ({ id: q.id, text: q.text, recommendation: q.options.find((o) => o.recommended)?.id ?? null, options: q.options.map((o) => ({ id: o.id, label: o.label, consequence: o.consequence })) })),
      decided, versions: null, raisedVersions: null, stale: false, waitingSince: move.since, runActive: false, parked: false,
      level: 3, suggestedLevel: null, levelReason: null, usage: null,
    } as Gate;
  }

  function oldCard(pick: (card: HTMLElement) => void): string {
    const move = GATE();
    const gate = oldGate(move);
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', levels: LEVELS }, jobs: [jobRow('alpha', 'needs-you', { level: 3, waitingFor: 'approval' })] }) });
    const post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true, sent: true, text: 'ok' }));
    const api = { get: vi.fn(), post } as unknown as ApiClient;
    const detail = {
      slug: 'alpha', thread: [], threadMore: false, options: { level: 3 }, statusForCompose: { questions: gate.questions, decidedOnYourBehalf: gate.decided, brief: { number: 15 } },
      drive: { mode: 'workshop' }, gate, answeredBriefs: [], heldReply: null,
    } as unknown as JobDetail;
    const utils = render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><GateSlot job={store.getState().jobs[0]} detail={detail} now={new Date()} reload={() => {}} /></UiProvider></WorkshopContext.Provider>);
    const el = document.querySelector<HTMLElement>('.gate-card')!;
    pick(el);
    fireEvent.click(el.querySelector<HTMLButtonElement>('[data-gate="approve"]')!);
    utils.unmount();
    clearAllSent(); clearGateSent();
    const call = post.mock.calls.find((c) => String(c[0]).endsWith('/gate'));
    if (!call) throw new Error('Today’s card sent nothing.');
    return JSON.stringify(call[1]);
  }

  async function newCard(pick: () => void): Promise<string> {
    forgetSentGo();
    const { post, unmount } = open();
    pick();
    fireEvent.click(go());
    await settle();
    unmount();
    return goBodyOf(post)[0];
  }

  it('the recommended picks', async () => {
    const old = oldCard(() => {});
    const now = await newCard(() => {});
    expect(now).toBe(old);
    expect(now).toBe('{"kind":"approve","briefNumber":15,"answers":{"1":{"choice":"a"},"2":{"choice":"a"}},"verdicts":{"D-012":{"verdict":"confirm"},"D-013":{"verdict":"confirm"}},"chips":[]}');
  });

  it('one changed and one in his own words', async () => {
    const old = oldCard((el) => {
      fireEvent.click(within(el).getAllByRole('radio')[1]);
      fireEvent.click(el.querySelectorAll('fieldset.gate-question')[1].querySelector<HTMLInputElement>('input[value="__other"]')!);
      fireEvent.change(within(el).getByRole('textbox', { name: 'Your own answer to question 2' }), { target: { value: '  Squash the fixups only ' } });
    });
    const now = await newCard(() => {
      fireEvent.click(radios(Q1)[1]);
      fireEvent.click(radios(Q2)[2]);
      fireEvent.change(within(card()).getByRole('textbox', { name: 'Your own answer to question 2' }), { target: { value: '  Squash the fixups only ' } });
    });
    expect(now).toBe(old);
    expect(now).toContain('"1":{"choice":"b"},"2":{"other":"Squash the fixups only"}');
  });
});

describe('a free-text ask', () => {
  const ASK: QuestionMove = { kind: 'question', ask: 'Can you smoke test it first?', since: '2026-11-13T12:03:00.000Z', quick: ['smoke ok, 1 yes, 2 yes', 'smoke failed'], itemId: 'reply:q1' };

  it('shows the quoted replies as quick replies that fill the message box and send nothing', () => {
    const { store, post } = open({ move: ASK });
    expect(card()).toHaveTextContent('Can you smoke test it first?');
    fireEvent.click(within(card()).getByRole('button', { name: '“smoke failed”' }));
    expect(store.getState().ui.draft).toBe('smoke failed');
    // Another replaces a quick reply; his own words are kept, the reply goes under them.
    fireEvent.click(within(card()).getByRole('button', { name: '“smoke ok, 1 yes, 2 yes”' }));
    expect(store.getState().ui.draft).toBe('smoke ok, 1 yes, 2 yes');
    act(() => { store.setDraft('Checked on the phone too.'); });
    fireEvent.click(within(card()).getByRole('button', { name: '“smoke failed”' }));
    expect(store.getState().ui.draft).toBe('Checked on the phone too.\nsmoke failed');
    expect(post).not.toHaveBeenCalled();
  });
});

describe('a permission', () => {
  const PUSH: PermissionMove = {
    kind: 'permission', id: 'p2', card: 'permission', what: 'The Foreman wants to push the branch to your fork', command: 'git push -u fork feature/crew-export',
    questions: null, risk: 'low', since: '2026-11-13T12:31:00.000Z', canAllowForRun: false, hardLine: false, defaultToNo: false, canAlwaysAllow: true,
  };
  const FULL: Permission = {
    id: 'p2', slug: SLUG, kind: 'tool', toolName: 'Bash', input: { command: 'git push -u fork feature/crew-export' }, plain: { headline: 'Push the branch to your fork' },
    draft: { tool: 'Bash', options: [{ kind: 'exact', value: 'git push -u fork feature/crew-export' }, { kind: 'prefix', value: 'git push -u fork' }] },
  } as Permission;

  it('takes the slot with the exact command and Allow once, Deny, Always allow…; Allow once answers at once', async () => {
    const { post } = open({ move: PUSH });
    expect(card()).toHaveTextContent('The Foreman wants to push the branch to your fork');
    expect(within(card()).getByText('git push -u fork feature/crew-export')).toBeInTheDocument();
    expect(within(card()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Allow oncea', 'Deny', 'Always allow…']);
    expect(within(card()).queryByRole('button', { name: /Allow for this run/ })).toBeNull();
    fireEvent.click(within(card()).getByRole('button', { name: /^Allow once/ }));
    expect(card()).toHaveTextContent('Allowed once');
    await settle();
    expect(post).toHaveBeenCalledWith('/api/permissions/p2', { decision: 'allow' });
  });

  it('a is Allow once; Deny says no; a refusal brings the calls back with the reason', async () => {
    const first = open({ move: PUSH });
    key('a');
    await settle();
    expect(first.post).toHaveBeenCalledWith('/api/permissions/p2', { decision: 'allow' });
    first.unmount();
    const denied = open({ move: PUSH });
    fireEvent.click(within(card()).getByRole('button', { name: 'Deny' }));
    expect(card()).toHaveTextContent('Denied · the Foreman was told no');
    await settle();
    expect(denied.post).toHaveBeenCalledWith('/api/permissions/p2', { decision: 'deny' });
    denied.unmount();
    open({ move: PUSH, post: vi.fn(async () => { throw new ApiError(404, 'That request is no longer waiting.'); }) });
    fireEvent.click(within(card()).getByRole('button', { name: /^Allow once/ }));
    await settle();
    expect(card()).toHaveTextContent('That request is no longer waiting.');
    expect(within(card()).getByRole('button', { name: /^Allow once/ })).toBeEnabled();
  });

  it('Allow for this run only where Claude Code offers it; a hard line or a risky step has no Always allow and no key', async () => {
    const run = open({ move: { ...PUSH, canAllowForRun: true } });
    fireEvent.click(within(card()).getByRole('button', { name: 'Allow for this run' }));
    await settle();
    expect(run.post).toHaveBeenCalledWith('/api/permissions/p2', { decision: 'allow-run' });
    run.unmount();
    for (const flags of [{ hardLine: true, canAllowForRun: true }, { defaultToNo: true }, { risk: 'high' }]) {
      const o = open({ move: { ...PUSH, ...flags } });
      if (!('risk' in flags)) expect(within(card()).queryByRole('button', { name: 'Always allow…' }), JSON.stringify(flags)).toBeNull();
      expect(within(card()).queryByRole('button', { name: 'Allow for this run' })).toBeNull();
      key('a');
      await settle();
      expect(o.post, JSON.stringify(flags)).not.toHaveBeenCalled();
      o.unmount();
    }
  });

  it('Always allow… opens today’s sheet, which saves the rule with POST /api/rules', async () => {
    const { post } = open({ move: PUSH, permissions: [FULL] });
    fireEvent.click(within(card()).getByRole('button', { name: 'Always allow…' }));
    const sheet = screen.getByRole('dialog', { name: 'Always allow' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(sheet).getByRole('button', { name: /Save rule and allow/ }));
    await settle();
    expect(post).toHaveBeenCalledWith('/api/rules', { rule: { tool: 'Bash', kind: 'exact', value: 'git push -u fork feature/crew-export' }, permissionId: 'p2' });
  });

  it('a crew question: its options, your own words, Send answers', async () => {
    const q: PermissionMove = { ...PUSH, id: 'p3', card: 'question', what: 'The Tester asks which browser', command: null, canAlwaysAllow: false, questions: [{ question: 'Which browser?', options: [{ label: 'Chrome' }, { label: 'Safari' }] }] };
    const { post } = open({ move: q });
    const send = within(card()).getByRole('button', { name: 'Send answers' });
    expect(send).toBeDisabled();
    fireEvent.click(within(card()).getByRole('radio', { name: 'Safari' }));
    fireEvent.click(send);
    await settle();
    expect(post).toHaveBeenCalledWith('/api/permissions/p3', { decision: 'allow', answers: { 'Which browser?': 'Safari' } });
  });
});

describe('when the job does not wait', () => {
  it('the slot is one line', () => {
    open({ move: null, patch: { state: 'working', stateLine: 'Builder on step 4 of 8 · 12 min' } });
    expect(card().children).toHaveLength(1);
    expect(card()).toHaveTextContent('Working · Builder on step 4 of 8 · 12 min');
    expect(within(card()).queryByRole('button')).toBeNull();
  });
});

describe('Task 9 fix round 1: Sent always ends', () => {
  /** A newer payload with the run (and anything else) given, landed through the store. */
  async function land(o: Opened, patch: Partial<JobPagePayload>) {
    const now = o.store.getState().payload!;
    o.serve({ ...now, ...patch, v: now.v + 1 });
    await act(async () => { await o.store.loadPage(); });
  }
  const run = (id: string, status: string) => ({ id, status, startedAt: '2026-11-13T12:00:00.000Z', lastAction: null });
  const SENT = 'Sent · the Foreman is reading your answers';

  it('the accepted run ends and the same gate still waits: the card comes back with Go awake', async () => {
    const o = open({ post: vi.fn(async () => ({ ok: true, sent: true, text: 'ok', run: { id: 'r1' } })) });
    fireEvent.click(go());
    await settle();
    await land(o, { run: run('r1', 'running') });
    expect(card()).toHaveTextContent(SENT);
    await land(o, { run: run('r1', 'error') });
    expect(go()).toBeEnabled();
    expect(go()).toHaveTextContent('Go · all recommended');
  });

  it('a newer run (a resume, a message) with the same gate still waiting: the card comes back', async () => {
    const o = open({ patch: { run: run('r0', 'done') }, post: vi.fn(async () => ({ ok: true, sent: true, text: 'ok', run: { id: 'r1' } })) });
    fireEvent.click(go());
    await settle();
    // The run seen at the click (r0) and the accepted one (r1) keep it Sent.
    await land(o, { run: run('r1', 'stopping') });
    expect(card()).toHaveTextContent(SENT);
    await land(o, { run: run('r2', 'running') });
    expect(go()).toBeEnabled();
  });

  it('a new brief after Sent: a fresh card for it, Go awake', async () => {
    const o = open();
    fireEvent.click(go());
    await settle();
    expect(card()).toHaveTextContent(SENT);
    await land(o, { move: { ...GATE(), brief: 16, ask: 'Brief 16 waits' } });
    expect(card()).toHaveTextContent('Brief 16 waits');
    expect(go()).toHaveTextContent('Go · all recommended');
    expect(go()).toBeEnabled();
  });

  it('held for the limit: over once the held reply is gone with no run; a run it starts keeps it Sent until that run ends', async () => {
    const held = { ok: true, sent: false, held: true, resetsAt: '2026-11-13T15:00:00Z', message: 'Held: it goes to the Foreman when Claude’s usage limit resets (around 3:00 PM).' };
    const dropped = open({ post: vi.fn(async () => held) });
    fireEvent.click(go());
    await settle();
    // Not shown as held yet: kept.
    await land(dropped, { heldReply: null });
    expect(card()).toHaveTextContent('Held: it goes to the Foreman');
    await land(dropped, { heldReply: { kind: 'approve', gateBrief: 15, at: '2026-11-13T12:00:00Z' } });
    expect(card()).toHaveTextContent('Held: it goes to the Foreman');
    await land(dropped, { heldReply: null });
    expect(go()).toBeEnabled();
    dropped.unmount();
    forgetSentGo();
    const released = open({ post: vi.fn(async () => held) });
    fireEvent.click(go());
    await settle();
    await land(released, { heldReply: { kind: 'approve', gateBrief: 15, at: '2026-11-13T12:00:00Z' } });
    await land(released, { heldReply: null, run: run('r9', 'running') });
    expect(card()).toHaveTextContent(SENT);
    await land(released, { run: run('r9', 'done') });
    expect(go()).toBeEnabled();
  });

  it('queued on the website: the run the laptop starts is this Go’s; when it ends with the gate still there, the card comes back', async () => {
    const o = open({ hosted: true, post: vi.fn(async () => ({ queued: { id: 'q1' } })) });
    fireEvent.click(go());
    await settle();
    expect(card()).toHaveTextContent('Queued for your laptop');
    await land(o, { run: run('r5', 'running') });
    expect(card()).toHaveTextContent(SENT);
    await land(o, { run: run('r5', 'stopped') });
    expect(go()).toBeEnabled();
  });

  it('marks the shared gate send, so today’s card, the old bar and the Desk grey out too; a refusal clears it', async () => {
    let answer: (v: unknown) => void = () => {};
    const Probe = () => <i data-testid="shared">{useSent(gateSentKey(SLUG)).state}</i>;
    render(<Probe />);
    const o = open({ post: vi.fn(() => new Promise((r) => { answer = r; })) });
    fireEvent.click(go());
    expect(screen.getByTestId('shared')).toHaveTextContent('sending');
    await act(async () => { answer({ ok: true, sent: true, text: 'ok', run: { id: 'r1' } }); });
    expect(screen.getByTestId('shared')).toHaveTextContent('sent');
    await land(o, { run: run('r1', 'done') });
    expect(screen.getByTestId('shared')).toHaveTextContent('idle');
    o.unmount();
    forgetSentGo();
    open({ post: vi.fn(async () => { throw new ApiError(409, 'x', { code: 'limited' }); }) });
    fireEvent.click(go());
    await settle();
    expect(screen.getByTestId('shared')).toHaveTextContent('idle');
  });

  it('a refusal gives Go the focus back; the next brief starts without the last one’s line or terminal tick', async () => {
    const post = vi.fn(async () => { throw new ApiError(409, 'Claude Code is open…', { code: 'terminal-open', terminals: 1 }); });
    const o = open({ post });
    fireEvent.click(go());
    await settle();
    expect(go()).toHaveFocus();
    fireEvent.click(within(card()).getByRole('checkbox', { name: 'None of the open terminals is this job’s Foreman' }));
    await land(o, { move: { ...GATE(), brief: 16, ask: 'Brief 16 waits' } });
    expect(within(card()).queryByRole('checkbox')).toBeNull();
    expect(card()).not.toHaveTextContent('Not sent');
  });

  it('↑ ↓ in the reader stay the reader’s; a busy answer is said plainly; any other refusal names the server’s words', async () => {
    const reader = screen.queryByRole('region', { name: 'Reader', hidden: true });
    expect(reader).toBeNull();
    const busy = open({ post: vi.fn(async () => { throw new ApiError(409, 'The Foreman is still working on your last message.', { code: 'busy' }); }) });
    const region = screen.getByRole('region', { name: 'Reader' });
    region.focus();
    key('ArrowDown', region);
    expect(document.activeElement).toBe(region);
    fireEvent.click(go());
    await settle();
    expect(card()).toHaveTextContent('Not sent: the Foreman is still working on a reply.');
    busy.unmount();
    forgetSentGo();
    open({ post: vi.fn(async () => { throw new ApiError(409, 'Starbase is being restarted. Try again in a moment.'); }) });
    fireEvent.click(go());
    await settle();
    expect(card()).toHaveTextContent('Not sent: Starbase is being restarted. Try again in a moment.');
  });
});
