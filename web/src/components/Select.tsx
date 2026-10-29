// The one select (packet R): drawn by the app, not the browser. A button that says the choice with a
// chevron, opening a list in the command box's menu look. Every <select> in the app goes through it
// (theme/controlRules.test.ts checks).
//
// It follows the select-only combobox pattern: the button is role="combobox" (named by its label,
// aria-label or aria-labelledby), the list is role="listbox" with one role="option" per choice.
// Keys, while it has the focus: ↓ ↑ Enter or Space open it; in the list ↓ ↑ Home End move, Enter or
// Space picks, Esc closes without a change, Tab closes, and a letter jumps to the next choice that
// starts with it. Keys it uses never reach the page's own keys (j, k, Esc closing a sheet).
// The chosen value is on the button as data-value.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** The words, when `label` isn't plain text (for the jump-by-letter and the tooltip). */
  text?: string;
  disabled?: boolean;
  title?: string;
}

export interface SelectProps {
  value: string;
  options: readonly SelectOption[];
  onChange(value: string): void;
  disabled?: boolean;
  id?: string;
  className?: string;
  title?: string;
  /** Shown while the value matches no option. */
  placeholder?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

const words = (o: SelectOption) => o.text ?? (typeof o.label === 'string' ? o.label : o.value);

export function Select({ value, options, onChange, disabled = false, id, className = '', title, placeholder = 'Pick one', ...aria }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;
  const chosen = options.findIndex((o) => o.value === value);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

  const close = useCallback((focus = true) => {
    setOpen(false);
    setActive(-1);
    if (focus) button.current?.focus();
  }, []);

  const openList = () => {
    if (disabled || options.length === 0) return;
    setActive(chosen >= 0 && !options[chosen].disabled ? chosen : enabled[0] ?? -1);
    setOpen(true);
  };

  const pick = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    close();
    if (o.value !== value) onChange(o.value);
  };

  // Where the list goes: under the button, or above it when there is no room below.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const place = () => {
      const r = button.current!.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      const want = Math.min(320, options.length * 36 + 10);
      setPlace(below < want && r.top > below
        ? { left: r.left, bottom: window.innerHeight - r.top + 4, width: r.width }
        : { left: r.left, top: r.bottom + 4, width: r.width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, options.length]);

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !list.current?.contains(t)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  // The active choice stays in view.
  useEffect(() => {
    if (open && active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  });

  const step = (by: number) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(active);
    const next = at < 0 ? enabled[0] : enabled[Math.max(0, Math.min(enabled.length - 1, at + by))];
    setActive(next);
  };

  const jump = (letter: string) => {
    const l = letter.toLowerCase();
    const order = [...options.keys()].map((n) => (n + Math.max(active, chosen) + 1) % options.length);
    const hit = order.find((i) => !options[i].disabled && words(options[i]).toLowerCase().startsWith(l));
    if (hit === undefined) return;
    if (open) setActive(hit); else if (options[hit].value !== value) onChange(options[hit].value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const used = () => { e.preventDefault(); e.stopPropagation(); };
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { used(); openList(); return; }
      if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) { used(); jump(e.key); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': used(); step(1); return;
      case 'ArrowUp': used(); step(-1); return;
      case 'Home': used(); setActive(enabled[0] ?? -1); return;
      case 'End': used(); setActive(enabled[enabled.length - 1] ?? -1); return;
      case 'Enter': case ' ': used(); pick(active); return;
      case 'Escape': used(); close(); return;
      case 'Tab': close(false); return;
      default:
        if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) { used(); jump(e.key); }
    }
  };

  const current = chosen >= 0 ? options[chosen] : null;
  return (
    <span className={`select-box ${className}`.trim()}>
      <button
        ref={button}
        type="button"
        id={id}
        role="combobox"
        className="select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        data-value={value}
        disabled={disabled}
        title={title}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        {...aria}
      >
        <span className={`select-value${current ? '' : ' muted'}`}>{current ? current.label : placeholder}</span>
        <Icon name="chevron-down" size={14} className="select-chevron" />
      </button>
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          className="select-menu"
          aria-label={aria['aria-label']}
          aria-labelledby={aria['aria-label'] ? undefined : aria['aria-labelledby'] ?? id}
          style={place ? { left: place.left, top: place.top, bottom: place.bottom, minWidth: place.width } : { visibility: 'hidden' }}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={optionId(i)}
              role="option"
              data-value={o.value}
              aria-selected={i === chosen}
              aria-disabled={o.disabled || undefined}
              className={`select-option${i === active ? ' is-active' : ''}`}
              title={o.title}
              onMouseMove={() => { if (!o.disabled && active !== i) setActive(i); }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
            >
              <span className="select-option-label">{o.label}</span>
              <Icon name="check" size={14} className="select-check" />
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
