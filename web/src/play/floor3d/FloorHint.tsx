// <FloorHint text>: the words that show when the pointer rests on a figure or a control on the
// floor. For now the browser's own hint (a title attribute); packet R's Tooltip replaces it here,
// in this one place, without the floor changing.
import { cloneElement, type ReactElement } from 'react';

export function FloorHint({ text, children }: { text: string; children: ReactElement<{ title?: string }> }) {
  return cloneElement(children, { title: text });
}
