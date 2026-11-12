// The job page on a phone (Part 3, Task 16): four simple screens chosen by the address. The job (the
// bar and its card first, then the steps, Overview, Copy decisions, What Auto decided and the Auto
// switch, with Conversation fixed at the bottom), a step, the conversation and the overview. And the
// owner's one requirement: a job that waits for him has Send back, Reply and Go on the job screen and
// on the screen of the step that waits, on an Auto job too, on the laptop and on the website. The
// setup is the laptop page's (JobPage.test.tsx), with the page under the router as the address
// picks the screen. Invented jobs only; no model calls, no browser, no network.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { useState, type ReactNode } from 'react';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { EvidenceView, Gate, Job, JobDetail, JobDoc, JobDocEntry, Permission, StageView, StopId, ThreadItem } from '../../api/types';
import { DETAIL_KEY } from '../../app/detail';
import { installKeyListener } from '../../app/keyRegistry';
import { useRoute, type JobView } from '../../app/router';
import { UiProvider, useUi } from '../../app/ui';
import { STOPS } from '../../components/stops/stops';
import { clearAllSent } from '../../lib/sentState';
import { useJobConversation } from '../../panes/Foreman/ForemanPane';
import { clearGateSent } from '../../panes/Foreman/gateSent';
import { jobBySlug } from '../../state/reducer';
import { createStore, useWorkshopState, WorkshopContext, type Store } from '../../state/store';
import { ev, job, permission, snapshot } from '../../state/test-fixtures';
import { AUTO_LABEL } from '../AutoSwitch';
import { useSentShown } from '../NextStep';
import { seenKey } from './ConversationPanel';
import { MENU_ON_LAPTOP } from './JobTop';
import { PhoneJob } from './PhoneJob';

const NOW = new Date().toISOString();

const GATE: Gate = {
  briefNumber: 2, briefFile: 'briefs/002-plan.md', headline: 'Plan v2 ready', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
  questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: '2026-10-21T09:00:00Z', runActive: false, parked: false,
  level: 1, suggestedLevel: null, levelReason: null, usage: null,
};

const EVIDENCE: EvidenceView = {
  evidence: { version: 1, commit: 'abc1234def', at: NOW, level: 2, criteria: [] },
  commit: 'abc1234def', wanted: true, why: 'This job records evidence.', recording: false, problem: null, folder: '/tmp/evidence', folderUrl: 'file:///tmp/evidence',
};

const PAGE: JobDetail['page'] = {
  ticket: { key: 'ORBIT-900', title: 'Pause a recurring service', url: 'https://orbit.example.test/tickets/ORBIT-900', filedBy: 'Dana Whitfield', filedAt: '2026-11-03T10:00:00Z', description: 'Customers go away for a few weeks.' },
  building: { from: 'spec', version: '3', outcome: ['Office staff can pause a service for 1 to 12 weeks.'], risks: ['A visit already on today’s route stays.'] },
  check: { worksWhen: ['Office staff see Pause on a recurring service.'], mustNot: ['Charge for a paused visit.'] },
};

/** One step's view, as GET /api/job/:slug/stage/:stop answers it. */
const stageView = (slug: string, stop: StopId): StageView => ({
  slug, stop, label: STOPS.find((s) => s.id === stop)!.label, state: 'done', stateWords: 'Done', since: null, stages: [],
  agents: [], finished: [], terminalApp: null, terminalApps: [], docs: [], checks: null, handTest: null, plan: null, prs: [], review: { reviewers: [] },
});

/** One of the job's documents, as GET /api/job/:slug/doc answers it, and its entry in a step's list. */
const docOf = (file: string): JobDoc => ({ file, name: file === 'implementation-plan.md' ? 'Implementation plan' : file, type: 'md', html: `<p>${file} body</p>`, text: file, updatedAt: NOW, size: 10 });
const entryOf = (file: string, group: string): JobDocEntry => ({ file, name: docOf(file).name, group, version: null, updatedAt: NOW, size: 10, type: 'md' } as JobDocEntry);

/** What the test's server knows. */
/** `stageHold`: while set, every step's view waits for it (a held request, resolved by the test). `stageMore`: added to every step's view. */
const server = { store: null as Store | null, answered: [] as number[], stageHold: null as Promise<void> | null, stageMore: {} as Partial<StageView> };

/** The window's width for useMinWidth and useNarrow (jsdom lays nothing out): a phone. */
function windowWidth(px: number) {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = (!min || px >= Number(min[1])) && (!max || px <= Number(max[1]));
    return { matches, media: q, addEventListener() {}, removeEventListener() {} };
  });
}

/** The phone page as the job page will draw it: the address picks the screen; one conversation and one sent line. */
function Screens({ job: j, step, view }: { job: Job; step?: StopId; view?: JobView }) {
  const conversation = useJobConversation(j);
  const sent = useSentShown(j, conversation);
  return <PhoneJob job={j} conversation={conversation} now={new Date()} step={step} view={view} sent={sent} />;
}
function Routed({ slug }: { slug: string }) {
  const route = useRoute();
  const j = jobBySlug(useWorkshopState(), slug);
  if (!j) return null;
  return <Screens job={j} step={route.name === 'stage' ? route.stop : undefined} view={route.name === 'job' ? route.view : undefined} />;
}

function setup({ jobs = [job('alpha', 'idle', { stage: 'plan' })], permissions = [] as Permission[], gate = null as Gate | null, auto = null as JobDetail['auto'] | null, page = undefined as JobDetail['page'], thread = [] as ThreadItem[], hosted = false, at = '#/job/alpha', extra = null as ReactNode, mount = true, play = 'subtle' as 'subtle' | 'full', post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true })), detailMore = {} as Partial<JobDetail> } = {}) {
  window.location.hash = at;
  const store: Store = createStore();
  server.store = store;
  server.answered = [];
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, permissions, meta: { token: 't', settings: { play: { mode: play } }, models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }] } as never }) });
  const detail = (s: string): JobDetail => ({ slug: s, thread, threadMore: false, gate, answeredBriefs: [...server.answered], heldReply: null, options: { level: 1 }, auto, page, ...detailMore } as JobDetail);
  const get = vi.fn(async (p: string): Promise<unknown> => {
    const stage = /^\/api\/job\/([^/]+)\/stage\/([a-z]+)$/.exec(p);
    if (stage) {
      const v = { ...stageView(decodeURIComponent(stage[1]), stage[2] as StopId), ...server.stageMore };
      return server.stageHold ? server.stageHold.then(() => v) : v;
    }
    if (p.endsWith('/evidence')) return EVIDENCE;
    if (p.endsWith('/docs')) return { docs: [] };
    const doc = /\/doc\?file=(.+)$/.exec(p);
    if (doc) return docOf(decodeURIComponent(doc[1]));
    if (p.endsWith('/commits')) return { commits: [] };
    if (p.endsWith('/decisions')) return { decisions: [] };
    if (p.endsWith('/auto')) return { summary: [], entries: [] };
    if (p.endsWith('/local')) return null;
    if (p.startsWith('/api/review/')) return null;
    if (p === '/api/stacks') return { stacks: [] };
    return detail(p.split('/')[3]);
  });
  const api = { get, post, ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><UiProvider>{extra}{mount && <Routed slug="alpha" />}</UiProvider></WorkshopContext.Provider>);
  /** The job as the next snapshot has it. */
  const move = (next: Job[], perms: Permission[] = permissions) => act(() => {
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: next, permissions: perms, meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) });
  });
  return { ...utils, get, post, store, move };
}

let off = () => {};
beforeEach(() => { off = installKeyListener(); windowWidth(390); server.stageHold = null; server.stageMore = {}; });
afterEach(() => { off(); cleanup(); clearAllSent(); clearGateSent(); localStorage.clear(); window.location.hash = ''; vi.unstubAllGlobals(); });

const bar = () => screen.getByRole('region', { name: 'Next step' });
const go = (hash: string) => act(() => { window.location.hash = hash; });
const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
/** The bar's buttons by their words, in order. */
const callsOf = () => within(bar()).getAllByRole('button').map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
async function threeCallsOn() {
  await waitFor(() => {
    expect(callsOf()).toEqual([expect.stringMatching(/^No go: send back/), 'Reply', expect.stringMatching(/^Go: approve/)]);
    for (const b of within(bar()).getAllByRole('button')) expect(b).toBeEnabled();
  });
}

const working = (stage: string, extra: Partial<Job> = {}) => job('alpha', 'running', { stage, lane: 'working', ...extra });
const STOPPED = { on: true, by: 'you' as const, ran: true, stopped: { reason: 'a database change needs you.', rule: 'database', at: NOW } };
const AUTO_STATES: [string, Job][] = [
  ['Auto on', job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', level: 1, waitingFor: 'approval', auto: { on: true, by: 'you', ran: true } })],
  ['Auto deciding', job('alpha', 'running', { stage: 'plan', lane: 'working', level: 1, waitingFor: 'approval', laneReason: 'Auto is deciding: the plan', auto: { on: true, by: 'you', ran: true } })],
  ['Auto stopped', job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', level: 1, waitingFor: 'approval', laneReason: 'Auto stopped: a database change needs you.', auto: STOPPED })],
];
const AUTO_OFF: [string, Job] = ['Auto off', job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', level: 1, waitingFor: 'approval', headline: 'The plan is ready. Start building?' })];

describe('the phone’s job screen', () => {
  it('the phone page leads with the bar and the card, then the steps, then Overview, Copy decisions and the Auto switch', async () => {
    const j = job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', level: 1, waitingFor: 'approval', ticket: 'ORBIT-907', auto: { on: true, by: 'tag', ran: false } });
    setup({ jobs: [j], gate: GATE, auto: { on: true, tag: 'auto' } as JobDetail['auto'] });
    await screen.findByRole('button', { name: /^Go: approve/ });
    const main = screen.getByRole('main', { name: 'Job' });
    // The head: back to Jobs and the gear, the title, the state in a word and the ticket, who started it.
    const back = within(main).getByRole('button', { name: 'Jobs' });
    expect(within(main).getByRole('button', { name: 'Job menu' })).toBeInTheDocument();
    const title = within(main).getByRole('heading', { level: 1, name: 'Job alpha' });
    const chip = within(main).getByText('Needs you', { selector: '.chip' });
    const ticket = within(main).getByText('ORBIT-907');
    const byAuto = await within(main).findByText('Started by Auto · tag auto');
    // Then the bar and its card, the seven steps, Overview, Copy decisions and the Auto switch.
    const next = bar();
    const card = main.querySelector<HTMLElement>('.job-gate-body')!;
    expect(card).not.toHaveAttribute('hidden');
    const steps = within(main).getByRole('heading', { name: 'Steps' });
    const rows = STOPS.map((s) => within(main).getByRole('button', { name: new RegExp(`^${s.label}: `) }));
    expect(rows).toHaveLength(7);
    expect(rows[2]).toHaveAccessibleName(/^Plan: Waiting for you/);
    const overview = within(main).getByRole('button', { name: /^Overview/ });
    const copy = within(main).getByRole('button', { name: 'Copy decisions' });
    expect(within(main).getByText('The product decisions, ready for an Orbit comment')).toBeInTheDocument();
    const auto = within(main).getByRole('checkbox', { name: AUTO_LABEL });
    const convo = within(main).getByRole('button', { name: /^Conversation/ });
    const order = [back, title, chip, ticket, byAuto, next, card, steps, ...rows, overview, copy, auto, convo];
    for (let i = 1; i < order.length; i++) expect(follows(order[i - 1], order[i])).toBe(true);
    // One bar, and the steps are a list of rows here (no tabs).
    expect(screen.getAllByRole('region', { name: 'Next step' })).toHaveLength(1);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it.each([...AUTO_STATES, AUTO_OFF])('Send back and Reply sit side by side with Go under them, all three enabled on an Auto job that is on, deciding or stopped (%s)', async (_name, j) => {
    setup({ jobs: [j], gate: GATE, auto: { on: Boolean(j.auto?.on), tag: null } as JobDetail['auto'] });
    await threeCallsOn();
    // They are the bar's own three: Go is the primary one, and nothing else on the page sends.
    expect(within(bar()).getByRole('button', { name: /^Go: approve/ })).toHaveClass('btn-primary');
    expect(screen.getAllByRole('button', { name: /^No go: send back/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Go: / })).toHaveLength(1);
    // Placed by the phone's stylesheet (jsdom lays nothing out): two columns, Go across both.
    const css = readFileSync(path.join(process.cwd(), 'src/job/page/page.css'), 'utf8');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.()*+?[\]\\^$|{}]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(rule('.sb-phone .job-go .next-actions')).toMatch(/display:\s*grid[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(rule('.sb-phone .job-go .next-actions > .btn-primary, .sb-phone .job-go .next-actions > :only-child')).toMatch(/grid-column:\s*1 \/ -1/);
    // And those rules reach the buttons drawn: Go spans both columns, Send back and Reply share the first row.
    expect(within(bar()).getByRole('button', { name: /^Go: approve/ }).matches('.sb-phone .job-go .next-actions > .btn-primary')).toBe(true);
    for (const b of [within(bar()).getByRole('button', { name: /^No go: send back/ }), within(bar()).getByRole('button', { name: 'Reply' })]) {
      expect(b.matches('.sb-phone .job-go .next-actions > :not(.btn-primary)')).toBe(true);
    }
  });

  it('a step row opens that step’s own screen, and Back returns to the job', async () => {
    setup({ jobs: [working('plan')] });
    const before = window.history.length;
    fireEvent.click(screen.getByRole('button', { name: /^Spec: / }));
    expect(window.location.hash).toBe('#/job/alpha/stage/spec');
    expect(await screen.findByRole('heading', { level: 1, name: 'Spec' })).toBeInTheDocument();
    // The step's own body and documents, once its view is in; no steps list on this screen.
    expect(await screen.findByText('Documents from this step')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Steps' })).toBeNull();
    // A new history entry: the browser's Back returns to the job.
    expect(window.history.length).toBe(before + 1);
    act(() => { window.history.back(); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Job alpha' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/job/alpha');
    // The screen's own back row, named by the job's title, returns too.
    fireEvent.click(screen.getByRole('button', { name: /^Build: / }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Build' })).toBeInTheDocument();
    const deep = window.history.length;
    fireEvent.click(screen.getByRole('button', { name: 'Job alpha' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Job alpha' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/job/alpha');
    // The back row went back: the history did not grow, and the browser's Back now leaves the job, never to Build.
    expect(window.history.length).toBe(deep);
    act(() => { window.history.back(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(window.location.hash).not.toBe('#/job/alpha/stage/build');
  });

  it('a step opened from a link has a back row that still goes to the job', async () => {
    setup({ jobs: [working('plan')], at: '#/job/alpha/stage/review' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Review' })).toBeInTheDocument();
    const before = window.history.length;
    fireEvent.click(screen.getByRole('button', { name: 'Job alpha' }));
    expect(window.location.hash).toBe('#/job/alpha');
    expect(await screen.findByRole('heading', { level: 1, name: 'Job alpha' })).toBeInTheDocument();
    expect(window.history.length).toBe(before + 1);
  });

  it('Conversation is fixed at the bottom, says how many are new, and opens full screen', async () => {
    const at = (m: number) => new Date(Date.UTC(2026, 10, 10, 9, m)).toISOString();
    const thread: ThreadItem[] = [
      { id: 'reply:1', kind: 'reply', at: at(1), html: '<p>Message 1 from the Foreman.</p>' },
      { id: 'reply:2', kind: 'reply', at: at(2), html: '<p>Message 2 from the Foreman.</p>' },
      { id: 'you:3', kind: 'you', at: at(3), text: 'Message 3 from you.' },
      { id: 'reply:4', kind: 'reply', at: at(4), html: '<p>Message 4 from the Foreman.</p>' },
    ];
    // Your last look was at the first message: two of the Foreman's are new; your own never counts.
    localStorage.setItem(seenKey('alpha'), at(1));
    setup({ jobs: [working('plan')], thread });
    const button = await screen.findByRole('button', { name: /^Conversation/ });
    await waitFor(() => expect(button).toHaveTextContent('2 new'));
    // Fixed at the bottom: after the screen's scroll area, not in it.
    const scroll = document.querySelector<HTMLElement>('.sb-phone-scroll')!;
    expect(scroll.contains(button)).toBe(false);
    expect(button.closest('.sb-phone-foot')).not.toBeNull();
    expect(follows(scroll, button)).toBe(true);
    fireEvent.click(button);
    expect(window.location.hash).toBe('#/job/alpha/conversation');
    const panel = await waitFor(() => { const p = document.querySelector<HTMLElement>('.sb-convo.is-full'); expect(p).not.toBeNull(); return p!; });
    expect(within(panel).getByRole('heading', { name: 'Conversation' })).toBeInTheDocument();
    expect(within(panel).getByText(/· 2 new/)).toBeInTheDocument();
    // A plain tap opens it without raising the keyboard: the box is not focused.
    expect(within(panel).getByRole('textbox', { name: /Your message to the Foreman/ })).not.toHaveFocus();
    expect(screen.queryByRole('button', { name: /^Conversation/ })).toBeNull();
    // Back to the job by its title.
    fireEvent.click(screen.getByRole('button', { name: 'Job alpha' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Job alpha' })).toBeInTheDocument();
  });

  it('Overview opens the ticket, what we’re building and what to check', async () => {
    setup({ jobs: [working('plan')], page: PAGE });
    const row = screen.getByRole('button', { name: /^Overview/ });
    await waitFor(() => expect(row).toHaveTextContent('ORBIT-900 as written, what we’re building, what to check'));
    fireEvent.click(row);
    expect(window.location.hash).toBe('#/job/alpha/overview');
    const main = screen.getByRole('main', { name: 'Job' });
    expect(await within(main).findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    // The three parts, one under another, open: nothing folded.
    const parts = ['The ticket', 'What we’re building', 'What to check'].map((name) => within(main).getByRole('heading', { level: 2, name }));
    expect(follows(parts[0], parts[1]) && follows(parts[1], parts[2])).toBe(true);
    expect(main.querySelector('details')).toBeNull();
    expect(within(main).getByText('Pause a recurring service')).toBeInTheDocument();
    expect(within(main).getByText('ORBIT-900 · filed by Dana Whitfield on Nov 3')).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: /Open ORBIT-900 in Orbit/ })).toHaveAttribute('href', PAGE!.ticket!.url);
    expect(within(main).getByText('From spec v3')).toBeInTheDocument();
    expect(within(main).getByText('Office staff can pause a service for 1 to 12 weeks.')).toBeInTheDocument();
    expect(within(main).getByText('A visit already on today’s route stays.')).toBeInTheDocument();
    expect(within(main).getByText('Office staff see Pause on a recurring service.')).toBeInTheDocument();
    expect(within(main).getByText('Charge for a paused visit.')).toBeInTheDocument();
    // A job from before the overview (no page facts): each part says so in a sentence.
    cleanup();
    setup({ jobs: [working('plan')], at: '#/job/alpha/overview' });
    const empty = screen.getByRole('main', { name: 'Job' });
    expect(await within(empty).findByText('This job did not start from an Orbit ticket.')).toBeInTheDocument();
    expect(within(empty).getByText('Not written yet. The Foreman writes this with its first brief.')).toBeInTheDocument();
    expect(within(empty).getByText('Not written yet. The Foreman writes this list with the plan.')).toBeInTheDocument();
  });

  it('the overview screen: a list that is not a list, or has holes, shows as nothing, never a crash', async () => {
    const bad = {
      ...PAGE,
      building: { from: 'spec', version: '3', outcome: 'Pause a service.', risks: [null, 'A visit already on today’s route stays.'] },
      check: { version: null, worksWhen: { 0: 'x' }, mustNot: [null, 'Charge for a paused visit.', 5] },
    } as unknown as JobDetail['page'];
    for (const hosted of [false, true]) {
      setup({ jobs: [working('plan')], page: bad, hosted, at: '#/job/alpha/overview' });
      const main = screen.getByRole('main', { name: 'Job' });
      expect(await within(main).findByText('ORBIT-900 · filed by Dana Whitfield on Nov 3')).toBeInTheDocument();
      expect(within(main).getByText('A visit already on today’s route stays.')).toBeInTheDocument();
      expect(within(main).queryByText('Pause a service.')).toBeNull();
      expect(within(main).getByText('Charge for a paused visit.')).toBeInTheDocument();
      expect(within(main).queryByText('It works when')).toBeNull();
      cleanup();
    }
  });

  it('What Auto decided is a row only once Auto has decided, its note Newest first', async () => {
    const { move } = setup({ jobs: [working('plan', { auto: { on: true, by: 'you', ran: false } })] });
    expect(screen.getByRole('checkbox', { name: AUTO_LABEL })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'What Auto decided' })).toBeNull();
    expect(screen.queryByText('Newest first')).toBeNull();
    move([working('plan', { auto: { on: true, by: 'you', ran: true } })]);
    const row = screen.getByRole('button', { name: 'What Auto decided' });
    expect(screen.getByText('Newest first')).toBeInTheDocument();
    // Between Copy decisions and the Auto switch.
    expect(follows(screen.getByRole('button', { name: 'Copy decisions' }), row)).toBe(true);
    expect(follows(row, screen.getByRole('checkbox', { name: AUTO_LABEL }))).toBe(true);
    fireEvent.click(row);
    expect(await screen.findByRole('dialog', { name: 'What Auto decided' })).toBeInTheDocument();
  });

  it('on a phone a guessed branch is shown as a guess with its button', async () => {
    const branch = 'feature/orbit-470-talent-hide-before-hire';
    const guess = (branchGuessed: boolean): Partial<JobDetail> => ({ repoPath: '/Users/me/Projects/moxie-portal', branch, locate: { path: '/Users/me/Projects/moxie-portal', branch, branchSource: branchGuessed ? 'workflow-status.md' : 'status.json', branchGuessed } });
    const { post, get } = setup({ jobs: [job('alpha', 'idle', { stage: 'plan', ticket: 'ORBIT-470' })], detailMore: guess(true) });
    const main = screen.getByRole('main', { name: 'Job' });
    const group = await within(main).findByRole('group', { name: 'The job’s branch' });
    expect(within(group).getByText('Branch (a guess):')).toBeInTheDocument();
    expect(within(group).getByText(branch)).toBeInTheDocument();
    // In the head, under the title and the ticket, before the bar.
    expect(group.closest('.sb-phone-head')).not.toBeNull();
    expect(follows(within(main).getByText('ORBIT-470'), group)).toBe(true);
    expect(follows(group, bar())).toBe(true);
    // Its button records the shown branch and the job is read again.
    const reads = get.mock.calls.filter(([p]) => p === '/api/job/alpha').length;
    await act(async () => { fireEvent.click(within(group).getByRole('button', { name: 'This is the job\'s branch' })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/repo', { repoPath: '/Users/me/Projects/moxie-portal', branch });
    await waitFor(() => expect(get.mock.calls.filter(([p]) => p === '/api/job/alpha').length).toBeGreaterThan(reads));
    cleanup();
    // A recorded branch: no guess line.
    const recorded = setup({ jobs: [job('alpha', 'idle', { stage: 'plan', ticket: 'ORBIT-470' })], detailMore: guess(false) });
    await waitFor(() => expect(recorded.get).toHaveBeenCalledWith('/api/job/alpha'));
    await act(async () => {});
    expect(screen.queryByText('Branch (a guess):')).toBeNull();
    expect(screen.queryByRole('button', { name: 'This is the job\'s branch' })).toBeNull();
  });

  it('on the website’s phone a guessed branch is shown as a guess without the button (choosing it is the laptop’s)', async () => {
    const branch = 'feature/orbit-470-talent-hide-before-hire';
    setup({ hosted: true, jobs: [job('alpha', 'idle', { stage: 'plan', ticket: 'ORBIT-470' })], detailMore: { repoPath: '/Users/me/Projects/moxie-portal', branch, locate: { path: '/Users/me/Projects/moxie-portal', branch, branchSource: 'workflow-status.md', branchGuessed: true } } });
    const main = screen.getByRole('main', { name: 'Job' });
    const group = await within(main).findByRole('group', { name: 'The job’s branch' });
    expect(within(group).getByText('Branch (a guess):')).toBeInTheDocument();
    expect(within(group).getByText(branch)).toBeInTheDocument();
    expect(within(group).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'This is the job\'s branch' })).toBeNull();
  });
});

describe('the job menu’s requests on the phone', () => {
  function Asks() {
    const ui = useUi();
    return <><button type="button" onClick={() => ui.openTry('alpha')}>try it</button><button type="button" onClick={() => ui.openScreens('alpha')}>review the screens</button></>;
  }

  it('Try it on your computer lands on the Test step’s screen with Try it open', async () => {
    setup({ jobs: [working('build')], extra: <Asks /> });
    fireEvent.click(screen.getByRole('button', { name: 'try it' }));
    expect(window.location.hash).toBe('#/job/alpha/stage/test');
    expect(await screen.findByRole('heading', { level: 1, name: 'Test' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Close Try it' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('Review the screens goes to the Screens page, one new history entry', () => {
    setup({ jobs: [working('spec')], extra: <Asks /> });
    const before = window.history.length;
    fireEvent.click(screen.getByRole('button', { name: 'review the screens' }));
    expect(window.location.hash).toBe('#/job/alpha/screens');
    expect(window.history.length).toBe(before + 1);
  });
});

describe('the phone’s step screen', () => {
  it.each([AUTO_OFF, ...AUTO_STATES])('the screen of the step that waits has Send back, Reply and Go; another step’s screen does not (%s)', async (_name, j) => {
    setup({ jobs: [j], gate: GATE, auto: { on: Boolean(j.auto?.on), tag: null } as JobDetail['auto'], at: '#/job/alpha/stage/plan' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument();
    await threeCallsOn();
    // The bar comes first, with the brief folded to one row under it, then the step's own panel.
    const next = bar();
    const row = screen.getByRole('button', { name: /^The brief/ });
    expect(follows(next, row)).toBe(true);
    expect(follows(row, screen.getByRole('region', { name: 'Plan' }))).toBe(true);
    go('#/job/alpha/stage/spec');
    expect(await screen.findByRole('heading', { level: 1, name: 'Spec' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^No go: send back/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Go: / })).toBeNull();
  });

  it('the step screen’s panel is a region named by the screen’s heading, not a tab panel', async () => {
    for (const hosted of [false, true]) {
      setup({ jobs: [working('implement')], at: '#/job/alpha/stage/build', hosted });
      const heading = await screen.findByRole('heading', { level: 1, name: 'Build' });
      const panel = await screen.findByRole('region', { name: 'Build' });
      expect(panel).toHaveClass('sb-panel');
      expect(panel.getAttribute('aria-labelledby')).toBe(heading.id);
      expect(heading.id).not.toBe('');
      // No tab row on the phone, so no tab panel.
      expect(screen.queryByRole('tabpanel')).toBeNull();
      expect(document.querySelector('[role="tabpanel"]')).toBeNull();
      cleanup();
    }
  });

  // The 3D bay is the laptop's (StepPanel draws it in Play full); the phone's screens stay simple, as drawn.
  it('in Play full the phone’s step screen has no bay', async () => {
    setup({ jobs: [working('implement')], at: '#/job/alpha/stage/build', play: 'full' });
    const panel = await screen.findByRole('region', { name: 'Build' });
    await waitFor(() => expect(panel.querySelector('.sb-step-body')).not.toBeNull());
    expect(screen.queryByRole('region', { name: 'The bay at this stop' })).toBeNull();
  });

  it('a step’s body comes only once that step’s view is in', async () => {
    let release = () => {};
    server.stageHold = new Promise<void>((r) => { release = r; });
    setup({ jobs: [working('implement')], at: '#/job/alpha/stage/build' });
    const panel = await screen.findByRole('region', { name: 'Build' });
    expect(within(panel).getByText('Loading who worked on it…')).toBeInTheDocument();
    expect(panel.querySelector('.sb-step-body')).toBeNull();
    // The head says the step's state all the same.
    expect(screen.getByRole('heading', { level: 1, name: 'Build' })).toBeInTheDocument();
    expect(screen.getByText('Working now', { selector: '.sb-phone-facts .chip' })).toBeInTheDocument();
    // The held answer comes in: the body comes, in the same panel.
    await act(async () => { release(); });
    await waitFor(() => expect(panel.querySelector('.sb-step-body')).not.toBeNull());
    expect(screen.getByRole('region', { name: 'Build' })).toBe(panel);
  });

  // Final review A2: the folded card on the waiting step's screen shows what it says after a press.
  it.each([['the laptop app', false], ['the website', true]] as const)('a refused Go on the phone’s step screen shows the error (%s)', async (_where, hosted) => {
    localStorage.setItem(DETAIL_KEY, 'simple');
    const TERMINAL = 'Claude Code is open in this repository in a terminal.';
    const post = vi.fn(async (p: string): Promise<unknown> => {
      if (p === '/api/job/alpha/gate') throw new ApiError(409, TERMINAL, { code: 'terminal-open' });
      return { ok: true };
    });
    setup({ jobs: [AUTO_OFF[1]], gate: GATE, hosted, post, at: '#/job/alpha/stage/plan' });
    await threeCallsOn();
    expect(screen.getByRole('button', { name: /^The brief/ })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(screen.getByText(TERMINAL)).toBeVisible());
    expect(screen.getByRole('checkbox', { name: /None of the open terminals is this job’s Foreman/ })).toBeVisible();
  });

  it('on the website a queued Go on a folded card shows its words and Cancel (the phone’s step screen)', async () => {
    localStorage.setItem(DETAIL_KEY, 'simple');
    const QUEUED = { id: 'd_abcdefgh1234', kind: 'approve', state: 'waiting', words: 'Go: waiting for your laptop. It runs when the laptop is back.', at: NOW, expiresAt: null, waiting: true, canCancel: true, permissionId: null };
    setup({ jobs: [AUTO_OFF[1]], gate: GATE, hosted: true, at: '#/job/alpha/stage/plan', detailMore: { queued: QUEUED } as Partial<JobDetail> });
    const card = await waitFor(() => { const c = document.querySelector<HTMLElement>('.queued-decision'); expect(c).not.toBeNull(); return c!; });
    expect(card).toBeVisible();
    expect(within(card).getByText(QUEUED.words)).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(bar()).toHaveTextContent(QUEUED.words);
    expect(bar()).not.toHaveTextContent(/Say go/);
  });

  // Final review A4: the card's words are kept across the phone's screens.
  it.each([['the laptop app', false], ['the website', true]] as const)('words typed in What should change? survive the phone’s screens (%s)', async (_where, hosted) => {
    setup({ jobs: [AUTO_OFF[1]], gate: GATE, hosted });
    await threeCallsOn();
    fireEvent.click(screen.getByRole('button', { name: /^No go: send back/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: /What should change\?/ }), { target: { value: 'Use the small table.' } });
    // A step's screen, then the overview, then back to the job.
    go('#/job/alpha/stage/spec');
    expect(await screen.findByRole('heading', { level: 1, name: 'Spec' })).toBeInTheDocument();
    go('#/job/alpha/overview');
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    go('#/job/alpha');
    expect(await screen.findByRole('textbox', { name: /What should change\?/ })).toHaveValue('Use the small table.');
  });

  it('after Go the chip reads Sent and the step’s row and screen read Approved', async () => {
    let n = 0;
    const sentPost = vi.fn(async (p: string, body?: unknown): Promise<unknown> => {
      if (p !== '/api/job/alpha/gate') return { ok: true };
      const b = (body ?? {}) as { kind?: string; briefNumber?: number | null };
      if (b.kind === 'approve' && typeof b.briefNumber === 'number') server.answered.push(b.briefNumber);
      const run = { id: `r_sent_${++n}`, slug: 'alpha', status: 'running' };
      server.store?.dispatch({ type: 'event', event: ev(100 + n, 'run', 'alpha', run) });
      return { ok: true, sent: true, text: 'sent', run };
    });
    setup({ jobs: [AUTO_OFF[1]], gate: GATE, post: sentPost });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await within(bar()).findByText('Sent. Waiting for the Foreman to start.');
    const main = screen.getByRole('main', { name: 'Job' });
    await waitFor(() => expect(main.querySelector('.state-chip')).toHaveTextContent('Sent'));
    expect(screen.getByRole('button', { name: /^Plan: / })).toHaveAccessibleName(/^Plan: Approved/);
    fireEvent.click(screen.getByRole('button', { name: /^Plan: / }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByText('Approved', { selector: '.sb-phone-facts .chip' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Plan' }).querySelector('.sb-panel-head .sb-step-chip')).toHaveTextContent('Approved');
  });
});

describe('the phone page on the website', () => {
  it('on the website the phone page has no gear and Try it says where it runs', async () => {
    setup({ jobs: [working('test')], hosted: true });
    const main = screen.getByRole('main', { name: 'Job' });
    expect(within(main).queryByRole('button', { name: 'Job menu' })).toBeNull();
    expect(within(main).getByText(MENU_ON_LAPTOP)).toBeInTheDocument();
    fireEvent.click(within(main).getByRole('button', { name: /^Test: / }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Test' })).toBeInTheDocument();
    expect(await screen.findByText('Try it runs on your laptop. Open the job there to use it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open Try it/ })).toBeNull();
  });

  it.each(AUTO_STATES)('on the website the phone page has Send back, Reply and Go on a waiting Auto job (%s)', async (_name, j) => {
    setup({ jobs: [j], gate: GATE, auto: { on: true, tag: null } as JobDetail['auto'], hosted: true });
    await threeCallsOn();
    expect(screen.getByRole('main', { name: 'Job' }).querySelector('.state-chip')).not.toBeNull();
    // And on the screen of the step that waits.
    fireEvent.click(screen.getByRole('button', { name: /^Plan: / }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument();
    await threeCallsOn();
  });

  it('on the website the overview and the conversation open as on the laptop app', async () => {
    setup({ jobs: [working('plan')], page: PAGE, hosted: true, at: '#/job/alpha/overview' });
    const main = screen.getByRole('main', { name: 'Job' });
    expect(within(main).getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(await within(main).findByText('ORBIT-900 · filed by Dana Whitfield on Nov 3')).toBeInTheDocument();
    for (const name of ['The ticket', 'What we’re building', 'What to check']) expect(within(main).getByRole('heading', { level: 2, name })).toBeInTheDocument();
    go('#/job/alpha/conversation');
    const panel = await waitFor(() => { const p = document.querySelector<HTMLElement>('.sb-convo.is-full'); expect(p).not.toBeNull(); return p!; });
    expect(within(panel).getByRole('heading', { name: 'Conversation' })).toBeInTheDocument();
    expect(within(panel).getByRole('textbox', { name: /Your message to the Foreman/ })).toBeInTheDocument();
  });
});

// The owner's requirement where no gate waits: the Foreman asked something (Reply only), and a
// permission (its alert in the bar's place; the three calls back once it is answered).
describe('the phone’s bar when no gate waits', () => {
  const ASKED = job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', level: 1, headline: 'Which table should the notes use?' });
  const reply = () => within(bar()).getByRole('button', { name: /^Reply/ });
  const box = () => screen.getByRole('textbox', { name: /Your message to the Foreman/ });

  it.each([['the laptop app', false], ['the website', true]] as const)('Reply is there with no gate and lands on the conversation with the box focused, on the job screen and the waiting step’s screen (%s)', async (_where, hosted) => {
    setup({ jobs: [ASKED], hosted });
    await within(bar()).findByText('The Foreman asked you something');
    expect(reply()).toBeEnabled();
    fireEvent.click(reply());
    expect(window.location.hash).toBe('#/job/alpha/conversation');
    await waitFor(() => expect(box()).toHaveFocus());
    // The waiting step's screen: the same Reply, the same landing.
    go('#/job/alpha/stage/plan');
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument();
    await within(bar()).findByText('The Foreman asked you something');
    expect(reply()).toBeEnabled();
    fireEvent.click(reply());
    expect(window.location.hash).toBe('#/job/alpha/conversation');
    await waitFor(() => expect(box()).toHaveFocus());
  });

  // Final review A1: the card's hand to the message box lands in a box he can see.
  it.each([['the laptop app', false], ['the website', true]] as const)('a decision handed to the message box opens the conversation screen (%s)', async (_where, hosted) => {
    const post = vi.fn(async (p: string): Promise<unknown> => (p === '/api/job/alpha/gate' ? { ok: true, sent: false, text: 'Go ahead with the plan.' } : { ok: true }));
    setup({ jobs: [AUTO_OFF[1]], gate: { ...GATE, runActive: true }, hosted, post });
    fireEvent.click(await screen.findByRole('button', { name: /^Go: approve/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/job/alpha/conversation'));
    await waitFor(() => expect(box()).toHaveFocus());
    expect(box()).toHaveValue('Go ahead with the plan.');
  });

  it.each([['the laptop app', false], ['the website', true]] as const)('the c key opens the conversation screen with the box focused (%s)', async (_where, hosted) => {
    setup({ jobs: [ASKED], hosted });
    await within(bar()).findByText('The Foreman asked you something');
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(window.location.hash).toBe('#/job/alpha/conversation');
    await waitFor(() => expect(box()).toHaveFocus());
    // On the conversation screen the c key puts the cursor back in the box.
    box().blur();
    fireEvent.keyDown(document.body, { key: 'c' });
    await waitFor(() => expect(box()).toHaveFocus());
  });

  it('a permission waiting on the phone takes the bar’s place, and once it is answered the three calls are back', async () => {
    const ask: Permission = { ...permission('p1', 'alpha'), createdAt: '2026-10-21T10:00:00Z', input: { command: 'npm test' } };
    const jobs = [AUTO_OFF[1]];
    const { move, post } = setup({ jobs, permissions: [ask], gate: GATE });
    const alert = await screen.findByRole('region', { name: 'Permission: Run a command' });
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: /^Allow once/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/p1', expect.objectContaining({ decision: 'allow' })));
    move(jobs, []);
    expect(screen.queryByRole('region', { name: 'Permission: Run a command' })).toBeNull();
    await threeCallsOn();
  });
});

// A document link (a Foreman message, the Tester's report, ⌘K Open docs) opens the document under
// the step that owns it, on that step's screen.
describe('a document link on the phone', () => {
  const PLAN_DOCS: JobDetail['page'] = { docs: { plan: [entryOf('implementation-plan.md', 'plan')], test: [entryOf('test-report.md', 'test')], none: [] } };
  function Asks({ file }: { file: string }) { const ui = useUi(); return <button type="button" onClick={() => ui.openDocs(file)}>open {file}</button>; }
  const reader = async (stop: string, name: string) => within(await screen.findByRole('region', { name: stop })).findByRole('article', { name });

  it('on a phone a document link in the conversation opens the document under the step that owns it', async () => {
    const thread: ThreadItem[] = [{ id: 'reply:1', kind: 'reply', at: NOW, html: '<p>Read <a href="implementation-plan.md">the plan</a> first.</p>' }];
    setup({ jobs: [working('implement')], thread, page: PLAN_DOCS, at: '#/job/alpha/conversation' });
    fireEvent.click(await screen.findByRole('link', { name: 'the plan' }));
    expect(window.location.hash).toBe('#/job/alpha/stage/plan');
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument();
    const doc = await reader('Plan', 'Implementation plan');
    expect(await within(doc).findByText('implementation-plan.md body')).toBeInTheDocument();
    // Back returns to the conversation.
    act(() => { window.history.back(); });
    await waitFor(() => expect(window.location.hash).toBe('#/job/alpha/conversation'));
    await waitFor(() => expect(document.querySelector('.sb-convo.is-full')).not.toBeNull());
    // A later visit to the step shows its list: the document is not opened again.
    go('#/job/alpha/stage/plan');
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole('article', { name: 'Implementation plan' })).toBeNull();
  });

  it('on a phone Open the Tester’s report opens the report under Test', async () => {
    server.stageMore = { checks: { passed: 4, failed: 0, notRun: 0, at: NOW } };
    setup({ jobs: [working('test')], page: PLAN_DOCS, at: '#/job/alpha/stage/test' });
    fireEvent.click(await screen.findByRole('button', { name: 'The command and the end of its output' }));
    expect(window.location.hash).toBe('#/job/alpha/stage/test');
    const doc = await reader('Test', 'test-report.md');
    expect(await within(doc).findByText('test-report.md body')).toBeInTheDocument();
  });

  it('a file no step owns opens under the step on screen', async () => {
    setup({ jobs: [working('implement')], page: PLAN_DOCS, at: '#/job/alpha/stage/review', extra: <Asks file="notes.md" /> });
    expect(await screen.findByRole('heading', { level: 1, name: 'Review' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'open notes.md' }));
    expect(window.location.hash).toBe('#/job/alpha/stage/review');
    expect(await within(await reader('Review', 'notes.md')).findByText('notes.md body')).toBeInTheDocument();
    // On a screen with no step (the job's), under the job's own step.
    cleanup();
    setup({ jobs: [working('implement')], page: PLAN_DOCS, extra: <Asks file="notes.md" /> });
    fireEvent.click(screen.getByRole('button', { name: 'open notes.md' }));
    expect(window.location.hash).toBe('#/job/alpha/stage/build');
    expect(await within(await reader('Build', 'notes.md')).findByText('notes.md body')).toBeInTheDocument();
  });

  it('a request made before the page was there is not replayed', async () => {
    // The link is pressed first; the page mounts after it.
    function Later() {
      const ui = useUi();
      const [on, setOn] = useState(false);
      return on ? <Routed slug="alpha" /> : <button type="button" onClick={() => { ui.openDocs('implementation-plan.md'); setOn(true); }}>the plan, then the page</button>;
    }
    setup({ jobs: [working('implement')], page: PLAN_DOCS, extra: <Later />, mount: false });
    fireEvent.click(screen.getByRole('button', { name: 'the plan, then the page' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Job alpha' })).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(window.location.hash).toBe('#/job/alpha');
  });
});
