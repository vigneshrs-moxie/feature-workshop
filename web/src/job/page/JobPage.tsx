// The job page (Part 3, design 3.1 to 3.5): App and the website mount it for #/job/<slug> and for
// a step's address, with the job as the key, so a pick never remounts it. JobScreen holds what every layout needs (the job's conversation, the shell's current
// job, the sent line and the clock); LaptopJob is the laptop's layout and everything only it uses
// (the evidence, the open step, the keys, the requests), so none of that runs on a phone.
//
// The laptop: the header (JobTop) is pinned; under it two scroll areas: the work column (a stack
// suggestion, the overview, the bar, the seven steps and the open step in place, with its body) and,
// from 1100 px, the conversation column, 400 px. Widen (or the conversation's address) gives the
// conversation the page: the work column's parts are hidden, and while the job waits for you the bar
// stays above it with its card folded to one row. Under 1100 px the conversation column is one
// Conversation button at the foot of the page, with the count of new messages; it opens the
// conversation full screen, again with the bar above it while the job waits for you. Every layout
// only hides, shows or moves parts (classes, `hidden`, CSS): the bar (NextStep) and the conversation
// (ConversationPanel) each stay in one place in the tree and are never drawn again from scratch, so
// typed words, an open box and the scroll stay through all of it.
//
// The open step: your pick on this page wins (it rewrites the address in place and is remembered
// as sb.job.step.<slug>); then the step the address names; then the step the job is at while it
// works or waits; then the one you last opened here; then the job's own step (openStep.ts). A later
// change of the address's step (a link, Back) is a pick of that step, and so is reading inside the
// open step (a click or a key press in its panel) while nothing is picked. [ and ] pick the step before
// and after; the bar's See the pull requests and Watch, the job menu's Try it and a link to a
// document pick the step they need. The step's panel stays mounted as the step changes; only its
// body changes, and only once the step's view is in.
//
// One clock, one sent line (useSentShown) and one evidence view (useJobEvidence) for the whole page.
// The open step's body is StepBody; the phone's step screen draws the same one.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject, type SyntheticEvent } from 'react';
import type { Job, JobDetail, StageAgent, StopId } from '../../api/types';
import { BRAND } from '../../app/brand';
import { useKeyScope } from '../../app/keyRegistry';
import { isJobView, jobHref, replaceHash, stageHref, type JobView } from '../../app/router';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Page, useMinWidth, useNarrow } from '../../components/page/Page';
import { isStopId, STOPS, stopOf } from '../../components/stops/stops';
import { laneOf } from '../../home/JobsPage';
import { readStored, useStored, writeStored } from '../../lib/stored';
import { useNow } from '../../lib/time';
import { focusMessageBox } from '../../panes/Foreman/Composer';
import { useCurrentJob, useJobConversation } from '../../panes/Foreman/ForemanPane';
import { useKeptBoxWords } from '../../panes/Foreman/GateCard';
import { jobBySlug } from '../../state/reducer';
import { useWorkshopState } from '../../state/store';
import { isRoundCard } from '../../views/Review/useReview';
import { StackSuggestion, useStackIndex } from '../../views/Stack/StackRows';
import { NextStep, useSentShown } from '../NextStep';
import { ConversationPanel, newCount, seenKey } from './ConversationPanel';
import { JobTop } from './JobTop';
import { lastStepKey, pickOpenStep } from './openStep';
import { OverviewCard } from './OverviewCard';
import { PhoneJob } from './PhoneJob';
import { StepBody } from './StepBody';
import { STEP_PANEL_ID, StepPanel, stepTabId } from './StepPanel';
import { StepsRow } from './StepsRow';
import { statesOf } from './stepWords';
import { recorderAgent } from './TestStep';
import { useJobEvidence } from './useJobEvidence';
import { useDocRequests, useJobMenuRequests, type DocAsk } from './useJobMenuRequests';
import { useStage } from './useStage';
import './page.css';

/** From this width the conversation is a column beside the work (design 3.4). */
export const CONVO_COLUMN_PX = 1100;
/** Where the overview's fold remembers open or closed (the Fold store, OverviewCard's id). */
const OVERVIEW_FOLD = 'gc.fold.job-overview';

type Conversation = ReturnType<typeof useJobConversation>;

export function JobPage({ slug, step, view }: { slug: string; step?: StopId; view?: JobView }) {
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
  // Another job starts the page afresh: its own pick, Watch and Try it.
  return <JobScreen key={slug} job={job} step={isStopId(step) ? step : undefined} view={isJobView(view) ? view : undefined} />;
}

/** What every layout of the page needs; then the phone's layout in a narrow window, else the laptop's. */
function JobScreen({ job, step, view }: { job: Job; step: StopId | undefined; view: JobView | undefined }) {
  const now = useNow();
  const conversation = useJobConversation(job);
  useCurrentJob(job, conversation);
  const sent = useSentShown(job, conversation);
  // Words left in the card's boxes when its brief is answered or replaced go to the message box.
  useKeptBoxWords(job, conversation.thread.detail ?? null);
  // A phone (760 px and under): its own simple screens, and nothing only the laptop uses runs.
  const narrow = useNarrow();
  if (narrow) return <PhoneJob job={job} conversation={conversation} now={now} step={step} view={view} sent={sent} />;
  return <LaptopJob job={job} conversation={conversation} now={now} step={step} view={view} sent={sent} />;
}

/** The step the job is at while it works or waits; null when it does neither (done, at rest). */
function liveStep(job: Job): StopId | null {
  const states = statesOf(job);
  return STOPS.find((s) => states[s.id] === 'now' || states[s.id] === 'waiting')?.id ?? null;
}

/** Something on the bar waits for you: a go / no go, a permission, or the Foreman's question. */
function waitsForYou(job: Job, detail: JobDetail | null, asking: boolean): boolean {
  return Boolean(detail?.gate) || asking || laneOf(job) === 'needs-you';
}

function LaptopJob({ job, conversation, now, step, view, sent }: {
  job: Job; conversation: Conversation; now: Date; step: StopId | undefined; view: JobView | undefined; sent: ReturnType<typeof useSentShown>;
}) {
  const slug = job.slug;
  const state = useWorkshopState();
  const { thread, run } = conversation;
  const detail = thread.detail ?? null;
  const stacks = useStackIndex();
  const column = useMinWidth(CONVO_COLUMN_PX);

  // ---- The conversation takes the page: Widen from 1100 px, full screen under it ----
  const [talk, setTalk] = useState(view === 'conversation');
  const [seenView, setSeenView] = useState(view);
  if (seenView !== view) {
    // The address and the full screen never drift apart: leaving the conversation's address (a
    // link, Back) gives the page back to the job.
    if (view === 'conversation') setTalk(true);
    else if (seenView === 'conversation') setTalk(false);
    setSeenView(view);
  }
  // The overview's address opens the overview (its fold remembers it, as a click would).
  useEffect(() => { if (view === 'overview') writeStored(OVERVIEW_FOLD, 'open'); }, [view]);
  const wide = column && talk;
  const full = !column && talk;
  // The full screen's own buttons come and go with it: the focus goes to Back to the job as it
  // opens, and back to the Conversation button as it closes (Widen's button stays where it is).
  // Opened to write to the Foreman, the focus goes to the message box instead.
  const focusTo = useRef<'back' | 'talk' | 'composer' | null>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const talkRef = useRef<HTMLDivElement>(null);
  const convoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const to = focusTo.current;
    // The message box only once the conversation is on screen (a child's effect may ask first).
    if (!to || (to === 'composer' && !column && !talk)) return;
    focusTo.current = null;
    if (to === 'composer') focusMessageBox(convoRef.current);
    else (to === 'back' ? backRef : talkRef).current?.querySelector<HTMLButtonElement>('button')?.focus();
  });
  /**
   * Writing to the Foreman (the bar's Reply, the c key, a decision the card hands to the message
   * box): the cursor in the message box, with the conversation opened full screen first while it
   * is behind the Conversation button (under 1100 px), so the box is always one he can see.
   */
  const writeToForeman = useCallback(() => {
    if (!column && !talk) { focusTo.current = 'composer'; setTalk(true); }
    else focusMessageBox(convoRef.current);
  }, [column, talk]);
  useKeyScope('job', { 'write': () => writeToForeman() });
  const leaveTalk = useCallback(() => {
    setTalk(false);
    // The conversation's own address would open it again: the job's address instead.
    if (view === 'conversation') replaceHash(jobHref(slug));
  }, [view, slug]);
  const asking = state.permissions.some((p) => p.slug === slug && !isRoundCard(p));
  const barShown = !talk || waitsForYou(job, detail, asking);

  // ---- The open step ----
  const [picked, setPicked] = useState<StopId | null>(null);
  // A later change of the address's step (a hashchange: a link, Back) is a pick of that step.
  const [seenStep, setSeenStep] = useState(step);
  if (seenStep !== step) {
    setSeenStep(step);
    if (step) setPicked(step);
  }
  const [last] = useState(() => { const v = readStored(lastStepKey(slug)); return isStopId(v) ? v : null; });
  const open = pickOpenStep({ picked, address: step ?? null, live: liveStep(job), last, current: stopOf(job.stage) });
  const choose = useCallback((stop: StopId) => {
    setPicked(stop);
    writeStored(lastStepKey(slug), stop);
    replaceHash(stageHref(slug, stop));
  }, [slug]);
  /**
   * Reading inside the open step (a click or a key press in its panel: a document, a commit's
   * change, a fold) is a pick of that step, once, while nothing is picked, as a click on its tab
   * is: the job moving on never takes what he reads away.
   */
  const readHere = (e: SyntheticEvent) => {
    if (picked !== null) return;
    if (e.target instanceof Element && e.target.closest(`#${STEP_PANEL_ID}`)) choose(open);
  };
  /** A request for a step's part (See the pull requests, Watch, Try it, a document) gives the page back to the job. */
  const toStep = useCallback((stop: StopId) => {
    if (talk) leaveTalk();
    choose(stop);
  }, [talk, leaveTalk, choose]);

  // [ and ]: the step before and after, as a click picks it. They rest while the steps are hidden.
  // With the focus inside the open step (its body changes under it) or on a step's tab, the focus goes to the new
  // step's tab, never to the page.
  const at = STOPS.findIndex((s) => s.id === open);
  const tabFocus = useRef<StopId | null>(null);
  const stepTo = (stop: StopId) => {
    // On a tab in the steps row too (fix round 1, item 13): the focused tab is the open step's.
    const focused = document.activeElement;
    const onStep = focused instanceof Element && (focused.closest(`#${STEP_PANEL_ID}`) !== null || /^sb-step-/.test(focused.closest('[role="tab"]')?.id ?? ''));
    tabFocus.current = onStep ? stop : null;
    choose(stop);
  };
  useEffect(() => {
    const stop = tabFocus.current;
    if (!stop) return;
    tabFocus.current = null;
    document.getElementById(stepTabId(stop))?.focus();
  });
  useKeyScope('stage', {
    'stage-prev': () => { const prev = STOPS[at - 1]; if (!prev) return false; stepTo(prev.id); },
    'stage-next': () => { const next = STOPS[at + 1]; if (!next) return false; stepTo(next.id); },
  }, !talk);

  // ---- The evidence: asked once here for the bar's gate card, the Test step and its strip ----
  const evidence = useJobEvidence(job);
  const { recording, watching, setWatching, tryOpen, setTryOpen } = evidence;
  const reloadEvidence = evidence.reload;

  // The job menu's "Try it on your computer" (the Test step, with Try it open) and "Review the screens".
  useJobMenuRequests(slug, () => { toStep('test'); setTryOpen(true); });
  // A link to one of the job's documents (or ⌘K Open docs): it opens under the step useDocRequests
  // names (the open step, when it is one of the file's owners or nothing owns it). A link picks that
  // step; ⌘K Open docs with no file is the open step's list and no pick: the page keeps following
  // the job. Each request is handed down only while its step is open, and StepPanel acts on it once.
  const [docAsk, setDocAsk] = useState<DocAsk | null>(null);
  useDocRequests(detail?.page?.docs, open, stopOf(job.stage), (ask) => {
    setDocAsk(ask);
    if (ask.file) toStep(ask.stop);
    else if (talk) leaveTalk();
  });
  const docRequest = useMemo(() => (docAsk && docAsk.stop === open ? { n: docAsk.n, file: docAsk.file } : undefined), [docAsk, open]);

  // ---- The open step's view: never another step's facts under this step's name ----
  const stage = useStage(slug, open);
  const stageView = stage.view && (!stage.view.stop || stage.view.stop === open) ? stage.view : null;
  const recorder = open === 'test' ? recorderAgent(recording ? evidence.view?.progress : null) : null;

  const cls = `page page-job sb-job-page${talk ? ' is-talk' : ''}${wide ? ' is-wide' : ''}${full ? ' is-full' : ''}`;
  return (
    <main className={cls} aria-label="Job" data-view={view}>
      <JobTop job={job} detail={detail} run={run} sent={sent} reload={thread.reload} />
      <div className="sb-job-cols">
        <div className="sb-job-work" hidden={talk && !barShown && !full}>
          {full && (
            <div className="sb-job-back" ref={backRef}>
              <Button kind="quiet" icon="chevron-left" onClick={() => { focusTo.current = 'talk'; leaveTalk(); }} title="Give the page back to the job: its steps, with the conversation one button away.">Back to the job</Button>
            </div>
          )}
          <div className="sb-job-part" hidden={talk}>
            <StackSuggestion job={job} index={stacks} />
            <TheOverview job={job} detail={detail} thread={thread} />
          </div>
          <div className="sb-job-bar" hidden={!barShown}>
            <NextStep
              job={job}
              conversation={conversation}
              now={now}
              onShip={() => toStep('ship')}
              onWatch={() => { toStep('test'); setWatching(true); }}
              onWrite={writeToForeman}
              foldHere={talk}
              evidence={evidence.view}
            />
          </div>
          <div className="sb-job-part" hidden={talk} onClickCapture={readHere} onKeyDownCapture={readHere}>
            <StepsRow job={job} times={detail?.page?.times} open={open} sent={sent} now={now} onOpen={choose} />
            <StepPanel
              job={job}
              stop={open}
              view={stageView}
              error={stage.error}
              onRetry={stage.reload}
              now={now}
              extraAgents={[recorder].filter((a): a is StageAgent => a !== null)}
              sent={sent}
              docRequest={docRequest}
              otherDocs={detail?.page?.docs?.none}
              bodyFirst={open === 'test'}
            >
              {stageView && (
                <StepBody
                  stop={open} job={job} detail={detail} view={stageView} now={now}
                  evidence={evidence.view} onRecorded={reloadEvidence} evidenceState={evidence}
                  watching={watching} onWatching={setWatching} tryOpen={tryOpen} onTryOpen={setTryOpen}
                />
              )}
            </StepPanel>
          </div>
        </div>
        <div className="sb-job-talk" ref={convoRef} hidden={!column && !talk}>
          <ConversationPanel job={job} conversation={conversation} now={now} wide={wide} full={full} onWide={(on) => (on ? setTalk(true) : leaveTalk())} />
        </div>
      </div>
      {!column && !talk && <TalkButton job={job} conversation={conversation} barRef={talkRef} onOpen={() => { focusTo.current = 'back'; setTalk(true); }} />}
    </main>
  );
}

/** The overview, or while the job's details load (or could not be read) a line in its place. */
function TheOverview({ job, detail, thread }: { job: Job; detail: JobDetail | null; thread: Conversation['thread'] }) {
  if (detail) return <OverviewCard job={job} detail={detail} />;
  if (thread.error) {
    return (
      <div className="sb-job-problem">
        <p className="thread-error" role="alert">Couldn’t load this job’s details.</p>
        <Button onClick={thread.reload} title={`Ask ${BRAND.name} for this job’s details again.`}>Try again</Button>
      </div>
    );
  }
  return <p className="muted sb-job-loading" role="status">Loading the overview…</p>;
}

/** Under 1100 px: the conversation behind one button at the foot of the page, with what is new. */
function TalkButton({ job, conversation, barRef, onOpen }: { job: Job; conversation: Conversation; barRef: RefObject<HTMLDivElement | null>; onOpen(): void }) {
  const [seen] = useStored(seenKey(job.slug));
  const fresh = newCount(conversation.thread.items, seen);
  return (
    <div className="sb-job-talkbar" ref={barRef}>
      <Button size="lg" icon="message" className="sb-job-talkbutton" onClick={onOpen} title="Open the conversation with the Foreman, full screen.">
        Conversation{fresh > 0 && <Chip tone="accent">{`${fresh} new`}</Chip>}
      </Button>
    </div>
  );
}
