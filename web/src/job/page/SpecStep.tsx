// The Spec step's body in the open step (design 3.2): the job's screens in the page (the Screens tab's
// prototype, its hint and today's Review the screens button; on the website the Screens tab says the
// page opens on the laptop), and on an Auto job the line saying what Auto did at the step.
// Also the Auto line every step body shares (StepAutoLine): read from GET /api/job/:slug/auto as What
// Auto decided reads it, only on a job Auto has run on; an older record (no kinds), a failed read or
// no entries for the step draw no line, never an error.
import { useEffect, useState } from 'react';
import type { AutoDecision, Job, StageView, StopId } from '../../api/types';
import { screensHref } from '../../app/router';
import { Button } from '../../components/Button';
import { Icon, type IconName } from '../../components/Icon';
import { ScreensTab } from '../../panes/Preview/ScreensTab';
import { versionLabel } from '../../panes/Preview/docs';
import { useWorkshop } from '../../state/store';
import './page.css';

const REASONS = 'What Auto decided has the reasons.';

/**
 * Auto's entries for the job, newest first; null while reading, after a failed read, or on a job Auto
 * never ran on. Read again when the job changes, keeping the last answer meanwhile.
 */
export function useAutoEntries(slug: string, job: Pick<Job, 'auto' | 'updatedAt'>): AutoDecision[] | null {
  const { api } = useWorkshop();
  const ran = Boolean(job.auto?.ran);
  const changedAt = job.updatedAt ?? null;
  const [entries, setEntries] = useState<AutoDecision[] | null>(null);
  useEffect(() => {
    if (!ran) { setEntries(null); return; }
    let off = false;
    api.get<{ entries?: unknown }>(`/api/job/${encodeURIComponent(slug)}/auto`).then(
      (d) => { if (!off) setEntries(d && Array.isArray(d.entries) ? (d.entries as AutoDecision[]).filter((e) => e && typeof e === 'object') : null); },
      () => { if (!off) setEntries(null); },
    );
    return () => { off = true; };
  }, [api, slug, ran, changedAt]);
  if (!entries) return null;
  // Newest first: the laptop sends them that way; put in order again only when every time is readable.
  const sorted = [...entries];
  if (sorted.every((e) => Number.isFinite(Date.parse(e.at)))) sorted.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return sorted;
}

/** The step's stop entry, when it is the newest entry of the whole job: Auto stopped here and still waits. */
export function stopHere(entries: AutoDecision[], step: StopId): AutoDecision | null {
  const newest = entries[0];
  return newest && newest.kind === 'stop' && newest.stop === step ? newest : null;
}

/** "Auto stopped here: {reason}." from a stop entry; null when it gives no reason. */
export const stoppedWords = (e: AutoDecision): string | null => {
  const reason = (e.chose ?? '').trim();
  return reason ? `Auto stopped here: ${/[.!?]$/.test(reason) ? reason : `${reason}.`}` : null;
};

/**
 * The Auto line at the top of a step, from that step's entries (newest first): Auto's stop when it
 * is the job's newest entry, else what it answered and approved. approved names what the step's
 * go-ahead approved ("spec v1"), when known. Null: no line (an older record with no kinds, no
 * entries for the step, or only permissions allowed).
 */
export function autoLineWords(entries: AutoDecision[] | null, step: StopId, approved: string | null = null): { words: string; icon: IconName } | null {
  if (!entries || !entries.some((e) => e.kind)) return null;
  const stop = stopHere(entries, step);
  const stopped = stop && stoppedWords(stop);
  if (stopped) return { words: stopped, icon: 'octagon' };
  const mine = entries.filter((e) => e.stop === step);
  const answers = mine.filter((e) => e.kind === 'answer').length;
  const approvedIt = mine.some((e) => e.kind === 'approve');
  const question = answers > 1 ? 'this step’s questions' : 'this step’s question';
  if (answers && approvedIt) return { words: `Auto answered ${question} and approved ${approved ?? 'this step'}. ${REASONS}`, icon: 'check' };
  if (approvedIt) return { words: `Auto approved this step. ${REASONS}`, icon: 'check' };
  if (answers) return { words: `Auto answered ${question}. ${REASONS}`, icon: 'check' };
  return null;
}

export function AutoLine({ words, icon }: { words: string; icon: IconName }) {
  return <p className="sb-auto-line"><Icon name={icon} size={15} /><span>{words}</span></p>;
}

/** The Auto line for a step, read for itself: nothing on a job Auto never ran on. */
export function StepAutoLine({ slug, job, step, approved = null }: { slug: string; job: Job; step: StopId; approved?: string | null }) {
  const line = autoLineWords(useAutoEntries(slug, job), step, approved);
  return line ? <AutoLine {...line} /> : null;
}

/** "spec v1" from the step's documents (the spec's version), when known. */
function specApproved(view: StageView | null | undefined): string | null {
  const v = Array.isArray(view?.docs) ? view.docs.find((d) => d?.file === 'spec')?.version : null;
  return v ? `spec ${versionLabel(v)}` : null;
}

export function SpecStep({ slug, job, view = null }: { slug: string; job: Job; /** The step's view, for the spec's version in the Auto line; missing: not known. */ view?: StageView | null }) {
  const { api } = useWorkshop();
  const hosted = api.hosted?.() ?? false;
  const version = job.wireframes ? versionLabel(job.wireframes.version) : '';
  return (
    <div className="sb-step-body">
      <StepAutoLine slug={slug} job={job} step="spec" approved={specApproved(view)} />
      {job.wireframes && (
        <section className="sb-block" aria-label="Screens">
          <h3 className="eyebrow">{version ? `Screens · ${version}` : 'Screens'}</h3>
          <ScreensTab slug={slug} job={job} active />
          {!hosted && (
            <p><Button icon="eye" href={screensHref(slug)} title="The feature’s screens, full width: click through the prototype, pin notes and pick the design choices. Copy feedback puts them in your reply.">Review the screens</Button></p>
          )}
        </section>
      )}
    </div>
  );
}
