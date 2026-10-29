import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Snapshot } from '../api/types';
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

function renderApp(snap: Snapshot | Error) {
  const streams: FakeStream[] = [];
  const api = {
    snapshot: vi.fn(async () => { if (snap instanceof Error) throw snap; return snap; }),
    setToken: vi.fn(),
    get: vi.fn(async () => ({ slug: 'beta', thread: [], threadMore: false })),
  } as unknown as ApiClient;
  const openStream = (_url: string) => { const s = new FakeStream(); streams.push(s); return s; };
  render(<App api={api} openStream={openStream} />);
  return { streams };
}

afterEach(() => { window.location.hash = ''; localStorage.clear(); });

describe('App shell', () => {
  it('shows a job full width: the Job page with its seven stops, no Jobs or Preview pane', async () => {
    window.location.hash = '#/job/beta';
    renderApp(snapshot({ jobs: [job('alpha', 'needs-you'), job('beta', 'running'), job('gamma', 'done')] }));
    const page = await screen.findByRole('main', { name: 'Job' });
    expect(within(page).getByRole('heading', { name: 'Job beta' })).toBeInTheDocument();
    expect(within(page).getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('#/job/beta/stage/'))).toHaveLength(7);
    expect(screen.queryByRole('navigation', { name: 'Jobs' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Preview' })).toBeNull();
    // The top bar: the product's name, the five pages (the Desk with what waits for you), and the gear.
    const bar = document.querySelector<HTMLElement>('.topbar')!;
    expect(within(bar).getByRole('link', { name: 'Dashboard, back to Jobs' })).toHaveAttribute('href', '#/');
    const pages = within(bar).getByRole('navigation', { name: 'Pages' });
    expect(within(pages).getAllByRole('link').map((a) => a.textContent)).toEqual(['Inbox', 'Desk', 'Jobs', 'Stacks', 'Telemetry']);
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
    expect(document.title).toBe('(1) Job beta · Dashboard');
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
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Brief', 'Spec', 'Plan', 'Code', 'Tests', 'Review', 'Decisions', 'Ship']);
    // Not in the page, the gear, the job menu, the keys sheet or any hover text.
    const said = () => [document.body.textContent ?? '', ...[...document.querySelectorAll('[title], [aria-label]')].map((e) => `${e.getAttribute('title') ?? ''} ${e.getAttribute('aria-label') ?? ''}`)].join(' ');
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

  it('shows a job’s screens full width at #/job/<slug>/screens, with Back to the job; the Spec tab links to them', async () => {
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
    // Back on the job: its Spec tab links to the screens; a job without screens has no link.
    act(() => { window.location.hash = '#/job/beta'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    fireEvent.click(await screen.findByRole('tab', { name: 'Spec' }));
    expect(screen.getByRole('link', { name: /Review the screens/ })).toHaveAttribute('href', '#/job/beta/screens');
    act(() => { window.location.hash = '#/job/alpha'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await screen.findByRole('heading', { name: 'Job alpha' });
    fireEvent.click(screen.getByRole('tab', { name: 'Spec' }));
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

describe('Job drawer in the shell', () => {
  function renderWithJob() {
    window.location.hash = '#/job/alpha';
    const get = vi.fn(async (path: string) => {
      if (path === '/api/job/alpha/notes') return { text: 'Keep it small.', updatedAt: null };
      return { slug: 'alpha', thread: [], threadMore: false, options: null };
    });
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
    const get = vi.fn(async (path: string) => (path === '/api/job/alpha/notes' ? { text: '', updatedAt: null } : { slug: 'alpha', thread: [], threadMore: false, options: null }));
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
