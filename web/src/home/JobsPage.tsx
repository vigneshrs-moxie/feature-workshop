// Jobs (#/): every job in four lanes, Working, Needs you, In review and Ready to merge (the lane
// comes from the dashboard: dashboard/lib/snapshot.js laneFor, with the reason in words). Resting
// and Done fold under the board. The next-step bar names the job that has waited longest for you;
// Open (o) opens it. A card that changes lane waits until the pointer leaves the board, so nothing
// moves under it. The other layout (Settings → Look → Jobs layout) is One list.
//
// Play: full gives console cards (a soft blinking light while the crew works, and a readout line);
// subtle keeps the card with a steady light and no readout; off has plain cards with the same dots
// and words. At phone width the lanes become folded sections, Needs you open first.
import { useRef, useState } from 'react';
import type { Job, JobLane } from '../api/types';
import { useKeyScope } from '../app/keyRegistry';
import { hrefFor, jobHref, navigate } from '../app/router';
import { useUi } from '../app/ui';
import { Icon, type IconName } from '../components/Icon';
import { Kbd } from '../components/Kbd';
import { Fold, GuideCards, NextBar, Page, useNarrow, type GuideSpec } from '../components/page/Page';
import { StopMap } from '../components/stops/StopMap';
import { STOPS, stopOf } from '../components/stops/stops';
import { useStored } from '../lib/stored';
import { relativeTime, useNow } from '../lib/time';
import { usePlayIfAny } from '../play/usePlay';
import { useWorkshopState } from '../state/store';
import type { Permission, ReviewView } from '../api/types';
import { GithubLine } from '../views/Review/GithubLine';
import { isRoundCard, useReviewList } from '../views/Review/useReview';
import { cardIcon } from '../views/Review/words';

export type JobsLayout = 'lanes' | 'list';
export const JOBS_LAYOUT_KEY = 'gc.jobs.layout';

export function useJobsLayout(): [JobsLayout, (layout: JobsLayout) => void] {
  const [raw, set] = useStored(JOBS_LAYOUT_KEY);
  return [raw === 'list' ? 'list' : 'lanes', (l) => set(l === 'lanes' ? null : l)];
}

type BoardLane = Exclude<JobLane, 'resting' | 'done'>;
export const LANE_INFO: Record<JobLane, { word: string; icon: IconName; hint: string }> = {
  working: { word: 'Working', icon: 'activity', hint: 'The crew is at work on these.' },
  'needs-you': { word: 'Needs you', icon: 'hand', hint: 'These wait for your go-ahead, an answer or a permission.' },
  'in-review': { word: 'In review', icon: 'eye', hint: 'A pull request is open and waits on a review or its checks.' },
  ready: { word: 'Ready to merge', icon: 'merge', hint: 'Approved, with its checks passed.' },
  resting: { word: 'Resting', icon: 'moon', hint: 'Nothing happening: each waits for your next message.' },
  done: { word: 'Done', icon: 'circle-check', hint: 'Finished, marked done or dropped.' },
};
const BOARD: readonly BoardLane[] = ['working', 'needs-you', 'in-review', 'ready'];

export const JOBS_GUIDE: GuideSpec = {
  id: 'jobs',
  title: 'How Jobs works',
  done: 'Show me my jobs',
  cards: [
    { icons: ['activity', 'hand', 'eye', 'merge'], title: 'Four lanes', say: 'Working, Needs you, In review, Ready to merge.' },
    { icons: ['loader'], title: 'A light means working', say: 'Each card says which stop it’s at and for how long.' },
    { icons: ['hand', 'external'], title: 'Needs you comes first', say: 'The bar at the top opens the one that has waited longest.' },
  ],
};

/** A job's lane, for a dashboard from before lanes: from its group. */
export function laneOf(job: Job): JobLane {
  if (job.lane) return job.lane;
  if (job.closed) return 'done';
  switch (job.group) {
    case 'needs-you': return 'needs-you';
    case 'running': case 'paused': return 'working';
    case 'shipping': return 'in-review';
    case 'done': return 'done';
    default: return 'resting';
  }
}

const since = (j: Job) => (j.waitingSince ?? j.updatedAt ?? null);
const age = (j: Job) => { const t = since(j); return t ? Date.parse(t) || Infinity : Infinity; };

/** The job the next-step bar names: the one in Needs you that has waited longest. */
export function nextJob(jobs: readonly Job[]): Job | null {
  return [...jobs].filter((j) => laneOf(j) === 'needs-you').sort((a, b) => age(a) - age(b))[0] ?? null;
}

/** The state chip's word and icon: what kind of wait, or what the crew does. */
export function stateChip(job: Job, permissions?: readonly Permission[]): { word: string; icon: IconName } {
  const lane = laneOf(job);
  if (lane === 'needs-you') {
    // A review round's card (packet Q) is a go / no go, not a permission.
    const mine = permissions?.filter((p) => p.slug === job.slug) ?? [];
    if (mine.length && mine.every(isRoundCard)) return { word: 'Review', icon: 'message' };
    if (job.permissions) return { word: 'Permission', icon: 'shield' };
    if (job.waitingFor === 'answers' || job.questions) return { word: 'Question', icon: 'help' };
    return { word: 'Go-ahead', icon: 'hand' };
  }
  if (lane === 'working') return job.limitPaused || job.group === 'paused' ? { word: 'Paused', icon: 'pause' } : { word: 'Working', icon: 'loader' };
  return { word: LANE_INFO[lane].word, icon: LANE_INFO[lane].icon };
}

function JobCard({ job, now, play, review }: { job: Job; now: Date; play: 'full' | 'subtle' | 'off'; review?: ReviewView | null }) {
  const lane = laneOf(job);
  const { permissions } = useWorkshopState();
  const chip = stateChip(job, permissions);
  const stop = STOPS.find((s) => s.id === stopOf(job.stage));
  const t = since(job);
  const working = lane === 'working' && chip.word === 'Working';
  return (
    <li className={`job-card lane-${lane} play-${play}`}>
      <div className="job-card-top">
        {play !== 'off' && <span className={`job-light${working ? ' is-on' : ''}${working && play === 'full' ? ' is-blink' : ''}`} aria-hidden="true" />}
        <a className="job-card-title" href={jobHref(job.slug)} title={`Open ${job.title || job.slug}.`}>{job.title || job.slug}</a>
      </div>
      <StopMap job={{ ...job, lane }} compact tips label={`${job.title || job.slug}: its stops`} />
      {play === 'full' && <span className="job-readout">{[stop?.label, t ? relativeTime(t, now) : null].filter(Boolean).join(' · ')}</span>}
      {review?.card
        ? <span className={`job-card-reason review-card-line is-${review.state}`}><Icon name={cardIcon(review.state)} size={14} /> {review.card.line}</span>
        : job.laneReason && <span className="job-card-reason">{job.laneReason}</span>}
      <div className="job-card-foot">
        <span className={`chip state-chip is-${lane}`}><Icon name={chip.icon} size={14} /> {chip.word}</span>
        {t && <span className="muted">{relativeTime(t, now)}</span>}
      </div>
    </li>
  );
}

function Cards({ jobs, now, play, reviews }: { jobs: readonly Job[]; now: Date; play: 'full' | 'subtle' | 'off'; reviews?: ReadonlyMap<string, ReviewView> }) {
  return <ul className="job-cards">{jobs.map((j) => <JobCard key={j.slug} job={j} now={now} play={play} review={reviews?.get(j.slug) ?? null} />)}</ul>;
}

export function JobsPage() {
  const { jobs } = useWorkshopState();
  const now = useNow();
  const ui = useUi();
  const playState = usePlayIfAny();
  const play: 'full' | 'subtle' | 'off' = playState?.full ? 'full' : playState?.on ? 'subtle' : 'off';
  const narrow = useNarrow();
  const [layout] = useJobsLayout();
  // Each job's review round (packet Q): the card says who it waits on, since when, and which round.
  const { list: reviewList } = useReviewList(jobs.length > 0);
  const reviews = new Map((reviewList?.jobs ?? []).map((v) => [v.slug, v] as const));
  const open = jobs; // closed ones go to Done
  // While the pointer is over the board, a card keeps the lane it had when the pointer came in.
  const frozen = useRef<Map<string, JobLane> | null>(null);
  const [, setHover] = useState(false);
  const laneFor = (j: Job) => frozen.current?.get(j.slug) ?? laneOf(j);
  const byLane = Object.fromEntries(Object.keys(LANE_INFO).map((l) => [l, [] as Job[]])) as Record<JobLane, Job[]>;
  for (const j of open) byLane[laneFor(j)].push(j);
  byLane['needs-you'].sort((a, b) => age(a) - age(b));
  const pick = nextJob(open);
  const needCount = byLane['needs-you'].length;

  useKeyScope('jobs', { 'jobs-open': () => { if (!pick) return false; navigate({ name: 'job', slug: pick.slug }); } });

  const bar = pick ? (
    <NextBar tone="stop" icon="hand" say={`${pick.title || pick.slug} needs you`} sub={`${reviews.get(pick.slug)?.desk?.headline ?? pick.laneReason ?? 'Waiting for you'}. ${needCount === 1 ? 'It is the only one.' : `${needCount} jobs need you. This one has waited longest.`}`}>
      <a className="btn btn-primary btn-lg" href={jobHref(pick.slug)} title={`Open ${pick.title || pick.slug} (key: o).`}>Open <Kbd id="jobs-open" /></a>
    </NextBar>
  ) : open.length ? (
    <NextBar tone="quiet" icon="circle-check" say="Nothing needs you right now" sub="The crew carries on; a job that needs you shows here first." />
  ) : null;

  const lanesView = narrow ? (
    <div className="jobs-folds">
      {(['needs-you', 'working', 'in-review', 'ready'] as const).map((l) => (
        <Fold key={l} icon={LANE_INFO[l].icon} name={LANE_INFO[l].word} note={byLane[l].length} open={l === 'needs-you' && byLane[l].length > 0}>
          {byLane[l].length ? <Cards jobs={byLane[l]} now={now} play={play} reviews={reviews} /> : <p className="muted">None.</p>}
        </Fold>
      ))}
    </div>
  ) : (
    <div
      className="jobs-board"
      onMouseEnter={() => { frozen.current = new Map(open.map((j) => [j.slug, laneOf(j)])); setHover(true); }}
      onMouseLeave={() => { frozen.current = null; setHover(false); }}
    >
      {BOARD.map((l) => (
        <section key={l} className={`lane lane-${l}${byLane[l].length ? ' has-cards' : ''}`} aria-label={`${LANE_INFO[l].word}, ${byLane[l].length}`} title={LANE_INFO[l].hint}>
          <header className="lane-head">
            <span className="lane-icon"><Icon name={LANE_INFO[l].icon} size={16} /></span>
            <h3 className="lane-word">{LANE_INFO[l].word}</h3>
            <span className="lane-count">{byLane[l].length}</span>
          </header>
          {byLane[l].length ? <Cards jobs={byLane[l]} now={now} play={play} reviews={reviews} /> : <p className="muted lane-empty">None right now.</p>}
        </section>
      ))}
    </div>
  );

  const listView = (
    <ul className="jobs-list">
      {BOARD.flatMap((l) => byLane[l]).map((j) => {
        const l = laneOf(j);
        return (
          <li key={j.slug} className={`jobs-list-row lane-${l}`}>
            <span className={`chip state-chip is-${l}`}><Icon name={LANE_INFO[l].icon} size={14} /> {LANE_INFO[l].word}</span>
            <a className="job-card-title" href={jobHref(j.slug)}>{j.title || j.slug}</a>
            <StopMap job={{ ...j, lane: l }} compact tips label={`${j.title || j.slug}: its stops`} />
            <span className="muted jobs-list-reason">{j.laneReason}</span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <Page label="Jobs" title="Jobs" className={`page-jobs play-${play}`} guide={JOBS_GUIDE} head={open.length ? <GithubLine /> : undefined}>
      {open.length === 0 ? (
        <section className="jobs-empty" aria-label="No jobs yet">
          <h3 className="hero-title">No jobs yet. Start one from a ticket.</h3>
          <GuideCards cards={JOBS_GUIDE.cards} />
          <div className="hero-actions jobs-empty-actions">
            <a className="btn btn-primary btn-lg" href={hrefFor({ name: 'inbox' })} title="Your Orbit tickets (keys: g i).">Pick a ticket in the Inbox <kbd className="kbd key-hint" aria-hidden="true">g i</kbd></a>
            <button type="button" className="btn btn-lg" onClick={() => ui.openSheet({ kind: 'new-job' })} title="Start a new job of your own (key: c).">New job <Kbd id="new-job" /></button>
          </div>
        </section>
      ) : (
        <>
          {bar}
          {layout === 'list' ? listView : lanesView}
          <div className="jobs-folded">
            <Fold icon="moon" name="Resting" note={`${byLane.resting.length} idle`} id="jobs-resting">
              {byLane.resting.length ? <Cards jobs={byLane.resting} now={now} play={play} /> : <p className="muted">None.</p>}
            </Fold>
            <Fold icon="circle-check" name="Done" note={byLane.done.length} id="jobs-done">
              {byLane.done.length ? <Cards jobs={byLane.done} now={now} play={play} /> : <p className="muted">None yet.</p>}
            </Fold>
          </div>
        </>
      )}
    </Page>
  );
}
