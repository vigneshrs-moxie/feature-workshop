// Invented jobs and helpers for the store tests. No real job names.
import type { Job, LiveEvent, Permission, Snapshot } from '../api/types';

export function job(slug: string, group: Job['group'], extra: Partial<Job> = {}): Job {
  return { slug, title: `Job ${slug}`, group, permissions: 0, ...extra };
}

export function snapshot(extra: Partial<Snapshot> = {}): Snapshot {
  return {
    v: 2,
    seq: 10,
    epoch: 'aaaa',
    meta: { token: 'tok-1' },
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
