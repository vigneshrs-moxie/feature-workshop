// Point, then say (Task 17, R4): every block in the reader shows `+` in its left margin on hover; a
// click, a text selection or `n` opens the note box in place with Change, Drop this and Explain; the
// `+` never changes a line's height or moves a word; Explain asks at once and its answer opens beside
// the block; a note on a block a newer version removed says so instead of vanishing. Built on the
// made-up long job.
import { act, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { box, chipText, host, noteBox, openNotes, para, payload, PLAN, plus, reader, settle, type NotesPage } from '../fixtures/notesPage';
import { forgetRecentPages } from '../recent';
import type { JobBody, JobPagePayload } from '../types';
import { blockOf, describeBlock } from './Pointable';

const CSS = readFileSync(path.join(process.cwd(), 'src/jobpage/jobpage.css'), 'utf8');
const rule = (sel: string) => { const at = CSS.indexOf(`${sel} {`); return at < 0 ? '' : CSS.slice(at + sel.length + 2, CSS.indexOf('}', at)); };
const FIRST = 'The time zone check counts the first day';
const S1 = 'The schedule page waits for the van number';
const press = (k: string) => act(() => { fireEvent.keyDown(document.body, { key: k }); });
const button = (name: string) => within(noteBox()!).getByRole('button', { name });
const field = () => within(noteBox()!).getByRole('textbox');

let offKeys: () => void = () => {};
beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear(); forgetRecentPages(); offKeys = installKeyListener(); resetChord();
});
afterEach(() => { offKeys(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

async function opened(o: Parameters<typeof openNotes>[0] = {}): Promise<NotesPage> {
  const p = openNotes(o);
  await settle();
  return p;
}

describe('the + in the margin', () => {
  it('shows on hover over any block, over the margin and outside the block: the block’s words and markup do not change', async () => {
    await opened();
    const p = para(S1);
    const before = p.outerHTML;
    expect(plus()).toBeNull();
    act(() => { fireEvent.mouseMove(p); });
    expect(plus()).not.toBeNull();
    expect(plus()!).toHaveAccessibleName('Add a note here');
    // Not inside the block, so it can't take a line's room: drawn over the reader's scroll area.
    expect(p.contains(plus())).toBe(false);
    expect(plus()!.parentElement).toBe(host());
    expect(p.outerHTML).toBe(before);
    expect(rule('.jp2-pt-plus')).toMatch(/position: absolute/);
    expect(rule('.jp2-pt-plus')).not.toMatch(/margin: [1-9]/);
    // A noted block's mark is drawn outside its text too (::after, absolutely placed).
    expect(rule('[data-pt-noted]::after')).toMatch(/position: absolute/);
  });

  it('every kind of block can be pointed at: a plan step heading, a paragraph, a list line, a decision row, a finding row', async () => {
    const o = await opened();
    expect(blockOf(para('S1: The row limit'))).toBe(para('S1: The row limit'));
    expect(blockOf(para(S1))).toBe(para(S1));
    act(() => { o.store.setReader({ kind: 'doc', id: 'acceptance.md' }); });
    await settle();
    const li = para('AC-6:');
    expect(blockOf(li)).toBe(li);
    // A line with its own id is named by it; one without, in the acceptance list, by its number.
    expect(describeBlock(li, { kind: 'doc', id: 'acceptance.md' }, o.store.getState()).place).toBe('Acceptance criteria v3 · AC-6 "The export counts the overtime hours. Nothing else…"');
    li.firstChild!.textContent = 'The export counts the overtime hours.';
    expect(describeBlock(li, { kind: 'doc', id: 'acceptance.md' }, o.store.getState()).place).toBe('Acceptance criteria v3 · acceptance line 6');
    // The page's own controls are never blocks.
    expect(blockOf(reader().querySelector('.jp2-rv-top'))).toBeNull();
  });
});

describe('the note box', () => {
  it('a click on + opens it in place, naming the document, its version and the step, with Change, Drop this and Explain', async () => {
    await opened();
    act(() => { fireEvent.mouseMove(para(S1)); });
    act(() => { fireEvent.click(plus()!); });
    const nb = noteBox()!;
    expect(nb).toHaveTextContent('Implementation plan v2 · step S1 "The row limit adds a second" · paragraph 1');
    expect(nb).toHaveTextContent(`“${S1}`);
    expect(within(nb).getAllByRole('button').map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['Change', 'Drop this', 'Explain', 'Close the note without adding it']);
    // The block it is about is marked while it is open.
    expect(para(S1)).toHaveAttribute('data-pt-marked');
    // In the reader's scroll area, under the block: not in the text's flow.
    expect(nb.parentElement).toBe(host());
    expect(rule('.jp2-nb')).toMatch(/position: absolute/);
  });

  it('Change adds a chip with his words; Drop this adds one with none; nothing is sent', async () => {
    const o = await opened();
    act(() => { fireEvent.mouseMove(para(S1)); });
    act(() => { fireEvent.click(plus()!); });
    fireEvent.change(field(), { target: { value: 'use the existing badge' } });
    act(() => { fireEvent.click(button('Change')); });
    expect(noteBox()).toBeNull();
    act(() => { fireEvent.mouseMove(para(FIRST)); });
    act(() => { fireEvent.click(plus()!); });
    act(() => { fireEvent.click(button('Drop this')); });
    expect(chipText()).toEqual(['Implementation plan step S1 paragraph 1 · use the existing badge', 'Implementation plan paragraph 1 · drop']);
    expect(o.post).not.toHaveBeenCalled();
    // Both blocks now carry the mark.
    expect(para(S1)).toHaveAttribute('data-pt-noted');
    expect(para(FIRST)).toHaveAttribute('data-pt-noted');
  });

  it('a text selection inside a block opens it with the words he picked', async () => {
    await opened();
    const p = para(S1);
    const text = p.firstChild!;
    const r = document.createRange();
    r.setStart(text, 4);
    r.setEnd(text, 28);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
    act(() => { fireEvent.mouseUp(p); });
    expect(noteBox()).toHaveTextContent('“schedule page waits for”');
    window.getSelection()!.removeAllRanges();
  });

  it('n opens it on the block under the pointer; with no block under it, n does nothing', async () => {
    await opened();
    press('n');
    expect(noteBox()).toBeNull();
    act(() => { fireEvent.mouseMove(para(FIRST)); });
    press('n');
    expect(noteBox()).toHaveTextContent('Implementation plan v2 · paragraph 1');
  });

  it('Change with nothing typed asks for the words and adds nothing; Escape closes it and adds nothing', async () => {
    await opened();
    act(() => { fireEvent.mouseMove(para(S1)); });
    act(() => { fireEvent.click(plus()!); });
    act(() => { fireEvent.click(button('Change')); });
    expect(noteBox()).toHaveTextContent('Write what should change, then press Change.');
    act(() => { fireEvent.keyDown(field(), { key: 'Escape' }); });
    expect(noteBox()).toBeNull();
    expect(chipText()).toEqual([]);
  });

  it('a diff line’s place is its file and line with the commit; a finding’s is the finding', async () => {
    const o = await opened();
    const df = document.createElement('div');
    df.className = 'jp2-ch-df';
    df.dataset.sha = 'abc1234def';
    df.dataset.short = 'abc1234';
    df.dataset.path = 'app/src/EmployeesTable.tsx';
    df.innerHTML = '<div class="jp2-dl is-add" data-ln="88">+  const badge = small;</div>';
    const spot = describeBlock(df.firstElementChild as HTMLElement, { kind: 'changes', id: 'changes' }, o.store.getState());
    expect(spot).toMatchObject({ place: 'app/src/EmployeesTable.tsx:88 (commit abc1234)', chip: 'EmployeesTable.tsx:88', quote: 'const badge = small;', block: { key: 'dl:abc1234def:app/src/EmployeesTable.tsx:88' } });
    const fd = document.createElement('div');
    fd.className = 'jp2-fd';
    fd.innerHTML = '<button class="jp2-fd-line"><span class="jp2-fd-sev">Major</span><span class="jp2-fd-w">ExportButton.tsx</span><span class="jp2-fd-t">The button stays on while the file is written.</span></button>';
    expect(describeBlock(fd, { kind: 'findings', id: 'findings' }, o.store.getState())).toMatchObject({ place: 'Findings · Major · ExportButton.tsx', chip: 'Finding ExportButton.tsx', quote: 'The button stays on while the file is written.' });
  });
});

describe('Explain', () => {
  it('asks at once (a Notes (1) block with one [explain] note), says it is asked beside the block, then shows the answer from the reply', async () => {
    const o = await opened();
    act(() => { fireEvent.mouseMove(para(S1)); });
    act(() => { fireEvent.click(plus()!); });
    await act(async () => { fireEvent.click(button('Explain')); });
    expect(o.post).toHaveBeenCalledTimes(1);
    const [url, body] = o.post.mock.calls[0];
    expect(url).toBe(`/api/job/${o.store.getState().slug}/send`);
    expect(body).toEqual({ kind: 'message', text: [
      '--- Notes (1) ---',
      '1. [explain] Implementation plan v2 · step S1 "The row limit adds a second" · paragraph 1',
      `   > ${(para(S1).textContent ?? '').trim()}`,
      '--- End of notes ---',
    ].join('\n') });
    // No chip: it went.
    expect(chipText()).toEqual([]);
    const note = () => reader().querySelector<HTMLElement>('.jp2-pt-mnote');
    expect(note()).toHaveTextContent('Asked. The answer opens here when the Foreman replies.');

    // The Foreman's reply lands with the answered block at its end.
    const next = payload();
    next.v = 2;
    next.thread.push({ id: 'reply:ans1', kind: 'reply', at: '2026-11-04T15:10:00.000Z', step: 'review', headline: 'The row limit', mine: false, hash: 'ans1' });
    const reply: JobBody = { id: 'reply:ans1', kind: 'reply', version: 'ans1', html: '<p>The row limit.</p>', meta: {}, text: 'The row limit.\n\n--- Notes answered ---\n1. done · explained · It adds a second sheet so no row is dropped.\n--- End ---' };
    await o.serve(next, { 'reply:ans1': reply });
    await settle();
    await settle();
    expect(note()).toHaveTextContent('It adds a second sheet so no row is dropped.');
    expect(note()).toHaveTextContent('Explain · the Foreman');
  });

  it('a refusal says why beside the block', async () => {
    const { ApiError } = await import('../../api/client');
    const post = vi.fn(async () => { throw new ApiError(409, 'limit', { code: 'limited' }); });
    await opened({ post });
    act(() => { fireEvent.mouseMove(para(S1)); });
    act(() => { fireEvent.click(plus()!); });
    await act(async () => { fireEvent.click(button('Explain')); });
    expect(reader().querySelector('.jp2-pt-mnote')).toHaveTextContent('Not sent: Claude’s usage limit is reached.');
  });
});

describe('the job changes under him', () => {
  it('a note box open with words typed keeps them while a newer payload lands', async () => {
    const o = await opened();
    act(() => { fireEvent.mouseMove(para(S1)); });
    act(() => { fireEvent.click(plus()!); });
    fireEvent.change(field(), { target: { value: 'half typed' } });
    const next = payload();
    next.v = 2;
    next.stateLine = 'Something moved';
    await o.serve(next);
    expect(field()).toHaveValue('half typed');
  });

  it('a note on a block a new version of the document removed says so: on its chip, and in the reader when the chip is clicked', async () => {
    const o = await opened();
    act(() => { fireEvent.mouseMove(para(S1)); });
    act(() => { fireEvent.click(plus()!); });
    act(() => { fireEvent.click(button('Drop this')); });
    expect(chipText()).toEqual(['Implementation plan step S1 paragraph 1 · drop']);
    // Plan v3 lands without that paragraph.
    const next: JobPagePayload = payload();
    next.v = 2;
    for (const s of next.steps) for (const out of s.outputs) if (out.id === PLAN) { out.version = '3'; out.hash = 'plan-v3'; }
    const v3: JobBody = { id: PLAN, kind: 'doc', version: 'plan-v3', text: '# Plan v3', meta: {}, html: '<h1>Implementation plan v3</h1><h3>S2: The totals line</h3><p>Only the totals now.</p>' };
    await o.serve(next, { [PLAN]: v3 });
    await settle();
    await settle();
    // Not dropped: its chip says where it went.
    expect(chipText()).toEqual(['Implementation plan step S1 paragraph 1 · drop · Not in Implementation plan v3']);
    act(() => { fireEvent.click(document.querySelector<HTMLElement>('.jp2-chip-l')!); });
    await settle();
    expect(reader().querySelector('.jp2-pt-lost')).toHaveTextContent('Not in Implementation plan v3: the part this note points at was taken out. The note stays, and still goes about the version you pointed at (v2).');
    // And it still goes, about v2.
    fireEvent.change(box(), { target: { value: '' } });
    expect(document.querySelectorAll('.jp2-chip')).toHaveLength(1);
  });
});

describe('the phone', () => {
  it('a tap on a block opens the note box as a sheet (no hover there)', async () => {
    vi.stubGlobal('matchMedia', (q: string) => {
      const max = /max-width:\s*(\d+)px/.exec(q);
      const min = /min-width:\s*(\d+)px/.exec(q);
      return { matches: (!min || 390 >= Number(min[1])) && (!max || 390 <= Number(max[1])), media: q, addEventListener() {}, removeEventListener() {} };
    });
    await opened();
    act(() => { fireEvent.mouseMove(para(S1)); });
    expect(plus()).toBeNull();
    act(() => { fireEvent.click(para(S1)); });
    expect(document.querySelector('.jp2-nb-sheet .jp2-nb.is-sheet')).not.toBeNull();
    // A link in a block is still a link: no sheet for it.
  });
});
