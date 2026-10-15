// The shell: top bar, then Jobs | Foreman | Preview. Owns the store, the API client and the live
// sync; tests pass their own (a fake fetch and a fake EventSource).
import { useEffect, useMemo, useState } from 'react';
import { createApi, type ApiClient } from '../api/client';
import { ForemanPane } from '../panes/Foreman/ForemanPane';
import { useAlerts } from '../alerts/useAlerts';
import { JobsPane, useJobsRail } from '../panes/Jobs/JobsPane';
import { PreviewPane } from '../panes/Preview/PreviewPane';
import { createLiveSync, type EventSourceLike, type LiveSync } from '../state/live';
import { needsYouCount, type Connection } from '../state/reducer';
import { createStore, useWorkshopState, WorkshopContext, type Store } from '../state/store';
import { SettingsView } from '../views/Settings/SettingsView';
import { classicHref, settingsHref, useRoute } from './router';

const CONNECTION: Record<Connection, { label: string; hint: string }> = {
  connecting: { label: 'Connecting…', hint: 'Opening the live connection to the dashboard.' },
  live: { label: 'Live', hint: 'Connected: changes show up here as they happen.' },
  reconnecting: { label: 'Reconnecting…', hint: 'The connection to the dashboard dropped. This page catches up by itself when it’s back.' },
};

function TopBar({ onRetry }: { onRetry: () => void }) {
  const state = useWorkshopState();
  const needs = needsYouCount(state);
  const conn = CONNECTION[state.connection];
  return (
    <header className="topbar">
      <h1 className="brand">Feature Workshop</h1>
      {state.meta?.demo ? <span className="chip" title="Demo mode: a pretend Foreman answers and nothing real runs.">Demo</span> : null}
      <span className="spacer" />
      {state.status === 'ready' && (
        <span className="needs" title="How many jobs are waiting for you." aria-live="polite">
          {needs === 0 ? 'Nothing needs you' : `${needs} need${needs === 1 ? 's' : ''} you`}
        </span>
      )}
      <span className={`conn conn-${state.connection}`} title={conn.hint} role="status">
        <span className="conn-dot" aria-hidden="true" />
        {conn.label}
      </span>
      {state.error && state.status === 'ready' && (
        <button type="button" className="btn btn-quiet" onClick={onRetry} title="Fetch everything from the dashboard again now.">Refresh</button>
      )}
      <a className="btn btn-quiet" href={settingsHref()} title="Your settings: the “Always allow” rules you’ve saved, and removing them.">Settings</a>
      <a className="btn btn-quiet" href={classicHref.home()} title="Open the classic Feature Workshop page.">Classic view</a>
    </header>
  );
}

function Shell({ onRetry }: { onRetry: () => void }) {
  const state = useWorkshopState();
  const route = useRoute();
  const [rail] = useJobsRail();
  useAlerts(state);
  const slug = route.name === 'job' ? route.slug : null;
  if (state.status !== 'ready') {
    return (
      <div className="app">
        <TopBar onRetry={onRetry} />
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
  return (
    <div className="app">
      <TopBar onRetry={onRetry} />
      <div className={rail ? 'panes panes-rail' : 'panes'}>
        <JobsPane selected={slug} />
        {route.name === 'settings' ? <SettingsView /> : <ForemanPane slug={slug} />}
        <PreviewPane slug={slug} />
      </div>
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
      <Shell onRetry={() => void sync?.refresh()} />
    </WorkshopContext.Provider>
  );
}
