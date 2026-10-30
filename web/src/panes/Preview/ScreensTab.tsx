// The Preview pane's Screens tab, and the body of the full-width view (#/job/<slug>/screens): the
// wireframes page the Painter drew, served by the dashboard's screens server from its own origin
// (meta.wireframesOrigin, <origin>/job/<slug>/wireframes), in a sandboxed iframe, with a small bar
// above it: the section in view, the page's version, Open full screen, Copy feedback and what
// happened. The page is a model-written HTML file, so it never shares this origin: its script can't
// reach this document, storage or the token, and every message is checked against its origin both
// ways. The page keeps its own keys (J K 1 2 3 A B N Esc) and its own notes (its localStorage, in
// its origin); the dashboard only tells it where to go and asks for its feedback text
// (panes/Preview/wireframes.ts). Copy feedback copies that text and, while the Foreman waits for
// your decision, adds it to your message to the Foreman so the reply carries your review.
// Keys: Enter (with nothing else focused) steps into the page; Esc inside it steps back out (the
// page posts 'wireframes-escape'; a cross-origin frame's keys can't be heard here).
// Nothing here changes a file or asks a model.
import { useEffect, useRef, useState } from 'react';
import type { Job } from '../../api/types';
import { useKeyScope } from '../../app/keyRegistry';
import { screensHref } from '../../app/router';
import { useUi } from '../../app/ui';
import { Button } from '../../components/Button';
import { readStored, writeStored } from '../../lib/stored';
import { useWorkshopState } from '../../state/store';
import { draftKey } from '../Foreman/Composer';
import { versionLabel } from './docs';
import { gotoScreen, isEscapeMessage, mountFrame, receive, requestFeedback, takeScreensRequest, useWireframes } from './wireframes';

/** The page's address for a job: on the screens server's own origin (meta.wireframesOrigin), under its own content security policy (dashboard/server.js). */
export const wireframesUrl = (origin: string, slug: string) => `${origin.replace(/\/+$/, '')}/job/${encodeURIComponent(slug)}/wireframes`;

/** What the Screens tab says when the dashboard named no screens origin (an older dashboard behind a newer page). */
export const NO_ORIGIN = 'The dashboard didn’t say where it serves the screens from. Restart the dashboard and reload this page.';

/** Whether the Foreman waits for your decision on this job (a gate, not a permission): the feedback then joins your reply. */
export const gateWaiting = (job: Job | null | undefined) => Boolean(job?.needsYou && (job.waitingFor === 'approval' || job.waitingFor === 'answers'));

/** The feedback block's marker lines in the draft: the text sits between them, so a later copy replaces it. */
export const feedbackMarkers = (version: string | null) => ({ start: `--- Screens feedback${version ? ` (v${version})` : ''} ---`, end: '--- end ---' });
// Whole lines only (^…$ with the m flag): a marker quoted inside one of your own lines, or an end
// marker followed by more words, is text, not the block's edge.
const FEEDBACK_BLOCK = /^--- Screens feedback(?: \([^)\n]*\))? ---\n[\s\S]*?\n--- end ---$/m;

/**
 * The composer's draft with the feedback in it, once: added after what is already there, between
 * marker lines; a block from an earlier copy (a changed verdict, an older version) is replaced.
 * False when nothing changed.
 */
export function addFeedbackToDraft(slug: string, text: string, version: string | null = null): boolean {
  const feedback = text.trim();
  if (!feedback) return false;
  const { start, end } = feedbackMarkers(version);
  const block = `${start}\n${feedback}\n${end}`;
  const prev = readStored(draftKey(slug)) ?? '';
  if (prev.includes(block)) return false;
  const next = FEEDBACK_BLOCK.test(prev) ? prev.replace(FEEDBACK_BLOCK, block) : prev.trim() ? `${prev.replace(/\s+$/, '')}\n\n${block}` : block;
  writeStored(draftKey(slug), next);
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
  const origin = useWorkshopState().meta?.wireframesOrigin ?? null;
  const frame = useRef<HTMLIFrameElement>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  const report = useWireframes(slug);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  // A section asked for before the page had posted anything: sent once it has.
  const wanted = useRef<string | null>(null);

  // This is the frame for this job; messages from its window, from the page's origin, are the page's.
  // Its Esc (posted, since a cross-origin frame's keys can't be heard here): back to the bar.
  useEffect(() => {
    const unmount = mountFrame(slug, () => frame.current?.contentWindow ?? null, () => frame.current?.focus(), origin);
    const onMessage = (e: MessageEvent) => {
      if (!frame.current?.contentWindow || e.source !== frame.current.contentWindow) return;
      if (!origin || e.origin !== origin) return;
      if (isEscapeMessage(e.data)) {
        firstButton.current?.focus();
        setNotice({ tone: 'ok', text: 'Back on the page. Enter steps into the screens again.' });
        return;
      }
      receive(slug, e.data);
    };
    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener('message', onMessage); unmount(); };
  }, [slug, origin]);

  // A request to open the screens at a section (the gate card's chips, the Docs list): go there.
  // Taken once, by the first tab to see it, including one mounted after it (the Desk's chips open
  // the full view, whose tab mounts then; panes/Preview/wireframes.ts takeScreensRequest).
  useEffect(() => {
    if (!takeScreensRequest(ui.screensRequest, ui.screensSlug, slug)) return;
    if (!ui.screensKey) return;
    if (!gotoScreen(slug, ui.screensKey) || !report) wanted.current = ui.screensKey;
  }, [ui.screensRequest, ui.screensSlug, ui.screensKey, slug, report]);
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
      const { text, version } = await requestFeedback(slug);
      let copied = true;
      try { await navigator.clipboard.writeText(text); } catch { copied = false; }
      const added = gateWaiting(job) && addFeedbackToDraft(slug, text, version);
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
        <Button ref={firstButton} kind="quiet" disabled={busy} onClick={() => void copyFeedback()} title="Ask the page for your verdicts, picks and notes as text, copy it, and, while the Foreman waits for your decision, add it to your message to the Foreman.">
          Copy feedback
        </Button>
        {!full && (
          <Button kind="quiet" href={screensHref(slug)} title="Show the screens on their own, full width (Back brings you here).">Open full screen</Button>
        )}
        <Button kind="quiet" keyId="screens-focus" onClick={() => frame.current?.focus()} title="Put the keyboard inside the screens page: its own keys then work (J K to move, 1 2 3 verdicts, A B picks, Esc back here).">
          Step in
        </Button>
      </div>
      {notice && <p className={`screens-status ${notice.tone === 'ok' ? 'muted' : 'field-problem'}`} role={notice.tone === 'ok' ? 'status' : 'alert'}>{notice.text}</p>}
      {origin ? (
        // allow-same-origin keeps the page's notes in ITS origin's storage, which can't reach this one.
        // Every job's page shares that one origin, so its storage is shared too: a page could read or
        // clear another job's notes. Accepted: the pages are the Painter's own files on this machine,
        // and the skill's template keys its notes by repo, job and version (wf-<repo>-<slug>-notes:v<n>),
        // so two jobs' notes never collide by accident.
        <iframe
          ref={frame}
          className="screens-frame"
          title={title}
          src={wireframesUrl(origin, slug)}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
        />
      ) : (
        <p className="field-problem" role="alert">{NO_ORIGIN}</p>
      )}
    </div>
  );
}
