// The Stage (packet M): one stop of a job and who's on it, from GET /api/job/:slug/stage/:stop.
// Roles come from the crew pack; status is a word with an icon; the Foreman opens in a terminal
// (continues its session), a crew member is watched (read-only); [ and ] step through the stops;
// n folds Finished here. Invented jobs and agents only; no model calls, nothing opens.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { StageAgent, StageView } from '../api/types';
import { installKeyListener } from '../app/keyRegistry';
import { UiProvider } from '../app/ui';
import { createStore, WorkshopContext } from '../state/store';
import { job, permission, snapshot } from '../state/test-fixtures';
import { forHowLong, StagePage } from './StagePage';

const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const agent = (who: string, extra: Partial<StageAgent> = {}): StageAgent => ({
  who, role: 'ignored', model: 'Opus 5.5', doing: null, since: at(12), lastAt: at(1), status: 'working',
  terminal: { kind: who === 'conductor' ? 'continue' : 'watch', ready: true, why: null }, ref: who === 'conductor' ? 'foreman' : `c1.${'a'.repeat(8)}`, ...extra,
});
const VIEW: StageView = {
  slug: 'alpha', stop: 'build', label: 'Build', state: 'now', stateWords: 'Working now', since: at(18), stages: ['implement'],
  agents: [
    agent('conductor', { doing: 'Checking each commit against step 3', since: at(18) }),
    agent('feature-implementer', { doing: 'Writing step 3 of 6', ref: 'c2.bbbbbbbb' }),
    agent('feature-tester', { model: 'Sonnet 5.5', doing: 'Running the tests', ref: 'c3.cccccccc', terminal: { kind: 'watch', ready: false, why: 'Its log isn’t known yet.' } }),
  ],
  finished: [agent('feature-planner', { status: 'done', doing: null, ref: 'c0.dddddddd' })],
  terminalApp: 'iTerm', terminalApps: ['iTerm', 'Terminal'],
};

function setup({ view = VIEW, play = 'subtle', stop = 'build' as StageView['stop'], permissions = [] as ReturnType<typeof permission>[] } = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'running', { stage: 'implement', ticket: 'ORBIT-471' } as never)], permissions, meta: { token: 't', settings: { play: { mode: play } } } as never }) });
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (/\/stage\//.test(path)) return { ...view, stop };
    return { slug: 'alpha', thread: [], threadMore: false, gate: null, options: { level: 1 } };
  });
  const post = vi.fn(async (path: string): Promise<unknown> => (path.endsWith('/terminal') ? { ok: true, kind: 'watch', terminalApp: 'iTerm' } : { ok: true }));
  const api = { get, post } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><StagePage slug="alpha" stop={stop} /></UiProvider></WorkshopContext.Provider>);
  return { get, post };
}

let off = () => {};
beforeEach(() => { off = installKeyListener(); window.location.hash = '#/job/alpha/stage/build'; });
afterEach(() => { off(); cleanup(); localStorage.clear(); window.location.hash = ''; });

describe('the Stage', () => {
  it('names the stop, its state in words, back to the job, and stop n of 7', async () => {
    const { get } = setup();
    const page = screen.getByRole('main', { name: 'Stage' });
    expect(within(page).getByRole('heading', { name: 'Build' })).toBeInTheDocument();
    expect(within(page).getByRole('link', { name: /Job alpha/ })).toHaveAttribute('href', '#/job/alpha');
    expect(page).toHaveTextContent('ORBIT-471 · stop 4 of 7');
    expect(page).toHaveTextContent('Write the code');
    expect(await within(page).findByText('Working now')).toBeInTheDocument();
    expect(page).toHaveTextContent('for 18 min');
    expect(get).toHaveBeenCalledWith('/api/job/alpha/stage/build');
  });

  it('lists who’s on it by role, with model, what each does and status in words; finished ones fold', async () => {
    setup();
    const who = await screen.findByRole('region', { name: 'Who’s on it' });
    const rows = [...who.querySelectorAll<HTMLElement>(':scope > .stage-rows > li')];
    expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['Foreman', 'Builder', 'Tester']);
    expect(rows[2]).toHaveTextContent('Sonnet 5.5');
    expect(rows[1]).toHaveTextContent('Writing step 3 of 6');
    expect(rows[1]).toHaveTextContent('Working');
    expect(who).toHaveTextContent('3 working');
    expect(screen.getByText('Finished here').closest('details')).not.toHaveAttribute('open');
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(screen.getByText('Finished here').closest('details')).toHaveAttribute('open');
    expect(screen.getByText('Planner')).toBeInTheDocument();
  });

  it('the Foreman opens in a terminal, a crew member is watched read-only; one not ready says why', async () => {
    const { post } = setup();
    const who = await screen.findByRole('region', { name: 'Who’s on it' });
    const [foreman, builder, tester] = [...who.querySelectorAll<HTMLElement>(':scope > .stage-rows > li')];
    expect(foreman).toHaveTextContent('Continues its session');
    expect(builder).toHaveTextContent('Read-only: follows its log');
    expect(within(tester).getByRole('button', { name: /Watch in terminal/ })).toBeDisabled();
    expect(tester).toHaveTextContent('Its log isn’t known yet.');
    fireEvent.click(within(builder).getByRole('button', { name: /Watch in terminal/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/stage/build/terminal', { ref: 'c2.bbbbbbbb' }));
    expect(await screen.findByText(/Following the Builder’s log in iTerm/)).toBeInTheDocument();
    fireEvent.click(within(foreman).getByRole('button', { name: /Open in terminal/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/stage/build/terminal', { ref: 'foreman' }));
    fireEvent.click(within(who).getByRole('button', { name: /Open the job’s folder in a terminal/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/local', { action: 'open', what: 'terminal' }));
    fireEvent.change(within(who).getByRole('combobox', { name: 'Terminal app' }), { target: { value: 'Terminal' } });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/alpha/local', { action: 'terminal-app', name: 'Terminal' }));
  });

  it('[ and ] go to the stops before and after', async () => {
    setup();
    expect(within(screen.getByRole('navigation', { name: 'Stops before and after' })).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#/job/alpha/stage/plan', '#/job/alpha/stage/test']);
    fireEvent.keyDown(document.body, { key: ']' });
    expect(window.location.hash).toBe('#/job/alpha/stage/test');
    fireEvent.keyDown(document.body, { key: '[' });
    expect(window.location.hash).toBe('#/job/alpha/stage/plan');
  });

  it('crew faces show only in Play full', async () => {
    setup({ play: 'full' });
    await screen.findByRole('region', { name: 'Who’s on it' });
    expect(document.querySelectorAll('.stage-face')).toHaveLength(4);
    cleanup();
    setup({ play: 'subtle' });
    await screen.findByRole('region', { name: 'Who’s on it' });
    expect(document.querySelectorAll('.stage-face')).toHaveLength(0);
  });

  it('a stop not reached yet says so', async () => {
    setup({ stop: 'ship', view: { ...VIEW, state: 'next', stateWords: 'Not yet', agents: [], finished: [] } });
    expect(await screen.findByText('The job hasn’t reached this stop yet.')).toBeInTheDocument();
    expect(screen.getByText('Last stop')).toBeInTheDocument();
  });

  it('a waiting permission shows its alert on the stop too', () => {
    setup({ permissions: [{ ...permission('p1', 'alpha'), agentType: 'feature-implementer' }] });
    expect(screen.getByRole('region', { name: 'Permission: Run a command' })).toHaveTextContent('The Builder wants to run a command');
  });

  it('forHowLong says how long in words', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(forHowLong('2026-10-21T11:42:00Z', now)).toBe('18 min');
    expect(forHowLong('2026-10-21T09:00:00Z', now)).toBe('3 h');
    expect(forHowLong('2026-10-18T09:00:00Z', now)).toBe('3 days');
    expect(forHowLong(null, now)).toBeNull();
  });
});
