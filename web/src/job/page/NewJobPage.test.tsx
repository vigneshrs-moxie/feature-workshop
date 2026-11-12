// The new job page on a laptop (Part 3, Task 15a): the header, the overview, the bar, seven steps with
// one open in place, and the conversation beside them. Which step is open (your pick, the address, the
// job's step, your last look), what you typed surviving a refresh, a pick and the job moving on, and
// the owner's one requirement: whichever step is open, a job that waits for you has Send back, Reply
// and Go on the bar, on an Auto job too. The setup is the Job page's (JobPage.test.tsx), with the
// step's view and the evidence added. Invented jobs only; no model calls, no browser, no network.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { EvidenceCriterion, EvidenceView, Gate, Job, JobDetail, JobDocEntry, Permission, StageView, StopId } from '../../api/types';
import { installKeyListener } from '../../app/keyRegistry';
import { useRoute } from '../../app/router';
import { UiProvider } from '../../app/ui';
import { STOPS } from '../../components/stops/stops';
import { clearAllSent } from '../../lib/sentState';
import { clearGateSent } from '../../panes/Foreman/gateSent';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { ev, job, permission, snapshot } from '../../state/test-fixtures';
import { NewJobPage } from './NewJobPage';

const NOW = new Date().toISOString();
const DOCS: JobDocEntry[] = [
  { file: 'implementation-plan.md', name: 'Implementation plan', group: 'plan', version: '2', updatedAt: NOW, size: 2048, type: 'md' },
];

const GATE: Gate = {
  briefNumber: 2, briefFile: 'briefs/002-plan.md', headline: 'Plan v2 ready', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
  questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: '2026-10-21T09:00:00Z', runActive: false, parked: false,
  level: 1, suggestedLevel: null, levelReason: null, usage: null,
};

const criterion = (n: number, status: EvidenceCriterion['status']): EvidenceCriterion => ({ id: `AC-${n}`, title: `Acceptance line ${n}.`, status, reason: null, spec: `evidence/specs/AC-${n}.spec.mjs`, screenshots: [], video: null });
const EVIDENCE: EvidenceView = {
  evidence: { version: 1, commit: 'abc1234def', at: NOW, level: 2, criteria: [criterion(1, 'passed'), criterion(2, 'failed')] },
  commit: 'abc1234def', wanted: true, why: 'This job records evidence.', recording: false, problem: null, folder: '/tmp/evidence', folderUrl: 'file:///tmp/evidence',
};
const RECORDING: EvidenceView = {
  ...EVIDENCE, evidence: null, recording: true, watch: true,
  progress: {
    commit: 'abc1234def', startedAt: NOW, line: 1, of: 3,
    lines: [
      { id: 'AC-1', title: 'Acceptance line 1.', state: 'running', video: null, at: NOW },
      { id: 'AC-2', title: 'Acceptance line 2.', state: 'waiting', video: null, at: null },
      { id: 'AC-3', title: 'Acceptance line 3.', state: 'waiting', video: null, at: null },
    ],
  },
};

/** One step's view, as GET /api/job/:slug/stage/:stop answers it. */
const stageView = (slug: string, stop: StopId): StageView => ({
  slug, stop, label: STOPS.find((s) => s.id === stop)!.label, state: 'done', stateWords: 'Done', since: null, stages: [],
  agents: [], finished: [], terminalApp: null, terminalApps: [], docs: [], checks: null, handTest: null, plan: null, prs: [], review: { reviewers: [] },
});

/** What the test's server knows (as in JobPage.test.tsx), and the evidence it answers. */
const server = { store: null as Store | null, answered: [] as number[], gate: undefined as Gate | null | undefined, evidence: EVIDENCE as EvidenceView };

const LAPTOP = 1280;
/** The window's width for useMinWidth and useNarrow (jsdom lays nothing out). */
function windowWidth(px: number) {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = (!min || px >= Number(min[1])) && (!max || px <= Number(max[1]));
    return { matches, media: q, addEventListener() {}, removeEventListener() {} };
  });
}

/** The page under the router, as App will mount it: the step's address is its `step`. */
function Routed({ slug }: { slug: string }) {
  const route = useRoute();
  return <NewJobPage slug={slug} step={route.name === 'stage' ? route.stop : undefined} view={route.name === 'job' ? route.view : undefined} />;
}

function setup({ jobs = [job('alpha', 'idle', { stage: 'plan' })], permissions = [] as Permission[], auto = null as JobDetail['auto'] | null, gate = null as Gate | null, slug = 'alpha', step = undefined as StopId | undefined, routed = false, evidence = EVIDENCE, post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true })) } = {}) {
  const store: Store = createStore();
  server.store = store;
  server.answered = [];
  server.gate = undefined;
  server.evidence = evidence;
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, permissions, meta: { token: 't', settings: { play: { mode: 'subtle' } }, models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }] } as never }) });
  const detail = (s: string): JobDetail => ({ slug: s, thread: [], threadMore: false, gate: server.gate === undefined ? gate : server.gate, answeredBriefs: [...server.answered], heldReply: null, options: { level: 1 }, auto } as JobDetail);
  const get = vi.fn(async (path: string): Promise<unknown> => {
    const stage = /^\/api\/job\/([^/]+)\/stage\/([a-z]+)$/.exec(path);
    if (stage) return stageView(decodeURIComponent(stage[1]), stage[2] as StopId);
    if (path.endsWith('/evidence')) return server.evidence;
    if (path.endsWith('/docs')) return { docs: DOCS };
    if (path.endsWith('/commits')) return { commits: [] };
    if (path.endsWith('/decisions')) return { decisions: [] };
    if (path.endsWith('/local')) return null;
    return detail(path.split('/')[3]);
  });
  const api = { get, post } as unknown as ApiClient;
  const page = routed ? <Routed slug={slug} /> : <NewJobPage slug={slug} step={step} />;
  const ui = (p = page) => <WorkshopContext.Provider value={{ store, api }}><UiProvider>{p}</UiProvider></WorkshopContext.Provider>;
  const utils = render(ui());
  /** The job as the next snapshot has it (the page fetches it again; nothing else changes). */
  const move = (next: Job[], perms: Permission[] = permissions) => act(() => {
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: next, permissions: perms, meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) });
  });
  return { ...utils, get, post, store, move, rerenderWith: (p: Parameters<typeof NewJobPage>[0]) => utils.rerender(ui(<NewJobPage {...p} />)) };
}

let off = () => {};
beforeEach(() => { off = installKeyListener(); windowWidth(LAPTOP); });
afterEach(() => { off(); cleanup(); localStorage.clear(); window.location.hash = ''; vi.useRealTimers(); vi.unstubAllGlobals(); });

const page = () => screen.getByRole('main', { name: 'Job' });
const bar = () => screen.getByRole('region', { name: 'Next step' });
/** The open step: its tab in the row. */
const openTab = () => screen.getByRole('tab', { selected: true });
const openStop = () => openTab().id.replace(/^sb-step-/, '');
const tabOf = (stop: StopId) => document.getElementById(`sb-step-${stop}`) as HTMLElement;
const pick = (stop: StopId) => fireEvent.click(tabOf(stop));
const stageCalls = (get: ReturnType<typeof vi.fn>, stop: StopId) => get.mock.calls.filter(([p]) => p === `/api/job/alpha/stage/${stop}`).length;
const working = (stage: string, extra: Partial<Job> = {}) => job('alpha', 'running', { stage, lane: 'working', ...extra });
const waiting = (extra: Partial<Job> = {}) => [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', waitingFor: 'approval', headline: 'The plan is ready. Start building?', ...extra })];

describe('the new job page on a laptop', () => {
  it('the page is the header, the overview, the bar, seven steps with one open, and the conversation', async () => {
    setup({ jobs: [working('plan')] });
    const main = page();
    expect(main).toHaveClass('page', 'page-job');
    const top = main.querySelector<HTMLElement>('.sb-job-top')!;
    expect(within(top).getByRole('heading', { name: 'Job alpha' })).toBeInTheDocument();
    expect(main.querySelectorAll('h1').length).toBeLessThanOrEqual(1);
    // Two scroll areas under the header: the work column and the conversation column.
    const work = main.querySelector<HTMLElement>('.sb-job-work')!;
    const talk = main.querySelector<HTMLElement>('.sb-job-talk')!;
    expect(top.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(talk).not.toHaveAttribute('hidden');
    // The work column: the overview, the bar, the steps row, the open step, in that order.
    const overview = within(work).getByText('Overview').closest('details')!;
    const next = within(work).getByRole('region', { name: 'Next step' });
    const row = within(work).getByRole('tablist', { name: 'The job’s seven steps' });
    const tabs = within(row).getAllByRole('tab');
    expect(tabs).toHaveLength(7);
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    const panel = within(work).getByRole('tabpanel', { name: 'Plan' });
    for (const [a, b] of [[overview, next], [next, row], [row, panel]]) expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(openStop()).toBe('plan');
    // The open step's body comes once its view is in.
    await within(panel).findByText('Documents from this step');
    // The conversation with its message box, in its own column.
    const convo = talk.querySelector<HTMLElement>('.sb-convo')!;
    expect(convo).toHaveAccessibleName('Conversation');
    expect(within(convo).getByRole('textbox', { name: /Your message to the Foreman/ })).toBeInTheDocument();
    expect(work.contains(convo)).toBe(false);
    // One of each.
    expect(document.querySelectorAll('.sb-convo')).toHaveLength(1);
    expect(screen.getAllByRole('region', { name: 'Next step' })).toHaveLength(1);
    expect(screen.getAllByRole('tablist', { name: 'The job’s seven steps' })).toHaveLength(1);
  });

  it('below 1100 px the conversation column is hidden, and the conversation stays mounted', () => {
    windowWidth(1024);
    setup({ jobs: [working('plan')] });
    const talk = page().querySelector<HTMLElement>('.sb-job-talk')!;
    expect(talk).toHaveAttribute('hidden');
    expect(talk.querySelector('.sb-convo')).not.toBeNull();
  });

  it('a job that isn’t there says so', () => {
    setup({ slug: 'nobody' });
    expect(screen.getByText(/There’s no job called “nobody”/)).toBeInTheDocument();
  });
});

describe('the open step', () => {
  it('it opens the step the job is working at; picking another puts it in the address and it stays when the job moves on', async () => {
    const { move } = setup({ jobs: [working('plan')] });
    expect(openStop()).toBe('plan');
    pick('spec');
    expect(openStop()).toBe('spec');
    expect(screen.getByRole('tabpanel', { name: 'Spec' })).toBeInTheDocument();
    expect(window.location.hash).toMatch(/\/stage\/spec$/);
    expect(localStorage.getItem('sb.job.step.alpha')).toBe('spec');
    // The job moves on to Test: the step you picked stays open.
    move([working('test')]);
    await act(async () => {});
    expect(openStop()).toBe('spec');
    expect(tabOf('test')).toHaveAccessibleName(/^Test: Working now/);
  });

  it('a pick is not undone by the address prop it wrote', async () => {
    window.location.hash = '#/job/alpha/stage/test';
    setup({ jobs: [working('plan')], routed: true });
    expect(openStop()).toBe('test');
    pick('spec');
    // Only the address changed (no hashchange): the router still says test, and Spec stays open.
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(window.location.hash).toBe('#/job/alpha/stage/spec');
    expect(openStop()).toBe('spec');
  });

  it('with no pick the open step follows the job', async () => {
    const { move } = setup({ jobs: [working('plan')] });
    expect(openStop()).toBe('plan');
    move([working('implement')]);
    expect(openStop()).toBe('build');
    move([job('alpha', 'needs-you', { stage: 'test', lane: 'needs-you', waitingFor: 'approval' })]);
    expect(openStop()).toBe('test');
  });

  it('a job at rest opens the step you last opened on it, else its own step', () => {
    localStorage.setItem('sb.job.step.alpha', 'review');
    setup({ jobs: [job('alpha', 'done', { stage: 'pr1', lane: 'done' })] });
    expect(openStop()).toBe('review');
    cleanup();
    localStorage.setItem('sb.job.step.alpha', 'not-a-step');
    setup({ jobs: [job('alpha', 'done', { stage: 'pr1', lane: 'done' })] });
    expect(openStop()).toBe('ship');
  });

  it('storage that throws never breaks the page', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage is off'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage is off'); });
    try {
      setup({ jobs: [working('plan')] });
      expect(openStop()).toBe('plan');
      pick('build');
      expect(openStop()).toBe('build');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('the step page’s address opens the job page on that step', () => {
    setup({ jobs: [working('plan')], step: 'review' });
    expect(openStop()).toBe('review');
    cleanup();
    window.location.hash = '#/job/alpha/stage/investigate';
    setup({ jobs: [working('plan')], routed: true });
    expect(openStop()).toBe('investigate');
  });

  it('a hashchange to another step’s address opens that step', async () => {
    window.location.hash = '#/job/alpha/stage/spec';
    setup({ jobs: [working('plan')], routed: true });
    expect(openStop()).toBe('spec');
    pick('build');
    expect(openStop()).toBe('build');
    // A link or Back: the address changes with a hashchange, and that step opens.
    act(() => { window.location.hash = '#/job/alpha/stage/ship'; });
    await waitFor(() => expect(openStop()).toBe('ship'));
    // The job's own address (no step) leaves the open step as it is.
    act(() => { window.location.hash = '#/job/alpha'; });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(openStop()).toBe('ship');
  });

  it('a step prop that is not a step is ignored', () => {
    setup({ jobs: [working('plan')], step: 'nowhere' as StopId });
    expect(openStop()).toBe('plan');
  });

  it('just after a pick the panel shows the new step loading, never the old step’s facts', async () => {
    const { get } = setup({ jobs: [working('plan')] });
    const panel = screen.getByRole('tabpanel', { name: 'Plan' });
    await waitFor(() => expect(panel.querySelector('.sb-step-body')).not.toBeNull());
    // The Spec step's answer never comes in this test.
    const answer = get.getMockImplementation()!;
    get.mockImplementation((path: string) => (path.endsWith('/stage/spec') ? new Promise(() => {}) : answer(path)));
    pick('spec');
    const now = screen.getByRole('tabpanel', { name: 'Spec' });
    expect(within(now).getByText('Loading who worked on it…')).toBeInTheDocument();
    // No body at all while it loads: neither the Plan step's nor one for Spec.
    expect(now.querySelector('.sb-step-body')).toBeNull();
    // The panel is the same panel: it was not drawn again from scratch.
    expect(now).toBe(panel);
  });
});

describe('what you typed stays', () => {
  it('what you typed in What should change? is still there after the open step’s feed refreshes and after you pick another step', async () => {
    const { get, store, move } = setup({ jobs: waiting(), gate: GATE });
    fireEvent.click(await screen.findByRole('button', { name: /^No go: send back/ }));
    const box = await screen.findByRole('textbox', { name: /What should change\?/ });
    fireEvent.change(box, { target: { value: 'Use the small table.' } });
    // The job is fetched again and the open step's feed refreshes.
    const before = stageCalls(get, 'plan');
    move(waiting({ updatedAt: new Date(Date.now() + 1000).toISOString() }));
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(stageCalls(get, 'plan')).toBeGreaterThan(before));
    await act(async () => {});
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toBe(box);
    expect(box).toHaveValue('Use the small table.');
    // You pick another step.
    pick('spec');
    await act(async () => {});
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toBe(box);
    expect(box).toHaveValue('Use the small table.');
  });

  it('words in the message box survive picking a step and the job moving on', async () => {
    const { move } = setup({ jobs: [working('plan')] });
    const box = screen.getByRole('textbox', { name: /Your message to the Foreman/ });
    fireEvent.change(box, { target: { value: 'Keep the icon small.' } });
    pick('review');
    move([working('implement')]);
    await act(async () => {});
    expect(screen.getByRole('textbox', { name: /Your message to the Foreman/ })).toBe(box);
    expect(box).toHaveValue('Keep the icon small.');
  });

  it('a permission card that comes and goes keeps What should change? open with its words', async () => {
    const ask: Permission = { ...permission('p1', 'alpha'), createdAt: '2026-10-21T10:00:00Z', input: { command: 'npm test' } };
    const { move, post } = setup({ jobs: waiting(), gate: GATE });
    fireEvent.click(await screen.findByRole('button', { name: /^No go: send back/ }));
    const box = await screen.findByRole('textbox', { name: /What should change\?/ });
    fireEvent.change(box, { target: { value: 'Use the small table.' } });
    // A permission waits: its card takes the bar's place; the gate card is only hidden.
    move(waiting(), [ask]);
    const alert = screen.getByRole('region', { name: 'Permission: Run a command' });
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
    expect(box.isConnected).toBe(true);
    expect(box.closest('[hidden]')).not.toBeNull();
    // The hidden card answers no keys: r would have closed its box.
    fireEvent.keyDown(document.body, { key: 'r' });
    fireEvent.click(within(alert).getByRole('button', { name: /^Allow once/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/p1', expect.objectContaining({ decision: 'allow' })));
    // Answered: the bar and its three calls are back, with the open box and its words.
    move(waiting(), []);
    expect(within(bar()).getByRole('button', { name: /^No go: send back/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toBe(box);
    expect(box).toHaveValue('Use the small table.');
    expect(box.closest('[hidden]')).toBeNull();
  });
});

// The owner's one requirement (2026-11-11): a button to send his approval or changes, whenever it waits.
describe('the bar on every step', () => {
  const STOPPED = { on: true, by: 'you' as const, ran: true, stopped: { reason: 'a database change needs you.', rule: 'database', at: NOW } };
  const AUTO_STATES: [string, Job][] = [
    ['Auto on', job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', level: 1, waitingFor: 'approval', auto: { on: true, by: 'you', ran: true } })],
    ['Auto deciding', job('alpha', 'running', { stage: 'plan', lane: 'working', level: 1, waitingFor: 'approval', laneReason: 'Auto is deciding: the plan', auto: { on: true, by: 'you', ran: true } })],
    ['Auto stopped', job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', level: 1, waitingFor: 'approval', laneReason: 'Auto stopped: a database change needs you.', auto: STOPPED })],
  ];

  it.each(AUTO_STATES)('whichever step is open, a job that waits for you has Send back, Reply and Go on the bar, on an Auto job too (%s)', async (_name, j) => {
    setup({ jobs: [j], gate: GATE, auto: { on: true, tag: null } });
    await screen.findByRole('button', { name: /^Go: approve/ });
    for (const s of STOPS) {
      pick(s.id);
      expect(openStop()).toBe(s.id);
      await waitFor(() => {
        const calls = within(bar()).getAllByRole('button').map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
        expect(calls).toEqual([expect.stringMatching(/^No go: send back/), 'Reply', expect.stringMatching(/^Go: approve/)]);
        for (const b of within(bar()).getAllByRole('button')) expect(b).toBeEnabled();
      });
    }
  });

  it('after Go the header reads Sent and the step reads Approved; after Send back the step keeps its own words', async () => {
    let n = 0;
    const sentPost = vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
      if (path !== '/api/job/alpha/gate') return { ok: true };
      const b = (body ?? {}) as { kind?: string; briefNumber?: number | null };
      if ((b.kind === 'approve' || b.kind === 'changes') && typeof b.briefNumber === 'number') server.answered.push(b.briefNumber);
      const run = { id: `r_sent_${++n}`, slug: 'alpha', status: 'running' };
      server.store?.dispatch({ type: 'event', event: ev(100 + n, 'run', 'alpha', run) });
      return { ok: true, sent: true, text: 'sent', run };
    });
    const chip = () => page().querySelector('.sb-job-top .state-chip');
    const panelChip = () => screen.getByRole('tabpanel', { name: 'Plan' }).querySelector('.sb-panel-head .sb-step-chip');

    setup({ jobs: waiting(), gate: GATE, post: sentPost });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText('Sent. Waiting for the Foreman to start.');
    await waitFor(() => expect(chip()).toHaveTextContent('Sent'));
    expect(tabOf('plan')).toHaveAccessibleName(/^Plan: Approved/);
    expect(panelChip()).toHaveTextContent('Approved');
    // A new page on the same job: the decision sent above is not out any more.
    cleanup();
    clearAllSent();
    clearGateSent();

    setup({ jobs: waiting(), gate: GATE, post: sentPost });
    fireEvent.click(await screen.findByRole('button', { name: /^No go: send back/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: /What should change\?/ }), { target: { value: 'Use the small table.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    await within(bar()).findByText('Sent. Waiting for the Foreman to start.');
    await waitFor(() => expect(chip()).toHaveTextContent('Sent'));
    expect(tabOf('plan')).toHaveAccessibleName(/^Plan: Waiting for you/);
    expect(panelChip()).toHaveTextContent('Waiting for you');
  });
});

describe('the Test step and the evidence', () => {
  const RECORDING_JOB = (extra: Partial<Job> = {}) => job('alpha', 'running', { stage: 'test', lane: 'working', testing: 'Recording evidence: line 1 of 3', ...extra });
  const evidenceCalls = (get: ReturnType<typeof vi.fn>) => get.mock.calls.filter(([p]) => p === '/api/job/alpha/evidence').length;

  it('with the page mounted and a recording running, one request per 3 s goes to the evidence route, not three', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    // The test gate waits too, so the gate card's folded strip is on the page as well.
    const { get } = setup({ jobs: [RECORDING_JOB({ lane: 'needs-you', waitingFor: 'approval' })], gate: { ...GATE, stage: 'test' }, evidence: RECORDING });
    for (let i = 0; i < 5; i++) await act(async () => {});
    expect(openStop()).toBe('test');
    expect(document.querySelector('.gate-evidence.is-fold')).not.toBeNull();
    // The Test step's own strip, open.
    fireEvent.click(screen.getByRole('button', { name: 'Each line and its video' }));
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(document.querySelectorAll('.gate-evidence')).toHaveLength(2);
    const before = evidenceCalls(get);
    for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(evidenceCalls(get) - before).toBe(3);
  });

  it('the Test step asks for the evidence again the moment a recording starts', async () => {
    const { get, move } = setup({ jobs: [job('alpha', 'running', { stage: 'test', lane: 'working' })], evidence: EVIDENCE });
    const row = await screen.findByRole('article', { name: 'Recorded evidence' });
    await waitFor(() => expect(evidenceCalls(get)).toBe(1));
    server.evidence = RECORDING;
    move([RECORDING_JOB()]);
    await waitFor(() => expect(evidenceCalls(get)).toBe(2));
    await waitFor(() => expect(row.querySelector('.sb-test-chip')).toHaveTextContent('Running, line 1 of 3'));
  });

  it('Watch on the bar opens the Test step watching; it is off again once the recording ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, blob: async () => new Blob([]) })));
    const { get } = setup({ jobs: [RECORDING_JOB()], evidence: RECORDING });
    pick('spec');
    await waitFor(() => expect(evidenceCalls(get)).toBeGreaterThan(0));
    fireEvent.click(await within(bar()).findByRole('button', { name: 'Watch' }));
    expect(openStop()).toBe('test');
    const row = await screen.findByRole('article', { name: 'Recorded evidence' });
    expect(await within(row).findByRole('button', { name: 'Stop watching' })).toBeInTheDocument();
    // The recording ends (the next ask, 3 s on), then another starts: it starts unwatched.
    server.evidence = EVIDENCE;
    act(() => { vi.advanceTimersByTime(3_000); });
    await waitFor(() => expect(within(row).queryByRole('button', { name: /Stop watching|Watch/ })).toBeNull());
    server.evidence = RECORDING;
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(await within(row).findByRole('button', { name: 'Watch' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Stop watching' })).toBeNull();
  });
});
