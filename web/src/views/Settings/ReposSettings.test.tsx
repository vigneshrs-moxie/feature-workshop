import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { RegisteredRepo, RepoRegistry } from '../../api/types';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { snapshot } from '../../state/test-fixtures';
import { repoStatus, ReposSettings } from './ReposSettings';

const ORBIT: RegisteredRepo = {
  path: '/Users/me/Projects/moxie-portal', folder: 'moxie-portal', name: 'Orbit', github: 'Moxie-Pest-Control-Phoenix/moxie-portal',
  profileFile: '/Users/me/Projects/ground-control/dashboard/profiles/orbit.md', profileSource: 'registry',
  ok: true, errors: [], warnings: [], ports: '3001-3099', exists: true,
};
const BROKEN: RegisteredRepo = {
  path: '/Users/me/Projects/widgets', folder: 'widgets', name: 'widgets', github: null,
  profileFile: '/Users/me/Projects/widgets/ground-control.md', profileSource: 'repo',
  ok: false, errors: ['github must look like org/repo, like acme/widgets.', 'ports (under tryIt) must look like 3001-3099, two numbers from 1024 to 65535.'], warnings: [], ports: null, exists: true,
};
const list = (repos: RegisteredRepo[], extra: Partial<RepoRegistry> = {}): RepoRegistry => ({ repos, file: '/state/repos.json', unreadable: null, ...extra });

function setup({ get, post, del }: { get?: () => Promise<unknown>; post?: (path: string, body: unknown) => Promise<unknown>; del?: (path: string) => Promise<unknown> } = {}) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't' } }) });
  const api = {
    get: vi.fn(get ?? (async () => list([ORBIT, BROKEN]))),
    post: vi.fn(post ?? (async () => ({}))),
    del: vi.fn(del ?? (async () => list([]))),
  } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}><ReposSettings /></WorkshopContext.Provider>);
  return api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> };
}

const rowOf = (name: string) => screen.getByRole('button', { name: `Remove ${name} from the list` }).closest('li') as HTMLElement;

afterEach(() => { localStorage.clear(); });

describe('Settings → Repos', () => {
  it('lists each repository with its folder, GitHub, ports, where its profile comes from and its state in words', async () => {
    const api = setup();
    expect(screen.getByText('Loading the repositories…')).toBeInTheDocument();
    await screen.findByText('Orbit');
    expect(api.get).toHaveBeenCalledWith('/api/repos/registry');
    const orbit = rowOf('Orbit');
    expect(orbit).toHaveTextContent('Profile ready');
    expect(orbit).toHaveTextContent('/Users/me/Projects/moxie-portal');
    expect(orbit).toHaveTextContent('GitHub Moxie-Pest-Control-Phoenix/moxie-portal');
    expect(orbit).toHaveTextContent('Ports 3001-3099');
    expect(orbit).toHaveTextContent('Profile: a profile file Ground Control keeps for it');
    expect(orbit).toHaveTextContent('(moxie-portal)');
    const broken = rowOf('widgets');
    // The state is words, never a colour alone; each problem is its own line.
    expect(broken).toHaveTextContent('Its profile has 2 problems');
    expect(broken).toHaveTextContent('Profile: its own ground-control.md');
    const problems = within(broken).getByRole('list', { name: 'Problems in widgets’s profile' });
    expect(within(problems).getAllByRole('listitem').map((li) => li.textContent)).toEqual(BROKEN.errors);
    expect(repoStatus({ ...ORBIT, exists: false })).toBe('Folder not found');
    expect(repoStatus({ ...BROKEN, errors: ['one'] })).toBe('Its profile has 1 problem');
  });

  it('says so when there are none', async () => {
    setup({ get: async () => list([]) });
    expect(await screen.findByText('No repositories yet. Add one below.')).toBeInTheDocument();
  });

  it('a load error and an unreadable list file are said in plain words', async () => {
    setup({ get: async () => { throw new ApiError(503, 'This copy of Ground Control can’t read the repository list yet.'); } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the repositories: This copy of Ground Control can’t read the repository list yet.');
  });

  it('an unreadable list file is a warning', async () => {
    setup({ get: async () => list([], { unreadable: '/state/repos.json' }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('The list file /state/repos.json can’t be read');
  });

  it('Check reads a row’s profile again; Remove takes it off the list', async () => {
    const api = setup({ post: async () => ({ ok: true, errors: [], warnings: ['Ground Control doesn’t know “stacks”, so it is kept but not used.'], name: 'Orbit', ports: '3001-3099' }) });
    await screen.findByText('Orbit');
    fireEvent.click(screen.getByRole('button', { name: 'Check Orbit’s profile' }));
    expect(await within(rowOf('Orbit')).findByText(/The profile reads well/)).toHaveTextContent('The profile reads well: Orbit, Try it ports 3001-3099.');
    expect(api.post).toHaveBeenCalledWith('/api/repos/registry/check', { path: ORBIT.path });
    expect(within(rowOf('Orbit')).getByRole('list', { name: 'Notes about the profile' })).toHaveTextContent('so it is kept but not used');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Orbit from the list' }));
    await screen.findByText('No repositories yet. Add one below.');
    expect(api.del).toHaveBeenCalledWith(`/api/repos/registry?path=${encodeURIComponent(ORBIT.path)}`);
  });

  it('Add a repository: Check lists each problem on its own line; Add refuses with them, then adds', async () => {
    let refuse = true;
    const api = setup({
      get: async () => list([]),
      post: async (path: string, body: unknown) => {
        if (path === '/api/repos/registry/check') return { ok: false, errors: BROKEN.errors, warnings: [] };
        if (refuse) throw new ApiError(400, BROKEN.errors[0], { error: BROKEN.errors[0], errors: BROKEN.errors });
        const b = body as { path: string };
        return { ...list([{ ...ORBIT, path: b.path, name: 'Widgets', folder: 'widgets' }]), ok: true, repo: { ...ORBIT, name: 'Widgets' } };
      },
    });
    await screen.findByText('No repositories yet. Add one below.');
    const form = screen.getByRole('form', { name: 'Add a repository' });
    const add = within(form).getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    fireEvent.change(within(form).getByLabelText('The repository’s folder'), { target: { value: ' /Users/me/Projects/widgets ' } });
    fireEvent.change(within(form).getByLabelText(/Profile file/), { target: { value: '/Users/me/widgets.md' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Check the profile' }));
    const problems = await within(form).findByRole('list', { name: 'Problems in the profile' });
    expect(within(problems).getAllByRole('listitem')).toHaveLength(2);
    expect(within(form).getByText('The profile has 2 problems:')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/api/repos/registry/check', { path: '/Users/me/Projects/widgets', profileFile: '/Users/me/widgets.md' });

    fireEvent.click(add);
    const why = await within(form).findByRole('list', { name: 'Why it wasn’t added' });
    expect(within(why).getAllByRole('listitem').map((li) => li.textContent)).toEqual(BROKEN.errors);
    expect(within(form).getByText('It wasn’t added. 2 problems:')).toBeInTheDocument();

    refuse = false;
    fireEvent.click(add);
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('Added Widgets. New jobs in it follow its profile.'));
    expect(screen.getByRole('button', { name: 'Remove Widgets from the list' })).toBeInTheDocument();
    expect((within(form).getByLabelText('The repository’s folder') as HTMLInputElement).value).toBe('');
  });

});
