// Key points: the short summary the Foreman writes of each document and brief (summaries/ in the
// job folder, lib/docs.js readSummary), shown above it so you needn't read the whole thing. Four
// parts, each named in words: Outcome, Risks and surprises, Decisions for you (with the
// recommendation), What changed. A part with nothing to say is left out. A summary of an older
// version says so. With none, a Summarise button puts a request for it into the job's message box
// (between marker lines, like the screens feedback); you send it like any message, so nothing
// runs and nothing is spent until you do. The dashboard never writes a summary itself.
import { useState } from 'react';
import type { DocSummary } from '../api/types';
import { readStored, writeStored } from '../lib/stored';
import { draftKey } from '../panes/Foreman/Composer';
import { InlineText } from './InlineText';

const vLabel = (v: string) => (/^v/i.test(v) ? v : `v${v}`);

/** The request block's marker lines in the draft: one block, a line per document asked for. */
export const SUMMARY_REQUEST_START = '--- Summaries wanted ---';
const SUMMARY_REQUEST_END = '--- end ---';
const SUMMARY_REQUEST_BLOCK = /^--- Summaries wanted ---\n([\s\S]*?)\n--- end ---$/m;
const SUMMARY_REQUEST_LEAD = 'Write the missing Key points (skills/feature/status-json.md §3, from the files on disk) for:';

/** One line of the request: the document and its version. */
export const summaryRequestLine = (file: string, version: string | null) => `- ${file}${version ? ` (${vLabel(version)})` : ''}`;

/**
 * Adds a document to the Summaries wanted block in the job's draft (made when there is none, after
 * what you've written). False when it is already asked for.
 */
export function addSummaryRequest(slug: string, file: string, version: string | null): boolean {
  const line = summaryRequestLine(file, version);
  const prev = readStored(draftKey(slug)) ?? '';
  const m = SUMMARY_REQUEST_BLOCK.exec(prev);
  if (m) {
    const lines = m[1].split('\n');
    if (lines.includes(line)) return false;
    writeStored(draftKey(slug), prev.replace(SUMMARY_REQUEST_BLOCK, `${SUMMARY_REQUEST_START}\n${[...lines, line].join('\n')}\n${SUMMARY_REQUEST_END}`));
    return true;
  }
  const block = `${SUMMARY_REQUEST_START}\n${SUMMARY_REQUEST_LEAD}\n${line}\n${SUMMARY_REQUEST_END}`;
  writeStored(draftKey(slug), prev.trim() ? `${prev.replace(/\s+$/, '')}\n\n${block}` : block);
  return true;
}

function Part({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kp-part">
      <h5 className="kp-label">{label}</h5>
      <ul className="kp-lines">{children}</ul>
    </div>
  );
}

export function KeyPoints({ summary, kind, slug, file, version = null }: {
  summary: DocSummary | null | undefined;
  /** A document (Key points) or a brief (In short). */
  kind: 'doc' | 'brief';
  slug: string;
  /** The file the Summarise button asks about ('spec' for the product spec). */
  file: string;
  /** The document's own version, for the stale note and the request. */
  version?: string | null;
}) {
  const [asked, setAsked] = useState<'added' | 'already' | null>(null);
  const title = kind === 'brief' ? 'In short' : 'Key points';
  if (!summary) {
    return (
      <div className="kp-missing">
        <span className="muted">{kind === 'brief' ? 'No short version of this brief yet.' : 'No key points for this document yet.'}</span>{' '}
        <button
          type="button"
          className="link-button"
          onClick={() => setAsked(addSummaryRequest(slug, file, version) ? 'added' : 'already')}
          title="Put a request for its key points into this job’s message box. Nothing is sent until you send it; the Foreman then writes them (a few cents)."
        >
          Summarise
        </button>
        {asked && (
          <span className="kp-asked" role="status">
            {asked === 'added' ? ' ✓ Added to your message. Send it when you’re ready.' : ' Already in your message.'}
          </span>
        )}
      </div>
    );
  }
  const { outcome, risks, decisions, changed } = summary;
  return (
    <section className={`key-points${summary.stale ? ' is-stale' : ''}`} aria-label={title}>
      <h4 className="kp-title">{title}</h4>
      {summary.stale && summary.version && (
        <p className="kp-stale">
          Summary of {vLabel(summary.version)}{version ? `; this is now ${vLabel(version)}` : ''}. Some of it may have changed.
        </p>
      )}
      {outcome.length > 0 && <Part label="Outcome">{outcome.map((l, i) => <li key={i}><InlineText text={l} /></li>)}</Part>}
      {risks.length > 0 && <Part label="Risks and surprises">{risks.map((l, i) => <li key={i}><InlineText text={l} /></li>)}</Part>}
      {decisions.length > 0 && (
        <Part label="Decisions for you">
          {decisions.map((d, i) => (
            <li key={i}>
              <InlineText text={d.text} />
              {d.recommendation && <> <span className="kp-rec">Recommended: <InlineText text={d.recommendation} /></span></>}
            </li>
          ))}
        </Part>
      )}
      {changed.length > 0 && <Part label="What changed">{changed.map((l, i) => <li key={i}><InlineText text={l} /></li>)}</Part>}
    </section>
  );
}
