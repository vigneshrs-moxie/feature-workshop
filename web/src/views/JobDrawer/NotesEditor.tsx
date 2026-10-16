// The job drawer's Notes tab: the job's notes.md, loaded with GET /api/job/:slug/notes and saved
// whole with PUT (at most 20,000 characters; the dashboard refuses more). Tells the drawer when
// there are unsaved changes, so closing it asks first. Preview shows the text as you have it now
// (saved or not) as a clean page: the dashboard renders it with the same sanitising renderer as
// every document (POST /api/job/:slug/render; nothing is saved by previewing).
import { useEffect, useId, useState } from 'react';
import { loadJobNotes, renderPreview, saveJobNotes } from '../../app/jobActions';
import { fullTime, relativeTime, useNow } from '../../lib/time';
import { ServerHtml } from '../../panes/Foreman/ServerHtml';
import { useWorkshop } from '../../state/store';

type Preview = { text: string; state: 'loading' } | { text: string; state: 'ready'; html: string } | { text: string; state: 'error'; message: string };

/** The notes as a page: rendered by the dashboard for exactly this text. */
function NotesPreview({ slug, text }: { slug: string; text: string }) {
  const { api } = useWorkshop();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!text.trim()) return;
    let cancelled = false;
    setPreview({ text, state: 'loading' });
    renderPreview(api, slug, text).then(
      (html) => { if (!cancelled) setPreview({ text, state: 'ready', html }); },
      (err) => { if (!cancelled) setPreview({ text, state: 'error', message: message(err) }); },
    );
    return () => { cancelled = true; };
  }, [api, slug, text, tries]);
  if (!text.trim()) return <p className="muted drawer-notes-preview">Nothing to preview yet. Choose Edit to write the notes.</p>;
  const p = preview?.text === text ? preview : null;
  return (
    <div className="drawer-notes-preview" aria-label="Notes preview" role="region">
      {(!p || p.state === 'loading') && <p className="muted" role="status">Getting the preview…</p>}
      {p?.state === 'error' && (
        <>
          <p className="thread-error" role="alert">Couldn’t show the preview: {p.message}</p>
          <button type="button" className="btn" onClick={() => setTries((n) => n + 1)} title="Ask the dashboard for the preview again.">Try again</button>
        </>
      )}
      {p?.state === 'ready' && <ServerHtml html={p.html} />}
    </div>
  );
}

export const NOTES_HINT = 'The Foreman reads these notes at the start of every session; they shape how it works, never approve anything.';

type Load = { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function NotesEditor({ slug, max, onDirtyChange }: { slug: string; max: number; onDirtyChange: (dirty: boolean) => void }) {
  const { api } = useWorkshop();
  const now = useNow();
  const id = useId();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [saved, setSaved] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [tries, setTries] = useState(0);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    loadJobNotes(api, slug).then(
      (n) => {
        if (cancelled) return;
        const t = typeof n?.text === 'string' ? n.text : '';
        setSaved(t);
        setText(t);
        setUpdatedAt(n?.updatedAt ?? null);
        setLoad({ state: 'ready' });
      },
      (err) => { if (!cancelled) setLoad({ state: 'error', message: message(err) }); },
    );
    return () => { cancelled = true; };
  }, [api, slug, tries]);

  const dirty = load.state === 'ready' && text !== saved;
  const over = text.length > max;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const n = await saveJobNotes(api, slug, text);
      const t = typeof n?.text === 'string' ? n.text : text;
      setSaved(t);
      setText(t);
      setUpdatedAt(n?.updatedAt ?? new Date().toISOString());
      setJustSaved(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (load.state === 'loading') return <p className="muted" role="status">Loading the notes…</p>;
  if (load.state === 'error') {
    return (
      <div>
        <p className="thread-error" role="alert">Couldn’t load the notes: {load.message}</p>
        <button type="button" className="btn" onClick={() => setTries((n) => n + 1)} title="Ask the dashboard for the notes again.">Try again</button>
      </div>
    );
  }

  const ago = updatedAt ? relativeTime(updatedAt, now) : '';
  return (
    <div className="drawer-notes">
      <p className="muted drawer-hint">{NOTES_HINT}</p>
      <div className="notes-mode doc-view-toggle" role="group" aria-label="Notes view">
        <button type="button" className="btn btn-quiet" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')} title="Write the notes, in Markdown.">Edit</button>
        <button type="button" className="btn btn-quiet" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')} title="See the notes as a clean page, exactly as you have them now (saved or not). Nothing is saved by previewing.">Preview</button>
      </div>
      {mode === 'preview' && <NotesPreview slug={slug} text={text} />}
      <label className="sr-only" htmlFor={id}>Notes for the Foreman (notes.md)</label>
      <textarea
        hidden={mode !== 'edit'}
        id={id}
        className="text-area drawer-notes-input"
        rows={14}
        value={text}
        disabled={busy}
        onChange={(e) => { setText(e.target.value); setJustSaved(false); setError(null); }}
        placeholder="For example: “Keep the old export working. Ask before renaming anything in the API.”"
        title="This job’s notes.md, in Markdown. The Foreman reads them at the start of every session; they guide how it works and never count as an approval."
        aria-describedby={`${id}-count`}
      />
      <div className="drawer-bar">
        <span id={`${id}-count`} className={`drawer-count num${over ? ' is-over' : ''}`} title={`notes.md can be at most ${max.toLocaleString('en')} characters.`}>
          {text.length.toLocaleString('en')} / {max.toLocaleString('en')} characters
        </span>
        <span className="composer-spacer" />
        {dirty && !busy && <span className="drawer-state" role="status">Unsaved changes</span>}
        {!dirty && justSaved && <span className="drawer-state is-ok" role="status">✓ Saved</span>}
        {!dirty && !justSaved && updatedAt && <span className="drawer-state muted" title={fullTime(updatedAt)}>Saved {ago}{/^\d+[mhd]$/.test(ago) ? ' ago' : ''}</span>}
        {!dirty && !justSaved && !updatedAt && <span className="drawer-state muted">No notes yet</span>}
        <button
          type="button"
          className="btn btn-quiet"
          disabled={!dirty || busy}
          onClick={() => { setText(saved); setError(null); }}
          title="Put the notes back as they were last saved."
        >
          Undo changes
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || over || busy}
          onClick={() => void save()}
          title={over ? `Too long: shorten the notes to ${max.toLocaleString('en')} characters to save them.` : 'Save notes.md for this job. The Foreman reads it at the start of its next session.'}
        >
          {busy ? 'Saving…' : 'Save notes'}
        </button>
      </div>
      {over && <p className="field-problem" role="alert">Too long: the notes can be at most {max.toLocaleString('en')} characters. Shorten them by {(text.length - max).toLocaleString('en')} to save.</p>}
      {error && <p className="field-problem" role="alert">{error}</p>}
    </div>
  );
}
