import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import { useKeyListener } from '../app/keyRegistry';
import { hrefFor, parseHash } from '../app/router';
import { UiProvider, useUi, type SheetState } from '../app/ui';
import { createStore, WorkshopContext } from '../state/store';
import { LEVELS, snapshot } from '../state/test-fixtures';
import { NewJobSheet } from './JobSheets/NewJobSheet';
import { InboxView, levelWord, startText, statusWord, type InboxAnswer, type InboxItem, type OrbitStatus, type OrbitStream } from './Inbox';
import { OrbitTokenSettings } from './Settings/OrbitTokenSettings';

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

function Keys() { useKeyListener(); return null; }

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
      <UiProvider><Keys /><SheetProbe onSheet={(s) => sheets.push(s)} />{ui}</UiProvider>
    </WorkshopContext.Provider>,
  );
  return { get: getFn, api, stream, sheets, wrap };
}

afterEach(() => { localStorage.clear(); });

describe('Inbox', () => {
  it('is its own page at #/inbox', () => {
    expect(parseHash('#/inbox')).toEqual({ name: 'inbox' });
    expect(hrefFor({ name: 'inbox' })).toBe('#/inbox');
  });

  it('without a token, says where to paste one', async () => {
    const { wrap } = setup({ answer: { ...STATUS, tokenPresent: false, store: null, url: null, items: [] } });
    wrap(<InboxView openStream={() => null} />);
    expect(await screen.findByText(/once Ground Control has your Orbit token/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings → Workflow' })).toHaveAttribute('href', '#/settings/workflow');
  });

  it('lists each ticket with key, title, priority, severity, age and assignee, all in words; jobs already on a ticket say so', async () => {
    const { wrap } = setup();
    wrap(<InboxView openStream={() => null} />);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const first = rows[0];
    expect(first).toHaveTextContent('ORBIT-479');
    expect(first).toHaveTextContent('Read-only feedback API');
    expect(within(first).getByText('High')).toBeInTheDocument();
    expect(within(first).getByText('Critical')).toBeInTheDocument();
    expect(within(first).getByText('3d')).toBeInTheDocument();
    expect(within(first).getByText('You')).toBeInTheDocument();
    expect(first).toHaveTextContent('You are already on this: Feedback API');
    expect(within(first).getByRole('link', { name: 'Feedback API' })).toHaveAttribute('href', '#/job/orbit-479-feedback-api');
    expect(within(first).getByRole('button', { name: 'Start a job on ORBIT-479' })).toBeDisabled();
    expect(within(rows[1]).getByText('Not set')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Someone else')).toBeInTheDocument();
    expect(within(rows[2]).getByText('No one')).toBeInTheDocument();
    expect(screen.getByText(/Read 2m ago · checked every 3 minutes while this page is open/)).toBeInTheDocument();
  });

  it('Start opens New job with the key and title filled in; s does the same on the row with the focus', async () => {
    const { wrap, sheets } = setup();
    wrap(<InboxView openStream={() => null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start a job on ORBIT-12' }));
    expect(sheets.at(-1)).toEqual({ kind: 'new-job', description: 'ORBIT-12: Sample ticket 12' });
    const open13 = screen.getByRole('button', { name: /^ORBIT-13/ });
    act(() => { open13.focus(); });
    fireEvent.keyDown(open13, { key: 's' });
    expect(sheets.at(-1)).toEqual({ kind: 'new-job', description: 'ORBIT-13: Sample ticket 13' });
    expect(startText({ key: 'ORBIT-1', title: 'x' })).toBe('ORBIT-1: x');
  });

  it('s on a ticket you are already on does nothing; nor while typing', async () => {
    const { wrap, sheets } = setup();
    wrap(<><InboxView openStream={() => null} /><input aria-label="Somewhere to type" /></>);
    const open479 = await screen.findByRole('button', { name: /^ORBIT-479/ });
    act(() => { open479.focus(); });
    fireEvent.keyDown(open479, { key: 's' });
    const box = screen.getByRole('textbox', { name: 'Somewhere to type' });
    act(() => { box.focus(); });
    fireEvent.keyDown(box, { key: 's' });
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
    expect(sheets.at(-1)).toEqual({ kind: 'new-job', description: 'ORBIT-12: Sample ticket 12' });
    fireEvent.click(within(detail).getByRole('button', { name: /All tickets/ }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('tabs: Mine, then your saved views from Orbit, each read when opened', async () => {
    const { wrap, get } = setup();
    wrap(<InboxView openStream={() => null} />);
    const tabs = await screen.findByRole('tablist', { name: 'Inbox lists' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Mine', 'Critical, mine']);
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

describe('New job from the Inbox', () => {
  it('opens with the description it was given', async () => {
    const { wrap } = setup({ get: async (p: string) => (p === '/api/repos' ? { repos: [] } : { rows: [], matched: 0, total: 0, canContinue: false }) });
    wrap(<NewJobSheet onClose={() => {}} description="ORBIT-12: Sample ticket 12" />);
    expect(screen.getByRole('textbox', { name: /What should the crew build/ })).toHaveValue('ORBIT-12: Sample ticket 12');
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
