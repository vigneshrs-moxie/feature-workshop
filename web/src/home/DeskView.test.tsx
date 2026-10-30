// The Desk (home/DeskView.tsx): three columns, the brief open in the middle, the hand-off nudges
// after the decisions (Shipping last), the keys printed on the buttons, Decided today, and the
// empty state. Rendered on its own, with the keys' one listener installed as App installs it.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Gate, Job, JobDetail, Nudge, Permission } from '../api/types';
import { installKeyListener } from '../app/keyRegistry';
import { createStore, WorkshopContext, type Store } from '../state/store';
import { job, permission, snapshot } from '../state/test-fixtures';
import { DeskView } from './DeskView';
import { deskQueue } from './homeModel';
import { clearDecisions } from './nudges';

const NOW = new Date('2026-10-21T12:00:00Z');
// vitest runs from web/ (jsdom gives import.meta.url an http scheme, so the path is from there).
const css = readFileSync(path.join(process.cwd(), 'src/app/app.css'), 'utf8');

const GATE: Gate = {
  briefNumber: 2, briefFile: 'briefs/002-plan.md', headline: 'Plan v2 ready', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
  questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: '2026-10-21T09:00:00Z', runActive: false, parked: false,
  level: 1, suggestedLevel: null, levelReason: null, usage: null,
};
const detail = (slug: string): JobDetail => ({
  slug, thread: [], threadMore: false, gate: GATE, answeredBriefs: [], heldReply: null, options: { level: 1 },
  latestBrief: { html: '<p>The plan in full: two steps, one test.</p>', number: 2 },
});
const nudge = (id: Nudge['id'], extra: Partial<Nudge> = {}): Nudge => ({
  id, kind: 'ask', title: 'Ask Raj for a review?', text: 'PR #2 (#142) is open and has no approval yet.', link: null, action: { send: 'Please request Raj’s review on PR #2.' }, afterLine: false, ...extra,
});
const LINK = 'https://github.com/acme/portal/pull/141';
const ALPHA = job('alpha', 'needs-you', { waitingFor: 'approval', stage: 'plan', waitingSince: '2026-10-21T09:00:00Z', kind: 'feature', level: 1, repo: { name: 'portal', branch: 'feature/alpha' }, cost: { totalUsd: 0.42 } });
const SHIP = job('ship', 'shipping', { stage: 'pr2', updatedAt: '2026-10-20T10:00:00Z', finish: { reached: true, at: '2026-10-20T08:00:00Z', by: 'pr1-merged', landed: null }, nudges: [nudge('pr2-review', { afterLine: true })] });
const FORK = job('fork', 'idle', { stage: 'pr1', updatedAt: '2026-10-19T10:00:00Z', nudges: [nudge('pr1-merge', { kind: 'link', title: 'Self-review and merge PR #1 on GitHub', text: 'PR #1 (#141) is open from your fork.', link: LINK, action: null })] });

function setup({ jobs = [ALPHA], permissions = [] as Permission[], post = vi.fn(async (): Promise<unknown> => ({ ok: true, sent: true, text: 'x' })) }: { jobs?: Job[]; permissions?: Permission[]; post?: ReturnType<typeof vi.fn> } = {}) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, permissions, meta: { token: 't' } }) });
  const get = vi.fn(async (path: string) => detail(path.split('/')[3]));
  const api = { get, post } as unknown as ApiClient;
  const view = (js: Job[], ps: Permission[]) => (
    <WorkshopContext.Provider value={{ store, api }}><DeskView items={deskQueue(js, ps)} now={NOW} /></WorkshopContext.Provider>
  );
  const utils = render(view(jobs, permissions));
  return {
    ...utils, post, get,
    show(js: Job[], ps: Permission[] = []) { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: js, permissions: ps, meta: { token: 't' } }) }); utils.rerender(view(js, ps)); },
  };
}

const queue = () => screen.getByRole('navigation', { name: 'Waiting for your decision' });
const queueWhats = () => within(queue()).getAllByRole('button').map((b) => b.querySelector('.desk-item-what')?.textContent);
const side = () => screen.getByRole('complementary', { name: 'Decided today, and the job' });
const kbd = (el: HTMLElement) => el.querySelector('kbd')?.textContent ?? null;

let off = () => {};
beforeEach(() => { off = installKeyListener(); });
afterEach(() => { off(); cleanup(); clearDecisions(); localStorage.clear(); window.location.hash = ''; });

describe('the Desk', () => {
  it('has three columns: the queue, the item with the brief open in the middle, and the side with Decided today and the job', async () => {
    setup();
    expect(queue()).toHaveClass('desk-queue');
    const current = screen.getByRole('region', { name: 'Job alpha: Go-ahead on Plan' });
    expect(current).toHaveClass('desk-current');
    expect(side()).toHaveClass('desk-side');
    // The brief, in full, in the middle column; b hides and shows it, and says so on the button.
    const brief = await screen.findByRole('region', { name: 'Brief #2' });
    expect(brief).toHaveTextContent('The plan in full: two steps, one test.');
    const toggle = within(brief).getByRole('button', { name: 'Hide the brief' });
    expect(kbd(toggle)).toBe('b');
    fireEvent.keyDown(document.body, { key: 'b' });
    expect(brief).not.toHaveTextContent('The plan in full');
    expect(within(brief).getByRole('button', { name: 'Show the brief' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(document.body, { key: 'b' });
    expect(brief).toHaveTextContent('The plan in full');
    // The gate card under it, its Approve with its key; Open the job with o.
    expect(kbd(within(current).getByRole('button', { name: 'Approve and start Build' }))).toBe('a');
    expect(kbd(screen.getByRole('link', { name: 'Open the job' }))).toBe('o');
    // The side: nothing decided yet; the job's facts and where its work is.
    expect(within(side()).getByRole('region', { name: 'Decided today' })).toHaveTextContent('Nothing decided yet.');
    const jobBox = within(side()).getByRole('region', { name: 'This job' });
    expect(jobBox.querySelector('.desk-facts')).toHaveTextContent('Needs youFeatureL1portalfeature/alpha$0.42');
    expect(jobBox.querySelector('.desk-where')).toHaveTextContent('feature/alpha · Plan');
    // The legend, from the registry, names b too.
    expect(queue().querySelector('.desk-keys')).toHaveTextContent('o Open the job · b Show or hide the brief');
  });

  it('lists the nudges after the decisions, those past the finish line under Shipping at the end; a says yes, d puts one away, o opens the link', async () => {
    const post = vi.fn(async (): Promise<unknown> => ({ ok: true }));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    setup({ jobs: [SHIP, ALPHA, FORK], post });
    expect(queueWhats()).toEqual(['Go-ahead on Plan', 'Self-review and merge PR #1 on GitHub', 'Ask Raj for a review?']);
    const heading = queue().querySelector('.desk-group')!;
    expect(heading).toHaveTextContent('Shipping');
    expect(heading.closest('li')!.querySelector('.desk-item')).toHaveTextContent('Ask Raj for a review?');
    expect(heading.closest('li')!.querySelector('.desk-item')).toHaveClass('is-shipping');
    // j twice: the Shipping nudge, with its keys printed on its buttons.
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'j' });
    const card = screen.getByRole('region', { name: 'Ask Raj for a review?' });
    expect(card).toHaveTextContent('Shipping · past your finish line');
    expect(card).toHaveTextContent('PR #2 (#142) is open and has no approval yet.');
    expect(kbd(within(card).getByRole('button', { name: 'Yes, ask the Foreman' }))).toBe('a');
    expect(kbd(within(card).getByRole('button', { name: 'Not now' }))).toBe('d');
    const jobBox = within(side()).getByRole('region', { name: 'This job' });
    expect(jobBox.querySelector('.desk-where')).toHaveTextContent('On the Moxie branch');
    // a: yes. The sentence goes through the nudge route; the item leaves at once; Decided today has it.
    fireEvent.keyDown(document.body, { key: 'a' });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/ship/nudge/pr2-review/yes', {}));
    await waitFor(() => expect(queueWhats()).toEqual(['Go-ahead on Plan', 'Self-review and merge PR #1 on GitHub']));
    const decided = within(side()).getByRole('region', { name: 'Decided today' });
    expect(decided).toHaveTextContent('Job ship');
    expect(decided).toHaveTextContent('Yes: Ask Raj for a review?');
    // The next one opened: the link nudge. a does nothing (nothing to send); o opens GitHub; d puts it away.
    const link = screen.getByRole('region', { name: 'Self-review and merge PR #1 on GitHub' });
    expect(link).toHaveTextContent('Hand-off');
    const anchor = within(link).getByRole('link', { name: 'Open on GitHub' });
    expect(anchor).toHaveAttribute('href', LINK);
    expect(anchor).toHaveClass('btn-primary');
    expect(kbd(anchor)).toBe('o');
    post.mockClear();
    fireEvent.keyDown(document.body, { key: 'a' });
    await new Promise((r) => setTimeout(r, 20));
    expect(post).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(open).toHaveBeenCalledWith(LINK, '_blank', 'noopener');
    expect(window.location.hash).toBe('');
    fireEvent.keyDown(document.body, { key: 'd' });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/fork/nudge/pr1-merge/dismiss', {}));
    await waitFor(() => expect(queueWhats()).toEqual(['Go-ahead on Plan']));
    expect(within(side()).getByRole('region', { name: 'Decided today' }).querySelectorAll('li')).toHaveLength(2);
    expect(within(side()).getByRole('region', { name: 'Decided today' }).querySelector('li')).toHaveTextContent('Not now: Self-review and merge PR #1 on GitHub');
    open.mockRestore();
  });

  it('a refused yes stays on the card and says why', async () => {
    const post = vi.fn(async (): Promise<unknown> => { throw new Error('That nudge no longer applies: the PRs have moved on. Nothing was sent.'); });
    setup({ jobs: [SHIP], post });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, ask the Foreman' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('That nudge no longer applies');
    expect(queueWhats()).toEqual(['Ask Raj for a review?']);
  });

  it('a decision made on a card goes into Decided today when the item leaves the queue', async () => {
    const perms = [{ ...permission('p1', 'beta'), createdAt: '2026-10-21T08:00:00Z' }];
    const { show, post } = setup({ jobs: [job('beta', 'needs-you')], permissions: perms });
    expect(queueWhats()).toEqual(['Run a command']);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Allow once' })); });
    expect(post).toHaveBeenCalledWith('/api/permissions/p1', expect.objectContaining({ decision: 'allow' }));
    show([job('beta', 'running')], []);
    const decided = within(side()).getByRole('region', { name: 'Decided today' });
    expect(decided).toHaveTextContent('Job beta');
    expect(decided).toHaveTextContent('Allow once');
  });

  it('says so when the desk is clear, and keeps the side', () => {
    setup({ jobs: [job('beta', 'running')] });
    expect(screen.getByRole('heading', { name: 'Desk clear' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Your desk is clear. The crew carries on with your decisions.');
    expect(within(side()).getByRole('region', { name: 'Decided today' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'This job' })).toBeNull();
  });

  it('app.css: three columns from 1200 px, the side under the item below that, one column under 900 px', () => {
    expect(css).toMatch(/@media \(min-width: 1200px\) \{\s*\.desk \{ grid-template-columns: minmax\(240px, 320px\) minmax\(0, 1fr\) minmax\(240px, 320px\); \}\s*\.desk-side \{ grid-column: 3; grid-row: 1; \}/);
    expect(css).toMatch(/\.desk-side \{[^}]*grid-column: 2;/);
    expect(css).toMatch(/@media \(max-width: 900px\) \{\s*\.desk, \.desk-is-clear \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(css).toMatch(/\.desk \.desk-current \{ max-width: none; \}/);
  });
});
