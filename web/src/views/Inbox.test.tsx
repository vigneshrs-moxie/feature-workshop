import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import { installKeyListener } from '../app/keyRegistry';
import { writeKeysSetting } from '../app/keysSetting';
import { hrefFor, parseHash } from '../app/router';
import { UiProvider, useUi, type SheetState } from '../app/ui';
import { clockTime } from '../lib/time';
import { createStore, WorkshopContext } from '../state/store';
import { LEVELS, snapshot } from '../state/test-fixtures';
import { InboxView, tagMatches, suggestNote, levelWord, nextTicket, shownPicks, queueOrder, sortInbox, toStart, startText, statusWord, type InboxAnswer, type InboxItem, type InboxSuggestion, type OrbitStatus, type OrbitStream } from './Inbox';
import { OrbitTokenSettings } from './Settings/OrbitTokenSettings';
import { setGuideFirstVisit } from '../components/page/Page';
import { pickOption } from '../components/Select.testing';
import type { AutoQueue } from '../api/types';
import { jobHref } from '../app/router';
import { HostedInboxPage } from './Hosted/HostedInboxPage';

// Invented tickets only.
const NOW = new Date();
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const STATUS: OrbitStatus = {
  tokenPresent: true, store: 'keychain', url: 'https://orbit.example.com', savedAt: daysAgo(1), expiresAt: daysAgo(-29), expired: false,
  lastPoll: new Date(NOW.getTime() - 2 * 60_000).toISOString(), lastError: null, errorKind: null, everyMs: 180_000, watchers: 1, waitingMs: 0,
};

const item = (n: number, extra: Partial<InboxItem> = {}): InboxItem => ({
  key: `ORBIT-${n}`, number: n, title: `Sample ticket ${n}`, type: 'feature', status: 'in_progress', priority: 'high', severity: 'critical',
  createdAt: daysAgo(3), changedAt: daysAgo(1), assignee: { name: 'You', you: true }, why: ['assigned'], url: `https://orbit.example.com/admin/feedback/ORBIT-${n}`, job: null, ...extra,
});

const INBOX: InboxAnswer = {
  ...STATUS,
  items: [
    item(479, { title: 'Read-only feedback API', job: { slug: 'orbit-479-feedback-api', title: 'Feedback API' } }),
    item(12, { priority: 'low', severity: null, assignee: { name: 'Someone else', you: false }, why: ['assigned'] }),
    item(13, { assignee: null }),
  ],
};

const DETAIL = {
  audience: 'tech',
  ticket: {
    ticket: { number: 12, subject: 'Sample ticket 12', description: 'Steps:\n1. Open the tracker' },
    timeline: [
      { type: 'status', at: daysAgo(2), from: 'open', to: 'planning', by: { fullName: 'Pat', email: 'pat@example.com' } },
      { type: 'comment', at: daysAgo(1), comment: { body: 'Looks like the filter.', author: { fullName: 'Sam', email: 's@example.com' }, deletedAt: null } },
    ],
  },
  item: { ...item(12, { priority: 'low', severity: null, assignee: { name: 'Someone else', you: false } }) },
};

function fakeStream() {
  const listeners = new Map<string, (ev: MessageEvent) => void>();
  const stream: OrbitStream & { closed: boolean; emit(type: string, data: unknown): void } = {
    closed: false,
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    close() { this.closed = true; },
    emit: (type, data) => act(() => { listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent); }),
  };
  return stream;
}

/** Shows which sheet the page asked for, as the shell would open it. */
function SheetProbe({ onSheet }: { onSheet: (s: SheetState) => void }) {
  const ui = useUi();
  useEffect(() => { onSheet(ui.sheet); }, [ui.sheet, onSheet]);
  return null;
}

function setup({ get, answer = INBOX }: { get?: (path: string) => Promise<unknown>; answer?: InboxAnswer } = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', levels: LEVELS } }) });
  const getFn = vi.fn(get ?? (async (path: string) => {
    if (path === '/api/orbit/inbox' || path === '/api/orbit/inbox?refresh=1') return answer;
    if (path === '/api/orbit/views') return { views: [{ id: 'v1', name: 'Critical, mine', isDefault: false }] };
    if (path === '/api/orbit/inbox?view=v1') return { ...STATUS, view: 'v1', items: [item(900, { title: 'Only in the saved view' })] };
    if (path === '/api/orbit/tickets/ORBIT-12') return DETAIL;
    if (path === '/api/orbit/tickets/ORBIT-12/references') return { references: [{ id: 'r1', kind: 'branch', label: 'fix/orbit-12-filter', url: 'https://github.com/example/repo/tree/fix/orbit-12-filter' }] };
    throw new ApiError(404, 'Not found');
  }));
  const api = { get: getFn, post: vi.fn(), del: vi.fn() } as unknown as ApiClient;
  const stream = fakeStream();
  const sheets: SheetState[] = [];
  const wrap = (ui: ReactNode) => render(
    <WorkshopContext.Provider value={{ store, api }}>
      <UiProvider><SheetProbe onSheet={(s) => sheets.push(s)} />{ui}</UiProvider>
    </WorkshopContext.Provider>,
  );
  return { get: getFn, api, stream, sheets, wrap, store };
}

// The page's one key listener, as App installs it: the Inbox's s is the registry's (inbox-start).
let offKeys = () => {};
beforeEach(() => { offKeys = installKeyListener(); });
afterEach(() => { offKeys(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

describe('Inbox', () => {
  it('is its own page at #/inbox', () => {
    expect(parseHash('#/inbox')).toEqual({ name: 'inbox' });
    expect(hrefFor({ name: 'inbox' })).toBe('#/inbox');
  });

  it('without a token, says where to paste one', async () => {
    const { wrap } = setup({ answer: { ...STATUS, tokenPresent: false, store: null, url: null, items: [] } });
    wrap(<InboxView openStream={() => null} />);
    expect(await screen.findByText(/once Starbase has your Orbit token/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings → Workflow' })).toHaveAttribute('href', '#/settings/workflow');
  });

  it('lists each ticket with severity, key, title, age and who is on it, all in words, most severe then oldest; no priority', async () => {
    const { wrap } = setup();
    wrap(<InboxView openStream={() => null} />);
    // Two groups: To start (no job yet), then Already started, each in the queue order.
    const tables = await screen.findAllByRole('table');
    expect(tables.map((t) => t.querySelector('caption')?.textContent)).toEqual([
      'Tickets to start, 2, in your queue order.',
      'Tickets already started, 1, in your queue order.',
    ]);
    const [decide, wait] = tables;
    const rows = within(decide).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const first = within(wait).getAllByRole('row')[1];
    expect(first).toHaveTextContent('ORBIT-479');
    expect(first).toHaveTextContent('Read-only feedback API');
    expect(within(first).getByText('Critical')).toBeInTheDocument();
    expect(within(first).getByText('3d')).toBeInTheDocument();
    expect(within(first).getByText('You')).toBeInTheDocument();
    expect(first).toHaveTextContent('You are already on this: Feedback API');
    expect(within(first).getByRole('link', { name: 'Feedback API' })).toHaveAttribute('href', '#/job/orbit-479-feedback-api');
    expect(within(first).getByRole('link', { name: 'Open its job' })).toHaveAttribute('href', '#/job/orbit-479-feedback-api');
    expect(within(first).queryByRole('button', { name: 'Start a job on ORBIT-479' })).toBeNull();
    expect(within(rows[0]).getByText('No one')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Not set')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Someone else')).toBeInTheDocument();
    for (const t of tables) expect(t).not.toHaveTextContent(/Priority|High/);
    expect(screen.getByText(/Read 2m ago · checked every 3 minutes while this page is open/)).toBeInTheDocument();
  });

  it('sorts by severity, then the oldest; the next step names the most severe ticket with no job, nobody on it first', () => {
    const list = [
      item(1, { severity: 'low', createdAt: daysAgo(30) }),
      item(2, { severity: null, createdAt: daysAgo(90) }),
      item(3, { severity: 'critical', createdAt: daysAgo(1) }),
      item(4, { severity: 'critical', createdAt: daysAgo(5) }),
      item(5, { severity: 'medium', createdAt: daysAgo(2) }),
      item(6, { severity: 'high', createdAt: daysAgo(2) }),
    ];
    expect(sortInbox(list).map((i) => i.number)).toEqual([4, 3, 6, 5, 1, 2]);
    expect(nextTicket(list)?.item.key).toBe('ORBIT-4');
    expect(nextTicket(list)?.why).toBe('order');
    expect(nextTicket([item(4, { job: { slug: 'x', title: 'x' } }), item(3, { createdAt: daysAgo(9) }), item(7, { assignee: null })])?.item.key).toBe('ORBIT-3');
    expect(nextTicket([item(4, { job: { slug: 'x', title: 'x' } })])).toBeNull();
    const sending = { id: 1, state: 'sending' as const, laptop: { id: 1, name: 'Mac', online: true }, at: daysAgo(0) };
    expect(nextTicket([item(4, { start: sending }), item(5)])?.item.key).toBe('ORBIT-5');
    expect(nextTicket([item(4, { start: { ...sending, state: 'failed' } })])?.item.key).toBe('ORBIT-4');
  });

  it('the next-step bar says which ticket and why, and Start in it (or s with no row focused) starts that one', async () => {
    const { wrap, sheets } = setup();
    wrap(<InboxView openStream={() => null} />);
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('ORBIT-13 is critical and nobody is on it');
    expect(bar).toHaveTextContent('Start a job and the Foreman reads the ticket first.');
    fireEvent.click(within(bar).getByRole('button', { name: /Start ORBIT-13/ }));
    expect(sheets.at(-1)).toEqual(expect.objectContaining({ kind: 'new-job', description: 'ORBIT-13: Sample ticket 13' }));
    act(() => { sheets.length = 0; });
    fireEvent.keyDown(document.body, { key: 's' });
    expect(sheets.at(-1)).toEqual(expect.objectContaining({ kind: 'new-job', description: 'ORBIT-13: Sample ticket 13' }));
  });

  it('a ticket whose job waits for you says Needs you, as a link to the job', async () => {
    const { wrap, store } = setup();
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', levels: LEVELS }, jobs: [{ ...snapshot().jobs[0], slug: 'orbit-479-feedback-api', lane: 'needs-you', laneReason: 'Waiting for your go-ahead on the plan' }] }) }); });
    wrap(<InboxView openStream={() => null} />);
    const link = await screen.findByRole('link', { name: /Needs you/ });
    expect(link).toHaveAttribute('href', '#/job/orbit-479-feedback-api');
    expect(link).toHaveAttribute('title', 'Waiting for your go-ahead on the plan');
  });

  it('with nothing to show: "Nothing for you right now" and New job', async () => {
    const { wrap, sheets } = setup({ answer: { ...INBOX, items: [] } });
    wrap(<InboxView openStream={() => null} />);
    expect(await screen.findByRole('heading', { name: 'Nothing for you right now' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New job' }));
    expect(sheets.at(-1)).toEqual(expect.objectContaining({ kind: 'new-job' }));
  });

  it('says under the title that only tickets assigned to you are listed, and never offers a Watching tab or chip', async () => {
    const { wrap } = setup();
    wrap(<InboxView openStream={() => null} />);
    expect(await screen.findByText("Tickets assigned to you. Tickets you only watch or are mentioned on aren't listed.")).toBeInTheDocument();
    expect(screen.queryByText(/Watching/i)).toBeNull();
    expect(screen.queryByText(/watched by you/i)).toBeNull();
    await screen.findByRole('tab', { name: /Critical, mine/ }); // the saved views arrive after the list
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.replace(/\d+\+?$/, ''))).toEqual(['Mine', 'Critical, mine']);
  });

  it('when Orbit did not apply "assigned to me", says so and shows no rows', async () => {
    const { wrap } = setup({ answer: { ...INBOX, items: [], filter: { audience: 'tech', ignored: ['assignee'], applied: false } } });
    wrap(<InboxView openStream={() => null} />);
    expect(await screen.findByText("Orbit didn't apply 'assigned to me' for this token, so your tickets can't be picked out. The account needs adding to Orbit's feedback-team list.")).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Nothing for you right now' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull();
    expect(screen.queryByText(/Watching/i)).toBeNull();
  });

  it('shows its three-card guide on the first visit only; How it works opens it again', async () => {
    setGuideFirstVisit(true);
    const { wrap } = setup();
    const view = wrap(<InboxView openStream={() => null} />);
    const guide = await screen.findByRole('dialog', { name: 'How the Inbox works' });
    expect(within(guide).getAllByRole('listitem').map((li) => li.querySelector('b')?.textContent)).toEqual(['Your Orbit tickets', 'Start makes a job', 'You say go at each step']);
    fireEvent.click(within(guide).getByRole('button', { name: 'Show me my tickets' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount();
    wrap(<InboxView openStream={() => null} />);
    await screen.findAllByRole('table');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /How it works/ }));
    expect(screen.getByRole('dialog', { name: 'How the Inbox works' })).toBeInTheDocument();
  });

  it('Start opens New job with the key and title filled in; s does the same on the row with the focus', async () => {
    const { wrap, sheets } = setup();
    wrap(<InboxView openStream={() => null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start a job on ORBIT-12' }));
    expect(sheets.at(-1)).toEqual(expect.objectContaining({ kind: 'new-job', description: 'ORBIT-12: Sample ticket 12', ticket: expect.objectContaining({ key: 'ORBIT-12' }) }));
    act(() => { sheets.length = 0; });
    const open13 = screen.getByRole('button', { name: /^ORBIT-13/ });
    act(() => { open13.focus(); });
    fireEvent.keyDown(open13, { key: 's' });
    expect(sheets.at(-1)).toEqual(expect.objectContaining({ kind: 'new-job', description: 'ORBIT-13: Sample ticket 13', ticket: expect.objectContaining({ key: 'ORBIT-13' }) }));
    expect(startText({ key: 'ORBIT-1', title: 'x' })).toBe('ORBIT-1: x');
  });

  it('Start as stack sits beside Start on each row and the open ticket and says when to use one; Shift+S does the same (packet K2)', async () => {
    const { wrap, sheets } = setup();
    wrap(<InboxView openStream={() => null} />);
    const row = await screen.findByRole('button', { name: 'Start ORBIT-12 as a stack' });
    expect(row).toHaveAttribute('title', expect.stringContaining('For a big ticket: the work is split into parts that are built side by side, then joined in order.'));
    fireEvent.click(row);
    expect(sheets.at(-1)).toEqual(expect.objectContaining({ kind: 'new-job', description: 'ORBIT-12: Sample ticket 12', ticket: expect.objectContaining({ key: 'ORBIT-12' }), stack: true }));
    expect(screen.queryByRole('button', { name: 'Start ORBIT-479 as a stack' })).toBeNull(); // already on a job: the row shows the job
    act(() => { sheets.length = 0; });
    const open13 = screen.getByRole('button', { name: /^ORBIT-13/ });
    act(() => { open13.focus(); });
    fireEvent.keyDown(open13, { key: 'S', shiftKey: true });
    expect(sheets.at(-1)).toEqual(expect.objectContaining({ kind: 'new-job', ticket: expect.objectContaining({ key: 'ORBIT-13' }) }));
    expect(within(screen.getByRole('region', { name: 'Next step' })).getByRole('button', { name: /Start as stack/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^ORBIT-12/ }));
    const detail = await screen.findByRole('dialog', { name: 'ORBIT-12: Sample ticket 12' });
    expect(within(detail).getByRole('button', { name: /Start as stack/ })).toBeInTheDocument();
    expect(detail).toHaveTextContent('Start as stack: for a big ticket: the work is split into parts');
  });

  it('s on a ticket you are already on does nothing; nor while typing, with a dialog open, or with keys off', async () => {
    const { wrap, sheets } = setup();
    wrap(<><InboxView openStream={() => null} /><input aria-label="Somewhere to type" /></>);
    const open479 = await screen.findByRole('button', { name: /^ORBIT-479/ });
    act(() => { open479.focus(); });
    fireEvent.keyDown(open479, { key: 's' });
    const box = screen.getByRole('textbox', { name: 'Somewhere to type' });
    act(() => { box.focus(); });
    fireEvent.keyDown(box, { key: 's' });
    const open12 = screen.getByRole('button', { name: /^ORBIT-12/ });
    act(() => { open12.focus(); });
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    fireEvent.keyDown(open12, { key: 's' });
    dialog.remove();
    act(() => { writeKeysSetting({ enabled: false }); });
    fireEvent.keyDown(open12, { key: 's' });
    expect(sheets.filter((s) => s?.kind === 'new-job')).toHaveLength(0);
  });

  it('a row opens the ticket in a quick look over the list (also with Space): its facts, description, links and timeline; j and k move, Esc closes, and it is in the address', async () => {
    const { wrap, get, sheets } = setup();
    wrap(<InboxView openStream={() => null} />);
    fireEvent.click(await screen.findByRole('button', { name: /^ORBIT-12/ }));
    const detail = await screen.findByRole('dialog', { name: 'ORBIT-12: Sample ticket 12' });
    expect(window.location.hash).toBe('#/?peek=ORBIT-12');
    expect(screen.getAllByRole('table')).toHaveLength(2); // the list stays where it was
    expect(get).toHaveBeenCalledWith('/api/orbit/tickets/ORBIT-12');
    expect(await within(detail).findByText(/Open the tracker/)).toBeInTheDocument();
    const fact = (name: string) => within(detail).getByText(name, { selector: 'dt' }).nextElementSibling;
    expect(fact('Status')).toHaveTextContent('In progress');
    expect(fact('Severity')).toHaveTextContent('Not set');
    expect(fact('Assigned to')).toHaveTextContent('Someone else');
    expect(await within(detail).findByRole('link', { name: 'fix/orbit-12-filter' })).toBeInTheDocument();
    expect(within(detail).getByText('Looks like the filter.')).toBeInTheDocument();
    expect(within(detail).getByText('Status: New → Planning')).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'Open on Orbit' })).toHaveAttribute('href', 'https://orbit.example.com/admin/feedback/ORBIT-12');
    fireEvent.keyDown(document.body, { key: 's' }); // the open ticket
    expect(sheets.at(-1)).toEqual(expect.objectContaining({ kind: 'new-job', description: 'ORBIT-12: Sample ticket 12', ticket: expect.objectContaining({ key: 'ORBIT-12' }) }));
    fireEvent.keyDown(document.body, { key: 'k' }); // the one before, in the list's order
    expect(await screen.findByRole('dialog', { name: 'ORBIT-13: Sample ticket 13' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/?peek=ORBIT-13');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe('#/');
    expect(screen.getAllByRole('table')).toHaveLength(2);
    const row = screen.getByRole('button', { name: /^ORBIT-12/ });
    fireEvent.keyDown(row, { key: ' ' });
    expect(await screen.findByRole('dialog', { name: 'ORBIT-12: Sample ticket 12' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a quick look in the address opens again on load', async () => {
    window.history.replaceState(null, '', '/#/inbox?peek=ORBIT-12');
    const { wrap } = setup();
    wrap(<InboxView openStream={() => null} />);
    expect(await screen.findByRole('dialog', { name: 'ORBIT-12: Sample ticket 12' })).toBeInTheDocument();
  });

  it('splits the tickets: To start has no job and nothing on its way; the rest are already started', () => {
    const sending = { id: 1, state: 'sending' as const, laptop: { id: 1, name: 'Mac', online: true }, at: daysAgo(0) };
    expect(toStart(item(1))).toBe(true);
    expect(toStart(item(2, { severity: 'low' }))).toBe(true);
    expect(toStart(item(3, { severity: null }))).toBe(true);
    expect(toStart(item(6, { job: { slug: 'x', title: 'X' } }))).toBe(false);
    expect(toStart(item(7, { start: sending }))).toBe(false);
    expect(toStart(item(8, { start: { ...sending, state: 'failed' } }))).toBe(true);
  });

  // The same table as dashboard/test/orbit.test.js, "queue order matches Plan my queue".
  it('rows follow Plan my queue', () => {
    const mk = (key: string, severity: string | null, queuePosition: number | null, createdAt = '2026-10-01T00:00:00Z') =>
      item(Number(key.charCodeAt(0)), { key, severity, queuePosition, createdAt });
    const sorted = [mk('e', null, null), mk('c', 'high', 2), mk('a', 'critical', 1), mk('d', null, 3), mk('b', 'critical', null)];
    expect(sortInbox(sorted).map((i) => i.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect([...sorted].sort(queueOrder).map((i) => i.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
    const unranked = [mk('x', 'low', null, '2026-10-05T00:00:00Z'), mk('y', 'low', null, '2026-10-02T00:00:00Z'), mk('z', 'low', 4)];
    expect(sortInbox(unranked).map((i) => i.key)).toEqual(['z', 'y', 'x']);
  });

  it('tabs: Mine, then your saved views from Orbit, each read when opened', async () => {
    const { wrap, get } = setup();
    wrap(<InboxView openStream={() => null} />);
    const tabs = await screen.findByRole('tablist', { name: 'Inbox lists' });
    await waitFor(() => expect(within(tabs).getAllByRole('tab').map((t) => t.querySelector('.seg-name')?.textContent)).toEqual(['Mine', 'Critical, mine']));
    expect(within(tabs).getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Critical, mine' }));
    expect(await screen.findByText(/Only in the saved view/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/orbit/inbox?view=v1');
  });

  it('when Orbit fails, the last list stays with its time; an expired token says to paste a new one', async () => {
    const { wrap } = setup({ answer: { ...INBOX, lastError: 'Your Orbit token expired or was revoked. Make a new one.', errorKind: 'auth', expired: true } });
    wrap(<InboxView openStream={() => null} />);
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent).join(' ')).toMatch(/Your Orbit token expired, paste a new one/);
    expect(alerts.map((a) => a.textContent).join(' ')).toMatch(/expired or was revoked.*Showing the list as it was at/);
    expect(screen.getAllByRole('row').filter((r) => r.closest('tbody'))).toHaveLength(3);
  });

  it('holds the stream while open (the dashboard then checks every 3 minutes) and takes each new list from it', async () => {
    const { wrap } = setup();
    const stream = fakeStream();
    const opened: string[] = [];
    const view = wrap(<InboxView openStream={(url) => { opened.push(url); return stream; }} />);
    await screen.findAllByRole('table');
    expect(opened).toEqual(['/api/orbit/events']);
    stream.emit('inbox', { ...INBOX, items: [item(77, { title: 'Arrived by the stream' })] });
    await waitFor(() => expect(screen.getByText(/Arrived by the stream/)).toBeInTheDocument());
    view.unmount();
    expect(stream.closed).toBe(true);
  });

  it('words for statuses and levels', () => {
    expect(statusWord('ready_for_development')).toBe('Ready for development');
    expect(statusWord('something_new')).toBe('Something new');
    expect(levelWord(null)).toBe('Not set');
    expect(levelWord('high', true)).toBe('Hidden');
  });
});

describe('Settings → Orbit token', () => {
  function settings(status: OrbitStatus) {
    const store = createStore();
    const post = vi.fn(async () => ({ ...status, tokenPresent: true, store: 'keychain', lastError: null }));
    const del = vi.fn(async () => ({ ...status, tokenPresent: false, store: null }));
    const api = { get: vi.fn(async () => status), post, del } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store, api }}><OrbitTokenSettings /></WorkshopContext.Provider>);
    return { post, del };
  }

  it('saves the address, the token and how long it lasts; the token box empties and the token is never shown', async () => {
    const { post } = settings({ ...STATUS, tokenPresent: false, store: null, url: null, expiresAt: null });
    expect(await screen.findByText('No token saved.')).toBeInTheDocument();
    const token = screen.getByLabelText('Your token');
    expect(token).toHaveAttribute('type', 'password');
    fireEvent.change(screen.getByLabelText('Orbit’s address'), { target: { value: 'https://orbit.example.com' } });
    fireEvent.change(token, { target: { value: 'orbfb_sample' } });
    pickOption(screen.getByLabelText('How long it lasts'), '30');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save the token' })); });
    expect(post).toHaveBeenCalledWith('/api/orbit/token', { token: 'orbfb_sample', url: 'https://orbit.example.com', expiresInDays: 30 });
    expect(await screen.findByText(/Orbit took the token/)).toBeInTheDocument();
    expect(screen.getByLabelText('A new token')).toHaveValue('');
    expect(screen.getByText(/A token is saved in your macOS Keychain/)).toBeInTheDocument();
  });

  it('says where the token is and until when, and forgets it', async () => {
    const { del } = settings(STATUS);
    expect(await screen.findByText(/A token is saved in your macOS Keychain/)).toBeInTheDocument();
    expect(screen.getByText(/It lasts until/)).toBeInTheDocument();
    expect(screen.getByLabelText('Orbit’s address')).toHaveValue('https://orbit.example.com');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Forget the token' })); });
    expect(del).toHaveBeenCalledWith('/api/orbit/token');
    expect(await screen.findByText(/Forgotten/)).toBeInTheDocument();
  });

  it('an expired token says so in words', async () => {
    settings({ ...STATUS, expired: true, expiresAt: daysAgo(2) });
    expect(await screen.findByText(/It expired on .*: paste a new one\./)).toBeInTheDocument();
  });
});

// Spec 4.1: the Queue column, the two groups and the bar that offers the lowest free number.
describe('the Inbox follows your queue', () => {
  const queued = (n: number, queuePosition: number | null, extra: Partial<InboxItem> = {}) => item(n, { queuePosition, workOrder: null, size: null, queueKnown: true, ...extra });
  const JOB = { slug: 'x', title: 'X' };
  const rowKeys = (table: HTMLElement) => within(table).getAllByRole('row').slice(1).map((r) => r.getAttribute('data-ticket'));

  it('the queue number shows on each ranked row and Not ranked on the rest', async () => {
    const { wrap } = setup({ answer: { ...INBOX, items: [queued(1, 3), queued(2, null, { severity: 'low' })] } });
    wrap(<InboxView openStream={() => null} />);
    const [table] = await screen.findAllByRole('table');
    expect(within(table).getAllByRole('columnheader')[0]).toHaveTextContent('Queue');
    expect(within(table).getByRole('columnheader', { name: 'Queue' })).toHaveAttribute('aria-sort', 'ascending');
    expect(within(table).getByRole('columnheader', { name: 'Severity' })).not.toHaveAttribute('aria-sort');
    const ranked = within(table).getByText('#3');
    expect(ranked).toHaveAttribute('title', 'Number 3 in your queue in Orbit (Plan my queue).');
    const none = within(table).getByText('Not ranked');
    expect(none).toHaveAttribute('title', "Not ranked in Orbit's Plan my queue yet.");
    expect(none).toHaveClass('muted');
  });

  it('no Queue column when Orbit sent no queue numbers, and the order is severity then oldest', async () => {
    const { wrap } = setup({ answer: { ...INBOX, items: [item(1, { severity: 'low', createdAt: daysAgo(9) }), item(2, { createdAt: daysAgo(2) }), item(3, { createdAt: daysAgo(8) })] } });
    wrap(<InboxView openStream={() => null} />);
    const [table] = await screen.findAllByRole('table');
    expect(within(table).queryByRole('columnheader', { name: 'Queue' })).toBeNull();
    expect(within(table).getByRole('columnheader', { name: 'Severity' })).toHaveAttribute('aria-sort', 'ascending');
    expect(rowKeys(table)).toEqual(['ORBIT-3', 'ORBIT-2', 'ORBIT-1']);
  });

  it('the bar offers the lowest number without a job', async () => {
    const { wrap } = setup({ answer: { ...INBOX, items: [queued(11, 1, { job: JOB }), queued(12, 2), queued(13, 3, { severity: 'critical' })] } });
    wrap(<InboxView openStream={() => null} />);
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('ORBIT-12 is number 2 in your queue');
    expect(bar).toHaveTextContent('The lowest number in your Orbit queue without a job. Start a job and the Foreman reads the ticket first.');
    expect(within(bar).getByRole('button', { name: /Start ORBIT-12/ })).toBeInTheDocument();
  });

  it('the bar offers the lowest number even when a more severe ticket has a higher one', async () => {
    const { wrap } = setup({ answer: { ...INBOX, items: [queued(51, 5, { severity: 'critical' }), queued(52, 1, { severity: 'high' })] } });
    wrap(<InboxView openStream={() => null} />);
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('ORBIT-52 is number 1 in your queue');
    expect(nextTicket([queued(51, 5, { severity: 'critical' }), queued(52, 1, { severity: 'high' })])?.item.key).toBe('ORBIT-52');
  });

  it('two rows numbered 2: the bar offers the first in order, and only one row is marked next', async () => {
    const { wrap } = setup({ answer: { ...INBOX, items: [queued(21, 2, { createdAt: daysAgo(1) }), queued(20, 2, { createdAt: daysAgo(5) })] } });
    wrap(<InboxView openStream={() => null} />);
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('ORBIT-20 is number 2 in your queue');
    const [table] = screen.getAllByRole('table');
    expect(table.querySelectorAll('tr.is-next')).toHaveLength(1);
    expect(table.querySelector('tr.is-next')).toHaveAttribute('data-ticket', 'ORBIT-20');
  });

  it("with nothing ranked the bar offers the first free ticket in order with today's words", async () => {
    const { wrap } = setup({ answer: { ...INBOX, items: [queued(31, null, { severity: 'low' }), queued(32, null, { severity: 'critical' })] } });
    wrap(<InboxView openStream={() => null} />);
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('ORBIT-32 is critical and yours');
    expect(bar).toHaveTextContent('Start a job and the Foreman reads the ticket first.');
    expect(bar).not.toHaveTextContent('lowest number');
  });

  it('a ticket with a job is under Already started', async () => {
    const { wrap } = setup({ answer: { ...INBOX, items: [queued(41, 1, { job: JOB }), queued(42, 2)] } });
    wrap(<InboxView openStream={() => null} />);
    const tables = await screen.findAllByRole('table');
    expect(screen.getByRole('heading', { name: /To start/ })).toBeInTheDocument();
    expect(screen.getByText('No job yet, in your Orbit queue order')).toBeInTheDocument();
    expect(rowKeys(tables[0])).toEqual(['ORBIT-42']);
    expect(screen.getByText('Already started')).toBeInTheDocument();
    expect(screen.getByText('A job is on each of these already')).toBeInTheDocument();
    expect(rowKeys(tables[1])).toEqual(['ORBIT-41']);
  });

  describe('suggested tickets', () => {
    const unranked = (n: number, extra: Partial<InboxItem> = {}) => item(n, { queuePosition: null, workOrder: null, size: null, queueKnown: true, ...extra });
    const suggest = (picks: { key: string; reason: string }[], extra: Partial<InboxSuggestion> = {}): InboxSuggestion => ({
      state: 'ready', at: new Date(NOW.getTime() - 4 * 60_000).toISOString(), picks, forList: ['ORBIT-31@x'], nextAt: null, ...extra,
    });
    const LIST = [unranked(31, { changedAt: 'x' }), unranked(32, { changedAt: 'x' }), unranked(33, { changedAt: 'x' }), unranked(34, { changedAt: 'x' })];
    const THREE = [{ key: 'ORBIT-33', reason: 'Small and blocks Sam.' }, { key: 'ORBIT-31', reason: 'Oldest.' }, { key: 'ORBIT-34', reason: 'Quick win.' }];
    const open = async (answer: InboxAnswer) => {
      const { wrap } = setup({ answer });
      wrap(<InboxView openStream={() => null} />);
      return screen.findByRole('region', { name: 'Next step' });
    };

    it('up to three rows say Suggested with their reason', async () => {
      await open({ ...INBOX, items: LIST, suggest: suggest(THREE) });
      const rows = screen.getAllByRole('row').filter((r) => r.getAttribute('data-ticket'));
      const marked = rows.filter((r) => within(r).queryByText('Suggested'));
      expect(marked.map((r) => r.getAttribute('data-ticket')).sort()).toEqual(['ORBIT-31', 'ORBIT-33', 'ORBIT-34']);
      const row33 = rows.find((r) => r.getAttribute('data-ticket') === 'ORBIT-33')!;
      expect(within(row33).getByText('Suggested')).toHaveAttribute('title', "Picked by Haiku on your laptop, because none of your tickets is ranked in Orbit. Rank them in Orbit's Plan my queue to set the order yourself.");
      expect(row33).toHaveTextContent('Small and blocks Sam.');
      expect(rows.find((r) => r.getAttribute('data-ticket') === 'ORBIT-32')).not.toHaveTextContent('Suggested');
    });

    it('the status line is always in the page, empty with no note and holding the note when there is one', async () => {
      await open({ ...INBOX, items: LIST, suggest: null });
      const empty = document.querySelector('.inbox-note');
      expect(empty).toBeInTheDocument();
      expect(empty).toHaveAttribute('role', 'status');
      expect(empty).toHaveTextContent('');
      cleanup();
      await open({ ...INBOX, items: LIST, suggest: suggest([], { state: 'asking' }) });
      expect(document.querySelector('.inbox-note')).toHaveTextContent('Picking up to three tickets to suggest…');
    });

    it('on the website the age comes from when the site received the suggestion, not the laptop’s own date', () => {
      const items = [unranked(31, { changedAt: 'x' })];
      const wrong = suggest([{ key: 'ORBIT-31', reason: 'r' }], { at: new Date(NOW.getTime() - 60_000).toISOString(), receivedAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString() });
      expect(suggestNote(wrong, items, 1, NOW, true)).toMatch(/^Suggested by your laptop 3 hours ago\. Your list may have changed since\./);
      expect(suggestNote({ ...wrong, receivedAt: new Date(NOW.getTime() - 4 * 60_000).toISOString() }, items, 1, NOW, true)).toBe('Suggested by your laptop 4 minutes ago.');
    });

    it('a pick that got a job or a rank is not shown', () => {
      const items = [unranked(31), unranked(32, { job: { slug: 'x', title: 'X' } }), unranked(33, { queuePosition: 2 }), unranked(34, { start: { id: 1, state: 'sending', laptop: { id: 1, name: 'L', online: true }, at: daysAgo(0) } }), unranked(35)];
      const picks = shownPicks(items, suggest([31, 32, 33, 34, 35, 99].map((n) => ({ key: `ORBIT-${n}`, reason: 'r' }))));
      expect(picks.map((i) => i.key)).toEqual(['ORBIT-31', 'ORBIT-35']);
      expect(shownPicks(items, suggest([{ key: 'ORBIT-31', reason: 'r' }], { state: 'failed' }))).toEqual([]);
      expect(shownPicks(items, null)).toEqual([]);
    });

    it('the bar offers the first shown pick with the exact words', async () => {
      const bar = await open({ ...INBOX, items: LIST, suggest: suggest(THREE) });
      expect(bar).toHaveTextContent('ORBIT-33 is suggested: Small and blocks Sam.');
      expect(bar).toHaveTextContent('None of your tickets is ranked in Orbit, so this is a suggestion. Start a job and the Foreman reads the ticket first.');
      expect(within(bar).getByRole('button', { name: /Start ORBIT-33/ })).toBeInTheDocument();
    });

    it('a ranked free ticket wins over any pick', () => {
      const items = [unranked(31), item(32, { queuePosition: 5, queueKnown: true })];
      expect(nextTicket(items, shownPicks(items, suggest([{ key: 'ORBIT-31', reason: 'r' }])))).toMatchObject({ item: { key: 'ORBIT-32' }, why: 'queue' });
    });

    it('the note above the table: asking, failed, and a list that changed since', async () => {
      await open({ ...INBOX, items: LIST, suggest: suggest([], { state: 'asking' }) });
      expect(screen.getByText('Picking up to three tickets to suggest…')).toBeInTheDocument();
      cleanup();
      await open({ ...INBOX, items: LIST, suggest: suggest([], { state: 'failed', why: "Haiku didn't answer in time." }) });
      expect(screen.getByText("No suggestion this time: Haiku didn't answer in time. It tries again when your list changes.")).toBeInTheDocument();
      cleanup();
      const next = new Date(NOW.getTime() + 20 * 60_000).toISOString();
      await open({ ...INBOX, items: LIST, suggest: suggest(THREE, { forList: ['ORBIT-OLD@x'], nextAt: next }) });
      expect(screen.getByText(new RegExp(`^Suggested 4 minutes ago\\. Your list has changed since, so a new suggestion comes by ${clockTime(next).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.$`))).toBeInTheDocument();
    });
  });
});

describe('Auto start on the Inbox', () => {
  const ON = { on: true, tag: 'auto', paused: null } as const;
  const tagged = (n: number, tags: string[], extra: Partial<InboxItem> = {}) => item(n, { tags, ...extra });

  it('says Auto start is on and marks only the tickets that will start by themselves', async () => {
    const answer: InboxAnswer = { ...STATUS, autoStart: ON, tagsShown: true, items: [tagged(1, ['Auto']), tagged(2, []), tagged(3, ['auto'], { job: { slug: 'orbit-3-x', title: 'x' } }), tagged(4, ['auto'], { title: 'auto', status: 'closed' })] };
    const { wrap } = setup({ answer });
    wrap(<InboxView openStream={() => null} />);
    expect(await screen.findByText('Auto start is on: tickets tagged "auto" start by themselves, up to 5 at a time.')).toBeInTheDocument();
    const row = (key: string) => screen.getAllByRole('row').find((r) => r.getAttribute('data-ticket') === key)!;
    expect(within(row('ORBIT-1')).getByText('Starts by itself')).toBeInTheDocument();
    for (const key of ['ORBIT-2', 'ORBIT-3', 'ORBIT-4']) expect(within(row(key)).queryByText('Starts by itself')).toBeNull();
  });

  it('says why it is paused', async () => {
    const limit = setup({ answer: { ...STATUS, autoStart: { ...ON, paused: 'limit' }, items: [tagged(1, ['auto'])] } });
    limit.wrap(<InboxView openStream={() => null} />);
    expect(await screen.findByText('Auto start is paused: the Claude limit warning is showing.')).toBeInTheDocument();
    cleanup();
    const orbit = setup({ answer: { ...STATUS, autoStart: { ...ON, paused: 'orbit' }, items: [tagged(1, ['auto'])] } });
    orbit.wrap(<InboxView openStream={() => null} />);
    expect(await screen.findByText("Auto start is paused: Orbit can't be reached.")).toBeInTheDocument();
  });

  it("says when it can't read the Claude limit or its list of started tickets", async () => {
    const a = setup({ answer: { ...STATUS, autoStart: { ...ON, paused: 'limit-reading' }, items: [tagged(1, ['auto'])] } });
    a.wrap(<InboxView openStream={() => null} />);
    expect(await screen.findByText("Auto start is paused: Starbase can't read your Claude limit right now.")).toBeInTheDocument();
    cleanup();
    const b = setup({ answer: { ...STATUS, autoStart: { ...ON, paused: 'memory' }, items: [tagged(1, ['auto'])] } });
    b.wrap(<InboxView openStream={() => null} />);
    expect(await screen.findByText("Auto start is paused: Starbase couldn't read its list of started tickets.")).toBeInTheDocument();
  });

  it('a ticket that failed to start by itself says why and offers Start', async () => {
    const answer: InboxAnswer = { ...STATUS, autoStart: ON, items: [tagged(1, ['auto'], { autoStartFailed: 'This laptop has no repository for it.' })] };
    const { wrap } = setup({ answer });
    wrap(<InboxView openStream={() => null} />);
    expect(await screen.findByText("Couldn't start by itself: This laptop has no repository for it. Press Start to try.")).toBeInTheDocument();
    expect(screen.queryByText('Starts by itself')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start a job on ORBIT-1' })).toBeInTheDocument();
  });

  it('with Auto start off there is no line and no chip', async () => {
    const { wrap } = setup({ answer: { ...STATUS, autoStart: { on: false, tag: 'auto', paused: null }, items: [tagged(1, ['auto'])] } });
    wrap(<InboxView openStream={() => null} />);
    await screen.findAllByRole('table');
    expect(screen.queryByText(/Auto start is/)).toBeNull();
    expect(screen.queryByText('Starts by itself')).toBeNull();
  });

  it('a tag matches a tag name only, ignoring case, never the title or text', () => {
    expect(tagMatches({ tags: ['Auto'] }, ' AUTO ')).toBe(true);
    expect(tagMatches({ tags: ['automatic'] }, 'auto')).toBe(false);
    expect(tagMatches({ tags: [], title: 'auto' } as never, 'auto')).toBe(false);
    expect(tagMatches({ tags: ['auto'] }, '  ')).toBe(false);
  });
});

// Task 16: the Inbox's Auto tab and Mine's marks, from the snapshot's Auto queue: on the laptop from
// the store, on the site from the site's own snapshot (HostedInboxPage reads /api/snapshot).
describe.each(['laptop', 'hosted'] as const)('the Inbox’s Auto tab (%s)', (mode) => {
  const ticket = (key: string, title: string, group: AutoQueue['tickets'][number]['group'], extra: Partial<AutoQueue['tickets'][number]> = {}) => ({ key, title, group, slug: null, reason: null, ...extra });
  const QUEUE: AutoQueue = {
    on: true, tag: 'auto', max: 3, working: 1, unfinished: 2, ceiling: 10, paused: null, testing: null,
    tickets: [
      ticket('ORBIT-21', 'Waiting ticket', 'next'),
      ticket('ORBIT-22', 'Busy ticket', 'working', { slug: 'orbit-22-busy' }),
      ticket('ORBIT-23', 'Big ticket', 'too-big', { slug: 'orbit-23-big', reason: 'The brief says it needs a stack.' }),
      ticket('ORBIT-24', 'Failed ticket', 'failed', { reason: 'This laptop has no repository for it.' }),
    ],
  };
  const SETTING = { on: true, tag: 'auto', max: 3 };
  const ITEMS = [item(21, { tags: ['auto'] }), item(22, { tags: ['auto'], job: { slug: 'orbit-22-busy', title: 'Busy' } })];

  /** The Inbox on this mode, with this queue (null: an older laptop sent none). */
  async function mount({ queue = QUEUE, setting = SETTING, items = ITEMS }: { queue?: AutoQueue | null; setting?: { on: boolean; tag: string; max?: number }; items?: InboxItem[] } = {}) {
    const answer: InboxAnswer = { ...STATUS, autoStart: { ...setting, paused: null }, tagsShown: true, items };
    if (mode === 'laptop') {
      const { store, wrap } = setup({ answer });
      store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', levels: LEVELS }, ...(queue ? { autoQueue: queue } : {}) }) });
      wrap(<InboxView openStream={() => null} />);
    } else {
      const get = vi.fn(async (path: string) => {
        if (path === '/api/orbit/inbox' || path === '/api/orbit/inbox?refresh=1') return answer;
        if (path === '/api/snapshot') return { meta: { settings: { workflow: { finishLine: 'pr1-merged', autoStart: setting } } }, ...(queue ? { autoQueue: queue } : {}) };
        throw new ApiError(404, 'Not found');
      });
      const api = { get, post: vi.fn(), del: vi.fn(), hosted: () => true } as unknown as ApiClient;
      render(<UiProvider><HostedInboxPage api={api} onSignedOut={() => {}} person={{ id: 1, name: 'Olive Owner', email: 'olive@example.test', role: 'owner' }} /></UiProvider>);
    }
    await screen.findAllByRole('table');
  }
  const tabNames = () => screen.getAllByRole('tab').map((t) => t.querySelector('.seg-name')?.textContent);
  const autoTab = () => screen.getByRole('tab', { name: 'Auto' });

  it('the Auto tab lists next up, working, too big and couldn\'t start, from the queue', async () => {
    await mount();
    // Mine, Auto, then the saved views (the laptop only); the count is the queue's tickets.
    await waitFor(() => expect(tabNames()).toEqual(mode === 'laptop' ? ['Mine', 'Auto', 'Critical, mine'] : ['Mine', 'Auto']));
    await waitFor(() => expect(autoTab().querySelector('.seg-count')).toHaveTextContent('4'));
    fireEvent.click(autoTab());
    expect(autoTab()).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Next up', 'Auto is working on these', 'Too big for Auto', 'Couldn’t start']);
    const next = screen.getByRole('region', { name: 'Next up' });
    expect(next).toHaveTextContent('ORBIT-21');
    expect(next).toHaveTextContent('Waiting ticket');
    expect(within(next).queryByRole('link')).toBeNull();
    const working = screen.getByRole('region', { name: 'Auto is working on these' });
    expect(within(working).getByRole('link', { name: /Busy ticket/ })).toHaveAttribute('href', jobHref('orbit-22-busy'));
    const big = screen.getByRole('region', { name: 'Too big for Auto' });
    expect(big).toHaveTextContent('The brief says it needs a stack.');
    expect(within(big).getByRole('link', { name: /Big ticket/ })).toHaveAttribute('href', jobHref('orbit-23-big'));
    const failed = screen.getByRole('region', { name: 'Couldn’t start' });
    expect(failed).toHaveTextContent('ORBIT-24');
    expect(failed).toHaveTextContent('This laptop has no repository for it.');
    expect(within(failed).queryByRole('link')).toBeNull();
    // Mine's table and its bar are not on this tab.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Start ORBIT/ })).toBeNull();
    // Back to Mine: its table again.
    fireEvent.click(screen.getByRole('tab', { name: 'Mine' }));
    expect(await screen.findAllByRole('table')).not.toHaveLength(0);
  });

  it('an empty group has no heading', async () => {
    await mount({ queue: { ...QUEUE, tickets: QUEUE.tickets.filter((t) => t.group === 'next' || t.group === 'working') } });
    fireEvent.click(await waitFor(() => autoTab()));
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Next up', 'Auto is working on these']);
    expect(screen.queryByText('Too big for Auto')).toBeNull();
    expect(screen.queryByText('Couldn’t start')).toBeNull();
  });

  it('with no queue from an older laptop there is no Auto tab', async () => {
    await mount({ queue: null });
    if (mode === 'laptop') await waitFor(() => expect(tabNames()).toEqual(['Mine', 'Critical, mine']));
    else expect(tabNames()).toEqual(['Mine']);
    expect(screen.queryByRole('tab', { name: 'Auto' })).toBeNull();
  });

  it('the paused line as on Jobs', async () => {
    await mount({ queue: { ...QUEUE, paused: 'limit' } });
    fireEvent.click(await waitFor(() => autoTab()));
    expect(screen.getByText('Auto is paused: the usage limit is near')).toBeInTheDocument();
  });

  it('Mine marks a ticket Auto is working on', async () => {
    await mount();
    const row = (key: string) => screen.getAllByRole('row').find((r) => r.getAttribute('data-ticket') === key)!;
    await waitFor(() => expect(within(row('ORBIT-22')).getByText('Auto is working on this')).toBeInTheDocument());
    expect(within(row('ORBIT-22')).queryByText('Starts by itself')).toBeNull();
    expect(within(row('ORBIT-21')).getByText('Starts by itself')).toBeInTheDocument();
    expect(within(row('ORBIT-21')).queryByText('Auto is working on this')).toBeNull();
  });

  it('the Auto start line says N', async () => {
    await mount();
    expect(await screen.findByText('Auto start is on: tickets tagged "auto" start by themselves, up to 3 at a time.')).toBeInTheDocument();
    cleanup();
    // A setting with no max (an older laptop): 5.
    await mount({ setting: { on: true, tag: 'auto' }, queue: null });
    expect(await screen.findByText('Auto start is on: tickets tagged "auto" start by themselves, up to 5 at a time.')).toBeInTheDocument();
  });
});

