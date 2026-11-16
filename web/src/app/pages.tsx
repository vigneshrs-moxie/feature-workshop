// The pages that are not the first screen, each in its own chunk, so the first load of Jobs (and of
// a job, the new job page) reads only what it shows. A page's chunk is fetched ahead: when the
// pointer or the focus reaches its link in the top bar, and quietly for all of them once the app is
// up and the browser is idle, so a page switch almost never waits. While one does wait, the page's
// place is held by an empty page of the same size (nothing below it moves), with "Opening…" only
// after 300 ms. A chunk that fails to load (the app was rebuilt since this tab loaded) says so,
// with Reload, instead of taking the app down.
import { Component, lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { BRAND } from './brand';

interface LazyPage<P> {
  Component: ComponentType<P>;
  /** Fetch the chunk now (once; a failure may be tried again). */
  preload(): Promise<unknown>;
}

/**
 * A page in its own chunk. Once the chunk is in (fetched ahead), the page draws at once: React.lazy
 * would still wait a turn and then hold its reveal for up to 300 ms. A page drawn before its chunk
 * came keeps the lazy route for its whole life, so it never mounts twice.
 */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>): LazyPage<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const get = () => (pending ??= load().then((c) => { loaded = c; return { default: c }; }, (err) => { pending = null; throw err; }));
  const Lazy = lazy(get) as unknown as ComponentType<P>;
  function LazyPageOf(props: P) {
    const [Shown] = useState(() => loaded ?? Lazy);
    return <Shown {...props} />;
  }
  return { Component: LazyPageOf, preload: () => get().catch(() => undefined) };
}

export const Pages = {
  desk: lazyPage(() => import('../home/DeskPage').then((m) => m.DeskPage)),
  inbox: lazyPage(() => import('../views/Inbox').then((m) => m.InboxView)),
  stacks: lazyPage(() => import('../views/Stack/StacksPage').then((m) => m.StacksPage)),
  stack: lazyPage(() => import('../views/Stack/StackPage').then((m) => m.StackPage)),
  stackPart: lazyPage(() => import('../views/Stack/PartPage').then((m) => m.PartPage)),
  stackBuild: lazyPage(() => import('../views/Stack/BuildStack').then((m) => m.BuildStackPage)),
  telemetry: lazyPage(() => import('../views/Telemetry').then((m) => m.TelemetryView)),
  settings: lazyPage(() => import('../views/Settings/SettingsView').then((m) => m.SettingsView)),
  crew: lazyPage(() => import('../views/CrewDex/CrewDexView').then((m) => m.CrewDexView)),
  achievements: lazyPage(() => import('../views/Achievements/AchievementsView').then((m) => m.AchievementsView)),
  gallery: lazyPage(() => import('../views/Gallery/GalleryView').then((m) => m.GalleryView)),
  screens: lazyPage(() => import('../views/Screens/ScreensView').then((m) => m.ScreensView)),
  notFound: lazyPage(() => import('../views/NotFound/NotFoundView').then((m) => m.NotFoundView)),
  home: lazyPage(() => import('../home/HomeView').then((m) => m.HomeView)),
  oldJob: lazyPage(() => import('../job/page/JobPage').then((m) => m.JobPage)),
  floorLab: lazyPage(() => import('../play/floor3d/FloorLab').then((m) => m.default)),
  hosted: lazyPage(() => import('../views/Hosted/HostedApp').then((m) => m.HostedApp)),
};
export type PageId = keyof typeof Pages;

/** The top bar's pages, by their link's id: what to fetch ahead when the pointer or the focus reaches it. */
const NAV: Record<string, PageId[]> = {
  desk: ['desk'], inbox: ['inbox'], stacks: ['stacks', 'stack'], telemetry: ['telemetry'],
  settings: ['settings'], crew: ['crew'], achievements: ['achievements'], map: ['home'], table: ['home'],
};
export function preloadNav(id: string) {
  for (const p of NAV[id] ?? []) void Pages[p].preload();
}

/** Every page's chunk, one after another while the browser is idle, from 3 s after the app is up (so none lands on the first click: a job opened from Jobs a moment after it loads). */
const IDLE_ORDER: PageId[] = ['desk', 'inbox', 'stacks', 'telemetry', 'settings', 'stack', 'stackPart', 'home', 'oldJob', 'screens', 'crew', 'achievements', 'notFound'];
export function usePreloadPagesWhenIdle(ready: boolean) {
  useEffect(() => {
    if (!ready) return undefined;
    let stopped = false;
    let handle: number | ReturnType<typeof setTimeout> | null = null;
    const w = window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    const later = (fn: () => void) => { handle = w.requestIdleCallback ? w.requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 200); };
    let i = 0;
    const next = () => {
      if (stopped || i >= IDLE_ORDER.length) return;
      void Pages[IDLE_ORDER[i++]].preload().then(() => later(next));
    };
    const start = setTimeout(() => later(next), 3000);
    return () => {
      stopped = true;
      clearTimeout(start);
      if (handle !== null) { if (typeof handle === 'number' && w.cancelIdleCallback) w.cancelIdleCallback(handle); else clearTimeout(handle as ReturnType<typeof setTimeout>); }
    };
  }, [ready]);
}

/** The page's place while its chunk loads: an empty page, "Opening…" fading in after 300 ms (app/pages.css). */
export function PageLoading() {
  return (
    <main className="page page-opening" aria-busy="true" aria-label="Opening the page">
      <div className="page-inner">
        <p className="page-opening-words muted" role="status">Opening…</p>
      </div>
    </main>
  );
}

/** A chunk that did not load: the page says so, with Reload; the top bar stays. */
class PageBoundary extends Component<{ children: ReactNode; at: string }, { failed: boolean; at: string }> {
  state = { failed: false, at: this.props.at };
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props: { at: string }, state: { failed: boolean; at: string }) {
    // Another page: try again.
    return props.at !== state.at ? { failed: false, at: props.at } : null;
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page page-opening" aria-label="This page did not open">
        <div className="page-inner">
          <p role="alert">This page did not open. {BRAND.name} may have been updated since this tab loaded.</p>
          <Button kind="primary" icon="refresh" onClick={() => window.location.reload()} title={`Load this tab again with the newest ${BRAND.name}.`}>Reload</Button>
        </div>
      </main>
    );
  }
}

/** Where a page is drawn: its chunk's wait held by PageLoading, a failed chunk by PageBoundary. `at` is the route's key. */
export function PageSlot({ at, children }: { at: string; children: ReactNode }) {
  return (
    <PageBoundary at={at}>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </PageBoundary>
  );
}
