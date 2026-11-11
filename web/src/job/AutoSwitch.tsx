// The Auto switch: a checkbox, on the New job form (controlled; the job doesn't exist yet) and in
// the job header (it posts /api/job/:slug/auto and spins until the server answers). Auto lets the
// job run to its first pull request while a read-only agent answers for you; fixed rules stop it.
// At L3 it is off and disabled with the server's own sentence. In the header it also keeps one line
// (Auto is on / Auto stopped: why / Started by Auto) in a place reserved for it, so nothing moves
// when the line appears. Self-contained: props in, no reach into the page.
import { useEffect, useRef, useState } from 'react';
import type { Job, LevelNumber } from '../api/types';
import { OptionRow } from '../components/Choice';
import { useWorkshop } from '../state/store';
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
  onToggle(next: boolean): void;
}

function SwitchView({ checked, blocked, disabled, busy, onToggle }: ViewProps) {
  const off = blocked || disabled;
  return (
    <OptionRow type="checkbox" className={`auto-switch-row${off ? ' is-off' : ''}`} checked={checked && !blocked} disabled={off} aria-busy={busy || undefined} onChange={(e) => onToggle(e.target.checked)}>
      {busy && <span className="auto-spin" role="status" aria-label={checked ? 'Turning Auto off…' : 'Turning Auto on…'}><span className="spin-ring" aria-hidden="true" /></span>}
      <span className="option-body">
        <span className="auto-switch-label">{AUTO_LABEL}</span>
        <span className="auto-switch-hint">{blocked ? AUTO_L3 : AUTO_HINT}</span>
      </span>
    </OptionRow>
  );
}

function HeaderSwitch({ job, onChange }: { job: Pick<Job, 'slug' | 'level' | 'suggestedLevel' | 'auto'>; onChange?(on: boolean): void }) {
  const { api } = useWorkshop();
  const sent = useSent(`auto:${job.slug}`);
  const inflight = useRef(false);
  // What the server last answered, until the job's own record catches up.
  const [shown, setShown] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setShown(null); }, [job.auto?.on]);
  const blocked = aboveAuto(job.level) || aboveAuto(job.suggestedLevel);
  const on = !blocked && (shown ?? job.auto?.on === true);

  async function toggle(next: boolean) {
    if (inflight.current || blocked) return;
    inflight.current = true;
    setError(null);
    sent.start();
    try {
      await api.post(`/api/job/${encodeURIComponent(job.slug)}/auto`, { on: next });
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
    <div className="auto-switch">
      <SwitchView checked={on} blocked={blocked} busy={sent.state === 'sending'} onToggle={(next) => { void toggle(next); }} />
      <p className="auto-line">
        {error ? <span className="is-refused" role="alert">{error}</span> : (
          <>
            {stopped ? <span className="is-stopped">Auto stopped: {stopped}</span> : on && <span>Auto is on</span>}
            {tag && <span>Started by Auto (tag: {tag})</span>}
            {!stopped && !on && !tag && ' '}
          </>
        )}
      </p>
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
