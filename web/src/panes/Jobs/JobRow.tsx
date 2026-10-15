// One job in the Jobs pane: hue dot, title, then the status glyph and label, the stage chip and how
// long ago it last changed. In the icon rail it shrinks to the hue dot and glyph, with the rest in
// its hover hint and its accessible name.
import type { Job } from '../../api/types';
import { jobHref } from '../../app/router';
import { fullTime, relativeTime } from '../../lib/time';
import { jobHueStyle } from '../../theme/hue';
import { jobStatus } from './jobStatus';
import { stageHint, stageLabel } from './stages';

export interface JobRowProps {
  job: Job;
  selected: boolean;
  now: Date;
  rail?: boolean;
}

export function JobRow({ job, selected, now, rail = false }: JobRowProps) {
  const status = jobStatus(job, now);
  const title = job.title || job.slug;
  const stage = job.group === 'done' ? '' : stageLabel(job.stage);
  const ago = relativeTime(job.updatedAt, now);
  const dot = <span className="hue-dot" style={jobHueStyle(job.slug)} aria-hidden="true" />;
  const glyph = <span className={`glyph status-${status.group}`} aria-hidden="true">{status.glyph}</span>;

  if (rail) {
    const name = [title, status.label, stage, ago && `updated ${/^\d+[mhd]$/.test(ago) ? `${ago} ago` : ago}`].filter(Boolean).join(' · ');
    return (
      <a className="job-rail-item" href={jobHref(job.slug)} aria-current={selected ? 'page' : undefined} aria-label={name} title={`${name}. ${status.hint}`}>
        {dot}
        {glyph}
      </a>
    );
  }

  return (
    <a className="job-row" href={jobHref(job.slug)} aria-current={selected ? 'page' : undefined} title={`Open ${title}: its conversation with the Foreman.`}>
      <span className="job-row-line">
        {dot}
        <span className="job-row-title">{title}</span>
        {ago && (
          <time className="job-row-time num" dateTime={job.updatedAt ?? undefined} title={`Last change: ${fullTime(job.updatedAt)}`}>{ago}</time>
        )}
      </span>
      <span className="job-row-line job-row-meta">
        <span className={`job-status status-${status.group}`} title={status.hint}>
          {glyph}
          <span className="job-status-label">{status.label}</span>
        </span>
        {stage && <span className="stage-chip" title={stageHint(job.stage)}>{stage}</span>}
      </span>
    </a>
  );
}
