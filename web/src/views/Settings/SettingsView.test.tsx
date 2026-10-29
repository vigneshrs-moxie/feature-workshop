import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { Meta, Rule, RulesList, Settings, SkillStatus } from '../../api/types';
import { installKeyListener } from '../../app/keyRegistry';
import { useRoute, type SettingsSection } from '../../app/router';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { ev, snapshot } from '../../state/test-fixtures';
import { SettingsView, STALE_SKILL } from './SettingsView';

const RULE: Rule = { id: 'r1', tool: 'Bash', kind: 'prefix', value: 'npm run test:db', label: 'run any command starting with “npm run test:db”', createdAt: '2026-10-15T11:00:00Z', from: { slug: 'alpha', title: 'Job alpha' } };
const FINISH_LINES: Meta['finishLines'] = [{ id: 'pr1-merged', label: 'PR #1 merged', hint: 'Done when your work is on the Moxie branch.' }, { id: 'main', label: 'In main', hint: 'Done when the release PR has carried it to main.' }];

/** The page as the shell mounts it: the section comes from the hash. */
function Routed() {
  const route = useRoute();
  return <SettingsView section={route.name === 'settings' ? route.section : undefined} />;
}

function setup(lists: RulesList[], del: (path: string) => Promise<unknown> = async () => ({ ok: true }), section: SettingsSection | 'routed' = 'rules', meta: Partial<Meta> = {}) {
  let n = 0;
  // The Notifications section reads its history (GET /api/notifications); the rest is the rule list.
  const get = vi.fn(async (path: string) => (path === '/api/notifications' ? { method: null, history: [] } : lists[Math.min(n++, lists.length - 1)]));
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', finishLines: FINISH_LINES, ...meta } }) });
  const api = { get, del: vi.fn(del), post: vi.fn(async () => ({})) } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}>{section === 'routed' ? <Routed /> : <SettingsView section={section} />}</WorkshopContext.Provider>);
  return { get, store, del: api.del as ReturnType<typeof vi.fn> };
}

const railRow = (name: string) => screen.getByRole('link', { name: new RegExp(`^${name}`) });
const railValue = (name: string) => railRow(name).querySelector('[data-value]')?.textContent;

afterEach(() => { localStorage.clear(); window.location.hash = ''; });

describe('Settings: the rail', () => {
  it('lists the eight sections in order, each with its current value in one line, and marks the open one', async () => {
    setup([{ rules: [RULE, { ...RULE, id: 'r2' }, { ...RULE, id: 'r3' }], active: true, unreadable: null }], undefined, 'permissions', {
      settings: { policy: 'auto', notify: { enabled: true, levels: { needs: 'sound', problem: 'silent', done: 'off' }, quiet: { on: false, from: '22:00', to: '07:00' }, skipWhenWatching: true }, workflow: { finishLine: 'pr1-merged' } },
    });
    const rail = screen.getByRole('navigation', { name: 'Settings sections' });
    const rows = within(rail).getAllByRole('link');
    expect(rows.map((r) => r.querySelector('.settings-rail-name')?.textContent)).toEqual(['Permissions', 'Notifications', 'Look', 'Keys', 'Workflow', 'Repos', 'Play', 'Rules']);
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(['#/settings/permissions', '#/settings/notifications', '#/settings/look', '#/settings/keys', '#/settings/workflow', '#/settings/repos', '#/settings/play', '#/settings/rules']);
    expect(railRow('Permissions')).toHaveAttribute('aria-current', 'page');
    expect(railRow('Rules')).not.toHaveAttribute('aria-current');
    expect(railValue('Permissions')).toBe('Auto mode');
    expect(railValue('Notifications')).toBe('Needs you and Problems on');
    expect(railValue('Look')).toBe('Default · M · One at a time · Four lanes · Play subtle');
    expect(railValue('Keys')).toBe('On');
    expect(railValue('Workflow')).toBe('Finish line: PR #1 merged');
    expect(railValue('Play')).toBe('Subtle');
    await waitFor(() => expect(railValue('Rules')).toBe('3 rules'));
    // One section at a time: Permissions is open, nothing else.
    expect(screen.getByRole('region', { name: 'Permissions' })).toBeInTheDocument();
    for (const name of ['Notifications', 'Look', 'Keys', 'Workflow', 'Play', 'Always allow rules']) expect(screen.queryByRole('region', { name })).toBeNull();
    // How this works is folded by default.
    expect(screen.getByText('How this works').closest('details')).not.toHaveAttribute('open');
  });

  it('#/settings opens the first section; #/settings/<section> opens that one; j and k move', async () => {
    window.location.hash = '#/settings';
    const off = installKeyListener();
    try {
      setup([{ rules: [], active: true, unreadable: null }], undefined, 'routed');
      expect(screen.getByRole('region', { name: 'Permissions' })).toBeInTheDocument();
      act(() => { window.location.hash = '#/settings/play'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
      expect(screen.getByRole('region', { name: 'Play' })).toBeInTheDocument();
      expect(railRow('Play')).toHaveAttribute('aria-current', 'page');
      fireEvent.keyDown(document.body, { key: 'j' });
      expect(window.location.hash).toBe('#/settings/rules');
      act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
      expect(screen.getByRole('region', { name: 'Always allow rules' })).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'j' }); // wraps round
      expect(window.location.hash).toBe('#/settings/permissions');
      act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
      fireEvent.keyDown(document.body, { key: 'k' });
      expect(window.location.hash).toBe('#/settings/rules');
      await waitFor(() => expect(railValue('Rules')).toBe('No rules'));
    } finally { off(); }
  });

  it('Find a setting: / focuses the box, matches replace the rail, a pick opens the section and rings the control', async () => {
    window.location.hash = '#/settings/keys';
    const off = installKeyListener();
    try {
      setup([{ rules: [], active: true, unreadable: null }], undefined, 'routed');
      fireEvent.keyDown(document.body, { key: '/' });
      const box = screen.getByRole('searchbox', { name: 'Find a setting' });
      expect(document.activeElement).toBe(box);
      fireEvent.change(box, { target: { value: 'chime' } });
      const hits = screen.getByRole('list', { name: 'Matching settings' });
      expect(within(hits).getAllByRole('button').map((b) => b.textContent)).toEqual(['In this browser: notifications and chimeNotifications']);
      expect(screen.queryByRole('navigation', { name: 'Settings sections' })?.querySelector('.settings-rail-list')).toBeNull();
      fireEvent.click(within(hits).getByRole('button'));
      expect(window.location.hash).toBe('#/settings/notifications');
      act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
      expect(screen.getByRole('region', { name: 'Notifications' })).toBeInTheDocument();
      const control = document.querySelector('[data-setting="alerts-browser"]')!;
      expect(control).toHaveClass('is-found');
      expect(control).toHaveTextContent('In this browser');
      // The query is cleared and the rail is back.
      expect((screen.getByRole('searchbox', { name: 'Find a setting' }) as HTMLInputElement).value).toBe('');
      expect(railRow('Notifications')).toHaveAttribute('aria-current', 'page');
      // Nothing matching says so; Enter jumps to the first match.
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zebra' } });
      expect(screen.getByText('No setting matches “zebra”.')).toBeInTheDocument();
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'finish' } });
      fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
      expect(window.location.hash).toBe('#/settings/workflow');
    } finally { off(); }
  });

  it('Notifications: the dashboard’s settings first, then In this browser, with Send a test and History last', async () => {
    setup([{ rules: [], active: true, unreadable: null }], undefined, 'notifications');
    const region = screen.getByRole('region', { name: 'Notifications' });
    const macos = within(region).getByRole('checkbox', { name: 'Send notifications to macOS' });
    const browser = within(region).getByRole('heading', { name: 'In this browser' });
    const chime = within(region).getByRole('button', { name: /Chime/ });
    const test = within(region).getByRole('button', { name: 'Send a test' });
    const history = within(region).getByText(/^History/);
    const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(before(macos, browser)).toBe(true);
    expect(before(browser, chime)).toBe(true);
    expect(before(chime, test)).toBe(true);
    expect(before(test, history)).toBe(true);
    // The same storage keys as before the move.
    fireEvent.click(chime);
    expect(localStorage.getItem('fw.alerts.chime')).toBe('on');
    await waitFor(() => expect(railValue('Rules')).toBe('No rules'));
  });
});

describe('Settings: rules', () => {
  it('lists your rules with where they came from', async () => {
    setup([{ rules: [RULE], active: true, unreadable: null }]);
    const row = (await screen.findByText('Run any command starting with “npm run test:db”')).closest('li')!;
    expect(within(row).getByRole('link', { name: 'Job alpha' })).toHaveAttribute('href', '#/job/alpha');
    expect(within(row).getByText('Bash')).toBeInTheDocument();
    expect(screen.getAllByText('How this works').length).toBeGreaterThan(0);
    expect(railValue('Rules')).toBe('1 rule');
  });

  it('removes a rule and fetches the list again', async () => {
    const { del, get } = setup([{ rules: [RULE], active: true, unreadable: null }, { rules: [], active: true, unreadable: null }]);
    const remove = await screen.findByRole('button', { name: 'Remove the rule: Run any command starting with “npm run test:db”' });
    expect(remove).toHaveAttribute('title');
    fireEvent.click(remove);
    await waitFor(() => expect(screen.getByText(/No rules yet/)).toBeInTheDocument());
    expect(del).toHaveBeenCalledWith('/api/rules/r1');
    expect(get.mock.calls.filter(([p]) => p === '/api/rules')).toHaveLength(2);
    expect(railValue('Rules')).toBe('No rules');
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
    expect(get.mock.calls.filter(([p]) => p === '/api/rules')).toHaveLength(2);
  });

  it('explains when the rules wait because every step asks', async () => {
    setup([{ rules: [RULE], active: false, unreadable: null }]);
    expect(await screen.findByRole('note')).toHaveTextContent('“Ask about everything” is on');
  });

  it('says when jobs with their own setting don’t use the rules', async () => {
    setup([{ rules: [RULE], active: true, jobOverrides: 2, unreadable: null }]);
    expect(await screen.findByRole('note')).toHaveTextContent('aren’t used for the 2 jobs set to “Ask about everything” on their own');
  });

  it('tells the rail when the rules couldn’t be loaded', async () => {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot() });
    const api = { get: vi.fn(async () => { throw new Error('no'); }) } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store, api }}><SettingsView section="rules" /></WorkshopContext.Provider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your rules: no');
    expect(railValue('Rules')).toBe('Couldn’t load');
  });
});

describe('Settings: the installed skill', () => {
  function withSkill(skill: SkillStatus | undefined) {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', skill } }) });
    const api = { get: vi.fn(async () => ({ rules: [], active: true, unreadable: null })) } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store, api }}><SettingsView section="permissions" /></WorkshopContext.Provider>);
    return { store };
  }
  const warning = () => screen.queryByText(/predates levels/);

  it('warns when the installed /feature skill has no Levels table, saying how to update it', async () => {
    withSkill({ installed: true, levels: false, path: '/tmp/fw-test/skills/feature/job-options.md' });
    const w = warning()!;
    expect(w).toHaveTextContent(STALE_SKILL);
    expect(STALE_SKILL).toBe('Your installed /feature skill predates levels. Run install.sh from claude-feature-workflow to update it; until then the Foreman treats L0 like L1 and ignores chip lines it doesn’t know.');
    expect(w).toHaveAttribute('title', expect.stringContaining('/tmp/fw-test/skills/feature/job-options.md'));
    await waitFor(() => expect(railValue('Rules')).toBe('No rules'));
  });

  it('says nothing when the skill knows levels, when none is installed, or before meta says', async () => {
    withSkill({ installed: true, levels: true, path: '/tmp/fw-test/skills/feature/job-options.md' });
    expect(warning()).toBeNull();
    await waitFor(() => expect(railValue('Rules')).toBe('No rules'));
    cleanup();
    withSkill({ installed: false, levels: false, path: '/tmp/fw-test/skills/feature/job-options.md' });
    expect(warning()).toBeNull();
    await waitFor(() => expect(railValue('Rules')).toBe('No rules'));
    cleanup();
    withSkill(undefined);
    expect(warning()).toBeNull();
    await waitFor(() => expect(railValue('Rules')).toBe('No rules'));
  });
});

describe('Settings: permissions', () => {
  function withSettings(settings: Settings, post: (path: string, body: unknown) => Promise<unknown>) {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings } }) });
    const api = { get: vi.fn(async () => ({ rules: [], active: true, unreadable: null })), del: vi.fn(), post: vi.fn(post) } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store, api }}><SettingsView section="permissions" /></WorkshopContext.Provider>);
    return { store, post: api.post as ReturnType<typeof vi.fn> };
  }

  it('offers the three settings with hints, routine steps automatic by default', async () => {
    withSettings({ policy: 'hands-off' }, async () => ({}));
    const group = screen.getByRole('group', { name: 'How much the Foreman may do without asking you' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => (r.closest('label') as HTMLElement).querySelector('.rule-option-kind')?.textContent)).toEqual(['Ask about everything', 'Routine steps automaticDefault', 'Auto mode']);
    expect(within(group).getByRole('radio', { name: /Routine steps automatic/ })).toBeChecked();
    for (const r of radios) expect(r.closest('label')).toHaveAttribute('title');
    expect(document.querySelector('.policy-hard-lines')).toHaveTextContent(/ask you, and pushes to the org repo or force pushes are refused/);
    await waitFor(() => expect(railValue('Rules')).toBe('No rules'));
  });

  it('picking auto mode saves it and shows it at once, in the rail too', async () => {
    const { post, store } = withSettings({ policy: 'hands-off' }, async (_p, body) => ({ policy: (body as { policy: string }).policy, jobPolicy: {}, autoMode: { available: null, reason: null, checkedAt: null } }));
    fireEvent.click(screen.getByRole('radio', { name: /Auto mode/ }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Auto mode/ })).toBeChecked());
    expect(post).toHaveBeenCalledWith('/api/settings', { policy: 'auto' });
    expect(store.getState().meta?.settings?.policy).toBe('auto');
    expect(railValue('Permissions')).toBe('Auto mode');
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
    expect(railValue('Permissions')).toBe('Ask about everything');
  });
});

describe('Settings: look', () => {
  it('offers every theme, each described on hover and the chosen one under the grid; a pick applies at once, is remembered, and shows in the rail', async () => {
    document.documentElement.setAttribute('data-theme', 'default');
    setup([{ rules: [], active: true, unreadable: null }], undefined, 'look');
    const picker = screen.getByRole('group', { name: 'How the Workshop looks' });
    const radios = within(picker).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['default', 'neon-arcade', 'blueprint', 'pixel-crew', 'candy-pop', 'glass', 'sunset-paper', 'light', 'light-glass']);
    expect(within(picker).getByRole('radio', { name: /^Default/ })).toBeChecked();
    expect(within(picker).getByRole('radio', { name: /Neon arcade/ }).closest('label')).toHaveAttribute('title', expect.stringMatching(/Ink-navy night/));
    fireEvent.click(within(picker).getByRole('radio', { name: /Candy pop/ }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('candy-pop');
    expect(screen.getByTestId('theme-chosen-line')).toHaveTextContent(/^Chosen: Candy pop — /);
    expect(localStorage.getItem('workshop.theme')).toBe('candy-pop');
    expect(within(picker).getByRole('radio', { name: /Candy pop/ })).toBeChecked();
    expect(screen.getByText(/changes only how things look/)).toBeInTheDocument();
    expect(railValue('Look')).toBe('Candy pop · M · One at a time · Four lanes · Play subtle');
    fireEvent.click(screen.getByRole('button', { name: 'XL' }));
    expect(railValue('Look')).toBe('Candy pop · XL · One at a time · Four lanes · Play subtle');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-text');
  });
});
