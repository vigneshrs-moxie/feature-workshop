// #/job/<slug>/screens: the job's wireframes page full width (the Home-style shell, no Jobs or
// Preview pane), with a Back link to the job. The body is the Preview pane's Screens tab.
import { jobHref } from '../../app/router';
import { ScreensTab } from '../../panes/Preview/ScreensTab';
import { jobBySlug } from '../../state/reducer';
import { useWorkshopState } from '../../state/store';
import { roleOf } from '../../play/crewPack';
import { Button } from '../../components/Button';

export function ScreensView({ slug }: { slug: string }) {
  const state = useWorkshopState();
  const job = jobBySlug(state, slug);
  return (
    <main className="screens-view" aria-label="Screens">
      <div className="screens-view-head">
        <Button kind="quiet" href={jobHref(slug)} title="Back to the job: its conversation, the gate card and the Preview pane."><span aria-hidden="true">←</span> Back to the job</Button>
        <h2 className="pane-title screens-view-title">{job?.title ?? slug} <span className="muted">· Screens</span></h2>
      </div>
      {job && !job.wireframes ? (
        <p className="muted">This job has no screens yet. They show up here once the {roleOf('feature-wireframer')} has drawn them (the Screens stage).</p>
      ) : (
        <ScreensTab key={slug} slug={slug} job={job} active full />
      )}
    </main>
  );
}
