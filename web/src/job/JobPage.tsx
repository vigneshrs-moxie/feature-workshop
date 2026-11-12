// The Job page (#/job/<slug>), as approved in packet M's wireframes: the job's name with its
// ticket, lane and level, the gear (the job menu); the map of seven stops, each a link to its
// Stage (in Play full each circle wears a small face of the crew member who works it, over faint
// grid lines); then one next step: the go / no go bar while a gate waits (No go: send back r,
// Go a; the gate card's questions and the decisions made for you sit under it), the permission
// alert while a permission waits (it takes the bar's place), or what is happening in words. Then
// one tab per kind of work, opened at the current stop (Brief, Spec, Plan, Code, Tests with L's
// evidence and Try it, Review, Decisions, Ship), the folded conversation, and the message box (c).
import { NextStep, ticketOf } from './NextStep';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Job, JobDocEntry, StopId } from '../api/types';
import { navigate, screensHref, stageHref } from '../app/router';
import { useUi } from '../app/ui';
import { useDetail } from '../app/detail';
import { More } from '../components/More';
import { NowLine } from '../components/NowLine';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Icon } from '../components/Icon';
import { Fold, FoldShow, Page, useMinWidth, useNarrow, type GuideSpec } from '../components/page/Page';
import { StopMap } from '../components/stops/StopMap';
import { STOPS, stopOf } from '../components/stops/stops';
import { chipTone, laneOf, LANE_INFO, stateChip } from '../home/JobsPage';
import { jobFacts, whereLine } from '../home/nudges';
import { relativeTime, useNow } from '../lib/time';
import { EvidenceStrip } from '../panes/Foreman/EvidenceStrip';
import { ThreadList, useCurrentJob, useJobConversation } from '../panes/Foreman/ForemanPane';
import { Composer } from '../panes/Foreman/Composer';
import { JobGithub } from '../panes/Foreman/JobGithub';
import { JobMenu } from '../panes/Foreman/JobHeader';
import { LevelChip } from '../panes/Foreman/LevelChip';
import { CopyDecisions } from './CopyDecisions';
import { BranchGuess } from './BranchGuess';
import { AutoSwitch } from './AutoSwitch';
import { WhatAutoDecided } from './WhatAutoDecided';
import { DecisionsTab } from '../panes/Preview/DecisionsTab';
import { DocsTab } from '../panes/Preview/DocsTab';
import { TryTab } from '../panes/Preview/TryTab';
import { WalkthroughTab } from '../panes/Preview/WalkthroughTab';
import { usePlay } from '../play/usePlay';
import { GithubLine } from '../views/Review/GithubLine';
import { ReviewPanel } from '../views/Review/ReviewPanel';
import { ROUND_NUDGES, useReview } from '../views/Review/useReview';
import { jobBySlug } from '../state/reducer';
import { useWorkshopState } from '../state/store';
import { CodeTab } from './CodeTab';
import { PartOfStack, StackSuggestion, useStackIndex } from '../views/Stack/StackRows';

// The bar lives in NextStep.tsx; the Stage page, the peek and a stack's part page import it from here too.
export { NextStep, STOP_ACTION, ticketOf } from './NextStep';

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

const isSpecDoc = (d: JobDocEntry) => /(^|\/)(spec|clarif|refine|acceptance|wirefram|screens)/i.test(d.file);
const isTestDoc = (d: JobDocEntry) => /test/i.test(d.file);

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
          <BranchGuess slug={job.slug} detail={thread.detail} onConfirmed={thread.reload} />
          <More screen="job" id="details" label="Details" note="level, stops, who is working, facts" icon="list" className="is-card job-details">
            <div className="job-details-head">
              {ticket && <Chip className="num">{ticket}</Chip>}
              {thread.detail?.auto?.tag && <Chip tone="accent">{`Started by Auto (tag: ${thread.detail.auto.tag})`}</Chip>}
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
