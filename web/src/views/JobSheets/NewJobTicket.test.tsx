// New job's Orbit ticket field (packet B, plan D1): filled in and read-only when started from the
// Inbox, optional and checked when typed. Invented repositories and tickets only.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { LEVELS, snapshot } from '../../state/test-fixtures';
import { NewJobSheet, TICKET_KEY_PROBLEM, ticketFromDescription, ticketKeyOf } from './NewJobSheet';

const MODELS = [{ id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Everyday.' }];
const REPOS = [{ path: '/tmp/fw-test/sample-one', name: 'sample-one', lastUsed: null }];

function setup() {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', models: MODELS, levels: LEVELS }, jobs: [] }) });
  const get = vi.fn(async (path: string) => {
    if (path === '/api/repos') return { repos: REPOS };
    throw new ApiError(404, 'Not found');
  });
  const post = vi.fn(async () => ({ slug: 'orbit-479-feedback-api' }));
  const api = { get, post } as unknown as ApiClient;
  const wrap = (ui: ReactNode) => render(<WorkshopContext.Provider value={{ store, api }}>{ui}</WorkshopContext.Provider>);
  return { post, wrap };
}

afterEach(() => { localStorage.clear(); window.location.hash = ''; });

async function startJob(dialog: HTMLElement) {
  await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Repository' })).toHaveValue('/tmp/fw-test/sample-one'));
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Start job' })); });
}

describe('NewJobSheet: the Orbit ticket', () => {
  it('reads a key in any lenient form, and the Inbox’s description', () => {
    expect(ticketKeyOf(' orbit-479 ')).toBe('ORBIT-479');
    expect(ticketKeyOf('#12')).toBe('ORBIT-12');
    expect(ticketKeyOf('ORBIT-0')).toBeNull();
    expect(ticketKeyOf('ticket 4')).toBeNull();
    expect(ticketFromDescription('ORBIT-479: Feedback API')).toEqual({ key: 'ORBIT-479', title: 'Feedback API', url: null });
    expect(ticketFromDescription('Add a button')).toBeNull();
  });

  it('started from the Inbox: the key is filled in and read-only, and goes with the job with its title and link', async () => {
    const { post, wrap } = setup();
    wrap(<NewJobSheet onClose={vi.fn()} ticket={{ key: 'ORBIT-479', title: 'Feedback API', url: 'https://orbit.example.com/t/479' }} />);
    const dialog = screen.getByRole('dialog', { name: 'Start a new job' });
    const field = within(dialog).getByRole('textbox', { name: 'Orbit ticket' });
    expect(field).toHaveValue('ORBIT-479');
    expect(field).toHaveAttribute('readonly');
    expect(within(dialog).getByRole('textbox', { name: /What should the crew build/ })).toHaveValue('ORBIT-479: Feedback API');
    expect(within(dialog).getByText(/From the Inbox\. The job, its branch and the ticket share this key/)).toBeInTheDocument();
    await startJob(dialog);
    expect(post).toHaveBeenCalledWith('/api/jobs', expect.objectContaining({
      description: 'ORBIT-479: Feedback API',
      ticket: { key: 'ORBIT-479', title: 'Feedback API', url: 'https://orbit.example.com/t/479' },
    }));
  });

  it('Start as stack (packet K2): "Run as a stack" is ticked, says when to use one, and goes with the job’s options', async () => {
    const { post, wrap } = setup();
    wrap(<NewJobSheet onClose={vi.fn()} ticket={{ key: 'ORBIT-479', title: 'Feedback API', url: null }} stack />);
    const dialog = screen.getByRole('dialog', { name: 'Start a new job' });
    const box = within(dialog).getByRole('checkbox', { name: /Run as a stack/ });
    expect(box).toBeChecked();
    expect(within(dialog).getByText(/For a big ticket: the Foreman splits the work into parts that are built side by side, then joined in order/)).toBeInTheDocument();
    await startJob(dialog);
    expect(post).toHaveBeenCalledWith('/api/jobs', expect.objectContaining({ options: expect.objectContaining({ stack: true }) }));
  });

  it('without Start as stack, "Run as a stack" is not ticked and nothing extra goes with the job', async () => {
    const { post, wrap } = setup();
    wrap(<NewJobSheet onClose={vi.fn()} ticket={{ key: 'ORBIT-479', title: 'Feedback API', url: null }} />);
    const dialog = screen.getByRole('dialog', { name: 'Start a new job' });
    expect(within(dialog).getByRole('checkbox', { name: /Run as a stack/ })).not.toBeChecked();
    await startJob(dialog);
    expect(post.mock.calls[0]).toBeTruthy();
    expect((post.mock.calls[0] as unknown[])[1]).not.toEqual(expect.objectContaining({ options: expect.objectContaining({ stack: true }) }));
  });

  it('the Inbox’s description alone ("ORBIT-<n>: <title>") counts as started from the Inbox', async () => {
    const { post, wrap } = setup();
    wrap(<NewJobSheet onClose={vi.fn()} description="ORBIT-12: Comment save fails" />);
    const dialog = screen.getByRole('dialog', { name: 'Start a new job' });
    expect(within(dialog).getByRole('textbox', { name: 'Orbit ticket' })).toHaveAttribute('readonly');
    await startJob(dialog);
    expect(post).toHaveBeenCalledWith('/api/jobs', expect.objectContaining({ ticket: { key: 'ORBIT-12', title: 'Comment save fails', url: null } }));
  });

  it('a new job: the field is optional; a typed key goes with the job; a bad one is refused before anything is sent', async () => {
    const { post, wrap } = setup();
    wrap(<NewJobSheet onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Start a new job' });
    const field = within(dialog).getByRole('textbox', { name: 'Orbit ticket (optional)' });
    expect(field).not.toHaveAttribute('readonly');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /What should the crew build/ }), { target: { value: 'Fix the comment save' } });
    fireEvent.change(field, { target: { value: 'TICKET-9' } });
    expect(within(dialog).getByText(TICKET_KEY_PROBLEM)).toBeInTheDocument();
    await startJob(dialog);
    expect(post).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(TICKET_KEY_PROBLEM);
    fireEvent.change(field, { target: { value: 'orbit-124' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Start job' })); });
    expect(post).toHaveBeenCalledWith('/api/jobs', expect.objectContaining({ ticket: { key: 'ORBIT-124', title: 'Fix the comment save', url: null } }));
  });

  it('left empty: no ticket is sent', async () => {
    const { post, wrap } = setup();
    wrap(<NewJobSheet onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Start a new job' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /What should the crew build/ }), { target: { value: 'Add a sample button' } });
    await startJob(dialog);
    expect(post).toHaveBeenCalledWith('/api/jobs', expect.objectContaining({ ticket: undefined }));
  });
});
