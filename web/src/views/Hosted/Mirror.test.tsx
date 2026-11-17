// Packet 2B on the page: a decision made on the hosted site waits on its card ("Waiting for your
// laptop…", with Cancel) and the Desk's calls rest meanwhile; a changed one says to look again; a
// permission says when it was asked and when it expires; and the live stream carries on quietly
// when the site ends one, and polls every 5 seconds when it can't have one.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Gate, JobDetail, Permission } from '../../api/types';
import { DeskView } from '../../home/DeskView';
import { AutoSwitch } from '../../job/AutoSwitch';
import { WhatAutoDecided } from '../../job/WhatAutoDecided';
import { clearAllSent } from '../../lib/sentState';
import { deskQueue } from '../../home/homeModel';
import { clearDecisions } from '../../home/nudges';
import { PermissionCard } from '../../components/permissions/PermissionCard';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { hrefFor } from '../../app/router';
import { longJob } from '../../jobpage/fixtures/longJob';
import { forgetRecentPages } from '../../jobpage/recent';
import type { JobBody } from '../../jobpage/types';
import { job, snapshot } from '../../state/test-fixtures';
import { hostedStream, POLL_MS } from './hostedStream';
import { HostedWorkshop } from './HostedWorkshop';
import { useHostedRoute, type MirrorRoute } from './route';
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

afterEach(() => { cleanup(); clearAllSent(); clearDecisions(); localStorage.clear(); vi.useRealTimers(); });

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

// Spec 1.2 on the website: the queued decision's own words are its sent line; 30 seconds on with
// nothing moved it adds "Nothing has moved yet." once, beside its Cancel. No Try again: the site
// refuses a second copy of a decision that waits. Go spins until the page shows the queued decision.
describe('a decision from the site, after the click', () => {
  const stuckWords = () => screen.queryAllByText('Nothing has moved yet.');

  it('a queued decision keeps its own words; at 30 seconds it adds “Nothing has moved yet.” once, beside Cancel, with no Try again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    desk(queued('sent', 'Go: sent to your laptop. It runs there in a moment.', { canCancel: true }));
    const words = await screen.findByText('Go: sent to your laptop. It runs there in a moment.', { exact: false });
    const line = words.closest('[role="status"]')!;
    expect(line).toHaveTextContent(/^Go: sent to your laptop\. It runs there in a moment\.$/);
    act(() => { vi.advanceTimersByTime(29_000); });
    expect(stuckWords()).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(line).toHaveTextContent('Go: sent to your laptop. It runs there in a moment. Nothing has moved yet.');
    expect(stuckWords()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(stuckWords()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('with the laptop off, the words say so and nothing contradicts them', async () => {
    desk(queued('waiting', 'Go: waiting for your laptop. It runs when the laptop is back.'));
    const words = await screen.findByText(/Go: waiting for your laptop/);
    expect(words.closest('[role="status"]')).toHaveTextContent(/^Go: waiting for your laptop\. It runs when the laptop is back\.$/);
    expect(screen.queryByText(/Sent to your laptop/)).toBeNull();
  });

  it('a settled decision never says it is stuck', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    desk(queued('changed', 'This changed on your laptop. Look again. The Foreman moved on to brief 2.', { canCancel: false }));
    expect(await screen.findByText(/This changed on your laptop/)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(stuckWords()).toHaveLength(0);
  });

  it('Go spins on the click until the page shows the queued decision; a press meanwhile sends nothing', async () => {
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [ALPHA], meta: { token: null, settings: { play: { mode: 'off' } } } as never }) });
    let q: QueuedView | null = null;
    let release: () => void = () => {};
    let held = false;
    const get = vi.fn(async (): Promise<JobDetail> => {
      // The page's fetch after the answer lands only when the test says so.
      if (held) await new Promise<void>((res) => { release = res; });
      return { slug: 'alpha', thread: [], threadMore: false, gate: GATE, answeredBriefs: [], heldReply: null, options: { level: 1 }, latestBrief: { html: '<p>The plan.</p>', number: 2 }, queued: q };
    });
    const post = vi.fn(async (path: string): Promise<unknown> => {
      if (!path.endsWith('/gate')) return { ok: true };
      q = queued('sent', 'Go: sent to your laptop. It runs there in a moment.', { canCancel: true });
      held = true;
      return { ok: true, sent: false, held: true, queued: q, text: '', message: q.words };
    });
    const api = { get, post, hosted: () => true } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store, api }}><DeskView items={deskQueue([ALPHA], [])} now={NOW} layout="one" /></WorkshopContext.Provider>);
    const go = await screen.findByRole('button', { name: /^Approve/ });
    go.focus();
    await act(async () => { fireEvent.click(go); });
    // The site has answered; the page hasn't shown the queued decision yet: Go still spins.
    expect(go).toHaveAttribute('aria-busy', 'true');
    expect(go).toHaveAccessibleName('Sending…');
    // The focus moved to the card's note saying where the decision went (as before), not dropped.
    expect(document.activeElement).toHaveTextContent('Go: sent to your laptop. It runs there in a moment.');
    expect(screen.getByRole('button', { name: /^Send back/ })).toBeDisabled();
    fireEvent.click(go);
    fireEvent.click(screen.getByRole('button', { name: /^Send back/ }));
    expect(post.mock.calls.filter(([p]) => p === '/api/job/alpha/gate')).toHaveLength(1);
    await act(async () => { release(); });
    expect(await screen.findByText('Go: sent to your laptop. It runs there in a moment.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Approve|Sending)/ })).toBeNull();
    expect(post.mock.calls.filter(([p]) => p === '/api/job/alpha/gate')).toHaveLength(1);
  });
});

// Auto on the website: the switch posts the same route as on the laptop, but the website queues it
// (shown beside the switch, never in the gate's place); the laptop's refusal comes back in words;
// and What Auto decided reads the website's copy of the laptop's list, as text.
describe('Auto on the website', () => {
  const AUTO_WORDS = 'Auto on or off: waiting for your laptop. It runs when the laptop is back.';
  const REFUSED = 'The job is marked done.';
  function header(autoQueued: QueuedView | null, post = vi.fn(async (): Promise<unknown> => ({ ok: true }))) {
    const j = { ...job('alpha', 'needs-you', { level: 1 }), autoQueued } as never;
    const store = createStore();
    const api = { get: vi.fn(), post, hosted: () => true } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store, api }}><AutoSwitch job={j} /></WorkshopContext.Provider>);
    return { post };
  }

  it('turning it on is queued: the checkbox does not flip, and the words say it waits for the laptop, with Cancel', async () => {
    const q = queued('waiting', AUTO_WORDS, { kind: 'auto' });
    const post = vi.fn(async (): Promise<unknown> => ({ ok: true, sent: false, held: true, queued: q, text: '', message: q.words }));
    header(null, post);
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/auto', { on: true });
    expect(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ })).not.toBeChecked();
    expect(screen.getByText(AUTO_WORDS)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('while it waits, the switch rests; the job’s own card line carries the words and Cancel', async () => {
    const { post } = header(queued('waiting', AUTO_WORDS, { kind: 'auto' }));
    const box = screen.getByRole('checkbox', { name: /Auto: run to PR #1/ });
    expect(box).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/decisions/d_abcdefgh1234/cancel', {}));
  });

  it('the laptop’s refusal shows in the laptop’s own sentence, with Got it', async () => {
    const { post } = header(queued('failed', `Auto on or off: your laptop couldn’t do it. ${REFUSED}`, { kind: 'auto', canCancel: false }));
    expect(screen.getByText(`Auto on or off: your laptop couldn’t do it. ${REFUSED}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/decisions/d_abcdefgh1234/dismiss', {}));
  });

  it('What Auto decided shows the website’s copy of the list, words as text and never as markup', async () => {
    const get = vi.fn(async () => ({
      on: true, stopped: null, tag: null,
      summary: ['Auto made 1 decision on this job. The Approver cost $0.01.', 'Auto is on.', 'Last decision: 30 Oct 15:30, Plan: Go.'],
      entries: [{ at: '2026-10-30T15:30:00.000Z', stage: 'Plan', chose: 'Go', asked: 'Start building?', why: '<img src=x onerror="alert(1)"> because it is small' }],
    }));
    const api = { get, post: vi.fn(), hosted: () => true } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store: createStore(), api }}><WhatAutoDecided slug="alpha" auto={{ ran: true }} /></WorkshopContext.Provider>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    expect(get).toHaveBeenCalledWith('/api/job/alpha/auto');
    expect(await screen.findByText('Auto is on.')).toBeInTheDocument();
    expect(screen.getByText(/because it is small/)).toHaveTextContent('<img src=x onerror="alert(1)"> because it is small');
    expect(document.querySelector('img')).toBeNull();
  });
});

// Part 3, Task 17: the website's job page is the job page, at a job's address and a step's, and
// going from one to the other (a hashchange on the website) keeps it mounted, so typed words stay.
describe('the job page on the website', () => {
  function site(route: MirrorRoute | 'address') {
    forgetRecentPages();
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [ALPHA], meta: { token: null, settings: { play: { mode: 'subtle' } } } as never }) });
    const get = vi.fn(async (path: string): Promise<unknown> => {
      if (/^\/api\/job\/alpha\/page/.test(path)) return { ...JSON.parse(JSON.stringify(longJob.payload)), slug: 'alpha', title: 'Job alpha', hosted: true };
      if (/^\/api\/job\/alpha\/item/.test(path)) {
        const b = longJob.bodies[decodeURIComponent(/[?&]id=([^&]+)/.exec(path)?.[1] ?? '')];
        if (!b) throw new Error('Starbase answered 404.');
        return { ...b, version: String(b.meta.hash ?? b.id) } satisfies JobBody;
      }
      if (path.endsWith('/docs')) return { docs: [] };
      if (path.endsWith('/decisions')) return { decisions: [] };
      return { slug: 'alpha', thread: [], threadMore: false, gate: GATE, answeredBriefs: [], heldReply: null, options: { level: 1 }, queued: null } as JobDetail;
    });
    const api = { get, post: vi.fn(async () => ({ ok: true })), hosted: () => true } as unknown as ApiClient;
    // 'address': the site's own route from the address bar (useHostedRoute), as HostedApp mounts it.
    const utils = render(route === 'address' ? <AtTheAddress api={api} store={store} /> : <HostedWorkshop api={api} store={store} route={route} />);
    return { ...utils, get, go: (next: MirrorRoute) => utils.rerender(<HostedWorkshop api={api} store={store} route={next} />) };
  }
  /** The website's job page under the site's own route, which it shows as data-route. */
  function AtTheAddress({ api, store }: { api: ApiClient; store: Store }) {
    const route = useHostedRoute();
    return (
      <div data-route={route.name === 'mirror' ? hrefFor(route.route) : route.name}>
        {route.name === 'mirror' && <HostedWorkshop api={api} store={store} route={route.route} />}
      </div>
    );
  }
  const heldRoute = () => document.querySelector('[data-route]')?.getAttribute('data-route');
  /**
   * Sets the address and waits for the browser's own hashchange for it (jsdom fires it as a later
   * task), so it never lands after the page has mounted. An address already there fires none.
   */
  const openAt = (hash: string) => new Promise<void>((done) => {
    if (window.location.hash === (hash === '#' ? '' : hash)) { done(); return; }
    window.addEventListener('hashchange', () => done(), { once: true });
    window.location.hash = hash;
  });
  const stepRow = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.jp2-st-row')].find((b) => b.querySelector('.jp2-st-name')?.textContent === name)!;
  const theBox = () => screen.getByRole('textbox', { name: 'Message to the Foreman' });

  it('the website’s job page is the job page, at a job’s address and a step’s', async () => {
    const { get } = site({ name: 'job', slug: 'alpha' });
    const page = await screen.findByRole('main', { name: 'Job' });
    expect(page).toHaveClass('jp2');
    expect(within(page).getByRole('heading', { level: 1, name: 'Job alpha' })).toBeInTheDocument();
    expect(page.querySelectorAll('.jp2-st-row')).toHaveLength(7);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/job/alpha/page'));
    expect(get.mock.calls.map((c) => c[0] as string).filter((p) => /\/stage\//.test(p))).toEqual([]);
    cleanup();
    // A step's address opens the same page on that step.
    site({ name: 'stage', slug: 'alpha', stop: 'review' });
    expect(await screen.findByRole('main', { name: 'Job' })).toHaveClass('jp2');
    await waitFor(() => expect(stepRow('Review')).toHaveAttribute('aria-current', 'step'));
  });

  it('the website’s step address keeps the page mounted', async () => {
    const { go } = site({ name: 'job', slug: 'alpha' });
    const page = await screen.findByRole('main', { name: 'Job' });
    const box = await screen.findByRole('textbox', { name: 'Message to the Foreman' });
    act(() => { box.focus(); });
    fireEvent.change(box, { target: { value: 'Use the small table.' } });
    // The job's address, then a step's, then another step's: the same page, the same box, the same words.
    go({ name: 'stage', slug: 'alpha', stop: 'spec' });
    await act(async () => {});
    expect(stepRow('Spec')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('main', { name: 'Job' })).toBe(page);
    expect(theBox()).toBe(box);
    expect(box).toHaveValue('Use the small table.');
    go({ name: 'stage', slug: 'alpha', stop: 'build' });
    await act(async () => {});
    expect(stepRow('Build')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('main', { name: 'Job' })).toBe(page);
    expect(theBox()).toBe(box);
    expect(box).toHaveValue('Use the small table.');
  });

  it('on the website a pick moves the route the site holds, with no new history entry', async () => {
    await openAt('#/job/alpha/stage/test');
    try {
      site('address');
      await screen.findByRole('main', { name: 'Job' });
      expect(heldRoute()).toBe('#/job/alpha/stage/test');
      const entries = window.history.length;
      await waitFor(() => expect(stepRow('Spec')).toBeDefined());
      fireEvent.click(stepRow('Spec'));
      await act(async () => {});
      expect(window.location.hash).toBe('#/job/alpha/stage/spec');
      expect(window.history.length).toBe(entries);
      expect(heldRoute()).toBe('#/job/alpha/stage/spec');
      expect(stepRow('Spec')).toHaveAttribute('aria-current', 'step');
    } finally { cleanup(); await openAt(''); }
  });

  it('on the website, after a pick, the address of the step the page opened at opens it again', async () => {
    await openAt('#/job/alpha/stage/test');
    try {
      site('address');
      await screen.findByRole('main', { name: 'Job' });
      await waitFor(() => expect(stepRow('Test')).toHaveAttribute('aria-current', 'step'));
      fireEvent.click(stepRow('Spec'));
      await act(async () => {});
      expect(stepRow('Spec')).toHaveAttribute('aria-current', 'step');
      // A link (or Back) to the step the page opened at: a hashchange.
      act(() => { window.location.hash = '#/job/alpha/stage/test'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
      await waitFor(() => expect(stepRow('Test')).toHaveAttribute('aria-current', 'step'));
    } finally { cleanup(); await openAt(''); }
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
