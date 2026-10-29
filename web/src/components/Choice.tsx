// The one radio and checkbox (packet R): 16 px, drawn in the accent by components/controls.css, the
// native input underneath so the keyboard, forms and screen readers work as always. Every
// <input type="radio|checkbox"> in the app goes through it (theme/controlRules.test.ts checks).
// Put it inside its <label> so the whole label is clickable.
//   <OptionRow> a full-width row for a brief's a / b / Other: it highlights on hover and shows the
//               one you picked.
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

export type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { type: 'radio' | 'checkbox' };

export const Choice = forwardRef<HTMLInputElement, ChoiceProps>(function Choice({ className = '', ...rest }, ref) {
  return <input ref={ref} className={`choice ${className}`.trim()} {...rest} />;
});

/** A full-width option row: the choice, then its words. */
export function OptionRow({ className = '', title, children, ...input }: ChoiceProps & { children: ReactNode }) {
  return (
    <label className={`option-row ${className}`.trim()} title={title}>
      <Choice {...input} />
      {children}
    </label>
  );
}

/**
 * A segmented choice: two to four short words, one picked (Detail: Simple / Full; text size S M L XL).
 * A radio group underneath (role="radiogroup"), so the arrow keys move the pick.
 */
export function Segmented<T extends string>({ value, options, onChange, label, className = '', disabled = false }: {
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  onChange(value: T): void;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  const move = (from: number, by: number) => {
    const next = options[(from + by + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-segment="${CSS.escape(label)}:${next.value}"]`)?.focus());
  };
  return (
    <span className={`segmented ${className}`.trim()} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          className="segmented-option"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          data-segment={`${label}:${o.value}`}
          disabled={disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(i, 1); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(i, -1); }
          }}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
