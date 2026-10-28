// Settings → Notifications: the usage warnings' switch (80 %, 90 % and full). Invented settings; no network.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Settings } from '../../api/types';
import { createStore, WorkshopContext } from '../../state/store';
import { snapshot } from '../../state/test-fixtures';
import { NotifySettings } from './NotifySettings';

afterEach(cleanup);

function setup(notify: Record<string, unknown>) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings: { policy: 'hands-off', notify } as unknown as Settings } as never }) });
  const get = vi.fn(async () => ({ method: 'osascript', history: [] }));
  const post = vi.fn(async (_path: string, body: { notify?: object }) => ({ policy: 'hands-off', notify: { ...notify, ...body.notify } }));
  render(<WorkshopContext.Provider value={{ store, api: { get, post } as unknown as ApiClient }}><NotifySettings /></WorkshopContext.Provider>);
  return { post };
}

const BASE = { enabled: true, levels: { needs: 'sound', problem: 'sound', done: 'silent' }, quiet: { on: false, from: '22:00', to: '07:00' }, skipWhenWatching: true };

describe('Settings → Notifications → Usage warnings', () => {
  it('is on unless turned off, and saves the switch', async () => {
    const { post } = setup(BASE);
    const box = screen.getByRole('checkbox', { name: 'Usage warnings at 80 %, 90 % and full' });
    expect(box).toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/settings', { notify: { usageWarnings: false } }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Usage warnings at 80 %, 90 % and full' })).not.toBeChecked());
  });

  it('shows off when it was turned off, and waits while all notifications are off', () => {
    setup({ ...BASE, enabled: false, usageWarnings: false });
    const box = screen.getByRole('checkbox', { name: 'Usage warnings at 80 %, 90 % and full' });
    expect(box).not.toBeChecked();
    expect(box).toBeDisabled();
  });
});
