// Chips and badges (packet R): one shape, radius 6 and 22 px high, an icon and a word, tinted from the
// status tokens (components/controls.css). Status is never colour alone: the word is always there.
import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type ChipTone = 'neutral' | 'accent' | 'ok' | 'info' | 'warn' | 'error' | 'needs-you' | 'review' | 'outline';

export function Chip({ tone = 'neutral', icon, className = '', children, ...rest }: { tone?: ChipTone; icon?: IconName; className?: string; children: ReactNode } & Omit<HTMLAttributes<HTMLSpanElement>, 'className' | 'children'>) {
  return (
    <span className={`chip${tone === 'neutral' ? '' : ` chip-${tone}`} ${className}`.trim()} {...rest}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}
