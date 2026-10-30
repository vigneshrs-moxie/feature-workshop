// The Stack pages (packet K2), against the approved Stack wireframe: the Stacks list with its four
// dots and words, the empty list's picture cards, How stacks work and the first visit; one stack in
// every state drawn (plan check with why it splits, building in Play full, subtle and off, a stuck
// part, ready to merge, a clash, tests failed, go / no go to push, pushed), each with its one button
// and key; the settings; the history; the four-big-steps picture; more than six parts.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { StackView, StacksList } from '../../api/types';
import { installKeyListener } from '../../app/keyRegistry';
import { writeKeysSetting } from '../../app/keysSetting';
import { hrefFor, parseHash } from '../../app/router';
import { UiProvider } from '../../app/ui';
import { createStore, WorkshopContext } from '../../state/store';
import { snapshot } from '../../state/test-fixtures';
import { part, stackView, summary } from './fixtures';
import { StackPage } from './StackPage';
import { StacksPage } from './StacksPage';
import { setStackGuideFirstVisit } from './StackGuide';

function setup(answers: Record<string, unknown>, { play = 'subtle' as 'full' | 'subtle' | 'off', post }: { play?: 'full' | 'subtle' | 'off'; post?: (path: string, body: unknown) => unknown } = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings: { play: { mode: play } } } as never }) });
  const get = vi.fn(async (path: string) => {
    if (path in answers) { const a = answers[path]; if (a instanceof Error) throw a; return a; }
    throw new ApiError(404, 'No stack by that name.');
  });
  const postFn = vi.fn(async (path: string, body: unknown) => (post ? post(path, body) : answers[path.replace(/\/[a-z-]+$/, '')]));
  const api = { get, post: postFn } as unknown as ApiClient;
  const wrap = (ui: ReactNode) => render(<WorkshopContext.Provider value={{ store, api }}><UiProvider>{ui}</UiProvider></WorkshopContext.Provider>);
  return { get, post: postFn, wrap, store };
}

const one = (view: StackView) => ({ [`/api/stacks/${view.slug}`]: view });
const bar = () => screen.getByRole('region', { name: 'Next step' });
const col = (word: string) => screen.getByRole('listitem', { name: new RegExp(`^${word}: \\d+$`) });

/** The stack is on the page, and its effects (its keys) have run. */
async function shown() {
  await screen.findByRole('heading', { name: 'Tech schedule export' }, { timeout: 5000 });
  await act(async () => {});
}

let offKeys = () => {};
beforeEach(() => { offKeys = installKeyListener(); setStackGuideFirstVisit(false); window.location.hash = '#/stack/orbit-512'; });
afterEach(() => { offKeys(); localStorage.clear(); window.location.hash = ''; });

describe('the Stacks list', () => {
  const building = stackView({ next: { action: 'wait', label: null, key: null, words: 'Building.' } }, ['running', 'running', 'pending']);
  const plan = { ...stackView({ slug: 'orbit-600', title: 'Holiday hours', ticketKey: 'ORBIT-600' }), next: { action: 'approve-plan' as const, label: 'Approve plan', key: 'a', words: 'Check it.' } };
  const list: StacksList = { stacks: [summary(plan), summary(building)], globalCap: 3, globalRunning: 2 };

  it('is its own page at #/stacks, and one stack is at #/stack/<slug>', () => {
    expect(parseHash('#/stacks')).toEqual({ name: 'stacks' });
    expect(parseHash('#/stack/orbit-512')).toEqual({ name: 'stack', slug: 'orbit-512' });
    expect(parseHash('#/stack/orbit-512?play=full')).toEqual({ name: 'stack', slug: 'orbit-512' });
    expect(hrefFor({ name: 'stack', slug: 'a b' })).toBe('#/stack/a%20b');
    expect(hrefFor({ name: 'stacks' })).toBe('#/stacks');
  });

  it('each stack is a card: its goal, why, a segment per part with words, who is at work, its risks and its one ask', async () => {
    const card = {
      ...summary(building), why: 'The model first, because everything reads it.', standing: 'needs-you' as const, approved: true, total: 3, merged: 1, atWorkCount: 1,
      lanes: { merged: 1, working: 1, stuck: 1, 'needs-you': 0, waiting: 0, queued: 0, checks: 0, ready: 0, merging: 0 },
      segments: [
        { n: 1, name: 'model', title: 'The model', lane: 'merged' as const, laneWords: 'Merged', slug: 'orbit-512--model' },
        { n: 2, name: 'api', title: 'The API', lane: 'working' as const, laneWords: 'At work', slug: 'orbit-512--api' },
        { n: 3, name: 'ui', title: 'The screens', lane: 'stuck' as const, laneWords: 'Stuck', slug: 'orbit-512--ui' },
      ],
      atWork: [{ n: 2, title: 'The API', slug: 'orbit-512--api', lane: 'working' as const, who: 'Builder', crew: 'feature-implementer', what: 'editing api.ts', since: null, tone: 'working' as const }],
      ask: { action: 'open-part' as const, label: 'Open part 3', part: 3, words: 'Part 3 got stuck after 3 failed tries' },
      risks: [{ kind: 'stuck' as const, tone: 'error' as const, parts: [3], words: 'Part 3 is stuck: its tests failed 3 times' }],
      costUsd: 12.5, startedAt: new Date(Date.now() - 2 * 86400e3).toISOString(), lastActivityAt: new Date().toISOString(), mergedToday: 1,
    };
    const { wrap } = setup({ '/api/stacks': { stacks: [summary(plan), card], globalCap: 3, globalRunning: 2 } });
    wrap(<StacksPage />);
    const cards = await screen.findByRole('list', { name: 'Stacks' });
    const items = [...cards.querySelectorAll(':scope > li')] as HTMLElement[];
    expect(items).toHaveLength(2);
    // Needs you first, whatever the server's order.
    expect(items[0]).toHaveTextContent('Tech schedule export');
    const c = items[0];
    expect(c).toHaveTextContent('The model first, because everything reads it.');
    expect(within(c).getByRole('link', { name: 'Part 2 · The API · At work' })).toHaveAttribute('href', '#/stack/orbit-512/part/2');
    expect(within(c).getByRole('link', { name: 'Part 3 · The screens · Stuck' })).toBeInTheDocument();
    expect(c).toHaveTextContent('1 of 3 merged · 1 at work · 1 needs you');
    expect(c).toHaveTextContent('Builder · editing api.ts');
    expect(c).toHaveTextContent('Part 3 is stuck: its tests failed 3 times');
    expect(c).toHaveTextContent('2 days');
    expect(c).toHaveTextContent('$12.50');
    expect(within(c).getByRole('button', { name: 'Open part 3' })).toBeInTheDocument();
    expect(within(c).getByRole('link', { name: 'Tech schedule export' })).toHaveAttribute('href', '#/stack/orbit-512');
    // The summary line, each number a filter.
    const sum = screen.getByRole('navigation', { name: 'Stacks at a glance' });
    expect(sum).toHaveTextContent('2 stacks');
    expect(sum).toHaveTextContent('1 part at work');
    fireEvent.click(within(sum).getByRole('button', { name: /needs? you/ }));
    expect(within(sum).getByRole('button', { name: /needs? you/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a click on a card’s body opens a quick look (R’s Peek, kept in the address) with its next step and parts; Escape closes it', async () => {
    window.location.hash = '#/stacks';
    const { wrap } = setup({ '/api/stacks': list });
    const { unmount } = wrap(<StacksPage />);
    const cards = await screen.findByRole('list', { name: 'Stacks' });
    const first = cards.querySelector<HTMLElement>(':scope > li')!;
    fireEvent.click(first.querySelector('.shc-why')!);
    const peek = screen.getByRole('dialog', { name: /a quick look/ });
    expect(peek).toHaveClass('peek', 'stack-peek');
    expect(within(peek).getByRole('region', { name: 'Next step' })).toBeInTheDocument();
    expect(within(peek).getByRole('link', { name: 'Open the stack' })).toBeInTheDocument();
    expect(window.location.hash).toBe(`#/stacks?peek=${first.dataset.stack}`);
    // Back on the page later, the quick look is open again.
    unmount();
    wrap(<StacksPage />);
    expect(await screen.findByRole('dialog', { name: /a quick look/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /a quick look/ })).toBeNull();
    expect(window.location.hash).toBe('#/stacks');
  });

  it('How stacks work brings back the three picture cards at any time; Escape closes them', async () => {
    const { wrap } = setup({ '/api/stacks': list });
    wrap(<StacksPage />);
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: /How stacks work/ }));
    const guide = screen.getByRole('dialog', { name: 'New to stacks?' });
    expect(within(guide).getAllByRole('listitem').map((c) => c.querySelector('.guide-title')?.textContent)).toEqual(['One ticket, a few parts', 'Built side by side', 'Merged in order, pushed with your yes']);
    expect(guide).toHaveTextContent('You can open this again with How it works.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the cards by itself on the first visit, once', async () => {
    setStackGuideFirstVisit(true);
    const { wrap } = setup({ '/api/stacks': list });
    const first = wrap(<StacksPage />);
    expect(screen.getByRole('dialog', { name: 'New to stacks?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show me the stacks/ }));
    first.unmount();
    wrap(<StacksPage />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('with no stacks: what a stack is, when to use one, a way to start from a ticket, and How stacks work', async () => {
    setStackGuideFirstVisit(true);
    const { wrap } = setup({ '/api/stacks': { stacks: [], globalCap: 3, globalRunning: 0 } });
    wrap(<StacksPage />);
    const empty = await screen.findByRole('region', { name: 'Build a big feature as a stack' });
    expect(empty).toHaveTextContent('A stack splits a big ticket into parts.');
    expect(empty).toHaveTextContent('Use one when a ticket touches several areas');
    expect(within(empty).getByRole('link', { name: /Start a stack from a ticket/ })).toHaveAttribute('href', '#/inbox');
    expect(within(empty).getByRole('button', { name: /How stacks work/ })).toBeInTheDocument();
  });

  it('away from your own computer, says stacks run there; a failed read says so with Try again', async () => {
    const away = setup({ '/api/stacks': new ApiError(404, 'Stacks run only on the dashboard on your own computer.') });
    const a = away.wrap(<StacksPage />);
    expect(await screen.findByText(/Stacks run only on the dashboard on your own computer/)).toBeInTheDocument();
    a.unmount();
    const broken = setup({ '/api/stacks': new Error('The dashboard didn’t answer.') });
    broken.wrap(<StacksPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the stacks: The dashboard didn’t answer.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('one stack', () => {
  it('plan check: why it splits this way, the parts on the board, Approve plan (a) with the settings from Details', async () => {
    const view = stackView();
    const { wrap, post } = setup(one(view), { post: () => view });
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(screen.getByText('ORBIT-512')).toBeInTheDocument();
    expect(bar()).toHaveTextContent('Check the 3 parts, then approve');
    expect(bar()).toHaveTextContent('Parts 1 and 2 start right away. Part 3 waits for part 2.');
    const why = screen.getByRole('region', { name: 'Why the plan splits it this way' });
    expect(why).toHaveTextContent('The button and the writer change different folders.');
    expect(why).toHaveTextContent('Each of the 3 parts changes only its own files');
    expect(why).toHaveTextContent('Part 3 waits for part 2, because it builds on it.');
    expect(col('Ready to start')).toHaveTextContent('1');
    expect(within(col('Ready to start')).getAllByRole('button')).toHaveLength(2);
    expect(col('Waiting on a part')).toHaveTextContent('Waiting on part 2');
    expect(screen.getByRole('list', { name: 'Progress, part by part' })).toBeInTheDocument();
    // The settings start with the plan: 3 at once, merging on its own.
    fireEvent.keyDown(document.body, { key: 'd' });
    const details = screen.getByRole('dialog', { name: 'Details' });
    fireEvent.change(within(details).getByRole('spinbutton'), { target: { value: '3' } });
    fireEvent.click(within(details).getByRole('checkbox', { name: /Merge on its own/ }));
    fireEvent.click(within(details).getByRole('button', { name: 'Save' }));
    await act(async () => {});
    expect(post).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull());
    fireEvent.keyDown(document.body, { key: 'a' });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/stacks/orbit-512/approve-plan', { cap: 3, autoIntegrate: true }));
  });

  it('Change something (r) sends the Foreman a note about the plan', async () => {
    const view = stackView();
    const { wrap, post } = setup(one(view), { post: () => view });
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    fireEvent.keyDown(document.body, { key: 'r' });
    const sheet = screen.getByRole('dialog', { name: 'Change something in the plan' });
    expect(within(sheet).getByRole('button', { name: 'Send to the Foreman' })).toBeDisabled();
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'Put the email after the export.' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send to the Foreman' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/stacks/orbit-512/send-back', { note: 'Put the email after the export.' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a plan with problems lists them and asks the Foreman to fix it (f); no plan yet says the Foreman is writing it', async () => {
    const bad = stackView({ plan: { ok: false, errors: ['Section ui depends on “api”, which isn’t a section in this plan.'], warnings: [], changedSinceApproval: false } });
    const { wrap, post } = setup(one(bad), { post: () => bad });
    const first = wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(screen.getByText(/The plan has a problem to fix first/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'What to fix in the plan' })).toHaveTextContent('depends on “api”');
    fireEvent.keyDown(document.body, { key: 'f' });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/stacks/orbit-512/send-back', { note: expect.stringContaining('Please fix the stack plan (stack.md)') }));
    first.unmount();
    const none = setup(one(stackView({ plan: null, parts: [] })));
    none.wrap(<StackPage slug="orbit-512" />);
    expect(await screen.findByText('The Foreman is writing the plan', undefined, { timeout: 5000 })).toBeInTheDocument();
  });

  it('building, in Play full: the Desk’s grid and slow lights on the parts at work; nothing to do yet', async () => {
    const view = stackView({}, ['running', 'running', 'pending']);
    const { wrap } = setup(one(view), { play: 'full' });
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never;
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(document.querySelector('.page-stack-v')).toHaveClass('has-grid');
    expect(document.querySelectorAll('.stack-board .stack-light.is-pulse')).toHaveLength(2);
    expect(col('At work')).toHaveTextContent('2');
    expect(col('Waiting on a part')).toHaveTextContent('Waiting on part 2');
    expect(bar()).toHaveTextContent('Nothing to do right now');
    expect(bar()).toHaveTextContent('We’ll tell you when part 1 is ready to merge.');
    expect(within(bar()).getByRole('button', { name: /Merge part 1/ })).toBeDisabled();
  });

  it('building, in Play subtle and off: the same board and words; subtle has steady lights and no grid, off has none', async () => {
    const view = stackView({}, ['running', 'running', 'pending']);
    for (const play of ['subtle', 'off'] as const) {
      const { wrap } = setup(one(view), { play });
      const r = wrap(<StackPage slug="orbit-512" />);
      await shown();
      expect(document.querySelector('.page-stack-v')).not.toHaveClass('has-grid');
      expect(document.querySelectorAll('.stack-light.is-pulse')).toHaveLength(0);
      expect(document.querySelectorAll('.stack-board .stack-light')).toHaveLength(play === 'off' ? 0 : 2);
      expect(bar()).toHaveTextContent('Nothing to do right now');
      expect(bar().querySelector('.next-label')).toBeNull();
      r.unmount();
    }
  });

  it('a stuck part: says so in one line, sits under Needs you, Open part 2 (o) opens its page, and f lets the Foreman try again', async () => {
    const view = stackView({}, ['ready', 'failed', 'pending'], { 'csv-writer': { failures: 3 } });
    const { wrap, post } = setup(one(view), { post: () => view });
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(bar()).toHaveTextContent('Part 2 got stuck');
    expect(bar()).toHaveTextContent('Its tests failed 3 times. The Foreman stopped to ask you.');
    expect(col('Needs you')).toHaveTextContent('Stuck');
    expect(col('Needs you')).toHaveTextContent('Tests failed 3 times');
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(window.location.hash).toBe('#/stack/orbit-512/part/2');
    fireEvent.keyDown(document.body, { key: 'f' });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/stacks/orbit-512/send-back', { section: 'csv-writer' }));
  });

  it('ready: go / no go. Merge part 1 (m) merges it; Not yet (r) sends it back with a note', async () => {
    const view = { ...stackView({}, ['ready', 'running', 'pending']), next: { action: 'merge' as const, label: 'Merge part 1', key: 'm', section: 'export-button', words: 'Part 1 is ready.' } };
    const { wrap, post } = setup(one(view), { post: () => ({ started: true, view }) });
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(bar()).toHaveTextContent('Go / no go');
    expect(bar()).toHaveTextContent('Part 1 is ready to merge');
    expect(bar()).toHaveTextContent('Its checks passed. We’ll run them again after merging.');
    fireEvent.keyDown(document.body, { key: 'm' });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/stacks/orbit-512/merge', { section: 'export-button' }));
    await waitFor(() => expect(within(bar()).getByRole('button', { name: /Not yet/ })).toBeEnabled());
    fireEvent.click(within(bar()).getByRole('button', { name: /Not yet/ }));
    const sheet = screen.getByRole('dialog', { name: 'Not yet: part 1' });
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'The button label is wrong.' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send back' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/stacks/orbit-512/send-back', { section: 'export-button', note: 'The button label is wrong.' }));
  });

  it('Merge on its own: a ready part says it merges by itself, with no button', async () => {
    const view = { ...stackView({ autoIntegrate: true }, ['ready', 'running', 'pending']), next: { action: 'wait' as const, label: null, key: null, section: 'export-button', words: 'Part 1 is ready and merges on its own.' } };
    const { wrap } = setup(one(view));
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(bar()).toHaveTextContent('Part 1 is ready and merges on its own');
    expect(within(bar()).queryByRole('button')).toBeNull();
    expect(col('Ready to merge')).toHaveTextContent('1');
  });

  it('a clash: names the part it clashes with and the file, nothing merged, and f hands it to the Foreman', async () => {
    const view = stackView({}, ['integrated', 'blocked', 'pending'], { 'csv-writer': { problem: { kind: 'conflict', words: 'Clash.', files: ['app/ui/schedule/Toolbar.tsx'] } } });
    const { wrap, post } = setup(one(view), { post: () => view });
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(bar()).toHaveTextContent('Part 2 clashes with part 1');
    expect(bar()).toHaveTextContent('Both changed Toolbar.tsx. Nothing was merged.');
    expect(bar()).toHaveClass('stack-bar-problem');
    expect(col('Needs you')).toHaveTextContent('Clash with part 1 in Toolbar.tsx');
    expect(within(bar()).getByRole('button', { name: 'Open in editor' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'f' });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/stacks/orbit-512/send-back', { section: 'csv-writer' }));
  });

  it('files outside its own, and nothing to merge, each say so with one way on', async () => {
    const outside = stackView({}, ['integrated', 'blocked', 'pending'], { 'csv-writer': { problem: { kind: 'outside', words: 'x', files: ['app/ui/x.ts', 'app/ui/y.ts'] } } });
    const a = setup(one(outside));
    const r = a.wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(bar()).toHaveTextContent('Part 2 changed files that aren’t its own');
    expect(bar()).toHaveTextContent('x.ts and y.ts. Nothing was merged');
    expect(within(bar()).getByRole('button', { name: /Let the Foreman fix it/ })).toBeInTheDocument();
    r.unmount();
    const empty = stackView({}, ['integrated', 'blocked', 'pending'], { 'csv-writer': { problem: { kind: 'empty', words: 'x', files: [] } } });
    setup(one(empty)).wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(bar()).toHaveTextContent('Part 2 has nothing to merge yet');
  });

  it('tests failed after merging: the merge was undone, its Foreman is fixing it, See what failed shows the end of the output', async () => {
    const view = stackView({}, ['integrated', 'running', 'pending'], { 'csv-writer': { failures: 1, problem: { kind: 'checks', words: 'x', files: [], tail: 'not ok 211 - csv: a visit after midnight' } } });
    const { wrap } = setup(one(view));
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(bar()).toHaveTextContent('Part 2 broke the tests, so we undid it');
    expect(bar()).toHaveTextContent('The stack is back where it was. Its Foreman has what failed and is fixing it (try 1 of 3).');
    expect(col('At work')).toHaveTextContent('Tests failed after merging (undone) · try 1 of 3');
    fireEvent.click(within(bar()).getByRole('button', { name: 'See what failed' }));
    expect(screen.getByRole('region', { name: 'What failed' })).toHaveTextContent('not ok 211');
  });

  it('push: p asks go / no go first, with three ticks and where it goes; No go (Esc) pushes nothing; Go (p) says go', async () => {
    const view = stackView({}, ['integrated', 'integrated', 'integrated']);
    const { wrap, post } = setup(one(view), { post: () => view });
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(bar()).toHaveTextContent('All 3 parts merged and checked');
    fireEvent.keyDown(document.body, { key: 'p' });
    let box = screen.getByRole('dialog', { name: 'Push to GitHub?' });
    expect(within(box).getAllByRole('listitem').map((l) => l.textContent?.trim())).toEqual(['3 parts merged, in order', 'All tests pass', 'Each part stayed in its own files']);
    expect(box).toHaveTextContent('Goes to your fork · feature/orbit-512');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(bar()).getByRole('button', { name: /Push/ }));
    box = screen.getByRole('dialog', { name: 'Push to GitHub?' });
    fireEvent.keyDown(document, { key: 'p' });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/stacks/orbit-512/push', { go: true }));
  });

  it('“Merge on its own” never skips the push: it still asks', async () => {
    const view = stackView({ autoIntegrate: true }, ['integrated', 'integrated', 'integrated']);
    setup(one(view)).wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(within(bar()).getByRole('button', { name: /Push/ })).toBeEnabled();
  });

  it('pushed: the whole map is done, and Open the job (o) goes to the job where the pull request is opened', async () => {
    const view = stackView({ push: { state: 'pushed', approvedAt: null, pushedAt: '2026-10-29T16:02:00Z', note: null, remote: 'moxie' } }, ['integrated', 'integrated', 'integrated']);
    setup(one(view)).wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(bar()).toHaveTextContent(/Pushed at/);
    expect(bar()).toHaveTextContent('Next: open the pull request from the job.');
    expect(col('Merged')).toHaveTextContent('3');
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(window.location.hash).toBe('#/job/orbit-512');
  });

  it('settings after approval are saved on the stack; a refusal shows in words', async () => {
    const view = stackView({}, ['running', 'running', 'pending']);
    const { wrap, post } = setup(one(view), { post: (path) => { if (path.endsWith('/settings')) throw new ApiError(400, 'Parts at once must be a whole number from 1 to 20.'); return view; } });
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Merge on its own/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/stacks/orbit-512/settings', { cap: 2, autoIntegrate: true }));
    expect(await screen.findByText('Parts at once must be a whole number from 1 to 20.')).toBeInTheDocument();
  });

  it('a part’s quick look: its files, branch, port and job, with its page one key away; j and k move; History is in Details', async () => {
    const view = stackView({}, ['running', 'running', 'pending']);
    setup(one(view)).wrap(<StackPage slug="orbit-512" />);
    await shown();
    fireEvent.keyDown(document.body, { key: 'j' });
    const peek = screen.getByRole('dialog', { name: 'Part 1: a quick look' });
    expect(peek).toHaveTextContent('Part 1 of 3');
    expect(peek).toHaveTextContent('app/ui/schedule/Toolbar.tsx');
    expect(peek).toHaveTextContent('feature/orbit-512--export-button');
    expect(peek).toHaveTextContent('24811');
    expect(within(peek).getByRole('link', { name: 'Open the job' })).toHaveAttribute('href', '#/job/orbit-512--export-button');
    expect(within(peek).getByRole('link', { name: 'Open part 1' })).toHaveAttribute('href', '#/stack/orbit-512/part/1');
    expect(window.location.hash).toBe('#/stack/orbit-512?peek=1');
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(screen.getByRole('dialog', { name: 'Part 2: a quick look' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/stack/orbit-512?peek=2');
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(window.location.hash).toBe('#/stack/orbit-512/part/2');
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    const details = screen.getByRole('dialog', { name: 'Details' });
    expect(within(details).getByRole('region', { name: 'History' })).toHaveTextContent(/The plan was approved: 3 parts/);
  });

  it('keys wait while typing, with a box open, and with keys off', async () => {
    const view = stackView();
    const { wrap, post } = setup(one(view), { post: () => view });
    wrap(<><StackPage slug="orbit-512" /><input aria-label="Somewhere to type" /></>);
    await shown();
    const box = screen.getByRole('textbox', { name: 'Somewhere to type' });
    act(() => box.focus());
    fireEvent.keyDown(box, { key: 'a' });
    act(() => box.blur());
    act(() => { writeKeysSetting({ enabled: false }); });
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(post).not.toHaveBeenCalled();
  });

  it('the views: Board, Map and Timeline (1, 2, 3), remembered for the stack', async () => {
    const view = stackView({}, ['integrated', 'running', 'pending'], { 'export-button': { startedAt: new Date(Date.now() - 86400e3).toISOString(), mergedAt: new Date(Date.now() - 3600e3).toISOString() }, 'csv-writer': { startedAt: new Date(Date.now() - 7200e3).toISOString() } });
    const r = setup(one(view)).wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(screen.getByRole('tab', { name: /Board/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.body, { key: '2' });
    expect(screen.getByRole('tab', { name: /Map/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /^Part 3: .*Waits on part 2\.$/ })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '3' });
    const tl = screen.getByLabelText('Each part from its start to its merge');
    expect(within(tl).getByRole('button', { name: /^Part 1: .*Merged\. Took 23h\.$/ })).toBeInTheDocument();
    expect(within(tl).getByRole('button', { name: /^Part 3: .*Not started\.$/ })).toBeInTheDocument();
    r.unmount();
    setup(one(view)).wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(screen.getByRole('tab', { name: /Timeline/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('twelve parts: every one on the board in its column, and folding Merged moves nothing in the other columns', async () => {
    const base = stackView({}, ['running', 'running', 'pending']);
    const states = ['integrated', 'integrated', 'integrated', 'running', 'running', 'ready', 'pending', 'pending', 'failed', 'blocked', 'running', 'pending'] as const;
    const many = states.map((st, i) => part(i + 1, `p${i + 1}`, st, st === 'blocked' ? { problem: { kind: 'conflict', words: 'x', files: ['a.ts'] } } : {}));
    setup(one({ ...base, parts: many })).wrap(<StackPage slug="orbit-512" />);
    await shown();
    const board = screen.getByRole('list', { name: 'The parts by where they are' });
    const total = [...board.querySelectorAll('.board-card, .board-merged-row')].length;
    expect(total).toBe(12);
    expect(col('Merged')).toHaveTextContent('3');
    const before = col('At work').innerHTML;
    fireEvent.click(within(col('Merged')).getByRole('button', { name: 'Show' }));
    expect(col('Merged').querySelectorAll('.board-card')).toHaveLength(3);
    expect(col('At work').innerHTML).toBe(before);
  });

  it('no such stack, or the dashboard not answering, each say so with a way on', async () => {
    const missing = setup({});
    const r = missing.wrap(<StackPage slug="nope" />);
    expect(await screen.findByText(/There’s no stack called “nope”/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Stacks' })).toHaveAttribute('href', '#/stacks');
    r.unmount();
    setup({ '/api/stacks/orbit-512': new Error('Offline.') }).wrap(<StackPage slug="orbit-512" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the stack: Offline.');
  });

  it('first visit: the picture cards open over the plan, “Show me the plan” closes them, How it works brings them back', async () => {
    setStackGuideFirstVisit(true);
    setup(one(stackView())).wrap(<StackPage slug="orbit-512" />);
    const guide = await screen.findByRole('dialog', { name: 'New to stacks?' });
    fireEvent.click(within(guide).getByRole('button', { name: /Show me the plan/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /How it works/ }));
    expect(screen.getByRole('dialog', { name: 'New to stacks?' })).toBeInTheDocument();
  });
});
