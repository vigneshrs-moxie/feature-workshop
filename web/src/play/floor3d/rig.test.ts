import { describe, expect, it } from 'vitest';
import { seatSpot, SIT_DZ } from './layout';
import { LOOPS, POSES, POSE_WORDS, blendRig, burstAt, changeRig, facesYou, isSeated, nextBurstIn, pathLength, phaseOf, pointAt, poseRig, rigAt, transitionMs, walkMs, walkPath, CRANK_HAND, type Pose } from './rig';

describe('poses', () => {
  it('has a still rig and words for every pose, at every seat', () => {
    for (const pose of POSES) {
      expect(POSE_WORDS[pose]).toBeTruthy();
      for (const seat of ['head', 0, 1, 2] as const) {
        const r = poseRig(pose, seat, 3);
        for (const v of Object.values(r).flat()) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('turns to you when waiting or asking, and to the bench while working', () => {
    const spot = seatSpot(0, 1);
    expect(poseRig('waiting', 0, 1).yaw).toBeCloseTo(spot.yawYou);
    expect(poseRig('asking', 0, 1).yaw).toBeCloseTo(spot.yawYou);
    expect(poseRig('editing', 0, 1).yaw).toBeCloseTo(spot.yawBench);
    expect(poseRig('running', 'head', 1).yaw).toBeCloseTo(seatSpot('head', 1).yawBench);
    expect(facesYou('done')).toBe(true);
    expect(facesYou('reading')).toBe(false);
  });

  it('raises the free hand above the head to wait, and holds a card up to ask', () => {
    const w = poseRig('waiting', 0, 1);
    expect(w.handL[1]).toBeGreaterThan(1);
    expect(w.headNod).toBeLessThan(0);
    const a = poseRig('asking', 0, 1);
    expect(a.card).toBe(1);
    expect(a.handL[1]).toBeGreaterThan(0.8);
  });

  it('shows each pose its own things: a sheet, the workpiece, the device, a crate and sign, a crate and clock, a stack', () => {
    const shows: [Pose, keyof ReturnType<typeof poseRig>][] = [
      ['reading', 'sheet'], ['editing', 'workpiece'], ['running', 'device'], ['stuck', 'sign'], ['paused', 'clock'], ['done', 'stack'],
    ];
    for (const [pose, part] of shows) expect(poseRig(pose, 0, 1)[part]).toBe(1);
    expect(poseRig('stuck', 0, 1).crate).toBe(1);
    expect(poseRig('paused', 0, 1).crate).toBe(1);
    expect(poseRig('idle', 0, 1).crate).toBe(0);
  });

  it('sits helpers on a crate in front of the bench, and the Foreman where it stands', () => {
    expect(isSeated('stuck')).toBe(true);
    expect(poseRig('stuck', 1, 2).dz).toBe(SIT_DZ);
    expect(poseRig('paused', 'head', 2).dz).toBeLessThan(0.1);
    expect(poseRig('paused', 0, 1).squash).toBeLessThan(1);
  });

  it('fills the device lamps with a command’s progress', () => {
    expect(poseRig('running', 0, 1, 0.4).lampFill).toBe(0.4);
    expect(rigAt('running', 0, 1, 0, 0, true, 0.6).lampFill).toBe(0.6);
  });

  it('keeps the cranking hand on the crank’s knob', () => {
    const r = rigAt('running', 0, 1, 900, 0, true);
    expect(r.handL).toEqual(CRANK_HAND(r.crank));
  });
});

describe('motion', () => {
  it('takes 120 to 600 ms for every change of pose', () => {
    for (const from of [null, ...POSES]) for (const to of POSES) {
      const ms = transitionMs(from, to);
      expect(ms).toBeGreaterThanOrEqual(120);
      expect(ms).toBeLessThanOrEqual(600);
    }
  });

  it('plays short bursts within 120–600 ms steps and rests between them', () => {
    for (const [pose, loop] of Object.entries(LOOPS)) {
      expect(loop.length).toBeLessThan(loop.period);
      expect(burstAt(pose as Pose, loop.length + 10, 0)).toBe(-1);
      expect(nextBurstIn(pose as Pose, loop.length + 10, 0)).toBe(loop.period - loop.length - 10);
      expect(nextBurstIn(pose as Pose, 1, 0)).toBe(0);
    }
    expect(nextBurstIn('stuck', 0, 0)).toBeNull();
    expect(nextBurstIn('done', 0, 0)).toBeNull();
  });

  it('holds still when not animated (reduced motion)', () => {
    for (const pose of POSES) {
      for (const t of [0, 300, 1700, 4000]) expect(rigAt(pose, 0, 1, t, 0.3, false)).toEqual(poseRig(pose, 0, 1));
    }
  });

  it('moves in a burst when animated', () => {
    expect(rigAt('editing', 0, 1, 100, 0, true).handR).not.toEqual(poseRig('editing', 0, 1).handR);
    expect(rigAt('waiting', 0, 1, 150, 0, true).handL).not.toEqual(poseRig('waiting', 0, 1).handL);
  });

  it('blends from one rig to the next, landing exactly on it', () => {
    const a = poseRig('editing', 0, 1);
    const b = poseRig('waiting', 0, 1);
    expect(blendRig(a, b, 0)).toEqual(a);
    expect(changeRig(a, b, 'waiting', 1)).toEqual(b);
    const mid = changeRig(a, b, 'waiting', 0.5);
    expect(mid.yaw).toBeGreaterThan(Math.min(a.yaw, b.yaw) - 1e-9);
    expect(mid.yaw).toBeLessThan(Math.max(a.yaw, b.yaw) + 1e-9);
  });

  it('tidies the bench on the way to done', () => {
    const a = poseRig('editing', 0, 1);
    const b = poseRig('done', 0, 1);
    expect(changeRig(a, b, 'done', 0.27).handL[1]).toBeGreaterThan(blendRig(a, b, 0.27).handL[1]);
  });

  it('walks from the door down the walkway to the spot', () => {
    const door = { x: -5, z: 0.5, aisleX: -5.3 };
    const path = walkPath(door, { x: 1, z: 4 }, 5.2);
    expect(path[0]).toEqual({ x: -5, z: 0.55 });
    expect(path.at(-1)).toEqual({ x: 1, z: 4 });
    expect(pointAt(path, 0)).toMatchObject({ x: -5, z: 0.55 });
    expect(pointAt(path, pathLength(path) + 1)).toMatchObject({ x: 1, z: 4 });
    expect(walkMs(path)).toBeGreaterThan(1000);
  });

  it('gives each figure its own phase', () => {
    expect(phaseOf('a:conductor')).not.toBe(phaseOf('b:conductor'));
    expect(phaseOf('a')).toBeGreaterThanOrEqual(0);
    expect(phaseOf('a')).toBeLessThan(1);
  });
});
