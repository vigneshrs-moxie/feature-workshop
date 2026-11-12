// Packet 2C on the page: the Inbox on the hosted site and Settings → Orbit, against a pretend site.
// Made-up people, tickets and tokens only.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../../api/client';
import type { AutoQueue, AutoTicket, InboxAnswer, InboxFilter, InboxItem, InboxLaptop, InboxStart, InboxSuggestion, OrbitStatus } from '../../api/types';
import { AUTO_PAUSED } from '../../home/autoTab';
import { HOSTED_READ_MS } from '../Inbox';
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

interface Site { suggest?: InboxSuggestion | null; status: OrbitStatus; items: InboxItem[]; filter?: InboxFilter; laptops: Laptop[]; repos?: { name: string; default: boolean }[]; calls: { method: string; path: string; body?: Record<string, unknown> }[]; startFails?: string; /** What the laptop's settings (mirrored) say about Auto start. */ autoStart?: { on: boolean; tag: string; max?: number }; /** What the laptop mirrors after an Auto start change: what was sent (default), nothing yet (false), or something else. */ autoTakes?: false | { on: boolean; tag: string }; /** Start answers only once this settles. */ hold?: Promise<void>; /** The next Auto start command answers only once this settles (taken once). */ autoHold?: Promise<void>; /** The Auto queue in the laptop's snapshot; missing: an older laptop's snapshot, with none. */ queue?: AutoQueue; /** Each snapshot read takes the next of these and answers only once it settles. */ snapshotHolds?: Promise<void>[] }

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
    if (path === '/api/snapshot') {
      // What the laptop has when it is asked; held reads answer later with it, in the order the test lets them go.
      const body = { meta: { settings: { workflow: { finishLine: 'pr1-merged', ...(s.autoStart ? { autoStart: s.autoStart } : {}) } } }, ...(s.queue ? { autoQueue: s.queue } : {}) };
      const hold = s.snapshotHolds?.shift();
      if (hold) await hold;
      return json(200, body);
    }
    if (path === '/api/orbit/auto-start' && method === 'POST') {
      const held = s.autoHold;
      if (held) { s.autoHold = undefined; await held; }
      // As hosted/site/routes-orbit.js answers: queued for the laptop, with whether it is there.
      // A command with no max keeps the laptop's N, as the laptop's settings route does.
      const keptMax = typeof body?.max === 'number' ? body.max : s.autoStart?.max;
      if (s.autoTakes !== false) s.autoStart = s.autoTakes ?? { on: body?.on as boolean, tag: String(body?.tag).trim(), ...(typeof keptMax === 'number' ? { max: keptMax } : {}) };
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
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      go('#/settings/orbit');
      const { s, api } = site({ autoStart: { on: true, tag: 'auto', max: 3 }, autoTakes: false });
      render(<HostedApp api={api} />);
      const group = await screen.findByRole('group', { name: 'Auto start' });
      const box = await within(group).findByRole('spinbutton', { name: 'Jobs at a time' });
      await waitFor(() => expect(box).toHaveValue('3'));
      fireEvent.change(box, { target: { value: '6' } });
      fireEvent.focusOut(box);
      await waitFor(() => expect(s.calls.find((c) => c.path === '/api/orbit/auto-start')?.body).toEqual({ on: true, tag: 'auto', max: 6 }));
      expect(await within(group).findByText('Sent to your laptop. It takes effect there.')).toBeInTheDocument();
      // The laptop still says 3: the change is not there yet, so the line stays after a look.
      await act(async () => { vi.advanceTimersByTime(3_100); });
      expect(within(group).getByText('Sent to your laptop. It takes effect there.')).toBeInTheDocument();
      s.autoStart = { on: true, tag: 'auto', max: 6 };
      await act(async () => { vi.advanceTimersByTime(3_100); });
      await waitFor(() => expect(within(group).queryByText('Sent to your laptop. It takes effect there.')).toBeNull());
    } finally { vi.useRealTimers(); }
  });
});

// Task 16 fix round 1: I1 (typing queues one command), M4 (the switch sends no max) and M5 (no box
// while the laptop's setting has no N) on the website.
describe('Up to N jobs at a time on the website', () => {
  const autoCalls = (s: Site) => s.calls.filter((c) => c.method === 'POST' && c.path === '/api/orbit/auto-start');

  it('typing 1 then 0 and leaving the box queues exactly one command, for 10', async () => {
    go('#/settings/orbit');
    const { s, api } = site({ autoStart: { on: true, tag: 'auto', max: 3 }, autoTakes: false });
    render(<HostedApp api={api} />);
    const group = await screen.findByRole('group', { name: 'Auto start' });
    const box = await within(group).findByRole('spinbutton', { name: 'Jobs at a time' });
    await waitFor(() => expect(box).toHaveValue('3'));
    fireEvent.change(box, { target: { value: '1' } });
    fireEvent.change(box, { target: { value: '10' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(autoCalls(s)).toHaveLength(0);
    fireEvent.focusOut(box);
    expect(await within(group).findByText('Sent to your laptop. It takes effect there.')).toBeInTheDocument();
    expect(autoCalls(s).map((c) => c.body)).toEqual([{ on: true, tag: 'auto', max: 10 }]);
  });

  it('the switch sends no max, and the line goes once the laptop has the change with its own N', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      go('#/settings/orbit');
      const { s, api } = site({ autoStart: { on: true, tag: 'auto', max: 3 } });
      render(<HostedApp api={api} />);
      const group = await screen.findByRole('group', { name: 'Auto start' });
      const box = within(group).getByRole('checkbox', { name: 'Start a job by itself for tickets with this tag' });
      await waitFor(() => expect(box).toBeChecked());
      fireEvent.click(box);
      await waitFor(() => expect(autoCalls(s).map((c) => c.body)).toEqual([{ on: false, tag: 'auto' }]));
      // The laptop keeps N = 3 and mirrors the switch off: that is what was asked, so the line goes.
      await act(async () => { vi.advanceTimersByTime(3_100); });
      await waitFor(() => expect(box).not.toBeChecked());
      await waitFor(() => expect(within(group).queryByText('Sent to your laptop. It takes effect there.')).toBeNull());
      expect(within(group).queryByText('Your laptop did not take this change.')).toBeNull();
      expect(within(group).getByRole('spinbutton', { name: 'Jobs at a time' })).toHaveValue('3');
    } finally { vi.useRealTimers(); }
  });

  it('with a laptop that has no N yet there is no box', async () => {
    go('#/settings/orbit');
    const { api } = site({ autoStart: { on: true, tag: 'auto' } });
    render(<HostedApp api={api} />);
    const group = await screen.findByRole('group', { name: 'Auto start' });
    await waitFor(() => expect(within(group).getByLabelText('Orbit tag')).toHaveValue('auto'));
    expect(within(group).queryByRole('spinbutton', { name: 'Jobs at a time' })).toBeNull();
    expect(group).not.toHaveTextContent('jobs at a time');
  });

  // Fix round 2, N1: the laptop shows the first step while the page waits for the second.
  it('a second step while the laptop shows the first keeps waiting, and ends on the second with no error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      go('#/settings/orbit');
      const { s, api } = site({ autoStart: { on: true, tag: 'auto', max: 3 }, autoTakes: false });
      render(<HostedApp api={api} />);
      const group = await screen.findByRole('group', { name: 'Auto start' });
      const box = await within(group).findByRole('spinbutton', { name: 'Jobs at a time' });
      await waitFor(() => expect(box).toHaveValue('3'));
      fireEvent.click(within(group).getByRole('button', { name: 'One more' }));
      await waitFor(() => expect(autoCalls(s).map((c) => c.body?.max)).toEqual([4]));
      await within(group).findByText('Sent to your laptop. It takes effect there.');
      // He presses + again while the page still waits for 4, and the second step is answered.
      fireEvent.click(within(group).getByRole('button', { name: 'One more' }));
      await waitFor(() => expect(autoCalls(s).map((c) => c.body?.max)).toEqual([4, 5]));
      // The page has its answer and waits for 5: its look after that send has asked the laptop.
      const second = s.calls.map((c) => c.path).lastIndexOf('/api/orbit/auto-start');
      await waitFor(() => expect(s.calls.slice(second + 1).some((c) => c.path === '/api/snapshot')).toBe(true));
      // Only now does the laptop show the first step (4). Before, the laptop's value changed before the
      // second press, so a look of the first wait (the one right after the send, or the 3 second one
      // when the run was slow) could read 4, end that wait and race the second press's answer
      // (task 19 fix round 1, item 7).
      s.autoStart = { on: true, tag: 'auto', max: 4 };
      // The next look reads 4: an earlier step on its way, so the page keeps waiting.
      await act(async () => { vi.advanceTimersByTime(3_100); });
      expect(within(group).queryByText('Your laptop did not take this change.')).toBeNull();
      expect(within(group).getByText('Sent to your laptop. It takes effect there.')).toBeInTheDocument();
      expect(box).toHaveValue('5');
      // The laptop takes 5: the line goes, the box says 5.
      s.autoStart = { on: true, tag: 'auto', max: 5 };
      await act(async () => { vi.advanceTimersByTime(3_100); });
      await waitFor(() => expect(within(group).queryByText('Sent to your laptop. It takes effect there.')).toBeNull());
      expect(within(group).queryByText('Your laptop did not take this change.')).toBeNull();
      expect(box).toHaveValue('5');
    } finally { vi.useRealTimers(); }
  });

  // N2: the switch pressed while a change of N is on its way waits for that N, not the laptop's old one.
  it('the switch pressed while a change of N is on its way waits for that N', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      go('#/settings/orbit');
      const { s, api } = site({ autoStart: { on: true, tag: 'auto', max: 3 }, autoTakes: false });
      render(<HostedApp api={api} />);
      const group = await screen.findByRole('group', { name: 'Auto start' });
      const box = await within(group).findByRole('spinbutton', { name: 'Jobs at a time' });
      await waitFor(() => expect(box).toHaveValue('3'));
      fireEvent.change(box, { target: { value: '6' } });
      fireEvent.focusOut(box);
      await waitFor(() => expect(autoCalls(s)).toHaveLength(1));
      fireEvent.click(within(group).getByRole('checkbox', { name: 'Start a job by itself for tickets with this tag' }));
      await waitFor(() => expect(autoCalls(s).map((c) => c.body)).toEqual([{ on: true, tag: 'auto', max: 6 }, { on: false, tag: 'auto' }]));
      // The laptop takes both: N 6, then the switch off with N kept.
      s.autoStart = { on: false, tag: 'auto', max: 6 };
      await act(async () => { vi.advanceTimersByTime(3_100); });
      await waitFor(() => expect(within(group).queryByText('Sent to your laptop. It takes effect there.')).toBeNull());
      expect(within(group).queryByText('Your laptop did not take this change.')).toBeNull();
      expect(box).toHaveValue('6');
    } finally { vi.useRealTimers(); }
  });

  // N3: after "did not take", the box shows the laptop's N and the same N can be sent again.
  it('after the laptop did not take a change of N, the box shows its N and the same N can be sent again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      go('#/settings/orbit');
      const { s, api } = site({ autoStart: { on: true, tag: 'auto', max: 3 }, autoTakes: false });
      render(<HostedApp api={api} />);
      const group = await screen.findByRole('group', { name: 'Auto start' });
      const box = await within(group).findByRole('spinbutton', { name: 'Jobs at a time' });
      await waitFor(() => expect(box).toHaveValue('3'));
      fireEvent.change(box, { target: { value: '6' } });
      fireEvent.focusOut(box);
      await waitFor(() => expect(autoCalls(s)).toHaveLength(1));
      // The laptop is there but keeps 3 for over a minute: not taken.
      await act(async () => { vi.advanceTimersByTime(63_000); });
      expect(await within(group).findByText('Your laptop did not take this change.')).toBeInTheDocument();
      expect(box).toHaveValue('3');
      fireEvent.change(box, { target: { value: '6' } });
      fireEvent.focusOut(box);
      await waitFor(() => expect(autoCalls(s).map((c) => c.body?.max)).toEqual([6, 6]));
    } finally { vi.useRealTimers(); }
  });

  // Fix round 3, C: a later command carries the switch he last set, not the laptop's mirrored one.
  it('switched off, then N changed before the laptop answers: the N command carries off, and the page ends off with the new N', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      go('#/settings/orbit');
      const { s, api } = site({ autoStart: { on: true, tag: 'auto', max: 3 }, autoTakes: false });
      render(<HostedApp api={api} />);
      const group = await screen.findByRole('group', { name: 'Auto start' });
      const sw = within(group).getByRole('checkbox', { name: 'Start a job by itself for tickets with this tag' });
      const box = await within(group).findByRole('spinbutton', { name: 'Jobs at a time' });
      await waitFor(() => expect(sw).toBeChecked());
      fireEvent.click(sw);
      await waitFor(() => expect(autoCalls(s)).toHaveLength(1));
      fireEvent.change(box, { target: { value: '6' } });
      fireEvent.focusOut(box);
      await waitFor(() => expect(autoCalls(s).map((c) => c.body)).toEqual([{ on: false, tag: 'auto' }, { on: false, tag: 'auto', max: 6 }]));
      // The laptop runs both in order.
      s.autoStart = { on: false, tag: 'auto', max: 6 };
      await act(async () => { vi.advanceTimersByTime(3_100); });
      await waitFor(() => expect(within(group).queryByText('Sent to your laptop. It takes effect there.')).toBeNull());
      expect(within(group).queryByText('Your laptop did not take this change.')).toBeNull();
      expect(sw).not.toBeChecked();
      expect(box).toHaveValue('6');
    } finally { vi.useRealTimers(); }
  });

  it('switched off, then the tag changed before the laptop answers: the tag command carries off', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      go('#/settings/orbit');
      const { s, api } = site({ autoStart: { on: true, tag: 'auto', max: 3 }, autoTakes: false });
      render(<HostedApp api={api} />);
      const group = await screen.findByRole('group', { name: 'Auto start' });
      const sw = within(group).getByRole('checkbox', { name: 'Start a job by itself for tickets with this tag' });
      await waitFor(() => expect(sw).toBeChecked());
      fireEvent.click(sw);
      await waitFor(() => expect(autoCalls(s)).toHaveLength(1));
      const tag = within(group).getByLabelText('Orbit tag');
      fireEvent.change(tag, { target: { value: 'robot' } });
      fireEvent.keyDown(tag, { key: 'Enter' });
      await waitFor(() => expect(autoCalls(s).map((c) => c.body)).toEqual([{ on: false, tag: 'auto' }, { on: false, tag: 'robot' }]));
      s.autoStart = { on: false, tag: 'robot', max: 3 };
      await act(async () => { vi.advanceTimersByTime(3_100); });
      await waitFor(() => expect(within(group).queryByText('Sent to your laptop. It takes effect there.')).toBeNull());
      expect(within(group).queryByText('Your laptop did not take this change.')).toBeNull();
      expect(sw).not.toBeChecked();
    } finally { vi.useRealTimers(); }
  });

  // Minor B: the wait follows the order the commands were sent, not the order the site answered.
  it('when the first command is answered after the second, the page still waits for the last one sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      go('#/settings/orbit');
      let release = () => {};
      const { s, api } = site({ autoStart: { on: true, tag: 'auto', max: 3 }, autoTakes: false, autoHold: new Promise<void>((res) => { release = res; }) });
      render(<HostedApp api={api} />);
      const group = await screen.findByRole('group', { name: 'Auto start' });
      const sw = within(group).getByRole('checkbox', { name: 'Start a job by itself for tickets with this tag' });
      const box = await within(group).findByRole('spinbutton', { name: 'Jobs at a time' });
      await waitFor(() => expect(box).toHaveValue('3'));
      // N to 6: its answer is held. Then the switch: answered at once.
      fireEvent.change(box, { target: { value: '6' } });
      fireEvent.focusOut(box);
      await waitFor(() => expect(autoCalls(s)).toHaveLength(1));
      fireEvent.click(sw);
      await within(group).findByText('Sent to your laptop. It takes effect there.');
      await act(async () => { release(); });
      expect(autoCalls(s).map((c) => c.body)).toEqual([{ on: true, tag: 'auto', max: 6 }, { on: false, tag: 'auto' }]);
      // The laptop ran both in the order sent.
      s.autoStart = { on: false, tag: 'auto', max: 6 };
      await act(async () => { vi.advanceTimersByTime(3_100); });
      await waitFor(() => expect(within(group).queryByText('Sent to your laptop. It takes effect there.')).toBeNull());
      expect(within(group).queryByText('Your laptop did not take this change.')).toBeNull();
      expect(box).toHaveValue('6');
    } finally { vi.useRealTimers(); }
  });
});


// Task 19: the site's Inbox has the laptop's Auto tab from the snapshot's queue, read again with
// the ticket list, and its Mine line says when Auto start is paused, as on the laptop.
describe('the Auto queue on the website', () => {
  const at = (key: string, group: AutoTicket['group'], extra: Partial<AutoTicket> = {}): AutoTicket => ({ key, title: `Sample ticket ${key.slice(6)}`, group, slug: null, reason: null, ...extra });
  const queue = (tickets: AutoTicket[], extra: Partial<AutoQueue> = {}): AutoQueue => ({ on: true, tag: 'auto', max: 5, working: 1, unfinished: 1, ceiling: 10, paused: null, testing: null, tickets, ...extra });
  const items = [ticket(12, { tags: ['auto'] }), ticket(13, { tags: ['auto'] }), ticket(14, { tags: ['auto'] }), ticket(15, { tags: ['auto'] })];
  const row = (key: string) => screen.getAllByRole('row').find((r) => r.getAttribute('data-ticket') === key)!;
  const snapshots = (s: Site) => s.calls.filter((c) => c.path === '/api/snapshot').length;

  it('the site\'s Inbox shows the Auto tab from the snapshot\'s queue', async () => {
    const big = 'The Foreman thinks this ticket is big enough for a stack.';
    const { api } = site({ items, queue: queue([at('ORBIT-13', 'next'), at('ORBIT-12', 'working', { slug: 'orbit-12-x' }), at('ORBIT-14', 'too-big', { slug: 'orbit-14-y', reason: big })]) });
    render(<HostedApp api={api} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Auto' }));
    expect(within(screen.getByRole('region', { name: 'Next up' })).getByText('ORBIT-13')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Auto is working on these' })).getByRole('link', { name: 'Sample ticket 12' })).toHaveAttribute('href', '#/job/orbit-12-x');
    const tooBig = screen.getByRole('region', { name: 'Too big for Auto' });
    expect(within(tooBig).getByRole('link', { name: 'Sample ticket 14' })).toHaveAttribute('href', '#/job/orbit-14-y');
    expect(tooBig).toHaveTextContent(big);
    // Each group only when it has rows: no start failed here.
    expect(screen.queryByRole('region', { name: 'Couldn’t start' })).toBeNull();
    cleanup();
    const all = site({ items, queue: queue([at('ORBIT-13', 'next'), at('ORBIT-12', 'working', { slug: 'orbit-12-x' }), at('ORBIT-14', 'too-big', { slug: 'orbit-14-y', reason: big }), at('ORBIT-15', 'failed', { reason: 'The laptop was off.' })]) });
    render(<HostedApp api={all.api} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Auto' }));
    expect([...document.querySelectorAll('.sb-inbox-auto-group')].map((g) => g.getAttribute('aria-label'))).toEqual(['Next up', 'Auto is working on these', 'Too big for Auto', 'Couldn’t start']);
    expect(screen.getByRole('region', { name: 'Couldn’t start' })).toHaveTextContent('The laptop was off.');
  });

  it('no queue in the snapshot: no Auto tab', async () => {
    const { s, api } = site({ items });
    render(<HostedApp api={api} />);
    await screen.findAllByRole('table');
    await waitFor(() => expect(snapshots(s)).toBeGreaterThan(0));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByRole('tab', { name: 'Mine' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Auto' })).toBeNull();
  });

  it('Mine marks a ticket Auto is working on', async () => {
    const { api } = site({ items, queue: queue([at('ORBIT-12', 'working', { slug: 'orbit-12-x' }), at('ORBIT-13', 'next')]) });
    render(<HostedApp api={api} />);
    await screen.findAllByRole('table');
    expect(await within(row('ORBIT-12')).findByText('Auto is working on this')).toBeInTheDocument();
    expect(within(row('ORBIT-13')).queryByText('Auto is working on this')).toBeNull();
  });

  it('the Auto tab shows the paused line on the site', async () => {
    const { api } = site({ items, queue: queue([at('ORBIT-13', 'next')], { paused: 'limit' }) });
    render(<HostedApp api={api} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Auto' }));
    expect(document.querySelector('.sb-inbox-auto .sb-auto-paused')).toHaveTextContent('Auto is paused: the usage limit is near');
  });

  it('the website\'s Mine line says Auto start is paused when the queue says so, in the laptop\'s words', async () => {
    const { api } = site({ items, autoStart: { on: true, tag: 'auto' }, queue: queue([], { paused: 'orbit' }) });
    render(<HostedApp api={api} />);
    expect(await screen.findByText(AUTO_PAUSED.orbit)).toBeInTheDocument();
    expect(screen.queryByText(/Auto start is on:/)).toBeNull();
    cleanup();
    const limit = site({ items, autoStart: { on: true, tag: 'auto' }, queue: queue([], { paused: 'limit' }) });
    render(<HostedApp api={limit.api} />);
    expect(await screen.findByText(AUTO_PAUSED.limit)).toBeInTheDocument();
    cleanup();
    // Not paused: the Auto start line, as before.
    const on = site({ items, autoStart: { on: true, tag: 'auto' }, queue: queue([]) });
    render(<HostedApp api={on.api} />);
    expect(await screen.findByText('Auto start is on: tickets tagged "auto" start by themselves, up to 5 at a time.')).toBeInTheDocument();
  });

  it('the queue is read again when the ticket list refreshes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { s, api } = site({ items, queue: queue([at('ORBIT-12', 'next'), at('ORBIT-13', 'next')]) });
      render(<HostedApp api={api} />);
      await screen.findAllByRole('table');
      await screen.findByRole('tab', { name: 'Auto' });
      expect(within(row('ORBIT-12')).queryByText('Auto is working on this')).toBeNull();
      // Auto starts ORBIT-12 on the laptop: the next tick of the list reads the queue too.
      s.queue = queue([at('ORBIT-12', 'working', { slug: 'orbit-12-x' }), at('ORBIT-13', 'next')]);
      await act(async () => { vi.advanceTimersByTime(HOSTED_READ_MS); });
      expect(await within(row('ORBIT-12')).findByText('Auto is working on this')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('tab', { name: 'Auto' }));
      expect(within(screen.getByRole('region', { name: 'Auto is working on these' })).getByRole('link', { name: 'Sample ticket 12' })).toHaveAttribute('href', '#/job/orbit-12-x');
    } finally { vi.useRealTimers(); }
  });

  // Fix round 1 (M4): reads that answer out of order. Only the newest read counts.
  it('two snapshot reads that answer out of order: the older never undoes the newer', async () => {
    let first = () => {};
    const { s, api } = site({ items, queue: queue([at('ORBIT-12', 'next')]), snapshotHolds: [new Promise<void>((r) => { first = r; })] });
    const reads: Promise<unknown>[] = [];
    const tracked = { ...api, get: <T,>(path: string) => { const p = api.get<T>(path); if (path === '/api/snapshot') reads.push(p); return p; } } as typeof api;
    render(<HostedApp api={tracked} />);
    await screen.findAllByRole('table');
    await waitFor(() => expect(reads).toHaveLength(1));
    // The read on open is held, with ORBIT-12 next. Auto starts it; Read now reads again, and that answer comes first.
    s.queue = queue([at('ORBIT-12', 'working', { slug: 'orbit-12-x' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Read now' }));
    expect(await within(row('ORBIT-12')).findByText('Auto is working on this')).toBeInTheDocument();
    // Then the older answer lands, and everything after it has run: it is dropped.
    await act(async () => { first(); await reads[0]; await new Promise((r) => { setTimeout(r, 0); }); });
    expect(within(row('ORBIT-12')).getByText('Auto is working on this')).toBeInTheDocument();
  });

  it('Read now, and the page coming back into view, read the queue again', async () => {
    const { s, api } = site({ items, queue: queue([at('ORBIT-12', 'next')]) });
    render(<HostedApp api={api} />);
    await screen.findByRole('tab', { name: 'Auto' });
    s.queue = queue([at('ORBIT-12', 'working', { slug: 'orbit-12-x' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Read now' }));
    expect(await within(row('ORBIT-12')).findByText('Auto is working on this')).toBeInTheDocument();
    s.queue = queue([at('ORBIT-12', 'next')]);
    const before = snapshots(s);
    const shown = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(snapshots(s)).toBe(before + 1));
      await waitFor(() => expect(within(row('ORBIT-12')).queryByText('Auto is working on this')).toBeNull());
    } finally { shown.mockRestore(); }
  });
});
