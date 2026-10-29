// Settings → Look: how the Workshop looks, all browser-local. The theme (ThemePicker: a swatch grid in
// Dark and Light groups), the text size (S M L XL, theme/textSize.ts: one factor on every type token
// and the row heights, with a live sample line) and Follow the system (theme/theme.ts: the system's
// colour scheme picks within the chosen theme's dark/light pair, Default ↔ Light or Glass ↔ Light
// glass; a theme with no twin stays as it is). Packet M adds the two layouts, Desk layout (One at a
// time or Three columns) and Jobs layout (Four lanes or One list), and Play beside them. Packet K2
// adds Stack picture (the merge map, or four big steps with a bar per part).
import { useState } from 'react';
import '../../theme/look.css';
import type { PlayMode, Settings } from '../../api/types';
import { hrefFor, settingsHref } from '../../app/router';
import { useDeskLayout } from '../../home/DeskPage';
import { useJobsLayout } from '../../home/JobsPage';
import { useStackPicture } from '../Stack/StackPicture';
import { playOf } from '../../play/settings';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { PLAY_MODE_CHOICES } from './PlaySettings';
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

/** A layout choice: two options, each with a small picture and one line on what it does, and a way to see it. */
function LayoutPicker<T extends string>({ id, title, value, onPick, options, see }: {
  id: string; title: string; value: T; onPick(v: T): void;
  options: readonly { id: T; label: string; say: string; pic: 'one' | 'columns' | 'lanes' | 'list' }[];
  see: { label: string; href: string };
}) {
  return (
    <fieldset className="layout-picker" data-setting={id}>
      <legend className="look-heading">{title}</legend>
      <div className="layout-options">
        {options.map((o, n) => (
          <label key={o.id} className={`layout-option${value === o.id ? ' is-picked' : ''}`}>
            <input type="radio" name={id} value={o.id} checked={value === o.id} onChange={() => onPick(o.id)} />
            <span className={`layout-pic pic-${o.pic}`} aria-hidden="true"><i /><i /><i /><i /></span>
            <span className="layout-body">
              <span className="layout-name">{o.label}{n === 0 && <span className="chip">Default</span>}</span>
              <span className="muted">{o.say}</span>
            </span>
          </label>
        ))}
      </div>
      <a className="btn btn-quiet layout-see" href={see.href}>{see.label} ▸</a>
    </fieldset>
  );
}

/** Play beside the layouts: Full, Subtle or Off (the same setting as Settings → Play). */
function PlayPicker() {
  const { api, store } = useWorkshop();
  const { meta } = useWorkshopState();
  const mode = playOf(meta?.settings).mode;
  const [error, setError] = useState<string | null>(null);
  async function pick(m: PlayMode) {
    setError(null);
    try { store.dispatch({ type: 'settings', settings: await api.post<Settings>('/api/settings', { play: { mode: m } }) }); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  return (
    <fieldset className="text-size" data-setting="look-play">
      <legend className="look-heading">Play</legend>
      <div className="text-size-options">
        {PLAY_MODE_CHOICES.map((m) => (
          <button key={m.id} type="button" className={`btn text-size-btn${mode === m.id ? ' is-on' : ''}`} aria-pressed={mode === m.id} title={m.hint} onClick={() => void pick(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="muted">Full dresses the Desk as a go / no go console and the job cards as consoles; Subtle keeps the words; Off is plain. The keys never change. <a href={settingsHref('play')}>More in Play</a>.</p>
      {error && <p className="field-problem" role="alert">{error}</p>}
    </fieldset>
  );
}

export function LookSettings() {
  const [desk, setDesk] = useDeskLayout();
  const [jobs, setJobs] = useJobsLayout();
  const [stackPicture, setStackPicture] = useStackPicture();
  return (
    <section className="look-settings" aria-label="Look">
      <h3 className="settings-heading">Look</h3>
      <ThemePicker />
      <TextSizePicker />
      <FollowSystem />
      <LayoutPicker
        id="desk-layout" title="Desk layout" value={desk} onPick={setDesk}
        options={[
          { id: 'one', label: 'One at a time', say: 'One decision fills the Desk; the whole queue opens in a drawer.', pic: 'one' },
          { id: 'columns', label: 'Three columns', say: 'The queue, the item and Decided today side by side, as the Desk was.', pic: 'columns' },
        ]}
        see={{ label: 'See it on the Desk', href: hrefFor({ name: 'desk' }) }}
      />
      <LayoutPicker
        id="jobs-layout" title="Jobs layout" value={jobs} onPick={setJobs}
        options={[
          { id: 'lanes', label: 'Four lanes', say: 'Working, Needs you, In review and Ready to merge, side by side.', pic: 'lanes' },
          { id: 'list', label: 'One list', say: 'Every job in one list, its lane in words.', pic: 'list' },
        ]}
        see={{ label: 'See it in Jobs', href: hrefFor({ name: 'home' }) }}
      />
      <LayoutPicker
        id="stack-picture" title="Stack picture" value={stackPicture} onPick={setStackPicture}
        options={[
          { id: 'map', label: 'Merge map', say: 'One line per part, built side by side, meeting at Merge: you see the parts join in order.', pic: 'list' },
          { id: 'steps', label: 'Four big steps', say: 'Plan, Build, Merge and Push as four boxes, with a bar on each part’s card.', pic: 'lanes' },
        ]}
        see={{ label: 'See it in Stacks', href: hrefFor({ name: 'stacks' }) }}
      />
      <PlayPicker />
      <p className="muted theme-hint">
        Each of these changes only how things look; nothing is lost and the keys stay the same. Play is kept by the dashboard; the rest is remembered in this browser.
        To try a theme from a link, add <code className="num">?theme=&lt;name&gt;</code> to the address.
      </p>
    </section>
  );
}
