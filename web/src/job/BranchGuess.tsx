// A branch Starbase only guessed (dashboard/lib/locate.js branchGuessed: a name match in git, or a branch the job's
// workflow-status.md only mentions). Nothing that writes or decides uses a guess: Try it, Close with the worktree
// removed, Send back and Auto all refuse it, in words that send you here. One button confirms it: the shown
// repository and branch become your choice (POST /api/job/:slug/repo, the old view's "Change"), and the page
// reads the job again. On the website the words only: choosing a repository is for the laptop's own page.
// Self-contained: props in, no reach into the page.
import { useState } from 'react';
import type { JobDetail } from '../api/types';
import { Button } from '../components/Button';
import { useWorkshop } from '../state/store';

export const CONFIRM_LABEL = 'This is the job\'s branch';

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function BranchGuess({ slug, detail, onConfirmed }: { slug: string; detail: JobDetail | null | undefined; onConfirmed?(): void }) {
  const { api } = useWorkshop();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branch = detail?.locate?.branchGuessed ? detail.locate.branch ?? null : null;
  if (!branch) return null;
  const repoPath = detail?.repoPath ?? detail?.locate?.path ?? null;
  const hosted = Boolean(api.hosted?.());
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/job/${encodeURIComponent(slug)}/repo`, { repoPath, branch });
      onConfirmed?.();
    } catch (err) {
      setError(`Not saved: ${messageOf(err)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="job-branch-guess" role="group" aria-label="The job’s branch">
      <p className="job-facts-line"><span>Branch (a guess): <code>{branch}</code></span></p>
      {!hosted && repoPath && (
        <Button size="sm" busy={busy} onClick={confirm}>{CONFIRM_LABEL}</Button>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
