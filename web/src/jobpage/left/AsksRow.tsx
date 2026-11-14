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
//     laptop picks it up there). A refusal puts its words in the box and says why.
//     One timer only, and only while an ask is pending: a second ask sends the first one now.
//     Leaving the page sends a pending ask now (he asked for it).
//   - needs a word: its text goes in the box with the cursor in the gap; nothing is sent.
//   - Go faster: not a message. It reads the job's options (GET /api/job/:slug), posts them back with
//     one reviewer a round and no second looks (POST …/options, from the next step), and says what
//     it switched, with Undo for four seconds: Undo posts back the options it replaced.
//
// The row never changes height: the `Sent · Undo` line lies over it. On a laptop the row shows only
// the asks that fit beside ⌘K (the prototype's fit; the rest are in ⌘K); on the phone it scrolls
// sideways and has no ⌘K.

import { memo, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { ApiError, type ApiClient } from '../../api/client';
import type { Job, JobDetail, JobOptions, OptionsResult } from '../../api/types';
import { BRAND } from '../../app/brand';
import { paletteKeyLabel, pressKey } from '../../app/keyRegistry';
import { Button } from '../../components/Button';
import { useWorkshop } from '../../state/store';
import { askSays, fastOptions, fillGap, rowFor, type Ask } from '../asks';
import { withWordsBack, type JobStore } from '../jobStore';
import { useJob, useJobStore } from '../useJob';
import { stepsFromRow } from './Steps';
import { sendRefusal } from './MessageBox';
import '../asks.css';

/** How long an ask is held (and its line shown) before it goes. */
export const HOLD_MS = 4000;

/** What the row says over itself: Sent · Undo, what Go faster switched, or why something did not go. */
export interface AskLine { words: string; undo: boolean; problem: boolean }

export interface AskRunner {
  getState(): AskLine | null;
  subscribe(listener: () => void): () => void;
  /** Run an ask from the row or ⌘K. */
  run(a: Ask): void;
  /** Undo what the line offers to undo. */
  undo(): void;
  /** Take a problem line away. */
  dismiss(): void;
  /** The page goes: a pending ask goes now; the timer ends. */
  destroy(): void;
}

const UNREACHABLE = `Couldn’t reach ${BRAND.name}. Try again.`;
const LOCKED = `Not sent: another place is working on this job (a terminal, or another ${BRAND.name}).`;
export const SENT = 'Sent';
export const BACK_TO_OWN = 'Back to the job’s own options';
export const ALREADY_FAST = 'Already fast: 1 reviewer, no second looks';

const failure = (err: unknown) => (err instanceof TypeError ? UNREACHABLE : err instanceof Error ? err.message : String(err));

export interface AskRunnerDeps {
  api: ApiClient;
  store: JobStore;
  /** The message box: an ask that needs a word fills it. */
  box: RefObject<HTMLTextAreaElement | null>;
}

export function createAskRunner({ api, store, box }: AskRunnerDeps): AskRunner {
  let line: AskLine | null = null;
  const listeners = new Set<() => void>();
  const say = (next: AskLine | null) => { line = next; for (const l of [...listeners]) l(); };
  /** The one timer: an ask held before it goes, or Go faster's line before it goes away. */
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The ask held now, or null. */
  let held: string | null = null;
  /** What Undo does now (Go faster: put the options back). */
  let undoFast: (() => void) | null = null;
  let ended = false;
  const slug = () => store.getState().slug;
  const path = (tail: string) => `/api/job/${encodeURIComponent(slug())}${tail}`;

  const clear = () => { if (timer !== null) clearTimeout(timer); timer = null; };

  /** The words go now. */
  async function post(text: string) {
    const hosted = store.getState().payload?.hosted === true;
    try {
      await api.post(path('/send'), { kind: 'message', text, ...(hosted ? {} : { queue: true }) });
    } catch (err) {
      if (ended) return;
      store.setDraft(withWordsBack(store.getState().ui.draft, text));
      say({ words: sendRefusal(err), problem: true, undo: false });
    }
  }

  /** A held ask goes now (a second ask, or the page going). */
  function flush() {
    const text = held;
    held = null;
    clear();
    if (text !== null) void post(text);
  }

  function hold(text: string) {
    flush();
    undoFast = null;
    held = text;
    say({ words: SENT, undo: true, problem: false });
    timer = setTimeout(() => {
      timer = null;
      const t = held;
      held = null;
      say(null);
      if (t !== null) void post(t);
    }, HOLD_MS);
  }

  /** A line that goes away by itself after HOLD_MS, on the same timer. */
  function brief(next: AskLine) {
    clear();
    say(next);
    timer = setTimeout(() => { timer = null; undoFast = null; say(null); }, HOLD_MS);
  }

  function fill(text: string) {
    const { draft, cursor } = fillGap(store.getState().ui.draft, text);
    flushSync(() => store.setDraft(draft));
    // c and i: under 1100 px it takes the reader off the left pane; the box takes the focus.
    pressKey('jp-write');
    const el = box.current;
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    el.setSelectionRange(cursor, cursor);
  }

  async function goFaster() {
    flush();
    undoFast = null;
    const kind = store.getState().payload?.kind ?? null;
    let was: JobOptions;
    let at: string | null;
    try {
      const detail = await api.get<JobDetail>(path(''));
      if (!detail?.options) { say({ words: 'Not switched: this job has no options yet.', problem: true, undo: false }); return; }
      was = detail.options;
      at = typeof was.updated_at === 'string' ? was.updated_at : null;
    } catch (err) {
      if (!ended) say({ words: `Not switched: ${failure(err)}`, problem: true, undo: false });
      return;
    }
    if (ended) return;
    const fast = fastOptions(was, kind);
    if (!fast.says) { brief({ words: ALREADY_FAST, undo: false, problem: false }); return; }
    let r: OptionsResult;
    try {
      r = await api.post<OptionsResult>(path('/options'), { options: fast.options, updated_at: at });
    } catch (err) {
      if (ended) return;
      say({ words: err instanceof ApiError && err.body.code === 'options-changed' ? 'Not switched: the options changed elsewhere just now. Try again.' : `Not switched: ${failure(err)}`, problem: true, undo: false });
      return;
    }
    if (ended) return;
    const now = typeof r?.updated_at === 'string' ? r.updated_at : null;
    brief({ words: fast.says, undo: true, problem: false });
    undoFast = () => {
      clear();
      say(null);
      void api.post<OptionsResult>(path('/options'), { options: was, updated_at: now }).then(
        () => { if (!ended) brief({ words: BACK_TO_OWN, undo: false, problem: false }); },
        (err) => { if (!ended) say({ words: `Not put back: ${failure(err)}`, problem: true, undo: false }); },
      );
    };
  }

  return {
    getState: () => line,
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    run(a) {
      if (a.needsWord) { fill(a.text); return; }
      // Go faster changes the options, which another place working on the job does not stop.
      if (a.kind === 'fast') { void goFaster(); return; }
      if (store.getState().payload?.lock) { flush(); say({ words: LOCKED, problem: true, undo: false }); return; }
      hold(a.text);
    },
    undo() {
      if (held !== null) { held = null; clear(); say(null); return; }
      const u = undoFast;
      undoFast = null;
      u?.();
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

/** The page's runner: made once, ended (a pending ask sent) when the page goes. */
export function useAskRunner(box: RefObject<HTMLTextAreaElement | null>): AskRunner {
  const { api } = useWorkshop();
  const store = useJobStore();
  const made = useRef<AskRunner | null>(null);
  if (!made.current) made.current = createAskRunner({ api, store, box });
  const [runner, setRunner] = useState(made.current);
  useEffect(() => {
    // StrictMode's test unmount ended it: a new one.
    if (made.current === null) { made.current = createAskRunner({ api, store, box }); setRunner(made.current); }
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
}

export const AsksRow = memo(function AsksRow({ runner, job, phone = false, lead = null }: AsksRowProps) {
  const step = useJob((s) => s.ui.step ?? (s.payload ? s.payload.steps : stepsFromRow(job)).find((x) => x.state === 'current')?.id ?? null);
  const locked = useJob((s) => Boolean(s.payload?.lock));
  const line = useSyncExternalStore(runner.subscribe, runner.getState, runner.getState);
  const row = rowFor(step, lead);
  const [tip, setTip] = useState<Ask | null>(null);
  const tipId = useId();
  return (
    <div className="jp2-asks" role="group" aria-label="Asks">
      <div className="jp2-asks-in">
        <AskButtons key={row.map((a) => a.id).join(' ')} row={row} phone={phone} locked={locked} tipId={tipId} tip={tip} onTip={setTip} runner={runner} />
        {!phone && (
          <Button kind="quiet" size="sm" className="jp2-asks-more" onClick={() => pressKey('jp-palette')} title={`Every ask and the page’s places, with a search field (${paletteKeyLabel()}).`}>
            {paletteKeyLabel()}
          </Button>
        )}
      </div>
      {line && (
        <div className={`jp2-asks-msg${line.problem ? ' is-problem' : ''}`} role={line.problem ? 'alert' : 'status'}>
          <span className="jp2-asks-mt" title={line.words}>{line.words}</span>
          {line.undo && (
            <>
              <span aria-hidden="true">·</span>
              <Button kind="quiet" size="sm" className="jp2-asks-undo" onClick={() => runner.undo()} title={line.words === SENT ? 'Take it back before it goes: nothing is sent.' : 'Put back the options it replaced.'}>Undo</Button>
            </>
          )}
          {line.problem && <Button kind="quiet" size="sm" className="jp2-asks-hide" onClick={() => runner.dismiss()} title="Hide this line.">Hide</Button>}
        </div>
      )}
      {tip && (
        <div className="jp2-asks-tip" role="tooltip" id={tipId}>
          <span className="jp2-asks-says">{askSays(tip)}</span> {tip.text}
        </div>
      )}
    </div>
  );
});

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
    widths.current = [...el.children].map((c) => (c as HTMLElement).offsetWidth);
    const gap = parseFloat(getComputedStyle(el).columnGap) || 4;
    const measure = () => {
      const room = el.clientWidth;
      const ws = widths.current;
      if (!room || !ws || ws.every((w) => !w)) return;
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
