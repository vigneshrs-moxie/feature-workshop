// Preview pane. Docs (phase 2.1): every document of the open job as a clean page (DocsTab).
// Screens (Light, round 3): the wireframes page the Painter drew, in an iframe, only when the job
// has one (ScreensTab). Classic view: links to the classic page for what isn't rebuilt yet
// (decision D4). The App, Diff, Tests, Terminal and Git tabs arrive in phase 4.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { HowThisWorks } from '../../components/HowThisWorks';
import { useKeyScope } from '../../app/keyRegistry';
import { classicHref } from '../../app/router';
import { useUi } from '../../app/ui';
import { jobBySlug } from '../../state/reducer';
import { useWorkshopState } from '../../state/store';
import { DocsTab } from './DocsTab';
import { ScreensTab } from './ScreensTab';

type PreviewTab = 'docs' | 'screens' | 'classic';

const TABS: { id: PreviewTab; label: string; hint: string }[] = [
  { id: 'docs', label: 'Docs', hint: 'Every document the crew writes for this job (spec, plans, briefs, reviews, notes), shown as a clean page.' },
  { id: 'screens', label: 'Screens', hint: 'The feature’s screens the Painter drew from the spec, to review before anyone builds: verdicts, picks and notes on the page, Copy feedback for your reply.' },
  { id: 'classic', label: 'Classic view', hint: 'Links to what is still on the classic page: trying it on your computer, costs and history search.' },
];

function ClassicLinks({ slug }: { slug: string | null }) {
  return (
    <>
      <HowThisWorks id="preview">
        <p>Later this pane also shows the app, the diff, tests and a terminal beside the conversation. Until then, these links open the same things in the classic view.</p>
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
    </>
  );
}

export function PreviewPane({ slug }: { slug: string | null }) {
  const ui = useUi();
  const state = useWorkshopState();
  const [picked, setTab] = useState<PreviewTab>('docs');
  const tabRefs = useRef<Partial<Record<PreviewTab, HTMLButtonElement | null>>>({});
  const job = jobBySlug(state, slug);
  // The Screens tab exists only while the job has a wireframes page.
  const hasScreens = Boolean(slug && job?.wireframes);
  const tabs = TABS.filter((t) => t.id !== 'screens' || hasScreens);
  const tab: PreviewTab = tabs.some((t) => t.id === picked) ? picked : 'docs';

  // ⌘K "Open docs" or a link to a document: this tab, with focus on the documents (DocsTab takes
  // it). Each request is handled once, so opening another job doesn't switch back to Docs.
  const handledRequest = useRef(ui.docsRequest);
  useEffect(() => {
    if (ui.docsRequest === handledRequest.current) return;
    handledRequest.current = ui.docsRequest;
    setTab('docs');
    if (!slug) tabRefs.current.docs?.focus();
  }, [ui.docsRequest, slug]);
  // The gate card's screen chips, "Review the screens" or the Docs list's Wireframes entry: the Screens tab.
  const handledScreens = useRef(ui.screensRequest);
  useEffect(() => {
    if (ui.screensRequest === handledScreens.current) return;
    handledScreens.current = ui.screensRequest;
    if (hasScreens) setTab('screens');
  }, [ui.screensRequest, hasScreens]);

  const stepTab = (by: 1 | -1, focus: boolean) => {
    const at = tabs.findIndex((t) => t.id === tab);
    const next = tabs[(at + by + tabs.length) % tabs.length].id;
    setTab(next);
    if (focus) tabRefs.current[next]?.focus();
  };
  // ← and → on the tab bar itself; [ and ] from anywhere on the job (the 'job' scope).
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    stepTab(e.key === 'ArrowRight' ? 1 : -1, true);
  }
  useKeyScope('job', { 'preview-prev': () => stepTab(-1, false), 'preview-next': () => stepTab(1, false) }, slug !== null);

  return (
    <aside className="pane pane-preview" data-pane="preview" aria-label="Preview">
      <h2 className="pane-title">Preview</h2>
      <div className="preview-tabs" role="tablist" aria-label="Preview">
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`preview-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`preview-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className="preview-tab"
            onClick={() => setTab(t.id)}
            onKeyDown={onTabKey}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
      </div>
      <section id="preview-panel-docs" role="tabpanel" aria-labelledby="preview-tab-docs" hidden={tab !== 'docs'}>
        {slug
          ? <DocsTab key={slug} slug={slug} changedAt={job?.updatedAt ?? null} focusRequest={ui.docsRequest} requestFile={ui.docsFile} active={tab === 'docs'} />
          : <p className="muted doc-empty">Open a job to read its documents here: the spec, plans, briefs and reviews, each as a clean page.</p>}
      </section>
      {/* Mounted whenever the job has screens (hidden until picked), so the page's report reaches the gate card's chips. */}
      {hasScreens && slug && (
        <section id="preview-panel-screens" role="tabpanel" aria-labelledby="preview-tab-screens" hidden={tab !== 'screens'}>
          <ScreensTab key={slug} slug={slug} job={job} active={tab === 'screens'} />
        </section>
      )}
      <section id="preview-panel-classic" role="tabpanel" aria-labelledby="preview-tab-classic" hidden={tab !== 'classic'}>
        <ClassicLinks slug={slug} />
      </section>
    </aside>
  );
}
