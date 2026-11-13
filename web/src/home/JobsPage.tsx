// Jobs (#/): every job in four lanes, Working, Needs you, In review and Ready to merge (the lane
// comes from the dashboard: dashboard/lib/snapshot.js laneFor, with the reason in words). Resting
// and Done fold under the board. The next-step bar names the next job that needs you (yours first);
// Open (o) opens it. A card that changes lane or place waits until the pointer leaves the board, so
// nothing moves under it, then slides there. The other layouts (Settings → Look → Jobs layout, or
// the switch in the heading in Play full) are One list and, in Play full only, Station: the 3D
// station (play/floor3d, packets S and SB), a bay per job with its crew at work, where a click (or
// Enter) takes the same quick look. In Play subtle or off, Station shows Four lanes and no 3D is
// loaded. (Its stored value stays 'floor'.)
//
// Play: full gives console cards (a soft blinking light while the crew works, and a readout line);
// subtle keeps the card with a steady light and no readout; off has plain cards with the same dots
// and words. At phone width the lanes become folded sections, Needs you open first.
//
// Two tabs, each with its count (design section 2): Yours is all of the above without the jobs in
// Auto's groups; Auto (AutoJobs.tsx) has its three groups and no layout switch. The chosen tab is
// remembered (autoTab.ts useJobsTab). The next-step bar is on both: it names the next job that needs
// you from Yours first, then from Auto's Needs you.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Job, JobLane } from '../api/types';
import { useDetail } from '../app/detail';
import { useKeyScope } from '../app/keyRegistry';
import { hrefFor, jobHref, navigate, peekFromHash, stackHref, withPeek } from '../app/router';
import { useUi } from '../app/ui';
import { Button } from '../components/Button';
import { Chip, type ChipTone } from '../components/Chip';
import { Icon, type IconName } from '../components/Icon';
import { KeyText } from '../components/Kbd';
import { Fold, GuideCards, NextBar, Page, useNarrow, type GuideSpec } from '../components/page/Page';
import { StopMap } from '../components/stops/StopMap';
import { STOPS, stopOf } from '../components/stops/stops';
import { useStored } from '../lib/stored';
import { useFlip } from '../lib/flip';
import { useHeldWhileHovered } from '../lib/useHeldWhileHovered';
import { relativeTime, useNow } from '../lib/time';
import { usePlayIfAny } from '../play/usePlay';
import { useWorkshop, useWorkshopState } from '../state/store';
import { prefetchProps } from '../jobpage/recent';
import { useNewJobPage } from '../jobpage/switch';
import { StackJobCard, useStackIndex, type StackIndex } from '../views/Stack/StackRows';
import { StepDots } from '../views/Stack/StacksPage';
import type { Permission, ReviewView } from '../api/types';
import { GithubLine } from '../views/Review/GithubLine';
import { JobPeek } from './JobPeek';
import { WhatAutoDecided } from '../job/WhatAutoDecided';
import { isRoundCard, useReviewList } from '../views/Review/useReview';
import { cardIcon } from '../views/Review/words';
import { Segmented } from '../components/Choice';
import { Floor3D } from '../play/floor3d/Floor3D';
import { useFloorBenches } from '../play/floor3d/useFloorBenches';
import { AutoJobs } from './AutoJobs';
import { AUTO_GROUPS, autoGroups, inAuto, useJobsTab, type JobsTab } from './autoTab';

export type JobsLayout = 'lanes' | 'list' | 'floor';
export const JOBS_LAYOUT_KEY = 'gc.jobs.layout';

export function useJobsLayout(): [JobsLayout, (layout: JobsLayout) => void] {
  const [raw, set] = useStored(JOBS_LAYOUT_KEY);
  return [raw === 'list' || raw === 'floor' ? raw : 'lanes', (l) => set(l === 'lanes' ? null : l)];
}

/** The heading's switch between the layouts (Play full: the only place Floor is offered on the page). */
export const LAYOUT_CHOICES: readonly { value: JobsLayout; label: string; title: string }[] = [
  { value: 'lanes', label: 'Four lanes', title: 'Working, Needs you, In review and Ready to merge, side by side.' },
  { value: 'list', label: 'One list', title: 'Every job in one list, its lane in words.' },
  { value: 'floor', label: 'Station', title: 'The station in 3D: a bay per job (a construction bay for a feature, a repair dock for a bug fix), with its crew doing what each agent is really doing.' },
];

/** Jobs as the 3D station: a click, or Enter on a picked bay, takes the quick look (j and k then move along the bays). Auto's jobs have their own tab, so no bay. */
function JobsFloor({ peek, setPeek, hide }: { peek: string | null; setPeek(slug: string | null): void; hide: ReadonlySet<string> }) {
  const { jobs } = useWorkshopState();
  const all = useFloorBenches();
  const benches = useMemo(() => (hide.size ? all.filter((b) => !hide.has(b.slug)) : all), [all, hide]);
  const order = benches.map((b) => b.slug);
  // An Auto job's address (?peek=) opens nothing here: it has no bay.
  const peekJob = peek && !hide.has(peek) ? jobs.find((j) => j.slug === peek) ?? null : null;
  return (
    <>
      <Floor3D benches={benches} onOpenJob={setPeek} keys current={peek} hint="Each bay is a job: a construction bay builds a feature, a repair dock fixes a bug. Pick one for a quick look." />
      {peekJob && <JobPeek job={peekJob} order={order} onPick={setPeek} onClose={() => setPeek(null)} />}
    </>
  );
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
const LANES = Object.keys(LANE_INFO) as JobLane[];
const slugOf = (j: Job) => j.slug;

export const JOBS_GUIDE: GuideSpec = {
  id: 'jobs',
  title: 'How Jobs works',
  done: 'Show me my jobs',
  cards: [
    { icons: ['activity', 'hand', 'eye', 'merge'], title: 'Four lanes', say: 'Working, Needs you, In review, Ready to merge.' },
    { icons: ['loader'], title: 'A light means working', say: 'Each card says which stop it’s at and for how long.' },
    { icons: ['hand', 'external'], title: 'Needs you comes first', say: 'The bar at the top opens the next one: yours first, then Auto’s.' },
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

/** The state chip's tint: needs you amber, working blue, paused grey, ready green, the rest neutral. */
export function chipTone(lane: JobLane, word: string): ChipTone {
  if (lane === 'needs-you') return 'needs-you';
  if (lane === 'working') return word === 'Paused' ? 'neutral' : 'info';
  if (lane === 'ready' || lane === 'done') return 'ok';
  if (lane === 'in-review') return 'review';
  return 'neutral';
}

function JobCard({ job, now, play, review, full, onPeek, peeked }: { job: Job; now: Date; play: 'full' | 'subtle' | 'off'; review?: ReviewView | null; full: boolean; onPeek?: (slug: string) => void; peeked?: boolean }) {
  const lane = laneOf(job);
  const { permissions } = useWorkshopState();
  // The new job page's payload, fetched ahead as the pointer or the focus reaches the job.
  const ahead = prefetchProps(useWorkshop().api, job.slug, useNewJobPage());
  const chip = stateChip(job, permissions);
  const t = since(job);
  const working = lane === 'working' && chip.word === 'Working';
  const name = job.title || job.slug;
  // Simple (packet R): the title, one status line, the state chip and the time. The stop dots show
  // on hover and on focus, over the time, so the card never changes size; in Full on a row of their own.
  const stops = <StopMap job={{ ...job, lane }} compact tips label={`${name}: its stops`} />;
  return (
    <li
      data-flip-key={job.slug}
      className={`job-card lane-${lane} play-${play}${full ? ' is-full' : ''}${onPeek ? ' can-peek' : ''}${peeked ? ' is-peeked' : ''}`}
      onClick={onPeek ? (e) => { if (!(e.target as Element).closest('a, button, [tabindex]')) onPeek(job.slug); } : undefined}
    >
      <div className="job-card-top">
        {play === 'full' && <span className={`job-light${working ? ' is-on' : ''}${working && play === 'full' ? ' is-blink' : ''}`} aria-hidden="true" />}
        <a
          className="job-card-title"
          href={jobHref(job.slug)}
          {...ahead}
          title={onPeek ? `Open ${name}. Space, or a click on the card, takes a quick look instead.` : `Open ${name}.`}
          onKeyDown={onPeek ? (e) => { if (e.key === ' ') { e.preventDefault(); onPeek(job.slug); } } : undefined}
        >
          {name}
        </a>
      </div>
      {full && stops}
      {/* Play full's console readout (the stop and how long), with every detail shown. */}
      {full && play === 'full' && <span className="job-readout">{[STOPS.find((x) => x.id === stopOf(job.stage))?.label, t ? relativeTime(t, now) : null].filter(Boolean).join(' · ')}</span>}
      {review?.card
        ? <span className={`job-card-reason review-card-line is-${review.state}`}><Icon name={cardIcon(review.state)} size={14} /> {review.card.line}</span>
        : job.laneReason && <span className="job-card-reason">{job.laneReason}</span>}
      <div className="job-card-foot">
        <Chip tone={chipTone(lane, chip.word)} icon={chip.icon} className={`state-chip is-${lane}`}>{chip.word}</Chip>
        <WhatAutoDecided slug={job.slug} auto={job.auto} />
        <span className="job-card-end">
          {t && <span className="muted job-card-time">{relativeTime(t, now)}</span>}
          {!full && <span className="job-card-peek">{stops}</span>}
        </span>
      </div>
    </li>
  );
}

export function Cards({ jobs, now, play, stacks, reviews, onPeek, peeked }: { jobs: readonly Job[]; now: Date; play: 'full' | 'subtle' | 'off'; stacks?: StackIndex; reviews?: ReadonlyMap<string, ReviewView>; onPeek?: (slug: string) => void; peeked?: string | null }) {
  const [detail] = useDetail();
  return (
    <ul className="job-cards">
      {jobs.map((j) => {
        // A stack is one card that opens into its parts (packet K2).
        const stack = stacks?.stackOf(j.slug);
        return stack ? <StackJobCard key={j.slug} job={j} stack={stack} now={now} play={play} /> : <JobCard key={j.slug} job={j} now={now} play={play} review={reviews?.get(j.slug) ?? null} full={detail === 'full'} onPeek={onPeek} peeked={peeked === j.slug} />;
      })}
    </ul>
  );
}

/** How long a job has waited, in words ("5h"), or null. */
const t0 = (j: Job) => { const t = since(j); return t ? relativeTime(t, new Date()) : null; };

/** The two tabs over the layouts (design section 2): his own jobs, and the ones Auto runs to PR #1. */
export const TABS: readonly { id: JobsTab; name: string; title: string }[] = [
  { id: 'yours', name: 'Yours', title: 'The jobs you run yourself, in the layout you chose.' },
  { id: 'auto', name: 'Auto', title: 'The jobs Auto runs to PR #1: working, needing you, and ready for you to try.' },
];

export function JobsPage() {
  const { jobs, autoQueue } = useWorkshopState();
  const { api } = useWorkshop();
  const newPage = useNewJobPage();
  const now = useNow();
  const ui = useUi();
  const playState = usePlayIfAny();
  const play: 'full' | 'subtle' | 'off' = playState?.full ? 'full' : playState?.on ? 'subtle' : 'off';
  const narrow = useNarrow();
  const [chosen, setLayout] = useJobsLayout();
  // Station is Play full's: elsewhere it shows Four lanes, and no 3D loads.
  const layout: JobsLayout = chosen === 'floor' && play !== 'full' ? 'lanes' : chosen;
  // Closed ones go to Done; a stack's parts are inside its card, not cards of their own.
  const stacks = useStackIndex();
  const open = jobs.filter((j) => !stacks.partOf(j.slug));
  // Auto's tab takes the jobs the server put in one of its groups (autoTab.ts); Yours is the rest,
  // in today's lanes, list and station.
  const [tab, setTabNow] = useJobsTab();
  const yours = open.filter((j) => !inAuto(j));
  const byAuto = autoGroups(open);
  const autoCount = AUTO_GROUPS.reduce((n, g) => n + byAuto[g].length, 0);
  const autoKey = open.filter(inAuto).map(slugOf).join('\n');
  const autoSlugs = useMemo(() => new Set(autoKey ? autoKey.split('\n') : []), [autoKey]);
  // Each job's review round (packet Q): the card says who it waits on, since when, and which round.
  const { list: reviewList } = useReviewList(jobs.length > 0);
  const reviews = new Map((reviewList?.jobs ?? []).map((v) => [v.slug, v] as const));
  // Each lane in its own order (Needs you: the longest wait first). While the pointer is over the
  // board, every card keeps the lane and the place it had when the pointer came in, with fresh
  // data (lib/useHeldWhileHovered.ts); when it leaves, each slides to where it belongs (lib/flip.ts).
  const placed = LANES.flatMap((l) => {
    const here = yours.filter((j) => laneOf(j) === l);
    return l === 'needs-you' ? here.sort((a, b) => age(a) - age(b)) : here;
  });
  const board = useHeldWhileHovered(placed, slugOf, laneOf, !narrow && tab === 'yours' && layout === 'lanes');
  const byLane = Object.fromEntries(LANES.map((l) => [l, [] as Job[]])) as Record<JobLane, Job[]>;
  for (const p of board.arranged) byLane[p.group as JobLane].push(p.item);
  const boardRef = useRef<HTMLDivElement>(null);
  useFlip(boardRef, BOARD.map((l) => `${l}:${byLane[l].map(slugOf).join(',')}`).join('|'));
  // One bar on both tabs, with its Open (o): the next job that needs you from Yours first, then
  // from Auto's Needs you (a stopped job, or one set aside as too big); its count covers both.
  const autoNeed = byAuto['needs-you'];
  const pick = nextJob(yours) ?? [...autoNeed].sort((a, b) => age(a) - age(b))[0] ?? null;
  const needCount = byLane['needs-you'].length + autoNeed.length;
  // Yours come first, so the pick may not be the longest wait: the bar says so only when it is.
  const longest = pick !== null && [...byLane['needs-you'], ...autoNeed].every((j) => age(pick) <= age(j));
  // Yours' count: the jobs on its four lanes (Resting and Done have their own, under the board).
  const yoursCount = BOARD.reduce((n, l) => n + byLane[l].length, 0);

  useKeyScope('jobs', { 'jobs-open': () => { if (!pick) return false; navigate({ name: 'job', slug: pick.slug }); } });
  // The quick look (packet R): over the right side of the board, in the board's order for j and k.
  // It is in the address (#/?peek=<slug>), so a reload or Back to Jobs opens it again. Replaced, not
  // pushed: j and k would otherwise fill Back with every card looked at.
  const [peek, setPeekNow] = useState<string | null>(() => peekFromHash(window.location.hash));
  const setPeek = useCallback((slug: string | null) => {
    setPeekNow(slug);
    const next = withPeek(window.location.hash, slug);
    if (next !== window.location.hash) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${next}`);
  }, []);
  useEffect(() => {
    const onHash = () => setPeekNow(peekFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const order = (tab === 'auto' ? AUTO_GROUPS.flatMap((g) => byAuto[g]) : BOARD.flatMap((l) => byLane[l])).map((j) => j.slug);
  // The quick look is the shown tab's: an address naming the other tab's job (a reload, Back) opens nothing.
  const peekJob = peek ? (tab === 'auto' ? open.filter(inAuto) : yours).find((j) => j.slug === peek) ?? null : null;
  const onFloor = tab === 'yours' && layout === 'floor';
  // A quick look at a job that isn't on the board (gone, or a part inside a stack): out of the address.
  // On the floor, the floor keeps its own (a finished job's bench stays until the next visit).
  useEffect(() => { if (!onFloor && peek && !peekJob) setPeek(null); }, [onFloor, peek, peekJob, setPeek]);
  // Another tab: the quick look closes, so it never shows a job from the tab left behind.
  const setTab = (t: JobsTab) => { if (t !== tab) { setTabNow(t); setPeek(null); } };

  // One line of a fixed height (packet R): it keeps its space when nothing waits, so the lanes never move.
  const bar = pick ? (
    <NextBar line tone="stop" icon="hand" say={`${pick.title || pick.slug} needs you`} sub={`${t0(pick) ? `Waiting ${t0(pick)}. ` : ''}${needCount === 1 ? 'It is the only one.' : `${needCount} jobs need you.${longest ? ' This one has waited longest.' : ''}`}`}>
      <Button kind="primary" keyId="jobs-open" keyShown href={jobHref(pick.slug)} title={`Open ${pick.title || pick.slug}: ${reviews.get(pick.slug)?.desk?.headline ?? pick.laneReason ?? 'it waits for you'} (key: o).`}>Open</Button>
    </NextBar>
  ) : open.length ? (
    <NextBar line tone="quiet" icon="circle-check" say="Nothing needs you right now" sub="The crew carries on; a job that needs you shows here first." />
  ) : null;

  const lanesView = narrow ? (
    <div className="jobs-folds">
      {(['needs-you', 'working', 'in-review', 'ready'] as const).map((l) => (
        <Fold key={l} icon={LANE_INFO[l].icon} name={LANE_INFO[l].word} note={byLane[l].length} open={l === 'needs-you' && byLane[l].length > 0}>
          {byLane[l].length ? <Cards jobs={byLane[l]} now={now} play={play} stacks={stacks} reviews={reviews} /> : <p className="muted">None.</p>}
        </Fold>
      ))}
    </div>
  ) : (
    <div
      ref={boardRef}
      className="jobs-board"
      {...board.hoverProps}
    >
      {BOARD.map((l) => (
        <section key={l} className={`lane lane-${l}${byLane[l].length ? ' has-cards' : ''}`} aria-label={`${LANE_INFO[l].word}, ${byLane[l].length}`} title={LANE_INFO[l].hint}>
          <header className="lane-head">
            <span className="lane-icon"><Icon name={LANE_INFO[l].icon} size={16} /></span>
            <h3 className="lane-word">{LANE_INFO[l].word}</h3>
            <span className="lane-count num">{byLane[l].length}</span>
          </header>
          {byLane[l].length ? <Cards jobs={byLane[l]} now={now} play={play} stacks={stacks} reviews={reviews} onPeek={setPeek} peeked={peek} /> : <p className="lane-empty">None right now</p>}
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
            <Chip tone={chipTone(l, LANE_INFO[l].word)} icon={LANE_INFO[l].icon} className={`state-chip is-${l}`}>{LANE_INFO[l].word}</Chip>
            <a className="job-card-title" href={stacks.stackOf(j.slug) ? stackHref(j.slug) : jobHref(j.slug)} {...prefetchProps(api, j.slug, newPage && !stacks.stackOf(j.slug))}>{j.title || j.slug}</a>
            {stacks.stackOf(j.slug)
              ? <StepDots steps={stacks.stackOf(j.slug)!.steps} label="Stack" />
              : <StopMap job={{ ...j, lane: l }} compact tips label={`${j.title || j.slug}: its stops`} />}
            <span className="muted jobs-list-reason">{j.laneReason}</span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <Page
      label="Jobs" title="Jobs" className={`page-jobs play-${play}`} guide={JOBS_GUIDE}
      head={open.length ? (
        <>
          <div className="seg sb-jobs-tabs" role="tablist" aria-label="Jobs">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" className="tab seg-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} title={t.title}>
                <span className="seg-name">{t.name}</span>
                <span className="seg-count" aria-hidden="true">{t.id === 'auto' ? autoCount : yoursCount}</span>
              </button>
            ))}
          </div>
          {play === 'full' && tab === 'yours' && <Segmented<JobsLayout> className="jobs-layout-switch" label="Jobs layout" value={layout} onChange={setLayout} options={LAYOUT_CHOICES} />}
          <GithubLine onlyStale />
        </>
      ) : undefined}
    >
      {open.length === 0 ? (
        <section className="jobs-empty" aria-label="No jobs yet">
          <h3 className="hero-title">No jobs yet. Start one from a ticket.</h3>
          <GuideCards cards={JOBS_GUIDE.cards} />
          <div className="hero-actions jobs-empty-actions">
            <Button kind="primary" size="lg" href={hrefFor({ name: 'inbox' })} title="Your Orbit tickets (keys: g i).">Pick a ticket in the Inbox <KeyText keys="g i" shown /></Button>
            <Button keyId="new-job" onClick={() => ui.openSheet({ kind: 'new-job' })} title="Start a new job of your own (key: c).">New job</Button>
          </div>
        </section>
      ) : tab === 'auto' ? (
        <>
          {/* On a phone the groups are one after another, and a row opens its job (no quick look, as the lanes' folds). */}
          {bar}
          <AutoJobs jobs={open} queue={autoQueue} now={now} play={play} stacks={stacks} onPeek={narrow ? undefined : setPeek} peeked={peek} />
          {peekJob && <JobPeek job={peekJob} order={order} onPick={setPeek} onClose={() => setPeek(null)} />}
        </>
      ) : (
        <>
          {bar}
          {layout === 'floor' ? <JobsFloor peek={peek} setPeek={setPeek} hide={autoSlugs} /> : layout === 'list' ? listView : lanesView}
          {layout !== 'floor' && peekJob && <JobPeek job={peekJob} order={order} onPick={setPeek} onClose={() => setPeek(null)} />}
          <div className="jobs-folded">
            <Fold icon="moon" name="Resting" note={`${byLane.resting.length} idle`} id="jobs-resting">
              {byLane.resting.length ? <Cards jobs={byLane.resting} now={now} play={play} stacks={stacks} reviews={reviews} /> : <p className="muted">None.</p>}
            </Fold>
            <Fold icon="circle-check" name="Done" note={byLane.done.length} id="jobs-done">
              {byLane.done.length ? <Cards jobs={byLane.done} now={now} play={play} stacks={stacks} reviews={reviews} /> : <p className="muted">None yet.</p>}
            </Fold>
          </div>
        </>
      )}
    </Page>
  );
}
