// New job's Branch row (Auto queue, Task 20): for a ticket, the form asks the laptop for a short name
// (POST /api/jobs/name), shows it after the branch's prefix, lets you ask again or type your own,
// and Start sends it as `name`. Invented repositories and tickets only; the network is faked.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { LEVELS, snapshot } from '../../state/test-fixtures';
import { BRANCH_RULE, NewJobSheet } from './NewJobSheet';

const MODELS = [{ id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Everyday.' }];
const REPOS = [{ path: '/tmp/fw-test/sample-one', name: 'sample-one', lastUsed: null }];
const TICKET = { key: 'ORBIT-471', title: 'Employee status filter', url: 'https://orbit.example.com/t/471' };
const RULE = BRANCH_RULE;
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
// Real time in short steps, so the form's own timers and the renders they cause run in between.
async function pause(ms: number) {
  for (let t = 0; t < ms; t += 100) await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
}

async function startJob(dialog: HTMLElement) {
  await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Repository' })).toHaveAttribute('data-value', '/tmp/fw-test/sample-one'));
  await act(async () => { fireEvent.click(startButton(dialog)); });
}

describe('NewJobSheet: the Branch row', () => {
  it('a ticket’s form shows the suggested branch name', async () => {
    const { wrap, nameCalls, jobBody } = setup(async () => byModel('employee-status-filter'));
    const view = wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    const field = branchField(dialog);
    await waitFor(() => expect(field).toHaveValue('employee-status-filter'));
    expect(within(dialog).getByText('feature/orbit-471-')).toBeInTheDocument();
    expect(nameCalls()).toEqual([{ ticket: TICKET, description: 'ORBIT-471: Employee status filter', kind: 'feature', repoPath: '/tmp/fw-test/sample-one' }]);
    await startJob(dialog);
    expect(jobBody()).toMatchObject({ name: 'employee-status-filter', kind: 'feature' });
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
    await waitFor(() => expect(again).toHaveAttribute('aria-disabled', 'true'));
    expect(startButton(dialog)).toBeEnabled();
    hold = null;
    await act(async () => { held.resolve(); });
    await waitFor(() => expect(field).toHaveValue('active-employee-filter'));
    expect(again).not.toHaveAttribute('aria-disabled', 'true');
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
    // The brief's exact words.
    expect(BRANCH_RULE).toBe('Use short words joined by hyphens, like employee-status-filter (up to five words, 40 characters).');
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
    // Its branch ends with the short title, so its prefix is good (fix round 1, V1).
    expect(within(dialog).getByText('feature/orbit-471-')).toBeInTheDocument();
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
    expect(within(dialog).getByRole('button', { name: 'Suggest again' })).not.toHaveAttribute('aria-disabled', 'true');
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

  // Fix round 1: nothing in the row moves, and a name changes only by his hand or into an empty field.
  it('an answer for an earlier kind that arrives late does not win', async () => {
    const feature = deferred<NameAnswer>();
    const { wrap, nameCalls, jobBody } = setup((body) => (body.kind === 'bug'
      ? Promise.resolve({ name: 'short-title', by: 'title', slug: 'orbit-471-short-title', branch: 'fix/orbit-471-short-title' })
      : feature.promise));
    wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    const field = branchField(dialog);
    await waitFor(() => expect(nameCalls()).toHaveLength(1));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Bug fix' }));
    await waitFor(() => expect(within(dialog).getByText('fix/orbit-471-')).toBeInTheDocument());
    expect(field).toHaveValue('');
    // The feature ask answers last: it is dropped, so neither its name nor its prefix lands.
    await act(async () => { feature.resolve(byModel('feature-name')); });
    await settle();
    expect(field).toHaveValue('');
    expect(within(dialog).getByText('fix/orbit-471-')).toBeInTheDocument();
    expect(within(dialog).queryByText('feature/orbit-471-')).toBeNull();
    await startJob(dialog);
    expect(jobBody()).toMatchObject({ kind: 'bug' });
    expect(jobBody()).not.toHaveProperty('name');
  });

  it('changing the ticket key drops the model’s name, and Start does not send it', async () => {
    const late = deferred<NameAnswer>();
    const { wrap, nameCalls, jobBody } = setup((body) => {
      if (body.ticket.key === 'ORBIT-124') return Promise.resolve(byModel('comment-save', 'feature/orbit-124-'));
      if (body.ticket.key === 'ORBIT-126') return late.promise;
      return new Promise(() => {});
    });
    wrap(<NewJobSheet onClose={vi.fn()} />);
    const dialog = sheet();
    const desc = within(dialog).getByRole('textbox', { name: /What should the crew build/ });
    fireEvent.change(desc, { target: { value: 'Fix the comment save' } });
    fireEvent.blur(desc);
    const ticket = within(dialog).getByRole('textbox', { name: 'Orbit ticket (optional)' });
    fireEvent.change(ticket, { target: { value: 'orbit-124' } });
    await waitFor(() => expect(branchField(dialog)).toHaveValue('comment-save'));
    expect(within(dialog).getByText('feature/orbit-124-')).toBeInTheDocument();
    // Another key: the last ticket's name and prefix go; its ask never answers.
    fireEvent.change(ticket, { target: { value: 'orbit-125' } });
    expect(branchField(dialog)).toHaveValue('');
    expect(within(dialog).queryByText('feature/orbit-124-')).toBeNull();
    await waitFor(() => expect(nameCalls()).toHaveLength(2));
    // And an answer for a key he has since left never lands.
    fireEvent.change(ticket, { target: { value: 'orbit-126' } });
    await waitFor(() => expect(nameCalls()).toHaveLength(3));
    fireEvent.change(ticket, { target: { value: 'orbit-127' } });
    await act(async () => { late.resolve(byModel('stale-name', 'feature/orbit-126-')); });
    await settle();
    expect(branchField(dialog)).toHaveValue('');
    expect(within(dialog).queryByText('feature/orbit-126-')).toBeNull();
    await startJob(dialog);
    expect(jobBody()).toMatchObject({ ticket: { key: 'ORBIT-127' } });
    expect(jobBody()).not.toHaveProperty('name');
  });

  it('the prefix sits inside the field’s box and stays through a kind switch until the new answer comes', async () => {
    const bug = deferred<NameAnswer>();
    const { wrap } = setup((body) => (body.kind === 'bug' ? bug.promise : Promise.resolve(byModel('employee-status-filter'))));
    wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    const field = branchField(dialog);
    const box = field.closest('.branch-box');
    expect(box).not.toBeNull();
    await waitFor(() => expect(within(box as HTMLElement).getByText('feature/orbit-471-')).toBeInTheDocument());
    expect(field.closest('.branch-box')).toBe(box);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Bug fix' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(within(box as HTMLElement).getByText('feature/orbit-471-')).toBeInTheDocument();
    await act(async () => { bug.resolve(byModel('status-filter-crash', 'fix/orbit-471-')); });
    await waitFor(() => expect(within(box as HTMLElement).getByText('fix/orbit-471-')).toBeInTheDocument());
    expect(field.closest('.branch-box')).toBe(box);
  });

  it('a kind switch updates the prefix and keeps the name', async () => {
    const { wrap, nameCalls, jobBody } = setup(async (body) => (body.kind === 'bug' ? byModel('status-filter-crash', 'fix/orbit-471-') : byModel('employee-status-filter')));
    wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    const field = branchField(dialog);
    await waitFor(() => expect(field).toHaveValue('employee-status-filter'));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Bug fix' }));
    await waitFor(() => expect(within(dialog).getByText('fix/orbit-471-')).toBeInTheDocument());
    expect(nameCalls()[1]).toMatchObject({ kind: 'bug' });
    expect(field).toHaveValue('employee-status-filter');
    await startJob(dialog);
    expect(jobBody()).toMatchObject({ name: 'employee-status-filter', kind: 'bug' });
  });

  it('editing the description after the first answer asks nothing and changes nothing', async () => {
    let n = 0;
    const { wrap, nameCalls } = setup(async () => byModel(n++ === 0 ? 'comment-save' : 'another-name', 'feature/orbit-124-'));
    wrap(<NewJobSheet onClose={vi.fn()} />);
    const dialog = sheet();
    const desc = within(dialog).getByRole('textbox', { name: /What should the crew build/ });
    fireEvent.change(desc, { target: { value: 'Fix the comment save' } });
    fireEvent.blur(desc);
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Orbit ticket (optional)' }), { target: { value: 'orbit-124' } });
    await waitFor(() => expect(branchField(dialog)).toHaveValue('comment-save'));
    fireEvent.change(desc, { target: { value: 'Fix the comment save on the ticket page' } });
    fireEvent.blur(desc);
    await pause(600);
    fireEvent.change(desc, { target: { value: 'Fix the comment save on the ticket page, again' } });
    await pause(2200);
    expect(nameCalls()).toHaveLength(1);
    expect(branchField(dialog)).toHaveValue('comment-save');
  });

  it('Suggest again pressed during the wait wins over the automatic ask', async () => {
    // Pressed before the automatic ask goes out: that ask never goes.
    let k = 0;
    const first = setup(async () => byModel(k++ === 0 ? 'hand-name' : 'auto-name'));
    const one = first.wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    let dialog = sheet();
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Repository' })).toHaveAttribute('data-value', '/tmp/fw-test/sample-one'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suggest again' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(first.nameCalls()).toHaveLength(1);
    expect(branchField(dialog)).toHaveValue('hand-name');
    one.unmount();

    // Pressed while the automatic ask is out: the automatic answer is dropped, the pressed one lands.
    const auto = deferred<NameAnswer>();
    const hand = deferred<NameAnswer>();
    let i = 0;
    const second = setup(() => (i++ === 0 ? auto.promise : hand.promise));
    second.wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    dialog = sheet();
    await waitFor(() => expect(second.nameCalls()).toHaveLength(1));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suggest again' }));
    expect(second.nameCalls()).toHaveLength(2);
    await act(async () => { auto.resolve(byModel('auto-name')); });
    await settle();
    expect(branchField(dialog)).toHaveValue('');
    await act(async () => { hand.resolve(byModel('hand-name')); });
    await waitFor(() => expect(branchField(dialog)).toHaveValue('hand-name'));
  });

  it('Suggest again keeps keyboard focus while it runs', async () => {
    const held = deferred<NameAnswer>();
    let n = 0;
    const { wrap, nameCalls } = setup(() => (n++ === 0 ? Promise.resolve(byModel('employee-status-filter')) : held.promise));
    wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    await waitFor(() => expect(branchField(dialog)).toHaveValue('employee-status-filter'));
    const again = within(dialog).getByRole('button', { name: 'Suggest again' });
    again.focus();
    fireEvent.click(again);
    await waitFor(() => expect(again).toHaveAttribute('aria-disabled', 'true'));
    expect(again).not.toBeDisabled();
    expect(again).toHaveFocus();
    // A press while it runs does nothing.
    fireEvent.click(again);
    expect(nameCalls()).toHaveLength(2);
    await act(async () => { held.resolve(byModel('status-filter')); });
    await waitFor(() => expect(branchField(dialog)).toHaveValue('status-filter'));
    expect(again).not.toHaveAttribute('aria-disabled', 'true');
    expect(again).toHaveFocus();
  });

  // Fix round 2: a typed key waits for its description; the shown branch is never wrong.
  it('a typed key with no description yet asks nothing; the first settled description asks once', async () => {
    const { wrap, nameCalls } = setup(async () => byModel('comment-save', 'feature/orbit-124-'));
    wrap(<NewJobSheet onClose={vi.fn()} />);
    const dialog = sheet();
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Repository' })).toHaveAttribute('data-value', '/tmp/fw-test/sample-one'));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Orbit ticket (optional)' }), { target: { value: 'orbit-124' } });
    await pause(2000);
    expect(nameCalls()).toHaveLength(0);
    expect(branchField(dialog)).toHaveValue('');
    expect(branchField(dialog)).toHaveAttribute('placeholder', WAITING);
    const desc = within(dialog).getByRole('textbox', { name: /What should the crew build/ });
    fireEvent.change(desc, { target: { value: 'Fix the comment save' } });
    fireEvent.blur(desc);
    await waitFor(() => expect(branchField(dialog)).toHaveValue('comment-save'));
    await pause(600);
    expect(nameCalls()).toEqual([{ ticket: { key: 'ORBIT-124', title: 'Fix the comment save', url: null }, description: 'Fix the comment save', kind: 'feature', repoPath: '/tmp/fw-test/sample-one' }]);
  });

  it('Suggest again’s ask is not overtaken by the automatic ask its press lets go', async () => {
    const hand = deferred<NameAnswer>();
    const { wrap, nameCalls } = setup(() => hand.promise);
    wrap(<NewJobSheet onClose={vi.fn()} />);
    const dialog = sheet();
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Repository' })).toHaveAttribute('data-value', '/tmp/fw-test/sample-one'));
    // The description is still being written, so the form has not asked by itself yet.
    fireEvent.change(within(dialog).getByRole('textbox', { name: /What should the crew build/ }), { target: { value: 'Fix the comment save' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Orbit ticket (optional)' }), { target: { value: 'orbit-124' } });
    await pause(400);
    expect(nameCalls()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suggest again' }));
    await pause(600);
    expect(nameCalls()).toHaveLength(1);
    await act(async () => { hand.resolve(byModel('hand-name', 'feature/orbit-124-')); });
    await waitFor(() => expect(branchField(dialog)).toHaveValue('hand-name'));
  });

  it('a kind switch whose ask fails takes the old prefix away', async () => {
    const bug = deferred<NameAnswer>();
    const one = setup((body) => (body.kind === 'bug' ? bug.promise : Promise.resolve(byModel('employee-status-filter'))));
    const view = one.wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    let dialog = sheet();
    await waitFor(() => expect(branchField(dialog)).toHaveValue('employee-status-filter'));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Bug fix' }));
    await waitFor(() => expect(one.nameCalls()).toHaveLength(2));
    // While the bug ask is out, the old prefix stays.
    expect(within(dialog).getByText('feature/orbit-471-')).toBeInTheDocument();
    await act(async () => { bug.reject(new ApiError(400, 'Something went wrong on the laptop.')); });
    await settle();
    expect(within(dialog).queryByText('feature/orbit-471-')).toBeNull();
    expect(branchField(dialog)).toHaveValue('employee-status-filter');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    view.unmount();

    // An answer with no usable prefix (no name) takes it away too.
    const two = setup(async (body) => (body.kind === 'bug' ? { name: '', by: 'title', slug: 'orbit-471', branch: 'fix/orbit-471' } : byModel('employee-status-filter')));
    two.wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    dialog = sheet();
    await waitFor(() => expect(branchField(dialog)).toHaveValue('employee-status-filter'));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Bug fix' }));
    await waitFor(() => expect(two.nameCalls()).toHaveLength(2));
    await settle();
    expect(within(dialog).queryByText('feature/orbit-471-')).toBeNull();
    expect(within(dialog).queryByText(/^fix\//)).toBeNull();
    expect(branchField(dialog)).toHaveValue('employee-status-filter');
  });

  it('a kind switch keeps the -2 line right', async () => {
    const bug = deferred<NameAnswer>();
    let failFeature = false;
    const { wrap, nameCalls } = setup((body) => {
      if (body.kind === 'bug') return bug.promise;
      if (failFeature) return Promise.reject(new ApiError(400, 'Something went wrong on the laptop.'));
      return Promise.resolve({ name: 'employee-status-filter', by: 'model', slug: 'orbit-471-employee-status-filter-2', branch: 'feature/orbit-471-employee-status-filter-2' });
    });
    wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    await waitFor(() => expect(within(dialog).getByText('feature/orbit-471-employee-status-filter-2')).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Bug fix' }));
    await waitFor(() => expect(nameCalls()).toHaveLength(2));
    expect(within(dialog).getByText('feature/orbit-471-employee-status-filter-2')).toBeInTheDocument();
    // The bug answer names another job, but the field keeps its name, which still takes "-2".
    await act(async () => { bug.resolve(byModel('status-filter-crash', 'fix/orbit-471-')); });
    await waitFor(() => expect(within(dialog).getByText('fix/orbit-471-employee-status-filter-2')).toBeInTheDocument());
    expect(branchField(dialog)).toHaveValue('employee-status-filter');
    expect(within(dialog).queryByText('feature/orbit-471-employee-status-filter-2')).toBeNull();
    expect(within(dialog).queryByText('fix/orbit-471-')).toBeNull();
    // Back to Feature, and that ask fails: no branch is shown rather than a wrong one.
    failFeature = true;
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Feature' }));
    await waitFor(() => expect(nameCalls()).toHaveLength(3));
    await settle();
    expect(within(dialog).queryByText(/employee-status-filter-2$/)).toBeNull();
    expect(within(dialog).queryByText(/orbit-471-$/)).toBeNull();
    expect(branchField(dialog)).toHaveValue('employee-status-filter');
  });

  it('typing a hyphen between words shows no sentence; leaving the field with one at the end does', async () => {
    const { wrap } = setup(async () => byModel('employee-status-filter'));
    wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    const field = branchField(dialog);
    await waitFor(() => expect(field).toHaveValue('employee-status-filter'));
    fireEvent.focus(field);
    for (const typing of ['status', 'status-', 'status-f', 'status-filter-']) {
      fireEvent.change(field, { target: { value: typing } });
      expect(within(dialog).queryByText(RULE)).toBeNull();
      expect(field).not.toHaveAttribute('aria-invalid', 'true');
      // Start stays off until the name is whole.
      if (typing.endsWith('-')) expect(startButton(dialog)).toBeDisabled();
      else expect(startButton(dialog)).toBeEnabled();
    }
    fireEvent.blur(field);
    expect(within(dialog).getByText(RULE)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    // Back in the field: Enter (trying Start) shows it too.
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'status-filter-x' } });
    expect(within(dialog).queryByText(RULE)).toBeNull();
    fireEvent.change(field, { target: { value: 'status-' } });
    expect(within(dialog).queryByText(RULE)).toBeNull();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(within(dialog).getByText(RULE)).toBeInTheDocument();
    // Anything else that breaks the rule shows at once, even in the field.
    fireEvent.change(field, { target: { value: 'status--' } });
    expect(within(dialog).getByText(RULE)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'Status filter' } });
    expect(within(dialog).getByText(RULE)).toBeInTheDocument();
  });

  it('Start pressed inside the wait sends no name ask', async () => {
    const { wrap, nameCalls, jobBody } = setup(async () => byModel('employee-status-filter'));
    wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    await startJob(dialog);
    expect(jobBody()).toBeDefined();
    expect(jobBody()).not.toHaveProperty('name');
    await pause(600);
    expect(nameCalls()).toHaveLength(0);
  });

  it('the name field itself has the field look, so each theme’s focus, error and disabled looks reach it', async () => {
    const { wrap } = setup(async () => byModel('employee-status-filter'));
    wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    const field = branchField(dialog);
    expect(field).toHaveClass('text-input');
    await waitFor(() => expect(within(dialog).getByText('feature/orbit-471-')).toBeInTheDocument());
    expect(field.closest('.branch-box')?.querySelectorAll('.text-input')).toHaveLength(1);
  });

  // Follow-up after re-review 2 (m6).
  it('a new ticket key forgets the last ticket’s "-2" endings', async () => {
    const { wrap, nameCalls } = setup(async (body) => (body.ticket.key === 'ORBIT-124'
      ? { name: 'comment-save', by: 'model', slug: 'orbit-124-comment-save-2', branch: 'feature/orbit-124-comment-save-2' }
      : byModel('other-name', 'feature/orbit-125-')));
    wrap(<NewJobSheet onClose={vi.fn()} />);
    const dialog = sheet();
    const desc = within(dialog).getByRole('textbox', { name: /What should the crew build/ });
    fireEvent.change(desc, { target: { value: 'Fix the comment save' } });
    fireEvent.blur(desc);
    const ticket = within(dialog).getByRole('textbox', { name: 'Orbit ticket (optional)' });
    fireEvent.change(ticket, { target: { value: 'orbit-124' } });
    await waitFor(() => expect(within(dialog).getByText('feature/orbit-124-comment-save-2')).toBeInTheDocument());
    // He keeps the name as his own, then moves to another ticket: its answer names another job.
    fireEvent.change(branchField(dialog), { target: { value: 'comment-sav' } });
    fireEvent.change(branchField(dialog), { target: { value: 'comment-save' } });
    fireEvent.change(ticket, { target: { value: 'orbit-125' } });
    await waitFor(() => expect(nameCalls()).toHaveLength(2));
    await waitFor(() => expect(within(dialog).getByText('feature/orbit-125-')).toBeInTheDocument());
    expect(branchField(dialog)).toHaveValue('comment-save');
    expect(within(dialog).queryByText('feature/orbit-125-comment-save-2')).toBeNull();
  });

  it('a Start tried from the keyboard with a hyphen at the end keeps the sentence up in the field', async () => {
    const { wrap, jobBody } = setup(async () => byModel('employee-status-filter'));
    wrap(<NewJobSheet onClose={vi.fn()} ticket={TICKET} />);
    const dialog = sheet();
    const field = branchField(dialog);
    await waitFor(() => expect(field).toHaveValue('employee-status-filter'));
    fireEvent.change(field, { target: { value: 'status-' } });
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Repository' })).toHaveAttribute('data-value', '/tmp/fw-test/sample-one'));
    await act(async () => { fireEvent.keyDown(within(dialog).getByRole('textbox', { name: /What should the crew build/ }), { key: 'Enter', metaKey: true }); });
    expect(jobBody()).toBeUndefined();
    // Back in the field without typing: the sentence stays, as Start was tried.
    fireEvent.focus(field);
    expect(within(dialog).getByText(RULE)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });
});
