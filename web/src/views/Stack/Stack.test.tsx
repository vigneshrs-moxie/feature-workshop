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
import { writeStored } from '../../lib/stored';
import { createStore, WorkshopContext } from '../../state/store';
import { snapshot } from '../../state/test-fixtures';
import { part, stackView, summary } from './fixtures';
import { StackPage } from './StackPage';
import { StacksPage } from './StacksPage';
import { setStackGuideFirstVisit } from './StackGuide';
import { STACK_PICTURE_KEY } from './StackPicture';

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

  it('a click on a card’s body opens a quick look with its next step and parts; Escape closes it', async () => {
    const { wrap } = setup({ '/api/stacks': list });
    wrap(<StacksPage />);
    const cards = await screen.findByRole('list', { name: 'Stacks' });
    fireEvent.click(cards.querySelector(':scope > li .shc-why')!);
    const peek = screen.getByRole('dialog', { name: /a quick look/ });
    expect(within(peek).getByRole('region', { name: 'Next step' })).toBeInTheDocument();
    expect(within(peek).getByRole('link', { name: 'Open the stack' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /a quick look/ })).toBeNull();
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
  it('plan check: the map, each step in one line, why it splits this way, and Approve plan (a) with the settings', async () => {
    const view = stackView();
    const { wrap, post } = setup(one(view), { post: () => view });
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(screen.getByText('ORBIT-512')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /The stack’s map/ })).toBeInTheDocument();
    expect(screen.getByText('You are here')).toBeInTheDocument();
    const lines = screen.getByRole('list', { name: 'What happens at each step' });
    expect(within(lines).getAllByRole('listitem').map((l) => l.querySelector('b')?.textContent)).toEqual(['Plan · now', 'Build', 'Merge', 'Push']);
    expect(lines).toHaveTextContent('You check them and approve.');
    expect(bar()).toHaveTextContent('Check the 3 parts, then approve');
    expect(bar()).toHaveTextContent('Parts 1 and 2 start right away. Part 3 waits for part 2.');
    const why = screen.getByRole('region', { name: 'Why the plan splits it this way' });
    expect(why).toHaveTextContent('The button and the writer change different folders.');
    expect(why).toHaveTextContent('Each of the 3 parts changes only its own files');
    expect(why).toHaveTextContent('Part 3 waits for part 2, because it builds on it.');
    const cards = screen.getByRole('list', { name: 'The parts, in merge order' });
    expect([...cards.querySelectorAll('li.stack-part')].map((c) => c.querySelector('.part-chip')?.textContent?.trim())).toEqual(['Ready to start', 'Ready to start', 'After part 2']);
    // The settings start with the plan: 3 at once, merging on its own.
    fireEvent.click(screen.getByRole('button', { name: /Stack settings/ }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Merge on its own/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(post).not.toHaveBeenCalled();
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

  it('building, in Play full: the grid, a pulsing dot while its Foreman works, lights on the cards; nothing to do yet', async () => {
    const view = stackView({}, ['running', 'running', 'pending']);
    const { wrap } = setup(one(view), { play: 'full' });
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as never;
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(document.querySelector('.stack-map')).toHaveClass('has-grid');
    expect(document.querySelectorAll('.map-dot.is-pulse')).toHaveLength(2);
    expect(document.querySelectorAll('.stack-light')).toHaveLength(3);
    expect(document.querySelectorAll('.map-chip')[0]).toHaveTextContent('Building');
    expect(document.querySelectorAll('.map-chip')[2]).toHaveTextContent('Waits for part 2');
    expect(bar()).toHaveTextContent('Nothing to do right now');
    expect(bar()).toHaveTextContent('We’ll tell you when part 1 is ready to merge.');
    expect(within(bar()).getByRole('button', { name: /Merge part 1/ })).toBeDisabled();
  });

  it('building, in Play subtle and off: the same map and words; subtle has steady lights and no grid, off has none', async () => {
    const view = stackView({}, ['running', 'running', 'pending']);
    for (const play of ['subtle', 'off'] as const) {
      const { wrap } = setup(one(view), { play });
      const r = wrap(<StackPage slug="orbit-512" />);
      await shown();
      expect(document.querySelector('.stack-map')).not.toHaveClass('has-grid');
      expect(document.querySelectorAll('.map-dot.is-pulse')).toHaveLength(0);
      expect(document.querySelectorAll('.stack-light')).toHaveLength(play === 'off' ? 0 : 3);
      expect(bar()).toHaveTextContent('Nothing to do right now');
      expect(bar().querySelector('.next-label')).toBeNull();
      r.unmount();
    }
  });

  it('a stuck part: says so in one line, Open part 2 (o) opens its job, and f lets the Foreman try again', async () => {
    const view = stackView({}, ['ready', 'failed', 'pending'], { 'csv-writer': { failures: 3 } });
    const { wrap, post } = setup(one(view), { post: () => view });
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(bar()).toHaveTextContent('Part 2 got stuck');
    expect(bar()).toHaveTextContent('Its tests failed 3 times. The Foreman stopped to ask you.');
    expect(document.querySelectorAll('.map-chip')[1]).toHaveTextContent('Needs you');
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(window.location.hash).toBe('#/job/orbit-512--csv-writer');
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
    expect(screen.getByRole('list', { name: 'What happens at each step' })).toHaveTextContent('so they join by themselves');
  });

  it('a clash: names the part it clashes with and the file, nothing merged, and f hands it to the Foreman', async () => {
    const view = stackView({}, ['integrated', 'blocked', 'pending'], { 'csv-writer': { problem: { kind: 'conflict', words: 'Clash.', files: ['app/ui/schedule/Toolbar.tsx'] } } });
    const { wrap, post } = setup(one(view), { post: () => view });
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(bar()).toHaveTextContent('Part 2 clashes with part 1');
    expect(bar()).toHaveTextContent('Both changed Toolbar.tsx. Nothing was merged.');
    expect(bar()).toHaveClass('stack-bar-problem');
    expect(document.querySelectorAll('.map-chip')[1]).toHaveTextContent('Conflict');
    expect(document.querySelector('.map-dot.is-mark')).not.toBeNull();
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
    expect(document.querySelectorAll('.map-chip')[1]).toHaveTextContent('Tests failed');
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
    expect(screen.queryByText('You are here')).toBeNull();
    expect(document.querySelectorAll('.map-node.is-done')).toHaveLength(3);
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(window.location.hash).toBe('#/job/orbit-512');
  });

  it('settings after approval are saved on the stack; a refusal shows in words', async () => {
    const view = stackView({}, ['running', 'running', 'pending']);
    const { wrap, post } = setup(one(view), { post: (path) => { if (path.endsWith('/settings')) throw new ApiError(400, 'Parts at once must be a whole number from 1 to 20.'); return view; } });
    wrap(<StackPage slug="orbit-512" />);
    await shown();
    fireEvent.click(screen.getByRole('button', { name: /Stack settings/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/stacks/orbit-512/settings', { cap: 2, autoIntegrate: false }));
    expect(await screen.findByText('Parts at once must be a whole number from 1 to 20.')).toBeInTheDocument();
  });

  it('Details opens a part’s files, branch, port and job; History lists what happened', async () => {
    const view = stackView({}, ['running', 'running', 'pending']);
    setup(one(view)).wrap(<StackPage slug="orbit-512" />);
    await shown();
    const card = screen.getByRole('list', { name: 'The parts, in merge order' }).querySelectorAll('li.stack-part')[0] as HTMLElement;
    fireEvent.click(within(card).getByText('Details'));
    expect(card).toHaveTextContent('app/ui/schedule/Toolbar.tsx');
    expect(card).toHaveTextContent('feature/orbit-512--export-button');
    expect(card).toHaveTextContent('24811');
    expect(within(card).getByRole('link', { name: /Open part 1’s job/ })).toHaveAttribute('href', '#/job/orbit-512--export-button');
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText(/The plan was approved: 3 parts/)).toBeInTheDocument();
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

  it('the other picture: four big steps (Settings → Look → Stack picture)', async () => {
    writeStored(STACK_PICTURE_KEY, 'steps');
    setup(one(stackView({}, ['running', 'running', 'pending']))).wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(document.querySelector('.stack-map')).toBeNull();
    const steps = screen.getByRole('list', { name: 'The four steps' });
    expect(within(steps).getAllByRole('listitem').map((s) => s.textContent)).toEqual(['Plan✓ Done', 'BuildNow · Side by side', 'MergeOne at a time', 'PushWith your yes']);
    expect(within(steps).getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step');
  });

  it('more than six parts: the map shows the ones at work, then “and 3 more waiting”', async () => {
    const base = stackView({}, ['running', 'running', 'pending']);
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((n, i) => part(i + 1, n, i < 6 ? 'running' : 'pending'));
    setup(one({ ...base, parts: many })).wrap(<StackPage slug="orbit-512" />);
    await shown();
    expect(document.querySelectorAll('.map-row')).toHaveLength(6);
    expect(document.querySelector('.map-more')).toHaveTextContent('and 3 more waiting');
    expect(document.querySelector('.stack-map')).toHaveClass('is-dense');
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
