// A drawer that slides in from the right edge: a modal dialog over a dimmed backdrop, in the same
// visual language as Sheet. Escape, the Close button or a click on the backdrop ask to close it
// (onRequestClose decides: the job drawer first asks about unsaved changes). Focus moves into it
// when it opens, stays inside it while it is open (Tab and Shift+Tab wrap around), and goes back
// where it was when it closes.
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { focusIsLost } from './CommandPalette';
import { Button } from './Button';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Whether an element can take focus now: not in a hidden panel, nor inside a closed <details> (its summary can). */
function reachable(el: HTMLElement): boolean {
  if (el.closest('[hidden]')) return false;
  for (let d = el.parentElement?.closest('details') ?? null; d; d = d.parentElement?.closest('details') ?? null) {
    if (!d.open && !(el.tagName === 'SUMMARY' && el.parentElement === d)) return false;
  }
  return true;
}

/** The elements Tab moves between inside `box`, in order. */
export function focusables(box: HTMLElement): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable);
}

export interface DrawerProps {
  title: string;
  /** Asked to close (Escape, Close, the backdrop). */
  onRequestClose: () => void;
  className?: string;
  /** Under the title, before the body (the tabs). */
  head?: ReactNode;
  /**
   * Where focus goes on close when what had it before is gone (a menu item that closed with its
   * menu, the ⌘K palette).
   */
  fallbackFocus?: () => HTMLElement | null;
  children: ReactNode;
}

export function Drawer({ title, onRequestClose, className = '', head, fallbackFocus, children }: DrawerProps) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(onRequestClose);
  latest.current = onRequestClose;
  const fallback = useRef(fallbackFocus);
  fallback.current = fallbackFocus;

  useEffect(() => {
    const had = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const el = box.current;
    const marked = el ? [...el.querySelectorAll<HTMLElement>('[data-autofocus]')].find(reachable) : undefined;
    const first = marked ?? (el ? focusables(el)[0] : null);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); latest.current(); }
    };
    // Focus that lands outside (a click on the page behind, a stray programmatic focus) comes back.
    const onFocusIn = (e: FocusEvent) => {
      const b = box.current;
      if (b && e.target instanceof Node && !b.contains(e.target)) (focusables(b)[0] ?? b).focus();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      if (!focusIsLost()) return;
      const back = had?.isConnected ? had : fallback.current?.() ?? null;
      back?.focus();
    };
  }, []);

  function trapTab(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !box.current) return;
    const list = focusables(box.current);
    if (!list.length) { e.preventDefault(); return; }
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && at <= 0) { e.preventDefault(); list[list.length - 1].focus(); }
    else if (!e.shiftKey && (at === list.length - 1 || at < 0)) { e.preventDefault(); list[0].focus(); }
  }

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onRequestClose(); }}>
      <div
        ref={box}
        className={`drawer ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="drawer-head">
          <h3 id={titleId} className="drawer-title">{title}</h3>
          <Button kind="quiet" className="drawer-close" onClick={onRequestClose} aria-label="Close the drawer" title="Close this drawer (Escape). If something isn’t saved yet, you’re asked first.">
            <span aria-hidden="true">✕</span>
          </Button>
        </div>
        {head}
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}
