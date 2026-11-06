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
// Publish and Pull notes run this laptop's publish.py (dashboard/lib/prototype.js): Publish puts the
// page on the prototypes site, and Pull notes puts what people left there into your message, in the
// same block Copy feedback uses. On the hosted site the page isn't here: the tab says so, with the
// published link when there is one.
// Keys: Enter (with nothing else focused) steps into the page; Esc inside it steps back out (the
// page posts 'wireframes-escape'; a cross-origin frame's keys can't be heard here).
// Nothing here asks a model.
import { useEffect, useRef, useState } from 'react';
import type { Job } from '../../api/types';
import { useKeyScope } from '../../app/keyRegistry';
import { screensHref } from '../../app/router';
import { useUi } from '../../app/ui';
import { Button } from '../../components/Button';
import { readStored, writeStored } from '../../lib/stored';
import { fullTime } from '../../lib/time';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { draftKey } from '../Foreman/Composer';
import { versionLabel } from './docs';
import { gotoScreen, isEscapeMessage, mountFrame, publishPrototype, pullPrototypeNotes, receive, requestFeedback, takeScreensRequest, useWireframes } from './wireframes';
import { BRAND } from '../../app/brand';

/** The page's address for a job: on the screens server's own origin (meta.wireframesOrigin), under its own content security policy (dashboard/server.js). */
export const wireframesUrl = (origin: string, slug: string) => `${origin.replace(/\/+$/, '')}/job/${encodeURIComponent(slug)}/wireframes`;

/** What the Screens tab says when the dashboard named no screens origin (an older dashboard behind a newer page). */
export const NO_ORIGIN = `${BRAND.name} didn’t say where it serves the screens from. Restart ${BRAND.name} and reload this page.`;

/** Whether the Foreman waits for your decision on this job (a gate, not a permission): the feedback then joins your reply. */
export const gateWaiting = (job: Job | null | undefined) => Boolean(job?.needsYou && (job.waitingFor === 'approval' || job.waitingFor === 'answers'));

/** The feedback block's marker lines in the draft: the text sits between them, so a later copy replaces it. */
export const feedbackMarkers = (version: string | null) => ({ start: `--- Screens feedback${version ? ` (v${version})` : ''} ---`, end: '--- end ---' });
// Whole lines only (^…$ with the m flag): a marker quoted inside one of your own lines, or an end
// marker followed by more words, is text, not the block's edge.
const FEEDBACK_BLOCK = /^--- Screens feedback(?: \([^)\n]*\))? ---\n[\s\S]*?\n--- end ---$/m;

// The lines Pull notes brought, per job. The site won't send them again, so a later Copy feedback
// keeps those still in the block, while the page's own lines in it are replaced as ever.
const pulledKey = (slug: string) => `fw.pulled.${slug}`;
const PULLED_MAX = 500;
function pulledLines(slug: string): string[] {
  try {
    const v: unknown = JSON.parse(readStored(pulledKey(slug)) ?? '[]');
    return Array.isArray(v) ? v.filter((l): l is string => typeof l === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The composer's draft with the feedback in it, once: added after what is already there, between
 * marker lines; a block from an earlier copy (a changed verdict, an older version) is replaced,
 * apart from any pulled lines in it. False when nothing changed.
 */
export function addFeedbackToDraft(slug: string, text: string, version: string | null = null): boolean {
  const feedback = text.trim();
  if (!feedback) return false;
  const { start, end } = feedbackMarkers(version);
  const prev = readStored(draftKey(slug)) ?? '';
  const inBlock = FEEDBACK_BLOCK.exec(prev)?.[0].split('\n') ?? [];
  const mine = feedback.split('\n');
  const kept = pulledLines(slug).filter((l) => inBlock.includes(l) && !mine.includes(l));
  const block = [start, ...mine, ...kept, end].join('\n');
  if (prev.includes(block)) return false;
  const next = FEEDBACK_BLOCK.test(prev) ? prev.replace(FEEDBACK_BLOCK, () => block) : prev.trim() ? `${prev.replace(/\s+$/, '')}\n\n${block}` : block;
  writeStored(draftKey(slug), next);
  return true;
}

/**
 * Pulled notes into the draft. The site won't send these lines again, so a block already there is
 * added to, never replaced: lines waiting in an unsent message stay. False when nothing changed.
 */
export function addNotesToDraft(slug: string, lines: string[], version: string | null = null): boolean {
  writeStored(pulledKey(slug), JSON.stringify([...new Set([...pulledLines(slug), ...lines])].slice(-PULLED_MAX)));
  const prev = readStored(draftKey(slug)) ?? '';
  const block = FEEDBACK_BLOCK.exec(prev)?.[0];
  if (!block) return addFeedbackToDraft(slug, lines.join('\n'), version);
  const kept = block.split('\n').slice(1, -1);
  const fresh = lines.filter((l) => !kept.includes(l));
  if (!fresh.length) return false;
  const { start, end } = feedbackMarkers(version);
  writeStored(draftKey(slug), prev.replace(FEEDBACK_BLOCK, () => [start, ...kept, ...fresh, end].join('\n')));
  return true;
}

/** What Pull notes says when there is nothing new. */
export const noNewNotes = (since: string | null) => (since ? `No new notes since ${fullTime(since)}.` : 'No notes yet.');

/** The hosted site's Screens line: the page itself is only on the laptop. */
export const ON_LAPTOP_LINE = 'The Screens page opens on your laptop.';

/** Something that takes keys of its own is focused: a button, link, field, tab or the iframe itself. */
const onControl = (target: EventTarget | null) => target instanceof Element && target.closest('button, a, input, select, textarea, summary, iframe, [role="tab"], [tabindex]') !== null;

type Notice = { tone: 'ok' | 'problem'; text: string; link?: { href: string; label: string } } | null;

const withWarnings = (text: string, warnings: string[] = []) => [text, ...warnings.map((w) => `Note: ${w}.`)].join(' ');

export function ScreensTab({ slug, job, active, full = false }: {
  slug: string;
  job: Job | null;
  /** The tab is the one showing (or the full view is open): its keys work. */
  active: boolean;
  /** The full-width view: no "Open full screen" link (the view has Back). */
  full?: boolean;
}) {
  const ui = useUi();
  const { api } = useWorkshop();
  const meta = useWorkshopState().meta;
  const origin = meta?.wireframesOrigin ?? null;
  const hosted = api.hosted?.() ?? false;
  const canPublish = Boolean(meta?.prototypes);
  const notSetUp = meta?.prototypesWhy ?? 'Publishing isn’t set up on this laptop.';
  const frame = useRef<HTMLIFrameElement>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  const report = useWireframes(slug);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [talking, setTalking] = useState<'publish' | 'notes' | null>(null);
  // The publish just made, until the job's own record catches up.
  const [justPublished, setJustPublished] = useState<{ slug: string; url: string; revision: number } | null>(null);
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

  async function publish() {
    setTalking('publish');
    setNotice(null);
    try {
      const { revision, url, warnings } = await publishPrototype(api, slug);
      setJustPublished({ slug, url, revision });
      setNotice({ tone: 'ok', text: withWarnings(`Published revision ${revision}.`, warnings), link: { href: url, label: 'Open on the site' } });
    } catch (err) {
      setNotice({ tone: 'problem', text: `Couldn’t publish: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setTalking(null);
    }
  }

  async function pullNotes() {
    setTalking('notes');
    setNotice(null);
    try {
      const { lines, since, revision, warnings } = await pullPrototypeNotes(api, slug);
      if (!lines.length) { setNotice({ tone: 'ok', text: withWarnings(noNewNotes(since), warnings) }); return; }
      // Always into your message: the site won't send these lines again, so they can't wait for a gate.
      addNotesToDraft(slug, lines, revision === null ? null : String(revision));
      setNotice({ tone: 'ok', text: withWarnings(`Added ${lines.length === 1 ? 'one line' : `${lines.length} lines`} to your message to the Foreman.`, warnings) });
    } catch (err) {
      setNotice({ tone: 'problem', text: `Couldn’t pull the notes: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setTalking(null);
    }
  }

  const current = report?.current ? report.screens.find((s) => s.key === report.current) ?? null : null;
  const version = report?.version ?? job?.wireframes?.version ?? null;
  const title = `${job?.title ?? slug}: screens`;
  const onSite = justPublished?.slug === slug && justPublished.revision >= (job?.prototype?.revision ?? 0) ? justPublished : job?.prototype ?? null;
  const siteLink = onSite && (
    <a className="screens-site-link" href={onSite.url} target="_blank" rel="noopener noreferrer" title="Open this feature on the prototypes site, in a new tab.">
      Revision {onSite.revision} on the site
    </a>
  );

  if (hosted) {
    return (
      <div className={`screens-tab${full ? ' is-full' : ''}`}>
        <p className="screens-status muted">
          {ON_LAPTOP_LINE}
          {onSite && <> Published: <a href={onSite.url} target="_blank" rel="noopener noreferrer">revision {onSite.revision} on the prototypes site</a></>}
        </p>
      </div>
    );
  }

  return (
    <div className={`screens-tab${full ? ' is-full' : ''}`}>
      <div className="screens-bar" role="group" aria-label="Screens">
        <span className="screens-current" aria-live="polite" title="The section of the screens page in view.">
          {current ? current.name : report ? 'Screens' : 'Loading the screens…'}
        </span>
        {version && <span className="chip doc-version" title="The version of the screens the job’s records name.">{versionLabel(version)}</span>}
        {siteLink}
        <span className="doc-spacer" />
        <Button ref={firstButton} kind="quiet" disabled={busy} onClick={() => void copyFeedback()} title="Ask the page for your verdicts, picks and notes as text, copy it, and, while the Foreman waits for your decision, add it to your message to the Foreman.">
          Copy feedback
        </Button>
        <Button kind="quiet" disabled={talking !== null || !canPublish} onClick={() => void publish()} title={canPublish ? `Put this page on the prototypes site (${meta?.prototypes?.site}) as the next revision.` : notSetUp}>
          {talking === 'publish' ? 'Publishing…' : 'Publish'}
        </Button>
        <Button kind="quiet" disabled={talking !== null || !canPublish} onClick={() => void pullNotes()} title={canPublish ? 'Bring new notes and picks from the prototypes site into your message to the Foreman.' : notSetUp}>
          {talking === 'notes' ? 'Pulling notes…' : 'Pull notes'}
        </Button>
        {!full && (
          <Button kind="quiet" href={screensHref(slug)} title="Show the screens on their own, full width (Back brings you here).">Open full screen</Button>
        )}
        <Button kind="quiet" keyId="screens-focus" onClick={() => frame.current?.focus()} title="Put the keyboard inside the screens page: its own keys then work (J K to move, 1 2 3 verdicts, A B picks, Esc back here).">
          Step in
        </Button>
      </div>
      {notice && <p className={`screens-status ${notice.tone === 'ok' ? 'muted' : 'field-problem'}`} role={notice.tone === 'ok' ? 'status' : 'alert'}>{notice.text}{notice.link && <> <a href={notice.link.href} target="_blank" rel="noopener noreferrer">{notice.link.label}</a></>}</p>}
      {!canPublish && <p className="screens-status muted">{notSetUp}</p>}
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
