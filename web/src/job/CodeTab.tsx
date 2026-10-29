// The Job page's Code tab: the job's commits on its branch, newest first (GET /api/job/:slug/commits),
// and one commit's change when you pick it (GET /api/job/:slug/commit/:sha): its files with the
// lines added (+) and removed (−). Nothing here changes a file.
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { relativeTime, useNow } from '../lib/time';
import { useWorkshop } from '../state/store';

interface Commit { sha: string; short: string; author: string; date: string; subject: string; step: string | null }
interface Commits { commits: Commit[]; note?: string }
interface Shown { sha: string; message: string; files: { path: string; added: number | null; removed: number | null }[]; patchFiles: { path: string; lines: string[] }[]; truncated: boolean }

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function CodeTab({ slug, changedAt }: { slug: string; changedAt?: string | null }) {
  const { api } = useWorkshop();
  const now = useNow();
  const [load, setLoad] = useState<Load<Commits>>({ state: 'loading' });
  const [tries, setTries] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState<Load<Shown> | null>(null);
  useEffect(() => {
    let off = false;
    api.get<Commits>(`/api/job/${encodeURIComponent(slug)}/commits`).then(
      (value) => { if (!off) setLoad({ state: 'ready', value: { commits: Array.isArray(value?.commits) ? value.commits : [], note: value?.note } }); },
      (err) => { if (!off) setLoad({ state: 'error', message: message(err) }); },
    );
    return () => { off = true; };
  }, [api, slug, tries, changedAt]);
  useEffect(() => {
    if (!open) { setShown(null); return; }
    let off = false;
    setShown({ state: 'loading' });
    api.get<Shown>(`/api/job/${encodeURIComponent(slug)}/commit/${open}`).then(
      (value) => { if (!off) setShown({ state: 'ready', value }); },
      (err) => { if (!off) setShown({ state: 'error', message: message(err) }); },
    );
    return () => { off = true; };
  }, [api, slug, open]);

  if (load.state === 'loading') return <p className="muted" role="status">Reading the job’s commits…</p>;
  if (load.state === 'error') {
    return (
      <div>
        <p className="thread-error" role="alert">Couldn’t read the commits: {load.message}</p>
        <button type="button" className="btn" onClick={() => setTries((n) => n + 1)} title="Ask the dashboard for the commits again.">Try again</button>
      </div>
    );
  }
  const { commits, note } = load.value;
  if (!commits.length) return <p className="muted">{note || 'No commits yet. They show up here once building starts.'}</p>;
  return (
    <div className="code-tab">
      <div className="job-tiles">
        <div className="job-tile"><Icon name="code" size={18} /><div><b>{commits.length}</b><span>{commits.length === 1 ? 'commit' : 'commits'}</span></div></div>
        <div className="job-tile"><Icon name="clock" size={18} /><div><b>{relativeTime(commits[0].date, now)}</b><span>newest</span></div></div>
      </div>
      <ul className="code-commits">
        {commits.map((c) => (
          <li key={c.sha}>
            <button type="button" className={`code-commit${open === c.sha ? ' is-open' : ''}`} aria-expanded={open === c.sha} onClick={() => setOpen(open === c.sha ? null : c.sha)} title={open === c.sha ? 'Hide this change.' : 'Show what this commit changed.'}>
              <code className="num">{c.short}</code>
              <span className="code-subject">{c.subject}</span>
              <span className="muted">{relativeTime(c.date, now)}</span>
            </button>
            {open === c.sha && shown && (
              shown.state === 'loading' ? <p className="muted" role="status">Reading the change…</p>
                : shown.state === 'error' ? <p className="thread-error" role="alert">Couldn’t read the change: {shown.message}</p>
                  : <Change value={shown.value} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
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
