// <JobTrail job variant />: the job's trail (Play, round 2), the classic page's meadow brought back.
// The stages it runs are a path of stops (done ones ticked, the goal a flag); the crew member for
// the current stage stands on it, big, in the job's mood: waiting with a "!" when it needs you, at
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
import { useNow } from '../lib/time';
import { useWorkshopState } from '../state/store';
import { crewInfo } from './crew';
import { CrewMember } from './CrewMember';
import { CREW_SIZE, crewSize } from './crewSizes';
import { jobTrail } from './trailModel';
import { usePlayIfAny } from './usePlay';
import { usePlayLedger } from './usePlayLedger';

const HINT = 'The trail (Play mode): the stages this job runs, with whoever is on the current stage standing on it. A quest is done by the Settings → Play rule (by default, when its first PR is created).';

export function JobTrail({ job, variant = 'header' }: { job: Job; variant?: 'header' | 'card' }) {
  const play = usePlayIfAny();
  const { meta, usage } = useWorkshopState();
  const now = useNow();
  // The page's shared ledger only: the trail never fetches one of its own.
  const { load } = usePlayLedger(false);
  if (!play?.on) return null;
  const slugs = load.state === 'ready' ? load.view.quests.slugs : undefined;
  const trail = jobTrail(job, { levels: meta?.levels, done: slugs ? slugs.includes(job.slug) : undefined, usage, now });
  if (!trail) return null;
  const full = play.full;
  const size = crewSize(variant === 'card' ? CREW_SIZE.floorCard : CREW_SIZE.trail, full);
  const current = trail.stops.find((s) => s.state === 'current');
  const last = trail.stops.length - 1;
  const name = crewInfo(trail.who).name;
  return (
    <section className={`job-trail is-${variant}${full ? ' is-full' : ''}${trail.ask ? ' is-ask' : ''}`} data-group={job.group} aria-label="Trail" title={HINT} style={{ '--trail-crew': `${size}px` } as CSSProperties}>
      <div className="trail-field">
        {full && trail.stars && (
          <span className="trail-stars" title={trail.difficulty ?? undefined}>
            <span aria-hidden="true">{trail.stars}</span>
            <span className="sr-only">{trail.difficulty}</span>
          </span>
        )}
        <ol className="trail-path" aria-label={`Stages${current ? `: now at ${current.label}` : trail.finished ? ': done' : ''}`}>
          {trail.stops.map((s, i) => {
            const goal = i === last;
            const here = s.state === 'current' || (trail.finished && goal);
            return (
              <li key={s.id} className={`trail-stop is-${s.state}${goal ? ' is-goal' : ''}${here ? ' is-here' : ''}`} title={s.label}>
                {here && (
                  <span className="trail-who">
                    {trail.ask && <span className="trail-ask" aria-hidden="true">!</span>}
                    <CrewMember type={trail.who} state={trail.mood} size={size} label={`${name}, ${trail.mood}`} />
                  </span>
                )}
                <span className="trail-dot" aria-hidden="true">{s.state === 'done' ? '✓' : goal ? '⚑' : ''}</span>
                <span className="trail-label">{s.label}</span>
                <span className="sr-only">{s.state === 'done' ? ', done' : s.state === 'current' ? ', now' : ''}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="trail-now">
        <strong className="trail-lead">{trail.lead}:</strong> {trail.now}
      </p>
      {trail.next && <p className="trail-next">{trail.next}</p>}
    </section>
  );
}
