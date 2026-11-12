// The Auto switch on the New job form: it goes with the job as options.auto, at every level.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { LEVELS, snapshot } from '../../state/test-fixtures';
import { NewJobSheet } from './NewJobSheet';

function setup() {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Everyday.' }], levels: LEVELS }, jobs: [] }) });
  const get = vi.fn(async (path: string) => {
    if (path === '/api/repos') return { repos: [{ path: '/tmp/fw-test/sample-one', name: 'sample-one', lastUsed: null }] };
    throw new ApiError(404, 'Not found');
  });
  const post = vi.fn(async () => ({ slug: 'alpha' }));
  render(<WorkshopContext.Provider value={{ store, api: { get, post } as unknown as ApiClient }}><NewJobSheet onClose={vi.fn()} /></WorkshopContext.Provider>);
  return { post, dialog: screen.getByRole('dialog', { name: 'Start a new job' }) };
}
async function start(dialog: HTMLElement) {
  await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Repository' })).toHaveAttribute('data-value', '/tmp/fw-test/sample-one'));
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Start job' })); });
}
afterEach(() => { localStorage.clear(); window.location.hash = ''; });

describe('NewJobSheet: Auto', () => {
  it('the form sends auto', async () => {
    const { post, dialog } = setup();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /What should the crew build/ }), { target: { value: 'Add a Copy ID button' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Auto: run to PR #1/ }));
    await start(dialog);
    expect(post).toHaveBeenCalledWith('/api/jobs', expect.objectContaining({ options: expect.objectContaining({ auto: true }) }));
  });

  it('sends nothing about Auto when it is left off', async () => {
    const { post, dialog } = setup();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /What should the crew build/ }), { target: { value: 'Add a Copy ID button' } });
    await start(dialog);
    expect((post.mock.calls[0] as unknown[])[1]).not.toEqual(expect.objectContaining({ options: expect.objectContaining({ auto: true }) }));
  });

  it('sends auto at L3 too: the tick stays when the level goes up', async () => {
    const { post, dialog } = setup();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /What should the crew build/ }), { target: { value: 'Add a Copy ID button' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: /^L1/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Auto: run to PR #1/ }));
    fireEvent.click(within(dialog).getByRole('radio', { name: /^L3/ }));
    const box = within(dialog).getByRole('checkbox', { name: /Auto: run to PR #1/ });
    expect(box).toBeChecked();
    expect(box).toBeEnabled();
    expect(dialog).not.toHaveTextContent('Auto works up to L2');
    await start(dialog);
    const options = ((post.mock.calls[0] as unknown[])[1] as { options: Record<string, unknown> }).options;
    expect(options.level).toBe(3);
    expect(options.auto).toBe(true);
  });

  it('on the website it sends auto at L3 too', async () => {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [] }) });
    const onStart = vi.fn(async () => {});
    const api = { get: vi.fn(async () => { throw new ApiError(404, 'Not found'); }), post: vi.fn(), hosted: () => true } as unknown as ApiClient;
    const laptops = [{ id: 1, name: 'Olive’s Mac', online: true, repos: [{ name: 'sample-one', default: true }] }];
    render(<WorkshopContext.Provider value={{ store, api }}><NewJobSheet onClose={vi.fn()} hosted={{ laptops, onStart }} /></WorkshopContext.Provider>);
    const dialog = screen.getByRole('dialog', { name: 'Start a new job' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /What should the crew build/ }), { target: { value: 'Add a Copy ID button' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: /^L3/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Auto: run to PR #1/ }));
    expect(within(dialog).getByRole('checkbox', { name: /Auto: run to PR #1/ })).toBeChecked();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Start job' })); });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(((onStart.mock.calls[0] as unknown[])[0] as { options: unknown }).options).toEqual({ level: 3, auto: true });
  });
});
