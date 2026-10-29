// Test helpers for <Select> (components/Select.tsx): pick a choice by its value, read the choices.
import { fireEvent } from '@testing-library/react';

function listOf(box: HTMLElement): HTMLElement {
  if (box.getAttribute('aria-expanded') !== 'true') fireEvent.click(box);
  const id = box.getAttribute('aria-controls');
  const list = id ? document.getElementById(id) : null;
  if (!list) throw new Error('The select did not open.');
  return list;
}

/** Opens the select and clicks the choice whose value is `value`. */
export function pickOption(box: HTMLElement, value: string) {
  const option = [...listOf(box).querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.dataset.value === value);
  if (!option) throw new Error(`No choice with the value ${value}.`);
  fireEvent.click(option);
}

/** The words of every choice, in order (opens the select, then closes it). */
export function optionWords(box: HTMLElement): string[] {
  const words = [...listOf(box).querySelectorAll('[role="option"]')].map((o) => o.textContent ?? '');
  fireEvent.keyDown(box, { key: 'Escape' });
  return words;
}
