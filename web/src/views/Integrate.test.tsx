import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { EventSourceLike } from '../state/live';
import { createStore, WorkshopContext } from '../state/store';
import { IntegrateBoard, outcomeWords, slotsLine, type IntegrateView } from './Integrate';

function board(over: Partial<IntegrateView> = {}): IntegrateView {
  return {
    root: '/work/ground-control',
    base: 'main',
    packets: [
      {
        id: 'C', name: 'Job lock', path: '/work/ground-control-C', branch: 'packet/C-job-lock', base: 'main', ahead: 3, behind: 1, state: 'waiting',
        lastCommit: { sha: 'a'.repeat(40), short: 'aaaaaaa', subject: 'Job lock: lock.json per job', time: new Date().toISOString() },
        testsState: 'green', testsAt: new Date().toISOString(), brief: 'docs/plans/packets/C-job-lock.md', owned: ['dashboard/lib/lock.js'], touchedOutsideOwned: [],
      },
      {
        id: 'D', name: 'Usage warnings', path: '/work/ground-control-D', branch: 'packet/D-usage-warnings', base: 'main', ahead: 2, behind: 0, state: 'waiting',
        lastCommit: { sha: 'b'.repeat(40), short: 'bbbbbbb', subject: 'Usage warnings: a banner', time: new Date().toISOString() },
        testsState: 'red', testsAt: null, brief: null, owned: null, touchedOutsideOwned: null,
      },
      {
        id: 'Z', name: 'Integration board', path: '/work/ground-control-Z', branch: 'packet/Z-integration-board', base: 'main', ahead: 0, behind: 4, state: 'merged',
        lastCommit: null, testsState: 'unknown', testsAt: null, brief: null, owned: [], touchedOutsideOwned: ['web/src/app/app.css', 'README.md'],
      },
    ],
    order: [
      { id: 'Z', branch: 'packet/Z-integration-board', state: 'merged', ahead: 0, name: 'Integration board' },
      { id: 'C', branch: 'packet/C-job-lock', state: 'waiting', ahead: 3, name: 'Job lock' },
      { id: 'E', branch: null, state: 'missing', ahead: null, name: null },
    ],
    next: { id: 'C', branch: 'packet/C-job-lock', state: 'waiting', ahead: 3, name: 'Job lock' },
    slots: 3,
    inUse: 2,
    last: null,
    running: null,
    log: '',
    ...over,
  };
}

class FakeStream implements EventSourceLike {
  readyState = 1;
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  closed = false;
  close() { this.closed = true; }
  send(data: unknown) { act(() => { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) })); }); }
}

function setup(view: IntegrateView = board()) {
  const get = vi.fn(async () => view);
  const post = vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
    if (path === '/api/integrate/merge-next') return { started: true, step: { kind: 'merge', stage: 'checking', startedAt: '2026-10-28T10:00:00Z' } };
    return body;
  });
  const api = { get, post } as unknown as ApiClient;
  const stream = new FakeStream();
  const openStream = vi.fn(() => stream);
  const utils = render(
    <WorkshopContext.Provider value={{ store: createStore(), api }}>
      <IntegrateBoard openStream={openStream} />
    </WorkshopContext.Provider>,
  );
  return { get, post, stream, openStream, ...utils };
}

afterEach(() => { localStorage.clear(); });

describe('the integration board', () => {
  it('lists the packets with every state in words next to its colour', async () => {
    setup();
    const table = await screen.findByRole('table');
    const rowC = within(table).getByRole('row', { name: /C Job lock/ });
    expect(rowC).toHaveTextContent('Not merged yet');
    expect(rowC).toHaveTextContent('packet/C-job-lock');
    expect(rowC).toHaveTextContent('3 ahead · 1 behind');
    expect(rowC).toHaveTextContent('aaaaaaa Job lock: lock.json per job');
    expect(rowC).toHaveTextContent('Passed');
    expect(rowC).toHaveTextContent('None');
    const rowD = within(table).getByRole('row', { name: /D Usage warnings/ });
    expect(rowD).toHaveTextContent('Failed');
    expect(rowD).toHaveTextContent('Unknown');
    const rowZ = within(table).getByRole('row', { name: /Z Integration board/ });
    expect(rowZ).toHaveTextContent('Merged');
    expect(rowZ).toHaveTextContent('Not run yet');
    expect(rowZ).toHaveTextContent('2 files');
    expect(within(rowZ).getByText('web/src/app/app.css')).toBeInTheDocument();
    expect(screen.getAllByText('2 of 3 slots in use').length).toBeGreaterThan(0);
  });

  it('shows the order as a numbered list; up and down save the new order', async () => {
    const { post } = setup();
    const list = await screen.findByRole('list', { name: 'Integration order' });
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('data-order'))).toEqual(['Z', 'C', 'E']);
    expect(within(list).getByText('No branch yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Z up' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move C up' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/integrate/order', { order: ['C', 'Z', 'E'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Take E out of the order' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/integrate/order', { order: ['Z', 'C'] }));
    // D has a worktree but isn't in the order: it can be added at the end.
    fireEvent.change(screen.getByRole('combobox', { name: /Add to the order/ }), { target: { value: 'D' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/integrate/order', { order: ['Z', 'C', 'E', 'D'] }));
  });

  it('packets at once can be changed at any time', async () => {
    const { post } = setup();
    const input = await screen.findByRole('spinbutton', { name: 'Packets at once' });
    expect(input).toHaveValue(3);
    fireEvent.change(input, { target: { value: '5' } });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/integrate/slots', { slots: 5 }));
    fireEvent.change(input, { target: { value: '0' } });
    expect(post).not.toHaveBeenCalledWith('/api/integrate/slots', { slots: 0 });
  });

  it('Merge next: the button and the m key start it; m does nothing while typing or with keys off', async () => {
    const { post } = setup();
    const button = await screen.findByRole('button', { name: /Merge next/ });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'm');
    expect(screen.getByText(/Packet/, { selector: 'span' })).toHaveTextContent('Packet C · Job lock Not merged yet');

    const input = screen.getByRole('spinbutton', { name: 'Packets at once' });
    fireEvent.keyDown(input, { key: 'm' });
    expect(post).not.toHaveBeenCalledWith('/api/integrate/merge-next', {});
    localStorage.setItem('fw.keys', JSON.stringify({ enabled: false, hints: true }));
    fireEvent.keyDown(document.body, { key: 'm' });
    expect(post).not.toHaveBeenCalledWith('/api/integrate/merge-next', {});
    localStorage.clear();

    fireEvent.keyDown(document.body, { key: 'm' });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/integrate/merge-next', {}));
    await waitFor(() => expect(screen.getByRole('button', { name: /Merge next/ })).toBeDisabled());
  });

  it('streams the running step into the output and refreshes when it is done', async () => {
    const { stream, get } = setup();
    await screen.findByRole('table');
    expect(screen.getByRole('log')).toHaveTextContent('Nothing has run yet.');
    stream.send({ type: 'hello', step: null, log: '' });
    stream.send({ type: 'step', step: { kind: 'merge', id: 'C', stage: 'merging', startedAt: '2026-10-28T10:00:00Z' } });
    stream.send({ type: 'line', text: '$ git merge --no-ff packet/C-job-lock\n' });
    stream.send({ type: 'line', text: 'Merge made by the ort strategy.\n' });
    expect(screen.getByRole('log')).toHaveTextContent('Merge made by the ort strategy.');
    expect(screen.getByText('Merging C…')).toBeInTheDocument();
    const calls = get.mock.calls.length;
    stream.send({ type: 'done', result: { outcome: 'merged', message: 'ok', at: '2026-10-28T10:01:00Z' } });
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(calls));
  });

  it('a conflict lists the files, each linking to the editor, and offers Open in editor', async () => {
    setup(board({ last: { outcome: 'conflict', at: new Date().toISOString(), id: 'C', files: ['dashboard/server.js'], message: 'Merging packet C stopped on a conflict in one file. Nothing was undone.' } }));
    expect(await screen.findByText('Conflict')).toBeInTheDocument();
    expect(screen.getByText(/Nothing was undone/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'dashboard/server.js' })).toHaveAttribute('href', 'vscode://file/work/ground-control/dashboard/server.js');
    expect(screen.getByRole('link', { name: 'Open in editor' })).toHaveAttribute('href', 'vscode://file/work/ground-control');
  });

  it('says it in words', () => {
    expect(slotsLine(1, 1)).toBe('1 of 1 slot in use');
    expect(slotsLine(4, 3)).toBe('4 of 3 slots in use: more packets are open than the number set');
    expect(outcomeWords({ outcome: 'merged', message: '', at: '', tests: { ok: false, steps: [] } })).toBe('Merged, tests failed');
    expect(outcomeWords({ outcome: 'refused', message: '', at: '' })).toBe('Not started');
  });
});
