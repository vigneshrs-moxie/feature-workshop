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
import { useUi } from '../../app/ui';
import { fullTime, relativeTime, useNow } from '../../lib/time';
import { useWorkshop } from '../../state/store';
import { KeyPoints } from '../../components/KeyPoints';
import { ServerHtml } from '../Foreman/ServerHtml';
import { sectionDocs, sectionOf, sizeLabel, versionLabel, type DocSection } from './docs';

type Load<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; message: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The folder of a document inside the job folder, which its relative links start from. */
const folderOf = (file: string) => (file === 'spec' || !file.includes('/') ? '' : file.slice(0, file.lastIndexOf('/')));

function When({ at, now }: { at: string | null | undefined; now: Date }) {
  if (!at) return null;
  const ago = relativeTime(at, now);
  return <time className="doc-time num" dateTime={at} title={`Last changed ${fullTime(at)}`}>{ago}{/^\d+[mhd]$/.test(ago) ? ' ago' : ''}</time>;
}

function DocItem({ d, now, onPick, itemRef }: { d: JobDocEntry; now: Date; onPick: (file: string) => void; itemRef?: RefObject<HTMLButtonElement | null> }) {
  const pinned = d.file === 'acceptance.md' || d.file === 'dev-tests.md';
  return (
    <li>
      <button
        ref={itemRef}
        type="button"
        className={`doc-item${pinned ? ' is-pinned' : ''}`}
        data-file={d.file}
        onClick={() => onPick(d.file)}
        title={d.type === 'html' ? `Open the screens in the Screens tab (${d.file}).` : `Read ${d.name} as a clean page${d.file === 'spec' ? ' (the spec in the repository)' : ` (${d.file})`}.${pinned ? ' You hand this on to the reviewer.' : ''}`}
      >
        <span className="doc-name">{d.name}</span>
        {d.version && <span className="chip doc-version" title="The version the job’s records name.">{versionLabel(d.version)}</span>}
        {d.type === 'json' && <span className="chip doc-type" title="A JSON file: shown indented, as written.">JSON</span>}
        {d.type === 'html' && <span className="chip doc-type" title="A page: it opens in the Screens tab.">Page</span>}
        {d.summary && (
          <span className={`doc-kp-dot${d.summary === 'stale' ? ' is-stale' : ''}`} title={d.summary === 'stale' ? 'Key points of an older version' : 'Has key points at the top'}>
            <span className="sr-only">{d.summary === 'stale' ? 'Key points (older)' : 'Key points'}</span>
          </span>
        )}
        <span className="doc-spacer" />
        <When at={d.updatedAt} now={now} />
      </button>
    </li>
  );
}

const EMPTY_WORDS: Record<DocSection, string> = {
  plan: 'The spec, the plans, the acceptance criteria and the dev tests show up here as the crew writes them.',
  briefs: 'The Foreman’s briefs to you show up here, newest first.',
  review: 'The review, the test report and any second looks show up here after the build.',
};

function DocList({ shown, more, section, now, onPick, pickedRef }: { shown: JobDocEntry[]; more: JobDocEntry[]; section: DocSection; now: Date; onPick: (file: string) => void; pickedRef: RefObject<HTMLButtonElement | null> }) {
  if (shown.length === 0 && more.length === 0) return <p className="muted doc-empty">{EMPTY_WORDS[section]}</p>;
  return (
    <div className="doc-list">
      {shown.length > 0 && (
        <ul className="doc-items">
          {shown.map((d, i) => <DocItem key={d.file} d={d} now={now} onPick={onPick} itemRef={i === 0 ? pickedRef : undefined} />)}
        </ul>
      )}
      {more.length > 0 && (
        <details className="doc-more">
          <summary title="The job’s own records, each reviewer’s file and raw data.">More files <span className="muted num">{more.length}</span></summary>
          <ul className="doc-items">
            {more.map((d, i) => <DocItem key={d.file} d={d} now={now} onPick={onPick} itemRef={shown.length === 0 && i === 0 ? pickedRef : undefined} />)}
          </ul>
        </details>
      )}
    </div>
  );
}

/** The groups whose documents the Foreman summarises (not your notes or the workflow's own logs). */
const SUMMARISED = new Set(['plan', 'briefs', 'review']);

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
      {doc && !source && doc.type !== 'json' && (doc.summary || SUMMARISED.has(entry?.group ?? '')) && <KeyPoints summary={doc.summary} kind={file.startsWith('briefs/') ? 'brief' : 'doc'} slug={slug} file={file} version={entry?.version ?? null} />}
      {doc && (source
        ? <pre className="doc-source" tabIndex={0} aria-label={`${name}, source`}>{text}</pre>
        : <ServerHtml html={String(doc.html ?? '')} className="doc-page" base={folderOf(file)} />)}
    </article>
  );
}

export function DocsTab({ slug, section = 'plan', onSection, changedAt, focusRequest = 0, requestFile = null, active = true }: {
  slug: string;
  /** Which of the Preview pane's document tabs this is. */
  section?: DocSection;
  /** A link or request opened a document of another tab: switch to it. */
  onSection?: (s: DocSection) => void;
  changedAt?: string | null; focusRequest?: number; requestFile?: string | null; active?: boolean;
}) {
  const { api } = useWorkshop();
  const ui = useUi();
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
    const found = load.state === 'ready' ? load.value.find((d) => d.file === wanted) : undefined;
    if (found) {
      if (sectionOf(found) !== section) onSection?.(sectionOf(found));
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

  // Another tab: its own list, unless the open document is one of its documents.
  const shownSection = useRef(section);
  if (shownSection.current !== section) {
    shownSection.current = section;
    const open = file && load.state === 'ready' ? load.value.find((d) => d.file === file) : null;
    if (file && (!open || sectionOf(open) !== section)) setFile(null);
  }

  const reload = useCallback(() => setTries((n) => n + 1), []);
  const pick = (f: string) => {
    // The wireframes page isn't a document: it opens in the Screens tab.
    if (load.state === 'ready' && load.value.find((d) => d.file === f)?.type === 'html') { ui.openScreens(slug); return; }
    lastPicked.current = f; setLinkHint(null); setFile(f);
  };
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
      <DocList {...sectionDocs(docs, section)} section={section} now={now} onPick={pick} pickedRef={first} />
    </div>
  );
}
