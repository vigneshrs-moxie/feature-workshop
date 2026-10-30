// The floor lab's benches (FloorLab.tsx, #/floor-lab): every pose for every role, for checking by
// eye. Invented words, never sent anywhere.
import type { Job, Permission } from '../../api/types';
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

// ---------- The live floor's made-up jobs: the states the demo has none of ----------

const MIN = 60 * 1000;
const at = (msAgo: number, now: Date) => new Date(now.getTime() - msAgo).toISOString();
/** Today at 4 pm (tomorrow's when that has passed): when the made-up limit resets. */
function fourPm(now: Date): string {
  const d = new Date(now);
  d.setHours(16, 0, 0, 0);
  if (d.getTime() < now.getTime()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/**
 * Jobs for the states the demo's own jobs lack: a command with a count (running), failed tests
 * (stopped), the usage limit (paused), a finished job (done), and a permission card waiting
 * (asking). Every title says it is an example.
 */
export function labJobs(now: Date = new Date()): { jobs: Job[]; permissions: Permission[] } {
  const jobs: Job[] = [
    { slug: 'lab-running-tests', title: 'Nightly export (example)', group: 'running', lane: 'working', stage: 'test', stageState: 'working', working: true,
      nowDoing: [{ who: 'feature-tester', doing: 'Running npm test · 212 of 577', since: at(4 * MIN, now) }] },
    { slug: 'lab-failed-tests', title: 'Price rounding (example)', group: 'idle', lane: 'resting', stage: 'test', stageState: 'blocked',
      headline: 'Price rounding · 3 tests failed', laneReason: '3 tests failed', updatedAt: at(18 * MIN, now) },
    { slug: 'lab-limit-pause', title: 'Route sharing (example)', group: 'paused', lane: 'working', stage: 'implement', stageState: 'working', limitPaused: fourPm(now),
      nowDoing: [{ who: 'feature-implementer', doing: 'Editing share.ts', since: at(30 * MIN, now) }] },
    { slug: 'lab-finished', title: 'Invoice footer (example)', group: 'done', lane: 'done', stage: 'pr3', stageState: 'done', closed: { as: 'done', at: at(60 * MIN, now) } as Job['closed'] },
    { slug: 'lab-permission', title: 'Tag colours (example)', group: 'needs-you', lane: 'needs-you', stage: 'implement', stageState: 'working', waitingFor: 'permission', permissions: 1,
      waitingSince: at(3 * MIN, now), nowDoing: [{ who: 'feature-implementer', doing: 'Run the linter', since: at(5 * MIN, now) }] },
  ];
  const permissions: Permission[] = [
    { id: 'lab-perm-1', slug: 'lab-permission', kind: 'permission', toolName: 'Bash', agentType: 'feature-implementer', createdAt: at(3 * MIN, now), input: { command: 'npm run lint' } },
  ];
  return { jobs, permissions };
}
