// Settings → Look: how the Workshop looks, all browser-local but Play. Simple first (packet R): the
// theme (ThemePicker: Light, Default and Follow the system, then All themes) and Detail, then one
// More: the text size (S M L XL, theme/textSize.ts: one factor on every type token and the row
// heights, with a live sample line), the two layouts from packet M, Desk layout (One at a time or
// Three columns) and Jobs layout (Four lanes or One list), and Play. Each change applies at once
// and says "Saved" beside its control (components/Saved.tsx).
import { useState } from 'react';
import '../../theme/look.css';
import type { PlayMode, Settings } from '../../api/types';
import { hrefFor, settingsHref } from '../../app/router';
import { useDeskLayout } from '../../home/DeskPage';
import { useJobsLayout } from '../../home/JobsPage';
import { playOf } from '../../play/settings';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { PLAY_MODE_CHOICES } from './PlaySettings';
import { TEXT_SCALES, TEXT_SIZE_LABELS, TEXT_SIZES, type TextSize, useTextSize } from '../../theme/textSize';
import { ThemePicker } from './ThemePicker';
import { Choice, Segmented } from '../../components/Choice';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import { Saved, useSaved } from '../../components/Saved';
import { DETAIL_INFO, useDetail, type Detail } from '../../app/detail';
import { SettingGroup, SettingsMore } from './SettingsMore';

export { followLine } from './ThemePicker';

const SIZE_NAMES: Record<TextSize, string> = { s: 'Small', m: 'Medium', l: 'Large', xl: 'Extra large' };

export function TextSizePicker() {
  const [size, setSize] = useTextSize();
  const saved = useSaved();
  const base = Math.round(14 * TEXT_SCALES[size] * 10) / 10; // body text is 14 px at Medium (packet R)
  return (
    <fieldset className="text-size" data-setting="text-size">
      <legend className="look-heading">Text size</legend>
      <div className="setting-row">
        <Segmented<TextSize>
          label="Text size"
          value={size}
          onChange={(id) => { if (id !== size) { setSize(id); saved.mark(); } }}
          options={TEXT_SIZES.map((id) => ({ value: id, label: TEXT_SIZE_LABELS[id], title: `${SIZE_NAMES[id]}: ${Math.round(TEXT_SCALES[id] * 100)}% of the usual size.` }))}
        />
        <Saved tick={saved.tick()} />
      </div>
      <p className="text-sample" data-size={size}>
        The quick brown fox jumps over the lazy dog.
        <span className="muted">{SIZE_NAMES[size]}: body text {base} px. Panes keep their width; only type and row heights change.</span>
      </p>
    </fieldset>
  );
}

/** A layout choice: two options, each with a small picture and one line on what it does, and a way to see it. */
function LayoutPicker<T extends string>({ id, title, value, onPick, options, see }: {
  id: string; title: string; value: T; onPick(v: T): void;
  options: readonly { id: T; label: string; say: string; pic: 'one' | 'columns' | 'lanes' | 'list' | 'floor' }[];
  see: { label: string; href: string };
}) {
  const saved = useSaved();
  return (
    <SettingGroup className="layout-picker" setting={id} title={title} saved={<Saved tick={saved.tick()} />}>
      <div className="layout-options">
        {options.map((o, n) => (
          <label key={o.id} className={`layout-option${value === o.id ? ' is-picked' : ''}`}>
            <Choice type="radio" name={id} value={o.id} checked={value === o.id} onChange={() => { onPick(o.id); saved.mark(); }} />
            <span className={`layout-pic pic-${o.pic}`} aria-hidden="true"><i /><i /><i /><i /></span>
            <span className="layout-body">
              <span className="layout-name">{o.label}{n === 0 && <span className="chip">Default</span>}</span>
              <span className="muted">{o.say}</span>
            </span>
          </label>
        ))}
      </div>
      <Button kind="quiet" size="sm" className="layout-see" href={see.href}>{see.label}<Icon name="chevron-right" size={14} /></Button>
    </SettingGroup>
  );
}

/** Play beside the layouts: Full, Subtle or Off (the same setting as Settings → Play). */
function PlayPicker() {
  const { api, store } = useWorkshop();
  const { meta } = useWorkshopState();
  const mode = playOf(meta?.settings).mode;
  const [error, setError] = useState<string | null>(null);
  const saved = useSaved();
  async function pick(m: PlayMode) {
    if (m === mode) return;
    setError(null);
    try {
      store.dispatch({ type: 'settings', settings: await api.post<Settings>('/api/settings', { play: { mode: m } }) });
      saved.mark();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  return (
    <fieldset className="text-size" data-setting="look-play">
      <legend className="look-heading">Play</legend>
      <div className="setting-row">
        <Segmented<PlayMode> label="Play" value={mode} onChange={(m) => void pick(m)} options={PLAY_MODE_CHOICES.map((m) => ({ value: m.id, label: m.label, title: m.hint }))} />
        <Saved tick={saved.tick()} />
      </div>
      <p className="muted">Full dresses the Desk as a go / no go console and the job cards as consoles; Subtle keeps the words; Off is plain. The keys never change. <a href={settingsHref('play')}>More in Play</a>.</p>
      {error && <p className="field-problem" role="alert">{error}</p>}
    </fieldset>
  );
}

/** Detail (packet R): Simple shows each screen's three things first, the rest one click away; Full shows it all. */
function DetailPicker() {
  const [detail, setDetail] = useDetail();
  const saved = useSaved();
  return (
    <fieldset className="look-detail" data-setting="look-detail">
      <legend className="look-heading">Detail</legend>
      <div className="setting-row">
        <Segmented<Detail>
          label="Detail"
          value={detail}
          onChange={(d) => { if (d !== detail) { setDetail(d); saved.mark(); } }}
          options={(['simple', 'full'] as const).map((d) => ({ value: d, label: DETAIL_INFO[d].label, title: DETAIL_INFO[d].say }))}
        />
        <Saved tick={saved.tick()} />
      </div>
      <p className="muted">{DETAIL_INFO[detail].say}{detail === 'simple' ? ' Whatever you open stays open on that screen.' : ''}</p>
    </fieldset>
  );
}

export function LookSettings() {
  const [desk, setDesk] = useDeskLayout();
  const [jobs, setJobs] = useJobsLayout();
  return (
    <section className="look-settings" aria-label="Look">
      <h3 className="settings-heading">Look</h3>
      <ThemePicker />
      <DetailPicker />
      <SettingsMore id="look-more" label="More: text size, layouts, play" holds={['text-size', 'desk-layout', 'jobs-layout', 'look-play']} className="look-more">
        <TextSizePicker />
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
            { id: 'floor', label: 'Floor', say: 'Play full only: the workshop floor in 3D, a bench per job with its builders at work. In Play subtle or off, Jobs shows the lanes.', pic: 'floor' },
          ]}
          see={{ label: 'See it in Jobs', href: hrefFor({ name: 'home' }) }}
        />
        <PlayPicker />
      </SettingsMore>
      <p className="muted theme-hint">
        Each of these changes only how things look; nothing is lost and the keys stay the same. Play is kept by the dashboard; the rest is remembered in this browser.
        To try a theme from a link, add <code className="num">?theme=&lt;name&gt;</code> to the address.
      </p>
    </section>
  );
}
