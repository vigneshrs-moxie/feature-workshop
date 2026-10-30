// A key hint on a button: <Kbd id="gate-approve" /> shows the binding's key (⌘ on a Mac, Ctrl
// elsewhere) from app/keyRegistry.ts. Hidden when keys or hints are off (Settings → Keys), and
// unless the key works right here: the page's listener is installed and the binding's scope is
// active (so a permission card shows `a` on the Desk, not on the job page). Hidden from screen
// readers too, so a button's name stays its words.
// KeyLegend is the footer line on the Desk and the Table: each key and what it does.
//
// Quiet keys (packet R): a hint is quiet unless it is the main action of a next-step bar (`shown`) or
// Settings → Keys → Show keys on every button is on. A quiet hint is drawn as a small keycap at the
// control's corner on hover or keyboard focus, and on every button at once while ? is held down
// (html[data-keys-held]); the button's tooltip says the key too. The key itself works the same.
import { KEYS, keysText, useKeyRegistry, type KeyId } from '../app/keyRegistry';
import { useKeysSetting } from '../app/keysSetting';

export function Kbd({ id, className = '', shown = false }: { id: KeyId; className?: string; shown?: boolean }) {
  const [{ enabled, hints, everywhere }] = useKeysSetting();
  const { installed, active } = useKeyRegistry();
  if (!enabled || !hints || !installed || !active.has(KEYS[id].scope)) return null;
  watchHeldKeys();
  const quiet = !shown && !everywhere;
  return <kbd className={`kbd key-hint${quiet ? ' is-quiet' : ''} ${className}`.trim()} aria-hidden="true">{keysText(id)}</kbd>;
}

/** A key written out by hand (g i on a link): the same quiet keycap as <Kbd>. */
export function KeyText({ keys, shown = false }: { keys: string; shown?: boolean }) {
  const [{ enabled, hints, everywhere }] = useKeysSetting();
  if (!enabled || !hints) return null;
  watchHeldKeys();
  return <kbd className={`kbd key-hint${!shown && !everywhere ? ' is-quiet' : ''}`} aria-hidden="true">{keys}</kbd>;
}

let watching = false;
/** While ? is held down, every quiet key shows (html[data-keys-held]); letting go hides them again. */
function watchHeldKeys() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const root = () => document.documentElement;
  window.addEventListener('keydown', (e) => { if (e.key === '?') root().setAttribute('data-keys-held', ''); });
  const off = () => root().removeAttribute('data-keys-held');
  window.addEventListener('keyup', (e) => { if (e.key === '?' || e.key === '/' || e.key === 'Shift') off(); });
  window.addEventListener('blur', off);
}

/** "j Next decision · k Previous decision · …" from the registry; nothing while keys are off. */
export function KeyLegend({ ids, className = '' }: { ids: readonly KeyId[]; className?: string }) {
  const [{ enabled }] = useKeysSetting();
  if (!enabled) return null;
  return (
    <p className={`muted key-legend ${className}`.trim()}>
      {ids.map((id, i) => (
        <span key={id} className="key-legend-item">
          {i > 0 && <span aria-hidden="true"> · </span>}
          <kbd className="kbd">{keysText(id)}</kbd> {KEYS[id].label}
        </span>
      ))}
    </p>
  );
}
