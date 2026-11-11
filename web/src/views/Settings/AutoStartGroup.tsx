// Auto start (Settings → Workflow on the laptop, Settings → Orbit on the site): a switch and the Orbit
// tag. Tickets assigned to you with that tag start by themselves with Auto on, up to 5 at a time. This
// only writes the setting; the laptop's own starter (dashboard/lib/auto-start.js) does the starting.
import { useEffect, useId, useState } from 'react';
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
} as const;

export function AutoStartGroup({ setting, tagsShown, busy = false, onSave, className = 'workflow-choice' }: {
  setting: AutoStartSetting | undefined;
  /** false: Orbit shows no tags to this token; undefined: not known (nothing is said). */
  tagsShown?: boolean;
  busy?: boolean;
  /** Saves the whole setting; rejects with the reason in words. */
  onSave: (next: AutoStartSetting) => Promise<void>;
  className?: string;
}) {
  const id = useId();
  const saved = useSaved();
  const on = setting?.on === true;
  const tag = setting?.tag ?? '';
  const [draft, setDraft] = useState(tag);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { setDraft(tag); }, [tag]);

  async function save(next: AutoStartSetting) {
    setProblem(null);
    try { await onSave(next); saved.mark('auto-start'); } catch (err) { setProblem(err instanceof Error ? err.message : String(err)); }
  }
  const trimmed = draft.trim();
  const needsTag = on === false && !trimmed;
  return (
    <SettingGroup className={className} disabled={busy} setting="auto-start" title={AUTO_START_WORDS.title} saved={<Saved tick={saved.tick('auto-start')} />}>
      <label className="check">
        <Choice
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const next = e.currentTarget.checked;
            if (next && !trimmed) { setProblem(AUTO_START_WORDS.needTag); return; }
            void save({ on: next, tag: trimmed });
          }}
        />
        {AUTO_START_WORDS.switch}
      </label>
      <div className="check">
        <label htmlFor={`${id}-tag`}>{AUTO_START_WORDS.box}</label>
        <TextInput
          id={`${id}-tag`}
          value={draft}
          maxLength={AUTO_START_TAG_MAX}
          placeholder={AUTO_START_WORDS.placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { setDraft(e.target.value); if (problem === AUTO_START_WORDS.needTag) setProblem(null); }}
          onBlur={() => { if (trimmed !== tag) void save({ on: on && Boolean(trimmed), tag: trimmed }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (trimmed !== tag) void save({ on: on && Boolean(trimmed), tag: trimmed }); } }}
        />
      </div>
      <p className="muted settings-note-under">{AUTO_START_WORDS.hint}</p>
      {needsTag && problem === AUTO_START_WORDS.needTag && <p className="field-problem" role="alert">{AUTO_START_WORDS.needTag}</p>}
      {on && tagsShown === false && <p className="field-problem" role="status">{AUTO_START_WORDS.noTags}</p>}
      {problem && problem !== AUTO_START_WORDS.needTag && <p className="field-problem" role="alert">{problem}</p>}
    </SettingGroup>
  );
}
