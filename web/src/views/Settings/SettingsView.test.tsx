import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { Rule, RulesList } from '../../api/types';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { ev, snapshot } from '../../state/test-fixtures';
import { SettingsView } from './SettingsView';

const RULE: Rule = { id: 'r1', tool: 'Bash', kind: 'prefix', value: 'npm run test:db', label: 'run any command starting with “npm run test:db”', createdAt: '2026-10-15T11:00:00Z', from: { slug: 'alpha', title: 'Job alpha' } };

function setup(lists: RulesList[], del: (path: string) => Promise<unknown> = async () => ({ ok: true })) {
  let n = 0;
  const get = vi.fn(async () => lists[Math.min(n++, lists.length - 1)]);
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot() });
  const api = { get, del: vi.fn(del) } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}><SettingsView /></WorkshopContext.Provider>);
  return { get, store, del: api.del as ReturnType<typeof vi.fn> };
}

afterEach(() => { localStorage.clear(); });

describe('Settings', () => {
  it('lists your rules with where they came from', async () => {
    setup([{ rules: [RULE], active: true, unreadable: null }]);
    const row = (await screen.findByText('Run any command starting with “npm run test:db”')).closest('li')!;
    expect(within(row).getByRole('link', { name: 'Job alpha' })).toHaveAttribute('href', '#/job/alpha');
    expect(within(row).getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('How this works')).toBeInTheDocument();
  });

  it('removes a rule and fetches the list again', async () => {
    const { del, get } = setup([{ rules: [RULE], active: true, unreadable: null }, { rules: [], active: true, unreadable: null }]);
    const remove = await screen.findByRole('button', { name: 'Remove the rule: Run any command starting with “npm run test:db”' });
    expect(remove).toHaveAttribute('title');
    fireEvent.click(remove);
    await waitFor(() => expect(screen.getByText(/No rules yet/)).toBeInTheDocument());
    expect(del).toHaveBeenCalledWith('/api/rules/r1');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('says why when a rule can’t be removed', async () => {
    setup([{ rules: [RULE], active: true, unreadable: null }], async () => { throw new ApiError(404, 'That rule was already removed.'); });
    fireEvent.click(await screen.findByRole('button', { name: /^Remove the rule/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already removed');
  });

  it('refetches when the rules change elsewhere', async () => {
    const { get, store } = setup([{ rules: [], active: true, unreadable: null }, { rules: [RULE], active: true, unreadable: null }]);
    await screen.findByText(/No rules yet/);
    act(() => store.dispatch({ type: 'event', event: ev(11, 'rules', null, { count: 1 }) }));
    expect(await screen.findByText('Run any command starting with “npm run test:db”')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('explains when the rules wait because every step asks', async () => {
    setup([{ rules: [RULE], active: false, unreadable: null }]);
    expect(await screen.findByRole('note')).toHaveTextContent('“Ask about everything” is on');
  });
});
