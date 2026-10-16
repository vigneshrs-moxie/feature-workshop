// A brief from the Foreman: its headline, opened to the full brief while it waits for you, and
// collapsed back to the headline once you've answered it (or a newer brief replaced it). Click the
// headline to open or close it any time. If the brief has a detail file it shows as a folded
// section underneath, read only when you open it. Rulings and proof lines show only if present.
import { useEffect, useState } from 'react';
import type { JobDoc } from '../../api/types';
import { fullTime, relativeTime } from '../../lib/time';
import { useWorkshop } from '../../state/store';
import { stageLabel } from '../Jobs/stages';
import { ServerHtml } from './ServerHtml';
import { ExtrasLines } from './ExtrasLines';
import type { ShownBrief } from './thread';

type Doc = { state: 'loading' } | { state: 'ready'; html: string } | { state: 'error'; message: string };

function useDoc(slug: string, file: string | null): Doc | null {
  const { api } = useWorkshop();
  const [doc, setDoc] = useState<{ key: string; doc: Doc } | null>(null);
  const key = file ? `${slug}\n${file}` : '';
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setDoc({ key, doc: { state: 'loading' } });
    api.get<JobDoc>(`/api/job/${encodeURIComponent(slug)}/doc?file=${encodeURIComponent(file)}`).then(
      (d) => { if (!cancelled) setDoc({ key, doc: { state: 'ready', html: String(d.html ?? '') } }); },
      (err) => { if (!cancelled) setDoc({ key, doc: { state: 'error', message: err instanceof Error ? err.message : String(err) } }); },
    );
    return () => { cancelled = true; };
  }, [api, slug, file, key]);
  if (!file) return null;
  return doc?.key === key ? doc.doc : { state: 'loading' };
}

const plainText = (html: string) =>
  html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/**
 * A brief's first line is normally its headline (the dashboard reads the headline from it), which
 * the card already shows above the body: leave that first paragraph out, so it isn't said twice.
 * Only when the paragraph is the headline plus at most a short tag such as "(demo)".
 */
export function withoutLeadHeadline(html: string, headline: string): string {
  const want = plainText(headline);
  const m = /^\s*<p>([\s\S]*?)<\/p>\s*/.exec(html);
  if (!want || !m) return html;
  const lead = plainText(m[1]);
  return lead.startsWith(want) && lead.length - want.length <= 20 ? html.slice(m[0].length) : html;
}

function DocBody({ doc, what, headline }: { doc: Doc | null; what: string; headline?: string }) {
  if (!doc || doc.state === 'loading') return <p className="muted">Loading the {what}…</p>;
  if (doc.state === 'error') return <p className="thread-error" role="alert">Couldn’t load the {what}: {doc.message}</p>;
  return <ServerHtml html={headline ? withoutLeadHeadline(doc.html, headline) : doc.html} />;
}

function DetailFold({ slug, file }: { slug: string; file: string }) {
  const [open, setOpen] = useState(false);
  const doc = useDoc(slug, open ? file : null);
  return (
    <details className="brief-detail" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary title="Show the longer explanation the Foreman wrote to go with this brief.">More detail</summary>
      {open && <DocBody doc={doc} what="detail" />}
    </details>
  );
}

export function BriefCard({ slug, brief, now }: { slug: string; brief: ShownBrief; now: Date }) {
  const { item, answered, detailFile } = brief;
  const [open, setOpen] = useState(!answered);
  // Answering it folds it back to its headline (and a brief that is open again opens): followed
  // here, not by remounting the card, so a brief you opened doesn't fetch itself again.
  const [wasAnswered, setWasAnswered] = useState(answered);
  if (wasAnswered !== answered) {
    setWasAnswered(answered);
    setOpen(!answered);
  }
  const doc = useDoc(slug, open ? item.file : null);
  const stage = stageLabel(item.stage);
  const label = `Brief #${item.number}${stage ? ` · ${stage}` : ''}`;
  const headline = item.headline || item.point || label;
  const bodyId = `brief-body-${item.id.replace(/[^\w-]/g, '_')}`;
  return (
    <article className={`thread-item brief-card${answered ? ' is-answered' : ''}`} aria-label={label}>
      <header className="brief-head">
        <button
          type="button"
          className="brief-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          title={open ? 'Fold this brief back to its headline.' : 'Open the whole brief.'}
        >
          <span className="brief-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className="brief-label">{label}</span>
          {answered && <span className="brief-state">Answered</span>}
          {item.at && <time className="thread-time num" dateTime={item.at} title={fullTime(item.at)}>{relativeTime(item.at, now)}</time>}
        </button>
        <p className="brief-headline">{headline}</p>
      </header>
      <div id={bodyId} className="brief-body" hidden={!open}>
        {open && <DocBody doc={doc} what="brief" headline={headline} />}
        {detailFile && <DetailFold slug={slug} file={detailFile} />}
      </div>
      <ExtrasLines item={item} />
    </article>
  );
}
