// A part's own page (packet V): its place in the stack, its problem with one action, its changes
// with one file's diff, its checks, the merge checklist in words, and [ ] o.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { PartPageData } from '../../api/types';
import { installKeyListener } from '../../app/keyRegistry';
import { hrefFor, parseHash } from '../../app/router';
import { UiProvider } from '../../app/ui';
import { createStore, WorkshopContext } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { part } from './fixtures';
import { PartPage } from './PartPage';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const partCss = readFileSync(join(process.cwd(), 'src/views/Stack/part-page.css'), 'utf8');

const seg = (n: number, lane: 'merged' | 'needs-you' | 'ready' | 'waiting', title: string) => ({ n, name: `p${n}`, title, lane, laneWords: lane === 'needs-you' ? 'Clash at its merge' : lane === 'merged' ? 'Merged' : lane === 'ready' ? 'Ready to merge' : 'Waiting on part 2', slug: `s--p${n}` });

function page(over: Partial<PartPageData['part']> = {}): PartPageData {
  const p = {
    ...part(2, 'email', 'blocked', { problem: { kind: 'conflict', words: 'It clashes.', files: ['app/billing/billing.ts'] } }),
    brief: 'Email delivery: send an invoice as a PDF.', title: 'Email delivery', lane: 'needs-you' as const, laneWords: 'Clash at its merge',
    dependsOnN: [1], unblocks: [3], waitsOn: [], costUsd: 4.2, ...over,
  };
  return {
    stack: { slug: 's', title: 'Invoice export', ticketKey: 'ORBIT-521', total: 3, why: null, parentBranch: 'feature/s', approved: true, nextToMerge: 'email', busy: null, autoIntegrate: false, parts: [seg(1, 'merged', 'The model'), seg(2, 'needs-you', 'Email delivery'), seg(3, 'waiting', 'Reports')] },
    part: p, prev: seg(1, 'merged', 'The model'), next: seg(3, 'waiting', 'Reports'),
    history: [{ at: new Date().toISOString(), event: 'conflict', words: 'Part email clashes.', checks: null, undone: null }],
    checklist: [
      { id: 'checks', ok: null, words: 'Its checks haven’t run yet' },
      { id: 'clash', ok: false, words: 'It clashes with the stack’s branch in billing.ts' },
      { id: 'owned', ok: true, words: 'It changed only its own files' },
      { id: 'waits', ok: true, words: 'The parts it waits on are merged' },
      { id: 'order', ok: true, words: 'It is next in the merge order' },
    ],
    risks: [{ kind: 'clash', tone: 'error', parts: [1, 2], words: 'Clash: parts 1 and 2 both change billing.ts' }],
    changes: { files: [{ file: 'app/billing/billing.ts', added: 13, removed: 19, binary: false }, { file: 'app/email/send.ts', added: 30, removed: 0, binary: false }], added: 43, removed: 19, base: 'feature/s', branch: 'feature/s--email' },
  };
}

function setup(data: PartPageData, jobs: ReturnType<typeof job>[] = []) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) });
  const get = vi.fn(async (path: string) => (path.includes('/diff?file=') ? { file: 'app/email/send.ts', diff: 'diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old line\n+new line\n' } : path.startsWith('/api/job/') ? { slug: 'orbit-512--email', thread: [], threadMore: false } : data));
  const post = vi.fn(async () => ({}));
  const api = { get, post } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><PartPage slug="s" n={2} /></UiProvider></WorkshopContext.Provider> as ReactNode);
  return { get, post };
}

let off = () => {};
beforeEach(() => { off = installKeyListener(); window.location.hash = '#/stack/s/part/2'; });
afterEach(() => { off(); localStorage.clear(); window.location.hash = ''; });

describe('a part’s own page', () => {
  it('lives at #/stack/<slug>/part/<n>', () => {
    expect(parseHash('#/stack/invoice-export/part/4')).toEqual({ name: 'stack-part', slug: 'invoice-export', n: 4 });
    expect(hrefFor({ name: 'stack-part', slug: 'a b', n: 2 })).toBe('#/stack/a%20b/part/2');
    expect(parseHash('#/stack/x/part/0')).toEqual({ name: 'not-found', hash: '#/stack/x/part/0' });
  });

  it('says its place, what it is for, waits on and unblocks, and its clash with one action', async () => {
    const { post } = setup(page());
    const head = await screen.findByRole('heading', { name: /Part 2 of 3\s*Email delivery/ });
    expect(head).toBeInTheDocument();
    const strip = screen.getByRole('region', { name: 'Its place in the stack' });
    expect(strip).toHaveTextContent('Email delivery: send an invoice as a PDF.');
    expect(within(strip).getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([['Part 1 · The model', '#/stack/s/part/1'], ['Part 3 · Reports', '#/stack/s/part/3']]);
    expect(strip).toHaveTextContent('$4.20');
    const bar = screen.getByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Clash: parts 1 and 2 both change billing.ts');
    expect(bar).toHaveTextContent('Nothing was merged');
    fireEvent.click(within(bar).getByRole('button', { name: 'Let the Foreman fix it' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/stacks/s/send-back', { section: 'email' }));
  });

  it('its changes with + and −, a click shows one file’s diff; the checklist in words; Merge waits until every line is met', async () => {
    setup(page());
    const changes = await screen.findByRole('region', { name: 'Changes' });
    expect(changes).toHaveTextContent('+43');
    expect(changes).toHaveTextContent('−19');
    fireEvent.click(within(changes).getByRole('button', { name: /send\.ts/ }));
    const sheet = await screen.findByRole('dialog', { name: 'app/email/send.ts' });
    await waitFor(() => expect(within(sheet).getByLabelText('Changes to app/email/send.ts')).toHaveTextContent('+new line'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    const list = screen.getByRole('region', { name: 'Ready to merge' });
    expect(list).toHaveTextContent('It clashes with the stack’s branch in billing.ts');
    expect(list).toHaveTextContent('not met');
    expect(within(list).getByRole('button', { name: 'Merge part 2' })).toBeDisabled();
  });

  it('ready and next: Merge asks first; [ ] move between parts and o opens its job', async () => {
    const { post } = setup(page({ state: 'ready', problem: null, lane: 'ready', laneWords: 'Ready to merge' }));
    const bar = await screen.findByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Part 2 is ready to merge');
    fireEvent.click(within(bar).getByRole('button', { name: 'Merge part 2' }));
    const ask = screen.getByRole('dialog', { name: 'Merge part 2?' });
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Merge part 2' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/stacks/s/merge', { section: 'email' }));
    await act(async () => {});
    fireEvent.keyDown(document.body, { key: ']' });
    expect(window.location.hash).toBe('#/stack/s/part/3');
    fireEvent.keyDown(document.body, { key: '[' });
    expect(window.location.hash).toBe('#/stack/s/part/1');
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(window.location.hash).toBe('#/job/orbit-512--email');
  });

  it('the job’s level is a fact in the strip with Choose, its card in a sheet; the conversation holds only the conversation', async () => {
    setup(page(), [job('orbit-512--email', 'running', { level: null, suggestedLevel: 2 } as never)]);
    const strip = await screen.findByRole('region', { name: 'Its place in the stack' });
    await waitFor(() => expect(strip).toHaveTextContent('Level'));
    expect(strip).toHaveTextContent('Not chosen yet');
    // The thread's own level card is hidden here (part-page.css); the strip and its sheet carry it.
    await waitFor(() => expect(document.querySelector('.part-convo .thread > .level-card')).toBeInTheDocument());
    expect(partCss).toMatch(/\.part-convo \.thread > \.level-card \{ display: none; \}/);
    fireEvent.click(within(strip).getByRole('button', { name: 'Choose' }));
    const sheet = await screen.findByRole('dialog', { name: 'The level for part 2’s job' });
    expect(within(sheet).getByRole('heading', { name: 'Pick a level for this job' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'The level for part 2’s job' })).not.toBeInTheDocument());
    expect(within(strip).queryByRole('button', { name: 'Choose' })).not.toBeInTheDocument();
  });
});
