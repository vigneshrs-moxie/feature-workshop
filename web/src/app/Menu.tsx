// <MenuButton />: a button that drops a short menu of links and actions (the gear, and the ☰ menu at
// phone width). ↓ ↑ move, Esc closes and gives focus back to the button, a click outside or Tab
// closes it. While it is open the page's single-letter keys wait (data-keys-wait, keyRegistry.ts).
// An action can be greyed out (its hint says why). A set of choices is a group under its heading, each
// a radio item with a tick on the one in force (the new job page's Permissions for this job).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { Kbd } from '../components/Kbd';
import type { KeyId } from './keyRegistry';
import { Button } from '../components/Button';

export type MenuEntry =
  | { kind: 'link'; id: string; label: string; href: string; icon?: IconName; hint?: string; keys?: KeyId; current?: boolean; count?: number }
  | { kind: 'action'; id: string; label: string; run: () => void; icon?: IconName; hint?: string; keys?: KeyId; keyText?: string; disabled?: boolean }
  | { kind: 'choices'; id: string; label: string; options: MenuChoice[] }
  | { kind: 'sep'; id: string };

/** One choice of a set (role menuitemradio): ticked when it is the one in force. */
export interface MenuChoice { id: string; label: string; run: () => void; checked: boolean; hint?: string; disabled?: boolean }

export function MenuButton({ label, hint, icon, children, entries, className = '', current = false }: {
  label: string;
  hint: string;
  icon?: IconName;
  children?: ReactNode;
  entries: MenuEntry[];
  className?: string;
  current?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = () => [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)') ?? [])];

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function close(focusButton = true) {
    setOpen(false);
    if (focusButton) button.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  }

  return (
    <div ref={box} className={`menu-box ${className}`.trim()} onKeyDown={onKeyDown}>
      <Button
        ref={button}
        kind="quiet"
        iconOnly
        icon={icon}
        className={children ? 'has-words' : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        aria-current={current ? 'page' : undefined}
        title={hint}
        onClick={() => setOpen((o) => !o)}
      >
        {children}
      </Button>
      {open && (
        <div id={id} className="menu" role="menu" aria-label={label} data-keys-wait="">
          {entries.map((e) => {
            if (e.kind === 'sep') return <div key={e.id} className="menu-sep" role="separator" />;
            if (e.kind === 'choices') {
              return (
                <div key={e.id} role="group" aria-labelledby={`${id}-${e.id}`}>
                  <div id={`${id}-${e.id}`} className="menu-heading">{e.label}</div>
                  {e.options.map((o) => (
                    <button key={o.id} type="button" role="menuitemradio" aria-checked={o.checked} className="menu-item" title={o.hint} disabled={o.disabled} onClick={() => { close(false); o.run(); }}>
                      {o.checked ? <Icon name="check" size={16} /> : <span className="menu-icon-gap" aria-hidden="true" />}
                      <span className="menu-label">{o.label}</span>
                    </button>
                  ))}
                </div>
              );
            }
            const inner = (
              <>
                {e.icon ? <Icon name={e.icon} size={16} /> : <span className="menu-icon-gap" aria-hidden="true" />}
                <span className="menu-label">{e.label}</span>
                {e.kind === 'link' && e.count ? <span className="home-view-count">{e.count}</span> : null}
                {e.keys ? <Kbd id={e.keys} className="menu-key" /> : e.kind === 'action' && e.keyText ? <kbd className="kbd menu-key">{e.keyText}</kbd> : null}
              </>
            );
            return e.kind === 'link' ? (
              <a key={e.id} role="menuitem" className="menu-item" href={e.href} title={e.hint} aria-current={e.current ? 'page' : undefined} onClick={() => close(false)}>{inner}</a>
            ) : (
              <button key={e.id} type="button" role="menuitem" className="menu-item" title={e.hint} disabled={e.disabled} onClick={() => { close(false); e.run(); }}>{inner}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}
