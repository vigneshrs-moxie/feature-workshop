// Nothing moves under the pointer (packet R, principle 4): while the pointer is over a board, each
// item keeps the group (lane) and the place it had when the pointer came in, while its data stays
// fresh. A new item joins at the end of its group; one that is gone leaves. When the pointer leaves,
// everything goes where it belongs now (lib/flip.ts slides it there).
import { useCallback, useRef, useState } from 'react';

/** One item and the group it shows in. */
export interface Placed<T> { item: T; group: string }
/** Where an item was when the hold began. */
export interface Slot { key: string; group: string }

/**
 * The items as they show: in `held`'s groups and order when there is a hold (with fresh data, new
 * ones at the end in their own group, gone ones left out), else in their own group and order.
 */
export function arrange<T>(held: readonly Slot[] | null, items: readonly T[], keyOf: (t: T) => string, groupOf: (t: T) => string): Placed<T>[] {
  if (!held) return items.map((item) => ({ item, group: groupOf(item) }));
  const byKey = new Map(items.map((item) => [keyOf(item), item] as const));
  const out: Placed<T>[] = [];
  const seen = new Set<string>();
  for (const s of held) {
    const item = byKey.get(s.key);
    if (item === undefined || seen.has(s.key)) continue;
    seen.add(s.key);
    out.push({ item, group: s.group });
  }
  for (const item of items) if (!seen.has(keyOf(item))) out.push({ item, group: groupOf(item) });
  return out;
}

/**
 * `items` in their groups (`groupOf`) and order, held while the pointer is over the element given
 * `hoverProps`. `active` false (another layout, no board) drops any hold.
 */
export function useHeldWhileHovered<T>(items: readonly T[], keyOf: (t: T) => string, groupOf: (t: T) => string, active = true) {
  const held = useRef<Slot[] | null>(null);
  const [, redraw] = useState(0);
  if (!active) held.current = null;
  const arranged = arrange(held.current, items, keyOf, groupOf);
  const latest = useRef({ arranged, keyOf });
  latest.current = { arranged, keyOf };
  const onMouseEnter = useCallback(() => {
    const { arranged: now, keyOf: key } = latest.current;
    held.current = now.map((p) => ({ key: key(p.item), group: p.group }));
  }, []);
  const onMouseLeave = useCallback(() => {
    if (!held.current) return;
    held.current = null;
    redraw((n) => n + 1);
  }, []);
  return { arranged, held: held.current !== null, hoverProps: { onMouseEnter, onMouseLeave } };
}
