// "Copy for the ticket" on the Decisions tab: the job's decisions.md (GET /api/jobs/:slug/decisions.md,
// dashboard/lib/decisions.js) as plain text, with the table's pipes, ready to paste into the ticket.
// At most 40 lines: a longer file gives its last 40 lines, and the message says so. Read again
// whenever the job's thread moves on, so it has the decisions made since.
import { useEffect, useState } from 'react';
import { useWorkshop, useWorkshopState } from '../../state/store';

export interface DecisionsFile {
  file: string;
  path: string;
  text: string;
  copy: { text: string; lines: number; total: number; cut: boolean };
}

type Copied = { state: 'ok'; lines: number; total: number; cut: boolean } | { state: 'failed' } | null;

export function CopyForTicket({ slug, active }: { slug: string; active: boolean }) {
  const { api } = useWorkshop();
  const state = useWorkshopState();
  const version = (state.threadVersions[slug] ?? 0) + state.threadEpoch;
  const [got, setGot] = useState<{ slug: string; file: DecisionsFile } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<Copied>(null);

  useEffect(() => {
    if (!active) return;
    let live = true;
    api.get<DecisionsFile>(`/api/jobs/${encodeURIComponent(slug)}/decisions.md`)
      .then((r) => {
        if (!live) return;
        if (typeof r?.text !== 'string' || typeof r.copy?.text !== 'string') { setError('the dashboard’s answer had no file in it'); return; }
        setGot({ slug, file: r });
        setError(null);
      })
      .catch((err) => { if (live) setError(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [api, slug, version, active]);

  const file = got?.slug === slug ? got.file : null;

  async function copy() {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.copy.text);
      setCopied({ state: 'ok', lines: file.copy.lines, total: file.copy.total, cut: file.copy.cut });
    } catch {
      setCopied({ state: 'failed' });
    }
  }

  return (
    <div className="decisions-file">
      <div className="doc-actions">
        <button type="button" className="btn btn-quiet" disabled={!file} onClick={() => void copy()} title="Copy the decision table and the Not doing list as plain text, to paste into the ticket.">
          Copy for the ticket
        </button>
        <span className="doc-facts muted">
          {file ? <>{file.file} in the job folder · {file.copy.total} {file.copy.total === 1 ? 'line' : 'lines'}</> : error ? <>Couldn’t read decisions.md: {error}</> : 'Reading decisions.md…'}
        </span>
      </div>
      {copied?.state === 'ok' && (
        <p className="doc-copied drawer-state is-ok" role="status">
          ✓ {copied.cut ? `Copied the last ${copied.lines} of ${copied.total} lines. The whole list is in decisions.md in the job folder.` : `Copied ${copied.lines} ${copied.lines === 1 ? 'line' : 'lines'}.`}
        </p>
      )}
      {copied?.state === 'failed' && <p className="field-problem" role="alert">Couldn’t copy: this browser didn’t allow it. Open decisions.md from the Docs tab and copy the text yourself.</p>}
    </div>
  );
}
