// The build stack (packet K2, step 8): the integration board is gone; this app's own packet
// worktrees are one read-only stack whose parts are the packet/<id>-* branches in the saved order,
// with the same Merge next (m) and both test suites. #/integrate opens #/stacks.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { IntegrateView } from '../../api/types';
import { BRAND } from '../../app/brand';
import { installKeyListener } from '../../app/keyRegistry';
import { hrefFor, parseHash, useRoute } from '../../app/router';
import type { EventSourceLike } from '../../state/live';
import { createStore, WorkshopContext } from '../../state/store';
import { aheadBehind, BUILD_NAME, BuildStackPage, buildSummary, resultWords } from './BuildStack';
import { StacksPage } from './StacksPage';
import { setStackGuideFirstVisit } from './StackGuide';

function board(over: Partial<IntegrateView> = {}): IntegrateView {
  return {
    root: '/work/app',
    base: 'main',
    packets: [
      {
        id: 'C', name: 'Job lock', path: '/work/app-C', branch: 'packet/C-job-lock', base: 'main', ahead: 3, behind: 1, state: 'waiting',
        lastCommit: { sha: 'a'.repeat(40), short: 'aaaaaaa', subject: 'Job lock: lock.json per job', time: new Date().toISOString() },
        testsState: 'green', testsAt: new Date().toISOString(), brief: 'docs/plans/packets/C-job-lock.md', owned: ['dashboard/lib/lock.js'], touchedOutsideOwned: [],
      },
      {
        id: 'D', name: 'Usage warnings', path: '/work/app-D', branch: 'packet/D-usage-warnings', base: 'main', ahead: 2, behind: 0, state: 'waiting',
        lastCommit: null, testsState: 'red', testsAt: null, brief: null, owned: null, touchedOutsideOwned: ['README.md'],
      },
      {
        id: 'Z', name: 'Integration board', path: '/work/app-Z', branch: 'packet/Z-integration-board', base: 'main', ahead: 0, behind: 4, state: 'merged',
        lastCommit: null, testsState: 'unknown', testsAt: null, brief: null, owned: [], touchedOutsideOwned: null,
      },
    ],
    order: [
      { id: 'Z', branch: 'packet/Z-integration-board', state: 'merged', ahead: 0, name: 'Integration board' },
      { id: 'C', branch: 'packet/C-job-lock', state: 'waiting', ahead: 3, name: 'Job lock' },
    ],
    next: { id: 'C', branch: 'packet/C-job-lock', state: 'waiting', ahead: 3, name: 'Job lock' },
    slots: 3, inUse: 2, last: null, running: null, log: '',
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

function setup(view: IntegrateView = board(), stacks: unknown = { stacks: [], globalCap: 3, globalRunning: 0 }) {
  const get = vi.fn(async (path: string) => (path === '/api/stacks' ? stacks : view));
  const post = vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
    if (path === '/api/integrate/merge-next') return { started: true, step: { kind: 'merge', stage: 'checking', startedAt: '2026-10-28T10:00:00Z' } };
    return body;
  });
  const api = { get, post } as unknown as ApiClient;
  const stream = new FakeStream();
  const wrap = (ui: ReactNode) => render(<WorkshopContext.Provider value={{ store: createStore(), api }}>{ui}</WorkshopContext.Provider>);
  return { get, post, stream, wrap };
}

let off = () => {};
beforeEach(() => { off = installKeyListener(); setStackGuideFirstVisit(false); });
afterEach(() => { off(); localStorage.clear(); });

describe('the build stack', () => {
  it('the old board’s address opens Stacks; the build stack is at #/stacks/build; its name comes from the brand', () => {
    expect(parseHash('#/integrate')).toEqual({ name: 'stacks' });
    expect(parseHash('#/stacks/build')).toEqual({ name: 'stack-build' });
    expect(hrefFor({ name: 'stack-build' })).toBe('#/stacks/build');
    expect(BUILD_NAME).toBe(`${BRAND.name} build`);
  });

  it('opening #/integrate lands on #/stacks, and the address says so', async () => {
    window.location.hash = '#/integrate';
    function Where() { const r = useRoute(); return <span>{r.name}</span>; }
    render(<Where />);
    expect(screen.getByText('stacks')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/stacks');
    window.location.hash = '';
  });

  it('is a card on Stacks like the others, marked as this app’s build, with its packets as parts', async () => {
    const { wrap } = setup();
    wrap(<StacksPage />);
    const card = (await screen.findByRole('link', { name: 'This app’s build' })).closest('li')!;
    expect(within(card).getByRole('link', { name: 'This app’s build' })).toHaveAttribute('href', '#/stacks/build');
    expect(card).toHaveTextContent('Read-only here: nothing pushes.');
    expect(card).toHaveTextContent('is next to merge');
    expect(within(card).getAllByRole('img', { name: /^Part \d · / })).toHaveLength(3);
    expect(screen.queryByRole('region', { name: 'Build a big feature as a stack' })).toBeNull();
    void BUILD_NAME;
  });

  it('its parts are the packets in the saved order, then those not in it, every state in words', async () => {
    const { wrap, stream } = setup();
    wrap(<BuildStackPage openStream={() => stream} />);
    const parts = await screen.findByRole('list', { name: 'The packets, in merge order' });
    const cards = [...parts.querySelectorAll('li.stack-part')] as HTMLElement[];
    expect(cards.map((c) => c.querySelector('.stack-part-title')?.textContent)).toEqual(['Packet Z · Integration board', 'Packet C · Job lock', 'Packet D · Usage warnings']);
    expect(cards[0]).toHaveTextContent('Merged');
    expect(cards[1]).toHaveTextContent('Not merged yet');
    expect(cards[1]).toHaveTextContent('Tests passed');
    expect(cards[1]).toHaveTextContent('Stayed in its own files');
    expect(cards[2]).toHaveTextContent('Not in the order');
    expect(cards[2]).toHaveTextContent('Tests failed');
    expect(cards[2]).toHaveTextContent('1 file outside its own');
    expect(screen.getByText(/Nothing here pushes/)).toBeInTheDocument();
  });

  it('Merge next (m) merges the next packet and runs both test suites; the output comes live', async () => {
    const { wrap, post, stream } = setup();
    wrap(<BuildStackPage openStream={() => stream} />);
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Packet C (Job lock) is next to merge');
    expect(bar).toHaveTextContent('then runs npm test and the web tests. Nothing is pushed.');
    await act(async () => {});
    fireEvent.keyDown(document.body, { key: 'm' });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/integrate/merge-next', {}));
    stream.send({ type: 'step', step: { kind: 'merge', id: 'C', stage: 'testing', startedAt: '2026-10-28T10:00:00Z' } });
    stream.send({ type: 'line', text: 'npm test: 712 passed\n' });
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('Running both test suites after merging C…');
    expect(screen.getByRole('log', { name: 'Output of the running step' })).toHaveTextContent('npm test: 712 passed');
  });

  it('a clash, and tests that failed after a merge, each say so with the next thing to do', async () => {
    const clash = setup(board({ last: { outcome: 'conflict', message: 'Packet C clashes.', at: '2026-10-28T10:00:00Z', id: 'C', files: ['web/src/app/App.tsx'] } }));
    const r = clash.wrap(<BuildStackPage openStream={() => clash.stream} />);
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Packet C clashes with main');
    expect(bar).toHaveTextContent('web/src/app/App.tsx. Settle it in the packet’s worktree, then Merge next again.');
    expect(within(bar).getByRole('link', { name: 'Open in editor' })).toBeInTheDocument();
    r.unmount();
    const red = setup(board({ last: { outcome: 'merged', message: 'Merged.', at: '2026-10-28T10:00:00Z', id: 'C', tests: { ok: false, steps: [] } } }));
    red.wrap(<BuildStackPage openStream={() => red.stream} />);
    expect(await screen.findByRole('region', { name: 'Next step' })).toHaveTextContent('Packet C merged, but the tests failed');
  });

  it('a next packet with no branch says Merge next waits for it; m does nothing', async () => {
    const { wrap, post, stream } = setup(board({ next: { id: 'E', branch: null, state: 'missing', ahead: null, name: null } }));
    wrap(<BuildStackPage openStream={() => stream} />);
    expect(await screen.findByRole('region', { name: 'Next step' })).toHaveTextContent('Packet E is next in the order, but has no branch yet');
    await act(async () => {});
    fireEvent.keyDown(document.body, { key: 'm' });
    expect(post).not.toHaveBeenCalled();
  });

  it('Details: run a packet’s tests, move it in the order, take it out or add it; Packets at once behind the gear', async () => {
    const { wrap, post, stream } = setup();
    wrap(<BuildStackPage openStream={() => stream} />);
    const parts = await screen.findByRole('list', { name: 'The packets, in merge order' });
    const c = parts.querySelectorAll('li.stack-part')[1] as HTMLElement;
    fireEvent.click(within(c).getByText('Details'));
    expect(c).toHaveTextContent('3 ahead · 1 behind');
    fireEvent.click(within(c).getByRole('button', { name: 'Move packet C up' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/integrate/order', { order: ['C', 'Z'] }));
    fireEvent.click(within(c).getByRole('button', { name: 'Run tests' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/integrate/run-tests', { id: 'C' }));
    const d = parts.querySelectorAll('li.stack-part')[2] as HTMLElement;
    fireEvent.click(within(d).getByText('Details'));
    fireEvent.click(within(d).getByRole('button', { name: 'Add to the order' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/integrate/order', { order: ['Z', 'C', 'D'] }));
    fireEvent.click(screen.getByRole('button', { name: /Stack settings/ }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/integrate/slots', { slots: 4 }));
  });

  it('every packet merged: push by hand; the words', () => {
    const done = board({ order: [{ id: 'Z', branch: 'b', state: 'merged', ahead: 0, name: null }], next: null, packets: [] });
    expect(buildSummary(done)).toMatchObject({ word: 'Merged: push by hand', tone: 'done' });
    expect(buildSummary(board()).word).toBe('Needs you: merge next');
    expect(aheadBehind({ ahead: null, behind: 1 })).toBe('Can’t tell');
    expect(resultWords({ outcome: 'merged', message: '', at: '', tests: { ok: true, steps: [] } })).toBe('Merged, tests passed');
  });
});
