// Packet 2C on the page: the Inbox on the hosted site and Settings → Orbit, against a pretend site.
// Made-up people, tickets and tokens only.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../../api/client';
import type { InboxAnswer, InboxItem, InboxStart, OrbitStatus } from '../../api/types';
import { HostedApp } from './HostedApp';
import { dayWords, savedWords } from './OrbitPage';
import { parseHostedHash } from './route';
import type { HostedPerson, Laptop } from './types';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const OLIVE: HostedPerson = { id: 1, name: 'Olive Owner', email: 'olive.owner@example.test', role: 'owner' };
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const TOKEN = `orbfb_test${'x'.repeat(39)}`;

const STATUS: OrbitStatus = {
  tokenPresent: true, store: null, url: 'https://orbit.example.test', savedAt: ago(86_400_000), expiresAt: '2026-12-12T16:00:00.000Z', expired: false,
  lastPoll: ago(60_000), lastError: null, errorKind: null, everyMs: 180_000, watchers: 0, waitingMs: 0, refused: false, refreshMs: 60_000, setup: [],
};
const ticket = (n: number, extra: Partial<InboxItem> = {}): InboxItem => ({
  key: `ORBIT-${n}`, number: n, title: `Sample ticket ${n}`, type: 'feature', status: 'open', priority: 'medium', severity: 'critical',
  createdAt: ago(3 * 86_400_000), changedAt: ago(86_400_000), assignee: { name: 'You', you: true }, why: ['assigned'],
  url: `https://orbit.example.test/admin/feedback/ORBIT-${n}`, job: null, description: `What ticket ${n} is about.`, start: null, ...extra,
});
const lap = (id: number, name: string, online: boolean): Laptop => ({ id, name, os: 'macOS', version: '0.1.0', pairedAt: ago(86_400_000 * 5), lastSeenAt: ago(online ? 5_000 : 3_600_000), online });

interface Site { status: OrbitStatus; items: InboxItem[]; laptops: Laptop[]; calls: { method: string; path: string; body?: Record<string, unknown> }[]; startFails?: string }

function site(over: Partial<Site> = {}) {
  const s: Site = { status: STATUS, items: [ticket(12), ticket(13, { severity: 'low' })], laptops: [lap(7, 'Olive’s Mac', true)], calls: [], ...over };
  const answer = (): InboxAnswer => ({ ...s.status, items: s.items });
  const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    s.calls.push({ method, path, body });
    if (path === '/api/meta') return json(200, { mode: 'hosted', person: OLIVE, signIn: '/api/auth/start', missing: [] });
    if (path === '/api/orbit/inbox' || path === '/api/orbit/inbox?refresh=1') return json(200, answer());
    if (path === '/api/orbit/status') return json(200, s.status);
    if (path === '/api/laptops') return json(200, { laptops: s.laptops });
    if (path === '/api/orbit/token' && method === 'POST') {
      s.status = { ...STATUS, tokenPresent: true, expired: false, expiresAt: '2026-12-12T16:00:00.000Z' };
      return json(200, s.status);
    }
    if (path === '/api/orbit/token' && method === 'DELETE') { s.status = { ...STATUS, tokenPresent: false, expiresAt: null }; return json(200, s.status); }
    if (path === '/api/orbit/start' && method === 'POST') {
      if (s.startFails) return json(409, { error: s.startFails });
      const l = s.laptops.find((x) => x.id === body?.laptopId)!;
      const start: InboxStart = { id: 41, state: l.online ? 'sending' : 'waiting', laptop: { id: l.id, name: l.name, online: l.online }, at: new Date().toISOString() };
      s.items = s.items.map((i) => (i.key === body?.key ? { ...i, start } : i));
      return json(200, { start, items: s.items });
    }
    if (path === '/api/orbit/start/41' && method === 'DELETE') { s.items = s.items.map((i) => ({ ...i, start: null })); return json(200, { items: s.items }); }
    return json(404, { error: 'There is nothing at this address.' });
  }) as typeof globalThis.fetch;
  return { s, api: createApi({ fetch, hosted: true }) };
}

const go = (hash: string) => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); };
beforeEach(() => { go('#/inbox'); });
afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

describe('the hosted Inbox', () => {
  it('has its own addresses: #/inbox and #/settings/orbit', () => {
    expect(parseHostedHash('#/inbox')).toEqual({ name: 'inbox' });
    expect(parseHostedHash('#/inbox?peek=ORBIT-12')).toEqual({ name: 'inbox' });
    expect(parseHostedHash('#/settings/orbit')).toEqual({ name: 'orbit' });
  });

  it('reads the inbox the site keeps (asking for a fresh read), with Mine only, no Start as stack and no live stream', async () => {
    const { s, api } = site();
    render(<HostedApp api={api} />);
    const tables = await screen.findAllByRole('table');
    expect(tables[0]).toHaveTextContent('ORBIT-12');
    expect(s.calls.some((c) => c.path === '/api/orbit/inbox?refresh=1')).toBe(true);
    expect(s.calls.some((c) => c.path.startsWith('/api/orbit/views') || c.path.startsWith('/api/orbit/events'))).toBe(false);
    expect(screen.queryByRole('button', { name: /as a stack/ })).toBeNull();
    expect(screen.queryByText('Start as stack')).toBeNull();
    expect(screen.getByText(/checked every 3 minutes, and every minute while this page is open/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page');
  });

  it('Start with one laptop sends it at once; the row says it is on its way, and Cancel takes it back', async () => {
    const { s, api } = site();
    render(<HostedApp api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start a job on ORBIT-12' }));
    await waitFor(() => expect(s.calls.find((c) => c.path === '/api/orbit/start')?.body).toEqual({ key: 'ORBIT-12', laptopId: 7 }));
    expect(await screen.findByText('Starting on Olive’s Mac…')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'DELETE' && c.path === '/api/orbit/start/41')).toBe(true));
    expect(await screen.findByRole('button', { name: 'Start a job on ORBIT-12' })).toBeInTheDocument();
  });

  it('with the laptop off the row says “Starts when your laptop is back”', async () => {
    const { api } = site({ laptops: [lap(7, 'Olive’s Mac', false)] });
    render(<HostedApp api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start a job on ORBIT-12' }));
    const said = await screen.findByText('Starts when your laptop is back');
    expect(said.closest('[role="status"]')?.querySelector('svg')).toBeTruthy();
  });

  it('with two laptops it asks which, one choice each, saying which is on', async () => {
    const { s, api } = site({ laptops: [lap(7, 'Olive’s Mac', false), lap(8, 'Olive’s spare laptop', true)] });
    render(<HostedApp api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start a job on ORBIT-12' }));
    const sheet = await screen.findByRole('dialog', { name: 'Which laptop starts ORBIT-12?' });
    const radios = within(sheet).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked(); // the one that is on, first and picked
    expect(sheet).toHaveTextContent('Online: it starts in a moment');
    expect(sheet).toHaveTextContent('it starts when the laptop is back');
    fireEvent.click(within(sheet).getByRole('radio', { name: /Olive’s Mac/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start on Olive’s Mac' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(s.calls.find((c) => c.path === '/api/orbit/start')?.body).toEqual({ key: 'ORBIT-12', laptopId: 7 });
    expect(await screen.findByText('Starts when your laptop is back')).toBeInTheDocument();
  });

  it('with no laptop, the sheet says to pair one; a refused Start says why', async () => {
    const { api } = site({ laptops: [] });
    render(<HostedApp api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start a job on ORBIT-12' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pair a laptop first' });
    expect(within(sheet).getByRole('link', { name: 'Open Settings → Laptops' })).toHaveAttribute('href', '#/settings/laptops');
    cleanup();
    const refused = site({ startFails: 'You’re already on this: Tidy button.' });
    render(<HostedApp api={refused.api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start a job on ORBIT-12' }));
    expect(await screen.findByText('ORBIT-12 wasn’t started: You’re already on this: Tidy button.')).toBeInTheDocument();
  });

  it('a Start the laptop couldn’t run says why, and offers Start again; a job on the mirror says “you are already on this”', async () => {
    const failed: InboxStart = { id: 5, state: 'failed', laptop: { id: 7, name: 'Olive’s Mac', online: true }, at: ago(60_000), error: 'This laptop doesn’t know which repository a ticket’s job goes in.' };
    const { api } = site({ items: [ticket(12, { start: failed }), ticket(14, { job: { slug: 'orbit-14-x', title: 'ORBIT-14: Sample', state: 'needs-you' } })] });
    render(<HostedApp api={api} />);
    expect(await screen.findByText(/Olive’s Mac couldn’t start it: This laptop doesn’t know which repository/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a job on ORBIT-12' })).toHaveTextContent('Start again');
    expect(screen.getByText(/You are already on this/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Needs you' })).toHaveAttribute('href', '#/job/orbit-14-x');
  });

  it('an expired or refused token: one calm banner, never covering the page, and the list stays', async () => {
    const { api } = site({ status: { ...STATUS, expired: true, refused: true, lastError: null } });
    render(<HostedApp api={api} />);
    const banner = await screen.findByText(/Your Orbit token expired\. Paste a new one in/);
    expect(screen.getAllByText(/Your Orbit token expired/)).toHaveLength(1);
    const p = banner.closest('p')!;
    expect(p).toHaveAttribute('role', 'status');
    expect(p).toHaveClass('inbox-token-banner');
    expect(within(p).getByRole('link', { name: 'Settings → Orbit' })).toHaveAttribute('href', '#/settings/orbit');
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
  });

  it('without a token, the steps and the way to Settings → Orbit; the settings the site lacks are named', async () => {
    const { api } = site({ status: { ...STATUS, tokenPresent: false, expiresAt: null, setup: ['TOKEN_KEY'] }, items: [] });
    render(<HostedApp api={api} />);
    expect(await screen.findByText(/once the site has your Orbit token, even while your laptop is closed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings → Orbit' })).toHaveAttribute('href', '#/settings/orbit');
    expect(screen.getByText(/sets TOKEN_KEY in Vercel first/)).toBeInTheDocument();
  });

  it('the quick look shows what the site keeps, and says the links and timeline are on Orbit', async () => {
    const { s, api } = site();
    render(<HostedApp api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: /ORBIT-12\s*Sample ticket 12/ }));
    const peek = await screen.findByRole('dialog', { name: /ORBIT-12: Sample ticket 12/ });
    expect(peek).toHaveTextContent('What ticket 12 is about.');
    expect(peek).toHaveTextContent('Its links and timeline are on Orbit');
    expect(s.calls.some((c) => c.path.startsWith('/api/orbit/tickets/'))).toBe(false);
  });
});

describe('Settings → Orbit on the site', () => {
  it('empty: paste a token and how long it lasts; saved: only “Saved · expires 12 Dec” and Remove, never the token', async () => {
    go('#/settings/orbit');
    const { s, api } = site({ status: { ...STATUS, tokenPresent: false, expiresAt: null } });
    render(<HostedApp api={api} />);
    const field = await screen.findByLabelText('Your token');
    expect(screen.getByRole('link', { name: /Orbit/, current: 'page' })).toBeInTheDocument();
    fireEvent.change(field, { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole('radio', { name: '90 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save the token' }));
    expect(await screen.findByText(`Saved · expires ${dayWords('2026-12-12T16:00:00.000Z')}`)).toBeInTheDocument();
    expect(s.calls.find((c) => c.path === '/api/orbit/token')?.body).toEqual({ token: TOKEN, expiresInDays: 90 });
    expect(screen.queryByLabelText(/token/i)).toBeNull();
    expect(document.body.innerHTML).not.toContain('orbfb_test');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByLabelText('Your token')).toBeInTheDocument();
    expect(s.calls.some((c) => c.method === 'DELETE' && c.path === '/api/orbit/token')).toBe(true);
  });

  it('expired: the banner and the form for a new one', async () => {
    go('#/settings/orbit');
    const { api } = site({ status: { ...STATUS, expired: true, refused: true } });
    render(<HostedApp api={api} />);
    expect(await screen.findByText('Your Orbit token expired. Paste a new one below.')).toBeInTheDocument();
    expect(screen.getByLabelText('A new token')).toBeInTheDocument();
  });

  it('dates read as “12 Dec”, with the year only when it isn’t this year’s', () => {
    expect(dayWords('2026-12-12T16:00:00.000Z', new Date('2026-10-30T12:00:00Z'))).toBe('12 Dec');
    expect(dayWords('2027-01-05T16:00:00.000Z', new Date('2026-10-30T12:00:00Z'))).toBe('5 Jan 2027');
    expect(savedWords({ expiresAt: null })).toBe('Saved · when it expires isn’t known');
  });
});
