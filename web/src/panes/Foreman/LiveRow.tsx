// The live row at the foot of the thread while the Foreman is replying: a typing indicator, what
// it's doing (its last tool step) and the last thing it wrote, updated by 'run' events. Gone once
// the reply ends; the finished reply then appears in the thread.
// With Play on (Subtle or Full) it also shows who is at work: the workers on the job (working) or
// the Foreman (thinking; waiting when something waits for you), and during a usage-limit pause a
// dim line with the crew asleep (Full: the Foreman and the workers asleep, with when they're back).
// With Play Off it is exactly as before.
import type { Job, Run, Usage } from '../../api/types';
import { ShortMarkdown } from '../../components/InlineText';
import { SleepingCrew } from '../../play/FullExtras';
import { LiveCrewFaces } from '../../play/ThreadCrew';
import { usagePaused } from '../../play/crewLines';
import { usePlayIfAny } from '../../play/usePlay';
import { isActiveRun, liveLabel } from './thread';

export function LiveRow({ run, job = null, usage = null }: { run: Run | null | undefined; job?: Job | null; usage?: Usage | null }) {
  const play = usePlayIfAny();
  const on = !play || play.on;
  if (!isActiveRun(run)) {
    if (!on || !job || !usagePaused(job, usage)) return null;
    return (
      <p className="thread-item thread-line live-row is-paused" title="Claude’s usage limit paused this job. It carries on when the limit resets (see the banner at the top).">
        {play?.full
          ? <SleepingCrew job={job} usage={usage} />
          : <><LiveCrewFaces job={job} run={run} usage={usage} /> Asleep until Claude’s usage limit resets.</>}
      </p>
    );
  }
  const text = run.lastText?.trim();
  return (
    <section className="thread-item live-row" aria-label="Foreman, replying now">
      <header className="thread-meta">
        <LiveCrewFaces job={job} run={run} usage={usage} where="lead" />
        <span className="who">Foreman</span>
        <span className="typing" aria-hidden="true"><span /><span /><span /></span>
        <span className="live-label" role="status">{liveLabel(run)}</span>
        <LiveCrewFaces job={job} run={run} usage={usage} where="tail" />
      </header>
      {run.lastAction && (
        <p className="live-action muted" title="The step the Foreman is on right now.">{run.lastAction}</p>
      )}
      {text && <div className="live-text" title="The latest thing the Foreman wrote. The full reply appears here when it finishes."><ShortMarkdown text={text} /></div>}
    </section>
  );
}
