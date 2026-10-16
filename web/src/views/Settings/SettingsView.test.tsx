import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { Rule, RulesList, Settings, SkillStatus } from '../../api/types';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { ev, snapshot } from '../../state/test-fixtures';
import { SettingsView, STALE_SKILL } from './SettingsView';

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
    expect(screen.getAllByText('How this works').length).toBeGreaterThan(0);
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

  it('says when jobs with their own setting don’t use the rules', async () => {
    setup([{ rules: [RULE], active: true, jobOverrides: 2, unreadable: null }]);
    expect(await screen.findByRole('note')).toHaveTextContent('aren’t used for the 2 jobs set to “Ask about everything” on their own');
  });
});

describe('Settings: the installed skill', () => {
  function withSkill(skill: SkillStatus | undefined) {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', skill } }) });
    const api = { get: vi.fn(async () => ({ rules: [], active: true, unreadable: null })) } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store, api }}><SettingsView /></WorkshopContext.Provider>);
    return { store };
  }
  const warning = () => screen.queryByText(/predates levels/);

  it('warns when the installed /feature skill has no Levels table, saying how to update it', async () => {
    withSkill({ installed: true, levels: false, path: '/tmp/fw-test/skills/feature/job-options.md' });
    const w = warning()!;
    expect(w).toHaveTextContent(STALE_SKILL);
    expect(STALE_SKILL).toBe('Your installed /feature skill predates levels. Run install.sh from claude-feature-workflow to update it; until then the Foreman treats L0 like L1 and ignores chip lines it doesn’t know.');
    expect(w).toHaveAttribute('title', expect.stringContaining('/tmp/fw-test/skills/feature/job-options.md'));
    await screen.findByText(/No rules yet/);
  });

  it('says nothing when the skill knows levels, when none is installed, or before meta says', async () => {
    withSkill({ installed: true, levels: true, path: '/tmp/fw-test/skills/feature/job-options.md' });
    expect(warning()).toBeNull();
    await screen.findByText(/No rules yet/);
    cleanup();
    withSkill({ installed: false, levels: false, path: '/tmp/fw-test/skills/feature/job-options.md' });
    expect(warning()).toBeNull();
    await screen.findByText(/No rules yet/);
    cleanup();
    withSkill(undefined);
    expect(warning()).toBeNull();
    await screen.findByText(/No rules yet/);
  });
});

describe('Settings: permissions', () => {
  function withSettings(settings: Settings, post: (path: string, body: unknown) => Promise<unknown>) {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings } }) });
    const api = { get: vi.fn(async () => ({ rules: [], active: true, unreadable: null })), del: vi.fn(), post: vi.fn(post) } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store, api }}><SettingsView /></WorkshopContext.Provider>);
    return { store, post: api.post as ReturnType<typeof vi.fn> };
  }

  it('offers the three settings with hints, routine steps automatic by default', async () => {
    withSettings({ policy: 'hands-off' }, async () => ({}));
    const group = screen.getByRole('group', { name: 'How much the Foreman may do without asking you' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => (r.closest('label') as HTMLElement).querySelector('.rule-option-kind')?.textContent)).toEqual(['Ask about everything', 'Routine steps automaticDefault', 'Auto mode']);
    expect(within(group).getByRole('radio', { name: /Routine steps automatic/ })).toBeChecked();
    for (const r of radios) expect(r.closest('label')).toHaveAttribute('title');
    expect(document.querySelector('.policy-hard-lines')).toHaveTextContent(/always ask you, and pushes to the org repo or force pushes are refused/);
    await screen.findByText(/No rules yet/);
  });

  it('picking auto mode saves it and shows it at once', async () => {
    const { post, store } = withSettings({ policy: 'hands-off' }, async (_p, body) => ({ policy: (body as { policy: string }).policy, jobPolicy: {}, autoMode: { available: null, reason: null, checkedAt: null } }));
    fireEvent.click(screen.getByRole('radio', { name: /Auto mode/ }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Auto mode/ })).toBeChecked());
    expect(post).toHaveBeenCalledWith('/api/settings', { policy: 'auto' });
    expect(store.getState().meta?.settings?.policy).toBe('auto');
  });

  it('shows auto mode disabled with the reason when the account can’t use it, and can check again', async () => {
    const { post } = withSettings(
      { policy: 'hands-off', autoMode: { available: false, reason: 'Claude Code started in its normal mode instead.', checkedAt: '2026-10-15T12:00:00Z' } },
      async () => ({ policy: 'hands-off', autoMode: { available: null, reason: null, checkedAt: null } }),
    );
    const auto = screen.getByRole('radio', { name: /Auto mode/ });
    expect(auto).toBeDisabled();
    expect(screen.getByText(/Not available: Claude Code started in its normal mode/)).toBeInTheDocument();
    const again = screen.getByRole('button', { name: 'Check again' });
    expect(again).toHaveAttribute('title');
    fireEvent.click(again);
    await waitFor(() => expect(screen.getByRole('radio', { name: /Auto mode/ })).toBeEnabled());
    expect(post).toHaveBeenCalledWith('/api/settings', { recheckAuto: true });
  });

  it('follows a change made elsewhere (the settings event)', async () => {
    const { store } = withSettings({ policy: 'hands-off' }, async () => ({}));
    act(() => store.dispatch({ type: 'event', event: ev(11, 'settings', null, { policy: 'ask-all', jobPolicy: {} }) }));
    expect(screen.getByRole('radio', { name: /Ask about everything/ })).toBeChecked();
  });

  it('offers every theme with a description, and a pick applies at once and is remembered', async () => {
    document.documentElement.setAttribute('data-theme', 'default');
    setup([{ rules: [], active: true, unreadable: null }]);
    const picker = screen.getByRole('group', { name: 'How the Workshop looks' });
    const radios = within(picker).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['default', 'neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop']);
    expect(within(picker).getByRole('radio', { name: /^Default/ })).toBeChecked();
    expect(within(picker).getByText(/Ink-navy night/)).toBeInTheDocument();
    fireEvent.click(within(picker).getByRole('radio', { name: /Candy pop/ }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('candy-pop');
    expect(localStorage.getItem('workshop.theme')).toBe('candy-pop');
    expect(within(picker).getByRole('radio', { name: /Candy pop/ })).toBeChecked();
    expect(screen.getByText(/changes only how things look/)).toBeInTheDocument();
    document.documentElement.removeAttribute('data-theme');
  });
});
