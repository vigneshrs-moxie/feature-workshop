import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeScopes, handleKey, installKeyListener, isTypingTarget, KEY_IDS, KEYS, keyDef, keyLabel, keysText, registerKeys, resetChord, SCOPE_PRIORITY, SCOPES, type KeyHandlers, type KeyId, type KeyScope,
} from './keyRegistry';
import { writeKeysSetting } from './keysSetting';

function press(target: EventTarget, init: KeyboardEventInit) {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, 'target', { value: target });
  return e;
}

const regs: { unregister(): void }[] = [];
function on(scope: Parameters<typeof registerKeys>[0], handlers: KeyHandlers, active = true) {
  const reg = registerKeys(scope, { current: handlers }, active);
  regs.push(reg);
  return reg;
}

beforeEach(() => { localStorage.clear(); resetChord(); });
afterEach(() => { for (const r of regs.splice(0)) r.unregister(); document.body.innerHTML = ''; });

describe('the key registry', () => {
  it('runs the page keys outside text fields and marks the event handled', () => {
    const next = vi.fn(); const prev = vi.fn(); const newJob = vi.fn(); const keys = vi.fn();
    on('rows', { 'next-job': next, 'prev-job': prev });
    on('global', { 'new-job': newJob, 'keys': keys });
    expect(handleKey(press(document.body, { key: 'j' }))).toBe(true);
    expect(handleKey(press(document.body, { key: 'k' }))).toBe(true);
    expect(handleKey(press(document.body, { key: 'c' }))).toBe(true);
    const q = press(document.body, { key: '?', shiftKey: true });
    expect(handleKey(q)).toBe(true);
    expect(q.defaultPrevented).toBe(true);
    expect([next, prev, newJob, keys].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 1]);
    expect(handleKey(press(document.body, { key: 'z' }))).toBe(false);
  });

  it('the highest-priority active scope gets the key; a parked scope lets it through', () => {
    const rows = vi.fn(); const desk = vi.fn();
    on('rows', { 'next-job': rows });
    const d = on('desk', { 'desk-next': desk });
    handleKey(press(document.body, { key: 'j' }));
    expect(desk).toHaveBeenCalledTimes(1);
    expect(rows).not.toHaveBeenCalled();
    d.setActive(false);
    handleKey(press(document.body, { key: 'j' }));
    expect(rows).toHaveBeenCalledTimes(1);
    expect(activeScopes().has('desk')).toBe(false);
  });

  it('a handler that answers false passes the key on to the next scope', () => {
    const rows = vi.fn();
    on('rows', { 'next-job': rows });
    on('desk', { 'desk-next': () => false });
    handleKey(press(document.body, { key: 'j' }));
    expect(rows).toHaveBeenCalledTimes(1);
  });

  it('single-letter keys are ignored while you type, and while a dialog is open; ⌘K is not', () => {
    const next = vi.fn(); const palette = vi.fn();
    on('rows', { 'next-job': next });
    on('global', { 'palette': palette });
    const area = document.body.appendChild(document.createElement('textarea'));
    const input = document.body.appendChild(document.createElement('input'));
    const select = document.body.appendChild(document.createElement('select'));
    for (const t of [area, input, select]) expect(handleKey(press(t, { key: 'j' }))).toBe(false);
    expect(handleKey(press(area, { key: 'k', metaKey: true }))).toBe(true);
    expect(handleKey(press(document.body, { key: 'K', ctrlKey: true }))).toBe(true);
    expect(palette).toHaveBeenCalledTimes(2);
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('aria-modal', 'true');
    expect(handleKey(press(document.body, { key: 'j' }))).toBe(false);
    expect(handleKey(press(document.body, { key: 'k', metaKey: true }))).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('a checkbox is not a text field', () => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    expect(isTypingTarget(box)).toBe(false);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('keys with ⌘, Ctrl or Alt held belong to the browser unless declared with Mod', () => {
    const newJob = vi.fn(); const next = vi.fn();
    on('global', { 'new-job': newJob });
    on('rows', { 'next-job': next });
    expect(handleKey(press(document.body, { key: 'c', metaKey: true }))).toBe(false);
    expect(handleKey(press(document.body, { key: 'j', altKey: true }))).toBe(false);
    expect(handleKey(press(document.body, { key: 'j', ctrlKey: true }))).toBe(false);
    expect(newJob).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('g then a letter within 1.5 s is a chord; a late or unknown second key does nothing', () => {
    const table = vi.fn(); const next = vi.fn();
    on('global', { 'go-table': table });
    on('rows', { 'next-job': next });
    const g = press(document.body, { key: 'g' });
    expect(handleKey(g, 1000)).toBe(true);
    expect(g.defaultPrevented).toBe(true);
    expect(handleKey(press(document.body, { key: 't' }), 2000)).toBe(true);
    expect(table).toHaveBeenCalledTimes(1);
    // Too late: t on its own is nothing.
    handleKey(press(document.body, { key: 'g' }), 3000);
    expect(handleKey(press(document.body, { key: 't' }), 4600)).toBe(false);
    expect(table).toHaveBeenCalledTimes(1);
    // g then j: not a chord, and j does not step jobs either.
    handleKey(press(document.body, { key: 'g' }), 5000);
    handleKey(press(document.body, { key: 'j' }), 5100);
    expect(next).not.toHaveBeenCalled();
    handleKey(press(document.body, { key: 'j' }), 5200);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('a higher scope that binds the same key wins: the Desk’s o over the gate’s', () => {
    const guidance = vi.fn(); const open = vi.fn();
    on('gate', { 'gate-guidance': guidance });
    on('desk', { 'desk-open': open });
    handleKey(press(document.body, { key: 'o' }), 1000);
    expect(open).toHaveBeenCalledTimes(1);
    expect(guidance).not.toHaveBeenCalled();
  });

  it('a held key never repeats, except where the binding says so', () => {
    const next = vi.fn(); const down = vi.fn();
    on('rows', { 'next-job': next });
    on('table', { 'table-down': down });
    handleKey(press(document.body, { key: 'j', repeat: true }));
    expect(next).not.toHaveBeenCalled();
    handleKey(press(document.body, { key: 'ArrowDown', repeat: true }));
    expect(down).toHaveBeenCalledTimes(1);
  });

  it('with keys off only the always-on bindings run: ⌘K and the arrows in a list, never a chord', () => {
    const next = vi.fn(); const palette = vi.fn(); const down = vi.fn(); const table = vi.fn();
    on('rows', { 'next-job': next });
    on('global', { 'palette': palette, 'go-table': table });
    on('desk', { 'desk-down': down });
    writeKeysSetting({ enabled: false });
    expect(handleKey(press(document.body, { key: 'j' }))).toBe(false);
    expect(handleKey(press(document.body, { key: 'g' }))).toBe(false);
    expect(handleKey(press(document.body, { key: 't' }))).toBe(false);
    expect(handleKey(press(document.body, { key: 'ArrowDown' }))).toBe(true);
    expect(handleKey(press(document.body, { key: 'k', metaKey: true }))).toBe(true);
    expect([next, table, down, palette].map((f) => f.mock.calls.length)).toEqual([0, 0, 1, 1]);
    writeKeysSetting({ enabled: true });
    expect(handleKey(press(document.body, { key: 'j' }))).toBe(true);
  });

  it('refuses a handler registered under the wrong scope', () => {
    expect(() => registerKeys('rows', { current: { 'desk-next': () => {} } })).toThrow(/desk scope/);
  });

  it('the installed listener answers keydown on the document, and stops when taken off', () => {
    const next = vi.fn();
    on('rows', { 'next-job': next });
    const off = installKeyListener();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
    expect(next).toHaveBeenCalledTimes(1);
    off();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('Enter or Space on a button, link, fold, option or tab belongs to that control; only an always binding runs there', () => {
    const open = vi.fn(); const focus = vi.fn(); const down = vi.fn();
    on('map', { 'map-open': open });
    on('job', { 'screens-focus': focus });
    on('desk', { 'desk-down': down });
    const button = document.body.appendChild(document.createElement('button'));
    const inLink = document.body.appendChild(document.createElement('a')).appendChild(document.createElement('span'));
    const summary = document.body.appendChild(document.createElement('details')).appendChild(document.createElement('summary'));
    const roleButton = document.body.appendChild(document.createElement('div'));
    roleButton.setAttribute('role', 'button');
    const option = document.body.appendChild(document.createElement('div'));
    option.setAttribute('role', 'option');
    const tab = document.body.appendChild(document.createElement('div'));
    tab.setAttribute('role', 'tab');
    for (const t of [button, inLink, summary, roleButton, option, tab]) {
      const enter = press(t, { key: 'Enter' });
      expect(handleKey(enter)).toBe(false);
      expect(enter.defaultPrevented).toBe(false);
      expect(handleKey(press(t, { key: ' ' }))).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    // An always binding (the arrows in a list) still runs with the focus on a button.
    expect(handleKey(press(button, { key: 'ArrowDown' }))).toBe(true);
    expect(down).toHaveBeenCalledTimes(1);
    // Off a control, Enter goes to the highest scope that binds it, as before.
    const plain = document.body.appendChild(document.createElement('div'));
    expect(handleKey(press(plain, { key: 'Enter' }))).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('labels keys for the screen: Mod as Ctrl off a Mac, arrows as arrows, Esc short', () => {
    expect(keyLabel('Mod+K')).toMatch(/^(⌘K|Ctrl\+K)$/);
    expect(keyLabel('ArrowDown')).toBe('↓');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('g h')).toBe('g h');
    expect(keysText('gate-answer')).toBe('1 / 2 / 3');
  });

  it('no page key fires while you type or with a dialog open: every binding in the registry, scope by scope', () => {
    // Everything but ⌘ bindings, the always-on ones (Esc, Enter, the arrows: what any page has) and list-only ones.
    const pageKeys = KEY_IDS.filter((id) => { const d = keyDef(id); return !d.listOnly && !d.always && !d.keys.some((k) => k.startsWith('Mod+')); });
    expect(pageKeys).toEqual(expect.arrayContaining<KeyId>(['inbox-start', 'stage-prev', 'stage-next', 'stage-finished', 'alert-allow', 'alert-deny', 'jobs-open', 'gate-approve', 'desk-approve']));
    for (const id of pageKeys) {
      const run = vi.fn();
      const reg = registerKeys(KEYS[id].scope, { current: { [id]: run } });
      const key = KEYS[id].keys[0];
      const first = key.includes(' ') ? key.split(' ')[0] : key;
      const area = document.body.appendChild(document.createElement('textarea'));
      expect(handleKey(press(area, { key: first })), `${id} while typing`).toBe(false);
      const dialog = document.body.appendChild(document.createElement('div'));
      dialog.setAttribute('aria-modal', 'true');
      expect(handleKey(press(document.body, { key: first })), `${id} with a dialog open`).toBe(false);
      dialog.remove(); area.remove();
      reg.unregister();
      resetChord();
      expect(run, id).not.toHaveBeenCalled();
    }
  });

  it('every scope has a place in the priority order and a title and line for the lists', () => {
    const scopes = new Set(KEY_IDS.map((id) => KEYS[id].scope));
    for (const scope of scopes) {
      expect(SCOPE_PRIORITY).toContain(scope);
      expect(SCOPES[scope as KeyScope].title).toMatch(/\S/);
    }
    expect(new Set(Object.values(SCOPES).map((s) => s.title)).size).toBe(Object.keys(SCOPES).length);
  });
});
