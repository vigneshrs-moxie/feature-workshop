// Packet 2C on the page: the Inbox on the hosted site and Settings → Orbit, against a pretend site.
// Made-up people, tickets and tokens only.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../../api/client';
import type { InboxAnswer, InboxFilter, InboxItem, InboxLaptop, InboxStart, InboxSuggestion, OrbitStatus } from '../../api/types';
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
const REPOS = [{ name: 'orbit', default: true }, { name: 'starbase', default: false }];
const lap = (id: number, name: string, online: boolean): Laptop => ({ id, name, os: 'macOS', version: '0.1.0', pairedAt: ago(86_400_000 * 5), lastSeenAt: ago(online ? 5_000 : 3_600_000), online });

interface Site { suggest?: InboxSuggestion | null; status: OrbitStatus; items: InboxItem[]; filter?: InboxFilter; laptops: Laptop[]; repos?: { name: string; default: boolean }[]; calls: { method: string; path: string; body?: Record<string, unknown> }[]; startFails?: string; /** What the laptop's settings (mirrored) say about Auto start. */ autoStart?: { on: boolean; tag: string; max?: number }; /** What the laptop mirrors after an Auto start change: what was sent (default), nothing yet (false), or something else. */ autoTakes?: false | { on: boolean; tag: string }; /** Start answers only once this settles. */ hold?: Promise<void> }

function site(over: Partial<Site> = {}) {
  const s: Site = { status: STATUS, items: [ticket(12), ticket(13, { severity: 'low' })], laptops: [lap(7, 'Olive’s Mac', true)], calls: [], ...over };
  const laptopsOf = (): InboxLaptop[] => s.laptops.map((l) => ({ id: l.id, name: l.name, online: l.online, repos: s.repos ?? REPOS }));
  const answer = (): InboxAnswer => ({ ...s.status, ...(s.filter ? { filter: s.filter } : {}), laptops: laptopsOf(), items: s.items, suggest: s.suggest ?? null });
  const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    s.calls.push({ method, path, body });
    if (path === '/api/meta') return json(200, { mode: 'hosted', person: OLIVE, signIn: '/api/auth/start', missing: [] });
    if (path === '/api/orbit/inbox' || path === '/api/orbit/inbox?refresh=1') return json(200, answer());
    if (path === '/api/snapshot') return json(200, { meta: { settings: { workflow: { finishLine: 'pr1-merged', ...(s.autoStart ? { autoStart: s.autoStart } : {}) } } } });
    if (path === '/api/orbit/auto-start' && method === 'POST') {
      // As hosted/site/routes-orbit.js answers: queued for the laptop, with whether it is there.
      if (s.autoTakes !== false) s.autoStart = s.autoTakes ?? { on: body?.on as boolean, tag: String(body?.tag).trim(), ...(typeof body?.max === 'number' ? { max: body.max } : {}) };
      const l = s.laptops[0];
      return json(200, { ok: true, queued: true, sent: false, commandId: 5, laptop: { id: l.id, name: l.name, online: l.online } });
    }
    if (path === '/api/orbit/status') return json(200, s.status);
    if (path === '/api/laptops') return json(200, { laptops: s.laptops });
    if (path === '/api/orbit/token' && method === 'POST') {
      s.status = { ...STATUS, tokenPresent: true, expired: false, expiresAt: '2026-12-12T16:00:00.000Z' };
      return json(200, s.status);
    }
    if (path === '/api/orbit/token' && method === 'DELETE') { s.status = { ...STATUS, tokenPresent: false, expiresAt: null }; return json(200, s.status); }
    if (path === '/api/orbit/start' && method === 'POST') {
      if (s.hold) await s.hold;
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

  it('the website shows how old the suggestion is, and that it may be out of date after two hours', async () => {
    const picks = [{ key: 'ORBIT-12', reason: 'Small and quick.' }];
    const unranked = (n: number) => ticket(n, { queuePosition: null, queueKnown: true });
    const { api } = site({ items: [unranked(12), unranked(13)], suggest: { state: 'ready', at: ago(5 * 60_000), picks, forList: [] } });
    render(<HostedApp api={api} />);
    expect(await screen.findByText('Suggested by your laptop 5 minutes ago.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('ORBIT-12 is suggested: Small and quick.');
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent("None of your tickets is ranked in Orbit, so this is your laptop's suggestion. Start sends it to your laptop.");
    cleanup();
    const old = site({ items: [unranked(12), unranked(13)], suggest: { state: 'ready', at: ago(3 * 3_600_000), picks, forList: [] } });
    render(<HostedApp api={old.api} />);
    expect(await screen.findByText('Suggested by your laptop 3 hours ago. Your list may have changed since. Your laptop suggests again when it is on.')).toBeInTheDocument();
  });

  it('says under the title that only tickets assigned to you are listed, with no Watching tab or chip', async () => {
    const { api } = site();
    render(<HostedApp api={api} />);
    expect(await screen.findByText("Tickets assigned to you. Tickets you only watch or are mentioned on aren't listed.")).toBeInTheDocument();
    expect(screen.queryByText(/Watching/i)).toBeNull();
  });

  it('when Orbit did not apply "assigned to me", says so and shows no rows', async () => {
    const { api } = site({ items: [], filter: { audience: 'tech', ignored: ['assignee'], applied: false } });
    render(<HostedApp api={api} />);
    expect(await screen.findByText("Orbit didn't apply 'assigned to me' for this token, so your tickets can't be picked out. The account needs adding to Orbit's feedback-team list.")).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/Watching/i)).toBeNull();
  });

  it("the website's bar skips a ticket whose Start is on its way", async () => {
    const sending: InboxStart = { id: 5, state: 'sending', laptop: { id: 7, name: 'Olive’s Mac', online: true }, at: ago(1000) };
    const q = { workOrder: null, size: null, queueKnown: true };
    const { api } = site({ items: [ticket(1, { ...q, queuePosition: 1, start: sending }), ticket(2, { ...q, queuePosition: 2 })] });
    render(<HostedApp api={api} />);
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('ORBIT-2 is number 2 in your queue');
    expect(bar).toHaveTextContent('The lowest number in your Orbit queue without a job. Start sends it to your laptop, and the Foreman reads the ticket there first.');
    expect(screen.getByText('A job is on each of these, or one is on its way')).toBeInTheDocument();
  });

  it('a stored row without queue fields still shows', async () => {
    const { api } = site({ items: [ticket(12), ticket(13, { severity: 'low' })] });
    render(<HostedApp api={api} />);
    const [table] = await screen.findAllByRole('table');
    expect(within(table).queryByRole('columnheader', { name: 'Queue' })).toBeNull();
    expect(table).toHaveTextContent('ORBIT-12');
    expect(table).toHaveTextContent('ORBIT-13');
  });

  const pressStart = async (name = 'Start a job on ORBIT-12') => {
    fireEvent.click(await screen.findByRole('button', { name }));
    return screen.findByRole('dialog', { name: 'Start a new job' });
  };

  it('Start on the website opens the form with the ticket filled in; submitting posts the choices, and Cancel takes the start back', async () => {
    const { s, api } = site();
    render(<HostedApp api={api} />);
    const sheet = await pressStart();
    expect(within(sheet).getByLabelText('What should the crew build or fix?')).toHaveValue('ORBIT-12: Sample ticket 12');
    expect(within(sheet).getByLabelText('Orbit ticket')).toHaveValue('ORBIT-12');
    expect(within(sheet).getByRole('radio', { name: 'Feature' })).toBeChecked();
    await waitFor(() => expect(within(sheet).getByRole('combobox', { name: 'Repository' })).toHaveAttribute('data-value', 'orbit'));
    expect(within(sheet).queryByText('Start from a past conversation (optional)')).toBeNull();
    expect(within(sheet).queryByText('Another folder…')).toBeNull();
    expect(within(sheet).queryByText('Which laptop starts it?')).toBeNull();
    fireEvent.click(within(sheet).getByRole('radio', { name: /L1/ }));
    fireEvent.click(within(sheet).getByRole('radio', { name: /^Fable 5\.2/ }));
    fireEvent.click(within(sheet).getByLabelText(/Run as a stack/));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start job' }));
    await waitFor(() => expect(s.calls.find((c) => c.path === '/api/orbit/start')?.body).toEqual({
      key: 'ORBIT-12', description: 'ORBIT-12: Sample ticket 12', kind: 'feature', laptopId: 7, repo: 'orbit', model: 'claude-fable-5-2', options: { level: 1, stack: true },
    }));
    expect(await screen.findByText('Starting on Olive’s Mac…')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'DELETE' && c.path === '/api/orbit/start/41')).toBe(true));
    expect(await screen.findByRole('button', { name: 'Start a job on ORBIT-12' })).toBeInTheDocument();
  });

  it('a repository picked in the form stays picked when the page re-renders', async () => {
    const { api } = site();
    const { rerender } = render(<HostedApp api={api} />);
    const sheet = await pressStart();
    const box = () => within(sheet).getByRole('combobox', { name: 'Repository' });
    await waitFor(() => expect(box()).toHaveAttribute('data-value', 'orbit'));
    fireEvent.click(box());
    fireEvent.click(await screen.findByRole('option', { name: 'starbase' }));
    await waitFor(() => expect(box()).toHaveAttribute('data-value', 'starbase'));
    rerender(<HostedApp api={api} />);
    expect(box()).toHaveAttribute('data-value', 'starbase');
  });

  it('a bug ticket preselects Bug fix', async () => {
    const { s, api } = site({ items: [ticket(12, { type: 'bug' })] });
    render(<HostedApp api={api} />);
    const sheet = await pressStart();
    expect(within(sheet).getByRole('radio', { name: 'Bug fix' })).toBeChecked();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start job' }));
    await waitFor(() => expect(s.calls.find((c) => c.path === '/api/orbit/start')?.body).toMatchObject({ kind: 'bug' }));
  });

  it('Start spins until the site answers and cannot be sent twice', async () => {
    let release: () => void = () => {};
    const { s, api } = site({ hold: new Promise<void>((res) => { release = res; }) });
    render(<HostedApp api={api} />);
    const sheet = await pressStart();
    const go = within(sheet).getByRole('button', { name: 'Start job' });
    fireEvent.click(go);
    fireEvent.click(go);
    await waitFor(() => expect(go).toHaveAttribute('aria-busy', 'true'));
    await waitFor(() => expect(s.calls.filter((c) => c.path === '/api/orbit/start')).toHaveLength(1));
    release();
    expect(await screen.findByText('Starting on Olive’s Mac…')).toBeInTheDocument();
    expect(s.calls.filter((c) => c.path === '/api/orbit/start')).toHaveLength(1);
  });

  it('with the laptop off the row says “Starts when your laptop is back”', async () => {
    const { api } = site({ laptops: [lap(7, 'Olive’s Mac', false)] });
    render(<HostedApp api={api} />);
    fireEvent.click(within(await pressStart()).getByRole('button', { name: 'Start job' }));
    const said = await screen.findByText('Starts when your laptop is back');
    expect(said.closest('[role="status"]')?.querySelector('svg')).toBeTruthy();
  });

  it('two laptops: the form asks which, the repositories are that laptop’s, and the choice is sent', async () => {
    const { s, api } = site({ laptops: [lap(7, 'Olive’s Mac', false), lap(8, 'Olive’s spare laptop', true)] });
    render(<HostedApp api={api} />);
    const sheet = await pressStart();
    const group = within(sheet).getByRole('group', { name: 'Which laptop starts it?' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked(); // the one that is on, first and picked
    expect(group).toHaveTextContent('Online: it starts in a moment');
    expect(group).toHaveTextContent('it starts when the laptop is back');
    fireEvent.click(within(group).getByRole('radio', { name: /Olive’s Mac/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start job' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(s.calls.find((c) => c.path === '/api/orbit/start')?.body).toMatchObject({ key: 'ORBIT-12', laptopId: 7 });
    expect(await screen.findByText('Starts when your laptop is back')).toBeInTheDocument();
  });

  it('two laptops that are both off or both on: nothing is picked, and Start job asks', async () => {
    const { s, api } = site({ laptops: [lap(7, 'Olive’s Mac', true), lap(8, 'Olive’s spare laptop', true)] });
    render(<HostedApp api={api} />);
    const sheet = await pressStart();
    expect(within(sheet).getAllByRole('radio', { name: /Olive’s/ }).some((r) => (r as HTMLInputElement).checked)).toBe(false);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start job' }));
    expect(await within(sheet).findByText('Pick which laptop starts it.')).toBeInTheDocument();
    expect(s.calls.some((c) => c.path === '/api/orbit/start')).toBe(false);
  });

  it('a laptop that has told the site no repository: the form says so and sends none', async () => {
    const { s, api } = site({ repos: [] });
    render(<HostedApp api={api} />);
    const sheet = await pressStart();
    expect(sheet).toHaveTextContent('hasn’t told Starbase about a repository yet');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start job' }));
    await waitFor(() => expect(s.calls.find((c) => c.path === '/api/orbit/start')?.body).not.toHaveProperty('repo'));
  });

  it('with no laptop, the sheet says to pair one; a refused Start says why in the form', async () => {
    const { api } = site({ laptops: [] });
    render(<HostedApp api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start a job on ORBIT-12' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pair a laptop first' });
    expect(within(sheet).getByRole('link', { name: 'Open Settings → Laptops' })).toHaveAttribute('href', '#/settings/laptops');
    cleanup();
    const refused = site({ startFails: 'You’re already on this: Tidy button.' });
    render(<HostedApp api={refused.api} />);
    fireEvent.click(within(await pressStart()).getByRole('button', { name: 'Start job' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You’re already on this: Tidy button.');
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

describe('Auto start on the website', () => {
  it('the Inbox says Auto start is on, marks the rows that start by themselves, and never starts one itself', async () => {
    const { s, api } = site({ autoStart: { on: true, tag: 'auto' }, items: [ticket(12, { tags: ['Auto'] }), ticket(13, { tags: [], title: 'auto auto' }), ticket(14, { tags: ['auto'], job: { slug: 'orbit-14-x', title: 'x' } })] });
    render(<HostedApp api={api} />);
    expect(await screen.findByText('Auto start is on: tickets tagged "auto" start by themselves, up to 5 at a time.')).toBeInTheDocument();
    const row = (key: string) => screen.getAllByRole('row').find((r) => r.getAttribute('data-ticket') === key)!;
    expect(within(row('ORBIT-12')).getByText('Starts by itself')).toBeInTheDocument();
    expect(within(row('ORBIT-13')).queryByText('Starts by itself')).toBeNull();
    expect(within(row('ORBIT-14')).queryByText('Starts by itself')).toBeNull();
    expect(s.calls.some((c) => c.method === 'POST' && c.path === '/api/orbit/start')).toBe(false);
  });

  it('with the switch off there is no line and no chip', async () => {
    const { api } = site({ autoStart: { on: false, tag: 'auto' }, items: [ticket(12, { tags: ['auto'] })] });
    render(<HostedApp api={api} />);
    await screen.findAllByRole('table');
    expect(screen.queryByText(/Auto start is on/)).toBeNull();
    expect(screen.queryByText('Starts by itself')).toBeNull();
  });

  it('Settings → Orbit: a switch with an empty box asks for a tag, then the setting is sent as the auto-start command', async () => {
    go('#/settings/orbit');
    const { s, api } = site({ items: [ticket(12, { tags: ['auto'], tagsKnown: true })] });
    render(<HostedApp api={api} />);
    const group = await screen.findByRole('group', { name: 'Auto start' });
    const box = within(group).getByRole('checkbox', { name: 'Start a job by itself for tickets with this tag' });
    expect(within(group).getByLabelText('Orbit tag')).toHaveAttribute('placeholder', 'auto');
    expect(group).toHaveTextContent('Only tickets assigned to you, in Inbox order. Nothing starts while the Claude limit warning shows.');
    fireEvent.click(box);
    expect(await within(group).findByText('Write a tag’s name to turn this on.')).toBeInTheDocument();
    expect(s.calls.some((c) => c.path === '/api/orbit/auto-start')).toBe(false);
    fireEvent.change(within(group).getByLabelText('Orbit tag'), { target: { value: ' auto ' } });
    fireEvent.click(box);
    await waitFor(() => expect(s.calls.find((c) => c.path === '/api/orbit/auto-start')?.body).toEqual({ on: true, tag: 'auto' }));
    await waitFor(() => expect(box).toBeChecked());
    expect(within(group).queryByText(/doesn’t show tags/)).toBeNull();
  });

  // Deep review D, I4: the website does not say "Saved" for something only the laptop can do.
  it('Settings → Orbit: Auto start goes to the laptop; the switch keeps the laptop’s value and one line says it was sent', async () => {
    go('#/settings/orbit');
    const { s, api } = site({ autoStart: { on: false, tag: 'auto' }, autoTakes: false });
    render(<HostedApp api={api} />);
    const group = await screen.findByRole('group', { name: 'Auto start' });
    const box = within(group).getByRole('checkbox', { name: 'Start a job by itself for tickets with this tag' });
    await waitFor(() => expect(within(group).getByLabelText('Orbit tag')).toHaveValue('auto'));
    fireEvent.click(box);
    expect(await within(group).findByText('Sent to your laptop. It takes effect there.')).toBeInTheDocument();
    expect(box).not.toBeChecked();
    expect(group).not.toHaveTextContent('Saved');
    // The laptop takes it and the site mirrors it: the switch shows it, and the line goes.
    s.autoStart = { on: true, tag: 'auto' };
    await waitFor(() => expect(box).toBeChecked(), { timeout: 5000 });
    await waitFor(() => expect(within(group).queryByText('Sent to your laptop. It takes effect there.')).toBeNull());
  });

  it('Settings → Orbit: with the laptop not connected the line says it waits for the laptop', async () => {
    go('#/settings/orbit');
    const { api } = site({ autoStart: { on: false, tag: 'auto' }, autoTakes: false, laptops: [lap(7, 'Olive’s Mac', false)] });
    render(<HostedApp api={api} />);
    const group = await screen.findByRole('group', { name: 'Auto start' });
    await waitFor(() => expect(within(group).getByLabelText('Orbit tag')).toHaveValue('auto'));
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Start a job by itself for tickets with this tag' }));
    expect(await within(group).findByText('Waiting for your laptop.')).toBeInTheDocument();
    expect(group).not.toHaveTextContent('Saved');
  });

  // Round 2, M8: the wait for the laptop ends after 10 minutes with what is true then (the site keeps the command).
  it('Settings → Orbit: after 10 minutes with the laptop away, it says the change is kept for the laptop', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      go('#/settings/orbit');
      const { api } = site({ autoStart: { on: false, tag: 'auto' }, autoTakes: false, laptops: [lap(7, 'Olive’s Mac', false)] });
      render(<HostedApp api={api} />);
      const group = await screen.findByRole('group', { name: 'Auto start' });
      await waitFor(() => expect(within(group).getByLabelText('Orbit tag')).toHaveValue('auto'));
      fireEvent.click(within(group).getByRole('checkbox', { name: 'Start a job by itself for tickets with this tag' }));
      expect(await within(group).findByText('Waiting for your laptop.')).toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(10 * 60_000 + 4_000); });
      expect(await within(group).findByText('Your laptop has not answered. The change is kept and takes effect when it is back online.')).toBeInTheDocument();
      expect(within(group).queryByText('Waiting for your laptop.')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('Settings → Orbit: when the laptop’s value arrives and differs from what was sent, it says the laptop did not take it', async () => {
    go('#/settings/orbit');
    const { api } = site({ autoStart: { on: false, tag: 'auto' }, autoTakes: { on: false, tag: 'other' } });
    render(<HostedApp api={api} />);
    const group = await screen.findByRole('group', { name: 'Auto start' });
    await waitFor(() => expect(within(group).getByLabelText('Orbit tag')).toHaveValue('auto'));
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Start a job by itself for tickets with this tag' }));
    expect(await within(group).findByText('Your laptop did not take this change.', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(within(group).getByRole('checkbox', { name: 'Start a job by itself for tickets with this tag' })).not.toBeChecked();
  });

  it('Settings → Orbit says when Orbit shows no tags to the token', async () => {
    go('#/settings/orbit');
    const { api } = site({ autoStart: { on: true, tag: 'auto' }, items: [ticket(12, { tags: [], tagsKnown: false })] });
    render(<HostedApp api={api} />);
    const group = await screen.findByRole('group', { name: 'Auto start' });
    expect(await within(group).findByText('Orbit doesn’t show tags to your token, so nothing starts by itself.')).toBeInTheDocument();
  });

  it('Settings → Orbit: Up to N jobs at a time goes to the laptop as max, and the line stays until the laptop has it', async () => {
    go('#/settings/orbit');
    const { s, api } = site({ autoStart: { on: true, tag: 'auto', max: 3 }, autoTakes: false });
    render(<HostedApp api={api} />);
    const group = await screen.findByRole('group', { name: 'Auto start' });
    const box = within(group).getByRole('spinbutton', { name: 'Jobs at a time' });
    await waitFor(() => expect(box).toHaveValue('3'));
    fireEvent.change(box, { target: { value: '6' } });
    await waitFor(() => expect(s.calls.find((c) => c.path === '/api/orbit/auto-start')?.body).toEqual({ on: true, tag: 'auto', max: 6 }));
    expect(await within(group).findByText('Sent to your laptop. It takes effect there.')).toBeInTheDocument();
    // The laptop still says 3: the change is not there yet, so the line stays.
    await new Promise((r) => setTimeout(r, 100));
    expect(within(group).getByText('Sent to your laptop. It takes effect there.')).toBeInTheDocument();
    s.autoStart = { on: true, tag: 'auto', max: 6 };
    await waitFor(() => expect(within(group).queryByText('Sent to your laptop. It takes effect there.')).toBeNull(), { timeout: 5000 });
  });
});

