// The Auto line every step body shares: what Auto did at the step, read from GET /api/job/:slug/auto
// as What Auto decided reads it, only on a job Auto has run on. An older record (no kinds), a failed
// read or no entries for the step draw no line, never an error.
import { useEffect, useState } from 'react';
import type { AutoDecision, Job, StopId } from '../../api/types';
import { Icon, type IconName } from '../../components/Icon';
import { useWorkshop } from '../../state/store';
import './page.css';

const REASONS = 'What Auto decided has the reasons.';

/**
 * Auto's entries for the job, newest first; null while reading, after a failed read, or on a job Auto
 * never ran on. Read again when the job changes, keeping the last answer meanwhile; another job's
 * answer is never shown for this one.
 */
export function useAutoEntries(slug: string, job: Pick<Job, 'auto' | 'updatedAt'>): AutoDecision[] | null {
  const { api } = useWorkshop();
  const ran = Boolean(job.auto?.ran);
  const changedAt = job.updatedAt ?? null;
  // The answer with the job it is for, so a new slug reads as nothing until its own answer comes.
  const [read, setRead] = useState<{ slug: string; entries: AutoDecision[] | null } | null>(null);
  useEffect(() => {
    if (!ran) { setRead(null); return; }
    let off = false;
    api.get<{ entries?: unknown }>(`/api/job/${encodeURIComponent(slug)}/auto`).then(
      (d) => { if (!off) setRead({ slug, entries: d && Array.isArray(d.entries) ? (d.entries as AutoDecision[]).filter((e) => e && typeof e === 'object') : null }); },
      () => { if (!off) setRead({ slug, entries: null }); },
    );
    return () => { off = true; };
  }, [api, slug, ran, changedAt]);
  const entries = ran && read?.slug === slug ? read.entries : null;
  if (!entries) return null;
  // Newest first: the laptop sends them that way; put in order again only when every time is readable.
  const sorted = [...entries];
  if (sorted.every((e) => Number.isFinite(Date.parse(e.at)))) sorted.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return sorted;
}

/** Auto is stopped on the job now and waits for him: Auto is on and the job's Auto record names a stop. */
export const autoStoppedNow = (job: Pick<Job, 'auto'>): boolean => {
  if (job.auto?.on !== true) return false;
  const stopped = job.auto.stopped;
  return typeof stopped === 'string' ? stopped.trim() !== '' : Boolean(stopped && typeof stopped === 'object');
};

/** The job's newest stop entry (entries newest first), when it is this step's. Whether Auto is still stopped is the caller's to check. */
export function stopHere(entries: AutoDecision[], step: StopId): AutoDecision | null {
  const newest = entries.find((e) => e.kind === 'stop');
  return newest && newest.stop === step ? newest : null;
}

/** "Auto stopped here: {reason}." from a stop entry; null when it gives no reason. */
export const stoppedWords = (e: AutoDecision): string | null => {
  const reason = (e.chose ?? '').trim();
  return reason ? `Auto stopped here: ${/[.!?…]['"”’)\]]*$/.test(reason) ? reason : `${reason}.`}` : null;
};

/**
 * The Auto line at the top of a step, from that step's entries (newest first): Auto's stop while
 * Auto is stopped now (stoppedNow) and its newest stop is this step's, else what it answered and
 * approved. One entry can hold several answers. approved names what the step's go-ahead approved
 * ("spec v1"), when known. Null: no line (an older record with no kinds, no entries for the step,
 * or only permissions allowed).
 */
export function autoLineWords(entries: AutoDecision[] | null, step: StopId, approved: string | null = null, stoppedNow = false): { words: string; icon: IconName } | null {
  if (!entries || !entries.some((e) => e.kind)) return null;
  const stop = stoppedNow ? stopHere(entries, step) : null;
  const stopped = stop && stoppedWords(stop);
  if (stopped) return { words: stopped, icon: 'octagon-pause' };
  const mine = entries.filter((e) => e.stop === step);
  const answers = mine.filter((e) => e.kind === 'answer').reduce((n, e) => n + (Array.isArray(e.answers) && e.answers.length ? e.answers.length : 1), 0);
  const approvedIt = mine.some((e) => e.kind === 'approve');
  const question = answers > 1 ? 'this step’s questions' : 'this step’s question';
  if (answers && approvedIt) return { words: `Auto answered ${question} and approved ${approved ?? 'it'}. ${REASONS}`, icon: 'bot' };
  if (approvedIt) return { words: `Auto approved this step. ${REASONS}`, icon: 'bot' };
  if (answers) return { words: `Auto answered ${question}. ${REASONS}`, icon: 'bot' };
  return null;
}

export function AutoLine({ words, icon }: { words: string; icon: IconName }) {
  return <p className="sb-auto-line"><Icon name={icon} size={15} /><span>{words}</span></p>;
}

/** The Auto line for a step, read for itself: nothing on a job Auto never ran on. */
export function StepAutoLine({ slug, job, step, approved = null }: { slug: string; job: Job; step: StopId; approved?: string | null }) {
  const line = autoLineWords(useAutoEntries(slug, job), step, approved, autoStoppedNow(job));
  return line ? <AutoLine {...line} /> : null;
}
