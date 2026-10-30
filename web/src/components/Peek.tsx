// Peek before you open (packet R, principle 10): a sheet over the right side of a list (Jobs, the
// Inbox), so reading one thing never costs you your place in the list.
//   usePeekKeys  j / k move through the list, ↵ opens the whole thing (when there is one), Esc
//                closes, all ahead of the page's own keys; never while typing or with a dialog
//                open. On close the focus goes back where it was.
//   usePeekAddress  the open peek in the address (#/inbox?peek=ORBIT-12), so a reload or Back to
//                the page opens it again. Replaced, not pushed: j and k would otherwise fill Back.
//   <Peek>       the sheet: a title row with its actions and Close, the body, and a quiet footer
//                naming the keys.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { isTypingTarget } from '../app/keyRegistry';
import { peekFromHash, withPeek } from '../app/router';
import { Button } from './Button';

export function usePeekKeys<T extends string>({ current, order, onPick, onClose, onEnter }: {
  current: T;
  order: readonly T[];
  onPick(id: T): void;
  onClose(): void;
  /** ↵ (not on a button or link): open the whole thing. */
  onEnter?(id: T): void;
}) {
  const latest = useRef({ current, order, onPick, onClose, onEnter });
  latest.current = { current, order, onPick, onClose, onEnter };
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const { current: id, order: o, onPick: pick, onClose: close, onEnter: enter } = latest.current;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault(); e.stopImmediatePropagation();
        const at = o.indexOf(id);
        const next = o[(at + (e.key === 'j' ? 1 : -1) + o.length) % o.length];
        if (next) pick(next);
        return;
      }
      if (enter && e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement)) {
        e.preventDefault(); e.stopImmediatePropagation(); enter(id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
}

export function usePeekAddress(): [string | null, (id: string | null) => void] {
  const [peek, setNow] = useState<string | null>(() => peekFromHash(window.location.hash));
  const set = useCallback((id: string | null) => {
    setNow(id);
    const next = withPeek(window.location.hash, id);
    if (next !== window.location.hash) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${next}`);
  }, []);
  useEffect(() => {
    const onHash = () => setNow(peekFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [peek, set];
}

export function Peek({ label, title, chip, actions, keys, onClose, className = '', children }: {
  /** The sheet's name for screen readers: "<thing>: a quick look". */
  label: string;
  title: ReactNode;
  chip?: ReactNode;
  /** Quiet actions beside Close in the title row. */
  actions?: ReactNode;
  /** The footer's key words, e.g. [['j k', 'the next or previous ticket'], ['Esc', 'close']]. */
  keys: readonly (readonly [string, string])[];
  onClose(): void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <aside className={`peek ${className}`.trim()} role="dialog" aria-modal="false" aria-label={label}>
      <header className="peek-head">
        <h3 className="peek-title">{title}</h3>
        {chip}
        <span className="spacer" />
        {actions}
        <Button kind="quiet" size="sm" iconOnly icon="x" aria-label="Close" title="Close this quick look; the list stays as it was (key: Esc)." onClick={onClose} />
      </header>
      <div className="peek-body">{children}</div>
      <footer className="peek-foot">
        {keys.map(([k, say]) => (
          <span key={k}>{k.split(' ').map((c, n) => <span key={c}>{n > 0 && ' '}<kbd className="kbd">{c}</kbd></span>)} {say}</span>
        ))}
      </footer>
    </aside>
  );
}
