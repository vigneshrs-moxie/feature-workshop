// One job in the Jobs pane (Light, §12): crew member (Play on), hue dot, title and the age on the
// right; under them one status word, the stage chip only when the job needs you (so only the rows
// that want something carry a chip), and a shipping job's muted "where" instead. In the icon rail
// it shrinks to the hue dot and glyph, with the rest in its hover hint and its accessible name.
import type { Job } from '../../api/types';
import { jobHref } from '../../app/router';
import { fullTime, relativeTime } from '../../lib/time';
import { RowCrew } from '../../play/RowCrew';
import { usePlayIfAny } from '../../play/usePlay';
import { jobHueStyle } from '../../theme/hue';
import { jobStatus, shippingWhere } from './jobStatus';
import { stageFamily, stageHint, stageLabel } from './stages';

const PARKED_HINT = 'A decision has waited for you for more than 4 hours. Nothing goes ahead until you decide; nothing is approved for you.';

export interface JobRowProps {
  job: Job;
  selected: boolean;
  now: Date;
  rail?: boolean;
}

export function JobRow({ job, selected, now, rail = false }: JobRowProps) {
  const status = jobStatus(job, now);
  const title = job.title || job.slug;
  const shipping = job.group === 'shipping';
  const stage = job.group === 'needs-you' ? stageLabel(job.stage) : '';
  // Past the finish line: where the work is, in a muted word, instead of a stage chip.
  const where = shipping ? shippingWhere(job) : '';
  const ago = relativeTime(job.updatedAt, now);
  const dot = <span className="hue-dot" style={jobHueStyle(job.slug)} aria-hidden="true" />;
  const glyph = <span className={`glyph status-${status.group}`} aria-hidden="true">{status.glyph}</span>;
  // A decision left waiting past the parking time (decision D3): still under Needs you, marked parked.
  const parked = Boolean(job.parked) && job.group === 'needs-you';
  const crew = Boolean(usePlayIfAny()?.on);

  if (rail) {
    const name = [title, status.label, parked && 'parked 4h', stage, where, ago && `updated ${/^\d+[mhd]$/.test(ago) ? `${ago} ago` : ago}`].filter(Boolean).join(' · ');
    return (
      <a className="job-rail-item" data-group={status.group} href={jobHref(job.slug)} aria-current={selected ? 'page' : undefined} aria-label={name} title={`${name}. ${status.hint}`}>
        {dot}
        {glyph}
      </a>
    );
  }

  return (
    <a className={crew ? 'job-row has-crew' : 'job-row'} data-group={status.group} href={jobHref(job.slug)} aria-current={selected ? 'page' : undefined} title={`Open ${title}: its conversation with the Foreman.`}>
      {crew && <RowCrew job={job} now={now} />}
      <span className="job-row-line">
        {dot}
        <span className="job-row-title">{title}</span>
        {ago && (
          <time className="job-row-time num" dateTime={job.updatedAt ?? undefined} title={`Last change: ${fullTime(job.updatedAt)}`}>{ago}</time>
        )}
      </span>
      <span className="job-row-line job-row-meta">
        <span className={`job-status status-${status.group}`} data-group={status.group} title={status.hint}>
          {glyph}
          <span className="job-status-label">{status.label}</span>
        </span>
        {stage && <span className="stage-chip" data-stage={stageFamily(job.stage)} title={stageHint(job.stage)}>{stage}</span>}
        {where && <span className="muted job-row-where" title="Where this job’s work is on its way to main.">{where}</span>}
        {parked && <span className="chip gate-parked job-row-parked" title={PARKED_HINT}>parked 4h</span>}
      </span>
    </a>
  );
}
