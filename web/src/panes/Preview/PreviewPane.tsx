// Preview pane. Docs (phase 2.1): every document of the open job as a clean page (DocsTab). Classic
// view: links to the classic page for what isn't rebuilt yet (decision D4). The App, Diff, Tests,
// Terminal and Git tabs arrive in phase 4.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { HowThisWorks } from '../../components/HowThisWorks';
import { classicHref } from '../../app/router';
import { useUi } from '../../app/ui';
import { jobBySlug } from '../../state/reducer';
import { useWorkshopState } from '../../state/store';
import { DocsTab } from './DocsTab';

type PreviewTab = 'docs' | 'classic';

const TABS: { id: PreviewTab; label: string; hint: string }[] = [
  { id: 'docs', label: 'Docs', hint: 'Every document the crew writes for this job (spec, plans, briefs, reviews, notes), shown as a clean page.' },
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
  const [tab, setTab] = useState<PreviewTab>('docs');
  const tabRefs = useRef<Record<PreviewTab, HTMLButtonElement | null>>({ docs: null, classic: null });
  const job = jobBySlug(state, slug);

  // ⌘K "Open docs": this tab, with focus on the documents (DocsTab takes it).
  useEffect(() => {
    if (!ui.docsRequest) return;
    setTab('docs');
    if (!slug) tabRefs.current.docs?.focus();
  }, [ui.docsRequest, slug]);

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const at = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(at + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <aside className="pane pane-preview" data-pane="preview" aria-label="Preview">
      <h2 className="pane-title">Preview</h2>
      <div className="preview-tabs" role="tablist" aria-label="Preview">
        {TABS.map((t) => (
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
          ? <DocsTab key={slug} slug={slug} changedAt={job?.updatedAt ?? null} focusRequest={ui.docsRequest} active={tab === 'docs'} />
          : <p className="muted doc-empty">Open a job to read its documents here: the spec, plans, briefs and reviews, each as a clean page.</p>}
      </section>
      <section id="preview-panel-classic" role="tabpanel" aria-labelledby="preview-tab-classic" hidden={tab !== 'classic'}>
        <ClassicLinks slug={slug} />
      </section>
    </aside>
  );
}
