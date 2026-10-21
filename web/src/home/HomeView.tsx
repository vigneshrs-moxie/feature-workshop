// Home: the landing page, full width. Three views of the same jobs, switched at the top (or by
// address: #/ the map, #/table, #/desk):
//   Map    where each job's work is on its way to staging and main, one row per job (FlowMap)
//   Table  the jobs as rows to sort, filter and search (TableView)
//   Desk   every decision waiting for you, one at a time (DeskView)
// With the map: the Foreman's "what needs you" and the cards waiting for an answer (a band above it,
// beside it on a wide screen).
// The map's tools line (and the Table's header) say when the branches and PRs were last read, and
// Refresh reads them now.
import { useEffect, useMemo, useRef } from 'react';
import { hrefFor } from '../app/router';
import { useUi } from '../app/ui';
import { HowThisWorks } from '../components/HowThisWorks';
import { NeedsYouCards } from '../components/permissions/PendingCards';
import { useStored } from '../lib/stored';
import { relativeTime, useNow } from '../lib/time';
import { floorSpeech } from '../play/floorModel';
import { usePlayIfAny } from '../play/usePlay';
import { WorkshopFloor } from '../play/WorkshopFloor';
import { useWorkshopState } from '../state/store';
import { DeskView } from './DeskView';
import { FlowMap } from './FlowMap';
import { deskQueue, type HomeView as View, type MapFilter, mapRepos, tableRows } from './homeModel';
import { deskEntries, isShipping } from './nudges';
import { TableView } from './TableView';
import { useFlow } from './useFlow';

export const MAP_FILTER_KEY = 'fw.home.map.filter';

const VIEWS: { id: View; label: string; route: 'home' | 'table' | 'desk'; hint: string }[] = [
  { id: 'map', label: 'Map', route: 'home', hint: 'Where each job’s work is: your worktree, your fork, the Moxie branch, staging, main.' },
  { id: 'table', label: 'Table', route: 'table', hint: 'The jobs as rows: sort, filter and search.' },
  { id: 'desk', label: 'Desk', route: 'desk', hint: 'Every decision waiting for you, one at a time, with keys.' },
];

function Side() {
  const play = usePlayIfAny();
  const { jobs, usage } = useWorkshopState();
  const now = useNow();
  if (play?.on) return <aside className="home-side" aria-label="What needs you"><WorkshopFloor compact /></aside>;
  const speech = floorSpeech(jobs, usage, now);
  return (
    <aside className="home-side" aria-label="What needs you">
      <p className="home-say">{speech.say}</p>
      <section className="needs-you-inbox" aria-label="Waiting for your answer">
        <h3 className="settings-heading">Waiting for your answer</h3>
        <NeedsYouCards now={now} />
      </section>
    </aside>
  );
}

export function HomeView({ view }: { view: View }) {
  const state = useWorkshopState();
  const { flow, refresh, problem } = useFlow();
  const ui = useUi();
  const now = useNow();
  const [filterRaw, setFilter] = useStored(MAP_FILTER_KEY);
  const filter: MapFilter = filterRaw === 'all' ? 'all' : 'open';
  const repos = useMemo(() => mapRepos(flow, state.jobs, filter), [flow, state.jobs, filter]);
  const rows = useMemo(() => tableRows(state.jobs, flow, now), [state.jobs, flow, now]);
  const desk = useMemo(() => deskQueue(state.jobs, state.permissions), [state.jobs, state.permissions]);
  // How many wait on the Desk (decisions plus the nudges before your finish line): the top bar shows
  // the number; the Desk tab here only says it to screen readers, so the count is on screen once.
  const deskCount = useMemo(() => deskEntries(desk, state.jobs).filter((e) => !isShipping(e)).length, [desk, state.jobs]);
  const read = flow?.fetchedAt ? `Branches and PRs read ${relativeTime(flow.fetchedAt, now)}` : 'Branches and PRs not read yet';
  const finishLine = state.meta?.settings?.workflow?.finishLine;
  // One scroller for the three views: a switch (g d, the tabs) starts the next view at its top.
  const pane = useRef<HTMLElement>(null);
  useEffect(() => { if (pane.current) pane.current.scrollTop = 0; }, [view]);

  return (
    <main ref={pane} className="home" aria-label="Home">
      <header className="home-head">
        <nav className="home-views" aria-label="Views">
          {VIEWS.map((v) => (
            <a key={v.id} className={`home-view${v.id === view ? ' is-on' : ''}`} href={hrefFor({ name: v.route })} aria-current={v.id === view ? 'page' : undefined} aria-label={v.id === 'desk' && deskCount > 0 ? `Desk, ${deskCount} waiting` : undefined} title={v.hint}>
              {v.label}
            </a>
          ))}
        </nav>
        <span className="spacer" />
        {view === 'table' && (
          <>
            <span className="muted home-read" role="status" title={flow?.nextFetchAt ? `The next read is due ${relativeTime(flow.nextFetchAt, now) || 'soon'}. Local counts are redone every minute.` : undefined}>
              {flow?.refreshing ? 'Reading branches and PRs…' : read}
            </span>
            <button type="button" className="btn" onClick={() => void refresh()} disabled={flow?.refreshing} title="Fetch the branches and read the PRs now (read-only: git fetch and gh).">Refresh</button>
          </>
        )}
        <button type="button" className="btn" onClick={() => ui.openSheet({ kind: 'new-job' })} title="Start a new job (key: c).">New job</button>
      </header>
      {problem && <p className="perm-warn" role="alert">Couldn’t read the flow map: {problem}</p>}
      <div className={`home-body${view === 'desk' ? ' is-desk' : ''}`}>
        {view === 'map' && <Side />}
        <div className="home-main">
          {view === 'map' && (
            <>
              <HowThisWorks id="home-map">
                <p>One row per job, under <strong>Needs you</strong>, <strong>Running</strong>, <strong>Idle</strong>, <strong>Shipping</strong> (past the finish line you set, waiting on other people) and <strong>Done</strong> (folded; click it to open). The dots are the ship track: <strong>worktree · fork · Moxie branch · staging · main</strong>, filled as far as the work has got, with the flag ⚑ on your finish line (Settings → Workflow). The words under it say the same, with the PR it is on (click it to open it on GitHub); the sentence on the right is what to do next.</p>
                <p><strong>main ↑3 ↓2</strong> means the branch has 3 commits main doesn’t, and main has 2 it doesn’t: main moved on, so bring it in before the next push. <strong>not pushed</strong> and <strong>uncommitted</strong> count what is only on your machine. Each repo’s line is its release train: how many commits wait in staging, the open release PR, the last release.</p>
                <p>Keys: <strong>j</strong> and <strong>k</strong> move the highlight, <strong>Enter</strong> opens the job, <strong>o</strong> its newest PR, <strong>/</strong> jumps to the chips, <strong>1</strong>–<strong>4</strong> pick them. The branches are fetched and the PRs read every 10 minutes (read-only); the counts are redone every minute. Refresh reads them now.</p>
              </HowThisWorks>
              <FlowMap repos={repos} now={now} finishLine={finishLine} withClosed={filter === 'all'} setWithClosed={(on) => setFilter(on ? 'all' : 'open')} read={read} refreshing={Boolean(flow?.refreshing)} onRefresh={() => void refresh()} />
              {!repos.length && (
                <p className="muted home-empty">{flow ? 'No job has a repository and a branch yet. They show here once their Foreman sets one up.' : 'Opening the map…'}</p>
              )}
            </>
          )}
          {view === 'table' && <TableView rows={rows} now={now} />}
          {view === 'desk' && <DeskView items={desk} now={now} />}
        </div>
      </div>
    </main>
  );
}
