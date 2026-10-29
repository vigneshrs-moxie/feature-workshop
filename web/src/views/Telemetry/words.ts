// Telemetry's small helpers: numbers in words, the series slots (a colour and a pattern each, from
// the theme's --chart-* tokens) and what's remembered in this browser (Fold and Hide, per person).
import type { GraphId } from '../../api/types';

export const usd = (n: number) => `$${n.toFixed(2)}`;
export const usd0 = (n: number) => `$${Math.round(n)}`;
export const pct = (n: number) => `${Math.round(n)}%`;

/** A round top for an axis: 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/**
 * A series slot: its fill (--chart-n) and its pattern (--chart-pattern-n), so no series is told
 * apart by colour alone. Other use always takes slot 8 (cross-hatch), and the people slots 1 to 7.
 */
export const OTHER_SLOT = 8;
export const slotClass = (slot: number) => `tele-s tele-s${Math.min(8, Math.max(1, slot))}`;

/** "Week from Wed 28 Oct, 4 pm" → "28 Oct" for an axis. */
export const weekTick = (label: string) => label.replace(/^Week from \w+ /, '').replace(/,.*$/, '');

// ---------- Fold and Hide, remembered per person in this browser ----------

export interface Prefs { folded: Partial<Record<GraphId, boolean>>; hidden: GraphId[] }
const EMPTY: Prefs = { folded: {}, hidden: [] };
export const prefsKey = (me: string | null) => `gc.telemetry.graphs.${me ?? 'you'}`;

/** What was saved (lib/stored's string), or nothing folded or hidden. */
export function parsePrefs(raw: string | null): Prefs {
  try {
    const v = JSON.parse(raw ?? 'null');
    if (!v || typeof v !== 'object') return EMPTY;
    return { folded: v.folded && typeof v.folded === 'object' ? v.folded : {}, hidden: Array.isArray(v.hidden) ? v.hidden.filter((x: unknown) => typeof x === 'string') : [] };
  } catch { return EMPTY; }
}
