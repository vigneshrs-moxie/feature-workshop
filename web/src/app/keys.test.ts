import { afterEach, describe, expect, it, vi } from 'vitest';
import { handlePageKey, isTypingTarget, type PageKeys } from './keys';

function keys(): PageKeys {
  return { palette: vi.fn(), nextJob: vi.fn(), previousJob: vi.fn(), newJob: vi.fn(), showKeys: vi.fn() };
}

function press(target: EventTarget, init: KeyboardEventInit) {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, 'target', { value: target });
  return e;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('page keys', () => {
  it('j, k, c and ? work outside text fields', () => {
    const k = keys();
    expect(handlePageKey(press(document.body, { key: 'j' }), k)).toBe(true);
    expect(handlePageKey(press(document.body, { key: 'k' }), k)).toBe(true);
    expect(handlePageKey(press(document.body, { key: 'c' }), k)).toBe(true);
    expect(handlePageKey(press(document.body, { key: '?', shiftKey: true }), k)).toBe(true);
    expect(k.nextJob).toHaveBeenCalledTimes(1);
    expect(k.previousJob).toHaveBeenCalledTimes(1);
    expect(k.newJob).toHaveBeenCalledTimes(1);
    expect(k.showKeys).toHaveBeenCalledTimes(1);
  });

  it('single-letter keys are ignored while you type', () => {
    const k = keys();
    const area = document.body.appendChild(document.createElement('textarea'));
    const input = document.body.appendChild(document.createElement('input'));
    const select = document.body.appendChild(document.createElement('select'));
    for (const t of [area, input, select]) expect(handlePageKey(press(t, { key: 'j' }), k)).toBe(false);
    expect(k.nextJob).not.toHaveBeenCalled();
  });

  it('a checkbox is not a text field', () => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    expect(isTypingTarget(box)).toBe(false);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
  });

  it('⌘K and Ctrl+K open the palette even from a text field', () => {
    const k = keys();
    const area = document.body.appendChild(document.createElement('textarea'));
    expect(handlePageKey(press(area, { key: 'k', metaKey: true }), k)).toBe(true);
    expect(handlePageKey(press(document.body, { key: 'K', ctrlKey: true }), k)).toBe(true);
    expect(k.palette).toHaveBeenCalledTimes(2);
    expect(k.previousJob).not.toHaveBeenCalled();
  });

  it('keys with ⌘, Ctrl or Alt held belong to the browser', () => {
    const k = keys();
    expect(handlePageKey(press(document.body, { key: 'c', metaKey: true }), k)).toBe(false);
    expect(handlePageKey(press(document.body, { key: 'j', altKey: true }), k)).toBe(false);
    expect(k.newJob).not.toHaveBeenCalled();
  });

  it('wait while a dialog is open', () => {
    const k = keys();
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('aria-modal', 'true');
    expect(handlePageKey(press(document.body, { key: 'j' }), k)).toBe(false);
    expect(k.nextJob).not.toHaveBeenCalled();
  });
});
