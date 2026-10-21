// Invented jobs and helpers for the store tests. No real job names.
import type { Job, LevelInfo, LiveEvent, Permission, ReviewerInfo, Snapshot } from '../api/types';

/** meta.levels as the dashboard sends them (lib/options.js levelsForClient). */
const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
export const REVIEWERS: ReviewerInfo[] = [
  { id: 'feature-reviewer', label: 'Head inspector' }, { id: 'feature-review-permissions', label: 'Locksmith' },
  { id: 'feature-review-tests', label: 'Gauge' }, { id: 'feature-review-conventions', label: 'Stickler' },
  { id: 'feature-review-errors', label: 'Fuse' }, { id: 'feature-review-db', label: 'Mason' },
  { id: 'feature-review-performance', label: 'Stopwatch' }, { id: 'feature-review-ui', label: 'Painter' },
];
export const LEVELS: LevelInfo[] = [
  {
    level: 0, label: 'L0 Tweak', name: 'Tweak', flow: 'quick', hint: 'One build, then the checks (npm run check/build); you look at the diff. No plan to approve.',
    models: { foreman: OPUS, build: SONNET, checks: SONNET }, skip: ['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'spec-update', 'plan', 'test', 'review'], reviewers: [], manualTest: false, fable: [],
  },
  {
    level: 1, label: 'L1 Small', name: 'Small', flow: 'quick', hint: 'A quick plan you approve, then build, checks, you try it, one reviewer. Clarify questions and screens only when asked.',
    models: { foreman: OPUS, build: OPUS, checks: OPUS }, skip: ['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'spec-update'], reviewers: ['feature-reviewer'], manualTest: true, fable: [],
  },
  {
    level: 2, label: 'L2 Standard', name: 'Standard', flow: 'small', hint: 'Clarify questions, a short spec, screens when it has them, a plan you approve, build in steps, the tester, you try it, 3–4 reviewers.',
    models: { foreman: OPUS, build: OPUS, checks: SONNET }, skip: ['refine'], reviewers: 'auto', manualTest: true, fable: [],
  },
  {
    level: 3, label: 'L3 Large', name: 'Large', flow: 'large', hint: 'Clarify questions, spec, product interview, screens when it has them, investigation, a plan you approve, build in steps, the tester, you try it, every reviewer plus Fable.',
    models: { foreman: OPUS, build: OPUS, checks: SONNET }, skip: [], reviewers: REVIEWERS.map((r) => r.id), manualTest: true, fable: ['plan', 'review'],
  },
];

export function job(slug: string, group: Job['group'], extra: Partial<Job> = {}): Job {
  return { slug, title: `Job ${slug}`, group, permissions: 0, ...extra };
}

/** Where the fixtures' dashboard serves a job's screens page from (its own origin, meta.wireframesOrigin). */
export const SCREENS_ORIGIN = 'http://127.0.0.1:4478';

export function snapshot(extra: Partial<Snapshot> = {}): Snapshot {
  return {
    v: 2,
    seq: 10,
    epoch: 'aaaa',
    meta: { token: 'tok-1', wireframesOrigin: SCREENS_ORIGIN },
    jobs: [job('alpha', 'idle'), job('beta', 'running')],
    needsYou: 0,
    permissions: [],
    usage: { limited: false, blocking: false, label: null, resetsAt: null },
    generatedAt: '2026-10-15T12:00:00.000Z',
    ...extra,
  };
}

export function ev(seq: number, type: string, job: string | null = null, data: unknown = {}): LiveEvent {
  return { v: 2, type, job, data, seq };
}

export function permission(id: string, slug: string): Permission {
  return { id, slug, kind: 'tool', toolName: 'Bash', plain: { headline: 'Run a command' } };
}
