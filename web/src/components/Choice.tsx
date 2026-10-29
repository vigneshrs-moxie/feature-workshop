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
