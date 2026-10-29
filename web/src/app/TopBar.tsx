// The top bar of every page: the mark and the product's name (app/brand.ts), the pages (Inbox,
// Desk with what waits for you, Jobs, Stacks, Telemetry), the usage meters, the live connection
// in words, New job (c) and the gear (Settings, the Crew-dex and Achievements in Play, the flow map,
// the Table, the keys, every action). At phone width (app.css) it is the short form: the mark, the
// page's name, the Desk count and a ☰ menu with everything else.
import type { Connection } from '../state/reducer';
import { useWorkshopState } from '../state/store';
import { UsageMeters } from '../components/UsageMeters';
import { StaminaBar } from '../play/FullExtras';
import { usePlay } from '../play/usePlay';
import { staminaOf } from '../play/extrasModel';
import { useNow } from '../lib/time';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { deskQueue } from '../home/homeModel';
import { deskEntries, isShipping } from '../home/nudges';
import { BRAND } from './brand';
import { paletteKeyLabel } from './keyRegistry';
import { MenuButton, type MenuEntry } from './Menu';
import { hrefFor, pageName, settingsHref, stacksHref, telemetryHref, type Route } from './router';
import { useUi } from './ui';

const CONNECTION: Record<Connection, { label: string; hint: string }> = {
  connecting: { label: 'Connecting…', hint: 'Opening the live connection to the dashboard.' },
  live: { label: 'Live', hint: 'Connected: changes show up here as they happen.' },
  reconnecting: { label: 'Reconnecting…', hint: 'The connection to the dashboard dropped. This page catches up by itself when it’s back.' },
};

/** Which of the five pages the route belongs to (a job and its screens are under Jobs). */
function section(route: Route): 'inbox' | 'desk' | 'jobs' | 'stacks' | 'telemetry' | null {
  switch (route.name) {
    case 'home': case 'job': case 'stage': case 'screens': return 'jobs';
    case 'inbox': return 'inbox';
    case 'desk': return 'desk';
    case 'stacks': case 'stack': case 'stack-build': return 'stacks';
    case 'telemetry': return 'telemetry';
    default: return null;
  }
}

/** How many decisions wait for you: the Desk's queue with the nudges before your finish line. */
export function useDeskCount(): number {
  const state = useWorkshopState();
  return deskEntries(deskQueue(state.jobs, state.permissions), state.jobs).filter((e) => !isShipping(e)).length;
}

export function TopBar({ route, onRetry, jobTitle = null }: { route: Route; onRetry: () => void; jobTitle?: string | null }) {
  const state = useWorkshopState();
  const ui = useUi();
  const play = usePlay();
  const desk = useDeskCount();
  const ready = state.status === 'ready';
  const conn = CONNECTION[state.connection];
  const now = useNow(60_000);
  const staminaLow = play.full && staminaOf(state.usage, now).state !== 'fresh';
  const at = section(route);
  const deskHint = desk === 0 ? 'The Desk: nothing is waiting for you right now.' : `The Desk: ${desk === 1 ? 'one decision is' : `${desk} decisions are`} waiting for you, one at a time (key: g d).`;

  const pages: (MenuEntry & { kind: 'link' })[] = [
    { kind: 'link', id: 'inbox', label: 'Inbox', href: hrefFor({ name: 'inbox' }), icon: 'inbox', current: at === 'inbox', hint: 'The Inbox: your Portal Feedback tickets from Orbit, most severe first, with Start for a new job on one (key: g i).' },
    { kind: 'link', id: 'desk', label: 'Desk', href: hrefFor({ name: 'desk' }), icon: 'hand', current: at === 'desk', count: desk, hint: deskHint },
    { kind: 'link', id: 'jobs', label: 'Jobs', href: hrefFor({ name: 'home' }), icon: 'activity', current: at === 'jobs', hint: 'Jobs: every job in four lanes, Working, Needs you, In review and Ready to merge (key: g j).' },
    { kind: 'link', id: 'stacks', label: 'Stacks', href: stacksHref(), icon: 'layers', current: at === 'stacks', hint: 'Stacks: a big ticket split into parts that are built side by side, then joined in order and pushed with your go.' },
    { kind: 'link', id: 'telemetry', label: 'Telemetry', href: telemetryHref(), icon: 'gauge', current: at === 'telemetry', hint: 'Telemetry: where the Claude usage goes and when the weekly limit will be reached.' },
  ];
  const more: MenuEntry[] = [
    { kind: 'link', id: 'settings', label: 'Settings', href: settingsHref(), icon: 'settings', keys: 'go-settings', current: route.name === 'settings', hint: 'Permissions, notifications, look and layouts, keys, workflow, Play and your “Always allow” rules.' },
    ...(play.on ? [
      { kind: 'link' as const, id: 'crew', label: 'Crew-dex', href: hrefFor({ name: 'crew' }), icon: 'users' as const, keys: 'go-crew' as const, current: route.name === 'crew', hint: 'Every crew member: who you have met and what they have done on your jobs (Play).' },
      { kind: 'link' as const, id: 'achievements', label: 'Achievements', href: hrefFor({ name: 'achievements' }), icon: 'trophy' as const, current: route.name === 'achievements', hint: 'What you have unlocked by finishing work, and the secrets you have found (Play).' },
    ] : []),
    { kind: 'sep', id: 'sep-views' },
    { kind: 'link', id: 'map', label: 'Flow map', href: hrefFor({ name: 'map' }), icon: 'map', keys: 'go-map', current: route.name === 'map', hint: 'Where each job’s work is on its way to staging and main: worktree, fork, branch, staging, main.' },
    { kind: 'link', id: 'table', label: 'Table', href: hrefFor({ name: 'table' }), icon: 'table', keys: 'go-table', current: route.name === 'table', hint: 'The jobs as rows: sort, filter and search.' },
    { kind: 'sep', id: 'sep-keys' },
    { kind: 'action', id: 'keys', label: 'Keys', icon: 'keyboard', keys: 'keys', run: () => ui.openSheet({ kind: 'keys' }), hint: 'The keys that work on this page.' },
    { kind: 'action', id: 'actions', label: 'Every action', icon: 'command', keyText: paletteKeyLabel(), run: () => ui.openSheet({ kind: 'palette' }), hint: `Search every action you can take right now (${paletteKeyLabel()}).` },
  ];
  const phoneMenu: MenuEntry[] = [
    ...pages,
    { kind: 'sep', id: 'sep-pages' },
    ...(ready ? [{ kind: 'action' as const, id: 'new-job', label: 'New job', icon: 'plus' as const, keys: 'new-job' as const, run: () => ui.openSheet({ kind: 'new-job' }), hint: 'Start a new job.' }] : []),
    ...more,
  ];

  return (
    <header className="topbar">
      <a className="brand gc-brand" href={hrefFor({ name: 'home' })} aria-label={BRAND.markLabel} title={`${BRAND.name}: every job, in four lanes.`}>
        <span className="gc-mark"><Icon name="radar" size={16} /></span>
        <span className="gc-brand-name">{BRAND.name}</span>
      </a>
      {state.meta?.demo ? <span className="gc-demo" title="Demo mode: a pretend Foreman answers and nothing real runs.">Demo</span> : null}
      <span className="gc-page-name" aria-hidden="true">{pageName(route, jobTitle)}</span>
      {ready && (
        <nav className="gc-nav" aria-label="Pages">
          {pages.map((p) => (
            <Button key={p.id} kind="quiet" className="gc-nav-link" href={p.href} aria-current={p.current ? 'page' : undefined} title={p.hint}>
              {p.label}
              {p.count ? <span className="home-view-count" title={`${p.count} waiting for you`}>{p.count}</span> : null}
            </Button>
          ))}
        </nav>
      )}
      <span className="spacer" />
      {/* The plan's 5-hour and weekly usage; without it (demo, or turned off), Play Full's stamina bar. */}
      {/* Without it, Play full's stamina shows only when it isn't fresh (low, or the crew resting). */}
      {ready && (state.planUsage?.enabled ? <span className="gc-meters"><UsageMeters /></span> : staminaLow ? <span className="gc-meters"><StaminaBar /></span> : null)}
      {/* The connection shows only when it isn't fine: nothing while live (a screen reader still
          hears the change), a quiet "Reconnecting…" while it is down, and Try again after a failed fetch. */}
      <span className={`conn conn-${state.connection}${state.connection === 'live' && !(state.error && ready) ? ' is-fine' : ''}`} title={conn.hint} role="status">
        {state.connection !== 'live' && <span className="conn-spin" aria-hidden="true" />}
        <span className="conn-label">{state.error && ready && state.connection === 'live' ? 'Couldn’t update' : conn.label}</span>
      </span>
      {state.error && ready && (
        <Button kind="quiet" size="sm" icon="refresh" onClick={onRetry} title="Fetch everything from the dashboard again now.">Try again</Button>
      )}
      {ready && (
        <Button icon="plus" keyId="new-job" className="gc-new-job" onClick={() => ui.openSheet({ kind: 'new-job' })} title="Start a new job: describe it, pick the repository, kind and Foreman model (key: c).">
          New job
        </Button>
      )}
      {ready && (
        <Button kind="quiet" icon="hand" className="gc-phone-desk" href={hrefFor({ name: 'desk' })} aria-label={desk ? `Desk, ${desk} waiting for you` : 'Desk, nothing waiting'} title={deskHint}>
          {desk > 0 && <span className="home-view-count">{desk}</span>}
        </Button>
      )}
      <MenuButton className="gc-gear" label="Settings and more" icon="settings" current={route.name === 'settings'} hint="Settings, the flow map, the Table, the keys and every action." entries={more} />
      <MenuButton className="gc-burger" label="Menu" icon="menu" hint="Every page, New job, Settings and the rest." entries={phoneMenu} />
    </header>
  );
}
