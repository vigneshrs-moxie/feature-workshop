// Settings → Keys: whether the page's keyboard shortcuts work, and whether buttons show their key.
// Remembered in this browser (fw.keys, app/keysSetting.ts): it is about this keyboard.
import { useKeysSetting } from '../../app/keysSetting';
import { keyLabel } from '../../app/keyRegistry';

const CHOICES: { on: boolean; label: string; note: string; hint: string }[] = [
  { on: true, label: 'On', note: 'j and k, c, ?, the Desk and gate keys, and g then a letter to go to a page.', hint: 'The keys work outside text boxes. Press ? for the list.' },
  { on: false, label: 'Off', note: 'Only what any web page has.', hint: 'Single-letter keys do nothing. Esc, Enter, the arrows in a list or menu, ⌘K and ⌘Enter still work.' },
];

export function KeysSettings() {
  const [{ enabled, hints }, set] = useKeysSetting();
  return (
    <section className="keys-settings" aria-label="Keys">
      <h3 className="settings-heading">Keyboard shortcuts</h3>
      <fieldset className="rule-options">
        <legend className="sr-only">Keyboard shortcuts</legend>
        {CHOICES.map((c) => (
          <label key={c.label} className={`rule-option${enabled === c.on ? ' is-picked' : ''}`} title={c.hint}>
            <input type="radio" name="keys-enabled" value={c.on ? 'on' : 'off'} checked={enabled === c.on} onChange={() => set({ enabled: c.on })} />
            <span className="rule-option-body">
              <span className="rule-option-kind">{c.label}{c.on && <span className="chip">Default</span>}</span>
              <span className="muted">{c.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className={`check${enabled ? '' : ' is-off'}`} title={enabled ? 'A small key beside each button that has one.' : 'Hints show only while the shortcuts are on.'}>
        <input type="checkbox" checked={hints && enabled} disabled={!enabled} onChange={(e) => set({ hints: e.currentTarget.checked })} />
        <span>Show key hints on buttons</span>
      </label>
      <p className="muted settings-note">Off keeps only what any web page has: Esc, Enter, the arrows inside a list or menu, {keyLabel('Mod+K')} and {keyLabel('Mod+Enter')}. Remembered in this browser.</p>
    </section>
  );
}
