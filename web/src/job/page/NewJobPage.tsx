// The new job page (Part 3, design 3.1 to 3.5), on a laptop. Not routed yet: App still mounts
// JobPage for #/job/<slug>. The header (JobTop) is pinned; under it two scroll areas: the work column
// (a stack suggestion, the overview, the bar, the seven steps and the open step in place, with its
// body) and, from 1100 px, the conversation column, 400 px. The narrow window, Widen's layout and the
// website are Task 15b's: a layout only hides or shows parts (classes and `hidden`), so the bar
// (NextStep) and the conversation (ConversationPanel) each stay in one place in the tree and never
// draw again from scratch: typed words, an open box and the scroll stay.
//
// The open step: your pick on this page wins (it rewrites the address in place and is remembered
// as sb.job.step.<slug>); then the step the address names; then the step the job is at while it
// works or waits; then the one you last opened here; then the job's own step (openStep.ts). A later
// change of the address's step (a link, Back) is a pick of that step. The step's panel stays mounted
// as the step changes; only its body changes, and only once the step's view is in.
//
// One clock, one sent line (useSentShown) and one evidence view (useJobEvidence) for the whole page.
// The open step's body is StepBody; the phone's step screen draws the same one.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Job, StageAgent, StopId } from '../../api/types';
import { isJobView, navigate, replaceHash, stageHref, type JobView } from '../../app/router';
import { useUi } from '../../app/ui';
import { Page, useMinWidth } from '../../components/page/Page';
import { isStopId, STOPS, stopOf } from '../../components/stops/stops';
import { readStored, writeStored } from '../../lib/stored';
import { useNow } from '../../lib/time';
import { useCurrentJob, useJobConversation } from '../../panes/Foreman/ForemanPane';
import { jobBySlug } from '../../state/reducer';
import { useWorkshopState } from '../../state/store';
import { StackSuggestion, useStackIndex } from '../../views/Stack/StackRows';
import { NextStep, useSentShown } from '../NextStep';
import { ConversationPanel } from './ConversationPanel';
import { JobTop } from './JobTop';
import { lastStepKey, pickOpenStep } from './openStep';
import { OverviewCard } from './OverviewCard';
import { StepBody } from './StepBody';
import { StepPanel } from './StepPanel';
import { StepsRow } from './StepsRow';
import { statesOf } from './stepWords';
import { recorderAgent } from './TestStep';
import { useJobEvidence } from './useJobEvidence';
import { useStage } from './useStage';
import './page.css';

/** From this width the conversation is a column beside the work (design 3.4). */
export const CONVO_COLUMN_PX = 1100;

export function NewJobPage({ slug, step, view }: { slug: string; step?: StopId; view?: JobView }) {
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
  // Another job starts the page afresh (as the Job page does): its own pick, Watch and Try it.
  return <JobScreen key={slug} job={job} step={isStopId(step) ? step : undefined} view={isJobView(view) ? view : undefined} />;
}

/** The step the job is at while it works or waits; null when it does neither (done, at rest). */
function liveStep(job: Job): StopId | null {
  const states = statesOf(job);
  return STOPS.find((s) => states[s.id] === 'now' || states[s.id] === 'waiting')?.id ?? null;
}

function JobScreen({ job, step, view }: { job: Job; step: StopId | undefined; view: JobView | undefined }) {
  const slug = job.slug;
  const now = useNow();
  const ui = useUi();
  const conversation = useJobConversation(job);
  useCurrentJob(job, conversation);
  const { thread, run } = conversation;
  const detail = thread.detail ?? null;
  const sent = useSentShown(job, conversation);
  const stacks = useStackIndex();
  const column = useMinWidth(CONVO_COLUMN_PX);
  // Widen and Back to the job: the panel's own button; the layout for it is Task 15b's.
  const [wide, setWide] = useState(false);

  // ---- The open step ----
  const [picked, setPicked] = useState<StopId | null>(null);
  // A later change of the address's step (a hashchange: a link, Back) is a pick of that step. The
  // address this page writes itself (replaceHash) fires no hashchange, so it never comes back here.
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

  // ---- The evidence: asked once here for the bar's gate card, the Test step and its strip ----
  const evidence = useJobEvidence(job);
  const { recording, watching, setWatching, tryOpen, setTryOpen } = evidence;
  const reloadEvidence = evidence.reload;

  // The job menu's "Try it on your computer": the Test step, with Try it open.
  const handledTry = useRef(ui.tryRequest);
  useEffect(() => {
    if (ui.tryRequest === handledTry.current) return;
    handledTry.current = ui.tryRequest;
    if (ui.trySlug === slug) { choose('test'); setTryOpen(true); }
  }, [ui.tryRequest, ui.trySlug, slug, choose]);
  // "Review the screens": the full-width Screens page, which takes the request as it mounts.
  const handledScreens = useRef(ui.screensRequest);
  useEffect(() => {
    if (ui.screensRequest === handledScreens.current) return;
    handledScreens.current = ui.screensRequest;
    if (ui.screensSlug === slug) navigate({ name: 'screens', slug });
  }, [ui.screensRequest, ui.screensSlug, slug]);

  // ---- The open step's view: never another step's facts under this step's name ----
  const stage = useStage(slug, open);
  const stageView = stage.view && (!stage.view.stop || stage.view.stop === open) ? stage.view : null;
  const recorder = open === 'test' ? recorderAgent(recording ? evidence.view?.progress : null) : null;

  return (
    <main className={`page page-job sb-job-page${wide ? ' is-wide' : ''}`} aria-label="Job" data-view={view}>
      <JobTop job={job} detail={detail} run={run} sent={sent} />
      <div className="sb-job-cols">
        <div className="sb-job-work">
          <StackSuggestion job={job} index={stacks} />
          <OverviewCard job={job} detail={detail} />
          <NextStep
            job={job}
            conversation={conversation}
            now={now}
            onShip={() => choose('ship')}
            onWatch={() => { choose('test'); setWatching(true); }}
            evidence={evidence.view}
          />
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
            bodyFirst={open === 'test'}
          >
            {stageView && (
              <StepBody
                stop={open} job={job} detail={detail} view={stageView} now={now}
                evidence={evidence.view} onRecorded={reloadEvidence}
                watching={watching} onWatching={setWatching} tryOpen={tryOpen} onTryOpen={setTryOpen}
              />
            )}
          </StepPanel>
        </div>
        <div className="sb-job-talk" hidden={!column}>
          <ConversationPanel job={job} conversation={conversation} now={now} wide={wide} onWide={setWide} />
        </div>
      </div>
    </main>
  );
}
