import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { JobDetail, Run, Steer, ThreadItem } from '../../api/types';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { ev, job, snapshot } from '../../state/test-fixtures';
import { Composer, draftKey } from './Composer';
import { ForemanPane } from './ForemanPane';

// Invented jobs only.
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Everyday.' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', note: 'Best judgment.' },
];
const DETAIL: JobDetail = {
  slug: 'alpha', title: 'Job alpha', thread: [], threadMore: false, run: null,
  drive: { mode: 'workshop', model: 'claude-fable-5-1' },
  statusForCompose: { questions: null, decidedOnYourBehalf: [], nextProposed: null, brief: { number: 2 } },
};
const RUNNING: Run = { id: 'run-1', slug: 'alpha', status: 'running' };

function setup({ run = null, detail = DETAIL, post = vi.fn(async () => ({})) }: { run?: Run | null; detail?: JobDetail | null; post?: ReturnType<typeof vi.fn> } = {}) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', models: MODELS }, jobs: [job('alpha', 'idle'), job('beta', 'idle')] }) });
  const api = { post, get: vi.fn() } as unknown as ApiClient;
  const ui = (slug: string, r: Run | null) => (
    <WorkshopContext.Provider value={{ store, api }}><Composer key={slug} slug={slug} detail={detail} run={r} /></WorkshopContext.Provider>
  );
  const utils = render(ui('alpha', run));
  return { ...utils, store, post, rerenderWith: (slug: string, r: Run | null) => utils.rerender(ui(slug, r)) };
}

const box = () => screen.getByRole('textbox', { name: /Foreman|Steer/ });

afterEach(() => { localStorage.clear(); });

describe('Composer', () => {
  it('shows exactly what the Foreman receives before sending, with the model you chose', async () => {
    const { post } = setup();
    expect(screen.getByRole('button', { name: 'Send…' })).toBeDisabled();
    fireEvent.change(box(), { target: { value: '  Please also check the export.  ' } });
    // The model defaults to the one the Foreman last used; change it.
    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('claude-fable-5-1');
    fireEvent.change(select, { target: { value: 'claude-opus-5-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    const dialog = screen.getByRole('dialog', { name: 'Message the Foreman' });
    const preview = screen.getByRole('textbox', { name: /exactly what the Foreman will receive/ });
    expect(preview).toHaveValue('Please also check the export.');
    expect(dialog).toHaveTextContent('Opus 5.5');
    fireEvent.change(preview, { target: { value: 'Please also check the CSV export.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to the Foreman' })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/send', { kind: 'message', text: 'Please also check the CSV export.', model: 'claude-opus-5-5', confirmNoTerminal: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(box()).toHaveValue('');
    expect(localStorage.getItem(draftKey('alpha'))).toBeNull();
  });

  it('keeps each job’s draft across job switches', () => {
    const { rerenderWith } = setup();
    fireEvent.change(box(), { target: { value: 'Draft for alpha' } });
    rerenderWith('beta', null);
    expect(box()).toHaveValue('');
    fireEvent.change(box(), { target: { value: 'Draft for beta' } });
    rerenderWith('alpha', null);
    expect(box()).toHaveValue('Draft for alpha');
    expect(localStorage.getItem(draftKey('beta'))).toBe('Draft for beta');
  });

  it('asks to confirm when Claude Code is open in a terminal, then sends again', async () => {
    let calls = 0;
    const post = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new ApiError(409, 'Claude Code is open in this repository in a terminal.', { code: 'terminal-open' });
      return {};
    });
    setup({ post });
    fireEvent.change(box(), { target: { value: 'Go on.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to the Foreman' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('open in this repository');
    const tick = screen.getByRole('checkbox', { name: /None of the open terminals/ });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to the Foreman' })); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('tick the box');
    fireEvent.click(tick);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to the Foreman' })); });
    expect(post).toHaveBeenLastCalledWith('/api/job/alpha/send', expect.objectContaining({ confirmNoTerminal: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('switches to Steer and Stop while the Foreman replies; Steer posts to the run and clears the draft', async () => {
    const steer: Steer = { id: 'st-1', runId: 'run-1', slug: 'alpha', text: 'Use the small table.', state: 'queued' };
    const post = vi.fn(async () => ({ steer }));
    const { store } = setup({ run: RUNNING, post });
    expect(screen.queryByRole('button', { name: 'Send…' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Steer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveAttribute('title', expect.stringMatching(/draft is kept/));
    fireEvent.change(box(), { target: { value: 'Use the small table.' } });
    await act(async () => { fireEvent.keyDown(box(), { key: 'Enter', metaKey: true }); });
    expect(post).toHaveBeenCalledWith('/api/runs/run-1/steer', { text: 'Use the small table.' });
    expect(box()).toHaveValue('');
    expect(store.getState().steers['st-1'].state).toBe('queued');
  });

  it('keeps the draft when the reply finished before the steer got there', async () => {
    const post = vi.fn(async () => { throw new ApiError(404, 'That reply already finished.', { code: 'finished' }); });
    setup({ run: RUNNING, post });
    fireEvent.change(box(), { target: { value: 'Late thought' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Steer' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('press Send');
    expect(box()).toHaveValue('Late thought');
  });

  it('keeps the draft when the steer was accepted but cancelled before it was handed over', async () => {
    const steer: Steer = { id: 'st-2', runId: 'run-1', slug: 'alpha', text: 'Late thought', state: 'cancelled' };
    const post = vi.fn(async () => ({ steer }));
    setup({ run: RUNNING, post });
    fireEvent.change(box(), { target: { value: 'Late thought' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Steer' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('press Send');
    expect(box()).toHaveValue('Late thought');
  });

  it('Stop posts to the run and keeps your draft', async () => {
    const post = vi.fn(async () => ({ ok: true }));
    const { rerenderWith } = setup({ run: RUNNING, post });
    fireEvent.change(box(), { target: { value: 'Half-written idea' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop' })); });
    expect(post).toHaveBeenCalledWith('/api/runs/run-1/stop', {});
    expect(screen.getByRole('status')).toHaveTextContent('draft is kept');
    rerenderWith('alpha', { ...RUNNING, status: 'stopping' });
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Steer' })).toBeDisabled();
    rerenderWith('alpha', { ...RUNNING, status: 'stopped' });
    expect(screen.getByRole('button', { name: 'Send…' })).toBeEnabled();
    expect(box()).toHaveValue('Half-written idea');
  });
});

describe('Foreman pane: steered messages show their delivery state', () => {
  it('shows a just-steered message at once, then follows queued → delivered → acted on, also once the thread has it', async () => {
    const steer: Steer = { id: 'st-9', runId: 'run-1', slug: 'alpha', text: 'Skip the slow tests.', state: 'queued', queuedAt: '2026-10-15T12:00:00.000Z' };
    let thread: ThreadItem[] = [];
    const get = vi.fn(async () => ({ ...DETAIL, run: RUNNING, thread }));
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', models: MODELS }, jobs: [job('alpha', 'running')] }) });
    store.dispatch({ type: 'event', event: ev(11, 'run', 'alpha', RUNNING) });
    const api = { get, post: vi.fn() } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store, api }}><ForemanPane slug="alpha" /></WorkshopContext.Provider>);
    await waitFor(() => expect(get).toHaveBeenCalled());

    act(() => { store.dispatch({ type: 'steer', steer }); });
    expect(screen.getByText('Skip the slow tests.')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'You' })).getByText('Queued')).toHaveAttribute('title', expect.stringMatching(/passes it to the Foreman/));

    act(() => { store.dispatch({ type: 'event', event: ev(12, 'steer', 'alpha', { ...steer, state: 'delivered' }) }); });
    expect(within(screen.getByRole('article', { name: 'You' })).getByText('Delivered')).toBeInTheDocument();
    // The POST's answer arriving late never steps a state back.
    act(() => { store.dispatch({ type: 'steer', steer }); });
    expect(within(screen.getByRole('article', { name: 'You' })).getByText('Delivered')).toBeInTheDocument();

    // The conversation now has it (audit line): shown once, with the live state.
    thread = [{ id: 'you:x', kind: 'you', at: '2026-10-15T12:00:00.000Z', text: 'Skip the slow tests.', sendKind: 'steer', steerId: 'st-9', runId: 'run-1' }];
    act(() => { store.dispatch({ type: 'event', event: ev(13, 'thread', 'alpha', { why: 'steer' }) }); });
    act(() => { store.dispatch({ type: 'event', event: ev(14, 'steer', 'alpha', { ...steer, state: 'acted-on' }) }); });
    await waitFor(() => expect(within(screen.getByRole('article', { name: 'You' })).getByText('Acted on')).toBeInTheDocument());
    expect(screen.getAllByText('Skip the slow tests.')).toHaveLength(1);
    expect(within(screen.getByRole('article', { name: 'You' })).getByText('Steer')).toHaveAttribute('title', expect.stringMatching(/while the Foreman was replying/));
  });
});
