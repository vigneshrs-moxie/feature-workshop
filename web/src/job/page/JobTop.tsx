// The job page's pinned header (Part 3, as drawn). Row one: the title and the state in a word
// (Sent once his decision is out, Needs you in the needs-you lane, else the lane's word); at the
// right the Auto switch with On or Off beside it, the gear (Job menu, the laptop only) and How it
// works. Row two: the ticket (a link to Orbit when the page knows a web address), Copy decisions,
// "Started by Auto · tag x" on a job a tag started, Too big for Auto (its title the reason) while
// Auto has set the job aside, the kind, the level chip, the repository and
// where the work is, what the job has cost once it is over 10 cents (the old facts line's rule and
// title), and the locked Foreman model once the job has started; at the right, under the
// switch (its own line: Auto is on, Auto stopped: why), What Auto decided, which opens as a drawer,
// with the risky calls Auto made beside it once there are any.
// Under the facts, a branch Starbase only guessed (BranchGuess: "Branch (a guess)" and This is the
// job's branch, which records it and reloads the job); where the work is then says the step alone,
// never the guess as the job's branch (whereLine leaves out a card's guessed branch, from the first paint).
// On the website the gear is not there (everything in it is done on the laptop): its place says so
// in one sentence, and the model lock's title names the laptop. BranchGuess shows its line there
// without the button (choosing the branch is the laptop's). The switch queues its change for
// the laptop, as AutoSwitch does. Nothing here touches the bar's three calls.
import type { Job, JobDetail, Permission, Run } from '../../api/types';
import { Button } from '../../components/Button';
import { Chip, type ChipTone } from '../../components/Chip';
import { Icon, type IconName } from '../../components/Icon';
import { Guide, useGuide, type GuideSpec } from '../../components/page/Page';
import { riskyWords, TOO_BIG, tooBigTitle } from '../../home/autoTab';
import { chipTone, laneOf, LANE_INFO, stateChip } from '../../home/JobsPage';
import { whereLine } from '../../home/nudges';
import type { GateKind } from '../../lib/compose';
import { JobMenu } from '../../panes/Foreman/JobHeader';
import { formatCost } from '../../panes/Foreman/thread';
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
import { tryNewJobPage } from '../../jobpage/switch';
import './page.css';

/** The job page's guide (How it works); its own id (the old page's was 'job'), so it opens once by itself on this page. */
export const JOB_GUIDE: GuideSpec = {
  id: 'job-page-2',
  read: '04-a-job',
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

/** On the website, where the job menu is not: the switch to the new job page (jobpage/switch.ts). */
export function TryNewPage() {
  return <Button kind="quiet" size="sm" onClick={tryNewJobPage} title="Show this job on the new job page. Its ⋯ menu brings this page back.">Try the new job page</Button>;
}
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
 * job's own, else the one in the job's page facts); on a job a tag started, "Started by Auto" with
 * the tag's name when the job's detail has it; while Auto has set the job aside as too big, its
 * reason (null when none was given); and the risky calls Auto made, in words, once there are any
 * and What Auto decided shows (Auto has run on the job).
 * How the job began is the record's began, kept when he switches Auto off and on (a record from an
 * older laptop has none: its by says); the tag's name comes with the job's detail.
 */
export function jobFacts(job: Job, detail: JobDetail | null): { ticket: string | null; startedByAuto: string | null; tooBig: { reason: string | null } | null; risky: string | null } {
  const ticket = ticketOf(job) ?? (typeof detail?.page?.ticket?.key === 'string' ? detail.page.ticket.key : null);
  const tag = typeof detail?.auto?.tag === 'string' && detail.auto.tag.trim() ? detail.auto.tag.trim() : null;
  const auto = job.auto;
  const byTag = auto?.began !== undefined ? auto.began === 'tag' : auto?.by === 'tag';
  const startedByAuto = byTag ? (tag ? `Started by Auto · tag ${tag}` : 'Started by Auto') : null;
  const big = auto?.tooBig;
  const tooBig = big && typeof big === 'object' ? { reason: tooBigTitle(big.reason) ?? null } : null;
  const risky = auto?.ran === true && typeof auto.risky === 'number' && auto.risky > 0 ? riskyWords(auto.risky) : null;
  return { ticket, startedByAuto, tooBig, risky };
}

/** Too big for Auto, as a chip whose title is the reason (none when no reason was given). */
export function TooBigChip({ tooBig, className }: { tooBig: { reason: string | null }; className: string }) {
  return <Chip tone="warn" icon="layers" className={className} title={tooBig.reason ?? undefined}>{TOO_BIG}</Chip>;
}

/** The state in a word as a chip (headerState), with the lane's hint unless it says Sent. */
export function JobStateChip({ job, sent }: { job: Job; sent: { kind: GateKind | null } | null }) {
  const state = useWorkshopState();
  const lane = laneOf(job);
  const chip = headerState(job, state.permissions, sent);
  return <Chip tone={chip.tone} icon={chip.icon} className={`state-chip is-${lane}`} title={sent ? undefined : LANE_INFO[lane].hint}>{chip.word}</Chip>;
}

const KIND_WORDS: Record<string, string> = { feature: 'Feature', bug: 'Bug fix' };
/** What the job has cost so far, over 10 cents only (source 'none': no cost records yet), with its title; as the old header had it. */
function costOf(job: Job): { words: string; title: string } | null {
  const usd = job.cost?.totalUsd;
  if (job.cost?.source === 'none' || typeof usd !== 'number' || !(usd > 0.1)) return null;
  const title = job.cost?.source === 'estimate' ? 'What this job has cost so far (an estimate from its sessions’ token counts).' : 'What this job has cost so far.';
  return { words: formatCost(usd), title };
}

const isWebAddress = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim());

/** reload: reads the job again (the conversation's thread.reload), once This is the job's branch is recorded. Required, so no page leaves it out. */
export function JobTop({ job, detail, run, sent, reload }: { job: Job; detail: JobDetail | null; run: Run | null; sent: { kind: GateKind | null } | null; reload(): void }) {
  const state = useWorkshopState();
  const { api } = useWorkshop();
  const hosted = Boolean(api.hosted?.());
  const stacks = useStackIndex();
  const [guideOpen, setGuideOpen] = useGuide(JOB_GUIDE.id);
  const { ticket, startedByAuto, tooBig, risky } = jobFacts(job, detail);
  const ticketUrl = detail?.page?.ticket?.url;
  const kind = job.kind ? KIND_WORDS[job.kind] ?? job.kind : null;
  const model = foremanModel(detail, state.meta?.models);
  const cost = costOf(job);
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
          {tooBig && <TooBigChip tooBig={tooBig} className="sb-top-big" />}
          {kind && <span className="sb-top-fact">{kind}</span>}
          <LevelChip job={job} ready={Boolean(detail)} />
          {job.repo?.name && <span className="sb-top-fact">{job.repo.name}</span>}
          <span className="sb-top-fact sb-top-where" title="Where the job’s work is, from the finish line and its PRs.">{whereLine(job)}</span>
          {cost && <span className="sb-top-fact num" title={cost.title}>{cost.words}</span>}
          <PartOfStack slug={job.slug} index={stacks} />
          {model && <span className="sb-top-model" title={hosted ? MODEL_LOCK_HOSTED : MODEL_LOCK}><Icon name="lock" size={13} />Foreman model: {model}</span>}
        </div>
        <BranchGuess slug={job.slug} detail={detail} onConfirmed={reload} />
      </div>
      <div className="sb-top-side">
        <div className="sb-top-acts">
          <AutoSwitch job={job} word tagLine={false} />
          {hosted
            ? <><span className="sb-top-laptop">{MENU_ON_LAPTOP}</span><TryNewPage /></>
            : <JobMenu job={job} dir={detail?.dir} policyOverride={detail?.policyOverride} run={run} worktree={detail?.worktree} started={Boolean(detail?.drive?.sessionId)} gear />}
          <Button kind="quiet" icon="help" className="page-how" onClick={() => setGuideOpen(true)} title="The three things to know about this page.">How it works</Button>
        </div>
        <div className="sb-decided-row">
          <WhatAutoDecided slug={job.slug} auto={job.auto} drawer plain />
          {risky && <span className="sb-decided-risky">{risky}</span>}
        </div>
      </div>
      {guideOpen && <Guide spec={JOB_GUIDE} onClose={() => setGuideOpen(false)} />}
    </header>
  );
}
