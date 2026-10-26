// The top bar's status summary: how many jobs need you, are running and are paused, in words with
// each group's glyph ("◆ 1 needs you · ◐ 2 running"). Groups with none are left out; with nothing
// in any of them it says "All quiet". Clicking it opens Home.
import type { Job, JobGroup } from '../api/types';
import { GROUP_GLYPHS } from '../panes/Jobs/jobStatus';
import { hrefFor } from '../app/router';
import { useWorkshopState } from '../state/store';

const SHOWN: { group: JobGroup; words: (n: number) => string }[] = [
  { group: 'needs-you', words: () => 'needs you' },
  { group: 'running', words: () => 'running' },
  { group: 'paused', words: () => 'paused' },
];

/** The summary's parts, in order: only the groups with at least one job. */
export function statusParts(jobs: readonly Job[]): { group: JobGroup; count: number; text: string }[] {
  return SHOWN.map(({ group, words }) => {
    const count = jobs.filter((j) => j.group === group).length;
    return { group, count, text: `${count} ${words(count)}` };
  }).filter((p) => p.count > 0);
}

export function StatusSummary() {
  const { jobs } = useWorkshopState();
  const parts = statusParts(jobs);
  const words = parts.length ? parts.map((p) => p.text).join(', ') : 'All quiet: nothing running and nothing waiting for you';
  return (
    <a className="status-summary" href={hrefFor({ name: 'home' })} title={`${words}. Open Home to see every job.`}>
      {parts.length === 0 && <span className="status-summary-part">All quiet</span>}
      {parts.map((p, i) => (
        <span key={p.group} className="status-summary-part" data-group={p.group}>
          {i > 0 && <span className="status-summary-sep" aria-hidden="true">·</span>}
          <span className={`glyph status-${p.group}`} aria-hidden="true">{GROUP_GLYPHS[p.group]}</span>
          <span className="num">{p.count}</span> {p.text.replace(/^\d+ /, '')}
        </span>
      ))}
    </a>
  );
}
