// How a figure holds itself in each pose, and how it moves between them: plain numbers, no three.js,
// so every pose can be checked in a test and the scene only copies the numbers onto its parts.
//
// The figure (kit.ts): a rounded body, a round head with no face, two hands, and its role's prop in
// the right hand. The left hand is the free one: it holds the sheet it reads, the card it holds up,
// and it is the hand that waves. The figure's front is +z (a small badge on its chest marks it).
//
// Motion follows the design philosophy: every change is 120–600 ms and eased; the working loops are
// short bursts with rests between them (calm, and the floor stops drawing while nothing moves); with
// reduced motion a figure holds its pose and never walks.
import type { Seat } from './layout';
import { BENCH, SIT_DZ, seatSpot } from './layout';

export type Pose = 'idle' | 'watching' | 'reading' | 'editing' | 'running' | 'waiting' | 'asking' | 'stuck' | 'paused' | 'done';
export const POSES: readonly Pose[] = ['reading', 'editing', 'running', 'waiting', 'asking', 'stuck', 'paused', 'done', 'watching', 'idle'];

/** What each pose shows, in a few words (the floor lab's names; the figures' own words come from labelFor). */
export const POSE_WORDS: Record<Pose, string> = {
  reading: 'Reading: holds a sheet, head tilted',
  editing: 'Editing: works at the bench',
  running: 'Running: turns the crank, lamps count up',
  waiting: 'Waiting for you: turns to you, hand up',
  asking: 'Asking: holds up a card',
  stuck: 'Stopped: sits on a crate by a sign',
  paused: 'Paused for the limit: sits by a clock',
  done: 'Done: tidies the bench, then rests',
  watching: 'Watching the crew, clipboard in hand',
  idle: 'Idle: stands at ease',
};

export type Vec3 = [number, number, number];

export interface Rig {
  /** Facing, radians (0 faces the camera). */
  yaw: number;
  /** Offset from its spot (sitting comes forward a little), world units. */
  dx: number;
  dz: number;
  /** Raised (on a crate), and how tall (1 standing, less sitting). */
  lift: number;
  squash: number;
  /** Tilts: forward (toward where it faces) and sideways. */
  lean: number;
  roll: number;
  /** The head: down (+) or up (−), sideways, turned. */
  headNod: number;
  headTilt: number;
  headTurn: number;
  /** The hands, in the body's own frame (+x its left, +z its front). */
  handL: Vec3;
  handR: Vec3;
  /** The prop in the right hand: tipped forward and sideways. */
  propPitch: number;
  propRoll: number;
  /** Things that show for a pose, 0 (gone) to 1 (there). */
  sheet: number;
  card: number;
  crate: number;
  sign: number;
  clock: number;
  device: number;
  workpiece: number;
  stack: number;
  /** The crank's turn (radians) and how full the device's lamps are (0..1). */
  crank: number;
  lampFill: number;
  /** The waiting hand's little wave, for the hand's own tilt. */
  wave: number;
}

/** The left hand on the crank's knob when the crank has turned `a` radians (the knob sits 0.07 from the axle). */
export const CRANK_HAND = (a: number): Vec3 => [0.235, BENCH.height + 0.06 + 0.07 * Math.sin(a), 0.38 - 0.07 * Math.cos(a)];

const REST_L: Vec3 = [0.3, 0.32, 0.04];
const REST_R: Vec3 = [-0.3, 0.32, 0.04];

const BASE: Rig = {
  yaw: 0, dx: 0, dz: 0, lift: 0, squash: 1, lean: 0, roll: 0,
  headNod: 0.05, headTilt: 0, headTurn: 0,
  handL: REST_L, handR: REST_R, propPitch: 0, propRoll: 0,
  sheet: 0, card: 0, crate: 0, sign: 0, clock: 0, device: 0, workpiece: 0, stack: 0,
  crank: 0, lampFill: 0, wave: 0,
};

/** Facing the bench, or turned round to you. */
const FACES: Record<Pose, 'bench' | 'you'> = {
  idle: 'you', watching: 'bench', reading: 'bench', editing: 'bench', running: 'bench',
  waiting: 'you', asking: 'you', stuck: 'you', paused: 'you', done: 'you',
};

/** Whether a pose faces you: the turn is part of what it says. */
export const facesYou = (pose: Pose) => FACES[pose] === 'you';

/** The pose held still: what reduced motion shows, and what the loops play around. */
export function poseRig(pose: Pose, seat: Seat, helpers: number, progress: number | null = null): Rig {
  const spot = seatSpot(seat, helpers);
  const head = seat === 'head';
  const yaw = FACES[pose] === 'you' ? spot.yawYou : spot.yawBench;
  const r: Rig = { ...BASE, yaw };
  switch (pose) {
    case 'idle':
      return { ...r, headNod: 0.06 };
    case 'watching':
      // The clipboard at the chest, tipped up to read; looking along the bench at the crew.
      return { ...r, yaw: spot.yawBench - (head ? 0.25 : 0), handR: [-0.11, 0.5, 0.25], propPitch: -1.05, handL: [0.27, 0.34, 0.08], headNod: 0.12 };
    case 'reading':
      // Turned a little toward you so the sheet shows; the sheet up in the left hand, head bent to it.
      return { ...r, yaw: yaw + (head ? -0.35 : 0.32), handL: [0.15, 0.55, 0.25], sheet: 1, handR: [-0.3, 0.3, 0.07], headNod: 0.36, headTilt: 0.14 };
    case 'editing':
      // Leaning in; the left hand steadies the work, the right lifts the tool over it.
      return { ...r, lean: 0.17, handL: [0.17, 0.5, 0.32], handR: [-0.13, 0.64, 0.32], propPitch: -0.45, workpiece: 1, headNod: 0.42 };
    case 'running':
      // The left hand on the crank at the device's side, the right holds the tool down by its side.
      // (Upright, so the hand stays on the crank's knob: kit.ts puts the crank 0.06 above the bench top.)
      return { ...r, handL: CRANK_HAND(0), handR: [-0.3, 0.32, 0.08], device: 1, headNod: 0.26, lampFill: progress ?? 0 };
    case 'waiting':
      // Turned to you, standing tall, looking up, the free hand raised.
      return { ...r, lean: -0.05, roll: -0.04, headNod: -0.22, headTilt: -0.08, handL: [0.27, 1.04, 0.12], handR: [-0.3, 0.3, 0.06] };
    case 'asking':
      // Turned to you, the card held up high in the free hand.
      return { ...r, lean: -0.02, headNod: -0.12, handL: [0.15, 0.9, 0.2], card: 1, handR: [-0.3, 0.3, 0.06] };
    case 'stuck':
      // Sat on a crate, slumped, head down, the tool on its lap; the "!" sign beside it.
      return { ...r, crate: 1, lift: 0.2, squash: 0.86, dz: head ? 0.06 : SIT_DZ, lean: 0.2, headNod: 0.44, handL: [0.17, 0.24, 0.21], handR: [-0.17, 0.24, 0.21], propPitch: 1.25, propRoll: 0.2, sign: 1 };
    case 'paused':
      // Sat on a crate, leaning back, head to one side (dozing); a small clock beside it.
      return { ...r, crate: 1, lift: 0.2, squash: 0.86, dz: head ? 0.06 : SIT_DZ, lean: -0.06, headNod: 0.14, headTilt: 0.32, handL: [0.15, 0.26, 0.2], handR: [-0.15, 0.26, 0.2], propPitch: 1.2, clock: 1 };
    case 'done':
      // Turned to you at ease, hands together; the work stacked neatly on the bench.
      return { ...r, lean: -0.03, headTilt: 0.06, headNod: 0, handL: [0.08, 0.29, 0.22], handR: [-0.08, 0.29, 0.22], propPitch: 0.5, stack: 1 };
  }
}

// ---------- The loops: short bursts, then a rest ----------

/** Each moving pose's rhythm: a burst of `length` ms every `period` ms. Poses not listed hold still. */
export const LOOPS: Partial<Record<Pose, { period: number; length: number }>> = {
  reading: { period: 3400, length: 560 },
  editing: { period: 2200, length: 660 },
  running: { period: 3000, length: 1800 },
  waiting: { period: 4600, length: 600 },
  asking: { period: 4000, length: 500 },
  watching: { period: 4200, length: 600 },
};

/** Where in its burst a figure is (0..1), or -1 between bursts. phase: 0..1, so figures don't move in step. */
export function burstAt(pose: Pose, t: number, phase: number): number {
  const loop = LOOPS[pose];
  if (!loop) return -1;
  const at = ((t + phase * loop.period) % loop.period + loop.period) % loop.period;
  return at < loop.length ? at / loop.length : -1;
}

/** ms until this pose's next burst starts (0 while one plays); null for a pose that holds still. */
export function nextBurstIn(pose: Pose, t: number, phase: number): number | null {
  const loop = LOOPS[pose];
  if (!loop) return null;
  const at = ((t + phase * loop.period) % loop.period + loop.period) % loop.period;
  return at < loop.length ? 0 : loop.period - at;
}

const bump = (u: number) => Math.sin(Math.PI * u);
const add = (v: Vec3, dx: number, dy: number, dz: number): Vec3 => [v[0] + dx, v[1] + dy, v[2] + dz];

/** The pose at time t (ms): its still rig with the loop's motion on top (when animated). */
export function rigAt(pose: Pose, seat: Seat, helpers: number, t: number, phase: number, animated: boolean, progress: number | null = null): Rig {
  const r = poseRig(pose, seat, helpers, progress);
  if (!animated) return r;
  const u = burstAt(pose, t, phase);
  if (u < 0) return r;
  switch (pose) {
    case 'reading': {
      // Reads on to the next line: the head tips across, the sheet follows a little.
      const b = bump(u);
      return { ...r, headTilt: r.headTilt - 0.2 * b, headNod: r.headNod + 0.05 * b, handL: add(r.handL, -0.02 * b, 0.015 * b, 0) };
    }
    case 'editing': {
      // Three quick taps: down fast, up softer.
      const tap = (u * 3) % 1;
      const d = tap < 0.33 ? easeInCubic(tap / 0.33) : 1 - easeOutCubic((tap - 0.33) / 0.67);
      return { ...r, handR: add(r.handR, 0, -0.12 * d, 0.02 * d), propPitch: r.propPitch + 0.95 * d, lean: r.lean + 0.03 * d };
    }
    case 'running': {
      // Two turns of the crank; the hand goes round with it.
      const a = easeInOutSine(u) * Math.PI * 4;
      const lamp = progress ?? ((Math.floor(t / 600) % 5) + 1) / 5;
      return { ...r, crank: a, handL: CRANK_HAND(a), lampFill: lamp, headNod: r.headNod + 0.03 * Math.sin(a) };
    }
    case 'waiting': {
      // A small wave: two swings of the raised hand.
      const w = Math.sin(u * Math.PI * 4) * bump(u);
      return { ...r, handL: add(r.handL, 0.05 * w, 0.01 * bump(u), 0), wave: w, roll: 0.03 * w };
    }
    case 'asking': {
      // Lifts the card a touch, to catch your eye.
      const b = bump(u);
      return { ...r, handL: add(r.handL, 0, 0.05 * b, 0.01 * b), lift: r.lift + 0.015 * b };
    }
    case 'watching': {
      // A glance along the bench and back.
      const b = bump(u);
      return { ...r, headTurn: 0.4 * b, headNod: r.headNod - 0.06 * b };
    }
    default:
      return r;
  }
}

// ---------- Changing pose ----------

const SEATED = new Set<Pose>(['stuck', 'paused']);
/** Stopped and paused figures sit down. */
export const isSeated = (pose: Pose) => SEATED.has(pose);

/** How long a change of pose takes, ms: always 120–600. Sitting down and turning round take longest. */
export function transitionMs(from: Pose | null, to: Pose): number {
  if (!from || from === to) return 120;
  if (to === 'done') return 600;
  if (SEATED.has(to) !== SEATED.has(from)) return 520;
  if (facesYou(from) !== facesYou(to)) return 460;
  return 300;
}

export const easeOutCubic = (u: number) => 1 - (1 - clamp01(u)) ** 3;
export const easeInCubic = (u: number) => clamp01(u) ** 3;
export const easeInOutCubic = (u: number) => { const x = clamp01(u); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };
export const easeInOutSine = (u: number) => -(Math.cos(Math.PI * clamp01(u)) - 1) / 2;
function clamp01(u: number) { return Math.min(1, Math.max(0, u)); }

const lerp = (a: number, b: number, k: number) => a * (1 - k) + b * k;
const lerpV = (a: Vec3, b: Vec3, k: number): Vec3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

/** a toward b by k (0..1), every part. */
export function blendRig(a: Rig, b: Rig, k: number): Rig {
  const out = { ...b };
  for (const key of Object.keys(b) as (keyof Rig)[]) {
    const va = a[key];
    const vb = b[key];
    if (Array.isArray(va) && Array.isArray(vb)) (out[key] as Vec3) = lerpV(va as Vec3, vb as Vec3, k);
    else (out[key] as number) = lerp(va as number, vb as number, k);
  }
  return out;
}

/**
 * Part way through a change of pose (u: 0..1 of transitionMs). Into "done" the figure first tidies
 * (both hands sweep across the bench), then turns to you and rests.
 */
export function changeRig(from: Rig, to: Rig, toPose: Pose, u: number): Rig {
  const k = toPose === 'done' || facesYou(toPose) ? easeInOutCubic(u) : easeOutCubic(u);
  const r = blendRig(from, to, k);
  if (toPose === 'done' && u < 0.55) {
    const s = bump(u / 0.55);
    return { ...r, handL: add(r.handL, -0.12 * s, 0.18 * s, 0.12 * s), handR: add(r.handR, 0.12 * s, 0.18 * s, 0.12 * s), lean: r.lean + 0.12 * s };
  }
  return r;
}

// ---------- Walking in and out ----------

export interface PathPoint { x: number; z: number }

/** Walking speed (world units a second) and one step's time (ms). */
export const WALK_SPEED = 1.9;
export const STEP_MS = 300;

/** From the door, down the walkway, along the aisle in front of the bench's row, to the spot. */
export function walkPath(door: { x: number; z: number; aisleX: number }, to: PathPoint, aisleZ: number): PathPoint[] {
  const pts: PathPoint[] = [{ x: door.x, z: door.z + 0.05 }, { x: door.aisleX, z: door.z + 0.45 }, { x: door.aisleX, z: aisleZ }, { x: to.x, z: aisleZ }, to];
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 1e-6);
}

export function pathLength(path: readonly PathPoint[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return d;
}

/** How long a walk takes, ms. */
export const walkMs = (path: readonly PathPoint[]) => (pathLength(path) / WALK_SPEED) * 1000;

/** Where along a path a figure is after `d` units, and which way it faces. */
export function pointAt(path: readonly PathPoint[], d: number): { x: number; z: number; yaw: number } {
  let left = Math.max(0, d);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= len || i === path.length - 1) {
      const k = len ? Math.min(1, left / len) : 1;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
    }
    left -= len;
  }
  const last = path[path.length - 1] ?? { x: 0, z: 0 };
  return { ...last, yaw: 0 };
}

/** The walk's own motion on top of a standing rig: a soft hop each step, hands swinging. */
export function walkRig(base: Rig, t: number, yaw: number): Rig {
  const u = (t % STEP_MS) / STEP_MS;
  const step = Math.floor(t / STEP_MS) % 2 ? 1 : -1;
  const hop = bump(u);
  const swing = Math.sin(u * Math.PI) * step;
  return {
    ...base, yaw, lift: 0.045 * hop, lean: 0.08, roll: 0.025 * swing, headNod: 0, headTilt: 0, headTurn: 0,
    handL: [0.29, 0.34, 0.04 + 0.07 * swing], handR: [-0.29, 0.34, 0.04 - 0.07 * swing], propPitch: 0.3,
    sheet: 0, card: 0, crate: 0, sign: 0, clock: 0, device: 0, workpiece: 0, stack: 0,
  };
}

/** A stable 0..1 for a figure, so its bursts don't land in step with its neighbours'. */
export function phaseOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h % 10007) / 10007;
}
