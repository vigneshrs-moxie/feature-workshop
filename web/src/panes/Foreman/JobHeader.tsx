// The open job's header: title, kind, repository and branch, what it has cost so far, its status,
// and the job menu. The menu is a stub in this step: it links to the classic page; Mark done,
// Reopen and Options arrive in plan step 9 (and are shown disabled until then).
import { useEffect, useRef, useState } from 'react';
import type { Job } from '../../api/types';
import { classicHref } from '../../app/router';
import { jobHueStyle } from '../../theme/hue';
import { GROUP_HINTS, GROUP_LABELS } from '../Jobs/jobStatus';
import { formatCost } from './thread';

const KIND_LABELS: Record<string, string> = { feature: 'Feature', bug: 'Bug fix' };
const SOON = 'Coming to this view soon. Use the classic view for this for now.';

function JobMenu({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="job-menu" ref={box}>
      <button
        type="button"
        className="btn btn-quiet"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="More things you can do with this job."
      >
        Job menu <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="job-menu-list">
          <li><a href={classicHref.job(slug)} title="Open this job in the classic view: try it on your computer, details, costs and options.">Open in classic view</a></li>
          <li><button type="button" disabled title={SOON}>Mark done</button></li>
          <li><button type="button" disabled title={SOON}>Reopen</button></li>
          <li><button type="button" disabled title={SOON}>Options</button></li>
        </ul>
      )}
    </div>
  );
}

export function JobHeader({ job, branch }: { job: Job; branch?: string | null }) {
  const kind = job.kind ? KIND_LABELS[job.kind] ?? job.kind : null;
  const repo = job.repo?.name ?? null;
  const br = branch ?? job.repo?.branch ?? null;
  // source 'none': the dashboard found no cost records yet, so show nothing rather than $0.00.
  const cost = job.cost?.source === 'none' ? '' : formatCost(job.cost?.totalUsd);
  const costHint = job.cost?.source === 'estimate' ? 'What this job has cost so far (an estimate from its sessions’ token counts).' : 'What this job has cost so far.';
  return (
    <header className="job-header">
      <div className="job-header-line">
        <span className="hue-dot" style={jobHueStyle(job.slug)} aria-hidden="true" />
        <h2 className="pane-title job-title">{job.title || job.slug}</h2>
        <JobMenu slug={job.slug} />
      </div>
      <p className="job-facts muted">
        <span className={`status status-${job.group}`} title={GROUP_HINTS[job.group]}>{GROUP_LABELS[job.group] ?? job.group}</span>
        {kind && <span title="What kind of job this is.">{kind}</span>}
        {repo && <span title="The repository this job works in.">{repo}</span>}
        {br && <span className="num" title="The git branch this job builds on.">{br}</span>}
        {cost && <span className="num" title={costHint}>{cost}</span>}
      </p>
    </header>
  );
}
