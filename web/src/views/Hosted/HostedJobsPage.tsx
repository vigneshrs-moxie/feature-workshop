// Jobs on the hosted site: my jobs from the mirror (GET /api/jobs), grouped by laptop when there is
// more than one. Each card says whether its laptop is online, in words with an icon (never colour
// alone): an offline laptop's jobs show as they last were. Read every 15 seconds, and when the tab
// comes back. Each card opens the job's own page (packet 2B), where you can decide.
//
// Yours and Auto (design section 10): with each read of the list the page also reads the laptop's
// snapshot (GET /api/snapshot, no live stream; only the newest answer counts and a failed read keeps
// the last good one). Once a snapshot carries its Auto queue the page has the laptop's two tabs, each
// with its count, the choice remembered as on the laptop (home/autoTab.ts). Yours is the list above
// without the rows whose job the snapshot puts in one of Auto's groups (joined by slug: with the same
// slug on two laptops the first row takes it); Auto is the laptop's Auto tab (home/AutoJobs.tsx) from
// the snapshot, whose rows open the job's page here. On the first load the list waits for the first
// snapshot read, at most FIRST_HOLD_MS after it came, so it is drawn once, already split, on the
// remembered tab. With no snapshot, a failed one, or an older laptop's with no queue, the page is the
// list alone, with no tabs.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ApiClient } from '../../api/client';
import type { AutoQueue, Job, Snapshot } from '../../api/types';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Hero, Page, type GuideSpec } from '../../components/page/Page';
import { AutoJobs } from '../../home/AutoJobs';
import { AUTO_GROUPS, autoGroups, inAuto, useJobsTab, type JobsTab } from '../../home/autoTab';
import { TABS } from '../../home/JobsPage';
import { relativeTime, useNow } from '../../lib/time';
import { useDelayedFlag } from '../../lib/useDelayedFlag';
import { usePlayIfAny } from '../../play/usePlay';
import { createStore, WorkshopContext } from '../../state/store';
import { prefetchProps } from '../../jobpage/recent';
import { useNewJobPage } from '../../jobpage/switch';
import { isSignedOut, words, type HostedProps } from './shared';
import type { LaptopJobs, MirroredJob } from './types';

export const REFRESH_MS = 15_000;
/** On the first load, the longest the list waits for the first snapshot read after the list came. */
export const FIRST_HOLD_MS = 600;

/** Each lane in words (dashboard/lib/snapshot.js LANES). */
export const STATE_WORDS: Record<string, string> = {
  working: 'Working', 'needs-you': 'Needs you', 'in-review': 'In review', ready: 'Ready to merge', resting: 'Resting', done: 'Done',
  idle: 'Idle', paused: 'Paused',
};
const STATE_ICON: Record<string, 'activity' | 'hand' | 'eye' | 'merge' | 'pause' | 'circle-check'> = {
  working: 'activity', 'needs-you': 'hand', 'in-review': 'eye', ready: 'merge', resting: 'pause', done: 'circle-check', paused: 'pause',
};
const stageWords = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : null);

const GUIDE: GuideSpec = {
  id: 'hosted-jobs',
  title: 'Your jobs, from anywhere',
  cards: [
    { icons: ['terminal', 'lock'], title: 'Pair each laptop once', say: 'On the laptop, starbase login --site and this site’s address prints a link and a code. Open it here and press Pair this laptop.' },
    { icons: ['activity'], title: 'Its jobs show here', say: 'Each open job, what stage it is at and what is happening now. Only yours: nobody else sees them here.' },
    { icons: ['hand'], title: 'Decide from anywhere', say: 'Open a job or the Desk to say go or no go. With your laptop closed, it waits and runs when the laptop is back. The code never leaves it.' },
  ],
  done: 'Got it',
};

export function LaptopState({ laptop, now }: { laptop: { online: boolean; lastSeenAt: string | null }; now: Date }) {
  return laptop.online
    ? <span className="hosted-online is-online"><Icon name="circle-dot" size={12} />Laptop online</span>
    : <span className="hosted-online is-offline" title="The job carries on there; this is how it last was."><Icon name="circle-dashed" size={12} />Laptop offline{laptop.lastSeenAt ? ` · seen ${relativeTime(laptop.lastSeenAt, now)}` : ''}</span>;
}

function JobCard({ job, laptop, now, api }: { job: MirroredJob; laptop: LaptopJobs; now: Date; api: ApiClient }) {
  const state = job.state ? STATE_WORDS[job.state] ?? job.stateWords ?? job.state : null;
  // The new job page's payload, fetched ahead as the pointer or the focus reaches the job.
  const newPage = useNewJobPage();
  return (
    <li className="hosted-job" data-job={job.slug} data-state={job.state ?? undefined}>
      <a className="hosted-job-link" href={`#/job/${encodeURIComponent(job.slug)}`} {...prefetchProps(api, job.slug, newPage)} title="Open the job: its brief, documents and decisions, from your laptop.">
        <span className="hosted-job-title">{job.title}</span>
      </a>
      <span className="hosted-job-meta">
        {job.ticket && <span className="chip num">{job.ticket}</span>}
        {stageWords(job.stage) && <span className="chip">{stageWords(job.stage)}</span>}
        {state && <span className="hosted-job-state">{STATE_ICON[job.state ?? ''] && <Icon name={STATE_ICON[job.state ?? '']} size={14} />}{state}</span>}
      </span>
      {job.now && <span className="hosted-job-now">{job.now}</span>}
      <span className="hosted-job-foot muted">
        <LaptopState laptop={laptop} now={now} />
        {job.updatedAt && <span title={job.updatedAt}>Updated {relativeTime(job.updatedAt, now)}</span>}
      </span>
    </li>
  );
}

type Load = { state: 'loading' } | { state: 'ready'; laptops: LaptopJobs[] } | { state: 'error'; message: string };

/** The laptop's tabs; on the site Yours has no layouts to choose from. */
const SITE_TABS = TABS.map((t) => (t.id === 'yours' ? { ...t, title: 'The jobs you run yourself, from every laptop you paired.' } : t));

/** Auto's tab with the laptop's Play setting, read from the page's own snapshot store above it. */
function SiteAutoJobs({ jobs, queue, now }: { jobs: readonly Job[]; queue: AutoQueue | null; now: Date }) {
  const p = usePlayIfAny();
  return <AutoJobs jobs={jobs} queue={queue} now={now} play={p?.full ? 'full' : p?.on ? 'subtle' : 'off'} />;
}

/** Each laptop's rows without those Auto has (by slug); a slug on two laptops is taken once, from the first. */
function withoutAuto(laptops: readonly LaptopJobs[], auto: ReadonlySet<string>): LaptopJobs[] {
  const taken = new Set<string>();
  return laptops.map((l) => ({
    ...l,
    jobs: l.jobs.filter((j) => {
      if (!auto.has(j.slug) || taken.has(j.slug)) return true;
      taken.add(j.slug);
      return false;
    }),
  }));
}

export function HostedJobsPage({ api, onSignedOut }: HostedProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const now = useNow(30_000);
  const [chosen, setTab] = useJobsTab();
  // The laptop's board, from its snapshot: in a store of the page's own, since the job cards in
  // Auto's groups read one. Never a live stream: it is read with the list.
  const workshop = useMemo(() => ({ api, store: createStore() }), [api]);
  const board = useSyncExternalStore(workshop.store.subscribe, workshop.store.getState, workshop.store.getState);
  // The first snapshot read has answered or failed, or the list has waited FIRST_HOLD_MS for it.
  const [settled, setSettled] = useState(false);
  const alive = useRef(true);
  const reads = useRef(0);
  const readBoard = useCallback(() => {
    const n = ++reads.current;
    Promise.resolve(api.get<Snapshot>('/api/snapshot')).then(
      // Only the newest read counts; a failed one keeps the last good snapshot.
      (s) => { if (alive.current && n === reads.current) workshop.store.dispatch({ type: 'snapshot', snapshot: s }); },
      () => {},
    ).finally(() => { if (alive.current) setSettled(true); });
  }, [api, workshop]);
  const read = useCallback(async () => {
    readBoard();
    try {
      const r = await api.get<{ laptops: LaptopJobs[] }>('/api/jobs');
      if (alive.current) setLoad({ state: 'ready', laptops: r.laptops });
    } catch (err) {
      if (isSignedOut(err)) { onSignedOut(); return; }
      // Keep what is shown when a later read fails; say so only when there is nothing yet.
      if (alive.current) setLoad((was) => (was.state === 'ready' ? was : { state: 'error', message: words(err) }));
    }
  }, [api, onSignedOut, readBoard]);
  useEffect(() => {
    alive.current = true;
    void read();
    const t = setInterval(() => { void read(); }, REFRESH_MS);
    const onShow = () => { if (document.visibilityState === 'visible') void read(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { alive.current = false; clearInterval(t); document.removeEventListener('visibilitychange', onShow); };
  }, [read]);
  // The first load only: the list waits for the first snapshot read, never longer than FIRST_HOLD_MS after it came.
  const listIn = load.state === 'ready';
  useEffect(() => {
    if (!listIn || settled) return undefined;
    const t = setTimeout(() => setSettled(true), FIRST_HOLD_MS);
    return () => clearTimeout(t);
  }, [listIn, settled]);
  const held = listIn && !settled;
  const slow = useDelayedFlag(load.state === 'loading' || held);

  // The tabs: only with the list shown and a snapshot that carries the Auto queue.
  const queue = board.status === 'ready' ? board.autoQueue : null;
  const boardJobs = board.status === 'ready' ? board.jobs : [];
  const tabs = Boolean(queue) && !held && load.state === 'ready' && load.laptops.length > 0;
  const tab: JobsTab = tabs ? chosen : 'yours';
  const laptops = load.state !== 'ready' ? [] : tabs ? withoutAuto(load.laptops, new Set(boardJobs.filter(inAuto).map((j) => j.slug))) : load.laptops;
  const yoursCount = laptops.reduce((n, l) => n + l.jobs.length, 0);
  const byAuto = autoGroups(boardJobs);
  const autoCount = AUTO_GROUPS.reduce((n, g) => n + byAuto[g].length, 0);

  const site = window.location.origin;
  let body;
  if (load.state === 'loading' || held) body = slow ? <p className="muted" role="status">Loading your jobs…</p> : null;
  else if (load.state === 'error') body = <div role="alert"><p className="field-problem">Couldn’t load your jobs: {load.message}</p><Button onClick={() => void read()}>Try again</Button></div>;
  else if (tab === 'auto') body = <SiteAutoJobs jobs={boardJobs} queue={queue} now={now} />;
  else if (!load.laptops.length) {
    body = (
      <Hero icon="terminal" title="Pair a laptop to see your jobs here" actions={<Button href="#/settings/laptops" icon="settings" title="Settings → Laptops: the laptops paired with the site.">Your laptops</Button>}>
        <p>On your laptop, in a terminal:</p>
        <pre className="hosted-command"><code>starbase login --site {site}</code></pre>
        <p className="muted">It prints a link and a code. Open the link here, check the code and press Pair this laptop.</p>
      </Hero>
    );
  } else {
    const many = laptops.length > 1;
    body = (
      <div className="hosted-laptops">
        {laptops.map((l, i) => {
          // Every open job on this laptop is Auto's: it has open jobs, none of them under Yours.
          const allAuto = !l.jobs.length && load.laptops[i].jobs.length > 0;
          return (
            <section key={l.id} className="hosted-laptop" aria-label={`Jobs on ${l.name}`} data-laptop={l.name}>
              <header className="hosted-laptop-head">
                <h3 className="hosted-laptop-name">{many ? l.name : `On ${l.name}`}</h3>
                <span className="muted">{allAuto ? 'None of yours' : l.jobs.length === 1 ? '1 open job' : `${l.jobs.length} open jobs`}</span>
              </header>
              {l.jobs.length ? (
                <ul className="hosted-jobs">{l.jobs.map((j) => <JobCard key={j.id} job={j} laptop={l} now={now} api={api} />)}</ul>
              ) : allAuto ? (
                <p className="muted hosted-empty">Its open jobs are Auto’s: see the Auto tab. <LaptopState laptop={l} now={now} /></p>
              ) : (
                <p className="muted hosted-empty">No open jobs on this laptop. <LaptopState laptop={l} now={now} /></p>
              )}
            </section>
          );
        })}
      </div>
    );
  }
  return (
    <WorkshopContext.Provider value={workshop}>
      <Page
        label="Jobs" title="Jobs" guide={GUIDE} className="sb-hosted-jobs"
        head={(
          <>
            {/* In the heading row, which keeps one height with them or without (hosted.css), so the list
                below never moves when they come at laptop width; on a phone, a row of their own. */}
            {tabs && (
              <div className="seg sb-jobs-tabs sb-hosted-jobs-tabs" role="tablist" aria-label="Jobs">
                {SITE_TABS.map((t) => (
                  <button key={t.id} type="button" role="tab" className="tab seg-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} title={t.title}>
                    <span className="seg-name">{t.name}</span>
                    <span className="seg-count" aria-hidden="true">{t.id === 'auto' ? autoCount : yoursCount}</span>
                  </button>
                ))}
              </div>
            )}
            <span className="page-note">From your laptops · only yours</span>
          </>
        )}
      >
        {body}
      </Page>
    </WorkshopContext.Provider>
  );
}
