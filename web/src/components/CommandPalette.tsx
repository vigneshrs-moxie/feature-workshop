// ⌘K: a search box over every action valid right now (app/commands.ts), as an ARIA combobox with
// a listbox. Type to narrow it, ↑/↓ to move, Enter to run, Esc to close. Focus stays in the box;
// the highlighted action is announced through aria-activedescendant.
// With Play on (onEgg given), a few exact phrases do something else on Enter (play/eggs.ts): never
// listed or hinted at. "rm -rf /" gets the Locksmith's door over the palette before it closes.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { filterCommands, type Command } from '../app/commands';
import { CrewMember } from '../play/CrewMember';
import { paletteEgg, type PaletteEgg } from '../play/eggs';

/** How long the Locksmith's door stays over the palette. */
export const DOOR_MS = 1400;

/** Focus went nowhere (the focused element was removed with the palette). */
export const focusIsLost = () => !document.activeElement || document.activeElement === document.body;

export function CommandPalette({ commands, onClose, onEgg }: { commands: Command[]; onClose: () => void; onEgg?: (egg: PaletteEgg) => void }) {
  const [query, setQuery] = useState('');
  const [door, setDoor] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const input = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => filterCommands(commands, query), [commands, query]);
  const at = shown.length ? Math.min(active, shown.length - 1) : -1;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    // Back where you were, unless the action you picked moved focus (or opened another sheet).
    return () => { if (before?.isConnected && focusIsLost() && !document.querySelector('[aria-modal="true"]')) before.focus(); };
  }, []);

  useEffect(() => {
    if (at >= 0) document.getElementById(optionId(at))?.scrollIntoView?.({ block: 'nearest' });
  });

  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!door) return;
    const t = setTimeout(() => close.current(), DOOR_MS);
    return () => clearTimeout(t);
  }, [door]);

  function pick(cmd: Command | undefined) {
    if (!cmd) return;
    onClose();
    cmd.run();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const n = shown.length;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); if (n) setActive((at + 1) % n); break;
      case 'ArrowUp': e.preventDefault(); if (n) setActive((at - 1 + n) % n); break;
      case 'Home': if (n) { e.preventDefault(); setActive(0); } break;
      case 'End': if (n) { e.preventDefault(); setActive(n - 1); } break;
      case 'Enter': {
        e.preventDefault();
        const egg = onEgg ? paletteEgg(query) : null;
        if (egg === 'rm-rf') { if (!door) { setDoor(true); onEgg?.(egg); } }
        else if (egg) { onClose(); onEgg?.(egg); }
        else pick(shown[at]);
        break;
      }
      case 'Escape': e.preventDefault(); e.stopPropagation(); onClose(); break;
      case 'Tab': e.preventDefault(); break; // the palette keeps focus until you pick or close
      default: break;
    }
  }

  return (
    <div className="sheet-backdrop palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={input}
          className="text-input palette-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={at >= 0 ? optionId(at) : undefined}
          aria-label="Search actions"
          placeholder="What do you want to do?"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
          title="Type to narrow the list. ↑ and ↓ move, Enter runs the highlighted action, Esc closes."
        />
        <ul id={listId} className="palette-list" role="listbox" aria-label="Actions you can take now" hidden={door}>
          {shown.map((c, i) => (
            <li
              key={c.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === at}
              aria-describedby={`${optionId(i)}-hint`}
              className={i === at ? 'palette-option is-active' : 'palette-option'}
              title={c.hint}
              onMouseMove={() => { if (i !== at) setActive(i); }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
            >
              <span className="palette-label">{c.label}</span>
              <span className="palette-section muted">{c.section}</span>
              {c.keys && <kbd className="kbd">{c.keys}</kbd>}
              <span id={`${optionId(i)}-hint`} className="sr-only">{c.hint}</span>
            </li>
          ))}
        </ul>
        {shown.length === 0 && !door && <p className="muted palette-empty" role="status">Nothing matches “{query}”. Try fewer words.</p>}
        {door && (
          <div className="palette-door" role="status">
            <CrewMember type="feature-review-permissions" state="waiting" size={44} label="Locksmith" animated={false} />
            <p className="palette-door-line">Hard line. Nice try.</p>
          </div>
        )}
        <p className="palette-foot muted">↑ ↓ to move · Enter to run · Esc to close</p>
      </div>
    </div>
  );
}
