// Your move (Task 9, R1 "the fast yes"): the card that asks him for a decision. The label and the
// ask paint from the snapshot row on the first paint (the same words the payload brings:
// waitingFor, waitingSince, headline) and from the payload's move after, so they do not change when
// it lands; what only the payload knows (the options, Go, the calls) fills in under them.
// A permission's or a question's ask has no text in the snapshot row, so on a cold open the row's
// headline shows until the payload brings the move's own words.
//
// - A gate: each question with its options, `recommended` on the Foreman's pick and already picked,
//   `Your own answer` last (a one-line field under the question). Go is awake at once and says what
//   it carries: `Go · all recommended`, `Go · 1 changed`. `n decided for you · confirmed by Go` with
//   `Look` (the decisions in the reader). The picks live in the store for this gate only
//   (jobStore forGate), so a payload that changes under him keeps them.
//   Go shows `Sent` at once, sends once however fast he clicks (or presses ⌘↵ or a), carries the
//   message box's words as the approval's note, and on a refusal puts the picks and the words back
//   with the reason in plain words. The body is gateBody.ts's: byte for byte today's card's.
//   `Send back` (r) sends the message box's words as the change (gateBody 'changes'), the same way:
//   Sent at once, once, the words back on a refusal; with an empty box it puts the cursor there
//   with a hint. A Go or Send back already on its way from another place (today's card, the Desk:
//   the shared gate:<slug> send) keeps both off until the job moves on (R8: no Reply mode).
// - A free-text ask: the replies the Foreman named in quotes are quick replies that fill the message
//   box. Nothing is sent until he presses Send.
// - A permission (or a crew question): what it wants, the exact command, `Allow once`, `Deny`,
//   `Always allow…` (today's sheet: POST /api/rules), `Allow for this run` where Claude Code offers
//   it. A hard line or a risky step has no key and no Always allow, as today's alert.
// - Nothing waits for him: one line.
//
// Keys (scope 'jobpage', only while the card waits): ⌘↵ Go from anywhere, the message box too;
// a Go, or Allow once; r Send back; ↑ ↓ move through the options (outside the reader); Space picks the one moved to.

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import type { GateResult, Job, Permission, Run } from '../../api/types';
import { BRAND } from '../../app/brand';
import { pressKey, useKeyScope } from '../../app/keyRegistry';
import { readHref, replaceHash } from '../../app/router';
import { Button } from '../../components/Button';
import { Choice, OptionRow } from '../../components/Choice';
import { useNarrow } from '../../components/page/Page';
import { AlwaysAllowSheet } from '../../components/permissions/AlwaysAllowSheet';
import { UNREACHABLE_WORDS, useGateSent } from '../../panes/Foreman/gateSent';
import { jobBySlug } from '../../state/reducer';
import { useWorkshop } from '../../state/store';
import { isOpen, queuedOf, type QueuedView } from '../../views/Hosted/QueuedDecision';
import type { GateMove, PermissionMove, QuestionMove, ReaderTarget, RefMeaning } from '../types';
import { queuedById } from '../jobStore';
import { backLabel, composeFor, goLabel, notesWord } from '../notes/chips';
import { useJob, useJobStore } from '../useJob';
import { AskedList, useAsked } from './Asked';
import { notesBack } from './MessageBox';
import { changedCount, gateBody, OWN, pickOf, unanswered, type GatePicks } from './gateBody';
import { STATE_WORDS, stateFromRow } from './Header';
import { firstMentions, RefOpen, RefText } from './Refs';

/** A time as "Fri 12:06 PM" (the reader's title rows use it too). */
export function sinceWords(at: string | null | undefined): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const DECISIONS: ReaderTarget = { kind: 'decisions', id: 'decisions' };

export interface YourMoveProps {
  job: Job | null;
  /** Open something in the reader (the page's own pick, so under 1100 px it comes over the left pane). */
  onOpen?(t: ReaderTarget, from?: HTMLElement | null): void;
}

export const YourMove = memo(function YourMove({ job, onOpen }: YourMoveProps) {
  const move = useJob((s) => s.payload?.move);
  const state = useJob((s) => s.payload?.state);
  const line = useJob((s) => s.payload?.stateLine);
  // What you asked (R5, Asked.tsx): in the slot when nothing else waits, else under the card.
  const asked = useAsked();
  // Task 21: the PR comments not answered yet are one line here (not a card each), opening that PR's view.
  const prLine = <PrMoveLine onOpen={onOpen} />;
  const answers = asked ? <><AskedList asked={asked} onOpen={onOpen} />{prLine}</> : prLine;
  const hasPr = useJob((s) => Boolean(s.payload?.prMove));
  if (move === undefined) {
    // Before the payload: the snapshot row's words.
    if (!job) return <div className="jp2-ym" />;
    const st = stateFromRow(job);
    if (st === 'needs-you') return <div className="jp2-ym"><Card label={moveLabel(job.waitingFor === 'permission', job.waitingSince)} ask={job.headline || job.laneReason || 'This job waits for you.'} /></div>;
    return <div className="jp2-ym"><p className="jp2-ym-one">{STATE_WORDS[st]}{job.laneReason ? ` · ${job.laneReason}` : ''}</p></div>;
  }
  if (move?.kind === 'gate') return <div className="jp2-ym"><GateCard key={gateKeyOf(move)} move={move} onOpen={onOpen} />{answers}</div>;
  if (move?.kind === 'question') return <div className="jp2-ym"><AskCard move={move} />{answers}</div>;
  if (move?.kind === 'permission') return <div className="jp2-ym"><PermissionCard key={move.id} move={move} />{answers}</div>;
  if (asked) return <div className="jp2-ym">{answers}</div>;
  if (hasPr) return <div className="jp2-ym"><p className="jp2-ym-one">{state ? STATE_WORDS[state] : ''}{line ? ` · ${line}` : ''}</p>{prLine}</div>;
  return <div className="jp2-ym"><p className="jp2-ym-one">{state ? STATE_WORDS[state] : ''}{line ? ` · ${line}` : ''}</p></div>;
});

/** `PR #1 · 3 new comments` (Task 21): opens that PR's view in the reader. Nothing when none are new. */
function PrMoveLine({ onOpen }: { onOpen?: YourMoveProps['onOpen'] }) {
  const pr = useJob((s) => s.payload?.prMove ?? null);
  if (!pr) return null;
  const since = sinceWords(pr.since);
  return (
    <button type="button" className="link-button jp2-ym-pr" onClick={(e) => onOpen?.({ kind: 'pr', id: String(pr.n) }, e.currentTarget)} title={`Opens PR #${pr.n}’s comments${since ? `, the oldest new one from ${since}` : ''}.`}>
      PR #{pr.n} · {pr.fresh} new comment{pr.fresh === 1 ? '' : 's'}
    </button>
  );
}

/** Your move's label, the same from the snapshot row (waitingFor, waitingSince) and from the payload, so it does not change when the payload lands. */
function moveLabel(permission: boolean, at: string | null | undefined): string {
  const since = sinceWords(at);
  return `Needs you${permission ? ' · permission' : ''}${since ? ` · since ${since}` : ''}`;
}

/**
 * The card: its label, the ask on one line (its headline, cut with an ellipsis, as the prototype's
 * compact card: lead's ruling on Task 10, so the left pane fits a 900 px window with the card
 * showing), then the rest. When the ask does not fit its line, `More` beside it opens the whole ask
 * in place; only what is under the ask moves, never anything above it. On the phone the ask is
 * always whole (Task 15: Your move in full on the job screen), with no More.
 */
function Card({ label, ask, refs, told, children }: { label: string; ask: string; refs?: Record<string, RefMeaning>; told?: ReadonlySet<string>; children?: ReactNode }) {
  const askRef = useRef<HTMLParagraphElement>(null);
  const [cut, setCut] = useState(false);
  const phone = useNarrow();
  // Opened for this ask only: a new ask arrives on its one line again.
  const [opened, setOpened] = useState<string | null>(null);
  const whole = phone || opened === ask;
  useLayoutEffect(() => {
    const el = askRef.current;
    if (!el || whole) return undefined;
    const measure = () => setCut(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    return () => seen.disconnect();
  }, [ask, whole]);
  return (
    <div className="jp2-card">
      <p className="jp2-card-label">{label}</p>
      <div className="jp2-card-askrow">
        <p ref={askRef} className={`jp2-card-ask${whole ? ' is-whole' : ''}`}><RefText text={ask} refs={refs} told={told} /></p>
        {!phone && (cut || whole) && (
          <button type="button" className="link-button jp2-card-more" aria-expanded={whole} onClick={() => setOpened(whole ? null : ask)} title={whole ? 'Show the ask on one line again.' : 'Show the whole ask here.'}>
            {whole ? 'Less' : 'More'}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ---------- Go, sent once per job ----------

type GoPhase = 'sending' | 'sent' | 'held' | 'queued';
interface GoSent {
  /** Go, or Send back. */
  kind?: 'approve' | 'changes';
  /** The gate it answered, and that gate's stage at the click. */
  key: string;
  stage: string | null;
  phase: GoPhase;
  line: string;
  /** The job's run at the click, and the run the server started for it (when it said). */
  clickRun: string | null;
  runId: string | null;
  /** Held for the limit: the payload has shown the held reply (so its going away means something). */
  heldSeen?: boolean;
  /** Queued on the website: the decision's id, and whether the payload has shown it. */
  queuedId?: string | null;
  queuedSeen?: boolean;
}

/** Where the job stands, as a Go compares it: the gate, its stage, the run, a held reply, and the website's decision for the gate. */
interface GoFacts { key: string; stage: string | null; runId: string | null; runStatus: string | null; held: boolean; queued: QueuedView | null }

// Kept outside the page, by job: a page drawn again (a step pick, coming back from Jobs) still knows
// Go went, so it cannot be sent twice before the job moves on.
const goSent = new Map<string, GoSent>();
const goHeard = new Set<() => void>();
const tellGo = () => { for (const l of [...goHeard]) l(); };
function setGo(slug: string, sent: GoSent | null) {
  if (sent) goSent.set(slug, sent); else goSent.delete(slug);
  tellGo();
}
const listenGo = (l: () => void) => { goHeard.add(l); return () => { goHeard.delete(l); }; };

/** Forget every Go sent (between tests). */
export function forgetSentGo() {
  goSent.clear();
  tellGo();
}

/** Which gate a Go answered: its brief number, or its words when it has none. */
const gateKeyOf = (move: GateMove) => (move.brief !== null ? `gate:${move.brief}` : `gate:${move.ask}`);

const UNREACHABLE = `Couldn’t reach ${BRAND.name}. Try again.`;
const ENDED = new Set(['done', 'stopped', 'error', 'limited']);

/**
 * A Go as it stands now (the same object when nothing changed), or null when it is over and the card
 * comes back (as today's useGateSent, which clears when the run, what the job waits for or its stage moves):
 * - another gate, or this gate at another stage: over;
 * - sending: kept until the answer (a run the server starts meanwhile is this Go's);
 * - sent, with its run: over when that run has ended and the gate still waits, or a newer run started;
 * - held: a newer run ends it (the held reply went to the Foreman: it is that run's, as sent; one
 *   already ended: over); else over once the payload showed the held reply and it is gone;
 * - queued on the website: follows its own decision (the payload's queuedDecision, by id): kept while
 *   it waits or is on its way, sent once the laptop ran it, over when it failed, changed, ran out, was
 *   cancelled, or was put away after the payload showed it (the card then says why: settledWords);
 * - sent with no run named: a new run is this Go's (ended already: over).
 */
function goAsItStands(s: GoSent, now: GoFacts): GoSent | null {
  if (s.key !== now.key || s.stage !== now.stage) return null;
  if (s.phase === 'sending') return s;
  const fresh = now.runId !== null && now.runId !== s.clickRun && now.runId !== s.runId;
  const ended = ENDED.has(now.runStatus ?? '');
  if (s.phase === 'sent' && s.runId !== null) return (now.runId === s.runId && ended) || fresh ? null : s;
  if (s.phase === 'held') {
    if (fresh) return ended ? null : { ...s, phase: 'sent', runId: now.runId, line: '' };
    if (now.held) return s.heldSeen ? s : { ...s, heldSeen: true };
    return s.heldSeen ? null : s;
  }
  if (s.phase === 'queued' && s.queuedId) {
    const q = now.queued && now.queued.id === s.queuedId ? now.queued : null;
    if (!q) return s.queuedSeen ? null : s;
    if (stillOpen(q)) return s.queuedSeen ? s : { ...s, queuedSeen: true };
    if (q.state === 'done') return { ...s, phase: 'sent', runId: fresh && !ended ? now.runId : null, queuedSeen: true };
    return null;
  }
  if (!fresh) return s;
  return ended ? null : { ...s, phase: 'sent', runId: now.runId, line: '' };
}

/** The decision still waits on the website or is on its way to the laptop (a plain boolean: isOpen's guard narrows too far here). */
const stillOpen = (q: QueuedView): boolean => isOpen(q);

/** Why a Go queued on the website ended without running: the site's own words for its decision. */
function settledWords(s: GoSent, q: QueuedView | null): string | null {
  if (s.phase !== 'queued' || !q || q.id !== s.queuedId || stillOpen(q) || q.state === 'done') return null;
  return q.words;
}

/** The server's no, in plain words (for a Send back: his words are back in the box). */
function refusalWords(err: unknown, kind: 'approve' | 'changes' = 'approve'): string {
  return forKind(refusalWordsForGo(err), kind);
}

/** Go's words for a Send back. */
const forKind = (words: string, kind: 'approve' | 'changes') => (kind === 'approve' ? words
  : words.replace('Your picks are kept; Go again', 'Your words are back in the box; Send back again').replace('Go again', 'Send back again'));

function refusalWordsForGo(err: unknown): string {
  if (err instanceof TypeError || (err instanceof Error && err.message === UNREACHABLE_WORDS)) return UNREACHABLE;
  const code = err instanceof ApiError ? err.body.code : null;
  if (code === 'limited') return 'Not sent: Claude’s usage limit is reached. Your picks are kept; Go again once it resets.';
  if (code === 'terminal') return 'Not sent: this job’s Foreman was last used in your terminal. Carry on there, or close it in the terminal and Go again here.';
  if (code === 'terminal-open') return 'Not sent: Claude Code is open in this repository in a terminal. Tick the box below if none of those windows is this job’s Foreman, then Go again.';
  if (code === 'stale-gate') return 'Not sent: the spec or plan changed since this was shown. Read the new version, then decide.';
  if (code === 'stale-brief') return 'Not sent: the Foreman has moved on to a newer brief. Decide on the new one.';
  if (code === 'busy') return BUSY_WORDS;
  return `Not sent: ${err instanceof Error ? err.message : String(err)}`;
}

/** The Foreman is still on a reply (the gate answers sent: false): nothing went, and the page keeps nothing to send later (yet). */
const BUSY_WORDS = 'Not sent: the Foreman is still working on a reply. Your picks are kept; Go again when it finishes.';
/** Send back with nothing in the message box. */
const BACK_HINT = 'Write what should change in the message box, then press Send back.';

const NO_PICKS: Record<string, string> = {};

/** The calls' size: small on a laptop, a thumb's size on the phone. */
const useCallSize = () => (useNarrow() ? 'md' : 'sm');

// ---------- A gate ----------

function GateCard({ move, onOpen }: { move: GateMove; onOpen?: YourMoveProps['onOpen'] }) {
  const size = useCallSize();
  const store = useJobStore();
  const { api } = useWorkshop();
  const slug = useJob((s) => s.slug);
  const key = gateKeyOf(move);
  const picks = useJob((s) => (s.ui.picksFor === key ? s.ui.picks : NO_PICKS));
  const own = useJob((s) => (s.ui.picksFor === key ? s.ui.own : NO_PICKS));
  const limited = useJob((s) => Boolean(s.payload?.usage?.limited));
  const held = useJob((s) => Boolean(s.payload?.lock));
  const runId = useJob((s) => s.payload?.run?.id ?? null);
  const runStatus = useJob((s) => s.payload?.run?.status ?? null);
  const heldReply = useJob((s) => Boolean(s.payload?.heldReply));
  const sentAny = useSyncExternalStore(listenGo, () => goSent.get(slug) ?? null);
  // This Go's own decision on the website, by its id (a newer decision for the job never hides it);
  // else the job's newest, for the shared send below.
  const queuedDecision = useJob((s) => queuedById(s.payload, sentAny?.queuedId) ?? queuedOf(s.payload?.queuedDecision));
  const facts: GoFacts = { key, stage: move.stage, runId, runStatus, held: heldReply, queued: queuedDecision };
  const sent = sentAny ? goAsItStands(sentAny, facts) : null;
  /** Per question: the id whose words are open under it (left/Refs.tsx). */
  const [refOpen, setRefOpen] = useState<Record<string, string | null>>({});
  const [line, setLine] = useState<string | null>(null);
  // Keep the Go as it now stands (held seen, a run adopted, its queued decision seen), or end it: the
  // card comes back, saying why when the website's decision did not run.
  useEffect(() => {
    if (!sentAny || sent === sentAny) return;
    setGo(slug, sent);
    if (!sent) {
      const why = settledWords(sentAny, queuedDecision);
      if (why) setLine(why);
      // The words it carried: the store follows its decision by id and gives them back (watchQueued).
    }
  });
  // The send today's card, the old page's bar, the Desk and the quick look read (useGateSent): it marks
  // the job the way they mark it (its run, what it waits for, its stage, from the app's Jobs row), so
  // every Go for this job greys out together and wakes when the job moves.
  const { store: app } = useWorkshop();
  const rowWaits = useSyncExternalStore(app.subscribe, () => jobBySlug(app.getState(), slug)?.waitingFor ?? null);
  const rowStage = useSyncExternalStore(app.subscribe, () => jobBySlug(app.getState(), slug)?.stage ?? null);
  const liveRun = useSyncExternalStore(app.subscribe, () => app.getState().runs[slug]?.id ?? null);
  const markJob = useMemo(() => ({ slug, waitingFor: rowWaits, stage: rowStage }) as Job, [slug, rowWaits, rowStage]);
  const markRunId = liveRun ?? runId;
  const markRun = useMemo(() => (markRunId ? ({ id: markRunId } as Run) : null), [markRunId]);
  // The website's decision, once the page shows it in any state: the shared send is over then (the
  // card follows the decision itself), so it never keeps Go off after the site put it away.
  const shared = useGateSent(markJob, markRun, queuedDecision?.id ?? null);
  const [askTerminal, setAskTerminal] = useState(false);
  const [noTerminal, setNoTerminal] = useState(false);
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  const goBtn = useRef<HTMLButtonElement>(null);
  /** Given back after the card had gone: Go takes the focus again (when nothing else has it). */
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (refocus && (document.activeElement === document.body || document.activeElement === null)) goBtn.current?.focus();
  }, [refocus]);
  /** The question whose own-answer field takes the focus when `Your own answer` is picked. */
  const focusOwn = useRef<string | null>(null);

  const p: GatePicks = useMemo(() => ({ picks, own }), [picks, own]);
  const changed = changedCount(move, p);
  const open = unanswered(move, p);
  // A decision for this job already out from another place (today's card, the Desk, the old bar): a
  // second one now would be refused as busy, and its answer would clear that place's grey-out.
  // (Sent counts for this brief only: a newer brief is a new decision.)
  const onItsWay = shared.state === 'sending' || (shared.state === 'sent' && (shared.accepted?.brief ?? null) === move.brief);
  /** Why neither Go nor Send back can go now. */
  const blocked = move.stale ? 'The spec or plan changed since this was shown. Read the new version, then decide.'
    : held ? 'Another place is working on this job. Only one place can work on a job at a time.'
      : onItsWay ? 'A Go or Send back for this job is already on its way. These wake once the job moves on.' : null;
  const why = blocked ?? (open !== null ? `Question ${open} has no answer. Pick one, or write your own.` : null);
  /** Send back pressed with an empty message box: what to do. */
  const [hint, setHint] = useState<string | null>(null);
  const hasWords = useJob((s) => s.ui.draft.trim() !== '' || s.ui.notes.length > 0);
  /** Notes pointed in the reader (R4): Go and Send back carry them. */
  const noteCount = useJob((s) => s.ui.notes.length);
  useEffect(() => { if (hasWords) setHint(null); }, [hasWords]);
  const label = noteCount ? goLabel(noteCount) : move.questions.length === 0 ? `Go · ${move.goSays}` : changed ? `Go · ${changed} changed` : 'Go · all recommended';
  const confirms = move.openDecisions.length;
  const goHint = `Go: ${move.goSays}.${move.questions.length ? ' Sends your answers' : ' Sends your go-ahead'}${changed && noteCount ? ` (${changed} changed)` : ''}${confirms ? ` and confirms the ${confirms} open decision${confirms === 1 ? '' : 's'}` : ''}; ${noteCount ? `your ${notesWord(noteCount)} go with it, for the Foreman to do as part of the go, and words in the message box too.` : 'words in the message box go with it as a note.'}`;

  const pick = (q: string, option: string) => {
    store.forGate(key);
    store.setPick(q, option);
    setLine(null);
  };
  const setOwn = (q: string, words: string) => {
    store.forGate(key);
    store.setOwn(q, words);
  };

  /** Go ('approve'), or Send back ('changes': the message box's words are the change). */
  const decide = useCallback(async (kind: 'approve' | 'changes', extra: { startAfterReset?: boolean } = {}) => {
    // Once: a second click, ⌘↵ or a while it is out finds it here and does nothing.
    const was = goSent.get(slug);
    const pay = store.getState().payload;
    if (was && goAsItStands(was, { key, stage: move.stage, runId: pay?.run?.id ?? null, runStatus: pay?.run?.status ?? null, held: Boolean(pay?.heldReply), queued: queuedById(pay, was.queuedId) ?? queuedOf(pay?.queuedDecision) })) return;
    const ui = store.getState().ui;
    const now: GatePicks = ui.picksFor === key ? { picks: ui.picks, own: ui.own } : { picks: {}, own: {} };
    if (move.stale || held || onItsWay) return;
    if (kind === 'approve' && unanswered(move, now) !== null) return;
    // His notes from the reader (R4) go first, as the notes block, his words after it.
    const typed = ui.draft;
    const notes = ui.notes;
    // (No notes: his words as they are, byte for byte today's card's.)
    const note = notes.length ? composeFor(notes, typed) : typed;
    // Send back needs the change in words (or notes): the cursor goes to the box, with a hint.
    if (kind === 'changes' && !note.trim()) { setLine(null); setHint(BACK_HINT); pressKey('jp-write'); return; }
    setHint(null);
    const body = kind === 'approve'
      ? gateBody('approve', move, now, { confirmNoTerminal: noTerminal, note, startAfterReset: extra.startAfterReset })
      : gateBody('changes', move, now, { confirmNoTerminal: noTerminal, note });
    const clickRun = pay?.run?.id ?? null;
    const carried = typeof body.note === 'string';
    const go = (phase: GoPhase, runIdNow: string | null = null, line = '', queuedId: string | null = null) => setGo(slug, { kind, key, stage: move.stage, phase, line, clickRun, runId: runIdNow, queuedId });
    go('sending');
    setLine(null);
    if (carried) { store.setDraft(''); if (notes.length) store.setNotes([]); }
    /** Not sent: the card again with his picks, and his words back in the box (before anything typed since). */
    const giveBack = (words: string) => {
      setGo(slug, null);
      setLine(words);
      setRefocus((n) => n + 1);
      if (!carried) return;
      // His words back in the box and his notes back as chips (before anything made since).
      const draft = store.getState().ui.draft;
      const back = typed.trim();
      if (!draft.trim()) store.setDraft(typed);
      else if (back && !draft.includes(back)) store.setDraft(`${back}\n\n${draft}`);
      if (notes.length) store.setNotes(notesBack(store.getState().ui.notes, notes));
    };
    let r: GateResult;
    try {
      // Through the shared send (it marks the job sending, then sent or clear, as today's card does).
      r = await shared.send(api, body);
    } catch (err) {
      giveBack(refusalWords(err, kind));
      if (err instanceof ApiError && err.body.code === 'terminal-open') setAskTerminal(true);
      if (err instanceof ApiError && (err.body.code === 'stale-gate' || err.body.code === 'stale-brief')) void store.loadPage();
      return;
    }
    const queued = (r as { queued?: { id?: unknown } } | null)?.queued;
    // The website first: its answer can say held too (the laptop is off), and it is still a decision waiting there.
    if (queued && typeof queued === 'object') {
      const id = typeof queued.id === 'string' ? queued.id : null;
      go('queued', null, '', id);
      // If it never runs there, the words come back to the box, wherever the card is by then.
      if (id && carried) store.watchQueued(id, note);
    }
    else if (r?.sent) go('sent', typeof r.run?.id === 'string' ? r.run.id : null);
    else if (r?.held) go('held', null, r.message ?? 'Held until Claude’s usage limit resets.');
    // The Foreman is still on a reply: today's card parks the reply in its composer; this page has no
    // place for it yet (Task 16 queues it), so it says so in its own words.
    else giveBack(forKind(BUSY_WORDS, kind));
  }, [api, store, slug, key, move, held, onItsWay, noTerminal, shared]);
  const goNow = useCallback((extra: { startAfterReset?: boolean } = {}) => decide('approve', extra), [decide]);

  const options = () => [...(root.current?.querySelectorAll<HTMLInputElement>('input[data-jp-opt]') ?? [])];
  const moveBy = (by: 1 | -1, e: KeyboardEvent) => {
    // The reader keeps its own arrows (it scrolls).
    if (e.target instanceof Element && e.target.closest('.jp2-reader')) return false;
    const all = options();
    if (!all.length) return false;
    const at = all.indexOf(document.activeElement as HTMLInputElement);
    const next = at < 0 ? (by > 0 ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, at + by));
    all[next].focus();
    return true;
  };

  useKeyScope('jobpage', {
    'jp-go': () => { if (why) return false; void goNow(); },
    'jp-yes': () => { if (why) return false; void goNow(); },
    'jp-back': () => { if (blocked) return false; void decide('changes'); },
    'jp-opt-next': (e) => moveBy(1, e),
    'jp-opt-prev': (e) => moveBy(-1, e),
    'jp-opt-pick': () => {
      const at = document.activeElement;
      if (!(at instanceof HTMLInputElement) || !options().includes(at)) return false;
      at.click();
    },
  }, !sent);

  const label0 = moveLabel(false, move.since);
  if (sent) {
    const words = sent.phase === 'held' ? sent.line
      : sent.phase === 'queued' ? 'Queued for your laptop: it goes to the Foreman when the laptop picks it up.'
        : sent.kind === 'changes' ? 'Sent back · the Foreman is revising'
          : move.questions.length ? 'Sent · the Foreman is reading your answers' : 'Sent · the Foreman is reading your go-ahead';
    return <p className="jp2-ym-sent" role="status">{words}</p>;
  }
  // Each id's meaning shows at its first mention in the card: the ask, then each question, its options' labels and consequences.
  const texts = [move.ask, ...move.questions.flatMap((q) => [q.text, ...q.options.flatMap((o) => [o.label, o.consequence ?? ''])])];
  const before = firstMentions(texts);
  /** Where each text sits in `texts`: the ask is 0; then each question, and each option's label and consequence. */
  const toldAt = new Map<string, ReadonlySet<string>>();
  let n = 1;
  for (const q of move.questions) {
    toldAt.set(`q:${q.id}`, before[n++]);
    for (const o of q.options) { toldAt.set(`l:${q.id}:${o.id}`, before[n++]); toldAt.set(`c:${q.id}:${o.id}`, before[n++]); }
  }
  return (
    <Card label={label0} ask={move.ask} refs={move.refs} told={before[0]}>
      <div ref={root} className="jp2-ym-qs">
        {move.questions.map((q, i) => {
          const chosen = pickOf(q, p);
          const name = `${uid}-q${q.id}`;
          const ownOpen = q.options.length === 0 || chosen === OWN;
          return (
            <fieldset key={q.id} className="jp2-ym-q">
              <legend className="jp2-ym-qt">{i + 1}. <RefText text={q.text} refs={move.refs} told={toldAt.get(`q:${q.id}`)} open={refOpen[q.id] ?? null} onPick={(id) => setRefOpen((o) => ({ ...o, [q.id]: o[q.id] === id ? null : id }))} /></legend>
              {refOpen[q.id] && move.refs?.[refOpen[q.id]!] && (
                <RefOpen meaning={move.refs[refOpen[q.id]!]} onOpen={onOpen} onClose={() => setRefOpen((o) => ({ ...o, [q.id]: null }))} />
              )}
              {q.options.map((o) => (
                <OptionRow
                  key={o.id}
                  type="radio"
                  name={name}
                  value={o.id}
                  className="jp2-ym-opt"
                  data-jp-opt=""
                  data-q={q.id}
                  checked={chosen === o.id}
                  onChange={() => pick(q.id, o.id)}
                  title={o.recommended ? 'The Foreman recommends this; it is picked for you. Pick another to change it.' : 'Answer with this option.'}
                >
                  <span className="jp2-ym-ot">
                    <span className="jp2-ym-ol"><b>{o.id}.</b> <RefText text={o.label} refs={move.refs} told={toldAt.get(`l:${q.id}:${o.id}`)} /></span>
                    {o.recommended && <span className="jp2-ym-rec">recommended</span>}
                    {o.consequence && <small><RefText text={o.consequence} refs={move.refs} told={toldAt.get(`c:${q.id}:${o.id}`)} /></small>}
                  </span>
                </OptionRow>
              ))}
              {q.options.length > 0 && (
                <OptionRow
                  type="radio"
                  name={name}
                  value={OWN}
                  className="jp2-ym-opt jp2-ym-ownrow"
                  data-jp-opt=""
                  data-q={q.id}
                  checked={chosen === OWN}
                  onChange={() => { focusOwn.current = q.id; pick(q.id, OWN); }}
                  title="Answer in your own words instead."
                >
                  <span className="jp2-ym-ot">Your own answer</span>
                </OptionRow>
              )}
              {ownOpen && (
                <input
                  type="text"
                  className="text-input jp2-ym-ownin"
                  aria-label={q.options.length > 0 ? `Your own answer to question ${i + 1}` : `Your answer to question ${i + 1}`}
                  placeholder={q.options.length > 0 ? 'Your own answer' : 'Your answer'}
                  value={own[q.id] ?? ''}
                  onChange={(e) => setOwn(q.id, e.target.value)}
                  ref={(el) => { if (el && focusOwn.current === q.id) { focusOwn.current = null; el.focus(); } }}
                  title="Your answer in your own words."
                />
              )}
            </fieldset>
          );
        })}
      </div>
      {move.decided > 0 && (
        <p className="jp2-ym-dec">
          {move.decided} decided for you · confirmed by Go
          <button type="button" className="link-button jp2-ym-look" onClick={(e) => { if (onOpen) onOpen(DECISIONS, e.currentTarget); else { store.setReader(DECISIONS); replaceHash(readHref(slug, DECISIONS)); } }} title="Open what was decided for you in the reader.">Look</button>
        </p>
      )}
      {askTerminal && (
        <label className="check jp2-ym-check" title="Claude Code is open in this repository in a terminal. Two Foremen on one job would trip over each other.">
          <Choice type="checkbox" checked={noTerminal} onChange={(e) => setNoTerminal(e.target.checked)} /> None of the open terminals is this job’s Foreman
        </label>
      )}
      <div className="jp2-ym-calls">
        <Button ref={goBtn} kind="primary" size={size} keyId="jp-go" keyShown disabled={why !== null} onClick={() => void goNow()} title={why ? `Off: ${why}` : goHint}>{label}</Button>
        <Button size={size} keyId="jp-back" disabled={blocked !== null} onClick={() => void decide('changes')} title={blocked ? `Off: ${blocked}` : noteCount ? 'Send back: your notes, and the words in the message box, are the change. The Foreman stays at this step, revises and asks you again.' : 'Send back: the words in the message box are the change. The Foreman stays at this step, revises and asks you again.'}>{backLabel(noteCount)}</Button>
        {limited && (
          <Button kind="quiet" size={size} disabled={why !== null} onClick={() => void goNow({ startAfterReset: true })} title="Claude’s usage limit is reached: your Go waits, and goes to the Foreman when it resets.">Go after the reset</Button>
        )}
      </div>
      {(line ?? hint ?? why) && <p className={`jp2-ym-why${line ? ' is-problem' : ''}`} role={line ? 'alert' : 'status'}>{line ?? hint ?? why}</p>}
    </Card>
  );
}

// ---------- A free-text ask ----------

function AskCard({ move }: { move: QuestionMove }) {
  const size = useCallSize();
  const store = useJobStore();
  const fill = (reply: string) => {
    const draft = store.getState().ui.draft;
    // A quick reply replaces another; his own words stay, with the reply under them.
    const text = !draft.trim() || move.quick.includes(draft.trim()) ? reply : `${draft.replace(/\s+$/, '')}\n${reply}`;
    store.setDraft(text);
    pressKey('jp-write');
    requestAnimationFrame(() => {
      const box = document.activeElement;
      if (box instanceof HTMLTextAreaElement) box.setSelectionRange(box.value.length, box.value.length);
    });
  };
  return (
    <Card label={moveLabel(false, move.since)} ask={move.ask} refs={move.refs}>
      {move.quick.length > 0 && (
        <div className="jp2-ym-quick" role="group" aria-label="Quick replies">
          {move.quick.map((q) => (
            <Button key={q} size={size} className="jp2-ym-reply" onClick={() => fill(q)} title="Put this reply in the message box. Nothing is sent until you press Send.">“{q}”</Button>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------- A permission, or a crew question ----------

type Answer = { decision: 'allow' | 'allow-run' | 'deny'; answers?: Record<string, string> };

function PermissionCard({ move }: { move: PermissionMove }) {
  const size = useCallSize();
  const { api, store: app } = useWorkshop();
  const [done, setDone] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Permission | null>(null);
  const out = useRef(false);
  const alwaysBtn = useRef<HTMLButtonElement>(null);
  const keyOk = move.card !== 'question' && !move.hardLine && !move.defaultToNo && move.risk !== 'high';
  const always = move.canAlwaysAllow && !move.hardLine && !move.defaultToNo;

  async function answer(body: Answer, words: string) {
    if (out.current) return;
    out.current = true;
    setDone(words);
    setLine(null);
    let r: { queued?: unknown } | null;
    try {
      r = await api.post<{ queued?: unknown }>(`/api/permissions/${encodeURIComponent(move.id)}`, body);
    } catch (err) {
      out.current = false;
      setDone(null);
      setLine(err instanceof TypeError ? UNREACHABLE : err instanceof Error ? err.message : String(err));
      return;
    }
    // On the website the answer waits for the laptop.
    if (r && typeof r === 'object' && r.queued) { setDone('Queued for your laptop: it goes when the laptop picks it up.'); return; }
    app.dispatch({ type: 'permission-answered', id: move.id });
  }

  useKeyScope('jobpage', {
    // A hard line or a risky step: a does nothing at all.
    'jp-yes': () => { if (keyOk) void answer({ decision: 'allow' }, 'Allowed once'); },
  }, done === null && sheet === null);

  const openSheet = () => {
    const full = app.getState().permissions.find((x) => x.id === move.id) ?? null;
    if (full?.draft?.options?.length) setSheet(full);
    else setLine('This request’s rule isn’t on this page. Use Allow once, or save a rule from the old job page.');
  };

  if (done) return <p className="jp2-ym-sent" role="status">{done}</p>;
  if (move.card === 'question') return <CrewQuestion move={move} line={line} onAnswer={answer} />;
  return (
    <Card label={moveLabel(true, move.since)} ask={move.what}>
      {move.command && <pre className="jp2-ym-cmd">{move.command}</pre>}
      {move.hardLine && <p className="jp2-ym-why">A hard line: a key never allows it.</p>}
      <div className="jp2-ym-calls">
        <Button kind="primary" size={size} keyId={keyOk ? 'jp-yes' : undefined} keyShown onClick={() => void answer({ decision: 'allow' }, 'Allowed once')} title="Let it do exactly this, one time. It asks again next time.">Allow once</Button>
        {move.canAllowForRun && !move.hardLine && (
          <Button kind="quiet" size={size} onClick={() => void answer({ decision: 'allow-run' }, 'Allowed for this run')} title="Let it do this kind of step without asking again until this reply is finished. Nothing is saved.">Allow for this run</Button>
        )}
        <Button size={size} onClick={() => void answer({ decision: 'deny' }, 'Denied · the Foreman was told no')} title="Say no. It skips this and carries on.">Deny</Button>
        {always && (
          <Button ref={alwaysBtn} kind="quiet" size={size} onClick={openSheet} title="Save a rule so steps like this run without asking, in every job. You choose how narrow it is and confirm it first; remove it any time in Settings.">Always allow…</Button>
        )}
      </div>
      {line && <p className="jp2-ym-why is-problem" role="alert">{line}</p>}
      {sheet?.draft && <AlwaysAllowSheet permission={sheet} draft={sheet.draft} onClose={() => { setSheet(null); alwaysBtn.current?.focus(); }} />}
    </Card>
  );
}

function CrewQuestion({ move, line, onAnswer }: { move: PermissionMove; line: string | null; onAnswer(body: Answer, words: string): void }) {
  const size = useCallSize();
  const qs = move.questions ?? [];
  const uid = useId();
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [words, setWords] = useState<Record<number, string>>({});
  const answerOf = (i: number) => (picked[i] === OWN ? (words[i] ?? '').trim() : picked[i] ?? '');
  const ready = qs.length > 0 && qs.every((_, i) => answerOf(i) !== '');
  return (
    <Card label={moveLabel(true, move.since)} ask={move.what}>
      {qs.map((q, i) => (
        <fieldset key={i} className="jp2-ym-q">
          <legend className="jp2-ym-qt">{q.question}</legend>
          {q.options.map((o) => (
            <OptionRow key={o.label} type="radio" name={`${uid}-${i}`} className="jp2-ym-opt" checked={picked[i] === o.label} onChange={() => setPicked((x) => ({ ...x, [i]: o.label }))} title="Pick this answer.">
              <span className="jp2-ym-ot">{o.label}</span>
            </OptionRow>
          ))}
          <OptionRow type="radio" name={`${uid}-${i}`} className="jp2-ym-opt jp2-ym-ownrow" checked={picked[i] === OWN} onChange={() => setPicked((x) => ({ ...x, [i]: OWN }))} title="None of these fits: answer in your own words.">
            <span className="jp2-ym-ot">Your own answer</span>
          </OptionRow>
          {picked[i] === OWN && (
            <input type="text" className="text-input jp2-ym-ownin" aria-label={`Your own answer to: ${q.question}`} placeholder="Your own answer" value={words[i] ?? ''} onChange={(e) => setWords((x) => ({ ...x, [i]: e.target.value }))} />
          )}
        </fieldset>
      ))}
      {qs.length === 0 && <p className="jp2-ym-why">The question didn’t come through. You can say no, and the Foreman will ask again in its reply.</p>}
      <div className="jp2-ym-calls">
        <Button kind="primary" size={size} disabled={!ready} onClick={() => onAnswer({ decision: 'allow', answers: Object.fromEntries(qs.map((q, i) => [q.question, answerOf(i)])) }, 'Answers sent')} title={ready ? 'Send your answers to the Foreman.' : 'Answer every question first.'}>Send answers</Button>
        <Button kind="quiet" size={size} onClick={() => onAnswer({ decision: 'deny' }, 'Not answered · the Foreman carries on without your choice')} title="Don’t answer. The Foreman carries on without your choice.">Don’t answer</Button>
      </div>
      {line && <p className="jp2-ym-why is-problem" role="alert">{line}</p>}
    </Card>
  );
}
