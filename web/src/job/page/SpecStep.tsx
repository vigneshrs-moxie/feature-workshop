// The Spec step's body in the open step (design 3.2): the job's screens in the page (the Screens tab's
// prototype, its hint and today's Review the screens button; on the website the Screens tab says the
// page opens on the laptop), and on an Auto job the line saying what Auto did at the step.
import type { Job, StageView } from '../../api/types';
import { screensHref } from '../../app/router';
import { Button } from '../../components/Button';
import { ScreensTab } from '../../panes/Preview/ScreensTab';
import { versionLabel } from '../../panes/Preview/docs';
import { useWorkshop } from '../../state/store';
import { StepAutoLine } from './stepAuto';
import './page.css';

/** "spec v1" from the step's documents (the spec's version), when known. */
function specApproved(view: StageView | null | undefined): string | null {
  const v = Array.isArray(view?.docs) ? view.docs.find((d) => d?.file === 'spec')?.version : null;
  return v ? `spec ${versionLabel(v)}` : null;
}

export function SpecStep({ slug, job, view = null }: { slug: string; job: Job; /** The step's view, for the spec's version in the Auto line; missing: not known. */ view?: StageView | null }) {
  const { api } = useWorkshop();
  const hosted = api.hosted?.() ?? false;
  const version = job.wireframes ? versionLabel(job.wireframes.version) : '';
  return (
    <div className="sb-step-body">
      <StepAutoLine slug={slug} job={job} step="spec" approved={specApproved(view)} />
      {job.wireframes && (
        <section className="sb-block" aria-label="Screens">
          <h3 className="eyebrow">{version ? `Screens · ${version}` : 'Screens'}</h3>
          <ScreensTab slug={slug} job={job} active />
          {!hosted && (
            <p><Button icon="eye" href={screensHref(slug)} title="The feature’s screens, full width: click through the prototype, pin notes and pick the design choices. Copy feedback puts them in your reply.">Review the screens</Button></p>
          )}
        </section>
      )}
    </div>
  );
}
