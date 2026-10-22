// The open job's header: title, kind, repository and branch, what it has cost so far, its status,
// its permission setting, whether it was marked done or dropped, and the job menu:
//   Mark done or dropped… (the classic options, in a sheet), Reopen, Notes and options… (the job
//   drawer), the job's classic page (decision D4), and this job's own permission setting
//   (POST /api/job/:slug/policy).
// ⌘K offers the same actions (app/commands.ts); both call app/jobActions.ts.
// The level chip (LevelChip.tsx) shows the job's level and changes it.
// The whole header stays still while the conversation scrolls under it (position: sticky on
// .job-header in app.css, "Job view and Desk (light round 2)"); "How this works" scrolls away.
// With Play on, the Foreman character stands by the title, its mood following the job, and the
// trail sits under the title line (play/JobTrail.tsx).
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
import { ForemanFace } from '../../play/ThreadCrew';
import { JobTrail } from '../../play/JobTrail';
import { LevelChip } from './LevelChip';
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
          <li>
            <button
              type="button"
              onClick={() => { setOpen(false); ui.openSheet({ kind: 'job-drawer', slug }); }}
              title="Open this job’s notes (notes.md, read by the Foreman every session) and its options: level, stages, reviewers, testing, Fable second looks and models."
            >
              Notes and options…
            </button>
          </li>
          <li><a href={classicHref.job(slug)} title="Open this job in the classic view: try it on your computer, details, costs and provided documents.">Open in classic view</a></li>
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
  /** Whether the job's detail has loaded: the level chip waits for it before it changes the level. */
  detailLoaded?: boolean;
}

/**
 * The stuck header's size. It tells the Foreman pane how tall it really is (--job-header-h on
 * .pane-foreman), so the pane and anything focused in the thread scroll clear of it; app.css keeps
 * an estimate for before the first measure.
 * Scrolled down, it goes compact (one slim row: the title, a thin trail, the level and the menu,
 * then "Your move"). It keeps its full height in the flow as a bottom margin, and turns compact
 * only once that freed room is scrolled out of sight, so the thread never jumps when it shrinks.
 */
function useStuckHeader() {
  const ref = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = ref.current;
    const pane = el?.closest<HTMLElement>('.pane-foreman');
    if (!el || !pane) return;
    let full = 0;
    let slim = 0;
    let isCompact = false;
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (!h) return; // not laid out (hidden, or no layout at all): keep the estimate
      if (isCompact) slim = h; else full = h;
      el.style.marginBottom = isCompact && full > h ? `${full - h}px` : '';
      pane.style.setProperty('--job-header-h', `${h}px`);
    };
    const onScroll = () => {
      // Until the slim height is known, guess it as a third of the full one.
      const next = full > 0 && pane.scrollTop >= full - (slim || full / 3);
      if (next === isCompact) return;
      isCompact = next;
      setCompact(next);
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    pane.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro?.disconnect();
      pane.removeEventListener('scroll', onScroll);
      pane.style.removeProperty('--job-header-h');
      el.style.marginBottom = '';
    };
  }, []);
  return { ref, compact };
}

export function JobHeader({ job, branch, dir, policyOverride, run, worktree, detailLoaded = false }: JobHeaderProps) {
  const now = useNow();
  const kind = job.kind ? KIND_LABELS[job.kind] ?? job.kind : null;
  const repo = job.repo?.name ?? null;
  const br = branch ?? job.repo?.branch ?? null;
  // One quiet line of facts (plan §4): the cost only once it is over 10 cents (source 'none': the
  // dashboard found no cost records yet), the permission setting only when it isn't the default.
  const cost = job.cost?.source === 'none' || !((job.cost?.totalUsd ?? 0) > 0.1) ? '' : formatCost(job.cost?.totalUsd);
  const costHint = job.cost?.source === 'estimate' ? 'What this job has cost so far (an estimate from its sessions’ token counts).' : 'What this job has cost so far.';
  const policy = useJobPolicy(dir, policyOverride);
  const policyShown = policy.override !== null || policy.global !== 'hands-off';
  const { usage } = useWorkshopState();
  const closed = job.closed ?? null;
  const { ref: headerRef, compact } = useStuckHeader();
  const ago = closed ? relativeTime(closed.at, now) : '';
  return (
    <header className={`job-header${compact ? ' is-compact' : ''}`} ref={headerRef}>
      <div className="job-header-line">
        <span className="hue-dot" style={jobHueStyle(job.slug)} aria-hidden="true" />
        {/* Play: the Foreman, its mood following the job (nothing with Play Off). */}
        <ForemanFace job={job} usage={usage} />
        <h2 className="pane-title job-title">{job.title || job.slug}</h2>
        <LevelChip job={job} ready={detailLoaded} />
        <JobMenu job={job} dir={dir} policyOverride={policyOverride} run={run} worktree={worktree} />
      </div>
      {/* Play: the trail (the stages as a path, who is on the current one, and what happens next). */}
      <JobTrail job={job} now={now} />
      <p className="job-facts muted">
        <span className={`status status-${job.group}`} data-group={job.group} title={GROUP_HINTS[job.group]}>{GROUP_LABELS[job.group] ?? job.group}</span>
        {kind && <span title="What kind of job this is.">{kind}</span>}
        {repo && <span title="The repository this job works in.">{repo}</span>}
        {br && <span className="num" title="The git branch this job builds on.">{br}</span>}
        {cost && <span className="num" title={costHint}>{cost}</span>}
        {policyShown && (
          <span className="job-policy" title={`How much the Foreman may do without asking you${policy.override ? ' (this job’s own setting)' : ' (your global setting)'}. Change it in the job menu.`}>
            {policyLabel(policy.effective)}{policy.override ? ' · this job' : ''}
          </span>
        )}
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
