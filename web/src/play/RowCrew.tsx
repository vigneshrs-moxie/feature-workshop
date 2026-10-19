// <RowCrew job />: a job's crew member at the start of its row in the Jobs list (Play, round 2):
// whoever stands on its trail (play/useTrail.ts, so the two always agree), in the job's mood, with a small "!" when it is
// your move. Decoration only: the row already says the status, stage and time in words, so it is
// hidden from screen readers. Always still, in Full too, so a long list stays calm (the trail and
// the live row are where the crew move). Draws nothing with Play Off.
import type { Job } from '../api/types';
import { CrewMember } from './CrewMember';
import { CREW_SIZE } from './crewSizes';
import { useTrail } from './useTrail';

export function RowCrew({ job, now }: { job: Job; now: Date }) {
  const trail = useTrail(job, now);
  if (!trail) return null;
  return (
    <span className="row-crew" aria-hidden="true">
      <CrewMember type={trail.who} state={trail.mood} size={CREW_SIZE.row} label="" animated={false} />
      {trail.ask && <span className="row-crew-ask">!</span>}
    </span>
  );
}
