// One commit's change (GET /api/job/:slug/commit/:sha): its files with the lines added (+) and
// removed (−). Moved out of the Code tab (job/CodeTab.tsx) so the Build step opens it the same way.
// Nothing here changes a file.
import { useEffect, useState } from 'react';
import { useWorkshop } from '../../state/store';

interface Shown { sha: string; message: string; files: { path: string; added: number | null; removed: number | null }[]; patchFiles: { path: string; lines: string[] }[]; truncated: boolean }

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function CommitChanges({ slug, sha }: { slug: string; sha: string }) {
  const { api } = useWorkshop();
  const [shown, setShown] = useState<Load<Shown>>({ state: 'loading' });
  useEffect(() => {
    let off = false;
    setShown({ state: 'loading' });
    api.get<Shown>(`/api/job/${encodeURIComponent(slug)}/commit/${sha}`).then(
      (value) => { if (!off) setShown({ state: 'ready', value }); },
      (err) => { if (!off) setShown({ state: 'error', message: message(err) }); },
    );
    return () => { off = true; };
  }, [api, slug, sha]);
  return shown.state === 'loading' ? <p className="muted" role="status">Reading the change…</p>
    : shown.state === 'error' ? <p className="thread-error" role="alert">Couldn’t read the change: {shown.message}</p>
      : <Change value={shown.value} />;
}

function Change({ value }: { value: Shown }) {
  const files = Array.isArray(value.patchFiles) ? value.patchFiles : [];
  return (
    <div className="code-change">
      {files.length === 0 && <p className="muted">No file changes in this commit.</p>}
      {files.map((f) => {
        const stat = value.files?.find((x) => x.path === f.path);
        return (
          <details key={f.path} className="code-file" open={files.length <= 3}>
            <summary><code>{f.path}</code>{stat && <span className="muted"> · {stat.added ?? '?'} added, {stat.removed ?? '?'} removed</span>}</summary>
            <pre className="code-lines">{f.lines.map((l, i) => <span key={i} className={l.startsWith('+') ? 'is-add' : l.startsWith('-') ? 'is-del' : l.startsWith('@@') ? 'is-hunk' : undefined}>{l}{'\n'}</span>)}</pre>
          </details>
        );
      })}
      {value.truncated && <p className="muted">Only the start of a very large change is shown.</p>}
    </div>
  );
}
