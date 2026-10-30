// The level choice on the New job sheet (decision D5): L0 Tweak to L3 Large, as one segmented choice,
// with the picked level's one-line "what runs" hint from meta.levels under it (every level's hint is
// also in its name and its tooltip). The rules' suggestion (lib/levels.ts, no model, instant) is
// marked, and a note shows when your pick is under the rules' floor. A radio group: the arrow keys
// move between the levels.
import type { LevelInfo, LevelNumber } from '../../api/types';
import { floorNote, LEVEL_NUMBERS, levelLabel, type LevelSuggestion } from '../../lib/levels';
import { Segmented } from '../../components/Choice';

export interface LevelPickerProps {
  levels: LevelInfo[] | null | undefined;
  /** The level picked now: yours, else the rules' suggestion; null before there is either. */
  value: LevelNumber | null;
  suggestion: LevelSuggestion | null;
  /** You picked one yourself (the suggestion no longer follows the description). */
  byHand: boolean;
  onPick: (level: LevelNumber) => void;
  disabled?: boolean;
}

export function LevelPicker({ levels, value, suggestion, byHand, onPick, disabled }: LevelPickerProps) {
  const note = suggestion && value !== null ? floorNote(suggestion, value) : null;
  const hint = (n: LevelNumber) => levels?.find((l) => l.level === n)?.hint ?? null;
  const picked = value === null ? null : hint(value);
  const about = 'How much process the job gets. The rules suggest one from your description as you type; pick another any time.';
  return (
    <div className="field level-picker">
      <span className="field-label" aria-hidden="true">Level</span>
      <Segmented
        label="Level"
        className="level-segments"
        value={value === null ? '' : String(value)}
        disabled={disabled}
        onChange={(v) => onPick(Number(v) as LevelNumber)}
        options={LEVEL_NUMBERS.map((n) => {
          const suggested = suggestion?.level === n;
          const words = hint(n);
          return {
            value: String(n),
            title: `${levelLabel(n, levels)}: ${words ?? 'see the job options'}${suggested ? ' The rules suggest this one for your description.' : ''}`,
            label: (
              <>
                {levelLabel(n, levels)}
                {suggested && <span className="level-suggested-dot" aria-hidden="true" />}
                {words && <span className="sr-only">: {words}</span>}
                {suggested && <span className="sr-only"> (suggested)</span>}
              </>
            ),
          };
        })}
      />
      <p className={`field-hint level-hint${picked ? '' : ' is-empty'}`}>{picked ?? about}</p>
      {suggestion && (
        <p className="field-hint level-suggested" title="The rules read your description for risky areas and for how big the change sounds. No AI is involved, and nothing is sent until you start the job.">
          Suggested: {levelLabel(suggestion.level, levels)} — {suggestion.reasons.join(' ')}{byHand && value !== suggestion.level ? ' You picked another level; it’s kept as you type.' : ''}
        </p>
      )}
      {note && <p className="perm-warn level-floor">{note}</p>}
    </div>
  );
}
