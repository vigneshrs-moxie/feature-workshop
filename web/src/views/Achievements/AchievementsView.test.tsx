import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Achievement, PlayMode, PlayView, Snapshot } from '../../api/types';
import { App } from '../../app/App';
import type { EventSourceLike } from '../../state/live';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { currentTheme, setThemeUnlocks, THEME_KEY } from '../../theme/theme';
import { AchievementsView, unlockDate } from './AchievementsView';

// An invented ledger: two of the ten unlocked, two secrets found out of 13.
const AT = '2026-10-14T15:30:00.000Z';
const visible = (got: Record<string, string>): Achievement[] =>
  [
    ['first-quest', 'First Quest', 'Finish your first quest.'],
    ['clean-sweep', 'Clean Sweep', 'Get a job’s first review round back with zero findings.'],
    ['speedrun', 'Speedrun', 'Take an L0 job from start to done in 15 minutes or less.'],
    ['full-panel', 'Full Panel', 'Have all 8 review lenses look at one job.'],
    ['boss-slayer', 'Boss Slayer', 'Finish an L3 quest.'],
    ['bug-hunter', 'Bug Hunter', 'Finish 10 bug quests.'],
    ['night-owl', 'Night Owl', 'Finish a quest between midnight and 4am.'],
    ['comeback', 'Comeback', 'Finish a job on the same day it carried on after a usage-limit pause.'],
    ['explorer', 'Explorer', 'Try the five original themes besides Default: Neon arcade, Blueprint, Pixel crew, Sunset paper and Candy pop.'],
    ['collector', 'Collector', 'Meet all 15 crew members.'],
  ].map(([id, name, howTo]) => ({ id, name, howTo, secret: false, unlockedAt: got[id] ?? null }));

function ledger(extra: Partial<PlayView> = {}): PlayView {
  return {
    schema: 1, mode: 'subtle', questDone: 'first-pr', crew: {}, crewMet: 0, crewTotal: 15,
    quests: { done: 4, bugs: 1, recent: [] },
    achievements: [
      ...visible({ 'first-quest': AT, explorer: AT }),
      { id: 'secret-teapot', name: 'Short and Stout', howTo: 'Found the teapot.', secret: true, unlockedAt: AT },
      { id: 'secret-headers', name: 'Clacks Overhead', howTo: 'Read the response headers.', secret: true, unlockedAt: AT },
    ],
    secrets: { found: ['teapot', 'headers'], total: 13 },
    themesTried: [], unlocks: { crt: false, gold: false },
    ...extra,
  };
}

function setup(view: PlayView = ledger()) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings: { policy: 'hands-off', play: { mode: 'subtle', questDone: 'first-pr', sounds: false } } } }) });
  const get = vi.fn(async () => view);
  render(<WorkshopContext.Provider value={{ store, api: { get } as unknown as ApiClient }}><AchievementsView /></WorkshopContext.Provider>);
  return { get };
}

const badge = (name: string) => screen.getByRole('heading', { name }).closest('li')!;

afterEach(() => { localStorage.clear(); window.location.hash = ''; setThemeUnlocks({}); document.documentElement.removeAttribute('data-theme'); });

describe('Achievements', () => {
  it('shows the ten as badges: name, how to get it, and the date or the word “Locked”', async () => {
    setup();
    await screen.findByRole('heading', { name: 'First Quest' });
    const grid = screen.getByRole('list', { name: 'Achievements' });
    expect(within(grid).getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText(/2\/10/)).toBeInTheDocument();

    const first = badge('First Quest');
    expect(first).toHaveClass('is-unlocked');
    expect(first).toHaveTextContent('Finish your first quest.');
    expect(first).toHaveTextContent(`Unlocked ${unlockDate(AT)}`);
    expect(first.querySelector('svg.ach-medal')).toHaveClass('is-unlocked');
    expect(first.querySelector('svg.ach-medal')).toHaveAttribute('aria-hidden', 'true');
    expect(within(first).queryByText('Locked')).toBeNull();

    // Locked: greyed, and says so in words (never colour alone), with how to get it.
    const owl = badge('Night Owl');
    expect(owl).toHaveClass('is-locked');
    expect(within(owl).getByText('Locked')).toBeInTheDocument();
    expect(owl).toHaveTextContent('Finish a quest between midnight and 4am.');
    expect(owl.querySelector('svg.ach-medal')).toHaveClass('is-locked');
    expect(unlockDate('2026-10-14T15:30:00.000Z')).toMatch(/Oct 1[45], 2026/);
  });

  it('lists only the secrets found (name and date), counts the rest with no hints', async () => {
    setup();
    const secrets = (await screen.findByRole('heading', { name: /^Secrets/ })).closest('section')!;
    expect(secrets).toHaveTextContent('2/13');
    expect(within(secrets).getByRole('heading', { name: 'Short and Stout' })).toBeInTheDocument();
    expect(within(secrets).getByRole('heading', { name: 'Clacks Overhead' })).toBeInTheDocument();
    expect(secrets).toHaveTextContent(`Found ${unlockDate(AT)}`);
    expect(secrets).toHaveTextContent('11 more secrets to find.');
    // A found secret doesn't spell out where the others are; unfound ones aren't in the page at all.
    expect(document.body).not.toHaveTextContent(/Konami|hammertime|sandwich/i);
    // Secrets are not among the ten.
    expect(within(screen.getByRole('list', { name: 'Achievements' })).queryByText('Short and Stout')).toBeNull();
  });

  it('says so when every secret is found, and one more in the singular', async () => {
    setup(ledger({ secrets: { found: Array.from({ length: 12 }, (_, i) => `s${i}`), total: 13 } }));
    expect(await screen.findByText('1 more secret to find.')).toBeInTheDocument();
  });

  it('shows Gold with its progress, and CRT Terminal only once unlocked', async () => {
    setup();
    const unlocks = (await screen.findByRole('heading', { name: 'Hidden themes' })).closest('section')!;
    expect(unlocks).toHaveTextContent('Gold Locked. Finish 10 quests: 4/10 so far.');
    expect(unlocks).not.toHaveTextContent('CRT');
  });

  it('with both unlocked, points at Settings → Theme', async () => {
    setup(ledger({ unlocks: { crt: true, gold: true }, quests: { done: 12, bugs: 0, recent: [] } }));
    const unlocks = (await screen.findByRole('heading', { name: 'Hidden themes' })).closest('section')!;
    expect(unlocks).toHaveTextContent('Gold Unlocked');
    expect(unlocks).toHaveTextContent('CRT Terminal Unlocked');
    expect(within(unlocks).getAllByRole('link', { name: 'Settings → Theme' })[0]).toHaveAttribute('href', '#/settings');
  });

  it('explains itself: from finished work, never from approving, local only', async () => {
    setup();
    await screen.findByRole('heading', { name: 'First Quest' });
    const how = screen.getByText('How this works').closest('details')!;
    expect(how).not.toHaveAttribute('open');
    expect(how).toHaveTextContent(/come from finished work/);
    expect(how).toHaveTextContent(/Approving something never earns anything/);
    expect(how).toHaveTextContent(/local and personal/);
    expect(how).toHaveTextContent(/never shared/);
  });
});

// ---------- In the shell: #/achievements and ⌘K, only with Play on; the ledger's unlocks reach the theme ----------

class FakeStream implements EventSourceLike {
  readyState = 0;
  onopen: EventSourceLike['onopen'] = null;
  onmessage: EventSourceLike['onmessage'] = null;
  onerror: EventSourceLike['onerror'] = null;
  close() { this.readyState = 2; }
}

function renderApp(mode: PlayMode, view: PlayView = ledger()) {
  const snap: Snapshot = snapshot({ jobs: [job('alpha', 'idle')], meta: { token: 't', settings: { policy: 'hands-off', play: { mode, questDone: 'first-pr', sounds: false } } } });
  const get = vi.fn(async (path: string) => (path === '/api/play' ? (mode === 'off' ? { mode: 'off' } : view) : { slug: 'alpha', thread: [], threadMore: false }));
  const api = { snapshot: vi.fn(async () => snap), setToken: vi.fn(), get } as unknown as ApiClient;
  render(<App api={api} openStream={() => new FakeStream()} />);
  return { get };
}

describe('Achievements in the shell', () => {
  it('Play on: #/achievements opens the view, from the one shared ledger fetch', async () => {
    window.location.hash = '#/achievements';
    const { get } = renderApp('subtle');
    expect(await screen.findByRole('main', { name: 'Achievements' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'First Quest' })).toBeInTheDocument();
    expect(get.mock.calls.filter(([p]) => p === '/api/play')).toHaveLength(1);
  });

  it('Play Off: #/achievements shows the usual page', async () => {
    window.location.hash = '#/achievements';
    renderApp('off');
    expect(await screen.findByRole('main', { name: 'Foreman' })).toBeInTheDocument();
    expect(screen.queryByRole('main', { name: 'Achievements' })).toBeNull();
  });

  it('a hidden theme you picked goes on once the ledger says it is unlocked, and never otherwise', async () => {
    localStorage.setItem(THEME_KEY, 'crt');
    renderApp('subtle', ledger({ unlocks: { crt: true, gold: false } }));
    await waitFor(() => expect(currentTheme()).toBe('crt'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('crt');
  });

  it('a hidden theme put in localStorage by hand stays off while it is locked', async () => {
    localStorage.setItem(THEME_KEY, 'gold');
    const { get } = renderApp('subtle', ledger({ unlocks: { crt: true, gold: false } }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/play'));
    await screen.findByRole('main', { name: 'Jobs' });
    expect(document.documentElement.getAttribute('data-theme')).not.toBe('gold');
    expect(currentTheme()).toBe('default');
  });
});
