// The hosted site's pages, from the same hash addresses as the laptop's app (app/router.ts):
//   #/ or #/jobs            my jobs, from the mirror
//   #/sign-in?problem=…     the sign-in page, saying why the last sign-in was refused
//   #/pair/<code>           "Pair this laptop?" for the code `ground-control login` printed
//   #/settings[/laptops]    Settings → Laptops;  #/settings/people  Settings → People
//   anything else the laptop's app has (a job's page, the Desk, Stacks, Telemetry, …)
//                           a calm "open this on your laptop for now" page, never an error
import { useEffect, useState } from 'react';
import { pageName, parseHash } from '../../app/router';

export type HostedRoute =
  | { name: 'jobs' }
  | { name: 'sign-in'; problem: string | null }
  | { name: 'pair'; code: string }
  | { name: 'laptops' }
  | { name: 'people' }
  | { name: 'later'; page: string };

export function parseHostedHash(raw: string): HostedRoute {
  const path = raw.replace(/\?.*$/, '');
  const query = new URLSearchParams(/\?(.*)$/.exec(raw)?.[1] ?? '');
  if (/^#\/sign-in\/?$/.test(path)) return { name: 'sign-in', problem: query.get('problem') };
  const pair = /^#\/pair\/([A-Za-z0-9-]{1,20})\/?$/.exec(path);
  if (pair) return { name: 'pair', code: pair[1].toUpperCase() };
  if (/^#\/settings(\/laptops)?\/?$/.test(path)) return { name: 'laptops' };
  if (/^#\/settings\/people\/?$/.test(path)) return { name: 'people' };
  const r = parseHash(raw);
  if (r.name === 'home' || r.name === 'not-found') return { name: 'jobs' };
  if (r.name === 'job' || r.name === 'stage' || r.name === 'screens') return { name: 'later', page: 'A job’s page' };
  if (r.name === 'stacks' || r.name === 'stack' || r.name === 'stack-part' || r.name === 'stack-build') return { name: 'later', page: 'Stacks' };
  if (r.name === 'settings') return { name: 'later', page: 'This part of Settings' };
  return { name: 'later', page: pageName(r) };
}

export function useHostedRoute(): HostedRoute {
  const [route, setRoute] = useState(() => parseHostedHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHostedHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** Where a sign-in should land: this page's own address (the hash), or the start. */
export function returnTo(hash: string = window.location.hash): string {
  if (!hash || hash === '#' || hash === '#/' || /^#\/sign-in/.test(hash)) return '/';
  return `/${hash}`;
}
