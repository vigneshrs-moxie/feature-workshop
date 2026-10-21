// The shell: top bar, the usage-limit banner, then Jobs | Foreman | Preview, plus the sheets (⌘K,
// New job, Mark done, the keys list, the job drawer with notes and options) and the page keys. Owns the store, the API client and the
// live sync; tests pass their own (a fake fetch and a fake EventSource).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createApi, type ApiClient } from '../api/client';
import type { PolicyId } from '../api/types';
import { ForemanPane } from '../panes/Foreman/ForemanPane';
import { useAlerts, usePresence } from '../alerts/useAlerts';
import { CommandPalette } from '../components/CommandPalette';
import { UsageBanner } from '../components/UsageBanner';
import { PaneResizer, usePreviewWidth } from '../components/PaneResizer';
import { JobsPane, useJobsRail } from '../panes/Jobs/JobsPane';
import { PreviewPane } from '../panes/Preview/PreviewPane';
import { createLiveSync, type EventSourceLike, type LiveSync } from '../state/live';
import { jobBySlug, needsYouCount, type Connection } from '../state/reducer';
import { createStore, useWorkshop, useWorkshopState, WorkshopContext, type Store } from '../state/store';
import { JobDrawer } from '../views/JobDrawer/JobDrawer';
import { CloseJobSheet } from '../views/JobSheets/CloseJobSheet';
import { KeysSheet } from '../views/JobSheets/KeysSheet';
import { NewJobSheet } from '../views/JobSheets/NewJobSheet';
import { SettingsView } from '../views/Settings/SettingsView';
import { CrewDexView } from '../views/CrewDex/CrewDexView';
import { AchievementsView } from '../views/Achievements/AchievementsView';
import { NotFoundView } from '../views/NotFound/NotFoundView';
import { PlayLedgerProvider } from '../play/PlayLedger';
import { PlayEggs, usePaletteEggs } from '../play/PlayEggs';
import { PlayToasts } from '../play/PlayToasts';
import { StaminaBar } from '../play/FullExtras';
import { CrewMember } from '../play/CrewMember';
import { CREW_SIZE } from '../play/crewSizes';
import { usePlay } from '../play/usePlay';
import { commandsFor, jobsInOrder, type CommandHandlers } from './commands';
import { reopenJob, setJobPolicy, stopRun } from './jobActions';
import { dialogOpen, paletteKeyLabel, useKeyListener, useKeyScope } from './keyRegistry';
import { Kbd } from '../components/Kbd';
import { classicHref, crewDexHref, hrefFor, navigate, openFromHash, settingsHref, useRoute, type Route } from './router';
import { HomeView } from '../home/HomeView';
import { deskQueue } from '../home/homeModel';
import { UiProvider, useUi, type SheetState } from './ui';

/** Put the cursor in the message box at the foot of the Foreman pane. */
export function focusComposer() {
  document.querySelector<HTMLTextAreaElement>('[data-composer-input]')?.focus();
}

const CONNECTION: Record<Connection, { label: string; hint: string }> = {
  connecting: { label: 'Connecting…', hint: 'Opening the live connection to the dashboard.' },
  live: { label: 'Live', hint: 'Connected: changes show up here as they happen.' },
  reconnecting: { label: 'Reconnecting…', hint: 'The connection to the dashboard dropped. This page catches up by itself when it’s back.' },
};

function TopBar({ onRetry, onCrew = false, slug = null }: { onRetry: () => void; onCrew?: boolean; slug?: string | null }) {
  const state = useWorkshopState();
  const ui = useUi();
  const play = usePlay();
  const needs = needsYouCount(state);
  const desk = deskQueue(state.jobs, state.permissions).length;
  const conn = CONNECTION[state.connection];
  return (
    <header className="topbar">
      {/* Play: the Foreman as the workshop's mascot, waving while something needs you. */}
      {play.on && <CrewMember type="conductor" state={needs > 0 ? 'waiting' : 'idle'} size={CREW_SIZE.mascot} label="" className="brand-mascot" />}
      <h1 className="brand"><a href={hrefFor({ name: 'home' })} title="Home: the flow map of every job.">Feature Workshop</a></h1>
      {play.on && <span className="brand-tagline" aria-hidden="true">Your crew, your features, your turn</span>}
      {state.meta?.demo ? <span className="chip" title="Demo mode: a pretend Foreman answers and nothing real runs.">Demo</span> : null}
      {state.status === 'ready' && (
        <button type="button" className="btn" onClick={() => ui.openSheet({ kind: 'new-job' })} title="Start a new job: describe it, pick the repository, kind and Foreman model (key: c).">
          New job <Kbd id="new-job" />
        </button>
      )}
      <button
        type="button"
        className="btn btn-quiet palette-button"
        onClick={() => ui.openSheet({ kind: 'palette' })}
        aria-label="Command palette"
        aria-keyshortcuts="Meta+K Control+K"
        title={`Search every action you can take right now (${paletteKeyLabel()}). Press ? for the list of keys.`}
      >
        <span aria-hidden="true">Actions</span> <kbd className="kbd">{paletteKeyLabel()}</kbd>
      </button>
      <span className="spacer" />
      {/* Play, Full mode only: Claude's usage limit as stamina. */}
      {state.status === 'ready' && <StaminaBar />}
      {state.status === 'ready' && (
        <span className="needs" title="How many jobs are waiting for you." aria-live="polite">
          {needs === 0 ? 'Nothing needs you' : `${needs} need${needs === 1 ? 's' : ''} you`}
        </span>
      )}
      {desk > 0 && (
        <a className="btn btn-quiet desk-link" href={hrefFor({ name: 'desk' })} title="The Desk: every decision waiting for you, one at a time.">
          Desk <span className="home-view-count">{desk}</span>
        </a>
      )}
      <span className={`conn conn-${state.connection}`} title={conn.hint} role="status">
        <span className="conn-dot" aria-hidden="true" />
        {conn.label}
      </span>
      {state.error && state.status === 'ready' && (
        <button type="button" className="btn btn-quiet" onClick={onRetry} title="Fetch everything from the dashboard again now.">Refresh</button>
      )}
      {play.on && (
        <a className="btn btn-quiet" href={crewDexHref()} aria-current={onCrew ? 'page' : undefined} title="The Crew-dex: every crew member, who you have met and what they have done on your jobs (Play mode).">Crew-dex</a>
      )}
      <a className="btn btn-quiet" href={settingsHref()} title="Your settings: the “Always allow” rules you’ve saved, and removing them.">Settings</a>
      {/* The same page in the classic view (the job you have open, else its home); its New view button brings you back. */}
      <a className="btn btn-quiet" href={slug ? classicHref.job(slug) : classicHref.home()} title="Open this page in the classic view: Costs, History, Try it on your computer and the job’s Details live there. Its New view button (key: n) brings you back.">Classic view</a>
    </header>
  );
}

/** The open sheet, if any, and what each of ⌘K's actions does. */
function Sheets({ route }: { route: Route }) {
  const { api, store } = useWorkshop();
  const state = useWorkshopState();
  const ui = useUi();
  const play = usePlay();
  const eggs = usePaletteEggs();
  const [problem, setProblem] = useState<string | null>(null);
  const slug = route.name === 'job' ? route.slug : null;

  const attempt = (p: Promise<unknown>) => { setProblem(null); p.catch((err) => setProblem(err instanceof Error ? err.message : String(err))); };
  const handlers: CommandHandlers = {
    openJob: (s) => navigate({ name: 'job', slug: s }),
    newJob: () => ui.openSheet({ kind: 'new-job' }),
    stop: (runId) => attempt(stopRun(api, runId)),
    // After the palette has closed and given focus back.
    focusComposer: () => setTimeout(focusComposer, 0),
    markDone: (s) => ui.openSheet({ kind: 'close-job', slug: s, worktree: ui.current?.slug === s ? ui.current.worktree : undefined }),
    reopen: (s) => attempt(reopenJob(api, s)),
    jobDrawer: (s) => ui.openSheet({ kind: 'job-drawer', slug: s }),
    // After the palette has closed and given focus back, so the Docs tab can take it.
    openDocs: () => setTimeout(ui.openDocs, 0),
    setPolicy: (s, policy: PolicyId | null) => attempt(setJobPolicy(api, store, s, ui.current?.slug === s ? ui.current.dir : null, policy)),
    settings: () => navigate({ name: 'settings' }),
    crewDex: () => navigate({ name: 'crew' }),
    achievements: () => navigate({ name: 'achievements' }),
    classic: (href) => { window.location.href = href; },
    showKeys: () => ui.openSheet({ kind: 'keys' }),
  };

  // ?open=new-job or ?open=options after the page's address (the classic view links here with
  // them): once the workshop has loaded, open the New job sheet or this job's Notes and options,
  // then drop it from the address so a reload doesn't open it again.
  useEffect(() => {
    if (state.status !== 'ready') return;
    const open = openFromHash(window.location.hash);
    if (!open) return;
    if (open === 'new-job') ui.openSheet({ kind: 'new-job' });
    else if (slug) ui.openSheet({ kind: 'job-drawer', slug, tab: 'options' });
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${window.location.hash.replace(/\?.*$/, '')}`);
  }, [state.status, slug]);

  // The page's keys (app/keyRegistry.ts). The Desk's own j and k win while it has something waiting.
  useKeyScope('global', {
    'palette': () => {
      if (ui.sheet?.kind === 'palette') ui.closeSheet();
      else if (!dialogOpen()) ui.openSheet({ kind: 'palette' });
    },
    'keys': () => ui.openSheet({ kind: 'keys' }),
    'new-job': () => { if (state.status === 'ready') ui.openSheet({ kind: 'new-job' }); },
    'go-home': () => navigate({ name: 'home' }),
    'go-table': () => navigate({ name: 'table' }),
    'go-desk': () => navigate({ name: 'desk' }),
    'go-settings': () => navigate({ name: 'settings' }),
    'go-crew': () => { if (!play.on) return false; navigate({ name: 'crew' }); },
  });
  useKeyScope('rows', {
    'next-job': () => stepJob(1),
    'prev-job': () => stepJob(-1),
  }, route.name !== 'desk');
  useKeyScope('job', {
    'notes': () => { if (slug) ui.openSheet({ kind: 'job-drawer', slug }); },
    'write': () => focusComposer(),
  }, slug !== null && state.status === 'ready');

  function stepJob(by: 1 | -1) {
    const list = jobsInOrder(state);
    if (!list.length) return;
    const at = list.findIndex((j) => j.slug === slug);
    const next = at < 0 ? (by > 0 ? 0 : list.length - 1) : (at + by + list.length) % list.length;
    navigate({ name: 'job', slug: list[next].slug });
  }

  const sheet: SheetState = ui.sheet;
  return (
    <>
      {problem && (
        <div className="toast" role="alert">
          <span>{problem}</span>
          <button type="button" className="btn btn-quiet" onClick={() => setProblem(null)} title="Hide this message.">Dismiss</button>
        </div>
      )}
      {sheet?.kind === 'palette' && (
        <CommandPalette
          commands={commandsFor({ state, slug, current: ui.current, onSettings: route.name === 'settings', onCrew: route.name === 'crew', onAchievements: route.name === 'achievements', play: play.on, classic: classicHref }, handlers)}
          onClose={ui.closeSheet}
          onEgg={eggs}
        />
      )}
      {sheet?.kind === 'new-job' && <NewJobSheet onClose={ui.closeSheet} />}
      {sheet?.kind === 'close-job' && <CloseJobSheet slug={sheet.slug} worktree={sheet.worktree} onClose={ui.closeSheet} />}
      {sheet?.kind === 'keys' && <KeysSheet onClose={ui.closeSheet} />}
      {sheet?.kind === 'job-drawer' && <JobDrawer key={sheet.slug} slug={sheet.slug} job={jobBySlug(state, sheet.slug)} tab={sheet.tab} onClose={ui.closeSheet} />}
    </>
  );
}

function Shell({ onRetry }: { onRetry: () => void }) {
  const state = useWorkshopState();
  const route = useRoute();
  const [rail] = useJobsRail();
  const play = usePlay();
  // The Preview pane's width, if you dragged the handle between it and the middle pane.
  const [previewWidth] = usePreviewWidth();
  const panes = useRef<HTMLDivElement>(null);
  useKeyListener();
  const { api } = useWorkshop();
  const post = useMemo(() => (path: string, body: unknown) => api.post(path, body), [api]);
  useAlerts(state);
  usePresence(post);
  const slug = route.name === 'job' ? route.slug : null;
  // The Crew-dex and Achievements are part of Play: with Play mode Off, #/crew and #/achievements show the same as #/.
  const crew = route.name === 'crew' && play.on;
  const achievements = route.name === 'achievements' && play.on;
  // A #/ address that isn't a page: the Sleuth looks for it (Play on), else #/'s view.
  const lost = route.name === 'not-found' && play.on ? route.hash : null;
  const home = route.name === 'home' ? 'map' : route.name === 'table' ? 'table' : route.name === 'desk' ? 'desk' : null;
  if (state.status !== 'ready') {
    return (
      <div className="app">
        <TopBar onRetry={onRetry} />
        <div className="banner-slot" />
        <Sheets route={route} />
        <div className="app-message" role={state.status === 'error' ? 'alert' : 'status'}>
          {state.status === 'loading' ? (
            <p>Loading jobs…</p>
          ) : (
            <>
              <p>{state.error}</p>
              <p className="muted">Is the dashboard running? This page keeps trying by itself.</p>
              <button type="button" className="btn" onClick={onRetry} title="Try reaching the dashboard again now.">Try again</button>
            </>
          )}
        </div>
      </div>
    );
  }
  // Home (#/, #/table, #/desk): full width, no Jobs or Preview pane.
  if (home) {
    return (
      <div className="app">
        <TopBar onRetry={onRetry} slug={null} />
        <div className="banner-slot"><UsageBanner /></div>
        <Sheets route={route} />
        <HomeView view={home} />
        <PlayToasts />
        <PlayEggs />
      </div>
    );
  }
  return (
    <div className="app">
      <TopBar onRetry={onRetry} onCrew={crew} slug={slug} />
      <div className="banner-slot"><UsageBanner /></div>
      <Sheets route={route} />
      <div ref={panes} className={rail ? 'panes panes-rail' : 'panes'} style={previewWidth ? ({ '--preview-w': `${previewWidth}px` } as CSSProperties) : undefined}>
        <JobsPane selected={slug} />
        {route.name === 'settings' ? <SettingsView /> : crew ? <CrewDexView /> : achievements ? <AchievementsView /> : lost !== null ? <NotFoundView hash={lost} /> : <ForemanPane slug={slug} />}
        <PreviewPane slug={slug} />
        <PaneResizer panes={panes} />
      </div>
      <PlayToasts />
      <PlayEggs />
    </div>
  );
}

export interface AppProps {
  api?: ApiClient;
  store?: Store;
  openStream?: (url: string) => EventSourceLike;
}

export function App({ api: givenApi, store: givenStore, openStream }: AppProps) {
  const [api] = useState(() => givenApi ?? createApi());
  const [store] = useState(() => givenStore ?? createStore());
  const [sync, setSync] = useState<LiveSync | null>(null);
  useEffect(() => {
    const s = createLiveSync({ api, store, openStream });
    setSync(s);
    void s.start();
    return () => s.stop();
  }, [api, store, openStream]);
  const value = useMemo(() => ({ api, store }), [api, store]);
  return (
    <WorkshopContext.Provider value={value}>
      <UiProvider>
        <PlayLedgerProvider>
          <Shell onRetry={() => void sync?.refresh()} />
        </PlayLedgerProvider>
      </UiProvider>
    </WorkshopContext.Provider>
  );
}
