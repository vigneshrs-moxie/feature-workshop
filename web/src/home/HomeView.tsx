// Home: the landing page, full width. Three views of the same jobs, switched at the top (or by
// address: #/ the map, #/table, #/desk):
//   Map    where each job's work is on its way to staging and main (FlowMap)
//   Table  the jobs as rows to sort, filter and search (TableView)
//   Desk   every decision waiting for you, one at a time (DeskView)
// With the map: the Foreman's "what needs you" and the cards waiting for an answer (a band above it,
// beside it on a wide screen).
// The header says when the branches and PRs were last read, and Refresh reads them now.
import { useMemo } from 'react';
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
  const read = flow?.fetchedAt ? `Branches and PRs read ${relativeTime(flow.fetchedAt, now)}` : 'Branches and PRs not read yet';

  return (
    <main className="home" aria-label="Home">
      <header className="home-head">
        <nav className="home-views" aria-label="Views">
          {VIEWS.map((v) => (
            <a key={v.id} className={`home-view${v.id === view ? ' is-on' : ''}`} href={hrefFor({ name: v.route })} aria-current={v.id === view ? 'page' : undefined} title={v.hint}>
              {v.label}
              {v.id === 'desk' && desk.length > 0 && <span className="home-view-count" aria-label={`${desk.length} waiting`}>{desk.length}</span>}
            </a>
          ))}
        </nav>
        {view === 'map' && (
          <div className="home-seg" role="group" aria-label="Which jobs">
            <button type="button" className={`home-seg-btn${filter === 'open' ? ' is-on' : ''}`} aria-pressed={filter === 'open'} onClick={() => setFilter('open')} title="Jobs that aren’t done.">Open jobs</button>
            <button type="button" className={`home-seg-btn${filter === 'all' ? ' is-on' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')} title="Also the jobs closed in the last 30 days: their work may still be on its way to main.">With recently closed</button>
          </div>
        )}
        <span className="spacer" />
        {view !== 'desk' && (
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
                <p>Each row is a job; its work travels left to right: <strong>your worktree</strong> → <strong>your fork</strong> → <strong>PR #1</strong> → <strong>the Moxie branch</strong> → <strong>PR #2</strong> → <strong>staging</strong> → <strong>the release PR</strong> → <strong>main</strong>. The box it has reached is marked. Each PR says whether it is open, approved or merged, and whether its checks pass; click it to open it on GitHub.</p>
                <p><strong>main ↑3 ↓2</strong> means the branch has 3 commits main doesn’t, and main has 2 it doesn’t: main moved on, so bring it in before the next push. <strong>not pushed</strong> and <strong>uncommitted</strong> count what is only on your machine.</p>
                <p>The branches are fetched and the PRs read every 10 minutes (read-only); the counts are redone every minute. Refresh reads them now.</p>
              </HowThisWorks>
              {repos.length ? <FlowMap repos={repos} now={now} /> : (
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
