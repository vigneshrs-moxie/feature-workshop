// Settings → Keys: whether the page's keyboard shortcuts work, and whether buttons show their key.
// Remembered in this browser (fw.keys, app/keysSetting.ts): it is about this keyboard. Under them,
// every key the app has, from app/keyRegistry.ts (the same list as the ? sheet).
import { useKeysSetting } from '../../app/keysSetting';
import { keyLabel } from '../../app/keyRegistry';
import { KeyGroups } from '../JobSheets/KeysSheet';
import { Choice } from '../../components/Choice';

const CHOICES: { on: boolean; label: string; note: string; hint: string }[] = [
  { on: true, label: 'On', note: 'j and k, c, s on the Inbox, ?, the Desk, gate and stop keys, and g then a letter to go to a page.', hint: 'The keys work outside text boxes. Press ? for the list.' },
  { on: false, label: 'Off', note: 'Only what any web page has.', hint: 'Single-letter keys do nothing. Esc, Enter, the arrows in a list or menu, ⌘K and ⌘Enter still work.' },
];

export function KeysSettings() {
  const [{ enabled, hints, everywhere }, set] = useKeysSetting();
  return (
    <section className="keys-settings" aria-label="Keys">
      <h3 className="settings-heading">Keyboard shortcuts</h3>
      <fieldset className="rule-options" data-setting="keys-enabled">
        <legend className="sr-only">Keyboard shortcuts</legend>
        {CHOICES.map((c) => (
          <label key={c.label} className={`rule-option${enabled === c.on ? ' is-picked' : ''}`} title={c.hint}>
            <Choice type="radio" name="keys-enabled" value={c.on ? 'on' : 'off'} checked={enabled === c.on} onChange={() => set({ enabled: c.on })} />
            <span className="rule-option-body">
              <span className="rule-option-kind">{c.label}{c.on && <span className="chip">Default</span>}</span>
              <span className="muted">{c.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className={`check${enabled ? '' : ' is-off'}`} title={enabled ? 'A small key beside each button that has one.' : 'Hints show only while the shortcuts are on.'} data-setting="keys-hints">
        <Choice type="checkbox" checked={hints && enabled} disabled={!enabled} onChange={(e) => set({ hints: e.currentTarget.checked })} />
        <span>Show key hints on buttons</span>
      </label>
      <label className={`check${enabled && hints ? '' : ' is-off'}`} title={enabled && hints ? 'Off: only the main action of a next step shows its key; the others show it when you point at them or Tab to them, and all of them while you hold ?.' : 'Shows only while the shortcuts and their hints are on.'} data-setting="keys-everywhere">
        <Choice type="checkbox" checked={everywhere && hints && enabled} disabled={!enabled || !hints} onChange={(e) => set({ everywhere: e.currentTarget.checked })} />
        <span>Show keys on every button</span>
      </label>
      <p className="muted settings-note">Off keeps only what any web page has: Esc, Enter, the arrows inside a list or menu, {keyLabel('Mod+K')} and {keyLabel('Mod+Enter')}. Remembered in this browser.</p>
      <section className="keys-all" aria-label="Every key">
        <h3 className="settings-heading">Every key</h3>
        <p className="muted settings-note">Single-letter keys never work while you type in a box or while a sheet or menu is open.</p>
        <KeyGroups />
      </section>
    </section>
  );
}
