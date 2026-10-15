// The open job's header: title, kind, repository and branch, what it has cost so far, its status,
// its permission setting, and the job menu. The menu links to the classic page and sets this job's
// own permission setting (POST /api/job/:slug/policy); Mark done, Reopen and Options arrive in plan
// step 9 (and are shown disabled until then).
import { useEffect, useRef, useState } from 'react';
import type { Job, JobPolicyResult, PolicyId } from '../../api/types';
import { classicHref } from '../../app/router';
import { autoBlockedReason, autoModeOf, HARD_LINES_NOTE, POLICIES, policyLabel } from '../../components/permissions/policies';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { jobHueStyle } from '../../theme/hue';
import { GROUP_HINTS, GROUP_LABELS } from '../Jobs/jobStatus';
import { formatCost } from './thread';

const KIND_LABELS: Record<string, string> = { feature: 'Feature', bug: 'Bug fix' };
const SOON = 'Coming to this view soon. Use the classic view for this for now.';

/** This job's own permission setting (null: it follows yours), and the one in force. */
function useJobPolicy(dir: string | null | undefined, fromDetail: PolicyId | null | undefined) {
  const { meta } = useWorkshopState();
  const settings = meta?.settings;
  // The live settings win (they follow changes from other tabs); the job's detail fills in before they arrive.
  const override = dir && settings?.jobPolicy ? settings.jobPolicy[dir] ?? null : fromDetail ?? null;
  const global: PolicyId = settings?.policy ?? 'hands-off';
  return { override, global, effective: override ?? global, auto: autoModeOf(settings) };
}

function JobMenu({ slug, dir, policyOverride }: { slug: string; dir?: string | null; policyOverride?: PolicyId | null }) {
  const { api, store } = useWorkshop();
  const { override, global, auto } = useJobPolicy(dir, policyOverride);
  const blocked = autoBlockedReason(auto);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  async function choose(policy: PolicyId | null) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<JobPolicyResult>(`/api/job/${encodeURIComponent(slug)}/policy`, { policy });
      const settings = store.getState().meta?.settings;
      if (settings && dir) {
        const jobPolicy = { ...(settings.jobPolicy ?? {}) };
        if (r.policyOverride) jobPolicy[dir] = r.policyOverride; else delete jobPolicy[dir];
        store.dispatch({ type: 'settings', settings: { ...settings, jobPolicy } });
      }
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

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
          <li role="presentation"><p className="job-menu-heading" id={`perm-${slug}`}>Permissions for this job</p></li>
          <li>
            <ul role="group" aria-labelledby={`perm-${slug}`}>
              <li>
                <button type="button" role="menuitemradio" aria-checked={override === null} disabled={busy} onClick={() => void choose(null)} title="Use your global setting from Settings, and follow it when you change it.">
                  {override === null ? '✓ ' : ''}Follow my setting ({policyLabel(global)})
                </button>
              </li>
              {POLICIES.map((p) => {
                const off = p.id === 'auto' && blocked !== null && override !== 'auto';
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={override === p.id}
                      disabled={busy || off}
                      onClick={() => void choose(p.id)}
                      title={off ? `Not available: ${blocked}` : `${p.hint} Only this job; it applies at once, also to a reply in progress. ${HARD_LINES_NOTE}`}
                    >
                      {override === p.id ? '✓ ' : ''}{p.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
          {error && <li><p className="field-problem menu-error" role="alert">{error}</p></li>}
        </ul>
      )}
    </div>
  );
}

export function JobHeader({ job, branch, dir, policyOverride }: { job: Job; branch?: string | null; dir?: string | null; policyOverride?: PolicyId | null }) {
  const kind = job.kind ? KIND_LABELS[job.kind] ?? job.kind : null;
  const repo = job.repo?.name ?? null;
  const br = branch ?? job.repo?.branch ?? null;
  // source 'none': the dashboard found no cost records yet, so show nothing rather than $0.00.
  const cost = job.cost?.source === 'none' ? '' : formatCost(job.cost?.totalUsd);
  const costHint = job.cost?.source === 'estimate' ? 'What this job has cost so far (an estimate from its sessions’ token counts).' : 'What this job has cost so far.';
  const policy = useJobPolicy(dir, policyOverride);
  return (
    <header className="job-header">
      <div className="job-header-line">
        <span className="hue-dot" style={jobHueStyle(job.slug)} aria-hidden="true" />
        <h2 className="pane-title job-title">{job.title || job.slug}</h2>
        <JobMenu slug={job.slug} dir={dir} policyOverride={policyOverride} />
      </div>
      <p className="job-facts muted">
        <span className={`status status-${job.group}`} title={GROUP_HINTS[job.group]}>{GROUP_LABELS[job.group] ?? job.group}</span>
        {kind && <span title="What kind of job this is.">{kind}</span>}
        {repo && <span title="The repository this job works in.">{repo}</span>}
        {br && <span className="num" title="The git branch this job builds on.">{br}</span>}
        {cost && <span className="num" title={costHint}>{cost}</span>}
        <span className="job-policy" title={`How much the Foreman may do without asking you${policy.override ? ' (this job’s own setting)' : ' (your global setting)'}. Change it in the job menu.`}>
          {policyLabel(policy.effective)}{policy.override ? ' · this job' : ''}
        </span>
      </p>
    </header>
  );
}
