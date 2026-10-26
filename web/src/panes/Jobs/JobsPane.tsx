// Jobs pane: every job, grouped as Needs you / Running / Paused / Idle / Shipping / Done (the
// dashboard decides the group, see dashboard/lib/snapshot.js). It collapses to a narrow icon rail and remembers that
// in this browser. The in-browser alert switches live in Settings → Notifications ("In this browser").
import { useMemo } from 'react';
import { JOB_GROUPS, type JobGroup } from '../../api/types';
import { HowThisWorks } from '../../components/HowThisWorks';
import { useStored } from '../../lib/stored';
import { useNow } from '../../lib/time';
import { jobsByGroup, needsYouCount } from '../../state/reducer';
import { useWorkshopState } from '../../state/store';
import { JobRow } from './JobRow';
import { GROUP_GLYPHS, GROUP_HINTS, GROUP_LABELS } from './jobStatus';

/** Remembered: the folded groups, comma-separated ('-' for none). Never set: Done starts folded. */
export const FOLDED_KEY = 'fw.jobs.folded';
const DEFAULT_FOLDED: JobGroup[] = ['done'];

export function useFoldedGroups(): [Set<JobGroup>, (g: JobGroup) => void] {
  const [value, set] = useStored(FOLDED_KEY);
  const folded = new Set<JobGroup>(value === null ? DEFAULT_FOLDED : (value.split(',').filter((g) => (JOB_GROUPS as readonly string[]).includes(g)) as JobGroup[]));
  const toggle = (g: JobGroup) => {
    const next = new Set(folded);
    if (next.has(g)) next.delete(g); else next.add(g);
    set(next.size ? [...next].join(',') : '-');
  };
  return [folded, toggle];
}

/** Remembered: 'on' while the pane is collapsed to the icon rail. The shell reads it for the layout. */
export const RAIL_KEY = 'fw.jobs.rail';

export function useJobsRail(): [boolean, (on: boolean) => void] {
  const [value, set] = useStored(RAIL_KEY);
  return [value === 'on', (on) => set(on ? 'on' : null)];
}

export function JobsPane({ selected }: { selected: string | null }) {
  const state = useWorkshopState();
  const groups = useMemo(() => jobsByGroup(state), [state]);
  const [rail, setRail] = useJobsRail();
  const [folded, toggleFold] = useFoldedGroups();
  const now = useNow();

  if (rail) {
    const needs = needsYouCount(state);
    return (
      <nav className="pane pane-jobs is-rail" data-pane="jobs" aria-label="Jobs">
        <button
          type="button"
          className="btn btn-quiet rail-toggle"
          onClick={() => setRail(false)}
          aria-label="Expand the jobs list"
          title="Show the full jobs list, with each job’s name, status, stage and time."
        >
          <span aria-hidden="true">»</span>
        </button>
        {needs > 0 && (
          <span className="rail-needs num" title={`${needs} job${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} you.`}>
            {needs}
          </span>
        )}
        {JOB_GROUPS.map((g) => (groups[g].length ? (
          <section key={g} className="rail-group" data-group={g} aria-label={GROUP_LABELS[g]}>
            <ul>
              {groups[g].map((j) => (
                <li key={j.slug}><JobRow job={j} selected={j.slug === selected} now={now} rail /></li>
              ))}
            </ul>
          </section>
        ) : null))}
      </nav>
    );
  }

  return (
    <nav className="pane pane-jobs" data-pane="jobs" aria-label="Jobs">
      <div className="pane-head">
        <h2 className="pane-title">Jobs</h2>
        <button
          type="button"
          className="btn btn-quiet rail-toggle"
          onClick={() => setRail(true)}
          aria-label="Collapse the jobs list"
          title="Shrink this list to a narrow strip of icons, to give the conversation more room. Hover an icon to see which job it is."
        >
          <span aria-hidden="true">«</span>
        </button>
      </div>
      <HowThisWorks id="jobs">
        <p>Every job, sorted by what it needs. <strong>Needs you</strong> is waiting for your answer or a permission click; <strong>Running</strong> is working now; <strong>Paused</strong> hit the Claude usage limit and says when it resumes; <strong>Idle</strong> is waiting for your next message; <strong>Shipping</strong> is past the finish line you set (Settings → Workflow) and on its way to main, with the row saying where it is; <strong>Done</strong> is in main or marked done, and still readable.</p>
        <p>Each row shows the job’s colour dot (only to help you spot it), its status in words, the stage it’s at and how long ago it last changed. Hover anything for more.</p>
        <p>The tab title shows how many jobs need you. Under <strong>Settings → Notifications → In this browser</strong> you can turn on browser notifications and a chime for when a job newly needs you. The « button shrinks this list to icons. Click a group’s heading to fold it away (Done starts folded); this browser remembers.</p>
        <p><strong>New job</strong> at the top starts one (key: <strong>c</strong>). Keys <strong>j</strong> and <strong>k</strong> step through this list; <strong>⌘K</strong> (Ctrl+K) searches every job and action.</p>
      </HowThisWorks>
      {state.status === 'ready' && state.jobs.length === 0 && <p className="muted">No jobs yet.</p>}
      {JOB_GROUPS.map((g) => {
        if (!groups[g].length) return null;
        // A folded group still shows its count, and says when the job you have open is inside it.
        const isFolded = folded.has(g);
        const hidesOpen = isFolded && groups[g].some((j) => j.slug === selected);
        return (
          <section key={g} className={`job-group${isFolded ? ' is-folded' : ''}`} data-group={g} aria-label={GROUP_LABELS[g]}>
            <h3 className="job-group-title" data-group={g}>
              <button type="button" className="job-group-toggle" aria-expanded={!isFolded} aria-controls={`job-group-${g}`} onClick={() => toggleFold(g)} title={`${GROUP_HINTS[g]} Click to ${isFolded ? 'show' : 'hide'} these jobs.`}>
                <span className="job-group-chevron" aria-hidden="true">{isFolded ? '▸' : '▾'}</span>
                <span className={`glyph status-${g}`} aria-hidden="true">{GROUP_GLYPHS[g]}</span>
                <span className="job-group-name">{GROUP_LABELS[g]}</span>
                {hidesOpen && <span className="job-group-open">open job inside</span>}
                <span className="count">{groups[g].length}</span>
              </button>
            </h3>
            <ul id={`job-group-${g}`} hidden={isFolded}>
              {groups[g].map((j) => (
                <li key={j.slug}><JobRow job={j} selected={j.slug === selected} now={now} /></li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
