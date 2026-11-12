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
  { id: 'claude-fable-5-2', label: 'Fable 5.2', note: 'Best judgment.' },
];
const DETAIL: JobDetail = {
  slug: 'alpha', title: 'Job alpha', thread: [], threadMore: false, run: null,
  drive: { mode: 'workshop', model: 'claude-fable-5-2' },
  statusForCompose: { questions: null, decidedOnYourBehalf: [], nextProposed: null, brief: { number: 2 } },
};
const RUNNING: Run = { id: 'run-1', slug: 'alpha', status: 'running' };

function setup({ run = null, detail = DETAIL, post = vi.fn(async () => ({})), modelLine }: { run?: Run | null; detail?: JobDetail | null; post?: ReturnType<typeof vi.fn>; modelLine?: string | null } = {}) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', models: MODELS }, jobs: [job('alpha', 'idle'), job('beta', 'idle')] }) });
  const api = { post, get: vi.fn() } as unknown as ApiClient;
  const ui = (slug: string, r: Run | null) => (
    <WorkshopContext.Provider value={{ store, api }}><Composer key={slug} slug={slug} detail={detail} run={r} modelLine={modelLine} /></WorkshopContext.Provider>
  );
  const utils = render(ui('alpha', run));
  return { ...utils, store, post, rerenderWith: (slug: string, r: Run | null) => utils.rerender(ui(slug, r)) };
}

const box = () => screen.getByRole('textbox', { name: /Foreman|Steer/ });

afterEach(() => { localStorage.clear(); });

describe('Composer', () => {
  it('shows exactly what the Foreman receives before sending, on the job’s own model', async () => {
    const { post } = setup();
    expect(screen.getByRole('button', { name: 'Send…' })).toBeDisabled();
    fireEvent.change(box(), { target: { value: '  Please also check the export.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    const dialog = screen.getByRole('dialog', { name: 'Message the Foreman' });
    const preview = screen.getByRole('textbox', { name: /exactly what the Foreman will receive/ });
    expect(preview).toHaveValue('Please also check the export.');
    expect(dialog).toHaveTextContent('Sent with Fable 5.2');
    fireEvent.change(preview, { target: { value: 'Please also check the CSV export.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to the Foreman' })); });
    // No model goes with the message: the model is fixed for the job.
    expect(post).toHaveBeenCalledWith('/api/job/alpha/send', { kind: 'message', text: 'Please also check the CSV export.', confirmNoTerminal: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(box()).toHaveValue('');
    expect(localStorage.getItem(draftKey('alpha'))).toBeNull();
  });

  it('no model menu under the message box', () => {
    setup();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('Foreman model')).toBeNull();
    setup({ detail: { ...DETAIL, drive: { mode: 'none', model: null } } });
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  // Its size by hand (jsdom lays nothing out): 20 px lines and 8 px of padding above and below,
  // border-box as the app's stylesheet sets every box. A text box's content height comes from its
  // text (one line per line written); `onLayout` runs at each such read, as a browser lays out then.
  function textHeights(onLayout = () => {}) {
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLTextAreaElement) { onLayout(); return 20 * (this.value ? this.value.split('\n').length : 0) + 16; },
    });
    return () => { Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'scrollHeight'); };
  }
  function sized() {
    const b = box() as HTMLTextAreaElement;
    b.style.boxSizing = 'border-box';
    b.style.lineHeight = '20px';
    b.style.paddingTop = '8px';
    b.style.paddingBottom = '8px';
    const write = (lines: number) => fireEvent.change(b, { target: { value: Array.from({ length: lines }, (_, i) => `Line ${i + 1}`).join('\n') } });
    return { b, write };
  }

  it('the message box grows to eight lines and then scrolls', () => {
    const undo = textHeights();
    try {
      setup();
      const { b, write } = sized();
      write(1);
      // Three lines or fewer: the box as it always was, three rows high.
      expect(b).toHaveAttribute('rows', '3');
      expect(b.style.height, 'three lines at least').toBe('');
      expect(b.style.overflowY).toBe('');
      write(5);
      expect(b.style.height, 'it grows with its text').toBe('116px');
      expect(b.style.overflowY).toBe('hidden');
      write(8);
      expect(b.style.height).toBe('176px');
      write(12);
      expect(b.style.height, 'eight lines at most').toBe('176px');
      expect(b.style.overflowY, 'then it scrolls').toBe('auto');
      write(2);
      expect(b.style.height, 'and shrinks back').toBe('');
      expect(b.style.overflowY).toBe('');
      expect(b).toHaveValue('Line 1\nLine 2');
    } finally {
      undo();
    }
  });

  // Fix round 1: measuring the text never shrinks the box itself, so a scrolled parent that sits at
  // its bottom is not pulled up while the box is measured.
  it('typing a fourth and fifth line does not change a scrolled parent’s scrollTop', () => {
    let parent: HTMLElement | null = null;
    let b: HTMLTextAreaElement | null = null;
    const height = () => b?.style.height;
    let top = 0;
    // The parent: 1000 px of other things, then the box; a 500 px window. A layout clamps its scrollTop.
    const boxHeight = () => parseFloat(b?.style.height ?? '') || 76;
    const parentHeight = () => 1000 + boxHeight();
    const layout = () => { if (parent) top = Math.min(top, parentHeight() - 500); };
    const undo = textHeights(layout);
    try {
      const { container } = setup();
      parent = container;
      Object.defineProperty(parent, 'scrollHeight', { configurable: true, get: () => parentHeight() });
      Object.defineProperty(parent, 'clientHeight', { configurable: true, value: 500 });
      Object.defineProperty(parent, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = Math.max(0, Math.min(parentHeight() - 500, v)); } });
      const sizedBox = sized();
      b = sizedBox.b;
      sizedBox.write(3);
      parent.scrollTop = 10_000; // at its bottom
      const atBottom = parent.scrollTop;
      sizedBox.write(4);
      expect(height()).toBe('96px');
      expect(parent.scrollTop, 'a fourth line: the parent stays where it was').toBe(atBottom);
      parent.scrollTop = 10_000; // at its bottom again, with the taller box
      const lower = parent.scrollTop;
      sizedBox.write(5);
      expect(height()).toBe('116px');
      expect(parent.scrollTop, 'a fifth line: the parent stays where it was').toBe(lower);
    } finally {
      undo();
    }
  });

  it('the Foreman model shows under the box with a lock when given', () => {
    setup({ modelLine: 'Opus 5.5' });
    const line = screen.getByText('Foreman model: Opus 5.5');
    expect(line.querySelector('svg.icon')).not.toBeNull();
    expect(line).toHaveAttribute('title', 'Fixed once the job starts. Change model… in the gear menu starts it again.');
    expect(box()).toHaveAttribute('placeholder', 'Write to the Foreman…');
    // Under the box: after it in the composer.
    expect(box().compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Send… is off with nothing written, and says why.
    expect(screen.getByRole('button', { name: 'Send…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send…' })).toHaveAttribute('title', 'Write something first.');
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
  // Spec 1.2: each spins on the click and can't be pressed twice while its request is out.
  /** A POST that answers only when told to. */
  function held(value: unknown = { ok: true }) {
    let answer: () => void = () => {};
    const post = vi.fn(() => new Promise((res) => { answer = () => res(value); }));
    return { post, answer: () => act(async () => { answer(); }) };
  }

  it('Send spins on the click and cannot be pressed twice', async () => {
    const { post, answer } = held();
    setup({ post });
    fireEvent.change(box(), { target: { value: 'Please check the export.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    const send = screen.getByRole('button', { name: 'Send to the Foreman' });
    send.focus();
    fireEvent.click(send);
    fireEvent.click(send);
    expect(send).toHaveAttribute('aria-busy', 'true');
    // A screen reader hears it sending; it keeps the focus.
    expect(send).toHaveAccessibleName('Sending…');
    expect(send).toHaveFocus();
    expect(send.querySelector('.spin-ring')).not.toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    await answer();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Steer spins on the click and cannot be pressed twice', async () => {
    const { post, answer } = held({ steer: { id: 'st-2', runId: 'run-1', slug: 'alpha', text: 'Skip it.', state: 'queued' } });
    setup({ run: RUNNING, post });
    fireEvent.change(box(), { target: { value: 'Skip it.' } });
    const steer = screen.getByRole('button', { name: 'Steer' });
    fireEvent.click(steer);
    fireEvent.click(steer);
    expect(steer).toHaveAttribute('aria-busy', 'true');
    expect(steer).toHaveAccessibleName('Steering…');
    expect(steer.querySelector('.spin-ring')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(1);
    await answer();
    expect(steer).not.toHaveAttribute('aria-busy');
  });

  it('Stop spins on the click and cannot be pressed twice', async () => {
    const { post, answer } = held();
    setup({ run: RUNNING, post });
    const stop = screen.getByRole('button', { name: 'Stop' });
    fireEvent.click(stop);
    fireEvent.click(stop);
    expect(stop).toHaveAttribute('aria-busy', 'true');
    expect(stop).toHaveAccessibleName('Stopping…');
    expect(stop.querySelector('.spin-ring')).not.toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    await answer();
    expect(stop).not.toHaveAttribute('aria-busy');
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
