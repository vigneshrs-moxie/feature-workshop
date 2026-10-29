// The usage-limit banner under the top bar. While Claude's usage limit is reached it says which jobs
// it paused and when they carry on, with "Carry on now" (POST /api/usage/resume, for when you know
// it has lifted, e.g. you turned on extra usage) and the automatic carry-on switch (POST
// /api/usage/auto). Close to the limit it shows a heads-up instead. Nothing otherwise.
import { useState } from 'react';
import { carryOnNow, setAutoCarryOn } from '../app/jobActions';
import { clockTime, useNow } from '../lib/time';
import { useWorkshop, useWorkshopState } from '../state/store';
import { Choice } from './Choice';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function untilText(iso: string | null, now: Date): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.parse(iso) - now.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function UsageBanner() {
  const { api, store } = useWorkshop();
  const { usage } = useWorkshopState();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!usage) return null;

  if (!usage.limited) {
    const w = usage.warning;
    if (!w) return null;
    return (
      <p className="usage-banner usage-warn" role="status">
        <strong>Heads-up:</strong> you’ve used {w.percent != null ? `${w.percent}% of` : 'most of'} Claude’s {w.label}
        {w.resetsAt ? ` (it resets at about ${clockTime(w.resetsAt, now)})` : ''}. If it runs out, running jobs pause and carry on after it resets.
      </p>
    );
  }

  const jobs = usage.jobs ?? [];
  const at = clockTime(usage.resetsAt, now);
  const left = untilText(usage.resetsAt, now);
  const plan = !usage.autoResume
    ? (usage.passed ? 'The limit has reset. Automatic carry-on is off, so use Carry on now when you’re ready.' : 'Automatic carry-on is off, so use Carry on now when you’re ready.')
    : usage.resetKnown
      ? `${jobs.length ? 'They carry on' : 'Jobs can start again'} by themselves at about ${at}${left ? ` (in ${left})` : ''}.`
      : `Claude didn’t say when it resets, so the dashboard tries again at about ${at}.`;

  async function resume() {
    setBusy(true);
    setError(null);
    try {
      const n = await carryOnNow(api);
      setNote(n ? `Carrying on: ${n} job${n === 1 ? '' : 's'}.` : 'Unpaused. Nothing was waiting.');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleAuto(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      await setAutoCarryOn(api, store, on);
      setNote(on ? 'Paused jobs will carry on by themselves.' : 'Paused jobs will wait for you.');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="usage-banner usage-limited" role="status" aria-label="Usage limit">
      <p className="usage-text">
        <strong>Claude’s {usage.label ?? 'usage limit'} is reached.</strong>{' '}
        {jobs.length ? `${jobs.length} job${jobs.length === 1 ? '' : 's'} paused: ${jobs.map((j) => j.title).join(', ')}.` : 'Nothing was running from here.'}{' '}
        {plan}
      </p>
      <div className="usage-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void resume()}
          title="Start the paused jobs again now, for example after you turned on extra usage. If the limit is still in force they pause again."
        >
          Carry on now
        </button>
        <label className="check usage-auto" title="When Claude’s limit resets, paused jobs carry on by themselves. Turn it off to restart them yourself with Carry on now.">
          <Choice type="checkbox" checked={Boolean(usage.autoResume)} disabled={busy} onChange={(e) => void toggleAuto(e.target.checked)} />
          Carry on automatically when it resets
        </label>
        {note && <span className="muted" role="status">{note}</span>}
      </div>
      {error && <p className="field-problem" role="alert">{error}</p>}
      <p className="muted sheet-fine">Jobs you run in a terminal can’t be paused from here: they stop with a limit message instead.</p>
    </section>
  );
}
