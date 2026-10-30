// The 3D floor in its host (play/WorkshopFloor.tsx): Play full draws it, Play subtle and Play off
// never load it; without WebGL (or if it fails to load) the 2D cards show with the same words;
// "Show as a list" swaps it for plain words; clicking a bench opens the job; reduced motion holds
// still. The scene itself is mocked (jsdom has no WebGL).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job, PlayMode } from '../../api/types';
import { ForemanPane } from '../../panes/Foreman/ForemanPane';
import { createStore, WorkshopContext } from '../../state/store';
import { job, LEVELS, permission, snapshot } from '../../state/test-fixtures';
import { Floor3D, FLOOR_VIEW_KEY } from './Floor3D';
import { loadScene } from './loadScene';
import type { FloorBench, FloorScene } from './types';
import { setWebGLForTests } from './webgl';
import { installKeyListener } from '../../app/keyRegistry';

let uninstall: (() => void) | null = null;
const installKeys = () => { uninstall ??= installKeyListener(); };
afterEach(() => { uninstall?.(); uninstall = null; });

vi.mock('./loadScene', () => ({ loadScene: vi.fn() }));

function fakeScene(): FloorScene {
  return {
    setLayout: vi.fn(), setBenches: vi.fn(), setPalette: vi.fn(), setReducedMotion: vi.fn(), setHover: vi.fn(), setPointer: vi.fn(),
    zoomAt: vi.fn(), fitAll: vi.fn(), zoomed: vi.fn(() => false), setActive: vi.fn(), onFrame: vi.fn(), setBusy: vi.fn(),
    stats: vi.fn(() => ({ frames: 0, avgMs: 0, p95Ms: 0, maxMs: 0, fps: 0, figures: 0, benches: 0 })), dispose: vi.fn(),
  };
}

let scene: FloorScene;
let create: ReturnType<typeof vi.fn>;
const NOW = new Date(2026, 9, 16, 15, 0);
const JOBS: Job[] = [
  job('busy', 'running', { title: 'Bulk archive', stage: 'implement', nowDoing: [{ who: 'feature-implementer', doing: 'Reading archive.ts' }] }),
  job('ask', 'needs-you', { title: 'Customer notes', stage: 'plan', waitingFor: 'approval', waitingSince: new Date(2026, 9, 16, 14, 25).toISOString() }),
];

function floor(mode: PlayMode) {
  const store = createStore();
  const snap = snapshot({ jobs: JOBS, meta: { token: 't', levels: LEVELS, settings: { policy: 'hands-off', play: { mode, questDone: 'first-pr', sounds: false } } } });
  snap.permissions = [permission('p1', 'ask')];
  store.dispatch({ type: 'snapshot', snapshot: snap });
  return render(<WorkshopContext.Provider value={{ store, api: { get: vi.fn(), post: vi.fn() } as unknown as ApiClient }}><ForemanPane slug={null} /></WorkshopContext.Provider>);
}

const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  width.mockReturnValue(1200);
  scene = fakeScene();
  create = vi.fn(() => scene);
  vi.mocked(loadScene).mockReset().mockResolvedValue({ createFloorScene: create } as never);
  setWebGLForTests(true);
});
afterEach(() => { vi.useRealTimers(); localStorage.clear(); setWebGLForTests(null); window.location.hash = ''; });

describe('the 3D floor in the workshop floor', () => {
  it('loads no 3D in Play subtle: the cards show as before', () => {
    floor('subtle');
    expect(loadScene).not.toHaveBeenCalled();
    expect(document.querySelector('.floor3d')).toBeNull();
    expect(screen.getByRole('region', { name: 'On the floor' })).toHaveTextContent('Bulk archive');
  });

  it('loads no 3D with Play off', () => {
    floor('off');
    expect(loadScene).not.toHaveBeenCalled();
    expect(document.querySelector('.floor3d')).toBeNull();
  });

  it('draws the floor in Play full, every bench with its words', async () => {
    floor('full');
    expect(loadScene).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(create).toHaveBeenCalled());
    const region = screen.getByRole('region', { name: 'The workshop floor' });
    expect(within(region).getByRole('link', { name: 'Bulk archive' })).toBeInTheDocument();
    expect(region).toHaveTextContent('Builder · reading archive.ts');
    // Its permission is the Foreman's own: it holds up its card.
    expect(region).toHaveTextContent('Foreman · asks to run a command');
    expect(region).toHaveTextContent('Go-ahead');
    await waitFor(() => expect(scene.setBenches).toHaveBeenCalled());
    const benches = vi.mocked(scene.setBenches).mock.calls.at(-1)?.[0] ?? [];
    expect(benches.map((b) => b.slug).sort()).toEqual(['ask', 'busy']);
    // The canvas is decoration for screen readers: the words are the floor.
    expect(region.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
  });

  it('reads the theme again once the scene is up, so a theme put on meanwhile is never missed (packet X)', async () => {
    floor('full');
    await waitFor(() => expect(create).toHaveBeenCalled());
    // Gold, say, is put on when the play ledger arrives: before the watch on the theme starts.
    await waitFor(() => expect(scene.setPalette).toHaveBeenCalled());
  });

  it('shows the cards with the same words when the browser can’t draw 3D', () => {
    setWebGLForTests(false);
    floor('full');
    expect(loadScene).not.toHaveBeenCalled();
    const region = screen.getByRole('region', { name: 'The workshop floor' });
    expect(region).toHaveTextContent('This browser can’t draw the 3D floor, so the jobs show as cards');
    expect(region.querySelector('.floor-grid')).toHaveTextContent('Bulk archive');
  });

  it('falls back to the cards when the 3D fails to load', async () => {
    vi.mocked(loadScene).mockRejectedValue(new Error('chunk failed'));
    floor('full');
    await waitFor(() => expect(document.querySelector('.floor3d.is-flat .floor-grid')).not.toBeNull());
  });

  it('frees the scene when the floor goes', async () => {
    const r = floor('full');
    await waitFor(() => expect(create).toHaveBeenCalled());
    r.unmount();
    expect(scene.dispose).toHaveBeenCalled();
  });
});

const BENCHES: FloorBench[] = [{
  slug: 'merge', index: 0, title: 'Customer merge', lamp: 'running', glyph: '◐', status: 'Working', stop: 'Build', hue: 'build', more: 2,
  figures: [
    { key: 'merge:conductor:0', who: 'conductor', role: 'Foreman', prop: 'clipboard', hue: 'build', pose: 'watching', seat: 'head', progress: null, label: 'Foreman · watching the Builder' },
    { key: 'merge:feature-implementer:0', who: 'feature-implementer', role: 'Builder', prop: 'hammer', hue: 'build', pose: 'editing', seat: 0, progress: null, label: 'Builder · editing merge.ts' },
  ],
}];

describe('<Floor3D>', () => {
  it('opens the job when its bench is picked', async () => {
    const open = vi.fn();
    render(<Floor3D benches={BENCHES} onOpenJob={open} />);
    fireEvent.click(screen.getByRole('link', { name: 'Customer merge' }));
    expect(open).toHaveBeenCalledWith('merge');
    await waitFor(() => expect(create).toHaveBeenCalled());
    fireEvent.click(document.querySelector('.floor3d-cell') as Element);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('gives each figure its words on hover', async () => {
    render(<Floor3D benches={BENCHES} onOpenJob={vi.fn()} />);
    await waitFor(() => expect(document.querySelectorAll('.floor3d-hit')).toHaveLength(2));
    // The words go to the app's own tooltip (components/Tooltip.tsx draws every data-tip).
    expect(document.querySelector('.floor3d-hit')).toHaveAttribute('data-tip', 'Foreman · watching the Builder');
    fireEvent.pointerEnter(document.querySelectorAll('.floor3d-hit')[1]);
    await waitFor(() => expect(scene.setHover).toHaveBeenLastCalledWith('merge:feature-implementer:0'));
    expect(document.querySelector('.floor3d-line.is-hover')).toHaveTextContent('Builder · editing merge.ts');
  });

  it('switches to a plain list and remembers it', async () => {
    const r = render(<Floor3D benches={BENCHES} onOpenJob={vi.fn()} />);
    await waitFor(() => expect(create).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Show as a list' }));
    const list = screen.getByRole('list', { name: 'The floor, bench by bench' });
    expect(list).toHaveTextContent('Customer merge');
    expect(list).toHaveTextContent('Build');
    expect(list).toHaveTextContent('Builder · editing merge.ts');
    expect(list).toHaveTextContent('and 2 more helpers at work');
    expect(scene.dispose).toHaveBeenCalled();
    expect(localStorage.getItem(FLOOR_VIEW_KEY)).toBe('list');
    r.unmount();
    render(<Floor3D benches={BENCHES} onOpenJob={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Show the floor' })).toBeInTheDocument();
  });

  it('holds every figure still with reduced motion', async () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    try {
      render(<Floor3D benches={BENCHES} onOpenJob={vi.fn()} />);
      await waitFor(() => expect(create).toHaveBeenCalled());
      expect(create.mock.calls[0][1]).toMatchObject({ reducedMotion: true });
      await act(async () => {});
      expect(scene.setReducedMotion).toHaveBeenLastCalledWith(true);
    } finally { window.matchMedia = real; }
  });

  it('zooms only with a pinch or ⌘ and scroll, and offers Fit all once zoomed', async () => {
    render(<Floor3D benches={BENCHES} onOpenJob={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('.floor3d-stage.is-ready')).not.toBeNull());
    const stage = document.querySelector('.floor3d-stage') as Element;
    fireEvent.wheel(stage, { deltaY: -100 });
    expect(scene.zoomAt).not.toHaveBeenCalled();
    vi.mocked(scene.zoomed).mockReturnValue(true);
    fireEvent.wheel(stage, { deltaY: -100, ctrlKey: true });
    expect(scene.zoomAt).toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('.floor3d-btn.is-idle')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Fit all' }));
    expect(scene.fitAll).toHaveBeenCalled();
  });

  it('answers the floor’s keys only when asked: j and k pick a bench, Enter opens it, Esc puts it down', async () => {
    const two: FloorBench[] = [BENCHES[0], { ...BENCHES[0], slug: 'notes', index: 1, title: 'Customer notes', figures: [] }];
    const open = vi.fn();
    const { unmount } = render(<Floor3D benches={two} onOpenJob={open} keys />);
    await waitFor(() => expect(create).toHaveBeenCalled());
    const key = (k: string) => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
    installKeys();
    key('j');
    expect(document.querySelector('.floor3d-cell.is-picked')).not.toBeNull();
    expect(document.querySelector('.floor3d-plate.is-picked')).toHaveTextContent('Customer merge');
    key('j');
    expect(document.querySelector('.floor3d-plate.is-picked')).toHaveTextContent('Customer notes');
    key('Enter');
    expect(open).toHaveBeenCalledWith('notes');
    key('Escape');
    expect(document.querySelector('.floor3d-plate.is-picked')).toBeNull();
    // The arrows work with the focus on the floor itself.
    const stage = screen.getByRole('group', { name: /The floor/ });
    fireEvent.keyDown(stage, { key: 'ArrowRight' });
    expect(document.querySelector('.floor3d-plate.is-picked')).toHaveTextContent('Customer merge');
    unmount();
    // Without keys (the floor lab, the workshop floor) j does nothing here.
    render(<Floor3D benches={two} onOpenJob={open} />);
    key('j');
    expect(document.querySelector('.floor3d-cell.is-picked')).toBeNull();
    expect(screen.queryByRole('group', { name: /The floor/ })).toBeNull();
  });

  it('shows the quick look’s job as picked', async () => {
    render(<Floor3D benches={BENCHES} onOpenJob={vi.fn()} keys current="merge" />);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(document.querySelector('.floor3d-plate.is-picked')).toHaveTextContent('Customer merge');
  });
});
