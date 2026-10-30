// Hash routes, so the dashboard only ever serves /next/index.html:
//   #/            Jobs: every job in four lanes (or one list), full width; #/jobs is the same page
//   #/map         the flow map (home/HomeView.tsx), from the gear menu
//   #/table       the Table: the jobs as rows, from the gear menu
//   #/desk        the Desk: every decision waiting for you, one at a time
//   #/job/<slug>  that job's page: the map of seven stops, the next step, the tabs, the conversation
//   #/job/<slug>/stage/<stop>  one stop of the job (the Stage): who works it, what each is doing
//   #/job/<slug>/id/<id>  the same job: the dashboard links requirement IDs (FR-001...) in
//                 replies and briefs this way; the job stays open (the ID itself is ignored for now)
//   #/job/<slug>/screens  that job's wireframes page full width (views/Screens), with a Back link
//   #/settings    Settings in the middle pane, on its first section (Permissions)
//   #/settings/<section>  Settings on that section: permissions, notifications, look, keys, workflow, repos, play, rules
//   #/crew        the Crew-dex in the middle pane (Play mode only; with Play Off it shows #/'s view)
//   #/inbox       your Portal Feedback tickets from Orbit, in the middle pane (views/Inbox.tsx)
//   #/achievements  your achievements in the middle pane (Play mode only, like the Crew-dex)
//   #/stacks      Stacks: every stack, a big ticket split into parts built side by side (views/Stack);
//                 the old #/integrate address opens it too (the integration board became a stack)
//   #/stacks/build  this app's own packets as one stack: Merge next and both test suites (views/Stack/BuildStack)
//   #/stack/<slug>  one stack: its map, its parts in merge order, the one next step (views/Stack)
//   #/telemetry   where the Claude usage goes and when the limit hits: five graphs, full width (views/Telemetry.tsx)
// Any other #/… is not a page: with Play on the Sleuth looks for it (views/NotFound), with Play
// Off it shows #/'s view. No hash, "#", "#/" or an in-page "#section" is #/. A query after the hash (#/?theme=x,
// read by theme/theme.ts; #/?peek=<slug>, the open quick look on Jobs) is ignored here, so it changes nothing
// about the route.
import { useEffect, useState } from 'react';
import type { StopId } from '../api/types';
import { isStopId, STOPS } from '../components/stops/stops';

/** The Settings page's sections, in the rail's order (views/Settings/sections.ts has their words). */
export const SETTINGS_SECTIONS = ['permissions', 'notifications', 'look', 'keys', 'workflow', 'repos', 'play', 'rules'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const isSettingsSection = (v: string): v is SettingsSection => (SETTINGS_SECTIONS as readonly string[]).includes(v);

export type Route = { name: 'home' } | { name: 'map' } | { name: 'table' } | { name: 'desk' } | { name: 'inbox' } | { name: 'settings'; section?: SettingsSection } | { name: 'crew' } | { name: 'achievements' } | { name: 'job'; slug: string }
  | { name: 'stage'; slug: string; stop: StopId }
  | { name: 'screens'; slug: string } | { name: 'telemetry' } | { name: 'stacks' } | { name: 'stack'; slug: string } | { name: 'stack-part'; slug: string; n: number } | { name: 'stack-build' }
  | { name: 'gallery' }
  | { name: 'not-found'; hash: string };

/** The integration board's old address: it opens Stacks now (packet K2). */
const OLD_INTEGRATE = /^#\/integrate\/?$/;

export function parseHash(rawHash: string): Route {
  const hash = rawHash.replace(/\?.*$/, '');
  if (/^#\/settings\/?$/.test(hash)) return { name: 'settings' };
  const sec = /^#\/settings\/([a-z-]+)\/?$/.exec(hash);
  if (sec && isSettingsSection(sec[1])) return { name: 'settings', section: sec[1] };
  if (/^#\/crew\/?$/.test(hash)) return { name: 'crew' };
  if (/^#\/table\/?$/.test(hash)) return { name: 'table' };
  if (/^#\/map\/?$/.test(hash)) return { name: 'map' };
  if (/^#\/jobs\/?$/.test(hash)) return { name: 'home' };
  if (/^#\/desk\/?$/.test(hash)) return { name: 'desk' };
  if (/^#\/inbox\/?$/.test(hash)) return { name: 'inbox' };
  if (/^#\/achievements\/?$/.test(hash)) return { name: 'achievements' };
  if (/^#\/telemetry\/?$/.test(hash)) return { name: 'telemetry' };
  // Every control in every state, for checking the look (packet R): only by typing the address.
  if (/^#\/gallery\/?$/.test(hash)) return { name: 'gallery' };
  if (/^#\/stacks\/?$/.test(hash) || OLD_INTEGRATE.test(hash)) return { name: 'stacks' };
  if (/^#\/stacks\/build\/?$/.test(hash)) return { name: 'stack-build' };
  // A part's own page (packet V): #/stack/<slug>/part/<n>.
  const sp = /^#\/stack\/([^/?#]+)\/part\/([1-9]\d{0,2})\/?$/.exec(hash);
  if (sp) {
    try {
      const slug = decodeURIComponent(sp[1]);
      if (slug) return { name: 'stack-part', slug, n: Number(sp[2]) };
    } catch { /* a malformed escape: not a page */ }
  }
  const sk = /^#\/stack\/([^/?#]+)\/?$/.exec(hash);
  if (sk) {
    try {
      const slug = decodeURIComponent(sk[1]);
      if (slug) return { name: 'stack', slug };
    } catch { /* a malformed escape: not a page */ }
  }
  const st = /^#\/job\/([^/?#]+)\/stage\/([a-z]+)\/?$/.exec(hash);
  if (st && isStopId(st[2])) {
    try {
      const slug = decodeURIComponent(st[1]);
      if (slug) return { name: 'stage', slug, stop: st[2] };
    } catch { /* a malformed escape: not a page */ }
  }
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
  if (route.name === 'stage') return `#/job/${encodeURIComponent(route.slug)}/stage/${route.stop}`;
  if (route.name === 'crew') return '#/crew';
  if (route.name === 'achievements') return '#/achievements';
  if (route.name === 'table') return '#/table';
  if (route.name === 'map') return '#/map';
  if (route.name === 'desk') return '#/desk';
  if (route.name === 'telemetry') return '#/telemetry';
  if (route.name === 'stacks') return '#/stacks';
  if (route.name === 'stack') return `#/stack/${encodeURIComponent(route.slug)}`;
  if (route.name === 'stack-part') return `#/stack/${encodeURIComponent(route.slug)}/part/${route.n}`;
  if (route.name === 'stack-build') return '#/stacks/build';
  if (route.name === 'inbox') return '#/inbox';
  if (route.name === 'gallery') return '#/gallery';
  if (route.name === 'not-found') return route.hash;
  if (route.name === 'settings') return route.section ? `#/settings/${route.section}` : '#/settings';
  return '#/';
}

export const settingsHref = (section?: SettingsSection) => hrefFor({ name: 'settings', section });

export const crewDexHref = () => hrefFor({ name: 'crew' });

export const achievementsHref = () => hrefFor({ name: 'achievements' });

/** Stacks: every stack. */
export const stacksHref = () => hrefFor({ name: 'stacks' });

/** One stack's page. */
export const stackHref = (slug: string) => hrefFor({ name: 'stack', slug });

/** A part's own page (packet V). */
export const partHref = (slug: string, n: number) => hrefFor({ name: 'stack-part', slug, n });

/** Telemetry: where the Claude usage goes and when the limit hits. */
export const telemetryHref = () => hrefFor({ name: 'telemetry' });

export const jobHref = (slug: string) => hrefFor({ name: 'job', slug });

/** One stop of a job: its Stage page. */
export const stageHref = (slug: string, stop: StopId) => hrefFor({ name: 'stage', slug, stop });

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

/**
 * The job whose quick look is open on Jobs (packet R, principle 14): #/?peek=<slug> or
 * #/jobs?peek=<slug>, after the hash route like ?open=. null when there is none.
 */
export function peekFromHash(rawHash: string): string | null {
  const peek = new URLSearchParams(/\?(.*)$/.exec(rawHash)?.[1] ?? '').get('peek');
  return peek ? peek : null;
}

/**
 * The same address with the quick look on `slug` (or none, with null); the route and any other
 * ?… words (such as ?theme=) stay as they are. No hash at all is #/.
 */
export function withPeek(rawHash: string, slug: string | null): string {
  const [, path = '', query = ''] = /^([^?]*)(?:\?(.*))?$/.exec(rawHash) ?? [];
  const params = new URLSearchParams(query);
  if (slug) params.set('peek', slug); else params.delete('peek');
  const rest = params.toString();
  const route = path === '' || path === '#' ? '#/' : path;
  return rest ? `${route}?${rest}` : route;
}

/** What a page is called: the top bar's page name at phone width and the browser tab's title. */
export function pageName(route: Route, jobTitle?: string | null): string {
  switch (route.name) {
    case 'home': return 'Jobs';
    case 'map': return 'Flow map';
    case 'table': return 'Table';
    case 'desk': return 'Desk';
    case 'inbox': return 'Inbox';
    case 'settings': return 'Settings';
    case 'crew': return 'Crew-dex';
    case 'achievements': return 'Achievements';
    case 'job': return jobTitle || 'Job';
    case 'screens': return jobTitle ? `${jobTitle}: screens` : 'Screens';
    case 'stage': { const stop = STOPS.find((x) => x.id === route.stop)?.label ?? 'Stop'; return jobTitle ? `${stop} · ${jobTitle}` : stop; }
    case 'telemetry': return 'Telemetry';
    case 'stacks': return 'Stacks';
    case 'stack': return jobTitle || 'Stack';
    case 'stack-part': return jobTitle ? `Part ${route.n} · ${jobTitle}` : `Part ${route.n}`;
    case 'stack-build': return 'Build stack';
    case 'gallery': return 'Gallery';
    default: return 'Not a page';
  }
}

/**
 * The old pages at / (decision D4). Nothing in this app links there or names them: the one way in
 * is the command box's hidden word (components/CommandPalette.tsx). Their own "New view" button
 * comes back.
 */
export const classicHref = {
  home: () => '/#/',
  job: (slug: string) => `/#/job/${encodeURIComponent(slug)}`,
  costs: () => '/#/costs',
  history: () => '/#/history',
};

/** Leaves this app for one of the old pages (a seam, so tests can watch it without leaving). */
export const oldPages = { open(href: string) { window.location.href = href; } };

export function navigate(route: Route) {
  const href = hrefFor(route);
  if (window.location.hash !== href) window.location.hash = href;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      // The old integration board's address says where it is now.
      if (OLD_INTEGRATE.test(window.location.hash.replace(/\?.*$/, ''))) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/stacks`);
      const next = parseHash(window.location.hash);
      setRoute((prev) => (hrefFor(prev) === hrefFor(next) ? prev : next));
    };
    window.addEventListener('hashchange', onChange);
    onChange();
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
