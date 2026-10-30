// The pages the hosted site doesn't serve yet (a job's page, the Desk, Stacks, Telemetry, …): a
// calm note, never an error: "Open this on your laptop for now — the hosted site shows it once
// this part is built."
import { Button } from '../../components/Button';
import { Hero, Page } from '../../components/page/Page';

export const LATER_TITLE = 'Open this on your laptop for now';
export const LATER_SAY = 'The hosted site shows it once this part is built.';

export function LaterPage({ page }: { page: string }) {
  return (
    <Page label={page} title={page}>
      <Hero icon="terminal" title={LATER_TITLE} quiet actions={<Button href="#/" icon="arrow-left" title="Back to your jobs.">Back to Jobs</Button>}>
        <p>{LATER_SAY}</p>
        <p className="muted">On your laptop it works as it always has: run ground-control start if it isn’t running, then open it there.</p>
      </Hero>
    </Page>
  );
}
