import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Snapshot } from '../api/types';
import { longJob } from '../jobpage/fixtures/longJob';
import { forgetRecentPages } from '../jobpage/recent';
import type { JobBody } from '../jobpage/types';
import type { EventSourceLike } from '../state/live';
import { job, snapshot } from '../state/test-fixtures';
import { App } from './App';
import { oldPages } from './router';

class FakeStream implements EventSourceLike {
  readyState = 0;
  onopen: EventSourceLike['onopen'] = null;
  onmessage: EventSourceLike['onmessage'] = null;
  onerror: EventSourceLike['onerror'] = null;
  close() { this.readyState = 2; }
}

/**
 * What the test's dashboard answers, by route: the job page reads its payload (the made-up long job's,
 * as this job, with its title) and its bodies; the drawer and the sheets read the job's details,
 * its documents and its notes. `detail` adds to a job's details.
 */
function serverGet(detail: (slug: string) => Record<string, unknown> = () => ({}), notes = '') {
  return vi.fn(async (path: string): Promise<unknown> => {
    const page = /^\/api\/job\/([^/?]+)\/page/.exec(path);
    if (page) {
      const slug = decodeURIComponent(page[1]);
      return { ...JSON.parse(JSON.stringify(longJob.payload)), slug, title: `Job ${slug}` };
    }
    if (/^\/api\/job\/[^/?]+\/item/.test(path)) {
      const b = longJob.bodies[decodeURIComponent(/[?&]id=([^&]+)/.exec(path)?.[1] ?? '')];
      if (!b) throw new Error('Starbase answered 404.');
      return { ...b, version: String(b.meta.hash ?? b.id) } satisfies JobBody;
    }
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

// A laptop's window, 1280 px wide (jsdom has no matchMedia): the job page shows its two panes and
// the conversation's column, as it does from 1100 px.
beforeEach(() => {
  forgetRecentPages();
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    return { matches: (!min || 1280 >= Number(min[1])) && (!max || 1280 <= Number(max[1])), media: q, addEventListener() {}, removeEventListener() {} };
  });
});
afterEach(() => { window.location.hash = ''; localStorage.clear(); vi.unstubAllGlobals(); });

describe('App shell', () => {
  it('shows a job full width: the job page with its seven steps, no Jobs or Preview pane', async () => {
    window.location.hash = '#/job/beta';
    renderApp(snapshot({ jobs: [job('alpha', 'needs-you'), job('beta', 'running'), job('gamma', 'done')] }));
    const page = await screen.findByRole('main', { name: 'Job' });
    expect(page).toHaveClass('jp2');
    expect(within(page).getByRole('heading', { level: 1, name: 'Job beta' })).toBeInTheDocument();
    // The seven stops are the job page's seven steps (a pick moves the address to #/job/beta/stage/<stop>).
    expect(within(within(page).getByRole('navigation', { name: 'Steps' })).getAllByRole('button')).toHaveLength(7);
    expect(screen.queryByRole('navigation', { name: 'Jobs' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Preview' })).toBeNull();
    // The top bar: the product's name, the five pages (the Desk with what waits for you), and the gear.
    const bar = document.querySelector<HTMLElement>('.topbar')!;
    expect(within(bar).getByRole('link', { name: 'Starbase, back to Jobs' })).toHaveAttribute('href', '#/');
    const pages = within(bar).getByRole('navigation', { name: 'Pages' });
    expect(within(pages).getAllByRole('link').map((a) => a.textContent)).toEqual(['Jobs', 'Desk', 'Inbox', 'Stacks', 'Telemetry']);
    expect(within(pages).getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByRole('link', { name: 'Desk' })).toHaveAttribute('href', '#/desk');
    // The gear: Settings, the Crew-dex in Play, the flow map, the Table, the keys, the guide and every action.
    fireEvent.click(within(bar).getByRole('button', { name: 'Settings and more' }));
    const gear = within(bar).getByRole('menu', { name: 'Settings and more' });
    expect(within(gear).getAllByRole('menuitem').map((m) => m.querySelector('.menu-label')?.textContent)).toEqual(['Settings', 'Crew-dex', 'Achievements', 'Flow map', 'Table', 'Keys', 'Guide', 'Every action']);
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
    expect(await screen.findByRole('heading', { level: 1, name: 'Job beta' })).toBeInTheDocument();
    // The job page: its seven steps.
    expect(within(screen.getByRole('navigation', { name: 'Steps' })).getAllByRole('button')).toHaveLength(7);
    // Not in the page, the gear, the job's ⋯ menu, the keys sheet or any hover text.
    const said = () => [document.body.textContent ?? '', ...[...document.querySelectorAll('[title], [aria-label], [data-tip]')].map((e) => `${e.getAttribute('title') ?? ''} ${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('data-tip') ?? ''}`)].join(' ');
    fireEvent.click(screen.getByRole('button', { name: 'Settings and more' }));
    expect(said()).not.toMatch(/classic/i);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'More for this job' }));
    expect(said()).not.toMatch(/classic/i);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(said()).not.toMatch(/classic/i);
    fireEvent.keyDown(document, { key: 'Escape' });
    // Every action (on the job page ⌘K is the page's own box, whose last row is Every action) lists
    // nothing for it; part of the word finds nothing; the exact word shows one row and Enter opens this job there.
    fireEvent.click(screen.getByRole('button', { name: 'Settings and more' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Every action/ }));
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

  it('shows a job’s screens full width at #/job/<slug>/screens, with Back to the job', async () => {
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
    // Back to the job: the job page.
    act(() => { window.location.hash = '#/job/beta'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Job beta' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Job' })).toHaveClass('jp2');
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
  });

  it('says so when the dashboard can’t be reached', async () => {
    renderApp(new Error('connection refused'));
    expect(await screen.findByRole('alert')).toHaveTextContent('connection refused');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('Every action lists only the actions valid now; picking one runs it', async () => {
    window.location.hash = '#/job/alpha';
    renderApp(snapshot({ jobs: [job('alpha', 'idle'), job('beta', 'running')] }));
    await screen.findByRole('heading', { level: 1, name: 'Job alpha' });
    // On the job page ⌘K is the page's own box: the gear's Every action is the app's.
    fireEvent.click(screen.getByRole('button', { name: 'Settings and more' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Every action/ }));
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
    await screen.findByRole('heading', { level: 1, name: 'Job alpha' });
    fireEvent.click(screen.getByRole('button', { name: 'Settings and more' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Every action/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search actions' }), { target: { value: 'mark' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search actions' }), { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Mark “Job alpha” as done' })).toBeInTheDocument();
  });

  it('c opens the new job sheet and ? the keys; j and k step through the jobs from Jobs, and are the job page’s own on a job', async () => {
    renderApp(snapshot({ jobs: [job('alpha', 'needs-you'), job('beta', 'idle')] }));
    await screen.findByRole('main', { name: 'Jobs' });
    const hop = () => act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(window.location.hash).toBe('#/job/alpha');
    hop();
    // On the job page j and k move between its lines: the address stays.
    await screen.findByRole('heading', { level: 1, name: 'Job alpha' });
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(window.location.hash).toBe('#/job/alpha');

    const composer = await screen.findByRole('textbox', { name: 'Message to the Foreman' });
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

// Part 3, Task 17: the job page at a job's address and at each step's. A pick moves the address in
// place (job to stage, stage to stage) and a link moves it with a hashchange; either way the page
// stays mounted (one key, the job's), so words typed in its message box stay.
describe('the job page at a job’s and a step’s address', () => {
  function renderJob(jobs = [job('alpha', 'needs-you', { stage: 'plan', lane: 'needs-you' })]) {
    const get = serverGet();
    const api = { snapshot: vi.fn(async () => snapshot({ jobs })), setToken: vi.fn(), get, post: vi.fn(async () => ({ ok: true })), put: vi.fn() } as unknown as ApiClient;
    render(<App api={api} openStream={() => new FakeStream()} />);
    return { get };
  }
  const stepRow = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.jp2-st-row')].find((b) => b.querySelector('.jp2-st-name')?.textContent === name)!;
  /** Words typed into the job page's message box. */
  async function typeInTheBox(words: string) {
    const box = await screen.findByRole('textbox', { name: 'Message to the Foreman' });
    act(() => { box.focus(); });
    fireEvent.change(box, { target: { value: words } });
    expect(box).toHaveValue(words);
    return box;
  }

  it('a job’s address shows the job page, from the Jobs row, then its payload', async () => {
    window.location.hash = '#/job/alpha';
    const { get } = renderJob([job('alpha', 'running', { stage: 'plan', lane: 'working' }), job('beta', 'idle')]);
    const page = await screen.findByRole('main', { name: 'Job' });
    expect(page).toHaveClass('jp2');
    expect(within(page).getByRole('heading', { level: 1, name: 'Job alpha' })).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/job/alpha/page'));
    // The heavy step view of the page that is gone is never asked for.
    expect(get.mock.calls.map((c) => c[0] as string).filter((p) => /\/stage\//.test(p))).toEqual([]);
    // The job's conversation address is the same page.
    cleanup();
    window.location.hash = '#/job/alpha/conversation';
    renderJob([job('alpha', 'running', { stage: 'plan', lane: 'working' })]);
    expect(await screen.findByRole('main', { name: 'Job' })).toHaveClass('jp2');
  });

  it('a step’s address shows the job page on that step; the browser tab names the step and the job', async () => {
    window.location.hash = '#/job/alpha/stage/review';
    renderJob([job('alpha', 'running', { stage: 'plan', lane: 'working' })]);
    const page = await screen.findByRole('main', { name: 'Job' });
    expect(page).toHaveClass('jp2');
    await waitFor(() => expect(stepRow('Review')).toHaveAttribute('aria-current', 'step'));
    expect(document.title).toContain('Review · Job alpha');
  });

  it('typing in the message box then picking another step keeps the words', async () => {
    window.location.hash = '#/job/alpha';
    renderJob();
    const page = await screen.findByRole('main', { name: 'Job' });
    await waitFor(() => expect(stepRow('Spec')).toBeDefined());
    const box = await typeInTheBox('Use the small table.');
    // From the job's address to a step's (the pick rewrites the address in place).
    fireEvent.click(stepRow('Spec'));
    await act(async () => {});
    expect(window.location.hash).toBe('#/job/alpha/stage/spec');
    expect(stepRow('Spec')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('main', { name: 'Job' })).toBe(page);
    expect(screen.getByRole('textbox', { name: 'Message to the Foreman' })).toBe(box);
    expect(box).toHaveValue('Use the small table.');
    // And from one step's address to another's.
    fireEvent.click(stepRow('Build'));
    await act(async () => {});
    expect(window.location.hash).toBe('#/job/alpha/stage/build');
    expect(screen.getByRole('main', { name: 'Job' })).toBe(page);
    expect(screen.getByRole('textbox', { name: 'Message to the Foreman' })).toBe(box);
    expect(box).toHaveValue('Use the small table.');
  });

  it('going from the job’s address to a step’s address keeps the words', async () => {
    window.location.hash = '#/job/alpha';
    renderJob();
    const page = await screen.findByRole('main', { name: 'Job' });
    const box = await typeInTheBox('Keep the old export.');
    // A link (a hashchange) to one of the job's steps, then to another.
    act(() => { window.location.hash = '#/job/alpha/stage/test'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await waitFor(() => expect(stepRow('Test')).toHaveAttribute('aria-current', 'step'));
    expect(screen.getByRole('main', { name: 'Job' })).toBe(page);
    expect(screen.getByRole('textbox', { name: 'Message to the Foreman' })).toBe(box);
    expect(box).toHaveValue('Keep the old export.');
    act(() => { window.location.hash = '#/job/alpha/stage/ship'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await waitFor(() => expect(stepRow('Ship')).toHaveAttribute('aria-current', 'step'));
    expect(screen.getByRole('main', { name: 'Job' })).toBe(page);
    expect(box).toHaveValue('Keep the old export.');
  });

  it('the old page’s addresses land on the job page: the overview, a requirement ID, a step', async () => {
    for (const hash of ['#/job/alpha/overview', '#/job/alpha/id/FR-001', '#/job/alpha/stage/plan']) {
      window.location.hash = hash;
      renderJob();
      expect(await screen.findByRole('main', { name: 'Job' }), hash).toHaveClass('jp2');
      expect(screen.getByRole('heading', { level: 1, name: 'Job alpha' })).toBeInTheDocument();
      cleanup();
    }
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

  it('the job page’s ⋯ menu opens it; Escape closes it', async () => {
    renderWithJob();
    await screen.findByRole('heading', { level: 1, name: 'Job alpha' });
    fireEvent.click(screen.getByRole('button', { name: 'More for this job' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Notes and options' }));
    const drawer = screen.getByRole('dialog', { name: 'Notes and options' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(within(drawer).getByRole('tab', { name: 'Notes' })).toHaveFocus();
    expect(await within(drawer).findByRole('textbox', { name: /Notes for the Foreman/ })).toHaveValue('Keep it small.');
    fireEvent.keyDown(document.body, { key: 'j' }); // the drawer is open: page keys wait
    expect(window.location.hash).toBe('#/job/alpha');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Notes and options' })).toBeNull();
  });

  it('Every action offers “Job notes and options” and opens the drawer', async () => {
    renderWithJob();
    await screen.findByRole('heading', { level: 1, name: 'Job alpha' });
    fireEvent.click(screen.getByRole('button', { name: 'Settings and more' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Every action/ }));
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

  it('on a job: i puts the cursor in the message box; Every action’s Write to the Foreman does too', async () => {
    window.location.hash = '#/job/alpha';
    const get = serverGet();
    const api = { snapshot: vi.fn(async () => snapshot({ jobs: [job('alpha', 'idle')] })), setToken: vi.fn(), get, post: vi.fn(), put: vi.fn() } as unknown as ApiClient;
    render(<App api={api} openStream={() => new FakeStream()} />);
    await screen.findByRole('heading', { level: 1, name: 'Job alpha' });
    expect(screen.getByRole('button', { name: 'New job' }).querySelector('kbd')).toHaveTextContent('c');
    fireEvent.keyDown(document.body, { key: 'i' });
    const box = screen.getByRole('textbox', { name: 'Message to the Foreman' });
    expect(box).toHaveFocus();
    fireEvent.keyDown(box, { key: 'n' }); // typing: nothing opens
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => { box.blur(); });
    fireEvent.click(screen.getByRole('button', { name: 'Settings and more' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Every action/ }));
    const search = screen.getByRole('combobox', { name: 'Search actions' });
    fireEvent.change(search, { target: { value: 'write to the foreman' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(box).toHaveFocus());
  });
});

// The switch between the old and the new job page is gone: a value kept in this browser from before
// changes nothing, and the job page's keys win while it is mounted.
describe('the job page with no switch', () => {
  it('a stored sb.jobPage is ignored; the page’s keys win (j k, g t, c); ? lists them; on Jobs j is the next job again', async () => {
    localStorage.setItem('sb.jobPage', 'old');
    window.location.hash = '#/job/beta';
    renderApp(snapshot({ jobs: [job('alpha', 'needs-you'), job('beta', 'running'), job('gamma', 'idle')] }));
    expect(await screen.findByRole('main', { name: 'Job' })).toHaveClass('jp2');
    await screen.findByRole('heading', { level: 1, name: 'Job beta' });
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
    const group = within(sheet).getByRole('region', { name: 'The job page' });
    expect(group).not.toHaveTextContent('(not on this page)');
    expect(group).toHaveTextContent('Open the ticket and goal');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    // Off the job page j is the next job again.
    act(() => { window.location.hash = '#/'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await screen.findByRole('main', { name: 'Jobs' });
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(window.location.hash).toMatch(/^#\/job\//);
    expect(localStorage.getItem('sb.jobPage')).toBe('old');
  });
});

describe('Jobs fetch the job page ahead (Task 7 fix round 1)', () => {
  beforeEach(async () => { (await import('../jobpage/recent')).forgetRecentPages(); });
  afterEach(async () => { (await import('../jobpage/recent')).forgetRecentPages(); });

  it('the pointer or the focus on a job card asks for its page once', async () => {
    const get = serverGet();
    const api = { snapshot: vi.fn(async () => snapshot({ jobs: [job('alpha', 'needs-you'), job('beta', 'running')] })), setToken: vi.fn(), get } as unknown as ApiClient;
    const pages = () => get.mock.calls.map((c) => c[0] as string).filter((p) => p.includes('/page'));
    render(<App api={api} openStream={() => new FakeStream()} />);
    await screen.findByRole('main', { name: 'Jobs' });
    expect(pages()).toEqual([]);
    const link = screen.getAllByRole('link', { name: 'Job beta' })[0];
    fireEvent.pointerEnter(link);
    fireEvent.focus(link);
    await waitFor(() => expect(pages()).toEqual(['/api/job/beta/page']));
  });
});

describe('the guide in the app', () => {
  it('the gear’s Guide opens it; g then ? opens it; the keys list links to its page on keys', async () => {
    renderApp(snapshot({ jobs: [job('alpha', 'needs-you')] }));
    await screen.findByRole('main', { name: 'Jobs' });
    const bar = document.querySelector<HTMLElement>('.topbar')!;
    fireEvent.click(within(bar).getByRole('button', { name: 'Settings and more' }));
    const item = within(within(bar).getByRole('menu', { name: 'Settings and more' })).getByRole('menuitem', { name: /^Guide/ });
    expect(item).toHaveAttribute('href', '#/guide');
    expect(item).toHaveTextContent('g ?');
    fireEvent.keyDown(item, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'g' });
    fireEvent.keyDown(document.body, { key: 'Shift', shiftKey: true });
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true });
    expect(window.location.hash).toBe('#/guide');
    const page = await screen.findByRole('main', { name: 'Guide' });
    expect(within(page).getByRole('navigation', { name: 'Guide pages' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('(1) Guide · Starbase'));
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true });
    const keys = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(keys).getByRole('link', { name: 'Guide' })).toHaveAttribute('href', '#/guide/10-keys-and-command-box');
  });

  it('a guide page’s address opens it; Back goes to the page before', async () => {
    window.location.hash = '#/guide/03-jobs';
    renderApp(snapshot({ jobs: [job('alpha', 'needs-you')] }));
    const page = await screen.findByRole('main', { name: 'Guide' });
    expect(await within(page).findByRole('heading', { level: 2, name: '3. The Jobs page' })).toBeInTheDocument();
    act(() => { window.location.hash = '#/guide/04-a-job'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(await within(page).findByRole('heading', { level: 2, name: '4. A job' })).toBeInTheDocument();
  });
});
