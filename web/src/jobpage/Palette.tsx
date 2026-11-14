// ⌘K on the new job page (R6): every ask (asks.ts) and the page's places, with a search field. The
// page's own box, drawn with the app's command box classes (components/palette.css) so it looks and
// themes the same. While the page is mounted (on a laptop) its ⌘K is this box (key jp-palette, the
// jobpage scope wins over the app's); on other pages, and on the phone (no ⌘K there), ⌘K is the app's
// palette as before. The last row, `Every ${BRAND.name} action`, opens the app's palette from here.
//
// Groups: For this step (the open step's asks), Any step, Yours (asks he kept from the conversation,
// sb.asks.kept), Places (`Go to: Plan`, `Go to: Changes`, the job's rows), Other steps, then the
// app's palette. No hidden prompts: each ask shows the exact text it sends under its label.
// Type to narrow it (every word must match the label, the text or the group), ↑ ↓ to move, Enter to
// run, Esc to close; picking closes the box first, so an ask that needs a word takes the focus to
// the message box.

import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import type { Job } from '../api/types';
import { BRAND } from '../app/brand';
import { dialogOpen, useKeyScope } from '../app/keyRegistry';
import { useUi } from '../app/ui';
import { Icon } from '../components/Icon';
import { ASKS, asksOf, keptAsk, keptAsks, stepGroup, type Ask } from './asks';
import type { AskRunner } from './left/AsksRow';
import { stepsFromRow } from './left/Steps';
import { CONVERSATION, DECISIONS, DETAILS, outputTarget, TICKET } from './targets';
import type { ReaderTarget, StepRow, StopId } from './types';
import { useJobStore } from './useJob';

export const PLACEHOLDER = 'Ask the Foreman or go to a place…';

type Item =
  | { kind: 'ask'; key: string; group: string; ask: Ask }
  | { kind: 'step'; key: string; group: string; label: string; step: StopId }
  | { kind: 'place'; key: string; group: string; label: string; target: ReaderTarget }
  | { kind: 'app'; key: string; group: string; label: string };

const GROUP = { step: 'For this step', any: 'Any step', yours: 'Yours', places: 'Places', other: 'Other steps', app: BRAND.name } as const;

/** Every item, in the box's order (pure: the box filters it). */
export function paletteItems(step: StopId | null, steps: StepRow[], kept: string[]): Item[] {
  const group = stepGroup(step);
  const out: Item[] = [];
  const seen = new Set<string>();
  const addAsk = (g: string, a: Ask) => { if (seen.has(a.id)) return; seen.add(a.id); out.push({ kind: 'ask', key: `ask:${a.id}`, group: g, ask: a }); };
  if (group !== 'any') for (const a of asksOf(group)) addAsk(GROUP.step, a);
  for (const a of asksOf('any')) addAsk(GROUP.any, a);
  kept.forEach((text, i) => out.push({ kind: 'ask', key: `kept:${i}`, group: GROUP.yours, ask: keptAsk(text, i) }));
  const places = new Set<string>();
  const place = (label: string, item: Item) => { if (places.has(label)) return; places.add(label); out.push(item); };
  for (const s of steps) {
    if (s.state === 'todo' || s.state === 'skipped') continue;
    place(s.label, { kind: 'step', key: `step:${s.id}`, group: GROUP.places, label: `Go to: ${s.label}`, step: s.id });
    for (const o of s.outputs) place(o.label, { kind: 'place', key: `out:${s.id}:${o.kind}:${o.id}`, group: GROUP.places, label: `Go to: ${o.label}`, target: outputTarget(o) });
  }
  for (const [label, target] of [['Ticket and goal', TICKET], ['Conversation', CONVERSATION], ['Decisions', DECISIONS], ['Details', DETAILS]] as const) {
    place(label, { kind: 'place', key: `row:${target.kind}`, group: GROUP.places, label: `Go to: ${label}`, target });
  }
  for (const a of ASKS) addAsk(GROUP.other, a);
  out.push({ kind: 'app', key: 'app', group: GROUP.app, label: `Every ${BRAND.name} action` });
  return out;
}

const labelOf = (i: Item) => (i.kind === 'ask' ? i.ask.label : i.label);

/** Every word of the query is in the item's label, its exact text or its group. */
export function matches(i: Item, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${labelOf(i)} ${i.kind === 'ask' ? i.ask.text : ''} ${i.group}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export interface PaletteProps {
  runner: AskRunner;
  job: Job | null;
  /** The phone has no ⌘K: there the key is the app's. */
  phone: boolean;
  onStep(id: StopId, from?: HTMLElement | null): void;
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

/** ⌘K's key and its box (nothing drawn while it is closed). */
export const Palette = memo(function Palette({ runner, job, phone, onStep, onOpen }: PaletteProps) {
  const [open, setOpen] = useState(false);
  const ui = useUi();
  const sheetOpen = ui.sheet?.kind === 'palette';
  useKeyScope('jobpage', {
    'jp-palette': () => {
      if (open) { setOpen(false); return; }
      // The phone, the app's own palette, or another dialog on top: the app's ⌘K decides.
      if (phone || sheetOpen || dialogOpen()) return false;
      setOpen(true);
    },
  });
  if (!open) return null;
  const close = () => flushSync(() => setOpen(false));
  return (
    <PaletteBox
      job={job}
      onClose={() => setOpen(false)}
      onPick={(item) => {
        close();
        if (item.kind === 'ask') runner.run(item.ask);
        else if (item.kind === 'step') onStep(item.step, null);
        else if (item.kind === 'place') onOpen(item.target, null);
        else ui.openSheet({ kind: 'palette' });
      }}
    />
  );
});

function PaletteBox({ job, onClose, onPick }: { job: Job | null; onClose(): void; onPick(i: Item): void }) {
  const store = useJobStore();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  // Read once, as the box opens: what the page holds now.
  const all = useMemo(() => {
    const s = store.getState();
    const steps = s.payload ? s.payload.steps : stepsFromRow(job);
    const step = s.ui.step ?? steps.find((x) => x.state === 'current')?.id ?? null;
    return paletteItems(step, steps, keptAsks());
  }, [store, job]);
  const shown = useMemo(() => all.filter((i) => matches(i, query)), [all, query]);
  const at = shown.length ? Math.min(active, shown.length - 1) : -1;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    // Back where he was, unless what he picked moved the focus (the message box).
    return () => { if (before?.isConnected && (!document.activeElement || document.activeElement === document.body)) before.focus(); };
  }, []);
  useEffect(() => { if (at >= 0) document.getElementById(optionId(at))?.scrollIntoView?.({ block: 'nearest' }); });

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const n = shown.length;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); if (n) setActive((at + 1) % n); break;
      case 'ArrowUp': e.preventDefault(); if (n) setActive((at - 1 + n) % n); break;
      case 'Enter': e.preventDefault(); if (at >= 0) onPick(shown[at]); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); onClose(); break;
      case 'Tab': e.preventDefault(); break;
      default: break;
    }
  }

  const runs: { group: string; items: { item: Item; i: number }[] }[] = [];
  shown.forEach((item, i) => {
    const last = runs[runs.length - 1];
    if (last && last.group === item.group) last.items.push({ item, i });
    else runs.push({ group: item.group, items: [{ item, i }] });
  });
  // Nothing kept yet: Yours says how to keep one, after Any step.
  if (!query.trim() && !all.some((i) => i.group === GROUP.yours)) {
    const after = runs.findIndex((r) => r.group === GROUP.any);
    runs.splice(after + 1, 0, { group: GROUP.yours, items: [] });
  }

  return (
    <div className="sheet-backdrop palette-backdrop jp2-pal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Asks and places">
        <div className="palette-search">
          <Icon name="search" size={18} className="palette-search-icon" />
          <input
            ref={input}
            className="palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={at >= 0 ? optionId(at) : undefined}
            aria-label="Search asks and places"
            placeholder={PLACEHOLDER}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            title="Type to narrow the list. ↑ and ↓ move, Enter runs the highlighted one, Esc closes."
          />
        </div>
        <ul id={listId} className="palette-list" role="listbox" aria-label="Asks and places">
          {runs.map((run, r) => (
            <li key={`${run.group}-${r}`} role="presentation" className="palette-group">
              <div className="palette-group-head" aria-hidden="true"><span className="palette-section" id={`${listId}-g-${r}`}>{run.group}</span></div>
              {!run.items.length && <p className="jp2-pal-empty">Nothing kept yet. Keep any message of yours from its line in the conversation.</p>}
              <ul role="group" aria-labelledby={`${listId}-g-${r}`} className="palette-group-list">
                {run.items.map(({ item, i }) => (
                  <li
                    key={item.key}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === at}
                    className={`palette-option jp2-pal-opt${i === at ? ' is-active' : ''}`}
                    onMouseMove={() => { if (i !== at) setActive(i); }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onPick(item)}
                  >
                    <span className="jp2-pal-main">
                      <span className="palette-label">{labelOf(item)}</span>
                      {item.kind === 'ask' && <span className="jp2-pal-says">{item.ask.text}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {shown.length === 0 && (
          <div className="palette-empty" role="status">
            <Icon name="search" size={20} className="palette-empty-icon" />
            <p>Nothing matches “{query}”. Try fewer words.</p>
          </div>
        )}
        <p className="palette-foot">
          <span className="palette-foot-item"><kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> to move</span>
          <span className="palette-foot-dot" aria-hidden="true"> · </span>
          <span className="palette-foot-item"><kbd className="kbd">Enter</kbd> to run</span>
          <span className="palette-foot-dot" aria-hidden="true"> · </span>
          <span className="palette-foot-item"><kbd className="kbd">Esc</kbd> to close</span>
        </p>
      </div>
    </div>
  );
}
