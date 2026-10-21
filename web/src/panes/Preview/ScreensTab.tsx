// The Preview pane's Screens tab, and the body of the full-width view (#/job/<slug>/screens): the
// wireframes page the Painter drew (GET /api/job/:slug/wireframes) in a sandboxed iframe, with a
// small bar above it: the section in view, the page's version, Open full screen, Copy feedback and
// what happened. The page keeps its own keys (J K 1 2 3 A B N Esc) and its own notes (its
// localStorage); the dashboard only tells it where to go and asks for its feedback text
// (panes/Preview/wireframes.ts). Copy feedback copies that text and, while the Foreman waits for
// your decision, adds it to your message to the Foreman so the reply carries your review.
// Keys: Enter (with nothing else focused) steps into the page; Esc inside it steps back out.
// Nothing here changes a file or asks a model.
import { useEffect, useRef, useState } from 'react';
import type { Job } from '../../api/types';
import { useKeyScope } from '../../app/keyRegistry';
import { screensHref } from '../../app/router';
import { useUi } from '../../app/ui';
import { Kbd } from '../../components/Kbd';
import { readStored, writeStored } from '../../lib/stored';
import { draftKey } from '../Foreman/Composer';
import { versionLabel } from './docs';
import { gotoScreen, mountFrame, receive, requestFeedback, useWireframes } from './wireframes';

/** The page's address for a job: same origin, its own content security policy (dashboard/server.js). */
export const wireframesUrl = (slug: string) => `/api/job/${encodeURIComponent(slug)}/wireframes`;

/** Whether the Foreman waits for your decision on this job (a gate, not a permission): the feedback then joins your reply. */
export const gateWaiting = (job: Job | null | undefined) => Boolean(job?.needsYou && (job.waitingFor === 'approval' || job.waitingFor === 'answers'));

/** The composer's draft with the feedback added once, after what is already there. */
export function addFeedbackToDraft(slug: string, text: string): boolean {
  const feedback = text.trim();
  if (!feedback) return false;
  const prev = readStored(draftKey(slug)) ?? '';
  if (prev.includes(feedback)) return false;
  writeStored(draftKey(slug), prev.trim() ? `${prev.replace(/\s+$/, '')}\n\n${feedback}` : feedback);
  return true;
}

/** Something that takes keys of its own is focused: a button, link, field, tab or the iframe itself. */
const onControl = (target: EventTarget | null) => target instanceof Element && target.closest('button, a, input, select, textarea, summary, iframe, [role="tab"], [tabindex]') !== null;

type Notice = { tone: 'ok' | 'problem'; text: string } | null;

export function ScreensTab({ slug, job, active, full = false }: {
  slug: string;
  job: Job | null;
  /** The tab is the one showing (or the full view is open): its keys work. */
  active: boolean;
  /** The full-width view: no "Open full screen" link (the view has Back). */
  full?: boolean;
}) {
  const ui = useUi();
  const frame = useRef<HTMLIFrameElement>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  const report = useWireframes(slug);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // A section asked for before the page had posted anything: sent once it has.
  const wanted = useRef<string | null>(null);

  // This is the frame for this job; messages from its window (same origin) are the page's.
  useEffect(() => {
    const unmount = mountFrame(slug, () => frame.current?.contentWindow ?? null, () => frame.current?.focus());
    const onMessage = (e: MessageEvent) => {
      if (!frame.current?.contentWindow || e.source !== frame.current.contentWindow) return;
      if (e.origin !== window.location.origin) return;
      receive(slug, e.data);
    };
    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener('message', onMessage); unmount(); };
  }, [slug]);

  // Esc inside the page (same origin, so its keys can be heard here): back to the bar.
  useEffect(() => {
    if (!loaded) return;
    const win = frame.current?.contentWindow;
    if (!win) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      firstButton.current?.focus();
      setNotice({ tone: 'ok', text: 'Back on the page. Enter steps into the screens again.' });
    };
    try { win.addEventListener('keydown', onKey); } catch { return; }
    return () => { try { win.removeEventListener('keydown', onKey); } catch { /* the page is gone */ } };
  }, [loaded, slug]);

  // A request to open the screens at a section (the gate card's chips, the Docs list): go there.
  const seenRequest = useRef(ui.screensRequest);
  useEffect(() => {
    if (ui.screensRequest === seenRequest.current) return;
    seenRequest.current = ui.screensRequest;
    if (!ui.screensKey) return;
    if (!gotoScreen(slug, ui.screensKey) || !report) wanted.current = ui.screensKey;
  }, [ui.screensRequest, ui.screensKey, slug, report]);
  useEffect(() => {
    if (wanted.current && report) {
      const key = wanted.current;
      wanted.current = null;
      gotoScreen(slug, key);
    }
  }, [report, slug]);

  // Enter with nothing else focused: into the page. (Esc out of it is the listener above.)
  useKeyScope('job', {
    'screens-focus': (e) => {
      if (onControl(e.target)) return false;
      frame.current?.focus();
    },
  }, active);

  async function copyFeedback() {
    setBusy(true);
    setNotice(null);
    try {
      const { text } = await requestFeedback(slug);
      let copied = true;
      try { await navigator.clipboard.writeText(text); } catch { copied = false; }
      const added = gateWaiting(job) && addFeedbackToDraft(slug, text);
      setNotice(copied
        ? { tone: 'ok', text: added ? 'Copied, and added to your message to the Foreman.' : 'Copied.' }
        : added ? { tone: 'ok', text: 'Added to your message to the Foreman (this browser didn’t allow copying).' }
          : { tone: 'problem', text: 'Couldn’t copy: this browser didn’t allow it. Use the page’s own Copy feedback button.' });
    } catch (err) {
      setNotice({ tone: 'problem', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const current = report?.current ? report.screens.find((s) => s.key === report.current) ?? null : null;
  const version = report?.version ?? job?.wireframes?.version ?? null;
  const title = `${job?.title ?? slug}: screens`;

  return (
    <div className={`screens-tab${full ? ' is-full' : ''}`}>
      <div className="screens-bar" role="group" aria-label="Screens">
        <span className="screens-current" aria-live="polite" title="The section of the screens page in view.">
          {current ? current.name : report ? 'Screens' : 'Loading the screens…'}
        </span>
        {version && <span className="chip doc-version" title="The version of the screens the job’s records name.">{versionLabel(version)}</span>}
        <span className="doc-spacer" />
        <button ref={firstButton} type="button" className="btn btn-quiet" disabled={busy} onClick={() => void copyFeedback()} title="Ask the page for your verdicts, picks and notes as text, copy it, and, while the Foreman waits for your decision, add it to your message to the Foreman.">
          Copy feedback
        </button>
        {!full && (
          <a className="btn btn-quiet" href={screensHref(slug)} title="Show the screens on their own, full width (Back brings you here).">Open full screen</a>
        )}
        <button type="button" className="btn btn-quiet" onClick={() => frame.current?.focus()} title="Put the keyboard inside the screens page: its own keys then work (J K to move, 1 2 3 verdicts, A B picks, Esc back here).">
          Step in <Kbd id="screens-focus" />
        </button>
      </div>
      {notice && <p className={`screens-status ${notice.tone === 'ok' ? 'muted' : 'field-problem'}`} role={notice.tone === 'ok' ? 'status' : 'alert'}>{notice.text}</p>}
      <iframe
        ref={frame}
        className="screens-frame"
        title={title}
        src={wireframesUrl(slug)}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
