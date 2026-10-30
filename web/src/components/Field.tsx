// The fields (packet R): one height (34 px), border, radius and focus ring for every input, text
// area and select (components/controls.css). <Field> is a label over its control, with an optional
// hint and a problem line; <TextInput> and <TextArea> are the inputs with the shared look.
import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className = '', type = 'text', ...rest }, ref) {
  return <input ref={ref} type={type} className={`text-input ${className}`.trim()} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} className={`text-area ${className}`.trim()} {...rest} />;
});

export function Field({ label, hint, problem, className = '', children }: { label: ReactNode; hint?: ReactNode; problem?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={`field ${className}`.trim()}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
      {problem && <span className="field-problem" role="alert">{problem}</span>}
    </label>
  );
}

/**
 * A whole number with − and + (never the browser's spinner). Typing works too; the value is
 * clamped to min..max when it is stepped. onChange gets the text as typed, like an <input>.
 */
export function NumberInput({ value, onChange, min, max, step = 1, disabled = false, id, className = '', 'aria-label': label, title }: {
  value: string | number;
  onChange(value: string): void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
  title?: string;
}) {
  const n = Number(value);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const by = (d: number) => onChange(String(clamp((Number.isFinite(n) ? n : (min ?? 0)) + d)));
  return (
    <span className={`number-input ${className}`.trim()} title={title}>
      <button type="button" className="number-step" tabIndex={-1} aria-label="One less" disabled={disabled || (min !== undefined && n <= min)} onClick={() => by(-step)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        role="spinbutton"
        aria-label={label}
        aria-valuenow={Number.isFinite(n) ? n : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value.replace(/[^\d-]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); by(step); }
          if (e.key === 'ArrowDown') { e.preventDefault(); by(-step); }
        }}
      />
      <button type="button" className="number-step" tabIndex={-1} aria-label="One more" disabled={disabled || (max !== undefined && n >= max)} onClick={() => by(step)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
      </button>
    </span>
  );
}
