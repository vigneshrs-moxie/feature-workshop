// The 3D floor's scene: the one renderer, the camera, the benches and their figures, the frame
// loop. This module (with kit.ts) is the only code that imports three.js, and it is only ever
// loaded with import() from ../loadScene.ts, so three.js sits in its own chunk that loads the
// first time the floor shows in Play full.
//
// Drawing: only while something moves, at most 30 frames a second; between the figures' bursts it
// sleeps until the next one is due; nothing at all while setActive(false) (the tab is hidden or the
// floor is out of view). The pixel ratio is capped at 2. dispose() frees every geometry, material,
// texture and the renderer.
import { Group, Mesh, OrthographicCamera, PCFShadowMap, SRGBColorSpace, Scene, Vector3, WebGLRenderer } from 'three';
import type { FloorLayout, Seat } from '../layout';
import { aroundPath, frustum, seatSpot } from '../layout';
import type { Pose, Rig } from '../rig';
import { changeRig, isSeated, nextBurstIn, burstAt, phaseOf, pointAt, poseRig, rigAt, transitionMs, walkMs, walkPath, walkRig, LOOPS, pathLength } from '../rig';
import type { FloorAnchors, FloorScene, FloorSceneOptions, FrameStats, PropId, RendererLike, SceneBench, SceneFigure } from '../types';
import type { StopHue } from '../palette';
import { FIGURE, HEAD_Y, createKit, type BenchParts, type FigureParts } from './kit';

const FRAME_MS = 1000 / 30;
const ZOOM_MIN = 1;
const ZOOM_MAX = 2.5;
const PARALLAX_YAW = 0.022;
const PARALLAX_PITCH = 0.014;

interface Walk { path: { x: number; z: number }[]; start: number; ms: number; out: boolean }

interface FigureView {
  key: string;
  slug: string;
  prop: PropId;
  pose: Pose;
  seat: Seat;
  hue: StopHue;
  helpers: number;
  progress: number | null;
  phase: number;
  parts: FigureParts;
  rig: Rig;
  from: Rig;
  fromPose: Pose | null;
  changeStart: number;
  changeMs: number;
  walk: Walk | null;
  hover: number;
}

interface BenchView { slug: string; index: number; hue: StopHue | null; parts: BenchParts; figures: Map<string, FigureView> }

function makeRenderer(canvas: HTMLCanvasElement): RendererLike {
  const r = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'default' });
  r.outputColorSpace = SRGBColorSpace;
  return r as unknown as RendererLike;
}

export function createFloorScene(canvas: HTMLCanvasElement, opts: FloorSceneOptions): FloorScene {
  const now = opts.now ?? (() => performance.now());
  const requestFrame = opts.requestFrame ?? ((cb) => requestAnimationFrame(cb));
  const cancelFrame = opts.cancelFrame ?? ((id) => cancelAnimationFrame(id));
  const renderer = (opts.makeRenderer ?? makeRenderer)(canvas);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  let palette = opts.palette;
  let reduced = opts.reducedMotion;
  const kit = createKit(palette, opts.icons);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 0, -1, 0.1, 200);
  const { hemi, sun, rim } = kit.lights();
  sun.castShadow = true;
  const sunShadow = sun.shadow;
  sunShadow.bias = -0.0006;
  sunShadow.normalBias = 0.025;
  sunShadow.radius = 5;
  scene.add(hemi, sun, sun.target, rim, rim.target);

  let layout: FloorLayout | null = null;
  let room: Group | null = null;
  const benches = new Map<string, BenchView>();
  const leaving = new Set<FigureView>();
  const pivot = new Vector3();
  let hoverKey: string | null = null;
  let active = true;
  let busy = false;
  let disposed = false;
  let frameId: number | null = null;
  let wakeId: ReturnType<typeof setTimeout> | null = null;
  let lastFrame = -Infinity;
  let listener: ((a: FloorAnchors) => void) | null = null;
  // The view: zoom about a point (px, at rest), and the parallax (eased toward the pointer).
  const view = { zoom: 1, ox: 0, oy: 0 };
  let zoomAnim: { from: typeof view; to: typeof view; start: number; ms: number } | null = null;
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  // Frame timings, for stats().
  let samples: number[] = [];
  let frameTimes: number[] = [];

  // ---------- The camera ----------

  function placeCamera() {
    if (!layout) return;
    const f = frustum(layout);
    const ppu = layout.ppu;
    const zMid = (layout.back + layout.front) / 2;
    pivot.set(0, 0, zMid);
    const s = Math.sin(layout.elevation);
    // The pivot's place in the view at rest: x 0 (the middle), y its height from the top.
    const pivotSy = zMid * s;
    const w = (f.right - f.left) / view.zoom;
    const h = (f.top - f.bottom) / view.zoom;
    camera.left = f.left + view.ox / ppu;
    camera.right = camera.left + w;
    camera.top = pivotSy - view.oy / ppu;
    camera.bottom = camera.top - h;
    const el = layout.elevation + tilt.y * PARALLAX_PITCH;
    const az = tilt.x * PARALLAX_YAW;
    const d = 60;
    camera.position.set(pivot.x + d * Math.cos(el) * Math.sin(az), d * Math.sin(el), pivot.z + d * Math.cos(el) * Math.cos(az));
    camera.up.set(0, 1, 0);
    camera.lookAt(pivot);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function placeSun() {
    if (!layout) return;
    const cx = (layout.left + layout.right) / 2;
    const cz = (layout.back + layout.front) / 2;
    sun.position.set(cx - 5, 10, cz + 4.5);
    sun.target.position.set(cx, 0, cz);
    sun.target.updateMatrixWorld();
    // The rim: from behind and to the right, low, so it catches the figures' shoulders and heads.
    rim.position.set(cx + 4, 5, cz - 9);
    rim.target.position.set(cx, 0.4, cz);
    rim.target.updateMatrixWorld();
    const span = Math.max(layout.right - layout.left, layout.front - layout.back) / 2 + 2;
    const cam = sunShadow.camera as OrthographicCamera;
    cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
    cam.near = 0.5; cam.far = 40;
    cam.updateProjectionMatrix();
    const size = layout.mode === 'column' ? 1024 : 2048;
    if (sunShadow.mapSize.x !== size) {
      sunShadow.mapSize.set(size, size);
      sunShadow.map?.dispose();
      sunShadow.map = null;
    }
  }

  // ---------- Benches and figures ----------

  function benchSpot(index: number) {
    return layout?.benches[index] ?? null;
  }

  function placeBench(b: BenchView) {
    const spot = benchSpot(b.index);
    b.parts.group.visible = Boolean(spot);
    if (!spot) return;
    b.parts.group.position.set(spot.x, 0, spot.z);
    for (const f of b.figures.values()) placeFigure(b, f);
  }

  function seatWorld(b: BenchView, f: FigureView) {
    const spot = benchSpot(b.index);
    const s = seatSpot(f.seat, f.helpers);
    return { x: (spot?.x ?? 0) + s.x, z: (spot?.z ?? 0) + s.z, yawBench: s.yawBench };
  }

  function placeFigure(b: BenchView, f: FigureView) {
    const w = seatWorld(b, f);
    f.parts.anchor.position.set(w.x, 0, w.z);
    f.parts.items.rotation.y = w.yawBench;
    // The Foreman stands off the bench's end: its things go a little further onto the bench.
    f.parts.items.position.set(f.seat === 'head' ? 0.16 : 0, 0, 0);
  }

  function newFigure(b: BenchView, fig: SceneFigure, helpers: number, t: number): FigureView {
    const parts = kit.makeFigure(fig.prop, fig.hue);
    kit.raiseHand(parts, fig.pose === 'waiting');
    const rig = rigAt(fig.pose, fig.seat, helpers, t, phaseOf(fig.key), animated(), fig.progress);
    const f: FigureView = {
      key: fig.key, slug: b.slug, prop: fig.prop, pose: fig.pose, seat: fig.seat, hue: fig.hue, helpers, progress: fig.progress,
      phase: phaseOf(fig.key), parts, rig, from: rig, fromPose: fig.pose, changeStart: -Infinity, changeMs: 0, walk: null, hover: 0,
    };
    placeFigure(b, f);
    scene.add(parts.anchor);
    applyRig(f, rig);
    return f;
  }

  const animated = () => !reduced;

  function aisleZ(b: BenchView) {
    const spot = benchSpot(b.index);
    return (spot?.z ?? 0) + 1.32;
  }

  function startWalk(b: BenchView, f: FigureView, out: boolean, t: number) {
    if (!layout) return;
    const w = seatWorld(b, f);
    const path = walkPath(layout.door, { x: w.x, z: w.z }, aisleZ(b));
    const p = out ? [...path].reverse() : path;
    f.walk = { path: p, start: t, ms: walkMs(p), out };
  }

  function setBenches(list: readonly SceneBench[]) {
    const t = now();
    const first = benches.size === 0;
    const seen = new Set<string>();
    for (const sb of list) {
      seen.add(sb.slug);
      let b = benches.get(sb.slug);
      const fresh = !b;
      if (!b) {
        const parts = kit.makeBench();
        b = { slug: sb.slug, index: sb.index, hue: null, parts, figures: new Map() };
        benches.set(sb.slug, b);
        scene.add(parts.group);
      }
      b.index = sb.index;
      if (b.hue !== sb.hue) { b.hue = sb.hue; kit.hueBench(b.parts, sb.hue); }
      placeBench(b);
      const helpers = sb.figures.filter((x) => x.seat !== 'head').length;
      const keep = new Set<string>();
      for (const fig of sb.figures) {
        keep.add(fig.key);
        let f = b.figures.get(fig.key);
        if (!f) {
          f = newFigure(b, fig, helpers, t);
          b.figures.set(fig.key, f);
          // A helper that starts while you watch walks in from the door.
          if (!first && !fresh && fig.seat !== 'head' && animated()) startWalk(b, f, false, t);
          continue;
        }
        if (f.hue !== fig.hue) { f.hue = fig.hue; kit.hueFigure(f.parts, fig.hue); }
        const reseat = f.seat !== fig.seat || f.helpers !== helpers;
        f.seat = fig.seat;
        f.helpers = helpers;
        f.progress = fig.progress;
        if (reseat) placeFigure(b, f);
        if (f.pose !== fig.pose || reseat) {
          const sitChange = isSeated(f.pose) !== isSeated(fig.pose);
          f.from = f.rig;
          f.fromPose = f.pose;
          f.pose = fig.pose;
          kit.raiseHand(f.parts, fig.pose === 'waiting');
          f.changeStart = t;
          f.changeMs = animated() ? transitionMs(f.fromPose, fig.pose) : 0;
          // A helper sitting down walks round the bench's end to its crate in front (and back).
          if (sitChange && fig.seat !== 'head' && animated() && !f.walk) {
            const w = seatWorld(b, f);
            const p = aroundPath({ x: w.x, z: w.z }, isSeated(fig.pose));
            f.walk = { path: p, start: t, ms: walkMs(p), out: false };
          }
        }
      }
      // A helper that finished walks out (and is gone at once with reduced motion).
      for (const [key, f] of b.figures) {
        if (keep.has(key)) continue;
        b.figures.delete(key);
        if (animated() && f.seat !== 'head' && layout) {
          f.from = f.rig;
          startWalk(b, f, true, t);
          leaving.add(f);
        } else removeFigure(f);
      }
    }
    for (const [slug, b] of benches) {
      if (seen.has(slug)) continue;
      for (const f of b.figures.values()) removeFigure(f);
      scene.remove(b.parts.group);
      benches.delete(slug);
    }
    wake();
  }

  function removeFigure(f: FigureView) {
    scene.remove(f.parts.anchor);
    leaving.delete(f);
  }

  // ---------- Copying a rig onto the parts ----------

  const show = (o: { visible: boolean; scale: { setScalar(n: number): void } }, k: number) => {
    o.visible = k > 0.01;
    o.scale.setScalar(Math.max(0.001, Math.min(1, k)));
  };

  function applyRig(f: FigureView, r: Rig) {
    const p = f.parts;
    p.root.rotation.y = r.yaw;
    const hoverLift = f.hover * 0.035;
    p.root.position.x = r.dx;
    p.root.position.z = r.dz;
    p.body.position.y = r.lift + hoverLift;
    p.body.rotation.set(r.lean, 0, r.roll);
    p.torso.scale.set(1, r.squash, 1);
    p.headPivot.position.y = HEAD_Y * r.squash;
    p.headPivot.rotation.set(r.headNod, r.headTurn, r.headTilt, 'YXZ');
    p.handL.position.set(r.handL[0], r.handL[1] * (r.handL[1] > 0.5 ? 1 : r.squash), r.handL[2]);
    p.handR.position.set(r.handR[0], r.handR[1] * (r.handR[1] > 0.5 ? 1 : r.squash), r.handR[2]);
    p.handL.rotation.z = r.wave * 0.3;
    p.prop.rotation.set(r.propPitch, 0, r.propRoll);
    show(p.sheet, r.sheet);
    show(p.card, r.card);
    show(p.crate, r.crate);
    show(p.sign, r.sign);
    show(p.clock, r.clock);
    show(p.device, r.device);
    show(p.workpiece, r.workpiece);
    show(p.stack, r.stack);
    p.crank.rotation.x = r.crank;
    const lit = Math.round(r.lampFill * p.lamps.length);
    p.lamps.forEach((m, i) => { m.material = kit.deviceLamp(i < lit); });
    // The contact shadow stays on the floor and spreads a little when it sits.
    p.blob.position.y = 0.004 - r.lift - hoverLift;
    p.blob.scale.setScalar(1 + r.crate * 0.25);
  }

  /** Moves every figure to time t. Whether anything is still moving. */
  function step(t: number): boolean {
    let moving = false;
    for (const b of benches.values()) {
      for (const f of b.figures.values()) moving = stepFigure(f, t) || moving;
    }
    for (const f of leaving) moving = stepFigure(f, t) || moving;
    return moving;
  }

  function stepFigure(f: FigureView, t: number): boolean {
    let moving = false;
    const hoverTo = hoverKey === f.key ? 1 : 0;
    if (f.hover !== hoverTo) {
      f.hover = reduced ? hoverTo : Math.abs(hoverTo - f.hover) < 0.05 ? hoverTo : f.hover + (hoverTo - f.hover) * 0.35;
      moving = true;
    }
    let r: Rig;
    if (f.walk) {
      const w = f.walk;
      const u = (t - w.start) / w.ms;
      if (u >= 1) {
        f.walk = null;
        if (w.out) { removeFigure(f); return true; }
        // Arrived: settle into its pose.
        f.from = walkRig(poseRig('idle', f.seat, f.helpers), t, pointAt(w.path, pathLength(w.path)).yaw);
        f.fromPose = 'idle';
        f.changeStart = t;
        f.changeMs = 300;
        r = f.from;
      } else {
        const at = pointAt(w.path, u * pathLength(w.path));
        const seat = f.parts.anchor.position;
        r = { ...walkRig(poseRig('idle', f.seat, f.helpers), t - w.start, at.yaw), dx: at.x - seat.x, dz: at.z - seat.z };
      }
      moving = true;
    } else {
      const target = rigAt(f.pose, f.seat, f.helpers, t, f.phase, animated() || busy, f.progress);
      const u = f.changeMs > 0 ? (t - f.changeStart) / f.changeMs : 1;
      if (u < 1) { r = changeRig(f.from, target, f.pose, u); moving = true; } else r = target;
      if ((animated() || busy) && LOOPS[f.pose] && (busy || burstAt(f.pose, t, f.phase) >= 0)) moving = true;
    }
    f.rig = r;
    applyRig(f, r);
    return moving;
  }

  // ---------- The frame loop ----------

  function wake() {
    if (disposed || !active || !layout) return;
    if (wakeId !== null) { clearTimeout(wakeId); wakeId = null; }
    if (frameId === null) frameId = requestFrame(frame);
  }

  function frame() {
    frameId = null;
    if (disposed || !active || !layout) return;
    const t = now();
    if (t - lastFrame < FRAME_MS - 2) { frameId = requestFrame(frame); return; }
    if (Number.isFinite(lastFrame)) frameTimes.push(t - lastFrame);
    lastFrame = t;
    const start = now();
    let moving = step(t);
    moving = stepView(t) || moving;
    placeCamera();
    renderer.render(scene, camera);
    samples.push(now() - start);
    if (samples.length > 600) samples = samples.slice(-300);
    if (frameTimes.length > 600) frameTimes = frameTimes.slice(-300);
    emitAnchors();
    if (moving || busy) { frameId = requestFrame(frame); return; }
    lastFrame = -Infinity;
    // Asleep until the next burst is due.
    if (reduced) return;
    let next = Infinity;
    for (const b of benches.values()) for (const f of b.figures.values()) {
      const n = nextBurstIn(f.pose, t, f.phase);
      if (n !== null) next = Math.min(next, n);
    }
    if (Number.isFinite(next)) wakeId = setTimeout(() => { wakeId = null; wake(); }, Math.max(16, next));
  }

  function stepView(t: number): boolean {
    let moving = false;
    if (zoomAnim) {
      const u = Math.min(1, (t - zoomAnim.start) / zoomAnim.ms);
      const k = 1 - (1 - u) ** 3;
      view.zoom = zoomAnim.from.zoom + (zoomAnim.to.zoom - zoomAnim.from.zoom) * k;
      view.ox = zoomAnim.from.ox + (zoomAnim.to.ox - zoomAnim.from.ox) * k;
      view.oy = zoomAnim.from.oy + (zoomAnim.to.oy - zoomAnim.from.oy) * k;
      if (u >= 1) zoomAnim = null; else moving = true;
    }
    if (reduced) { tilt.x = 0; tilt.y = 0; return moving; }
    const dx = tilt.tx - tilt.x;
    const dy = tilt.ty - tilt.y;
    if (Math.abs(dx) > 0.002 || Math.abs(dy) > 0.002) {
      tilt.x += dx * 0.18;
      tilt.y += dy * 0.18;
      moving = true;
    } else { tilt.x = tilt.tx; tilt.y = tilt.ty; }
    return moving;
  }

  const v = new Vector3();
  function toPx(x: number, y: number, z: number) {
    v.set(x, y, z).project(camera);
    return { x: (v.x + 1) / 2 * (layout?.width ?? 0), y: (1 - v.y) / 2 * (layout?.height ?? 0) };
  }

  /** The floor point (y = 0) that sits at (px, py) at rest. */
  function floorPointAt(px: number, py: number) {
    const L = layout as FloorLayout;
    return { x: (px - L.width / 2) / L.ppu, z: py / L.ppu / Math.sin(L.elevation) };
  }

  function emitAnchors() {
    if (!listener || !layout) return;
    const out: FloorAnchors = { benches: [], figures: [] };
    for (const b of benches.values()) {
      const spot = benchSpot(b.index);
      if (!spot) continue;
      // The words hang on the floor under the bench: follow the floor point under their top middle.
      const plateAt = floorPointAt(spot.plate.left + spot.plate.width / 2, spot.plate.top);
      const tl = floorPointAt(spot.cell.left, spot.cell.top);
      const br = floorPointAt(spot.cell.left + spot.cell.width, spot.cell.top + spot.cell.height);
      const p = toPx(plateAt.x, 0, plateAt.z);
      const a = toPx(tl.x, 0, tl.z);
      const c = toPx(br.x, 0, br.z);
      out.benches.push({
        slug: b.slug,
        plate: { ...spot.plate, left: Math.round(p.x - spot.plate.width / 2), top: Math.round(p.y) },
        cell: { left: Math.round(a.x), top: Math.round(a.y), width: Math.round(c.x - a.x), height: Math.round(c.y - a.y) },
      });
      for (const f of b.figures.values()) {
        const a = f.parts.anchor.position;
        const px = a.x + f.rig.dx;
        const pz = a.z + f.rig.dz;
        const top = toPx(px, (HEAD_Y + FIGURE.headRadius * 2) * f.rig.squash + f.rig.lift + 0.05, pz);
        const foot = toPx(px, 0, pz + FIGURE.bodyRadius);
        const half = (FIGURE.bodyRadius + 0.09) * layout.ppu * view.zoom;
        out.figures.push({ key: f.key, slug: b.slug, rect: { left: Math.round(top.x - half), top: Math.round(top.y), width: Math.round(half * 2), height: Math.max(8, Math.round(foot.y - top.y)) } });
      }
    }
    listener(out);
  }

  // ---------- The API ----------

  return {
    setLayout(next, pixelRatio) {
      layout = next;
      renderer.setPixelRatio(Math.min(2, Math.max(1, pixelRatio)));
      renderer.setSize(next.width, next.height, false);
      if (room) scene.remove(room);
      room = kit.makeRoom(next);
      for (const m of room.children) if (m instanceof Mesh) m.castShadow = false;
      scene.add(room);
      placeSun();
      for (const b of benches.values()) placeBench(b);
      view.zoom = Math.min(view.zoom, ZOOM_MAX);
      clampView();
      wake();
    },
    setBenches,
    setPalette(p) {
      palette = p;
      kit.setPalette(palette);
      wake();
    },
    setReducedMotion(r) {
      reduced = r;
      if (r) {
        for (const f of leaving) removeFigure(f);
        for (const b of benches.values()) for (const f of b.figures.values()) { f.walk = null; f.changeMs = 0; }
        tilt.tx = 0; tilt.ty = 0;
      }
      wake();
    },
    setHover(key) {
      if (hoverKey === key) return;
      hoverKey = key;
      wake();
    },
    setPointer(nx, ny) {
      if (reduced) return;
      tilt.tx = Math.max(-1, Math.min(1, nx));
      tilt.ty = Math.max(-1, Math.min(1, ny));
      wake();
    },
    zoomAt(factor, px, py) {
      if (!layout) return;
      const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.zoom * factor));
      // Keep the point under the pointer where it is.
      const wx = view.ox + px / view.zoom;
      const wy = view.oy + py / view.zoom;
      zoomAnim = null;
      view.zoom = z;
      view.ox = wx - px / z;
      view.oy = wy - py / z;
      clampView();
      wake();
    },
    fitAll() {
      zoomAnim = { from: { ...view }, to: { zoom: 1, ox: 0, oy: 0 }, start: now(), ms: reduced ? 1 : 260 };
      wake();
    },
    zoomed: () => view.zoom > 1.001,
    setActive(on) {
      active = on;
      if (!on) {
        if (frameId !== null) { cancelFrame(frameId); frameId = null; }
        if (wakeId !== null) { clearTimeout(wakeId); wakeId = null; }
        lastFrame = -Infinity;
      } else wake();
    },
    onFrame(cb) { listener = cb; if (cb) wake(); },
    setBusy(b) { busy = b; wake(); },
    stats(reset = false): FrameStats {
      const sorted = [...samples].sort((a, b) => a - b);
      const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
      const gap = frameTimes.length ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 0;
      let figures = 0;
      for (const b of benches.values()) figures += b.figures.size;
      const out = {
        frames: samples.length, avgMs: avg, p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0, maxMs: sorted[sorted.length - 1] ?? 0,
        fps: gap ? 1000 / gap : 0, figures, benches: benches.size,
      };
      if (reset) { samples = []; frameTimes = []; }
      return out;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frameId !== null) cancelFrame(frameId);
      if (wakeId !== null) clearTimeout(wakeId);
      listener = null;
      scene.clear();
      benches.clear();
      leaving.clear();
      sunShadow.map?.dispose();
      kit.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };

  function clampView() {
    if (!layout) return;
    const maxX = layout.width - layout.width / view.zoom;
    const maxY = layout.height - layout.height / view.zoom;
    view.ox = Math.max(0, Math.min(maxX, view.ox));
    view.oy = Math.max(0, Math.min(maxY, view.oy));
  }
}
