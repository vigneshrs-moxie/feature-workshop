// Settings → Play: Play mode (Full, Subtle, Off) and the opt-in sounds (Full only). When a job
// counts as a finished quest is the finish line (Settings → Workflow), not a Play setting. Saved on the dashboard (POST /api/settings { play }), so it is the same
// in every browser on this machine; follows changes made elsewhere (the 'settings' event). Simple first
// (packet R): the mode shows, Sounds waits in a More; each change says "Saved" beside its control.
import { useState } from 'react';
import type { PlayMode, PlaySettings as Play, Settings } from '../../api/types';
import { HowThisWorks } from '../../components/HowThisWorks';
import { playOf } from '../../play/settings';
import { useWorkshop, useWorkshopState } from '../../state/store';
import { Choice } from '../../components/Choice';
import { Saved, useSaved } from '../../components/Saved';
import { SectionHead, SettingsMore } from './SettingsMore';

export const PLAY_MODE_CHOICES: { id: PlayMode; label: string; note: string; hint: string }[] = [
  { id: 'full', label: 'Full', note: 'The crew moves, plus difficulty stars, boss fights, stamina and short celebrations.', hint: 'Everything in Subtle, animated, with the game extras. Sounds can be turned on below.' },
  { id: 'subtle', label: 'Subtle', note: 'The crew stand still beside the work: on each job’s trail, in the job list and the conversation; achievements and the Crew-dex are on.', hint: 'Quiet: still characters, achievements, the Crew-dex and the easter eggs.' },
  { id: 'off', label: 'Off', note: 'No crew, achievements or secrets: the Workshop exactly as it was.', hint: 'Turns the whole Play layer off. Nothing else changes.' },
];

export function PlaySettings() {
  const { api, store } = useWorkshop();
  const { meta } = useWorkshopState();
  const play = playOf(meta?.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = useSaved();

  async function save(patch: Partial<Play>, what: string) {
    setBusy(true);
    setError(null);
    try {
      store.dispatch({ type: 'settings', settings: await api.post<Settings>('/api/settings', { play: patch }) });
      saved.mark(what);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const soundsOff = play.mode !== 'full';
  return (
    <section className="play-settings" aria-label="Play">
      <SectionHead saved={<Saved tick={saved.tick('mode')} />}>Play</SectionHead>
      <HowThisWorks id="play">
        <p><strong>Play</strong> adds the workshop crew, achievements, a Crew-dex and a few secrets on top of the work. It is personal: everything is worked out on this computer from what the dashboard already records, it never asks Claude anything and costs no usage.</p>
        <p><strong>Subtle</strong> (the default) shows the crew still. <strong>Full</strong> animates them and adds difficulty stars, boss fights for large reviews, stamina for your usage limit and short celebrations. <strong>Off</strong> turns all of it off.</p>
        <p>Achievements reward finished work, never clicks: approving something earns nothing. A job counts as a finished quest once, when it crosses the finish line you set under Workflow (or you mark it done); reopening it and finishing again doesn’t count twice. Nothing play-related ever stands between you and a card or the message box.</p>
      </HowThisWorks>
      <fieldset className="rule-options play-options" disabled={busy} data-setting="play-mode">
        <legend className="sr-only">Play mode</legend>
        {PLAY_MODE_CHOICES.map((m) => (
          <label key={m.id} className={`rule-option${play.mode === m.id ? ' is-picked' : ''}`} title={m.hint}>
            <Choice type="radio" name="play-mode" value={m.id} checked={play.mode === m.id} onChange={() => void save({ mode: m.id }, 'mode')} />
            <span className="rule-option-body">
              <span className="rule-option-kind">{m.label}{m.id === 'subtle' && <span className="chip">Default</span>}</span>
              <span className="muted">{m.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <SettingsMore id="play-more" label="More: sounds" holds={['play-sounds']}>
        <div className="setting-row" data-setting="play-sounds">
          <label
            className={`check play-sounds${soundsOff ? ' is-off' : ''}`}
            title={soundsOff ? 'Sounds play only in Full mode. Pick Full above to turn them on.' : 'Short chiptune blips for unlocks and finished quests. Off unless you turn them on.'}
          >
            <Choice type="checkbox" checked={play.sounds && !soundsOff} disabled={busy || soundsOff} onChange={(e) => void save({ sounds: e.currentTarget.checked }, 'sounds')} />
            <span>Sounds (chiptune blips) <span className="muted">{soundsOff ? '· Full mode only' : '· off unless you turn them on'}</span></span>
          </label>
          <Saved tick={saved.tick('sounds')} />
        </div>
      </SettingsMore>
      {error && <p className="field-problem" role="alert">{error}</p>}
    </section>
  );
}
