// Jobs pane, shell version: the five groups with a plain link per job. Plan step 5 adds the full
// rows (status glyph, stage, time, hue dot, "resumes 3:42pm"), notifications and the chime.
import { useMemo } from 'react';
import { JOB_GROUPS, type JobGroup } from '../../api/types';
import { HowThisWorks } from '../../components/HowThisWorks';
import { jobHref } from '../../app/router';
import { jobsByGroup } from '../../state/reducer';
import { useWorkshopState } from '../../state/store';

export const GROUP_LABELS: Record<JobGroup, string> = {
  'needs-you': 'Needs you',
  running: 'Running',
  paused: 'Paused',
  idle: 'Idle',
  done: 'Done',
};

export function JobsPane({ selected }: { selected: string | null }) {
  const state = useWorkshopState();
  const groups = useMemo(() => jobsByGroup(state), [state]);
  return (
    <nav className="pane pane-jobs" aria-label="Jobs">
      <h2 className="pane-title">Jobs</h2>
      <HowThisWorks id="jobs">
        <p>Every job, sorted by what it needs. <strong>Needs you</strong> is waiting for your answer or a permission click; <strong>Running</strong> is working now; <strong>Paused</strong> hit the Claude usage limit and carries on when it resets.</p>
        <p>Pick a job to open its conversation with the Foreman.</p>
      </HowThisWorks>
      {state.status === 'ready' && state.jobs.length === 0 && <p className="muted">No jobs yet.</p>}
      {JOB_GROUPS.map((g) => (groups[g].length ? (
        <section key={g} className="job-group" aria-label={GROUP_LABELS[g]}>
          <h3 className="job-group-title">{GROUP_LABELS[g]} <span className="count">{groups[g].length}</span></h3>
          <ul>
            {groups[g].map((j) => (
              <li key={j.slug}>
                <a
                  className="job-link"
                  href={jobHref(j.slug)}
                  aria-current={j.slug === selected ? 'page' : undefined}
                  title={`Open ${j.title}: its conversation with the Foreman.`}
                >
                  {j.title || j.slug}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null))}
    </nav>
  );
}
