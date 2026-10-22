// Preview pane: one tab per purpose. Plan (the acceptance criteria and dev tests you hand on to
// the reviewer first, then the spec and the plans), Briefs and Review are the job's documents as
// clean pages (one DocsTab whose list follows the tab; records and raw files under More files).
// Screens: the wireframes page the Painter drew, only when the job has one (ScreensTab). Try it:
// the classic page's "Try it on your computer" (TryTab). Walkthrough: the review walkthrough page
// built for the job's branch, only when there is one (WalkthroughTab). Help is the small ? beside the title; the
// classic view is in the job menu and the top bar.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { HowThisWorks } from '../../components/HowThisWorks';
import { useKeyScope } from '../../app/keyRegistry';
import { useUi } from '../../app/ui';
import { jobBySlug } from '../../state/reducer';
import { useWorkshopState } from '../../state/store';
import { DocsTab } from './DocsTab';
import type { DocSection } from './docs';
import { ScreensTab } from './ScreensTab';
import { TryTab } from './TryTab';
import { WalkthroughTab } from './WalkthroughTab';

type PreviewTab = DocSection | 'walkthrough' | 'screens' | 'try';

const TABS: { id: PreviewTab; label: string; hint: string }[] = [
  { id: 'plan', label: 'Plan', hint: 'The acceptance criteria and dev tests you hand on to the reviewer, the spec and the plans. Notes and raw files are under More files.' },
  { id: 'briefs', label: 'Briefs', hint: 'The Foreman’s briefs to you, newest first.' },
  { id: 'review', label: 'Review', hint: 'The combined review, the test report and any second looks. Each reviewer’s own file is under More files.' },
  { id: 'walkthrough', label: 'Walkthrough', hint: 'The review walkthrough for this job’s branch: every change by zoom level, with verdicts and notes, to go through with your reviewer.' },
  { id: 'screens', label: 'Screens', hint: 'The feature’s screens the Painter drew from the spec, to review before anyone builds: verdicts, picks and notes on the page, Copy feedback for your reply.' },
  { id: 'try', label: 'Try it', hint: 'Run this job’s branch on your computer and click around: set up, start the app, switch the database, run commands.' },
];

const HELP: Record<PreviewTab, string> = {
  plan: 'Acceptance criteria (what it needs to be ready for staging) and Dev tests (one-line tests you run by hand) come first: you hand both to the reviewer. Then the spec and the plans. A dot means the document has Key points at the top, the Foreman’s short summary. Notes, the job’s records and raw files are under More files. Nothing here changes a file.',
  briefs: 'Every brief the Foreman gave you, newest first. Each opens with its Key points; Summarise asks for them where there are none.',
  review: 'The combined review and the test report. Each reviewer’s own file is under More files.',
  walkthrough: 'The review walkthrough built for this branch (prep this for review). Quick reads the change aloud in plain words; All shows every level. Its links open in a new tab. Notes stay in this browser; Open the published page is where they are saved and shared.',
  screens: 'The screens page: mark each screen, pick the design choices, and Copy feedback puts your notes in your reply.',
  try: 'Runs this job’s branch from its own folder next to your main app. ▶ Try it sets up what is missing and starts the app; the steps show each part. Commands and logs are folded at the bottom.',
};

const isDocTab = (t: PreviewTab): t is DocSection => t === 'plan' || t === 'briefs' || t === 'review';

export function PreviewPane({ slug }: { slug: string | null }) {
  const ui = useUi();
  const state = useWorkshopState();
  const [picked, setTab] = useState<PreviewTab>('plan');
  const tabRefs = useRef<Partial<Record<PreviewTab, HTMLButtonElement | null>>>({});
  const job = jobBySlug(state, slug);
  // The Screens tab exists only while the job has a wireframes page; Try it only on a job.
  const hasScreens = Boolean(slug && job?.wireframes);
  const hasWalkthrough = Boolean(slug && job?.walkthrough);
  const tabs = TABS.filter((t) => (t.id !== 'screens' || hasScreens) && (t.id !== 'walkthrough' || hasWalkthrough) && (t.id !== 'try' || slug));
  const tab: PreviewTab = tabs.some((t) => t.id === picked) ? picked : 'plan';
  const docTab: DocSection = isDocTab(tab) ? tab : 'plan';

  // ⌘K "Open docs" or a link to a document: a documents tab, with focus on its list (DocsTab
  // takes it; a linked document switches to its own tab). Each request is handled once.
  const handledRequest = useRef(ui.docsRequest);
  useEffect(() => {
    if (ui.docsRequest === handledRequest.current) return;
    handledRequest.current = ui.docsRequest;
    setTab((t) => (isDocTab(t) ? t : 'plan'));
    if (!slug) tabRefs.current.plan?.focus();
  }, [ui.docsRequest, slug]);
  // The gate card's screen chips, "Review the screens" or the Wireframes entry: the Screens tab.
  const handledScreens = useRef(ui.screensRequest);
  useEffect(() => {
    if (ui.screensRequest === handledScreens.current) return;
    handledScreens.current = ui.screensRequest;
    if (hasScreens && ui.screensSlug === slug) setTab('screens'); // a request for another job is that job's
  }, [ui.screensRequest, ui.screensSlug, slug, hasScreens]);
  // The job menu's or the gate card's "Try it on your computer": the Try it tab.
  const handledTry = useRef(ui.tryRequest);
  useEffect(() => {
    if (ui.tryRequest === handledTry.current) return;
    handledTry.current = ui.tryRequest;
    if (slug && ui.trySlug === slug) setTab('try');
  }, [ui.tryRequest, ui.trySlug, slug]);

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
      <div className="preview-head">
        <h2 className="pane-title">Preview</h2>
        <HowThisWorks id="preview" variant="icon"><p>{HELP[tab]}</p></HowThisWorks>
      </div>
      <div className="preview-tabs" role="tablist" aria-label="Preview">
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`preview-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`preview-panel-${isDocTab(t.id) ? 'docs' : t.id}`}
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
      {/* One documents panel for Plan, Briefs and Review: its list follows the tab. */}
      <section id="preview-panel-docs" role="tabpanel" aria-labelledby={`preview-tab-${docTab}`} hidden={!isDocTab(tab)}>
        {slug
          ? <DocsTab key={slug} slug={slug} section={docTab} onSection={setTab} changedAt={job?.updatedAt ?? null} focusRequest={ui.docsRequest} requestFile={ui.docsFile} active={isDocTab(tab)} />
          : <p className="muted doc-empty">Open a job to see its plan, briefs and review here, each as a clean page.</p>}
      </section>
      {/* Mounted whenever the job has screens (hidden until picked), so the page's report reaches the gate card's chips. */}
      {hasScreens && slug && (
        <section id="preview-panel-screens" role="tabpanel" aria-labelledby="preview-tab-screens" hidden={tab !== 'screens'}>
          <ScreensTab key={slug} slug={slug} job={job} active={tab === 'screens'} />
        </section>
      )}
      {hasWalkthrough && slug && (
        <section id="preview-panel-walkthrough" role="tabpanel" aria-labelledby="preview-tab-walkthrough" hidden={tab !== 'walkthrough'}>
          <WalkthroughTab slug={slug} job={job} active={tab === 'walkthrough'} />
        </section>
      )}
      {slug && (
        <section id="preview-panel-try" role="tabpanel" aria-labelledby="preview-tab-try" hidden={tab !== 'try'}>
          <TryTab key={slug} slug={slug} active={tab === 'try'} />
        </section>
      )}
    </aside>
  );
}
