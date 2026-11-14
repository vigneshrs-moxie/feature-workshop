// The asks row (R6): at most four asks above the message box, fitted to the open step (asks.ts), and
// ⌘K for all of them and the page's places (Palette.tsx). No hidden prompts: hovering (or focusing)
// an ask shows the exact text it sends.
//
// What an ask does (the runner below, shared by the row and ⌘K):
//   - nothing to fill in: the row says `Sent · Undo` at once and the ask is held for four seconds;
//     Undo in that time cancels it before it leaves. Then it goes as a message to the Foreman
//     (POST /api/job/:slug/send). On this computer it goes with `queue: true`, so while the Foreman
//     works it waits for the reply to end like a typed message (Task 16; the box shows it with
//     Cancel), and with nothing running it goes at once. The website sends it as a message (the
//     laptop picks it up there: the row says `Queued for your laptop` and the store watches it, so
//     its words come back to the box if it ends without running). On the website while the Foreman
//     works, an ask is like a typed message there: its words stay in the box. A refusal puts its
//     words in the box and says why.
//     One timer only: a second ask within the four seconds is held with the first (`Sent 2 · Undo`,
//     the timer starts again) and Undo takes back both; held asks go together, as one message.
//     Leaving the page sends held asks now (he asked for them). Go faster's line sends held asks
//     first, so its Undo is only ever the options'.
//     On the phone (no hover) the line shows the held words: `Sent: “…” · Undo`.
//   - needs a word: its text goes in the box with the cursor in the gap; nothing is sent.
//   - Go faster: not a message. It reads the job's options (GET /api/job/:slug), posts them back with
//     one reviewer a round and no second looks (POST …/options, from the next step), and says what
//     it switched, with Undo for four seconds: Undo posts back the options it replaced.
//   - Pull PR comments (Task 22): not a message. GitHub is read now, as the PR view's Pull now does
//     (POST …/pr/1/pull), and the reader opens the newest open PR (the pull requests when none is
//     open). A failed read says why in the row.
//   - Mark done (Task 22): not a message. It opens the same Mark done sheet the header's ⋯ menu opens
//     (never marks in one click); while the Foreman replies, or on a job already marked, it says why.
//
// Asks drawn outside the row (AsksInPlace: the hand test's `It works` and `Something is wrong…`, R7) run
// through the same runner (AsksContext) and follow the same rules: hover or focus shows the exact
// text, and the line they cause (Sent · Undo) shows in place under them too.
//
// The row never changes height: the `Sent · Undo` line lies over it. On a laptop the row shows only
// the asks that fit beside ⌘K (the prototype's fit; the rest are in ⌘K); on the phone it scrolls
// sideways and has no ⌘K.

import { createContext, memo, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { ApiError, type ApiClient } from '../../api/client';
import type { Job, JobDetail, JobOptions, OptionsResult } from '../../api/types';
import { BRAND } from '../../app/brand';
import { paletteKeyLabel, pressKey } from '../../app/keyRegistry';
import { useUi, type SheetState } from '../../app/ui';
import { Button } from '../../components/Button';
import { useWorkshop, type Store } from '../../state/store';
import { askSays, fastOptions, fillGap, joinAsks, rowFor, type Ask } from '../asks';
import { withWordsBack, type JobStore } from '../jobStore';
import type { ReaderTarget } from '../types';
import { useJob, useJobStore } from '../useJob';
import { stepsFromRow } from './Steps';
import { sendRefusal } from './MessageBox';
import { SHIP } from './PrLines';
import '../asks.css';

/** How long an ask is held (and its line shown) before it goes. */
export const HOLD_MS = 4000;
/** Asks held together go at the latest this long after the first click, */
export const HOLD_MAX_MS = 8000;
/** or as soon as this many are held. */
export const HOLD_MAX_ASKS = 4;

/**
 * What the row says over itself: Sent · Undo (with the held words, `held`), what Go faster switched,
 * or why something did not go. `undo`: what Undo takes back ('held' asks, or Go faster's 'options').
 */
export interface AskLine { words: string; undo: 'held' | 'options' | null; problem: boolean; held?: string[] }

export interface AskRunner {
  getState(): AskLine | null;
  subscribe(listener: () => void): () => void;
  /** Run an ask from the row or ⌘K. */
  run(a: Ask): void;
  /** Undo what the line offers to undo. */
  undo(): void;
  /** Take a problem line away. */
  dismiss(): void;
  /** The page goes: held asks go now; the timer ends. */
  destroy(): void;
}

const UNREACHABLE = `Couldn’t reach ${BRAND.name}. Try again.`;
const LOCKED = `Not sent: another place is working on this job (a terminal, or another ${BRAND.name}).`;
export const SENT = 'Sent';
export const BACK_TO_OWN = 'Back to the job’s own options';
export const ALREADY_FAST = 'Already fast: 1 reviewer, no second looks';
/** The website: the ask waits for the laptop (the message box's words). */
export const QUEUED = 'Queued for your laptop: it goes to the Foreman when the laptop picks it up.';
/** The website while the Foreman works: like a typed message there, the words stay in the box. */
export const KEPT = 'Kept in the box, not sent: the Foreman is working. Press Send when it finishes.';
/** Mark done while the Foreman replies (the ⋯ menu's words). */
export const DONE_RUNNING = 'The Foreman is replying. Stop the reply first, then mark the job.';
/** Mark done on a job already marked done or dropped. */
export const DONE_ALREADY = 'Already marked done or dropped. Reopen it from the ⋯ menu.';
/** Mark done before the job's page has loaded (whether it runs or is marked is not known yet). */
export const DONE_LOADING = 'Still loading the job. Try Mark done again in a moment.';
/** The run statuses that mean the Foreman is replying right now (as MessageBox's ACTIVE). */
const ACTIVE = new Set(['starting', 'running', 'waiting_permission', 'stopping']);

const failure = (err: unknown) => (err instanceof TypeError ? UNREACHABLE : err instanceof Error ? err.message : String(err));

/** Why an ask did not go, in the box's words; the two that point at the box's own controls say what to do instead. */
export function askRefusal(err: unknown): string {
  const code = err instanceof ApiError ? err.body.code : null;
  if (code === 'terminal-open') return 'Not sent: Claude Code is open in this repository in a terminal. The ask’s words are in the box: press Send there to say whether one of those windows is this job’s Foreman.';
  if (code === 'waiting') return 'Not sent: a message is already waiting for the Foreman. The ask’s words are in the box: send them once it has gone, or cancel the waiting one.';
  return sendRefusal(err);
}

export interface AskRunnerDeps {
  api: ApiClient;
  store: JobStore;
  /** The message box: an ask that needs a word fills it. */
  box: RefObject<HTMLTextAreaElement | null>;
  /** Whether the Foreman is replying now (the app's live run, else the payload's). */
  running?: () => boolean;
  /** The clock (tests). */
  now?: () => number;
  /** Open something in the reader (Pull PR comments opens the PR). */
  open?: (t: ReaderTarget) => void;
  /** Open one of the app's sheets (Mark done opens the Mark done sheet). */
  openSheet?: (s: SheetState) => void;
}

export function createAskRunner({ api, store, box, running = () => false, now: clock = () => Date.now(), open, openSheet }: AskRunnerDeps): AskRunner {
  let line: AskLine | null = null;
  const listeners = new Set<() => void>();
  const say = (next: AskLine | null) => { line = next; for (const l of [...listeners]) l(); };
  /** The one timer: the asks held before they go, or a short line before it goes away. */
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The asks held now, in the order he clicked them (they go together, as one message). */
  let held: { label: string; text: string }[] = [];
  /** When the first of them was clicked. */
  let firstAt = 0;
  /** What Undo does for Go faster's line (put the options back). */
  let undoFast: (() => void) | null = null;
  let ended = false;
  const slug = () => store.getState().slug;
  const path = (tail: string) => `/api/job/${encodeURIComponent(slug())}${tail}`;
  const hosted = () => store.getState().payload?.hosted === true;

  const clear = () => { if (timer !== null) clearTimeout(timer); timer = null; };

  /** The words go now. */
  async function post(text: string) {
    let r: { queued?: unknown } | null;
    try {
      r = await api.post<{ queued?: unknown }>(path('/send'), { kind: 'message', text, ...(hosted() ? {} : { queue: true }) });
    } catch (err) {
      // Words never lost, even after the page went: they are the box's kept draft.
      store.setDraft(withWordsBack(store.getState().ui.draft, text));
      if (!ended) say({ words: askRefusal(err), problem: true, undo: null });
      return;
    }
    // The website: it waits for the laptop. Watched, so its words come back if it ends without running.
    const q = r && typeof r === 'object' ? (r.queued as { id?: unknown } | undefined) : undefined;
    if (q) {
      if (typeof q === 'object' && typeof q.id === 'string') store.watchQueued(q.id, text);
      // Only when nothing else is said: Go faster's line keeps its Undo.
      if (!ended && line === null) brief({ words: QUEUED, undo: null, problem: false });
    }
  }

  /** Held asks go now (Go faster, the cap, or the page going): one message; their Undo goes with them. */
  function flush() {
    const asks = held;
    held = [];
    clear();
    if (line?.undo === 'held') say(null);
    if (asks.length) void post(joinAsks(asks));
  }

  function hold(label: string, text: string) {
    // The same ask twice within the hold goes once.
    if (held.some((h) => h.text === text)) return;
    // The cap: four held, the fifth starts a new hold after they go.
    if (held.length >= HOLD_MAX_ASKS) flush();
    clear();
    undoFast = null;
    if (!held.length) firstAt = clock();
    held = [...held, { label, text }];
    say({ words: held.length > 1 ? `${SENT} ${held.length}` : SENT, undo: 'held', problem: false, held: held.map((h) => h.text) });
    // One timer: the newest ask restarts it, so each has its four seconds of Undo, but never past
    // eight seconds from the first click.
    const wait = Math.max(0, Math.min(HOLD_MS, firstAt + HOLD_MAX_MS - clock()));
    timer = setTimeout(() => {
      timer = null;
      const asks = held;
      held = [];
      // Only its own line: a refusal said meanwhile stays.
      if (line?.undo === 'held') say(null);
      if (asks.length) void post(joinAsks(asks));
    }, wait);
  }

  /** A line that goes away by itself after HOLD_MS, on the same timer (never while asks are held). */
  function brief(next: AskLine) {
    if (held.length) return;
    clear();
    say(next);
    timer = setTimeout(() => { timer = null; undoFast = null; if (line === next) say(null); }, HOLD_MS);
  }

  function fill(text: string, cursorAt?: number) {
    const { draft, cursor } = fillGap(store.getState().ui.draft, text);
    flushSync(() => store.setDraft(draft));
    // c and i: under 1100 px it takes the reader off the left pane; the box takes the focus.
    pressKey('jp-write');
    const el = box.current;
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    const at = cursorAt === undefined ? cursor : draft.length;
    el.setSelectionRange(at, at);
  }

  async function goFaster() {
    flush();
    undoFast = null;
    const kind = store.getState().payload?.kind ?? null;
    let was: JobOptions;
    let at: string | null;
    try {
      const detail = await api.get<JobDetail>(path(''));
      if (!detail?.options) { if (!ended) { flush(); say({ words: 'Not switched: this job has no options yet.', problem: true, undo: null }); } return; }
      was = detail.options;
      at = typeof was.updated_at === 'string' ? was.updated_at : null;
    } catch (err) {
      if (!ended) { flush(); say({ words: `Not switched: ${failure(err)}`, problem: true, undo: null }); }
      return;
    }
    if (ended) return;
    const fast = fastOptions(was, kind);
    // An ask clicked while this ran goes now: the line is Go faster's, and so is its Undo.
    if (!fast.says) { flush(); brief({ words: ALREADY_FAST, undo: null, problem: false }); return; }
    let r: OptionsResult;
    try {
      r = await api.post<OptionsResult>(path('/options'), { options: fast.options, updated_at: at });
    } catch (err) {
      if (ended) return;
      flush();
      say({ words: err instanceof ApiError && err.body.code === 'options-changed' ? 'Not switched: the options changed elsewhere just now. Try again.' : `Not switched: ${failure(err)}`, problem: true, undo: null });
      return;
    }
    if (ended) return;
    flush();
    const now = typeof r?.updated_at === 'string' ? r.updated_at : null;
    undoFast = () => {
      clear();
      say(null);
      void api.post<OptionsResult>(path('/options'), { options: was, updated_at: now }).then(
        () => { if (!ended) brief({ words: BACK_TO_OWN, undo: null, problem: false }); },
        (err) => { if (!ended) say({ words: `Not put back: ${failure(err)}`, problem: true, undo: null }); },
      );
    };
    brief({ words: fast.says, undo: 'options', problem: false });
  }

  /** Pull PR comments: GitHub is read now (the PR view's Pull now), and the newest open PR opens. */
  function pull() {
    if (hosted()) return;
    const live = [...(store.getState().payload?.prs ?? [])].reverse().find((l) => l.state === 'open' || l.state === 'draft');
    api.post(path('/pr/1/pull'), {}).catch((err: unknown) => { if (!ended) say({ words: `Not read: ${failure(err)}`, problem: true, undo: null }); });
    open?.(live ? { kind: 'pr', id: String(live.n) } : SHIP);
  }

  /** Mark done: the ⋯ menu's Mark done sheet, on the same terms as the menu. */
  function markDone() {
    const p = store.getState().payload;
    if (hosted()) return;
    if (!p) { say({ words: DONE_LOADING, problem: true, undo: null }); return; }
    if (p.closed) { say({ words: DONE_ALREADY, problem: true, undo: null }); return; }
    if (running()) { say({ words: DONE_RUNNING, problem: true, undo: null }); return; }
    openSheet?.({ kind: 'close-job', slug: slug(), worktree: p.local?.worktree ?? null });
  }

  return {
    getState: () => line,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    run(a) {
      if (a.kind === 'pull') { pull(); return; }
      if (a.kind === 'mark-done') { markDone(); return; }
      if (a.needsWord) { fill(a.text); return; }
      // Go faster changes the options, which another place working on the job does not stop.
      if (a.kind === 'fast') { void goFaster(); return; }
      if (store.getState().payload?.lock) { say({ words: LOCKED, problem: true, undo: null }); return; }
      // The website can't keep a message waiting: while the Foreman works the words stay in the box, as typed ones do.
      if (hosted() && running()) { fill(a.text, -1); brief({ words: KEPT, undo: null, problem: false }); return; }
      hold(a.label, a.text);
    },
    undo() {
      if (line?.undo === 'held' && held.length) { held = []; clear(); say(null); return; }
      if (line?.undo === 'options') { const u = undoFast; undoFast = null; u?.(); }
    },
    dismiss() { if (line?.problem) say(null); },
    destroy() {
      flush();
      ended = true;
      clear();
      listeners.clear();
    },
  };
}

/** Whether the Foreman is replying now: the app's live run when it is the payload's (or the payload names none), else the payload's. */
function runningNow(app: Store, store: JobStore): boolean {
  const s = store.getState();
  const live = app.getState().runs[s.slug] ?? null;
  const p = s.payload?.run ?? null;
  const on = (r: { status?: string | null } | null) => Boolean(r && ACTIVE.has(r.status ?? ''));
  // As the message box's runNow: the live run when it is the payload's (or the payload names none),
  // or when it is replying and the payload's is not; else the payload's.
  const run = live && (!p || !p.id || live.id === p.id) ? live : p && live && on(live) && !on(p) ? live : p ?? live;
  return on(run);
}

/** The page's runner: made once, ended (held asks sent) when the page goes. `open`: the page's reader pick. */
export function useAskRunner(box: RefObject<HTMLTextAreaElement | null>, open?: (t: ReaderTarget) => void): AskRunner {
  const { api, store: app } = useWorkshop();
  const store = useJobStore();
  const ui = useUi();
  // The runner is made once; what it opens is read when it runs.
  const to = useRef({ open, sheet: ui.openSheet });
  useLayoutEffect(() => { to.current = { open, sheet: ui.openSheet }; });
  const make = () => createAskRunner({
    api, store, box, running: () => runningNow(app, store),
    open: (t) => to.current.open?.(t),
    openSheet: (s) => to.current.sheet(s),
  });
  const made = useRef<AskRunner | null>(null);
  if (!made.current) made.current = make();
  const [runner, setRunner] = useState(made.current);
  useEffect(() => {
    // StrictMode's test unmount ended it: a new one.
    if (made.current === null) { made.current = make(); setRunner(made.current); }
    const mine = made.current;
    return () => { mine.destroy(); made.current = null; };
  }, []);
  return runner;
}

export interface AsksRowProps {
  runner: AskRunner;
  /** The Jobs snapshot's row (the first paint's open step, before the payload lands). */
  job: Job | null;
  phone?: boolean;
  /** Tasks 20 and 22: the PR's next action, first in the row while the Ship step is not open. */
  lead?: Ask | null;
  /** What the lead's click does instead of sending (Task 20: opens the PR's line with what will go; left/PrLines.tsx). */
  onLead?: (a: Ask) => void;
}

export const AsksRow = memo(function AsksRow({ runner, job, phone = false, lead = null, onLead }: AsksRowProps) {
  const step = useJob((s) => s.ui.step ?? (s.payload ? s.payload.steps : stepsFromRow(job)).find((x) => x.state === 'current')?.id ?? null);
  const locked = useJob((s) => Boolean(s.payload?.lock));
  const hosted = useJob((s) => s.payload?.hosted === true);
  const line = useSyncExternalStore(runner.subscribe, runner.getState, runner.getState);
  const row = rowFor(step, lead, hosted);
  const [tip, setTip] = useState<Ask | null>(null);
  const tipId = useId();
  // The lead never sends from the row: its click opens what it will do first (two clicks, as on its line).
  const press: AskRunner = lead && onLead ? { ...runner, run: (a: Ask) => (a.id === lead.id ? onLead(a) : runner.run(a)) } : runner;
  return (
    <div className="jp2-asks" role="group" aria-label="Asks">
      <div className="jp2-asks-in">
        <AskButtons key={row.map((a) => a.id).join(' ')} row={row} phone={phone} locked={locked} tipId={tipId} tip={tip} onTip={setTip} runner={press} />
        {!phone && (
          <Button kind="quiet" size="sm" className="jp2-asks-more" onClick={() => pressKey('jp-palette')} title={`Every ask and the page’s places, with a search field (${paletteKeyLabel()}).`}>
            {paletteKeyLabel()}
          </Button>
        )}
      </div>
      {line && <AskLineView key={`${line.words}|${(line.held ?? []).join('|')}`} line={line} phone={phone} runner={runner} />}
      {tip && (
        <div className="jp2-asks-tip" role="tooltip" id={tipId}>
          <span className="jp2-asks-says">{askSays(tip)}</span> {tip.text}
        </div>
      )}
    </div>
  );
});

/** The page's runner and whether it is the phone, for asks drawn outside the row (AsksInPlace). */
export const AsksContext = createContext<{ runner: AskRunner; phone: boolean } | null>(null);

const noSubscribe = () => () => {};
const noLine = () => null;

/**
 * Asks drawn in place, outside the row (the hand test's `It works` and `Something is wrong…`, R7): the
 * page's runner, the row's rules. Hovering or focusing one shows the exact text it sends; the line its
 * click causes (Sent · Undo, or why it did not go) shows here under them as well as in the row, so it is
 * seen where he clicked (the row may be under the reader). Off without the page's runner.
 */
export function AsksInPlace({ asks, primary, className }: { asks: Ask[]; primary?: string; className?: string }) {
  const ctx = useContext(AsksContext);
  const runner = ctx?.runner ?? null;
  const locked = useJob((s) => Boolean(s.payload?.lock));
  const line = useSyncExternalStore(runner?.subscribe ?? noSubscribe, runner?.getState ?? noLine, runner?.getState ?? noLine);
  const [tip, setTip] = useState<Ask | null>(null);
  const tipId = useId();
  /** The line shown is one these asks caused, until it goes. */
  const [mine, setMine] = useState(false);
  useEffect(() => { if (!line) setMine(false); }, [line]);
  return (
    <div className={`jp2-asks-here${className ? ` ${className}` : ''}`}>
      {asks.map((a) => (
        <Button
          key={a.id}
          kind={a.id === primary ? 'primary' : 'secondary'}
          size="sm"
          disabled={!runner || (locked && a.kind === 'send' && !a.needsWord)}
          title={runner ? undefined : `${askSays(a)} ${a.text}`}
          aria-describedby={tip?.id === a.id ? tipId : undefined}
          onMouseEnter={() => setTip(a)}
          onMouseLeave={() => setTip(null)}
          onFocus={() => setTip(a)}
          onBlur={() => setTip(null)}
          onClick={() => { setTip(null); if (!a.needsWord) setMine(true); runner?.run(a); }}
        >
          {a.label}
        </Button>
      ))}
      {mine && line && runner && <AskLineView key={`${line.words}|${(line.held ?? []).join('|')}`} line={line} phone={ctx?.phone ?? false} runner={runner} />}
      {tip && (
        <div className="jp2-asks-tip" role="tooltip" id={tipId}>
          <span className="jp2-asks-says">{askSays(tip)}</span> {tip.text}
        </div>
      )}
    </div>
  );
}

/**
 * The row's line. On the phone (no hover) a held ask's exact words are in it: `Sent: “…” · Undo`,
 * cut to one line; a tap on them shows them whole.
 */
function AskLineView({ line, phone, runner }: { line: AskLine; phone: boolean; runner: AskRunner }) {
  const [whole, setWhole] = useState(false);
  const quote = phone && line.held?.length ? line.held.join(' · ') : null;
  return (
    <div className={`jp2-asks-msg${line.problem ? ' is-problem' : ''}${whole ? ' is-whole' : ''}`} role={line.problem ? 'alert' : 'status'}>
      <span className="jp2-asks-mt" title={quote ? undefined : line.words}>{line.words}{quote ? ':' : ''}</span>
      {quote && (
        <button type="button" className="jp2-asks-quote" aria-expanded={whole} onClick={() => setWhole((w) => !w)} title="Show the whole text this sends.">
          “{quote}”
        </button>
      )}
      {line.undo && (
        <>
          <span aria-hidden="true">·</span>
          <Button kind="quiet" size="sm" className="jp2-asks-undo" onClick={() => runner.undo()} title={line.undo === 'held' ? 'Take it back before it goes: nothing is sent.' : 'Put back the options it replaced.'}>Undo</Button>
        </>
      )}
      {line.problem && <Button kind="quiet" size="sm" className="jp2-asks-hide" onClick={() => runner.dismiss()} title="Hide this line.">Hide</Button>}
    </div>
  );
}

interface AskButtonsProps {
  row: Ask[];
  phone: boolean;
  locked: boolean;
  tipId: string;
  tip: Ask | null;
  onTip(a: Ask | null): void;
  runner: AskRunner;
}

/** The row's asks. On a laptop only the ones that fit are shown (measured once per row, then on a resize). */
function AskButtons({ row, phone, locked, tipId, tip, onTip, runner }: AskButtonsProps) {
  const fit = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(row.length);
  /** Each ask's width, measured while all of them were shown. */
  const widths = useRef<number[] | null>(null);
  useLayoutEffect(() => {
    const el = fit.current;
    if (phone || !el) return undefined;
    const read = () => { widths.current = [...el.children].map((c) => (c as HTMLElement).offsetWidth); };
    read();
    const gap = parseFloat(getComputedStyle(el).columnGap) || 4;
    const measure = () => {
      const room = el.clientWidth;
      if (!room) return;
      // A row first drawn hidden measured nothing: measure the asks when it first shows (all of them
      // are still shown then, since nothing was fitted).
      if (!widths.current || widths.current.every((w) => !w)) read();
      const ws = widths.current;
      if (!ws || ws.every((w) => !w)) return;
      let used = 0;
      let n = 0;
      for (const w of ws) {
        const next = used + (n ? gap : 0) + w;
        if (n > 0 && next > room) break;
        used = next;
        n++;
      }
      setFits(n);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phone]);
  return (
    <div ref={fit} className="jp2-asks-fit">
      {row.map((a, i) => (
        <Button
          key={a.id}
          kind="secondary"
          size={phone ? 'md' : 'sm'}
          className="jp2-askb"
          hidden={!phone && i >= fits}
          disabled={locked && a.kind === 'send' && !a.needsWord}
          aria-describedby={tip?.id === a.id ? tipId : undefined}
          onMouseEnter={() => onTip(a)}
          onMouseLeave={() => onTip(null)}
          onFocus={() => onTip(a)}
          onBlur={() => onTip(null)}
          onClick={() => { onTip(null); runner.run(a); }}
        >
          {a.label}
        </Button>
      ))}
    </div>
  );
}
