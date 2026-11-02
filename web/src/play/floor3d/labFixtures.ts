// The station lab's bays (FloorLab.tsx, #/station-lab): every bay kind at every phase, every pose
// for every role, for checking by eye. Invented words, never sent anywhere.
import type { Job, Permission } from '../../api/types';
import { roleOf } from '../crewPack';
import type { LampGroup, StopHue } from './palette';
import { hueFor } from './model';
import { ALERT_WORDS, alertFor, BAY_ALERTS, PHASE_WORDS, PHASES, sectionState, SECTION_WORDS, signFor, stackWords, type BayAlert, type BayKind, type BuildPhase } from './bays';
import { sectionX } from './model';
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

/** A stop for each made-up bench, round the ring, so the lab shows every hue. */
const RING: StopHue[] = ['build', 'test', 'review', 'plan', 'investigate', 'spec', 'ship'];
const STOP_WORD: Record<StopHue, string> = { spec: 'Spec', investigate: 'Investigate', plan: 'Plan', build: 'Build', test: 'Test', review: 'Review', ship: 'Ship', none: '' };

function figure(slug: string, who: string, pose: Pose, seat: FloorFigure['seat'], stop: StopHue = 'build'): FloorFigure {
  const role = roleOf(who);
  return {
    key: `${slug}:${who}`, who, role, prop: propFor(who), pose, seat, hue: hueFor(who, stop),
    progress: pose === 'running' ? 212 / 577 : null,
    label: EXAMPLE[pose].replace('{role}', role),
  };
}

/** The words a made-up bay carries for its kind and phase. */
function bayWords(kind: BayKind, phase: BuildPhase, title: string) {
  return { kind, phase, sign: signFor(kind, phase, title), phaseWords: PHASE_WORDS[kind][phase], alert: null, sections: null };
}

/** A made-up bay's state, from its status and its crew's poses, as the model works it out. */
const withAlert = (b: FloorBench): FloorBench => ({ ...b, alert: alertFor(b.lamp, b.figures.map((f) => f.pose)) });

/** The phase that goes with a stop, for the made-up bays. */
const PHASE_OF: Record<StopHue, BuildPhase> = { spec: 'frame', investigate: 'frame', plan: 'frame', none: 'frame', build: 'plates', test: 'lights', review: 'sealed', ship: 'sealed' };
const STOP_OF: Record<BuildPhase, StopHue> = { frame: 'plan', plates: 'build', lights: 'test', sealed: 'review', launched: 'ship' };

/** Every bay kind at every phase: a construction bay and a repair dock for each, with a crew at work. */
export function bayBenches(): FloorBench[] {
  const out: FloorBench[] = [];
  const POSE: Record<BuildPhase, Pose> = { frame: 'reading', plates: 'editing', lights: 'running', sealed: 'watching', launched: 'done' };
  const WHO: Record<BuildPhase, string> = { frame: 'feature-planner', plates: 'feature-implementer', lights: 'feature-tester', sealed: 'feature-reviewer', launched: 'feature-implementer' };
  for (const phase of PHASES) {
    for (const kind of ['build', 'repair'] as BayKind[]) {
      const slug = `lab-${kind}-${phase}`;
      const stop = STOP_OF[phase];
      const title = kind === 'build' ? 'Invoice export' : 'Footer typo';
      const done = phase === 'launched';
      const lamp: LampGroup = done ? 'done' : 'running';
      const pose = POSE[phase];
      out.push({
        slug, index: out.length, title: `${kind === 'build' ? 'Construction bay' : 'Repair dock'}: ${PHASE_WORDS[kind][phase]}`, ...bayWords(kind, phase, title),
        lamp, glyph: GLYPH[lamp], status: STATUS[lamp], stop: STOP_WORD[stop], hue: stop, more: 0,
        figures: done ? [figure(slug, 'conductor', 'done', 'head', stop)] : [figure(slug, 'conductor', 'watching', 'head', stop), figure(slug, WHO[phase], pose, 0, stop)],
      });
    }
  }
  return out.map(withAlert);
}

/**
 * Every state on both kinds of bay (needs you, asks permission, stopped, paused, done), and a stack
 * as one larger module: three parts joined, two at work with their own small crews, one built, one
 * stuck, three waiting as dim frames.
 */
export function stateBenches(): FloorBench[] {
  const out: FloorBench[] = [];
  const STATE: Record<BayAlert, { lamp: LampGroup; head: Pose; helper: Pose | null; phase: BuildPhase }> = {
    'needs-you': { lamp: 'needs-you', head: 'waiting', helper: null, phase: 'frame' },
    asking: { lamp: 'needs-you', head: 'watching', helper: 'asking', phase: 'plates' },
    stuck: { lamp: 'idle', head: 'watching', helper: 'stuck', phase: 'lights' },
    paused: { lamp: 'paused', head: 'paused', helper: 'paused', phase: 'plates' },
    done: { lamp: 'done', head: 'done', helper: null, phase: 'launched' },
  };
  for (const alert of BAY_ALERTS) {
    for (const kind of ['build', 'repair'] as BayKind[]) {
      const st = STATE[alert];
      const slug = `lab-${alert}-${kind}`;
      const stop = STOP_OF[st.phase];
      const title = kind === 'build' ? 'Invoice export' : 'Footer typo';
      const helperWho = alert === 'stuck' ? 'feature-tester' : 'feature-implementer';
      out.push({
        slug, index: out.length, title: `${kind === 'build' ? 'Construction bay' : 'Repair dock'}: ${ALERT_WORDS[alert].toLowerCase()}`, ...bayWords(kind, st.phase, title),
        lamp: st.lamp, glyph: GLYPH[st.lamp], status: STATUS[st.lamp], stop: STOP_WORD[stop], hue: stop, more: 0,
        figures: [figure(slug, 'conductor', st.head, 'head', stop), ...(st.helper ? [figure(slug, helperWho, st.helper, 0, stop)] : [])],
      });
    }
  }
  // The stack.
  const parts = ['integrated', 'integrated', 'integrated', 'blocked', 'ready', 'running', 'running', 'pending', 'pending', 'pending'];
  const sections = parts.map((state, i) => {
    const sec = sectionState(state);
    return { n: i + 1, slug: `lab-stack--part-${i + 1}`, state: sec, name: `part ${i + 1}`, words: `Part ${i + 1} · part ${i + 1} · ${SECTION_WORDS[sec]}` };
  });
  const slug = 'lab-stack';
  const crew = sections.filter((x) => x.state === 'working').map((x, i) => ({
    ...figure(`${slug}:${x.n}`, i ? 'feature-tester' : 'feature-implementer', i ? 'running' : 'editing', i as 0 | 1, i ? 'test' : 'build'),
    at: sectionX(x.n, sections.length), small: true,
  }));
  out.push({
    slug, index: out.length, title: 'A stack: one module, a section per part', kind: 'build', phase: 'plates', sign: signFor('build', 'plates', 'Billing'),
    phaseWords: `Stack · ${stackWords(sections.map((x) => x.state))}`, alert: null, sections,
    lamp: 'running', glyph: GLYPH.running, status: STATUS.running, stop: STOP_WORD.build, hue: 'build', more: 0,
    figures: [figure(slug, 'conductor', 'watching', 'head', 'build'), ...crew],
  });
  return out.map(withAlert);
}

/** Two benches per pose: the Foreman, Builder, Tester and Reviewer at the first; the Foreman and the Planner at the second. */
export function poseBenches(): FloorBench[] {
  const out: FloorBench[] = [];
  POSES.forEach((pose) => {
    const words = POSE_WORDS[pose];
    const lamp = LAMP[pose];
    const a = `lab-${pose}-a`;
    const b = `lab-${pose}-b`;
    const sa = RING[out.length % RING.length];
    const sb = RING[(out.length + 1) % RING.length];
    out.push({
      slug: a, index: out.length, title: words, ...bayWords('build', PHASE_OF[sa], 'Invoice export'), lamp, glyph: GLYPH[lamp], status: STATUS[lamp], stop: STOP_WORD[sa], hue: sa,
      figures: [figure(a, 'conductor', pose, 'head', sa), figure(a, 'feature-implementer', pose, 0, sa), figure(a, 'feature-tester', pose, 1, sa), figure(a, 'feature-reviewer', pose, 2, sa)],
      more: 0,
    });
    out.push({
      slug: b, index: out.length, title: `${words.split(':')[0]}, one helper`, ...bayWords('repair', PHASE_OF[sb], 'Footer typo'), lamp, glyph: GLYPH[lamp], status: STATUS[lamp], stop: STOP_WORD[sb], hue: sb,
      figures: [figure(b, 'conductor', pose, 'head', sb), figure(b, 'feature-planner', pose, 0, sb)],
      more: 0,
    });
  });
  return out.map(withAlert);
}

/** Twelve bays with thirty figures (twelve Foremen, eighteen helpers), all at work: the frame-time check. */
export function busyBenches(): FloorBench[] {
  const two = ['feature-implementer', 'feature-tester'];
  const one = ['feature-reviewer'];
  const poses: Pose[] = ['editing', 'running', 'reading', 'waiting', 'watching', 'asking'];
  return Array.from({ length: 12 }, (_, i): FloorBench => {
    const slug = `busy-${i + 1}`;
    const crew = i % 2 ? one : two;
    const stop = RING[i % RING.length];
    return {
      slug, index: i, title: `Bay ${i + 1}`, ...bayWords(i % 3 === 1 ? 'repair' : 'build', PHASE_OF[stop], `Bay ${i + 1}`), lamp: 'running' as const, glyph: GLYPH.running, status: STATUS.running, stop: STOP_WORD[stop], hue: stop, more: 0,
      figures: [figure(slug, 'conductor', poses[(i + 4) % poses.length], 'head', stop), ...crew.map((who, j) => figure(slug, who, poses[(i + j) % poses.length], j as 0 | 1, stop))],
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
