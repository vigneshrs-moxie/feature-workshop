// The Full-mode extras (Play layer step 6). Each draws nothing unless Play mode is Full, so Subtle
// and Off are exactly as before; with reduced motion asked for, everything holds still. Every one
// has words as well as a picture, and a hover hint. None of them ever sits in a gate card, a
// permission card or the composer.
//   <QuestTrack job />     in the job header: difficulty stars and the stages as a path, the current
//                          stage's crew member standing on it (only the stars on a narrow pane)
//   <BossFight review />   under an L3 job's review brief: its findings as a health bar
//   <StaminaBar />         in the top bar: Claude's usage limit as Fresh, Warning or Resting
//   <SleepingCrew />       the live row during a usage pause: the crew asleep, back at 3:42pm
import type { Job, ReviewBoss, Usage } from '../api/types';
import { useNow } from '../lib/time';
import { useWorkshopState } from '../state/store';
import { crewInfo } from './crew';
import { CrewMember } from './CrewMember';
import { nameList, workersNow } from './crewLines';
import { backAt, bossView, questTrack, staminaOf } from './extrasModel';
import { usePlayIfAny } from './usePlay';
import { usePlayLedger } from './usePlayLedger';

const useFull = () => {
  const play = usePlayIfAny();
  return Boolean(play?.on && play.full);
};

const TRACK_HINT = 'The quest track (Play mode Full): the job’s level as difficulty, and the stages this level runs as a path with whoever is on the current stage standing on it. A quest is done by the Settings → Play rule (by default, when its first PR is created).';

export function QuestTrack({ job }: { job: Job }) {
  const full = useFull();
  const { meta } = useWorkshopState();
  // The page's shared ledger only: the track never fetches one of its own.
  const { load } = usePlayLedger(false);
  if (!full) return null;
  // Done by the Settings → Play rule, as the ledger counts it (no ledger, or one from before, says nothing).
  const slugs = load.state === 'ready' ? load.view.quests.slugs : undefined;
  const track = questTrack(job, meta?.levels, slugs ? slugs.includes(job.slug) : undefined);
  if (!track) return null;
  const current = track.stops.find((s) => s.state === 'current');
  return (
    <div className="quest-track" title={TRACK_HINT}>
      <span className="quest-stars" aria-hidden="true">{track.stars}</span>
      <span className="sr-only">{track.difficulty}</span>
      <ol className="quest-path" aria-label={`Quest track${current ? `: now at ${current.label}` : track.finished ? ': done' : ''}`}>
        {track.stops.map((s, i) => (
          <li key={s.id} className={`quest-stop is-${s.state}${i === track.stops.length - 1 ? ' is-goal' : ''}`}>
            {s.state === 'current' && track.who && (
              <span className="quest-who"><CrewMember type={track.who} state="working" size={22} label={crewInfo(track.who).name} /></span>
            )}
            {track.finished && i === track.stops.length - 1 && (
              <span className="quest-who"><CrewMember type="conductor" state="celebrating" size={22} label="Foreman, celebrating" /></span>
            )}
            <span className="quest-dot" aria-hidden="true">{s.state === 'done' ? '✓' : i === track.stops.length - 1 ? '⚑' : ''}</span>
            <span className="quest-label">{s.label}</span>
            <span className="sr-only">{s.state === 'done' ? ', done' : s.state === 'current' ? ', now' : ''}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const BOSS_HINT = 'The boss fight (Play mode Full, L3 reviews): the review’s findings as hit points (blockers 5, majors 3, minors 1), draining as fix rounds land. It is defeated once the blockers and majors are fixed; minors left over are yours. From review.md only; it costs no usage and never rewards approving.';

export function BossFight({ review }: { review: ReviewBoss | null | undefined }) {
  const full = useFull();
  const boss = bossView(review);
  if (!full || !boss) return null;
  return (
    <div className={`boss-fight${boss.defeated ? ' is-defeated' : ''}`} title={BOSS_HINT}>
      <p className="boss-text">
        {boss.defeated && <span className="boss-glyph" aria-hidden="true">✓ </span>}
        {boss.text}
      </p>
      <span className="boss-bar" aria-hidden="true">
        <span className="boss-bar-fill" style={{ width: `${Math.round(boss.share * 100)}%` }} />
      </span>
    </div>
  );
}

export function StaminaBar() {
  const full = useFull();
  const { usage } = useWorkshopState();
  const now = useNow();
  if (!full) return null;
  const s = staminaOf(usage, now);
  return (
    <span className={`stamina is-${s.state}`} title={`Stamina (Play mode Full). ${s.hint}`}>
      <span className="stamina-bar" aria-hidden="true">
        <span className="stamina-fill" style={{ width: `${Math.round(s.fill * 100)}%` }} />
      </span>
      <span className="stamina-label"><span className="sr-only">Stamina: </span>{s.label}</span>
    </span>
  );
}

/** Full mode's usage-pause line: the Foreman and the workers on the job asleep, and when they're back. */
export function SleepingCrew({ job, usage }: { job: Job; usage?: Usage | null }) {
  const now = useNow();
  const workers = workersNow(job);
  const types = ['conductor', ...workers].slice(0, 4);
  const back = backAt(usage, now);
  const who = workers.length ? nameList(types, 4) : 'The crew';
  return (
    <>
      <span className="live-crew sleeping-crew">
        {types.map((t) => <CrewMember key={t} type={t} state="asleep" size={30} label="" />)}
      </span>
      {' '}{who} are asleep{back ? ` · ${back}` : ' until Claude’s usage limit resets'}.
    </>
  );
}
