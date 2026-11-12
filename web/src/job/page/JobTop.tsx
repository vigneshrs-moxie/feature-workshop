// The job page's pinned header (Part 3, as drawn). Row one: the title and the state in a word
// (Sent once his decision is out, Needs you in the needs-you lane, else the lane's word); at the
// right the Auto switch with On or Off beside it, the gear (Job menu, the laptop only) and How it
// works. Row two: the ticket (a link to Orbit when the page knows a web address), Copy decisions,
// "Started by Auto · tag x" on a job a tag started, the kind, the level chip, the repository and
// where the work is, and the locked Foreman model once the job has started; at the right, under the
// switch (its own line: Auto is on, Auto stopped: why), What Auto decided, which opens as a drawer.
// Under the facts, a branch Starbase only guessed (BranchGuess: "Branch (a guess)" and This is the
// job's branch, which records it and reloads the job); where the work is then says the step alone,
// never the guess as the job's branch.
// On the website the gear is not there (everything in it is done on the laptop): its place says so
// in one sentence, and the model lock's title names the laptop. BranchGuess shows its line there
// without the button (choosing the branch is the laptop's). The switch queues its change for
// the laptop, as AutoSwitch does. Nothing here touches the bar's three calls.
import type { Job, JobDetail, Permission, Run } from '../../api/types';
import { Button } from '../../components/Button';
import { Chip, type ChipTone } from '../../components/Chip';
import { Icon, type IconName } from '../../components/Icon';
import { Guide, useGuide, type GuideSpec } from '../../components/page/Page';
import { chipTone, laneOf, LANE_INFO, stateChip } from '../../home/JobsPage';
import { whereLine } from '../../home/nudges';
import type { GateKind } from '../../lib/compose';
import { JobMenu } from '../../panes/Foreman/JobHeader';
import { LevelChip } from '../../panes/Foreman/LevelChip';
import { DecisionsTab } from '../../panes/Preview/DecisionsTab';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { PartOfStack, useStackIndex } from '../../views/Stack/StackRows';
import { AutoSwitch } from '../AutoSwitch';
import { BranchGuess } from '../BranchGuess';
import { CopyDecisions } from '../CopyDecisions';
import { ticketOf } from '../NextStep';
import { WhatAutoDecided } from '../WhatAutoDecided';
import { foremanModel } from './foremanModel';
import './page.css';

/** The job page's guide (How it works); its own id (the old page's was 'job'), so it opens once by itself on this page. */
export const JOB_GUIDE: GuideSpec = {
  id: 'job-page-2',
  title: 'How the job page works',
  done: 'Got it',
  cards: [
    { icons: ['hand'], title: 'Your next move is at the top', say: 'The bar says what the job waits for. Send back, Reply and Go are there whenever it waits for you.' },
    { icons: ['file', 'clipboard', 'hammer', 'rocket'], title: 'Seven steps, each opens in place', say: 'Click a step to see who worked on it, what they are doing now and what it produced.' },
    { icons: ['message'], title: 'The conversation stays beside you', say: 'The whole history with the Foreman, newest at the bottom. Widen it when you want to read.' },
  ],
};

export const MODEL_LOCK = 'Fixed once the job starts. Change model… in the gear menu starts it again.';
/** The lock's title on the website, which has no gear. */
export const MODEL_LOCK_HOSTED = 'Fixed once the job starts. Change model… on your laptop starts it again.';
/** In the gear's place on the website. */
export const MENU_ON_LAPTOP = 'The job menu is on your laptop.';
export const AUTO_START_WHERE = 'Settings, Workflow, Auto start';

/**
 * The header's state in a word: Sent while the bar shows his decision on its way (whatever he sent);
 * Needs you in the needs-you lane (which counts a step that is his because he wrote to an Auto job);
 * else the word the Jobs card uses.
 */
export function headerState(job: Job, permissions: readonly Permission[] | undefined, sent: { kind: GateKind | null } | null): { word: string; tone: ChipTone; icon: IconName } {
  if (sent) return { word: 'Sent', tone: 'info', icon: 'loader' };
  const lane = laneOf(job);
  if (lane === 'needs-you') return { word: LANE_INFO['needs-you'].word, tone: 'needs-you', icon: LANE_INFO['needs-you'].icon };
  const chip = stateChip(job, permissions);
  return { word: chip.word, tone: chipTone(lane, chip.word), icon: chip.icon };
}

/**
 * The facts the header works out (the phone's job screen shows them too): the ticket's number (the
 * job's own, else the one in the job's page facts), and, on a job a tag started, "Started by Auto"
 * with the tag's name when the job's detail has it. The job's record says a tag started Auto; the
 * tag's name comes with the job's detail.
 */
export function jobFacts(job: Job, detail: JobDetail | null): { ticket: string | null; startedByAuto: string | null } {
  const ticket = ticketOf(job) ?? (typeof detail?.page?.ticket?.key === 'string' ? detail.page.ticket.key : null);
  const tag = typeof detail?.auto?.tag === 'string' && detail.auto.tag.trim() ? detail.auto.tag.trim() : null;
  const startedByAuto = job.auto?.by === 'tag' ? (tag ? `Started by Auto · tag ${tag}` : 'Started by Auto') : null;
  return { ticket, startedByAuto };
}

/** The state in a word as a chip (headerState), with the lane's hint unless it says Sent. */
export function JobStateChip({ job, sent }: { job: Job; sent: { kind: GateKind | null } | null }) {
  const state = useWorkshopState();
  const lane = laneOf(job);
  const chip = headerState(job, state.permissions, sent);
  return <Chip tone={chip.tone} icon={chip.icon} className={`state-chip is-${lane}`} title={sent ? undefined : LANE_INFO[lane].hint}>{chip.word}</Chip>;
}

const KIND_WORDS: Record<string, string> = { feature: 'Feature', bug: 'Bug fix' };
const isWebAddress = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim());

/** Where the job's work is (whereLine), without a branch Starbase only guessed: the step alone then. */
function whereWords(job: Job, detail: JobDetail | null): string {
  return detail?.locate?.branchGuessed === true && job.repo ? whereLine({ ...job, repo: { ...job.repo, branch: null } }) : whereLine(job);
}

/** reload: reads the job again (the conversation's thread.reload), once This is the job's branch is recorded. */
export function JobTop({ job, detail, run, sent, reload }: { job: Job; detail: JobDetail | null; run: Run | null; sent: { kind: GateKind | null } | null; reload?(): void }) {
  const state = useWorkshopState();
  const { api } = useWorkshop();
  const hosted = Boolean(api.hosted?.());
  const stacks = useStackIndex();
  const [guideOpen, setGuideOpen] = useGuide(JOB_GUIDE.id);
  const { ticket, startedByAuto } = jobFacts(job, detail);
  const ticketUrl = detail?.page?.ticket?.url;
  const kind = job.kind ? KIND_WORDS[job.kind] ?? job.kind : null;
  const model = foremanModel(detail, state.meta?.models);
  return (
    <header className="sb-job-top">
      <div className="sb-top-main">
        <div className="sb-top-title">
          <h1 className="page-title">{job.title || job.slug}</h1>
          <JobStateChip job={job} sent={sent} />
        </div>
        <div className="sb-top-facts">
          {ticket && (isWebAddress(ticketUrl)
            ? <a className="chip chip-outline num sb-top-ticket" href={ticketUrl.trim()} target="_blank" rel="noreferrer" title="Open the ticket in Orbit.">{ticket}<Icon name="external" size={12} /></a>
            : <Chip tone="outline" className="num sb-top-ticket">{ticket}</Chip>)}
          <CopyDecisions slug={job.slug} all={<DecisionsTab slug={job.slug} active copy={false} />} />
          {startedByAuto && <Chip tone="accent" icon="bot" className="sb-top-auto" title={AUTO_START_WHERE}>{startedByAuto}</Chip>}
          {kind && <span className="sb-top-fact">{kind}</span>}
          <LevelChip job={job} ready={Boolean(detail)} />
          {job.repo?.name && <span className="sb-top-fact">{job.repo.name}</span>}
          <span className="sb-top-fact sb-top-where" title="Where the job’s work is, from the finish line and its PRs.">{whereWords(job, detail)}</span>
          <PartOfStack slug={job.slug} index={stacks} />
          {model && <span className="sb-top-model" title={hosted ? MODEL_LOCK_HOSTED : MODEL_LOCK}><Icon name="lock" size={13} />Foreman model: {model}</span>}
        </div>
        <BranchGuess slug={job.slug} detail={detail} onConfirmed={reload} />
      </div>
      <div className="sb-top-side">
        <div className="sb-top-acts">
          <AutoSwitch job={job} word tagLine={false} />
          {hosted
            ? <span className="sb-top-laptop">{MENU_ON_LAPTOP}</span>
            : <JobMenu job={job} dir={detail?.dir} policyOverride={detail?.policyOverride} run={run} worktree={detail?.worktree} started={Boolean(detail?.drive?.sessionId)} gear />}
          <Button kind="quiet" icon="help" className="page-how" onClick={() => setGuideOpen(true)} title="The three things to know about this page.">How it works</Button>
        </div>
        <WhatAutoDecided slug={job.slug} auto={job.auto} drawer plain />
      </div>
      {guideOpen && <Guide spec={JOB_GUIDE} onClose={() => setGuideOpen(false)} />}
    </header>
  );
}
