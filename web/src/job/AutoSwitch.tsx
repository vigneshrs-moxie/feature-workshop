// The Auto switch: a checkbox, on the New job form (controlled; the job doesn't exist yet) and in
// the job header (it posts /api/job/:slug/auto and spins until the server answers). Auto lets the
// job run to its first pull request while a read-only agent answers for you; fixed rules stop it.
// At L3 it is off and disabled with the server's own sentence. In the header it also keeps one line
// (Auto is on / Auto stopped: why / Started by Auto) in a place reserved for it, so nothing moves
// when the line appears. On the hosted website the same POST is queued for the laptop: the job's
// `autoQueued` (a decision from the site, views/Hosted/QueuedDecision) says it waits, is on its way or was
// refused (with the laptop's own sentence), beside the switch, and the switch rests meanwhile.
// Self-contained: props in, no reach into the page.
import { useEffect, useId, useRef, useState } from 'react';
import type { Job, LevelNumber } from '../api/types';
import { OptionRow } from '../components/Choice';
import { useWorkshop } from '../state/store';
import { isOpen, needsLook, QueuedDecision, queuedOf, type QueuedView } from '../views/Hosted/QueuedDecision';
import { useSent } from '../lib/sentState';
import './auto.css';

export const AUTO_LABEL = 'Auto: run to PR #1 without asking me.';
export const AUTO_HINT = 'A Fable agent approves each step for you and takes the recommended answers. It stops and asks you when something is risky. It never merges.';
/** The server's sentence for a job above Auto's level: dashboard/lib/auto.js AUTO_L3 (the app can't import it, so keep the two the same). */
export const AUTO_L3 = 'Auto works up to L2. An L3 job needs you to approve each step.';

const aboveAuto = (v: unknown) => typeof v === 'number' && v > 2;
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface ViewProps {
  checked: boolean;
  blocked: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** The header's: the hint is not shown, it describes the checkbox (and is its title). Unless blocked: that sentence is shown. */
  quiet?: boolean;
  onToggle(next: boolean): void;
}

function SwitchView({ checked, blocked, disabled, busy, quiet, onToggle }: ViewProps) {
  const off = blocked || disabled;
  const hintId = useId();
  const hidden = quiet && !blocked;
  return (
    <>
    <OptionRow type="checkbox" className={`auto-switch-row${off ? ' is-off' : ''}`} checked={checked && !blocked} disabled={off} aria-busy={busy || undefined} aria-describedby={hidden ? hintId : undefined} title={hidden ? AUTO_HINT : undefined} onChange={(e) => onToggle(e.target.checked)}>
      {busy && <span className="auto-spin" role="status" aria-label={checked ? 'Turning Auto off…' : 'Turning Auto on…'}><span className="spin-ring" aria-hidden="true" /></span>}
      <span className="option-body">
        <span className="auto-switch-label">{AUTO_LABEL}</span>
        {!quiet && <span className="auto-switch-hint">{blocked ? AUTO_L3 : AUTO_HINT}</span>}
      </span>
    </OptionRow>
    {/* Outside the label, so it describes the checkbox without becoming part of its name. */}
    {hidden && <span id={hintId} className="sr-only">{AUTO_HINT}</span>}
    </>
  );
}

function HeaderSwitch({ job, onChange }: { job: Pick<Job, 'slug' | 'level' | 'suggestedLevel' | 'auto'> & { autoQueued?: unknown }; onChange?(on: boolean): void }) {
  const { api } = useWorkshop();
  const sent = useSent(`auto:${job.slug}`);
  const inflight = useRef(false);
  // What the server last answered, until the job's own record catches up.
  const [shown, setShown] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setShown(null); }, [job.auto?.on]);
  // The website's queue: what the site answered to the click, until the job's own record shows it.
  const [held, setHeld] = useState<QueuedView | null>(null);
  useEffect(() => { if (job.autoQueued) setHeld(null); }, [job.autoQueued]);
  const queued = queuedOf(job.autoQueued) ?? held;
  const waiting = isOpen(queued);
  const blocked = aboveAuto(job.level) || aboveAuto(job.suggestedLevel);
  const on = !blocked && (shown ?? job.auto?.on === true);

  async function toggle(next: boolean) {
    if (inflight.current || blocked) return;
    inflight.current = true;
    setError(null);
    sent.start();
    try {
      const answer = await api.post<{ held?: boolean; queued?: unknown } | undefined>(`/api/job/${encodeURIComponent(job.slug)}/auto`, { on: next });
      if (answer?.held) { setHeld(queuedOf(answer.queued)); return; } // the website queued it: the laptop does it, and the line says so
      setShown(next);
      onChange?.(next);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      inflight.current = false;
      sent.clear();
    }
  }

  const stopped = on && job.auto?.stopped ? job.auto.stopped : null;
  const tag = on && job.auto?.by === 'tag' && job.auto.tag ? job.auto.tag : null;
  return (
    <div className="auto-switch is-inline">
      <SwitchView quiet checked={on} blocked={blocked} disabled={sent.state === 'sending' || waiting} busy={sent.state === 'sending'} onToggle={(next) => { void toggle(next); }} />
      <p className="auto-line">
        {error ? <span className="is-refused" role="alert">{error}</span> : (
          <>
            {blocked && <span>{AUTO_L3}</span>}
            {stopped ? <span className="is-stopped">Auto stopped: {stopped}</span> : on && <span>Auto is on</span>}
            {tag && <span>Started by Auto (tag: {tag})</span>}
            {!stopped && !on && !tag && ' '}
          </>
        )}
      </p>
      {queued && (isOpen(queued) || needsLook(queued)) && <QueuedDecision queued={queued} onChange={() => setHeld(null)} />}
    </div>
  );
}

export interface AutoSwitchProps {
  /** The job page's switch: posts the change itself. Leave out on the New job form. */
  job?: Pick<Job, 'slug' | 'level' | 'suggestedLevel' | 'auto'> | null;
  /** The form's: the level picked so far (L3 turns it off), whether it is ticked, and its disabled state. */
  level?: LevelNumber | null;
  checked?: boolean;
  disabled?: boolean;
  /** Called with the new value: by the form's checkbox, and by the header after the server took it. */
  onChange?(on: boolean): void;
}

export function AutoSwitch({ job = null, level = null, checked = false, disabled, onChange }: AutoSwitchProps) {
  if (job) return <HeaderSwitch job={job} onChange={onChange} />;
  return (
    <div className="auto-switch">
      <SwitchView checked={checked} blocked={aboveAuto(level)} disabled={disabled} onToggle={(next) => onChange?.(next)} />
    </div>
  );
}
