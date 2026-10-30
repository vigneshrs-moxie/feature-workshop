// <WorkshopFloor />: the Foreman pane with no job open, Play on (Play, round 2). The classic page's
// home brought back:
//   1. The Foreman, big, saying what to do next: "3 jobs need you. Longest wait first:", with a
//      link for each (what it needs, how long it has waited), or who is at work when nothing does.
//   2. Every permission and question waiting for you (the Needs-you cards, as before). They sit
//      here, above the floor, so nothing stands between you and them.
//   3. On the floor: a card for every open job, its trail with its crew member standing on it, and
//      what it is waiting on. Click one to open it.
// Draws nothing with Play Off (the pane then shows what phase 2 did). compact (Home's side column):
// the Foreman and the cards waiting for you, without the floor's job cards (the map shows those).
import type { Job } from '../api/types';
import { jobHref } from '../app/router';
import { useUi } from '../app/ui';
import { NeedsYouCards } from '../components/permissions/PendingCards';
import { useNow } from '../lib/time';
import { jobStatus } from '../panes/Jobs/jobStatus';
import { useWorkshopState } from '../state/store';
import { jobHueStyle } from '../theme/hue';
import { CrewMember } from './CrewMember';
import { CREW_SIZE } from './crewSizes';
import { closedText, floorJobs, floorSpeech } from './floorModel';
import { JobTrail } from './JobTrail';
import { usePlayIfAny } from './usePlay';
import { Button } from '../components/Button';

function FloorCard({ job, now }: { job: Job; now: Date }) {
  const status = jobStatus(job, now);
  const title = job.title || job.slug;
  return (
    <li className="floor-card" data-group={status.group}>
      <div className="floor-card-head">
        <span className="hue-dot" style={jobHueStyle(job.slug)} aria-hidden="true" />
        {/* The whole card opens the job (the link's box covers it); its name is the job's title. */}
        <h4 className="floor-card-title"><a href={jobHref(job.slug)} title={`Open ${title}: its conversation with the Foreman.`}>{title}</a></h4>
        <span className={`job-status status-${status.group}`} data-group={status.group} title={status.hint}>
          <span className={`glyph status-${status.group}`} aria-hidden="true">{status.glyph}</span>
          <span className="job-status-label">{status.label}</span>
        </span>
      </div>
      <JobTrail job={job} now={now} variant="card" />
    </li>
  );
}

export function WorkshopFloor({ compact = false }: { compact?: boolean } = {}) {
  const play = usePlayIfAny();
  const { jobs, usage } = useWorkshopState();
  const ui = useUi();
  const now = useNow();
  if (!play?.on) return null;
  const speech = floorSpeech(jobs, usage, now);
  const open = floorJobs(jobs);
  const closed = closedText(jobs);
  return (
    <div className={`workshop-floor${compact ? ' is-compact' : ''}`}>
      <section className="floor-foreman" aria-label="The Foreman">
        <CrewMember type="conductor" state={speech.mood} size={CREW_SIZE.floorForeman} label={`Foreman, ${speech.mood}`} className="floor-foreman-face" />
        <div className="floor-bubble">
          <p className="floor-eyebrow">Foreman</p>
          <p className="floor-say">{speech.say}</p>
          {speech.asks.length > 0 && (
            <ul className="floor-asks">
              {speech.asks.map((a) => (
                <li key={a.slug}>
                  <a className="floor-ask" href={jobHref(a.slug)} title={`Open ${a.title} to ${a.what}.`}>
                    <span className="floor-ask-arrow" aria-hidden="true">▶</span>
                    <span className="floor-ask-title">{a.title}</span>
                    <span className="floor-ask-what">{a.what}{a.waited ? ` · waiting ${a.waited}` : ''}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {speech.more > 0 && <p className="floor-more muted">…and {speech.more} more in the list on the left.</p>}
          {open.length === 0 && (
            <Button kind="primary" onClick={() => ui.openSheet({ kind: 'new-job' })} title="Start a new job: describe it, pick the repository, kind and Foreman model (key: c).">
              New job
            </Button>
          )}
        </div>
      </section>

      <section className="needs-you-inbox" aria-label="Waiting for your answer">
        <h3 className="settings-heading" title="Every permission and question waiting for you, across all jobs. You can answer them here or in each job.">Waiting for your answer</h3>
        <NeedsYouCards now={now} />
      </section>

      {!compact && open.length > 0 && (
        <section className="floor-jobs" aria-label="On the floor">
          <h3 className="settings-heading" title="Every open job, with its trail: the stages it runs and who is on the current one.">On the floor</h3>
          <p className="muted floor-hint">Pick a job to open its conversation.{closed ? ` ${closed} in the list on the left.` : ''}</p>
          <ul className="floor-grid">
            {open.map((j) => <FloorCard key={j.slug} job={j} now={now} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
