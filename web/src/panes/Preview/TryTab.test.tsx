// Try it (TryTab.tsx): the classic page's "Try it on your computer" in the Preview pane. Same
// routes; the database switch asks first, in place.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { createStore, WorkshopContext } from '../../state/store';
import { TryTab } from './TryTab';

// An invented job folder only.
const VIEW = {
  slug: 'alpha', available: true, root: '/Users/me/wt/alpha', branch: 'feature/alpha', port: 3101, url: 'http://localhost:3101', terminalApp: 'iTerm',
  app: { dir: '/Users/me/wt/alpha', rel: '.' },
  env: { exists: true, ready: true, sourceExists: true, signInSkipped: true, file: '.env.local', notes: [] },
  db: { available: true, name: 'app_dev', missing: ['0042_add_flag'], extra: [], connections: 0, matches: null, original: { exists: true, savedAt: null } },
  server: null, cmd: null, presets: [{ id: 'test', label: 'Run the tests', command: 'npm test' }],
};

function setup(view: Record<string, unknown> = VIEW) {
  const store = createStore();
  const post = vi.fn(async () => ({ ok: true }));
  const api = { get: vi.fn(async () => view), post } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}><TryTab slug="alpha" active /></WorkshopContext.Provider>);
  return { post };
}

describe('Try it', () => {
  it('shows the folder, the steps and the quick commands', async () => {
    setup();
    expect(await screen.findByRole('button', { name: '▶ Try it' })).toBeInTheDocument();
    expect(screen.getByText('~/wt/alpha')).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Steps' });
    expect(within(steps).getByText('Settings file')).toBeInTheDocument();
    expect(within(steps).getByText(/Missing this job’s database changes/)).toBeInTheDocument();
    expect(within(steps).getByText('Not running.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run the tests' })).toBeInTheDocument();
  });

  it('Try it with database changes missing asks first; starting without switching skips the switch', async () => {
    const { post } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '▶ Try it' }));
    const ask = await screen.findByRole('group', { name: 'Please confirm' });
    expect(ask).toHaveTextContent('is lost');
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Start without switching' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/local', { action: 'start' }));
    expect(post).not.toHaveBeenCalledWith('/api/job/alpha/local', expect.objectContaining({ action: 'db' }));
  });

  it('a command runs in the job’s folder', async () => {
    const { post } = setup();
    fireEvent.change(await screen.findByRole('textbox', { name: /Command to run/ }), { target: { value: 'npm test -- alpha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/local', { action: 'run', command: 'npm test -- alpha', where: 'app' }));
  });

  it('running: an Open the app link and the output', async () => {
    setup({ ...VIEW, server: { status: 'running' }, cmd: { command: 'npm test', status: 'failed', exitCode: 1, output: '1 failing' } });
    expect(await screen.findByRole('link', { name: 'Open the app ↗' })).toHaveAttribute('href', 'http://localhost:3101');
    expect(screen.getByText('Failed (exit 1)')).toBeInTheDocument();
    expect(screen.getByLabelText('Command output')).toHaveTextContent('1 failing');
  });

  it('not available: says why', async () => {
    setup({ slug: 'alpha', available: false, reason: 'This job has no folder yet.', presets: [] });
    expect(await screen.findByText('This job has no folder yet.')).toBeInTheDocument();
  });
});
