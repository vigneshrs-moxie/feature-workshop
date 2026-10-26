// The Decisions tab: every choice you made on this job, newest first (GET /api/job/:slug/decisions,
// dashboard/lib/decisions.js). Approvals, send-backs with their note, permissions, level changes,
// closing and reopening. Read again whenever the job's thread moves on.
import { useEffect, useState } from 'react';
import type { Decision } from '../../api/types';
import { fullTime, relativeTime, useNow } from '../../lib/time';
import { useWorkshop, useWorkshopState } from '../../state/store';

const GLYPH: Record<string, string> = { approve: '✓', changes: '↺', stop: '■', allow: '›', deny: '⊘', level: '⇅', options: '⚙', policy: '⚙', close: '✕', reopen: '↻', nudge: '›' };

export function DecisionsTab({ slug, active }: { slug: string; active: boolean }) {
  const { api } = useWorkshop();
  const state = useWorkshopState();
  const now = useNow();
  const version = (state.threadVersions[slug] ?? 0) + state.threadEpoch;
  const [log, setLog] = useState<{ slug: string; decisions: Decision[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let live = true;
    api.get<{ decisions: Decision[] }>(`/api/job/${encodeURIComponent(slug)}/decisions`)
      .then((r) => { if (live) { setLog({ slug, decisions: r.decisions }); setError(null); } })
      .catch((err) => { if (live) setError(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [api, slug, version, active]);

  const decisions = log?.slug === slug ? log.decisions : null;
  if (error && !decisions) return <p className="muted doc-empty">Couldn’t read the decisions: {error}</p>;
  if (!decisions) return <p className="muted doc-empty">Reading your decisions…</p>;
  if (decisions.length === 0) return <p className="muted doc-empty">No decisions yet. Approvals, send-backs, permissions and level changes you make on this job are listed here.</p>;
  return (
    <ol className="decision-log">
      {decisions.map((d, i) => (
        <li key={`${d.at}-${i}`} className="decision-entry" data-kind={d.kind}>
          <span className="glyph" aria-hidden="true">{GLYPH[d.kind] ?? '›'}</span>
          <span className="decision-entry-text">
            {d.text}
            {d.note && <span className="decision-entry-note">“{d.note}”</span>}
          </span>
          {d.at && <time className="decision-entry-time num" dateTime={d.at} title={fullTime(d.at)}>{relativeTime(d.at, now)}</time>}
        </li>
      ))}
    </ol>
  );
}
