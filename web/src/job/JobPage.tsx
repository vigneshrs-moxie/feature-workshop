// The Job page (#/job/<slug>), as approved in packet M's wireframes: the job's name with its
// ticket, lane and level, the gear (the job menu); the map of seven stops, each a link to its
// Stage (in Play full each circle wears a small face of the crew member who works it, over faint
// grid lines); then one next step: the go / no go bar while a gate waits (No go: send back r,
// Go a; the gate card's questions and the decisions made for you sit under it), the permission
// alert while a permission waits (it takes the bar's place), or what is happening in words. Then
// one tab per kind of work, opened at the current stop (Brief, Spec, Plan, Code, Tests with L's
// evidence and Try it, Review, Decisions, Ship), the folded conversation, and the message box (c).
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Job, JobDocEntry, StopId } from '../api/types';
import { jobHref, navigate, screensHref, stageHref } from '../app/router';
import { useUi } from '../app/ui';
import { useDetail, useShown } from '../app/detail';
import { More } from '../components/More';
import { NowLine } from '../components/NowLine';
import { Button } from '../components/Button';
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
import { GateSlot } from '../panes/Foreman/GateCard';
import { JobGithub } from '../panes/Foreman/JobGithub';
import { JobMenu } from '../panes/Foreman/JobHeader';
import { LevelChip } from '../panes/Foreman/LevelChip';
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
import { useWorkshopState } from '../state/store';
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

/** A button's words without its key hint. */
function wordsOf(b: Element | null): string {
  if (!b) return '';
  const copy = b.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('kbd').forEach((k) => k.remove());
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
          <JobMenu job={job} dir={thread.detail?.dir} policyOverride={thread.detail?.policyOverride} run={run} worktree={thread.detail?.worktree} gear />
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
              <LevelChip job={job} ready={Boolean(thread.detail)} />
              <PartOfStack slug={job.slug} index={stacks} />
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
  const { thread } = conversation;
  const perms = state.permissions.filter((p) => p.slug === job.slug && !isRoundCard(p));
  if (perms.length > 0) return <PermissionAlert permissions={perms} now={now} />;
  if (thread.detail?.gate) return <GoBar job={job} detail={thread.detail} now={now} reload={thread.reload} call={play.on} foldCard={foldCard} />;
  if (review.view) return <ReviewBar view={review.view} act={review.act} problem={review.problem} />;
  return <StateBar job={job} onShip={onShip} />;
}

/**
 * The go / no go bar while a gate waits. The gate card under it keeps every rule (its questions,
 * the decisions made for you, a stale plan, the evidence); its own row of buttons is hidden, and
 * the bar's two calls press them. Go is off while the card asks a question: a never answers one.
 */
function GoBar({ job, detail, now, reload, call, foldCard = false }: { job: Job; detail: NonNullable<ReturnType<typeof useJobConversation>['thread']['detail']>; now: Date; reload(): void; call: boolean; foldCard?: boolean }) {
  const [cardShown, setCardShown] = useShown('stage', 'brief');
  const folded = foldCard && !cardShown;
  const body = useRef<HTMLDivElement>(null);
  const [go, setGo] = useState({ words: '', off: true, asks: false, backOff: false });
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const read = () => {
      const b = el.querySelector<HTMLButtonElement>('[data-gate="approve"]');
      const back = el.querySelector<HTMLButtonElement>('[data-gate="revise"]');
      const next = { words: wordsOf(b), off: !b || b.disabled, asks: Boolean(el.querySelector('.gate-question')), backOff: !back || back.disabled };
      setGo((was) => (was.words === next.words && was.off === next.off && was.asks === next.asks && was.backOff === next.backOff ? was : next));
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    return () => watch.disconnect();
  }, [detail]);
  const press = (what: 'approve' | 'revise') => body.current?.querySelector<HTMLButtonElement>(`[data-gate="${what}"]:not(:disabled)`)?.click();
  const gate = detail.gate;
  const goWords = go.words || 'Approve';
  return (
    <div className="job-go">
      <NextBar
        tone="go"
        icon="clipboard"
        label={call ? 'Go / no go' : null}
        say={gate?.headline || (typeof job.headline === 'string' && job.headline) || 'The Foreman waits for your go-ahead'}
        sub={gate?.nextProposed ? `Say go and the Foreman goes ahead: ${gate.nextProposed}` : job.laneReason}
      >
        <Button size="lg" keyId="gate-revise" disabled={go.backOff} onClick={() => press('revise')} title={go.backOff ? 'Off for now: the card under this says why.' : 'No go: say what should change. The Foreman stays at this stop and revises; nothing is approved (key: r).'}>
          {call ? 'No go: send back' : 'Send back'}
        </Button>
        {/* Go is on whenever the card's own Approve is: with questions it sends your answers too (the
            picked ones show under this), but the a key never answers a question, so it shows no key. */}
        <Button
          kind="primary"
          size="lg"
          keyId={go.asks ? undefined : 'gate-approve'}
          keyShown
          disabled={go.off}
          onClick={() => press('approve')}
          title={go.off ? 'Go is off for now: the card under this says why.' : go.asks ? `${goWords}, with your answers to the questions under this. The a key never answers a question.` : `${goWords} (key: a).`}
        >
          {call ? `Go: ${lowerFirst(goWords)}` : goWords}
        </Button>
      </NextBar>
      {foldCard && (
        <button type="button" className="desk-details-row stage-brief-row" aria-expanded={!folded} onClick={() => setCardShown(folded)} title={folded ? 'Show the brief’s questions and details here; Go sends the answers picked in it.' : 'Fold the brief back to this row.'}>
          <Icon name="file" size={16} />
          <span className="desk-details-words"><b>The brief</b><span className="muted">its questions and details, also on the job’s page; Go sends the answers picked in it</span></span>
          <Icon name="chevron-down" size={14} className={`fold-chevron${folded ? '' : ' is-up'}`} />
        </button>
      )}
      <div ref={body} className="job-gate-body" hidden={folded}>
        <GateSlot job={job} detail={detail} now={now} reload={reload} callsOutside />
      </div>
    </div>
  );
}

/** No gate and no permission: what is happening, in words, and the one thing you can do. */
function StateBar({ job, onShip }: { job: Job; onShip?: () => void }) {
  const lane = laneOf(job);
  const at = stopOf(job.stage);
  const doing = job.nowDoing?.[0]?.doing ?? null;
  let tone: NextTone = 'quiet';
  let icon: IconName = 'clock';
  let say = 'Nothing to do right now';
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
          {job.wireframes && <p><Button icon="eye" href={screensHref(slug)} title="The feature’s screens, full width: mark each one, pick the design choices, and Copy feedback puts your notes in your reply.">Review the screens</Button></p>}
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
