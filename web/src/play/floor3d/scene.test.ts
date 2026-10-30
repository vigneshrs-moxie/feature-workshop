// The scene with real three.js geometry and a fake renderer (jsdom has no WebGL): it draws only
// while something moves, at most 30 frames a second, never while inactive, walks helpers in, and
// frees every geometry, material and texture, and the renderer, when it goes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Material, Mesh, Texture, type Object3D } from 'three';
import { floorLayout } from './layout';
import { derivePalette } from './palette';
import { createFloorScene } from './scene/index';
import { poseBenches } from './labFixtures';
import { sceneBenches, type RendererLike, type SceneBench } from './types';

function fakeRenderer() {
  const r = {
    scenes: [] as Object3D[],
    setPixelRatio: vi.fn(), setSize: vi.fn(), setClearColor: vi.fn(),
    render: vi.fn((scene: Object3D) => { r.scenes.push(scene); }),
    dispose: vi.fn(), forceContextLoss: vi.fn(),
    shadowMap: { enabled: false, type: null as unknown },
  };
  return r;
}

let clock = 0;
let queue: (() => void)[] = [];
const tick = (ms = 40) => { clock += ms; const q = queue; queue = []; q.forEach((cb) => cb()); };

function make(reducedMotion = false) {
  const renderer = fakeRenderer();
  const scene = createFloorScene(document.createElement('canvas'), {
    palette: derivePalette({}, 'dark'),
    reducedMotion,
    makeRenderer: () => renderer as unknown as RendererLike,
    now: () => clock,
    requestFrame: (cb) => { queue.push(cb); return queue.length; },
    cancelFrame: () => { queue = []; },
  });
  return { renderer, scene };
}

const benches = (n = 4): SceneBench[] => sceneBenches(poseBenches().slice(0, n));

beforeEach(() => { clock = 1000; queue = []; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the floor scene', () => {
  it('caps the pixel ratio at 2 and sizes the renderer to the layout', () => {
    const { renderer, scene } = make();
    const layout = floorLayout(1200, 4);
    scene.setLayout(layout, 3);
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(2);
    expect(renderer.setSize).toHaveBeenCalledWith(layout.width, layout.height, false);
    scene.dispose();
  });

  it('draws the benches and figures, and says where their words go', () => {
    const { renderer, scene } = make();
    const anchors = vi.fn();
    scene.onFrame(anchors);
    scene.setLayout(floorLayout(1200, 4), 1);
    scene.setBenches(benches(4));
    tick();
    expect(renderer.render).toHaveBeenCalled();
    const a = anchors.mock.calls.at(-1)?.[0];
    expect(a.benches).toHaveLength(4);
    expect(a.figures).toHaveLength(4 + 2 + 4 + 2);
    for (const f of a.figures) { expect(f.rect.width).toBeGreaterThan(0); expect(f.rect.height).toBeGreaterThan(0); }
    expect(scene.stats().benches).toBe(4);
    expect(scene.stats().figures).toBe(12);
    scene.dispose();
  });

  it('draws at most 30 frames a second', () => {
    const { renderer, scene } = make();
    scene.setLayout(floorLayout(1200, 1), 1);
    scene.setBenches(benches(1));
    scene.setBusy(true);
    tick(40);
    const n = renderer.render.mock.calls.length;
    tick(10);
    expect(renderer.render.mock.calls.length).toBe(n);
    tick(30);
    expect(renderer.render.mock.calls.length).toBe(n + 1);
    scene.dispose();
  });

  it('stops drawing when nothing moves, and sleeps until the next burst', () => {
    const { renderer, scene } = make(true);
    scene.setLayout(floorLayout(1200, 2), 1);
    scene.setBenches(benches(2));
    tick();
    const n = renderer.render.mock.calls.length;
    for (let i = 0; i < 5; i++) tick();
    expect(renderer.render.mock.calls.length).toBe(n);
    expect(queue).toHaveLength(0);
    scene.dispose();
  });

  it('draws nothing while inactive (tab hidden, scrolled away)', () => {
    const { renderer, scene } = make();
    scene.setLayout(floorLayout(1200, 1), 1);
    scene.setActive(false);
    scene.setBenches(benches(1));
    tick(); tick();
    expect(renderer.render).not.toHaveBeenCalled();
    scene.setActive(true);
    tick();
    expect(renderer.render).toHaveBeenCalled();
    scene.dispose();
  });

  it('walks a new helper in from the door, and not with reduced motion', () => {
    for (const reduced of [false, true]) {
      const { scene } = make(reduced);
      const anchors = vi.fn();
      scene.onFrame(anchors);
      const layout = floorLayout(1200, 1);
      scene.setLayout(layout, 1);
      const [b] = benches(1);
      scene.setBenches([{ ...b, figures: b.figures.slice(0, 1) }]);
      tick();
      scene.setBenches([b]);
      tick(40);
      const fig = anchors.mock.calls.at(-1)?.[0].figures.find((f: { key: string }) => f.key === b.figures[1].key);
      const seat = anchors.mock.calls.at(-1)?.[0].figures.find((f: { key: string }) => f.key === b.figures[0].key);
      // Walking: still near the door (top left), far from its spot at the bench.
      if (!reduced) expect(fig.rect.top).toBeLessThan(seat.rect.top);
      else expect(fig.rect.top).toBeLessThan(seat.rect.top + 80);
      scene.dispose();
    }
  });

  it('frees every geometry, material and texture, and the renderer, when it goes', () => {
    const disposed = new Set<unknown>();
    for (const proto of [BufferGeometry.prototype, Material.prototype, Texture.prototype]) {
      const real = proto.dispose;
      vi.spyOn(proto, 'dispose').mockImplementation(function (this: unknown) { disposed.add(this); return real.call(this); });
    }
    const { renderer, scene } = make();
    scene.setLayout(floorLayout(1200, 4), 1);
    scene.setBenches(benches(4));
    scene.setLayout(floorLayout(900, 4), 1);
    tick();
    const used = new Set<unknown>();
    renderer.scenes.at(-1)?.traverse((o) => {
      if (o instanceof Mesh) {
        used.add(o.geometry);
        for (const m of [o.material].flat()) { used.add(m); if ((m as { alphaMap?: Texture }).alphaMap) used.add((m as { alphaMap?: Texture }).alphaMap); }
      }
    });
    expect(used.size).toBeGreaterThan(40);
    scene.dispose();
    for (const u of used) expect(disposed.has(u)).toBe(true);
    expect(renderer.dispose).toHaveBeenCalled();
    expect(renderer.forceContextLoss).toHaveBeenCalled();
    // Nothing more is drawn after.
    scene.setBenches(benches(1));
    tick();
    expect(queue).toHaveLength(0);
  });
});
