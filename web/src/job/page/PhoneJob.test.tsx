// The job page on a phone (Part 3, Task 16): four simple screens chosen by the address. The job (the
// bar and its card first, then the steps, Overview, Copy decisions, What Auto decided and the Auto
// switch, with Conversation fixed at the bottom), a step, the conversation and the overview. And the
// owner's one requirement: a job that waits for him has Send back, Reply and Go on the job screen and
// on the screen of the step that waits, on an Auto job too, on the laptop and on the website. The
// setup is the laptop page's (NewJobPage.test.tsx), with the page under the router as the address
// picks the screen. Invented jobs only; no model calls, no browser, no network.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { EvidenceView, Gate, Job, JobDetail, StageView, StopId, ThreadItem } from '../../api/types';
import { installKeyListener } from '../../app/keyRegistry';
import { useRoute, type JobView } from '../../app/router';
import { UiProvider } from '../../app/ui';
import { STOPS } from '../../components/stops/stops';
import { clearAllSent } from '../../lib/sentState';
import { useJobConversation } from '../../panes/Foreman/ForemanPane';
import { clearGateSent } from '../../panes/Foreman/gateSent';
import { jobBySlug } from '../../state/reducer';
import { createStore, useWorkshopState, WorkshopContext, type Store } from '../../state/store';
import { ev, job, snapshot } from '../../state/test-fixtures';
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

/** What the test's server knows. */
const server = { store: null as Store | null, answered: [] as number[], stageHangs: false };

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

function setup({ jobs = [job('alpha', 'idle', { stage: 'plan' })], gate = null as Gate | null, auto = null as JobDetail['auto'] | null, page = undefined as JobDetail['page'], thread = [] as ThreadItem[], hosted = false, at = '#/job/alpha', post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({ ok: true })) } = {}) {
  window.location.hash = at;
  const store: Store = createStore();
  server.store = store;
  server.answered = [];
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, meta: { token: 't', settings: { play: { mode: 'subtle' } }, models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }] } as never }) });
  const detail = (s: string): JobDetail => ({ slug: s, thread, threadMore: false, gate, answeredBriefs: [...server.answered], heldReply: null, options: { level: 1 }, auto, page } as JobDetail);
  const get = vi.fn(async (p: string): Promise<unknown> => {
    const stage = /^\/api\/job\/([^/]+)\/stage\/([a-z]+)$/.exec(p);
    if (stage) return server.stageHangs ? new Promise(() => {}) : stageView(decodeURIComponent(stage[1]), stage[2] as StopId);
    if (p.endsWith('/evidence')) return EVIDENCE;
    if (p.endsWith('/docs')) return { docs: [] };
    if (p.endsWith('/commits')) return { commits: [] };
    if (p.endsWith('/decisions')) return { decisions: [] };
    if (p.endsWith('/auto')) return { summary: [], entries: [] };
    if (p.endsWith('/local')) return null;
    if (p.startsWith('/api/review/')) return null;
    if (p === '/api/stacks') return { stacks: [] };
    return detail(p.split('/')[3]);
  });
  const api = { get, post, ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><Routed slug="alpha" /></UiProvider></WorkshopContext.Provider>);
  /** The job as the next snapshot has it. */
  const move = (next: Job[]) => act(() => {
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: next, meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) });
  });
  return { ...utils, get, post, store, move };
}

let off = () => {};
beforeEach(() => { off = installKeyListener(); windowWidth(390); server.stageHangs = false; });
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
    fireEvent.click(screen.getByRole('button', { name: 'Job alpha' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Job alpha' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/job/alpha');
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
    expect(within(panel).getByRole('textbox', { name: /Your message to the Foreman/ })).toBeInTheDocument();
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
    expect(follows(row, screen.getByRole('tabpanel', { name: 'Plan' }))).toBe(true);
    go('#/job/alpha/stage/spec');
    expect(await screen.findByRole('heading', { level: 1, name: 'Spec' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^No go: send back/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Go: / })).toBeNull();
  });

  it('a step’s body comes only once that step’s view is in', async () => {
    server.stageHangs = true;
    setup({ jobs: [working('implement')], at: '#/job/alpha/stage/build' });
    const panel = await screen.findByRole('tabpanel', { name: 'Build' });
    expect(within(panel).getByText('Loading who worked on it…')).toBeInTheDocument();
    expect(panel.querySelector('.sb-step-body')).toBeNull();
    // The head says the step's state all the same.
    expect(screen.getByRole('heading', { level: 1, name: 'Build' })).toBeInTheDocument();
    expect(screen.getByText('Working now', { selector: '.sb-phone-facts .chip' })).toBeInTheDocument();
    // Once the view is in, the body comes.
    server.stageHangs = false;
    cleanup();
    setup({ jobs: [working('implement')], at: '#/job/alpha/stage/build' });
    const ready = await screen.findByRole('tabpanel', { name: 'Build' });
    await waitFor(() => expect(ready.querySelector('.sb-step-body')).not.toBeNull());
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
    expect(screen.getByRole('tabpanel', { name: 'Plan' }).querySelector('.sb-panel-head .sb-step-chip')).toHaveTextContent('Approved');
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

  it('on the website the phone page has Send back, Reply and Go on a waiting Auto job', async () => {
    setup({ jobs: [AUTO_STATES[1][1]], gate: GATE, auto: { on: true, tag: null } as JobDetail['auto'], hosted: true });
    await threeCallsOn();
    expect(screen.getByRole('main', { name: 'Job' }).querySelector('.state-chip')).not.toBeNull();
    // And on the screen of the step that waits.
    fireEvent.click(screen.getByRole('button', { name: /^Plan: / }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan' })).toBeInTheDocument();
    await threeCallsOn();
  });
});
