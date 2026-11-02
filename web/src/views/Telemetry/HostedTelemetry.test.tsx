// Telemetry on the hosted site (packet 2E) against a pretend site whose answers come from the site's
// own sums (hostedTelemetry.fixture.ts, made by hosted/lib/team-telemetry.js for two made-up
// people): the shared account's graphs for everyone, your own two for you, Other use once, the
// parts in words, the empty state, a failed read and a session that ended.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../../api/client';
import { HostedApp } from '../Hosted/HostedApp';
import { fixture } from './hostedTelemetry.fixture';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const RAJ = { id: 1, name: 'Raj Example', email: 'raj.example@example.test', role: 'manager' };

function site({ team = fixture.team as unknown, mine = fixture.mine as unknown, fail = false, ended = false } = {}) {
  const calls: string[] = [];
  let person: typeof RAJ | null = RAJ;
  const fetch = (async (url: RequestInfo | URL) => {
    const path = String(url);
    calls.push(path);
    if (path === '/api/meta') return json(200, { mode: 'hosted', person, signIn: '/api/auth/start', missing: [] });
    if (ended && path.startsWith('/api/telemetry/')) { person = null; return json(401, { error: 'Sign in first.', signIn: true }); }
    if (fail && path.startsWith('/api/telemetry/team')) return json(500, { error: 'Something went wrong on the site. Try again in a moment.' });
    if (path.startsWith('/api/telemetry/team')) return json(200, team);
    if (path.startsWith(`/api/telemetry/people/${RAJ.id}`)) return json(200, mine);
    return json(404, { error: 'There is nothing at this address.' });
  }) as typeof globalThis.fetch;
  return { calls, api: createApi({ fetch, hosted: true }) };
}

beforeEach(() => {
  window.location.hash = '#/telemetry';
  try { window.localStorage.clear(); window.localStorage.setItem('gc.guide.seen', JSON.stringify(['team-telemetry'])); } catch { /* none */ }
});
afterEach(() => { cleanup(); });

describe('Telemetry on the hosted site', () => {
  it('shows the shared account to everyone: the gauge, who used the limit (each part named, Other use once) and share by model', async () => {
    const { api, calls } = site();
    render(<HostedApp api={api} />);
    expect(await screen.findByRole('heading', { name: 'The shared account' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Telemetry', level: 2 })).toBeTruthy();
    // The top bar says where you are.
    expect(screen.getAllByRole('link', { name: 'Telemetry' }).some((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
    // Who used this week's limit: names, in the app and in Claude Code apart, Other use once, adding up.
    const who = document.getElementById('tele-graph-people')!;
    expect(within(who).getByText('Who used this week’s limit')).toBeTruthy();
    expect(within(who).getByText(fixture.team.graphs.find((g) => g.id === 'people')!.headline)).toBeTruthy();
    const bar = within(who).getByRole('img', { name: /^Share of this week’s limit:/ });
    expect(bar.getAttribute('aria-label')).toBe('Share of this week’s limit: Raj Example in the app 11%, Raj Example in Claude Code 2%, Sam Example in the app 11%, Other use (claude.ai, the Claude app, other people), estimated 8%, still free 68%.');
    expect(within(who).getAllByText(/Other use \(claude\.ai, the Claude app, other people\)/).length).toBe(1);
    // Every common graph says it is about the whole account; none names a job.
    for (const id of ['limit', 'models', 'people']) expect(document.getElementById(`tele-graph-${id}`)!.getAttribute('data-audience')).toBe('common');
    expect(within(document.querySelector('.tele-team-part')! as HTMLElement).queryByText(/Add export|Tidy button|SALES-12/)).toBeNull();
    expect(within(document.getElementById('tele-graph-models')!).getByText(fixture.team.graphs.find((g) => g.id === 'models')!.headline)).toBeTruthy();
    // The dials: the newest reading, split.
    expect(screen.getByText('Weekly limit')).toBeTruthy();
    // It asked with this browser's time zone, and for your own graphs only.
    expect(calls.some((c) => /^\/api\/telemetry\/team\?tz=/.test(c))).toBe(true);
    expect(calls.filter((c) => c.startsWith('/api/telemetry/people/')).every((c) => c.startsWith('/api/telemetry/people/1'))).toBe(true);
  });

  it('shows your own two graphs, marked as yours only, with your jobs’ names', async () => {
    const { api } = site();
    render(<HostedApp api={api} />);
    const mine = await screen.findByRole('region', { name: 'Your own jobs' });
    expect(within(mine).getByText('Only you see these, as on your laptop.')).toBeTruthy();
    const byDay = document.getElementById('tele-graph-by-day')!;
    expect(byDay.getAttribute('data-audience')).toBe('private');
    expect(within(byDay).getByText('Only yours')).toBeTruthy();
    expect(within(byDay).getByText(fixture.mine.graphs[0].headline)).toBeTruthy();
    expect(within(byDay).getAllByText('Add export').length).toBeGreaterThan(0);
    const ticket = document.getElementById('tele-graph-ticket-stage')!;
    expect(within(ticket).getByText('SALES-12 Add export')).toBeTruthy();
    expect(within(ticket).getByRole('heading', { name: /^By stage/ })).toBeTruthy();
    // Table shows the numbers.
    fireEvent.click(within(ticket).getByRole('button', { name: 'More for Cost per ticket and per stage' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Show the table/ }));
    expect(within(ticket).getByRole('table')).toBeTruthy();
  });

  it('with nothing from any laptop yet, says how it fills in and where to pair one', async () => {
    const empty = { ...fixture.team, lines: 0, meters: { week: null, fiveHour: null } };
    const { api } = site({ team: empty, mine: { ...fixture.mine, lines: 0 } });
    render(<HostedApp api={api} />);
    expect(await screen.findByText('Nothing from any laptop yet')).toBeTruthy();
    expect(screen.getByText(/Laptops send numbers only, never prompts, replies, code or file names\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Settings → Laptops' }).getAttribute('href')).toBe('#/settings/laptops');
  });

  it('a failed read says so, with Try again; a session that ended brings the sign-in back', async () => {
    const failing = site({ fail: true });
    render(<HostedApp api={failing.api} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Couldn’t read Telemetry from the site/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    cleanup();
    const ended = site({ ended: true });
    render(<HostedApp api={ended.api} />);
    await waitFor(() => expect(screen.getByRole('link', { name: /Sign in with Google/ })).toBeTruthy());
  });
});
