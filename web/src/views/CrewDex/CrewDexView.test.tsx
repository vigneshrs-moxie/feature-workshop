import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { PlayMode, PlayView, Snapshot } from '../../api/types';
import { App } from '../../app/App';
import type { EventSourceLike } from '../../state/live';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { ev, job, snapshot } from '../../state/test-fixtures';
import { CrewDexView, stageTime } from './CrewDexView';

// An invented ledger: the Foreman, the Builder and the Locksmith met; nobody else.
const HOUR = 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
function ledger(extra: Partial<PlayView> = {}): PlayView {
  return {
    schema: 1, mode: 'subtle', questDone: 'first-pr',
    crew: {
      conductor: { firstSeen: ago(30 * HOUR), lastSeen: ago(2 * HOUR), jobs: 3, dispatches: 7, avgStageMs: null, blockers: 0, majors: 0 },
      'feature-implementer': { firstSeen: ago(20 * HOUR), lastSeen: ago(3 * HOUR), jobs: 2, dispatches: 4, avgStageMs: 24 * 60_000, blockers: 0, majors: 0 },
      'feature-review-permissions': { firstSeen: ago(10 * HOUR), lastSeen: ago(2 * HOUR), jobs: 1, dispatches: 1, avgStageMs: 75 * 60_000, blockers: 1, majors: 2 },
    },
    crewMet: 3, crewTotal: 15,
    quests: { done: 1, bugs: 0, recent: [] },
    achievements: [
      { id: 'first-quest', name: 'First Quest', howTo: 'Finish a quest.', secret: false, unlockedAt: ago(HOUR) },
      { id: 'clean-sweep', name: 'Clean Sweep', howTo: 'A clean review.', secret: false, unlockedAt: null },
      { id: 'collector', name: 'Collector', howTo: 'Meet all 15.', secret: false, unlockedAt: null },
      { id: 'secret-teapot', name: 'Short and Stout', howTo: 'Found the teapot.', secret: true, unlockedAt: ago(HOUR) },
    ],
    secrets: { found: ['teapot'], total: 13 },
    themesTried: [], unlocks: { crt: false, gold: false },
    ...extra,
  };
}

const META = {
  token: 't',
  models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }, { id: 'claude-fable-5-1', label: 'Fable 5.1' }],
  crewModels: {
    'feature-implementer': { model: 'claude-opus-5-5', effort: 'high' },
    'feature-review-conventions': { model: 'claude-haiku-5-5', effort: null },
    'feature-review-tests': { model: 'claude-sonnet-5-5', effort: null },
    'feature-fable-check': { model: 'claude-fable-5-1', effort: 'high' },
  },
};

function setup({ mode = 'subtle', view = ledger() }: { mode?: PlayMode; view?: PlayView } = {}) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { ...META, settings: { policy: 'hands-off', play: { mode, questDone: 'first-pr', sounds: false } } } }) });
  const get = vi.fn(async (path: string) => {
    if (path !== '/api/play') throw new Error(`unexpected ${path}`);
    return view;
  });
  const api = { get } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}><CrewDexView /></WorkshopContext.Provider>);
  return { store, get };
}

const card = (name: string) => screen.getByRole('heading', { name, level: 3 }).closest('li')!;

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); window.location.hash = ''; });

describe('Crew-dex', () => {
  it('lists all 15, numbered #001–#015, met ones with their character and stats, the rest as silhouettes', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Foreman', level: 3 })).toBeInTheDocument();
    const items = within(screen.getAllByRole('list').find((l) => l.classList.contains('dex-grid'))!).getAllByRole('listitem');
    expect(items).toHaveLength(15);
    expect(items[0]).toHaveTextContent('#001');
    expect(items[14]).toHaveTextContent('#015');

    const builder = card('Builder');
    expect(builder).toHaveClass('is-met');
    expect(builder.querySelector('svg.crew')).not.toHaveClass('is-silhouette');
    expect(within(builder).queryByText('Not met yet')).toBeNull();
    expect(within(builder).getByRole('button', { name: 'Builder: card back' })).toBeInTheDocument();

    const sleuth = card('Sleuth');
    expect(sleuth).toHaveClass('is-unmet');
    expect(within(sleuth).getByText('Not met yet')).toBeInTheDocument();
    expect(sleuth.querySelector('svg.crew')).toHaveClass('is-silhouette');
    expect(sleuth.querySelector('.dex-stats')).toBeNull();
    // The bio stays hidden until they're met: not even in the page.
    expect(sleuth).not.toHaveTextContent('mystery novel');
    expect(within(sleuth).queryByRole('button')).toBeNull();
    // Their role is still there, so a teammate knows who they are.
    expect(sleuth).toHaveTextContent('Investigates the code');
  });

  it('shows the rarity as text (Haiku common · Sonnet uncommon · Opus rare · Fable legendary), with a hint', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Foreman', level: 3 });
    const rarity = (name: string) => card(name).querySelector('.dex-rarity')!;
    expect(rarity('Stickler')).toHaveTextContent('Common');
    expect(rarity('Gauge')).toHaveTextContent('Uncommon');
    expect(rarity('Builder')).toHaveTextContent('Rare');
    expect(rarity('Oracle')).toHaveTextContent('Legendary');
    expect(rarity('Oracle')).toHaveAttribute('title', 'Legendary: runs on Fable.');
    // The Foreman is Opus at every level (rare), whatever else you can pick.
    expect(rarity('Foreman')).toHaveTextContent('Rare');
    expect(card('Foreman')).toHaveTextContent('Opus 5.5');
    expect(card('Builder')).toHaveTextContent('Opus 5.5 · effort high');
    expect(card('Stickler')).toHaveTextContent('Haiku 5.5');
  });

  it('shows real stats: jobs, dispatches, blockers and majors for a lens, average stage time, last seen', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Foreman', level: 3 });
    const stat = (name: string, label: string) => within(card(name)).getByText(label).nextElementSibling;
    expect(stat('Builder', 'Jobs worked')).toHaveTextContent('2');
    expect(stat('Builder', 'Times dispatched')).toHaveTextContent('4');
    expect(stat('Builder', 'Avg. time on a stage')).toHaveTextContent('24m');
    expect(stat('Builder', 'Last seen')).toHaveTextContent('3h ago');
    // Only the review lenses raise findings.
    expect(within(card('Builder')).queryByText('Blockers raised')).toBeNull();
    expect(stat('Locksmith', 'Blockers raised')).toHaveTextContent('1');
    expect(stat('Locksmith', 'Majors raised')).toHaveTextContent('2');
    expect(stat('Locksmith', 'Avg. time on a stage')).toHaveTextContent('1h 15m');
    // The Foreman hands the work out.
    expect(stat('Foreman', 'Work handed out')).toHaveTextContent('7');
    expect(within(card('Foreman')).queryByText('Avg. time on a stage')).toBeNull();
    expect(stageTime(20_000)).toBe('under a minute');
    expect(stageTime(2 * HOUR)).toBe('2h');
  });

  it('counts crew met, secrets found (never which) and achievements', async () => {
    setup();
    const counts = await screen.findByRole('list', { name: 'Your collection' });
    expect(counts).toHaveTextContent('Crew met 3/15');
    expect(counts).toHaveTextContent('Secrets found 1/13');
    expect(counts).toHaveTextContent('Achievements 1/3');
    expect(counts).not.toHaveTextContent(/teapot/i);
    // The achievements count opens the Achievements view.
    const link = within(counts).getByRole('link', { name: /Achievements 1\/3/ });
    expect(link).toHaveAttribute('href', '#/achievements');
    expect(link).toHaveAttribute('title');
  });

  it('says Play is Off when the dashboard answers so before this page has heard', async () => {
    const { get } = setup({ mode: 'subtle', view: { mode: 'off' } as unknown as PlayView });
    expect(await screen.findByRole('status')).toHaveTextContent('Play mode is Off, so the Crew-dex is put away.');
    expect(get).toHaveBeenCalledWith('/api/play');
    expect(screen.queryByText('Loading the Crew-dex…')).toBeNull();
    expect(document.querySelector('.dex-grid')).toBeNull();
  });

  it('turns a met card over with a toggle button (and a click on the card), to the bio', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Foreman', level: 3 });
    const locksmith = card('Locksmith');
    const flip = within(locksmith).getByRole('button', { name: 'Locksmith: card back' });
    const front = locksmith.querySelector('.dex-front')!;
    const back = locksmith.querySelector('.dex-back')!;
    expect(flip).toHaveAttribute('aria-pressed', 'false');
    expect(back).toHaveAttribute('aria-hidden', 'true');
    expect(front).not.toHaveAttribute('aria-hidden');

    expect(flip).toHaveTextContent(/^Card back$/);
    fireEvent.click(flip);
    expect(flip).toHaveAttribute('aria-pressed', 'true');
    // It looks pressed (ticked) while the back shows; its name stays the same.
    expect(flip).toHaveTextContent('✓ Card back');
    expect(flip).toHaveAccessibleName('Locksmith: card back');
    expect(locksmith).toHaveClass('is-flipped');
    expect(back).not.toHaveAttribute('aria-hidden');
    expect(front).toHaveAttribute('aria-hidden', 'true');
    expect(within(back as HTMLElement).getByText('Has never met a door it trusted.')).toBeInTheDocument();

    // A click anywhere on the card turns it back.
    fireEvent.click(locksmith);
    expect(flip).toHaveAttribute('aria-pressed', 'false');
    // A card not met yet doesn't turn over.
    fireEvent.click(card('Painter'));
    expect(card('Painter')).not.toHaveClass('is-flipped');
  });

  it('holds still in Subtle; in Full a met crew member works while you point at or focus the card', async () => {
    setup({ mode: 'subtle' });
    await screen.findByRole('heading', { name: 'Foreman', level: 3 });
    fireEvent.mouseEnter(card('Builder'));
    expect(card('Builder').querySelector('svg.crew')).toHaveAttribute('data-state', 'idle');
    expect(card('Builder').querySelector('svg.crew')).toHaveClass('is-still');
  });

  it('Full: hover and focus play the working animation; silhouettes never move', async () => {
    setup({ mode: 'full' });
    await screen.findByRole('heading', { name: 'Foreman', level: 3 });
    const builder = card('Builder');
    fireEvent.mouseEnter(builder);
    expect(builder.querySelector('svg.crew')).toHaveAttribute('data-state', 'working');
    expect(builder.querySelector('svg.crew')).toHaveClass('is-animated');
    fireEvent.mouseLeave(builder);
    expect(builder.querySelector('svg.crew')).toHaveAttribute('data-state', 'idle');
    act(() => { within(card('Locksmith')).getByRole('button').focus(); });
    expect(card('Locksmith').querySelector('svg.crew')).toHaveAttribute('data-state', 'working');
    fireEvent.mouseEnter(card('Sleuth'));
    expect(card('Sleuth').querySelector('svg.crew')).toHaveClass('is-still');
    expect(card('Sleuth').querySelector('svg.crew')).toHaveAttribute('data-state', 'idle');
  });

  it('refreshes on the dashboard’s play event and on a new snapshot', async () => {
    const { store, get } = setup();
    await screen.findByRole('heading', { name: 'Foreman', level: 3 });
    expect(get).toHaveBeenCalledTimes(1);
    act(() => { store.dispatch({ type: 'event', event: ev(11, 'play', null, { achievement: { id: 'first-quest' } }) }); });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ seq: 12, generatedAt: '2026-10-15T12:05:00.000Z', meta: { ...META, settings: { policy: 'hands-off' } } }) }); });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  });

  it('explains itself in a folded “How this works”: who the crew are, how you meet them, that it costs nothing', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Foreman', level: 3 });
    const how = screen.getByText('How this works').closest('details')!;
    expect(how).not.toHaveAttribute('open');
    expect(how).toHaveTextContent(/helpers the Foreman hands work to/);
    expect(how).toHaveTextContent(/first time they actually work on one of your jobs/);
    expect(how).toHaveTextContent(/costs no usage/);
    expect(how).toHaveTextContent(/Approving something never meets anyone/);
  });
});

// ---------- In the shell: a top-bar link and #/crew, only with Play on ----------

class FakeStream implements EventSourceLike {
  readyState = 0;
  onopen: EventSourceLike['onopen'] = null;
  onmessage: EventSourceLike['onmessage'] = null;
  onerror: EventSourceLike['onerror'] = null;
  close() { this.readyState = 2; }
}

function renderApp(mode: PlayMode) {
  const snap: Snapshot = snapshot({ jobs: [job('alpha', 'idle')], meta: { ...META, settings: { policy: 'hands-off', play: { mode, questDone: 'first-pr', sounds: false } } } });
  const get = vi.fn(async (path: string) => (path === '/api/play' ? (mode === 'off' ? { mode: 'off' } : ledger()) : { slug: 'alpha', thread: [], threadMore: false }));
  const api = { snapshot: vi.fn(async () => snap), setToken: vi.fn(), get } as unknown as ApiClient;
  render(<App api={api} openStream={() => new FakeStream()} />);
  return { get };
}

describe('Crew-dex in the shell', () => {
  it('Play on: a Crew-dex item in the gear menu, and #/crew opens it', async () => {
    window.location.hash = '#/crew';
    renderApp('subtle');
    expect(await screen.findByRole('main', { name: 'Crew-dex' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings and more' }));
    const link = screen.getByRole('menuitem', { name: /^Crew-dex/ });
    expect(link).toHaveAttribute('href', '#/crew');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link).toHaveAttribute('title');
  });

  it('Play Off: no link, and #/crew shows the usual page without asking for the ledger', async () => {
    window.location.hash = '#/crew';
    const { get } = renderApp('off');
    expect(await screen.findByRole('main', { name: 'Foreman' })).toBeInTheDocument();
    expect(screen.queryByRole('main', { name: 'Crew-dex' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings and more' }));
    expect(screen.queryByRole('menuitem', { name: /^Crew-dex/ })).toBeNull();
    expect(get).not.toHaveBeenCalledWith('/api/play');
  });
});
