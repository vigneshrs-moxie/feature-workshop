// The Auto switch: a checkbox, on the New job form (controlled; the job doesn't exist yet) and in
// the job header (it posts /api/job/:slug/auto and spins until the server answers). Auto lets the
// job run to its first pull request while a read-only agent answers for you; what the fixed rules
// forbid is refused, and the job carries on.
// It is on or off at every level (Auto runs L3 jobs too). In the header it also keeps one line
// (Auto is on / Auto stopped: why / Started by Auto) in a place reserved for it, so nothing moves
// when the line appears. On the hosted website the same POST is queued for the laptop: the job's
// `autoQueued` (a decision from the site, views/Hosted/QueuedDecision) says it waits, is on its way or was
// refused (with the laptop's own sentence), beside the switch, and the switch rests meanwhile.
// The new job page's header (optimistic, short): the switch flips at once, without the spinner, and
// flips back with one plain line if the server refuses; on the website it queues as above. Short shows
// the word Auto, its name still the full sentence. There the line sits beside the switch: a refusal
// with Dismiss, a stop as the word Stopped with its reason in the title (heard, not drawn), and the
// website's queued change drawn small. Other screens keep the spinner, the sentence and the line.
// Self-contained: props in, no reach into the page.
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../components/Button';
import type { Job } from '../api/types';
import { OptionRow } from '../components/Choice';
import { useWorkshop } from '../state/store';
import { isOpen, needsLook, QueuedDecision, queuedOf, type QueuedView } from '../views/Hosted/QueuedDecision';
import { useSent } from '../lib/sentState';
import './auto.css';

export const AUTO_LABEL = 'Auto: run to PR #1 without asking me.';
export const AUTO_HINT = 'A Fable agent approves each step for you and takes the recommended answers, up to PR #1. When something is risky it takes the safer option and lists it under What Auto decided. It never merges.';
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface ViewProps {
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** The header's: the hint is not shown, it describes the checkbox (and is its title). */
  quiet?: boolean;
  /** The new job page's header: On or Off beside the switch (the checkbox's state already says it to a screen reader). */
  word?: boolean;
  /** The new job page's header: the word Auto shows; the sentence stays the checkbox's name. */
  short?: boolean;
  /** The new job page's header: Auto has stopped, and why (the word says Stopped; the title the reason). */
  stopped?: string | null;
  onToggle(next: boolean): void;
}

function SwitchView({ checked, disabled, busy, quiet, word = false, short = false, stopped = null, onToggle }: ViewProps) {
  const hintId = useId();
  return (
    <>
    <OptionRow type="checkbox" className={`auto-switch-row${disabled ? ' is-off' : ''}`} checked={checked} disabled={disabled} aria-busy={busy || undefined} aria-describedby={quiet ? hintId : undefined} title={quiet ? (short && stopped ? `Auto stopped: ${stopped}. ${AUTO_HINT}` : AUTO_HINT) : undefined} onChange={(e) => onToggle(e.target.checked)}>
      <span className="option-body">
        {short
          ? <span className="auto-switch-label"><span className="sr-only">{AUTO_LABEL}</span><span className="auto-switch-short" aria-hidden="true">Auto</span></span>
          : <span className="auto-switch-label">{AUTO_LABEL}</span>}
        {!quiet && <span className="auto-switch-hint">{AUTO_HINT}</span>}
      </span>
      {word && <b className={`sb-auto-switch-word${checked ? ' is-on' : ''}`} aria-hidden="true">{checked ? (short && stopped ? 'Stopped' : 'On') : 'Off'}</b>}
    </OptionRow>
    {/* Outside the label, so its words never join the checkbox's name. */}
    {busy && <span className="auto-spin" role="status" aria-label={checked ? 'Turning Auto off…' : 'Turning Auto on…'}><span className="spin-ring" aria-hidden="true" /></span>}
    {/* Outside the label, so it describes the checkbox without becoming part of its name. */}
    {quiet && <span id={hintId} className="sr-only">{AUTO_HINT}</span>}
    </>
  );
}

function HeaderSwitch({ job, onChange, word = false, tagLine = true, optimistic = false, short = false }: { job: Pick<Job, 'slug' | 'auto'> & { autoQueued?: unknown }; onChange?(on: boolean): void; word?: boolean; tagLine?: boolean; optimistic?: boolean; short?: boolean }) {
  const { api } = useWorkshop();
  // The website queues the change for the laptop: nothing flips there before the laptop does it.
  const fast = optimistic && !api.hosted?.();
  const sent = useSent(`auto:${job.slug}`);
  const inflight = useRef(false);
  // The job's own record, as it is now (a slow refusal checks it before it flips the switch back).
  const record = useRef(job.auto?.on === true);
  record.current = job.auto?.on === true;
  // What the server last answered, until the job's own record catches up.
  const [shown, setShown] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The job's Auto state changed (on, off, stopped or going again): what the server last answered,
  // and a refusal's words, give way to the job's own record.
  const stopKey = JSON.stringify(job.auto?.stopped ?? null);
  useEffect(() => { setShown(null); setError(null); }, [job.auto?.on, stopKey]);
  // The website's queue: what the site answered to the click, until the job's own record shows it.
  const [held, setHeld] = useState<QueuedView | null>(null);
  useEffect(() => { if (job.autoQueued) setHeld(null); }, [job.autoQueued]);
  const queued = queuedOf(job.autoQueued) ?? held;
  const waiting = isOpen(queued);
  const on = shown ?? job.auto?.on === true;

  async function toggle(next: boolean) {
    if (inflight.current) return;
    inflight.current = true;
    setError(null);
    const was = on;
    if (fast) setShown(next); else sent.start();
    try {
      const answer = await api.post<{ held?: boolean; queued?: unknown } | undefined>(`/api/job/${encodeURIComponent(job.slug)}/auto`, { on: next });
      if (answer?.held) { setHeld(queuedOf(answer.queued)); return; } // the website queued it: the laptop does it, and the line says so
      setShown(next);
      onChange?.(next);
    } catch (err) {
      if (fast && record.current === next) setShown(null); // the record already shows the change: it went through after all
      else if (fast) { setShown(was); setError(`Auto stayed ${was ? 'on' : 'off'}: ${messageOf(err)}`); } else setError(messageOf(err));
    } finally {
      inflight.current = false;
      if (!fast) sent.clear();
    }
  }

  // The record keeps { reason, rule, at }; older pages may have sent the sentence alone.
  const stop = on ? job.auto?.stopped ?? null : null;
  const stopped = !stop ? null : typeof stop === 'string' ? stop : typeof stop.reason === 'string' && stop.reason ? stop.reason : 'it needs you';
  // The new job page's header says who started it in its own chip (tagLine false).
  const tag = tagLine && on && job.auto?.by === 'tag' && job.auto.tag ? job.auto.tag : null;
  return (
    <div className="auto-switch is-inline">
      <SwitchView quiet word={word} short={short} stopped={stopped} checked={on} disabled={sent.state === 'sending' || waiting} busy={sent.state === 'sending'} onToggle={(next) => { void toggle(next); }} />
      {/* A polite live region: a refusal, a stop or "Auto is on" is heard once, without taking the focus. */}
      {short ? (
        <>
          {/* The new header: a stop or "Auto is on" is heard, not drawn; a refusal shows, with Dismiss. */}
          <p className="auto-line" role="status" aria-live="polite">
            {error ? <span className="is-refused" title={error}>{error}</span> : <span className="sr-only">{stopped ? `Auto stopped: ${stopped}` : on ? 'Auto is on' : ''}</span>}
          </p>
          {error && <Button kind="quiet" size="sm" iconOnly icon="x" className="auto-line-x" aria-label="Dismiss" title="Hide this line." onClick={() => setError(null)} />}
        </>
      ) : (
      <p className="auto-line" role="status" aria-live="polite">
        {error ? <span className="is-refused">{error}</span> : (
          <>
            {stopped ? <span className="is-stopped">Auto stopped: {stopped}</span> : on && <span>Auto is on</span>}
            {tag && <span>Started by Auto (tag: {tag})</span>}
            {!stopped && !on && !tag && ' '}
          </>
        )}
      </p>
      )}
      {queued && (isOpen(queued) || needsLook(queued)) && <QueuedDecision queued={queued} compact={short} onChange={() => setHeld(null)} />}
    </div>
  );
}

export interface AutoSwitchProps {
  /** The job page's switch: posts the change itself. Leave out on the New job form. */
  job?: Pick<Job, 'slug' | 'auto'> | null;
  /** The form's: whether it is ticked, and its disabled state. */
  checked?: boolean;
  disabled?: boolean;
  /** Called with the new value: by the form's checkbox, and by the header after the server took it. */
  onChange?(on: boolean): void;
  /** The job's switch: draws On or Off beside it (the new job page's header). */
  word?: boolean;
  /** The job's switch: false leaves out "Started by Auto (tag: x)" under it, for a header whose own chip says it. */
  tagLine?: boolean;
  /** The job's switch on the new job page: flips at once and flips back with a line if the server refuses. */
  optimistic?: boolean;
  /** The job's switch on the new job page: the word Auto instead of the sentence (which stays its name). */
  short?: boolean;
}

export function AutoSwitch({ job = null, checked = false, disabled, onChange, word = false, tagLine = true, optimistic = false, short = false }: AutoSwitchProps) {
  if (job) return <HeaderSwitch job={job} onChange={onChange} word={word} tagLine={tagLine} optimistic={optimistic} short={short} />;
  return (
    <div className="auto-switch">
      <SwitchView checked={checked} disabled={disabled} onToggle={(next) => onChange?.(next)} />
    </div>
  );
}
