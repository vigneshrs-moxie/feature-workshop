// The bar at the top of a job (design 3.3; moved here from JobPage.tsx): what the job waits for and
// the one thing to do about it. The permission alert while a permission waits (it takes the bar's
// place), else the go / no go bar while a gate waits (No go: send back r, Reply, Go a; the gate
// card's questions and the decisions made for you sit under it), else, while a pull request is in
// review, the review round's bar, else what is happening in words: who is working and on what, or
// the evidence being recorded. The owner's one requirement: on every step that waits for him, on
// Auto jobs too (Auto on, deciding, stopped, or the step his once he wrote), the three calls are
// there and pressable. After a send the bar says what reached the Foreman (sentView.ts).
import { isOpen, queuedOf } from '../views/Hosted/QueuedDecision';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { EvidenceView, Job, NowDoing, Run, StopId, TestChecks } from '../api/types';
import { BRAND } from '../app/brand';
import { jobHref } from '../app/router';
import { useShown } from '../app/detail';
import { Button, isPressable } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { NextBar, type NextTone } from '../components/page/Page';
import { PermissionAlert } from '../components/permissions/PermissionAlert';
import { stopOf } from '../components/stops/stops';
import { laneOf } from '../home/JobsPage';
import type { useJobConversation } from '../panes/Foreman/ForemanPane';
import { GateSlot, pressReply } from '../panes/Foreman/GateCard';
import { sessionOf, useGateSent, type GateSent } from '../panes/Foreman/gateSent';
import { isActiveRun } from '../panes/Foreman/thread';
import type { GateKind } from '../lib/compose';
import { answeredKind, autoAnswered, linesText, stateLines, STUCK_WORDS, useSentView, type SentShown } from './sentView';
import { AUTO_DECIDING_NOTE, autoDeciding, autoLaneReason } from './autoLine';
import { usePlay } from '../play/usePlay';
import { ReviewBar } from '../views/Review/ReviewBar';
import { isRoundCard, useReview } from '../views/Review/useReview';
import { useWorkshop, useWorkshopState } from '../state/store';

/** What each stop's go approves (the bar no longer shows it greyed while nothing waits). */
export const STOP_ACTION: Record<StopId, string> = {
  spec: 'Approve the spec', investigate: 'Approve the plan', plan: 'Approve the plan', build: 'Approve the tests',
  test: 'Approve the tests', review: 'Approve the review', ship: 'Open the pull request',
};

/** The job's ticket key (ORBIT-471), when it has one. */
export function ticketOf(job: Job): string | null {
  const t = job.ticket as unknown;
  if (typeof t === 'string') return t;
  const key = (t as { key?: unknown } | null | undefined)?.key;
  return typeof key === 'string' ? key : null;
}

/** A button's words without its key hint (or the words a busy one says to a screen reader). */
function wordsOf(b: Element | null): string {
  if (!b) return '';
  const copy = b.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('kbd, .btn-busy-words').forEach((k) => k.remove());
  return (copy.textContent ?? '').trim();
}
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The one next step, on the job page and the phone's step screens: the permission alert while a permission waits
 * (oldest first), else the go / no go bar while a gate waits, else, while a pull request is in
 * review, the review round's bar (packet Q: its card is answered here, not as a permission), else
 * what is happening in words. `onShip` shows the pull requests (the Ship step); without it, the
 * button goes to the job page. While a permission card has the bar's place the gate card stays
 * mounted, only hidden, so a box opened in it and the words typed there are still there after.
 */
export function NextStep({ job, conversation, now, onShip, onWatch, onWrite, foldCard = false, foldHere = false, evidence }: { job: Job; conversation: Conversation; now: Date; onShip?: () => void; /** Shows the evidence being recorded (laptop only). */ onWatch?: () => void; /** Reply while no gate waits (left out: it puts the focus in the page's message box; the phone's goes to its conversation screen). */ onWrite?: () => void; /** The phone's screens: the brief under the bar folds to one row (the laptop's job page has it in full). */ foldCard?: boolean; /** The job page while its conversation takes the screen: the brief is one row each time, whatever the Detail setting, and open only while a box in it is open or he opens the row (not remembered for any other page). */ foldHere?: boolean; /** The page's own evidence view for the gate card's strip (left out: the strip asks for itself). */ evidence?: EvidenceView | null }) {
  const state = useWorkshopState();
  const play = usePlay();
  const review = useReview(job.slug);
  const { thread, run } = conversation;
  const { api } = useWorkshop();
  const after = useAfterSend(job, run, thread.reload, queuedOf(thread.detail?.queued)?.id ?? null, sessionOf(thread.detail));
  const perms = state.permissions.filter((p) => p.slug === job.slug && !isRoundCard(p));
  // One live region, always here (empty when nothing is out), so each of sending, sent and stuck is
  // announced once; the bar shows the same words, but not as a live region.
  // The brief is answered (or his reply's run is at work): the bar keeps saying it was sent.
  const sentShown = useSentView(job, thread.detail, run, after.decision, thread.reload);
  const sent = perms.length === 0 ? sentShown : null;
  const live = <p className="sr-only" role="status" data-next-live>{after.live || (sent ? linesText(sent) : '')}</p>;
  const problem = after.problem && <p ref={after.problemRef} className="field-problem" role="alert" tabIndex={-1}>{after.problem}</p>;
  const alert = perms.length > 0 ? <PermissionAlert permissions={perms} now={now} /> : null;
  // The gate's bar and card stay in one place whether or not a permission card is up: hidden under it.
  const gate = thread.detail?.gate ? <GoBar job={job} detail={thread.detail} now={now} reload={thread.reload} call={play.on} foldCard={foldCard} foldHere={foldHere} after={after} sent={sent} run={run} evidence={evidence} hidden={alert !== null} /> : null;
  // Neither: the review round's bar, else what is happening in words.
  const bar: ReactNode = alert || gate ? null
    : review.view ? <ReviewBar view={review.view} act={review.act} problem={review.problem} />
    : <StateBar job={job} now={now} checks={thread.detail?.page?.checks ?? null} onShip={onShip} onWatch={onWatch} onWrite={onWrite} hosted={Boolean(api.hosted?.())} after={after} />;
  return <>{alert}{gate}{bar}{live}{problem}</>;
}

type Conversation = ReturnType<typeof useJobConversation>;

/**
 * Whether the bar shows a sent line for his decision now, with the kind sent when known (null: it
 * does not). The same rule the bar uses: no permission card waits, and the send's own state (sent,
 * stuck, or Try again out) or, at a gate, what the job says (useSentView). A brief Auto answered is
 * not his: null, though the bar says it was sent. The page's other parts read it to say Sent too.
 */
export function useSentShown(job: Job, conversation: Conversation): { kind: GateKind | null } | null {
  const state = useWorkshopState();
  const review = useReview(job.slug);
  const { thread, run } = conversation;
  const decision = useGateSent(job, run, queuedOf(thread.detail?.queued)?.id ?? null, sessionOf(thread.detail));
  // No reload here: the bar fetches the job itself; the lines show or not alike either way.
  const view = useSentView(job, thread.detail, run, decision);
  if (state.permissions.some((p) => p.slug === job.slug && !isRoundCard(p))) return null;
  const own = decision.state === 'sent' || decision.state === 'stuck' || decision.retrying;
  if (thread.detail?.gate) {
    if (own) return { kind: decision.kind };
    return view && !autoAnswered(thread.detail, decision) ? { kind: answeredKind(thread.detail, decision) } : null;
  }
  return own && !review.view ? { kind: decision.kind } : null;
}

/** "18 min", "2 h", "3 days": how long since `iso`; null when not known. */
function forHowLong(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** The line's first letter lowered, unless it starts a capitalised short form (PR, API). */
const lowerLine = (s: string) => (/^[A-Z]{2}/.test(s) ? s : lowerFirst(s));
const nameOf = (c: NowDoing) => text(c.name) ?? c.who;
const isForeman = (c: NowDoing) => c.who === 'conductor' || nameOf(c) === 'Foreman';
/** What a crew member is, to say several at once: every reviewer lens is a reviewer; else its name. */
const roleOf = (c: NowDoing) => (/^(feature|bug)-review/.test(c.who) ? 'reviewer' : nameOf(c).toLowerCase());
/** Words that end in -ing but are not a verb at the start of a line: they take the colon. */
const NOT_VERBS = new Set(['nothing', 'something', 'anything', 'everything', 'thing', 'string', 'during']);
const startsWithVerb = (s: string) => { const w = /^([A-Za-z]{2,}ing)\b/.exec(s)?.[1]; return Boolean(w) && !NOT_VERBS.has(w!.toLowerCase()); };
/** "Spec, Errors, Tests and Screens". */
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * Who is working and on what, as the bar says it while nothing waits for him (null: nobody is).
 * The first one at work gives the sentence; the line under it names the model and how long, or,
 * with several at once, all of them and the longest time. The Foreman is not crew: while any crew
 * member works it is left out, and it is named only when it works alone.
 */
export function workingWords(job: Pick<Job, 'nowDoing' | 'stage'>, now: Date): { say: string; sub: string } | null {
  const all = (job.nowDoing ?? []).filter((c) => c && typeof c.who === 'string');
  const crew = all.some((c) => !isForeman(c)) ? all.filter((c) => !isForeman(c)) : all;
  if (crew.length === 0) return null;
  const first = crew[0];
  const name = nameOf(first);
  const doing = text(first.doing);
  const say = !doing ? `The ${name} is working` : startsWithVerb(doing) ? `The ${name} is ${lowerLine(doing)}` : `The ${name}: ${lowerLine(doing)}`;
  const nothing = `Nothing for you to do ${stopOf(job.stage) === 'build' ? 'until the tests' : 'right now'}.`;
  if (crew.length === 1) {
    const model = text(first.model);
    const time = forHowLong(first.since, now);
    const who = `${name}${model ? ` on ${model}` : ''}${time ? `, ${time} on this step` : ''}.`;
    return { say, sub: `${who}${isForeman(first) ? '' : ' The Foreman waits for it.'} ${nothing}` };
  }
  const roles = crew.map(roleOf);
  const group = roles.every((r) => r === roles[0]) ? `${crew.length} ${roles[0]}s` : `${crew.length} crew`;
  const since = crew.map((c) => (c.since ? Date.parse(c.since) : NaN)).filter(Number.isFinite);
  const time = since.length ? forHowLong(new Date(Math.min(...since)).toISOString(), now) : null;
  return { say, sub: `${group} on this step: ${andList(crew.map(nameOf))}${time ? `, ${time}` : ''}. The Foreman waits for them. ${nothing}` };
}

/** While evidence records: what it does, and the Tester's checks when none failed. */
export const RECORDING_SUB = `${BRAND.name} plays each acceptance line in a hidden browser.`;
/** Watch is the laptop's: the website says so instead of offering it. */
export const WATCH_ON_LAPTOP = 'You can watch it on the laptop.';
function checksLine(checks: TestChecks | null): string {
  const passed = checks?.passed ?? 0;
  if (!checks || passed <= 0 || (checks.failed ?? 0) > 0) return '';
  return ` The Tester’s checks passed, ${passed} of ${passed + (checks.notRun ?? 0)}.`;
}

/** The lane's words for a pull request in review, as the bar says them ("PR #1 is open. Waiting on a review"). */
const reviewSay = (reason: string | null | undefined) => (reason ? reason.replace(/^(PR #\d+ is open), waiting on a review$/, '$1. Waiting on a review') : 'Waiting on a review');

/** The step is his on an Auto job: the lane's "Auto stopped: …" (Task 6b), else, once he wrote, this. */
export const AUTO_YOURS = 'Auto stopped: you wrote to this job while this step waited, so it is yours to decide.';
export const AUTO_STOPPED_SUB = 'Answer it yourself and Auto carries on from there.';
function autoStopped(job: Job): string | null {
  const reason = autoLaneReason(job);
  if (reason?.startsWith('Auto stopped')) return reason;
  return job.auto?.on === true && job.auto.yours === true ? AUTO_YOURS : null;
}

const SENDING_WORDS = 'Sending…';
const SENDING_OFF = 'Off while your decision is being sent.';

interface AfterSend {
  decision: GateSent;
  /** What the page's live region says: sending, sent, stuck, or nothing. */
  live: string;
  /** Where focus goes when the sent line shows and focus would otherwise be lost, and Try again. */
  sayRef: RefObject<HTMLSpanElement | null>;
  tryRef: RefObject<HTMLButtonElement | null>;
  /** The second line while a reply or a send back waits (null: the bar keeps its own). */
  more: string | null;
  /** What the bar says instead of its own words, while a decision waits for the Foreman (null: nothing waits). */
  say: ReactNode;
  stuck: boolean;
  /** Try again is out (it spins; the bar's other calls rest). */
  retrying: boolean;
  tryAgain(): void;
  /** Why Try again sent nothing: the server's own sentence. */
  problem: string | null;
  problemRef: RefObject<HTMLParagraphElement | null>;
}

/**
 * The decision this job's gate card sent, as the bar shows it: watched here (gateSent.ts clears it
 * once the job moves on), with Try again sending the same decision once more.
 */
function useAfterSend(job: Job, run: Run | null, reload: () => void, queuedId: string | null, session: string | null): AfterSend {
  const { api } = useWorkshop();
  const decision = useGateSent(job, run, queuedId, session);
  const sayRef = useRef<HTMLSpanElement>(null);
  const tryRef = useRef<HTMLButtonElement>(null);
  const problemRef = useRef<HTMLParagraphElement>(null);
  const [retrying, setRetrying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const out = decision.state;
  useEffect(() => { if (out === 'sending' && !retrying) setProblem(null); }, [out, retrying]);
  async function tryAgain() {
    if (out === 'sending') return;
    setProblem(null);
    setRetrying(true);
    try {
      const r = await decision.retry(api);
      if (!r?.sent && r?.message) setProblem(r.message);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
      reload();
    }
  }
  const waits = out === 'sent' || out === 'stuck' || (retrying && out === 'sending');
  const lines = stateLines(decision, job);
  const words = lines?.words ?? STUCK_WORDS;
  const shown = !waits ? null : out === 'sent' ? 'sent' : 'stuck';
  const tryShown = out === 'stuck' || retrying;
  const more = out === 'sent' ? lines?.more ?? null : null;
  // Focus stays on the pressed button while it spins (a busy button keeps it). When the sent or stuck
  // line shows, or Try again goes, and the focus would be lost (on nothing, or on a call now off), it
  // moves to the line, to Try again once stuck, or to the server's sentence when Try again was
  // refused. Focus somewhere else (the card's note) is left where it is, and so is focus when the
  // line is being cleared in this same pass (the job has already moved on).
  useEffect(() => {
    const at = document.activeElement as HTMLElement | null;
    const lost = !at || at === document.body || !at.isConnected || (at as HTMLButtonElement).disabled === true;
    if (!lost) return;
    if (shown && !decision.moved) (shown === 'stuck' ? tryRef.current ?? sayRef.current : sayRef.current)?.focus();
    else if (!shown && problem) problemRef.current?.focus();
  }, [shown, tryShown, problem, decision.moved]);
  return {
    decision,
    more,
    live: out === 'sending' ? SENDING_WORDS : lines ? linesText(lines) : '',
    sayRef,
    tryRef,
    say: waits ? <span ref={sayRef} tabIndex={-1}>{words}</span> : null,
    stuck: tryShown,
    retrying: retrying && out === 'sending',
    tryAgain: () => { void tryAgain(); },
    problem,
    problemRef,
  };
}

function TryAgain({ after }: { after: AfterSend }) {
  return (
    <Button ref={after.tryRef} size="lg" busy={after.retrying} busyLabel={SENDING_WORDS} onClick={after.tryAgain} title="Send the same decision to the Foreman once more.">
      Try again
    </Button>
  );
}

/**
 * The go / no go bar while a gate waits. The gate card under it keeps every rule (its questions,
 * the decisions made for you, a stale plan, the evidence); its own row of buttons is hidden, and
 * the bar's three calls press them (Reply opens the message box). Go is off while the card asks a question: a never answers one.
 */
function GoBar({ job, detail, now, reload, call, foldCard = false, foldHere = false, after, sent, run, evidence, hidden = false }: { job: Job; detail: NonNullable<ReturnType<typeof useJobConversation>['thread']['detail']>; now: Date; reload(): void; call: boolean; foldCard?: boolean; /** See NextStep. */ foldHere?: boolean; after: AfterSend; sent: SentShown | null; run: Run | null; evidence?: EvidenceView | null; /** A permission card has the bar's place: kept, not shown, its keys at rest. */ hidden?: boolean }) {
  // With foldCard the brief is remembered open or folded (useShown); over the job page's conversation
  // it starts as one row each time and is opened there only.
  const [stageShown, setStageShown] = useShown('stage', 'brief');
  const [shownHere, setShownHere] = useState(false);
  const [wasHere, setWasHere] = useState(foldHere);
  if (wasHere !== foldHere) {
    setWasHere(foldHere);
    if (foldHere) setShownHere(false);
  }
  const cardShown = foldHere ? shownHere : stageShown;
  const setCardShown = foldHere ? setShownHere : setStageShown;
  const folds = foldCard || foldHere;
  const body = useRef<HTMLDivElement>(null);
  const [go, setGo] = useState({ words: '', off: true, asks: false, backOff: false, replyOff: true, why: '', boxOpen: false });
  // A box open in the card (What should change?, Reply) keeps it open: typed words are never out of sight.
  const folded = folds && !cardShown && !go.boxOpen;
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const read = () => {
      const b = el.querySelector<HTMLButtonElement>('[data-gate="approve"]');
      const back = el.querySelector<HTMLButtonElement>('[data-gate="revise"]');
      // Off whenever the card's button can't be pressed: disabled, aria-disabled, or busy.
      const reply = el.querySelector<HTMLButtonElement>('[data-gate="guidance"]');
      // The card's own reason when Go must wait for something on it (words typed for a send back).
      const next = { words: wordsOf(b), off: !isPressable(b), asks: Boolean(el.querySelector('.gate-question')), backOff: !isPressable(back), replyOff: !isPressable(reply), why: b?.dataset.offWhy ?? '', boxOpen: Boolean(el.querySelector('.gate-note')) };
      setGo((was) => (was.words === next.words && was.off === next.off && was.asks === next.asks && was.backOff === next.backOff && was.replyOff === next.replyOff && was.why === next.why && was.boxOpen === next.boxOpen ? was : next));
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    return () => watch.disconnect();
  }, [detail]);
  const press = (what: 'approve' | 'revise') => { const b = body.current?.querySelector(`[data-gate="${what}"]`); if (isPressable(b)) b.click(); };
  // Send back and Reply open a box in the card: a folded brief opens first so the box is seen.
  const reply = () => { if (folded) setCardShown(true); pressReply(body.current); };
  const gate = detail.gate;
  const goWords = go.words || 'Approve';
  // The call pressed spins while its decision is out (the card's own button was pressed for it).
  const out = after.decision.state === 'sending' && !after.retrying;
  const spins = (kind: string) => out && after.decision.kind === kind;
  // Why a greyed call is off: a decision on its way (m2), else the card under the bar says.
  const offWhy = out ? SENDING_OFF : 'Off for now: the card under this says why.';
  // His decision went (I1): the sent line, the second line for what was sent, and no calls; Try
  // again only once nothing has moved and no run is at work.
  const waits = Boolean(after.say) || sent !== null;
  const sentSay = after.say ?? <span ref={after.sayRef} tabIndex={-1}>{sent?.words}</span>;
  // Auto stopped (or the step is his): the stop look with its reason, and the same three calls.
  const stopped = waits ? null : autoStopped(job);
  return (
    <div className="job-go" hidden={hidden}>
      <NextBar
        tone={stopped ? 'stop' : 'go'}
        icon={stopped ? 'hand' : 'clipboard'}
        label={call && !waits ? 'Go / no go' : null}
        say={waits ? sentSay : stopped ?? (gate?.headline || (typeof job.headline === 'string' && job.headline) || 'The Foreman waits for your go-ahead')}
        sub={waits ? (sent?.more ?? after.more) : stopped ? AUTO_STOPPED_SUB : autoLaneReason(job) ?? (gate?.nextProposed ? `Say go and the Foreman goes ahead: ${gate.nextProposed}` : job.laneReason)}
      >
        {/* Try again: the send itself is stuck, or the answered brief has stalled with no run at work. */}
        {waits && !isActiveRun(run) && (after.stuck || sent?.canRetry) && <TryAgain after={after} />}
        {/* On the hosted site a Go made there waits for the laptop (the card under this says so): no calls meanwhile. */}
        {!waits && !isOpen(queuedOf(detail.queued)) && <>
        <Button size="lg" keyId="gate-revise" busy={spins('changes')} busyLabel={SENDING_WORDS} disabled={go.backOff} onClick={() => { if (folded) setCardShown(true); press('revise'); }} title={go.backOff ? offWhy : 'No go: say what should change. The Foreman stays at this stop and revises; nothing is approved (key: r).'}>
          {call ? 'No go: send back' : 'Send back'}
        </Button>
        {/* Reply opens the card's message box: on whenever the card waits, even with a question open. It never approves. */}
        <Button size="lg" busy={spins('message')} busyLabel={SENDING_WORDS} disabled={go.replyOff} onClick={reply} title={go.replyOff ? offWhy : 'Answer a question or leave a note for the Foreman. Nothing is approved. Your answers so far go with it.'}>
          Reply
        </Button>
        {/* Go is on whenever the card's own Approve is: with questions it sends your answers too (the
            picked ones show under this), but the a key never answers a question, so it shows no key. */}
        <Button
          kind="primary"
          size="lg"
          keyId={go.asks ? undefined : 'gate-approve'}
          keyShown
          busy={spins('approve')}
          busyLabel={SENDING_WORDS}
          disabled={go.off}
          onClick={() => press('approve')}
          title={go.off ? go.why || (out ? SENDING_OFF : 'Go is off for now: the card under this says why.') : go.asks ? `${goWords}, with your answers to the questions under this. The a key never answers a question.` : `${goWords} (key: a).`}
        >
          {call ? `Go: ${lowerFirst(goWords)}` : goWords}
        </Button>
        </>}
      </NextBar>
      {autoDeciding(job) && !stopped && !waits && <p className="job-go-auto muted">{AUTO_DECIDING_NOTE}</p>}
      {folds && (
        <button type="button" className="desk-details-row stage-brief-row" aria-expanded={!folded} onClick={() => setCardShown(folded)} title={folded ? 'Show the brief’s questions and details here; Go sends the answers picked in it.' : 'Fold the brief back to this row.'}>
          <Icon name="file" size={16} />
          <span className="desk-details-words"><b>The brief</b><span className="muted">{foldHere ? 'its questions and details; Go sends the answers picked in it' : 'its questions and details, also on the job’s page; Go sends the answers picked in it'}</span></span>
          <Icon name="chevron-down" size={14} className={`fold-chevron${folded ? '' : ' is-up'}`} />
        </button>
      )}
      <div ref={body} className="job-gate-body" hidden={folded}>
        <GateSlot job={job} detail={detail} now={now} reload={reload} callsOutside onOpenBox={() => { if (folded) setCardShown(true); }} evidence={evidence} keysOff={hidden} />
      </div>
    </div>
  );
}

/**
 * No gate and no permission: what is happening, in words, and the one thing you can do. While the
 * crew works: who, on what, on which model and for how long, with no button. While evidence
 * records: the line it is on, with Watch on the laptop.
 */
function StateBar({ job, now, checks, onShip, onWatch, onWrite, hosted, after }: { job: Job; now: Date; checks: TestChecks | null; onShip?: () => void; onWatch?: () => void; onWrite?: () => void; hosted: boolean; after: AfterSend }) {
  const lane = laneOf(job);
  let tone: NextTone = 'quiet';
  let icon: IconName = 'clock';
  let say: ReactNode = job.laneReason || 'Nothing for you to do right now';
  let sub: ReactNode = null;
  let action: ReactNode = null;
  const prs = onShip
    ? <Button kind="primary" size="lg" onClick={onShip} title="The pull requests and what waits on them.">See the pull requests</Button>
    : <Button kind="primary" size="lg" href={jobHref(job.slug)} title="The job’s page: its Ship tab has the pull requests.">See the pull requests</Button>;
  const write = <Button kind="primary" size="lg" keyId="write" keyShown onClick={onWrite ?? (() => document.querySelector<HTMLTextAreaElement>('[data-composer-input]')?.focus())} title="Write to the Foreman (key: c).">Reply</Button>;
  const testing = text(job.testing);
  const working = workingWords(job, now);
  /** The Foreman waits for him: its question (or what the card says), and Reply. */
  const asked = () => {
    tone = 'stop'; icon = 'help'; say = 'The Foreman asked you something';
    sub = (typeof job.headline === 'string' && job.headline) || job.laneReason || 'Read its last message in the conversation, then reply.'; action = write;
  };
  if (job.closed) {
    tone = 'quiet'; icon = 'circle-check';
    say = job.closed.as === 'done' ? 'This job is marked done' : 'This job was dropped';
    sub = 'Reopen it from the gear; a message to the Foreman reopens it too.'; action = null;
  } else if (lane === 'done') {
    icon = 'circle-check'; say = 'This job is done'; sub = job.laneReason; action = null;
  } else if (lane === 'needs-you') {
    asked();
  } else if (job.limitPaused || job.group === 'paused') {
    tone = 'warn'; icon = 'pause'; say = 'Paused'; sub = job.laneReason;
  } else if (lane === 'in-review') {
    icon = 'eye'; say = reviewSay(job.laneReason); sub = 'Nothing for you to do. We’ll tell you if it gets comments.';
    action = prs;
  } else if (lane === 'ready') {
    tone = 'go'; icon = 'merge'; say = 'Ready to merge'; sub = job.laneReason;
    action = prs;
  } else if (lane === 'resting') {
    icon = 'moon'; say = 'Nothing happening'; sub = 'It waits for your next message.'; action = write;
  } else if (job.waitingFor === 'approval' || job.waitingFor === 'answers') {
    // The card says a go-ahead or answers wait for him but no gate shows (its details are loading, or did not come;
    // a permission never draws a gate, so it is not counted here):
    // as for the needs-you lane, never the crew's words or "Nothing for you to do".
    asked();
  } else if (testing) {
    icon = 'flask'; say = testing; sub = `${RECORDING_SUB}${checksLine(checks)}${onWatch && hosted ? ` ${WATCH_ON_LAPTOP}` : ''}`;
    action = onWatch && !hosted ? <Button size="lg" onClick={onWatch} title="Watch the evidence being recorded.">Watch</Button> : null;
  } else if (working) {
    icon = 'activity'; say = working.say; sub = working.sub;
  }
  // A decision was taken and the Foreman hasn't started yet: the bar says so (and Try again once stuck).
  if (after.say) { say = after.say; if (after.stuck) action = <TryAgain after={after} />; }
  return <NextBar tone={tone} icon={icon} say={say} sub={sub}>{action}</NextBar>;
}
