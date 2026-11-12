// The open step on the job page (design 3.2): its head, who worked on it with a model and a status
// in words, the live feed, the step's own body and its documents; the loader that asks again while
// the step works. Invented jobs, agents and documents only; no model calls, nothing opens.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job, JobDocEntry, StageAgent, StageView, StopId } from '../../api/types';
import { UiProvider } from '../../app/ui';
import { pickOption } from '../../components/Select.testing';
import { jobBySlug } from '../../state/reducer';
import { createStore, useWorkshopState, WorkshopContext } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { StepDocs } from './StepDocs';
import { StepPanel } from './StepPanel';
import { StepsRow } from './StepsRow';
import { useStage } from './useStage';

const NOW = new Date('2026-11-10T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const SLUG = 'pause-a-service';

const agent = (who: string, extra: Partial<StageAgent> = {}): StageAgent => ({
  who, role: 'ignored', model: 'Opus 5.5', doing: null, since: ago(12), lastAt: ago(1), status: 'working',
  terminal: { kind: who === 'conductor' ? 'continue' : 'watch', ready: true, why: null }, ref: who === 'conductor' ? 'foreman' : 'c1.aaaaaaaa', ...extra,
});

const PLAN_DOC: JobDocEntry = { file: 'implementation-plan.md', name: 'Implementation plan', group: 'plan', version: '2', updatedAt: ago(30), size: 1200, type: 'md' };
const TEST_PLAN: JobDocEntry = { file: 'test-plan.md', name: 'Test plan', group: 'plan', version: null, updatedAt: ago(90), size: 800, type: 'md' };

const BUILD: StageView = {
  slug: SLUG, stop: 'build', label: 'Build', state: 'now', stateWords: 'Working now', since: ago(40), stages: ['implement'],
  agents: [
    agent('conductor', { doing: 'Checking each commit against step 3', since: ago(40), feed: [{ text: 'Read the plan', at: ago(38) }, { text: 'Started the Builder on step 3', at: ago(12) }] }),
    agent('feature-implementer', { doing: 'Writing step 3 of 6', ref: 'c2.bbbbbbbb', feed: [{ text: 'Wrote PauseDialog.tsx', at: ago(4) }, { text: 'Ran the unit tests', at: ago(0.2) }] }),
  ],
  finished: [agent('feature-planner', { status: 'done', doing: null, ref: 'c0.dddddddd', model: 'Fable 5.2', since: ago(200), lastAt: ago(130), feed: [{ text: 'Wrote the plan', at: ago(131) }] })],
  terminalApp: 'iTerm', terminalApps: ['iTerm', 'Terminal'],
  time: { startedAt: ago(32), endedAt: null },
  docs: [PLAN_DOC, TEST_PLAN],
};

const BUILDING: Job = job(SLUG, 'running', { stage: 'implement', lane: 'working', working: true, updatedAt: ago(1) });

function stores(j: Job, { hosted = false, play, get, post }: { hosted?: boolean; play?: 'full' | 'subtle'; get?: (path: string) => Promise<unknown>; post?: (path: string) => Promise<unknown> } = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [j], meta: { token: 't', ...(play ? { settings: { play: { mode: play } } } : {}) } as never }) });
  const api = {
    get: vi.fn(get ?? (async (path: string): Promise<unknown> => {
      if (/\/doc\?file=implementation-plan\.md$/.test(path)) return { file: 'implementation-plan.md', name: 'Implementation plan', html: '<p>Step 1: the pause dialog.</p>', summary: null };
      throw new Error(`not in this test: ${path}`);
    })),
    post: vi.fn(post ?? (async (): Promise<unknown> => ({ ok: true }))),
    ...(hosted ? { hosted: () => true } : {}),
  } as unknown as ApiClient & { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
  const wrap = (n: ReactNode) => <WorkshopContext.Provider value={{ store, api }}><UiProvider>{n}</UiProvider></WorkshopContext.Provider>;
  return { store, api, wrap };
}

/** The panel drawn with a view in hand. */
function show(view: StageView | null, { j = BUILDING, stop = view?.stop ?? 'build', hosted = false, play = undefined as 'full' | 'subtle' | undefined, error = null as string | null, extraAgents = undefined as StageAgent[] | undefined, otherDocs = undefined as JobDocEntry[] | null | undefined, regionOf = undefined as string | undefined } = {}) {
  const s = stores(j, { hosted, play });
  const onRetry = vi.fn();
  render(s.wrap(<StepPanel job={j} stop={stop} view={view} error={error} onRetry={onRetry} now={NOW} extraAgents={extraAgents} otherDocs={otherDocs} regionOf={regionOf}><p>The step’s own body</p></StepPanel>));
  return { ...s, onRetry };
}

/** The panel with its loader, as the page will mount it. */
function Live({ stop }: { stop: StopId }) {
  const j = jobBySlug(useWorkshopState(), SLUG)!;
  const { view, error, reload } = useStage(SLUG, stop);
  return <StepPanel job={j} stop={stop} view={view} error={error} onRetry={reload} now={NOW}><p>The step’s own body</p></StepPanel>;
}

const who = (name = 'Who worked on it') => screen.getByRole('region', { name });
const rows = () => [...who().querySelectorAll<HTMLElement>('.sb-who-row')];
const stageCalls = (get: ReturnType<typeof vi.fn>, stop: StopId = 'build') => get.mock.calls.filter(([p]) => p === `/api/job/${SLUG}/stage/${stop}`).length;

afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

describe('StepPanel', () => {
  it('who worked on it, each with a model and a status in words', async () => {
    const { api } = show(BUILD);
    const panel = screen.getByRole('tabpanel', { name: 'Build' });
    const head = panel.querySelector('.sb-panel-head')!;
    expect(head).toHaveTextContent('Build');
    expect(within(head as HTMLElement).getByText('Working now')).toHaveClass('chip');
    expect(head).toHaveTextContent('32 min so far');
    expect(head).toHaveTextContent('Step 4 of 7');

    expect(rows().map((r) => r.querySelector('.sb-who-role')?.textContent)).toEqual(['Foreman', 'Builder', 'Planner']);
    const [foreman, builder, planner] = rows();
    expect(foreman.querySelector('.sb-who-initials')).toHaveTextContent('F');
    expect(within(builder).getByText('Opus 5.5')).toHaveClass('chip');
    expect(within(planner).getByText('Fable 5.2')).toHaveClass('chip');
    expect(builder).toHaveTextContent('Writing step 3 of 6');
    expect(builder).toHaveTextContent('12 min');
    expect(within(builder).getByText('Working')).toHaveClass('chip');
    expect(within(planner).getByText('Done')).toHaveClass('chip');
    expect(planner).toHaveTextContent('Finished its part');
    expect(planner).toHaveTextContent('1 h 10 min');

    // The terminals, as on the step page today.
    expect(within(foreman).getByRole('button', { name: /Open in terminal/ })).toBeEnabled();
    fireEvent.click(within(builder).getByRole('button', { name: /Watch in terminal/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/api/job/${SLUG}/stage/build/terminal`, { ref: 'c2.bbbbbbbb' }));
    expect(await screen.findByText(/Following the Builder’s log in iTerm/)).toBeInTheDocument();
    fireEvent.click(within(who()).getByRole('button', { name: /Open the job’s folder in a terminal/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/api/job/${SLUG}/local`, { action: 'open', what: 'terminal' }));
    pickOption(within(who()).getByRole('combobox', { name: 'Terminal app' }), 'Terminal');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/api/job/${SLUG}/local`, { action: 'terminal-app', name: 'Terminal' }));
    cleanup();

    // Waiting for you, and one that never started.
    show({ ...BUILD, agents: [agent('feature-implementer', { status: 'waiting', doing: 'Waiting for you to allow a command' })], finished: [agent('feature-tester', { status: 'stopped', since: null, lastAt: null, ref: 'c3.cccccccc' })] });
    const [waiting, never] = rows();
    expect(within(waiting).getByText('Waiting for you')).toHaveClass('chip');
    expect(within(never).getByText('Not started')).toHaveClass('chip');
    cleanup();

    // A row the step's body adds (extraAgents), after the rest.
    show(BUILD, { extraAgents: [agent('recorder-like', { role: 'Starbase', model: 'recorder', ref: 'extra' })] });
    expect(rows().map((r) => r.querySelector('.sb-who-role')?.textContent)).toEqual(['Foreman', 'Builder', 'Planner', 'Starbase']);
  });

  it('the Foreman’s row says who it waits for while a crew member works', () => {
    const foremanStatus = () => rows()[0].querySelector('.sb-who-status')?.textContent;
    show(BUILD);
    expect(foremanStatus()).toBe('Waiting for the Builder');
    cleanup();
    // Starbase records the evidence.
    const recording = job(SLUG, 'running', { stage: 'test', lane: 'working', testing: 'Recording evidence: line 4 of 19' });
    show({ ...BUILD, stop: 'test', label: 'Test', agents: [agent('conductor')], finished: [] }, { j: recording });
    expect(foremanStatus()).toBe('Waiting for the evidence');
    cleanup();
    // A pull request open at Ship.
    const shipping = job(SLUG, 'shipping', { stage: 'pr1', lane: 'in-review', laneReason: 'PR #1 is open, waiting on a review' });
    show({ ...BUILD, stop: 'ship', label: 'Ship', agents: [agent('conductor', { status: 'stopped', doing: 'Not working right now' })], finished: [] }, { j: shipping });
    expect(foremanStatus()).toBe('Waiting on the review');
    cleanup();
    // Waiting for you stays its own words; alone it is Working.
    show({ ...BUILD, agents: [agent('conductor', { status: 'waiting' }), agent('feature-implementer')] });
    expect(foremanStatus()).toBe('Waiting for you');
    cleanup();
    show({ ...BUILD, agents: [agent('conductor')], finished: [] });
    expect(foremanStatus()).toBe('Working');
  });

  it('the feed lists each working crew member’s last actions, and says What they did last when nobody works', () => {
    show(BUILD);
    const feed = screen.getByRole('region', { name: 'Live: what they’re doing' });
    const blocks = [...feed.querySelectorAll<HTMLElement>('.sb-feed-block')];
    // Crew members only: the Foreman's row says whom it waits for; newest line first.
    expect(blocks.map((b) => b.querySelector('.sb-feed-who')?.textContent)).toEqual(['Builder']);
    const builder = blocks[0];
    expect(builder).toHaveTextContent('Opus 5.5');
    expect(within(builder).getByText('Live')).toBeInTheDocument();
    expect([...builder.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['nowRan the unit tests', '4 min agoWrote PauseDialog.tsx']);
    expect(feed).not.toHaveTextContent('Wrote the plan');
    expect(feed).not.toHaveTextContent('Read the plan');
    cleanup();

    const done = { ...BUILD, state: 'done' as const, agents: [], finished: [agent('conductor', { status: 'done', feed: [{ text: 'Raised the brief', at: ago(65) }] }), BUILD.finished[0]] };
    show(done);
    expect(screen.queryByRole('region', { name: 'Live: what they’re doing' })).toBeNull();
    const last = screen.getByRole('region', { name: 'What they did last' });
    const lastBlocks = [...last.querySelectorAll<HTMLElement>('.sb-feed-block')];
    expect(lastBlocks.map((b) => b.querySelector('.sb-feed-who')?.textContent)).toEqual(['Planner']);
    expect(within(lastBlocks[0]).getByText('Finished')).toBeInTheDocument();
    expect(lastBlocks[0]).toHaveTextContent('2 h 11 min agoWrote the plan');
  });

  it('the feed shows only where a crew member worked: none on a Foreman-only, done-without-lines or skipped step', () => {
    const feedRegion = () => screen.queryByRole('region', { name: /Live: what they’re doing|What they did last/ });
    // Only the Foreman works, with lines of its own.
    show({ ...BUILD, agents: [BUILD.agents[0]], finished: [] });
    expect(feedRegion()).toBeNull();
    cleanup();
    // Done, its crew left no lines.
    show({ ...BUILD, state: 'done', agents: [], finished: [agent('conductor', { status: 'done' }), agent('feature-implementer', { status: 'done', ref: 'c2.bbbbbbbb' })] });
    expect(feedRegion()).toBeNull();
    expect(screen.queryByText('No actions to show yet.')).toBeNull();
    cleanup();
    // Skipped.
    show({ ...BUILD, stop: 'investigate', label: 'Investigate', state: 'skipped', stateWords: 'Skipped', agents: [], finished: [] }, { j: { ...BUILDING, skipped: ['investigate', 'spec-update'] } });
    expect(feedRegion()).toBeNull();
    expect(screen.getByText('This job skipped this step.')).toBeInTheDocument();
    cleanup();
    // A crew member at work with no lines yet (an older laptop): its block says so; a finished one with none has no block.
    show({ ...BUILD, agents: [agent('conductor'), agent('feature-implementer', { ref: 'c2.bbbbbbbb' })], finished: [agent('feature-planner', { status: 'done', ref: 'c0.dddddddd' })] });
    const live = screen.getByRole('region', { name: 'Live: what they’re doing' });
    const blocks = [...live.querySelectorAll<HTMLElement>('.sb-feed-block')];
    expect(blocks.map((b) => b.querySelector('.sb-feed-who')?.textContent)).toEqual(['Builder']);
    expect(blocks[0]).toHaveTextContent('No actions to show yet.');
  });

  it('the feed asks again every 5 seconds while the step works', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    let answer: StageView = BUILD;
    const { api, wrap } = stores(BUILDING, { get: async () => answer });
    const view = render(wrap(<Live stop="build" />));
    await act(async () => {});
    expect(stageCalls(api.get)).toBe(1);
    expect(screen.getByText('Ran the unit tests')).toBeInTheDocument();
    answer = { ...BUILD, agents: [BUILD.agents[0], { ...BUILD.agents[1], feed: [{ text: 'Committed step 3', at: ago(0) }] }] };
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(stageCalls(api.get)).toBe(2);
    expect(screen.getByText('Committed step 3')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(stageCalls(api.get)).toBe(3);

    // Nobody works any more: every 30 seconds.
    answer = { ...BUILD, state: 'done', agents: [], finished: BUILD.agents.map((a) => ({ ...a, status: 'done' as const })) };
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(stageCalls(api.get)).toBe(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(stageCalls(api.get)).toBe(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(stageCalls(api.get)).toBe(5);

    // Gone from the page: it stops asking.
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(stageCalls(api.get)).toBe(5);
  });

  it('the step asks again when the job changes', async () => {
    let slow: (v: StageView) => void = () => {};
    let build: StageView = BUILD;
    const { api, store, wrap } = stores(BUILDING, {
      get: async (path: string) => {
        if (path.endsWith('/stage/plan')) return new Promise((r) => { slow = r as (v: StageView) => void; });
        return path.endsWith('/stage/test') ? { ...BUILD, stop: 'test', label: 'Test', state: 'next', agents: [], finished: [] } : build;
      },
    });
    const view = render(wrap(<Live stop="build" />));
    await screen.findByText('Writing step 3 of 6');
    expect(stageCalls(api.get)).toBe(1);
    // Another snapshot with the job unchanged: no new ask.
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [{ ...BUILDING }], meta: { token: 't' } as never }) }); });
    expect(stageCalls(api.get)).toBe(1);
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [{ ...BUILDING, updatedAt: ago(0) }], meta: { token: 't' } as never }) }); });
    await waitFor(() => expect(stageCalls(api.get)).toBe(2));

    // Another step: its own answer, never the old step's drawn into it.
    view.rerender(wrap(<Live stop="plan" />));
    expect(stageCalls(api.get, 'plan')).toBe(1);
    expect(screen.getByText('Loading who worked on it…')).toBeInTheDocument();
    expect(screen.queryByText('Writing step 3 of 6')).toBeNull();
    view.rerender(wrap(<Live stop="test" />));
    await screen.findByText('Not yet. The Tester starts when the build is done. These three run then:');
    await act(async () => { slow({ ...BUILD, stop: 'plan', label: 'Plan' }); });
    expect(screen.queryByText('Writing step 3 of 6')).toBeNull();
    expect(screen.getByRole('tabpanel', { name: 'Test' })).toBeInTheDocument();

    // Back on a step seen before: the last answer at once, then the fresh answer replaces it.
    build = { ...BUILD, agents: [BUILD.agents[0], { ...BUILD.agents[1], doing: 'Writing step 4 of 6' }] };
    view.rerender(wrap(<Live stop="build" />));
    expect(screen.getByText('Writing step 3 of 6')).toBeInTheDocument();
    expect(screen.queryByText('Loading who worked on it…')).toBeNull();
    expect(await screen.findByText('Writing step 4 of 6')).toBeInTheDocument();
    expect(screen.queryByText('Writing step 3 of 6')).toBeNull();
  });

  it('a document opens in place and Back returns to the list', async () => {
    const { api } = show(BUILD);
    const docs = screen.getByRole('region', { name: 'Documents from this step' });
    const items = within(docs).getAllByRole('button');
    expect(items.map((b) => b.querySelector('.doc-name')?.textContent)).toEqual(['Implementation plan', 'Test plan']);
    expect(items[0]).toHaveTextContent('v2');
    expect(items[0].querySelector('time')).toHaveAttribute('dateTime', PLAN_DOC.updatedAt);
    fireEvent.click(items[0]);
    expect(await within(docs).findByText('Step 1: the pause dialog.')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/api/job/${SLUG}/doc?file=implementation-plan.md`);
    expect(screen.getByText('The step’s own body')).toBeInTheDocument();
    fireEvent.click(within(docs).getByRole('button', { name: /All documents/ }));
    expect(within(docs).queryByText('Step 1: the pause dialog.')).toBeNull();
    expect(within(docs).getAllByRole('button').map((b) => b.querySelector('.doc-name')?.textContent)).toEqual(['Implementation plan', 'Test plan']);
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-file', 'implementation-plan.md'));
  });

  it('workflow-status.md and an unknown notes-extra.md can be opened from Other documents of this job', async () => {
    const STATUS_DOC: JobDocEntry = { file: 'workflow-status.md', name: 'Workflow status', group: 'other', version: null, updatedAt: ago(5), size: 300, type: 'md' };
    const EXTRA: JobDocEntry = { file: 'notes-extra.md', name: 'notes-extra.md', group: 'other', version: null, updatedAt: ago(8), size: 120, type: 'md' };
    const get = async (path: string): Promise<unknown> => {
      if (/\/doc\?file=workflow-status\.md$/.test(path)) return { file: 'workflow-status.md', name: 'Workflow status', html: '<p>Status: building step 3.</p>', summary: null };
      if (/\/doc\?file=notes-extra\.md$/.test(path)) return { file: 'notes-extra.md', name: 'notes-extra.md', html: '<p>Extra notes from the reviewer.</p>', summary: null };
      throw new Error(`not in this test: ${path}`);
    };
    // The laptop app, the website, and the phone's step screen (a region named by its heading).
    for (const mode of [{ hosted: false }, { hosted: true }, { hosted: false, regionOf: 'phone-step-title' }]) {
      const s = stores(BUILDING, { hosted: mode.hosted, get });
      render(s.wrap(
        <>
          {mode.regionOf && <h1 id={mode.regionOf}>Build</h1>}
          <StepPanel job={BUILDING} stop="build" view={BUILD} error={null} onRetry={() => {}} now={NOW} otherDocs={[STATUS_DOC, EXTRA]} regionOf={mode.regionOf}><p>The step’s own body</p></StepPanel>
        </>,
      ));
      const fold = screen.getByText('Other documents of this job', { selector: '.fold-name' }).closest('details')!;
      // Closed at first, under the step's own documents.
      expect(fold.open).toBe(false);
      const own = screen.getByRole('region', { name: 'Documents from this step' });
      expect(own.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(own).queryByText('Workflow status')).toBeNull();
      fireEvent.click(fold.querySelector('summary')!);
      expect(fold.open).toBe(true);
      const items = within(fold).getAllByRole('button');
      expect(items.map((b) => b.querySelector('.doc-name')?.textContent)).toEqual(['Workflow status', 'notes-extra.md']);
      fireEvent.click(items[0]);
      expect(await within(fold).findByText('Status: building step 3.')).toBeInTheDocument();
      fireEvent.click(within(fold).getByRole('button', { name: /All documents/ }));
      fireEvent.click(within(fold).getByRole('button', { name: /notes-extra\.md/ }));
      expect(await within(fold).findByText('Extra notes from the reviewer.')).toBeInTheDocument();
      expect(s.api.get).toHaveBeenCalledWith(`/api/job/${SLUG}/doc?file=notes-extra.md`);
      // The step's own documents are still its own.
      expect(within(own).getAllByRole('button').map((b) => b.querySelector('.doc-name')?.textContent)).toEqual(['Implementation plan', 'Test plan']);
      expect(screen.queryByRole('alert')).toBeNull();
      cleanup();
    }
  });

  it('no fold when the job has no other documents', () => {
    for (const otherDocs of [[], null, undefined]) {
      for (const hosted of [false, true]) {
        show(BUILD, { otherDocs, hosted });
        expect(screen.queryByText('Other documents of this job')).toBeNull();
        expect(screen.getByRole('region', { name: 'Documents from this step' })).toBeInTheDocument();
        cleanup();
      }
    }
  });

  it('a request opens its document in the list', async () => {
    const { wrap, api } = stores(BUILDING);
    const view = render(wrap(<StepDocs slug={SLUG} docs={[PLAN_DOC, TEST_PLAN]} />));
    expect(screen.getAllByRole('button')).toHaveLength(2);
    view.rerender(wrap(<StepDocs slug={SLUG} docs={[PLAN_DOC, TEST_PLAN]} request={{ n: 1, file: 'implementation-plan.md' }} />));
    expect(await screen.findByText('Step 1: the pause dialog.')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
    // The same request again does nothing new; a request with no file goes back to the list.
    view.rerender(wrap(<StepDocs slug={SLUG} docs={[PLAN_DOC, TEST_PLAN]} request={{ n: 1, file: 'implementation-plan.md' }} />));
    expect(api.get).toHaveBeenCalledTimes(1);
    view.rerender(wrap(<StepDocs slug={SLUG} docs={[PLAN_DOC, TEST_PLAN]} request={{ n: 2, file: null }} />));
    expect(screen.queryByText('Step 1: the pause dialog.')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    cleanup();
    render(stores(BUILDING).wrap(<StepDocs slug={SLUG} docs={[]} />));
    expect(screen.getByText('No documents from this step yet.')).toBeInTheDocument();
  });

  it('an open document stays with its step: a refresh keeps it, another step shows its own list', async () => {
    const { wrap } = stores(BUILDING);
    const PLAN: StageView = { ...BUILD, stop: 'plan', label: 'Plan', state: 'done', agents: [], docs: [TEST_PLAN] };
    const panel = (view: StageView, stop: StopId = view.stop) => wrap(<StepPanel job={BUILDING} stop={stop} view={view} error={null} onRetry={() => {}} now={NOW} />);
    const docs = () => screen.getByRole('region', { name: 'Documents from this step' });
    const view = render(panel(BUILD));
    fireEvent.click(within(docs()).getByRole('button', { name: /Implementation plan/ }));
    expect(await within(docs()).findByText('Step 1: the pause dialog.')).toBeInTheDocument();
    // The step's view refreshes (a new answer): the document stays open, the focus where it was.
    const focused = document.activeElement;
    view.rerender(panel({ ...BUILD, docs: [{ ...PLAN_DOC }, { ...TEST_PLAN }] }));
    expect(within(docs()).getByText('Step 1: the pause dialog.')).toBeInTheDocument();
    expect(document.activeElement).toBe(focused);
    // Another step: its own list, not Build's document.
    view.rerender(panel(PLAN));
    expect(within(docs()).queryByText('Step 1: the pause dialog.')).toBeNull();
    expect(within(docs()).getAllByRole('button').map((b) => b.querySelector('.doc-name')?.textContent)).toEqual(['Test plan']);
    // Back on Build: its list, not the document it had open.
    view.rerender(panel(BUILD));
    expect(within(docs()).queryByText('Step 1: the pause dialog.')).toBeNull();
    expect(within(docs()).getAllByRole('button')).toHaveLength(2);
  });

  it('a document request opens its file once; picking the step again does not reopen it; a new one does', async () => {
    const { wrap, api } = stores(BUILDING);
    const PLAN: StageView = { ...BUILD, stop: 'plan', label: 'Plan', state: 'done', agents: [], docs: [TEST_PLAN] };
    const ask = { n: 1, file: 'implementation-plan.md' };
    const panel = (view: StageView, docRequest?: { n: number; file: string | null }) => wrap(<StepPanel job={BUILDING} stop={view.stop} view={view} error={null} onRetry={() => {}} now={NOW} docRequest={docRequest} />);
    const docs = () => screen.getByRole('region', { name: 'Documents from this step' });
    const view = render(panel(BUILD, ask));
    expect(await within(docs()).findByText('Step 1: the pause dialog.')).toBeInTheDocument();
    const reads = () => api.get.mock.calls.filter(([p]) => String(p).includes('/doc?')).length;
    expect(reads()).toBe(1);
    fireEvent.click(within(docs()).getByRole('button', { name: /All documents/ }));
    // Plan, then Build again, with the same request still passed: Build's list.
    view.rerender(panel(PLAN, ask));
    expect(within(docs()).getAllByRole('button')).toHaveLength(1);
    view.rerender(panel(BUILD, ask));
    expect(within(docs()).queryByText('Step 1: the pause dialog.')).toBeNull();
    expect(within(docs()).getAllByRole('button')).toHaveLength(2);
    expect(reads()).toBe(1);
    // A new request opens it again.
    view.rerender(panel(BUILD, { n: 2, file: 'implementation-plan.md' }));
    expect(await within(docs()).findByText('Step 1: the pause dialog.')).toBeInTheDocument();
    expect(reads()).toBe(2);
  });

  it('Open docs is dropped when the step’s load fails: a later Try again never moves the focus', async () => {
    for (const hosted of [false, true]) {
      const { wrap } = stores(BUILDING, { hosted });
      const panel = (view: StageView | null, error: string | null) => wrap(<StepPanel job={BUILDING} stop="build" view={view} error={error} onRetry={() => {}} now={NOW} docRequest={{ n: 1, file: null }} />);
      const view = render(panel(null, null));
      // The load fails: the request waits no more.
      view.rerender(panel(null, 'Starbase isn’t answering'));
      expect(screen.getByRole('alert')).toBeInTheDocument();
      // He clicks elsewhere; Try again brings the step with its documents later: the focus stays.
      const elsewhere = document.createElement('button');
      document.body.append(elsewhere);
      elsewhere.focus();
      view.rerender(panel(BUILD, null));
      await act(async () => {});
      expect(within(screen.getByRole('region', { name: 'Documents from this step' })).getAllByRole('button')).toHaveLength(2);
      expect(elsewhere).toHaveFocus();
      elsewhere.remove();
      cleanup();
    }
  });

  it('Open docs waiting for a step’s answer is dropped when the job changes', async () => {
    const { wrap } = stores(BUILDING);
    const ask = { n: 1, file: null };
    const view = render(wrap(<StepDocs slug={SLUG} docs={[]} request={ask} loaded={false} />));
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    // Another job's list comes in, with the same request still passed: the focus stays.
    view.rerender(wrap(<StepDocs slug="another-job" docs={[PLAN_DOC, TEST_PLAN]} request={ask} loaded />));
    await act(async () => {});
    expect(document.querySelectorAll('.doc-item')).toHaveLength(2);
    expect(elsewhere).toHaveFocus();
    // The same job, as before: its answer takes the focus to its first document.
    view.rerender(wrap(<StepDocs slug="another-job" docs={[PLAN_DOC, TEST_PLAN]} request={{ n: 2, file: null }} loaded />));
    await act(async () => {});
    expect(document.activeElement).toBe(document.querySelector('.doc-item'));
    elsewhere.remove();
  });

  it('the step’s body sits after the feed, or first with bodyFirst', () => {
    const order = () => {
      const panel = screen.getByRole('tabpanel');
      const marks = [...panel.querySelectorAll('.sb-who h3, .sb-feed h3, .body-mark, .sb-panel-docs h3, .sb-not-yet')];
      return marks.map((m) => (m.classList.contains('body-mark') ? 'body' : m.textContent));
    };
    const s = stores(BUILDING);
    const panel = (view: StageView, bodyFirst?: boolean) => s.wrap(<StepPanel job={BUILDING} stop={view.stop} view={view} error={null} onRetry={() => {}} now={NOW} bodyFirst={bodyFirst}><p className="body-mark">Three kinds of test</p></StepPanel>);
    const view = render(panel(BUILD));
    expect(order()).toEqual(['Who worked on it', 'Live: what they’re doing', 'body', 'Documents from this step']);
    view.rerender(panel(BUILD, true));
    expect(order()).toEqual(['body', 'Who worked on it', 'Live: what they’re doing', 'Documents from this step']);
    // A step not reached: the not-yet line, then the body; nobody to list, so no who heading.
    const TEST: StageView = { ...BUILD, stop: 'test', label: 'Test', state: 'next', stateWords: 'Not yet', since: null, agents: [], finished: [], docs: [] };
    const line = 'Not yet. The Tester starts when the build is done. These three run then:';
    view.rerender(panel(TEST, true));
    expect(order()).toEqual([line, 'body', 'Documents from this step']);
    view.rerender(panel(TEST));
    expect(order()).toEqual(['Who will work on it', line, 'body', 'Documents from this step']);
  });

  it('a heading never stands alone: a step not reached with nobody to list draws no who heading', () => {
    const notYet: StageView = { ...BUILD, stop: 'test', label: 'Test', state: 'next', stateWords: 'Not yet', since: null, agents: [], finished: [], docs: [] };
    const s = stores(BUILDING);
    const panel = (bodyFirst: boolean, extraAgents?: StageAgent[]) => s.wrap(<StepPanel job={BUILDING} stop="test" view={notYet} error={null} onRetry={() => {}} now={NOW} bodyFirst={bodyFirst} extraAgents={extraAgents}><p>The step’s own body</p></StepPanel>);
    const view = render(panel(true));
    expect(screen.queryByRole('heading', { name: 'Who will work on it' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Who will work on it' })).toBeNull();
    expect(screen.getByText('Not yet. The Tester starts when the build is done. These three run then:')).toBeInTheDocument();
    expect(screen.getByText('The step’s own body')).toBeInTheDocument();
    // In the usual order the not-yet line sits under the heading, so the heading stays.
    view.rerender(panel(false));
    expect(within(who('Who will work on it')).getByText('Not yet. The Tester starts when the build is done. These three run then:')).toBeInTheDocument();
    // A row to list: the heading is back, with the row under it.
    view.rerender(panel(true, [agent('starbase-recorder', { role: 'Starbase', model: 'recorder', ref: 'recorder' })]));
    expect(who('Who will work on it').querySelectorAll('.sb-who-row')).toHaveLength(1);
  });

  it('an older answer never overwrites a newer one', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const answers: ((v: StageView) => void)[] = [];
    const { api, wrap } = stores(BUILDING, { get: () => new Promise((r) => { answers.push(r as (v: StageView) => void); }) });
    render(wrap(<Live stop="build" />));
    await act(async () => {});
    expect(stageCalls(api.get)).toBe(1);
    // Nothing answered yet: the next ask comes at 30 s.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(stageCalls(api.get)).toBe(2);
    // The second (newer) answers first, then the slow first one.
    await act(async () => { answers[1]({ ...BUILD, agents: [BUILD.agents[0], { ...BUILD.agents[1], doing: 'Writing step 4 of 6' }] }); });
    expect(screen.getByText('Writing step 4 of 6')).toBeInTheDocument();
    await act(async () => { answers[0](BUILD); });
    expect(screen.getByText('Writing step 4 of 6')).toBeInTheDocument();
    expect(screen.queryByText('Writing step 3 of 6')).toBeNull();
  });

  it('while a picked step loads the panel keeps its last height as a minimum, and drops it when the step shows', () => {
    // jsdom lays nothing out: the panel's measured height is a stub (640 px), the rest measure 0.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.classList.contains('sb-panel') ? 640 : 0, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
    try {
      const planView: StageView = { ...BUILD, stop: 'plan', label: 'Plan', agents: [], finished: [], docs: [] };
      for (const hosted of [false, true]) {
        const { wrap } = stores(BUILDING, { hosted });
        const panelOf = (stop: StopId, view: StageView | null, error: string | null = null) => wrap(
          <StepPanel job={BUILDING} stop={stop} view={view} error={error} onRetry={() => {}} now={NOW}>{view && <p>The step’s own body</p>}</StepPanel>,
        );
        const view = render(panelOf('build', BUILD));
        const panel = () => document.querySelector<HTMLElement>('.sb-panel')!;
        // The first draw holds nothing.
        expect(panel().style.minHeight).toBe('');
        // Another step picked: while its view loads the panel keeps the height it had.
        view.rerender(panelOf('plan', null));
        expect(within(panel()).getByText('Loading who worked on it…')).toBeInTheDocument();
        expect(panel().style.minHeight).toBe('640px');
        // The step shows: the minimum goes.
        view.rerender(panelOf('plan', planView));
        expect(panel().style.minHeight).toBe('');
        // A pick whose load fails: the error shows and the minimum goes.
        view.rerender(panelOf('build', null));
        expect(panel().style.minHeight).toBe('640px');
        view.rerender(panelOf('build', null, 'Starbase isn’t answering'));
        expect(within(panel()).getByRole('alert')).toBeInTheDocument();
        expect(panel().style.minHeight).toBe('');
        // Try again loads the same step again: no pick, so nothing is held.
        view.rerender(panelOf('build', null));
        expect(panel().style.minHeight).toBe('');
        // A step whose view is in at the pick (seen before) holds nothing.
        view.rerender(panelOf('plan', planView));
        expect(panel().style.minHeight).toBe('');
        cleanup();
      }

      // The phone's step screen is its own screen: nothing is held there.
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('760'), addEventListener() {}, removeEventListener() {} }));
      const { wrap } = stores(BUILDING);
      const view = render(wrap(<StepPanel job={BUILDING} stop="build" view={BUILD} error={null} onRetry={() => {}} now={NOW} />));
      view.rerender(wrap(<StepPanel job={BUILDING} stop="plan" view={null} error={null} onRetry={() => {}} now={NOW} />));
      expect(document.querySelector<HTMLElement>('.sb-panel')!.style.minHeight).toBe('');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('a pick made while another pick is loading keeps the first pick’s height as the minimum', () => {
    // jsdom lays nothing out. As a browser would: a panel with a minimum is at least that tall; else
    // a step that shows measures 640 px and a step still loading only its loading line, 120 px.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const min = parseFloat(this.style.minHeight) || 0;
      const own = this.classList.contains('sb-panel') ? (this.querySelector('.sb-who-row') ? 640 : 120) : 0;
      return { height: Math.max(min, own), width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
    try {
      const specView: StageView = { ...BUILD, stop: 'spec', label: 'Spec', agents: [], finished: [], docs: [] };
      const { wrap } = stores(BUILDING);
      const panelOf = (stop: StopId, view: StageView | null) => wrap(<StepPanel job={BUILDING} stop={stop} view={view} error={null} onRetry={() => {}} now={NOW} />);
      const panel = () => document.querySelector<HTMLElement>('.sb-panel')!;
      const view = render(panelOf('build', BUILD));
      // Build shows; Plan is picked and loads: Build's height is held.
      view.rerender(panelOf('plan', null));
      expect(panel().style.minHeight).toBe('640px');
      // Spec is picked while Plan still loads: still Build's height, never the loading line's.
      view.rerender(panelOf('spec', null));
      expect(panel().style.minHeight).toBe('640px');
      // Spec shows: the minimum goes.
      view.rerender(panelOf('spec', specView));
      expect(panel().style.minHeight).toBe('');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('an older good answer that lands after a newer failure is kept', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const asks: { ok(v: StageView): void; fail(e: Error): void }[] = [];
    const { api, wrap } = stores(BUILDING, { get: () => new Promise((ok, fail) => { asks.push({ ok: ok as (v: StageView) => void, fail }); }) });
    render(wrap(<Live stop="build" />));
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(stageCalls(api.get)).toBe(2);
    // The newer ask fails first: nothing good is in yet, so it says so.
    await act(async () => { asks[1].fail(new Error('Starbase isn’t answering')); });
    expect(within(who()).getByRole('alert')).toHaveTextContent('Couldn’t load this step: Starbase isn’t answering');
    // The older ask's good answer lands after it: kept, and the problem goes.
    await act(async () => { asks[0].ok(BUILD); });
    expect(screen.getByText('Writing step 3 of 6')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    // A failure older than a good answer already taken changes nothing.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(asks).toHaveLength(4);
    await act(async () => { asks[3].ok({ ...BUILD, agents: [BUILD.agents[0], { ...BUILD.agents[1], doing: 'Writing step 4 of 6' }] }); });
    await act(async () => { asks[2].fail(new Error('late')); });
    expect(screen.getByText('Writing step 4 of 6')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a step not reached says so', () => {
    const notYet = (stop: StopId, label: string) => ({ ...BUILD, stop, label, state: 'next' as const, stateWords: 'Not yet', since: null, agents: [], finished: [], docs: [] });
    show(notYet('test', 'Test'));
    expect(screen.getByRole('tabpanel', { name: 'Test' })).toHaveTextContent('Step 5 of 7');
    expect(within(who('Who will work on it')).getByText('Not yet. The Tester starts when the build is done. These three run then:')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Who worked on it' })).toBeNull();
    expect(screen.queryByRole('region', { name: /What they did last|Live: what they’re doing/ })).toBeNull();
    expect(screen.getByText('The step’s own body')).toBeInTheDocument();
    cleanup();
    show(notYet('review', 'Review'));
    expect(who('Who will work on it')).toHaveTextContent('Not yet. Four reviewers look at the change after the tests: spec, errors, tests and screens.');
    cleanup();
    show(notYet('ship', 'Ship'));
    expect(who('Who will work on it')).toHaveTextContent('Not yet. PR #1 opens after the review, with its own go-ahead. PR #2 and PR #3 follow, each with yours.');
    cleanup();
    const planning = job(SLUG, 'needs-you', { stage: 'plan', lane: 'needs-you', needsYou: true });
    show(notYet('build', 'Build'), { j: planning });
    expect(within(who('Who will work on it')).getByText('Not yet.')).toBeInTheDocument();
    cleanup();
    // Before its answer: the job already says it is not reached.
    show(null, { j: planning, stop: 'build' });
    expect(within(who('Who will work on it')).getByText('Not yet.')).toBeInTheDocument();
    expect(screen.queryByText('Loading who worked on it…')).toBeNull();
  });

  it('a step that can’t load says why and offers Try again, and the rest of the panel stays', async () => {
    let fail = true;
    const { api, wrap } = stores(BUILDING, { get: async () => { if (fail) throw new Error('Starbase isn’t answering'); return BUILD; } });
    render(wrap(<Live stop="build" />));
    // First visit: loading in the list's place.
    expect(within(who()).getByText('Loading who worked on it…')).toBeInTheDocument();
    expect(await within(who()).findByRole('alert')).toHaveTextContent('Couldn’t load this step: Starbase isn’t answering');
    const panel = screen.getByRole('tabpanel', { name: 'Build' });
    expect(panel).toHaveTextContent('Step 4 of 7');
    expect(within(panel).getByText('The step’s own body')).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: 'Documents from this step' })).toBeInTheDocument();
    fail = false;
    fireEvent.click(within(who()).getByRole('button', { name: 'Try again' }));
    expect(await within(who()).findByText('Writing step 3 of 6')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(stageCalls(api.get)).toBe(2);
  });

  it('on the website there is no terminal button', () => {
    const { api } = show(BUILD, { hosted: true });
    expect(rows()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /terminal/i })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Terminal app' })).toBeNull();
    expect(who()).toHaveTextContent('The terminal buttons are on your laptop.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('Starbase’s recorder row has no terminal button', () => {
    const recorder = agent('starbase-recorder', { role: 'Starbase', model: 'recorder', ref: 'recorder', doing: 'Recording evidence: line 4 of 19', terminal: { kind: 'watch', ready: false, why: 'Starbase records this itself.' } });
    show(BUILD, { extraAgents: [recorder] });
    const all = rows();
    const sb = all[all.length - 1];
    expect(sb.querySelector('.sb-who-role')).toHaveTextContent('Starbase');
    expect(within(sb).queryByRole('button')).toBeNull();
    expect(sb).not.toHaveTextContent('Starbase records this itself.');
    // Every other row keeps its own.
    expect(within(all[1]).getByRole('button', { name: /Watch in terminal/ })).toBeInTheDocument();
  });

  it('a stage view with no time, no documents and no feed still draws the panel', () => {
    const bare: StageView = {
      slug: SLUG, stop: 'build', label: 'Build', state: 'now', stateWords: 'Working now', since: null, stages: ['implement'],
      agents: [agent('conductor', { since: null, lastAt: null }), agent('feature-implementer', { since: null, lastAt: null, ref: 'c2.bbbbbbbb' })], finished: [], terminalApp: null, terminalApps: [],
    };
    show(bare);
    const panel = screen.getByRole('tabpanel', { name: 'Build' });
    expect(panel.querySelector('.sb-panel-head')).toHaveTextContent(/^BuildWorking nowStep 4 of 7$/);
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toHaveTextContent('Getting started');
    expect(screen.getByRole('region', { name: 'Live: what they’re doing' })).toHaveTextContent('BuilderOpus 5.5LiveNo actions to show yet.');
    expect(screen.getByText('The step’s own body')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Documents from this step' })).getByText('This step’s documents aren’t known yet.')).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/NaN|undefined|null/);
  });

  it('the steps row and the open step show the same time for a step: with no time known, neither shows one', () => {
    // A step with no span (an older laptop, a job started in a terminal), though its view has a start.
    const s = stores(BUILDING);
    render(s.wrap(
      <>
        <StepsRow job={BUILDING} times={{}} open="build" sent={null} now={NOW} onOpen={() => {}} />
        <StepPanel job={BUILDING} stop="build" view={{ ...BUILD, time: undefined, since: ago(12) }} error={null} onRetry={() => {}} now={NOW}><p>The step’s own body</p></StepPanel>
      </>,
    ));
    const tab = screen.getByRole('tab', { name: /^Build/ });
    expect(tab.querySelector('.sb-step-time')).toBeNull();
    expect(screen.getByRole('tabpanel', { name: 'Build' }).querySelector('.sb-panel-time')).toBeNull();
    cleanup();
    // With a span, both say the same.
    const t = stores(BUILDING);
    render(t.wrap(
      <>
        <StepsRow job={BUILDING} times={{ build: BUILD.time }} open="build" sent={null} now={NOW} onOpen={() => {}} />
        <StepPanel job={BUILDING} stop="build" view={BUILD} error={null} onRetry={() => {}} now={NOW}><p>The step’s own body</p></StepPanel>
      </>,
    ));
    const rowTime = screen.getByRole('tab', { name: /^Build/ }).querySelector('.sb-step-time')?.textContent;
    expect(rowTime).toBe('32 min so far');
    expect(screen.getByRole('tabpanel', { name: 'Build' }).querySelector('.sb-panel-time')?.textContent).toBe(rowTime);
  });

  it('documents not known say so; a known empty list says there are none yet', () => {
    const docs = () => screen.getByRole('region', { name: 'Documents from this step' });
    for (const hosted of [false, true]) {
      // A laptop older than the step's documents (no docs list), and a step that could not be read.
      show({ ...BUILD, docs: undefined }, { hosted });
      expect(docs()).toHaveTextContent('This step’s documents aren’t known yet.');
      expect(docs()).not.toHaveTextContent('No documents from this step yet.');
      cleanup();
      show(null, { hosted, error: 'Starbase isn’t answering' });
      expect(docs()).toHaveTextContent('This step’s documents aren’t known yet.');
      cleanup();
      show({ ...BUILD, docs: [] }, { hosted });
      expect(docs()).toHaveTextContent('No documents from this step yet.');
      cleanup();
    }
  });

  // Moved from the old step page's tests, which the job page replaced.
  it('the Foreman opens in a terminal, a crew member is watched read-only; one not ready says why', async () => {
    const tester = agent('feature-tester', { model: 'Sonnet 5.5', doing: 'Running the tests', ref: 'c3.cccccccc', terminal: { kind: 'watch', ready: false, why: 'Its log isn’t known yet.' } });
    const { api } = show({ ...BUILD, agents: [...BUILD.agents, tester], finished: [] });
    const [foreman, builder, notReady] = rows();
    expect(foreman).toHaveTextContent('Continues its session');
    expect(builder).toHaveTextContent('Read-only: follows its log');
    expect(within(notReady).getByRole('button', { name: /Watch in terminal/ })).toBeDisabled();
    expect(notReady).toHaveTextContent('Its log isn’t known yet.');
    fireEvent.click(within(foreman).getByRole('button', { name: /Open in terminal/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/api/job/${SLUG}/stage/build/terminal`, { ref: 'foreman' }));
    expect(await screen.findByText(/Opened the Foreman in iTerm\. Its session carries on there\./)).toBeInTheDocument();
  });

  // Moved from statusWords.test.ts (it read the step page's status words): status is never colour alone.
  it('each crew member’s status on a step has its own words', () => {
    show({
      ...BUILD,
      agents: [agent('feature-implementer', { ref: 'c1.aaaaaaaa' }), agent('feature-tester', { status: 'waiting', ref: 'c2.bbbbbbbb' })],
      finished: [agent('feature-planner', { status: 'done', ref: 'c3.cccccccc' }), agent('feature-reviewer', { status: 'stopped', ref: 'c4.dddddddd' })],
    });
    const words = rows().map((r) => r.querySelector('.sb-who-status')?.textContent ?? '');
    expect(words).toEqual(['Working', 'Waiting for you', 'Done', 'Stopped']);
    expect(new Set(words.map((w) => w.toLowerCase())).size).toBe(words.length);
  });

  // Moved from the step page's tests: Play full's bay, in 3D, above who worked on it (the plan's "the strip above the crew rows").
  it('the bay at this step shows only in Play full, above who worked on it', () => {
    show(BUILD, { play: 'full' });
    const band = screen.getByRole('region', { name: 'The bay at this stop' });
    expect(band.compareDocumentPosition(who()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    show(BUILD, { play: 'subtle' });
    expect(screen.queryByRole('region', { name: 'The bay at this stop' })).toBeNull();
  });
});
