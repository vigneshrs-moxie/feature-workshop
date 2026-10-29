// Mark a job done or dropped: the classic view's options (done or dropped, a note, and removing its
// worktree when nothing would be lost). POST /api/job/:slug/close.
import { useState } from 'react';
import { closeJob } from '../../app/jobActions';
import { Sheet } from '../../components/Sheet';
import { jobBySlug } from '../../state/reducer';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { Choice } from '../../components/Choice';

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~');

export function CloseJobSheet({ slug, worktree, onClose }: { slug: string; worktree?: string | null; onClose: () => void }) {
  const { api } = useWorkshop();
  const state = useWorkshopState();
  const job = jobBySlug(state, slug);
  const [as, setAs] = useState<'done' | 'dropped'>('done');
  const [note, setNote] = useState('');
  const [removeWorktree, setRemoveWorktree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await closeJob(api, slug, { as, note: note.trim(), removeWorktree: Boolean(worktree) && removeWorktree });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Mark “${job?.title || slug}” as done`} onClose={onClose} busy={busy} className="close-sheet">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="muted">It moves to <strong>Done</strong>. Nothing is deleted, the Foreman isn’t contacted, and you can reopen it any time (sending the Foreman a message reopens it too).</p>
        <fieldset className="rule-options" disabled={busy}>
          <legend className="sr-only">How it ended</legend>
          <label className={`rule-option${as === 'done' ? ' is-picked' : ''}`} title="It shipped, or only waits on someone else’s merge or release. Counts as done.">
            <Choice type="radio" name="as" value="done" checked={as === 'done'} onChange={() => setAs('done')} />
            <span className="rule-option-body">
              <span className="rule-option-kind">Done</span>
              <span className="muted">Shipped, merged, or only waiting on someone else’s merge or release.</span>
            </span>
          </label>
          <label className={`rule-option${as === 'dropped' ? ' is-picked' : ''}`} title="It isn’t going ahead, or another job replaced it. Doesn’t count as done.">
            <Choice type="radio" name="as" value="dropped" checked={as === 'dropped'} onChange={() => setAs('dropped')} />
            <span className="rule-option-body">
              <span className="rule-option-kind">Dropped</span>
              <span className="muted">Not going ahead, or replaced by another job.</span>
            </span>
          </label>
        </fieldset>
        <label className="field sheet-field">
          <span>Note (optional)</span>
          <input
            className="text-input"
            type="text"
            maxLength={300}
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. PR waiting on a teammate’s approval"
            title="A short note for later: why it ended, or what it’s waiting on. Shown on the job."
          />
        </label>
        {worktree && (
          <>
            <label className="check" title="Frees the folder. Only happens when nothing would be lost; otherwise the job isn’t marked and you’re told why.">
              <Choice type="checkbox" checked={removeWorktree} disabled={busy} onChange={(e) => setRemoveWorktree(e.target.checked)} />
              Also remove its worktree (<code className="num">{tilde(worktree)}</code>)
            </label>
            <p className="muted sheet-fine">Only when nothing would be lost: no uncommitted changes, and its latest commit is already on GitHub. The branch itself is kept.</p>
          </>
        )}
        {error && <p className="field-problem" role="alert">{error}</p>}
        <div className="sheet-actions">
          <button type="submit" className="btn btn-primary" disabled={busy} title={as === 'done' ? 'Mark this job done now.' : 'Mark this job dropped now.'}>
            {busy ? (removeWorktree && worktree ? 'Checking the worktree…' : 'Marking…') : 'Mark it'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy} title="Leave the job as it is.">Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}
