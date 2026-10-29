// The easter eggs through the real page: the Konami code, the console, ⌘K's phrases (and the
// Locksmith's door), the Sleuth's not-found page, the Foreman knocked on seven times, the Friday
// push eyebrow and the seasonal hats. Each records its secret once; with Play mode Off none of
// them does anything and the page is as it was.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Permission, PlayMode } from '../api/types';
import { App } from '../app/App';
import { writeKeysSetting } from '../app/keysSetting';
import { CommandPalette, DOOR_MS } from '../components/CommandPalette';
import { PermissionCard } from '../components/permissions/PermissionCard';
import type { EventSourceLike } from '../state/live';
import { createStore, WorkshopContext } from '../state/store';
import { job, snapshot } from '../state/test-fixtures';
import { setThemeUnlocks, THEME_KEY } from '../theme/theme';
import { CrewMember } from './CrewMember';
import { clearScenes, KONAMI, SCENE_MS, setCrewClock } from './eggs';
import { PlayToasts } from './PlayToasts';
import { ForemanFace } from './ThreadCrew';
import { forgetSecrets } from './useSecret';

class FakeStream implements EventSourceLike {
  readyState = 0;
  onopen: EventSourceLike['onopen'] = null;
  onmessage: EventSourceLike['onmessage'] = null;
  onerror: EventSourceLike['onerror'] = null;
  close() { this.readyState = 2; }
}

const settings = (mode: PlayMode) => ({ token: 'tok-1', settings: { policy: 'hands-off' as const, play: { mode, questDone: 'first-pr' as const, sounds: false } } });

function fakeApi(found: string[] = []) {
  const posts: [string, unknown][] = [];
  const api = {
    setToken: vi.fn(),
    // The ledger: CRT Terminal unlocked once the Konami secret is in it.
    get: vi.fn(async (p: string) => (p === '/api/play'
      ? { mode: 'subtle', crew: {}, quests: { done: 0, bugs: 0, recent: [] }, achievements: [], secrets: { found: [...found], total: 13 }, themesTried: [], unlocks: { crt: found.includes('konami'), gold: false } }
      : { slug: 'alpha', thread: [], threadMore: false })),
    post: vi.fn(async (p: string, body: { id?: string }) => {
      posts.push([p, body]);
      if (p === '/api/play/secret' && body.id) found.push(body.id);
      return { recorded: true, secrets: { found: [...found], total: 13 } };
    }),
  };
  return { api, posts, secrets: () => posts.filter(([p]) => p === '/api/play/secret').map(([, b]) => (b as { id: string }).id) };
}

function renderApp(mode: PlayMode, jobs = [job('alpha', 'idle', { title: 'Alpha' })]) {
  const fake = fakeApi();
  const api = { ...fake.api, snapshot: vi.fn(async () => snapshot({ jobs, meta: settings(mode) })) } as unknown as ApiClient;
  render(<App api={api} openStream={() => new FakeStream()} />);
  return fake;
}

/** A component inside a store with the given Play mode. */
function inStore(mode: PlayMode, ui: React.ReactNode) {
  const fake = fakeApi();
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: settings(mode) }) });
  render(<WorkshopContext.Provider value={{ store, api: fake.api as unknown as ApiClient }}>{ui}<PlayToasts /></WorkshopContext.Provider>);
  return fake;
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const press = (keys: readonly string[], target: EventTarget = document.body) => { for (const key of keys) fireEvent.keyDown(target, { key }); };

beforeEach(() => { forgetSecrets(); clearScenes(); });
afterEach(() => {
  vi.useRealTimers();
  window.location.hash = '';
  localStorage.clear();
  delete (window as { crew?: unknown }).crew;
  document.documentElement.removeAttribute('data-theme');
  setThemeUnlocks({});
});

describe('the Konami code', () => {
  it('outside a field: records the secret and puts on CRT Terminal, with a scene', async () => {
    const { secrets } = renderApp('subtle');
    await screen.findByRole('main', { name: 'Jobs' });
    await flush();
    expect(document.documentElement).not.toHaveAttribute('data-theme', 'crt');
    press(KONAMI);
    await flush();
    expect(secrets()).toEqual(['konami']);
    // On once the ledger, fetched again, says it is unlocked.
    await vi.waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'crt'));
    expect(localStorage.getItem(THEME_KEY)).toBe('crt');
    expect(await screen.findByText(/CRT Terminal unlocked/)).toBeInTheDocument();
  });

  it('survives the page changing under it halfway through', async () => {
    const { secrets } = renderApp('subtle');
    await screen.findByRole('main', { name: 'Jobs' });
    press(KONAMI.slice(0, 5));
    act(() => { window.location.hash = '#/job/alpha'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await screen.findByRole('heading', { name: /Alpha/ });
    press(KONAMI.slice(5));
    await flush();
    expect(secrets()).toEqual(['konami']);
  });

  it('typed into a field it is just typing', async () => {
    const { secrets } = renderApp('subtle');
    await screen.findByRole('main', { name: 'Jobs' });
    const box = document.createElement('input');
    document.body.appendChild(box);
    press(KONAMI, box);
    await flush();
    expect(secrets()).toEqual([]);
    box.remove();
  });

  it('Play Off: nothing', async () => {
    const { secrets } = renderApp('off');
    await screen.findByRole('main', { name: 'Jobs' });
    press(KONAMI);
    await flush();
    expect(secrets()).toEqual([]);
    expect(document.documentElement).not.toHaveAttribute('data-theme', 'crt');
  });

  it('with the page’s keys turned off (Settings → Keys) it is off too; back on, it works again', async () => {
    const { secrets } = renderApp('subtle');
    await screen.findByRole('main', { name: 'Jobs' });
    writeKeysSetting({ enabled: false });
    press(KONAMI);
    await flush();
    expect(secrets()).toEqual([]);
    expect(document.documentElement).not.toHaveAttribute('data-theme', 'crt');
    writeKeysSetting({ enabled: true });
    press(KONAMI);
    await flush();
    expect(secrets()).toEqual(['konami']);
  });
});

describe('the console', () => {
  it('greets with the crew, and crew.hello() is a secret found', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { secrets } = renderApp('full');
    await screen.findByRole('main', { name: 'Jobs' });
    const crew = (window as { crew?: { hello: () => string } }).crew;
    expect(crew).toBeDefined();
    expect(crew!.hello()).toMatch(/teapot/);
    await flush();
    expect(secrets()).toEqual(['console']);
    log.mockRestore();
  });

  it('Play Off: no crew in the console', async () => {
    renderApp('off');
    await screen.findByRole('main', { name: 'Jobs' });
    expect((window as { crew?: unknown }).crew).toBeUndefined();
  });
});

describe('⌘K phrases', () => {
  const palette = (onEgg?: (e: string) => void) => {
    const onClose = vi.fn();
    render(<CommandPalette commands={[]} onClose={onClose} onEgg={onEgg} />);
    const box = screen.getByRole('combobox', { name: 'Search actions' });
    const type = (q: string) => { fireEvent.change(box, { target: { value: q } }); fireEvent.keyDown(box, { key: 'Enter' }); };
    return { onClose, type };
  };

  it('an exact phrase runs its egg and closes the palette', () => {
    const onEgg = vi.fn();
    const { onClose, type } = palette(onEgg);
    type('hammertime');
    expect(onEgg).toHaveBeenCalledWith('hammertime');
    expect(onClose).toHaveBeenCalled();
  });

  it('rm -rf /: the Locksmith’s door over the palette, then it closes', () => {
    vi.useFakeTimers();
    const onEgg = vi.fn();
    const { onClose, type } = palette(onEgg);
    type('rm -rf /');
    expect(onEgg).toHaveBeenCalledWith('rm-rf');
    expect(screen.getByRole('status')).toHaveTextContent('Hard line. Nice try.');
    expect(screen.getByRole('listbox', { hidden: true })).not.toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(DOOR_MS); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Play Off (no onEgg): a phrase is just a search with no match', () => {
    const { onClose, type } = palette(undefined);
    type('hammertime');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it('through the app: the scene plays with the toasts and the secret is found', async () => {
    const { secrets } = renderApp('subtle');
    await screen.findByRole('main', { name: 'Jobs' });
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    const box = screen.getByRole('combobox', { name: 'Search actions' });
    fireEvent.change(box, { target: { value: 'sudo make me a sandwich' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await flush();
    expect(secrets()).toEqual(['sandwich']);
    const scene = document.querySelector('[data-scene="sandwich"]')!;
    expect(scene).toHaveTextContent('Okay.');
    expect(scene.closest('.play-toasts')).not.toBeNull();
    // The scene's own keyframes move it once; its crew hold a still pose (no looping).
    expect(scene.querySelector('.crew.is-animated')).toBeNull();
  });
});

describe('not found', () => {
  it('Play on: the Sleuth looks for a #/ address that isn’t a page', async () => {
    window.location.hash = '#/nowhere';
    const { secrets } = renderApp('subtle');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Page not found' })).toHaveTextContent('#/nowhere');
    expect(screen.getByRole('img', { name: 'Sleuth, searching' })).not.toHaveClass('is-animated');
    expect(screen.getByRole('link', { name: 'Back to the Workshop' })).toHaveAttribute('href', '#/');
    await flush();
    expect(secrets()).toEqual(['sleuth-404']);
  });

  it('Play Off: the same view as #/', async () => {
    window.location.hash = '#/nowhere';
    const { secrets } = renderApp('off');
    expect(await screen.findByText('Pick a job on the left to see its conversation.')).toBeInTheDocument();
    expect(screen.queryByText('Page not found')).toBeNull();
    expect(secrets()).toEqual([]);
  });
});

describe('the Foreman, knocked on', () => {
  const alpha = job('alpha', 'idle');
  const face = () => document.querySelector('.foreman-knock')!;

  it('seven quick clicks: a one-liner with the toasts, and the secret', async () => {
    const { secrets } = inStore('subtle', <ForemanFace job={alpha} />);
    for (let i = 0; i < 6; i++) fireEvent.click(face());
    expect(document.querySelector('[data-scene="foreman"]')).toBeNull();
    fireEvent.click(face());
    await flush();
    expect(document.querySelector('[data-scene="foreman"]')).not.toBeNull();
    expect(secrets()).toEqual(['foreman-clicks']);
  });

  it('a pause between clicks starts the count again', () => {
    vi.useFakeTimers();
    inStore('subtle', <ForemanFace job={alpha} />);
    for (let i = 0; i < 6; i++) fireEvent.click(face());
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.click(face());
    expect(document.querySelector('[data-scene="foreman"]')).toBeNull();
  });

  it('a scene left when Play goes Off never comes back when it is turned on again', () => {
    const fake = fakeApi();
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: settings('subtle') }) });
    render(<WorkshopContext.Provider value={{ store, api: fake.api as unknown as ApiClient }}><ForemanFace job={alpha} /><PlayToasts /></WorkshopContext.Provider>);
    for (let i = 0; i < 7; i++) fireEvent.click(face());
    expect(document.querySelector('[data-scene="foreman"]')).not.toBeNull();
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: settings('off') }) }); });
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: settings('subtle') }) }); });
    expect(document.querySelector('[data-scene="foreman"]')).toBeNull();
  });

  it('the scene goes by itself', async () => {
    vi.useFakeTimers();
    inStore('full', <ForemanFace job={alpha} />);
    for (let i = 0; i < 7; i++) fireEvent.click(face());
    expect(document.querySelector('[data-scene="foreman"]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(SCENE_MS); });
    expect(document.querySelector('[data-scene="foreman"]')).toBeNull();
  });

  it('Play Off: no Foreman, nothing to knock on', () => {
    inStore('off', <ForemanFace job={alpha} />);
    expect(document.querySelector('.foreman-knock')).toBeNull();
  });
});

describe('a git push on a Friday afternoon', () => {
  const push: Permission = { id: 'p1', slug: 'alpha', kind: 'tool', toolName: 'Bash', input: { command: 'git push origin feat' }, plain: { headline: 'Push the branch' } };
  const FRI = new Date(2026, 9, 16, 16, 30);

  it('the Locksmith raises an eyebrow under the buttons; the decision is untouched', async () => {
    const { secrets } = inStore('subtle', <PermissionCard permission={push} now={FRI} />);
    const card = screen.getByRole('article', { name: 'Permission: Push the branch' });
    const note = within(card).getByText(/The Locksmith raises an eyebrow/);
    // After the buttons, never between you and them.
    const allow = within(card).getByRole('button', { name: 'Allow once' });
    expect(allow.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(allow).toBeEnabled();
    await flush();
    expect(secrets()).toEqual(['friday-push']);
  });

  it('nothing on a Thursday, or with Play Off', () => {
    inStore('subtle', <PermissionCard permission={push} now={new Date(2026, 9, 15, 17)} />);
    expect(screen.queryByText(/raises an eyebrow/)).toBeNull();
    const off = inStore('off', <PermissionCard permission={{ ...push, id: 'p2' }} now={FRI} />);
    expect(screen.queryByText(/raises an eyebrow/)).toBeNull();
    expect(off.secrets()).toEqual([]);
  });
});

describe('seasonal hats and nightcaps', () => {
  it('Halloween: witch hats, and the secret found once', async () => {
    setCrewClock(() => new Date(2026, 9, 31, 12));
    const { secrets } = inStore('subtle', <><CrewMember type="feature-tester" /><CrewMember type="conductor" /></>);
    expect(document.querySelectorAll('.hat-witch')).toHaveLength(2);
    await flush();
    expect(secrets()).toEqual(['seasonal-hats']);
  });

  it('after midnight: nightcaps, but no secret', async () => {
    setCrewClock(() => new Date(2026, 5, 17, 2));
    const { secrets } = inStore('subtle', <CrewMember type="feature-tester" />);
    expect(document.querySelector('.hat-nightcap')).not.toBeNull();
    await flush();
    expect(secrets()).toEqual([]);
  });

  it('an ordinary day: their own hats; a not-yet-met silhouette always keeps its own', () => {
    inStore('subtle', <CrewMember type="feature-tester" />);
    expect(document.querySelector('.hat')).toHaveAttribute('class', 'hat');
    setCrewClock(() => new Date(2026, 9, 31, 12));
    render(<CrewMember type="feature-tester" silhouette />);
    expect(document.querySelectorAll('.hat-witch')).toHaveLength(0);
  });
});
