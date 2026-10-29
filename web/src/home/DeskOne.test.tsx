// The Desk's One at a time layout (packet M, the default): the dots and "1 of N", the queue in a
// drawer, the seven stops, the brief behind Details (b), and the three calls Reply (c), No go: send
// back (r) and Go (a), which press the gate card's own buttons. Play changes the words, never the keys.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Gate, Job, JobDetail, Permission } from '../api/types';
import { installKeyListener } from '../app/keyRegistry';
import { createStore, WorkshopContext, type Store } from '../state/store';
import { job, permission, snapshot } from '../state/test-fixtures';
import { DeskView } from './DeskView';
import { deskQueue } from './homeModel';
import { clearDecisions } from './nudges';

const NOW = new Date('2026-10-21T12:00:00Z');
const GATE: Gate = {
  briefNumber: 2, briefFile: 'briefs/002-plan.md', headline: 'Plan v2 ready', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
  questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: '2026-10-21T09:00:00Z', runActive: false, parked: false,
  level: 1, suggestedLevel: null, levelReason: null, usage: null,
};
const detail = (slug: string): JobDetail => ({
  slug, thread: [], threadMore: false, gate: GATE, answeredBriefs: [], heldReply: null, options: { level: 1 },
  latestBrief: { html: '<p>The plan in full: two steps, one test.</p>', number: 2 },
});
const ALPHA = job('alpha', 'needs-you', { waitingFor: 'approval', stage: 'plan', lane: 'needs-you', laneReason: 'Waiting for your go-ahead on the plan', headline: 'The plan is ready. Start building?', waitingSince: '2026-10-21T09:00:00Z', level: 1 });

function setup({ jobs = [ALPHA], permissions = [] as Permission[], play = 'subtle' }: { jobs?: Job[]; permissions?: Permission[]; play?: 'full' | 'subtle' | 'off' } = {}) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, permissions, meta: { token: 't', settings: { play: { mode: play } } } as never }) });
  const get = vi.fn(async (path: string) => detail(path.split('/')[3]));
  const post = vi.fn(async (): Promise<unknown> => ({ ok: true, sent: true, text: 'x' }));
  const api = { get, post } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}><DeskView items={deskQueue(jobs, permissions)} now={NOW} layout="one" /></WorkshopContext.Provider>);
  return { get, post };
}

const kbd = (el: HTMLElement) => el.querySelector('kbd')?.textContent ?? null;
let off = () => {};
beforeEach(() => { off = installKeyListener(); });
afterEach(() => { off(); cleanup(); clearDecisions(); localStorage.clear(); window.location.hash = ''; });

describe('the Desk, one at a time', () => {
  it('shows one decision: where it is in the queue, the seven stops in words, the headline, and the brief behind Details (b)', async () => {
    setup({ permissions: [{ ...permission('p1', 'alpha'), createdAt: '2026-10-21T10:00:00Z' }] });
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Waiting for your decision' })).toBeNull();
    const card = screen.getByRole('region', { name: 'Job alpha: Go-ahead on Plan' });
    const stops = within(card).getByRole('list', { name: 'Where the job is' });
    expect(within(stops).getAllByRole('listitem').map((li) => li.getAttribute('title'))).toEqual([
      'Spec: Done', 'Investigate: Done', 'Plan: Waiting for you', 'Build: Not yet', 'Test: Not yet', 'Review: Not yet', 'Ship: Not yet',
    ]);
    expect(await within(card).findByRole('heading', { name: 'The plan is ready. Start building?' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Waiting for your go-ahead on the plan');
    expect(card).toHaveTextContent('Go / no go');
    const details = within(card).getByRole('button', { name: /The Foreman’s brief/ });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(card).not.toHaveTextContent('The plan in full');
    fireEvent.keyDown(document.body, { key: 'b' });
    expect(card).toHaveTextContent('The plan in full');
  });

  it('Go (a) approves through the gate card; r opens send back, c opens a reply; the keys are printed on the calls', async () => {
    const { post } = setup();
    const go = await screen.findByRole('button', { name: /^Go: approve/ });
    expect(kbd(go)).toBe('a');
    expect(kbd(screen.getByRole('button', { name: /^No go: send back/ }))).toBe('r');
    expect(kbd(screen.getByRole('button', { name: /^Reply/ }))).toBe('c');
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(await screen.findByText(/What should change\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(await screen.findByText(/Your guidance or question for the Foreman/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(go);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/gate', expect.objectContaining({ kind: 'approve' })));
  });

  it('with Play off the calls are ordinary buttons with the gate’s own words, and "Waiting for you"', async () => {
    setup({ play: 'off' });
    expect(await screen.findByRole('button', { name: /^Approve/ })).toHaveClass('btn-primary');
    expect(screen.getByRole('button', { name: /^Send back/ })).not.toHaveClass('btn-lg');
    expect(screen.getByText('Waiting for you')).toBeInTheDocument();
    expect(screen.queryByText('Go / no go')).toBeNull();
  });

  it('Queue opens the whole list in a drawer; picking one shows it; Escape closes it', async () => {
    setup({ permissions: [{ ...permission('p1', 'alpha'), createdAt: '2026-10-21T10:00:00Z' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    const drawer = screen.getByRole('dialog', { name: 'The queue' });
    const items = within(drawer).getAllByRole('button').filter((b) => b.classList.contains('desk-item'));
    expect(items.map((b) => b.querySelector('.desk-item-what')?.textContent)).toEqual(['Go-ahead on Plan', 'Run a command']);
    fireEvent.click(items[1]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('when nothing waits: Desk clear, See all jobs, and Decided today folded', () => {
    setup({ jobs: [job('beta', 'running')] });
    expect(screen.getByRole('heading', { name: 'Desk clear' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /See all jobs/ })).toHaveAttribute('href', '#/');
    const fold = screen.getByText('Decided today').closest('details')!;
    expect(fold.open).toBe(false);
    act(() => { fold.open = true; });
  });
});
