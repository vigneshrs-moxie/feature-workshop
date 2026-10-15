import { act, render, screen, within } from '@testing-library/react';
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

  it('remembers a closed “How this works” box', async () => {
    renderApp(snapshot());
    await screen.findByRole('navigation', { name: 'Jobs' });
    const box = within(screen.getByRole('navigation', { name: 'Jobs' })).getByText('How this works').closest('details')!;
    expect(box.open).toBe(true);
    act(() => { box.open = false; box.dispatchEvent(new Event('toggle')); });
    expect(localStorage.getItem('fw.how.jobs')).toBe('closed');
  });
});
