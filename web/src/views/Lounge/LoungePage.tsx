// The Lounge (packet 2D, decision G13): the team's one shared page on the hosted site. Per person,
// very little: their name, online, away or off (in words with an icon, never colour alone), what is
// running on their laptops with its ticket, title and stage, and when they were last active.
// Nothing more, on purpose. Everyone signed in sees the same page; your own jobs open, nobody
// else's is a link.
//
// Play: the site shows the work plainly (Play off), as the hosted Desk and Jobs do; ?play=full or
// ?play=subtle in the address shows it in that mode. Full makes each person a console tile with a
// quiet working light (a soft blink while they are online with something running) and a readout
// line; subtle keeps the tile and a steady light, with no readout and no motion; off is plain cards.
//
// Read every 30 seconds while the page is in view, and when the tab comes back. Reading it is what
// tells the site you have it open (so you show online to the others).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Icon, type IconName } from '../../components/Icon';
import { Page, type GuideSpec } from '../../components/page/Page';
import { TooltipLayer } from '../../components/Tooltip';
import { STOPS, stopOf } from '../../components/stops/stops';
import { jobHref } from '../../app/router';
import { relativeTime, fullTime, useNow } from '../../lib/time';
import { useDelayedFlag } from '../../lib/useDelayedFlag';
import { playModeFromAddress } from '../../play/settings';
import type { PlayMode } from '../../api/types';
import { isSignedOut, words, type HostedProps } from '../Hosted/shared';
import type { LoungeAnswer, LoungeJob, LoungePerson, Presence } from './types';
import './lounge.css';

export const REFRESH_MS = 30_000;
/** Jobs shown on a person before "Show n more". */
export const SHOWN_JOBS = 5;

export const PRESENCE: Record<Presence, { word: string; icon: IconName; hint: (minutes: number) => string }> = {
  online: { word: 'Online', icon: 'circle-dot', hint: (m) => `Active in the last ${m} minutes.` },
  away: { word: 'Away', icon: 'moon', hint: (m) => `A laptop is on, but nothing has happened for ${m} minutes.` },
  off: { word: 'Off', icon: 'circle-dashed', hint: () => 'No laptop on, and not on this site lately.' },
};

const GUIDE: GuideSpec = {
  id: 'lounge',
  title: 'The Lounge',
  cards: [
    { icons: ['users'], title: 'The whole team, the same', say: 'Everyone signed in sees this same page. A manager sees nothing extra.' },
    { icons: ['circle-dot', 'moon'], title: 'Online, away or off', say: 'Online: active in the last 15 minutes. Away: a laptop is on, but quiet. Off: no laptop on.' },
    { icons: ['lock'], title: 'Very little, on purpose', say: 'Names, what is running and its stage, and when someone was last active. Never briefs, conversations, costs or decisions. Your own jobs open; others’ don’t.' },
  ],
  done: 'Got it',
};

/** The stage as the job's stop ("Build"), or the stage itself in words. */
export function stageWords(stage: string | null): string | null {
  if (!stage) return null;
  const stop = STOPS.find((s) => s.id === stopOf(stage));
  return stop?.label ?? stage.charAt(0).toUpperCase() + stage.slice(1).replace(/-/g, ' ');
}

/** "Last active 12m ago", "Active just now", "Last active yesterday", "Not active yet". */
export function lastActiveWords(at: string | null, now: Date): string {
  if (!at) return 'Not active yet';
  const rel = relativeTime(at, now);
  if (!rel) return 'Not active yet';
  if (rel === 'just now') return 'Active just now';
  if (/^\d+[mhd]$/.test(rel)) return `Last active ${rel} ago`;
  return `Last active ${rel}`;
}

function JobRow({ job, owner }: { job: LoungeJob; owner: string | null }) {
  const stage = stageWords(job.stage);
  return (
    <li className="lounge-job">
      {job.slug
        ? <a className="lounge-job-title" href={jobHref(job.slug)} title="Open your job.">{job.title}</a>
        : <span className="lounge-job-title" title={owner ? `Only ${owner} can open this job.` : 'Only the person running it can open this job.'}>{job.title}</span>}
      <span className="lounge-job-meta">
        {job.ticket && <span className="chip num">{job.ticket}</span>}
        {stage && <span className="chip lounge-stage" title={job.stage ? `Stage: ${stage}` : undefined}>{stage}</span>}
      </span>
    </li>
  );
}

function PersonTile({ p, play, now, minutes }: { p: LoungePerson; play: PlayMode; now: Date; minutes: number }) {
  const [more, setMore] = useState(false);
  const name = p.name || 'Name not set';
  const owner = p.name || null;
  const state = PRESENCE[p.presence];
  const working = p.presence === 'online' && p.jobs.length > 0;
  const shown = more ? p.jobs : p.jobs.slice(0, SHOWN_JOBS);
  const hidden = p.jobs.length - shown.length;
  const stops = [...new Set(p.jobs.map((j) => stageWords(j.stage)).filter(Boolean))].join(', ');
  return (
    <li className={`lounge-person is-${p.presence} play-${play}${p.you ? ' is-you' : ''}`} data-presence={p.presence} aria-label={`${name}: ${state.word}`}>
      <div className="lounge-person-head">
        {play !== 'off' && <span className={`job-light lounge-light${working ? ' is-on' : ''}${working && play === 'full' ? ' is-blink' : ''}`} aria-hidden="true" />}
        <h3 className={`lounge-name${p.name ? '' : ' is-unnamed'}`}>{name}</h3>
        {p.you && <Chip tone="accent" className="lounge-you">You</Chip>}
        <span className={`lounge-presence is-${p.presence}`} title={state.hint(minutes)}><Icon name={state.icon} size={14} />{state.word}</span>
      </div>
      {play === 'full' && <span className="lounge-readout">{p.jobs.length ? `${p.jobs.length} running${stops ? ` · ${stops}` : ''}` : 'Nothing running'}</span>}
      {p.jobs.length ? (
        <>
          <ul className="lounge-jobs" aria-label={`Running on ${p.you ? 'your' : owner ? `${owner}’s` : 'their'} laptops`}>
            {shown.map((j, i) => <JobRow key={j.slug ?? `${j.ticket ?? ''}${j.title}${i}`} job={j} owner={owner} />)}
          </ul>
          {p.jobs.length > SHOWN_JOBS && (
            <Button kind="quiet" size="sm" className="lounge-more" onClick={() => setMore((m) => !m)} title={more ? 'Show only the first few.' : 'Show every job running.'}>
              {more ? 'Show fewer' : `Show ${hidden} more`}
            </Button>
          )}
        </>
      ) : (
        play !== 'full' && <p className="lounge-none">Nothing running</p>
      )}
      <p className="lounge-last" title={p.lastActiveAt ? fullTime(p.lastActiveAt) : undefined}><Icon name="clock" size={14} />{lastActiveWords(p.lastActiveAt, now)}</p>
    </li>
  );
}

type Load = { state: 'loading' } | { state: 'ready'; lounge: LoungeAnswer } | { state: 'error'; message: string };

export function LoungePage({ api, onSignedOut }: HostedProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const now = useNow(30_000);
  const slow = useDelayedFlag(load.state === 'loading');
  const [play] = useState<PlayMode>(() => playModeFromAddress() ?? 'off');
  const alive = useRef(true);
  const read = useCallback(async () => {
    try {
      const lounge = await api.get<LoungeAnswer>('/api/lounge');
      if (alive.current) setLoad({ state: 'ready', lounge });
    } catch (err) {
      if (isSignedOut(err)) { onSignedOut(); return; }
      // Keep what is shown when a later read fails; say so only when there is nothing yet.
      if (alive.current) setLoad((was) => (was.state === 'ready' ? was : { state: 'error', message: words(err) }));
    }
  }, [api, onSignedOut]);
  useEffect(() => {
    alive.current = true;
    void read();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') void read(); }, REFRESH_MS);
    const onShow = () => { if (document.visibilityState === 'visible') void read(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { alive.current = false; clearInterval(t); document.removeEventListener('visibilitychange', onShow); };
  }, [read]);

  let body;
  if (load.state === 'loading') body = slow ? <p className="muted" role="status">Loading the Lounge…</p> : null;
  else if (load.state === 'error') body = <div role="alert"><p className="field-problem">Couldn’t load the Lounge: {load.message}</p><Button onClick={() => void read()}>Try again</Button></div>;
  else {
    const minutes = load.lounge.activeMinutes;
    const count = (w: Presence) => load.lounge.people.filter((p) => p.presence === w).length;
    body = (
      <>
        <p className="lounge-key">
          {(['online', 'away', 'off'] as const).map((w) => (
            <span key={w} className={`lounge-key-one lounge-presence is-${w}`} title={PRESENCE[w].hint(minutes)}>
              <Icon name={PRESENCE[w].icon} size={14} />{PRESENCE[w].word} <span className="lounge-key-count">{count(w)}</span>
            </span>
          ))}
          <span className="lounge-key-say">Online: active in the last {minutes} minutes. Away: a laptop is on, but quiet. Off: no laptop on.</span>
        </p>
        <ul className={`lounge-people play-${play}`} aria-label="The team">
          {load.lounge.people.map((p) => <PersonTile key={p.id} p={p} play={play} now={now} minutes={minutes} />)}
        </ul>
      </>
    );
  }
  return (
    <Page label="Lounge" title="Lounge" className={`page-lounge play-${play}`} guide={GUIDE} head={<span className="page-note">The whole team · the same for everyone</span>}>
      {body}
      {/* The app's own tooltips for the hints here (the hosted Jobs and Settings pages have none yet). */}
      <TooltipLayer />
    </Page>
  );
}
