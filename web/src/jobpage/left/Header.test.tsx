// The new job page's header (job page rebuild, Task 8): the ticket key, the title, one state word, the
// dim facts, the Auto switch, and the ⋯ menu with everything rare. Built against the made-up long job.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { ApiError } from '../../api/client';
import type { Job, Settings } from '../../api/types';
import { UiProvider, useUi } from '../../app/ui';
import { POLICIES } from '../../components/permissions/policies';
import { JobMenu } from '../../panes/Foreman/JobHeader';
import { AUTO_LABEL } from '../../job/AutoSwitch';
import { clearAllSent } from '../../lib/sentState';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job as jobRow, snapshot } from '../../state/test-fixtures';
import { longJob } from '../fixtures/longJob';
import { createJobStore } from '../jobStore';
import { JOB_PAGE_KEY } from '../switch';
import type { JobPagePayload, JobState } from '../types';
import { JobStoreContext } from '../useJob';
import { Header, STATE_WORDS } from './Header';

const SLUG = longJob.payload.slug;
const DIR = '/made/up/jobs/orbit-905';
const WORKTREE = '/made/up/worktrees/crew-schedule-export';
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** The long job's payload, with the laptop's menu facts filled in (a started job with a worktree). */
function payload(over: Partial<JobPagePayload> = {}): JobPagePayload {
  const p = clone(longJob.payload) as unknown as JobPagePayload;
  p.local = { dir: DIR, worktree: WORKTREE, policyOverride: null, started: true };
  return { ...p, ...over };
}

/** The sheet the app would open now (App.tsx draws it from ui.sheet). */
function SheetProbe() {
  const { sheet } = useUi();
  return <output data-testid="sheet">{sheet ? JSON.stringify(sheet) : ''}</output>;
}
const sheetNow = () => screen.getByTestId('sheet').textContent;

interface Mounted { api: ApiClient; post: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; app: Store; unmount(): void }
function mount({ p = payload(), row = null, hosted = false, post = vi.fn(async (): Promise<unknown> => ({})) }: { p?: JobPagePayload | null; row?: Job | null; hosted?: boolean; post?: ReturnType<typeof vi.fn> } = {}): Mounted {
  const app = createStore();
  app.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings: { policy: 'hands-off', jobPolicy: {} } as unknown as Settings } }) });
  const get = vi.fn(async (path: string): Promise<unknown> => (path.includes('decisions.md') ? { orbit: { text: '- Keep the old export', count: 1 } } : {}));
  const api = { get, post, hosted: () => hosted } as unknown as ApiClient;
  const store = createJobStore(SLUG, { api, initial: p, events: () => () => {} });
  const { unmount } = render(
    <WorkshopContext.Provider value={{ store: app, api }}>
      <UiProvider>
        <JobStoreContext.Provider value={store}>
          <Header job={row} />
          <SheetProbe />
        </JobStoreContext.Provider>
      </UiProvider>
    </WorkshopContext.Provider>,
  );
  return { api, post, get, app, unmount };
}

const head = () => document.querySelector<HTMLElement>('.jp2-head')!;
const openMenu = () => fireEvent.click(within(head()).getByRole('button', { name: 'More for this job' }));
const menuNames = () => [...screen.getByRole('menu').querySelectorAll('[role="menuitem"], [role="menuitemradio"]')].map((b) => b.textContent);
const item = (name: string | RegExp) => within(screen.getByRole('menu')).getByRole('menuitem', { name });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { clearAllSent(); });

describe('the header', () => {
  it('says one state word only, for each of the five states, from the payload and from the row before it', () => {
    const states: JobState[] = ['needs-you', 'working', 'waiting-github', 'paused', 'done'];
    for (const state of states) {
      const { unmount } = mount({ p: payload({ state }) });
      const said = Object.values(STATE_WORDS).filter((w) => head().textContent!.includes(w));
      expect(said, state).toEqual([STATE_WORDS[state]]);
      expect(head().querySelectorAll('.jp2-state')).toHaveLength(1);
      unmount();
    }
    // Before the payload: the snapshot row's lane in the same five words.
    const { unmount } = mount({ p: null, row: jobRow(SLUG, 'running', { lane: 'working', title: 'Crew schedule export', stage: 'build' }) });
    expect(Object.values(STATE_WORDS).filter((w) => head().textContent!.includes(w))).toEqual(['Working']);
    unmount();
  });

  it('links the ticket key to Orbit when it has an address, and shows the dim level, repository and cost as the old page does', () => {
    const a = mount({ p: payload({ keyUrl: 'https://orbit.example.com/admin/feedback/ORBIT-905' }) });
    const link = within(head()).getByRole('link', { name: 'ORBIT-905' });
    expect(link).toHaveAttribute('href', 'https://orbit.example.com/admin/feedback/ORBIT-905');
    expect(link).toHaveAttribute('target', '_blank');
    expect(within(head()).getByRole('heading', { name: 'Crew schedule export' })).toBeInTheDocument();
    expect(head().querySelector('.jp2-facts')).toHaveTextContent(/^L3 · fieldbook · \$96\.40$/);
    a.unmount();
    // No Orbit address: the key as plain words. Cost at 10 cents or under, and no level: left out.
    const p = payload({ keyUrl: null });
    p.facts = { ...p.facts, level: null, cost: 0.08 };
    mount({ p });
    expect(within(head()).queryByRole('link', { name: 'ORBIT-905' })).toBeNull();
    expect(head().querySelector('.jp2-key')).toHaveTextContent('ORBIT-905');
    expect(head().querySelector('.jp2-facts')).toHaveTextContent(/^fieldbook$/);
  });

  it('the Auto switch flips at once and flips back with a line if the server refuses', async () => {
    let refuse: (e: unknown) => void = () => {};
    const post = vi.fn(() => new Promise((_, no) => { refuse = no; }));
    mount({ post });
    const box = within(head()).getByRole('checkbox', { name: AUTO_LABEL });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(post).toHaveBeenCalledWith(`/api/job/${SLUG}/auto`, { on: true });
    expect(box).toBeChecked();
    await act(async () => { refuse(new ApiError(409, 'Auto is off for this repository.', { code: 'x' })); });
    expect(box).not.toBeChecked();
    expect(head()).toHaveTextContent('Auto stayed off: Auto is off for this repository.');
  });
});

describe('the ⋯ menu', () => {
  it('holds everything rare, in the brief’s order, with the page switch last', () => {
    mount();
    openMenu();
    expect(menuNames()).toEqual([
      'Mark done or dropped', 'Notes and options', 'Change model',
      'Follow my setting (Routine steps automatic)', ...POLICIES.map((p) => p.label),
      'Copy decisions', 'How this page works', 'Open the folder in a terminal', 'Back to the old job page',
    ]);
    expect(within(screen.getByRole('menu')).getByRole('group', { name: 'Permissions for this job' })).toBeInTheDocument();
  });

  it('Mark done or dropped, Notes and options and Change model open the same sheets as the old page’s job menu', () => {
    const row = jobRow(SLUG, 'needs-you', { title: 'Crew schedule export' });
    const picks = ['Mark done or dropped', 'Notes and options', 'Change model'];
    // The old page's menu (panes/Foreman/JobHeader JobMenu), with the same job.
    const old: string[] = [];
    for (const name of picks) {
      const app = createStore();
      const api = { get: vi.fn(), post: vi.fn(), hosted: () => false } as unknown as ApiClient;
      const { unmount } = render(<WorkshopContext.Provider value={{ store: app, api }}><UiProvider><JobMenu job={row} dir={DIR} worktree={WORKTREE} started run={null} /><SheetProbe /></UiProvider></WorkshopContext.Provider>);
      fireEvent.click(screen.getByRole('button', { name: /Job menu/ }));
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
      old.push(sheetNow()!);
      unmount();
    }
    expect(old.map((s) => JSON.parse(s).kind)).toEqual(['close-job', 'job-drawer', 'change-model']);
    for (const [i, name] of picks.entries()) {
      const { unmount } = mount();
      openMenu();
      fireEvent.click(item(name));
      expect(sheetNow(), name).toBe(old[i]);
      unmount();
    }
  });

  it('Permissions for this job posts the job’s own setting as the old menu does, and the tick follows it', async () => {
    const post = vi.fn(async (): Promise<unknown> => ({ policyOverride: 'ask-all' }));
    const { app } = mount({ post });
    openMenu();
    const follow = within(screen.getByRole('menu')).getByRole('menuitemradio', { name: /Follow my setting/ });
    expect(follow).toHaveAttribute('aria-checked', 'true');
    await act(async () => { fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Ask about everything' })); });
    expect(post).toHaveBeenCalledWith(`/api/job/${SLUG}/policy`, { policy: 'ask-all' });
    expect(app.getState().meta?.settings?.jobPolicy?.[DIR]).toBe('ask-all');
    openMenu();
    expect(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Ask about everything' })).toHaveAttribute('aria-checked', 'true');
  });

  it('Copy decisions and How this page works open the same sheets the old page’s buttons open', async () => {
    const { get } = mount();
    openMenu();
    await act(async () => { fireEvent.click(item('Copy decisions')); });
    expect(get).toHaveBeenCalledWith(`/api/jobs/${SLUG}/decisions.md`);
    expect(screen.getByRole('dialog', { name: 'Copy decisions' })).toHaveTextContent('- Keep the old export');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Copy decisions' })).getByRole('button', { name: /Close/ }));
    openMenu();
    fireEvent.click(item('How this page works'));
    expect(screen.getByText('How this job page works')).toBeInTheDocument();
  });

  it('Open the folder in a terminal asks the laptop as the old page does, and says what happened in one line', async () => {
    const { post } = mount();
    openMenu();
    await act(async () => { fireEvent.click(item('Open the folder in a terminal')); });
    expect(post).toHaveBeenCalledWith(`/api/job/${SLUG}/local`, { action: 'open', what: 'terminal' });
    expect(within(head()).getByText('Opened the job’s folder in a terminal.').closest('[role="status"]')).not.toBeNull();
  });

  it('Back to the old job page turns the switch off', () => {
    localStorage.setItem(JOB_PAGE_KEY, 'new');
    mount();
    openMenu();
    fireEvent.click(item('Back to the old job page'));
    expect(localStorage.getItem(JOB_PAGE_KEY)).toBeNull();
  });

  it('on the website it hides the laptop’s items: what remains is Copy decisions, How this page works and the page switch', () => {
    const p = payload({ hosted: true });
    delete p.local;
    mount({ p, hosted: true });
    openMenu();
    expect(menuNames()).toEqual(['Copy decisions', 'How this page works', 'Back to the old job page']);
    expect(within(screen.getByRole('menu')).queryByRole('group')).toBeNull();
  });

  it('while the Foreman replies, Mark done and Change model wait; a closed job offers Reopen', async () => {
    const running = payload();
    running.run = { id: 'r1', status: 'running', startedAt: null, lastAction: null };
    const a = mount({ p: running });
    openMenu();
    expect(item('Mark done or dropped')).toBeDisabled();
    expect(item('Change model')).toBeDisabled();
    expect(item('Notes and options')).toBeEnabled();
    a.unmount();
    const { post } = mount({ p: payload({ closed: { as: 'done', at: '2026-11-05T10:00:00.000Z' } }) });
    openMenu();
    expect(menuNames()).not.toContain('Mark done or dropped');
    await act(async () => { fireEvent.click(item('Reopen')); });
    expect(post).toHaveBeenCalledWith(`/api/job/${SLUG}/reopen`, {});
  });
});
