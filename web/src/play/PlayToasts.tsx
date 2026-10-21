// The play toasts (Play on): each 'play' event heard live (an achievement unlocked, a quest done)
// becomes a small toast in the bottom-right corner, over the Preview pane: never over the
// composer, the gate card or a permission card (they all live in the middle pane), and under any
// sheet or drawer. It has the badge, the name and one line on how it was earned; it fades in
// quickly, goes by itself after about 5 s (held while you point at it or focus it) and has a
// Dismiss button. Up to three show at once, the rest wait their turn. Read out politely
// (aria-live). Each has a burst round its badge, small in Subtle (play/celebrate.ts); in Full with
// Sounds on, each batch that arrives together plays one blip, for the biggest of them.
// A boss defeated (an L3 review drained to nothing) is a Full-mode extra: toasted only in Full.
// The easter eggs' short scenes (play/Scenes.tsx) show here too, above the toasts.
// Events already in the page when it mounts are never toasted, so nothing celebrates on load, and
// a restarted dashboard's resync drops the old run's events (state/reducer.ts), so none come back.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PlayNews } from '../api/types';
import { useWorkshopState } from '../state/store';
import { AchievementBadge } from './AchievementBadge';
import { burstPieces, celebrate, type Celebration, type CelebrationKind } from './celebrate';
import { clearScenes } from './eggs';
import { Scenes } from './Scenes';
import { playBlip } from './sound';
import { usePlay } from './usePlay';
import { MEDAL_SIZE } from './crewSizes';

export const TOAST_MS = 5000;
export const MAX_VISIBLE = 3;

export interface ToastItem {
  key: number;
  kind: 'achievement' | 'secret' | 'quest' | 'boss';
  badge: string;
  label: string;
  name: string;
  line: string;
}

const LEVEL = (n: number | null) => (Number.isInteger(n) ? `L${n} ` : '');

const celebrationKind = (t: ToastItem): CelebrationKind => (t.kind === 'quest' || t.kind === 'boss' ? t.kind : 'achievement');
// Which blip a batch plays: its biggest moment.
const BLIP_RANK: Record<CelebrationKind, number> = { achievement: 0, quest: 1, boss: 2 };

/** The one blip for toasts that arrived together (the biggest kind among them), or null for none. */
export function batchBlip(items: ToastItem[]): CelebrationKind | null {
  let best: CelebrationKind | null = null;
  for (const t of items) {
    const k = celebrationKind(t);
    if (best === null || BLIP_RANK[k] > BLIP_RANK[best]) best = k;
  }
  return best;
}

/** What a 'play' event says as a toast (null: nothing to show). full: Full mode (a boss only shows then). */
export function toastOf(news: PlayNews, titleOf: (slug: string) => string | undefined, full = false): ToastItem | null {
  if (news.boss) {
    if (!full) return null;
    const b = news.boss;
    return {
      key: news.seq, kind: 'boss', badge: 'boss-slayer', label: 'Boss defeated', name: titleOf(b.slug) ?? b.slug,
      line: 'The review’s blockers and majors are all fixed.',
    };
  }
  if (news.quest) {
    const q = news.quest;
    // What crossed the finish line (older dashboards say only the rule it was counted under).
    const by = q.by ?? (q.rule === 'marked-done' || q.rule === 'marked' ? 'marked' : q.rule === 'first-pr' ? 'pr1-open' : q.rule);
    const how = by === 'marked' ? 'you marked it done'
      : by === 'pr1-merged' ? 'PR #1 was merged'
        : by === 'staging' ? 'it reached staging'
          : by === 'main' ? 'it reached main'
            : 'its first PR was created';
    return {
      key: news.seq, kind: 'quest', badge: 'quest', label: 'Quest done', name: titleOf(q.slug) ?? q.slug,
      line: `${LEVEL(q.level)}${q.kind === 'bug' ? 'bug fix' : 'feature'}: ${how}.`.replace(/^./, (c) => c.toUpperCase()),
    };
  }
  if (news.achievement) {
    const a = news.achievement;
    return { key: news.seq, kind: a.secret ? 'secret' : 'achievement', badge: a.id, label: a.secret ? 'Secret found' : 'Achievement unlocked', name: a.name, line: a.howTo };
  }
  return null;
}

function Burst({ c }: { c: Celebration }) {
  return (
    <span className={`play-burst burst-${c.kind}`} aria-hidden="true">
      {burstPieces(c.pieces).map((p, i) => (
        <i key={i} className={`play-burst-piece tone-${p.hue}`} style={{ '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--delay': `${p.delay}ms` } as CSSProperties} />
      ))}
    </span>
  );
}

function Toast({ item, onDone }: { item: ToastItem; onDone: (key: number) => void }) {
  const play = usePlay();
  // Decided once, when the toast appears.
  const [c] = useState(() => celebrate(celebrationKind(item), play));
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const t = setTimeout(() => onDone(item.key), TOAST_MS);
    return () => clearTimeout(t);
  }, [held, item.key, onDone]);
  return (
    <div
      className={`play-toast is-${item.kind}${c.burst ? ' has-burst' : ''}`}
      data-kind={item.kind}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className="play-toast-badge">
        <AchievementBadge id={item.badge} size={MEDAL_SIZE.toast} />
        {c.burst && <Burst c={c} />}
      </span>
      <div className="play-toast-body">
        <p className="play-toast-label">{item.label}</p>
        <p className="play-toast-name">{item.name}</p>
        <p className="play-toast-line">{item.line}</p>
      </div>
      <button
        type="button"
        className="btn btn-quiet play-toast-close"
        aria-label={`Dismiss: ${item.name}`}
        title="Hide this now. It also goes by itself after a few seconds."
        onClick={() => onDone(item.key)}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export function PlayToasts() {
  const { playNews, jobs, epoch } = useWorkshopState();
  const play = usePlay();
  // The newest event already dealt with, in this run of the dashboard (seq starts again after a
  // restart, and the snapshot that follows one clears playNews).
  const seen = useRef({ epoch, seq: playNews.length ? playNews[playNews.length - 1].seq : 0 });
  const [queue, setQueue] = useState<ToastItem[]>([]);

  useEffect(() => {
    if (seen.current.epoch !== epoch) seen.current = { epoch, seq: 0 };
    const fresh = playNews.filter((n) => n.seq > seen.current.seq);
    if (!fresh.length) return;
    seen.current = { epoch, seq: fresh[fresh.length - 1].seq };
    if (!play.on) return;
    const titleOf = (slug: string) => jobs.find((j) => j.slug === slug)?.title;
    const items = fresh.map((n) => toastOf(n, titleOf, play.full)).filter((t): t is ToastItem => t !== null);
    if (!items.length) return;
    setQueue((q) => [...q, ...items]);
    // One blip per batch, here rather than per toast, so three at once never play over each other.
    const blip = batchBlip(items);
    if (blip && celebrate(blip, play).sound) playBlip(blip);
  }, [playNews, play, jobs, epoch]);

  // Off: nothing waits to come back (nor a scene) when Play is turned on again.
  useEffect(() => { if (!play.on) { setQueue([]); clearScenes(); } }, [play.on]);

  const [done] = useState(() => (key: number) => setQueue((q) => q.filter((t) => t.key !== key)));

  if (!play.on) return null;
  const visible = queue.slice(0, MAX_VISIBLE);
  const waiting = queue.length - visible.length;
  return (
    <section className="play-toasts at-bottom-end" aria-label="Achievements and quests" aria-live="polite" aria-relevant="additions">
      <Scenes />
      {visible.map((t) => <Toast key={t.key} item={t} onDone={done} />)}
      {waiting > 0 && <p className="play-toasts-more muted">{waiting} more</p>}
    </section>
  );
}
