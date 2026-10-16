// Alerts when something new needs you: a browser notification (when you've allowed them) and an
// optional soft chime. Both are settings remembered in this browser:
//   fw.alerts.notify  'on' | 'off', or unset until you've been asked. The browser's own permission
//                     prompt can only open after a click, so the page asks on your first click
//                     anywhere (see useAlerts) and remembers the answer.
//   fw.alerts.chime   'on' | 'off' (off unless you turn it on).
//
// What counts as new: a job that has just entered Needs you, a permission card that has just
// arrived (also for a job that was already in Needs you), or a decision that has just been parked
// (left waiting 4 hours; the dashboard's gate-stale event). What was already there when the page
// loaded never alerts.
import type { Job, Permission } from '../api/types';
import { jobHref } from '../app/router';
import type { WorkshopState } from '../state/reducer';

export const NOTIFY_KEY = 'fw.alerts.notify';
export const CHIME_KEY = 'fw.alerts.chime';

export interface Alert {
  slug: string;
  title: string;
  body: string;
}

/** Everything currently asking for you, by a key that stays the same while it keeps asking. */
export function attentionKeys(state: Pick<WorkshopState, 'jobs' | 'permissions'>): Set<string> {
  const keys = new Set<string>();
  for (const j of state.jobs) if (j.group === 'needs-you') keys.add(`job:${j.slug}`);
  for (const j of state.jobs) if (j.group === 'needs-you' && j.parked) keys.add(`parked:${j.slug}`);
  for (const p of state.permissions) keys.add(`perm:${p.id}`);
  return keys;
}

const permissionText = (p: Permission) => p.plain?.headline || (p.toolName ? `Use ${p.toolName}` : 'An action');

function waitingText(job: Job | undefined): string {
  switch (job?.waitingFor) {
    case 'answers': return 'The Foreman asked you something.';
    case 'approval': return 'The Foreman is waiting for your go-ahead.';
    default: return 'The Foreman is waiting for your reply.';
  }
}

/** The alerts to raise for what is in `state` but wasn't in `before`: at most one per job. */
export function newAlerts(before: Set<string>, state: Pick<WorkshopState, 'jobs' | 'permissions'>): Alert[] {
  const bySlug = new Map<string, Alert>();
  const jobOf = (slug: string) => state.jobs.find((j) => j.slug === slug);
  for (const p of state.permissions) {
    if (before.has(`perm:${p.id}`) || bySlug.has(p.slug)) continue;
    const job = jobOf(p.slug);
    bySlug.set(p.slug, { slug: p.slug, title: `Permission needed: ${job?.title || p.slug}`, body: `${permissionText(p)}. Open the job to allow or deny it.` });
  }
  for (const j of state.jobs) {
    if (j.group !== 'needs-you' || before.has(`job:${j.slug}`) || bySlug.has(j.slug)) continue;
    bySlug.set(j.slug, { slug: j.slug, title: `Needs you: ${j.title || j.slug}`, body: j.headline ? String(j.headline) : waitingText(j) });
  }
  for (const j of state.jobs) {
    if (j.group !== 'needs-you' || !j.parked || before.has(`parked:${j.slug}`) || bySlug.has(j.slug)) continue;
    bySlug.set(j.slug, { slug: j.slug, title: `Parked 4h: ${j.title || j.slug}`, body: 'A decision has waited for you for more than 4 hours. Nothing goes ahead until you decide.' });
  }
  return [...bySlug.values()];
}

// ---------- The chime ----------

let audio: AudioContext | null = null;

/** Two soft rising notes, the same as the classic page's chime. Silent where audio isn't available. */
export function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const now = audio.currentTime;
    for (const [freq, at] of [[784, 0], [1175, 0.14]]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.12, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.5);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.55);
    }
  } catch { /* audio blocked or unavailable */ }
}

// ---------- Browser notifications ----------

export type NotifySupport = 'unsupported' | NotificationPermission;

export function notifySupport(): NotifySupport {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Ask the browser for permission (only works during a click). Resolves to what it said. */
export async function askNotifyPermission(): Promise<NotifySupport> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

export function showNotification(alert: Alert) {
  if (notifySupport() !== 'granted') return;
  try {
    const n = new Notification(alert.title, { body: alert.body, tag: `fw-${alert.slug}`, silent: true });
    n.onclick = () => {
      window.focus();
      window.location.hash = jobHref(alert.slug);
      n.close();
    };
  } catch { /* some browsers refuse notifications from plain http */ }
}

/** Swappable so tests can watch what would be played or shown. */
export const alertOutputs = { chime: playChime, notify: showNotification };
