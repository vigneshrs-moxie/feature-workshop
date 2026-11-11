// Auto start (Settings → Workflow on the laptop, Settings → Orbit on the site): a switch and the Orbit
// tag. Tickets assigned to you with that tag start by themselves with Auto on, up to 5 at a time. This
// only writes the setting; the laptop's own starter (dashboard/lib/auto-start.js) does the starting.
import { useEffect, useId, useRef, useState } from 'react';
import type { AutoStartSetting } from '../../api/types';
import { Choice } from '../../components/Choice';
import { TextInput } from '../../components/Field';
import { SettingGroup } from './SettingsMore';
import { Saved, useSaved } from '../../components/Saved';

export const AUTO_START_TAG_MAX = 60;
export const AUTO_START_WORDS = {
  title: 'Auto start',
  switch: 'Start a job by itself for tickets with this tag',
  box: 'Orbit tag',
  placeholder: 'auto',
  hint: 'Only tickets assigned to you. Up to 5 jobs at a time, in Inbox order. Nothing starts while the Claude limit warning shows.',
  needTag: 'Write a tag’s name to turn this on.',
  noTags: 'Orbit doesn’t show tags to your token, so nothing starts by itself.',
  offNeedsTag: 'Auto start is off: it needs a tag.',
  needsToken: 'Auto start needs the Orbit token (below) before it can start anything.',
} as const;

export function AutoStartGroup({ setting, tagsShown, tokenSet, busy = false, onSave, className = 'workflow-choice', laptopNote }: {
  setting: AutoStartSetting | undefined;
  /** false: Orbit shows no tags to this token; undefined: not known (nothing is said). */
  tagsShown?: boolean;
  /** false: no Orbit token is saved on this laptop; undefined: not known (nothing is said). */
  tokenSet?: boolean;
  busy?: boolean;
  /** Saves the whole setting; rejects with the reason in words. */
  onSave: (next: AutoStartSetting) => Promise<void>;
  className?: string;
  /**
   * The website (I4): it only queues the change for the laptop, so there is no "Saved"; this one line
   * under the group says where the change is instead (null: nothing to say now).
   */
  laptopNote?: string | null;
}) {
  const id = useId();
  const saved = useSaved();
  const on = setting?.on === true;
  const tag = setting?.tag ?? '';
  const [draft, setDraft] = useState(tag);
  const [problem, setProblem] = useState<string | null>(null);
  // Said once a cleared tag turned Auto start off (m10); goes when it is on again.
  const [offNote, setOffNote] = useState(false);
  useEffect(() => { setDraft(tag); }, [tag]);
  useEffect(() => { if (on) setOffNote(false); }, [on]);
  // A press on the switch moves the focus off the tag box first: its blur then leaves the save to the
  // switch, so the tag and the switch go in one save (m10), not two.
  const switching = useRef(false);

  async function save(next: AutoStartSetting) {
    setProblem(null);
    try { await onSave(next); if (laptopNote === undefined) saved.mark('auto-start'); } catch (err) { setProblem(err instanceof Error ? err.message : String(err)); }
  }
  const trimmed = draft.trim();
  const needsTag = on === false && !trimmed;
  /** The tag box was left (blur or Enter): save a changed tag; a cleared one turns Auto start off and says so. */
  function saveTag() {
    if (trimmed === tag) return;
    if (on && !trimmed) setOffNote(true);
    void save({ on: on && Boolean(trimmed), tag: trimmed });
  }
  const latestSaveTag = useRef(saveTag);
  latestSaveTag.current = saveTag;
  /** A press on the switch: if it ends without changing the switch (dragged off), the tag is saved then. */
  function pressSwitch() {
    switching.current = true;
    window.addEventListener('mouseup', () => setTimeout(() => {
      if (!switching.current) return;
      switching.current = false;
      latestSaveTag.current();
    }, 0), { once: true });
  }
  return (
    <SettingGroup className={className} disabled={busy} setting="auto-start" title={AUTO_START_WORDS.title} saved={<Saved tick={saved.tick('auto-start')} />}>
      <label className="check" onMouseDown={pressSwitch}>
        <Choice
          type="checkbox"
          checked={on}
          onChange={(e) => {
            switching.current = false;
            const next = e.currentTarget.checked;
            if (next && !trimmed) { setProblem(AUTO_START_WORDS.needTag); return; }
            void save({ on: next, tag: trimmed });
          }}
        />
        {AUTO_START_WORDS.switch}
      </label>
      <div className="check">
        <label htmlFor={`${id}-tag`} className="auto-start-tag-label">{AUTO_START_WORDS.box}</label>
        <TextInput
          id={`${id}-tag`}
          value={draft}
          maxLength={AUTO_START_TAG_MAX}
          placeholder={AUTO_START_WORDS.placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { setDraft(e.target.value); if (problem === AUTO_START_WORDS.needTag) setProblem(null); }}
          onBlur={() => { if (switching.current) return; saveTag(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveTag(); } }}
        />
      </div>
      <p className="muted settings-note-under">{AUTO_START_WORDS.hint}</p>
      {needsTag && problem === AUTO_START_WORDS.needTag && <p className="field-problem" role="alert">{AUTO_START_WORDS.needTag}</p>}
      {on && tokenSet === false && <p className="field-problem" role="status">{AUTO_START_WORDS.needsToken}</p>}
      {on && tokenSet !== false && tagsShown === false && <p className="field-problem" role="status">{AUTO_START_WORDS.noTags}</p>}
      {/* M5: once the box has text again, the tag is no longer missing. */}
      {!on && offNote && !trimmed && <p className="field-problem" role="status">{AUTO_START_WORDS.offNeedsTag}</p>}
      {problem && problem !== AUTO_START_WORDS.needTag && <p className="field-problem" role="alert">{problem}</p>}
      {laptopNote !== undefined && <p className="muted settings-note-under" role="status">{laptopNote ?? ''}</p>}
    </SettingGroup>
  );
}
