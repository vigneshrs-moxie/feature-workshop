// The level choice on the New job sheet (decision D5): L0 Tweak to L3 Large, each with its one-line
// "what runs" hint from meta.levels. The rules' suggestion (lib/levels.ts, no model, instant) is
// marked, and a note shows when your pick is under the rules' floor. Native radios, so arrow keys
// move between the levels.
import type { LevelInfo, LevelNumber } from '../../api/types';
import { floorNote, LEVEL_NUMBERS, levelLabel, type LevelSuggestion } from '../../lib/levels';
import { Choice } from '../../components/Choice';

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
  return (
    <div className="level-picker">
      <div className="rule-options" role="radiogroup" aria-label="Level">
        <span className="seg-label muted" title="How much process the job gets. The rules suggest one from your description as you type; pick another any time.">Level</span>
        {LEVEL_NUMBERS.map((n) => {
          const info = levels?.find((l) => l.level === n);
          const suggested = suggestion?.level === n;
          return (
            <label
              key={n}
              className={`rule-option${value === n ? ' is-picked' : ''}`}
              title={`${levelLabel(n, levels)}: ${info?.hint ?? 'see the job options'}${suggested ? ' The rules suggest this one for your description.' : ''}`}
            >
              <Choice type="radio" name="level" value={n} checked={value === n} disabled={disabled} onChange={() => onPick(n)} />
              <span className="rule-option-body">
                <span className="rule-option-kind">{levelLabel(n, levels)}{suggested && <span className="chip">Suggested</span>}</span>
                {info?.hint && <span className="muted">{info.hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {suggestion && (
        <p className="muted sheet-fine level-suggested" title="The rules read your description for risky areas and for how big the change sounds. No AI is involved, and nothing is sent until you start the job.">
          Suggested: {levelLabel(suggestion.level, levels)} — {suggestion.reasons.join(' ')}{byHand && value !== suggestion.level ? ' You picked another level; it’s kept as you type.' : ''}
        </p>
      )}
      {note && <p className="perm-warn level-floor">{note}</p>}
    </div>
  );
}
