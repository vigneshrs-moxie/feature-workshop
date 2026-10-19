// The crew in the conversation (Play layer step 3). Every piece here draws nothing with Play mode
// Off, so the thread is then exactly what phase 2 showed. Subtle draws them still and small, Full
// moves them (CrewMember follows the mode). Each character sits beside words that name it, or is
// an image named "<Name>, <mood>" with a tooltip. Callers never put these in a gate card, a
// permission card or the composer.
import { memo, useCallback, useRef } from 'react';
import type { Job, Run, Usage } from '../api/types';
import { crewInfo, type CrewState } from './crew';
import { CrewMember } from './CrewMember';
import { foremanMood, handoffLine, liveCrew, nameList } from './crewLines';
import { foremanLine, KNOCK_GAP_MS, KNOCKS, showScene } from './eggs';
import { usePlayIfAny } from './usePlay';
import { useFindSecret } from './useSecret';
import { CREW_SIZE, crewSize } from './crewSizes';

const hint = (type: string) => {
  const c = crewInfo(type);
  return c.number ? `${c.name}: ${c.role}.` : `${c.name}: a helper outside the workshop crew.`;
};

/** A crew member with their name (or other words) beside them: "[Sleuth] Sleuth". */
export const CrewTag = memo(function CrewTag({ type, state = 'idle', text, size }: { type: string; state?: CrewState; text?: string; size?: number }) {
  const play = usePlayIfAny();
  if (play && !play.on) return null;
  return (
    <span className="crew-tag" title={hint(type)}>
      <CrewMember type={type} state={state} size={size ?? crewSize(CREW_SIZE.tag, play?.full)} label="" />
      <span className="crew-tag-text">{text ?? crewInfo(type).name}</span>
    </span>
  );
});

/** In a routine-steps line: the workers it handed work to, "Sleuth started investigating". */
export const HandoffSummary = memo(function HandoffSummary({ types }: { types: string[] }) {
  const play = usePlayIfAny();
  if ((play && !play.on) || !types.length) return null;
  const size = crewSize(CREW_SIZE.handoff, play?.full);
  const text = types.length === 1 ? handoffLine(types[0]) : `${nameList(types)} started work`;
  return (
    <span className="crew-handoff">
      {types.slice(0, 4).map((t) => (
        <span key={t} title={hint(t)}><CrewMember type={t} state="idle" size={size} label="" /></span>
      ))}
      <span className="crew-handoff-text">{text}</span>
    </span>
  );
}, (a, b) => a.types.join() === b.types.join());

/**
 * The live row's crew: the workers at work, or the Foreman thinking, waiting or asleep. `where`:
 * 'lead' draws only the Foreman (before its name), 'tail' only workers (after what the row says).
 */
export function LiveCrewFaces({ job, run, usage, where }: { job: Job | null | undefined; run: Run | null | undefined; usage?: Usage | null; where?: 'lead' | 'tail' }) {
  const play = usePlayIfAny();
  const who = liveCrew(job, run, usage);
  if ((play && !play.on) || !who) return null;
  const size = crewSize(CREW_SIZE.live, play?.full);
  const foreman = who.types.length === 1 && who.types[0] === 'conductor';
  if ((where === 'lead' && !foreman) || (where === 'tail' && foreman)) return null;
  // The Foreman before its name ('lead') is decoration: the row says "Foreman" and what it is doing
  // right beside it, so a screen reader hears it once. Alone (a usage pause) it is named.
  const named = foreman && where !== 'lead';
  return (
    <span className="live-crew">
      {who.types.slice(0, 4).map((t) => (
        <CrewMember key={t} type={t} state={who.state} size={size} {...(named ? {} : { label: '' })} />
      ))}
      {who.text && <span className="live-crew-text" title="Who is at work on this job right now (from its session logs).">{who.text}</span>}
    </span>
  );
}

/** The Foreman by the job's title, in a mood that follows the job (waiting on you, at work, asleep in a usage pause…). */
export function ForemanFace({ job, usage }: { job: Job; usage?: Usage | null }) {
  const mood = foremanMood(job, usage);
  const knock = useKnocks();
  const play = usePlayIfAny();
  if (play && !play.on) return null;
  return (
    <span className="foreman-knock" onClick={knock}>
      <CrewMember type="conductor" state={mood} size={CREW_SIZE.foreman} className="foreman-face" />
    </span>
  );
}

// Knocks on the Foreman: KNOCKS clicks, each within KNOCK_GAP_MS of the last, get a one-liner
// (a scene with the toasts) and are a secret found. The next seven get the next line.
let lines = 0;
function useKnocks() {
  const find = useFindSecret();
  const knocks = useRef({ n: 0, at: 0 });
  return useCallback(() => {
    const now = Date.now();
    const k = knocks.current;
    k.n = now - k.at <= KNOCK_GAP_MS ? k.n + 1 : 1;
    k.at = now;
    if (k.n < KNOCKS) return;
    k.n = 0;
    void find('foreman-clicks');
    showScene('foreman', foremanLine(lines++));
  }, [find]);
}

/** A review brief's lineup: the lenses that looked at the change, named on hover. */
export function ReviewLineup({ types }: { types: string[] }) {
  const play = usePlayIfAny();
  if ((play && !play.on) || !types.length) return null;
  return (
    <ul className="crew-lineup" aria-label={`Reviewers on this round: ${nameList(types, types.length)}`}>
      {types.map((t) => (
        <li key={t} title={hint(t)}>
          <CrewMember type={t} state="idle" size={CREW_SIZE.lineup} label={crewInfo(t).name} />
        </li>
      ))}
    </ul>
  );
}
