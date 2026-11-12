// The new job page's pinned header (Task 9): the title and the state in a word, the ticket, Copy
// decisions, the Auto switch with On or Off, the gear and How it works; the second row's facts and
// the locked Foreman model; What Auto decided under the switch. On the laptop and on the website.
// Invented jobs only; no model calls, no network.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job, JobDetail, Permission, Run } from '../../api/types';
import { clearAllSent } from '../../lib/sentState';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { AUTO_HINT, AUTO_L3, AUTO_LABEL } from '../AutoSwitch';
import { headerState, JobTop, NEW_JOB_GUIDE } from './JobTop';

const MODELS = [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }];

function detailOf(extra: Partial<JobDetail> = {}): JobDetail {
  return { slug: 'alpha', thread: [], threadMore: false, ...extra } as JobDetail;
}

function setup({ j = job('alpha', 'idle', { title: 'Technician notes', stage: 'plan', level: 1 }), detail = detailOf() as JobDetail | null, run = null as Run | null, sent = null as { kind: 'approve' | 'changes' | 'message' | null } | null, hosted = false, permissions = [] as Permission[], post = vi.fn(async (): Promise<unknown> => ({ ok: true })) } = {}) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [j], permissions, meta: { token: 't', models: MODELS } as never }) });
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path === '/api/stacks') return { stacks: [] };
    if (path.endsWith('/decisions')) return { decisions: [] };
    return null;
  });
  const api = { get, post, ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><JobTop job={j} detail={detail} run={run} sent={sent as never} /></WorkshopContext.Provider>);
  return { ...utils, get, post, store };
}

const top = () => document.querySelector('.sb-job-top') as HTMLElement;

afterEach(() => { cleanup(); clearAllSent(); localStorage.clear(); });

describe('JobTop', () => {
  it('the header holds the title, the state in a word, the ticket, Copy decisions, the Auto switch, the gear and How it works', () => {
    const j = job('alpha', 'running', { title: 'Technician notes', stage: 'build', level: 1, lane: 'working', ticket: 'ORBIT-907' });
    setup({ j });
    const head = top();
    expect(head).not.toBeNull();
    expect(within(head).getByRole('heading', { level: 1, name: 'Technician notes' })).toBeInTheDocument();
    expect(within(head).getByText('Working', { selector: '.chip' })).toBeInTheDocument();
    expect(within(head).getByText('ORBIT-907')).toBeInTheDocument();
    expect(within(head).getByRole('button', { name: 'Copy decisions' })).toBeInTheDocument();
    const box = within(head).getByRole('checkbox', { name: AUTO_LABEL });
    expect(box.closest('label')).toHaveAttribute('title', AUTO_HINT);
    expect(within(head).getByRole('button', { name: 'Job menu' })).toBeInTheDocument();
    expect(within(head).queryByText('The job menu is on your laptop.')).toBeNull();
    const how = within(head).getByRole('button', { name: 'How it works' });
    expect(how).toHaveAttribute('title', 'The three things to know about this page.');
    fireEvent.click(how);
    const guide = screen.getByRole('dialog', { name: 'How the job page works' });
    expect(within(guide).getByRole('button', { name: 'Got it' })).toBeInTheDocument();
    expect(NEW_JOB_GUIDE.id).toBe('job-page-2');
    expect(NEW_JOB_GUIDE.title).toBe('How the job page works');
    expect(NEW_JOB_GUIDE.done).toBe('Got it');
    expect(NEW_JOB_GUIDE.cards.map((c) => [c.title, c.say])).toEqual([
      ['Your next move is at the top', 'The bar says what the job waits for. Send back, Reply and Go are there whenever it waits for you.'],
      ['Seven steps, each opens in place', 'Click a step to see who worked on it, what they are doing now and what it produced.'],
      ['The conversation stays beside you', 'The whole history with the Foreman, newest at the bottom. Widen it when you want to read.'],
    ]);
  });

  it('the ticket is a link to Orbit only for a web address, opening in a new tab', () => {
    const j = job('alpha', 'idle', { stage: 'plan', level: 1, ticket: 'ORBIT-907' });
    const { unmount } = setup({ j, detail: detailOf({ page: { ticket: { key: 'ORBIT-907', url: 'https://orbit.example/t/907' } } }) });
    const link = within(top()).getByRole('link', { name: /ORBIT-907/ });
    expect(link).toHaveAttribute('href', 'https://orbit.example/t/907');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    unmount();
    setup({ j, detail: detailOf({ page: { ticket: { key: 'ORBIT-907', url: 'javascript:alert(1)' } } }) });
    expect(within(top()).queryByRole('link', { name: /ORBIT-907/ })).toBeNull();
    expect(within(top()).getByText('ORBIT-907')).toBeInTheDocument();
  });

  it('a job Auto started says Started by Auto with the tag once, in the chip; one you started says nothing', () => {
    const j = job('alpha', 'running', { stage: 'plan', level: 1, auto: { on: true, by: 'tag', tag: 'auto', ran: true } });
    const { unmount } = setup({ j, detail: detailOf({ auto: { on: true, tag: 'auto' } }) });
    expect(screen.getAllByText(/Started by Auto/)).toHaveLength(1);
    const chip = screen.getByText('Started by Auto · tag auto');
    expect(chip).toHaveClass('chip');
    expect(chip).toHaveAttribute('title', 'Settings, Workflow, Auto start');
    expect(chip.querySelector('svg')).not.toBeNull();
    // Auto is on stays under the switch.
    expect(screen.getByText('Auto is on')).toBeInTheDocument();
    unmount();
    // A tag started it, but the tag isn't known yet (the job's detail hasn't come).
    const second = setup({ j, detail: null });
    expect(screen.getAllByText(/Started by Auto/)).toHaveLength(1);
    expect(screen.getByText('Started by Auto')).toHaveClass('chip');
    second.unmount();
    // He started it himself: nothing, even with an old tag on the record.
    setup({ j: { ...j, auto: { on: true, by: 'you', tag: 'old', ran: true } }, detail: detailOf({ auto: { on: true, tag: 'old' } }) });
    expect(screen.queryByText(/Started by Auto/)).toBeNull();
  });

  it('the switch says On or Off beside it', async () => {
    let finish: (v: unknown) => void = () => {};
    const post = vi.fn(() => new Promise((r) => { finish = r; }));
    setup({ post });
    const box = within(top()).getByRole('checkbox', { name: AUTO_LABEL });
    expect(box).not.toBeChecked();
    expect(within(top()).getByText('Off')).toBeInTheDocument();
    expect(within(top()).queryByText('On')).toBeNull();
    fireEvent.click(box);
    await act(async () => { finish({ ok: true }); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/auto', { on: true });
    expect(within(top()).getByRole('checkbox', { name: AUTO_LABEL })).toBeChecked();
    expect(within(top()).getByText('On')).toBeInTheDocument();
    expect(within(top()).queryByText('Off')).toBeNull();
  });

  it('the Foreman model shows as words with a lock, and not before the job has started', () => {
    const { unmount } = setup({ detail: detailOf({ drive: { sessionId: 's-1', model: 'claude-opus-5-5' } }) });
    const line = screen.getByText('Foreman model: Opus 5.5');
    expect(line).toHaveAttribute('title', 'Fixed once the job starts. Change model… in the gear menu starts it again.');
    expect(line.querySelector('svg')).not.toBeNull();
    unmount();
    setup({ detail: detailOf({ drive: { model: 'claude-opus-5-5' } }) });
    expect(screen.queryByText(/Foreman model/)).toBeNull();
  });

  it('after a decision is sent the state reads Sent', () => {
    const waiting = job('alpha', 'needs-you', { stage: 'plan', level: 1, lane: 'needs-you' });
    const { unmount } = setup({ j: waiting, sent: { kind: 'message' } });
    expect(within(top()).getByText('Sent', { selector: '.chip' })).toBeInTheDocument();
    expect(within(top()).queryByText('Needs you')).toBeNull();
    unmount();
    setup({ j: waiting, sent: null });
    expect(within(top()).getByText('Needs you', { selector: '.chip' })).toBeInTheDocument();
    // The rule itself: Sent whatever was sent; Needs you in the needs-you lane (Auto on, but the step his); else today's word.
    expect(headerState(waiting, [], { kind: null })).toMatchObject({ word: 'Sent', tone: 'info', icon: 'loader' });
    expect(headerState({ ...waiting, auto: { on: true, yours: true } } as Job, [], null)).toMatchObject({ word: 'Needs you', tone: 'needs-you', icon: 'hand' });
    expect(headerState(job('beta', 'running', { lane: 'working', auto: { on: true } }), [], null)).toMatchObject({ word: 'Working', tone: 'info' });
    // job.auto alone never makes it Needs you: the lane decides.
    expect(headerState(job('beta', 'running', { lane: 'working', auto: { on: true, yours: true } }), [], null)).toMatchObject({ word: 'Working', tone: 'info' });
    expect(headerState(job('gamma', 'running', { lane: 'in-review' }), [], null)).toMatchObject({ word: 'In review', tone: 'review' });
  });

  it('the gear’s reply checks get the job’s run', () => {
    const run: Run = { id: 'r1', slug: 'alpha', status: 'running' };
    setup({ run });
    fireEvent.click(within(top()).getByRole('button', { name: 'Job menu' }));
    const mark = screen.getByRole('button', { name: 'Mark done or dropped…' });
    expect(mark).toBeDisabled();
    expect(mark).toHaveAttribute('title', 'The Foreman is replying. Stop the reply first, then mark the job.');
  });

  it('What Auto decided shows only once Auto has decided something', async () => {
    const { unmount } = setup({ j: job('alpha', 'running', { stage: 'plan', level: 1, auto: { on: true, ran: false } }) });
    expect(within(top()).queryByRole('button', { name: 'What Auto decided' })).toBeNull();
    unmount();
    const { get } = setup({ j: job('alpha', 'running', { stage: 'plan', level: 1, auto: { on: true, ran: true } }) });
    const what = within(top()).getByRole('button', { name: 'What Auto decided' });
    // A plain small button with its icon, as drawn (not the quiet look).
    expect(what).toHaveClass('btn-sm');
    expect(what).not.toHaveClass('btn-quiet');
    expect(what.querySelector('svg')).not.toBeNull();
    await act(async () => { fireEvent.click(what); });
    expect(get).toHaveBeenCalledWith('/api/job/alpha/auto');
    // On the job page it opens as the drawer at the right (auto.css places .sb-drawer).
    expect(screen.getByRole('dialog', { name: 'What Auto decided' })).toHaveClass('sb-drawer');
  });

  it('an L3 job: the switch is off and says why', () => {
    setup({ j: job('alpha', 'needs-you', { stage: 'plan', level: 3, auto: { on: true } }) });
    const box = within(top()).getByRole('checkbox', { name: AUTO_LABEL });
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(within(top()).getByText('Off')).toBeInTheDocument();
    expect(within(top()).getByText(AUTO_L3)).toBeInTheDocument();
  });

  it('on the website there is no gear, and the switch queues its change', async () => {
    const words = 'Auto on or off: waiting for your laptop. It runs when the laptop is back.';
    const queued = { id: 'd_abcdefgh1234', kind: 'auto', state: 'waiting', words, at: '2026-11-11T09:00:00Z', expiresAt: null, waiting: true, canCancel: true, permissionId: null };
    const post = vi.fn(async (): Promise<unknown> => ({ ok: true, sent: false, held: true, queued, text: '', message: words }));
    setup({ hosted: true, post, detail: detailOf({ drive: { sessionId: 's-1', model: 'claude-opus-5-5' } }) });
    expect(within(top()).queryByRole('button', { name: 'Job menu' })).toBeNull();
    // In the gear's place, one sentence: the menu is on the laptop.
    expect(within(top()).getByText('The job menu is on your laptop.')).toHaveClass('sb-top-laptop');
    // The rest of the header is whole.
    expect(within(top()).getByRole('button', { name: 'How it works' })).toBeInTheDocument();
    expect(within(top()).getByRole('button', { name: 'Copy decisions' })).toBeInTheDocument();
    expect(screen.getByText('Foreman model: Opus 5.5')).toHaveAttribute('title', 'Fixed once the job starts. Change model… on your laptop starts it again.');
    await act(async () => { fireEvent.click(within(top()).getByRole('checkbox', { name: AUTO_LABEL })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/auto', { on: true });
    expect(within(top()).getByRole('checkbox', { name: AUTO_LABEL })).not.toBeChecked();
    expect(within(top()).getByText('Off')).toBeInTheDocument();
    expect(screen.getByText(words)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('Copy decisions in the header holds everything decided on this job in a fold, with no second button', async () => {
    const { get } = setup();
    get.mockImplementation(async (path: string): Promise<unknown> => {
      if (path === '/api/stacks') return { stacks: [] };
      if (path.endsWith('/decisions.md')) return { orbit: { text: 'ORBIT-907 decisions', count: 1 } };
      if (path.endsWith('/decisions')) return { decisions: [{ at: '2026-11-10T10:00:00Z', kind: 'approve', text: 'Approved brief 2' }] };
      return null;
    });
    fireEvent.click(within(top()).getByRole('button', { name: 'Copy decisions' }));
    await screen.findByLabelText('The text that will be copied');
    const fold = screen.getByRole('dialog', { name: 'Copy decisions' }).querySelector('details')!;
    expect(fold.querySelector('summary')).toHaveTextContent('Everything decided on this job');
    await act(async () => { fireEvent.click(fold.querySelector('summary')!); });
    expect(await within(fold).findByText('Approved brief 2')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Copy decisions' })).toHaveLength(1);
  });

  it('a second row of facts: kind, the level chip, the repository and where the work is', () => {
    const j = job('alpha', 'idle', { stage: 'plan', level: 2, kind: 'feature', repo: { name: 'field-app', branch: 'feature/notes' } as never });
    setup({ j });
    const head = top();
    expect(within(head).getByText('Feature')).toBeInTheDocument();
    expect(within(head).getByText('field-app')).toBeInTheDocument();
    expect(within(head).getByText(/feature\/notes/)).toBeInTheDocument();
    expect(head.querySelector('.level-chip, [class*="level"]')).not.toBeNull();
  });
});
