// What a job's row says about its status: a glyph, a short text label (status is never shown by
// colour alone) and a hover hint in plain words. The group comes from the dashboard
// (dashboard/lib/snapshot.js); the label adds the detail the row has room for.
import type { Job, JobGroup } from '../../api/types';
import { clockTime } from '../../lib/time';

export interface JobStatus {
  group: JobGroup;
  glyph: string;
  label: string;
  hint: string;
}

export const GROUP_LABELS: Record<JobGroup, string> = {
  'needs-you': 'Needs you',
  running: 'Running',
  paused: 'Paused',
  idle: 'Idle',
  done: 'Done',
};

export const GROUP_GLYPHS: Record<JobGroup, string> = {
  'needs-you': '◆',
  running: '◐',
  paused: '‖',
  idle: '○',
  done: '✓',
};

export const GROUP_HINTS: Record<JobGroup, string> = {
  'needs-you': 'Jobs waiting for you: a permission click, a question, or your go-ahead.',
  running: 'Jobs the Foreman or its crew are working on right now.',
  paused: 'Jobs stopped by the Claude usage limit. They carry on when it resets.',
  idle: 'Jobs where nothing is happening and nothing is asked of you. Send a message to carry on.',
  done: 'Finished jobs, and jobs you marked done or dropped. Their conversations stay readable.',
};

const closedAs = (job: Job): string | null => {
  const c = job.closed as { as?: string } | undefined;
  return c && typeof c === 'object' ? (c.as === 'dropped' ? 'dropped' : 'done') : null;
};

export function jobStatus(job: Job, now: Date = new Date()): JobStatus {
  const group = job.group;
  const glyph = GROUP_GLYPHS[group] ?? GROUP_GLYPHS.idle;
  switch (group) {
    case 'needs-you': {
      const n = job.permissions ?? 0;
      if (n > 0 || job.waitingFor === 'permission') {
        return { group, glyph, label: n > 1 ? `${n} permissions` : 'Permission', hint: 'The Foreman wants your permission for an action. Open the job to allow or deny it.' };
      }
      if (job.waitingFor === 'answers') return { group, glyph, label: 'Question', hint: 'The Foreman asked you something. Open the job to answer.' };
      if (job.waitingFor === 'approval') return { group, glyph, label: 'Go-ahead', hint: 'The Foreman is waiting for your go-ahead before the next stage. Open the job to read the brief and reply.' };
      return { group, glyph, label: 'Your turn', hint: 'The Foreman is waiting for your reply. Open the job to see what it said.' };
    }
    case 'running':
      return job.starting
        ? { group, glyph, label: 'Starting', hint: 'This new job is starting up: the Foreman is reading your request.' }
        : { group, glyph, label: 'Working', hint: 'The Foreman or its crew are working on this job right now.' };
    case 'paused': {
      const at = clockTime(job.limitPaused, now);
      if (!at) return { group, glyph, label: 'Paused', hint: 'The Claude usage limit stopped this job. It carries on when the limit resets.' };
      return job.limitAuto === false
        ? { group, glyph, label: `limit resets ${at}`, hint: `The Claude usage limit stopped this job. The limit resets at ${at}; send a message then to carry on (automatic resume is off).` }
        : { group, glyph, label: `resumes ${at}`, hint: `The Claude usage limit stopped this job. It carries on by itself when the limit resets at ${at}.` };
    }
    case 'done':
      return closedAs(job) === 'dropped'
        ? { group, glyph: '–', label: 'Dropped', hint: 'You dropped this job. Its conversation stays readable, and you can reopen it.' }
        : { group, glyph, label: 'Done', hint: 'This job is finished. Its conversation stays readable, and you can reopen it.' };
    default:
      return job.stageState === 'paused'
        ? { group: 'idle', glyph, label: 'Stopped', hint: 'You stopped the last reply. The job waits for your next message.' }
        : { group: 'idle', glyph, label: 'Idle', hint: 'Nothing is happening and nothing is asked of you. Send a message to carry on.' };
  }
}
