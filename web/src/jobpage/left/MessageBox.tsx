// The message box (Task 11, R8): one box, docked at the foot of the left pane, always there. It grows
// with its words to eight lines, then scrolls (the stylesheet: field-sizing; a browser without it
// gets the height set here). There is one place to write, and what the words do depends on the call:
//   - with Go (Your move), they are the approval's note;
//   - with Send back (Your move), they are the change;
//   - alone, with Send, they are a message to the Foreman (POST /api/job/:slug/send).
// No Reply mode, no Steer.
//
// The draft lives in the page's store, which keeps it under the old page's key (fw.draft.<slug>), so
// a refresh, a step pick, a permission card, a width change and a reload all find the same words.
//
// Send shows `Sent` at once and empties the box; a refusal puts the words back (before anything
// typed since) with the server's reason in plain words. It sends once however fast he clicks.
// While a reply runs the box says `Sends when the Foreman finishes`, with `Stop it and send now`
// beside it. Waiting messages are Task 16: until then Send keeps the words in the box and sends
// nothing, and `Stop it and send now` stops the reply (POST /api/runs/:id/stop), then sends the
// words once the run has ended.
//
// Keys: c and i put the cursor here (the page's jp-write); ⌘↵ in the box is Go while a go-ahead
// waits (Your move's jp-go), else Send.

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from 'react';
import { ApiError } from '../../api/client';
import { BRAND } from '../../app/brand';
import { pressKey } from '../../app/keyRegistry';
import { Button } from '../../components/Button';
import { Choice } from '../../components/Choice';
import { useNarrow } from '../../components/page/Page';
import { useWorkshop } from '../../state/store';
import { useJob, useJobStore } from '../useJob';

/** The run statuses that mean the Foreman is replying right now (panes/Foreman/thread.ts ACTIVE). */
const ACTIVE = new Set(['starting', 'running', 'waiting_permission', 'stopping']);

export const PLACEHOLDER = 'Write to the Foreman…';
export const WHILE_RUNNING = 'Sends when the Foreman finishes';
const AFTER_SENT = 'Sent. Write more to the Foreman…';

const UNREACHABLE = `Couldn’t reach ${BRAND.name}. Try again.`;
const BUSY = 'Not sent: the Foreman is still working on a reply. Your words are back in the box; send them when it finishes, or Stop it and send now.';
// Waiting messages come with Task 16; until then this says what to do.
const KEPT = 'Kept here, not sent. Press Send when the Foreman finishes, or Stop it and send now.';
const LOCKED = `Another place is working on this job (a terminal, or another ${BRAND.name}). Only one place can work on a job at a time.`;

/** The server's no, in plain words. */
export function sendRefusal(err: unknown): string {
  if (err instanceof TypeError) return UNREACHABLE;
  const code = err instanceof ApiError ? err.body.code : null;
  if (code === 'limited') return 'Not sent: Claude’s usage limit is reached. Your words are back in the box; send them once it resets.';
  if (code === 'terminal') return 'Not sent: this job’s Foreman was last used in your terminal. Carry on there, or close it in the terminal and send again here.';
  if (code === 'terminal-open') return 'Not sent: Claude Code is open in this repository in a terminal. Tick the box below if none of those windows is this job’s Foreman, then send again.';
  if (code === 'job-locked') return `Not sent: ${LOCKED}`;
  if (err instanceof ApiError && err.status === 409 && !code) return BUSY;
  return `Not sent: ${err instanceof Error ? err.message : String(err)}`;
}

type RunFacts = { id: string | null; status: string | null } | null;

/**
 * The run the Foreman is on, as fresh as the page can know it: the app's live run (the stream's
 * `run` events) when it is the payload's run or the payload names none, else the payload's.
 */
function runNow(live: RunFacts, p: RunFacts): RunFacts {
  if (live && (!p || !p.id || live.id === p.id)) return live;
  if (p && live && ACTIVE.has(live.status ?? '') && !ACTIVE.has(p.status ?? '')) return live;
  return p;
}

/** Where a browser can't size a box to its words: set its height here, up to eight lines. */
const FITS = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');
function fit(el: HTMLTextAreaElement) {
  if (FITS) return;
  if (!el.value) { el.style.height = ''; el.style.overflowY = ''; return; }
  el.style.height = 'auto';
  const most = parseFloat(getComputedStyle(el).maxHeight) || 172;
  const h = el.scrollHeight + 2;
  el.style.height = `${Math.min(h, most)}px`;
  el.style.overflowY = h > most ? 'auto' : 'hidden';
}

export interface MessageBoxProps {
  /** The page's handle on the box (c and i, quick replies and Send back put the cursor in it). */
  boxRef: RefObject<HTMLTextAreaElement | null>;
}

export const MessageBox = memo(function MessageBox({ boxRef }: MessageBoxProps) {
  const store = useJobStore();
  const { api, store: app } = useWorkshop();
  const slug = useJob((s) => s.slug);
  const draft = useJob((s) => s.ui.draft);
  const gateWaits = useJob((s) => s.payload?.move?.kind === 'gate');
  const locked = useJob((s) => Boolean(s.payload?.lock));
  const payloadRunId = useJob((s) => s.payload?.run?.id ?? null);
  const payloadRunStatus = useJob((s) => s.payload?.run?.status ?? null);
  const liveRunId = useSyncExternalStore(app.subscribe, () => app.getState().runs[slug]?.id ?? null);
  const liveRunStatus = useSyncExternalStore(app.subscribe, () => app.getState().runs[slug]?.status ?? null);
  const hasPayloadRun = useJob((s) => Boolean(s.payload?.run));
  const hasLiveRun = useSyncExternalStore(app.subscribe, () => Boolean(app.getState().runs[slug]));
  const run = runNow(hasLiveRun ? { id: liveRunId, status: liveRunStatus } : null, hasPayloadRun ? { id: payloadRunId, status: payloadRunStatus } : null);
  const running = Boolean(run && ACTIVE.has(run.status ?? ''));
  const narrow = useNarrow();

  /** sent: the last words went (Send says Sent until he types again); stopping: Stop it and send now is waiting for the reply to end. */
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'stopping'>('idle');
  const [line, setLine] = useState<{ words: string; problem: boolean } | null>(null);
  const [askTerminal, setAskTerminal] = useState(false);
  const [noTerminal, setNoTerminal] = useState(false);
  const out = useRef(false);

  useLayoutEffect(() => { if (boxRef.current) fit(boxRef.current); }, [boxRef, draft]);

  const focusBox = useCallback(() => { pressKey('jp-write'); if (document.activeElement !== boxRef.current) boxRef.current?.focus(); }, [boxRef]);

  const send = useCallback(async () => {
    if (out.current) return;
    const words = store.getState().ui.draft;
    const text = words.trim();
    if (!text) { focusBox(); return; }
    out.current = true;
    setPhase('sending');
    setLine(null);
    store.setDraft('');
    let r: { queued?: unknown } | null;
    try {
      r = await api.post<{ queued?: unknown }>(`/api/job/${encodeURIComponent(slug)}/send`, { kind: 'message', text, confirmNoTerminal: noTerminal });
    } catch (err) {
      out.current = false;
      setPhase('idle');
      // His words back, before anything typed since.
      const now = store.getState().ui.draft;
      if (!now.trim()) store.setDraft(words);
      else if (!now.includes(text)) store.setDraft(`${text}\n\n${now}`);
      setLine({ words: sendRefusal(err), problem: true });
      if (err instanceof ApiError && err.body.code === 'terminal-open') setAskTerminal(true);
      return;
    }
    out.current = false;
    setPhase('sent');
    setAskTerminal(false);
    setNoTerminal(false);
    // On the website a message waits for the laptop.
    if (r && typeof r === 'object' && r.queued) setLine({ words: 'Queued for your laptop: it goes to the Foreman when the laptop picks it up.', problem: false });
  }, [api, store, slug, noTerminal, focusBox]);

  const pressSend = useCallback(() => {
    if (!store.getState().ui.draft.trim()) { focusBox(); return; }
    if (locked) return;
    // Waiting messages are Task 16: the words stay in the box.
    if (running) { setLine({ words: KEPT, problem: false }); return; }
    void send();
  }, [store, focusBox, locked, running, send]);

  const stopAndSend = useCallback(async () => {
    if (!store.getState().ui.draft.trim()) { focusBox(); setLine({ words: 'Write the message first, then Stop it and send now.', problem: false }); return; }
    if (!run?.id || phase === 'stopping') return;
    setPhase('stopping');
    setLine({ words: 'Stopping the Foreman; your words go as soon as it has stopped.', problem: false });
    try {
      await api.post(`/api/runs/${encodeURIComponent(run.id)}/stop`, {});
    } catch (err) {
      setPhase('idle');
      setLine({ words: `Not stopped: ${err instanceof TypeError ? UNREACHABLE : err instanceof Error ? err.message : String(err)}`, problem: true });
    }
  }, [api, store, run?.id, phase, focusBox]);

  // Stopped: the words go now.
  useEffect(() => {
    if (phase !== 'stopping' || running) return;
    setPhase('idle');
    setLine(null);
    void send();
  }, [phase, running, send]);

  // His own typing ends a Sent; a Kept line goes once the reply has ended.
  useEffect(() => { if (draft && phase === 'sent') setPhase('idle'); }, [draft, phase]);
  useEffect(() => { if (!running) setLine((l) => (l?.words === KEPT ? null : l)); }, [running]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    e.preventDefault();
    // A go-ahead waits: ⌘↵ is Go (it carries these words as its note), never a message.
    if (gateWaits) { pressKey('jp-go'); return; }
    pressSend();
  }

  const placeholder = running ? WHILE_RUNNING : phase === 'sent' && !draft ? AFTER_SENT : PLACEHOLDER;
  const sentShown = phase === 'sending' || (phase === 'sent' && !draft);
  return (
    <div className="jp2-mbw">
      {locked && <p className="jp2-mb-line" role="status">{LOCKED}</p>}
      {askTerminal && (
        <label className="check jp2-mb-line" title="Claude Code is open in this repository in a terminal. Two Foremen on one job would trip over each other.">
          <Choice type="checkbox" checked={noTerminal} onChange={(e) => setNoTerminal(e.target.checked)} /> None of the open terminals is this job’s Foreman
        </label>
      )}
      {line && <p className={`jp2-mb-line${line.problem ? ' is-problem' : ''}`} role={line.problem ? 'alert' : 'status'}>{line.words}</p>}
      {running && (
        // Its own row above the box, so the box keeps its width and says its words on one line.
        <div className="jp2-mb-run">
          <Button
            kind="quiet"
            size={narrow ? 'md' : 'sm'}
            className="jp2-mb-stop"
            busy={phase === 'stopping'}
            busyLabel="Stopping…"
            disabled={locked}
            onClick={() => void stopAndSend()}
            title="End the Foreman’s reply now, then send your words as soon as it has stopped. Anything waiting for your answer is declined."
          >
            Stop it and send now
          </Button>
        </div>
      )}
      <div className="jp2-mb">
        <textarea
          ref={boxRef}
          className="jp2-mb-ta"
          aria-label="Message to the Foreman"
          placeholder={placeholder}
          rows={1}
          value={draft}
          onChange={(e) => store.setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          title={gateWaits
            ? 'Your words go with Go as a note, with Send back as the change, or alone with Send as a message. Kept for this job until they go.'
            : 'Your message to this job’s Foreman. Kept for this job until it goes. ⌘↵ sends it.'}
        />
        <Button
          kind="primary"
          size={narrow ? 'md' : 'sm'}
          className="jp2-mb-send"
          disabled={locked}
          onClick={pressSend}
          title={locked ? `Off: ${LOCKED}` : running ? 'The Foreman is replying: your words stay in the box until it finishes.' : 'Send your words to the Foreman as a message.'}
        >
          {sentShown ? 'Sent' : 'Send'}
        </Button>
      </div>
    </div>
  );
});
