// A stack's progress bar (packet V): one segment per part, in merge order. Each segment wears its
// lane's colour and pattern (solid, stripes, hollow, dashed, hatch) and says its part and lane in
// words on hover and to a screen reader, so status is never colour alone; the line under the bar
// says the same counts in words. The home's cards use the small size; a stack's page the large one.
// A segment can be a link (to the part's page) or a button (to pick it).
import type { StackSegment } from '../../api/types';
import { LANE_LOOK } from './stackLook';

export function StackBar({ segments, size = 'sm', hrefFor, picked, onPick, label = 'Progress, part by part' }: {
  segments: readonly StackSegment[];
  size?: 'sm' | 'lg';
  /** Each segment links to this (the part's page). */
  hrefFor?: (s: StackSegment) => string | null;
  /** The picked part, ringed. */
  picked?: number | null;
  onPick?: (s: StackSegment) => void;
  label?: string;
}) {
  if (!segments.length) return null;
  return (
    <ol className={`stack-segs is-${size}`} aria-label={label}>
      {segments.map((s) => {
        const look = LANE_LOOK[s.lane];
        const words = `Part ${s.n} · ${s.title} · ${s.laneWords || look.word}`;
        const cls = `stack-seg tone-${look.tone} pat-${look.pattern}${picked === s.n ? ' is-picked' : ''}`;
        const href = hrefFor?.(s) ?? null;
        return (
          <li key={s.n} className="stack-seg-slot">
            {onPick
              ? <button type="button" className={cls} title={words} aria-label={words} onClick={() => onPick(s)} />
              : href
                ? <a className={cls} href={href} title={words} aria-label={words} />
                : <span className={cls} title={words} role="img" aria-label={words} />}
          </li>
        );
      })}
    </ol>
  );
}
