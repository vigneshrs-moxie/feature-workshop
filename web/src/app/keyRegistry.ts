// Every key the page has, declared once (KEYS), and the one listener that runs them.
//
// A view registers the keys it answers for with useKeyScope(scope, handlers, active) while it is
// mounted; App installs the single document listener (useKeyListener). A key goes to the
// highest-priority active scope that binds it (desk > alert > gate > stage > job > jobs > inbox >
// map > rows > table > settings > sheet > global), so the Desk's j and k win over the page's, and
// the Map's over the Jobs list's. Rules, the same everywhere:
//   - single-letter keys never fire while you type in a field, or while a dialog is open;
//   - Enter and Space with the focus on a button, link, fold, option or tab belong to that control;
//     only an `always` binding of them runs there;
//   - ⌘, Ctrl and Alt belong to the browser, except bindings declared with Mod (⌘K, ⌘Enter);
//   - a held key never repeats (except where the binding says so: the Table's arrows);
//   - `g` then a letter within 1.5 s is a chord (g h home, g t table…);
//   - with keys turned off (Settings → Keys, keysSetting.ts) only `always` bindings run: what any
//     web page has anyway.
// Kbd (components/Kbd.tsx) shows a binding's key on a button; the ? sheet lists the whole table.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { readKeysSetting } from './keysSetting';

export type KeyScope = 'global' | 'rows' | 'job' | 'stage' | 'alert' | 'gate' | 'desk' | 'jobs' | 'inbox' | 'map' | 'table' | 'settings' | 'sheet';

/** Highest priority first: the scope that gets the key when several bind it. */
export const SCOPE_PRIORITY: readonly KeyScope[] = ['desk', 'alert', 'gate', 'stage', 'job', 'jobs', 'inbox', 'map', 'rows', 'table', 'settings', 'sheet', 'global'];

/** Each scope in the ? sheet: its title and where its keys work, in plain words. */
export const SCOPES: Record<KeyScope, { title: string; where: string }> = {
  global: { title: 'Everywhere', where: 'On every page, outside a text box.' },
  rows: { title: 'Jobs', where: 'On every page but the Desk; the order is the Jobs list’s.' },
  job: { title: 'The open job', where: 'On a job’s page and its stops.' },
  stage: { title: 'A stop of a job', where: 'On a stop’s page (the Stage).' },
  alert: { title: 'The permission alert', where: 'While a permission waits at the top of a job or a stop.' },
  gate: { title: 'The gate card', where: 'While a gate card waits for your decision, on the job or on the Desk.' },
  desk: { title: 'The Desk', where: 'On the Desk, while something waits for you.' },
  jobs: { title: 'The Jobs page', where: 'On Jobs, the four lanes.' },
  inbox: { title: 'The Inbox', where: 'On the Inbox, outside a text box.' },
  map: { title: 'The Flow map', where: 'On the Flow map.' },
  table: { title: 'The Table', where: 'With the focus on a job in the Table.' },
  settings: { title: 'Settings', where: 'On the Settings page.' },
  sheet: { title: 'In ⌘K', where: 'While the command palette is open.' },
};

export interface KeyDef {
  /** The keys, as `KeyboardEvent.key`: 'j', '?', 'ArrowDown', 'Escape'; 'Mod+K' for ⌘K / Ctrl+K; 'g h' for a chord. */
  keys: readonly string[];
  label: string;
  scope: KeyScope;
  /** Only when it differs from the scope's own line. */
  where?: string;
  /** Runs with keys turned off too: what any web page has (⌘K, ⌘Enter, Esc, Enter, arrows in a list). */
  always?: boolean;
  /** Listed in the ? sheet, run by the component itself (Esc in a sheet, ⌘Enter in the message box). */
  listOnly?: boolean;
  /** A held key repeats (the arrows in the Table). */
  repeats?: boolean;
}

export const KEYS = {
  // Everywhere
  'palette': { keys: ['Mod+K'], label: 'Search every action you can take right now', scope: 'global', where: 'Everywhere, even while typing or with a sheet open.', always: true },
  'keys': { keys: ['?'], label: 'Show this list', scope: 'global' },
  'new-job': { keys: ['c'], label: 'Start a new job', scope: 'global' },
  'go-home': { keys: ['g j', 'g h'], label: 'Go to Jobs', scope: 'global' },
  'go-inbox': { keys: ['g i'], label: 'Go to the Inbox', scope: 'global' },
  'go-map': { keys: ['g m'], label: 'Go to the flow map', scope: 'global' },
  'go-table': { keys: ['g t'], label: 'Go to the Table', scope: 'global' },
  'go-desk': { keys: ['g d'], label: 'Go to the Desk', scope: 'global' },
  'go-settings': { keys: ['g s'], label: 'Go to Settings', scope: 'global' },
  'go-crew': { keys: ['g x'], label: 'Go to the Crew-dex (Play mode)', scope: 'global' },
  'close': { keys: ['Escape'], label: 'Close the menu, sheet or drawer on top', scope: 'global', always: true, listOnly: true },
  // Telemetry: registered by the Telemetry page while it is open, so they answer only there (listed
  // with the keys that work everywhere, each with where it works).
  'tele-read': { keys: ['r'], label: 'Telemetry: read the limits now', scope: 'global', where: 'On the Telemetry page only; on the Desk, r is No go.' },
  'tele-step': { keys: ['ArrowLeft', 'ArrowRight'], label: 'Telemetry: step through the weekly line’s readings, or the weekday map’s squares', scope: 'global', where: 'With the focus on the weekly line or the weekday map (Tab to it).', always: true, listOnly: true },
  // Jobs
  'next-job': { keys: ['j'], label: 'Open the next job', scope: 'rows' },
  'prev-job': { keys: ['k'], label: 'Open the previous job', scope: 'rows' },
  // The open job
  'notes': { keys: ['n'], label: 'Open the job’s Notes and options', scope: 'job', where: 'On a job; on a stop, n shows who finished there.' },
  'write': { keys: ['c', 'i'], label: 'Put the cursor in the message box', scope: 'job', where: 'On a job or a stop; elsewhere c is New job.' },
  'screens-focus': { keys: ['Enter'], label: 'Step into the screens (the page’s own keys then work)', scope: 'job', where: 'With the Screens tab showing and nothing else focused.' },
  'screens-leave': { keys: ['Escape'], label: 'Step out of the screens, back to the page', scope: 'job', where: 'Inside the screens.', listOnly: true },
  'send': { keys: ['Mod+Enter'], label: 'In the message box: preview and send, or steer a reply in progress', scope: 'job', always: true, listOnly: true },
  // A stop of a job (the Stage)
  'stage-prev': { keys: ['['], label: 'The stop before this one', scope: 'stage' },
  'stage-next': { keys: [']'], label: 'The stop after this one', scope: 'stage' },
  'stage-finished': { keys: ['n'], label: 'Show or hide who finished here', scope: 'stage', where: 'On a stop; on a job, n is Notes and options.' },
  // The permission alert
  'alert-allow': { keys: ['a'], label: 'Allow once', scope: 'alert', where: 'Never for a hard line or a risky step.' },
  'alert-deny': { keys: ['d'], label: 'Deny (you can say why)', scope: 'alert' },
  // The gate card
  'gate-approve': { keys: ['a'], label: 'Approve', scope: 'gate', where: 'Only when the card asks no questions and the plan hasn’t changed.' },
  'gate-edit': { keys: ['e'], label: 'Edit, then approve', scope: 'gate' },
  'gate-revise': { keys: ['r'], label: 'Revise with feedback', scope: 'gate' },
  'gate-guidance': { keys: ['o'], label: 'Other guidance', scope: 'gate', where: 'On the job only: on the Desk, o opens the job.' },
  'gate-answer': { keys: ['1', '2', '3'], label: 'Pick that answer to the first unanswered question', scope: 'gate' },
  'gate-adjust': { keys: ['.'], label: 'Open or close “Adjust the next step”', scope: 'gate' },
  'gate-decided': { keys: ['v'], label: 'Open or close the decisions made for you', scope: 'gate', where: 'Only when the card has some.' },
  // The Desk
  'jobs-open': { keys: ['o'], label: 'Open the job the next-step bar names', scope: 'jobs', where: 'When a job needs you.' },
  'desk-next': { keys: ['j'], label: 'Next decision', scope: 'desk' },
  'desk-prev': { keys: ['k'], label: 'Previous decision', scope: 'desk' },
  'desk-down': { keys: ['ArrowDown'], label: 'Next decision', scope: 'desk', where: 'Inside the queue.', always: true },
  'desk-up': { keys: ['ArrowUp'], label: 'Previous decision', scope: 'desk', where: 'Inside the queue.', always: true },
  'desk-open': { keys: ['o'], label: 'Open the job', scope: 'desk' },
  'desk-approve': { keys: ['a'], label: 'Approve, or Allow once', scope: 'desk', where: 'Never for a hard line, a risky step or a question.' },
  'desk-deny': { keys: ['d'], label: 'Deny a permission', scope: 'desk', where: 'On a nudge: put it away.' },
  'desk-send-back': { keys: ['r'], label: 'No go: send back', scope: 'desk', where: 'On a go-ahead: say what to change.' },
  'desk-reply': { keys: ['c'], label: 'Reply without deciding', scope: 'desk', where: 'On a go-ahead; elsewhere c is New job.' },
  'desk-brief': { keys: ['b'], label: 'Show or hide the brief', scope: 'desk', where: 'On a go-ahead.' },
  // The Inbox
  'inbox-start': { keys: ['s'], label: 'Start a job on the ticket', scope: 'inbox', where: 'The open ticket, else the row with the focus, else the one the next-step bar names.' },
  // The Map (Home)
  'map-next': { keys: ['j'], label: 'Highlight the next row', scope: 'map' },
  'map-prev': { keys: ['k'], label: 'Highlight the previous row', scope: 'map' },
  'map-open': { keys: ['Enter'], label: 'Open the highlighted job', scope: 'map' },
  'map-pr': { keys: ['o'], label: 'Open its newest PR on GitHub', scope: 'map' },
  'map-filter': { keys: ['/'], label: 'Jump to the filter chips', scope: 'map' },
  'map-chip': { keys: ['1', '2', '3', '4'], label: 'Pick that filter chip: All, Needs you, Shipping, the first repo', scope: 'map' },
  // The Table
  'table-down': { keys: ['ArrowDown'], label: 'The next job', scope: 'table', always: true, repeats: true },
  'table-up': { keys: ['ArrowUp'], label: 'The previous job', scope: 'table', always: true, repeats: true },
  'table-open': { keys: ['Enter'], label: 'Open the job', scope: 'table', always: true, listOnly: true },
  // Settings
  'settings-next': { keys: ['j'], label: 'The next section', scope: 'settings' },
  'settings-prev': { keys: ['k'], label: 'The previous section', scope: 'settings' },
  'settings-find': { keys: ['/'], label: 'Find a setting', scope: 'settings' },
  // In ⌘K
  'sheet-move': { keys: ['ArrowDown', 'ArrowUp'], label: 'Move in the list', scope: 'sheet', always: true, listOnly: true },
  'sheet-run': { keys: ['Enter'], label: 'Run the highlighted action', scope: 'sheet', always: true, listOnly: true },
} as const satisfies Record<string, KeyDef>;

export type KeyId = keyof typeof KEYS;

export const KEY_IDS = Object.keys(KEYS) as KeyId[];

export const keyDef = (id: KeyId): KeyDef => KEYS[id];

// ---------- Guards and labels ----------

/** Typing here: single-letter keys belong to the field, not the page. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type);
  return false;
}

/** A dialog (the send preview, Always allow…, a sheet) or a dropped menu (the gear, ☰) is open: page keys wait. */
export const dialogOpen = () => document.querySelector('[aria-modal="true"], [data-keys-wait]') !== null;

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

const KEY_WORDS: Record<string, string> = { ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', ' ': 'Space' };

/** One key as shown on screen: 'Mod+K' is ⌘K on a Mac and Ctrl+K elsewhere; 'ArrowDown' is ↓; 'g h' stays. */
export function keyLabel(key: string): string {
  if (key.startsWith('Mod+')) return isMac() ? `⌘${key.slice(4)}` : `Ctrl+${key.slice(4)}`;
  return key.split(' ').map((k) => KEY_WORDS[k] ?? k).join(' ');
}

/** "⌘K" on a Mac, "Ctrl+K" elsewhere. */
export const paletteKeyLabel = () => keyLabel('Mod+K');

/** A binding's keys for a line of text: 'j', '↓', '1 / 2 / 3'. */
export const keysText = (id: KeyId) => KEYS[id].keys.map(keyLabel).join(' / ');

// ---------- The registry ----------

/** What a key does: nothing returned (or true) means handled; false means "not here", and the next scope gets it. */
export type KeyHandler = (e: KeyboardEvent) => void | boolean;
export type KeyHandlers = Partial<Record<KeyId, KeyHandler>>;

interface Registration {
  scope: KeyScope;
  handlers: { current: KeyHandlers };
  active: boolean;
}

const registrations: Registration[] = [];
const listeners = new Set<() => void>();
let version = 0;
let installed = 0;
const notify = () => { version++; for (const l of [...listeners]) l(); };

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Register handlers for a scope. Returns a function to set `active` and one to unregister. */
export function registerKeys(scope: KeyScope, handlers: { current: KeyHandlers }, active = true): { setActive(on: boolean): void; unregister(): void } {
  for (const id of Object.keys(handlers.current) as KeyId[]) {
    if (KEYS[id].scope !== scope) throw new Error(`Key ${id} belongs to the ${KEYS[id].scope} scope, not ${scope}`);
  }
  const reg: Registration = { scope, handlers, active };
  registrations.push(reg);
  notify();
  return {
    setActive(on) { if (reg.active !== on) { reg.active = on; notify(); } },
    unregister() { const i = registrations.indexOf(reg); if (i >= 0) { registrations.splice(i, 1); notify(); } },
  };
}

/** The scopes with an active registration right now. */
export function activeScopes(): Set<KeyScope> {
  return new Set(registrations.filter((r) => r.active).map((r) => r.scope));
}

/** True while the page's key listener is installed (so a key hint promises something that works). */
export const keysInstalled = () => installed > 0;

const CHORD_MS = 1500;
let pending: { key: string; at: number } | null = null;

/** Everything registered, highest priority first, latest registration first within a scope. */
function ordered(): Registration[] {
  const rank = (s: KeyScope) => SCOPE_PRIORITY.indexOf(s);
  return [...registrations].reverse().filter((r) => r.active).sort((a, b) => rank(a.scope) - rank(b.scope));
}

/** What `e.key` counts as here: letters lowercased unless Shift is held (so ? and A stay themselves). */
function tokenOf(e: KeyboardEvent): string {
  if ((e.metaKey || e.ctrlKey) && !e.altKey) return `Mod+${e.key.length === 1 ? e.key.toUpperCase() : e.key}`;
  return e.key.length === 1 && /[a-z]/i.test(e.key) && !e.shiftKey ? e.key.toLowerCase() : e.key;
}

/** A control Enter and Space already work: a button, a link, a fold's summary, an option or a tab. */
const CONTROL = 'button, a, summary, [role="button"], [role="option"], [role="tab"]';
const onControl = (target: EventTarget | null) => target instanceof Element && target.closest(CONTROL) !== null;

/** Runs the first active binding for `token`; true when one took it. */
function runToken(token: string, e: KeyboardEvent, enabled: boolean): boolean {
  // Enter or Space with the focus on a control belongs to that control (Refresh, New job, a
  // fold…): a page binding of either never fires there, unless it is one any web page has (always).
  const taken = (token === 'Enter' || token === ' ') && onControl(e.target);
  for (const reg of ordered()) {
    for (const [id, run] of Object.entries(reg.handlers.current) as [KeyId, KeyHandler | undefined][]) {
      const def = keyDef(id);
      if (!run || def.listOnly || !def.keys.includes(token)) continue;
      if (!enabled && !def.always) continue;
      if (taken && !def.always) continue;
      if (e.repeat && !def.repeats) return true; // a held key: swallowed, never repeated
      if (run(e) === false) continue;
      return true;
    }
  }
  return false;
}

/** Whether some active binding starts a chord with this key (e.g. `g`). */
function startsChord(token: string, enabled: boolean): boolean {
  return ordered().some((reg) => (Object.keys(reg.handlers.current) as KeyId[]).some((id) => {
    const def = keyDef(id);
    return !def.listOnly && (enabled || def.always) && def.keys.some((k) => k.startsWith(`${token} `));
  }));
}

/** The one keydown handler. Exported for tests; App installs it through useKeyListener. */
export function handleKey(e: KeyboardEvent, now = Date.now()): boolean {
  if (e.defaultPrevented || e.isComposing) return false;
  const enabled = readKeysSetting().enabled;
  const token = tokenOf(e);
  if (token.startsWith('Mod+')) {
    // ⌘K and friends: from anywhere, even a text box or a sheet (the handler decides).
    if (e.altKey || e.shiftKey) return false;
    if (runToken(token, e, enabled)) { e.preventDefault(); return true; }
    return false;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) { pending = null; return false; }
  if (isTypingTarget(e.target) || dialogOpen()) { pending = null; return false; }
  if (pending && now - pending.at <= CHORD_MS) {
    const chord = `${pending.key} ${token}`;
    pending = null;
    if (e.repeat) return false;
    runToken(chord, e, enabled); // an unmatched chord does nothing else
    e.preventDefault();
    return true;
  }
  pending = null;
  if (runToken(token, e, enabled)) { e.preventDefault(); return true; }
  if (!e.repeat && startsChord(token, enabled)) { pending = { key: token, at: now }; e.preventDefault(); return true; }
  return false;
}

/** Forget a chord started earlier (tests). */
export const resetChord = () => { pending = null; };

/** Puts the one listener on the document. Returns the function that takes it off. */
export function installKeyListener(): () => void {
  const onKey = (e: KeyboardEvent) => { handleKey(e); };
  document.addEventListener('keydown', onKey);
  installed++;
  notify();
  return () => { document.removeEventListener('keydown', onKey); installed--; notify(); };
}

// ---------- Hooks ----------

/** App: the one key listener, for as long as the shell is mounted. */
export function useKeyListener() {
  useEffect(() => installKeyListener(), []);
}

/**
 * Answer for a scope's keys while this view is mounted. The latest handlers are always the ones
 * run; `active` false parks the scope (its keys fall through to the next one).
 */
export function useKeyScope(scope: KeyScope, handlers: KeyHandlers, active = true) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const wanted = useRef(active);
  wanted.current = active;
  const reg = useRef<ReturnType<typeof registerKeys> | null>(null);
  useEffect(() => {
    reg.current = registerKeys(scope, latest, wanted.current);
    return () => { reg.current?.unregister(); reg.current = null; };
  }, [scope]);
  useEffect(() => { reg.current?.setActive(active); }, [active]);
}

const snapshot = () => version;

/** Re-renders when scopes come and go or the listener is installed (the ? sheet, Kbd). */
export function useKeyRegistry(): { installed: boolean; active: Set<KeyScope> } {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return { installed: keysInstalled(), active: activeScopes() };
}
