// <JobTrail job variant />: the job's trail (Play, round 2), the classic page's meadow brought back.
// The stages it runs are a path of stops (done ones ticked, the finish line's stop a flag, the stops
// after the line smaller); the crew member for the current stage stands on it, big, in the job's mood: waiting with a "!" when it needs you, at
// work, asleep in a usage pause, celebrating at the end. Under it, one line in plain words says
// what is happening and whose move it is ("Your move: …", "Now: Builder is building."), then
// what comes next.
//
//   variant 'header'  under the open job's title (both Subtle and Full; Full adds the difficulty
//                     stars and the field's trees)
//   variant 'card'    on a workshop-floor card: a smaller crew member, and only the current
//                     stop and the goal keep their names
//
// Draws nothing with Play Off. Subtle holds the crew still; Full moves them (CrewMember follows the
// mode); reduced motion holds every one still. Never inside a gate card, a permission card or the
// composer.
import type { CSSProperties } from 'react';
import type { Job } from '../api/types';
import { crewInfo } from './crew';
import { CrewMember } from './CrewMember';
import { CREW_SIZE, crewSize } from './crewSizes';
import { usePlayIfAny } from './usePlay';
import { useTrail } from './useTrail';

const HINT = 'The trail (Play mode): the stages this job runs, with whoever is on the current stage standing on it. The flag is the finish line you set (Settings → Workflow); the quest is done when the job crosses it.';

export function JobTrail({ job, now, variant = 'header' }: { job: Job; now: Date; variant?: 'header' | 'card' }) {
  const play = usePlayIfAny();
  const trail = useTrail(job, now, variant);
  if (!play?.on || !trail) return null;
  const full = play.full;
  const title = job.title || job.slug;
  const size = crewSize(variant === 'card' ? CREW_SIZE.floorCard : CREW_SIZE.trail, full);
  const current = trail.stops.find((s) => s.state === 'current');
  const name = crewInfo(trail.who).name;
  return (
    <section className={`job-trail is-${variant}${full ? ' is-full' : ''}${trail.ask ? ' is-ask' : ''}`} data-group={job.group} aria-label={variant === 'card' ? `Trail: ${title}` : 'Trail'} title={HINT} style={{ '--trail-crew': `${size}px` } as CSSProperties}>
      <div className="trail-field">
        <ol className="trail-path" aria-label={`Stages${current ? `: now at ${current.label}` : trail.finished ? ': done' : ''}`}>
          {trail.stops.map((s) => {
            const { goal, here } = s;
            return (
              <li key={s.id} className={`trail-stop is-${s.state}${goal ? ' is-goal' : ''}${s.after ? ' is-after' : ''}${here ? ' is-here' : ''}`} title={s.after ? `${s.label} (after the finish line)` : goal ? `${s.label} (the finish line)` : s.label}>
                {here && (
                  <span className="trail-who">
                    {trail.ask && <span className="trail-ask" aria-hidden="true">!</span>}
                    <CrewMember type={trail.who} state={trail.mood} size={size} label={`${name}, ${trail.mood}`} />
                  </span>
                )}
                <span className="trail-dot" aria-hidden="true">{s.state === 'done' ? '✓' : goal ? '⚑' : ''}</span>
                <span className="trail-label">{s.label}</span>
                <span className="sr-only">{s.state === 'done' ? ', done' : s.state === 'current' ? ', now' : ''}{goal ? ', the finish line' : s.after ? ', after the line' : ''}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="trail-now">
        {/* Full: the difficulty, at the line's end (off the field, where a crew member may stand). */}
        {full && trail.stars && (
          <span className="trail-stars" title={trail.difficulty ?? undefined}>
            <span aria-hidden="true">{trail.stars}</span>
            <span className="sr-only">{trail.difficulty}</span>
          </span>
        )}
        <strong className="trail-lead">{trail.lead}:</strong> {trail.now}
      </p>
      {trail.next && <p className="trail-next">{trail.next}</p>}
    </section>
  );
}
