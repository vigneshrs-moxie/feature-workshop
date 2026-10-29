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
