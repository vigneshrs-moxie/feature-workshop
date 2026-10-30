// Stacks on the other pages (packet K2): a stack is one card on Jobs that opens into its parts (and
// its parts get no cards of their own); a part's Job page says "Part 2 of stack ORBIT-512"; the
// Foreman's suggestion with "Run as a stack instead"; Settings → Look no longer offers a Stack
// picture (packet V's stack page has Board, Map and Timeline). And the plain words of the Stack
// pages (stackModel), state by state.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job } from '../../api/types';
import { installKeyListener, KEYS } from '../../app/keyRegistry';
import { UiProvider } from '../../app/ui';
import { JobsPage } from '../../home/JobsPage';
import { createStore, WorkshopContext } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { LookSettings } from '../Settings/LookSettings';
import { stackView, summary } from './fixtures';
import { indexStacks, PartOfStack, RUN_AS_STACK_TEXT, StackSuggestion } from './StackRows';
import { nextStep, ownsFile, splitWhy, startLine, summaryChip } from './stackModel';

const building = stackView({ next: { action: 'wait', label: null, key: null, words: 'Building.' } }, ['running', 'ready', 'pending']);
const LIST = { stacks: [summary(building)], globalCap: 3, globalRunning: 1 };

function setup(jobs: Job[], post = vi.fn(async () => ({}))) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) });
  const api = { get: vi.fn(async (p: string) => (p === '/api/stacks' ? LIST : {})), post } as unknown as ApiClient;
  const wrap = (ui: ReactNode) => render(<WorkshopContext.Provider value={{ store, api }}><UiProvider>{ui}</UiProvider></WorkshopContext.Provider>);
  return { wrap, post, store };
}

let off = () => {};
beforeEach(() => { off = installKeyListener(); });
afterEach(() => { off(); localStorage.clear(); });

describe('a stack on Jobs', () => {
  const jobs = [
    job('orbit-512', 'running', { title: 'Tech schedule export', lane: 'working', laneReason: 'The crew is at work' }),
    job('orbit-512--export-button', 'running', { title: 'Tech schedule export · export-button', lane: 'working' }),
    job('orbit-512--csv-writer', 'idle', { title: 'Tech schedule export · csv-writer', lane: 'resting' }),
    job('other', 'running', { title: 'Something else', lane: 'working' }),
  ];

  it('is one card with four dots for Plan, Build, Merge and Push; "3 parts" opens its parts; its parts have no cards of their own', async () => {
    const { wrap } = setup(jobs);
    wrap(<JobsPage />);
    const working = await screen.findByRole('region', { name: 'Working, 2' });
    const card = working.querySelector('.stack-card') as HTMLElement;
    expect(within(card).getByRole('link', { name: 'Tech schedule export' })).toHaveAttribute('href', '#/stack/orbit-512');
    expect(within(card).getByRole('img', { name: /Plan: done, Build: done, Merge: now, Push: not yet/ })).toBeInTheDocument();
    expect(card).toHaveTextContent('Stack · merge · 1 of 3 running');
    expect(card).toHaveTextContent('Merging');
    fireEvent.click(within(card).getByText('3 parts'));
    const rows = card.querySelectorAll('.stack-card-parts li');
    expect([...rows].map((r) => r.textContent)).toEqual(['1export-buttonBuilding', '2csv-writerReady to merge', '3emailQueued']);
    expect(within(card).getByRole('link', { name: 'export-button' })).toHaveAttribute('href', '#/job/orbit-512--export-button');
    expect(screen.queryByText('Tech schedule export · export-button')).toBeNull();
    expect(screen.queryByText('Tech schedule export · csv-writer')).toBeNull();
    expect(screen.getByRole('link', { name: 'Something else' })).toBeInTheDocument();
  });

  it('without stacks (or an older dashboard), Jobs is as before', async () => {
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, meta: { token: 't' } as never }) });
    const api = { get: vi.fn(async () => { throw new Error('Not found'); }), post: vi.fn() } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><JobsPage /></UiProvider></WorkshopContext.Provider>);
    await act(async () => {});
    expect(document.querySelector('.stack-card')).toBeNull();
    expect(screen.getByRole('link', { name: 'Tech schedule export · export-button' })).toBeInTheDocument();
  });
});

describe('a part’s Job page, and the Foreman’s suggestion', () => {
  const index = indexStacks(LIST.stacks);

  it('says “Part 2 of stack ORBIT-512” with a link; the stack’s own job says it is a stack of 3 parts; others say nothing', () => {
    const { wrap } = setup([]);
    const a = wrap(<PartOfStack slug="orbit-512--csv-writer" index={index} />);
    expect(screen.getByRole('link', { name: /Part 2 of stack ORBIT-512/ })).toHaveAttribute('href', '#/stack/orbit-512');
    a.unmount();
    const b = wrap(<PartOfStack slug="orbit-512" index={index} />);
    expect(screen.getByRole('link', { name: /A stack of 3 parts/ })).toHaveAttribute('href', '#/stack/orbit-512');
    b.unmount();
    wrap(<PartOfStack slug="other" index={index} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('when the first brief says the ticket looks big: one line saying why, and Run as a stack instead tells the Foreman', async () => {
    const big = job('orbit-600', 'needs-you', { title: 'Holiday hours', stackSuggested: 'It touches the booking page, the email and the API.' });
    const { wrap, post } = setup([big]);
    wrap(<StackSuggestion job={big} index={index} />);
    const box = screen.getByRole('region', { name: 'The Foreman suggests a stack' });
    expect(box).toHaveTextContent('The Foreman thinks this ticket is big enough for a stack. It touches the booking page, the email and the API.');
    expect(box).toHaveTextContent('built side by side, then joined in order');
    fireEvent.click(within(box).getByRole('button', { name: 'Run as a stack instead' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/job/orbit-600/send', { kind: 'message', text: RUN_AS_STACK_TEXT }));
    expect(await within(box).findByRole('status')).toHaveTextContent('Sent. The Foreman writes the stack’s plan next.');
  });

  it('says nothing without a suggestion, or once the job is a stack or a part', () => {
    const { wrap } = setup([]);
    wrap(<>
      <StackSuggestion job={job('x', 'idle', {})} index={index} />
      <StackSuggestion job={job('orbit-512', 'idle', { stackSuggested: 'Big.' })} index={index} />
    </>);
    expect(screen.queryByRole('region')).toBeNull();
  });
});

describe('Settings → Look', () => {
  it('has no Stack picture: the stack page itself offers Board, Map and Timeline', () => {
    const { wrap } = setup([]);
    wrap(<LookSettings />);
    expect(screen.queryByRole('group', { name: 'Stack picture' })).toBeNull();
    expect(screen.queryByText(/Merge map|Four big steps/)).toBeNull();
  });
});

describe('the words (stackModel)', () => {
  it('the start line, and why it splits', () => {
    const v = stackView();
    expect(startLine(v)).toBe('Parts 1 and 2 start right away. Part 3 waits for part 2.');
    expect(startLine({ ...v, cap: 1 })).toBe('Part 1 starts right away. Part 2 starts when one of those finishes (1 at once). Part 3 waits for part 2.');
    expect(splitWhy(v)).toEqual([
      'The button and the writer change different folders.',
      'Each of the 3 parts changes only its own files, so they can be built side by side without getting in each other’s way.',
      'Part 3 waits for part 2, because it builds on it.',
      'They merge in this order, one at a time: 1, 2, 3.',
    ]);
  });

  it('a clash is with the merged part that owns the file', () => {
    expect(ownsFile('app/ui/**', 'app/ui/a/b.tsx')).toBe(true);
    expect(ownsFile('app/ui/*.ts', 'app/ui/a.ts')).toBe(true);
    expect(ownsFile('app/ui/*.ts', 'app/ui/a/b.ts')).toBe(false);
    expect(ownsFile('docs/x.md', 'docs/x.md')).toBe(true);
    const v = stackView({}, ['integrated', 'blocked', 'pending'], { 'csv-writer': { problem: { kind: 'conflict', words: '', files: ['app/lib/elsewhere.ts'] } } });
    expect(nextStep(v).say).toBe('Part 2 clashes with what is merged');
  });

  it('a stack’s word on the list', () => {
    expect(summaryChip({ action: 'approve-plan', phase: 'plan', needs: '' })).toEqual({ word: 'Needs you: check the plan', tone: 'needs-you' });
    expect(summaryChip({ action: 'fix-plan', phase: 'plan', needs: 'There is no stack plan (stack.md) yet. The Foreman writes it.' })).toEqual({ word: 'The plan is being written', tone: 'working' });
    expect(summaryChip({ action: 'fix-plan', phase: 'plan', needs: 'The plan has a problem' }).tone).toBe('needs-you');
    expect(summaryChip({ action: 'wait', phase: 'merge', needs: '' }).word).toBe('Merging');
    expect(summaryChip({ action: 'open-job', phase: 'pushed', needs: '' })).toEqual({ word: 'Pushed', tone: 'done' });
  });

  it('every button on the bar has a key the registry knows, scoped to the stack', () => {
    const states = [
      stackView(), stackView({}, ['failed', 'pending', 'pending'], { 'export-button': { failures: 3 } }),
      { ...stackView({}, ['ready', 'running', 'pending']), next: { action: 'merge' as const, label: '', key: 'm', section: 'export-button', words: '' } },
      stackView({}, ['integrated', 'integrated', 'integrated']),
    ];
    for (const v of states) {
      const n = nextStep(v);
      for (const b of [n.primary, n.second]) if (b?.key) expect(['stack'], b.key).toContain(KEYS[b.key].scope);
    }
  });
});
