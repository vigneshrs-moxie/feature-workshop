// The one Button (packet R): every button and button-like link is drawn by components/controls.css.
//   kind   primary (the solid accent, at most one per area), secondary (the default: surface and a
//          1 px edge), quiet (no edge until hover), danger
//   size   sm 28 px, md 34 px (the default), lg 40 px (at most one per screen)
//   icon   an icon before the words; the words are one run (so "No go: send back" stays tight)
//   keyId  its key from app/keyRegistry.ts, shown by <Kbd>: quiet (on hover, focus, or while ? is
//          held) unless `keyShown`, the main action of a next-step bar
//   busy   a small spinner in place of the words, at the same width; the button is off meanwhile
//          but keeps its focus (aria-disabled and its clicks ignored, not the disabled attribute),
//          and a screen reader hears busyLabel as its name ("Sending…"; "Working…" by default)
//   href   draws an <a> that looks the same (a link that does something becomes a button)
// The class names stay the theme hooks: .btn, .btn-primary, .btn-quiet, .btn-danger, .btn-sm, .btn-lg.
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import type { KeyId } from '../app/keyRegistry';
import { Icon, type IconName } from './Icon';
import { Kbd } from './Kbd';

export type ButtonKind = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface Look {
  kind?: ButtonKind;
  size?: ButtonSize;
  icon?: IconName;
  /** Only an icon: the button is square and its name comes from aria-label. */
  iconOnly?: boolean;
  keyId?: KeyId;
  /** Show the key inside the button at all times (the next-step bar's main action). */
  keyShown?: boolean;
  busy?: boolean;
  /** What a screen reader hears while busy, in place of the words (default "Working…"). */
  busyLabel?: string;
  className?: string;
  children?: ReactNode;
}

export type ButtonProps = Look & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & { href?: undefined };
export type LinkButtonProps = Look & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children'> & { href: string };

/**
 * Whether a button can be pressed now: not disabled, not aria-disabled, not busy. Code that presses
 * another component's button (the job page's and the Desk's calls press the gate card's) asks this,
 * since a busy button is aria-disabled, not disabled.
 */
export function isPressable(b: Element | null | undefined): b is HTMLButtonElement {
  return b instanceof HTMLButtonElement && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && b.getAttribute('aria-busy') !== 'true';
}

/** The class list for a look, for the rare control that can't be a <Button> (a <summary>). */
export function buttonClass({ kind = 'secondary', size = 'md', iconOnly = false, busy = false, className = '' }: Pick<Look, 'kind' | 'size' | 'iconOnly' | 'busy' | 'className'> = {}): string {
  return [
    'btn',
    kind === 'secondary' ? '' : `btn-${kind}`,
    size === 'md' ? '' : `btn-${size}`,
    iconOnly ? 'btn-icon' : '',
    busy ? 'is-busy' : '',
    className,
  ].filter(Boolean).join(' ');
}

const BUSY_WORDS = 'Working…';

function Inside({ icon, size, keyId, keyShown, busy, busyLabel = BUSY_WORDS, children }: Look) {
  const iconSize = size === 'sm' ? 14 : 16;
  return (
    <>
      {icon && <Icon name={icon} size={iconSize} />}
      {children !== undefined && children !== null && children !== false && <span className="btn-label" aria-hidden={busy || undefined}>{children}</span>}
      {keyId && <Kbd id={keyId} shown={keyShown} />}
      {busy && <span className="spin-ring" aria-hidden="true" />}
      {busy && <span className="sr-only btn-busy-words">{busyLabel}</span>}
    </>
  );
}

function ButtonImpl(props: ButtonProps | LinkButtonProps, ref: Ref<HTMLButtonElement | HTMLAnchorElement>) {
  const { kind, size, icon, iconOnly, keyId, keyShown, busy, busyLabel, className, children, ...rest } = props;
  const cls = buttonClass({ kind, size, iconOnly, busy, className });
  const inside = <Inside icon={icon} size={size} keyId={keyId} keyShown={keyShown} busy={busy} busyLabel={busyLabel}>{children}</Inside>;
  if (typeof (rest as LinkButtonProps).href === 'string') {
    const a = rest as Omit<LinkButtonProps, keyof Look>;
    return <a ref={ref as Ref<HTMLAnchorElement>} className={cls} aria-busy={busy || undefined} {...a}>{inside}</a>;
  }
  const b = rest as Omit<ButtonProps, keyof Look>;
  // Busy, it stays focusable (a disabled button would drop the focus) but does nothing when pressed.
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      type="button"
      {...b}
      className={cls}
      disabled={busy ? false : b.disabled}
      aria-disabled={busy ? true : b['aria-disabled']}
      // A label of the caller's own would win over the busy words: while busy, the words are the label.
      aria-label={busy && b['aria-label'] !== undefined ? busyLabel ?? BUSY_WORDS : b['aria-label']}
      aria-busy={busy || undefined}
      onClick={busy ? (e) => e.preventDefault() : b.onClick}
    >
      {inside}
    </button>
  );
}

/** A button, or with `href` a link drawn as one. */
export const Button = forwardRef(ButtonImpl) as {
  (props: ButtonProps & { ref?: Ref<HTMLButtonElement> }): ReactNode;
  (props: LinkButtonProps & { ref?: Ref<HTMLAnchorElement> }): ReactNode;
};
