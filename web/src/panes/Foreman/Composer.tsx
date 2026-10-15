// The composer at the foot of the Foreman pane.
// - While the Foreman is idle: write a message, pick the Foreman model, then "Send…" shows exactly
//   what the Foreman will receive (built by the dashboard's own composeReply, editable) before
//   POST /api/job/:slug/send.
// - While it replies: "Steer" adds your message to the reply in progress (POST /api/runs/:id/steer;
//   its delivery state then shows on the message), and "Stop" ends the reply
//   (POST /api/runs/:id/stop); the job then waits for you.
// Each job keeps its own unsent draft in this browser (localStorage): it survives switching jobs,
// reloading and Stop, and is cleared only once the message has gone.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError } from '../../api/client';
import type { JobDetail, ModelChoice, Run, Steer } from '../../api/types';
import { composeMessage } from '../../lib/compose';
import { useStored } from '../../lib/stored';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { isActiveRun } from './thread';

export const draftKey = (slug: string) => `fw.draft.${slug}`;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function modelLabel(models: ModelChoice[], id: string | null | undefined): string {
  return models.find((m) => m.id === id)?.label ?? id ?? 'the usual model';
}

function SendPreview({ slug, initial, model, models, onSent, onClose }: {
  slug: string; initial: string; model: string | null; models: ModelChoice[]; onSent: () => void; onClose: () => void;
}) {
  const { api } = useWorkshop();
  const titleId = useId();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Claude Code is open in a terminal in this repository: you confirm none of them is this job's Foreman.
  const [askTerminal, setAskTerminal] = useState(false);
  const [noTerminal, setNoTerminal] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function send() {
    if (!text.trim()) { setError('The message is empty.'); return; }
    if (askTerminal && !noTerminal) { setError('Check the open terminals first, then tick the box.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/job/${encodeURIComponent(slug)}/send`, { kind: 'message', text, model, confirmNoTerminal: noTerminal });
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.body.code === 'terminal-open') setAskTerminal(true);
      setError(err instanceof ApiError && err.body.code === 'terminal'
        ? 'This job’s Foreman was last used in your terminal. Take it over in the classic view first, or carry on in the terminal.'
        : message(err));
      return;
    }
    onSent();
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="sheet send-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h3 id={titleId} className="sheet-title">Message the Foreman</h3>
        <label className="field">
          <span>This is exactly what the Foreman will receive. You can still edit it.</span>
          <textarea
            ref={box}
            className="text-area preview-text"
            rows={9}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
            title="The final text. It is also saved in the job’s activity log."
          />
        </label>
        <p className="muted send-facts">
          Sent with <strong>{modelLabel(models, model)}</strong>. The Foreman reads it and replies here.
        </p>
        {askTerminal && (
          <label className="check" title="Claude Code is open in this repository in a terminal. Two Foremen on one job would trip over each other.">
            <input type="checkbox" checked={noTerminal} onChange={(e) => setNoTerminal(e.target.checked)} /> None of the open terminals is this job’s Foreman
          </label>
        )}
        {error && <p className="field-problem" role="alert">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={busy} title="Send this text to the job’s Foreman now (⌘/Ctrl+Enter).">
            {busy ? 'Sending…' : 'Send to the Foreman'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy} title="Go back to your draft without sending. Your draft is kept.">Back</button>
        </div>
      </div>
    </div>
  );
}

export function Composer({ slug, detail, run }: { slug: string; detail: JobDetail | null; run: Run | null }) {
  const { api, store } = useWorkshop();
  const { meta } = useWorkshopState();
  const models = meta?.models ?? [];
  const [stored, setDraft] = useStored(draftKey(slug));
  const draft = stored ?? '';
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'steer' | 'stop' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const inputId = useId();

  const running = isActiveRun(run);
  const stopping = running && run.status === 'stopping';
  const lastModel = detail?.drive?.model ?? null;
  const model = chosenModel ?? lastModel ?? models[0]?.id ?? null;
  const modelOptions = lastModel && !models.some((m) => m.id === lastModel) ? [...models, { id: lastModel, label: lastModel }] : models;
  const empty = draft.trim() === '';

  // "Stopping…" is over once the reply ends; an old problem is moot once a new reply starts.
  useEffect(() => { setNote(null); if (running) setError(null); }, [running]);

  function openPreview() {
    if (empty) return;
    setError(null);
    setNote(null);
    setPreview(composeMessage(draft, detail?.statusForCompose));
  }

  async function steer() {
    if (!running || empty) return;
    setBusy('steer');
    setError(null);
    setNote(null);
    try {
      const r = await api.post<{ steer: Steer }>(`/api/runs/${encodeURIComponent(run.id)}/steer`, { text: draft });
      store.dispatch({ type: 'steer', steer: r.steer });
      setDraft(null);
    } catch (err) {
      // The reply ended meanwhile: keep the draft, it goes as a new message instead.
      setError(err instanceof ApiError && err.status === 404
        ? 'The reply finished before your message got there. It’s still in the box: press Send to send it as a new message.'
        : message(err));
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    if (!running) return;
    setBusy('stop');
    setError(null);
    try {
      await api.post(`/api/runs/${encodeURIComponent(run.id)}/stop`, {});
      setNote('Stopping. Your draft is kept; the job waits for your next message.');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    if (running) void steer(); else openPreview();
  }

  return (
    <section className="composer" aria-label="Message the Foreman">
      <label htmlFor={inputId} className="sr-only">{running ? 'Steer the reply in progress' : 'Your message to the Foreman'}</label>
      <textarea
        id={inputId}
        data-composer-input
        className="text-area composer-input"
        rows={3}
        value={draft}
        placeholder={running ? 'Add something to the reply in progress…' : 'Write to the Foreman…'}
        onChange={(e) => setDraft(e.target.value === '' ? null : e.target.value)}
        onKeyDown={onKeyDown}
        title={running
          ? 'The Foreman is replying. What you write here joins that reply: it reads it at its next step. ⌘/Ctrl+Enter to steer.'
          : 'Your message to this job’s Foreman. It is kept for this job until you send it. ⌘/Ctrl+Enter to preview and send.'}
      />
      <div className="composer-bar">
        <label className="composer-model" title={running ? 'The model for your next message. The reply in progress keeps the one it started with.' : 'Which Claude model runs this job’s Foreman for your next message. Opus is the everyday choice; Fable costs more.'}>
          <span className="muted">Foreman model</span>
          <select className="select" value={model ?? ''} onChange={(e) => setChosenModel(e.target.value)} disabled={models.length === 0}>
            {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <span className="composer-spacer" />
        {running ? (
          <>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void stop()}
              disabled={stopping || busy !== null}
              title="End the Foreman’s reply now. Anything waiting for your answer is declined, your draft is kept, and the job waits for your next message."
            >
              {stopping || busy === 'stop' ? 'Stopping…' : 'Stop'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void steer()}
              disabled={empty || stopping || busy !== null}
              title={stopping ? 'The reply is stopping. Send your message once it has stopped.' : 'Add your message to the reply in progress. The Foreman reads it at its next step; its state shows on your message.'}
            >
              {busy === 'steer' ? 'Steering…' : 'Steer'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={openPreview}
            disabled={empty}
            title="See exactly what the Foreman will receive, then send it."
          >
            Send…
          </button>
        )}
      </div>
      {note && <p className="muted composer-note" role="status">{note}</p>}
      {error && <p className="field-problem" role="alert">{error}</p>}
      {preview !== null && (
        <SendPreview
          slug={slug}
          initial={preview}
          model={model}
          models={models}
          onClose={() => setPreview(null)}
          onSent={() => { setPreview(null); setDraft(null); }}
        />
      )}
    </section>
  );
}
