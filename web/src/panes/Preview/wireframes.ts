// The wireframes page's side of the Screens tab. The page (wireframes.html, drawn by the
// feature-wireframe skill and served by the dashboard's screens server from ITS OWN ORIGIN,
// meta.wireframesOrigin, so its script can't reach this document, storage or token) runs in an
// iframe and talks to the dashboard with postMessage, the contract in the skill's SKILL.md
// ("Inside the Feature Workshop"):
//   - it posts { type: 'wireframes', version, current, screens: [{ key, name, kind, status, choice }] }
//     on load, when the section in view changes, and after a verdict or pick;
//   - it answers { type: 'wireframes-goto', key } by scrolling to that section;
//   - it answers { type: 'wireframes-feedback' } with { type: 'wireframes-feedback', version, text },
//     the Copy feedback text (the lines the Foreman understands: "Pick A for c-entry", "s-list: needs change: …");
//   - it posts { type: 'wireframes-escape' } on Esc outside its notes box (the keyboard steps back out).
// Every message is checked against that origin, both ways: nothing is read from, or posted to, anywhere else.
// This module keeps the latest report per job, the one frame showing a job's page (ScreensTab
// mounts it), and sends the two messages. The gate card reads the report for its screen chips.
// Everything the page sends is data from a file on disk, checked here before it is kept; nothing is
// run, and nothing here reads a model.
import { useSyncExternalStore } from 'react';

export type ScreenKind = 'screen' | 'choice' | 'questions' | 'overview';
export type ScreenStatus = '' | 'good' | 'ask' | 'fix';

export interface WireframeScreen {
  key: string;
  name: string;
  kind: ScreenKind;
  status: ScreenStatus;
  /** The option picked on a design choice: A, B or none. */
  choice: string;
}

export interface WireframesReport {
  version: string | null;
  /** The section in view (its key). */
  current: string | null;
  screens: WireframeScreen[];
}

export interface WireframesFeedback {
  version: string | null;
  text: string;
}

const KINDS: readonly ScreenKind[] = ['screen', 'choice', 'questions', 'overview'];
const STATUSES: readonly ScreenStatus[] = ['', 'good', 'ask', 'fix'];
/** Longest key, name or version kept from the page. */
const MAX_TEXT = 200;
/** Most sections kept from one report. */
const MAX_SCREENS = 60;

const text = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : '');
const versionOf = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 20) : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);

/** A 'wireframes' message from the page as a report, or null for anything else. */
export function parseWireframesMessage(data: unknown): WireframesReport | null {
  if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'wireframes') return null;
  const m = data as { version?: unknown; current?: unknown; screens?: unknown };
  const screens: WireframeScreen[] = [];
  for (const raw of Array.isArray(m.screens) ? m.screens.slice(0, MAX_SCREENS) : []) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    const key = text(s.key);
    if (!key) continue;
    const kind = KINDS.includes(s.kind as ScreenKind) ? (s.kind as ScreenKind) : 'screen';
    const status = STATUSES.includes(s.status as ScreenStatus) ? (s.status as ScreenStatus) : '';
    screens.push({ key, name: text(s.name) || key, kind, status, choice: /^[A-Z]$/.test(String(s.choice ?? '')) ? String(s.choice) : '' });
  }
  const current = text(m.current);
  return { version: versionOf(m.version), current: current || null, screens };
}

/** Whether this is the page's Esc message (the reader wants the keyboard back on the dashboard). */
export const isEscapeMessage = (data: unknown) => Boolean(data) && typeof data === 'object' && (data as { type?: unknown }).type === 'wireframes-escape';

/** A 'wireframes-feedback' answer from the page, or null for anything else. */
export function parseFeedbackMessage(data: unknown): WireframesFeedback | null {
  if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'wireframes-feedback') return null;
  const m = data as { version?: unknown; text?: unknown };
  return { version: versionOf(m.version), text: typeof m.text === 'string' ? m.text.slice(0, 20_000) : '' };
}

/** The verdict words the page's statuses stand for. */
export const STATUS_WORDS: Record<Exclude<ScreenStatus, ''>, string> = { good: 'Good', ask: 'Question', fix: 'Needs change' };

/** What the reader marked on a section, in words: "Pick A" on a choice, "Needs change" on a screen, nothing yet. */
export function screenWord(s: Pick<WireframeScreen, 'kind' | 'status' | 'choice'>): string {
  if (s.kind === 'choice') return s.choice ? `Pick ${s.choice}` : '';
  return s.status ? STATUS_WORDS[s.status] : '';
}

/** The sections a reviewer goes to: the screens and the design choices (not the overview or the questions). */
export const reviewable = (screens: readonly WireframeScreen[]) => screens.filter((s) => s.kind === 'screen' || s.kind === 'choice');

/**
 * The same list from wireframes.json (the skill writes it next to the page): for the gate card
 * before the Screens tab has loaded the page. Statuses and picks are unknown there.
 */
export function screensFromJson(jsonText: string): WireframeScreen[] {
  let data: unknown;
  try { data = JSON.parse(jsonText); } catch { return []; }
  if (!data || typeof data !== 'object') return [];
  const d = data as { screens?: unknown; choices?: unknown };
  const out: WireframeScreen[] = [];
  for (const raw of Array.isArray(d.screens) ? d.screens : []) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const key = text(s.key);
    if (key) out.push({ key, name: text(s.name) || key, kind: 'screen', status: '', choice: '' });
  }
  for (const raw of Array.isArray(d.choices) ? d.choices : []) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const key = text(c.key);
    if (key) out.push({ key, name: text(c.question) || key, kind: 'choice', status: '', choice: '' });
  }
  return out.slice(0, MAX_SCREENS);
}

// ---------- The frame and the reports ----------

interface Frame {
  slug: string;
  window: () => Window | null;
  focus: () => void;
  /** The page's origin (meta.wireframesOrigin): the only place messages go to. Null: nothing is posted. */
  origin: string | null;
}

let frame: Frame | null = null;
const reports = new Map<string, WireframesReport>();
let pendingFeedback: { slug: string; resolve: (f: WireframesFeedback) => void } | null = null;
const listeners = new Set<() => void>();
let version = 0;
const notify = () => { version++; for (const l of [...listeners]) l(); };

/** ScreensTab: this is the frame showing `slug`'s page, served from `origin`. Returns the function that forgets it. */
export function mountFrame(slug: string, win: () => Window | null, focus: () => void, origin: string | null = null): () => void {
  const f: Frame = { slug, window: win, focus, origin };
  frame = f;
  notify();
  return () => { if (frame === f) { frame = null; notify(); } };
}

/** Whether a Screens tab or full-screen view shows this job's page right now. */
export const frameMounted = (slug: string) => frame?.slug === slug;

/**
 * A message from the frame (ScreensTab checks it came from its iframe, from the page's origin). A report is
 * kept for the gate card; a feedback answer settles the request waiting for it. True when it was one of the two.
 */
export function receive(slug: string, data: unknown): boolean {
  const report = parseWireframesMessage(data);
  if (report) {
    reports.set(slug, report);
    notify();
    return true;
  }
  const feedback = parseFeedbackMessage(data);
  if (feedback) {
    if (pendingFeedback?.slug === slug) { pendingFeedback.resolve(feedback); pendingFeedback = null; }
    return true;
  }
  return false;
}

function post(slug: string, message: object): boolean {
  if (!frameMounted(slug)) return false;
  const win = frame?.window() ?? null;
  const origin = frame?.origin ?? null;
  if (!win || !origin) return false;
  try { win.postMessage(message, origin); return true; } catch { return false; }
}

// ---------- The open-at-a-section request ----------
// ui.openScreens(key) counts a request (ui.screensRequest); whichever Screens tab shows the page
// takes it, once. Kept here, not per tab, so a tab mounted AFTER the request (the Desk's gate card
// opens the full view, which mounts its tab then) still finds it waiting; a tab mounted later still
// won't replay an old one.
let takenRequest = 0;

/** Whether request `n` (ui.screensRequest) is new: true once, for the first tab that asks. */
export function takeScreensRequest(n: number): boolean {
  if (n <= 0 || n === takenRequest) return false;
  takenRequest = n;
  return true;
}

/** Ask the page to scroll to a section. False when no frame shows this job. */
export const gotoScreen = (slug: string, key: string) => post(slug, { type: 'wireframes-goto', key });

/** Put the keyboard inside the page (its own keys then work). False when no frame shows this job. */
export function focusFrame(slug: string): boolean {
  if (!frameMounted(slug)) return false;
  frame?.focus();
  return true;
}

/** Ask the page for its Copy feedback text. Rejects when no frame shows this job or it doesn't answer in time. */
export function requestFeedback(slug: string, timeoutMs = 3000): Promise<WireframesFeedback> {
  return new Promise((resolve, reject) => {
    if (pendingFeedback) { pendingFeedback = null; }
    const timer = setTimeout(() => {
      if (pendingFeedback?.resolve === done) pendingFeedback = null;
      reject(new Error('The screens page didn’t answer. Use its own Copy feedback button.'));
    }, timeoutMs);
    const done = (f: WireframesFeedback) => { clearTimeout(timer); resolve(f); };
    pendingFeedback = { slug, resolve: done };
    if (!post(slug, { type: 'wireframes-feedback' })) {
      clearTimeout(timer);
      pendingFeedback = null;
      reject(new Error('The screens aren’t open here. Open the Screens tab first.'));
    }
  });
}

/** The latest report from this job's page, or null before it has posted one. */
export const wireframesReport = (slug: string) => reports.get(slug) ?? null;

/** Forget a job's report (the page went away, or tests). */
export function clearWireframes(slug?: string) {
  if (slug === undefined) reports.clear(); else reports.delete(slug);
  if (slug === undefined) { frame = null; takenRequest = 0; }
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const snapshot = () => version;

/** The latest report from this job's page; re-renders as the page posts. */
export function useWireframes(slug: string | null): WireframesReport | null {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return slug ? wireframesReport(slug) : null;
}

/** Whether a frame shows this job's page; re-renders as frames come and go. */
export function useFrameMounted(slug: string | null): boolean {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return slug !== null && frameMounted(slug);
}
