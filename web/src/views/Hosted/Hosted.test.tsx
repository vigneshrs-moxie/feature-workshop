// The hosted site's screens (packet 2A) against a pretend site: sign-in and its refusals, Jobs from
// the mirror by laptop, the placeholder for pages not built yet, Pair this laptop, Laptops and People.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { createApi } from '../../api/client';
import { HostedApp } from './HostedApp';
import { hostedPage } from './mode';
import { parseHostedHash, returnTo } from './route';
import type { HostedPerson, LaptopJobs, PersonRow } from './types';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const OLIVE: HostedPerson = { id: 1, name: 'Olive Owner', email: 'olive.owner@example.test', role: 'owner' };
const MIA: HostedPerson = { id: 2, name: 'Mia Member', email: 'mia.member@example.test', role: 'member' };

const job = (id: number, laptopId: number, title: string, extra = {}) => ({ id, laptopId, slug: title.toLowerCase().replace(/\W+/g, '-'), title, ticket: null, stage: 'build', state: 'working', stateWords: 'Working', now: 'Builder: Writing the tests', updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(), ...extra });
const laptop = (id: number, name: string, online: boolean, jobs: ReturnType<typeof job>[]): LaptopJobs => ({ id, name, os: 'macOS', version: '0.1.0', pairedAt: new Date(Date.now() - 86_400_000).toISOString(), lastSeenAt: new Date(Date.now() - (online ? 5_000 : 600_000)).toISOString(), online, jobs });

interface Site { person: HostedPerson | null; laptops: LaptopJobs[]; people: PersonRow[]; calls: { method: string; path: string; body?: unknown }[]; jobs401?: boolean }

function site(over: Partial<Site> = {}) {
  const s: Site = { person: OLIVE, laptops: [], people: [], calls: [], ...over };
  const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    s.calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === '/api/meta') return json(200, { mode: 'hosted', person: s.person, signIn: '/api/auth/start', missing: [] });
    if (path === '/api/jobs') { if (s.jobs401) s.person = null; } if (path === '/api/jobs') return s.jobs401 ? json(401, { error: 'Sign in first.', signIn: true }) : json(200, { laptops: s.laptops });
    if (path === '/api/laptops' && method === 'GET') return json(200, { laptops: s.laptops.map(({ jobs: _jobs, ...l }) => l) });
    if (path.startsWith('/api/laptops/') && method === 'DELETE') { s.laptops = s.laptops.filter((l) => `/api/laptops/${l.id}` !== path); return json(200, { laptops: s.laptops }); }
    if (path === '/api/pair/ABCD2345') return json(200, { code: 'ABCD2345', name: 'Mia’s laptop', os: 'Windows', state: 'waiting', expiresAt: new Date(Date.now() + 600_000).toISOString() });
    if (path === '/api/pair/ABCD2345/approve') return json(200, { code: 'ABCD2345', name: 'Mia’s laptop', os: 'Windows', state: 'approved', expiresAt: '' });
    if (path === '/api/pair/ZZZZ9999') return json(404, { error: 'There is no pairing with that code.' });
    if (path === '/api/people' && method === 'GET') return json(200, { people: s.people });
    const role = /^\/api\/people\/(\d+)\/role$/.exec(path);
    if (role) { s.people = s.people.map((p) => (p.id === Number(role[1]) ? { ...p, role: (JSON.parse(String(init?.body)) as { role: PersonRow['role'] }).role } : p)); return json(200, { people: s.people }); }
    if (path === '/api/auth/logout') { s.person = null; return json(200, { ok: true }); }
    return json(404, { error: 'There is nothing at this address.' });
  }) as typeof globalThis.fetch;
  return { s, api: createApi({ fetch, hosted: true }) };
}

const go = (hash: string) => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); };

beforeEach(() => { window.location.hash = '#/'; });
afterEach(() => { cleanup(); document.querySelector('meta[name="dashboard-mode"]')?.remove(); });

describe('the hosted site', () => {
  it('is told apart by its page: the build’s mark, and App opens the hosted screens then', async () => {
    expect(hostedPage()).toBe(false);
    const m = document.createElement('meta');
    m.name = 'dashboard-mode';
    m.content = 'hosted';
    document.head.append(m);
    expect(hostedPage()).toBe(true);
    const { api } = site({ person: null });
    render(<App api={api} />);
    expect(await screen.findByRole('link', { name: /Sign in with Google/ })).toBeTruthy();
  });

  it('signed out: one button, Sign in with Google, that comes back to where you were', async () => {
    go('#/pair/ABCD2345');
    const { api } = site({ person: null });
    render(<HostedApp api={api} />);
    const link = await screen.findByRole('link', { name: /Sign in with Google/ });
    expect(link.getAttribute('href')).toBe(`/api/auth/start?return=${encodeURIComponent('/#/pair/ABCD2345')}`);
    expect(screen.getByText(/Sign in to pair your laptop/)).toBeTruthy();
  });

  it('a deployment with no database (a preview) says so calmly, with no sign-in and no error', async () => {
    const fetch = (async () => json(200, { mode: 'hosted', person: null, signIn: '/api/auth/start', missing: ['GOOGLE_CLIENT_ID', 'DATABASE_URL'], noDatabase: true })) as typeof globalThis.fetch;
    render(<HostedApp api={createApi({ fetch, hosted: true })} />);
    expect(await screen.findByRole('heading', { name: 'This deployment has no database' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Sign in with Google/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refused sign-in says why in words: “This site is for Moxie accounts only”', async () => {
    go('#/sign-in?problem=domain');
    const { api } = site({ person: null });
    render(<HostedApp api={api} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This site is for Moxie accounts only');
    expect(screen.getByRole('link', { name: /Sign in with Google/ }).getAttribute('href')).toBe('/api/auth/start?return=%2F');
  });

  it('Jobs: one laptop’s jobs, with the laptop online or not in words', async () => {
    const { api } = site({ laptops: [laptop(1, 'Olive’s Mac', true, [job(1, 1, 'Add export'), job(2, 1, 'Tidy button', { ticket: 'ORBIT-479', state: 'needs-you', stateWords: 'Needs you: the plan', now: null })])] });
    render(<HostedApp api={api} />);
    expect(await screen.findByText('Add export')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'On Olive’s Mac' })).toBeTruthy();
    const tidy = screen.getByText('Tidy button').closest('li')!;
    expect(within(tidy).getByText('ORBIT-479')).toBeTruthy();
    expect(within(tidy).getByText('Needs you')).toBeTruthy();
    expect(within(tidy).getByText('Laptop online')).toBeTruthy();
    expect(screen.getByText('Builder: Writing the tests')).toBeTruthy();
  });

  it('Jobs: grouped by laptop when there is more than one; an offline laptop says so', async () => {
    const { api } = site({ laptops: [laptop(1, 'Olive’s Mac', true, [job(1, 1, 'Add export')]), laptop(2, 'Olive’s spare', false, [job(3, 2, 'Nightly export')])] });
    render(<HostedApp api={api} />);
    const spare = await screen.findByRole('region', { name: 'Jobs on Olive’s spare' });
    expect(within(spare).getByRole('heading', { name: 'Olive’s spare' })).toBeTruthy();
    expect(within(spare).getByText(/Laptop offline · seen/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Jobs on Olive’s Mac' })).getByText('Add export')).toBeTruthy();
  });

  it('Jobs with no laptop yet: how to pair one, with this site’s address', async () => {
    const { api } = site();
    render(<HostedApp api={api} />);
    expect(await screen.findByText('Pair a laptop to see your jobs here')).toBeTruthy();
    expect(screen.getByText(`ground-control login --site ${window.location.origin}`)).toBeTruthy();
  });

  it('a page the site doesn’t serve yet is a calm placeholder, never an error', async () => {
    for (const [hash, title] of [['#/job/add-export/screens', 'A job’s screens'], ['#/stacks/build', 'Stacks'], ['#/telemetry', 'Telemetry']] as const) {
      go(hash);
      const { api } = site();
      render(<HostedApp api={api} />);
      expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
      expect(screen.getByText('Open this on your laptop for now')).toBeTruthy();
      expect(screen.getByText('The hosted site shows it once this part is built.')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      cleanup();
    }
  });

  it('the session ending (a 401) brings the sign-in back', async () => {
    const { api } = site({ jobs401: true });
    render(<HostedApp api={api} />);
    expect(await screen.findByRole('link', { name: /Sign in with Google/ })).toBeTruthy();
  });

  it('Pair this laptop: the laptop’s name, system and code, then one press', async () => {
    go('#/pair/abcd2345');
    const { s, api } = site({ person: MIA });
    render(<HostedApp api={api} />);
    expect(await screen.findByText('Mia’s laptop')).toBeTruthy();
    expect(screen.getByText('Windows')).toBeTruthy();
    expect(screen.getByText('ABCD2345')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pair this laptop' }));
    expect(await screen.findByText(/Paired\. The laptop finishes by itself/)).toBeTruthy();
    expect(s.calls.find((c) => c.path === '/api/pair/ABCD2345/approve')?.method).toBe('POST');
  });

  it('Pair this laptop with a code nobody is waiting with says so', async () => {
    go('#/pair/ZZZZ9999');
    const { api } = site();
    render(<HostedApp api={api} />);
    expect((await screen.findByRole('alert')).textContent).toContain('No laptop is waiting with code ZZZZ9999');
  });

  it('Settings → Laptops: online or not in words; Remove asks once more, then removes', async () => {
    go('#/settings/laptops');
    const { s, api } = site({ laptops: [laptop(4, 'Olive’s Mac', true, []), laptop(5, 'Old laptop', false, [])] });
    render(<HostedApp api={api} />);
    const row = (await screen.findByText('Old laptop')).closest('li')!;
    expect(within(row).getByText(/Offline · last seen/)).toBeTruthy();
    expect(within(screen.getByText('Olive’s Mac').closest('li')!).getByText('Online')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Remove Old laptop' }));
    expect(within(row).getByText(/Its token stops working at once/)).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Remove it' }));
    await waitFor(() => expect(screen.queryByText('Old laptop')).toBeNull());
    expect(s.calls.some((c) => c.method === 'DELETE' && c.path === '/api/laptops/5')).toBe(true);
  });

  it('Settings → People: the owner sets manager or member; anyone else sees the roles in words', async () => {
    go('#/settings/people');
    const people: PersonRow[] = [{ ...OLIVE, lastSignInAt: null, you: true }, { ...MIA, lastSignInAt: null, you: false }];
    const { s, api } = site({ people });
    render(<HostedApp api={api} />);
    const mia = within(await screen.findByRole('list', { name: 'People' })).getByText('Mia Member').closest('li')!;
    fireEvent.click(within(mia).getByRole('radio', { name: 'Manager' }));
    await waitFor(() => expect(within(mia).getByRole('radio', { name: 'Manager' }).getAttribute('aria-checked')).toBe('true'));
    expect(s.calls.find((c) => c.path === '/api/people/2/role')?.body).toEqual({ role: 'manager' });
    expect(within(within(screen.getByRole('list', { name: 'People' })).getByText('Olive Owner').closest('li')!).getByText('Owner')).toBeTruthy();
    cleanup();
    const member = site({ person: MIA, people });
    render(<HostedApp api={member.api} />);
    const row = within(await screen.findByRole('list', { name: 'People' })).getByText('Mia Member').closest('li')!;
    expect(within(row).getByText('Member')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText(/Only the owner changes roles/)).toBeTruthy();
  });

  it('Sign out ends the session and shows Sign in', async () => {
    const { s, api } = site();
    render(<HostedApp api={api} />);
    await screen.findByText('Pair a laptop to see your jobs here');
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]);
    expect(await screen.findByRole('link', { name: /Sign in with Google/ })).toBeTruthy();
    expect(s.calls.some((c) => c.path === '/api/auth/logout' && c.method === 'POST')).toBe(true);
  });
});

describe('the hosted routes', () => {
  it('reads the laptop app’s addresses', () => {
    expect(parseHostedHash('#/')).toEqual({ name: 'jobs' });
    expect(parseHostedHash('#/jobs')).toEqual({ name: 'jobs' });
    expect(parseHostedHash('#/pair/abcd2345')).toEqual({ name: 'pair', code: 'ABCD2345' });
    expect(parseHostedHash('#/sign-in?problem=domain')).toEqual({ name: 'sign-in', problem: 'domain' });
    expect(parseHostedHash('#/settings')).toEqual({ name: 'laptops' });
    expect(parseHostedHash('#/settings/people')).toEqual({ name: 'people' });
    expect(parseHostedHash('#/job/x/stage/plan')).toEqual({ name: 'mirror', route: { name: 'stage', slug: 'x', stop: 'plan' } });
    expect(parseHostedHash('#/desk')).toEqual({ name: 'mirror', route: { name: 'desk' } });
    expect(parseHostedHash('#/stack/s/part/2')).toEqual({ name: 'mirror', route: { name: 'stack-part', slug: 's', n: 2 } });
    expect(parseHostedHash('#/job/x/screens')).toEqual({ name: 'later', page: 'A job’s screens' });
    expect(parseHostedHash('#/settings/look')).toEqual({ name: 'later', page: 'This part of Settings' });
    expect(parseHostedHash('#/no-such-page')).toEqual({ name: 'jobs' });
    expect(returnTo('#/pair/ABCD2345')).toBe('/#/pair/ABCD2345');
    expect(returnTo('#/sign-in?problem=state')).toBe('/');
  });
});
