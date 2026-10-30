// The theme picker in Settings → Look, simple first (packet R): three equal tiles, Light, Default and
// Follow the system (the system's light or dark picks within the chosen theme's pair), then
// "All themes (n)", a More holding every other theme's tile in two groups, Dark and Light. Each
// swatch is drawn from its own theme's tokens (data-theme on the swatch, theme/swatches.css), the
// name sits under it, and the chosen one is marked with a ring and the word "Chosen" (Follow the
// system says "On"). Each theme's description is the card's title (hover) and, for the chosen one,
// the line under the tiles, so the chosen theme is always named even with All themes closed; when it
// is one of those, All themes starts open and names it beside its label. A pick applies as you click,
// is remembered in this browser and says "Saved" beside the heading. Only looks change; every pane,
// button and key stays where it is. The "Default" tag marks the theme a new browser opens in (Light).
// A pick is also told to the dashboard's play ledger (POST /api/play/event, for the Explorer
// achievement) unless Play mode is Off; that never gets in the way of the pick itself.
// The hidden themes (CRT Terminal, Gold) are listed only once the play ledger has unlocked them,
// with an "Unlocked" tag.
import { playOf } from '../../play/settings';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { DEFAULT_THEME, themePair, THEMES, type ColorScheme, type ThemeInfo, useAvailableThemes, useChosenTheme, useTheme, useThemeFollow } from '../../theme/theme';
import { Choice } from '../../components/Choice';
import { Saved, useSaved } from '../../components/Saved';
import { SettingsMore } from './SettingsMore';

const GROUPS: { scheme: ColorScheme; title: string }[] = [
  { scheme: 'dark', title: 'Dark' },
  { scheme: 'light', title: 'Light' },
];

/** The two themes shown first, in this order, then Follow the system. */
const FIRST: readonly string[] = ['light', 'default'];

const labelOf = (id: string) => THEMES.find((t) => t.id === id)?.label ?? id;

/** What Follow the system would switch between for the chosen theme, in one line. */
export function followLine(chosen: string): string {
  const pair = themePair(chosen);
  if (!pair) return `${labelOf(chosen)} has no dark or light twin, so this changes nothing until you choose Default, Light, Glass or Light glass.`;
  return `Switches between ${labelOf(pair.dark)} when your system is dark and ${labelOf(pair.light)} in daylight.`;
}

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

/** Follow the system, as a tile beside Light and Default: half of each, split on the diagonal. */
function FollowTile({ chosen, onSaved }: { chosen: string; onSaved(): void }) {
  const [on, setOn] = useThemeFollow();
  return (
    <label className={`rule-option theme-option theme-follow${on ? ' is-picked' : ''}`} data-setting="follow-system" title={followLine(chosen)}>
      <Choice type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); onSaved(); }} />
      <span className="theme-swatch-pair" aria-hidden="true"><Swatch id="light" /><Swatch id="default" /></span>
      <span className="rule-option-body">
        <span className="rule-option-kind">Follow the system {on && <span className="theme-chosen">On</span>}</span>
      </span>
    </label>
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
  const saved = useSaved();

  function pick(id: string) {
    setTheme(id);
    saved.mark();
    if (playOff || !meta) return;
    Promise.resolve().then(() => api.post('/api/play/event', { kind: 'theme', id })).catch(() => { /* only the ledger misses it */ });
  }

  const option = (t: ThemeInfo) => {
    const picked = theme === t.id;
    return (
      <label key={t.id} className={`rule-option theme-option${picked ? ' is-picked' : ''}${t.unlock ? ' is-hidden-theme' : ''}`} title={t.description}>
        {/* A click on the chosen one fires no change; it still puts it on (it may be off screen under Follow the system). */}
        <Choice type="radio" name="theme" value={t.id} checked={picked} onChange={() => pick(t.id)} onClick={() => { if (picked) setTheme(t.id); }} />
        <Swatch id={t.id} />
        <span className="rule-option-body">
          <span className="rule-option-kind">
            {t.label}{' '}
            {picked && <span className="theme-chosen">Chosen</span>}
            {t.id === DEFAULT_THEME && <>{' '}<span className="chip">Default</span></>}
            {t.unlock && <span className="chip theme-unlocked" title="A hidden theme you unlocked by playing.">Unlocked</span>}
          </span>
        </span>
      </label>
    );
  };

  const first = FIRST.map((id) => themes.find((t) => t.id === id)).filter((t): t is ThemeInfo => Boolean(t));
  const rest = themes.filter((t) => !FIRST.includes(t.id));
  const inRest = chosen !== null && rest.some((t) => t.id === chosen.id);
  const chosenId = chosen?.id ?? DEFAULT_THEME;

  return (
    <section className="theme-picker" aria-label="Theme" data-setting="theme">
      <div className="setting-head"><h4 className="look-heading">Theme</h4><Saved tick={saved.tick()} /></div>
      <fieldset className="rule-options theme-options">
        <legend className="sr-only">How the Workshop looks</legend>
        <div className="theme-first">
          {first.map(option)}
          <FollowTile chosen={chosenId} onSaved={() => saved.mark()} />
        </div>
        <div className="theme-lines">
          {chosen && (
            <p className="muted theme-description" data-testid="theme-chosen-line">
              <span className="theme-chosen">Chosen:</span> {chosen.label} — {chosen.description}
            </p>
          )}
          <p className="muted theme-description">Follow the system: {followLine(chosenId)}</p>
        </div>
        {rest.length > 0 && (
          <SettingsMore id="look-themes" label={`All themes (${rest.length})`} holds={[]} simpleOpen={inRest} note={inRest ? `${chosen!.label} is chosen` : undefined} className="theme-more">
            {GROUPS.map(({ scheme, title }) => {
              const list = rest.filter((t) => t.scheme === scheme);
              if (!list.length) return null;
              return (
                <div key={scheme} className="theme-group" role="group" aria-label={title}>
                  <h5 className="theme-group-title">{title}</h5>
                  <div className="theme-grid">{list.map(option)}</div>
                </div>
              );
            })}
          </SettingsMore>
        )}
      </fieldset>
    </section>
  );
}
