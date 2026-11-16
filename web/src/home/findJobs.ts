// Finding a job fast (16 Nov: "add a search bar in the jobs tab … and other features that make it
// easier to navigate and work faster"). Pure, so the Jobs page, the job page and the keys share it.
//
// matchJobs: every word he types must be somewhere in the job (its title, its ticket key ORBIT-906,
// its slug, repository and branch, its step, and what its lane says about it); the best matches first:
// a title that starts with the words, then a title that has them, then a ticket key, then the rest;
// ties keep the order given (the board's).
//
// nextNeedsYou: the job that has waited longest for him, other than the one he is on: what "Next
// needs you" (the job page's header) and the g n key open.

import type { Job } from '../api/types';
import { laneOf, nextJob } from './JobsPage';

/** The ticket key a slug names (orbit-906-… → ORBIT-906), as the server reads it. */
export function keyOfSlug(slug: string): string | null {
  const m = /^orbit-(\d{1,9})(?:-|$)/i.exec(slug);
  return m ? `ORBIT-${Number(m[1])}` : null;
}

/** The words a job is found by, lower case, the title first. */
export function haystackOf(job: Job): { title: string; key: string; rest: string } {
  const key = keyOfSlug(job.slug) ?? '';
  const rest = [job.slug, job.repo?.name, job.repo?.branch, job.stage, job.laneReason, job.headline, laneOf(job)]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .join(' ');
  return { title: (job.title || job.slug).toLowerCase(), key: key.toLowerCase(), rest: rest.toLowerCase() };
}

/** The jobs that match every word of `query`, best first; all of them, in order, for an empty query. */
export function matchJobs(jobs: readonly Job[], query: string): Job[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...jobs];
  // "906" finds ORBIT-906 as well as "orbit-906".
  const scored: { job: Job; score: number; at: number }[] = [];
  jobs.forEach((job, at) => {
    const h = haystackOf(job);
    const all = `${h.title} ${h.key} ${h.rest}`;
    if (!words.every((w) => all.includes(w))) return;
    const q = words.join(' ');
    const score = h.title.startsWith(q) ? 0 : words.every((w) => h.title.includes(w)) ? 1 : words.some((w) => h.key.includes(w)) ? 2 : 3;
    scored.push({ job, score, at });
  });
  return scored.sort((a, b) => a.score - b.score || a.at - b.at).map((s) => s.job);
}

/** The job that has waited longest for him, other than `current`; null when none waits. */
export function nextNeedsYou(jobs: readonly Job[], current: string | null = null): Job | null {
  return nextJob(jobs.filter((j) => j.slug !== current && !j.closed));
}

/** How many jobs wait for him, other than `current`. */
export function needsYouCount(jobs: readonly Job[], current: string | null = null): number {
  return jobs.filter((j) => j.slug !== current && !j.closed && laneOf(j) === 'needs-you').length;
}
