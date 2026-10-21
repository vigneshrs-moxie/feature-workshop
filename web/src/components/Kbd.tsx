// A key hint on a button: <Kbd id="gate-approve" /> shows the binding's key (⌘ on a Mac, Ctrl
// elsewhere) from app/keyRegistry.ts. Hidden when keys or hints are off (Settings → Keys), and
// unless the key works right here: the page's listener is installed and the binding's scope is
// active (so a permission card shows `a` on the Desk, not on the job page). Hidden from screen
// readers too, so a button's name stays its words.
// KeyLegend is the footer line on the Desk and the Table: each key and what it does.
import { KEYS, keysText, useKeyRegistry, type KeyId } from '../app/keyRegistry';
import { useKeysSetting } from '../app/keysSetting';

export function Kbd({ id, className = '' }: { id: KeyId; className?: string }) {
  const [{ enabled, hints }] = useKeysSetting();
  const { installed, active } = useKeyRegistry();
  if (!enabled || !hints || !installed || !active.has(KEYS[id].scope)) return null;
  return <kbd className={`kbd key-hint ${className}`.trim()} aria-hidden="true">{keysText(id)}</kbd>;
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
