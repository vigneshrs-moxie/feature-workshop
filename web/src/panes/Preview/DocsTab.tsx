// The Preview pane's Docs tab: every document the crew writes for the open job (the spec, findings,
// plans, briefs, reviews, Fable's second looks, notes and the job's own records), listed by group
// with its version and when it changed (GET /api/job/:slug/docs). Picking one shows it as a clean
// page, rendered and sanitised by the dashboard (GET /api/job/:slug/doc, shown with ServerHtml);
// Source shows the Markdown as written (each document opens on its page again). A link in a
// document to another of the job's documents opens that one here (ServerHtml, ui.openDocs(file)).
// Read only: nothing here changes a file.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { JobDoc, JobDocEntry } from '../../api/types';
import { loadJobDoc, loadJobDocs } from '../../app/jobActions';
import { classicHref } from '../../app/router';
import { HowThisWorks } from '../../components/HowThisWorks';
import { fullTime, relativeTime, useNow } from '../../lib/time';
import { useWorkshop } from '../../state/store';
import { ServerHtml } from '../Foreman/ServerHtml';
import { groupDocs, sizeLabel, versionLabel } from './docs';

type Load<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; message: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The folder of a document inside the job folder, which its relative links start from. */
const folderOf = (file: string) => (file === 'spec' || !file.includes('/') ? '' : file.slice(0, file.lastIndexOf('/')));

function When({ at, now }: { at: string | null | undefined; now: Date }) {
  if (!at) return null;
  const ago = relativeTime(at, now);
  return <time className="doc-time num" dateTime={at} title={`Last changed ${fullTime(at)}`}>{ago}{/^\d+[mhd]$/.test(ago) ? ' ago' : ''}</time>;
}

function DocList({ docs, now, onPick, onReload, pickedRef }: { docs: JobDocEntry[]; now: Date; onPick: (file: string) => void; onReload: () => void; pickedRef: RefObject<HTMLButtonElement | null> }) {
  const groups = groupDocs(docs);
  return (
    <div className="doc-list">
      <div className="doc-list-head">
        <span className="muted">{docs.length} document{docs.length === 1 ? '' : 's'}</span>
        <button type="button" className="link-button" onClick={onReload} title="Ask the dashboard for this job’s documents again (new ones also show up when the job changes).">Reload</button>
      </div>
      {groups.map((g) => (
        <section key={g.id} className="doc-group" aria-labelledby={`doc-group-${g.id}`}>
          <h3 className="doc-group-title" id={`doc-group-${g.id}`} title={g.hint}>{g.label} <span className="muted num">{g.docs.length}</span></h3>
          <ul className="doc-items">
            {g.docs.map((d, i) => (
              <li key={d.file}>
                <button
                  ref={g === groups[0] && i === 0 ? pickedRef : undefined}
                  type="button"
                  className="doc-item"
                  data-file={d.file}
                  onClick={() => onPick(d.file)}
                  title={`Read ${d.name} as a clean page${d.file === 'spec' ? ' (the spec in the repository)' : ` (${d.file})`}.`}
                >
                  <span className="doc-name">{d.name}</span>
                  {d.version && <span className="chip doc-version" title="The version the job’s records name.">{versionLabel(d.version)}</span>}
                  {d.type === 'json' && <span className="chip doc-type" title="A JSON file: shown indented, as written.">JSON</span>}
                  <span className="doc-spacer" />
                  <When at={d.updatedAt} now={now} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DocReader({ slug, entry, file, now, onBack }: { slug: string; entry: JobDocEntry | null; file: string; now: Date; onBack: () => void }) {
  const { api } = useWorkshop();
  const [load, setLoad] = useState<Load<JobDoc>>({ state: 'loading' });
  const [tries, setTries] = useState(0);
  // Page or Source, for this document only: the next one opens on its page again.
  const [source, setSource] = useState(false);
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const back = useRef<HTMLButtonElement>(null);
  const changed = entry?.updatedAt ?? null;

  useEffect(() => { back.current?.focus(); }, [file]);
  useEffect(() => {
    let cancelled = false;
    setLoad((l) => (l.state === 'ready' && l.value.file === file ? l : { state: 'loading' }));
    loadJobDoc(api, slug, file).then(
      (d) => { if (!cancelled) setLoad({ state: 'ready', value: d }); },
      (err) => { if (!cancelled) setLoad({ state: 'error', message: message(err) }); },
    );
    return () => { cancelled = true; };
  }, [api, slug, file, tries, changed]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  }

  const doc = load.state === 'ready' ? load.value : null;
  const name = doc?.name ?? entry?.name ?? file;
  const text = doc?.text ?? '';
  return (
    <article className="doc-reader" aria-label={name}>
      <header className="doc-reader-head">
        <button ref={back} type="button" className="btn btn-quiet doc-back" onClick={onBack} title="Back to the list of this job’s documents.">
          <span className="doc-back-arrow" aria-hidden="true">←</span>All documents
        </button>
        <h3 className="doc-title">
          {name}
          {entry?.version && <> <span className="chip doc-version">{versionLabel(entry.version)}</span></>}
        </h3>
        <p className="doc-facts muted">
          {file === 'spec' ? 'Product spec, in the repository' : file}
          {(doc?.updatedAt ?? entry?.updatedAt) && <> · changed <When at={doc?.updatedAt ?? entry?.updatedAt} now={now} /></>}
          {(doc?.size ?? entry?.size) ? <> · {sizeLabel(doc?.size ?? entry?.size)}</> : null}
        </p>
        <div className="doc-actions">
          <div className="doc-view-toggle" role="group" aria-label="Show as">
            <button type="button" className="btn btn-quiet" aria-pressed={!source} onClick={() => setSource(false)} title="Show the document as a formatted page.">Page</button>
            <button type="button" className="btn btn-quiet" aria-pressed={source} onClick={() => setSource(true)} title={doc?.type === 'json' ? 'Show the JSON exactly as written.' : 'Show the Markdown source exactly as written.'}>Source</button>
          </div>
          <button type="button" className="btn btn-quiet" disabled={!doc || typeof doc.text !== 'string'} onClick={() => void copy(text)} title={doc?.type === 'json' ? 'Copy the JSON as written.' : 'Copy the document’s Markdown, to paste it somewhere else.'}>
            {doc?.type === 'json' ? 'Copy JSON' : 'Copy as markdown'}
          </button>
          <a className="btn btn-quiet" href={classicHref.job(slug)} title="Open this job in the classic view. Its Files and Briefs tabs show the same documents.">Open in classic view</a>
        </div>
        {copied === 'ok' && <p className="doc-copied drawer-state is-ok" role="status">✓ Copied</p>}
        {copied === 'failed' && <p className="field-problem" role="alert">Couldn’t copy: this browser didn’t allow it. Choose Source and copy the text yourself.</p>}
      </header>
      {load.state === 'loading' && <p className="muted" role="status">Loading the document…</p>}
      {load.state === 'error' && (
        <div>
          <p className="thread-error" role="alert">Couldn’t load it: {load.message}</p>
          <button type="button" className="btn" onClick={() => setTries((n) => n + 1)} title="Ask the dashboard for this document again.">Try again</button>
        </div>
      )}
      {doc && (source
        ? <pre className="doc-source" tabIndex={0} aria-label={`${name}, source`}>{text}</pre>
        : <ServerHtml html={String(doc.html ?? '')} className="doc-page" base={folderOf(file)} />)}
    </article>
  );
}

export function DocsTab({ slug, changedAt, focusRequest = 0, requestFile = null, active = true }: { slug: string; changedAt?: string | null; focusRequest?: number; requestFile?: string | null; active?: boolean }) {
  const { api } = useWorkshop();
  const now = useNow();
  const [load, setLoad] = useState<Load<JobDocEntry[]>>({ state: 'loading' });
  const [tries, setTries] = useState(0);
  const [file, setFile] = useState<string | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  const lastPicked = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad((l) => (l.state === 'ready' ? l : { state: 'loading' }));
    loadJobDocs(api, slug).then(
      (docs) => { if (!cancelled) setLoad({ state: 'ready', value: docs }); },
      (err) => { if (!cancelled) setLoad({ state: 'error', message: message(err) }); },
    );
    return () => { cancelled = true; };
  }, [api, slug, tries, changedAt]);

  // ⌘K "Open docs" (a request made after this job's tab opened): back to the list, focus on its
  // first document (or the Docs tab when there is none) once the tab shows and the list is loaded.
  // A link to another document (requestFile): that document, once the list is loaded, when it is
  // one of this job's; otherwise the link isn't followed and a line says why.
  const seenRequest = useRef(focusRequest);
  const focusPending = useRef(false);
  const filePending = useRef<string | null>(null);
  const [linkHint, setLinkHint] = useState<string | null>(null);
  if (focusRequest !== seenRequest.current) {
    seenRequest.current = focusRequest;
    if (requestFile) {
      filePending.current = requestFile;
    } else {
      focusPending.current = true;
      if (file !== null) setFile(null);
      if (linkHint !== null) setLinkHint(null);
    }
  }
  useEffect(() => {
    const wanted = filePending.current;
    if (!wanted || load.state === 'loading') return;
    filePending.current = null;
    if (load.state === 'ready' && load.value.some((d) => d.file === wanted)) {
      setLinkHint(null);
      lastPicked.current = wanted;
      setFile(wanted);
    } else {
      setLinkHint(`The link points to ${wanted}, which isn’t one of this job’s documents, so it didn’t open.`);
    }
  });
  useEffect(() => {
    if (!focusPending.current || !active || file !== null || load.state === 'loading') return;
    focusPending.current = false;
    (first.current ?? document.getElementById('preview-tab-docs'))?.focus();
  });

  const reload = useCallback(() => setTries((n) => n + 1), []);
  const pick = (f: string) => { lastPicked.current = f; setLinkHint(null); setFile(f); };
  const backToList = () => {
    setLinkHint(null);
    setFile(null);
    // Focus goes back to the document you were reading.
    setTimeout(() => {
      const f = lastPicked.current;
      const btn = f ? [...document.querySelectorAll<HTMLButtonElement>('.doc-item')].find((b) => b.dataset.file === f) : null;
      (btn ?? first.current)?.focus();
    }, 0);
  };

  const docs = load.state === 'ready' ? load.value : [];
  const how = (
    <HowThisWorks id="docs-tab">
      <p>Every document the crew writes for this job, shown as a clean page.</p>
      <p>The spec, findings and plans are under <strong>Plan &amp; spec</strong>, the Foreman’s briefs under <strong>Briefs</strong>, the reviewers’ findings and Fable’s second looks under <strong>Review</strong>, and your notes under <strong>Notes</strong>. A version shows when the job’s records name one. <strong>Source</strong> shows the Markdown exactly as written, <strong>Copy as markdown</strong> copies it. A link in a document to another of the job’s documents opens it here. Nothing here changes a file: the Foreman and its crew write them, and your notes are edited in the job drawer.</p>
    </HowThisWorks>
  );

  if (load.state === 'loading') return <div className="docs-tab"><p className="muted" role="status">Loading this job’s documents…</p></div>;
  if (load.state === 'error') {
    return (
      <div className="docs-tab">
        <p className="thread-error" role="alert">Couldn’t load the documents: {load.message}</p>
        <button type="button" className="btn" onClick={reload} title="Ask the dashboard for this job’s documents again.">Try again</button>
      </div>
    );
  }
  const hint = linkHint && <p className="link-hint doc-link-hint" role="status">{linkHint}</p>;
  if (file) {
    return (
      <div className="docs-tab">
        {hint}
        <DocReader key={file} slug={slug} file={file} entry={docs.find((d) => d.file === file) ?? null} now={now} onBack={backToList} />
      </div>
    );
  }
  return (
    <div className="docs-tab">
      {hint}
      {how}
      {docs.length === 0 ? (
        <div className="doc-empty">
          <p>No documents yet.</p>
          <p className="muted">The spec, plans, briefs and reviews show up here as the crew writes them.</p>
          <button type="button" className="link-button" onClick={reload} title="Ask the dashboard for this job’s documents again.">Check again</button>
        </div>
      ) : (
        <DocList docs={docs} now={now} onPick={pick} onReload={reload} pickedRef={first} />
      )}
    </div>
  );
}
