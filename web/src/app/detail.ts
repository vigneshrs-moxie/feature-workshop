// How much each screen shows (packet R, Settings → Look → Detail), remembered in this browser:
//   simple (the default)  each screen shows what is happening, what needs you and the one next action;
//                         everything else sits one click away behind a labelled disclosure
//   full                  every disclosure starts open, for people who want everything shown
// What you open or close on a screen is remembered per screen (useShown), and wins over the
// setting's starting point until you change the setting again.
import { useCallback } from 'react';
import { useStored, writeStored } from '../lib/stored';

export type Detail = 'simple' | 'full';
export const DETAIL_KEY = 'workshop.detail';

export const DETAIL_INFO: Record<Detail, { label: string; say: string }> = {
  simple: { label: 'Simple', say: 'Each screen shows what is happening, what needs you and the next step. The rest is one click away.' },
  full: { label: 'Full', say: 'Every screen opens with all of its details: history, activity, facts and every graph.' },
};

/** What a browser that never chose starts with: Simple. Tests start in Full (test-setup.ts) unless they ask. */
let startWith: Detail = 'simple';
export function setDefaultDetail(d: Detail) { startWith = d; }

const shownKey = (screen: string) => `workshop.shown.${screen}`;
const SCREENS_SEEN = 'workshop.shown.screens';

function parse(raw: string | null): Record<string, boolean> {
  try {
    const v = JSON.parse(raw ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, b]) => typeof b === 'boolean')) as Record<string, boolean> : {};
  } catch { return {}; }
}

/** The Detail setting, live, and a setter. Changing it starts every screen over from the new setting. */
export function useDetail(): [Detail, (d: Detail) => void] {
  const [raw, set] = useStored(DETAIL_KEY);
  const [seen] = useStored(SCREENS_SEEN);
  const change = useCallback((d: Detail) => {
    for (const screen of parseList(seen)) writeStored(shownKey(screen), null);
    writeStored(SCREENS_SEEN, null);
    set(d);
  }, [seen, set]);
  return [raw === 'full' || raw === 'simple' ? raw : startWith, change];
}

function parseList(raw: string | null): string[] {
  try { const v = JSON.parse(raw ?? '[]') as unknown; return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []; } catch { return []; }
}

/**
 * Whether one disclosure on a screen is open: what you last chose there in this browser, else open
 * in Full and closed in Simple (or `simpleOpen` when it starts open even in Simple).
 */
export function useShown(screen: string, id: string, simpleOpen = false): [boolean, (open: boolean) => void] {
  const [detail] = useDetail();
  const [raw, set] = useStored(shownKey(screen));
  const [seen, setSeen] = useStored(SCREENS_SEEN);
  const map = parse(raw);
  const open = id in map ? map[id] : detail === 'full' || simpleOpen;
  const change = useCallback((next: boolean) => {
    const now = parse(raw);
    now[id] = next;
    set(JSON.stringify(now));
    const list = parseList(seen);
    if (!list.includes(screen)) setSeen(JSON.stringify([...list, screen]));
  }, [raw, id, set, seen, screen, setSeen]);
  return [open, change];
}
