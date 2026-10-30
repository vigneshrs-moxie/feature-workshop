// A decision made on the hosted site, on its card (packet 2B). The site answers a job's page and its
// waiting permissions with `queued`: the decision shown on it (hosted/lib/queue.js view).
//   waiting, or sent while the laptop is off   "Go: waiting for your laptop. It runs when the laptop
//                                               is back." with Cancel; the card's own buttons are put
//                                               away until then
//   sent while the laptop is on                "sent to your laptop. It runs there in a moment."
//   changed                                    "This changed on your laptop. Look again." above the new
//                                               card, with Got it
//   failed, expired                            what happened, with Got it
// Words and an icon carry each state, never colour alone. Only the hosted site sends `queued`, so
// on the laptop nothing here ever shows.
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useWorkshop } from '../../state/store';

export interface QueuedView {
  id: string;
  kind: string;
  state: 'waiting' | 'sent' | 'done' | 'failed' | 'changed' | 'cancelled' | 'expired';
  words: string;
  at: string;
  expiresAt: string | null;
  waiting: boolean;
  canCancel: boolean;
  permissionId: string | null;
}

export function queuedOf(v: unknown): QueuedView | null {
  if (!v || typeof v !== 'object') return null;
  const q = v as Partial<QueuedView>;
  return typeof q.id === 'string' && typeof q.state === 'string' && typeof q.words === 'string' ? (q as QueuedView) : null;
}

/** Still on its way: the card's own buttons wait. */
export const isOpen = (q: QueuedView | null): q is QueuedView => Boolean(q && (q.state === 'waiting' || q.state === 'sent'));
/** Settled in a way you should see (the job moved on, the laptop couldn't, it ran out). */
export const needsLook = (q: QueuedView | null): q is QueuedView => Boolean(q && (q.state === 'changed' || q.state === 'failed' || q.state === 'expired'));

const ICON = { waiting: 'clock', sent: 'send', changed: 'refresh', failed: 'alert', expired: 'clock', cancelled: 'x', done: 'circle-check' } as const;

export function QueuedDecision({ queued, onChange }: { queued: QueuedView; onChange?: () => void }) {
  const { api } = useWorkshop();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function act(what: 'cancel' | 'dismiss') {
    setBusy(true);
    setProblem(null);
    try { await api.post(`/api/decisions/${encodeURIComponent(queued.id)}/${what}`, {}); onChange?.(); } catch (err) { setProblem(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  }
  const open = isOpen(queued);
  const tone = open ? 'is-waiting' : needsLook(queued) ? 'is-look' : 'is-settled';
  return (
    <section className={`queued-decision ${tone}`} data-state={queued.state} aria-label="Your decision from the site">
      <p className="queued-decision-words" role="status">
        <Icon name={ICON[queued.state] ?? 'clock'} size={18} />
        <span>{queued.words}</span>
      </p>
      <div className="queued-decision-actions">
        {open && queued.canCancel && (
          <Button kind="secondary" size="lg" busy={busy} onClick={() => void act('cancel')} title="Take this decision back. Nothing is sent to your laptop.">Cancel</Button>
        )}
        {!open && (
          <Button kind="quiet" busy={busy} onClick={() => void act('dismiss')} title="Put this note away.">Got it</Button>
        )}
      </div>
      {problem && <p className="field-problem" role="alert">{problem}</p>}
    </section>
  );
}

/** "Asked 12m ago · expires in 3m", for a permission on the site. */
export function askedLine(createdAt: string | null | undefined, expiresAt: string | null | undefined, now: Date): string | null {
  const parts: string[] = [];
  const m = (ms: number) => (ms < 60_000 ? 'less than a minute' : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m` : `${Math.floor(ms / 3_600_000)}h`);
  if (createdAt && !Number.isNaN(Date.parse(createdAt))) {
    const ago = now.getTime() - Date.parse(createdAt);
    parts.push(ago < 60_000 ? 'Asked just now' : `Asked ${m(ago)} ago`);
  }
  if (expiresAt && !Number.isNaN(Date.parse(expiresAt))) {
    const left = Date.parse(expiresAt) - now.getTime();
    parts.push(left > 0 ? `expires in ${m(left)}` : 'expired');
  }
  return parts.length ? parts.join(' · ') : null;
}
