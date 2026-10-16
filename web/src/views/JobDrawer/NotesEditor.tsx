// The job drawer's Notes tab: the job's notes.md, loaded with GET /api/job/:slug/notes and saved
// whole with PUT (at most 20,000 characters; the dashboard refuses more). Tells the drawer when
// there are unsaved changes, so closing it asks first.
import { useEffect, useId, useState } from 'react';
import { loadJobNotes, saveJobNotes } from '../../app/jobActions';
import { fullTime, relativeTime, useNow } from '../../lib/time';
import { useWorkshop } from '../../state/store';

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
      <label className="sr-only" htmlFor={id}>Notes for the Foreman (notes.md)</label>
      <textarea
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
