import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Usage } from '../api/types';
import { createStore, WorkshopContext } from '../state/store';
import { snapshot } from '../state/test-fixtures';
import { UsageBanner } from './UsageBanner';

// Invented jobs only.
const LIMITED: Usage = {
  limited: true, blocking: true, label: '5-hour limit', resetsAt: new Date(Date.now() + 90 * 60000).toISOString(), resetKnown: true,
  passed: false, jobs: [{ slug: 'alpha', title: 'Job alpha' }], autoResume: true, warning: null,
};

function setup(usage: Usage, post = vi.fn(async (path: string, body?: { on?: boolean }) => (path === '/api/usage/auto' ? { ...usage, autoResume: body?.on } : { resumed: [{ slug: 'alpha' }] }))) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ usage }) });
  const api = { post, get: vi.fn() } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><UsageBanner /></WorkshopContext.Provider>);
  return { ...utils, store, post };
}

describe('UsageBanner', () => {
  it('shows nothing while there is no limit', () => {
    const { container } = setup({ limited: false, blocking: false, label: null, resetsAt: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('says which jobs are paused and when they carry on', () => {
    setup(LIMITED);
    const banner = screen.getByRole('status', { name: 'Usage limit' });
    expect(banner).toHaveTextContent('Claude’s 5-hour limit is reached.');
    expect(banner).toHaveTextContent('1 job paused: Job alpha.');
    expect(banner).toHaveTextContent(/They carry on by themselves at about .* \(in 1h 30m\)/);
  });

  it('Carry on now starts the paused jobs again', async () => {
    const { post } = setup(LIMITED);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Carry on now' })); });
    expect(post).toHaveBeenCalledWith('/api/usage/resume', {});
    expect(screen.getByText('Carrying on: 1 job.')).toBeInTheDocument();
  });

  it('the automatic carry-on switch is saved and shown at once', async () => {
    const { post, store } = setup(LIMITED);
    const box = screen.getByRole('checkbox', { name: 'Carry on automatically when it resets' });
    expect(box).toBeChecked();
    await act(async () => { fireEvent.click(box); });
    expect(post).toHaveBeenCalledWith('/api/usage/auto', { on: false });
    expect(store.getState().usage?.autoResume).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Carry on automatically when it resets' })).not.toBeChecked();
    expect(screen.getByRole('status', { name: 'Usage limit' })).toHaveTextContent('Automatic carry-on is off');
  });

  it('gives a heads-up close to the limit', () => {
    setup({ limited: false, blocking: false, label: null, resetsAt: null, warning: { label: 'weekly limit', percent: 92, resetsAt: null } });
    expect(screen.getByRole('status')).toHaveTextContent('you’ve used 92% of Claude’s weekly limit');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
