// Preview pane, phase 1: a placeholder with links to the classic page for what isn't rebuilt yet
// (decision D4). The App, Diff, Tests, Terminal and Git tabs arrive in phase 4.
import { HowThisWorks } from '../../components/HowThisWorks';
import { classicHref } from '../../app/router';

export function PreviewPane({ slug }: { slug: string | null }) {
  return (
    <aside className="pane pane-preview" aria-label="Preview">
      <h2 className="pane-title">Preview</h2>
      <HowThisWorks id="preview">
        <p>Later this pane shows the app, the diff, tests and a terminal beside the conversation. Until then, these links open the same things in the classic view.</p>
      </HowThisWorks>
      <ul className="classic-links">
        {slug && (
          <li>
            <a href={classicHref.job(slug)} title="Open this job in the classic view: try it on your computer, details and costs.">Open this job in classic view</a>
          </li>
        )}
        <li><a href={classicHref.costs()} title="Open the Costs page in the classic view.">Costs (classic view)</a></li>
        <li><a href={classicHref.history()} title="Search your past Claude conversations in the classic view.">History search (classic view)</a></li>
        <li><a href={classicHref.home()} title="Open the classic Feature Workshop page.">Classic view</a></li>
      </ul>
    </aside>
  );
}
