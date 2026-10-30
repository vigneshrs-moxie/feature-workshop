// The laptop app's own pages on the hosted site (packet 2B): the Desk, a job, its Stage, Stacks and
// a part, drawn from the full mirror. The store is the laptop app's (state/store.ts), kept in step
// by the same live sync (state/live.ts) over the site's snapshot and its live stream
// (hostedStream.ts: each stream ends before the site's time limit and the next carries on without a
// sign; every 5 seconds by polling when a stream can't be had).
//
// What is decided here waits for the laptop when it is off (QueuedDecision.tsx says so on the card),
// and above every page a line says how the laptop is, in words.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ApiClient } from '../../api/client';
import { useKeyListener } from '../../app/keyRegistry';
import { UiProvider } from '../../app/ui';
import { TooltipLayer } from '../../components/Tooltip';
import { DeskPage } from '../../home/DeskPage';
import { JobPage } from '../../job/JobPage';
import { StagePage } from '../../job/StagePage';
import { useNow } from '../../lib/time';
import { useDelayedFlag } from '../../lib/useDelayedFlag';
import { PlayLedgerProvider } from '../../play/PlayLedger';
import { createLiveSync } from '../../state/live';
import { createStore, useWorkshopState, WorkshopContext, type Store } from '../../state/store';
import { PartPage } from '../Stack/PartPage';
import { StackPage } from '../Stack/StackPage';
import { StacksPage } from '../Stack/StacksPage';
import { hostedStream } from './hostedStream';
import { LaptopState } from './HostedJobsPage';
import type { MirrorRoute } from './route';
import type { Laptop } from './types';

/** The store and its live sync for the signed-in person: made once, kept across pages. */
export function useHostedWorkshop(api: ApiClient, on: boolean): Store | null {
  const [store, setStore] = useState<Store | null>(null);
  useEffect(() => {
    if (!on) return undefined;
    const s = createStore();
    const sync = createLiveSync({ api, store: s, openStream: (url) => hostedStream(url) });
    setStore(s);
    void sync.start();
    return () => { sync.stop(); setStore(null); };
  }, [api, on]);
  return store;
}

/** How the laptop is, in words with an icon (never colour alone): "Laptop offline · seen 5m ago". */
export function LaptopLine() {
  const state = useWorkshopState();
  const now = useNow(30_000);
  const laptops = ((state.meta as { laptops?: Laptop[] } | null)?.laptops ?? []);
  if (!laptops.length) return null;
  return (
    <div className="hosted-laptop-line" role="status">
      {laptops.map((l) => (
        <p key={l.id} className="hosted-laptop-line-one">
          {laptops.length > 1 && <span className="hosted-laptop-line-name">{l.name}:</span>}
          <LaptopState laptop={l} now={now} />
          {!l.online && <span className="hosted-laptop-line-note">What you decide here waits for it.</span>}
        </p>
      ))}
    </div>
  );
}

function Body({ route }: { route: MirrorRoute }) {
  const state = useWorkshopState();
  useKeyListener();
  const slow = useDelayedFlag(state.status === 'loading');
  if (state.status !== 'ready') {
    return (
      <div className="app-message" role={state.status === 'error' ? 'alert' : 'status'}>
        {state.status === 'error' ? <p>{state.error}</p> : <p className={slow ? undefined : 'pending is-waiting'}>Loading…</p>}
      </div>
    );
  }
  let page: ReactNode;
  switch (route.name) {
    case 'desk': page = <DeskPage />; break;
    case 'job': page = <JobPage key={route.slug} slug={route.slug} />; break;
    case 'stage': page = <StagePage key={`${route.slug}/${route.stop}`} slug={route.slug} stop={route.stop} />; break;
    case 'stacks': page = <StacksPage />; break;
    case 'stack': page = <StackPage key={route.slug} slug={route.slug} />; break;
    default: page = <PartPage key={`${route.slug}/${route.n}`} slug={route.slug} n={route.n} />;
  }
  return (
    <>
      <div className="banner-slot hosted-laptop-slot"><LaptopLine /></div>
      {page}
    </>
  );
}

export function HostedWorkshop({ api, store, route }: { api: ApiClient; store: Store | null; route: MirrorRoute }) {
  const value = useMemo(() => (store ? { api, store } : null), [api, store]);
  if (!value) return <div className="app-message" role="status"><p className="pending is-waiting">Loading…</p></div>;
  return (
    <WorkshopContext.Provider value={value}>
      <UiProvider>
        <PlayLedgerProvider>
          <Body route={route} />
          <TooltipLayer />
        </PlayLedgerProvider>
      </UiProvider>
    </WorkshopContext.Provider>
  );
}

