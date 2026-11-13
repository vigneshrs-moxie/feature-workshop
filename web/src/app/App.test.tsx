import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Gate, Snapshot, StageView, StopId } from '../api/types';
import { STOPS } from '../components/stops/stops';
import type { EventSourceLike } from '../state/live';
import { ev, job, permission, snapshot } from '../state/test-fixtures';
import { App } from './App';
import { oldPages } from './router';

class FakeStream implements EventSourceLike {
  readyState = 0;
  onopen: EventSourceLike['onopen'] = null;
  onmessage: EventSourceLike['onmessage'] = null;
  onerror: EventSourceLike['onerror'] = null;
  close() { this.readyState = 2; }
}

/** One step's view, as GET /api/job/:slug/stage/:stop answers it. */
const stageView = (slug: string, stop: StopId): StageView => ({
  slug, stop, label: STOPS.find((s) => s.id === stop)!.label, state: 'done', stateWords: 'Done', since: null, stages: [],
  agents: [], finished: [], terminalApp: null, terminalApps: [], docs: [], checks: null, handTest: null, plan: null, prs: [], review: { reviewers: [] },
});

/**
 * What the test's dashboard answers, by route: the job page asks for a step's view, the evidence,
 * the documents and the commits as well as the job's details. `detail` adds to a job's details.
 */
function serverGet(detail: (slug: string) => Record<string, unknown> = () => ({}), notes = '') {
  return vi.fn(async (path: string): Promise<unknown> => {
    const stage = /^\/api\/job\/([^/]+)\/stage\/([a-z]+)$/.exec(path);
    if (stage) return stageView(decodeURIComponent(stage[1]), stage[2] as StopId);
    if (path.endsWith('/evidence')) return { evidence: null, commit: null, wanted: false, why: '', recording: false, problem: null, folder: '/tmp/evidence', folderUrl: 'file:///tmp/evidence' };
    if (path.endsWith('/docs')) return { docs: [] };
    if (path.endsWith('/commits')) return { commits: [] };
    if (path.endsWith('/decisions')) return { decisions: [] };
    if (path.endsWith('/notes')) return { text: notes, updatedAt: null };
    if (path.endsWith('/local')) return null;
    const slug = decodeURIComponent(path.split('/')[3] ?? '');
    return { slug, thread: [], threadMore: false, options: null, ...detail(slug) };
  });
}

function renderApp(snap: Snapshot | Error) {
  const streams: FakeStream[] = [];
  const api = {
    snapshot: vi.fn(async () => { if (snap instanceof Error) throw snap; return snap; }),
    setToken: vi.fn(),
    get: serverGet(),
  } as unknown as ApiClient;
  const openStream = (_url: string) => { const s = new FakeStream(); streams.push(s); return s; };
  render(<App api={api} openStream={openStream} />);
  return { streams };
}

// A laptop's window, 1280 px wide (jsdom has no matchMedia): the job page shows the conversation
// column beside the steps, as it does from 1100 px.
beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    return { matches: (!min || 1280 >= Number(min[1])) && (!max || 1280 <= Number(max[1])), media: q, addEventListener() {}, removeEventListener() {} };
  });
});
afterEach(() => { window.location.hash = ''; localStorage.clear(); vi.unstubAllGlobals(); });

describe('App shell', () => {
  it('shows a job full width: the Job page with its seven stops, no Jobs or Preview pane', async () => {
    window.location.hash = '#/job/beta';
    renderApp(snapshot({ jobs: [job('alpha', 'needs-you'), job('beta', 'running'), job('gamma', 'done')] }));
    const page = await screen.findByRole('main', { name: 'Job' });
    expect(within(page).getByRole('heading', { name: 'Job beta' })).toBeInTheDocument();
    // The seven stops are the job page's seven steps (a pick moves the address to #/job/beta/stage/<stop>).
    expect(within(within(page).getByRole('tablist', { name: 'The job’s seven steps' })).getAllByRole('tab')).toHaveLength(7);
    expect(screen.queryByRole('navigation', { name: 'Jobs' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Preview' })).toBeNull();
    // The top bar: the product's name, the five pages (the Desk with what waits for you), and the gear.
    const bar = document.querySelector<HTMLElement>('.topbar')!;
    expect(within(bar).getByRole('link', { name: 'Starbase, back to Jobs' })).toHaveAttribute('href', '#/');
    const pages = within(bar).getByRole('navigation', { name: 'Pages' });
    expect(within(pages).getAllByRole('link').map((a) => a.textContent)).toEqual(['Jobs', 'Desk', 'Inbox', 'Stacks', 'Telemetry']);
    expect(within(pages).getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByRole('link', { name: 'Desk' })).toHaveAttribute('href', '#/desk');
    // The gear: Settings, the Crew-dex in Play, the flow map, the Table, the keys and every action.
    fireEvent.click(within(bar).getByRole('button', { name: 'Settings and more' }));
    const gear = within(bar).getByRole('menu', { name: 'Settings and more' });
    expect(within(gear).getAllByRole('menuitem').map((m) => m.querySelector('.menu-label')?.textContent)).toEqual(['Settings', 'Crew-dex', 'Achievements', 'Flow map', 'Table', 'Keys', 'Every action']);
    expect(within(gear).getByRole('menuitem', { name: /^Settings/ })).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'g' }); // the menu is open: page keys wait
    fireEvent.keyDown(document.body, { key: 't' });
    expect(window.location.hash).toBe('#/job/beta');
    fireEvent.keyDown(gear, { key: 'Escape' });
    expect(within(bar).queryByRole('menu')).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Settings and more' })).toHaveFocus();
    // The browser tab: the page and the product.
    expect(document.title).toBe('(1) Job beta · Starbase');
  });

  it('opens Settings on a section from the hash; j and k move between sections, / finds a setting', async () => {
    window.location.hash = '#/settings/keys';
    renderApp(snapshot());
    expect(await screen.findByRole('main', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Keys' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Keys/ })).toHaveAttribute('aria-current', 'page');
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(window.location.hash).toBe('#/settings/workflow');
    act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(screen.getByRole('region', { name: 'Workflow' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Keys' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(window.location.hash).toBe('#/settings/keys');
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Find a setting' }));
    // While typing in the box, j is a letter, not a key.
    fireEvent.keyDown(document.activeElement!, { key: 'j' });
    expect(window.location.hash).toBe('#/settings/keys');
  });

  it('opens a job from the hash; the old pages are named nowhere, and only the exact word in ⌘K opens them', async () => {
    const open = vi.spyOn(oldPages, 'open').mockImplementation(() => {});
    window.location.hash = '#/job/beta';
    renderApp(snapshot());
    expect(await screen.findByRole('heading', { name: 'Job beta' })).toBeInTheDocument();
    // The job page: its seven steps, in order.
    expect(within(screen.getByRole('tablist', { name: 'The job’s seven steps' })).getAllByRole('tab').map((t) => t.id)).toEqual(STOPS.map((s) => `sb-step-${s.id}`));
    // Not in the page, the gear, the job menu, the keys sheet or any hover text.
    const said = () => [document.body.textContent ?? '', ...[...document.querySelectorAll('[title], [aria-label], [data-tip]')].map((e) => `${e.getAttribute('title') ?? ''} ${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('data-tip') ?? ''}`)].join(' ');
    fireEvent.click(screen.getByRole('button', { name: 'Settings and more' }));
    expect(said()).not.toMatch(/classic/i);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Job menu/ }));
    expect(said()).not.toMatch(/classic/i);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(said()).not.toMatch(/classic/i);
    fireEvent.keyDown(document, { key: 'Escape' });
    // ⌘K lists nothing for it; part of the word finds nothing; the exact word shows one row and Enter opens this job there.
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    const box = screen.getByRole('combobox', { name: 'Search actions' });
    expect(said().replace(/Search actions/, '')).not.toMatch(/classic/i);
    fireEvent.change(box, { target: { value: 'class' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fireEvent.change(box, { target: { value: 'classic' } });
    expect(screen.getAllByRole('option').map((o) => o.querySelector('.palette-label')?.textContent)).toEqual(['Open the old view of this page']);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(open).toHaveBeenCalledWith('/#/job/beta');
    open.mockRestore();
    act(() => { window.location.hash = '#/'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    // Back to Jobs: the four lanes, full width, with the next-step bar naming the job that needs you.
    expect(screen.getByRole('main', { name: 'Jobs' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Jobs' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('needs you');
  });

  it('shows a job’s screens full width at #/job/<slug>/screens, with Back to the job; the Spec step links to them', async () => {
    window.location.hash = '#/job/beta/screens';
    renderApp(snapshot({ jobs: [job('alpha', 'needs-you'), job('beta', 'running', { wireframes: { version: '2' } })] }));
    const view = await screen.findByRole('main', { name: 'Screens' });
    expect(screen.queryByRole('navigation', { name: 'Jobs' }), 'full width: no Jobs pane').toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Preview' })).toBeNull();
    expect(within(view).getByRole('link', { name: /Back to the job/ })).toHaveAttribute('href', '#/job/beta');
    expect(view).toHaveTextContent('Job beta');
    // From the screens server's own origin (meta.wireframesOrigin), never this one.
    expect(view.querySelector('iframe.screens-frame')).toHaveAttribute('src', 'http://127.0.0.1:4478/job/beta/wireframes');
    expect(within(view).getByRole('button', { name: 'Copy feedback' })).toBeInTheDocument();
    expect(within(view).queryByRole('link', { name: 'Open full screen' })).toBeNull();
    // Back on the job: its Spec step links to the screens; a job without screens has no link.
    act(() => { window.location.hash = '#/job/beta'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await screen.findByRole('heading', { name: 'Job beta' });
    fireEvent.click(document.getElementById('sb-step-spec')!);
    expect(await screen.findByRole('link', { name: /Review the screens/ })).toHaveAttribute('href', '#/job/beta/screens');
    act(() => { window.location.hash = '#/job/alpha'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await screen.findByRole('heading', { name: 'Job alpha' });
    fireEvent.click(document.getElementById('sb-step-spec')!);
    const spec = await screen.findByRole('tabpanel', { name: 'Spec' });
    await waitFor(() => expect(spec.querySelector('.sb-step-body')).not.toBeNull());
    expect(screen.queryByRole('link', { name: /Review the screens/ })).toBeNull();
    // A job without screens at the screens address says so.
    act(() => { window.location.hash = '#/job/alpha/screens'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(await screen.findByRole('main', { name: 'Screens' })).toHaveTextContent('This job has no screens yet.');
  });

  it('opens what the classic view asks for (?open=), once, and drops it from the address', async () => {
    window.location.hash = '#/job/beta?open=options';
    renderApp(snapshot());
    expect(await screen.findByRole('dialog', { name: 'Notes and options' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Options' })).toHaveAttribute('aria-selected', 'true');
    expect(window.location.hash).toBe('#/job/beta');
  });

  it('opens the New job sheet from ?open=new-job', async () => {
    window.location.hash = '#/?open=new-job';
    renderApp(snapshot());
    expect(await screen.findByRole('dialog', { name: /new job/i })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/');
  });

  it('updates live from the stream', async () => {
    window.location.hash = '#/job/beta';
    const { streams } = renderApp(snapshot());
    await screen.findByRole('main', { name: 'Job' });
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    act(() => { streams[0].readyState = 1; streams[0].onopen?.(new Event('open')); });
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Permission/ })).toBeNull();
    act(() => { streams[0].onmessage?.(new MessageEvent('message', { data: JSON.stringify(ev(11, 'permission', 'beta', permission('p1', 'beta'))) })); });
    // The permission alert takes the next-step bar's place on the job's page.
    expect(screen.getByRole('region', { name: 'Permission: Run a command' })).toHaveTextContent('The Foreman wants to run a command');
  });

  it('says so when the dashboard can’t be reached', async () => {
    renderApp(new Error('connection refused'));
    expect(await screen.findByRole('alert')).toHaveTextContent('connection refused');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('⌘K opens the palette with only the actions valid now; picking one runs it', async () => {
    window.location.hash = '#/job/alpha';
    renderApp(snapshot({ jobs: [job('alpha', 'idle'), job('beta', 'running')] }));
    await screen.findByRole('heading', { name: 'Job alpha' });
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    const box = screen.getByRole('combobox', { name: 'Search actions' });
    const names = screen.getAllByRole('option').map((o) => o.querySelector('.palette-label')?.textContent);
    expect(names).toEqual(expect.arrayContaining(['Mark done or dropped…', 'New job…', 'Open Job beta', 'Settings']));
    expect(names).not.toContain('Stop the reply'); // alpha isn't replying
    expect(names).not.toContain('Open Job alpha'); // already open
    fireEvent.change(box, { target: { value: 'open beta' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    expect(window.location.hash).toBe('#/job/beta');
  });

  it('the palette opens Mark done for the open job', async () => {
    window.location.hash = '#/job/alpha';
    renderApp(snapshot({ jobs: [job('alpha', 'idle')] }));
    await screen.findByRole('heading', { name: 'Job alpha' });
    fireEvent.click(screen.getByRole('button', { name: 'Settings and more' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Every action/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search actions' }), { target: { value: 'mark' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search actions' }), { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Mark “Job alpha” as done' })).toBeInTheDocument();
  });

  it('c opens the new job sheet and ? the keys; j and k step through the jobs, but not while typing', async () => {
    renderApp(snapshot({ jobs: [job('alpha', 'needs-you'), job('beta', 'idle')] }));
    await screen.findByRole('main', { name: 'Jobs' });
    const hop = () => act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(window.location.hash).toBe('#/job/alpha');
    hop();
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(window.location.hash).toBe('#/job/beta');
    hop();
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(window.location.hash).toBe('#/job/alpha');
    hop();

    const composer = await screen.findByRole('textbox', { name: /Your message to the Foreman/ });
    fireEvent.keyDown(composer, { key: 'j' });
    expect(window.location.hash).toBe('#/job/alpha');

    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    // On a job, c is the message box; elsewhere it starts a new job.
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(composer).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: 'Start a new job' })).toBeNull();
    composer.blur();
    act(() => { window.location.hash = '#/'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await screen.findByRole('main', { name: 'Jobs' });
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(screen.getByRole('dialog', { name: 'Start a new job' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'j' }); // a sheet is open: page keys wait
    expect(window.location.hash).toBe('#/');
  });

  it('shows the usage-limit banner under the top bar', async () => {
    renderApp(snapshot({ usage: { limited: true, blocking: true, label: '5-hour limit', resetsAt: null, jobs: [], autoResume: false, passed: true } }));
    expect(await screen.findByRole('status', { name: 'Usage limit' })).toHaveTextContent('The limit has reset. Automatic carry-on is off');
    expect(screen.getByRole('button', { name: 'Carry on now' })).toBeInTheDocument();
  });

  it('“How this works” boxes start folded, and one you opened stays open', async () => {
    window.location.hash = '#/map';
    renderApp(snapshot());
    const box = async () => (await screen.findByText('How this works')).closest('details')!;
    const first = await box();
    expect(first.open).toBe(false);
    act(() => { first.open = true; first.dispatchEvent(new Event('toggle')); });
    expect(localStorage.getItem('fw.how.home-map')).toBe('open');
    cleanup();
    window.location.hash = '#/map';
    renderApp(snapshot());
    const again = await box();
    expect(again.open).toBe(true);
    act(() => { again.open = false; again.dispatchEvent(new Event('toggle')); });
    expect(localStorage.getItem('fw.how.home-map')).toBe('closed');
  });
});

// Part 3, Task 17: the new job page is the job page, at a job's address and at each step's. A pick
// moves the address in place (job to stage, stage to stage) and a link moves it with a hashchange;
// either way the page stays mounted (one key, the job's), so words typed in What should change? stay.
describe('the job page at a job’s and a step’s address', () => {
  const GATE: Gate = {
    briefNumber: 2, briefFile: 'briefs/002-plan.md', headline: 'Plan v2 ready', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
    questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: '2026-10-21T09:00:00Z', runActive: false, parked: false,
    level: 1, suggestedLevel: null, levelReason: null, usage: null,
  };
  const WAITING = job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you', waitingFor: 'approval', headline: 'The plan is ready. Start building?' });

  function renderJob(jobs = [WAITING]) {
    const get = serverGet((slug) => ({ gate: slug === 'alpha' ? GATE : null, answeredBriefs: [], heldReply: null, options: { level: 1 }, auto: null, drive: null }));
    const api = { snapshot: vi.fn(async () => snapshot({ jobs })), setToken: vi.fn(), get, post: vi.fn(async () => ({ ok: true })), put: vi.fn() } as unknown as ApiClient;
    render(<App api={api} openStream={() => new FakeStream()} />);
    return { get };
  }
  const openTab = () => screen.getByRole('tab', { selected: true, hidden: true });
  const tabOf = (stop: StopId) => document.getElementById(`sb-step-${stop}`) as HTMLElement;
  /** No go: send back, then words typed into What should change? */
  async function typeAChange(words: string) {
    fireEvent.click(await screen.findByRole('button', { name: /^No go: send back/ }));
    const box = await screen.findByRole('textbox', { name: /What should change\?/ });
    box.focus();
    fireEvent.change(box, { target: { value: words } });
    expect(box).toHaveValue(words);
    return box;
  }

  it('a job’s address shows the new page', async () => {
    window.location.hash = '#/job/alpha';
    renderApp(snapshot({ jobs: [job('alpha', 'running', { stage: 'plan', lane: 'working' }), job('beta', 'idle')] }));
    const page = await screen.findByRole('main', { name: 'Job' });
    // The new page: its header, the seven steps with one open, and the conversation.
    expect(page).toHaveClass('sb-job-page');
    expect(within(page.querySelector<HTMLElement>('.sb-job-top')!).getByRole('heading', { name: 'Job alpha' })).toBeInTheDocument();
    expect(within(page).getAllByRole('tab', { hidden: true })).toHaveLength(7);
    expect(openTab().id).toBe('sb-step-plan');
    expect(page.querySelectorAll('.sb-convo')).toHaveLength(1);
    // The job's conversation address gives the conversation the page (the route's view reaches it).
    cleanup();
    window.location.hash = '#/job/alpha/conversation';
    renderApp(snapshot({ jobs: [job('alpha', 'running', { stage: 'plan', lane: 'working' })] }));
    expect(await screen.findByRole('main', { name: 'Job' })).toHaveAttribute('data-view', 'conversation');
    expect(screen.getByRole('main', { name: 'Job' })).toHaveClass('is-talk');
  });

  it('a step’s address shows the job page on that step', async () => {
    window.location.hash = '#/job/alpha/stage/review';
    renderJob([job('alpha', 'running', { stage: 'plan', lane: 'working' })]);
    const page = await screen.findByRole('main', { name: 'Job' });
    expect(page).toHaveClass('sb-job-page');
    expect(openTab().id).toBe('sb-step-review');
    expect(within(page).getByRole('tabpanel', { name: 'Review', hidden: true })).toBeInTheDocument();
    // The browser tab still names the step and the job.
    expect(document.title).toContain('Review · Job alpha');
  });

  it('typing in What should change? then picking another step keeps the words', async () => {
    window.location.hash = '#/job/alpha';
    renderJob();
    const page = await screen.findByRole('main', { name: 'Job' });
    const box = await typeAChange('Use the small table.');
    // From the job's address to a step's (the pick rewrites the address in place).
    fireEvent.click(tabOf('spec'));
    await act(async () => {});
    expect(window.location.hash).toBe('#/job/alpha/stage/spec');
    expect(openTab().id).toBe('sb-step-spec');
    expect(screen.getByRole('main', { name: 'Job' })).toBe(page);
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toBe(box);
    expect(box).toHaveValue('Use the small table.');
    // And from one step's address to another's.
    fireEvent.click(tabOf('build'));
    await act(async () => {});
    expect(window.location.hash).toBe('#/job/alpha/stage/build');
    expect(openTab().id).toBe('sb-step-build');
    expect(screen.getByRole('main', { name: 'Job' })).toBe(page);
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toBe(box);
    expect(box).toHaveValue('Use the small table.');
  });

  it('going from the job’s address to a step’s address keeps the words', async () => {
    window.location.hash = '#/job/alpha';
    renderJob();
    const page = await screen.findByRole('main', { name: 'Job' });
    const box = await typeAChange('Keep the old export.');
    // A link (a hashchange) to one of the job's steps, then to another.
    act(() => { window.location.hash = '#/job/alpha/stage/test'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await waitFor(() => expect(openTab().id).toBe('sb-step-test'));
    expect(screen.getByRole('main', { name: 'Job' })).toBe(page);
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toBe(box);
    expect(box).toHaveValue('Keep the old export.');
    act(() => { window.location.hash = '#/job/alpha/stage/ship'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await waitFor(() => expect(openTab().id).toBe('sb-step-ship'));
    expect(screen.getByRole('main', { name: 'Job' })).toBe(page);
    expect(screen.getByRole('textbox', { name: /What should change\?/ })).toBe(box);
    expect(box).toHaveValue('Keep the old export.');
  });
});

// Review Focus 1: a step view from an older laptop, or a half-written answer, never takes the page down.
describe('a step view with missing parts', () => {
  it('a step view with no agents shows the step with nobody working, and the page is whole', async () => {
    window.location.hash = '#/job/alpha/stage/build';
    const get = serverGet();
    const answer = get.getMockImplementation()!;
    // No agents, no finished, documents that are not a list, no terminal apps. Done, so whether the
    // step is live is read from its agents.
    // At Test: agents that are not a list, and a finished row with a hole before it and no terminal.
    const tester = { who: 'feature-tester', role: 'Tester', model: null, doing: null, since: null, lastAt: null, status: 'done', ref: '7' };
    get.mockImplementation(async (path: string) => (/\/stage\/test$/.test(path)
      ? { slug: 'alpha', stop: 'test', label: 'Test', state: 'done', stateWords: 'Done', since: null, agents: 'nobody', finished: [null, tester] }
      : /\/stage\/[a-z]+$/.test(path)
        ? { slug: 'alpha', stop: path.split('/').pop(), label: 'Build', state: 'done', stateWords: 'Done', since: null, docs: {} }
        : answer(path)));
    const api = { snapshot: vi.fn(async () => snapshot({ jobs: [job('alpha', 'running', { stage: 'implement', lane: 'working' })] })), setToken: vi.fn(), get, post: vi.fn(async () => ({ ok: true })), put: vi.fn() } as unknown as ApiClient;
    render(<App api={api} openStream={() => new FakeStream()} />);
    const page = await screen.findByRole('main', { name: 'Job' });
    const panel = within(page).getByRole('tabpanel', { name: 'Build' });
    expect(await within(panel).findByText('Nobody is working here now.')).toBeInTheDocument();
    // Documents that are not a list are not known: it says so, never that there are none.
    expect(within(panel).getByText('This step’s documents aren’t known yet.')).toBeInTheDocument();
    // The page is whole: the header, the seven steps, the bar and the conversation are all there.
    expect(within(page.querySelector<HTMLElement>('.sb-job-top')!).getByRole('heading', { name: 'Job alpha' })).toBeInTheDocument();
    expect(within(within(page).getByRole('tablist', { name: 'The job’s seven steps' })).getAllByRole('tab')).toHaveLength(7);
    expect(within(page).getByRole('region', { name: 'Next step' })).toBeInTheDocument();
    expect(within(page).getByRole('textbox', { name: /Your message to the Foreman/ })).toBeInTheDocument();
    // Another step with the same answer: still whole.
    fireEvent.click(document.getElementById('sb-step-test')!);
    const test = await screen.findByRole('tabpanel', { name: 'Test' });
    expect(await within(test).findByRole('heading', { name: 'Three kinds of test' })).toBeInTheDocument();
    // The Tester's row shows; with no terminal facts its button rests.
    expect(within(test).getByText('Finished its part')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Job' })).toBe(page);
  });
});

describe('Job drawer in the shell', () => {
  function renderWithJob() {
    window.location.hash = '#/job/alpha';
    const get = serverGet(undefined, 'Keep it small.');
    const api = { snapshot: vi.fn(async () => snapshot({ jobs: [job('alpha', 'idle')] })), setToken: vi.fn(), get, post: vi.fn(), put: vi.fn() } as unknown as ApiClient;
    render(<App api={api} openStream={() => new FakeStream()} />);
    return { get };
  }

  it('the job menu opens it; Escape closes it and focus goes back to the job menu', async () => {
    renderWithJob();
    await screen.findByRole('heading', { name: 'Job alpha' });
    fireEvent.click(screen.getByRole('button', { name: /Job menu/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Notes and options…' }));
    const drawer = screen.getByRole('dialog', { name: 'Notes and options' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(within(drawer).getByRole('tab', { name: 'Notes' })).toHaveFocus();
    expect(await within(drawer).findByRole('textbox', { name: /Notes for the Foreman/ })).toHaveValue('Keep it small.');
    fireEvent.keyDown(document.body, { key: 'j' }); // the drawer is open: page keys wait
    expect(window.location.hash).toBe('#/job/alpha');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Notes and options' })).toBeNull();
    expect(screen.getByRole('button', { name: /Job menu/ })).toHaveFocus();
  });

  it('⌘K offers “Job notes and options” and opens the drawer', async () => {
    renderWithJob();
    await screen.findByRole('heading', { name: 'Job alpha' });
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    const box = screen.getByRole('combobox', { name: 'Search actions' });
    fireEvent.change(box, { target: { value: 'notes and options' } });
    expect(screen.getAllByRole('option').map((o) => o.querySelector('.palette-label')?.textContent)).toEqual(['Job notes and options']);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Notes and options' })).toBeInTheDocument();
  });
});

describe('Keys through the registry', () => {
  it('g then a letter goes to a page; with keys off only ⌘K is left', async () => {
    renderApp(snapshot({ jobs: [job('alpha', 'needs-you')] }));
    await screen.findByRole('main', { name: 'Jobs' });
    fireEvent.keyDown(document.body, { key: 'g' });
    fireEvent.keyDown(document.body, { key: 't' });
    expect(window.location.hash).toBe('#/table');
    fireEvent.keyDown(document.body, { key: 'g' });
    fireEvent.keyDown(document.body, { key: 's' });
    expect(window.location.hash).toBe('#/settings');
    fireEvent.keyDown(document.body, { key: 'g' });
    fireEvent.keyDown(document.body, { key: 'h' });
    expect(window.location.hash).toBe('#/');
    localStorage.setItem('fw.keys', JSON.stringify({ enabled: false, hints: true }));
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(screen.queryByRole('dialog', { name: 'Start a new job' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('on a job: n opens Notes and options, i puts the cursor in the message box', async () => {
    window.location.hash = '#/job/alpha';
    const get = serverGet();
    const api = { snapshot: vi.fn(async () => snapshot({ jobs: [job('alpha', 'idle')] })), setToken: vi.fn(), get, post: vi.fn(), put: vi.fn() } as unknown as ApiClient;
    render(<App api={api} openStream={() => new FakeStream()} />);
    await screen.findByRole('heading', { name: 'Job alpha' });
    expect(screen.getByRole('button', { name: 'New job' }).querySelector('kbd')).toHaveTextContent('c');
    fireEvent.keyDown(document.body, { key: 'i' });
    const composer = screen.getByRole('textbox', { name: /Your message to the Foreman/ });
    expect(composer).toHaveFocus();
    fireEvent.keyDown(composer, { key: 'n' }); // typing: nothing opens
    expect(screen.queryByRole('dialog')).toBeNull();
    composer.blur();
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(screen.getByRole('dialog', { name: 'Notes and options' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// Task 7: the new job page behind the switch (sb.jobPage = 'new'), with its own keys while it is mounted.
describe('the new job page’s switch', () => {
  async function renderSwitchable() {
    const { longJob } = await import('../jobpage/fixtures/longJob');
    const base = serverGet();
    const api = {
      snapshot: vi.fn(async () => snapshot({ jobs: [job('alpha', 'needs-you'), job('beta', 'running'), job('gamma', 'idle')] })),
      setToken: vi.fn(),
      get: vi.fn(async (path: string) => {
        if (/^\/api\/job\/beta\/page/.test(path)) return { ...JSON.parse(JSON.stringify(longJob.payload)), slug: 'beta', title: 'Beta, from its page' };
        if (/^\/api\/job\/beta\/item/.test(path)) throw new Error('Starbase answered 404.');
        return base(path);
      }),
    } as unknown as ApiClient;
    render(<App api={api} openStream={() => new FakeStream()} />);
  }
  const hop = () => act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); });

  it('mounts the new page only when sb.jobPage is new; each page’s menu switches to the other at the same address', async () => {
    window.location.hash = '#/job/beta/stage/plan';
    await renderSwitchable();
    const old = await screen.findByRole('main', { name: 'Job' });
    expect(old).toHaveClass('sb-job-page');
    expect(old).not.toHaveClass('jp2');
    fireEvent.click(screen.getByRole('button', { name: /Job menu/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Try the new job page' }));
    expect(localStorage.getItem('sb.jobPage')).toBe('new');
    const fresh = await screen.findByRole('main', { name: 'Job' });
    expect(fresh).toHaveClass('jp2');
    expect(window.location.hash).toBe('#/job/beta/stage/plan');
    expect(await screen.findByRole('heading', { level: 1, name: 'Beta, from its page' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More for this job' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Back to the old job page' }));
    expect(localStorage.getItem('sb.jobPage')).toBeNull();
    expect(await screen.findByRole('main', { name: 'Job' })).toHaveClass('sb-job-page');
  });

  it('while the new page is mounted its keys win (j k, g t, c); ? lists them; the old meanings come back when it goes', async () => {
    localStorage.setItem('sb.jobPage', 'new');
    window.location.hash = '#/job/beta';
    await renderSwitchable();
    expect(await screen.findByRole('main', { name: 'Job' })).toHaveClass('jp2');
    await screen.findByRole('heading', { level: 1, name: 'Beta, from its page' });
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(window.location.hash).toBe('#/job/beta');
    fireEvent.keyDown(document.body, { key: 'g' });
    fireEvent.keyDown(document.body, { key: 't' });
    expect(window.location.hash).toBe('#/job/beta/read/ticket/ticket');
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(screen.queryByRole('dialog', { name: /new job/i })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message to the Foreman' }));
    act(() => { (document.activeElement as HTMLElement).blur(); });
    fireEvent.keyDown(document.body, { key: '?' });
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const group = within(sheet).getByRole('region', { name: 'The new job page' });
    expect(group).not.toHaveTextContent('(not on this page)');
    expect(group).toHaveTextContent('Open the ticket and goal');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    // Back to the old page: j is the next job again.
    act(() => { localStorage.removeItem('sb.jobPage'); window.dispatchEvent(new StorageEvent('storage', { key: 'sb.jobPage' })); });
    expect(await screen.findByRole('main', { name: 'Job' })).toHaveClass('sb-job-page');
    hop();
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(window.location.hash).not.toMatch(/^#\/job\/beta/);
    expect(window.location.hash).toMatch(/^#\/job\//);
  });
});
