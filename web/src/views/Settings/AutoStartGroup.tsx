// Auto start (Settings → Workflow on the laptop, Settings → Orbit on the site): a switch, the Orbit
// tag, and Up to N jobs at a time (1 to 10, 5 when the setting has none). Tickets assigned to you with
// that tag start by themselves with Auto on, up to N at a time. This only writes the setting; the
// laptop's own starter (dashboard/lib/auto-start.js) does the starting. Every save sends the switch and
// the tag; only the number box sends max (the server keeps the saved N when a save leaves it out). The
// box saves when he leaves it or presses Enter, and at once for a step (− or +, or an arrow key).
import { useEffect, useId, useRef, useState } from 'react';
import type { AutoStartSetting } from '../../api/types';
import { Choice } from '../../components/Choice';
import { NumberInput, TextInput } from '../../components/Field';
import { AUTO_MAX } from '../../home/autoTab';
import { SettingGroup } from './SettingsMore';
import { Saved, useSaved } from '../../components/Saved';

export const AUTO_START_TAG_MAX = 60;
export const AUTO_START_WORDS = {
  title: 'Auto start',
  switch: 'Start a job by itself for tickets with this tag',
  box: 'Orbit tag',
  placeholder: 'auto',
  hint: 'Only tickets assigned to you, in Inbox order. Nothing starts while the Claude limit warning shows.',
  maxBefore: 'Up to',
  maxAfter: 'jobs at a time',
  maxLabel: 'Jobs at a time',
  needTag: 'Write a tag’s name to turn this on.',
  noTags: 'Orbit doesn’t show tags to your token, so nothing starts by itself.',
  offNeedsTag: 'Auto start is off: it needs a tag.',
  needsToken: 'Auto start needs the Orbit token (below) before it can start anything.',
} as const;

export function AutoStartGroup({ setting, tagsShown, tokenSet, busy = false, onSave, className = 'workflow-choice', laptopNote, notTaken = 0 }: {
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
  /** The website: goes up each time a change is reported as not taken by the laptop. */
  notTaken?: number;
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
  // N: the setting's, else 5; the box's text until it is a whole number from 1 to 10.
  const known = typeof setting?.max === 'number' ? setting.max : undefined;
  const max = known ?? AUTO_MAX.default;
  const [maxDraft, setMaxDraft] = useState(String(max));
  // Typed into since the box last showed a settled number: only then does leaving it save.
  const maxEdited = useRef(false);
  // The last N this page sent, until the setting shows it. A new N is weighed against this (else the
  // setting's), never against the setting alone, which on the website lags behind what was sent.
  const sentMax = useRef<number | null>(null);
  useEffect(() => {
    // While a sent N is on its way, the box keeps it, even when the setting shows an earlier step (N1).
    if (sentMax.current !== null && sentMax.current !== known) return;
    sentMax.current = null;
    setMaxDraft(String(max));
    maxEdited.current = false;
  }, [max, known]);
  // The website said the laptop did not take the change: forget the N sent, so the same N can be sent
  // again, and show the laptop's N (N3).
  const maxNow = useRef(max);
  maxNow.current = max;
  useEffect(() => {
    if (!notTaken) return;
    sentMax.current = null;
    maxEdited.current = false;
    setMaxDraft(String(maxNow.current));
  }, [notTaken]);
  // On the website the box shows only when the laptop's setting has N: an older laptop refuses max.
  const showMax = laptopNote === undefined || known !== undefined;
  useEffect(() => { if (on) setOffNote(false); }, [on]);
  // A press on the switch moves the focus off the tag box first: its blur then leaves the save to the
  // switch, so the tag and the switch go in one save (m10), not two.
  const switching = useRef(false);

  /** Saves the setting as given; false when it was refused (the reason is shown). */
  async function save(next: AutoStartSetting): Promise<boolean> {
    setProblem(null);
    try { await onSave(next); if (laptopNote === undefined) saved.mark('auto-start'); return true; } catch (err) { setProblem(err instanceof Error ? err.message : String(err)); return false; }
  }
  const trimmed = draft.trim();
  const needsTag = on === false && !trimmed;
  /** The tag box was left (blur or Enter): save a changed tag; a cleared one turns Auto start off and says so. */
  function saveTag() {
    if (trimmed === tag) return;
    if (on && !trimmed) setOffNote(true);
    void save({ on: on && Boolean(trimmed), tag: trimmed });
  }
  /** A whole number from 1 to 10, else null. */
  const maxOf = (raw: string) => {
    const n = Number(raw);
    return raw.trim() && Number.isInteger(n) && n >= AUTO_MAX.min && n <= AUTO_MAX.max ? n : null;
  };
  /** Sends N when it differs from the last N sent (else the setting's). */
  async function saveMax(n: number) {
    if (n === (sentMax.current ?? max)) return;
    sentMax.current = n === known ? null : n;
    const ok = await save({ on: on && Boolean(trimmed), tag: trimmed, max: n });
    // Refused: the reason shows, and the box shows the saved number again.
    if (!ok && sentMax.current === n) { sentMax.current = null; setMaxDraft(String(max)); }
  }
  /** Typing only changes the box; nothing is saved until he leaves it or presses Enter. */
  function typeMax(raw: string) { setMaxDraft(raw); maxEdited.current = true; }
  /** A step (− or +, or an arrow key) is one deliberate change: saved at once. */
  function stepMax(raw: string) {
    setMaxDraft(raw);
    maxEdited.current = false;
    const n = maxOf(raw);
    if (n !== null) void saveMax(n);
  }
  /** Leaving the box or Enter: a typed whole number from 1 to 10 is saved; anything else shows the last one again. */
  function commitMax() {
    if (!maxEdited.current) return;
    maxEdited.current = false;
    const n = maxOf(maxDraft);
    setMaxDraft(String(n ?? sentMax.current ?? max));
    if (n !== null) void saveMax(n);
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
      {/* Leaving the box (not for its own − and +) or Enter saves what was typed, or shows the last number again. */}
      {showMax && (
        <div
          className="check sb-auto-start-max"
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitMax(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitMax(); } }}
        >
          <label htmlFor={`${id}-max`}>{AUTO_START_WORDS.maxBefore}</label>
          <NumberInput id={`${id}-max`} value={maxDraft} min={AUTO_MAX.min} max={AUTO_MAX.max} onChange={typeMax} onStep={stepMax} aria-label={AUTO_START_WORDS.maxLabel} />
          <span>{AUTO_START_WORDS.maxAfter}</span>
        </div>
      )}
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
