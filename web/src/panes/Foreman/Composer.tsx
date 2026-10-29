// The composer at the foot of the Foreman pane.
// - While the Foreman is idle: write a message, pick the Foreman model, then "Send…" shows exactly
//   what the Foreman will receive (built by the dashboard's own composeReply, editable) before
//   POST /api/job/:slug/send.
// - While it replies: "Steer" adds your message to the reply in progress (POST /api/runs/:id/steer;
//   its delivery state then shows on the message), and "Stop" ends the reply
//   (POST /api/runs/:id/stop); the job then waits for you.
// Each job keeps its own unsent draft in this browser (localStorage): it survives switching jobs,
// reloading and Stop, and is cleared only once the message has gone.
// A gate card's reply made while the Foreman was still working waits here too: the draft then
// remembers the brief it answers (lib/gateCard.ts gateDraftKey), and Send carries it as gateBrief,
// so the brief counts as answered once it goes.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError } from '../../api/client';
import type { JobDetail, JobLockInfo, ModelChoice, Run, Steer } from '../../api/types';
import { composeMessage } from '../../lib/compose';
import { gateDraftKey, KIND_WORDS, readGateMemo } from '../../lib/gateCard';
import { useStored } from '../../lib/stored';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { isActiveRun } from './thread';
import { LockCard, lockFromError } from '../../views/JobLock/LockCard';
import { Choice } from '../../components/Choice';
import { Select } from '../../components/Select';

export const draftKey = (slug: string) => `fw.draft.${slug}`;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function modelLabel(models: ModelChoice[], id: string | null | undefined): string {
  return models.find((m) => m.id === id)?.label ?? id ?? 'the usual model';
}

export interface SendPreviewProps {
  initial: string;
  model: string | null;
  models: ModelChoice[];
  /** Send the text (it throws the dashboard's refusal, shown in the sheet). */
  submit(text: string, opts: { confirmNoTerminal: boolean }): Promise<void>;
  onSent(): void;
  onClose(): void;
  title?: string;
  /** The line above the text box. */
  intro?: string;
  sendLabel?: string;
  sendHint?: string;
  /** Why it can't be sent any more (shown, and Send is off); null or absent when it can. */
  blocked?: string | null;
}

/**
 * The sheet that shows exactly what the Foreman will receive, editable, before it goes: the
 * composer's Send… and the gate card's "Edit, then approve".
 */
export function SendPreview({
  initial, model, models, submit, onSent, onClose,
  title = 'Message the Foreman',
  intro = 'This is exactly what the Foreman will receive. You can still edit it.',
  sendLabel = 'Send to the Foreman',
  sendHint = 'Send this text to the job’s Foreman now (⌘/Ctrl+Enter).',
  blocked = null,
}: SendPreviewProps) {
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
    if (blocked) return;
    if (!text.trim()) { setError('The message is empty.'); return; }
    if (askTerminal && !noTerminal) { setError('Check the open terminals first, then tick the box.'); return; }
    setBusy(true);
    setError(null);
    try {
      await submit(text, { confirmNoTerminal: noTerminal });
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.body.code === 'terminal-open') setAskTerminal(true);
      setError(err instanceof ApiError && err.body.code === 'terminal'
        ? 'This job’s Foreman was last used in your terminal. Carry on there, or close it in the terminal and try again here.'
        : message(err));
      return;
    }
    onSent();
  }

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="sheet send-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h3 id={titleId} className="sheet-title">{title}</h3>
        <label className="field">
          <span>{intro}</span>
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
            <Choice type="checkbox" checked={noTerminal} onChange={(e) => setNoTerminal(e.target.checked)} /> None of the open terminals is this job’s Foreman
          </label>
        )}
        {blocked && <p className="perm-warn" role="alert">{blocked}</p>}
        {error && <p className="field-problem" role="alert">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={busy || Boolean(blocked)} title={blocked ?? sendHint}>
            {busy ? 'Sending…' : sendLabel}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy} title="Go back without sending. Nothing is lost.">Back</button>
        </div>
      </div>
    </div>
  );
}

const FINISHED_FIRST = 'The reply finished before your message got there. It’s still in the box: press Send to send it as a new message.';

export function Composer({ slug, detail, run }: { slug: string; detail: JobDetail | null; run: Run | null }) {
  const { api, store } = useWorkshop();
  const { meta, jobs } = useWorkshopState();
  const models = meta?.models ?? [];
  // The job is held elsewhere (a terminal, another dashboard): from the snapshot, or a refused send.
  // While it is, the box and its buttons are off, with the lock card saying why.
  const heldAt = jobs.find((j) => j.slug === slug)?.lock ?? null;
  const [refused, setRefused] = useState<JobLockInfo | null>(null);
  useEffect(() => { setRefused(null); }, [heldAt?.pid, heldAt?.acquiredAt]);
  const lock = heldAt ?? refused;
  const [stored, setDraft] = useStored(draftKey(slug));
  const [gateRaw, setGateRaw] = useStored(gateDraftKey(slug));
  const draft = stored ?? '';
  // The draft is a gate card's reply: the brief it answers and what kind of reply it is.
  const gate = draft.trim() ? readGateMemo(gateRaw) : null;
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

  /** The message has gone (or the box was emptied): forget the draft and what it answered. */
  function clearDraft() {
    setDraft(null);
    setGateRaw(null);
  }

  function openPreview() {
    if (empty) return;
    setError(null);
    setNote(null);
    // A gate reply was composed already (by the dashboard, with its answers and decisions): as it is.
    setPreview(gate ? draft.trim() : composeMessage(draft, detail?.statusForCompose));
  }

  async function steer() {
    // A gate reply goes as its own message once the Foreman finishes, never into the reply in progress.
    if (!running || empty || gate) return;
    setBusy('steer');
    setError(null);
    setNote(null);
    try {
      const r = await api.post<{ steer: Steer }>(`/api/runs/${encodeURIComponent(run.id)}/steer`, { text: draft });
      store.dispatch({ type: 'steer', steer: r.steer });
      // Accepted, but the reply ended before it was handed over: keep the draft to send anew.
      if (r.steer?.state === 'cancelled') setError(FINISHED_FIRST);
      else clearDraft();
    } catch (err) {
      // The reply ended meanwhile: keep the draft, it goes as a new message instead.
      setError(err instanceof ApiError && err.status === 404 ? FINISHED_FIRST : message(err));
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

  async function submit(text: string, { confirmNoTerminal }: { confirmNoTerminal: boolean }) {
    // A gate reply goes as the kind of reply it is, with the brief it answers.
    try {
      await api.post(`/api/job/${encodeURIComponent(slug)}/send`, {
        kind: gate?.kind ?? 'message', text, model, confirmNoTerminal, ...(gate ? { gateBrief: gate.brief } : {}),
      });
    } catch (err) {
      const held = lockFromError(err);
      if (held) { setRefused(held); setPreview(null); }
      // The Foreman moved on to a newer brief: this reply was for the old one, so nothing was sent.
      // The text stays in the box as an ordinary message; the newer brief's card is the place to decide.
      if (gate && err instanceof ApiError && err.status === 409 && err.body.code === 'stale-brief') {
        const now = typeof err.body.briefNumber === 'number' ? err.body.briefNumber : null;
        setGateRaw(null);
        setPreview(null);
        setError(`The Foreman moved on to ${now ? `brief ${now}` : 'a newer brief'}; your reply to brief ${gate.brief} wasn’t sent. It’s still in the box.`);
      }
      throw err;
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    if (running) void steer(); else openPreview();
  }

  // A gate reply can't steer the reply in progress: it is a decision on its brief, sent on its own.
  const gateWaits = running && gate !== null;

  return (
    <section className="composer" aria-label="Message the Foreman">
      {gate && (
        <p className="muted composer-note composer-gate" role="status">
          {gateWaits
            ? `This is your reply to brief ${gate.brief} (${KIND_WORDS[gate.kind]}); it goes as its own message once the Foreman finishes. Make it a plain message to steer it.`
            : `This is your reply to brief ${gate.brief} from its card (${KIND_WORDS[gate.kind]}). Press Send… to send it.`}{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => setGateRaw(null)}
            title={gateWaits
              ? 'Make this an ordinary message, so you can steer the reply in progress with it: brief cards then don’t count it as your answer.'
              : 'Send this text as an ordinary message instead: brief cards then don’t count it as your answer.'}
          >
            Make it a plain message
          </button>
        </p>
      )}
      {lock && (
        <div className="composer-lock">
          <LockCard lock={lock} />
          {!heldAt && (
            <button type="button" className="btn btn-quiet" onClick={() => setRefused(null)} title="You closed it there: turn the message box back on and send again.">
              It’s closed there now
            </button>
          )}
        </div>
      )}
      <label htmlFor={inputId} className="sr-only">{running ? 'Steer the reply in progress' : 'Your message to the Foreman'}</label>
      <textarea
        id={inputId}
        data-composer-input
        className="text-area composer-input"
        rows={3}
        value={draft}
        placeholder={running ? 'Add something to the reply in progress…' : 'Write to the Foreman…'}
        onChange={(e) => { if (e.target.value === '') clearDraft(); else setDraft(e.target.value); }}
        onKeyDown={onKeyDown}
        disabled={lock !== null}
        title={lock ? 'Off while the job is open somewhere else: only one place can work on a job at a time.' : gateWaits
          ? 'Your reply to a brief, waiting for the Foreman to finish. It goes as its own message then; it can’t steer the reply in progress.'
          : running
          ? 'The Foreman is replying. What you write here joins that reply: it reads it at its next step. ⌘/Ctrl+Enter to steer.'
          : 'Your message to this job’s Foreman. It is kept for this job until you send it. ⌘/Ctrl+Enter to preview and send.'}
      />
      <div className="composer-bar">
        <label className="composer-model" title={running ? 'The model for your next message. The reply in progress keeps the one it started with.' : 'Which Claude model runs this job’s Foreman for your next message. Opus is the everyday choice; Fable costs more.'}>
          <span className="muted">Foreman model</span>
          <Select value={model ?? ''} onChange={setChosenModel} disabled={models.length === 0} options={modelOptions.map((m) => ({ value: m.id, label: m.label }))} />
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
              disabled={empty || stopping || busy !== null || gateWaits}
              title={gateWaits ? `This is your reply to brief ${gate?.brief}; it goes as its own message once the Foreman finishes. Make it a plain message to steer it.`
                : stopping ? 'The reply is stopping. Send your message once it has stopped.' : 'Add your message to the reply in progress. The Foreman reads it at its next step; its state shows on your message.'}
            >
              {busy === 'steer' ? 'Steering…' : 'Steer'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={openPreview}
            disabled={empty || lock !== null}
            title={lock ? 'Off while the job is open somewhere else.' : 'See exactly what the Foreman will receive, then send it.'}
          >
            Send…
          </button>
        )}
      </div>
      {note && <p className="muted composer-note" role="status">{note}</p>}
      {error && <p className="field-problem" role="alert">{error}</p>}
      {preview !== null && (
        <SendPreview
          initial={preview}
          model={model}
          models={models}
          submit={submit}
          onClose={() => setPreview(null)}
          onSent={() => { setPreview(null); clearDraft(); }}
        />
      )}
    </section>
  );
}
