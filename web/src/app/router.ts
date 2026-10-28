// Hash routes, so the dashboard only ever serves /next/index.html:
//   #/            Home: the flow map, full width (home/HomeView.tsx)
//   #/table       Home's Table: the jobs as rows
//   #/desk        Home's Desk: every decision waiting for you, one at a time
//   #/job/<slug>  that job's thread in the Foreman pane
//   #/job/<slug>/id/<id>  the same job: the dashboard links requirement IDs (FR-001...) in
//                 replies and briefs this way; the job stays open (the ID itself is ignored for now)
//   #/job/<slug>/screens  that job's wireframes page full width (views/Screens), with a Back link
//   #/settings    Settings in the middle pane, on its first section (Permissions)
//   #/settings/<section>  Settings on that section: permissions, notifications, look, keys, workflow, play, rules
//   #/crew        the Crew-dex in the middle pane (Play mode only; with Play Off it shows #/'s view)
//   #/inbox       your Portal Feedback tickets from Orbit, in the middle pane (views/Inbox.tsx)
//   #/achievements  your achievements in the middle pane (Play mode only, like the Crew-dex)
//   #/integrate   the integration board: the packet worktrees and Merge next, full width (views/Integrate.tsx)
//   #/telemetry   where the Claude usage goes and when the limit hits: five graphs, full width (views/Telemetry.tsx)
// Any other #/… is not a page: with Play on the Sleuth looks for it (views/NotFound), with Play
// Off it shows #/'s view. No hash, "#", "#/" or an in-page "#section" is #/. A query after the hash (#/?theme=x,
// read by theme/theme.ts) is ignored here, so it changes nothing about the route.
import { useEffect, useState } from 'react';

/** The Settings page's sections, in the rail's order (views/Settings/sections.ts has their words). */
export const SETTINGS_SECTIONS = ['permissions', 'notifications', 'look', 'keys', 'workflow', 'play', 'rules'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const isSettingsSection = (v: string): v is SettingsSection => (SETTINGS_SECTIONS as readonly string[]).includes(v);

export type Route = { name: 'home' } | { name: 'table' } | { name: 'desk' } | { name: 'inbox' } | { name: 'settings'; section?: SettingsSection } | { name: 'crew' } | { name: 'achievements' } | { name: 'job'; slug: string }
  | { name: 'screens'; slug: string } | { name: 'integrate' } | { name: 'telemetry' } | { name: 'not-found'; hash: string };

export function parseHash(rawHash: string): Route {
  const hash = rawHash.replace(/\?.*$/, '');
  if (/^#\/settings\/?$/.test(hash)) return { name: 'settings' };
  const sec = /^#\/settings\/([a-z-]+)\/?$/.exec(hash);
  if (sec && isSettingsSection(sec[1])) return { name: 'settings', section: sec[1] };
  if (/^#\/crew\/?$/.test(hash)) return { name: 'crew' };
  if (/^#\/table\/?$/.test(hash)) return { name: 'table' };
  if (/^#\/desk\/?$/.test(hash)) return { name: 'desk' };
  if (/^#\/inbox\/?$/.test(hash)) return { name: 'inbox' };
  if (/^#\/achievements\/?$/.test(hash)) return { name: 'achievements' };
  if (/^#\/integrate\/?$/.test(hash)) return { name: 'integrate' };
  if (/^#\/telemetry\/?$/.test(hash)) return { name: 'telemetry' };
  const m = /^#\/job\/([^/?#]+)(?:\/id\/[^/?#]+|\/(screens))?\/?$/.exec(hash);
  if (m) {
    try {
      const slug = decodeURIComponent(m[1]);
      if (slug) return m[2] === 'screens' ? { name: 'screens', slug } : { name: 'job', slug };
    } catch { /* a malformed escape: not a page */ }
  }
  if (!hash.startsWith('#/') || hash === '#/') return { name: 'home' };
  return { name: 'not-found', hash };
}

export function hrefFor(route: Route): string {
  if (route.name === 'job') return `#/job/${encodeURIComponent(route.slug)}`;
  if (route.name === 'screens') return `#/job/${encodeURIComponent(route.slug)}/screens`;
  if (route.name === 'crew') return '#/crew';
  if (route.name === 'achievements') return '#/achievements';
  if (route.name === 'table') return '#/table';
  if (route.name === 'desk') return '#/desk';
  if (route.name === 'integrate') return '#/integrate';
  if (route.name === 'telemetry') return '#/telemetry';
  if (route.name === 'inbox') return '#/inbox';
  if (route.name === 'not-found') return route.hash;
  if (route.name === 'settings') return route.section ? `#/settings/${route.section}` : '#/settings';
  return '#/';
}

export const settingsHref = (section?: SettingsSection) => hrefFor({ name: 'settings', section });

export const crewDexHref = () => hrefFor({ name: 'crew' });

export const achievementsHref = () => hrefFor({ name: 'achievements' });

/** The integration board (packet worktrees, Merge next). */
export const integrateHref = () => hrefFor({ name: 'integrate' });

/** Telemetry: where the Claude usage goes and when the limit hits. */
export const telemetryHref = () => hrefFor({ name: 'telemetry' });

export const jobHref = (slug: string) => hrefFor({ name: 'job', slug });

/** The job's wireframes page, full width. */
export const screensHref = (slug: string) => hrefFor({ name: 'screens', slug });

/**
 * What the address asks to open once the page has loaded: ?open=new-job (the New job sheet) or
 * ?open=options (the job's Notes and options), after the hash route. The classic view links here
 * with them. null for anything else.
 */
export function openFromHash(rawHash: string): 'new-job' | 'options' | null {
  const open = new URLSearchParams(/\?(.*)$/.exec(rawHash)?.[1] ?? '').get('open');
  return open === 'new-job' || open === 'options' ? open : null;
}

/** Links into the old UI at / for features not rebuilt yet (decision D4). */
export const classicHref = {
  home: () => '/#/',
  job: (slug: string) => `/#/job/${encodeURIComponent(slug)}`,
  costs: () => '/#/costs',
  history: () => '/#/history',
};

export function navigate(route: Route) {
  const href = hrefFor(route);
  if (window.location.hash !== href) window.location.hash = href;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      const next = parseHash(window.location.hash);
      setRoute((prev) => (hrefFor(prev) === hrefFor(next) ? prev : next));
    };
    window.addEventListener('hashchange', onChange);
    onChange();
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
