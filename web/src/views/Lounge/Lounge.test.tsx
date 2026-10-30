// The Lounge (packet 2D) against a pretend site: three made-up people (one online with two jobs, one
// away, one off), online/away/off in words with an icon, your own job a link and nobody else's,
// "Last active 12m ago", Play full's console tiles and Play off's plain cards, and its nav entry.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../../api/client';
import { HostedApp } from '../Hosted/HostedApp';
import { parseHostedHash } from '../Hosted/route';
import type { HostedPerson } from '../Hosted/types';
import { lastActiveWords, LoungePage, SHOWN_JOBS, stageWords } from './LoungePage';
import type { LoungeAnswer, LoungePerson } from './types';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const OLIVE: HostedPerson = { id: 1, name: 'Olive Owner', email: 'olive.owner@example.test', role: 'owner' };
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const PEOPLE: LoungePerson[] = [
  { id: 2, name: 'Mia Member', you: false, presence: 'away', lastActiveAt: ago(40), jobs: [{ ticket: 'ORBIT-512', title: 'Tidy the settings', stage: 'plan' }] },
  { id: 1, name: 'Olive Owner', you: true, presence: 'online', lastActiveAt: ago(12), jobs: [
    { ticket: null, title: 'Add export', stage: 'implement', slug: 'add-export' },
    { ticket: 'ORBIT-479', title: 'Tidy button', stage: 'review', slug: 'orbit-479-tidy-button' },
  ] },
  { id: 3, name: 'Sam Sample', you: false, presence: 'off', lastActiveAt: ago(60 * 26), jobs: [] },
];

function site(answer: LoungeAnswer | (() => Response) = { activeMinutes: 15, people: PEOPLE }) {
  const calls: string[] = [];
  const fetch = (async (url: RequestInfo | URL) => {
    const path = String(url);
    calls.push(path);
    if (path === '/api/meta') return json(200, { mode: 'hosted', person: OLIVE, signIn: '/api/auth/start', missing: [] });
    if (path === '/api/lounge') return typeof answer === 'function' ? answer() : json(200, answer);
    if (path === '/api/jobs') return json(200, { laptops: [] });
    return json(404, { error: 'There is nothing at this address.' });
  }) as typeof globalThis.fetch;
  return { calls, api: createApi({ fetch, hosted: true }) };
}

const go = (hash: string) => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); };
const tile = (name: string) => screen.getByRole('listitem', { name: new RegExp(`^${name}:`) });

beforeEach(() => { window.location.hash = '#/lounge'; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the Lounge', () => {
  it('shows each person: name, online, away or off in words with an icon, what is running and last active', async () => {
    const { api } = site();
    render(<LoungePage api={api} onSignedOut={() => {}} person={OLIVE} />);
    await screen.findByRole('listitem', { name: /^Olive Owner: Online$/ });
    expect(screen.getAllByRole('listitem', { name: /: (Online|Away|Off)$/ }).map((li) => li.getAttribute('aria-label'))).toEqual(['Mia Member: Away', 'Olive Owner: Online', 'Sam Sample: Off']);

    const olive = tile('Olive Owner');
    // In words, with an icon: never colour alone.
    const online = within(olive).getByText('Online');
    expect(online.querySelector('svg')).toBeTruthy();
    expect(within(olive).getByText('You')).toBeTruthy();
    expect(within(olive).getByText('Last active 12m ago')).toBeTruthy();
    expect(within(olive).getByText('ORBIT-479')).toBeTruthy();
    expect(within(olive).getByText('Review')).toBeTruthy();
    expect(within(olive).getByText('Build')).toBeTruthy();
    expect(within(tile('Mia Member')).getByText('Away').querySelector('svg')).toBeTruthy();
    expect(within(tile('Mia Member')).getByText('Plan')).toBeTruthy();
    expect(within(tile('Mia Member')).getByText('Last active 40m ago')).toBeTruthy();
    const sam = tile('Sam Sample');
    expect(within(sam).getByText('Off').querySelector('svg')).toBeTruthy();
    expect(within(sam).getByText('Nothing running')).toBeTruthy();
    // What online, away and off mean is on the page, not only in the guide.
    expect(screen.getByText(/Online: active in the last 15 minutes\. Away: a laptop is on, but quiet\. Off: no laptop on\./)).toBeTruthy();
  });

  it('your own job opens; another person’s job is not a link', async () => {
    const { api } = site();
    render(<LoungePage api={api} onSignedOut={() => {}} person={OLIVE} />);
    await screen.findByRole('listitem', { name: /^Olive Owner:/ });
    const mine = within(tile('Olive Owner')).getByRole('link', { name: 'Tidy button' });
    expect(mine.getAttribute('href')).toBe('#/job/orbit-479-tidy-button');
    const mia = tile('Mia Member');
    expect(within(mia).queryByRole('link')).toBeNull();
    expect(within(mia).getByText('Tidy the settings').getAttribute('title')).toBe('Only Mia Member can open this job.');
  });

  it('Play off is plain cards, no light; Play full is console tiles with a quiet working light and a readout', async () => {
    const { api } = site();
    const { unmount } = render(<LoungePage api={api} onSignedOut={() => {}} person={OLIVE} />);
    await screen.findByRole('listitem', { name: /^Olive Owner:/ });
    expect(tile('Olive Owner').className).toContain('play-off');
    expect(document.querySelector('.lounge-light')).toBeNull();
    expect(document.querySelector('.lounge-readout')).toBeNull();
    unmount();

    window.location.hash = '#/lounge?play=full';
    render(<LoungePage api={api} onSignedOut={() => {}} person={OLIVE} />);
    await screen.findByRole('listitem', { name: /^Olive Owner:/ });
    const olive = tile('Olive Owner');
    expect(olive.className).toContain('play-full');
    // Online with something running: the light is on and blinks softly.
    expect(olive.querySelector('.lounge-light')?.className).toMatch(/is-on.*is-blink/);
    expect(within(olive).getByText('2 running · Build, Review')).toBeTruthy();
    // Away or off: the light is there but unlit, and still the words say which.
    expect(tile('Mia Member').querySelector('.lounge-light')?.className).not.toContain('is-on');
    expect(within(tile('Sam Sample')).getByText('Nothing running')).toBeTruthy();
    cleanup();

    window.location.hash = '#/lounge?play=subtle';
    render(<LoungePage api={api} onSignedOut={() => {}} person={OLIVE} />);
    await screen.findByRole('listitem', { name: /^Olive Owner:/ });
    // Subtle: the tile and a steady light, no readout, no blink.
    expect(tile('Olive Owner').querySelector('.lounge-light')?.className).toContain('is-on');
    expect(tile('Olive Owner').querySelector('.lounge-light')?.className).not.toContain('is-blink');
    expect(document.querySelector('.lounge-readout')).toBeNull();
  });

  it('a long list folds after a few, with Show n more', async () => {
    const many = Array.from({ length: SHOWN_JOBS + 3 }, (_, i) => ({ ticket: null, title: `Job ${String(i + 1).padStart(2, '0')}`, stage: 'test' }));
    const { api } = site({ activeMinutes: 15, people: [{ id: 2, name: 'Mia Member', you: false, presence: 'online', lastActiveAt: ago(0), jobs: many }] });
    render(<LoungePage api={api} onSignedOut={() => {}} person={OLIVE} />);
    await screen.findByText('Job 01');
    expect(screen.queryByText(`Job ${String(SHOWN_JOBS + 1).padStart(2, '0')}`)).toBeNull();
    expect(screen.getByText('Active just now')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more' }));
    expect(screen.getByText('Job 08')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.queryByText('Job 08')).toBeNull();
  });

  it('says so in words when it can’t load, and a signed-out answer brings the sign-in back', async () => {
    const { api } = site(() => json(500, { error: 'Something went wrong on the site. Try again in a moment.' }));
    render(<LoungePage api={api} onSignedOut={() => {}} person={OLIVE} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn’t load the Lounge: Something went wrong/);
    cleanup();
    const out = vi.fn();
    const signedOut = site(() => json(401, { error: 'Sign in first.', signIn: true }));
    render(<LoungePage api={signedOut.api} onSignedOut={out} person={OLIVE} />);
    await waitFor(() => expect(out).toHaveBeenCalled());
  });

  it('is in the hosted nav, at #/lounge', async () => {
    expect(parseHostedHash('#/lounge')).toEqual({ name: 'lounge' });
    expect(parseHostedHash('#/lounge?play=full')).toEqual({ name: 'lounge' });
    const { api, calls } = site();
    go('#/lounge');
    render(<HostedApp api={api} />);
    expect(await screen.findByRole('heading', { name: 'Lounge', level: 2 })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    const link = within(nav).getByRole('link', { name: 'Lounge' });
    expect(link.getAttribute('href')).toBe('#/lounge');
    expect(link.getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(calls).toContain('/api/lounge'));
  });

  it('words: the stage as its stop, and last active in plain words', () => {
    expect(stageWords('implement')).toBe('Build');
    expect(stageWords('pr2')).toBe('Ship');
    expect(stageWords('something-else')).toBe('Something else');
    expect(stageWords(null)).toBeNull();
    const now = new Date('2026-10-30T16:00:00Z');
    expect(lastActiveWords(null, now)).toBe('Not active yet');
    expect(lastActiveWords('2026-10-30T15:59:40Z', now)).toBe('Active just now');
    expect(lastActiveWords('2026-10-30T15:48:00Z', now)).toBe('Last active 12m ago');
    // Older: the hours, "yesterday", a weekday count or a date, from lib/time (local days).
    expect(lastActiveWords('2026-10-20T13:00:00Z', now)).toMatch(/^Last active (10d ago|Oct 2\d)$/);
  });
});
