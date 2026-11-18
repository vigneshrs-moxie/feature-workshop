// A branch Starbase only guessed (dashboard/lib/locate.js branchGuessed): a slim row under the job page's
// header. Nothing that writes or decides uses a guess: Try it, Close with the worktree removed, Send back and
// Auto refuse it, in words that send him here ("Confirm it on the job page"). One button confirms it: the
// repository and branch become his choice (POST /api/job/:slug/repo), and the page reads the job again.
// Laptop only: the website's payload has no `local`, so the row never shows there.

import { memo, useState } from 'react';
import { Button } from '../../components/Button';
import { useWorkshop } from '../../state/store';
import { useJob, useJobStore } from '../useJob';

export const CONFIRM_LABEL = 'This is the job\'s branch';

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const BranchGuess = memo(function BranchGuess() {
  const { api } = useWorkshop();
  const store = useJobStore();
  const slug = useJob((s) => s.slug);
  const branch = useJob((s) => s.payload?.local?.guess?.branch ?? null);
  const repoPath = useJob((s) => s.payload?.local?.guess?.repoPath ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!branch) return null;
  const repoName = repoPath ? repoPath.split(/[\\/]/).filter(Boolean).pop() ?? null : null;
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/job/${encodeURIComponent(slug)}/repo`, { repoPath, branch });
      await store.loadPage();
    } catch (err) {
      setError(`Not saved: ${messageOf(err)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="jp2-guess" role="group" aria-label="The job’s branch">
      <p className="jp2-guess-says">
        Branch (a guess): <code>{branch}</code>{repoName && <span className="jp2-guess-repo"> in {repoName}</span>}
        <span className="jp2-guess-why"> · Auto and Send back won’t use a guessed branch until you confirm it.</span>
      </p>
      {repoPath && <Button size="sm" busy={busy} onClick={() => void confirm()} title="Confirm the repository and branch shown, so Auto, Try it and Close can use them.">{CONFIRM_LABEL}</Button>}
      {error && <p className="jp2-guess-error" role="alert">{error}</p>}
    </div>
  );
});
