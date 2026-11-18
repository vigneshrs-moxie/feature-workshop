// The message box (Task 11, R8): one box, docked at the foot of the left pane, always there. It grows
// with its words to eight lines, then scrolls (the stylesheet: field-sizing; a browser without it
// gets the height set here). There is one place to write, and what the words do depends on the call:
//   - with Go (Your move), they are the approval's note;
//   - with Send back (Your move), they are the change;
//   - alone, with Send, they are a message to the Foreman (POST /api/job/:slug/send).
// No Reply mode and no Steer button: Send itself goes into a running reply.
//
// The draft lives in the page's store, which keeps it under the old page's key (fw.draft.<slug>), so
// a refresh, a step pick, a permission card, a width change and a reload all find the same words.
//
// Send shows `Sent` at once and empties the box; a refusal puts the words back (before anything
// typed since) with the server's reason in plain words. It sends once however fast he clicks.
// While a reply runs, Send goes into that reply (talk any time, 18 Nov): on the laptop it posts the
// words to POST /api/runs/:id/steer and the Foreman reads them at its next step, as he can butt in at
// any moment in the terminal. The box says `Write to the Foreman… it reads this at its next step`. Under
// the box, each message sent into this reply shows where it is (the app's steers: sent, read by the
// Foreman, being answered; at most three, older ones folded), and goes when the reply ends. The reply
// ending before he was answered (`unanswered`) puts the words back in the box once, with a line saying
// so; a message the Foreman never read (`cancelled`) the server keeps as the job's waiting message and
// sends when the reply ends, so the waiting block below shows it. The reply having ended meanwhile (404
// finished) sends the words as a plain message; a reply that is stopping (409) makes them wait instead.
// `Stop it and send now` is the interrupt: it sits beside the box in the same row (on the phone, with no
// room in the row, on its own line above the box: Task 15). On the job page the line above the box
// (NowLine) has the one stop control instead (`stopElsewhere`): the box leaves its row to the words and
// hands the same action to that line (pressStopAndSend). A message waits for the Foreman (Task 16,
// R8): Stop it and send now posts it with `queue: true` and the server keeps it (one per job,
// lib/queued.js) and sends it when the reply ends. Its words show under the box at once, with `Cancel`
// (POST …/waiting/cancel; the words come back to the box). A second one is refused naming the first:
// `Replace it` sends with `replace: true`. When it was time to send and the server still said no (the
// usage limit, the terminal), the payload's `waiting.why` says so in its place. `Stop it and send now`
// makes the words wait, then stops the reply (POST /api/runs/:id/stop): the server sends them as it ends.
// The website cannot keep a message waiting or reach a running reply (its decisions wait for the laptop
// instead): there the waiting message shows read-only, Send while a reply runs keeps the words in the box
// (`Sends when it finishes`), and `Stop it and
// send now` stops the reply, then sends the words once the run has ended (once more if the server still
// says busy right after; it gives up waiting after STOP_WAIT_MS with a plain line). At a go-ahead or a
// question the box says `Your own answer, or a message to the Foreman…` (the prototype's words).
// A message the website queues for the laptop that the site shows ended without being sent (failed,
// changed, ran out, cancelled) gives its words back to the box (jobStore watchQueued).
//
// Keys: c and i put the cursor here (the page's jp-write); ⌘↵ in the box is Go while a go-ahead
// waits (Your move's jp-go), else Send.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ClipboardEvent, type KeyboardEvent, type RefObject } from 'react';
import { ApiError } from '../../api/client';
import type { Steer } from '../../api/types';
import { BRAND } from '../../app/brand';
import { pressKey } from '../../app/keyRegistry';
import { Button } from '../../components/Button';
import { Choice } from '../../components/Choice';
import { useNarrow } from '../../components/page/Page';
import { useWorkshop } from '../../state/store';
import { withWordsBack, type PageNote } from '../jobStore';
import { backLabel, composeFor, sendLabel } from '../notes/chips';
import { NoteChips } from '../notes/NoteChips';
import { keepPasted, pastedPicture } from '../notes/Pins';
import type { ReaderTarget } from '../types';
import { useJob, useJobStore } from '../useJob';

/** The run statuses that mean the Foreman is replying right now (panes/Foreman/thread.ts ACTIVE). */
const ACTIVE = new Set(['starting', 'running', 'waiting_permission', 'stopping']);

export const PLACEHOLDER = 'Write to the Foreman…';
/** The prototype's short words (it sits beside Stop it and send now). */
export const WHILE_RUNNING = 'Sends when it finishes';
/** While a reply runs on the laptop: Send goes into it (talk any time), and its short form on the phone. */
export const INTO_REPLY = 'Write to the Foreman… it reads it at its next step';
const INTO_REPLY_SHORT = 'Message the Foreman…';
/** Where a message sent into the reply is (the app's steer states). */
export const STEER_WORDS: Partial<Record<Steer['state'], string>> = {
  queued: 'Sent · the Foreman reads it at its next step',
  delivered: 'Read by the Foreman',
  'acted-on': 'The Foreman is answering it',
};
/** The reply ended before the Foreman answered: the words are back in the box. */
export const UNANSWERED = 'The reply ended before the Foreman answered your last message. Its words are back in the box.';
/** At most this many messages sent into the reply show under the box (older ones fold). */
const STEER_ROWS = 3;
/** At a go-ahead or a question (the prototype's PHQ), and its short form on the phone. */
export const AT_ASK = 'Your own answer, or a message to the Foreman…';
const AT_ASK_SHORT = 'Message the Foreman…';
const AFTER_SENT = 'Sent. Write more to the Foreman…';
const AFTER_SENT_SHORT = 'Sent. Write more…';
/** How long Stop it and send now waits for the reply to end before it says so. */
export const STOP_WAIT_MS = 10_000;
/** A send right after a stop that the server still calls busy is tried once more after this. */
export const RETRY_AFTER_MS = 1_500;
const STOP_SLOW = 'The Foreman hasn’t stopped yet. Your words are still here: press Stop it and send now again, or Send once it finishes.';

const UNREACHABLE = `Couldn’t reach ${BRAND.name}. Try again.`;
const BUSY = 'Not sent: the Foreman is still working on a reply. Your words are back in the box; send them when it finishes, or Stop it and send now.';
// The website keeps the words in the box while the Foreman works (only the laptop keeps a message waiting).
const KEPT = 'Kept here, not sent. Press Send when the Foreman finishes, or Stop it and send now.';
/** Above the words that wait for the Foreman (the prototype's `queued · sends when the Foreman finishes`). */
export const WAITS = 'Sends when the Foreman finishes';
const GONE_ALREADY = 'It had already gone to the Foreman.';
/** The reply ended at a go-ahead or a question: the waiting words were moved into the box (fix round 1, M4). */
export const TO_BOX = 'Your waiting words are in the box: the Foreman is asking you something first.';
const LOCKED = `Another place is working on this job (a terminal, or another ${BRAND.name}). Only one place can work on a job at a time.`;

/** The server's no, in plain words. */
export function sendRefusal(err: unknown): string {
  if (err instanceof TypeError) return UNREACHABLE;
  const code = err instanceof ApiError ? err.body.code : null;
  if (code === 'limited') return 'Not sent: Claude’s usage limit is reached. Your words are back in the box; send them once it resets.';
  if (code === 'terminal') return 'Not sent: this job’s Foreman was last used in your terminal. Carry on there, or close it in the terminal and send again here.';
  if (code === 'terminal-open') return 'Not sent: Claude Code is open in this repository in a terminal. Tick the box below if none of those windows is this job’s Foreman, then send again.';
  if (code === 'job-locked') return `Not sent: ${LOCKED}`;
  if (err instanceof ApiError && err.status === 409 && !code) {
    // The server's 409s without a code (runner sendPlan), each in his words.
    if (isBusy(err)) return BUSY;
    if (/started again on another model/i.test(err.message)) return 'Not sent: this job is being started again on another model right now. Your words are back in the box; send them once that is done.';
    if (/marked done/i.test(err.message)) return 'Not sent: this job is being marked done right now. Your words are back in the box.';
  }
  return `Not sent: ${err instanceof Error ? err.message : String(err)}`;
}

/** A second message while one waits (409 code waiting): the first one's words, named. */
function secondRefusal(err: ApiError): string {
  const first = (err.body.waiting as { text?: unknown } | undefined)?.text;
  const words = typeof first === 'string' ? (first.length > 120 ? `${first.slice(0, 119)}…` : first) : null;
  return `Not sent: a message is already waiting for the Foreman${words ? `: “${words}”` : '.'} Replace it with these words, or cancel it first.`;
}
const isSecond = (err: unknown): err is ApiError => err instanceof ApiError && err.status === 409 && err.body.code === 'waiting';

/** The server's "the Foreman is still working" (a 409 with no code). */
const isBusy = (err: unknown) => err instanceof ApiError && err.status === 409 && !err.body.code && /still working/i.test(err.message);

type RunFacts = { id: string | null; status: string | null } | null;

type SteerRow = Pick<Steer, 'id' | 'runId' | 'text' | 'state'>;
/**
 * This job's messages sent into the runs in `runs`, oldest first, as one string: a string stays the same
 * value while nothing about them changes, so the box draws again only when one does (speed rule 5).
 */
function steersKey(steers: Record<string, Steer>, slug: string, runs: ReadonlySet<string>): string {
  if (!runs.size) return '';
  const mine: Steer[] = [];
  for (const k in steers) { const x = steers[k]; if (x && x.slug === slug && runs.has(x.runId)) mine.push(x); }
  if (!mine.length) return '';
  mine.sort((a, b) => String(a.queuedAt ?? '').localeCompare(String(b.queuedAt ?? '')));
  return JSON.stringify(mine.map((x): SteerRow => ({ id: x.id, runId: x.runId, text: x.text, state: x.state })));
}

/**
 * The run the Foreman is on, as fresh as the page can know it: the app's live run (the stream's
 * `run` events) when it is the payload's run or the payload names none, else the payload's.
 */
function runNow(live: RunFacts, p: RunFacts): RunFacts {
  if (live && (!p || !p.id || live.id === p.id)) return live;
  if (p && live && ACTIVE.has(live.status ?? '') && !ACTIVE.has(p.status ?? '')) return live;
  return p;
}

/** Where a browser can't size a box to its words: set its height here, up to eight lines. */
const FITS = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');
function fit(el: HTMLTextAreaElement) {
  if (FITS) return;
  if (!el.value) { el.style.height = ''; el.style.overflowY = ''; return; }
  el.style.height = 'auto';
  const most = parseFloat(getComputedStyle(el).maxHeight) || 172;
  const h = el.scrollHeight + 2;
  el.style.height = `${Math.min(h, most)}px`;
  el.style.overflowY = h > most ? 'auto' : 'hidden';
}

/** The boxes that left their Stop it and send now to the line above them (NowLine), by job. */
const stopHandlers = new Map<string, () => void>();
/** Stop it and send now for this job's box, from the line above it: false when no box has registered one. */
export function pressStopAndSend(slug: string): boolean {
  const h = stopHandlers.get(slug);
  if (!h) return false;
  h();
  return true;
}
/** The words Stop it and send now has on its button (the box's own, or the line above it). */
export const STOP_SEND_HINT = 'End the Foreman’s reply now, then send your words as soon as it has stopped. Anything waiting for your answer is declined.';

export interface MessageBoxProps {
  /** The page's handle on the box (c and i, quick replies and Send back put the cursor in it). */
  boxRef: RefObject<HTMLTextAreaElement | null>;
  /** Open something in the reader (a note's chip; a pasted picture, to pin on). */
  onOpen?(t: ReaderTarget, from?: HTMLElement | null): void;
  /**
   * The line above the box (NowLine) has the one stop control: the box shows no Stop it and send now of its
   * own and hands its action to that line (pressStopAndSend).
   */
  stopElsewhere?: boolean;
}

/** Notes taken out to go, back in the box after a refusal (before any made since). */
export function notesBack(now: PageNote[], taken: PageNote[]): PageNote[] {
  if (!taken.length) return now;
  return [...taken, ...now.filter((n) => !taken.some((t) => t.n === n.n))];
}

/** The run the Foreman is on now (runNow), for the box and for Your move's Stop (left/StopReply.tsx). */
export function useForemanRun(): RunFacts {
  const { store: app } = useWorkshop();
  const slug = useJob((s) => s.slug);
  // A run that has ended is told apart from none by its status alone: its id is read only while it runs, so a
  // reply arriving as its run ends does not draw the box again (speed rule 5).
  const payloadRunId = useJob((s) => (ACTIVE.has(s.payload?.run?.status ?? '') ? s.payload?.run?.id ?? null : null));
  const payloadRunStatus = useJob((s) => s.payload?.run?.status ?? null);
  const liveRunId = useSyncExternalStore(app.subscribe, () => app.getState().runs[slug]?.id ?? null);
  const liveRunStatus = useSyncExternalStore(app.subscribe, () => app.getState().runs[slug]?.status ?? null);
  const hasPayloadRun = useJob((s) => Boolean(s.payload?.run));
  const hasLiveRun = useSyncExternalStore(app.subscribe, () => Boolean(app.getState().runs[slug]));
  return runNow(hasLiveRun ? { id: liveRunId, status: liveRunStatus } : null, hasPayloadRun ? { id: payloadRunId, status: payloadRunStatus } : null);
}

/** The run statuses of a reply still going. */
export const RUN_ACTIVE: ReadonlySet<string> = ACTIVE;
export { LOCKED };

export const MessageBox = memo(function MessageBox({ boxRef, onOpen, stopElsewhere = false }: MessageBoxProps) {
  const store = useJobStore();
  const { api, store: app } = useWorkshop();
  const slug = useJob((s) => s.slug);
  const draft = useJob((s) => s.ui.draft);
  /** Notes pointed in the reader (R4): they go with the next Send (at a gate: Send back or Go). */
  const noteCount = useJob((s) => s.ui.notes.length);
  const gateWaits = useJob((s) => s.payload?.move?.kind === 'gate');
  const asked = useJob((s) => s.payload?.move?.kind === 'gate' || s.payload?.move?.kind === 'question');
  const locked = useJob((s) => Boolean(s.payload?.lock));
  const run = useForemanRun();
  const running = Boolean(run && ACTIVE.has(run.status ?? ''));
  const narrow = useNarrow();
  const hosted = useJob((s) => s.payload?.hosted === true);
  /** The run Send goes into now (the laptop, a reply running), else null. */
  const intoRun = running && !hosted ? run?.id ?? null : null;
  /** The runs this box has seen running: their messages' ends (unanswered) are watched after the run ends. */
  const seenRuns = useRef<Set<string>>(new Set());
  if (intoRun && !seenRuns.current.has(intoRun)) seenRuns.current = new Set([...seenRuns.current, intoRun]);
  const steerCache = useRef<{ steers: Record<string, Steer> | null; runs: ReadonlySet<string> | null; key: string }>({ steers: null, runs: null, key: '' });
  const steerKey = useSyncExternalStore(app.subscribe, () => {
    const steers = app.getState().steers;
    const c = steerCache.current;
    if (c.steers !== steers || c.runs !== seenRuns.current) steerCache.current = { steers, runs: seenRuns.current, key: steersKey(steers, slug, seenRuns.current) };
    return steerCache.current.key;
  });
  const steerList = useMemo<SteerRow[]>(() => (steerKey ? JSON.parse(steerKey) as SteerRow[] : []), [steerKey]);
  // Rows: this reply's messages, while it runs (a cancelled one shows as the waiting message instead).
  const steerRows = intoRun ? steerList.filter((x) => x.runId === intoRun && STEER_WORDS[x.state]) : [];
  const waitText = useJob((s) => s.payload?.waiting?.text ?? null);
  const waitWhy = useJob((s) => s.payload?.waiting?.why ?? null);
  const waitAt = useJob((s) => s.payload?.waiting?.at ?? null);
  const waitToBox = useJob((s) => s.payload?.waiting?.toBox === true);
  /**
   * What he made wait, shown at once, until a payload newer than the server's answer says how it stands
   * (`afterV`: the payload's v when the answer came; null: not answered yet). `cancelled` the same for Cancel.
   */
  const [mine, setMine] = useState<{ text: string; afterV: number | null } | null>(null);
  const [cancelled, setCancelled] = useState<{ afterV: number | null } | null>(null);
  const [stopping, setStopping] = useState(false);
  /** His Send on a message kept or held back: on its way (until a payload newer than the answer). */
  const [going, setGoing] = useState<{ afterV: number | null } | null>(null);
  // The payload's v, read only while something above waits on it: any other new payload (a line in the
  // conversation) does not draw the box (speed rule 5).
  const v = useJob((s) => (mine || cancelled || going ? s.payload?.v ?? 0 : -1));
  const vNow = () => store.getState().payload?.v ?? 0;
  const fresh = (x: { afterV: number | null } | null) => Boolean(x && (x.afterV === null || x.afterV === v));
  // The payload's message wins when it is the same words (it may carry a why the answer did not).
  const waits: { text: string; why: string | null; toBox: boolean } | null = fresh(cancelled) ? null
    : waitText && (!mine || mine.text === waitText) && !fresh(going) ? { text: waitText, why: waitWhy, toBox: waitToBox }
      : fresh(mine) ? { text: mine!.text, why: null, toBox: false }
        : waitText ? { text: waitText, why: fresh(going) ? null : waitWhy, toBox: waitToBox } : null;

  /**
   * sent: the last words went (Send says Sent until he types again); waiting: they are on their way to wait
   * for the Foreman; stopping (the website): Stop it and send now is waiting for the reply to end.
   */
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'waiting' | 'stopping'>('idle');
  /** replace: the line offers Replace it (a message already waits). */
  const [line, setLine] = useState<{ words: string; problem: boolean; replace?: boolean } | null>(null);
  const [askTerminal, setAskTerminal] = useState(false);
  const [noTerminal, setNoTerminal] = useState(false);
  const out = useRef(false);
  /** Words the store gave back from something the website queued that never ran (jobStore watchQueued). */
  const gaveBack = useJob((s) => s.gaveBack);
  /** The retry after a stop that is waiting, so leaving the page ends it and keeps the words. */
  const retry = useRef<{ timer: ReturnType<typeof setTimeout>; words: string } | null>(null);
  useEffect(() => () => {
    const r = retry.current;
    if (!r) return;
    clearTimeout(r.timer);
    retry.current = null;
    // Not sent: the words go back to the kept draft, so the page finds them next time.
    store.setDraft(withWordsBack(store.getState().ui.draft, r.words));
  }, [store]);
  const runningNow = useRef(running);
  runningNow.current = running;
  const phaseNow = useRef(phase);
  phaseNow.current = phase;

  useLayoutEffect(() => { if (boxRef.current) fit(boxRef.current); }, [boxRef, draft]);

  const focusBox = useCallback(() => { pressKey('jp-write'); if (document.activeElement !== boxRef.current) boxRef.current?.focus(); }, [boxRef]);

  /** Send the box's words; `afterStop`: right after Stop it and send now, a busy answer is tried once more. */
  const send = useCallback(async (afterStop = false) => {
    if (out.current) return;
    const words = store.getState().ui.draft;
    const text = words.trim();
    const notes = store.getState().ui.notes;
    if (!text && !notes.length) { focusBox(); return; }
    // The notes block first, his words after it (notes/chips.ts: the server's composeNotes).
    const message = composeFor(notes, words);
    out.current = true;
    setPhase('sending');
    setLine(null);
    store.clearGaveBack();
    store.setDraft('');
    if (notes.length) store.setNotes([]);
    let r: { queued?: unknown } | null;
    const post = () => api.post<{ queued?: unknown }>(`/api/job/${encodeURIComponent(slug)}/send`, { kind: 'message', text: message, confirmNoTerminal: noTerminal });
    try {
      try {
        r = await post();
      } catch (err) {
        // The reply has just been stopped and the server has not caught up yet: once more.
        if (!afterStop || !isBusy(err)) throw err;
        // Left before it is due: the timer is cleared and nothing more is sent (the words stay kept).
        await new Promise<void>((due) => {
          retry.current = { timer: setTimeout(() => { retry.current = null; due(); }, RETRY_AFTER_MS), words };
        });
        r = await post();
      }
    } catch (err) {
      out.current = false;
      setPhase('idle');
      // His words back, before anything typed since; his notes back as chips.
      const now = store.getState().ui.draft;
      if (!now.trim()) store.setDraft(words);
      else if (!now.includes(text)) store.setDraft(`${text}\n\n${now}`);
      if (notes.length) store.setNotes(notesBack(store.getState().ui.notes, notes));
      setLine({ words: sendRefusal(err), problem: true });
      if (err instanceof ApiError && err.body.code === 'terminal-open') setAskTerminal(true);
      return;
    }
    out.current = false;
    setPhase('sent');
    setAskTerminal(false);
    setNoTerminal(false);
    // On the website a message waits for the laptop: its words are kept until it is sent there.
    const q = r && typeof r === 'object' ? (r.queued as { id?: unknown } | undefined) : undefined;
    if (q) {
      setLine({ words: 'Queued for your laptop: it goes to the Foreman when the laptop picks it up.', problem: false });
      if (typeof q === 'object' && typeof q.id === 'string') store.watchQueued(q.id, notes.length ? message : text);
    }
  }, [api, store, slug, noTerminal, focusBox]);


  /**
   * The box's words wait for the Foreman (POST …/send with queue: true): shown under the box at once; a
   * refusal puts them back. 'waiting': kept (202); 'sent': nothing was running, so they went now; 'refused'.
   */
  const queue = useCallback(async (replace = false): Promise<'waiting' | 'sent' | 'refused' | 'none'> => {
    if (out.current) return 'none';
    const words = store.getState().ui.draft;
    const text = words.trim();
    const notes = store.getState().ui.notes;
    if (!text && !notes.length) { focusBox(); return 'none'; }
    const message = composeFor(notes, words);
    out.current = true;
    setPhase('waiting');
    setLine(null);
    store.clearGaveBack();
    store.setDraft('');
    if (notes.length) store.setNotes([]);
    setMine({ text: message, afterV: null });
    setCancelled(null);
    let r: { waiting?: unknown } | null;
    try {
      r = await api.post<{ waiting?: unknown }>(`/api/job/${encodeURIComponent(slug)}/send`, { kind: 'message', text: message, queue: true, ...(replace ? { replace: true } : {}), confirmNoTerminal: noTerminal });
    } catch (err) {
      out.current = false;
      setPhase('idle');
      setMine(null);
      const now = store.getState().ui.draft;
      if (!now.trim()) store.setDraft(words);
      else if (!now.includes(text)) store.setDraft(`${text}\n\n${now}`);
      if (notes.length) store.setNotes(notesBack(store.getState().ui.notes, notes));
      setLine(isSecond(err) ? { words: secondRefusal(err), problem: true, replace: true } : { words: sendRefusal(err), problem: true });
      if (err instanceof ApiError && err.body.code === 'terminal-open') setAskTerminal(true);
      return 'refused';
    }
    out.current = false;
    setAskTerminal(false);
    setNoTerminal(false);
    const kept = Boolean(r && typeof r === 'object' && r.waiting);
    setPhase(kept ? 'idle' : 'sent');
    setMine(kept ? { text: message, afterV: vNow() } : null);
    return kept ? 'waiting' : 'sent';
  }, [api, store, slug, noTerminal, focusBox]);

  /**
   * Send while a reply runs (the laptop): the words go into that reply (POST /api/runs/:id/steer) and the
   * Foreman reads them at its next step. Shown at once under the box (the app's steers). The reply having
   * ended meanwhile (404 finished) sends them as a plain message; a reply stopping (409) makes them wait.
   */
  const steer = useCallback(async (runId: string) => {
    if (out.current) return;
    const words = store.getState().ui.draft;
    const text = words.trim();
    const notes = store.getState().ui.notes;
    if (!text && !notes.length) { focusBox(); return; }
    const message = composeFor(notes, words);
    out.current = true;
    setPhase('sending');
    setLine(null);
    store.clearGaveBack();
    store.setDraft('');
    if (notes.length) store.setNotes([]);
    let r: { steer?: Steer } | null;
    try {
      r = await api.post<{ steer?: Steer }>(`/api/runs/${encodeURIComponent(runId)}/steer`, { text: message });
    } catch (err) {
      out.current = false;
      setPhase('idle');
      // His words back, before anything typed since; his notes back as chips.
      const now = store.getState().ui.draft;
      if (!now.trim()) store.setDraft(words);
      else if (!now.includes(text)) store.setDraft(`${text}\n\n${now}`);
      if (notes.length) store.setNotes(notesBack(store.getState().ui.notes, notes));
      if (err instanceof ApiError && err.status === 404 && err.body.code === 'finished') { void send(); return; }
      if (err instanceof ApiError && err.status === 409) { void queue(); return; }
      setLine({ words: sendRefusal(err), problem: true });
      return;
    }
    if (r?.steer) app.dispatch({ type: 'steer', steer: r.steer });
    out.current = false;
    setPhase('sent');
  }, [api, app, store, focusBox, send, queue]);

  // The reply ended before the Foreman answered a message he sent into it: its words back in the box, once.
  const unanswered = useRef<Set<string>>(new Set());
  useEffect(() => {
    let back = false;
    for (const x of steerList) {
      if (x.state !== 'unanswered' || unanswered.current.has(x.id)) continue;
      unanswered.current.add(x.id);
      const now = store.getState().ui.draft;
      const text = x.text.trim();
      if (!now.trim()) store.setDraft(x.text);
      else if (!now.includes(text)) store.setDraft(`${text}\n\n${now}`);
      back = true;
    }
    if (back) { setPhase('idle'); setLine({ words: UNANSWERED, problem: false }); }
  }, [steerList, store]);

  /** Cancel: off the page at once; the words come back to the box (before anything typed since) once the server has removed it. */
  const cancelWaiting = useCallback(async () => {
    const text = waits?.text ?? '';
    setCancelled({ afterV: null });
    setMine(null);
    setLine(null);
    let r: { cancelled?: boolean } | null;
    try {
      r = await api.post<{ cancelled?: boolean }>(`/api/job/${encodeURIComponent(slug)}/waiting/cancel`, {});
    } catch (err) {
      setCancelled(null);
      setLine({ words: `Not cancelled: ${err instanceof TypeError ? UNREACHABLE : err instanceof Error ? err.message : String(err)}`, problem: true });
      return;
    }
    setCancelled({ afterV: vNow() });
    if (!r?.cancelled) { setLine({ words: GONE_ALREADY, problem: false }); return; }
    const now = store.getState().ui.draft;
    if (!now.trim()) store.setDraft(text);
    else if (!now.includes(text)) store.setDraft(`${text}\n\n${now}`);
  }, [api, store, slug, waits?.text]);

  /** His Send on a message kept after a plain stop, or held back (POST …/waiting/send): it goes now, or says why not. */
  const sendWaiting = useCallback(async () => {
    setGoing({ afterV: null });
    setLine(null);
    let r: { waiting?: { why?: string | null } | null } | null;
    try {
      r = await api.post<{ waiting?: { why?: string | null } | null }>(`/api/job/${encodeURIComponent(slug)}/waiting/send`, {});
    } catch (err) {
      setGoing(null);
      setLine({ words: sendRefusal(err), problem: true });
      return;
    }
    setGoing({ afterV: vNow() });
    const why = r?.waiting?.why;
    if (why) setLine({ words: `Not sent: ${why}`, problem: true });
  }, [api, slug]);

  // The reply ended at a go-ahead or a question: the words move into the box (after what is there), the message is
  // cancelled, and one line says so. Once per message; never on the website (it shows it only).
  const movedAt = useRef<string | null>(null);
  useEffect(() => {
    if (!waitToBox || !waitText || hosted || movedAt.current === waitAt) return;
    movedAt.current = waitAt;
    const text = waitText;
    setCancelled({ afterV: null });
    void (async () => {
      let r: { cancelled?: boolean } | null;
      try {
        r = await api.post<{ cancelled?: boolean }>(`/api/job/${encodeURIComponent(slug)}/waiting/cancel`, {});
      } catch {
        setCancelled(null);
        movedAt.current = null;
        return;
      }
      setCancelled({ afterV: vNow() });
      if (!r?.cancelled) return;
      store.setDraft(withWordsBack(store.getState().ui.draft, text));
      setLine({ words: TO_BOX, problem: false });
    })();
  }, [api, store, slug, hosted, waitToBox, waitText, waitAt]);

  const pressSend = useCallback(() => {
    const ui = store.getState().ui;
    if (!ui.draft.trim() && !ui.notes.length) { focusBox(); return; }
    if (locked) return;
    // At a gate the notes are a Send back (Your move's: it carries them and the words as the change).
    if (ui.notes.length && store.getState().payload?.move?.kind === 'gate') { pressKey('jp-back'); return; }
    if (running) {
      // The website can't keep a message waiting: the words stay in the box.
      if (hosted) { setLine({ words: KEPT, problem: false }); return; }
      // The laptop: into the reply, read at the Foreman's next step (talk any time).
      if (run?.id) void steer(run.id); else void queue();
      return;
    }
    void send();
  }, [store, focusBox, locked, running, hosted, run?.id, steer, queue, send]);

  /** Stop it and send now, on this computer: the words wait (if any), then the reply stops; the server sends them as it ends. */
  const stopThenSend = useCallback(async () => {
    // Words, or notes, to make wait first.
    const words = Boolean(store.getState().ui.draft.trim() || store.getState().ui.notes.length);
    if (!words && !waits) { focusBox(); setLine({ words: 'Write the message first, then Stop it and send now.', problem: false }); return; }
    if (!run?.id || stopping) return;
    if (words && (await queue()) !== 'waiting') return;
    setStopping(true);
    try {
      // then: the stopped end sends the waiting message (a plain stop keeps it).
      await api.post(`/api/runs/${encodeURIComponent(run.id)}/stop`, { then: 'send-waiting' });
    } catch (err) {
      // Ended by itself meanwhile (404 "already finished"): the waiting message goes as it would after a stop.
      if (!(err instanceof ApiError && err.status === 404)) setLine({ words: `Not stopped: ${(err instanceof TypeError ? UNREACHABLE : err instanceof Error ? err.message : String(err)).replace(/[.!?]$/, '')}. Your message still waits for the Foreman.`, problem: true });
    } finally {
      setStopping(false);
    }
  }, [api, store, run?.id, stopping, waits, queue, focusBox]);

  const stopAndSend = useCallback(async () => {
    if (!store.getState().ui.draft.trim() && !store.getState().ui.notes.length) { focusBox(); setLine({ words: 'Write the message first, then Stop it and send now.', problem: false }); return; }
    if (!run?.id || phase === 'stopping') return;
    setPhase('stopping');
    setLine({ words: 'Stopping the Foreman; your words go as soon as it has stopped.', problem: false });
    try {
      await api.post(`/api/runs/${encodeURIComponent(run.id)}/stop`, {});
    } catch (err) {
      // The reply ended by itself meanwhile (or had already: 404 "already finished"): the words go
      // as they would after a stop.
      if (!runningNow.current || phaseNow.current !== 'stopping' || (err instanceof ApiError && err.status === 404)) return;
      setPhase('idle');
      setLine({ words: `Not stopped: ${err instanceof TypeError ? UNREACHABLE : err instanceof Error ? err.message : String(err)}`, problem: true });
    }
  }, [api, store, run?.id, phase, focusBox]);

  // Words given back from the website: the box's own line about that send is over.
  // (Not while a newer send or a stop is under way: that one keeps its own state.)
  useEffect(() => {
    if (!gaveBack || out.current || phaseNow.current === 'stopping') return;
    setLine(null);
    setPhase('idle');
  }, [gaveBack]);

  // Stopped (the website): the words go now.
  useEffect(() => {
    if (phase !== 'stopping' || running) return;
    setPhase('idle');
    setLine(null);
    void send(true);
  }, [phase, running, send]);
  // A stop that never shows the reply ended: stop waiting, and say so.
  useEffect(() => {
    if (phase !== 'stopping') return undefined;
    const t = setTimeout(() => {
      if (phaseNow.current !== 'stopping') return;
      setPhase('idle');
      setLine({ words: STOP_SLOW, problem: true });
    }, STOP_WAIT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // His own typing ends a Sent; a Kept line goes once the reply has ended.
  useEffect(() => { if (draft && phase === 'sent') setPhase('idle'); }, [draft, phase]);
  useEffect(() => { if (!running) setLine((l) => (l?.words === KEPT ? null : l)); }, [running]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    e.preventDefault();
    // A go-ahead waits: ⌘↵ is Go (it carries these words as its note), never a message.
    if (gateWaits) { pressKey('jp-go'); return; }
    pressSend();
  }

  const placeholder = running ? (hosted ? WHILE_RUNNING : narrow ? INTO_REPLY_SHORT : INTO_REPLY)
    : phase === 'sent' && !draft ? (narrow ? AFTER_SENT_SHORT : AFTER_SENT)
      : asked ? (narrow ? AT_ASK_SHORT : AT_ASK) : PLACEHOLDER;
  const sentShown = phase === 'sending' || (phase === 'sent' && !draft);
  // The line above the box presses it: the same action as the button (always the newest one).
  const stopAction = useRef<() => void>(() => {});
  stopAction.current = () => void (hosted ? stopAndSend() : stopThenSend());
  useEffect(() => {
    if (!stopElsewhere) return undefined;
    const h = () => stopAction.current();
    stopHandlers.set(slug, h);
    return () => { if (stopHandlers.get(slug) === h) stopHandlers.delete(slug); };
  }, [slug, stopElsewhere]);
  const stop = running && !stopElsewhere && (
    <Button
      kind="quiet"
      size={narrow ? 'md' : 'sm'}
      className="jp2-mb-stop"
      busy={phase === 'stopping' || stopping}
      busyLabel="Stopping…"
      disabled={locked}
      onClick={() => void (hosted ? stopAndSend() : stopThenSend())}
      title={STOP_SEND_HINT}
    >
      Stop it and send now
    </Button>
  );
  /** A picture pasted into the box (⌘V) opens in the reader to pin on (R4); on the laptop it is saved in the job's folder first. */
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const file = pastedPicture(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    setLine({ words: 'Saving the picture…', problem: false });
    void keepPasted(slug, file, hosted || api.hosted?.() ? null : api).then(
      (id) => { setLine(null); onOpen?.({ kind: 'picture', id }, boxRef.current); },
      (err) => setLine({ words: `Couldn’t keep that picture: ${err instanceof TypeError ? UNREACHABLE : err instanceof Error ? err.message : String(err)}`, problem: true }),
    );
  }

  /** At a gate with notes, the box's button is Send back (it carries the notes as the change). */
  const backNow = gateWaits && noteCount > 0;
  return (
    <div className="jp2-mbw">
      <NoteChips onOpen={onOpen} />
      {locked && <p className="jp2-mb-line" role="status">{LOCKED}</p>}
      {askTerminal && (
        <label className="check jp2-mb-line" title="Claude Code is open in this repository in a terminal. Two Foremen on one job would trip over each other.">
          <Choice type="checkbox" checked={noTerminal} onChange={(e) => setNoTerminal(e.target.checked)} /> None of the open terminals is this job’s Foreman
        </label>
      )}
      {line && (
        <p className={`jp2-mb-line${line.problem ? ' is-problem' : ''}`} role={line.problem ? 'alert' : 'status'}>
          {line.words}
          {line.replace && (
            <Button kind="quiet" size="sm" className="jp2-mb-replace" disabled={locked} onClick={() => void queue(true)} title="Send these words to wait for the Foreman in place of the message waiting now.">
              Replace it
            </Button>
          )}
        </p>
      )}
      {!line && gaveBack && <p className="jp2-mb-line is-problem" role="alert">{gaveBack.line}</p>}
      {/* The phone's row has no room for it beside the box: its own line above it. */}
      {narrow && stop && <div className="jp2-mb-stopline">{stop}</div>}
      <div className="jp2-mb">
        <textarea
          ref={boxRef}
          className="jp2-mb-ta"
          aria-label="Message to the Foreman"
          placeholder={placeholder}
          rows={1}
          value={draft}
          onChange={(e) => store.setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          title={gateWaits
            ? 'Your words go with Go as a note, with Send back as the change, or alone with Send as a message. Kept for this job until they go.'
            : 'Your message to this job’s Foreman. Kept for this job until it goes. ⌘↵ sends it.'}
        />
        {!narrow && stop}
        <Button
          kind="primary"
          size={narrow ? 'md' : 'sm'}
          className="jp2-mb-send"
          disabled={locked}
          onClick={pressSend}
          title={locked ? `Off: ${LOCKED}` : backNow ? 'Send back: your notes, and the words in the box, are the change. The Foreman stays at this step, revises and asks you again.' : running ? (hosted ? 'The Foreman is replying: your words stay in the box until it finishes.' : 'The Foreman is working: your message goes into this reply and it reads it at its next step.') : noteCount ? 'Send your notes, and the words in the box, to the Foreman as one message.' : 'Send your words to the Foreman as a message.'}
        >
          {sentShown ? 'Sent' : backNow ? backLabel(noteCount) : sendLabel(noteCount)}
        </Button>
      </div>
      {steerRows.length > 0 && (
        <div className="jp2-mb-wait jp2-mb-steers" role="status">
          {steerRows.length > STEER_ROWS && <p className="jp2-mb-steer-more">+{steerRows.length - STEER_ROWS} earlier</p>}
          {steerRows.slice(-STEER_ROWS).map((x) => (
            <p key={x.id} className="jp2-mb-steer" data-state={x.state}>
              <span className="jp2-mb-steer-words" title={x.text}>{x.text}</span>
              <span className="jp2-mb-steer-says">{STEER_WORDS[x.state]}</span>
            </p>
          ))}
        </div>
      )}
      {waits && (
        <div className={`jp2-mb-wait${waits.why ? ' is-problem' : ''}`} role="status">
          <p className="jp2-mb-wait-says">{fresh(going) ? 'Sending…' : waits.why ? `Not sent yet: ${waits.why}` : WAITS}</p>
          <p className="jp2-mb-wait-words" title={waits.text}>{waits.text}</p>
          {/* The website shows it only: sending and cancelling are the laptop's. */}
          {!hosted && (
            <div className="jp2-mb-wait-acts">
              {waits.why && !waits.toBox && !fresh(going) && (
                <Button kind="quiet" size="sm" disabled={locked} onClick={() => void sendWaiting()} title="Send this message to the Foreman now (or as soon as the reply going ends).">
                  Send
                </Button>
              )}
              <Button kind="quiet" size="sm" className="jp2-mb-wait-cancel" onClick={() => void cancelWaiting()} title="Take this message back before it goes: it is not sent, and its words return to the box.">
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
