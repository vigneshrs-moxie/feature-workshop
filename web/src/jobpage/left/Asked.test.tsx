// What you asked (Task 18, R5): when the Foreman comes back from a send-back with its answer to each
// note, Your move shows `What you asked · 3 of 3 done` and one line per note that opens that exact
// change; a note not done says why and has `Ask again`, which puts it back as a chip. Made-up job.
import { act, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { clearAllSent } from '../../lib/sentState';
import { clearGateSent } from '../../panes/Foreman/gateSent';
import { chipText, openNotes, PLAN, reader, settle } from '../fixtures/notesPage';
import { notesKey, type PageNote } from '../jobStore';
import type { ApiClient } from '../../api/client';
import { loadCommits, useBranch } from '../reader/branch';
import { forgetRecentPages } from '../recent';
import type { JobPagePayload, NoteAnswer } from '../types';
import { forgetSentGo } from './YourMove';

const SLUG = 'orbit-905-crew-schedule-export';

const DONE3: NoteAnswer[] = [
  { n: 1, note: 'use the existing badge', place: 'Implementation plan v2 · step S1 "The row limit adds a second"', done: true, what: 'Implementation plan v2 · step S1 now uses the badge', target: { kind: 'doc', id: PLAN }, ask: { kind: 'change', place: 'Implementation plan v2 · step S1 "The row limit adds a second"', quote: null, note: 'use the existing badge' } },
  { n: 2, note: 'a smaller badge', place: 'src/EmployeesTable.tsx:88 (commit 1a2b3c4)', done: true, what: 'commit abc1234 · EmployeesTable.tsx', target: { kind: 'changes', id: 'changes' }, commit: { sha: 'abc1234', file: 'EmployeesTable.tsx' }, ask: { kind: 'change', place: 'src/EmployeesTable.tsx:88 (commit 1a2b3c4)', quote: null, note: 'a smaller badge' } },
  { n: 3, note: 'Explain', place: 'Findings · major · Saves twice', done: true, explained: true, what: 'The form submits as well as the button.', target: { kind: 'findings', id: 'findings' }, ask: { kind: 'explain', place: 'Findings · major · Saves twice', quote: null, note: null } },
];
const NOT_DONE: NoteAnswer = { n: 3, note: 'Drop this', place: 'Product spec v0.5 · acceptance line 6', done: false, what: 'needs your answer: keep the PDF export for admins?', target: null, ask: { kind: 'drop', place: 'Product spec v0.5 · acceptance line 6', quote: 'Export to PDF', note: null } };

const withAsked = (notes: NoteAnswer[], move: 'gate' | null = null) => (p: JobPagePayload) => {
  if (!move) p.move = null;
  p.asked = { total: notes.length, done: notes.filter((x) => x.done).length, notes };
};
const asked = () => document.querySelector<HTMLElement>('.jp2-asked');
const lines = () => [...asked()!.querySelectorAll<HTMLElement>('.jp2-asked-i')];

let offKeys: () => void = () => {};
beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear(); forgetRecentPages(); forgetSentGo(); offKeys = installKeyListener(); resetChord();
});
afterEach(() => { offKeys(); vi.unstubAllGlobals(); localStorage.clear(); clearAllSent(); clearGateSent(); window.history.replaceState(null, '', '/'); });

describe('What you asked', () => {
  it('a reply without the block: no What you asked, Your move as today', async () => {
    openNotes({ read: null, patch: (p) => { p.move = null; p.asked = null; } });
    await settle();
    expect(asked()).toBeNull();
    expect(document.querySelector('.jp2-ym-one')).not.toBeNull();
  });

  it('shows `What you asked · the Foreman says 3 of 3 done` in Your move’s slot, one line per note: the note, then what changed', async () => {
    openNotes({ read: null, patch: withAsked(DONE3) });
    await settle();
    const box = asked()!;
    expect(box.closest('.jp2-ym')).not.toBeNull();
    expect(within(box).getByText('What you asked · the Foreman says 3 of 3 done')).toBeTruthy();
    expect(lines().map((l) => [l.querySelector('.jp2-asked-note')!.textContent, l.querySelector('.jp2-asked-what')!.textContent])).toEqual([
      ['use the existing badge', 'Implementation plan v2 · step S1 now uses the badge'],
      ['a smaller badge', 'commit abc1234 · EmployeesTable.tsx'],
      ['Explain', 'The form submits as well as the button.'],
    ]);
    // Nothing waits for him: no one-line state in the slot as well.
    expect(document.querySelector('.jp2-ym-one')).toBeNull();
    expect(within(box).queryByRole('button', { name: /Ask again/ })).toBeNull();
  });

  it('a line opens that exact change: the document’s version in the reader; a commit and its file in Changes', async () => {
    const o = openNotes({ read: { kind: 'conversation', id: 'conversation' }, patch: withAsked(DONE3) });
    await settle();
    act(() => { fireEvent.click(within(lines()[0]).getByRole('button', { name: /use the existing badge/ })); });
    await settle();
    expect(o.store.getState().ui.reader).toEqual({ kind: 'doc', id: PLAN });
    expect(reader().querySelector('.jp2-rv-title')!.textContent).toBe('Implementation plan');
    act(() => { fireEvent.click(within(lines()[1]).getByRole('button', { name: /a smaller badge/ })); });
    await settle();
    expect(o.store.getState().ui.reader).toEqual({ kind: 'changes', id: 'changes' });
    let pick: { sha: string | null; path: string | null } | null = null;
    function Peek() { pick = useBranch(o.store).pick; return null; }
    const { render } = await import('@testing-library/react');
    render(<Peek />);
    expect(pick).toEqual({ sha: 'abc1234', path: 'EmployeesTable.tsx' });
  });

  it('a note not done says why and has Ask again, which puts that note back as a chip (once)', async () => {
    openNotes({ read: null, patch: withAsked([DONE3[0], DONE3[1], NOT_DONE]) });
    await settle();
    expect(within(asked()!).getByText('What you asked · the Foreman says 2 of 3 done')).toBeTruthy();
    const line = lines()[2];
    expect(line.classList.contains('is-not')).toBe(true);
    expect(line.querySelector('.jp2-asked-what')!.textContent).toBe('needs your answer: keep the PDF export for admins?');
    expect(within(line).getByText('Not done')).toBeTruthy();
    act(() => { fireEvent.click(within(line).getByRole('button', { name: 'Ask again' })); });
    await settle();
    expect(chipText()).toEqual(['Product spec v0.5 acceptance line 6 · drop']);
    const kept = JSON.parse(localStorage.getItem(notesKey(SLUG))!).notes as PageNote[];
    expect(kept.map((n) => [n.kind, n.place, n.quote, n.note])).toEqual([['drop', 'Product spec v0.5 · acceptance line 6', 'Export to PDF', '']]);
    expect(within(lines()[2]).queryByRole('button', { name: 'Ask again' })).toBeNull();
    expect(within(lines()[2]).getByText(/Back in your notes/)).toBeTruthy();
  });

  it('with a gate waiting too, the gate’s card comes first and What you asked sits under it', async () => {
    openNotes({ read: null, patch: withAsked(DONE3, 'gate') });
    await settle();
    const ym = document.querySelector<HTMLElement>('.jp2-ym')!;
    const card = ym.querySelector('.jp2-card')!;
    expect(card).not.toBeNull();
    expect(card.compareDocumentPosition(asked()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // (In Your move: on a laptop the conversation's column beside it has lines that start with Go too.)
    expect(within(ym).getByRole('button', { name: /^Go(?! faster)/ })).toBeTruthy();
  });
});

describe('Task 18 fix round 1: a commit the Foreman names that is not on the branch', () => {
  it('its line says so and opens nothing; a commit that is there stays a link', async () => {
    const o = openNotes({ read: null, patch: withAsked([DONE3[1], { ...DONE3[1], n: 4, note: 'the real one', what: 'commit b81b49e · week.ts', commit: { sha: 'b81b49e', file: 'week.ts' } }]) });
    await settle();
    const commits = [{ sha: 'b81b49e7f5a657e2d701ccca3e5a3a455ed7b41b', short: 'b81b49e7', subject: 's', date: null, files: [{ path: 'app/offices/week.ts', added: 1, removed: 0 }] }];
    // The page reads the list again for the sha it does not find (B3); that read answers too (final W9:
    // a re-read that fails leaves the line unknown).
    o.get.mockImplementation(async () => ({ commits }));
    await act(async () => { await loadCommits(o.store, { get: async () => ({ commits }) } as unknown as ApiClient, SLUG); });
    await settle();
    const [gone, there] = lines();
    expect(within(gone).queryByRole('button')).toBeNull();
    expect(gone.querySelector('.jp2-asked-warn')!.textContent).toBe('Commit abc1234 is not on this branch');
    expect(within(there).getByRole('button', { name: /the real one/ })).toBeTruthy();
    expect(there.querySelector('.jp2-asked-warn')).toBeNull();
  });
});

describe('Task 18 fix round 2: a commit list that cannot tell', () => {
  const twoLines = () => withAsked([DONE3[1], { ...DONE3[1], n: 4, note: 'the real one', what: 'commit b81b49e · week.ts', commit: { sha: 'b81b49e', file: 'week.ts' } }]);
  const commits = [{ sha: 'b81b49e7f5a657e2d701ccca3e5a3a455ed7b41b', short: 'b81b49e7', subject: 's', date: null, files: [] }];

  it('a list cut at its limit: a commit not in it stays a link (Changes asks for it by itself)', async () => {
    const o = openNotes({ read: null, patch: twoLines() });
    await settle();
    await act(async () => { await loadCommits(o.store, { get: async () => ({ commits, cut: true }) } as unknown as ApiClient, SLUG); });
    const [maybe] = lines();
    expect(maybe.querySelector('.jp2-asked-warn')).toBeNull();
    expect(within(maybe).getByRole('button', { name: /a smaller badge/ })).toBeTruthy();
  });

  it('an empty list (no branch yet, or it could not be read) marks no line as not on the branch', async () => {
    const o = openNotes({ read: null, patch: twoLines() });
    await settle();
    await act(async () => { await loadCommits(o.store, { get: async () => ({ commits: [], note: 'No feature branch yet.' }) } as unknown as ApiClient, SLUG); });
    expect(asked()!.querySelector('.jp2-asked-warn')).toBeNull();
    expect(lines().every((l) => within(l).queryByRole('button'))).toBe(true);
  });
});
