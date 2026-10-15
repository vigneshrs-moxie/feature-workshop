// A modal sheet: a dimmed backdrop and a dialog. Escape or a click on the backdrop closes it (unless
// `busy`); focus moves into it when it opens and goes back where it was when it closes.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { focusIsLost } from './CommandPalette';

export interface SheetProps {
  title: string;
  onClose: () => void;
  busy?: boolean;
  className?: string;
  children: ReactNode;
}

export function Sheet({ title, onClose, busy = false, className = '', children }: SheetProps) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>('input, textarea, select, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !latest.current.busy) { e.preventDefault(); latest.current.onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (before?.isConnected && focusIsLost()) before.focus();
    };
  }, []);

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={box} className={`sheet ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h3 id={titleId} className="sheet-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}
