// The job page on a laptop (Part 3): the header, the overview, the bar, seven steps with
// one open in place, and the conversation beside them. Which step is open (your pick, the address, the
// job's step, your last look), what you typed surviving a refresh, a pick and the job moving on, and
// the owner's one requirement: whichever step is open, a job that waits for you has Send back, Reply
// and Go on the bar, on an Auto job too. The setup is the one the old job page's tests had, with the
// step's view and the evidence added. Invented jobs only; no model calls, no browser, no network.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { EvidenceCriterion, EvidenceView, Gate, Job, JobDetail, JobDoc, JobDocEntry, Permission, StageView, StopId, ThreadItem } from '../../api/types';
import { BRAND } from '../../app/brand';
import { DETAIL_KEY } from '../../app/detail';
import { installKeyListener } from '../../app/keyRegistry';
import { useRoute, type JobView } from '../../app/router';
import { UiProvider, useUi } from '../../app/ui';
import { STOPS } from '../../components/stops/stops';
import { clearAllSent } from '../../lib/sentState';
import { writeStored } from '../../lib/stored';
import { clearGateSent } from '../../panes/Foreman/gateSent';
import { ServerHtml } from '../../panes/Foreman/ServerHtml';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { ev, job, permission, snapshot } from '../../state/test-fixtures';
import type { QueuedView } from '../../views/Hosted/QueuedDecision';
import { seenKey } from './ConversationPanel';
import { MENU_ON_LAPTOP } from './JobTop';
import { JobPage } from './JobPage';
import { BUILDING_NOT_WRITTEN, NO_TICKET } from './OverviewCard';
import { CHECK_NOT_WRITTEN } from './WhatToCheck';

const NOW = new Date().toISOString();
const DOCS: JobDocEntry[] = [
  { file: 'implementation-plan.md', name: 'Implementation plan', group: 'plan', version: '2', updatedAt: NOW, size: 2048, type: 'md' },
];
const docOf = (file: string): JobDoc => ({ file, name: file === 'implementation-plan.md' ? 'Implementation plan' : file, type: 'md', html: `<p>${file} body</p>`, text: file, updatedAt: NOW, size: 10 });

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

/**
 * What the test's server knows, and the evidence it answers. `fail`: the
 * job's details can't be read while it is set.
 */
const server = {
  store: null as Store | null, answered: [] as number[], gate: undefined as Gate | null | undefined, held: null as JobDetail['heldReply'], drive: undefined as JobDetail['drive'] | undefined,
  evidence: EVIDENCE as EvidenceView, fail: false, thread: [] as ThreadItem[],
};

const LAPTOP = 1280;
/** The window's width for useMinWidth and useNarrow (jsdom lays nothing out); resizeTo tells them it changed. */
const media = { width: LAPTOP, heard: new Set<() => void>() };
function windowWidth(px: number) {
  media.width = px;
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = (!min || media.width >= Number(min[1])) && (!max || media.width <= Number(max[1]));
    return { matches, media: q, addEventListener(_: string, fn: () => void) { media.heard.add(fn); }, removeEventListener(_: string, fn: () => void) { media.heard.delete(fn); } };
  });
}
const resizeTo = (px: number) => act(() => { media.width = px; for (const fn of [...media.heard]) fn(); });

/** The page under the router, as App will mount it: the step's address is its `step`. */
function Routed({ slug }: { slug: string }) {
  const route = useRoute();
  return <JobPage slug={slug} step={route.name === 'stage' ? route.stop : undefined} view={route.name === 'job' ? route.view : undefined} />;
}

function setup({
  jobs = [job('alpha', 'idle', { stage: 'plan' })], permissions = [] as Permission[], auto = null as JobDetail['auto'] | null, gate = null as Gate | null, slug = 'alpha',
  step = undefined as StopId | undefined, view = undefined as JobView | undefined, routed = false, evidence = EVIDENCE, play = 'subtle', drive = null as JobDetail['drive'],
  hosted = false, extra = null as ReactNode, thread = [] as ThreadItem[], more = {} as Partial<JobDetail>, stageOf = stageView, fail = false,
  post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true })),
} = {}) {
  const store: Store = createStore();
  server.store = store;
  server.answered = [];
  server.gate = undefined;
  server.held = null;
  server.drive = undefined;
  server.evidence = evidence;
  server.fail = fail;
  server.thread = thread;
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, permissions, meta: { token: 't', settings: { play: { mode: play } }, models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }] } as never }) });
  const detail = (s: string): JobDetail => ({
    slug: s, thread: server.thread, threadMore: false, gate: server.gate === undefined ? gate : server.gate, answeredBriefs: [...server.answered], heldReply: server.held, options: { level: 1 }, auto,
    drive: server.drive === undefined ? drive : server.drive, ...more,
  } as JobDetail);
  const get = vi.fn(async (path: string): Promise<unknown> => {
    const stage = /^\/api\/job\/([^/]+)\/stage\/([a-z]+)$/.exec(path);
    if (stage) return stageOf(decodeURIComponent(stage[1]), stage[2] as StopId);
    if (path.endsWith('/evidence')) return server.evidence;
    if (path.endsWith('/docs')) return { docs: DOCS };
    const doc = /\/doc\?file=(.+)$/.exec(path);
    if (doc) return docOf(decodeURIComponent(doc[1]));
    if (path.endsWith('/commits')) return { commits: [] };
    if (path.endsWith('/decisions')) return { decisions: [] };
    if (path.endsWith('/local')) return null;
    if (server.fail) throw new ApiError(503, 'The laptop is away.');
    return detail(path.split('/')[3]);
  });
  const api = { get, post, ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
  const page = routed ? <Routed slug={slug} /> : <JobPage slug={slug} step={step} view={view} />;
  const ui = (p = page) => <WorkshopContext.Provider value={{ store, api }}><UiProvider>{extra}{p}</UiProvider></WorkshopContext.Provider>;
  const utils = render(ui());
  /** The job as the next snapshot has it (the page fetches it again; nothing else changes). */
  const move = (next: Job[], perms: Permission[] = permissions) => act(() => {
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: next, permissions: perms, meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) });
  });
  return { ...utils, get, post, store, move, rerenderWith: (p: Parameters<typeof JobPage>[0]) => utils.rerender(ui(<JobPage {...p} />)) };
}

let off = () => {};
beforeEach(() => { off = installKeyListener(); windowWidth(LAPTOP); });
afterEach(() => { off(); cleanup(); localStorage.clear(); window.location.hash = ''; vi.useRealTimers(); vi.unstubAllGlobals(); media.heard.clear(); });

const page = () => screen.getByRole('main', { name: 'Job' });
const bar = () => screen.getByRole('region', { name: 'Next step' });
/** The open step: its tab in the row. */
const openTab = () => screen.getByRole('tab', { selected: true, hidden: true });
const openStop = () => openTab().id.replace(/^sb-step-/, '');
const tabOf = (stop: StopId) => document.getElementById(`sb-step-${stop}`) as HTMLElement;
const pick = (stop: StopId) => fireEvent.click(tabOf(stop));
const stageCalls = (get: ReturnType<typeof vi.fn>, stop: StopId) => get.mock.calls.filter(([p]) => p === `/api/job/alpha/stage/${stop}`).length;
const working = (stage: string, extra: Partial<Job> = {}) => job('alpha', 'running', { stage, lane: 'working', ...extra });
const waiting = (extra: Partial<Job> = {}) => [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', waitingFor: 'approval', headline: 'The plan is ready. Start building?', ...extra })];

describe('the job page on a laptop', () => {
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
    const overview = (await within(work).findByText('Overview')).closest('details')!;
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
    // The address changed in place (no hashchange, no history entry); the route follows it, and Spec stays open.
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

  // Final review A5: reading inside the open step is a pick of that step.
  it('a commit opened in Build stays open when the job moves on to Test', async () => {
    const { get, move } = setup({ jobs: [working('implement')] });
    const answer = get.getMockImplementation()!;
    get.mockImplementation((path: string) => {
      if (path.endsWith('/commits')) return Promise.resolve({ head: 'feature/x', commits: [{ sha: 'b'.repeat(40), short: '7d03b18', author: 'Ann', date: NOW, subject: 'Leave paused visits off the route', files: [] }] });
      if (path.includes('/commit/')) return Promise.resolve({ files: [], patchFiles: [{ path: 'src/route.ts', lines: ['@@ -1 +1 @@', '-old', '+new'] }], truncated: false });
      return answer(path);
    });
    expect(openStop()).toBe('build');
    const panel = screen.getByRole('tabpanel', { name: 'Build' });
    fireEvent.click(await within(panel).findByRole('button', { name: /Leave paused visits off the route/ }));
    expect(await within(panel).findByText('src/route.ts')).toBeInTheDocument();
    // As a click on its tab: the address and the last step opened.
    expect(window.location.hash).toBe('#/job/alpha/stage/build');
    move([working('test')]);
    await act(async () => {});
    expect(openStop()).toBe('build');
    expect(within(screen.getByRole('tabpanel', { name: 'Build' })).getByText('src/route.ts')).toBeInTheDocument();
  });

  it('a key press inside the open step counts as picking it too', async () => {
    const { move } = setup({ jobs: [working('plan')] });
    const panel = screen.getByRole('tabpanel', { name: 'Plan' });
    await waitFor(() => expect(panel.querySelector('.sb-step-body')).not.toBeNull());
    fireEvent.keyDown(panel.querySelector('.sb-step-body')!, { key: 'Tab' });
    move([working('implement')]);
    expect(openStop()).toBe('plan');
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
const STOPPED = { on: true, by: 'you' as const, ran: true, stopped: { reason: 'a database change needs you.', rule: 'database', at: NOW } };
/** A job that waits for you at the plan, with Auto on, deciding, and stopped. */
const AUTO_STATES: [string, Job][] = [
  ['Auto on', job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', level: 1, waitingFor: 'approval', auto: { on: true, by: 'you', ran: true } })],
  ['Auto deciding', job('alpha', 'running', { stage: 'plan', lane: 'working', level: 1, waitingFor: 'approval', laneReason: 'Auto is deciding: the plan', auto: { on: true, by: 'you', ran: true } })],
  ['Auto stopped', job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', level: 1, waitingFor: 'approval', laneReason: 'Auto stopped: a database change needs you.', auto: STOPPED })],
];

describe('the bar on every step', () => {
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
    await within(bar()).findByText('Sent. The Foreman is at work on it.');
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
    await within(bar()).findByText('Sent. The Foreman is at work on it.');
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
    // Only the test moves the clock (no real time slips in under load); each step lets every answer in.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, blob: async () => new Blob([]) })));
    const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); for (let i = 0; i < 5; i++) await act(async () => {}); };
    const { get } = setup({ jobs: [RECORDING_JOB()], evidence: RECORDING });
    pick('spec');
    await settle();
    expect(evidenceCalls(get)).toBeGreaterThan(0);
    fireEvent.click(within(bar()).getByRole('button', { name: 'Watch' }));
    expect(openStop()).toBe('test');
    await settle();
    const row = screen.getByRole('article', { name: 'Recorded evidence' });
    expect(within(row).getByRole('button', { name: 'Stop watching' })).toBeInTheDocument();
    // The recording ends (the next ask, 3 s on), then another starts: it starts unwatched.
    server.evidence = EVIDENCE;
    await settle(3_000);
    expect(within(row).queryByRole('button', { name: /Stop watching|Watch/ })).toBeNull();
    server.evidence = RECORDING;
    await settle(30_000);
    expect(within(row).getByRole('button', { name: 'Watch' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Stop watching' })).toBeNull();
  });
});

// ---------- Task 15b: the page's keys and requests, Widen, windows under 1100 px, errors, the website ----------

/** Shown: neither it nor anything around it is hidden. */
const shown = (el: Element | null) => Boolean(el) && el!.closest('[hidden]') === null;
const steps = () => screen.getByRole('tablist', { name: 'The job’s seven steps', hidden: true });
const convo = () => document.querySelector<HTMLElement>('.sb-convo')!;
const messageBox = () => screen.getByRole('textbox', { name: /Your message to the Foreman/, hidden: true });
const words = (b: HTMLElement) => b.textContent?.replace(/\s+/g, ' ').trim();
/** The owner's one requirement: the bar is shown with No go: send back, Reply and Go, each enabled. */
async function expectTheThreeCalls() {
  await waitFor(() => {
    expect(shown(bar())).toBe(true);
    const calls = within(bar()).getAllByRole('button');
    expect(calls.map(words)).toEqual([expect.stringMatching(/^No go: send back/), 'Reply', expect.stringMatching(/^Go: approve/)]);
    for (const b of calls) expect(b).toBeEnabled();
  });
}
/** Detail set to Simple, the app's own default (tests start in Full, where every fold starts open). */
const simple = () => localStorage.setItem(DETAIL_KEY, 'simple');
/** The brief under the bar folded to one row. */
const briefRow = () => screen.getByRole('button', { name: /^The brief/ });
/** The conversation takes the page: Widen from 1100 px, the Conversation button under it. */
type Takes = 'widened' | 'full screen';
function takePage(how: Takes) {
  fireEvent.click(screen.getByRole('button', { name: how === 'widened' ? 'Widen' : /^Conversation/ }));
  expect(page()).toHaveClass(how === 'widened' ? 'is-wide' : 'is-full');
}
const ASK: Permission = { ...permission('p1', 'alpha'), createdAt: '2026-10-21T10:00:00Z', input: { command: 'npm test' } };
/** A job Auto stopped with no gate (a status card): the bar has Reply only. */
const STOPPED_NO_GATE = () => [job('alpha', 'needs-you', { stage: 'build', lane: 'needs-you', level: 1, laneReason: 'Auto stopped: a database change needs you.', headline: 'Which table?', auto: STOPPED })];

/** The full-screen and widened cases each layout test runs. */
function layoutCases(how: Takes) {
  const width = how === 'widened' ? LAPTOP : 1024;
  it(`${how}: with Detail set to Full the card is still one row, and its row does not send you to the job’s page`, async () => {
    windowWidth(width);
    setup({ jobs: waiting(), gate: GATE });
    await screen.findByRole('button', { name: /^Go: approve/ });
    takePage(how);
    expect(briefRow()).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.job-gate-body')).toHaveAttribute('hidden');
    expect(briefRow()).toHaveTextContent('its questions and details; Go sends the answers picked in it');
    expect(briefRow()).not.toHaveTextContent('also on the job’s page');
    // Opened here, it is open here only: the stop pages' remembered choice is not touched.
    fireEvent.click(briefRow());
    expect(document.querySelector('.job-gate-body')).not.toHaveAttribute('hidden');
    expect(localStorage.getItem('workshop.shown.stage')).toBeNull();
    await expectTheThreeCalls();
  });

  it(`${how} with What should change? open keeps the box and its words in sight`, async () => {
    windowWidth(width);
    simple();
    setup({ jobs: waiting(), gate: GATE });
    fireEvent.click(await screen.findByRole('button', { name: /^No go: send back/ }));
    const box = await screen.findByRole('textbox', { name: /What should change\?/ });
    fireEvent.change(box, { target: { value: 'Use the small table.' } });
    takePage(how);
    expect(shown(box)).toBe(true);
    expect(box).toHaveValue('Use the small table.');
    expect(briefRow()).toHaveAttribute('aria-expanded', 'true');
    // Cancel: no words wait now, and the card is one row again.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(briefRow()).toHaveAttribute('aria-expanded', 'false'));
  });

  it(`${how}: a permission card takes the bar’s place above the conversation, and the three calls come back once it is answered`, async () => {
    windowWidth(width);
    const { move, post } = setup({ jobs: waiting(), gate: GATE });
    await screen.findByRole('button', { name: /^Go: approve/ });
    takePage(how);
    move(waiting(), [ASK]);
    const alert = screen.getByRole('region', { name: 'Permission: Run a command' });
    expect(shown(alert)).toBe(true);
    expect(alert.compareDocumentPosition(convo()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: /^Allow once/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/p1', expect.objectContaining({ decision: 'allow' })));
    move(waiting(), []);
    await expectTheThreeCalls();
    expect(shown(convo())).toBe(true);
  });

  it(`${how}: a stopped job with no gate keeps its bar above the conversation, with Reply only`, async () => {
    windowWidth(width);
    setup({ jobs: STOPPED_NO_GATE() });
    await screen.findByText('Overview');
    takePage(how);
    expect(shown(bar())).toBe(true);
    expect(within(bar()).getAllByRole('button').map(words)).toEqual([expect.stringMatching(/^Reply/)]);
    expect(within(bar()).getByRole('button', { name: /^Reply/ })).toBeEnabled();
    expect(shown(convo())).toBe(true);
  });
}
const QUEUED: QueuedView = { id: 'd_abcdefgh1234', kind: 'approve', state: 'waiting', words: 'Go: waiting for your laptop. It runs when the laptop is back.', at: NOW, expiresAt: null, waiting: true, canCancel: true, permissionId: null };
const at = (m: number) => new Date(Date.now() - (60 - m) * 60_000).toISOString();
const THREAD: ThreadItem[] = [
  { id: 'reply:1', kind: 'reply', at: at(1), html: '<p>The plan is written.</p>' },
  { id: 'you:2', kind: 'you', at: at(2), text: 'Keep it small.' },
  { id: 'reply:3', kind: 'reply', at: at(3), html: '<p>Will do.</p>' },
  { id: 'reply:4', kind: 'reply', at: at(4), html: '<p>The plan is ready.</p>' },
];

describe('the page’s keys and requests', () => {
  it('[ and ] move the open step', () => {
    setup({ jobs: [working('plan')] });
    expect(openStop()).toBe('plan');
    fireEvent.keyDown(document.body, { key: ']' });
    expect(openStop()).toBe('build');
    // As a click does: the address and the last step opened.
    expect(window.location.hash).toBe('#/job/alpha/stage/build');
    expect(localStorage.getItem('sb.job.step.alpha')).toBe('build');
    fireEvent.keyDown(document.body, { key: '[' });
    fireEvent.keyDown(document.body, { key: '[' });
    expect(openStop()).toBe('investigate');
    // At either end it stays.
    pick('spec');
    fireEvent.keyDown(document.body, { key: '[' });
    expect(openStop()).toBe('spec');
    pick('ship');
    fireEvent.keyDown(document.body, { key: ']' });
    expect(openStop()).toBe('ship');
    // In the message box [ is a letter you type, not a key.
    fireEvent.keyDown(messageBox(), { key: '[' });
    expect(openStop()).toBe('ship');
    // With the conversation widened the steps are hidden: the keys rest.
    fireEvent.click(screen.getByRole('button', { name: 'Widen' }));
    fireEvent.keyDown(document.body, { key: '[' });
    expect(openStop()).toBe('ship');
  });

  it('See the pull requests opens Ship; Watch opens Test with the picture on; Try it from the gear opens Test with Try it open', async () => {
    setup({ jobs: [job('alpha', 'running', { stage: 'pr1', lane: 'in-review', laneReason: 'PR #1 is in review' })] });
    pick('spec');
    fireEvent.click(within(bar()).getByRole('button', { name: 'See the pull requests' }));
    expect(openStop()).toBe('ship');
    expect(window.location.hash).toBe('#/job/alpha/stage/ship');
    cleanup();

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, blob: async () => new Blob([]) })));
    setup({ jobs: [job('alpha', 'running', { stage: 'test', lane: 'working', testing: 'Recording evidence: line 1 of 3' })], evidence: RECORDING });
    pick('plan');
    fireEvent.click(await within(bar()).findByRole('button', { name: 'Watch' }));
    expect(openStop()).toBe('test');
    const row = await screen.findByRole('article', { name: 'Recorded evidence' });
    expect(await within(row).findByRole('button', { name: 'Stop watching' })).toBeInTheDocument();
    cleanup();

    setup({ jobs: [working('plan')] });
    fireEvent.click(screen.getByRole('button', { name: 'Job menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try it on your computer' }));
    expect(openStop()).toBe('test');
    expect(await screen.findByRole('button', { name: 'Close Try it' })).toHaveAttribute('aria-expanded', 'true');
  });

  // The job menu has no Review the screens of its own; the request is the one the gear's neighbours
  // send (a screens chip, the wireframes page in a list): ui.openScreens for this job.
  it('a request to review this job’s screens goes to the Screens page', () => {
    function Screens() { const ui = useUi(); return <button type="button" onClick={() => ui.openScreens('alpha')}>review the screens</button>; }
    function Other() { const ui = useUi(); return <button type="button" onClick={() => ui.openScreens('beta')}>another job’s screens</button>; }
    setup({ jobs: [working('spec')], extra: <><Screens /><Other /></> });
    fireEvent.click(screen.getByRole('button', { name: 'another job’s screens' }));
    expect(window.location.hash).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'review the screens' }));
    expect(window.location.hash).toBe('#/job/alpha/screens');
  });

  it('a link to a document opens it under the step that owns it', async () => {
    function Links() {
      const ui = useUi();
      return <><button type="button" onClick={() => ui.openDocs('implementation-plan.md')}>the plan</button><button type="button" onClick={() => ui.openDocs('notes.md')}>loose notes</button></>;
    }
    setup({ jobs: [working('implement')], extra: <Links />, more: { page: { docs: { plan: [DOCS[0]], none: [] } } } });
    await screen.findByText('Overview');
    expect(openStop()).toBe('build');
    fireEvent.click(screen.getByRole('button', { name: 'the plan' }));
    expect(openStop()).toBe('plan');
    expect(window.location.hash).toBe('#/job/alpha/stage/plan');
    const reader = await within(screen.getByRole('tabpanel', { name: 'Plan' })).findByRole('article', { name: 'Implementation plan' });
    expect(await within(reader).findByText('implementation-plan.md body')).toBeInTheDocument();
    // Handled once: another step and back shows the step’s list, not the document again.
    pick('spec');
    pick('plan');
    await act(async () => {});
    expect(screen.queryByRole('article', { name: 'Implementation plan' })).toBeNull();
    // A file no step owns opens under the open step.
    pick('review');
    fireEvent.click(screen.getByRole('button', { name: 'loose notes' }));
    expect(openStop()).toBe('review');
    const loose = await within(screen.getByRole('tabpanel', { name: 'Review' })).findByRole('article', { name: 'notes.md' });
    expect(await within(loose).findByText('notes.md body')).toBeInTheDocument();
  });

  // Final review A6 (page Minor 9): a document two steps own opens under the open step when it is one of them.
  it('a document that two steps own opens under the open step when it is one of them', async () => {
    function Link() { const ui = useUi(); return <button type="button" onClick={() => ui.openDocs('implementation-plan.md')}>the plan</button>; }
    for (const hosted of [false, true]) {
      setup({ jobs: [working('implement')], extra: <Link />, hosted, more: { page: { docs: { plan: [DOCS[0]], build: [DOCS[0]], none: [] } } } });
      await screen.findByText('Overview');
      expect(openStop()).toBe('build');
      fireEvent.click(screen.getByRole('button', { name: 'the plan' }));
      expect(openStop()).toBe('build');
      expect(await within(screen.getByRole('tabpanel', { name: 'Build' })).findByRole('article', { name: 'Implementation plan' })).toBeInTheDocument();
      // From another step it opens under the first that owns it.
      pick('spec');
      fireEvent.click(screen.getByRole('button', { name: 'the plan' }));
      expect(openStop()).toBe('plan');
      cleanup();
      localStorage.clear();
      window.location.hash = '';
    }
  });

  // Final review A6 (page Minor 10): ⌘K Open docs with no file is not a pick.
  it('Open docs with no file opens the open step’s documents without picking it', async () => {
    function Opener() { const ui = useUi(); return <button type="button" onClick={() => ui.openDocs()}>open docs</button>; }
    for (const hosted of [false, true]) {
      const { move } = setup({ jobs: [working('plan')], extra: <Opener />, hosted, stageOf: (slug, stop) => ({ ...stageView(slug, stop), docs: stop === 'plan' ? DOCS : [] }) });
      const panel = screen.getByRole('tabpanel', { name: 'Plan' });
      await within(panel).findByRole('button', { name: /^Implementation plan/ });
      fireEvent.click(screen.getByRole('button', { name: 'open docs' }));
      await waitFor(() => expect(within(panel).getByRole('button', { name: /^Implementation plan/ })).toHaveFocus());
      expect(window.location.hash).toBe('');
      expect(localStorage.getItem('sb.job.step.alpha')).toBeNull();
      // The page still follows the job.
      move([working('implement')]);
      expect(openStop()).toBe('build');
      cleanup();
      localStorage.clear();
    }
  });

  // Final review A6 (page Minor 11): [ and ] never drop the focus to the page.
  it('after [ or ] with the focus inside the open step, the focus goes to the new step’s tab', async () => {
    setup({ jobs: [working('plan')], stageOf: (slug, stop) => ({ ...stageView(slug, stop), docs: DOCS }) });
    const doc = await within(screen.getByRole('tabpanel', { name: 'Plan' })).findByRole('button', { name: /^Implementation plan/ });
    doc.focus();
    fireEvent.keyDown(doc, { key: ']' });
    expect(openStop()).toBe('build');
    await waitFor(() => expect(tabOf('build')).toHaveFocus());
    // Focus outside the panel stays where it is.
    const box = messageBox();
    fireEvent.click(screen.getByRole('button', { name: 'Widen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the job' }));
    const widen = screen.getByRole('button', { name: 'Widen' });
    widen.focus();
    fireEvent.keyDown(widen, { key: '[' });
    expect(openStop()).toBe('plan');
    await act(async () => {});
    expect(widen).toHaveFocus();
    expect(box).not.toHaveFocus();
  });

  // Fix round 1, item 13 (browser fault 4): from a focused step tab, the focus goes with the open step.
  it('after ] the focused tab is the open step’s tab', async () => {
    setup({ jobs: [working('plan')] });
    tabOf('plan').focus();
    fireEvent.keyDown(tabOf('plan'), { key: ']' });
    expect(openStop()).toBe('build');
    await waitFor(() => expect(tabOf('build')).toHaveFocus());
    fireEvent.keyDown(tabOf('build'), { key: ']' });
    fireEvent.keyDown(document.activeElement!, { key: '[' });
    expect(openStop()).toBe('build');
    await waitFor(() => expect(tabOf('build')).toHaveFocus());
    // From the page body the focus stays where it was.
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: ']' });
    expect(openStop()).toBe('test');
    await act(async () => {});
    expect(document.activeElement).toBe(document.body);
  });

  // Final review A6 (page Minor 8): the address and the conversation never drift apart.
  it('leaving the conversation’s address for the job’s closes the full-screen conversation', async () => {
    for (const hosted of [false, true]) {
      windowWidth(1024);
      window.location.hash = '#/job/alpha/conversation';
      setup({ jobs: [working('plan')], routed: true, hosted });
      expect(page()).toHaveClass('is-full');
      act(() => { window.location.hash = '#/job/alpha'; });
      await waitFor(() => expect(page()).not.toHaveClass('is-full'));
      expect(page()).not.toHaveClass('is-talk');
      expect(shown(steps())).toBe(true);
      cleanup();
      window.location.hash = '';
    }
  });

  it('a request for a step while the conversation has the page gives the page back to the job', async () => {
    setup({ jobs: [working('plan')], view: 'conversation' });
    expect(shown(steps())).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Job menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try it on your computer' }));
    expect(page()).not.toHaveClass('is-wide');
    expect(shown(steps())).toBe(true);
    expect(openStop()).toBe('test');
    expect(window.location.hash).toBe('#/job/alpha/stage/test');
  });

  it('the conversation’s address opens it widened, and the overview’s opens the overview', async () => {
    setup({ jobs: [working('plan')], view: 'conversation' });
    expect(page()).toHaveClass('is-wide');
    expect(shown(steps())).toBe(false);
    expect(shown(convo())).toBe(true);
    cleanup();
    setup({ jobs: [working('plan')], view: 'overview' });
    const overview = (await screen.findByText('Overview')).closest('details')!;
    expect(overview).toHaveAttribute('open');
  });
});

describe('Widen', () => {
  it('with the conversation widened, a job that waits for you still has the three calls', async () => {
    for (const [, j] of [['Not Auto', waiting()[0]] as [string, Job], ...AUTO_STATES]) {
      simple();
      setup({ jobs: [j], gate: GATE, auto: { on: Boolean(j.auto?.on), tag: null } });
      await screen.findByRole('button', { name: /^Go: approve/ });
      fireEvent.click(screen.getByRole('button', { name: 'Widen' }));
      expect(page()).toHaveClass('is-wide');
      // The work column's own parts are hidden; the bar stays above the conversation.
      expect(shown(steps())).toBe(false);
      expect(shown(screen.getByRole('tabpanel', { hidden: true }))).toBe(false);
      expect(shown(screen.getByText('Overview'))).toBe(false);
      expect(shown(convo())).toBe(true);
      expect(convo()).toHaveClass('is-wide');
      expect(bar().compareDocumentPosition(convo()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      await expectTheThreeCalls();
      // Its card folded to one row.
      expect(briefRow()).toHaveAttribute('aria-expanded', 'false');
      expect(document.querySelector('.job-gate-body')).toHaveAttribute('hidden');
      // Back to the job: the two columns, the card in full.
      fireEvent.click(screen.getByRole('button', { name: 'Back to the job' }));
      expect(page()).not.toHaveClass('is-wide');
      expect(shown(steps())).toBe(true);
      expect(screen.queryByRole('button', { name: /^The brief/ })).toBeNull();
      await expectTheThreeCalls();
      cleanup();
      clearAllSent();
      clearGateSent();
      localStorage.clear();
    }
  });

  layoutCases('widened');

  it('Widen and Back to the job keep the focus on the button you pressed', async () => {
    setup({ jobs: waiting(), gate: GATE });
    await screen.findByRole('button', { name: /^Go: approve/ });
    const widen = screen.getByRole('button', { name: 'Widen' });
    widen.focus();
    fireEvent.click(widen);
    expect(document.activeElement).toBe(widen);
    expect(widen).toHaveTextContent('Back to the job');
    fireEvent.click(widen);
    expect(document.activeElement).toBe(widen);
    expect(widen).toHaveTextContent('Widen');
  });

  it('widened, a job that does not wait for you shows only the conversation', () => {
    setup({ jobs: [working('plan')] });
    fireEvent.click(screen.getByRole('button', { name: 'Widen' }));
    expect(shown(screen.getByRole('region', { name: 'Next step', hidden: true }))).toBe(false);
    expect(shown(convo())).toBe(true);
  });

  it('typing in What should change?, then Widen and Back to the job, keeps the words and the open box', async () => {
    simple();
    setup({ jobs: waiting(), gate: GATE, thread: THREAD });
    fireEvent.click(await screen.findByRole('button', { name: /^No go: send back/ }));
    const box = await screen.findByRole('textbox', { name: /What should change\?/ });
    fireEvent.change(box, { target: { value: 'Use the small table.' } });
    const message = messageBox();
    fireEvent.change(message, { target: { value: 'And keep the icon.' } });
    const list = convo().querySelector('.sb-convo-list')!;
    fireEvent.click(screen.getByRole('button', { name: 'Widen' }));
    // The same box, in sight with its words (an open box keeps the card open), and the same message box.
    expect(shown(box)).toBe(true);
    expect(box).toHaveValue('Use the small table.');
    expect(messageBox()).toBe(message);
    expect(message).toHaveValue('And keep the icon.');
    // Typing goes on while widened.
    fireEvent.change(box, { target: { value: 'Use the small table. Two columns.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to the job' }));
    await act(async () => {});
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toBe(box);
    expect(box).toHaveValue('Use the small table. Two columns.');
    expect(shown(box)).toBe(true);
    expect(messageBox()).toBe(message);
    expect(message).toHaveValue('And keep the icon.');
    // The conversation's scroll area is the same one: where you were in it stays.
    expect(convo().querySelector('.sb-convo-list')).toBe(list);
    expect(document.querySelectorAll('.sb-convo')).toHaveLength(1);
    expect(screen.getAllByRole('region', { name: 'Next step' })).toHaveLength(1);
  });
});

describe('a window under 1100 px', () => {
  it('under 1100 px the conversation is one button with the count of new messages, and it opens full screen', async () => {
    windowWidth(1024);
    localStorage.setItem(seenKey('alpha'), at(1));
    setup({ jobs: [working('plan')], thread: THREAD });
    const talk = page().querySelector<HTMLElement>('.sb-job-talk')!;
    expect(talk).toHaveAttribute('hidden');
    // Two messages from the Foreman since your last look (yours never counts).
    const button = await screen.findByRole('button', { name: /^Conversation/ });
    await waitFor(() => expect(button).toHaveTextContent('2 new'));
    expect(shown(button)).toBe(true);
    fireEvent.click(button);
    expect(shown(convo())).toBe(true);
    expect(convo()).toHaveClass('is-full');
    expect(page()).toHaveClass('is-full');
    expect(within(convo()).getByRole('heading', { name: 'Conversation' })).toBeInTheDocument();
    expect(within(convo()).getByText(/4 messages · 2 new/)).toBeInTheDocument();
    expect(shown(steps())).toBe(false);
    expect(screen.queryByRole('button', { name: /^Conversation/ })).toBeNull();
    // Back to the job: the button again.
    fireEvent.click(screen.getByRole('button', { name: 'Back to the job' }));
    expect(talk).toHaveAttribute('hidden');
    expect(shown(steps())).toBe(true);
    expect(screen.getByRole('button', { name: /^Conversation/ })).toBeInTheDocument();
  });

  it('under 1100 px the full-screen conversation keeps the three calls', async () => {
    for (const [, j] of [['Not Auto', waiting()[0]] as [string, Job], ...AUTO_STATES]) {
      windowWidth(1024);
      simple();
      setup({ jobs: [j], gate: GATE, auto: { on: Boolean(j.auto?.on), tag: null } });
      await screen.findByRole('button', { name: /^Go: approve/ });
      fireEvent.click(screen.getByRole('button', { name: /^Conversation/ }));
      expect(convo()).toHaveClass('is-full');
      await expectTheThreeCalls();
      expect(bar().compareDocumentPosition(convo()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(briefRow()).toHaveAttribute('aria-expanded', 'false');
      expect(shown(steps())).toBe(false);
      cleanup();
      clearAllSent();
      clearGateSent();
      localStorage.clear();
    }
  });

  layoutCases('full screen');

  it('opening the full screen puts the focus on Back to the job; closing it puts it on the Conversation button', async () => {
    windowWidth(1024);
    setup({ jobs: waiting(), gate: GATE });
    await screen.findByRole('button', { name: /^Go: approve/ });
    const open = screen.getByRole('button', { name: /^Conversation/ });
    open.focus();
    fireEvent.click(open);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back to the job' })));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the job' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Conversation/ })));
  });

  it('the full-screen conversation counts only what is new since you last read it, the second time too', async () => {
    windowWidth(1024);
    localStorage.setItem(seenKey('alpha'), at(1));
    const { store } = setup({ jobs: [working('plan')], thread: THREAD });
    const button = () => screen.getByRole('button', { name: /^Conversation/ });
    await waitFor(() => expect(button()).toHaveTextContent('2 new'));
    fireEvent.click(button());
    expect(within(convo()).getByText(/4 messages · 2 new/)).toBeInTheDocument();
    // He reads them: the visible panel writes the newest message's time as his last look.
    act(() => { writeStored(seenKey('alpha'), at(4)); });
    fireEvent.click(screen.getByRole('button', { name: 'Back to the job' }));
    expect(button()).not.toHaveTextContent('new');
    // One message arrives, and he opens it again.
    server.thread = [...THREAD, { id: 'reply:5', kind: 'reply', at: at(5), html: '<p>One more thing.</p>' }];
    act(() => { store.dispatch({ type: 'event', event: ev(400, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(button()).toHaveTextContent('1 new'));
    fireEvent.click(button());
    const head = convo().querySelector('.sb-convo-head')!;
    expect(head).toHaveTextContent('5 messages · 1 new');
    // The new line sits above the one new message only.
    expect(within(convo()).getByRole('separator', { name: '1 new since you last looked' })).toBeInTheDocument();
  });

  it('what you typed stays through the full-screen conversation, a resize across 1100 px and Widen', async () => {
    windowWidth(1280);
    setup({ jobs: waiting(), gate: GATE, thread: THREAD });
    fireEvent.click(await screen.findByRole('button', { name: /^No go: send back/ }));
    const box = await screen.findByRole('textbox', { name: /What should change\?/ });
    fireEvent.change(box, { target: { value: 'Use the small table.' } });
    const message = messageBox();
    fireEvent.change(message, { target: { value: 'And keep the icon.' } });
    const panel = convo();
    const list = convo().querySelector('.sb-convo-list');
    const theBar = bar();
    const keep = () => {
      expect(convo()).toBe(panel);
      expect(convo().querySelector('.sb-convo-list')).toBe(list);
      expect(bar()).toBe(theBar);
      expect(screen.getByRole('textbox', { name: /What should change\?/, hidden: true })).toBe(box);
      expect(box).toHaveValue('Use the small table.');
      expect(messageBox()).toBe(message);
      expect(message).toHaveValue('And keep the icon.');
    };
    resizeTo(1024);
    expect(page().querySelector('.sb-job-talk')).toHaveAttribute('hidden');
    keep();
    fireEvent.click(screen.getByRole('button', { name: /^Conversation/ }));
    expect(shown(message)).toBe(true);
    keep();
    // Closed with its own Back to the job, and opened again.
    fireEvent.click(screen.getByRole('button', { name: 'Back to the job' }));
    expect(page()).not.toHaveClass('is-full');
    keep();
    expect(shown(box)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Conversation/ }));
    keep();
    // Wider again with the conversation open: it is the widened conversation now.
    resizeTo(1280);
    expect(page()).toHaveClass('is-wide');
    keep();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the job' }));
    resizeTo(1024);
    resizeTo(1280);
    keep();
    expect(shown(box)).toBe(true);
  });
});

// Final review A1: writing to the Foreman always lands in a box he can see. jsdom lets a hidden
// element take focus, so each test also checks the focused box has no [hidden] ancestor.
describe('writing to the Foreman under 1100 px', () => {
  const ASKED = () => [job('alpha', 'needs-you', { stage: 'spec', lane: 'needs-you', headline: 'Which login page?' })];
  const MODES = [['the laptop app', false], ['the website', true]] as const;
  async function expectTheBoxInSight() {
    await waitFor(() => expect(messageBox()).toHaveFocus());
    expect(shown(messageBox())).toBe(true);
    expect(page()).toHaveClass('is-full');
  }

  it.each(MODES)('under 1100 px Reply opens the conversation and puts the cursor in the message box (%s)', async (_where, hosted) => {
    windowWidth(800);
    setup({ jobs: ASKED(), hosted });
    expect(page().querySelector('.sb-job-talk')).toHaveAttribute('hidden');
    fireEvent.click(within(bar()).getByRole('button', { name: /^Reply/ }));
    await expectTheBoxInSight();
  });

  it.each(MODES)('under 1100 px the c key does the same (%s)', async (_where, hosted) => {
    windowWidth(800);
    setup({ jobs: ASKED(), hosted });
    await screen.findByText('Overview');
    fireEvent.keyDown(document.body, { key: 'c' });
    await expectTheBoxInSight();
  });

  it.each(MODES)('under 1100 px a decision handed to the message box shows that box (%s)', async (_where, hosted) => {
    windowWidth(800);
    simple();
    // The Foreman is still replying: the server gives the decision back for the message box.
    const post = vi.fn(async (p: string): Promise<unknown> => (p === '/api/job/alpha/gate' ? { ok: true, sent: false, text: 'Go ahead with the plan.' } : { ok: true }));
    setup({ jobs: waiting(), gate: { ...GATE, runActive: true }, hosted, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await expectTheBoxInSight();
    expect(messageBox()).toHaveValue('Go ahead with the plan.');
  });
});

// Final review A2: a folded card never hides what it says after a press.
// Fix round 1, item 11 (browser fault 1): opening a box never changes what he chose for the fold.
describe('the fold after a box closes, with the conversation full screen', () => {
  const MODES = [['the laptop app', false], ['the website', true]] as const;
  /** Watches the bar's area being scrolled back to its top (jsdom keeps no scroll position). */
  function watchTop() {
    const work = page().querySelector<HTMLElement>('.sb-job-work')!;
    let top = 120;
    Object.defineProperty(work, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = v; } });
    return () => top;
  }

  it.each(MODES)('Cancel folds the card again when the box was what unfolded it (%s)', async (_where, hosted) => {
    windowWidth(1024);
    simple();
    setup({ jobs: waiting(), gate: GATE, hosted });
    await screen.findByRole('button', { name: /^Go: approve/ });
    takePage('full screen');
    const top = watchTop();
    for (const [call, name] of [['Reply', /Your answers or a note/], [/^No go: send back/, /What should change\?/]] as const) {
      expect(briefRow()).toHaveAttribute('aria-expanded', 'false');
      const open = screen.getByRole('button', { name: call });
      await waitFor(() => expect(open).toBeEnabled());
      fireEvent.click(open);
      expect(await screen.findByRole('textbox', { name })).toBeVisible();
      fireEvent.click(within(document.querySelector<HTMLElement>('.job-gate-body .gate-note')!).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(briefRow()).toHaveAttribute('aria-expanded', 'false'));
      expect(document.querySelector('.job-gate-body')).toHaveAttribute('hidden');
      expect(top()).toBe(0);
    }
  });

  // Fix round 2, item 2: the same on the widened laptop.
  it.each(MODES)('after a refused Go on the widened laptop, Send back on the bar shows its box (%s)', async (_where, hosted) => {
    simple();
    const post = vi.fn(async (p: string): Promise<unknown> => { if (p === '/api/job/alpha/gate') throw new ApiError(503, 'The laptop is away.'); return { ok: true }; });
    setup({ jobs: waiting(), gate: GATE, hosted, post });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    takePage('widened');
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await waitFor(() => expect(screen.getByText('The laptop is away.')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: /^No go: send back/ }));
    const box = await screen.findByRole('textbox', { name: /What should change\?/ });
    await act(async () => {});
    expect(box).toBeVisible();
  });

  it.each(MODES)('a card he unfolded himself stays unfolded after Cancel (%s)', async (_where, hosted) => {
    windowWidth(1024);
    simple();
    setup({ jobs: waiting(), gate: GATE, hosted });
    await screen.findByRole('button', { name: /^Go: approve/ });
    takePage('full screen');
    fireEvent.click(briefRow());
    expect(briefRow()).toHaveAttribute('aria-expanded', 'true');
    const reply = screen.getByRole('button', { name: 'Reply' });
    await waitFor(() => expect(reply).toBeEnabled());
    fireEvent.click(reply);
    await screen.findByRole('textbox', { name: /Your answers or a note/ });
    fireEvent.click(within(document.querySelector<HTMLElement>('.job-gate-body .gate-note')!).getByRole('button', { name: 'Cancel' }));
    await act(async () => {});
    expect(briefRow()).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.job-gate-body')).not.toHaveAttribute('hidden');
  });
});

describe('what the folded card says after a press', () => {
  const MODES = [['the laptop app', false], ['the website', true]] as const;
  const TERMINAL = 'Claude Code is open in this repository in a terminal.';

  it.each(MODES)('a refused Go with the conversation full screen shows the error (%s)', async (_where, hosted) => {
    windowWidth(1024);
    simple();
    const post = vi.fn(async (p: string): Promise<unknown> => {
      if (p === '/api/job/alpha/gate') throw new ApiError(409, TERMINAL, { code: 'terminal-open' });
      return { ok: true };
    });
    setup({ jobs: waiting(), gate: GATE, hosted, post });
    await screen.findByRole('button', { name: /^Go: approve/ });
    takePage('full screen');
    expect(briefRow()).toHaveAttribute('aria-expanded', 'false');
    const go = screen.getByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await waitFor(() => expect(screen.getByText(TERMINAL)).toBeVisible());
    expect(screen.getByRole('checkbox', { name: /None of the open terminals is this job’s Foreman/ })).toBeVisible();
    expect(briefRow()).toHaveAttribute('aria-expanded', 'true');
  });

  it('on the website a queued Go on a folded card shows its words and Cancel (laptop full screen)', async () => {
    windowWidth(1024);
    simple();
    setup({ jobs: waiting(), gate: GATE, hosted: true, more: { queued: QUEUED } });
    await screen.findAllByText(QUEUED.words);
    takePage('full screen');
    const card = document.querySelector<HTMLElement>('.queued-decision')!;
    expect(card).toBeVisible();
    expect(within(card).getByText(QUEUED.words)).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Cancel' })).toBeVisible();
    // The bar's sentence is the decision's own words, not "Say go and the Foreman goes ahead".
    expect(bar()).toHaveTextContent(QUEUED.words);
    expect(bar()).not.toHaveTextContent(/Say go/);
  });
});

// Final review A4: words typed in the card's boxes are kept per job and brief.
describe('words typed in the card’s boxes', () => {
  const MODES = [['the laptop app', false], ['the website', true]] as const;
  const changesBox = () => screen.findByRole('textbox', { name: /What should change\?/ });
  async function sendBackWith(words: string) {
    const back = await screen.findByRole('button', { name: /^No go: send back/ });
    await waitFor(() => expect(back).toBeEnabled());
    fireEvent.click(back);
    fireEvent.change(await changesBox(), { target: { value: words } });
  }

  // Fix round 1, item 10 (browser fault 5). No user-event here (it is not a dependency of web/), so
  // each key is one input event straight after the last, with no await between them.
  it.each(MODES)('typing with no gap between keys loses nothing (%s)', async (_where, hosted) => {
    const SENTENCE = 'Ask the office about closed tickets and the export.';
    setup({ jobs: waiting(), gate: GATE, hosted });
    for (const [call, name] of [[/^No go: send back/, /What should change\?/], ['Reply', /Your answers or a note/]] as const) {
      const open = await screen.findByRole('button', { name: call });
      await waitFor(() => expect(open).toBeEnabled());
      fireEvent.click(open);
      const box = await screen.findByRole('textbox', { name });
      for (let i = 1; i <= SENTENCE.length; i++) fireEvent.change(box, { target: { value: SENTENCE.slice(0, i) } });
      expect(screen.getByRole('textbox', { name })).toBe(box);
      expect(box).toHaveValue(SENTENCE);
      expect(localStorage.getItem('fw.gateBox.alpha')).toContain(SENTENCE);
      await act(async () => {});
      expect(box).toHaveValue(SENTENCE);
    }
    // Each box kept its own words.
    const kept = JSON.parse(localStorage.getItem('fw.gateBox.alpha')!) as { notes: { changes: string; message: string } };
    expect(kept.notes).toEqual({ changes: SENTENCE, message: SENTENCE });
  });

  it.each(MODES)('words typed in What should change? survive a refresh (%s)', async (_where, hosted) => {
    setup({ jobs: waiting(), gate: GATE, hosted });
    await sendBackWith('Use the small table.');
    cleanup();
    setup({ jobs: waiting(), gate: GATE, hosted });
    expect(await changesBox()).toHaveValue('Use the small table.');
    // Restored, it does not take the focus from the page.
    expect(await changesBox()).not.toHaveFocus();
  });

  it.each(MODES)('when Auto answers while he types, his words move to the message box and the bar says so (%s)', async (_where, hosted) => {
    const { store } = setup({ jobs: [AUTO_STATES[0][1]], gate: GATE, hosted, auto: { on: true, tag: null } });
    fireEvent.change(messageBox(), { target: { value: 'Earlier words.' } });
    await sendBackWith('Use the small table.');
    // Auto approves brief 2: the job is fetched again with the brief answered.
    server.answered = [2];
    server.thread = [{ id: 'you-auto', kind: 'you', at: NOW, text: 'Approved.', sendKind: 'approve', gateBrief: 2, by: 'auto' } as ThreadItem];
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(messageBox()).toHaveValue('Earlier words.\n\nUse the small table.'));
    const said = screen.getByText('Brief 2 was answered while you were writing. Your words are in the message box.');
    expect(said).toBeVisible();
    expect(screen.queryByRole('textbox', { name: /What should change\?/ })).toBeNull();
    // Once: a refresh does not move them again, and the line goes once he writes.
    fireEvent.change(messageBox(), { target: { value: 'Earlier words.\n\nUse the small table. And the icon.' } });
    await waitFor(() => expect(screen.queryByText(/was answered while you were writing/)).toBeNull());
    cleanup();
    setup({ jobs: [AUTO_STATES[0][1]], gate: GATE, hosted, auto: { on: true, tag: null } });
    server.answered = [2];
    await act(async () => {});
    expect(messageBox()).toHaveValue('Earlier words.\n\nUse the small table. And the icon.');
  });

  it.each(MODES)('the line about words moved to the message box goes when he dismisses it (%s)', async (_where, hosted) => {
    const { store } = setup({ jobs: waiting(), gate: GATE, hosted });
    await sendBackWith('Use the small table.');
    // A new brief replaces the card.
    server.gate = { ...GATE, briefNumber: 3, headline: 'Plan v3 ready' };
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(messageBox()).toHaveValue('Use the small table.'));
    expect(screen.getByText('Brief 2 was answered while you were writing. Your words are in the message box.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText(/was answered while you were writing/)).toBeNull();
  });

  // Fix round 1, M4: a gate with no brief number whose words change keeps the same card mounted.
  it.each(MODES)('a gate with no brief number whose words change: the moved words leave the card’s box too (%s)', async (_where, hosted) => {
    const NO_NUMBER = { ...GATE, briefNumber: null };
    const { store } = setup({ jobs: waiting(), gate: NO_NUMBER, hosted });
    await sendBackWith('Use the small table.');
    server.gate = { ...NO_NUMBER, headline: 'Plan v3 ready', nextProposed: 'Build step 2' };
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(messageBox()).toHaveValue('Use the small table.'));
    await waitFor(() => expect(bar()).toHaveTextContent('Plan v3 ready'));
    // The card for the new words: its box is closed, and opening it shows no old words.
    expect(screen.queryByRole('textbox', { name: /What should change\?/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^No go: send back/ }));
    expect(await changesBox()).toHaveValue('');
    await act(async () => {});
    expect(messageBox()).toHaveValue('Use the small table.');
  });

  it.each(MODES)('sent or cancelled words are not restored (%s)', async (_where, hosted) => {
    // Cancelled.
    setup({ jobs: waiting(), gate: GATE, hosted });
    await sendBackWith('Use the small table.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    cleanup();
    setup({ jobs: waiting(), gate: GATE, hosted });
    await screen.findByRole('button', { name: /^Go: approve/ });
    await act(async () => {});
    expect(screen.queryByRole('textbox', { name: /What should change\?/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^No go: send back/ }));
    expect(await changesBox()).toHaveValue('');
    cleanup();
    localStorage.clear();
    clearAllSent();
    clearGateSent();
    // Sent (a Reply: the brief stays open, so the card is drawn again).
    const post = vi.fn(async (p: string): Promise<unknown> => (p === '/api/job/alpha/gate' ? { ok: true, sent: true, text: 'sent' } : { ok: true }));
    setup({ jobs: waiting(), gate: GATE, hosted, post });
    await screen.findByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'What does the old column feed?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'message' })));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /Your answers or a note/ })).toBeNull());
    cleanup();
    clearAllSent();
    clearGateSent();
    setup({ jobs: waiting(), gate: GATE, hosted });
    await screen.findByRole('button', { name: /^Go: approve/ });
    await act(async () => {});
    expect(screen.queryByRole('textbox', { name: /Your answers or a note/ })).toBeNull();
    expect(messageBox()).toHaveValue('');
  });
});

describe('when the job’s details are slow, fail, or come from an older laptop', () => {
  it('the job’s details failing leaves the bar, the steps and the conversation in place', async () => {
    setup({ jobs: [working('plan')], fail: true });
    expect(await screen.findByText('Couldn’t load this job’s details.')).toHaveAttribute('role', 'alert');
    expect(screen.queryByText('Overview')).toBeNull();
    // The rest of the page is whole: the header from the snapshot, the bar, the steps and the conversation.
    expect(within(page().querySelector<HTMLElement>('.sb-job-top')!).getByRole('heading', { name: 'Job alpha' })).toBeInTheDocument();
    expect(shown(bar())).toBe(true);
    expect(within(steps()).getAllByRole('tab')).toHaveLength(7);
    expect(screen.getByRole('tabpanel', { name: 'Plan' })).toBeInTheDocument();
    expect(shown(convo())).toBe(true);
    expect(messageBox()).toBeInTheDocument();
    // Try again, and they come.
    server.fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Overview')).toBeInTheDocument();
    expect(screen.queryByText('Couldn’t load this job’s details.')).toBeNull();
  });

  it('while the job’s details load, the header shows from the snapshot and the overview says it is loading', () => {
    setup({ jobs: [working('plan')] });
    expect(screen.getByText('Loading the overview…')).toHaveAttribute('role', 'status');
    expect(within(page().querySelector<HTMLElement>('.sb-job-top')!).getByRole('heading', { name: 'Job alpha' })).toBeInTheDocument();
    expect(within(steps()).getAllByRole('tab')).toHaveLength(7);
  });

  it('a job record from an older laptop (no page, no step times, no feed) shows a whole page with the "Not written yet" lines', async () => {
    // The website before the laptop is rebuilt: the job's answer has no page; a step's view has no time, docs or feed.
    const older = (slug: string, stop: StopId): StageView => {
      const v = stageView(slug, stop) as Partial<StageView>;
      delete v.docs;
      delete v.time;
      return {
        ...v,
        agents: [{ who: 'feature-planner', role: 'Planner', model: null, doing: null, since: null, lastAt: null, status: 'done', terminal: { kind: 'watch', ready: false, why: null }, ref: 'a1' }],
      } as StageView;
    };
    const errors = vi.spyOn(console, 'error');
    setup({ jobs: [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', waitingFor: 'approval' })], gate: GATE, hosted: true, stageOf: older });
    fireEvent.click(await screen.findByText('Overview'));
    expect(screen.getByText(NO_TICKET)).toBeInTheDocument();
    expect(screen.getByText(BUILDING_NOT_WRITTEN)).toBeInTheDocument();
    expect(screen.getByText(CHECK_NOT_WRITTEN)).toBeInTheDocument();
    const panel = screen.getByRole('tabpanel', { name: 'Plan' });
    expect(await within(panel).findByText('This step’s documents aren’t known yet.')).toBeInTheDocument();
    expect(within(panel).getByText('Planner')).toBeInTheDocument();
    expect(within(steps()).getAllByRole('tab')).toHaveLength(7);
    for (const s of STOPS) {
      pick(s.id);
      expect((await within(screen.getByRole('tabpanel', { name: s.label })).findAllByText(/This step’s documents aren’t known yet\.|Not yet/)).length).toBeGreaterThan(0);
    }
    await expectTheThreeCalls();
    expect(shown(convo())).toBe(true);
    expect(page().querySelector('.sb-job-top')).toHaveTextContent(MENU_ON_LAPTOP);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('on the website', () => {
  it('on the website the same page shows, with a queued decision in place of the calls', async () => {
    setup({ jobs: waiting(), gate: GATE, hosted: true, more: { queued: QUEUED } });
    await waitFor(() => expect(document.querySelector('.job-gate-body .queued-decision')).toHaveTextContent(QUEUED.words));
    // The same page: the header (the job menu on the laptop), the bar, seven steps with one open, the conversation.
    expect(page().querySelector('.sb-job-top')).toHaveTextContent(MENU_ON_LAPTOP);
    expect(shown(bar())).toBe(true);
    expect(within(steps()).getAllByRole('tab')).toHaveLength(7);
    expect(screen.getByRole('tabpanel', { name: 'Plan' })).toBeInTheDocument();
    expect(shown(convo())).toBe(true);
    // The decision waits for the laptop: no calls meanwhile.
    expect(within(bar()).queryByRole('button', { name: /^(No go|Go|Reply)/ })).toBeNull();
  });

  it('on the website a waiting Auto job has Send back, Reply and Go, all enabled', async () => {
    for (const [, j] of AUTO_STATES) {
      setup({ jobs: [j], gate: GATE, hosted: true, auto: { on: true, tag: null } });
      await screen.findByRole('button', { name: /^Go: approve/ });
      await expectTheThreeCalls();
      // Widened too.
      fireEvent.click(screen.getByRole('button', { name: 'Widen' }));
      await expectTheThreeCalls();
      cleanup();
      clearAllSent();
      clearGateSent();
      localStorage.clear();
      // And in the full-screen conversation of a narrow window.
      windowWidth(1024);
      setup({ jobs: [j], gate: GATE, hosted: true, auto: { on: true, tag: null } });
      await screen.findByRole('button', { name: /^Go: approve/ });
      fireEvent.click(screen.getByRole('button', { name: /^Conversation/ }));
      await expectTheThreeCalls();
      cleanup();
      clearAllSent();
      clearGateSent();
      localStorage.clear();
      windowWidth(LAPTOP);
    }
  });
});

// Review of Task 15a, fix 1: a step's address always opens that step.
describe('the address after a pick', () => {
  it('after a pick, the address of the step the page opened at opens it again', () => {
    const { rerenderWith } = setup({ jobs: [working('plan')], step: 'test' });
    expect(openStop()).toBe('test');
    pick('spec');
    // The app's route follows the address the pick wrote.
    rerenderWith({ slug: 'alpha', step: 'spec' });
    expect(openStop()).toBe('spec');
    rerenderWith({ slug: 'alpha', step: 'test' });
    expect(openStop()).toBe('test');
  });

  it('routed: after a pick, a link to the step the page opened at opens it again', async () => {
    window.location.hash = '#/job/alpha/stage/test';
    setup({ jobs: [working('plan')], routed: true });
    expect(openStop()).toBe('test');
    pick('spec');
    act(() => { window.location.hash = '#/job/alpha/stage/test'; });
    await waitFor(() => expect(openStop()).toBe('test'));
  });
});

// ---------- Moved from the old job page's tests: no other test had these ----------
describe('the old job page’s tests, on this page', () => {
  it('a question from the Foreman: Reply puts the cursor in the message box', () => {
    setup({ jobs: [job('alpha', 'needs-you', { stage: 'spec', lane: 'needs-you', headline: 'Which login page?' })] });
    expect(bar()).toHaveTextContent('The Foreman asked you something');
    expect(bar()).toHaveTextContent('Which login page?');
    fireEvent.click(within(bar()).getByRole('button', { name: /^Reply/ }));
    expect(screen.getByRole('textbox', { name: /Your message to the Foreman/ })).toHaveFocus();
  });

  /** The plan, with a link to a section, one to another document and one to a file that is no document. */
  const LINKED: JobDoc = {
    file: 'implementation-plan.md', name: 'Implementation plan', type: 'md', updatedAt: NOW, size: 2048, text: 'plan',
    html: '<h1 id="h-plan">Plan</h1><p><a href="#s1">Jump to S1</a> · <a href="review.md">The review</a></p><h2 id="h-s1">S1</h2><p>Step one.</p>',
  };
  const REVIEW_DOC: JobDocEntry = { file: 'review.md', name: 'Review (combined)', group: 'review', version: null, updatedAt: NOW, size: 400, type: 'md' };
  const withDocs = (slug: string, stop: StopId): StageView => ({ ...stageView(slug, stop), docs: stop === 'plan' ? DOCS : stop === 'review' ? [REVIEW_DOC] : [] });
  const linkedPlan = (get: ReturnType<typeof setup>['get']) => {
    const answer = get.getMockImplementation()!;
    get.mockImplementation((path: string) => (path.endsWith('/doc?file=implementation-plan.md') ? Promise.resolve(LINKED) : answer(path)));
  };

  it('in a document a #section link goes to its heading, and a link to another document opens it under its step; a link in a reply too', async () => {
    const { get } = setup({
      jobs: [working('plan')], stageOf: withDocs, more: { page: { docs: { plan: [DOCS[0]], review: [REVIEW_DOC], none: [] } } },
      extra: <ServerHtml html={'<p><a href="./notes.md">notes</a></p>'} />,
    });
    linkedPlan(get);
    await screen.findByText('Overview');
    fireEvent.click(await within(screen.getByRole('tabpanel', { name: 'Plan' })).findByRole('button', { name: /^Implementation plan/ }));
    const reader = await screen.findByRole('article', { name: 'Implementation plan' });
    fireEvent.click(await within(reader).findByRole('link', { name: 'Jump to S1' }));
    expect(within(reader).getByRole('heading', { name: 'S1' })).toHaveFocus();
    // Another of the job's documents: the step that owns it opens with it.
    fireEvent.click(within(reader).getByRole('link', { name: 'The review' }));
    expect(openStop()).toBe('review');
    expect(await within(screen.getByRole('tabpanel', { name: 'Review' })).findByText('review.md body')).toBeInTheDocument();
    // A link in a reply to a file no step owns: it opens under the open step.
    fireEvent.click(screen.getByRole('link', { name: 'notes' }));
    expect(openStop()).toBe('review');
    const notes = await within(screen.getByRole('tabpanel', { name: 'Review' })).findByRole('article', { name: 'notes.md' });
    expect(await within(notes).findByText('notes.md body')).toBeInTheDocument();
  });

  it('⌘K Open docs: the open step’s documents, with the focus on the first one', async () => {
    function Opener() { const ui = useUi(); return <button type="button" onClick={() => ui.openDocs()}>open docs</button>; }
    const TEST_PLAN: JobDocEntry = { file: 'test-plan.md', name: 'Test plan', group: 'plan', version: null, updatedAt: NOW, size: 800, type: 'md' };
    setup({ jobs: [working('plan')], stageOf: (slug, stop) => ({ ...stageView(slug, stop), docs: stop === 'plan' ? [DOCS[0], TEST_PLAN] : [] }), extra: <Opener /> });
    const panel = screen.getByRole('tabpanel', { name: 'Plan' });
    const first = () => within(panel).getByRole('button', { name: /^Implementation plan/ });
    await within(panel).findByRole('button', { name: /^Test plan/ });
    fireEvent.click(screen.getByRole('button', { name: 'open docs' }));
    expect(openStop()).toBe('plan');
    await waitFor(() => expect(first()).toHaveFocus());
    // With a document open: back to the list, the focus on the first one (not the one you read).
    fireEvent.click(within(panel).getByRole('button', { name: /^Test plan/ }));
    await within(panel).findByRole('article', { name: 'Test plan' });
    fireEvent.click(screen.getByRole('button', { name: 'open docs' }));
    await waitFor(() => expect(first()).toHaveFocus());
    expect(within(panel).queryByRole('article', { name: /Test plan|test-plan\.md/ })).toBeNull();
  });

  // Review of Task 18, I1: a request that found no document must not take the focus later.
  it('Open docs on a step with no documents does not move the focus when one arrives later', async () => {
    function Opener() { const ui = useUi(); return <button type="button" onClick={() => ui.openDocs()}>open docs</button>; }
    let planDocs: JobDocEntry[] = [];
    const { move } = setup({ jobs: [working('plan')], stageOf: (slug, stop) => ({ ...stageView(slug, stop), docs: stop === 'plan' ? planDocs : [] }), extra: <Opener /> });
    const panel = screen.getByRole('tabpanel', { name: 'Plan' });
    await waitFor(() => expect(panel.querySelector('.sb-step-body')).not.toBeNull());
    expect(within(panel).getByText('No documents from this step yet.')).toBeInTheDocument();
    const opener = screen.getByRole('button', { name: 'open docs' });
    opener.focus();
    fireEvent.click(opener);
    await act(async () => {});
    // Later the job changes and the step's answer has a document.
    planDocs = [DOCS[0]];
    move([working('plan', { updatedAt: new Date(Date.now() + 1000).toISOString() })]);
    const doc = await within(panel).findByRole('button', { name: /^Implementation plan/ });
    await act(async () => {});
    expect(doc).not.toHaveFocus();
    expect(opener).toHaveFocus();
  });

  it('Open docs never takes the focus out of a box he is typing in', async () => {
    function Opener() { const ui = useUi(); return <button type="button" onClick={() => ui.openDocs()}>open docs</button>; }
    const { get } = setup({ jobs: [working('plan')], extra: <Opener /> });
    await waitFor(() => expect(screen.getByRole('tabpanel', { name: 'Plan' }).querySelector('.sb-step-body')).not.toBeNull());
    // The Spec step's answer is held until he is typing.
    let release = () => {};
    const held = new Promise<void>((r) => { release = r; });
    const answer = get.getMockImplementation()!;
    get.mockImplementation((path: string) => (path.endsWith('/stage/spec') ? held.then(() => ({ ...stageView('alpha', 'spec'), docs: [DOCS[0]] })) : answer(path)));
    pick('spec');
    fireEvent.click(screen.getByRole('button', { name: 'open docs' }));
    const box = messageBox();
    box.focus();
    fireEvent.change(box, { target: { value: 'Keep the icon' } });
    await act(async () => { release(); });
    const doc = await within(screen.getByRole('tabpanel', { name: 'Spec' })).findByRole('button', { name: /^Implementation plan/ });
    await act(async () => {});
    expect(doc).not.toHaveFocus();
    expect(box).toHaveFocus();
    expect(box).toHaveValue('Keep the icon');
  });
});

// ---------- The old job page's blocks, run against this page ----------
// Copied as they are: the go / no go bar, after a click on the go / no go bar, Auto on the job page
// and the permission alert. Only places this page does not have are pointed at the new place
// (the page head is .sb-job-top; the locked model line is in the header and under the message box).
describe('the go / no go bar', () => {
  const waiting = () => [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', waitingFor: 'approval', headline: 'The plan is ready. Start building?' })];

  it('Go presses the gate card’s approve, and send back opens its box; the card’s own row is hidden', async () => {
    const { post } = setup({ jobs: waiting(), gate: GATE });
    await waitFor(() => expect(document.querySelector('[data-gate="approve"]')).not.toBeNull());
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    expect(go.querySelector('kbd')).toHaveTextContent('a');
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('Plan v2 ready');
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('Build step 1');
    expect(document.querySelector('.job-gate-body .gate-actions')).toHaveAttribute('hidden');
    fireEvent.click(screen.getByRole('button', { name: /^No go: send back/ }));
    expect(await screen.findByText(/What should change\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(go);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve' })));
  });

  const ASKING: Gate = { ...GATE, questions: [{ id: '1', text: 'Keep the old column?', recommendation: null, options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] }] } as Gate;

  it('the bar has Send back, Reply and Go', async () => {
    setup({ jobs: waiting(), gate: GATE });
    await screen.findByRole('button', { name: /^Go: approve/ });
    const calls = within(screen.getByRole('region', { name: 'Next step' })).getAllByRole('button').map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
    expect(calls).toEqual([expect.stringMatching(/^No go: send back/), 'Reply', expect.stringMatching(/^Go: approve/)]);
    // One way to do it: the card's own Other guidance is not shown under the bar.
    expect(document.querySelector('.job-gate-body .gate-actions')).toHaveAttribute('hidden');
  });

  it('the card’s help names the bar’s buttons, not the hidden ones', async () => {
    setup({ jobs: waiting(), gate: GATE });
    await screen.findByRole('button', { name: /^Go: approve/ });
    const help = document.querySelector('.job-gate-body .how-body')!;
    expect(help).toHaveTextContent('Reply');
    expect(help).toHaveTextContent('No go: send back');
    expect(help).not.toHaveTextContent('Other guidance');
    expect(help).not.toHaveTextContent('Revise with feedback');
  });

  it('Reply works with a question unanswered', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true, sent: true, text: 'sent' }));
    setup({ jobs: waiting(), gate: ASKING, post });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    expect(go).toBeDisabled();
    const reply = screen.getByRole('button', { name: 'Reply' });
    expect(reply).toBeEnabled();
    fireEvent.click(reply);
    const box = await screen.findByRole('textbox', { name: 'Your answers or a note for the Foreman. Nothing is approved.' });
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: 'What does the old column feed?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'message', note: 'What does the old column feed?' })));
    // Nothing was approved: the card stays open, and the bar says it was sent.
    await within(screen.getByRole('region', { name: 'Next step' })).findByText('Sent. Waiting for the Foreman to start.');
    expect(screen.getByRole('group', { name: /Keep the old column\?/ })).toBeInTheDocument();
    // m3: the reply was taken, so its box is cleared and closed: no second press sends it again.
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /Your answers or a note/ })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Send the reply' })).toBeNull();
    expect(post.mock.calls.filter(([, b]) => (b as { kind?: string })?.kind === 'approve')).toHaveLength(0);
  });

  it('Reply sends the answers typed so far', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true, sent: true, text: 'sent' }));
    setup({ jobs: waiting(), gate: ASKING, post });
    fireEvent.click(await screen.findByRole('radio', { name: /No/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'Not sure about the rest.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'message', answers: { 1: { choice: 'b' } } })));
  });

  it('Reply while its box is open keeps the box and puts the cursor in it', async () => {
    setup({ jobs: waiting(), gate: GATE });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const box = await screen.findByRole('textbox', { name: /Your answers or a note/ });
    screen.getByRole('button', { name: /^Go: approve/ }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(screen.getByRole('textbox', { name: /Your answers or a note/ })).toBe(box);
    expect(box).toHaveFocus();
  });

  // Deep review D, I2: a typed note is never thrown away.
  it('Go with the Reply box open and words in it sends the words with the approval', async () => {
    const { post } = setup({ jobs: waiting(), gate: GATE });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'Approved, but keep the icon small.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve', note: 'Approved, but keep the icon small.' })));
  });

  it('Go with the Send back box open and words in it is off, and says why', async () => {
    const { post } = setup({ jobs: waiting(), gate: GATE });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /^No go: send back/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: /What should change\?/ }), { target: { value: 'Use the small table.' } });
    await waitFor(() => expect(go).toBeDisabled());
    expect(go).toHaveAttribute('title', 'You wrote what should change. Send it back or cancel it first.');
    fireEvent.click(go);
    fireEvent.keyDown(document.body, { key: 'a' });
    await act(async () => {});
    expect(post.mock.calls.filter(([, b]) => (b as { kind?: string })?.kind === 'approve')).toHaveLength(0);
    // Cancel keeps nothing in the way: Go is on again.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(go).toBeEnabled());
  });

  // Final review A3: Send back never closes its own box, and change words never go with an approval.
  it('Send back pressed twice keeps the box open and its words', async () => {
    const { post } = setup({ jobs: waiting(), gate: GATE });
    const back = await screen.findByRole('button', { name: /^No go: send back/ });
    await waitFor(() => expect(back).toBeEnabled());
    fireEvent.click(back);
    const box = await screen.findByRole('textbox', { name: /What should change\?/ });
    fireEvent.change(box, { target: { value: 'Use the small table.' } });
    back.focus();
    fireEvent.click(back);
    await act(async () => {});
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toBe(box);
    expect(box).toHaveValue('Use the small table.');
    expect(box).toHaveFocus();
    expect(screen.getByRole('button', { name: /^Go: approve/ })).toBeDisabled();
    expect(post.mock.calls.filter(([p]) => p === '/api/job/alpha/gate')).toHaveLength(0);
  });

  it('the r key on an open box keeps it', async () => {
    setup({ jobs: waiting(), gate: GATE });
    await waitFor(() => expect(screen.getByRole('button', { name: /^No go: send back/ })).toBeEnabled());
    fireEvent.keyDown(document.body, { key: 'r' });
    const box = await screen.findByRole('textbox', { name: /What should change\?/ });
    fireEvent.change(box, { target: { value: 'Use the small table.' } });
    box.blur();
    fireEvent.keyDown(document.body, { key: 'r' });
    await act(async () => {});
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toBe(box);
    expect(box).toHaveValue('Use the small table.');
    expect(box).toHaveFocus();
    // The o key on an open Reply box keeps it too.
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const reply = await screen.findByRole('textbox', { name: /Your answers or a note/ });
    reply.blur();
    fireEvent.keyDown(document.body, { key: 'o' });
    await act(async () => {});
    expect(screen.getByRole('textbox', { name: /Your answers or a note/ })).toHaveFocus();
  });

  it('changes typed, then Reply, then Go: no approval carries those words', async () => {
    const { post } = setup({ jobs: waiting(), gate: GATE });
    const back = await screen.findByRole('button', { name: /^No go: send back/ });
    await waitFor(() => expect(back).toBeEnabled());
    fireEvent.click(back);
    fireEvent.change(await screen.findByRole('textbox', { name: /What should change\?/ }), { target: { value: 'Use the small table.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    // The Reply box has its own words: none yet.
    const reply = await screen.findByRole('textbox', { name: /Your answers or a note/ });
    expect(reply).toHaveValue('');
    // Back to Send back: its words are still its own.
    fireEvent.click(back);
    expect(await screen.findByRole('textbox', { name: /What should change\?/ })).toHaveValue('Use the small table.');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const go = screen.getByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve' })));
    for (const [, b] of post.mock.calls.filter(([p]) => p === '/api/job/alpha/gate')) {
      expect(JSON.stringify(b)).not.toContain('Use the small table.');
    }
  });

  it('with Play off the calls are the gate’s own words', async () => {
    setup({ jobs: waiting(), gate: GATE, play: 'off' });
    expect(await screen.findByRole('button', { name: /^Approve/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Send back/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Next step' })).not.toHaveTextContent('Go / no go');
  });
});

// Spec 1.2: a decision shows it is on its way (the pressed call spins and can't send twice), then
// that it was sent, until the job moves; after 30 seconds of nothing it says so and offers Try again.
describe('after a click on the go / no go bar', () => {
  const waiting = (extra = {}) => [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', waitingFor: 'approval', headline: 'The plan is ready. Start building?', ...extra })];
  const SENT_LINE = 'Sent. Waiting for the Foreman to start.';
  /** Once the run it started works (final review A6, calls Minor 1). */
  const AT_WORK_LINE = 'Sent. The Foreman is at work on it.';
  /** A POST to the gate that answers only when told to. */
  function held() {
    let answer: (v: unknown) => void = () => {};
    const post = vi.fn((path: string, _body?: unknown): Promise<unknown> => (path.endsWith('/gate') ? new Promise((res) => { answer = res; }) : Promise.resolve({ ok: true })));
    return { post, answer: (v: unknown = { ok: true, sent: true, text: 'sent' }) => act(async () => { answer(v); }) };
  }
  /**
   * The gate POST as the server answers it (dashboard/runner/index.js): `sent: true` always comes with a
   * started run, whose run event reaches the page, and a deciding answer (approve, changes) answers the
   * brief. `runEvent: false`: the run event never arrives (a lost event stream), so the sent line stays.
   */
  const sentPost = ({ runEvent = true, answers = true } = {}) => {
    let n = 0;
    return vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
      if (path !== '/api/job/alpha/gate') return { ok: true };
      const b = (body ?? {}) as { kind?: string; briefNumber?: number | null };
      if (answers && (b.kind === 'approve' || b.kind === 'changes') && typeof b.briefNumber === 'number') server.answered.push(b.briefNumber);
      const run = { id: `r_sent_${++n}`, slug: 'alpha', status: 'running' };
      if (runEvent) server.store?.dispatch({ type: 'event', event: ev(100 + n, 'run', 'alpha', run) });
      return { ok: true, sent: true, text: 'sent', run };
    });
  };
  /** Every call in the bar (Try again aside). */
  const calls = () => within(bar()).queryAllByRole('button').filter((b) => !/Try again/.test(b.textContent ?? ''));
  /** Watches the bar from the click on: once the sent line has shown, the old ask must never come back. */
  function watchBar() {
    const seen: string[] = [];
    let sent = false;
    const look = () => {
      const el = document.querySelector('.next-bar');
      const text = el?.textContent ?? '';
      if (text.includes(SENT_LINE)) sent = true;
      const greyed = [...(el?.querySelectorAll('button') ?? [])].some((b) => (b as HTMLButtonElement).disabled && !/Try again/.test(b.textContent ?? ''));
      if (sent && (/Say go and the Foreman goes ahead|Go \/ no go/i.test(text) || greyed)) seen.push(text);
    };
    const mo = new MutationObserver(look);
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    return { stop: () => { look(); mo.disconnect(); return { sent, comeBack: seen }; } };
  }
  const gatePosts = (post: ReturnType<typeof vi.fn>) => post.mock.calls.filter(([p]) => p === '/api/job/alpha/gate');
  const bar = () => screen.getByRole('region', { name: 'Next step' });
  /** The page's one live region for a decision on its way (always there, empty when idle). */
  const live = () => document.querySelector('[data-next-live]')!;
  /** No go: send back, a note, then the card's Send back. */
  async function sendBack(note = 'Use the small table.') {
    fireEvent.click(await screen.findByRole('button', { name: /^No go: send back/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: /What should change\?/ }), { target: { value: note } });
    return screen.getByRole('button', { name: 'Send back' });
  }

  afterEach(() => { vi.useRealTimers(); });

  // Fix round 1, I1: the words that go out leave the store at the press, so the brief showing as
  // answered before the send's own answer comes back never copies them into the message box.
  const MOVED = /was answered while you were writing|unsent words are in the message box/;
  async function answeredBeforeTheReply(store: Store) {
    server.answered = [2];
    act(() => { store.dispatch({ type: 'event', event: ev(250, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(within(bar()).queryByRole('button', { name: /^Go: approve/ })).toBeNull());
    await act(async () => {});
  }

  it('Send back, with the answer slow to come back: the words are not copied into the message box and the bar says nothing about it', async () => {
    const { post, answer } = held();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await sendBack('Use the small table.'));
    await waitFor(() => expect(gatePosts(post)).toHaveLength(1));
    await answeredBeforeTheReply(store);
    expect(messageBox()).toHaveValue('');
    expect(screen.queryByText(MOVED)).toBeNull();
    await answer();
    expect(messageBox()).toHaveValue('');
    expect(screen.queryByText(MOVED)).toBeNull();
    expect(localStorage.getItem('fw.gateBox.alpha')).toBeNull();
  });

  it('Reply words sent with Go, with the answer slow to come back: the words are not copied into the message box and the bar says nothing about it', async () => {
    const { post, answer } = held();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'Keep the icon small.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(gatePosts(post)).toHaveLength(1));
    expect(gatePosts(post)[0][1]).toEqual(expect.objectContaining({ kind: 'approve', note: 'Keep the icon small.' }));
    await answeredBeforeTheReply(store);
    expect(messageBox()).toHaveValue('');
    expect(screen.queryByText(MOVED)).toBeNull();
    await answer();
    expect(messageBox()).toHaveValue('');
    expect(screen.queryByText(MOVED)).toBeNull();
  });

  // Fix round 1, M5: when he answered the brief himself, the line says only where his unsent words are.
  it.each([['the laptop app', false], ['the website', true]] as const)('after his own Go the unsent change words move to the message box with a line that says so (%s)', async (_where, hosted) => {
    // The box is named for steering while the run his Go started works.
    const composerBox = () => document.querySelector<HTMLTextAreaElement>('[data-composer-input]')!;
    setup({ jobs: waiting(), gate: GATE, post: sentPost(), hosted });
    await sendBack('Use the small table.');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const go = screen.getByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    await waitFor(() => expect(composerBox()).toHaveValue('Use the small table.'));
    expect(screen.getByText('Your unsent words are in the message box.')).toBeVisible();
    expect(screen.queryByText(/was answered while you were writing/)).toBeNull();
    // The same rule: it goes once he writes there.
    fireEvent.change(composerBox(), { target: { value: 'Use the small table. Later.' } });
    await waitFor(() => expect(screen.queryByText('Your unsent words are in the message box.')).toBeNull());
  });

  // Fix round 1, item 12 (browser fault 3): a send that never got an answer says so in plain words.
  it.each([['the laptop app', false], ['the website', true]] as const)('a send that never gets an answer says Couldn’t reach …, not the browser’s words (%s)', async (_where, hosted) => {
    const post = vi.fn(async (p: string): Promise<unknown> => { if (p.endsWith('/gate')) throw new TypeError('Failed to fetch'); return { ok: true }; });
    setup({ jobs: waiting(), gate: GATE, post, hosted });
    // Go, then Send back.
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    expect(await screen.findByText(`Couldn’t reach ${BRAND.name}. Try again.`)).toBeVisible();
    expect(screen.queryByText('Failed to fetch')).toBeNull();
    fireEvent.click(await sendBack('Use the small table.'));
    await waitFor(() => expect(gatePosts(post)).toHaveLength(2));
    expect(await screen.findByText(`Couldn’t reach ${BRAND.name}. Try again.`)).toBeVisible();
    expect(screen.queryByText('Failed to fetch')).toBeNull();
    // An answer from the server keeps its own words.
    post.mockImplementation(async (p: string) => { if (p.endsWith('/gate')) throw new ApiError(503, 'The laptop is away.'); return { ok: true }; });
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    expect(await screen.findByText('The laptop is away.')).toBeInTheDocument();
  });

  // Fix round 2, item 1 (R1): after the press, a card writes to the slot only while it is still its own.
  const composerBox = () => document.querySelector<HTMLTextAreaElement>('[data-composer-input]')!;
  const times = (text: string, words: string) => text.split(words).length - 1;
  /** Change words held in What should change?, then Reply words, then Go: Go carries the Reply words. */
  async function bothBoxesThenGo(change: string, reply: string) {
    await sendBack(change);
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: reply } });
    const go = screen.getByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
  }

  it('words in both boxes, the details arrive before the send’s answer: the other box’s words are in the message box once', async () => {
    const { post, answer } = held();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    await bothBoxesThenGo('Use the small table.', 'Keep the icon small.');
    await waitFor(() => expect(gatePosts(post)).toHaveLength(1));
    await answeredBeforeTheReply(store);
    await waitFor(() => expect(composerBox()).toHaveValue('Use the small table.'));
    await answer();
    await act(async () => {});
    await act(async () => {});
    expect(composerBox()).toHaveValue('Use the small table.');
    expect(screen.getByText('Your unsent words are in the message box.')).toBeVisible();
  });

  it('words in both boxes, the details arrive before the send fails: each box’s words are in the message box once', async () => {
    let refuse: (e: unknown) => void = () => {};
    const post = vi.fn((p: string): Promise<unknown> => (p.endsWith('/gate') ? new Promise((_res, rej) => { refuse = rej; }) : Promise.resolve({ ok: true })));
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    await bothBoxesThenGo('Use the small table.', 'Keep the icon small.');
    await waitFor(() => expect(gatePosts(post)).toHaveLength(1));
    await answeredBeforeTheReply(store);
    await waitFor(() => expect(composerBox()).toHaveValue('Use the small table.'));
    await act(async () => { refuse(new ApiError(503, 'The laptop is away.')); });
    // The sent words that did not go come to the message box once; the other box's are not added again.
    await waitFor(() => expect(times(composerBox().value, 'Keep the icon small.')).toBe(1));
    await act(async () => {});
    expect(times(composerBox().value, 'Use the small table.')).toBe(1);
    expect(times(composerBox().value, 'Keep the icon small.')).toBe(1);
  });

  it('a late answer for brief 2 leaves brief 3’s words in his box and in the store', async () => {
    const { post, answer } = held();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    await bothBoxesThenGo('Old change.', 'A note.');
    await waitFor(() => expect(gatePosts(post)).toHaveLength(1));
    // Brief 2 is answered and brief 3 is raised before the Go's answer comes back.
    server.answered = [2];
    server.gate = { ...GATE, briefNumber: 3, headline: 'Tests ready' };
    act(() => { store.dispatch({ type: 'event', event: ev(250, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(bar()).toHaveTextContent('Tests ready'));
    await waitFor(() => expect(composerBox()).toHaveValue('Old change.'));
    // While brief 2's Go is out this page's calls rest, so brief 3's words are typed elsewhere (the
    // Desk, another tab) and kept in the job's one slot.
    act(() => { writeStored('fw.gateBox.alpha', JSON.stringify({ gate: '#3', session: null, brief: 3, mode: 'changes', notes: { changes: 'Brief three words.', message: '' } })); });
    await answer();
    await act(async () => {});
    expect(localStorage.getItem('fw.gateBox.alpha')).toContain('Brief three words.');
    expect(composerBox()).toHaveValue('Old change.');
    // Drawn again, brief 3's card has his words in its box.
    cleanup();
    setup({ jobs: waiting(), gate: { ...GATE, briefNumber: 3, headline: 'Tests ready' } });
    expect(await screen.findByRole('textbox', { name: /What should change\?/ })).toHaveValue('Brief three words.');
    expect(composerBox()).toHaveValue('Old change.');
  });

  it('after his own Send back the unsent Reply words move to the message box with a line that says so', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A question for later.' } });
    fireEvent.click(await sendBack('Use the small table.'));
    await waitFor(() => expect(composerBox()).toHaveValue('A question for later.'));
    expect(screen.getByText('Your unsent words are in the message box.')).toBeVisible();
    expect(times(composerBox().value, 'Use the small table.')).toBe(0);
  });

  // Fix round 3: a call's error is always seen, and the focus is never lost to the page body.
  const THREE_QUESTIONS: Gate = {
    ...GATE,
    questions: ['Keep the old column?', 'Show it on the phone?', 'Log the merge?'].map((text, i) => ({ id: String(i + 1), text, recommendation: 'a', options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] })),
  } as Gate;
  /** As a browser does: a focused control that is disabled loses the focus to the page body. */
  function focusFixup() {
    const mo = new MutationObserver(() => {
      const at = document.activeElement as HTMLButtonElement | null;
      if (at && at !== document.body && at.disabled) at.blur();
    });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['disabled'] });
    return () => mo.disconnect();
  }
  function watchScrolls() {
    const seen = vi.fn();
    const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: seen });
    return { seen, restore: () => { if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had); else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; } };
  }
  const UNREACHABLE = `Couldn’t reach ${BRAND.name}. Try again.`;
  const cannotReach = () => vi.fn(async (p: string): Promise<unknown> => { if (p.endsWith('/gate')) throw new TypeError('Failed to fetch'); return { ok: true }; });

  it.each([['the laptop app', false], ['the website', true]] as const)('a failed Go on a brief with several questions brings the error into view (%s)', async (_where, hosted) => {
    const { seen, restore } = watchScrolls();
    try {
      const { store } = setup({ jobs: waiting(), gate: THREE_QUESTIONS, post: cannotReach(), hosted });
      const go = await screen.findByRole('button', { name: /^Go: approve/ });
      await waitFor(() => expect(go).toBeEnabled());
      fireEvent.click(go);
      const words = await screen.findByText(UNREACHABLE);
      await waitFor(() => expect(seen.mock.contexts.filter((c) => c === words)).toHaveLength(1));
      expect(seen).toHaveBeenCalledWith({ block: 'nearest' });
      // A redraw with the same words does not scroll again.
      act(() => { store.dispatch({ type: 'event', event: ev(260, 'thread', 'alpha', {}) }); });
      await act(async () => {});
      expect(screen.getByText(UNREACHABLE)).toBe(words);
      expect(seen.mock.contexts.filter((c) => c === words)).toHaveLength(1);
    } finally { restore(); }
  });

  it.each([['the laptop app', false], ['the website', true]] as const)('after a failed Go the focus is on Go, not the page body (%s)', async (_where, hosted) => {
    const undo = focusFixup();
    try {
      setup({ jobs: waiting(), gate: THREE_QUESTIONS, post: cannotReach(), hosted });
      const go = await screen.findByRole('button', { name: /^Go: approve/ });
      await waitFor(() => expect(go).toBeEnabled());
      go.focus();
      fireEvent.click(go);
      await screen.findByText(UNREACHABLE);
      await waitFor(() => expect(go).toHaveFocus());
      expect(document.activeElement).not.toBe(document.body);
    } finally { undo(); }
  });

  it('a failed send never takes the focus from a box he is typing in', async () => {
    setup({ jobs: waiting(), gate: THREE_QUESTIONS, post: cannotReach() });
    fireEvent.click(await sendBack('Use the small table.'));
    await screen.findByText(UNREACHABLE);
    // He went on typing in the message box.
    composerBox().focus();
    await act(async () => {});
    expect(composerBox()).toHaveFocus();
  });

  it('a send that fails puts the words back in the box and in the store', async () => {
    let refuse: (e: unknown) => void = () => {};
    const post = vi.fn((p: string): Promise<unknown> => (p.endsWith('/gate') ? new Promise((_res, rej) => { refuse = rej; }) : Promise.resolve({ ok: true })));
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await sendBack('Use the small table.'));
    await waitFor(() => expect(gatePosts(post)).toHaveLength(1));
    // While it is out, the words are not kept to be moved.
    expect(localStorage.getItem('fw.gateBox.alpha') ?? '').not.toContain('Use the small table.');
    await act(async () => { refuse(new ApiError(503, 'The laptop is away.')); });
    expect(await screen.findByText('The laptop is away.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toHaveValue('Use the small table.');
    expect(localStorage.getItem('fw.gateBox.alpha')).toContain('Use the small table.');
  });

  it('Go spins on the click and cannot be pressed twice', async () => {
    const { post, answer } = held();
    setup({ jobs: waiting(), gate: GATE, post });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    const back = screen.getByRole('button', { name: /^No go: send back/ });
    go.focus();
    fireEvent.click(go);
    fireEvent.click(go);
    await waitFor(() => expect(go).toHaveAttribute('aria-busy', 'true'));
    // It can't be pressed, but it keeps the focus, and a screen reader hears that it is sending.
    expect(go).toHaveAttribute('aria-disabled', 'true');
    expect(go).toHaveFocus();
    expect(go).toHaveAccessibleName('Sending…');
    expect(go.querySelector('.spin-ring')).not.toBeNull();
    expect(back).toBeDisabled();
    expect(gatePosts(post)).toHaveLength(1);
    expect(gatePosts(post)[0][1]).toEqual(expect.objectContaining({ kind: 'approve' }));
    await answer();
  });

  // m2: the greyed calls say why while a decision is out, not "the card under this says why".
  it('while a Go is being sent the other calls say they are off for that', async () => {
    const { post, answer } = held();
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(live()).toHaveTextContent('Sending…'));
    const back = screen.getByRole('button', { name: /^No go: send back/ });
    const reply = screen.getByRole('button', { name: 'Reply' });
    await waitFor(() => expect(back).toBeDisabled());
    expect(back).toHaveAttribute('title', 'Off while your decision is being sent.');
    expect(reply).toBeDisabled();
    expect(reply).toHaveAttribute('title', 'Off while your decision is being sent.');
    await answer();
  });

  it('Reply spins on the click, cannot be pressed twice, and the focus ends on the sent line', async () => {
    const { post, answer } = held();
    setup({ jobs: waiting(), gate: GATE, post });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A note.' } });
    const send = screen.getByRole('button', { name: 'Send the reply' });
    send.focus();
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(send).toHaveAttribute('aria-busy', 'true'));
    expect(gatePosts(post)).toHaveLength(1);
    expect(gatePosts(post)[0][1]).toEqual(expect.objectContaining({ kind: 'message' }));
    expect(live()).toHaveTextContent('Sending…');
    await answer();
    await waitFor(() => expect(live()).toHaveTextContent(SENT_LINE));
    // The bar has no calls now, so no second press; the focus is on something still on screen.
    expect(within(bar()).queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.isConnected).toBe(true);
  });

  it('the page has one live region: empty before the click, then sending, then sent; the focus goes to what was sent', async () => {
    const { post, answer } = held();
    setup({ jobs: waiting(), gate: GATE, post });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    expect(live()).toHaveAttribute('role', 'status');
    expect(live()).toBeEmptyDOMElement();
    go.focus();
    fireEvent.click(go);
    await waitFor(() => expect(live()).toHaveTextContent('Sending…'));
    expect(go).toHaveFocus();
    await answer();
    await waitFor(() => expect(live()).toHaveTextContent(SENT_LINE));
    expect(document.querySelectorAll('[data-next-live]')).toHaveLength(1);
    // The card's note says what went (as before), and has the focus: it is not dropped.
    expect(document.activeElement).toHaveTextContent('Your approval went to the Foreman.');
  });

  it('before the job says the brief is answered, the card’s own a key sends nothing again', async () => {
    // The gap between the run starting and the job being fetched again: the card is still open.
    const post = sentPost({ answers: false });
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(AT_WORK_LINE);
    await act(async () => {});
    expect(document.querySelector('[data-gate="approve"]')).not.toBeNull();
    fireEvent.keyDown(document.body, { key: 'a' });
    await act(async () => {});
    expect(gatePosts(post)).toHaveLength(1);
  });

  it('a press while sent sends nothing', async () => {
    const post = sentPost();
    setup({ jobs: waiting(), gate: GATE, post });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    fireEvent.click(go);
    await within(bar()).findByText(AT_WORK_LINE);
    // The calls are gone from the bar; a second click or the a key sends nothing.
    expect(calls()).toHaveLength(0);
    fireEvent.click(go);
    fireEvent.keyDown(document.body, { key: 'a' });
    await act(async () => {});
    expect(gatePosts(post)).toHaveLength(1);
  });

  it('after the server accepts, the bar says it was sent and the Foreman is at work on it', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    expect(await within(bar()).findByText(AT_WORK_LINE)).toBeInTheDocument();
    expect(live()).toHaveTextContent(AT_WORK_LINE);
    // The calls are gone: nothing spins and nothing can be pressed again.
    expect(calls()).toHaveLength(0);
  });

  it('after 30 seconds with no change it says "Nothing has moved yet." and offers Try again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup({ jobs: waiting(), gate: GATE, post: sentPost({ runEvent: false }) });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    act(() => { vi.advanceTimersByTime(29_000); });
    expect(within(bar()).queryByText('Nothing has moved yet.')).toBeNull();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(within(bar()).getByText('Nothing has moved yet.')).toBeInTheDocument();
    expect(live()).toHaveTextContent('Nothing has moved yet.');
    expect(within(bar()).queryByText(SENT_LINE)).toBeNull();
    expect(within(bar()).getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  // m1: a send with no answer at all.
  it('a Go that gets no answer: after 30 seconds from the click, "Nothing has moved yet." with Try again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { post, answer } = held();
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(live()).toHaveTextContent('Sending…'));
    act(() => { vi.advanceTimersByTime(29_000); });
    expect(bar()).not.toHaveTextContent('Nothing has moved yet.');
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(within(bar()).getByText('Nothing has moved yet.')).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'Try again' })).toBeEnabled();
    await answer();
  });

  it('Try again sends the same decision once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = sentPost({ runEvent: false });
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    act(() => { vi.advanceTimersByTime(30_000); });
    const again = within(bar()).getByRole('button', { name: 'Try again' });
    fireEvent.click(again);
    fireEvent.click(again);
    expect(await within(bar()).findByText(SENT_LINE)).toBeInTheDocument();
    const sent = gatePosts(post);
    expect(sent).toHaveLength(2);
    expect(sent[1][1]).toEqual(sent[0][1]);
  });

  it('Try again shows the server’s refusal where errors show, and the bar goes back to how it was', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    const post = vi.fn(async (path: string): Promise<unknown> => {
      if (path.endsWith('/gate') && n++ > 0) throw new ApiError(409, 'The Foreman has moved on to brief 3 since this card was shown. Nothing was sent; decide on the new brief.', { code: 'stale-brief' });
      return { ok: true, sent: true, text: 'sent' };
    });
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    act(() => { vi.advanceTimersByTime(30_000); });
    fireEvent.click(within(bar()).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/moved on to brief 3/)).toHaveAttribute('role', 'alert');
    expect(within(bar()).queryByText('Nothing has moved yet.')).toBeNull();
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  // Fix round 2: focus after Try again, and the bar's calls while it is out.
  /** Sent at once the first time; later gate posts answer only when told to (or are refused). */
  function sentThenHeld() {
    let n = 0;
    let answer: (v: unknown) => void = () => {};
    let fail: (e: unknown) => void = () => {};
    const post = vi.fn((path: string, _body?: unknown): Promise<unknown> => {
      if (!path.endsWith('/gate')) return Promise.resolve({ ok: true });
      if (n++ === 0) return Promise.resolve({ ok: true, sent: true, text: 'sent' });
      return new Promise((res, rej) => { answer = res; fail = rej; });
    });
    return {
      post,
      answer: () => act(async () => { answer({ ok: true, sent: true, text: 'sent' }); }),
      refuse: () => act(async () => { fail(new ApiError(409, 'The Foreman has moved on to brief 3 since this card was shown. Nothing was sent; decide on the new brief.', { code: 'stale-brief' })); }),
    };
  }
  async function stuckThenTryAgain(post: (path: string, body?: unknown) => Promise<unknown>) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup({ jobs: waiting(), gate: GATE, post: vi.fn(post) });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    act(() => { vi.advanceTimersByTime(30_000); });
    const again = within(bar()).getByRole('button', { name: 'Try again' });
    again.focus();
    fireEvent.click(again);
    await waitFor(() => expect(again).toHaveAttribute('aria-busy', 'true'));
    expect(again).toHaveFocus();
    return again;
  }

  it('after Try again succeeds the focus is on the sent line, not the page', async () => {
    const { post, answer } = sentThenHeld();
    await stuckThenTryAgain(post);
    await answer();
    const line = await within(bar()).findByText(SENT_LINE);
    await waitFor(() => expect(within(bar()).queryByRole('button', { name: /Try again|Sending/ })).toBeNull());
    expect(line).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('after Try again is refused again the focus is on the server’s sentence, not the page', async () => {
    const { post, refuse } = sentThenHeld();
    await stuckThenTryAgain(post);
    await refuse();
    const said = await screen.findByText(/moved on to brief 3/);
    // Try again is gone (the bar is back to how it was), so the focus goes to why it sent nothing.
    expect(within(bar()).queryByRole('button', { name: /Try again|Sending/ })).toBeNull();
    expect(said).toHaveFocus();
  });

  it('while Try again is out, Go and Send back are not in the bar, and the a key sends nothing', async () => {
    const { post, answer } = sentThenHeld();
    await stuckThenTryAgain(post);
    expect(calls()).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: 'a' });
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(gatePosts(post)).toHaveLength(2);
    expect(screen.queryByText(/What should change\?/)).toBeNull();
    await answer();
  });

  it('when the job moves on, the bar clears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost({ runEvent: false }) });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    // The job moves on: its stage and what it waits for change, and its gate goes.
    server.gate = null;
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: waiting({ stage: 'implement', waitingFor: null, lane: 'working' }), meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(bar()).not.toHaveTextContent(SENT_LINE));
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(bar()).not.toHaveTextContent('Nothing has moved yet.');
  });

  it('Send back spins on the click and cannot be pressed twice', async () => {
    const { post, answer } = held();
    setup({ jobs: waiting(), gate: GATE, post });
    const back = await screen.findByRole('button', { name: /^No go: send back/ });
    const go = screen.getByRole('button', { name: /^Go: approve/ });
    const send = await sendBack();
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(send).toHaveAttribute('aria-busy', 'true'));
    expect(send).toHaveAccessibleName('Sending…');
    expect(send.querySelector('.spin-ring')).not.toBeNull();
    expect(back).toHaveAttribute('aria-busy', 'true');
    expect(go).toBeDisabled();
    expect(gatePosts(post)).toHaveLength(1);
    expect(gatePosts(post)[0][1]).toEqual(expect.objectContaining({ kind: 'changes', note: 'Use the small table.' }));
    await answer();
  });

  it('after the server accepts a send back, the bar says it was sent and the Foreman is at work on it', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    fireEvent.click(await sendBack());
    expect(await within(bar()).findByText(AT_WORK_LINE)).toBeInTheDocument();
    expect(bar()).toHaveTextContent('Sent back: the Foreman stays at Plan and revises. Nothing is approved.');
    expect(live()).toHaveTextContent(`${AT_WORK_LINE} Sent back: the Foreman stays at Plan and revises. Nothing is approved.`);
  });

  it('after the server accepts a reply, the bar says nothing is approved', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A note.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    expect(await within(bar()).findByText(AT_WORK_LINE)).toBeInTheDocument();
    expect(bar()).toHaveTextContent('Your reply reached the Foreman. Nothing is approved, so the card stays open.');
    expect(live()).toHaveTextContent(`${AT_WORK_LINE} Your reply reached the Foreman. Nothing is approved, so the card stays open.`);
  });

  it('after the Foreman answers a reply, Reply, Go and Send back can be pressed again', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A note.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await within(bar()).findByText(AT_WORK_LINE);
    // The Foreman picks the message up (the run the reply started): the bar keeps its words, no calls.
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ id: 'r_sent_1', status: 'running' }));
    expect(bar()).toHaveTextContent('Your reply reached the Foreman. Nothing is approved, so the card stays open.');
    expect(calls()).toHaveLength(0);
    // It answers: the gate is still waiting.
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_sent_1', slug: 'alpha', status: 'done' }) }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    expect(screen.getByRole('button', { name: /^Go: approve/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^No go: send back/ })).toBeEnabled();
    // The bar reads as waiting again.
    expect(bar()).toHaveTextContent('Say go and the Foreman goes ahead: Build step 1');
    expect(bar()).not.toHaveTextContent('Nothing is approved');
  });

  it('a reply with answers and no note is sent', async () => {
    const post = sentPost();
    setup({ jobs: waiting(), gate: { ...GATE, questions: [{ id: '1', text: 'Keep the old column?', recommendation: null, options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] }] } as Gate, post });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await screen.findByRole('textbox', { name: /Your answers or a note/ });
    expect(screen.getByRole('button', { name: 'Send the reply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send the reply' })).toHaveAttribute('title', 'Pick an answer or write a note first.');
    fireEvent.click(screen.getByRole('radio', { name: /No/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'message', answers: { 1: { choice: 'b' } } })));
  });

  it('after 30 seconds with no change to a send back it says "Nothing has moved yet."; Try again sends the same send back once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = sentPost({ runEvent: false });
    setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await sendBack());
    await within(bar()).findByText(SENT_LINE);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(within(bar()).getByText('Nothing has moved yet.')).toBeInTheDocument();
    const again = within(bar()).getByRole('button', { name: 'Try again' });
    fireEvent.click(again);
    fireEvent.click(again);
    await within(bar()).findByText(SENT_LINE);
    const sent = gatePosts(post);
    expect(sent).toHaveLength(2);
    expect(sent[1][1]).toEqual(sent[0][1]);
    expect(sent[1][1]).toEqual(expect.objectContaining({ kind: 'changes', note: 'Use the small table.' }));
  });

  it('when the job moves on after a send back, the bar clears', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost({ runEvent: false }) });
    fireEvent.click(await sendBack());
    await within(bar()).findByText(SENT_LINE);
    server.gate = null;
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: waiting({ waitingFor: null, lane: 'working' }), meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(bar()).not.toHaveTextContent(SENT_LINE));
  });

  // Deep review D, I1: the server answers `sent` with a started run, so the sent state clears at once;
  // the bar keeps its words after the run started, and the old ask never comes back.
  it('Go: after the run started the bar still says it was sent, with no calls', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    const watch = watchBar();
    fireEvent.click(go);
    await within(bar()).findByText(AT_WORK_LINE);
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ status: 'running' }));
    await act(async () => {});
    expect(within(bar()).getByText(AT_WORK_LINE)).toBeInTheDocument();
    expect(live()).toHaveTextContent(AT_WORK_LINE);
    expect(calls()).toHaveLength(0);
    expect(bar()).toHaveTextContent('Your go reached the Foreman. Build starts next.');
    expect(bar()).not.toHaveTextContent('Nothing is approved');
    expect(bar()).not.toHaveTextContent('rework');
    // A run is at work: no Try again.
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(watch.stop().comeBack).toEqual([]);
  });

  it('Send back: after the run started the bar says it was sent and that the Foreman stays at the step', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    const send = await sendBack();
    const watch = watchBar();
    fireEvent.click(send);
    await within(bar()).findByText(AT_WORK_LINE);
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ status: 'running' }));
    await act(async () => {});
    expect(within(bar()).getByText(AT_WORK_LINE)).toBeInTheDocument();
    expect(bar()).toHaveTextContent('Sent back: the Foreman stays at Plan and revises. Nothing is approved.');
    expect(calls()).toHaveLength(0);
    expect(watch.stop().comeBack).toEqual([]);
  });

  it('Reply: while the run it started works the bar says it was sent and that nothing is approved', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE, post: sentPost() });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A note.' } });
    const watch = watchBar();
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await within(bar()).findByText(AT_WORK_LINE);
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ status: 'running' }));
    await act(async () => {});
    expect(within(bar()).getByText(AT_WORK_LINE)).toBeInTheDocument();
    expect(bar()).toHaveTextContent('Your reply reached the Foreman. Nothing is approved, so the card stays open.');
    expect(calls()).toHaveLength(0);
    expect(watch.stop().comeBack).toEqual([]);
  });

  it('an answered brief drawn again (the page opened later) says it was sent, with no calls and no Try again while a run works', async () => {
    server.answered = [];
    const { store } = setup({ jobs: waiting(), gate: GATE });
    server.answered.push(2);
    act(() => { store.dispatch({ type: 'event', event: ev(20, 'run', 'alpha', { id: 'r_x', slug: 'alpha', status: 'running' }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(21, 'thread', 'alpha', {}) }); });
    // The bar is drawn again once the job is fetched: look it up each time.
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    expect(calls()).toHaveLength(0);
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(bar()).not.toHaveTextContent('Say go and the Foreman goes ahead');
  });

  // Part 2: an answered brief that has stalled offers Try again; a held answer is not "sent".
  it('answered, and 30 s after the run ended with nothing new: "Nothing has moved yet." with Try again, which sends the same decision again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = sentPost();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(AT_WORK_LINE);
    // The run ends; the brief is still the answered one and nothing new starts.
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_sent_1', slug: 'alpha', status: 'done', endedAt: new Date().toISOString() }) }); });
    act(() => { vi.advanceTimersByTime(29_000); });
    // The run is over: the line waits for the Foreman again.
    expect(bar()).toHaveTextContent(SENT_LINE);
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
    act(() => { vi.advanceTimersByTime(2_000); });
    await waitFor(() => expect(bar()).toHaveTextContent('Nothing has moved yet.'));
    const again = within(bar()).getByRole('button', { name: 'Try again' });
    expect(calls()).toHaveLength(0);
    fireEvent.click(again);
    await waitFor(() => expect(gatePosts(post)).toHaveLength(2));
    expect(gatePosts(post)[1][1]).toEqual(gatePosts(post)[0][1]);
  });

  it('a page opened on an answered brief with no run and no decision of its own: "Nothing has moved yet.", write to the Foreman, no Try again', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE });
    server.answered.push(2);
    act(() => { store.dispatch({ type: 'event', event: ev(20, 'run', 'alpha', { id: 'r_old', slug: 'alpha', status: 'done', endedAt: new Date(Date.now() - 31_000).toISOString() }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(21, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(bar()).toHaveTextContent('Nothing has moved yet.'));
    // M2: no "below": at 1280 px and wider the message box is to the right.
    expect(bar()).toHaveTextContent('Write to the Foreman to move it on.');
    expect(bar()).not.toHaveTextContent('below');
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(calls()).toHaveLength(0);
  });

  it('an answer held for the usage limit says so, not "Sent", with no calls', async () => {
    const { store } = setup({ jobs: waiting(), gate: GATE });
    server.held = { kind: 'approve', gateBrief: 2, at: NOW };
    act(() => { store.dispatch({ type: 'event', event: ev(21, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(bar()).toHaveTextContent('Held until Claude’s usage limit resets.'));
    expect(bar()).not.toHaveTextContent(SENT_LINE);
    expect(calls()).toHaveLength(0);
    expect(live()).toHaveTextContent('Held until Claude’s usage limit resets.');
  });

  // Round 2, M6: a job started again under the same name is a new job: the old answer is forgotten.
  it('after the job is started again (a new session), its brief 2 asks again; the old answer is not kept', async () => {
    const post = sentPost();
    const { store } = setup({ jobs: waiting(), gate: GATE, post, drive: { sessionId: 's1', model: 'claude-opus-5-5' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    // Started again: a new Foreman session, the same brief number open again, nothing answered.
    server.answered = [];
    server.drive = { sessionId: 's2', model: 'claude-fable-5-2' };
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_new', slug: 'alpha', status: 'done', endedAt: new Date().toISOString() }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(201, 'thread', 'alpha', {}) }); });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    // Neither sent line (fix round 1, M2): the old answer is not kept.
    expect(bar()).not.toHaveTextContent(SENT_LINE);
    expect(bar()).not.toHaveTextContent(AT_WORK_LINE);
    fireEvent.click(go);
    await waitFor(() => expect(gatePosts(post)).toHaveLength(2));
  });

  // Round 2, M7: Try again sends a decision only, never a Reply's words.
  it('after a Reply, a brief decided elsewhere that stalls says to write to the Foreman, with no Try again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = sentPost();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Your answers or a note/ }), { target: { value: 'A note.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the reply' }));
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    // Another page decided the brief; the reply's run ends and nothing new comes.
    server.answered.push(2);
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_sent_1', slug: 'alpha', status: 'done', endedAt: new Date().toISOString() }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(201, 'thread', 'alpha', {}) }); });
    act(() => { vi.advanceTimersByTime(31_000); });
    await waitFor(() => expect(bar()).toHaveTextContent('Nothing has moved yet.'));
    expect(bar()).toHaveTextContent('Write to the Foreman');
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(gatePosts(post)).toHaveLength(1);
  });

  // Round 2, N2: the stalled line is never said to a job that waits on something else, or has moved.
  const answeredAndEnded = (store: Store) => {
    server.answered.push(2);
    act(() => { store.dispatch({ type: 'event', event: ev(20, 'run', 'alpha', { id: 'r_old', slug: 'alpha', status: 'error', endedAt: new Date(Date.now() - 300_000).toISOString() }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(21, 'thread', 'alpha', {}) }); });
  };
  it('a job paused for the usage limit says so, in the page’s own words, never "Nothing has moved yet."', async () => {
    const { store } = setup({ jobs: waiting({ limitPaused: new Date(Date.now() + 3_600_000).toISOString(), group: 'paused', lane: 'working', laneReason: 'Paused for the usage limit; carries on at 15:00' }), gate: GATE });
    answeredAndEnded(store);
    await waitFor(() => expect(bar()).toHaveTextContent('Paused for the usage limit; carries on at 15:00'));
    await act(async () => {});
    expect(bar()).not.toHaveTextContent('Nothing has moved yet.');
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(calls()).toHaveLength(0);
  });

  it('a job cut off by a restart says it waits for Resume, never "Nothing has moved yet."', async () => {
    const { store } = setup({ jobs: waiting({ restartPaused: { how: 'crash' }, group: 'paused', lane: 'working', laneReason: 'Paused by a restart; waits for Resume' }), gate: GATE });
    answeredAndEnded(store);
    await waitFor(() => expect(bar()).toHaveTextContent('Paused by a restart; waits for Resume'));
    await act(async () => {});
    expect(bar()).not.toHaveTextContent('Nothing has moved yet.');
    expect(within(bar()).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('a stale page: when the run ends the job is fetched again, and the bar asks about the new brief, never "Nothing has moved yet."', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = sentPost();
    const { store } = setup({ jobs: waiting(), gate: GATE, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    // The run ends; what the page reads then still shows brief 2 answered (the server's list lags).
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_sent_1', slug: 'alpha', status: 'done', endedAt: new Date().toISOString() }) }); });
    await act(async () => {});
    expect(bar()).toHaveTextContent(SENT_LINE);
    // Meanwhile the Foreman raised brief 3; no thread event reaches this page.
    server.gate = { ...GATE, briefNumber: 3, headline: 'Tests ready', nextProposed: 'Open PR #1' };
    act(() => { vi.advanceTimersByTime(31_000); });
    await waitFor(() => expect(bar()).toHaveTextContent('Say go and the Foreman goes ahead: Open PR #1'));
    expect(bar()).not.toHaveTextContent('Nothing has moved yet.');
    expect(gatePosts(post)).toHaveLength(1);
  });

  it('before it says "Nothing has moved yet." the page fetches the job once more', async () => {
    const { store, get } = setup({ jobs: waiting(), gate: GATE });
    server.answered.push(2);
    act(() => { store.dispatch({ type: 'event', event: ev(21, 'thread', 'alpha', {}) }); });
    await waitFor(() => expect(bar()).toHaveTextContent(SENT_LINE));
    const before = get.mock.calls.filter(([p]) => p === '/api/job/alpha').length;
    act(() => { store.dispatch({ type: 'event', event: ev(22, 'run', 'alpha', { id: 'r_old', slug: 'alpha', status: 'done', endedAt: new Date(Date.now() - 31_000).toISOString() }) }); });
    await waitFor(() => expect(bar()).toHaveTextContent('Nothing has moved yet.'));
    expect(get.mock.calls.filter(([p]) => p === '/api/job/alpha').length).toBeGreaterThan(before);
  });

  // Round 2, N1: a go / no go with no brief number (the reviewer's team-invites and audit-log).
  const UNNUMBERED: Gate = { ...GATE, briefNumber: null, briefFile: null } as unknown as Gate;
  it('no brief number: after Go the sent line shows and stays while the Foreman works; the old ask and its calls never come back', async () => {
    const { store } = setup({ jobs: waiting(), gate: UNNUMBERED, post: sentPost() });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    const watch = watchBar();
    fireEvent.click(go);
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    expect(store.getState().runs.alpha).toEqual(expect.objectContaining({ status: 'running' }));
    // The job is fetched again (a thread event): its gate still has the same words and no number.
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await act(async () => {});
    expect(bar()).toHaveTextContent(AT_WORK_LINE);
    expect(calls()).toHaveLength(0);
    expect(watch.stop().comeBack).toEqual([]);
  });

  it('no brief number: a second Go, by the button or the a key, sends nothing', async () => {
    const post = sentPost();
    const { store } = setup({ jobs: waiting(), gate: UNNUMBERED, post });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    fireEvent.click(go);
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    act(() => { store.dispatch({ type: 'event', event: ev(300, 'thread', 'alpha', {}) }); });
    await act(async () => {});
    fireEvent.click(go);
    for (const b of within(bar()).queryAllByRole('button')) fireEvent.click(b);
    document.querySelector<HTMLButtonElement>('[data-gate="approve"]')?.click();
    fireEvent.keyDown(document.body, { key: 'a' });
    await act(async () => {});
    expect(gatePosts(post)).toHaveLength(1);
  });

  it('no brief number: once the gate’s words change, it asks again', async () => {
    const { store } = setup({ jobs: waiting(), gate: UNNUMBERED, post: sentPost() });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(bar()).toHaveTextContent(AT_WORK_LINE));
    act(() => { store.dispatch({ type: 'event', event: ev(200, 'run', 'alpha', { id: 'r_sent_1', slug: 'alpha', status: 'done', endedAt: new Date().toISOString() }) }); });
    server.gate = { ...UNNUMBERED, headline: 'Build done', nextProposed: 'Run the tests' } as Gate;
    act(() => { store.dispatch({ type: 'event', event: ev(301, 'thread', 'alpha', {}) }); });
    expect(await screen.findByRole('button', { name: /^Go: approve/ })).toBeEnabled();
    expect(bar()).toHaveTextContent('Say go and the Foreman goes ahead: Run the tests');
  });

  it('once the brief is answered and the gate goes, the bar without a gate still says it was sent', async () => {
    setup({ jobs: waiting(), gate: GATE, post: sentPost({ runEvent: false }) });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText(SENT_LINE);
    // The same job, its page drawn again without its gate (the Foreman's status no longer waits on it).
    cleanup();
    setup({ jobs: waiting(), gate: null, post: sentPost({ runEvent: false }) });
    expect(within(bar()).getByText(SENT_LINE)).toBeInTheDocument();
  });
});

// Deep review D, C1: Auto is on the page the person answers on, not only in a header no page shows.
describe('Auto on the job page', () => {
  const STOPPED = { on: true, by: 'you' as const, ran: true, stopped: { reason: 'a database change needs you.', rule: 'database', at: NOW } };
  const head = () => document.querySelector('.sb-job-top')!;

  // This page has no Details: the locked model line is in the header (.sb-job-top) and under the message box.
  it('an Auto job has the switch and What Auto decided in the page head, and the locked model line in the header and under the message box', async () => {
    setup({ jobs: [job('alpha', 'running', { stage: 'plan', level: 1, auto: { on: true, by: 'you', ran: true } })], drive: { sessionId: 's1', model: 'claude-opus-5-5' } });
    const box = screen.getByRole('checkbox', { name: /Auto: run to PR #1/ });
    expect(box).toBeChecked();
    expect(box.closest('.job-details')).toBeNull();
    expect(head().contains(box)).toBe(true);
    const what = screen.getByRole('button', { name: 'What Auto decided' });
    expect(head().contains(what)).toBe(true);
    await waitFor(() => expect(screen.getAllByText(/Foreman model: Opus 5\.5/)).toHaveLength(2));
    const [inHead, underBox] = screen.getAllByText(/Foreman model: Opus 5\.5/);
    expect(head().contains(inHead)).toBe(true);
    expect(inHead.querySelector('svg, .icon')).not.toBeNull();
    expect(underBox.closest('.sb-convo-foot')).not.toBeNull();
    expect(underBox.querySelector('svg, .icon')).not.toBeNull();
  });

  it('a job without Auto still has the switch, off, so Auto can be turned on', () => {
    setup({ jobs: [job('alpha', 'idle', { stage: 'plan', level: 1 })] });
    expect(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'What Auto decided' })).toBeNull();
  });

  it('a stopped Auto job says why it stopped in the bar, not "Say go and the Foreman goes ahead"', async () => {
    const reason = 'Auto stopped: a database change needs you.';
    setup({ jobs: [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', level: 1, waitingFor: 'approval', laneReason: reason, auto: STOPPED })], gate: GATE });
    await screen.findByRole('button', { name: /^Go: approve/ });
    const bar = screen.getByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent(reason);
    expect(bar).not.toHaveTextContent('Say go and the Foreman goes ahead');
  });

  it('while Auto is deciding the bar says so, the calls stay usable, and his own answer still counts', async () => {
    const { post } = setup({ jobs: [job('alpha', 'running', { stage: 'plan', lane: 'working', level: 1, waitingFor: 'approval', laneReason: 'Auto is deciding: the plan', auto: { on: true, by: 'you', ran: true } })], gate: GATE });
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    await waitFor(() => expect(go).toBeEnabled());
    const bar = screen.getByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Auto is deciding: the plan');
    expect(bar).not.toHaveTextContent('Say go and the Foreman goes ahead');
    expect(screen.getByText('Auto is deciding this step. Your own answer still counts.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^No go: send back/ })).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve' })));
  });

  it('an ordinary job never says Auto is deciding', async () => {
    setup({ jobs: [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', waitingFor: 'approval' })], gate: GATE });
    await screen.findByRole('button', { name: /^Go: approve/ });
    expect(screen.queryByText(/Auto is deciding/)).toBeNull();
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('Say go and the Foreman goes ahead: Build step 1');
  });
});

describe('the permission alert', () => {
  const ask = (id: string, at: string, extra: Partial<Permission> = {}): Permission => ({ ...permission(id, 'alpha'), createdAt: at, input: { command: 'npm test' }, ...extra });

  it('takes the bar’s place: what it wants, the exact step, Allow once (a) and Deny (d); the rest fold oldest first', async () => {
    const { post } = setup({ permissions: [ask('p2', '2026-10-21T10:05:00Z'), ask('p1', '2026-10-21T10:00:00Z', { agentType: 'feature-tester' }), ask('p3', '2026-10-21T10:09:00Z')] });
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
    const alert = screen.getByRole('region', { name: 'Permission: Run a command' });
    expect(alert).toHaveTextContent('The Tester wants to run a command');
    expect(alert).toHaveTextContent('npm test');
    expect(within(alert).getByRole('button', { name: /^Allow once/ }).querySelector('kbd')).toHaveTextContent('a');
    expect(screen.getByText('2 more waiting').closest('details')).not.toHaveAttribute('open');
    // Not offered: the dashboard can't keep a rule for one job here.
    expect(within(alert).queryByRole('button', { name: 'Always allow for this job' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'a' });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/p1', expect.objectContaining({ decision: 'allow' })));
  });

  it('a hard line: no key allows it, and it is never remembered', () => {
    const { post } = setup({ permissions: [ask('p1', '2026-10-21T10:00:00Z', { hardLine: { line: 'push', reason: 'It pushes to GitHub.' }, canAllowForJob: true } as Partial<Permission>)] });
    const alert = screen.getByRole('region', { name: 'Permission: Run a command' });
    expect(alert).toHaveTextContent('Hard line');
    expect(alert).toHaveTextContent('Why it asks: It pushes to GitHub.');
    expect(alert).toHaveTextContent('A key never allows a hard line.');
    expect(within(alert).getByRole('button', { name: /^Allow once/ }).querySelector('kbd')).toBeNull();
    expect(within(alert).queryByRole('button', { name: /Always allow/ })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(post).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'd' });
    expect(within(alert).getByRole('button', { name: /^Deny/ })).toBeInTheDocument();
  });

  it('offers Always allow for this job only where the dashboard can keep it', async () => {
    const { post } = setup({ permissions: [ask('p1', '2026-10-21T10:00:00Z', { canAllowForJob: true } as Partial<Permission>)] });
    fireEvent.click(screen.getByRole('button', { name: 'Always allow for this job' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/p1', expect.objectContaining({ decision: 'allow-job' })));
  });

  it('folds a long step', () => {
    setup({ permissions: [ask('p1', '2026-10-21T10:00:00Z', { input: { command: 'a\nb\nc\nd\ne' } })] });
    const step = screen.getByText(/The exact step/).closest('details')!;
    expect(step).not.toHaveAttribute('open');
    expect(step).toHaveTextContent('5 lines');
  });
});

// A narrow window (760 px and under, useNarrow) shows the phone's own layout (PhoneJob), and nothing
// only the laptop uses runs there: one ask for the evidence, one for the step, one handler per request.
describe('a narrow window', () => {
  const PHONE = 390;
  const evidenceAsks = (get: ReturnType<typeof vi.fn>) => get.mock.calls.filter(([p]) => p === '/api/job/alpha/evidence').length;

  it('a narrow window shows the phone layout', () => {
    windowWidth(PHONE);
    setup({ jobs: [working('plan')] });
    expect(page()).toHaveClass('sb-phone');
    expect(page().querySelector('.sb-job-top')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Job alpha' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Steps' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Conversation/ })).toBeInTheDocument();
  });

  it('in a narrow window the evidence is asked for once, the step once, and Review the screens adds one history entry', async () => {
    windowWidth(PHONE);
    function Screens() { const ui = useUi(); return <button type="button" onClick={() => ui.openScreens('alpha')}>review the screens</button>; }
    window.location.hash = '#/job/alpha/stage/plan';
    const { get } = setup({ jobs: [working('plan')], routed: true, extra: <Screens /> });
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument();
    expect(await screen.findByText('Documents from this step')).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(evidenceAsks(get)).toBe(1);
    expect(stageCalls(get, 'plan')).toBe(1);
    expect(get.mock.calls.filter(([p]) => /\/stage\//.test(p as string))).toHaveLength(1);
    const before = window.history.length;
    fireEvent.click(screen.getByRole('button', { name: 'review the screens' }));
    expect(window.location.hash).toBe('#/job/alpha/screens');
    expect(window.history.length).toBe(before + 1);
  });

  it('in a narrow window a document link opens the document', async () => {
    windowWidth(PHONE);
    function Link() { const ui = useUi(); return <button type="button" onClick={() => ui.openDocs('implementation-plan.md')}>the plan</button>; }
    window.location.hash = '#/job/alpha';
    const { get } = setup({ jobs: [working('implement')], routed: true, extra: <Link />, more: { page: { docs: { plan: [DOCS[0]], none: [] } } } });
    expect(page()).toHaveClass('sb-phone');
    // Once the job's details (with which step owns each document) are in.
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/job/alpha'));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'the plan' }));
    expect(window.location.hash).toBe('#/job/alpha/stage/plan');
    // The phone's step screen: its panel is a region named by the screen's heading.
    const reader = await within(await screen.findByRole('region', { name: 'Plan' })).findByRole('article', { name: 'Implementation plan' });
    expect(await within(reader).findByText('implementation-plan.md body')).toBeInTheDocument();
  });

  it.each([['the laptop app', false], ['the website', true]] as const)('in a narrow window a waiting Auto job has No go: send back, Reply and Go, enabled (%s)', async (_where, hosted) => {
    windowWidth(PHONE);
    const deciding = job('alpha', 'running', { stage: 'plan', lane: 'working', level: 1, waitingFor: 'approval', laneReason: 'Auto is deciding: the plan', auto: { on: true, by: 'you', ran: true } });
    setup({ jobs: [deciding], gate: GATE, auto: { on: true, tag: null }, hosted });
    expect(page()).toHaveClass('sb-phone');
    await waitFor(() => {
      const calls = within(bar()).getAllByRole('button').map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
      expect(calls).toEqual([expect.stringMatching(/^No go: send back/), 'Reply', expect.stringMatching(/^Go: approve/)]);
      for (const b of within(bar()).getAllByRole('button')) expect(b).toBeEnabled();
    });
  });
});

describe('a branch that was only guessed, on the laptop page', () => {
  const GUESSED = 'feature/someone-elses-branch';
  const guessed = { repoPath: '/Users/me/Projects/moxie-portal', branch: GUESSED, locate: { path: '/Users/me/Projects/moxie-portal', branch: GUESSED, branchGuessed: true } } as unknown as Partial<JobDetail>;
  const detailAsks = (get: ReturnType<typeof vi.fn>) => get.mock.calls.filter(([p]) => p === '/api/job/alpha').length;

  it('This is the job’s branch records the branch and reads the job again', async () => {
    const { get, post } = setup({ jobs: [working('plan')], more: guessed });
    const top = page().querySelector<HTMLElement>('.sb-job-top')!;
    const guess = await within(top).findByRole('group', { name: 'The job’s branch' });
    expect(within(guess).getByText('Branch (a guess):')).toBeInTheDocument();
    const before = detailAsks(get);
    fireEvent.click(within(guess).getByRole('button', { name: 'This is the job\'s branch' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/repo', { repoPath: '/Users/me/Projects/moxie-portal', branch: GUESSED }));
    await waitFor(() => expect(detailAsks(get)).toBeGreaterThan(before));
  });
});
