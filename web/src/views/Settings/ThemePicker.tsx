// The theme picker in Settings → Look: a compact swatch grid, one radio per theme (theme/theme.ts)
// in two groups, Dark and Light. Each swatch is drawn from its own theme's tokens (data-theme on the
// swatch, theme/swatches.css), the name sits under it, and the chosen one is marked with a ring and
// the word "Chosen". Each theme's description is the card's title (hover) and, for the chosen one,
// the line under the grid. A pick applies as you click and is remembered in this browser. Only looks
// change; every pane, button and key stays where it is.
// A pick is also told to the dashboard's play ledger (POST /api/play/event, for the Explorer
// achievement) unless Play mode is Off; that never gets in the way of the pick itself.
// The hidden themes (CRT Terminal, Gold) are listed only once the play ledger has unlocked them,
// with an "Unlocked" tag.
import { playOf } from '../../play/settings';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { type ColorScheme, type ThemeInfo, useAvailableThemes, useChosenTheme, useTheme } from '../../theme/theme';

const GROUPS: { scheme: ColorScheme; title: string }[] = [
  { scheme: 'dark', title: 'Dark' },
  { scheme: 'light', title: 'Light' },
];

/** A tiny window in the theme's own colours: a top bar, a side pane and a card with two lines and four dots. */
function Swatch({ id }: { id: string }) {
  return (
    <span className="theme-swatch" data-theme={id} aria-hidden="true">
      <span className="swatch-bar" />
      <span className="swatch-side" />
      <span className="swatch-main">
        <span className="swatch-card">
          <i className="swatch-line is-1" />
          <i className="swatch-line is-2" />
          <span className="swatch-dots"><i className="is-accent" /><i className="is-needs" /><i className="is-running" /><i className="is-done" /></span>
        </span>
      </span>
    </span>
  );
}

export function ThemePicker() {
  const [, setTheme] = useTheme();
  // "Chosen" is the theme you picked, not the one on screen: with Follow the system on, a dark
  // system shows Default while Light is the choice (and stays marked).
  const theme = useChosenTheme();
  const themes = useAvailableThemes();
  const chosen = themes.find((t) => t.id === theme) ?? null;
  const { api } = useWorkshop();
  const { meta } = useWorkshopState();
  const playOff = playOf(meta?.settings).mode === 'off';

  function pick(id: string) {
    setTheme(id);
    if (playOff || !meta) return;
    Promise.resolve().then(() => api.post('/api/play/event', { kind: 'theme', id })).catch(() => { /* only the ledger misses it */ });
  }

  const option = (t: ThemeInfo) => {
    const picked = theme === t.id;
    return (
      <label key={t.id} className={`rule-option theme-option${picked ? ' is-picked' : ''}${t.unlock ? ' is-hidden-theme' : ''}`} title={t.description}>
        <input type="radio" name="theme" value={t.id} checked={picked} onChange={() => pick(t.id)} />
        <Swatch id={t.id} />
        <span className="rule-option-body">
          <span className="rule-option-kind">
            {t.label}{' '}
            {picked && <span className="theme-chosen">Chosen</span>}
            {t.id === 'default' && <span className="chip">Default</span>}
            {t.unlock && <span className="chip theme-unlocked" title="A hidden theme you unlocked by playing.">Unlocked</span>}
          </span>
        </span>
      </label>
    );
  };

  return (
    <section className="theme-picker" aria-label="Theme" data-setting="theme">
      <h4 className="look-heading">Theme</h4>
      <fieldset className="rule-options theme-options">
        <legend className="sr-only">How the Workshop looks</legend>
        {GROUPS.map(({ scheme, title }) => {
          const list = themes.filter((t) => t.scheme === scheme);
          if (!list.length) return null;
          return (
            <div key={scheme} className="theme-group" role="group" aria-label={title}>
              <h5 className="theme-group-title">{title}</h5>
              <div className="theme-grid">{list.map(option)}</div>
            </div>
          );
        })}
      </fieldset>
      {chosen && (
        <p className="muted theme-description" data-testid="theme-chosen-line">
          <span className="theme-chosen">Chosen:</span> {chosen.label} — {chosen.description}
        </p>
      )}
    </section>
  );
}
