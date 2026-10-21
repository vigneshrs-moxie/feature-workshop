// Hash routes, so the dashboard only ever serves /next/index.html:
//   #/            no job open
//   #/job/<slug>  that job's thread in the Foreman pane
//   #/job/<slug>/id/<id>  the same job: the dashboard links requirement IDs (FR-001...) in
//                 replies and briefs this way; the job stays open (the ID itself is ignored for now)
//   #/settings    Settings (your "Always allow" rules) in the middle pane
//   #/crew        the Crew-dex in the middle pane (Play mode only; with Play Off it shows #/'s view)
//   #/achievements  your achievements in the middle pane (Play mode only, like the Crew-dex)
// Any other #/… is not a page: with Play on the Sleuth looks for it (views/NotFound), with Play
// Off it shows #/'s view. No hash, "#", "#/" or an in-page "#section" is #/. A query after the hash (#/?theme=x,
// read by theme/theme.ts) is ignored here, so it changes nothing about the route.
import { useEffect, useState } from 'react';

export type Route = { name: 'home' } | { name: 'settings' } | { name: 'crew' } | { name: 'achievements' } | { name: 'job'; slug: string }
  | { name: 'not-found'; hash: string };

export function parseHash(rawHash: string): Route {
  const hash = rawHash.replace(/\?.*$/, '');
  if (/^#\/settings\/?$/.test(hash)) return { name: 'settings' };
  if (/^#\/crew\/?$/.test(hash)) return { name: 'crew' };
  if (/^#\/achievements\/?$/.test(hash)) return { name: 'achievements' };
  const m = /^#\/job\/([^/?#]+)(?:\/id\/[^/?#]+)?\/?$/.exec(hash);
  if (m) {
    try {
      const slug = decodeURIComponent(m[1]);
      if (slug) return { name: 'job', slug };
    } catch { /* a malformed escape: not a page */ }
  }
  if (!hash.startsWith('#/') || hash === '#/') return { name: 'home' };
  return { name: 'not-found', hash };
}

export function hrefFor(route: Route): string {
  if (route.name === 'job') return `#/job/${encodeURIComponent(route.slug)}`;
  if (route.name === 'crew') return '#/crew';
  if (route.name === 'achievements') return '#/achievements';
  if (route.name === 'not-found') return route.hash;
  return route.name === 'settings' ? '#/settings' : '#/';
}

export const settingsHref = () => hrefFor({ name: 'settings' });

export const crewDexHref = () => hrefFor({ name: 'crew' });

export const achievementsHref = () => hrefFor({ name: 'achievements' });

export const jobHref = (slug: string) => hrefFor({ name: 'job', slug });

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
