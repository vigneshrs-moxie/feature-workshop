// The list of keys (?), generated from app/keyRegistry.ts: every binding grouped by where it
// works, the groups not on this page marked, and a note when keys are off (Settings → Keys).
import { KEY_IDS, KEYS, keyDef, keyLabel, SCOPES, useKeyRegistry, type KeyId, type KeyScope } from '../../app/keyRegistry';
import { useKeysSetting } from '../../app/keysSetting';
import { Sheet } from '../../components/Sheet';

/** The groups in the order they read best: everywhere first, then the places. Every scope is here. */
export const GROUP_ORDER: readonly KeyScope[] = ['global', 'rows', 'inbox', 'desk', 'jobs', 'job', 'stage', 'alert', 'review', 'gate', 'map', 'table', 'settings', 'sheet'];

export function KeysSheet({ onClose }: { onClose: () => void }) {
  const [{ enabled }] = useKeysSetting();
  return (
    <Sheet title="Keyboard shortcuts" onClose={onClose} className="keys-sheet">
      {!enabled && (
        <p className="perm-warn keys-off" role="note">
          Keyboard shortcuts are off (Settings → Keys). Only Esc, Enter, the arrows inside a list or menu, {keyLabel('Mod+K')} and {keyLabel('Mod+Enter')} work.
        </p>
      )}
      <KeyGroups />
      <p className="muted sheet-fine">Single-letter keys don’t work while you’re typing in a box: click outside it, or press Esc in a menu first. Turn them off, or hide the hints on buttons, in Settings → Keys.</p>
      <div className="sheet-actions">
        <button type="button" className="btn" onClick={onClose} title="Close this list (Esc).">Close</button>
      </div>
    </Sheet>
  );
}

/** Every key in the registry, grouped by where it works; groups not on this page are marked. Also in Settings → Keys. */
export function KeyGroups() {
  const { active } = useKeyRegistry();
  const groups = GROUP_ORDER.map((scope) => ({ scope, ids: KEY_IDS.filter((id) => KEYS[id].scope === scope) })).filter((g) => g.ids.length);
  return (
    <>
      {groups.map(({ scope, ids }) => (
        <section key={scope} className="key-group" aria-label={SCOPES[scope].title}>
          <h4 className="key-group-title">
            {SCOPES[scope].title}
            {!active.has(scope) && scope !== 'sheet' && <> <span className="muted">(not on this page)</span></>}
          </h4>
          <p className="muted key-group-where">Where it works: {SCOPES[scope].where}</p>
          <dl className="key-list">
            {ids.map((id) => <KeyRow key={id} id={id} />)}
          </dl>
        </section>
      ))}
    </>
  );
}

function KeyRow({ id }: { id: KeyId }) {
  const def = keyDef(id);
  return (
    <div className="key-row">
      <dt>{def.keys.map((k, i) => <span key={k}>{i > 0 && <span className="muted"> / </span>}<kbd className="kbd">{keyLabel(k)}</kbd></span>)}</dt>
      <dd>
        {def.label}
        {def.where && <span className="muted key-where">{def.where}</span>}
      </dd>
    </div>
  );
}
