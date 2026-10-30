// Jobs on the hosted site: my jobs from the mirror (GET /api/jobs), grouped by laptop when there is
// more than one. Each card says whether its laptop is online, in words with an icon (never colour
// alone): an offline laptop's jobs show as they last were. Read every 15 seconds, and when the tab
// comes back. Nothing here changes a job: that is still done on the laptop.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Hero, Page, type GuideSpec } from '../../components/page/Page';
import { relativeTime, useNow } from '../../lib/time';
import { useDelayedFlag } from '../../lib/useDelayedFlag';
import { isSignedOut, words, type HostedProps } from './shared';
import type { LaptopJobs, MirroredJob } from './types';

export const REFRESH_MS = 15_000;

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
    { icons: ['terminal', 'lock'], title: 'Pair each laptop once', say: 'On the laptop, ground-control login --site and this site’s address prints a link and a code. Open it here and press Pair this laptop.' },
    { icons: ['activity'], title: 'Its jobs show here', say: 'Each open job, what stage it is at and what is happening now. Only yours: nobody else sees them here.' },
    { icons: ['hand'], title: 'Work on the laptop for now', say: 'Answering the Foreman and approving gates stay on the laptop for now. The code never leaves it.' },
  ],
  done: 'Got it',
};

export function LaptopState({ laptop, now }: { laptop: { online: boolean; lastSeenAt: string | null }; now: Date }) {
  return laptop.online
    ? <span className="hosted-online is-online"><Icon name="circle-dot" size={12} />Laptop online</span>
    : <span className="hosted-online is-offline" title="The job carries on there; this is how it last was."><Icon name="circle-dashed" size={12} />Laptop offline{laptop.lastSeenAt ? ` · seen ${relativeTime(laptop.lastSeenAt, now)}` : ''}</span>;
}

function JobCard({ job, laptop, now }: { job: MirroredJob; laptop: LaptopJobs; now: Date }) {
  const state = job.state ? STATE_WORDS[job.state] ?? job.stateWords ?? job.state : null;
  return (
    <li className="hosted-job" data-job={job.slug} data-state={job.state ?? undefined}>
      <a className="hosted-job-link" href={`#/job/${encodeURIComponent(job.slug)}`} title="A job’s page is on your laptop for now.">
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

export function HostedJobsPage({ api, onSignedOut }: HostedProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const now = useNow(30_000);
  const slow = useDelayedFlag(load.state === 'loading');
  const alive = useRef(true);
  const read = useCallback(async () => {
    try {
      const r = await api.get<{ laptops: LaptopJobs[] }>('/api/jobs');
      if (alive.current) setLoad({ state: 'ready', laptops: r.laptops });
    } catch (err) {
      if (isSignedOut(err)) { onSignedOut(); return; }
      // Keep what is shown when a later read fails; say so only when there is nothing yet.
      if (alive.current) setLoad((was) => (was.state === 'ready' ? was : { state: 'error', message: words(err) }));
    }
  }, [api, onSignedOut]);
  useEffect(() => {
    alive.current = true;
    void read();
    const t = setInterval(() => { void read(); }, REFRESH_MS);
    const onShow = () => { if (document.visibilityState === 'visible') void read(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { alive.current = false; clearInterval(t); document.removeEventListener('visibilitychange', onShow); };
  }, [read]);

  const site = window.location.origin;
  let body;
  if (load.state === 'loading') body = slow ? <p className="muted" role="status">Loading your jobs…</p> : null;
  else if (load.state === 'error') body = <div role="alert"><p className="field-problem">Couldn’t load your jobs: {load.message}</p><Button onClick={() => void read()}>Try again</Button></div>;
  else if (!load.laptops.length) {
    body = (
      <Hero icon="terminal" title="Pair a laptop to see your jobs here" actions={<Button href="#/settings/laptops" icon="settings" title="Settings → Laptops: the laptops paired with the site.">Your laptops</Button>}>
        <p>On your laptop, in a terminal:</p>
        <pre className="hosted-command"><code>ground-control login --site {site}</code></pre>
        <p className="muted">It prints a link and a code. Open the link here, check the code and press Pair this laptop.</p>
      </Hero>
    );
  } else {
    const many = load.laptops.length > 1;
    body = (
      <div className="hosted-laptops">
        {load.laptops.map((l) => (
          <section key={l.id} className="hosted-laptop" aria-label={`Jobs on ${l.name}`} data-laptop={l.name}>
            <header className="hosted-laptop-head">
              <h3 className="hosted-laptop-name">{many ? l.name : `On ${l.name}`}</h3>
              <span className="muted">{l.jobs.length === 1 ? '1 open job' : `${l.jobs.length} open jobs`}</span>
            </header>
            {l.jobs.length ? (
              <ul className="hosted-jobs">{l.jobs.map((j) => <JobCard key={j.id} job={j} laptop={l} now={now} />)}</ul>
            ) : (
              <p className="muted hosted-empty">No open jobs on this laptop. <LaptopState laptop={l} now={now} /></p>
            )}
          </section>
        ))}
      </div>
    );
  }
  return (
    <Page label="Jobs" title="Jobs" guide={GUIDE} head={<span className="page-note">From your laptops · only yours</span>}>
      {body}
    </Page>
  );
}
