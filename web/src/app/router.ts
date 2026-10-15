// Hash routes, so the dashboard only ever serves /next/index.html:
//   #/            no job open
//   #/job/<slug>  that job's thread in the Foreman pane
//   #/job/<slug>/id/<id>  the same job: the dashboard links requirement IDs (FR-001...) in
//                 replies and briefs this way; the job stays open (the ID itself is ignored for now)
// Anything else falls back to #/.
import { useEffect, useState } from 'react';

export type Route = { name: 'home' } | { name: 'job'; slug: string };

export function parseHash(hash: string): Route {
  const m = /^#\/job\/([^/?#]+)(?:\/id\/[^/?#]+)?\/?$/.exec(hash);
  if (m) {
    try {
      const slug = decodeURIComponent(m[1]);
      if (slug) return { name: 'job', slug };
    } catch { /* a malformed escape: fall through to home */ }
  }
  return { name: 'home' };
}

export function hrefFor(route: Route): string {
  return route.name === 'job' ? `#/job/${encodeURIComponent(route.slug)}` : '#/';
}

export const jobHref = (slug: string) => hrefFor({ name: 'job', slug });

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
