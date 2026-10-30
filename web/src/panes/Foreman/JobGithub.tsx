// GitHub on the open job: at the PR stages (or whenever a hand-off waits), Check GitHub reads the
// PRs now (POST /api/flow/refresh, read-only) instead of waiting for the 10-minute refresh, and the
// job's hand-off nudges (dashboard/lib/nudges.js) show here as on the Desk. The one this exists
// for: PR #n merged on GitHub while the Foreman still asks you to merge it ("PR #1 is merged: tell
// the Foreman?"); Yes sends it one sentence, so it carries on. The dashboard never merges anything.
import { useState } from 'react';
import type { Job } from '../../api/types';
import { nudgePath } from '../../home/nudges';
import { useWorkshop } from '../../state/store';
import { Button } from '../../components/Button';

const PR_STAGES = new Set(['pr1', 'pr2', 'staging-qa', 'pr3']);
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** check: false where the GitHub line (views/Review/GithubLine.tsx) already offers Check now: then only the nudges show. */
export function JobGithub({ job, check: withCheck = true, hide }: { job: Job; check?: boolean; hide?: ReadonlySet<string> }) {
  const { api } = useWorkshop();
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const nudges = (job.nudges ?? []).filter((n) => !done.has(n.id) && !hide?.has(n.id));
  if ((!withCheck || !PR_STAGES.has(job.stage ?? '')) && !nudges.length) return null;

  async function check() {
    setChecking(true);
    setError(null);
    try {
      await api.post('/api/flow/refresh', {});
      setChecked(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  }
  async function settle(id: string, what: 'yes' | 'dismiss') {
    setBusy(id);
    setError(null);
    try {
      await api.post(nudgePath(job.slug, id, what), {});
      setDone((s) => new Set([...s, id]));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="job-github" aria-label="GitHub">
      {withCheck && <p className="job-github-head">
        <span className="ask-label">GitHub</span>
        <button type="button" className="link-button" disabled={checking} onClick={() => void check()} title="Read this job’s pull requests on GitHub now (read-only), instead of waiting for the next refresh. Nothing is sent to the Foreman.">
          {checking ? 'Checking…' : 'Check GitHub'}
        </button>
        {checked && !checking && <span className="muted" role="status">Asked GitHub; this updates in a few seconds.</span>}
      </p>}
      {nudges.map((n) => (
        <div key={n.id} className="job-github-nudge">
          <p className="job-github-title"><strong>{n.title}</strong></p>
          <p className="job-github-text">{n.text}</p>
          <div className="perm-actions">
            {n.action && (
              <Button kind="primary" disabled={busy !== null} onClick={() => void settle(n.id, 'yes')} title={`The Foreman gets “${n.action.send}” and takes it from there.`}>
                {n.id.endsWith('-merged') ? 'Yes, tell the Foreman' : 'Yes, ask the Foreman'}
              </Button>
            )}
            {n.link && <Button href={n.link} target="_blank" rel="noopener noreferrer" title="Open it on GitHub, in a new tab. The dashboard never merges or approves anything itself.">Open on GitHub</Button>}
            <Button kind="quiet" disabled={busy !== null} onClick={() => void settle(n.id, 'dismiss')} title="Put this away for this job. The job is unchanged.">Not now</Button>
          </div>
        </div>
      ))}
      {error && <p className="field-problem" role="alert">{error}</p>}
    </section>
  );
}
