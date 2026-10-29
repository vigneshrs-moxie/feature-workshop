// Settings → Look: how the Workshop looks, all browser-local. The theme (ThemePicker: a swatch grid in
// Dark and Light groups), the text size (S M L XL, theme/textSize.ts: one factor on every type token
// and the row heights, with a live sample line) and Follow the system (theme/theme.ts: the system's
// colour scheme picks within the chosen theme's dark/light pair, Default ↔ Light or Glass ↔ Light
// glass; a theme with no twin stays as it is). Nothing here changes what is on screen or where.
import '../../theme/look.css';
import { readStored, useStored } from '../../lib/stored';
import { DEFAULT_THEME, THEME_KEY, THEMES, themePair, useThemeFollow } from '../../theme/theme';
import { TEXT_SCALES, TEXT_SIZE_LABELS, TEXT_SIZES, type TextSize, useTextSize } from '../../theme/textSize';
import { ThemePicker } from './ThemePicker';

const SIZE_NAMES: Record<TextSize, string> = { s: 'Small', m: 'Medium', l: 'Large', xl: 'Extra large' };
const labelOf = (id: string) => THEMES.find((t) => t.id === id)?.label ?? id;

export function TextSizePicker() {
  const [size, setSize] = useTextSize();
  const base = Math.round(13 * TEXT_SCALES[size] * 10) / 10;
  return (
    <fieldset className="text-size" data-setting="text-size">
      <legend className="look-heading">Text size</legend>
      <div className="text-size-options">
        {TEXT_SIZES.map((id) => (
          <button
            key={id}
            type="button"
            className={`btn text-size-btn${size === id ? ' is-on' : ''}`}
            aria-pressed={size === id}
            title={`${SIZE_NAMES[id]}: ${Math.round(TEXT_SCALES[id] * 100)}% of the usual size.`}
            onClick={() => setSize(id)}
          >
            {TEXT_SIZE_LABELS[id]}
          </button>
        ))}
      </div>
      <p className="text-sample" data-size={size}>
        The quick brown fox jumps over the lazy dog.
        <span className="muted">{SIZE_NAMES[size]}: body text {base} px. Panes keep their width; only type and row heights change.</span>
      </p>
    </fieldset>
  );
}

/** What Follow the system would switch between for the chosen theme, in one line. */
export function followLine(chosen: string): string {
  const pair = themePair(chosen);
  if (!pair) return `${labelOf(chosen)} has no dark or light twin, so this changes nothing until you choose Default, Light, Glass or Light glass.`;
  return `Switches between ${labelOf(pair.dark)} when your system is dark and ${labelOf(pair.light)} in daylight.`;
}

export function FollowSystem() {
  const [on, setOn] = useThemeFollow();
  const [stored] = useStored(THEME_KEY);
  const chosen = stored ?? readStored(THEME_KEY) ?? DEFAULT_THEME;
  return (
    <label className="rule-option follow-system" data-setting="follow-system">
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
      <span className="rule-option-body">
        <span className="rule-option-kind">Follow the system</span>
        <span className="muted">{followLine(THEMES.some((t) => t.id === chosen) ? chosen : DEFAULT_THEME)}</span>
      </span>
    </label>
  );
}

export function LookSettings() {
  return (
    <section className="look-settings" aria-label="Look">
      <h3 className="settings-heading">Look</h3>
      <ThemePicker />
      <TextSizePicker />
      <FollowSystem />
      <p className="muted theme-hint">
        Each of these changes only how things look; nothing moves and nothing works differently. Your choices are remembered in this browser.
        To try a theme from a link, add <code className="num">?theme=&lt;name&gt;</code> to the address.
      </p>
    </section>
  );
}
