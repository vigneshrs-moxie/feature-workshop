// The Job page (#/job/<slug>), as approved in packet M's wireframes: the job's name with its
// ticket, lane and level, the gear (the job menu); the map of seven stops, each a link to its
// Stage (in Play full each circle wears a small face of the crew member who works it, over faint
// grid lines); then one next step: the go / no go bar while a gate waits (No go: send back r,
// Go a; the gate card's questions and the decisions made for you sit under it), the permission
// alert while a permission waits (it takes the bar's place), or what is happening in words. Then
// one tab per kind of work, opened at the current stop (Brief, Spec, Plan, Code, Tests with L's
// evidence and Try it, Review, Decisions, Ship), the folded conversation, and the message box (c).
import { isOpen, queuedOf } from '../views/Hosted/QueuedDecision';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { Job, JobDetail, JobDocEntry, Run, StopId } from '../api/types';
import { jobHref, navigate, screensHref, stageHref } from '../app/router';
import { useUi } from '../app/ui';
import { useDetail, useShown } from '../app/detail';
import { More } from '../components/More';
import { NowLine } from '../components/NowLine';
import { Button, isPressable } from '../components/Button';
import { Chip } from '../components/Chip';
import { Icon, type IconName } from '../components/Icon';
import { Fold, FoldShow, NextBar, Page, useMinWidth, useNarrow, type GuideSpec, type NextTone } from '../components/page/Page';
import { PermissionAlert } from '../components/permissions/PermissionAlert';
import { StopMap } from '../components/stops/StopMap';
import { STOPS, stopOf } from '../components/stops/stops';
import { chipTone, laneOf, LANE_INFO, stateChip } from '../home/JobsPage';
import { jobFacts, whereLine } from '../home/nudges';
import { relativeTime, useNow } from '../lib/time';
import { EvidenceStrip } from '../panes/Foreman/EvidenceStrip';
import { ThreadList, useCurrentJob, useJobConversation } from '../panes/Foreman/ForemanPane';
import { Composer } from '../panes/Foreman/Composer';
import { GateSlot, pressReply } from '../panes/Foreman/GateCard';
import { useGateSent, type GateSent } from '../panes/Foreman/gateSent';
import { isActiveRun } from '../panes/Foreman/thread';
import { DECIDING_KINDS, openGate } from '../lib/gateCard';
import { JobGithub } from '../panes/Foreman/JobGithub';
import { JobMenu } from '../panes/Foreman/JobHeader';
import { LevelChip } from '../panes/Foreman/LevelChip';
import { CopyDecisions } from './CopyDecisions';
import { AutoSwitch } from './AutoSwitch';
import { WhatAutoDecided } from './WhatAutoDecided';
import { AUTO_DECIDING_NOTE, autoDeciding, autoLaneReason } from './autoLine';
import { DecisionsTab } from '../panes/Preview/DecisionsTab';
import { DocsTab } from '../panes/Preview/DocsTab';
import { TryTab } from '../panes/Preview/TryTab';
import { WalkthroughTab } from '../panes/Preview/WalkthroughTab';
import { usePlay } from '../play/usePlay';
import { GithubLine } from '../views/Review/GithubLine';
import { ReviewBar } from '../views/Review/ReviewBar';
import { ReviewPanel } from '../views/Review/ReviewPanel';
import { isRoundCard, ROUND_NUDGES, useReview } from '../views/Review/useReview';
import { jobBySlug } from '../state/reducer';
import { useWorkshop, useWorkshopState } from '../state/store';
import { CodeTab } from './CodeTab';
import { PartOfStack, StackSuggestion, useStackIndex } from '../views/Stack/StackRows';

export const JOB_GUIDE: GuideSpec = {
  id: 'job',
  title: 'How a job works',
  done: 'Show me this job',
  cards: [
    { icons: ['file', 'clipboard', 'hammer', 'rocket'], title: 'Seven stops', say: 'Every job goes Spec to Ship. Click a stop to see who works on it.' },
    { icons: ['hand'], title: 'The hand means you', say: 'At some stops the Foreman waits for your go.' },
    { icons: ['message'], title: 'Talk any time', say: 'Write to the Foreman at the bottom; the tabs hold its work.' },
  ],
};

export type JobTab = 'brief' | 'spec' | 'plan' | 'code' | 'tests' | 'review' | 'decisions' | 'ship';
export const JOB_TABS: readonly { id: JobTab; label: string; stop: StopId | null; hint: string }[] = [
  { id: 'brief', label: 'Brief', stop: null, hint: 'The Foreman’s briefs to you, newest first.' },
  { id: 'spec', label: 'Spec', stop: 'spec', hint: 'The product spec, what it must do to be ready, and the screens when there are some.' },
  { id: 'plan', label: 'Plan', stop: 'plan', hint: 'The findings and the plans the crew works from.' },
  { id: 'code', label: 'Code', stop: 'build', hint: 'The commits on the job’s branch, and what each one changed.' },
  { id: 'tests', label: 'Tests', stop: 'test', hint: 'What was tested and what the tests showed, the test report, and Try it on your computer.' },
  { id: 'review', label: 'Review', stop: 'review', hint: 'The reviewers’ findings and the review walkthrough.' },
  { id: 'decisions', label: 'Decisions', stop: null, hint: 'Every choice you made on this job, newest first.' },
  { id: 'ship', label: 'Ship', stop: 'ship', hint: 'The pull requests and what waits on them.' },
];

/** The tab a stop opens at. */
export function tabForStop(stop: StopId | null): JobTab {
  switch (stop) {
    case 'spec': return 'spec';
    case 'investigate': case 'plan': return 'plan';
    case 'build': return 'code';
    case 'test': return 'tests';
    case 'review': return 'review';
    case 'ship': return 'ship';
    default: return 'brief';
  }
}

/** The button the bar holds at each stop, greyed until there is something to approve. */
export const STOP_ACTION: Record<StopId, string> = {
  spec: 'Approve the spec', investigate: 'Approve the plan', plan: 'Approve the plan', build: 'Approve the tests',
  test: 'Approve the tests', review: 'Approve the review', ship: 'Open the pull request',
};

const isSpecDoc = (d: JobDocEntry) => /(^|\/)(spec|clarif|refine|acceptance|wirefram|screens)/i.test(d.file);
const isTestDoc = (d: JobDocEntry) => /test/i.test(d.file);

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

export function JobPage({ slug }: { slug: string }) {
  const state = useWorkshopState();
  const job = jobBySlug(state, slug);
  if (!job) {
    return (
      <Page label="Job" title="Job">
        {state.runs[slug]
          ? <p className="muted" role="status">Starting the job… It appears here in a moment.</p>
          : <p className="muted">There’s no job called “{slug}”. It may have been renamed or removed.</p>}
      </Page>
    );
  }
  return <JobView key={slug} job={job} />;
}

function JobView({ job }: { job: Job }) {
  const now = useNow();
  const play = usePlay();
  const ui = useUi();
  const narrow = useNarrow();
  const conversation = useJobConversation(job);
  useCurrentJob(job, conversation);
  const { thread, run } = conversation;
  const lane = laneOf(job);
  const state = useWorkshopState();
  const chip = stateChip(job, state.permissions);
  const at = stopOf(job.stage);
  const [tab, setTab] = useState<JobTab>(() => tabForStop(at));
  const [tryOpen, setTryOpen] = useState(false);
  // Something asked for a tab (Try it, a document link, ⌘K Open docs): the job's work opens.
  const [workAsked, setWorkAsked] = useState(false);

  // The job menu's or the gate card's "Try it on your computer": the Tests tab, with Try it open.
  const handledTry = useRef(ui.tryRequest);
  useEffect(() => {
    if (ui.tryRequest === handledTry.current) return;
    handledTry.current = ui.tryRequest;
    if (ui.trySlug === job.slug) { setTab('tests'); setTryOpen(true); setWorkAsked(true); }
  }, [ui.tryRequest, ui.trySlug, job.slug]);
  // "Review the screens" (a chip, the wireframes page in a list): the full-width Screens page, which
  // takes the request as it mounts. The gate card goes there itself when no frame shows the page.
  const handledScreens = useRef(ui.screensRequest);
  useEffect(() => {
    if (ui.screensRequest === handledScreens.current) return;
    handledScreens.current = ui.screensRequest;
    if (ui.screensSlug === job.slug) navigate({ name: 'screens', slug: job.slug });
  }, [ui.screensRequest, ui.screensSlug, job.slug]);
  // ⌘K "Open docs" or a link to another of the job's documents: it opens in the document tab you
  // are on, else in the Plan tab (which then acts on the request as it opens).
  const handledDocs = useRef(ui.docsRequest);
  const replayDocs = useRef(false);
  if (ui.docsRequest !== handledDocs.current) {
    handledDocs.current = ui.docsRequest;
    if (!DOC_TABS.has(tab)) { replayDocs.current = true; setTab('plan'); }
    if (!workAsked) setWorkAsked(true);
  }
  const replay = replayDocs.current;
  useEffect(() => { replayDocs.current = false; });

  const ticket = ticketOf(job);
  const messages = thread.items.length;
  const messagesNote = messages ? `${messages} ${messages === 1 ? 'message' : 'messages'}` : undefined;
  const stacks = useStackIndex(); // a stack's part says which stack it belongs to (packet K2)
  // From 1280 px the page is two columns (packet R): the next step, the brief and the tabs on the
  // left; the conversation and the message box, who is working and the job's details on the right,
  // staying in view as the left one scrolls. Narrower, one column as before.
  const wide = useMinWidth(1280);
  // Simple (packet R): the newest message with "Earlier (n)"; the tabs and the facts one click away.
  const [detail] = useDetail();
  const thread_ = <ThreadList job={job} conversation={conversation} now={now} cards={false} newest={detail === 'simple' ? 1 : undefined} />;
  const workCount = JOB_TABS.length;
  // The Foreman's model, fixed once the job has started: a locked line in Details.
  const modelId = thread.detail?.drive?.sessionId ? thread.detail.drive.model ?? null : null;
  const modelLabel = modelId ? state.meta?.models?.find((m) => m.id === modelId)?.label ?? modelId : null;
  return (
    <Page
      label="Job"
      title={job.title || job.slug}
      className={`page-job play-${play.mode}${wide ? ' is-wide' : ''}`}
      guide={JOB_GUIDE}
      head={(
        <>
          <Chip tone={chipTone(lane, chip.word)} icon={chip.icon} className={`state-chip is-${lane}`} title={LANE_INFO[lane].hint}>{chip.word}</Chip>
          {/* The stops as a thin strip on the header line (packet R); the labelled map is in Details. */}
          <section className="job-strip" aria-label="The job’s stops"><StopMap job={{ ...job, lane }} compact hrefFor={(s) => stageHref(job.slug, s)} label="The job’s stops: each opens who works on it" /></section>
          {narrow && <PartOfStack slug={job.slug} index={stacks} />}
          <span className="spacer" />
          {/* Auto (C1): the switch with its line, and What Auto decided, where he answers. */}
          <div className="job-auto"><AutoSwitch job={job} /><WhatAutoDecided slug={job.slug} auto={job.auto} /></div>
          <CopyDecisions slug={job.slug} />
          <JobMenu job={job} dir={thread.detail?.dir} policyOverride={thread.detail?.policyOverride} run={run} worktree={thread.detail?.worktree} started={Boolean(thread.detail?.drive?.sessionId)} gear />
        </>
      )}
    >
      <StackSuggestion job={job} index={stacks} />
      <div className="job-layout">
        <div className="job-main">
          <NextStep job={job} conversation={conversation} now={now} onShip={() => setTab('ship')} />
          <More screen="job" id="work" label="The job’s work" note={`${JOB_TABS.map((t) => t.label).slice(0, workCount).join(', ')}`} icon="file" className="is-card job-work" open={workAsked}>
            <JobTabs job={job} tab={tab} onTab={setTab} narrow={narrow} tryOpen={tryOpen} onTry={setTryOpen} docs={{ focusRequest: ui.docsRequest, requestFile: ui.docsFile, replay }} />
          </More>
        </div>
        <aside className="job-side" aria-label="The conversation and the job">
          <NowLine job={job} now={now} className="job-now" />
          <More screen="job" id="details" label="Details" note="level, stops, who is working, facts" icon="list" className="is-card job-details">
            <div className="job-details-head">
              {ticket && <Chip className="num">{ticket}</Chip>}
              {thread.detail?.auto?.tag && <Chip tone="accent">{`Started by Auto (tag: ${thread.detail.auto.tag})`}</Chip>}
              <CopyDecisions slug={job.slug} />
              <LevelChip job={job} ready={Boolean(thread.detail)} />
              <PartOfStack slug={job.slug} index={stacks} />
              {modelLabel && (
                <span className="job-model muted" title="Fixed for this job. Change model… in the job menu starts the job again.">
                  <Icon name="lock" size={12} /> Foreman model: {modelLabel}
                </span>
              )}
            </div>
            <section className={`job-map${play.full ? ' has-grid' : ''}`} aria-label="The job’s stops, in full">
              <StopMap job={{ ...job, lane }} faces={play.full && !narrow} label="Every stop, with its name" />
            </section>
            <JobFacts job={job} now={now} />
          </More>
          {wide ? (
            <section className="job-convo" aria-label="Conversation">
              <header className="job-side-head"><Icon name="message" size={16} /><h3>Conversation</h3>{messagesNote && <span className="muted">· {messagesNote}</span>}</header>
              <div className="job-convo-thread">{thread_}</div>
              <Composer key={job.slug} slug={job.slug} detail={thread.detail} run={run} />
            </section>
          ) : (
            <>
              <Fold icon="message" name="Conversation" note={messagesNote} id={`job-convo-${job.slug}`}>{thread_}</Fold>
              <Composer key={job.slug} slug={job.slug} detail={thread.detail} run={run} />
            </>
          )}
        </aside>
      </div>
    </Page>
  );
}

/** Who is working on the job now, and its facts and where its work is (the wide Job page's side). */
function JobFacts({ job, now }: { job: Job; now: Date }) {
  const crew = job.nowDoing ?? [];
  return (
    <section className="job-side-card" aria-label="This job">
      {crew.length > 0 && (
        <div className="job-side-group">
          <h4 className="eyebrow">Working now</h4>
          <ul className="job-crew">
            {crew.map((c, i) => (
              <li key={`${c.who}-${i}`}>
                <span className="job-crew-who">{c.name || c.who}</span>
                {c.doing && <span className="muted job-crew-doing">{c.doing}</span>}
                {c.since && <time className="muted num" dateTime={c.since}>{relativeTime(c.since, now)}</time>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="job-side-group">
        <h4 className="eyebrow">This job</h4>
        <p className="job-facts-line">{jobFacts(job).map((f, i) => <span key={i}>{f}</span>)}</p>
        <p className="job-where" title="Where the job’s work is, from the finish line and its PRs.">{whereLine(job)}</p>
      </div>
    </section>
  );
}

/**
 * The one next step, on the Job page and each Stage: the permission alert while a permission waits
 * (oldest first), else the go / no go bar while a gate waits, else, while a pull request is in
 * review, the review round's bar (packet Q: its card is answered here, not as a permission), else
 * what is happening in words. `onShip` shows the pull requests (the Ship tab); without it, the
 * button goes to the Job page.
 */
export function NextStep({ job, conversation, now, onShip, foldCard = false }: { job: Job; conversation: ReturnType<typeof useJobConversation>; now: Date; onShip?: () => void; /** A stop's page: the brief under the bar folds to one row (the Job page has it in full). */ foldCard?: boolean }) {
  const state = useWorkshopState();
  const play = usePlay();
  const review = useReview(job.slug);
  const { thread, run } = conversation;
  const after = useAfterSend(job, run, thread.reload, queuedOf(thread.detail?.queued)?.id ?? null);
  const perms = state.permissions.filter((p) => p.slug === job.slug && !isRoundCard(p));
  // One live region, always here (empty when nothing is out), so each of sending, sent and stuck is
  // announced once; the bar shows the same words, but not as a live region.
  // The brief is answered (or his reply's run is at work): the bar keeps saying it was sent.
  const sent = perms.length === 0 ? sentView(job, thread.detail, run, after.decision) : null;
  const live = <p className="sr-only" role="status" data-next-live>{after.live || (sent ? [SENT_WORDS, sent.more].filter(Boolean).join(' ') : '')}</p>;
  const problem = after.problem && <p ref={after.problemRef} className="field-problem" role="alert" tabIndex={-1}>{after.problem}</p>;
  let bar: ReactNode;
  if (perms.length > 0) bar = <PermissionAlert permissions={perms} now={now} />;
  else if (thread.detail?.gate) bar = <GoBar job={job} detail={thread.detail} now={now} reload={thread.reload} call={play.on} foldCard={foldCard} after={after} sent={sent} run={run} />;
  else if (review.view) bar = <ReviewBar view={review.view} act={review.act} problem={review.problem} />;
  else bar = <StateBar job={job} onShip={onShip} after={after} />;
  return <>{bar}{live}{problem}</>;
}

/** The bar after a decision was taken (spec 1.2): its words, and Try again once nothing has moved. */
const SENT_WORDS = 'Sent. Waiting for the Foreman to start.';
const STUCK_WORDS = 'Nothing has moved yet.';
/** The second line under the sent line, by what was sent (an approval has none). */
const SENT_MORE: Partial<Record<string, string>> = {
  message: 'Your reply is with the Foreman. Nothing is approved.',
  changes: 'The Foreman will rework this step with your note.',
};

const SENDING_WORDS = 'Sending…';

/** What the bar says once his decision on the waiting brief went: the second line by what was sent. */
interface SentView { more: string | null }

/**
 * The bar after the server took his decision (deep review D, I1). The server answers `sent` with a
 * started run, so the sent state clears at once; the bar keeps saying it was sent, with no calls,
 * while the brief is answered (the job's detail says so, or the server took a deciding answer to this
 * brief), or while the run his reply started works. Null: the bar asks as usual.
 */
function sentView(job: Job, detail: JobDetail | null | undefined, run: Run | null, decision: GateSent): SentView | null {
  const gate = detail?.gate ?? null;
  if (!gate || job.closed) return null;
  const a = decision.accepted;
  const thisBrief = a !== null && a.brief !== null && a.brief === (gate.briefNumber ?? null);
  const answered = openGate(detail, false) === null || (thisBrief && DECIDING_KINDS.includes(a.kind));
  const replying = !answered && a?.kind === 'message' && a.runId !== null && isActiveRun(run) && run.id === a.runId;
  if (!answered && !replying) return null;
  return { more: a && (thisBrief || replying) ? SENT_MORE[a.kind] ?? null : null };
}

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
function useAfterSend(job: Job, run: Run | null, reload: () => void, queuedId: string | null): AfterSend {
  const { api } = useWorkshop();
  const decision = useGateSent(job, run, queuedId);
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
  const words = out === 'sent' ? SENT_WORDS : STUCK_WORDS;
  const shown = !waits ? null : out === 'sent' ? 'sent' : 'stuck';
  const tryShown = out === 'stuck' || retrying;
  const more = out === 'sent' && decision.kind ? SENT_MORE[decision.kind] ?? null : null;
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
    live: out === 'sending' ? SENDING_WORDS : out === 'sent' ? [SENT_WORDS, more].filter(Boolean).join(' ') : out === 'stuck' ? STUCK_WORDS : '',
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
function GoBar({ job, detail, now, reload, call, foldCard = false, after, sent, run }: { job: Job; detail: NonNullable<ReturnType<typeof useJobConversation>['thread']['detail']>; now: Date; reload(): void; call: boolean; foldCard?: boolean; after: AfterSend; sent: SentView | null; run: Run | null }) {
  const [cardShown, setCardShown] = useShown('stage', 'brief');
  const folded = foldCard && !cardShown;
  const body = useRef<HTMLDivElement>(null);
  const [go, setGo] = useState({ words: '', off: true, asks: false, backOff: false, replyOff: true, why: '' });
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const read = () => {
      const b = el.querySelector<HTMLButtonElement>('[data-gate="approve"]');
      const back = el.querySelector<HTMLButtonElement>('[data-gate="revise"]');
      // Off whenever the card's button can't be pressed: disabled, aria-disabled, or busy.
      const reply = el.querySelector<HTMLButtonElement>('[data-gate="guidance"]');
      // The card's own reason when Go must wait for something on it (words typed for a send back).
      const next = { words: wordsOf(b), off: !isPressable(b), asks: Boolean(el.querySelector('.gate-question')), backOff: !isPressable(back), replyOff: !isPressable(reply), why: b?.dataset.offWhy ?? '' };
      setGo((was) => (was.words === next.words && was.off === next.off && was.asks === next.asks && was.backOff === next.backOff && was.replyOff === next.replyOff && was.why === next.why ? was : next));
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
  // His decision went (I1): the sent line, the second line for what was sent, and no calls; Try
  // again only once nothing has moved and no run is at work.
  const waits = Boolean(after.say) || sent !== null;
  const sentSay = after.say ?? <span ref={after.sayRef} tabIndex={-1}>{SENT_WORDS}</span>;
  return (
    <div className="job-go">
      <NextBar
        tone="go"
        icon="clipboard"
        label={call && !waits ? 'Go / no go' : null}
        say={waits ? sentSay : (gate?.headline || (typeof job.headline === 'string' && job.headline) || 'The Foreman waits for your go-ahead')}
        sub={waits ? (sent?.more ?? after.more) : autoLaneReason(job) ?? (gate?.nextProposed ? `Say go and the Foreman goes ahead: ${gate.nextProposed}` : job.laneReason)}
      >
        {waits && after.stuck && !isActiveRun(run) && <TryAgain after={after} />}
        {/* On the hosted site a Go made there waits for the laptop (the card under this says so): no calls meanwhile. */}
        {!waits && !isOpen(queuedOf(detail.queued)) && <>
        <Button size="lg" keyId="gate-revise" busy={spins('changes')} busyLabel={SENDING_WORDS} disabled={go.backOff} onClick={() => { if (folded) setCardShown(true); press('revise'); }} title={go.backOff ? 'Off for now: the card under this says why.' : 'No go: say what should change. The Foreman stays at this stop and revises; nothing is approved (key: r).'}>
          {call ? 'No go: send back' : 'Send back'}
        </Button>
        {/* Reply opens the card's message box: on whenever the card waits, even with a question open. It never approves. */}
        <Button size="lg" busy={spins('message')} busyLabel={SENDING_WORDS} disabled={go.replyOff} onClick={reply} title={go.replyOff ? 'Off for now: the card under this says why.' : 'Answer a question or leave a note for the Foreman. Nothing is approved. Your answers so far go with it.'}>
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
          title={go.off ? go.why || 'Go is off for now: the card under this says why.' : go.asks ? `${goWords}, with your answers to the questions under this. The a key never answers a question.` : `${goWords} (key: a).`}
        >
          {call ? `Go: ${lowerFirst(goWords)}` : goWords}
        </Button>
        </>}
      </NextBar>
      {autoDeciding(job) && !waits && <p className="job-go-auto muted">{AUTO_DECIDING_NOTE}</p>}
      {foldCard && (
        <button type="button" className="desk-details-row stage-brief-row" aria-expanded={!folded} onClick={() => setCardShown(folded)} title={folded ? 'Show the brief’s questions and details here; Go sends the answers picked in it.' : 'Fold the brief back to this row.'}>
          <Icon name="file" size={16} />
          <span className="desk-details-words"><b>The brief</b><span className="muted">its questions and details, also on the job’s page; Go sends the answers picked in it</span></span>
          <Icon name="chevron-down" size={14} className={`fold-chevron${folded ? '' : ' is-up'}`} />
        </button>
      )}
      <div ref={body} className="job-gate-body" hidden={folded}>
        <GateSlot job={job} detail={detail} now={now} reload={reload} callsOutside onOpenBox={() => { if (folded) setCardShown(true); }} />
      </div>
    </div>
  );
}

/** No gate and no permission: what is happening, in words, and the one thing you can do. */
function StateBar({ job, onShip, after }: { job: Job; onShip?: () => void; after: AfterSend }) {
  const lane = laneOf(job);
  const at = stopOf(job.stage);
  const doing = job.nowDoing?.[0]?.doing ?? null;
  let tone: NextTone = 'quiet';
  let icon: IconName = 'clock';
  let say: ReactNode = 'Nothing to do right now';
  let sub: string | null | undefined = doing ?? job.laneReason;
  let action: ReactNode = <Button size="lg" disabled title="Greyed until there is something to approve.">{at ? STOP_ACTION[at] : 'Approve'}</Button>;
  const prs = onShip
    ? <Button kind="primary" size="lg" onClick={onShip} title="The pull requests and what waits on them.">See the pull requests</Button>
    : <Button kind="primary" size="lg" href={jobHref(job.slug)} title="The job’s page: its Ship tab has the pull requests.">See the pull requests</Button>;
  const write = <Button kind="primary" size="lg" keyId="write" keyShown onClick={() => document.querySelector<HTMLTextAreaElement>('[data-composer-input]')?.focus()} title="Write to the Foreman (key: c).">Reply</Button>;
  if (job.closed) {
    tone = 'quiet'; icon = 'circle-check';
    say = job.closed.as === 'done' ? 'This job is marked done' : 'This job was dropped';
    sub = 'Reopen it from the gear; a message to the Foreman reopens it too.'; action = null;
  } else if (lane === 'done') {
    icon = 'circle-check'; say = 'This job is done'; sub = job.laneReason; action = null;
  } else if (lane === 'needs-you') {
    tone = 'stop'; icon = 'help'; say = 'The Foreman asked you something';
    sub = (typeof job.headline === 'string' && job.headline) || job.laneReason || 'Read its last message in the conversation, then reply.'; action = write;
  } else if (job.limitPaused || job.group === 'paused') {
    tone = 'warn'; icon = 'pause'; say = 'Paused'; sub = job.laneReason;
  } else if (lane === 'in-review') {
    icon = 'eye'; say = job.laneReason || 'Waiting on a review'; sub = 'Nothing for you to do. We’ll tell you if it gets comments.';
    action = prs;
  } else if (lane === 'ready') {
    tone = 'go'; icon = 'merge'; say = 'Ready to merge'; sub = job.laneReason;
    action = prs;
  } else if (lane === 'resting') {
    icon = 'moon'; say = 'Nothing happening'; sub = 'It waits for your next message.'; action = write;
  }
  // A decision was taken and the Foreman hasn't started yet: the bar says so (and Try again once stuck).
  if (after.say) { say = after.say; if (after.stuck) action = <TryAgain after={after} />; }
  return <NextBar tone={tone} icon={icon} say={say} sub={sub}>{action}</NextBar>;
}

function JobTabs({ job, tab, onTab, narrow, tryOpen, onTry, docs }: { job: Job; tab: JobTab; onTab(t: JobTab): void; narrow: boolean; tryOpen: boolean; onTry(open: boolean): void; docs: DocsAsk }) {
  const refs = useRef<Partial<Record<JobTab, HTMLButtonElement | null>>>({});
  const [all, setAll] = useState(false);
  const atIdx = STOPS.findIndex((s) => s.id === stopOf(job.stage));
  const reached = (t: (typeof JOB_TABS)[number]) => t.stop === null || atIdx < 0 || STOPS.findIndex((s) => s.id === t.stop) <= atIdx || job.lane === 'done';
  // At phone width: Brief and the open tab; the rest fold under ⋯.
  const shown = narrow && !all ? JOB_TABS.filter((t) => t.id === 'brief' || t.id === tab) : JOB_TABS;
  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = shown.findIndex((t) => t.id === tab);
    const next = shown[(i + (e.key === 'ArrowRight' ? 1 : -1) + shown.length) % shown.length].id;
    onTab(next);
    refs.current[next]?.focus();
  }
  return (
    <section className="job-tabs-wrap">
      <div className="job-tabs" role="tablist" aria-label="The job’s work">
        {shown.map((t) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`job-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="job-tab-panel"
            tabIndex={tab === t.id ? 0 : -1}
            className={`job-tab${reached(t) ? '' : ' is-later'}`}
            onClick={() => { onTab(t.id); setAll(false); }}
            onKeyDown={onKey}
            title={reached(t) ? t.hint : `${t.hint} The job hasn’t reached it yet.`}
          >
            {t.label}
          </button>
        ))}
        {narrow && !all && (
          <button type="button" className="job-tab job-tab-more" onClick={() => setAll(true)} aria-label="Show every tab" title="Show every tab.">⋯</button>
        )}
        {tab === 'ship' && !narrow && <GithubLine />}
      </div>
      {tab === 'ship' && narrow && <GithubLine className="gh-line-row" />}
      <div className="job-tab-panel" id="job-tab-panel" role="tabpanel" aria-labelledby={`job-tab-${tab}`}>
        <TabBody job={job} tab={tab} tryOpen={tryOpen} onTry={onTry} docs={docs} />
      </div>
    </section>
  );
}

/** The hand-off nudges under the review panel: the PR ones a review round covers stay hidden while it shows. */
function ShipNudges({ job }: { job: Job }) {
  const { view } = useReview(job.slug);
  return <JobGithub job={job} check={false} hide={view ? ROUND_NUDGES : undefined} />;
}

/** What the tab's documents list acts on: ⌘K "Open docs", a link to another document. */
interface DocsAsk { focusRequest: number; requestFile: string | null; replay: boolean }
/** The tabs that list documents (a document link opens in the one you are on). */
const DOC_TABS: ReadonlySet<JobTab> = new Set<JobTab>(['brief', 'spec', 'plan', 'tests', 'review']);

function TabBody({ job, tab, tryOpen, onTry, docs }: { job: Job; tab: JobTab; tryOpen: boolean; onTry(open: boolean): void; docs: DocsAsk }) {
  const slug = job.slug;
  const changed = job.updatedAt ?? null;
  switch (tab) {
    case 'brief': return <DocsTab key="briefs" {...docs} slug={slug} section="briefs" changedAt={changed} />;
    case 'spec':
      return (
        <>
          {job.wireframes && <p><Button icon="eye" href={screensHref(slug)} title="The feature’s screens, full width: click through the prototype, pin notes and pick the design choices. Copy feedback puts them in your reply.">Review the screens</Button></p>}
          <DocsTab key="spec" {...docs} slug={slug} section="plan" pick={isSpecDoc} changedAt={changed} />
        </>
      );
    case 'plan': return <DocsTab key="plan" {...docs} slug={slug} section="plan" pick={(d) => !isSpecDoc(d)} changedAt={changed} />;
    case 'code': return <CodeTab slug={slug} changedAt={changed} />;
    case 'tests':
      return (
        <>
          <EvidenceStrip slug={slug} refresh={changed} />
          <DocsTab key="tests" {...docs} slug={slug} section="review" pick={isTestDoc} changedAt={changed} />
          <details className="fold job-try" open={tryOpen} onToggle={(e) => onTry(e.currentTarget.open)}>
            <summary className="fold-head" title="Run this job’s branch on your computer and click around.">
              <Icon name="terminal" size={16} /><span className="fold-name">Try it on your computer</span>
              <FoldShow />
            </summary>
            <div className="fold-body">{tryOpen && <TryTab slug={slug} active />}</div>
          </details>
        </>
      );
    case 'review':
      return (
        <>
          <DocsTab key="review" {...docs} slug={slug} section="review" pick={(d) => !isTestDoc(d)} changedAt={changed} />
          {job.walkthrough && (
            <Fold icon="eye" name="Review walkthrough" note="every change, by zoom level">
              <WalkthroughTab slug={slug} job={job} active />
            </Fold>
          )}
        </>
      );
    case 'decisions': return <DecisionsTab slug={slug} active />;
    case 'ship': {
      const shipping = stopOf(job.stage) === 'ship' || (job.nudges?.length ?? 0) > 0;
      return shipping
        ? <><ReviewPanel slug={slug} /><ShipNudges job={job} /></>
        : <p className="muted">Nothing to ship yet. The pull requests show here from PR #1 on.</p>;
    }
  }
}
