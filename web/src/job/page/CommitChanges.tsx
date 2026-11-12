// One commit's change (GET /api/job/:slug/commit/:sha): its files with the lines added (+) and
// removed (−). Moved out of the old job page's Code tab so the Build step opens it the same way.
// A change that could not be read says why, with Try again. Nothing here changes a file.
import { useEffect, useState } from 'react';
import { BRAND } from '../../app/brand';
import { Button } from '../../components/Button';
import { listOf, textsOf } from '../../lib/lists';
import { useWorkshop } from '../../state/store';

interface Shown { sha: string; message: string; files: { path: string; added: number | null; removed: number | null }[]; patchFiles: { path: string; lines: string[] }[]; truncated: boolean }

/** A read the step makes: under way, failed (with why) or in. */
export type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };
/** A failure's words. */
export const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function CommitChanges({ slug, sha }: { slug: string; sha: string }) {
  const { api } = useWorkshop();
  const [shown, setShown] = useState<Load<Shown>>({ state: 'loading' });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let off = false;
    setShown({ state: 'loading' });
    api.get<Shown>(`/api/job/${encodeURIComponent(slug)}/commit/${sha}`).then(
      (value) => { if (!off) setShown({ state: 'ready', value }); },
      (err) => { if (!off) setShown({ state: 'error', message: message(err) }); },
    );
    return () => { off = true; };
  }, [api, slug, sha, tries]);
  if (shown.state === 'loading') return <p className="muted" role="status">Reading the change…</p>;
  if (shown.state === 'error') {
    return (
      <div>
        <p className="thread-error" role="alert">Couldn’t read the change: {shown.message}</p>
        <Button onClick={() => setTries((n) => n + 1)} title={`Ask ${BRAND.name} for this change again.`}>Try again</Button>
      </div>
    );
  }
  return <Change value={shown.value} />;
}

function Change({ value }: { value: Shown }) {
  // Not a list, or holes in one (an older or half-written answer): left out, never a crash.
  const files = listOf<Shown['patchFiles'][number]>(value.patchFiles);
  const stats = listOf<Shown['files'][number]>(value.files);
  return (
    <div className="code-change">
      {files.length === 0 && <p className="muted">No file changes in this commit.</p>}
      {files.map((f) => {
        const stat = stats.find((x) => x.path === f.path);
        return (
          <details key={f.path} className="code-file" open={files.length <= 3}>
            <summary><code>{f.path}</code>{stat && <span className="muted"> · {stat.added ?? '?'} added, {stat.removed ?? '?'} removed</span>}</summary>
            <pre className="code-lines">{textsOf(f.lines).map((l, i) => <span key={i} className={l.startsWith('+') ? 'is-add' : l.startsWith('-') ? 'is-del' : l.startsWith('@@') ? 'is-hunk' : undefined}>{l}{'\n'}</span>)}</pre>
          </details>
        );
      })}
      {value.truncated && <p className="muted">Only the start of a very large change is shown.</p>}
    </div>
  );
}
