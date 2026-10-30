// Packet 2B on the page: a decision made on the hosted site waits on its card ("Waiting for your
// laptop…", with Cancel) and the Desk's calls rest meanwhile; a changed one says to look again; a
// permission says when it was asked and when it expires; and the live stream carries on quietly
// when the site ends one, and polls every 5 seconds when it can't have one.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Gate, JobDetail, Permission } from '../../api/types';
import { DeskView } from '../../home/DeskView';
import { deskQueue } from '../../home/homeModel';
import { clearDecisions } from '../../home/nudges';
import { PermissionCard } from '../../components/permissions/PermissionCard';
import { createStore, WorkshopContext } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { hostedStream, POLL_MS } from './hostedStream';
import { askedLine, type QueuedView } from './QueuedDecision';

const NOW = new Date('2026-10-30T16:00:00Z');
const GATE: Gate = {
  briefNumber: 2, briefFile: 'briefs/002-plan.md', headline: 'Plan v2 ready', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
  questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: '2026-10-30T15:00:00Z', runActive: false, parked: false,
  level: 1, suggestedLevel: null, levelReason: null, usage: null,
};
const queued = (state: QueuedView['state'], words: string, extra: Partial<QueuedView> = {}): QueuedView => ({
  id: 'd_abcdefgh1234', kind: 'approve', state, words, at: '2026-10-30T15:58:00Z', expiresAt: null, waiting: state === 'waiting', canCancel: state === 'waiting', permissionId: null, ...extra,
});
const ALPHA = job('alpha', 'needs-you', { waitingFor: 'approval', stage: 'plan', lane: 'needs-you', laneReason: 'Waiting for your go-ahead on the plan', headline: 'The plan is ready. Start building?', waitingSince: '2026-10-30T15:00:00Z', level: 1 });

function desk(q: QueuedView | null) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [ALPHA], meta: { token: null, settings: { play: { mode: 'off' } } } as never }) });
  const detail: JobDetail = { slug: 'alpha', thread: [], threadMore: false, gate: GATE, answeredBriefs: [], heldReply: null, options: { level: 1 }, latestBrief: { html: '<p>The plan.</p>', number: 2 }, queued: q };
  const get = vi.fn(async () => detail);
  const post = vi.fn(async (): Promise<unknown> => ({ ok: true }));
  const api = { get, post, hosted: () => true } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}><DeskView items={deskQueue([ALPHA], [])} now={NOW} layout="one" /></WorkshopContext.Provider>);
  return { post, get, detail };
}

afterEach(() => { cleanup(); clearDecisions(); localStorage.clear(); vi.useRealTimers(); });

describe('a decision from the site, on its card', () => {
  it('waiting for the laptop: the words say so, with Cancel; the Desk’s Go and No go rest until then', async () => {
    const { post } = desk(queued('waiting', 'Go: waiting for your laptop. It runs when the laptop is back.'));
    expect(await screen.findByText('Go: waiting for your laptop. It runs when the laptop is back.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Go|Approve)/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^(No go|Send back)/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/decisions/d_abcdefgh1234/cancel', {}));
  });

  it('changed on the laptop: “Look again” above the new card, whose Go works; Got it puts the note away', async () => {
    const { post } = desk(queued('changed', 'This changed on your laptop. Look again. The Foreman moved on to brief 2.', { canCancel: false }));
    expect(await screen.findByText(/This changed on your laptop\. Look again\./)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^(Go: approve|Approve)/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/decisions/d_abcdefgh1234/dismiss', {}));
  });

  it('on the laptop (no decision from a site): the card is as it always was', async () => {
    desk(null);
    expect(await screen.findByRole('button', { name: /^(Go: approve|Approve)/ })).toBeEnabled();
    expect(screen.queryByText(/waiting for your laptop/)).toBeNull();
  });

  it('a permission says when it was asked and when it expires, and waits with Cancel once allowed', () => {
    expect(askedLine('2026-10-30T15:48:00Z', '2026-10-30T16:03:00Z', NOW)).toBe('Asked 12m ago · expires in 3m');
    expect(askedLine('2026-10-30T15:48:00Z', null, NOW)).toBe('Asked 12m ago');
    expect(askedLine('2026-10-30T15:48:00Z', '2026-10-30T15:59:00Z', NOW)).toBe('Asked 12m ago · expired');
    const store = createStore();
    const api = { post: vi.fn() } as unknown as ApiClient;
    const p: Permission = { id: 'perm-9', slug: 'alpha', kind: 'permission', toolName: 'Bash', createdAt: '2026-10-30T15:48:00Z', expiresAt: '2026-10-30T16:03:00Z', plain: { headline: 'Run the database tests' }, queued: queued('waiting', 'Allow: waiting for your laptop. It runs when the laptop is back.', { kind: 'allow', permissionId: 'perm-9' }) };
    render(<WorkshopContext.Provider value={{ store, api }}><PermissionCard permission={p} now={NOW} /></WorkshopContext.Provider>);
    expect(screen.getByText('Asked 12m ago · expires in 3m')).toBeInTheDocument();
    expect(screen.getByText(/Allow: waiting for your laptop/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

class FakeSource {
  static made: FakeSource[] = [];
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  listeners = new Map<string, (ev: MessageEvent) => void>();
  closed = false;
  constructor(public url: string) { FakeSource.made.push(this); }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) { this.listeners.set(type, fn); }
  close() { this.closed = true; this.readyState = 2; }
  open() { this.readyState = 1; this.onopen?.(new Event('open')); }
  send(data: unknown) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) })); }
  bye() { this.listeners.get('bye')?.(new MessageEvent('bye', { data: '{}' })); }
  fail() { this.onerror?.(new Event('error')); }
}

describe('the hosted live stream', () => {
  it('carries on from the last event when the site ends a stream, with no error and no reconnect shown', () => {
    FakeSource.made = [];
    const s = hostedStream('/api/events?v=2&since=10', { open: (u) => new FakeSource(u) });
    const got: number[] = [];
    let errors = 0;
    s.onmessage = (ev) => { got.push(JSON.parse(String(ev.data)).seq); };
    s.onerror = () => { errors++; };
    const first = FakeSource.made[0];
    expect(first.url).toBe('/api/events?v=2&since=10');
    first.open();
    first.send({ v: 2, type: 'change', job: null, data: {}, seq: 14 });
    first.bye();
    expect(first.closed).toBe(true);
    expect(FakeSource.made[1].url).toBe('/api/events?v=2&since=14');
    FakeSource.made[1].send({ v: 2, type: 'thread', job: 'alpha', data: {}, seq: 15 });
    expect(got).toEqual([14, 15]);
    expect(errors).toBe(0);
    s.close();
  });

  it('polls every 5 seconds when a stream can’t be had', async () => {
    vi.useFakeTimers();
    FakeSource.made = [];
    const fetchJson = vi.fn(async () => ({ events: [{ v: 2, type: 'change', job: null, data: {}, seq: 21 }], seq: 21 }));
    const s = hostedStream('/api/events?v=2&since=20', { open: (u) => new FakeSource(u), fetchJson });
    const got: number[] = [];
    s.onmessage = (ev) => { got.push(JSON.parse(String(ev.data)).seq); };
    for (let i = 0; i < 3; i++) FakeSource.made[0].fail();
    await act(async () => { await Promise.resolve(); });
    expect(fetchJson).toHaveBeenCalledWith('/api/events/poll?since=20');
    await act(async () => { vi.advanceTimersByTime(POLL_MS); await Promise.resolve(); });
    expect(fetchJson).toHaveBeenLastCalledWith('/api/events/poll?since=21');
    expect(got[0]).toBe(21);
    s.close();
  });
});
