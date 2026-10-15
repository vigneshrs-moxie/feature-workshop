// The open job's header: title, kind, repository and branch, what it has cost so far, its status,
// its permission setting, whether it was marked done or dropped, and the job menu:
//   Mark done or dropped… (the classic options, in a sheet), Reopen, Options and the job's classic
//   page (decision D4), and this job's own permission setting (POST /api/job/:slug/policy).
// ⌘K offers the same actions (app/commands.ts); both call app/jobActions.ts.
import { useEffect, useRef, useState } from 'react';
import type { Job, PolicyId, Run } from '../../api/types';
import { reopenJob, setJobPolicy } from '../../app/jobActions';
import { classicHref } from '../../app/router';
import { useUi } from '../../app/ui';
import { autoBlockedReason, autoModeOf, HARD_LINES_NOTE, POLICIES, policyLabel } from '../../components/permissions/policies';
import { fullTime, relativeTime, useNow } from '../../lib/time';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { jobHueStyle } from '../../theme/hue';
import { GROUP_HINTS, GROUP_LABELS } from '../Jobs/jobStatus';
import { formatCost, isActiveRun } from './thread';

const KIND_LABELS: Record<string, string> = { feature: 'Feature', bug: 'Bug fix' };

/** This job's own permission setting (null: it follows yours), and the one in force. */
function useJobPolicy(dir: string | null | undefined, fromDetail: PolicyId | null | undefined) {
  const { meta } = useWorkshopState();
  const settings = meta?.settings;
  // The live settings win (they follow changes from other tabs); the job's detail fills in before they arrive.
  const override = dir && settings?.jobPolicy ? settings.jobPolicy[dir] ?? null : fromDetail ?? null;
  const global: PolicyId = settings?.policy ?? 'hands-off';
  return { override, global, effective: override ?? global, auto: autoModeOf(settings) };
}

interface MenuProps {
  job: Job;
  dir?: string | null;
  policyOverride?: PolicyId | null;
  run?: Run | null;
  worktree?: string | null;
}

function JobMenu({ job, dir, policyOverride, run, worktree }: MenuProps) {
  const { api, store } = useWorkshop();
  const ui = useUi();
  const slug = job.slug;
  const { override, global, auto } = useJobPolicy(dir, policyOverride);
  const blocked = autoBlockedReason(auto);
  const running = isActiveRun(run);
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

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
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
        title="More things you can do with this job. ⌘K lists them too."
      >
        Job menu <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="job-menu-list">
          {!job.closed && (
            <li>
              <button
                type="button"
                disabled={busy || running}
                onClick={() => { setOpen(false); ui.openSheet({ kind: 'close-job', slug, worktree: worktree ?? null }); }}
                title={running ? 'The Foreman is replying. Stop the reply first, then mark the job.' : 'Move it to Done, as done or dropped, with an optional note. Nothing is deleted and you can reopen it any time.'}
              >
                Mark done or dropped…
              </button>
            </li>
          )}
          {(job.closed || job.closedEarlier) && (
            <li>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(() => reopenJob(api, slug))}
                title={job.closed ? 'Put it back among the open jobs. Nothing else changes; the Foreman isn’t contacted.' : 'It was marked done or dropped earlier and has changed since. Keep it open for good.'}
              >
                {job.closed ? 'Reopen' : 'Keep it open'}
              </button>
            </li>
          )}
          <li><a href={classicHref.job(slug)} title="Change this job’s options on its classic page (the Options button there): stages, reviewers, notes for the Foreman.">Options (classic view)</a></li>
          <li><a href={classicHref.job(slug)} title="Open this job in the classic view: try it on your computer, details, costs and options.">Open in classic view</a></li>
          <li role="presentation"><p className="job-menu-heading" id={`perm-${slug}`}>Permissions for this job</p></li>
          <li>
            <ul role="group" aria-labelledby={`perm-${slug}`}>
              <li>
                <button type="button" role="menuitemradio" aria-checked={override === null} disabled={busy} onClick={() => void act(() => setJobPolicy(api, store, slug, dir, null))} title="Use your global setting from Settings, and follow it when you change it.">
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
                      onClick={() => void act(() => setJobPolicy(api, store, slug, dir, p.id))}
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

export interface JobHeaderProps {
  job: Job;
  branch?: string | null;
  dir?: string | null;
  policyOverride?: PolicyId | null;
  run?: Run | null;
  worktree?: string | null;
}

export function JobHeader({ job, branch, dir, policyOverride, run, worktree }: JobHeaderProps) {
  const now = useNow();
  const kind = job.kind ? KIND_LABELS[job.kind] ?? job.kind : null;
  const repo = job.repo?.name ?? null;
  const br = branch ?? job.repo?.branch ?? null;
  // source 'none': the dashboard found no cost records yet, so show nothing rather than $0.00.
  const cost = job.cost?.source === 'none' ? '' : formatCost(job.cost?.totalUsd);
  const costHint = job.cost?.source === 'estimate' ? 'What this job has cost so far (an estimate from its sessions’ token counts).' : 'What this job has cost so far.';
  const policy = useJobPolicy(dir, policyOverride);
  const closed = job.closed ?? null;
  const ago = closed ? relativeTime(closed.at, now) : '';
  return (
    <header className="job-header">
      <div className="job-header-line">
        <span className="hue-dot" style={jobHueStyle(job.slug)} aria-hidden="true" />
        <h2 className="pane-title job-title">{job.title || job.slug}</h2>
        <JobMenu job={job} dir={dir} policyOverride={policyOverride} run={run} worktree={worktree} />
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
      {closed && (
        <p className="closed-note muted" title={`Marked on ${fullTime(closed.at)}. Reopen it from the job menu; sending the Foreman a message reopens it too.`}>
          <strong>{closed.as === 'done' ? 'Marked done' : 'Dropped'}</strong> {ago && (/^\d+[mhd]$/.test(ago) ? `${ago} ago` : ago)}
          {closed.note ? `: “${closed.note}”` : ''}.{closed.worktreeRemoved ? ' Its worktree was removed; the branch is kept.' : ''}
        </p>
      )}
    </header>
  );
}
