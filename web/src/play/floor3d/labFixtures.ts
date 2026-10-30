// The floor lab's benches (FloorLab.tsx, #/floor-lab): every pose for every role, for checking by
// eye. Invented words, never sent anywhere.
import { roleOf } from '../crewPack';
import type { LampGroup } from './palette';
import { POSES, POSE_WORDS, type Pose } from './rig';
import { propFor } from './props';
import type { FloorBench, FloorFigure } from './types';

/** An example line for each pose, as labelFor writes them (model.ts), with {role} for the role word. */
const EXAMPLE: Record<Pose, string> = {
  reading: '{role} · reading merge.ts',
  editing: '{role} · editing merge.ts',
  running: '{role} · running npm test · 212 of 577',
  waiting: '{role} · waiting for your go-ahead · 35m',
  asking: '{role} · asks to run a command',
  stuck: '{role} · stopped: 3 tests failed',
  paused: 'Paused until the limit resets, 4:00pm',
  done: 'Done',
  watching: '{role} · watching the crew',
  idle: '{role} · idle',
};

const LAMP: Record<Pose, LampGroup> = {
  reading: 'running', editing: 'running', running: 'running', watching: 'running',
  waiting: 'needs-you', asking: 'needs-you', stuck: 'idle', paused: 'paused', done: 'done', idle: 'idle',
};
const GLYPH: Record<LampGroup, string> = { 'needs-you': '◆', running: '◐', paused: '‖', idle: '○', shipping: '↗', done: '✓' };
const STATUS: Record<LampGroup, string> = { 'needs-you': 'Needs you', running: 'Working', paused: 'Paused', idle: 'Idle', shipping: 'Shipping', done: 'Done' };

function figure(slug: string, who: string, pose: Pose, seat: FloorFigure['seat']): FloorFigure {
  const role = roleOf(who);
  return {
    key: `${slug}:${who}`, who, role, prop: propFor(who), pose, seat,
    progress: pose === 'running' ? 212 / 577 : null,
    label: EXAMPLE[pose].replace('{role}', role),
  };
}

/** Two benches per pose: the Foreman, Builder, Tester and Reviewer at the first; the Foreman and the Planner at the second. */
export function poseBenches(): FloorBench[] {
  const out: FloorBench[] = [];
  POSES.forEach((pose) => {
    const words = POSE_WORDS[pose];
    const lamp = LAMP[pose];
    const a = `lab-${pose}-a`;
    const b = `lab-${pose}-b`;
    out.push({
      slug: a, index: out.length, title: words, lamp, glyph: GLYPH[lamp], status: STATUS[lamp], stop: '',
      figures: [figure(a, 'conductor', pose, 'head'), figure(a, 'feature-implementer', pose, 0), figure(a, 'feature-tester', pose, 1), figure(a, 'feature-reviewer', pose, 2)],
      more: 0,
    });
    out.push({
      slug: b, index: out.length, title: `${words.split(':')[0]}, one helper`, lamp, glyph: GLYPH[lamp], status: STATUS[lamp], stop: '',
      figures: [figure(b, 'conductor', pose, 'head'), figure(b, 'feature-planner', pose, 0)],
      more: 0,
    });
  });
  return out;
}

/** Twelve benches with thirty figures (twelve Foremen, eighteen helpers), all at work: the frame-time check. */
export function busyBenches(): FloorBench[] {
  const two = ['feature-implementer', 'feature-tester'];
  const one = ['feature-reviewer'];
  const poses: Pose[] = ['editing', 'running', 'reading', 'waiting', 'watching', 'asking'];
  return Array.from({ length: 12 }, (_, i) => {
    const slug = `busy-${i + 1}`;
    const crew = i % 2 ? one : two;
    return {
      slug, index: i, title: `Bench ${i + 1}`, lamp: 'running' as const, glyph: GLYPH.running, status: STATUS.running, stop: '', more: 0,
      figures: [figure(slug, 'conductor', poses[(i + 4) % poses.length], 'head'), ...crew.map((who, j) => figure(slug, who, poses[(i + j) % poses.length], j as 0 | 1))],
    };
  });
}
