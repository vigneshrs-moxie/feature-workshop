// What each figure on the 3D floor is doing, from real data: the job card (the dashboard's
// snapshot), the crew at work on it (its nowDoing, the same lines the Stage shows from
// dashboard/lib/stage-view.js), the permissions and questions waiting, the usage limit and the
// Foreman's last reply. poseFor() picks the pose, labelFor() writes the words that always go with
// it (status is never shown by a pose or a colour alone). Pure: no React, no fetching, no model.
//
//   reading files or searching   reading   "Builder · reading merge.ts"
//   editing files                editing   "Builder · editing merge.ts"
//   running a command or tests   running   "Tester · running npm test · 212 of 577"
//   waiting for you              waiting   "Foreman · waiting for your go-ahead · 35m"
//   asking permission            asking    "Builder · asks to run a command"
//   stuck or failed              stuck     "Tester · stopped: 3 tests failed"
//   paused for the usage limit   paused    "Paused until the limit resets, 4:00pm"
//   finished                     done      "Done"
// and two of the Foreman's own: watching the crew ("Foreman · watching the Builder") and idle.
import type { Job, Permission, Run, Usage } from '../../api/types';
import { clockTime } from '../../lib/time';
import { jobStatus, shippingWhere } from '../../panes/Jobs/jobStatus';
import { stageLabel } from '../../panes/Jobs/stages';
import { STAGE_CHARACTER } from '../crew';
import { CREW_PACK, roleOf } from '../crewPack';
import { usagePaused } from '../crewLines';
import { waited } from '../floorModel';
import { MAX_HELPERS, type Seat } from './layout';
import type { LampGroup } from './palette';
import { propFor } from './props';
import type { Pose } from './rig';
import type { FloorBench, FloorFigure } from './types';

/** One agent, as the job card's nowDoing or a Stage row has it. */
export interface AgentFacts {
  /** The agent type; 'conductor' is the Foreman. */
  who: string;
  /** Its current step in words ("Reading merge.ts", "Run the unit tests"). */
  doing?: string | null;
  since?: string | null;
  /** Asked to use a tool and quiet this long (ms): often a prompt waiting in its terminal. */
  quietMs?: number | null;
  /** A Stage row's status, when the facts come from the Stage. */
  status?: 'working' | 'waiting' | 'done' | 'stopped' | null;
  /** How far a command has got, when known. */
  progress?: { done: number; total: number } | null;
}

/** The job around an agent. */
export interface JobFacts {
  job: Job;
  /** Waiting permissions and questions (all jobs' or this job's: only this job's are read). */
  permissions?: readonly Permission[];
  usage?: Usage | null;
  /** The Foreman's latest reply on this job. */
  run?: Run | null;
  now?: Date;
}

/** An agent asked to use a tool this long ago and has said nothing since: probably a prompt in its terminal. */
export const QUIET_MS = 5 * 60 * 1000;

type Kind = 'reading' | 'editing' | 'running' | 'sending';

/** What kind of step a nowDoing line is (dashboard/lib/session-log.js describeTool writes them). */
export function kindOf(doing: string | null | undefined): Kind | null {
  const d = String(doing ?? '').trim();
  if (!d) return null;
  if (/^(Reading|Searching|Looking for files|Loading skill)\b/i.test(d)) return 'reading';
  if (/^(Editing|Writing)\b/i.test(d)) return 'editing';
  if (/^Sending (work|a follow-up)\b/i.test(d)) return 'sending';
  return 'running';
}

const isConductor = (who: string) => who === 'conductor';
/** "Reading merge.ts" → "reading merge.ts"; leaves "PR #1…" and "npm…" as they are. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const PR_STAGES = new Set(['pr1', 'pr2', 'pr3', 'staging-qa']);

function asksFor(facts: JobFacts, who: string, kind: 'question' | 'permission'): Permission | null {
  const list = (facts.permissions ?? []).filter((p) => p.slug === facts.job.slug && (kind === 'question' ? p.kind === 'question' : p.kind !== 'question'));
  return list.find((p) => (isConductor(who) ? !p.agentType || p.agentType === 'conductor' : p.agentType === who)) ?? null;
}

/** What a permission asks to do, in a few words: "run a command", "edit a file". */
export function askWords(p: Pick<Permission, 'toolName'> & { displayName?: unknown }): string {
  const t = String(p.toolName ?? '');
  if (t === 'Bash') return 'run a command';
  if (t === 'Edit' || t === 'MultiEdit' || t === 'NotebookEdit') return 'edit a file';
  if (t === 'Write') return 'write a file';
  if (t === 'Read' || t === 'Glob' || t === 'Grep') return 'read the code';
  if (t === 'WebFetch' || t === 'WebSearch') return 'look something up on the web';
  if (t === 'Agent' || t === 'Task') return 'start a helper';
  const name = typeof p.displayName === 'string' && p.displayName ? p.displayName : t;
  return name ? `use ${name}` : 'take a step';
}

/** Why the job is stuck, in words ("3 tests failed"), or null when it isn't. */
export function stuckReason(job: Job): string | null {
  const blocked = job.stageState === 'blocked' && !PR_STAGES.has(job.stage ?? '');
  const failing = typeof job.laneReason === 'string' && /\b(fail(ed|ing|s)?|stuck|broke|broken)\b/i.test(job.laneReason);
  if (!blocked && !failing) return null;
  const from = failing ? String(job.laneReason) : String(job.headline ?? job.laneReason ?? '');
  // "Price rounding · 3 tests failed" → "3 tests failed".
  const tail = from.split(' · ').at(-1)?.trim() ?? '';
  return tail ? lowerFirst(tail) : 'it can’t go on by itself';
}

/** Who a stuck job's stop belongs to: the crew member for its stage, else the Foreman. */
export function stuckWho(job: Job): string {
  return STAGE_CHARACTER[job.stage ?? ''] ?? 'conductor';
}

const progressOf = (a: AgentFacts): number | null => {
  if (a.progress && a.progress.total > 0) return Math.min(1, a.progress.done / a.progress.total);
  const m = /(\d[\d,]*)\s+of\s+(\d[\d,]*)/.exec(String(a.doing ?? ''));
  if (!m) return null;
  const done = Number(m[1].replace(/,/g, ''));
  const total = Number(m[2].replace(/,/g, ''));
  return total > 0 ? Math.min(1, done / total) : null;
};

/** The pose for one agent. */
export function poseFor(agent: AgentFacts, facts: JobFacts): Pose {
  const { job } = facts;
  const who = agent.who;
  if (job.group === 'done') return 'done';
  if (usagePaused(job, facts.usage)) return 'paused';
  if (asksFor(facts, who, 'permission')) return 'asking';
  if (asksFor(facts, who, 'question')) return 'waiting';
  if (agent.status === 'stopped') return 'stuck';
  if (isConductor(who)) {
    if (facts.run?.status === 'error' && job.group !== 'running') return 'stuck';
    const stuck = stuckReason(job);
    if (stuck) return isConductor(stuckWho(job)) ? 'stuck' : 'watching';
    if (job.group === 'needs-you') return (job.permissions ?? 0) > 0 || job.waitingFor === 'permission' ? 'watching' : 'waiting';
    if (job.group === 'shipping') return 'done';
    if (job.group === 'running') {
      const k = kindOf(agent.doing);
      return k && k !== 'sending' ? k : 'watching';
    }
    return 'idle';
  }
  if (agent.status === 'waiting') return 'asking';
  const k = kindOf(agent.doing);
  if ((agent.quietMs ?? 0) >= QUIET_MS && (k === 'running' || k === null)) return 'asking';
  if (k === 'reading' || k === 'editing' || k === 'running') return k;
  return 'editing';
}

const ago = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};

/** The helpers' role words for the Foreman's line: "the Builder", "the Reviewer and 2 more". */
function crewWords(types: readonly string[]): string {
  if (!types.length) return '';
  const first = `the ${roleOf(types[0])}`;
  return types.length === 1 ? first : `${first} and ${types.length - 1} more`;
}

/** The words under a figure, always shown with it. */
export function labelFor(agent: AgentFacts, facts: JobFacts, crew: readonly string[] = []): string {
  const { job } = facts;
  const now = facts.now ?? new Date();
  const who = agent.who;
  const role = roleOf(isConductor(who) ? null : who);
  const pose = poseFor(agent, facts);
  const line = (rest: string) => `${role} · ${rest}`;
  const w = waited(job, now);
  const since = (s: string) => (w ? `${s} · ${w}` : s);
  switch (pose) {
    case 'done':
      if (job.group === 'done') return (job.closed as { as?: string } | null | undefined)?.as === 'dropped' ? 'Dropped' : 'Done';
      return line(lowerFirst(typeof job.laneReason === 'string' && job.laneReason ? job.laneReason : shippingWhere(job) || 'past the finish line'));
    case 'paused': {
      if (!isConductor(who)) return line('paused for the usage limit');
      const at = clockTime(job.limitPaused ?? facts.usage?.resetsAt ?? null, now);
      return at ? `Paused until the limit resets, ${at}` : 'Paused until the limit resets';
    }
    case 'asking': {
      const p = asksFor(facts, who, 'permission');
      if (p) return line(`asks to ${askWords(p as Permission & { displayName?: unknown })}`);
      if (agent.status === 'waiting') return line(lowerFirst(agent.doing || 'waiting for you to allow a step'));
      return line(`may need you in its terminal · quiet ${ago(agent.quietMs ?? 0)}`);
    }
    case 'waiting': {
      if (asksFor(facts, who, 'question')) return line(since('waiting for your answer'));
      if (job.waitingFor === 'approval') return line(since('waiting for your go-ahead'));
      if (job.waitingFor === 'answers') return line(since('waiting for your answer'));
      return line(since('waiting for your reply'));
    }
    case 'stuck': {
      if (isConductor(who) && facts.run?.status === 'error' && job.group !== 'running') return line('stopped: the last reply ended with a problem');
      return line(`stopped: ${stuckReason(job) ?? lowerFirst(agent.doing || 'it can’t go on by itself')}`);
    }
    case 'watching': {
      const stuck = stuckReason(job);
      if (stuck) return line(`waiting with the ${roleOf(stuckWho(job))}`);
      if (job.group === 'needs-you') {
        const asking = (facts.permissions ?? []).find((p) => p.slug === job.slug && p.kind !== 'question' && p.agentType && p.agentType !== 'conductor');
        return line(since(asking ? `waiting for you to answer the ${roleOf(asking.agentType)}` : 'waiting for you to allow a step'));
      }
      const k = kindOf(agent.doing);
      if (k === 'sending') {
        const m = /^Sending work to ([\w-]+)/.exec(String(agent.doing));
        return line(m ? `sending work to the ${roleOf(m[1])}` : lowerFirst(String(agent.doing)));
      }
      if (job.starting) return line('starting the job');
      return line(crew.length ? `watching ${crewWords(crew)}` : 'thinking');
    }
    case 'idle':
      if (job.stageState === 'paused') return line('stopped; waiting for your next message');
      return line(typeof job.laneReason === 'string' && job.laneReason ? lowerFirst(job.laneReason) : 'idle');
    default: {
      const doing = agent.doing ? lowerFirst(agent.doing) : 'working';
      const p = agent.progress;
      const count = p && p.total > 0 && !/\d+\s+of\s+\d+/.test(doing) ? ` · ${p.done} of ${p.total}` : '';
      return line(`${doing}${count}`);
    }
  }
}

// ---------- A whole bench ----------

const LAMP: Record<string, LampGroup> = { 'needs-you': 'needs-you', running: 'running', paused: 'paused', idle: 'idle', shipping: 'shipping', done: 'done' };
const ROLE_ORDER = CREW_PACK.map((m) => m.type);
const rank = (who: string) => { const i = ROLE_ORDER.indexOf(who); return i < 0 ? ROLE_ORDER.length : i; };

interface NowLine { who?: string; doing?: string | null; since?: string | null; quietMs?: number | null }

/** One job's bench: its status in words and its figures, the Foreman first, then up to three helpers. */
export function benchFor(job: Job, index: number, facts: Omit<JobFacts, 'job'>): FloorBench {
  const f: JobFacts = { ...facts, job };
  const now = facts.now ?? new Date();
  const status = jobStatus(job, now);
  const lines = (Array.isArray(job.nowDoing) ? (job.nowDoing as NowLine[]) : []).filter((d) => typeof d?.who === 'string');
  const foremanLine = lines.find((d) => d.who === 'conductor');
  let helpers: AgentFacts[] = job.group === 'done' ? [] : lines.filter((d) => d.who !== 'conductor').map((d) => ({ who: d.who as string, doing: d.doing, since: d.since, quietMs: d.quietMs }));
  // A crew member who asks for a permission is at the bench even if its line has gone quiet.
  for (const p of facts.permissions ?? []) {
    if (p.slug === job.slug && p.agentType && p.agentType !== 'conductor' && !helpers.some((h) => h.who === p.agentType)) helpers.push({ who: p.agentType });
  }
  // A stuck stop's crew member sits at the bench with its sign.
  const stuck = stuckReason(job);
  const stuckType = stuck ? stuckWho(job) : null;
  if (stuckType && !isConductor(stuckType) && job.group !== 'done') {
    helpers = helpers.filter((h) => h.who !== stuckType);
    helpers.unshift({ who: stuckType, status: 'stopped' });
  }
  helpers.sort((a, b) => (a.status === 'stopped' ? -1 : 0) - (b.status === 'stopped' ? -1 : 0) || rank(a.who) - rank(b.who));
  const shown = helpers.slice(0, MAX_HELPERS);
  const crewTypes = shown.map((h) => h.who);
  const foreman: AgentFacts = { who: 'conductor', doing: foremanLine?.doing ?? null, since: foremanLine?.since ?? null };
  const seen = new Map<string, number>();
  const figure = (a: AgentFacts, seat: Seat): FloorFigure => {
    const n = seen.get(a.who) ?? 0;
    seen.set(a.who, n + 1);
    const pose = poseFor(a, f);
    return {
      key: `${job.slug}:${a.who}:${n}`,
      who: a.who,
      role: roleOf(isConductor(a.who) ? null : a.who),
      prop: propFor(a.who),
      pose,
      seat,
      progress: pose === 'running' ? progressOf(a) : null,
      label: labelFor(a, f, isConductor(a.who) ? crewTypes : []),
    };
  };
  return {
    slug: job.slug,
    index,
    title: job.title || job.slug,
    lamp: LAMP[status.group] ?? 'idle',
    glyph: status.glyph,
    status: status.label,
    stop: job.stage ? stageLabel(job.stage) : '',
    figures: [figure(foreman, 'head'), ...shown.map((h, i) => figure(h, i as Seat))],
    more: Math.max(0, helpers.length - shown.length),
  };
}
