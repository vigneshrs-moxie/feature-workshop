import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import { installKeyListener } from '../app/keyRegistry';
import { writeKeysSetting } from '../app/keysSetting';
import { hrefFor, parseHash } from '../app/router';
import { UiProvider, useUi, type SheetState } from '../app/ui';
import { createStore, WorkshopContext } from '../state/store';
import { LEVELS, snapshot } from '../state/test-fixtures';
import { InboxView, levelWord, nextTicket, sortInbox, startText, statusWord, type InboxAnswer, type InboxItem, type OrbitStatus, type OrbitStream } from './Inbox';
import { OrbitTokenSettings } from './Settings/OrbitTokenSettings';
import { setGuideFirstVisit } from '../components/page/Page';

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
    item(12, { priority: 'low', severity: null, assignee: { name: 'Someone else', you: false }, why: ['watching'] }),
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
afterEach(() => { offKeys(); localStorage.clear(); });

describe('Inbox', () => {
  it('is its own page at #/inbox', () => {
    expect(parseHash('#/inbox')).toEqual({ name: 'inbox' });
    expect(hrefFor({ name: 'inbox' })).toBe('#/inbox');
  });

  it('without a token, says where to paste one', async () => {
    const { wrap } = setup({ answer: { ...STATUS, tokenPresent: false, store: null, url: null, items: [] } });
    wrap(<InboxView openStream={() => null} />);
    expect(await screen.findByText(/once Ground Control has your Orbit token/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings → Workflow' })).toHaveAttribute('href', '#/settings/workflow');
  });

  it('lists each ticket with severity, key, title, age and who is on it, all in words, most severe then oldest; no priority', async () => {
    const { wrap } = setup();
    wrap(<InboxView openStream={() => null} />);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const first = rows[0];
    expect(first).toHaveTextContent('ORBIT-479');
    expect(first).toHaveTextContent('Read-only feedback API');
    expect(within(first).getByText('Critical')).toBeInTheDocument();
    expect(within(first).getByText('3d')).toBeInTheDocument();
    expect(within(first).getByText('You')).toBeInTheDocument();
    expect(first).toHaveTextContent('You are already on this: Feedback API');
    expect(within(first).getByRole('link', { name: 'Feedback API' })).toHaveAttribute('href', '#/job/orbit-479-feedback-api');
    expect(within(first).getByRole('link', { name: 'Open its job ▸' })).toHaveAttribute('href', '#/job/orbit-479-feedback-api');
    expect(within(first).queryByRole('button', { name: 'Start a job on ORBIT-479' })).toBeNull();
    expect(within(rows[1]).getByText('No one')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Not set')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Someone else')).toBeInTheDocument();
    expect(table).not.toHaveTextContent(/Priority|High/);
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
    expect(nextTicket(list)?.key).toBe('ORBIT-4');
    expect(nextTicket([item(4, { job: { slug: 'x', title: 'x' } }), item(3, { createdAt: daysAgo(9) }), item(7, { assignee: null })])?.key).toBe('ORBIT-7');
    expect(nextTicket([item(4, { job: { slug: 'x', title: 'x' } })])).toBeNull();
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
    const link = await screen.findByRole('link', { name: /Needs you ▸/ });
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
    await screen.findByRole('table');
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
    expect(sheets.at(-1)).toEqual(expect.objectContaining({ kind: 'new-job', description: 'ORBIT-12: Sample ticket 12', ticket: expect.objectContaining({ key: 'ORBIT-12' }) }));
    expect(screen.queryByRole('button', { name: 'Start ORBIT-479 as a stack' })).toBeNull(); // already on a job: the row shows the job
    act(() => { sheets.length = 0; });
    const open13 = screen.getByRole('button', { name: /^ORBIT-13/ });
    act(() => { open13.focus(); });
    fireEvent.keyDown(open13, { key: 'S', shiftKey: true });
    expect(sheets.at(-1)).toEqual(expect.objectContaining({ kind: 'new-job', ticket: expect.objectContaining({ key: 'ORBIT-13' }) }));
    expect(within(screen.getByRole('region', { name: 'Next step' })).getByRole('button', { name: /Start as stack/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^ORBIT-12/ }));
    const detail = await screen.findByRole('region', { name: 'ORBIT-12: Sample ticket 12' });
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

  it('a row opens the ticket: its facts, description, links and timeline; Back returns to the list', async () => {
    const { wrap, get, sheets } = setup();
    wrap(<InboxView openStream={() => null} />);
    fireEvent.click(await screen.findByRole('button', { name: /^ORBIT-12/ }));
    const detail = await screen.findByRole('region', { name: 'ORBIT-12: Sample ticket 12' });
    expect(get).toHaveBeenCalledWith('/api/orbit/tickets/ORBIT-12');
    expect(await within(detail).findByText(/Open the tracker/)).toBeInTheDocument();
    expect(within(detail).getByText('Status: In progress')).toBeInTheDocument();
    expect(within(detail).getByText('Severity: Not set')).toBeInTheDocument();
    expect(await within(detail).findByRole('link', { name: 'fix/orbit-12-filter' })).toBeInTheDocument();
    expect(within(detail).getByText('Looks like the filter.')).toBeInTheDocument();
    expect(within(detail).getByText('Status: New → Planning')).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'Open on Orbit' })).toHaveAttribute('href', 'https://orbit.example.com/admin/feedback/ORBIT-12');
    fireEvent.keyDown(document.body, { key: 's' }); // the open ticket
    expect(sheets.at(-1)).toEqual(expect.objectContaining({ kind: 'new-job', description: 'ORBIT-12: Sample ticket 12', ticket: expect.objectContaining({ key: 'ORBIT-12' }) }));
    fireEvent.click(within(detail).getByRole('button', { name: /All tickets/ }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
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
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('holds the stream while open (the dashboard then checks every 3 minutes) and takes each new list from it', async () => {
    const { wrap } = setup();
    const stream = fakeStream();
    const opened: string[] = [];
    const view = wrap(<InboxView openStream={(url) => { opened.push(url); return stream; }} />);
    await screen.findByRole('table');
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
    fireEvent.change(screen.getByLabelText('How long it lasts'), { target: { value: '30' } });
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
