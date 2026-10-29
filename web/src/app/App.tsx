// The shell: the top bar (app/TopBar.tsx), the usage-limit banners, then the page, plus the sheets
// (⌘K, New job, Mark done, the keys list, the job drawer with notes and options) and the page keys.
// Owns the store, the API client and the live sync; tests pass their own (a fake fetch and a fake
// EventSource). The browser tab's title is the page's name and the product's (app/brand.ts).
import { useEffect, useMemo, useState } from 'react';
import { createApi, type ApiClient } from '../api/client';
import type { PolicyId } from '../api/types';
import { useAlerts, usePresence } from '../alerts/useAlerts';
import { CommandPalette } from '../components/CommandPalette';
import { UsageBanner } from '../components/UsageBanner';
import { UsageWarningBanner } from '../components/UsageWarningBanner';
import { createLiveSync, type EventSourceLike, type LiveSync } from '../state/live';
import { jobBySlug } from '../state/reducer';
import { createStore, useWorkshop, useWorkshopState, WorkshopContext, type Store } from '../state/store';
import { JobDrawer } from '../views/JobDrawer/JobDrawer';
import { CloseJobSheet } from '../views/JobSheets/CloseJobSheet';
import { KeysSheet } from '../views/JobSheets/KeysSheet';
import { NewJobSheet } from '../views/JobSheets/NewJobSheet';
import { SettingsView } from '../views/Settings/SettingsView';
import { CrewDexView } from '../views/CrewDex/CrewDexView';
import { AchievementsView } from '../views/Achievements/AchievementsView';
import { NotFoundView } from '../views/NotFound/NotFoundView';
import { ScreensView } from '../views/Screens/ScreensView';
import { IntegrateBoard } from '../views/Integrate';
import { InboxView } from '../views/Inbox';
import { DeskPage } from '../home/DeskPage';
import { JobsPage } from '../home/JobsPage';
import { JobPage } from '../job/JobPage';
import { TelemetryView } from '../views/Telemetry';
import { PlayLedgerProvider } from '../play/PlayLedger';
import { PlayEggs, usePaletteEggs } from '../play/PlayEggs';
import { PlayToasts } from '../play/PlayToasts';
import { usePlay } from '../play/usePlay';
import { commandsFor, jobsInOrder, type CommandHandlers } from './commands';
import { reopenJob, setJobPolicy, stopRun } from './jobActions';
import { dialogOpen, useKeyListener, useKeyScope } from './keyRegistry';
import { classicHref, navigate, oldPages, openFromHash, pageName, useRoute, type Route } from './router';
import { pageTitle } from './brand';
import { TopBar } from './TopBar';
import { HomeView } from '../home/HomeView';
import { UiProvider, useUi, type SheetState } from './ui';

/** Put the cursor in the message box at the foot of the Foreman pane. */
export function focusComposer() {
  document.querySelector<HTMLTextAreaElement>('[data-composer-input]')?.focus();
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
    'go-inbox': () => navigate({ name: 'inbox' }),
    'go-map': () => navigate({ name: 'map' }),
    'go-table': () => navigate({ name: 'table' }),
    'go-desk': () => navigate({ name: 'desk' }),
    'go-settings': () => navigate({ name: 'settings' }),
    'go-crew': () => { if (!play.on) return false; navigate({ name: 'crew' }); },
  });
  // On the Desk and in Settings, j and k are theirs (the queue, the sections).
  useKeyScope('rows', {
    'next-job': () => stepJob(1),
    'prev-job': () => stepJob(-1),
  }, route.name !== 'desk' && route.name !== 'settings');
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
          commands={commandsFor({ state, slug, current: ui.current, onSettings: route.name === 'settings', onCrew: route.name === 'crew', onAchievements: route.name === 'achievements', play: play.on }, handlers)}
          onClose={ui.closeSheet}
          onEgg={eggs}
          onOldPages={() => oldPages.open(slug ? classicHref.job(slug) : classicHref.home())}
        />
      )}
      {sheet?.kind === 'new-job' && <NewJobSheet onClose={ui.closeSheet} description={sheet.description} ticket={sheet.ticket} />}
      {sheet?.kind === 'close-job' && <CloseJobSheet slug={sheet.slug} worktree={sheet.worktree} onClose={ui.closeSheet} />}
      {sheet?.kind === 'keys' && <KeysSheet onClose={ui.closeSheet} />}
      {sheet?.kind === 'job-drawer' && <JobDrawer key={sheet.slug} slug={sheet.slug} job={jobBySlug(state, sheet.slug)} tab={sheet.tab} onClose={ui.closeSheet} />}
    </>
  );
}

function Shell({ onRetry }: { onRetry: () => void }) {
  const state = useWorkshopState();
  const route = useRoute();
  const play = usePlay();
  useKeyListener();
  const { api } = useWorkshop();
  const post = useMemo(() => (path: string, body: unknown) => api.post(path, body), [api]);
  const slug = route.name === 'job' || route.name === 'stage' || route.name === 'screens' ? route.slug : null;
  const job = jobBySlug(state, slug);
  const jobTitle = job ? job.title || job.slug : slug;
  useAlerts(state, pageTitle(pageName(route, jobTitle)));
  usePresence(post);
  // The Crew-dex and Achievements are part of Play: with Play mode Off, #/crew and #/achievements show the same as #/.
  const crew = route.name === 'crew' && play.on;
  const achievements = route.name === 'achievements' && play.on;
  // A #/ address that isn't a page: the Sleuth looks for it (Play on), else #/'s view.
  const lost = route.name === 'not-found' && play.on ? route.hash : null;
  const home = route.name === 'home' ? 'jobs' : route.name === 'map' ? 'map' : route.name === 'table' ? 'table' : route.name === 'desk' ? 'desk' : null;
  const top = <TopBar route={route} onRetry={onRetry} jobTitle={jobTitle} />;
  if (state.status !== 'ready') {
    return (
      <div className="app">
        {top}
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
  // Every page is full width: a job is the Job page (and its stops' Stages); there are no panes.
  const page = route.name === 'screens' ? <ScreensView key={route.slug} slug={route.slug} />
    : route.name === 'job' || route.name === 'stage' ? <JobPage key={route.slug} slug={route.slug} />
      : route.name === 'integrate' ? <IntegrateBoard />
        : route.name === 'telemetry' ? <TelemetryView />
          : route.name === 'inbox' ? <InboxView />
            : route.name === 'desk' ? <DeskPage />
              : route.name === 'settings' ? <div className="page-wide"><SettingsView section={route.section} /></div>
                : crew ? <div className="page-wide"><CrewDexView /></div>
                  : achievements ? <div className="page-wide"><AchievementsView /></div>
                    : lost !== null ? <div className="page-wide"><NotFoundView hash={lost} /></div>
                      : home === 'map' || home === 'table' ? <HomeView view={home} />
                        : <JobsPage />;
  return (
    <div className="app">
      {top}
      <div className="banner-slot"><UsageBanner /><UsageWarningBanner /></div>
      <Sheets route={route} />
      {page}
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
