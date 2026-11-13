// New job's Branch row (Auto queue, Task 20): for a ticket, the form asks the laptop for a short name
// (POST /api/jobs/name), shows it after the branch's prefix, lets you ask again or type your own,
// and Start sends it as `name`. Invented repositories and tickets only; the network is faked.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { LEVELS, snapshot } from '../../state/test-fixtures';
import { NewJobSheet } from './NewJobSheet';

const MODELS = [{ id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Everyday.' }];
const REPOS = [{ path: '/tmp/fw-test/sample-one', name: 'sample-one', lastUsed: null }];
const TICKET = { key: 'ORBIT-471', title: 'Employee status filter', url: 'https://orbit.example.com/t/471' };
const RULE = 'Use short words joined by hyphens, like employee-status-filter (up to five words, 40 characters).';
const WAITING = 'named when the job starts';

type NameBody = { ticket: { key: string; title: string | null; url: string | null }; description: string; kind: string; repoPath: string; avoid?: string[] };
type NameAnswer = { name: string; by: 'model' | 'title'; slug: string; branch: string };
const byModel = (name: string, prefix = 'feature/orbit-471-'): NameAnswer => ({ name, by: 'model', slug: `orbit-471-${name}`, branch: `${prefix}${name}` });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function setup(answer: (body: NameBody) => Promise<unknown>) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', models: MODELS, levels: LEVELS }, jobs: [] }) });
  const get = vi.fn(async (path: string) => {
    if (path === '/api/repos') return { repos: REPOS };
    throw new ApiError(404, 'Not found');
  });
  const post = vi.fn(async (path: string, body?: unknown) => (path === '/api/jobs/name' ? answer(body as NameBody) : { slug: 'orbit-471-sample' }));
  const api = { get, post } as unknown as ApiClient;
  const wrap = (ui: ReactNode) => render(<WorkshopContext.Provider value={{ store, api }}>{ui}</WorkshopContext.Provider>);
  const nameCalls = () => post.mock.calls.filter((c) => c[0] === '/api/jobs/name').map((c) => c[1] as NameBody);
  const jobBody = () => post.mock.calls.find((c) => c[0] === '/api/jobs')?.[1] as Record<string, unknown> | undefined;
  return { post, wrap, nameCalls, jobBody };
}

afterEach(() => { localStorage.clear(); window.location.hash = ''; });

const sheet = () => screen.getByRole('dialog', { name: 'Start a new job' });
const branchField = (dialog: HTMLElement) => within(dialog).getByRole('textbox', { name: 'Branch' });
const startButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Start job' });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function startJob(dialog: HTMLElement) {
  await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Repository' })).toHaveAttribute('data-value', '/tmp/fw-test/sample-one'));
  await act(async () => { fireEvent.click(startButton(dialog)); });
}

describe('NewJobSheet: the Branch row', () => {
  it('a ticket’s form shows the suggested branch name', async () => {
    const { wrap, nameCalls, jobBody } = setup(async (body) => (body.kind === 'bug' ? byModel('status-filter-crash', 'fix/orbit-471-') : byModel('employee-status-filter')));
    const view = wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    const field = branchField(dialog);
    await waitFor(() => expect(field).toHaveValue('employee-status-filter'));
    expect(within(dialog).getByText('feature/orbit-471-')).toBeInTheDocument();
    expect(nameCalls()).toEqual([{ ticket: TICKET, description: 'ORBIT-471: Employee status filter', kind: 'feature', repoPath: '/tmp/fw-test/sample-one' }]);
    // A bug fix: asked again with its kind; its branch starts fix/.
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Bug fix' }));
    await waitFor(() => expect(field).toHaveValue('status-filter-crash'));
    expect(nameCalls()[1]).toMatchObject({ kind: 'bug' });
    expect(within(dialog).getByText('fix/orbit-471-')).toBeInTheDocument();
    expect(within(dialog).queryByText('feature/orbit-471-')).toBeNull();
    await startJob(dialog);
    expect(jobBody()).toMatchObject({ name: 'status-filter-crash', kind: 'bug' });
    view.unmount();

    // A job with that name already exists, so the branch ends in -2: the whole branch, as plain text.
    const again = setup(async () => ({ name: 'employee-status-filter', by: 'model', slug: 'orbit-471-employee-status-filter-2', branch: 'feature/orbit-471-employee-status-filter-2' }));
    again.wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const second = sheet();
    await waitFor(() => expect(branchField(second)).toHaveValue('employee-status-filter'));
    expect(within(second).getByText('feature/orbit-471-employee-status-filter-2')).toBeInTheDocument();
    expect(within(second).queryByText('feature/orbit-471-')).toBeNull();
  });

  it('Suggest again asks with the names shown so far and takes the new one', async () => {
    const names = ['employee-status-filter', 'status-filter', 'active-employee-filter', 'filter-by-status', 'staff-status-filter', 'employee-filter', 'status-dropdown'];
    let n = 0;
    let hold: ReturnType<typeof deferred<void>> | null = null;
    let fail = false;
    const { wrap, nameCalls, jobBody } = setup(async () => {
      if (hold) await hold.promise;
      if (fail) throw new ApiError(400, 'Something went wrong on the laptop.');
      return byModel(names[n++]);
    });
    wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    const field = branchField(dialog);
    const again = within(dialog).getByRole('button', { name: 'Suggest again' });
    await waitFor(() => expect(field).toHaveValue('employee-status-filter'));
    expect(nameCalls()[0]).not.toHaveProperty('avoid');

    fireEvent.click(again);
    await waitFor(() => expect(field).toHaveValue('status-filter'));
    expect(nameCalls()[1].avoid).toEqual(['employee-status-filter']);

    // While it asks, the button rests; Start does not.
    hold = deferred<void>();
    const held = hold;
    fireEvent.click(again);
    await waitFor(() => expect(again).toBeDisabled());
    expect(startButton(dialog)).toBeEnabled();
    hold = null;
    await act(async () => { held.resolve(); });
    await waitFor(() => expect(field).toHaveValue('active-employee-filter'));
    expect(again).toBeEnabled();
    expect(nameCalls()[2].avoid).toEqual(['employee-status-filter', 'status-filter']);

    // At most five names go back: the latest ones.
    for (const next of names.slice(3)) {
      fireEvent.click(again);
      await waitFor(() => expect(field).toHaveValue(next));
    }
    expect(nameCalls()[6].avoid).toEqual(names.slice(1, 6));

    // A failed ask changes nothing.
    fail = true;
    fireEvent.click(again);
    await waitFor(() => expect(nameCalls()).toHaveLength(8));
    await settle();
    expect(field).toHaveValue('status-dropdown');
    expect(within(dialog).getByText('feature/orbit-471-')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    await startJob(dialog);
    expect(jobBody()).toMatchObject({ name: 'status-dropdown' });
  });

  it('his own name is never overwritten, and Start sends it', async () => {
    const first = deferred<NameAnswer>();
    let n = 0;
    const { wrap, nameCalls, jobBody } = setup(() => (n++ === 0 ? first.promise : Promise.resolve(byModel('status-filter-crash', 'fix/orbit-471-'))));
    wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    const field = branchField(dialog);
    await waitFor(() => expect(nameCalls()).toHaveLength(1));
    fireEvent.change(field, { target: { value: 'My-Own-Name' } });
    await act(async () => { first.resolve(byModel('employee-status-filter')); });
    expect(field).toHaveValue('My-Own-Name');
    // A later answer (the kind changed) moves the prefix but leaves his name.
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Bug fix' }));
    await waitFor(() => expect(within(dialog).getByText('fix/orbit-471-')).toBeInTheDocument());
    expect(nameCalls()).toHaveLength(2);
    expect(field).toHaveValue('My-Own-Name');
    await startJob(dialog);
    expect(jobBody()).toMatchObject({ name: 'my-own-name' });
  });

  it('a name that breaks the rule shows the sentence and switches Start off', async () => {
    const { wrap, jobBody } = setup(async () => byModel('employee-status-filter'));
    wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    const field = branchField(dialog);
    await waitFor(() => expect(field).toHaveValue('employee-status-filter'));
    expect(within(dialog).queryByText(RULE)).toBeNull();
    for (const bad of ['Not a good name!', 'one-two-three-four-five-six', 'a'.repeat(41), 'trailing-', 'two--hyphens']) {
      fireEvent.change(field, { target: { value: bad } });
      expect(within(dialog).getByText(RULE)).toBeInTheDocument();
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(startButton(dialog)).toBeDisabled();
    }
    // ⌘+Enter in the description does not get round it.
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Repository' })).toHaveAttribute('data-value', '/tmp/fw-test/sample-one'));
    await act(async () => { fireEvent.keyDown(within(dialog).getByRole('textbox', { name: /What should the crew build/ }), { key: 'Enter', metaKey: true }); });
    expect(jobBody()).toBeUndefined();
    for (const good of [' Five-Words-Are-Fine-Here ', 'a'.repeat(40)]) {
      fireEvent.change(field, { target: { value: good } });
      expect(within(dialog).queryByText(RULE)).toBeNull();
      expect(field).not.toHaveAttribute('aria-invalid', 'true');
      expect(startButton(dialog)).toBeEnabled();
    }
    // An empty field never blocks Start, and sends no name.
    fireEvent.change(field, { target: { value: '' } });
    expect(within(dialog).queryByText(RULE)).toBeNull();
    expect(startButton(dialog)).toBeEnabled();
    await startJob(dialog);
    expect(jobBody()).toBeDefined();
    expect(jobBody()).not.toHaveProperty('name');
  });

  it('Start does not wait for a suggestion: with none yet it sends no name', async () => {
    const { wrap, nameCalls, jobBody } = setup(() => new Promise(() => {}));
    wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    const field = branchField(dialog);
    await waitFor(() => expect(nameCalls()).toHaveLength(1));
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('placeholder', WAITING);
    expect(startButton(dialog)).toBeEnabled();
    await startJob(dialog);
    expect(jobBody()).toBeDefined();
    expect(jobBody()).not.toHaveProperty('name');
  });

  it('a by-title answer shows the short title as a placeholder, a failed request keeps the form as it was, and neither sends a name', async () => {
    const long = 'can-we-have-a-filter-here-for-active';
    const titled = setup(async () => ({ name: long, by: 'title', slug: `orbit-471-${long}`, branch: `feature/orbit-471-${long}` }));
    const one = titled.wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    let dialog = sheet();
    await waitFor(() => expect(branchField(dialog)).toHaveAttribute('placeholder', long));
    expect(branchField(dialog)).toHaveValue('');
    expect(within(dialog).queryByText('feature/orbit-471-')).toBeNull();
    expect(within(dialog).queryByText(RULE)).toBeNull();
    await startJob(dialog);
    expect(titled.jobBody()).toBeDefined();
    expect(titled.jobBody()).not.toHaveProperty('name');
    one.unmount();

    // A ticket with no title: the short title is empty, so the placeholder says when it is named.
    const empty = setup(async () => ({ name: '', by: 'title', slug: 'orbit-471', branch: 'feature/orbit-471' }));
    const two = empty.wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    dialog = sheet();
    await waitFor(() => expect(empty.nameCalls()).toHaveLength(1));
    await settle();
    expect(branchField(dialog)).toHaveAttribute('placeholder', WAITING);
    two.unmount();

    const failed = setup(async () => { throw new ApiError(400, 'Ticket: the key is missing.'); });
    failed.wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    dialog = sheet();
    await waitFor(() => expect(failed.nameCalls()).toHaveLength(1));
    await settle();
    expect(branchField(dialog)).toHaveValue('');
    expect(branchField(dialog)).toHaveAttribute('placeholder', WAITING);
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Suggest again' })).toBeEnabled();
    await startJob(dialog);
    expect(failed.jobBody()).toBeDefined();
    expect(failed.jobBody()).not.toHaveProperty('name');
  });

  it('a form with no ticket has no Branch row', async () => {
    const { wrap, nameCalls, jobBody } = setup(async () => byModel('comment-save'));
    wrap(<NewJobSheet onClose={vi.fn()} />);
    const dialog = sheet();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /What should the crew build/ }), { target: { value: 'Fix the comment save' } });
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Repository' })).toHaveAttribute('data-value', '/tmp/fw-test/sample-one'));
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(within(dialog).queryByRole('textbox', { name: 'Branch' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Suggest again' })).toBeNull();
    expect(nameCalls()).toHaveLength(0);
    // A key typed in gives it one; taking it out again takes the row away.
    const ticket = within(dialog).getByRole('textbox', { name: 'Orbit ticket (optional)' });
    fireEvent.change(ticket, { target: { value: 'orbit-124' } });
    await waitFor(() => expect(branchField(dialog)).toHaveValue('comment-save'));
    expect(nameCalls()[0]).toMatchObject({ ticket: { key: 'ORBIT-124', title: 'Fix the comment save', url: null } });
    fireEvent.change(ticket, { target: { value: '' } });
    expect(within(dialog).queryByRole('textbox', { name: 'Branch' })).toBeNull();
    await startJob(dialog);
    expect(jobBody()).toBeDefined();
    expect(jobBody()).not.toHaveProperty('name');
  });

  it('on the website the row says the branch is named when the job starts, with no field', async () => {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [] }) });
    const onStart = vi.fn(async () => {});
    const post = vi.fn();
    const api = { get: vi.fn(async () => { throw new ApiError(404, 'Not found'); }), post, hosted: () => true } as unknown as ApiClient;
    const laptops = [{ id: 1, name: 'Olive’s Mac', online: true, repos: [{ name: 'sample-one', default: true }] }];
    render(<WorkshopContext.Provider value={{ store, api }}><NewJobSheet onClose={vi.fn()} ticket={TICKET} hosted={{ laptops, onStart }} /></WorkshopContext.Provider>);
    const dialog = sheet();
    expect(within(dialog).getByText('Branch · named when the job starts')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'Branch' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Suggest again' })).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(post).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(startButton(dialog)); });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect((onStart.mock.calls[0] as unknown[])[0]).not.toHaveProperty('name');
  });
});
