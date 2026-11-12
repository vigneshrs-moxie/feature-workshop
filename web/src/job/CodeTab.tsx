// The Job page's Code tab: the job's commits on its branch, newest first (GET /api/job/:slug/commits),
// and one commit's change when you pick it (CommitChanges, job/page/CommitChanges.tsx). Nothing here
// changes a file.
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { relativeTime, useNow } from '../lib/time';
import { useWorkshop } from '../state/store';
import { Button } from '../components/Button';
import { BRAND } from '../app/brand';
import { CommitChanges } from './page/CommitChanges';

interface Commit { sha: string; short: string; author: string; date: string; subject: string; step: string | null }
interface Commits { commits: Commit[]; note?: string }

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function CodeTab({ slug, changedAt }: { slug: string; changedAt?: string | null }) {
  const { api } = useWorkshop();
  const now = useNow();
  const [load, setLoad] = useState<Load<Commits>>({ state: 'loading' });
  const [tries, setTries] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    api.get<Commits>(`/api/job/${encodeURIComponent(slug)}/commits`).then(
      (value) => { if (!off) setLoad({ state: 'ready', value: { commits: Array.isArray(value?.commits) ? value.commits : [], note: value?.note } }); },
      (err) => { if (!off) setLoad({ state: 'error', message: message(err) }); },
    );
    return () => { off = true; };
  }, [api, slug, tries, changedAt]);

  if (load.state === 'loading') return <p className="muted" role="status">Reading the job’s commits…</p>;
  if (load.state === 'error') {
    return (
      <div>
        <p className="thread-error" role="alert">Couldn’t read the commits: {load.message}</p>
        <Button onClick={() => setTries((n) => n + 1)} title={`Ask ${BRAND.name} for the commits again.`}>Try again</Button>
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
            {open === c.sha && <CommitChanges slug={slug} sha={c.sha} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
