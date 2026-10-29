// The Stage (#/job/<slug>/stage/<stop>), as approved in packet M's wireframes: one stop of a job and
// everyone on it. Back to the job, its ticket and "stop 4 of 7"; the stop's name, its state in words,
// how long, what the stop is for, the seven stops small, and Plan ‹ / Test › ([ and ]). Then the one
// next step (the same as the Job page's: the permission alert, go / no go, or what is happening).
// Then Who's on it: one row per agent with its role (crew/crewPack.ts), model, what it is doing, for
// how long and its status in words, and its terminal button: Open in terminal for the Foreman
// (continues its session), Watch in terminal for a crew member (read-only: follows its log). Open the
// job's folder in a terminal, and the terminal app. Finished here (n) folds those done; then the
// conversation at this stop, folded, and the message box (c). Crew faces show only in Play full;
// subtle and off show the role's initials.
import { useCallback, useEffect, useState } from 'react';
import type { Job, StageAgent, StageView, StopId } from '../api/types';
import { useKeyScope } from '../app/keyRegistry';
import { jobHref, navigate, stageHref } from '../app/router';
import { Icon, type IconName } from '../components/Icon';
import { Kbd } from '../components/Kbd';
import { Fold, Page, type GuideSpec } from '../components/page/Page';
import { StopMap } from '../components/stops/StopMap';
import { STOPS, stagesOf } from '../components/stops/stops';
import { useNow } from '../lib/time';
import { Composer } from '../panes/Foreman/Composer';
import { ThreadList, useCurrentJob, useJobConversation } from '../panes/Foreman/ForemanPane';
import { CrewMember } from '../play/CrewMember';
import { initialsOf, roleOf } from '../play/crewPack';
import { usePlay } from '../play/usePlay';
import { jobBySlug } from '../state/reducer';
import { useWorkshop, useWorkshopState } from '../state/store';
import { NextStep, ticketOf } from './JobPage';
import { ReviewPanel } from '../views/Review/ReviewPanel';

export const STAGE_GUIDE: GuideSpec = {
  id: 'stage',
  title: 'How a stop works',
  done: 'Show me who’s on it',
  cards: [
    { icons: ['users'], title: 'Who’s on it', say: 'The Foreman and the crew at this stop, what each is doing, in words.' },
    { icons: ['terminal'], title: 'Open or watch', say: 'Open the Foreman in a terminal to carry on its session; watch a crew member’s log, read-only.' },
    { icons: ['chevron-left', 'chevron-right'], title: 'Step through', say: '[ and ] go to the stop before and after.' },
  ],
};

/** What each stop is for, in a few words. */
export const STOP_PURPOSE: Record<StopId, string> = {
  spec: 'Write what it must do', investigate: 'Read the code it touches', plan: 'Plan the steps', build: 'Write the code',
  test: 'Run the tests', review: 'Check the change', ship: 'Open the pull requests',
};

export const AGENT_STATUS: Record<StageAgent['status'], { word: string; icon: IconName }> = {
  working: { word: 'Working', icon: 'activity' },
  waiting: { word: 'Waiting for you', icon: 'hand' },
  done: { word: 'Done', icon: 'circle-check' },
  stopped: { word: 'Stopped', icon: 'stop' },
};
export const STATE_ICON: Record<StageView['state'], IconName> = { done: 'circle-check', now: 'activity', waiting: 'hand', next: 'circle-dashed', skipped: 'skip' };

/** "18 min", "2 h", "3 days": how long since `iso`. */
export function forHowLong(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };

export function StagePage({ slug, stop }: { slug: string; stop: StopId }) {
  const state = useWorkshopState();
  const job = jobBySlug(state, slug);
  if (!job) {
    return (
      <Page label="Stage" title="Stage">
        <p className="muted">There’s no job called “{slug}”. It may have been renamed or removed.</p>
      </Page>
    );
  }
  return <StageBody key={`${slug}/${stop}`} job={job} stop={stop} />;
}

function StageBody({ job, stop }: { job: Job; stop: StopId }) {
  const { api } = useWorkshop();
  const now = useNow();
  const play = usePlay();
  const conversation = useJobConversation(job);
  useCurrentJob(job, conversation);
  const { thread, run } = conversation;
  const [load, setLoad] = useState<Load<StageView>>({ state: 'loading' });
  const [tries, setTries] = useState(0);
  const path = `/api/job/${encodeURIComponent(job.slug)}/stage/${stop}`;
  useEffect(() => {
    let off = false;
    const get = () => api.get<StageView>(path).then(
      (value) => { if (!off) setLoad({ state: 'ready', value }); },
      (err) => { if (!off) setLoad((l) => (l.state === 'ready' ? l : { state: 'error', message: err instanceof Error ? err.message : String(err) })); },
    );
    void get();
    // While someone works here, what they are doing changes without the job changing.
    const id = setInterval(() => void get(), 10_000);
    return () => { off = true; clearInterval(id); };
  }, [api, path, tries, job.updatedAt]);

  const i = STOPS.findIndex((s) => s.id === stop);
  const here = STOPS[i];
  const prev = STOPS[i - 1] ?? null;
  const next = STOPS[i + 1] ?? null;
  const [finishedOpen, setFinishedOpen] = useState(false);
  useKeyScope('stage', {
    'stage-finished': () => setFinishedOpen((o) => !o),
    'stage-prev': () => { if (prev) navigate({ name: 'stage', slug: job.slug, stop: prev.id }); },
    'stage-next': () => { if (next) navigate({ name: 'stage', slug: job.slug, stop: next.id }); },
  });

  const view = load.state === 'ready' ? load.value : null;
  const ticket = ticketOf(job);
  const stagesHere = view?.stages?.length ? view.stages : stagesOf(stop);
  const messages = thread.items.length;
  const long = forHowLong(view?.since, now);
  return (
    <Page
      label="Stage"
      className={`page-stage play-${play.mode}`}
      guide={STAGE_GUIDE}
      title={<><Icon name={here.icon} size={22} /> {here.label}</>}
      head={(
        <>
          {view && <span className={`chip state-chip is-${view.state}`}><Icon name={STATE_ICON[view.state]} size={14} /> {view.stateWords}</span>}
          <span className="muted stage-for">{long ? `for ${long} · ` : ''}{STOP_PURPOSE[stop]}</span>
          <StopMap job={job} compact current={stop} hrefFor={(s) => stageHref(job.slug, s)} label="The job’s stops" />
          <span className="spacer" />
          <nav className="stage-steps" aria-label="Stops before and after">
            {prev
              ? <a className="btn btn-quiet" href={stageHref(job.slug, prev.id)} title={`The stop before: ${prev.label} (key: [).`}><Icon name="chevron-left" size={16} /> {prev.label}<Kbd id="stage-prev" /></a>
              : <span className="btn btn-quiet is-off" aria-disabled="true" title="This is the first stop."><Icon name="chevron-left" size={16} /> First stop</span>}
            {next
              ? <a className="btn btn-quiet" href={stageHref(job.slug, next.id)} title={`The stop after: ${next.label} (key: ]).`}>{next.label} <Icon name="chevron-right" size={16} /><Kbd id="stage-next" /></a>
              : <span className="btn btn-quiet is-off" aria-disabled="true" title="This is the last stop.">Last stop <Icon name="chevron-right" size={16} /></span>}
          </nav>
        </>
      )}
    >
      <p className="stage-back">
        <a href={jobHref(job.slug)} title="Back to the job’s page."><Icon name="arrow-left" size={16} /> {job.title || job.slug}</a>
        <span className="muted"> {ticket ? `· ${ticket} ` : ''}· stop {i + 1} of {STOPS.length}</span>
      </p>
      <NextStep job={job} conversation={conversation} now={now} />
      {stop === 'ship' && <ReviewPanel slug={job.slug} line />}
      {load.state === 'loading' && <p className="muted" role="status">Reading who’s on this stop…</p>}
      {load.state === 'error' && (
        <div>
          <p className="thread-error" role="alert">Couldn’t read this stop: {load.message}</p>
          <button type="button" className="btn" onClick={() => setTries((n) => n + 1)} title="Ask the dashboard for this stop again.">Try again</button>
        </div>
      )}
      {view && <WhoIsOn job={job} view={view} now={now} faces={play.full} finishedOpen={finishedOpen} setFinishedOpen={setFinishedOpen} />}
      <Fold icon="message" name="Conversation at this stop" note={messages ? `${messages} ${messages === 1 ? 'message' : 'messages'}` : undefined} id={`stage-convo-${job.slug}-${stop}`}>
        <ThreadList job={job} conversation={conversation} now={now} cards={false} stages={stagesHere} />
      </Fold>
      <Composer key={job.slug} slug={job.slug} detail={thread.detail} run={run} />
    </Page>
  );
}

function WhoIsOn({ job, view, now, faces, finishedOpen, setFinishedOpen }: { job: Job; view: StageView; now: Date; faces: boolean; finishedOpen: boolean; setFinishedOpen(open: boolean): void }) {
  const { api } = useWorkshop();
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [app, setApp] = useState<string | null>(view.terminalApp);
  const local = `/api/job/${encodeURIComponent(job.slug)}/local`;
  const act = useCallback(async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try { setNote({ text: await fn(), bad: false }); } catch (err) { setNote({ text: err instanceof Error ? err.message : String(err), bad: true }); } finally { setBusy(null); }
  }, []);
  const openFolder = () => act('folder', async () => {
    await api.post(local, { action: 'open', what: 'terminal' });
    return `Opened the job’s folder in ${app ?? 'a terminal'}.`;
  });
  const pickApp = (name: string) => act('app', async () => {
    await api.post(local, { action: 'terminal-app', name });
    setApp(name);
    return `The terminal buttons now use ${name}.`;
  });
  const openAgent = (a: StageAgent) => act(a.ref, async () => {
    const r = await api.post<{ demo?: boolean; kind?: string }>(`/api/job/${encodeURIComponent(job.slug)}/stage/${view.stop}/terminal`, { ref: a.ref });
    const role = roleOf(a.who === 'conductor' ? null : a.who);
    if (r?.demo) return `In the demo nothing opens; on your computer this would ${a.terminal.kind === 'continue' ? `open the ${role} in a terminal` : `follow the ${role}’s log in a terminal`}.`;
    return a.terminal.kind === 'continue' ? `Opened the ${role} in ${app ?? 'a terminal'}. Its session carries on there.` : `Following the ${role}’s log in ${app ?? 'a terminal'}. It only reads; nothing you type reaches it.`;
  });

  const working = view.agents.filter((a) => a.status === 'working' || a.status === 'waiting').length;
  const apps = view.terminalApps.length ? view.terminalApps : [];
  return (
    <section className="stage-who" aria-labelledby="stage-who-title">
      <header className="stage-who-head">
        <h3 id="stage-who-title">Who’s on it</h3>
        <span className="muted">{view.agents.length === 0 ? 'Nobody right now' : working ? `${working} working` : `${view.agents.length} here`}</span>
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => void openFolder()} title="Open a terminal in the job’s folder (its worktree).">
          <Icon name="folder" size={16} /> Open the job’s folder in a terminal
        </button>
        {apps.length > 1 && (
          <select className="stage-app" value={app ?? apps[0]} aria-label="Terminal app" disabled={busy !== null} onChange={(e) => void pickApp(e.target.value)} title="Which terminal app the buttons here open.">
            {apps.map((t) => <option key={t} value={t}>in {t}</option>)}
          </select>
        )}
      </header>
      {note && <p className={note.bad ? 'thread-error' : 'muted stage-note'} role={note.bad ? 'alert' : 'status'}>{note.text}</p>}
      {view.agents.length === 0 && (
        <p className="muted stage-empty">{view.state === 'next' ? 'The job hasn’t reached this stop yet.' : view.state === 'skipped' ? 'This job skipped this stop.' : 'Nobody is working here now.'}</p>
      )}
      <ul className="stage-rows">
        {view.agents.map((a) => <AgentRow key={a.ref} a={a} now={now} faces={faces} busy={busy === a.ref} onOpen={() => void openAgent(a)} />)}
      </ul>
      {view.finished.length > 0 && (
        <details className="fold stage-finished" open={finishedOpen} onToggle={(e) => setFinishedOpen(e.currentTarget.open)}>
          <summary className="fold-head" title="Who finished their part at this stop (key: n).">
            <Icon name="circle-check" size={16} /><span className="fold-name">Finished here</span><span className="muted">· {view.finished.length}</span>
            <Kbd id="stage-finished" />
            <span className="fold-show" aria-hidden="true"><span className="when-closed">Show ▸</span><span className="when-open">Hide ▾</span></span>
          </summary>
          <ul className="fold-body stage-rows">
            {view.finished.map((a) => <AgentRow key={a.ref} a={a} now={now} faces={faces} busy={busy === a.ref} onOpen={() => void openAgent(a)} />)}
          </ul>
        </details>
      )}
    </section>
  );
}

function AgentRow({ a, now, faces, busy, onOpen }: { a: StageAgent; now: Date; faces: boolean; busy: boolean; onOpen(): void }) {
  const role = roleOf(a.who === 'conductor' ? null : a.who);
  const status = AGENT_STATUS[a.status];
  const long = forHowLong(a.since, now);
  const cont = a.terminal.kind === 'continue';
  const live = a.status === 'working' || a.status === 'waiting';
  return (
    <li className={`stage-row is-${a.status}`}>
      {faces
        ? <span className="stage-face" aria-hidden="true"><CrewMember type={a.who} size={48} label="" state={a.status === 'working' ? 'working' : a.status === 'waiting' ? 'waiting' : 'idle'} /></span>
        : <span className="stage-initials" aria-hidden="true">{initialsOf(a.who === 'conductor' ? null : a.who)}</span>}
      <div className="stage-row-say">
        <span className="stage-row-who"><b>{role}</b>{a.model && <span className="chip num">{a.model}</span>}</span>
        <span className="stage-row-doing">{a.doing || (live ? 'Getting started' : a.status === 'done' ? 'Finished its part' : 'Stopped before it finished')}</span>
      </div>
      <span className="muted stage-row-time" title={a.since ? `Since ${new Date(a.since).toLocaleString()}` : undefined}>{long && <><Icon name="clock" size={14} /> {long}</>}</span>
      <span className={`chip stage-status is-${a.status}`}><Icon name={status.icon} size={14} /> {status.word}</span>
      <div className="stage-row-term">
        <button
          type="button"
          className={cont ? 'btn' : 'btn btn-quiet'}
          disabled={!a.terminal.ready || busy}
          onClick={onOpen}
          title={a.terminal.ready ? (cont ? 'Open the Foreman in a terminal and carry on its session there.' : `Follow the ${role}’s log in a terminal. Read-only: nothing you type reaches it.`) : a.terminal.why ?? 'Not available now.'}
        >
          <Icon name={cont ? 'terminal' : 'scroll'} size={16} /> {cont ? 'Open in terminal' : 'Watch in terminal'}
        </button>
        <span className="muted stage-row-term-note">{a.terminal.ready ? (cont ? 'Continues its session' : 'Read-only: follows its log') : a.terminal.why}</span>
      </div>
    </li>
  );
}
