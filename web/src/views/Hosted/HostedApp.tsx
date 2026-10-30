// The hosted site (packet 2A): the same web app, in hosted mode. It knows you by the site's session
// cookie (the API client in hosted mode), not by a page token, and has its own few screens:
//   signed out           Sign in with Google (SignInPage), saying why a refused sign-in was refused
//   Jobs                 my jobs from the mirror, by laptop (HostedJobsPage)
//   Pair this laptop     the code `ground-control login` printed (PairPage)
//   Inbox                your Orbit tickets, from the inbox the site keeps (HostedInboxPage)
//   Settings             Laptops, Orbit and People (LaptopsPage, OrbitPage, PeoplePage)
//   everything else      a calm "open this on your laptop for now" page (LaterPage), never an error
// A 401 from any of them (the session ended) brings the sign-in page back.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createApi, type ApiClient } from '../../api/client';
import { BRAND, pageTitle } from '../../app/brand';
import { MenuButton, type MenuEntry } from '../../app/Menu';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useDelayedFlag } from '../../lib/useDelayedFlag';
import { HostedInboxPage } from './HostedInboxPage';
import { HostedJobsPage } from './HostedJobsPage';
import { LaptopsPage } from './LaptopsPage';
import { LaterPage } from './LaterPage';
import { OrbitPage } from './OrbitPage';
import { PairPage } from './PairPage';
import { PeoplePage } from './PeoplePage';
import { SignInPage } from './SignInPage';
import { useHostedRoute, type HostedRoute } from './route';
import type { HostedMeta, HostedPerson } from './types';
import { words, type HostedProps } from './shared';
import './hosted.css';


type Load = { state: 'loading' } | { state: 'ready'; meta: HostedMeta } | { state: 'error'; message: string };

function nameOf(route: HostedRoute): string {
  switch (route.name) {
    case 'jobs': return 'Jobs';
    case 'sign-in': return 'Sign in';
    case 'pair': return 'Pair this laptop';
    case 'laptops': return 'Laptops';
    case 'people': return 'People';
    case 'orbit': return 'Orbit';
    case 'inbox': return 'Inbox';
    default: return route.page;
  }
}

function TopBar({ route, person, onSignOut, busy }: { route: HostedRoute; person: HostedPerson | null; onSignOut?: () => void; busy?: boolean }) {
  const at = route.name === 'jobs' || route.name === 'inbox' ? route.name : route.name === 'laptops' || route.name === 'people' || route.name === 'orbit' ? 'settings' : route.name === 'later' ? route.page : null;
  const pages: (MenuEntry & { kind: 'link' })[] = [
    { kind: 'link', id: 'jobs', label: 'Jobs', href: '#/', icon: 'activity', current: at === 'jobs', hint: 'Your jobs, from every laptop you paired.' },
    { kind: 'link', id: 'inbox', label: 'Inbox', href: '#/inbox', icon: 'inbox', current: at === 'inbox', hint: 'Your Orbit tickets, read by the site even while your laptop is closed.' },
    { kind: 'link', id: 'desk', label: 'Desk', href: '#/desk', icon: 'hand', current: at === 'Desk', hint: 'The Desk: on your laptop for now.' },
    { kind: 'link', id: 'stacks', label: 'Stacks', href: '#/stacks', icon: 'layers', current: at === 'Stacks', hint: 'Stacks: on your laptop for now.' },
    { kind: 'link', id: 'telemetry', label: 'Telemetry', href: '#/telemetry', icon: 'gauge', current: at === 'Telemetry', hint: 'Telemetry: on your laptop for now.' },
  ];
  const settings: MenuEntry = { kind: 'link', id: 'settings', label: 'Settings', href: '#/settings/laptops', icon: 'settings', current: at === 'settings', hint: 'Your laptops, and the people on the site.' };
  return (
    <header className="topbar hosted-topbar">
      <a className="brand gc-brand" href="#/" aria-label={BRAND.markLabel} title={`${BRAND.name}: your jobs.`}>
        <span className="gc-mark"><Icon name="radar" size={16} /></span>
        <span className="gc-brand-name">{BRAND.name}</span>
      </a>
      <span className="gc-page-name" aria-hidden="true">{nameOf(route)}</span>
      {person && (
        <nav className="gc-nav" aria-label="Pages">
          {pages.map((p) => (
            <Button key={p.id} kind="quiet" className="gc-nav-link" href={p.href} aria-current={p.current ? 'page' : undefined} title={p.hint}>{p.label}</Button>
          ))}
        </nav>
      )}
      <span className="spacer" />
      {person && (
        <>
          <Button kind="quiet" className="gc-nav-link hosted-settings-link" href="#/settings/laptops" aria-current={at === 'settings' ? 'page' : undefined} icon="settings" title="Your laptops, and the people on the site.">Settings</Button>
          <span className="hosted-who" title={`Signed in as ${person.email}`}><Icon name="user" size={14} /><span className="hosted-who-name">{person.name}</span></span>
          <Button kind="quiet" size="sm" className="hosted-sign-out" busy={busy} onClick={onSignOut} title="Sign out of the site in this browser.">Sign out</Button>
          <MenuButton className="gc-burger" label="Menu" icon="menu" hint="Every page, Settings and Sign out." entries={[...pages, settings, { kind: 'sep', id: 'sep' }, { kind: 'action', id: 'sign-out', label: 'Sign out', icon: 'arrow-left', run: () => onSignOut?.(), hint: 'Sign out of the site in this browser.' }]} />
        </>
      )}
    </header>
  );
}

export function HostedApp({ api: given }: { api?: ApiClient }) {
  const [api] = useState(() => given ?? createApi({ hosted: true }));
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [signingOut, setSigningOut] = useState(false);
  const route = useHostedRoute();
  const slow = useDelayedFlag(load.state === 'loading');

  const refresh = useCallback(async () => {
    try { setLoad({ state: 'ready', meta: (await api.meta()) as unknown as HostedMeta }); } catch (err) { setLoad({ state: 'error', message: words(err) }); }
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);

  const person = load.state === 'ready' ? load.meta.person : null;
  useEffect(() => { document.title = pageTitle(person ? nameOf(route) : 'Sign in'); }, [route, person]);
  // Signed in, the sign-in page has nothing to say: go to Jobs.
  useEffect(() => { if (person && route.name === 'sign-in') window.location.hash = '#/'; }, [person, route.name]);

  const onSignedOut = useCallback(() => { void refresh(); }, [refresh]);
  async function signOut() {
    setSigningOut(true);
    try { await api.post('/api/auth/logout', {}); } catch { /* signed out already */ }
    setSigningOut(false);
    window.location.hash = '#/';
    await refresh();
  }

  let body: ReactNode;
  if (load.state === 'loading') body = <div className="app-message" role="status"><p className={slow ? undefined : 'pending is-waiting'}>Loading…</p></div>;
  else if (load.state === 'error') {
    body = (
      <div className="app-message" role="alert">
        <p>The site couldn’t be reached: {load.message}</p>
        <Button onClick={() => void refresh()} title="Try reaching the site again now.">Try again</Button>
      </div>
    );
  } else if (!person) body = <SignInPage meta={load.meta} route={route} />;
  else {
    const props: HostedProps = { api, onSignedOut, person };
    body = route.name === 'pair' ? <PairPage key={route.code} code={route.code} {...props} />
      : route.name === 'laptops' ? <LaptopsPage {...props} />
        : route.name === 'people' ? <PeoplePage {...props} />
          : route.name === 'orbit' ? <OrbitPage {...props} />
            : route.name === 'inbox' ? <HostedInboxPage {...props} />
          : route.name === 'later' ? <LaterPage page={route.page} />
            : <HostedJobsPage {...props} />;
  }
  return (
    <div className="app hosted-app" data-mode="hosted">
      <TopBar route={route} person={person} onSignOut={() => void signOut()} busy={signingOut} />
      <div className="banner-slot" />
      {body}
    </div>
  );
}
