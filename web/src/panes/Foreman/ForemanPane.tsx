// Foreman pane, shell version: names the open job. Plan step 6 adds the thread, step 7 the
// permission and question cards, step 8 the composer.
import { HowThisWorks } from '../../components/HowThisWorks';
import { GROUP_LABELS } from '../Jobs/JobsPane';
import { jobBySlug } from '../../state/reducer';
import { useWorkshopState } from '../../state/store';

export function ForemanPane({ slug }: { slug: string | null }) {
  const state = useWorkshopState();
  const job = jobBySlug(state, slug);
  return (
    <main className="pane pane-foreman" aria-label="Foreman">
      <div className="foreman-column">
        <h2 className="pane-title">{job ? job.title : 'Foreman'}</h2>
        <HowThisWorks id="foreman">
          <p>This is your conversation with the job’s Foreman, the Claude session that plans the work and runs the crew. Its briefs, questions and permission requests appear here for you to answer.</p>
        </HowThisWorks>
        {!slug && <p className="muted">Pick a job on the left to see its conversation.</p>}
        {slug && !job && state.status === 'ready' && <p className="muted">There’s no job called “{slug}”. It may have been renamed or removed.</p>}
        {job && (
          <p className="muted">
            Status: <span className={`status status-${job.group}`}>{GROUP_LABELS[job.group] ?? job.group}</span>
            {job.headline ? <> · {job.headline}</> : null}
          </p>
        )}
      </div>
    </main>
  );
}
