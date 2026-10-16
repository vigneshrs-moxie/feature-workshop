// The theme picker in Settings: one radio per theme (theme/theme.ts), applied as you click and
// remembered in this browser. Only looks change; every pane, button and key stays where it is.
// A pick is also told to the dashboard's play ledger (POST /api/play/event, for the Explorer
// achievement) unless Play mode is Off; that never gets in the way of the pick itself.
// The hidden themes (CRT Terminal, Gold) are listed only once the play ledger has unlocked them,
// with an "Unlocked" tag.
import { playOf } from '../../play/settings';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { useAvailableThemes, useTheme } from '../../theme/theme';

export function ThemePicker() {
  const [theme, setTheme] = useTheme();
  const themes = useAvailableThemes();
  const { api } = useWorkshop();
  const { meta } = useWorkshopState();
  const playOff = playOf(meta?.settings).mode === 'off';

  function pick(id: string) {
    setTheme(id);
    if (playOff || !meta) return;
    Promise.resolve().then(() => api.post('/api/play/event', { kind: 'theme', id })).catch(() => { /* only the ledger misses it */ });
  }

  return (
    <section className="theme-picker" aria-label="Theme">
      <h3 className="settings-heading">Theme</h3>
      <fieldset className="rule-options theme-options">
        <legend className="sr-only">How the Workshop looks</legend>
        {themes.map((t) => (
          <label key={t.id} className={`rule-option theme-option${theme === t.id ? ' is-picked' : ''}${t.unlock ? ' is-hidden-theme' : ''}`} title={t.description}>
            <input type="radio" name="theme" value={t.id} checked={theme === t.id} onChange={() => pick(t.id)} />
            <span className="rule-option-body">
              <span className="rule-option-kind">
                {t.label}
                {t.id === 'default' && <span className="chip">Default</span>}
                {t.unlock && <span className="chip theme-unlocked" title="A hidden theme you unlocked by playing.">Unlocked</span>}
              </span>
              <span className="muted">{t.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="muted theme-hint">
        A theme changes only how things look; nothing moves and nothing works differently. Your choice is remembered in this browser.
        To try one from a link, add <code className="num">?theme=&lt;name&gt;</code> to the address.
      </p>
    </section>
  );
}
