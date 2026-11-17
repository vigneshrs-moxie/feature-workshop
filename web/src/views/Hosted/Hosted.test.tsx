// The hosted site's screens (packet 2A) against a pretend site: sign-in and its refusals, Jobs from
// the mirror by laptop, the placeholder for pages not built yet, Pair this laptop, Laptops and People.
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { createApi } from '../../api/client';
import type { AutoQueue, Job } from '../../api/types';
import { JOBS_TAB_KEY } from '../../home/autoTab';
import { job as card, snapshot as board } from '../../state/test-fixtures';
import { HostedApp } from './HostedApp';
import { FIRST_HOLD_MS, REFRESH_MS } from './HostedJobsPage';
import { hostedPage } from './mode';
import { parseHostedHash, returnTo } from './route';
import type { HostedPerson, LaptopJobs, PersonRow } from './types';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const OLIVE: HostedPerson = { id: 1, name: 'Olive Owner', email: 'olive.owner@example.test', role: 'owner' };
const MIA: HostedPerson = { id: 2, name: 'Mia Member', email: 'mia.member@example.test', role: 'member' };

const job = (id: number, laptopId: number, title: string, extra = {}) => ({ id, laptopId, slug: title.toLowerCase().replace(/\W+/g, '-'), title, ticket: null, stage: 'build', state: 'working', stateWords: 'Working', now: 'Builder: Writing the tests', updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(), ...extra });
const laptop = (id: number, name: string, online: boolean, jobs: ReturnType<typeof job>[]): LaptopJobs => ({ id, name, os: 'macOS', version: '0.1.0', pairedAt: new Date(Date.now() - 86_400_000).toISOString(), lastSeenAt: new Date(Date.now() - (online ? 5_000 : 600_000)).toISOString(), online, jobs });

interface Site { person: HostedPerson | null; laptops: LaptopJobs[]; people: PersonRow[]; calls: { method: string; path: string; body?: unknown }[]; jobs401?: boolean; /** The laptop's snapshot the site serves; missing: none (404); 'fails': a 500. */ snapshot?: unknown; /** The snapshot answers only once this settles. */ snapshotHold?: Promise<void>; /** The snapshot answers 30 ms after the jobs list has. */ snapshotAfterJobs?: boolean; /** When the site last answered /api/jobs (performance.now()). */ jobsAt?: number }

function site(over: Partial<Site> = {}) {
  const s: Site = { person: OLIVE, laptops: [], people: [], calls: [], ...over };
  let jobsAnswered = () => {};
  const afterJobs = new Promise<void>((r) => { jobsAnswered = r; }).then(() => new Promise<void>((r) => { setTimeout(r, 30); }));
  const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    s.calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === '/api/meta') return json(200, { mode: 'hosted', person: s.person, signIn: '/api/auth/start', missing: [] });
    if (path === '/api/jobs') { s.jobsAt = performance.now(); jobsAnswered(); }
    if (path === '/api/jobs') { if (s.jobs401) s.person = null; } if (path === '/api/jobs') return s.jobs401 ? json(401, { error: 'Sign in first.', signIn: true }) : json(200, { laptops: s.laptops });
    if (path === '/api/snapshot' && s.snapshotHold) await s.snapshotHold;
    if (path === '/api/snapshot' && s.snapshotAfterJobs) await afterJobs;
    if (path === '/api/snapshot' && s.snapshot !== undefined) return s.snapshot === 'fails' ? json(500, { error: 'The site couldn’t read the laptop’s board.' }) : json(200, s.snapshot);
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
    expect(screen.getByText(`starbase login --site ${window.location.origin}`)).toBeTruthy();
  });

  it('a page the site doesn’t serve yet is a calm placeholder, never an error', async () => {
    for (const [hash, title] of [['#/job/add-export/screens', 'A job’s screens'], ['#/stacks/build', 'Stacks'], ['#/settings/workflow', 'This part of Settings']] as const) {
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

// Task 19 (design section 10): the site's Jobs page reads the laptop's snapshot too, and joins its
// jobs to the site's rows by slug. With no Auto queue in it, or no snapshot, it is today's list.
describe('the site’s Jobs page: Yours and Auto', () => {
  const QUEUE: AutoQueue = { on: true, tag: 'auto', max: 5, working: 1, unfinished: 2, ceiling: 10, paused: null, testing: null, tickets: [] };
  const rows = (...titles: string[]) => [laptop(1, 'Olive’s Mac', true, titles.map((t, i) => job(i + 1, 1, t)))];
  const working = card('auto-builds-this', 'running', { title: 'Auto builds this', stage: 'implement', lane: 'working', laneReason: 'Building step 2', auto: { on: true, ran: true, group: 'working' } });
  const ready = card('auto-finished-this', 'idle', { title: 'Auto finished this', stage: 'ship', lane: 'in-review', level: 3, auto: { on: false, ran: true, group: 'ready', risky: 2, finished: new Date().toISOString() } });
  const mine = card('your-own-job', 'running', { title: 'Your own job', stage: 'build', lane: 'working' });
  const stopped = card('auto-stopped-here', 'needs-you', { title: 'Auto stopped here', stage: 'plan', lane: 'needs-you', laneReason: 'Auto stopped: the Foreman says it is blocked', auto: { on: true, ran: true, stopped: { reason: 'the Foreman says it is blocked' }, group: 'needs-you' } });
  const big = card('auto-set-this-aside', 'needs-you', { title: 'Auto set this aside', stage: 'brief', lane: 'needs-you', auto: { on: false, ran: true, group: 'needs-you', tooBig: { at: new Date().toISOString(), reason: 'The Foreman thinks this ticket is big enough for a stack.' } } });
  /** The laptop's snapshot; null: one from an older laptop, with no autoQueue at all. */
  const snap = (jobs: Job[], autoQueue: AutoQueue | null = QUEUE) => board({ jobs, ...(autoQueue ? { autoQueue } : {}) });
  const tab = (name: string) => screen.getByRole('tab', { name });
  const count = (name: string) => tab(name).querySelector('.seg-count')?.textContent;
  /** Waits until the snapshot was asked for and the list is drawn: on the first load the page draws it only once that read has answered or failed. */
  const snapshotRead = async (s: Site) => {
    await waitFor(() => expect(s.calls.some((c) => c.path === '/api/snapshot')).toBe(true));
    await screen.findByRole('region', { name: /^Jobs on / });
  };
  /** Watches the page from before it is drawn: whether `seen` was ever true after any change to it. */
  const everShown = (seen: () => boolean) => {
    let ever = false;
    const o = new MutationObserver(() => { ever = ever || seen(); });
    o.observe(document.body, { childList: true, subtree: true, characterData: true });
    return { get ever() { return ever; }, stop: () => o.disconnect() };
  };
  const snapshots = (s: Site) => s.calls.filter((c) => c.path === '/api/snapshot').length;

  afterEach(() => { localStorage.removeItem(JOBS_TAB_KEY); });

  it('the site\'s Jobs page shows Yours and Auto from the snapshot', async () => {
    const { api } = site({ laptops: rows('Auto builds this', 'Auto finished this', 'Your own job'), snapshot: snap([working, ready, mine]) });
    render(<HostedApp api={api} />);
    expect(await screen.findByRole('tab', { name: 'Yours' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tablist', { name: 'Jobs' })).toBeInTheDocument();
    expect(count('Yours')).toBe('1');
    expect(count('Auto')).toBe('2');
    const mac = screen.getByRole('region', { name: 'Jobs on Olive’s Mac' });
    expect(within(mac).getByText('Your own job')).toBeInTheDocument();
    expect(within(mac).queryByText('Auto builds this')).toBeNull();
    expect(within(mac).queryByText('Auto finished this')).toBeNull();
    fireEvent.click(tab('Auto'));
    expect(tab('Auto')).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('region', { name: 'Working · 1 of 5' })).getByText('Auto builds this')).toBeInTheDocument();
    const readyGroup = screen.getByRole('region', { name: 'Ready for you to try, 1' });
    expect(within(readyGroup).getByRole('heading', { name: 'Ready for you to try' })).toBeInTheDocument();
    expect(within(readyGroup).getByText('Auto finished this')).toBeInTheDocument();
    expect(within(readyGroup).getByText('L3')).toBeInTheDocument();
    expect(within(readyGroup).getByText('2 risky calls')).toBeInTheDocument();
    expect(screen.queryByText('Your own job')).toBeNull();
  });

  it('a job that needs you under Auto says why', async () => {
    localStorage.setItem(JOBS_TAB_KEY, 'auto');
    const { api } = site({ laptops: rows('Auto stopped here', 'Auto set this aside'), snapshot: snap([stopped, big]) });
    render(<HostedApp api={api} />);
    const need = await screen.findByRole('region', { name: 'Needs you, 2' });
    const row = (name: string) => within(need).getByRole('link', { name }).closest('li')!;
    expect(row('Auto stopped here')).toHaveTextContent('Auto stopped: the Foreman says it is blocked');
    expect(within(row('Auto set this aside')).getByText('Too big for Auto')).toBeInTheDocument();
    expect(row('Auto set this aside')).toHaveTextContent('The Foreman thinks this ticket is big enough for a stack.');
  });

  it('no queue in the snapshot: today\'s list, no tabs', async () => {
    // An older laptop: no autoQueue. Even a job with a group, and Auto remembered as the tab, changes nothing.
    localStorage.setItem(JOBS_TAB_KEY, 'auto');
    const { s, api } = site({ laptops: rows('Auto builds this', 'Your own job'), snapshot: snap([working, mine], null) });
    render(<HostedApp api={api} />);
    expect(await screen.findByText('Auto builds this')).toBeInTheDocument();
    await snapshotRead(s);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Your own job')).toBeInTheDocument();
    expect(screen.getByText('Auto builds this')).toBeInTheDocument();
    expect(screen.getByText('2 open jobs')).toBeInTheDocument();
  });

  it('the snapshot fails to load: today\'s list, no tabs', async () => {
    const { s, api } = site({ laptops: rows('Auto builds this', 'Your own job'), snapshot: 'fails' });
    render(<HostedApp api={api} />);
    expect(await screen.findByText('Auto builds this')).toBeInTheDocument();
    await snapshotRead(s);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Your own job')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the chosen tab is remembered', async () => {
    const { api } = site({ laptops: rows('Auto builds this', 'Your own job'), snapshot: snap([working, mine]) });
    render(<HostedApp api={api} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Auto' }));
    expect(localStorage.getItem(JOBS_TAB_KEY)).toBe('auto');
    cleanup();
    const again = site({ laptops: rows('Auto builds this', 'Your own job'), snapshot: snap([working, mine]) });
    render(<HostedApp api={again.api} />);
    expect(await screen.findByRole('tab', { name: 'Auto' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Working · 1 of 5' })).toBeInTheDocument();
    fireEvent.click(tab('Yours'));
    expect(localStorage.getItem(JOBS_TAB_KEY)).toBeNull();
  });

  it('an Auto job\'s row opens its job page on the site', async () => {
    localStorage.setItem(JOBS_TAB_KEY, 'auto');
    const { api } = site({ laptops: rows('Auto builds this', 'Auto stopped here'), snapshot: snap([working, stopped]) });
    render(<HostedApp api={api} />);
    await screen.findByRole('region', { name: 'Needs you, 1' });
    for (const [name, slug] of [['Auto builds this', 'auto-builds-this'], ['Auto stopped here', 'auto-stopped-here']]) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('href', `#/job/${slug}`);
      expect(parseHostedHash(link.getAttribute('href')!)).toEqual({ name: 'mirror', route: { name: 'job', slug } });
      // No quick look on the site: the row is the link to the job.
      expect(link.closest('li')).not.toHaveClass('can-peek');
    }
  });

  // Fix round 1 (I2): the first load waits for the first snapshot read, but never longer than FIRST_HOLD_MS.
  it('a snapshot that never answers shows today\'s list after the cap', async () => {
    // And when it does answer at last, the tabs come with it.
    let answer = () => {};
    const { s, api } = site({ laptops: rows('Auto builds this', 'Your own job'), snapshot: snap([working, mine]), snapshotHold: new Promise<void>((r) => { answer = r; }) });
    render(<HostedApp api={api} />);
    expect(await screen.findByText('Your own job', undefined, { timeout: 3000 })).toBeInTheDocument();
    // Not before the cap: the list waited that long after the site answered it.
    expect(performance.now() - s.jobsAt!).toBeGreaterThanOrEqual(FIRST_HOLD_MS);
    expect(screen.getByText('Auto builds this')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    await act(async () => { answer(); });
    expect(await screen.findByRole('tab', { name: 'Yours' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Auto builds this')).toBeNull();
    expect(screen.getByText('Your own job')).toBeInTheDocument();
  });

  it('at phone width the groups come one after another', async () => {
    localStorage.setItem(JOBS_TAB_KEY, 'auto');
    const { api } = site({ laptops: rows('Auto builds this', 'Auto stopped here', 'Auto finished this'), snapshot: snap([working, stopped, ready]) });
    render(<HostedApp api={api} />);
    await screen.findByRole('region', { name: 'Needs you, 1' });
    const groups = [...document.querySelectorAll('.sb-auto-group')].map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Working · 1 of 5', 'Needs you, 1', 'Ready for you to try, 1']);
    // At 760 px and under: one column for the groups, and the tabs take the full width on a row of their own.
    const phone = (file: string, selector: string) => {
      const css = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const blocks = [...css.matchAll(/@media \(max-width: 760px\) \{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)].map((m) => m[1]);
      return blocks.flatMap((b) => [...b.matchAll(/([^{}]+)\{([^{}]*)\}/g)]).filter((m) => m[1].split(',').map((x) => x.trim()).includes(selector)).map((m) => m[2]).join(';');
    };
    expect(phone('../../app/pages.css', '.sb-auto-groups')).toMatch(/grid-template-columns: minmax\(0, 1fr\)/);
    expect(screen.getByRole('tablist', { name: 'Jobs' })).toHaveClass('sb-hosted-jobs-tabs');
    expect(phone('./hosted.css', '.page-head .sb-hosted-jobs-tabs')).toMatch(/width: 100%/);
    expect(phone('./hosted.css', '.sb-hosted-jobs-tabs .seg-tab')).toMatch(/flex: 1/);
  });

  // Fix round 1 (I2): the first load is drawn once, already split, on the remembered tab.
  it('with Auto remembered, the list is not shown and then replaced', async () => {
    localStorage.setItem(JOBS_TAB_KEY, 'auto');
    const listed = everShown(() => document.querySelector('.hosted-laptops') !== null);
    try {
      const { api } = site({ laptops: rows('Auto builds this', 'Your own job'), snapshot: snap([working, mine]), snapshotAfterJobs: true });
      render(<HostedApp api={api} />);
      expect(await screen.findByRole('region', { name: 'Working · 1 of 5' })).toBeInTheDocument();
      expect(tab('Auto')).toHaveAttribute('aria-selected', 'true');
      expect(listed.ever).toBe(false);
    } finally { listed.stop(); }
  });

  it('with Yours remembered and one Auto job, that job\'s row is never drawn under Yours', async () => {
    const drawn = everShown(() => Boolean(document.querySelector('.hosted-laptops')?.textContent?.includes('Auto builds this')));
    try {
      const { api } = site({ laptops: rows('Auto builds this', 'Your own job'), snapshot: snap([working, mine]), snapshotAfterJobs: true });
      render(<HostedApp api={api} />);
      expect(await screen.findByRole('tab', { name: 'Yours' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Your own job')).toBeInTheDocument();
      expect(drawn.ever).toBe(false);
    } finally { drawn.stop(); }
  });

  // Fix round 1 (I1): the snapshot is read with the list, on its 15 second tick, and never streamed.
  it('the tabs follow a snapshot that changes on the next tick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { s, api } = site({ laptops: rows('Auto builds this', 'Auto finished this', 'Your own job'), snapshot: snap([working, mine]) });
      render(<HostedApp api={api} />);
      await screen.findByRole('tab', { name: 'Yours' });
      expect(count('Yours')).toBe('2');
      expect(count('Auto')).toBe('1');
      // Auto finishes a job on the laptop: the next tick's snapshot puts it under Ready.
      s.snapshot = snap([working, ready, mine]);
      await act(async () => { vi.advanceTimersByTime(REFRESH_MS); });
      await waitFor(() => expect(count('Auto')).toBe('2'));
      expect(count('Yours')).toBe('1');
      expect(screen.queryByText('Auto finished this')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('the Jobs page opens no live stream', async () => {
    const opened: string[] = [];
    vi.stubGlobal('EventSource', class { readyState = 0; onopen = null; onmessage = null; onerror = null; constructor(url: string) { opened.push(url); } addEventListener() {} close() {} });
    try {
      const { s, api } = site({ laptops: rows('Auto builds this', 'Your own job'), snapshot: snap([working, mine]) });
      render(<HostedApp api={api} />);
      await screen.findByRole('tab', { name: 'Yours' });
      // Whatever would follow the snapshot (a store's stream opens right after it) has had its turn.
      await act(async () => {});
      expect(opened).toEqual([]);
      expect(s.calls.some((c) => c.path.startsWith('/api/events'))).toBe(false);
      expect(snapshots(s)).toBe(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('a snapshot that arrives and later fails keeps the tabs and moves nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { s, api } = site({ laptops: rows('Auto builds this', 'Your own job'), snapshot: snap([working, mine]) });
      render(<HostedApp api={api} />);
      await screen.findByRole('tab', { name: 'Yours' });
      s.snapshot = 'fails';
      s.laptops = rows('Auto builds this', 'Your own job', 'Another job of yours');
      await act(async () => { vi.advanceTimersByTime(REFRESH_MS); });
      // The tick's list has come; its snapshot read was asked for first, and failed.
      expect(await screen.findByText('Another job of yours')).toBeInTheDocument();
      expect(snapshots(s)).toBe(2);
      expect(tab('Yours')).toHaveAttribute('aria-selected', 'true');
      expect(count('Auto')).toBe('1');
      expect(count('Yours')).toBe('2');
      expect(within(screen.getByRole('region', { name: 'Jobs on Olive’s Mac' })).queryByText('Auto builds this')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('a laptop whose open jobs are all Auto\'s says so under Yours', async () => {
    const { api } = site({ laptops: [laptop(1, 'Olive’s Mac', true, [job(1, 1, 'Your own job')]), laptop(2, 'Olive’s spare', true, [job(2, 2, 'Auto builds this')])], snapshot: snap([working, mine]) });
    render(<HostedApp api={api} />);
    const spare = await screen.findByRole('region', { name: 'Jobs on Olive’s spare' });
    expect(within(spare).getByText('None of yours')).toBeInTheDocument();
    expect(spare).toHaveTextContent('Its open jobs are Auto’s: see the Auto tab.');
    expect(within(screen.getByRole('region', { name: 'Jobs on Olive’s Mac' })).getByText('1 open job')).toBeInTheDocument();
  });

  // Follow-up: only the first load waits for the snapshot.
  it('a later tick whose snapshot read is slow leaves the list in place', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { s, api } = site({ laptops: rows('Auto builds this', 'Your own job'), snapshot: snap([working, mine]) });
      render(<HostedApp api={api} />);
      await screen.findByRole('tab', { name: 'Yours' });
      // From here the list and the tabs stay drawn, while the next tick's snapshot never answers.
      const watch = everShown(() => document.querySelector('.hosted-laptops') === null || screen.queryByRole('tablist') === null);
      try {
        s.snapshotHold = new Promise<void>(() => {});
        s.laptops = rows('Auto builds this', 'Your own job', 'Another job of yours');
        await act(async () => { vi.advanceTimersByTime(REFRESH_MS + FIRST_HOLD_MS); });
        expect(await screen.findByText('Another job of yours')).toBeInTheDocument();
        expect(snapshots(s)).toBe(2);
        expect(watch.ever).toBe(false);
        expect(count('Yours')).toBe('2');
      } finally { watch.stop(); }
    } finally { vi.useRealTimers(); }
  });

  // Fix round 1 (M1): at laptop width the heading row is as tall without the tabs as with them.
  it('the heading row keeps its height when the tabs come', async () => {
    const { api } = site({ laptops: rows('Your own job'), snapshot: snap([mine]) });
    render(<HostedApp api={api} />);
    await screen.findByRole('tab', { name: 'Yours' });
    expect(screen.getByRole('main', { name: 'Jobs' })).toHaveClass('sb-hosted-jobs');
    const rules = (file: string, media: string | null, selector: string) => {
      let css = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      if (media) css = [...css.matchAll(new RegExp(`@media \\(${media}\\) \\{((?:[^{}]*\\{[^{}]*\\})*)[^{}]*\\}`, 'g'))].map((m) => m[1]).join('\n');
      else css = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
      return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').map((x) => x.trim()).includes(selector)).map((m) => m[2]).join(';');
    };
    // The tab bar: a --control-h-sm tab, 3 px padding and a 1 px border above and below, no margin; the row is that tall without it.
    expect(rules('../../app/pages.css', null, '.seg .seg-tab')).toMatch(/min-height: var\(--control-h-sm\)/);
    expect(rules('../../app/pages.css', null, '.seg:has(> .seg-tab)')).toMatch(/padding: 3px/);
    expect(rules('../../app/pages.css', null, '.seg')).toMatch(/border: 1px solid/);
    expect(rules('../../app/pages.css', null, '.page-head > .seg')).toMatch(/margin: 0/);
    expect(rules('./hosted.css', 'min-width: 761px', '.sb-hosted-jobs .page-head')).toMatch(/min-height: calc\(var\(--control-h-sm\) \+ 8px\)/);
  });
});

describe('the website’s Jobs fetch the job page ahead (Task 7 fix round 1)', () => {
  afterEach(async () => { localStorage.clear(); (await import('../../jobpage/recent')).forgetRecentPages(); });

  it('the pointer or the focus on a job asks for its page once', async () => {
    const { s, api } = site({ laptops: [laptop(1, 'Olive’s Mac', true, [job(1, 1, 'Add export')])] });
    render(<HostedApp api={api} />);
    const link = (await screen.findByText('Add export')).closest('a')!;
    const slug = decodeURIComponent(link.getAttribute('href')!.replace('#/job/', ''));
    expect(s.calls.filter((c) => c.path.includes('/page'))).toEqual([]);
    fireEvent.pointerEnter(link);
    fireEvent.focus(link);
    await waitFor(() => expect(s.calls.filter((c) => c.path.includes('/page')).map((c) => c.path)).toEqual([`/api/job/${encodeURIComponent(slug)}/page`]));
  });
});

describe('the guide on the website', () => {
  it('signed in: the top bar’s Guide opens the laptop app’s Guide page, at a page’s address too', async () => {
    expect(parseHostedHash('#/guide')).toEqual({ name: 'guide' });
    expect(parseHostedHash('#/guide/09-the-website/set-it-up-once')).toEqual({ name: 'guide', page: '09-the-website', section: 'set-it-up-once' });
    go('#/guide/09-the-website');
    const { api } = site();
    render(<HostedApp api={api} />);
    const page = await screen.findByRole('main', { name: 'Guide' });
    expect(await within(page).findByRole('heading', { level: 2, name: '9. The website' })).toBeInTheDocument();
    expect(within(page).getByRole('link', { name: '9. The website' })).toHaveAttribute('aria-current', 'page');
    const bar = document.querySelector<HTMLElement>('.hosted-topbar')!;
    expect(within(bar).getByRole('link', { name: 'Guide' })).toHaveAttribute('href', '#/guide');
    expect(within(bar).getByRole('link', { name: 'Guide' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(document.title).toBe('Guide · Starbase'));
    // The ☰ menu has it too.
    fireEvent.click(within(bar).getByRole('button', { name: 'Menu' }));
    expect(within(bar).getByRole('menuitem', { name: /^Guide/ })).toHaveAttribute('href', '#/guide');
  });

  it('signed out: the guide waits behind the sign-in, like every page', async () => {
    go('#/guide/03-jobs');
    const { api } = site({ person: null });
    render(<HostedApp api={api} />);
    expect(await screen.findByRole('link', { name: /Sign in with Google/ })).toBeTruthy();
    expect(screen.queryByRole('main', { name: 'Guide' })).toBeNull();
    expect(document.querySelector('.hosted-topbar a[href="#/guide"]')).toBeNull();
  });
});
