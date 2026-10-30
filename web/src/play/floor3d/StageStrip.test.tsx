// The Stage strip: this job's bench at one stop, in a fixed 220 px band (the scene mocked: jsdom has
// no WebGL), with the Stage's own crew rows as its figures and their words beside it; it folds to
// one line of the same words, remembered, and then loads no 3D.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { StageAgent } from '../../api/types';
import { createStore, WorkshopContext } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { loadScene } from './loadScene';
import { StageStrip, STRIP_FOLD_KEY } from './StageStrip';
import { stripLayout, STRIP_PX } from './layout';
import { stageBench } from './model';
import type { FloorScene } from './types';
import { setWebGLForTests } from './webgl';

vi.mock('./loadScene', () => ({ loadScene: vi.fn() }));

const scene = (): FloorScene => ({
  setLayout: vi.fn(), setBenches: vi.fn(), setPalette: vi.fn(), setReducedMotion: vi.fn(), setHover: vi.fn(), setPointer: vi.fn(),
  zoomAt: vi.fn(), fitAll: vi.fn(), zoomed: vi.fn(() => false), setActive: vi.fn(), onFrame: vi.fn(), setBusy: vi.fn(),
  stats: vi.fn(() => ({ frames: 0, avgMs: 0, p95Ms: 0, maxMs: 0, fps: 0, figures: 0, benches: 0 })), dispose: vi.fn(),
});

const J = job('route', 'running', { title: 'Route optimizer', stage: 'review', nowDoing: [{ who: 'conductor', doing: 'Sending work to feature-reviewer' }] });
const agent = (who: string, doing: string, status: StageAgent['status']): StageAgent => ({ who, role: '', model: null, doing, since: null, lastAt: null, status, terminal: { kind: 'watch', ready: true, why: null }, ref: who });
const AGENTS = [agent('conductor', 'Sending work to feature-reviewer', 'working'), agent('feature-reviewer', 'Reading plan.ts', 'working'), agent('feature-review-db', 'Finished', 'done')];

function strip(agents: StageAgent[] | null = AGENTS) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [J], meta: { token: 't', settings: { play: { mode: 'full' } } } as never }) });
  return render(<WorkshopContext.Provider value={{ store, api: { get: vi.fn(), post: vi.fn() } as unknown as ApiClient }}><StageStrip job={J} stop="review" agents={agents} /></WorkshopContext.Provider>);
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.mocked(loadScene).mockReset().mockResolvedValue({ createFloorScene: () => scene() } as never);
  setWebGLForTests(true);
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); setWebGLForTests(null); });

describe('the Stage strip', () => {
  it('is one bench in a band 220 px tall, the words beside the bench', () => {
    const l = stripLayout(1200);
    expect(l.height).toBe(STRIP_PX);
    expect(l.benches).toHaveLength(1);
    const [b] = l.benches;
    expect(b.plate.left).toBeGreaterThanOrEqual(b.cell.left + b.cell.width);
    expect(stripLayout(390).height).toBe(STRIP_PX);
  });

  it('seats the crew the Stage lists at this stop (not the ones done), in the stop’s hue', () => {
    const b = stageBench(J, 'review', AGENTS, { now: new Date() });
    expect(b.figures.map((f) => [f.role, f.label])).toEqual([['Foreman', 'Foreman · sending work to the Reviewer'], ['Reviewer', 'Reviewer · reading plan.ts']]);
    expect(b).toMatchObject({ hue: 'review', stop: 'Review' });
  });

  it('draws the bench with its words, and folds to one line that loads no 3D', async () => {
    strip();
    const band = screen.getByRole('region', { name: 'The bench at this stop' });
    expect(band).toHaveTextContent('Reviewer · reading plan.ts');
    await waitFor(() => expect(loadScene).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Fold' }));
    expect(localStorage.getItem(STRIP_FOLD_KEY)).toBe('folded');
    expect(document.querySelector('.stage-strip.is-folded')).toHaveTextContent('Foreman · sending work to the Reviewer');
    expect(document.querySelector('.floor3d')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the bench' }));
    expect(document.querySelector('.floor3d')).not.toBeNull();
  });

  it('shows the job card’s own lines until the Stage answers', () => {
    strip(null);
    expect(screen.getByRole('region', { name: 'The bench at this stop' })).toHaveTextContent('Foreman · sending work to the Reviewer');
  });
});
