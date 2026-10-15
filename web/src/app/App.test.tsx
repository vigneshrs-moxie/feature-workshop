import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Snapshot } from '../api/types';
import type { EventSourceLike } from '../state/live';
import { ev, job, permission, snapshot } from '../state/test-fixtures';
import { App } from './App';

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
  it('shows the three panes with the jobs grouped', async () => {
    renderApp(snapshot({ jobs: [job('alpha', 'needs-you'), job('beta', 'running'), job('gamma', 'done')] }));
    expect(await screen.findByRole('navigation', { name: 'Jobs' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Foreman' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Preview' })).toBeInTheDocument();
    const needs = screen.getByRole('region', { name: 'Needs you' });
    expect(within(needs).getByRole('link', { name: /^Job alpha/ })).toHaveAttribute('href', '#/job/alpha');
    expect(screen.getByRole('region', { name: 'Running' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Paused' })).toBeNull();
    expect(screen.getByText('1 needs you')).toBeInTheDocument();
  });

  it('opens a job from the hash, with a link to its classic page', async () => {
    window.location.hash = '#/job/beta';
    renderApp(snapshot());
    expect(await screen.findByRole('heading', { name: 'Job beta' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Job beta/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Open this job in classic view' })).toHaveAttribute('href', '/#/job/beta');
    act(() => { window.location.hash = '#/'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(screen.getByText('Pick a job on the left to see its conversation.')).toBeInTheDocument();
  });

  it('updates live from the stream', async () => {
    const { streams } = renderApp(snapshot());
    await screen.findByRole('navigation', { name: 'Jobs' });
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    act(() => { streams[0].readyState = 1; streams[0].onopen?.(new Event('open')); });
    expect(screen.getByText('Live')).toBeInTheDocument();
    act(() => { streams[0].onmessage?.(new MessageEvent('message', { data: JSON.stringify(ev(11, 'permission', 'alpha', permission('p1', 'alpha'))) })); });
    expect(within(screen.getByRole('region', { name: 'Needs you' })).getByRole('link', { name: /^Job alpha/ })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search actions' }), { target: { value: 'mark' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search actions' }), { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Mark “Job alpha” as done' })).toBeInTheDocument();
  });

  it('c opens the new job sheet and ? the keys; j and k step through the jobs, but not while typing', async () => {
    renderApp(snapshot({ jobs: [job('alpha', 'needs-you'), job('beta', 'idle')] }));
    await screen.findByRole('navigation', { name: 'Jobs' });
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
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(screen.getByRole('dialog', { name: 'Start a new job' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'j' }); // a sheet is open: page keys wait
    expect(window.location.hash).toBe('#/job/alpha');
  });

  it('shows the usage-limit banner under the top bar', async () => {
    renderApp(snapshot({ usage: { limited: true, blocking: true, label: '5-hour limit', resetsAt: null, jobs: [], autoResume: false, passed: true } }));
    expect(await screen.findByRole('status', { name: 'Usage limit' })).toHaveTextContent('The limit has reset. Automatic carry-on is off');
    expect(screen.getByRole('button', { name: 'Carry on now' })).toBeInTheDocument();
  });

  it('remembers a closed “How this works” box', async () => {
    renderApp(snapshot());
    await screen.findByRole('navigation', { name: 'Jobs' });
    const box = within(screen.getByRole('navigation', { name: 'Jobs' })).getByText('How this works').closest('details')!;
    expect(box.open).toBe(true);
    act(() => { box.open = false; box.dispatchEvent(new Event('toggle')); });
    expect(localStorage.getItem('fw.how.jobs')).toBe('closed');
  });
});
