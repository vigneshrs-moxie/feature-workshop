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
import { longJob200 } from '../fixtures/longJob200';
import { blockOf, blockSearches, describeBlock, roughIndex } from './Pointable';

const CSS = readFileSync(path.join(process.cwd(), 'src/jobpage/jobpage.css'), 'utf8');
const rule = (sel: string) => { const at = CSS.indexOf(`${sel} {`); return at < 0 ? '' : CSS.slice(at + sel.length + 2, CSS.indexOf('}', at)); };
const FIRST = 'The time zone check counts the first day';
const S1 = 'The schedule page waits for the van number';
const press = (k: string) => act(() => { fireEvent.keyDown(document.body, { key: k }); });
const button = (name: string) => within(noteBox()!).getByRole('button', { name });
const field = () => within(noteBox()!).getByRole('textbox');

/** His message line, its body, and a reply that answers note 1 as explained. */
const mine = (id: string) => ({ id, kind: 'you' as const, at: '2026-11-04T15:09:00.000Z', step: 'review' as const, headline: 'Notes', mine: true, hash: id });
const mineBody = (id: string, text: string): JobBody => ({ id, kind: 'you', version: id, html: '<p>Notes</p>', meta: {}, text });
const answerBody = (id: string, answer: string): JobBody => ({ id, kind: 'reply', version: id, html: '<p>Reply.</p>', meta: {}, text: `Reply.\n\n--- Notes answered ---\n1. done · explained · ${answer}\n--- End ---` });

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

    // His message carrying it, then the Foreman's reply with the answered block at its end.
    const next = payload();
    next.v = 2;
    next.thread.push(mine('you:ex1'), { id: 'reply:ans1', kind: 'reply', at: '2026-11-04T15:10:00.000Z', step: 'review', headline: 'The row limit', mine: false, hash: 'reply:ans1' });
    await o.serve(next, { 'you:ex1': mineBody('you:ex1', String(body.text)), 'reply:ans1': answerBody('reply:ans1', 'It adds a second sheet so no row is dropped.') });
    await settle();
    await settle();
    expect(note()).toHaveTextContent('It adds a second sheet so no row is dropped.');
    expect(note()).toHaveTextContent('Explain · the Foreman');
  });

  it('a refusal says why beside the block with Ask again, and is never kept as asked: a reload and a later reply show nothing', async () => {
    const { ApiError } = await import('../../api/client');
    const post = vi.fn(async (_path: string, _body?: unknown) => { throw new ApiError(409, 'limit', { code: 'limited' }); });
    const o = await opened({ post });
    act(() => { fireEvent.mouseMove(para(S1)); });
    act(() => { fireEvent.click(plus()!); });
    fireEvent.change(field(), { target: { value: 'why here and not in the export?' } });
    await act(async () => { fireEvent.click(button('Explain')); });
    expect(String((post.mock.calls[0][1] as { text: string }).text)).toContain('   Note: why here and not in the export?');
    const note = () => reader().querySelector<HTMLElement>('.jp2-pt-mnote');
    expect(note()).toHaveTextContent('Not sent: Claude’s usage limit is reached.');
    expect(note()).not.toHaveTextContent('Asked');
    expect(o.store.getState().explains).toEqual([]);
    expect(localStorage.getItem(`sb.notes.${o.store.getState().slug}`)).toBeNull();
    // Ask again sends it again, his words with it.
    await act(async () => { fireEvent.click(within(note()!).getByRole('button', { name: 'Ask again' })); });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][1]).toEqual(post.mock.calls[0][1]);
    // Refused again: Ask again still carries them.
    await act(async () => { fireEvent.click(within(note()!).getByRole('button', { name: 'Ask again' })); });
    expect(post.mock.calls[2][1]).toEqual(post.mock.calls[0][1]);
    // A reply that lands later is not taken for its answer.
    const next = payload();
    next.v = 2;
    next.thread.push({ id: 'reply:later', kind: 'reply', at: '2026-11-04T15:10:00.000Z', step: 'review', headline: 'Something else', mine: false, hash: 'reply:later' });
    await o.serve(next, { 'reply:later': answerBody('reply:later', 'Not about that.') });
    await settle();
    expect(note()).not.toHaveTextContent('Not about that.');
    expect(note()).not.toHaveTextContent('answered in its reply');
  });

  it('an Explain that waits behind a running reply is answered by the reply after its own message, not by the running one', async () => {
    const { ApiError } = await import('../../api/client');
    const post = vi.fn(async (_path: string, body?: unknown) => {
      if ((body as { queue?: boolean }).queue) return { waiting: { text: 'x', at: 'now', why: null } };
      throw new ApiError(409, 'The Foreman is still working on your last message.', {});
    });
    const o = await opened({ post });
    act(() => { fireEvent.mouseMove(para(S1)); });
    act(() => { fireEvent.click(plus()!); });
    await act(async () => { fireEvent.click(button('Explain')); });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][1]).toMatchObject({ queue: true });
    const sent = String((post.mock.calls[1][1] as { text: string }).text);
    const note = () => reader().querySelector<HTMLElement>('.jp2-pt-mnote');
    // The running reply ends first (it answers his earlier message, with an answered block of its own).
    const next = payload();
    next.v = 2;
    next.thread.push({ id: 'reply:running', kind: 'reply', at: '2026-11-04T15:05:00.000Z', step: 'review', headline: 'Earlier', mine: false, hash: 'reply:running' });
    await o.serve(next, { 'reply:running': answerBody('reply:running', 'An answer to something else.') });
    await settle();
    expect(note()).toHaveTextContent('Asked. The answer opens here when the Foreman replies.');
    // Then his waiting message goes, and its own reply.
    const after = payload();
    after.v = 3;
    after.thread.push(next.thread.at(-1)!, mine('you:ex2'), { id: 'reply:mine', kind: 'reply', at: '2026-11-04T15:12:00.000Z', step: 'review', headline: 'The row limit', mine: false, hash: 'reply:mine' });
    await o.serve(after, { 'you:ex2': mineBody('you:ex2', sent), 'reply:mine': answerBody('reply:mine', 'It adds a second sheet.') });
    await settle();
    await settle();
    expect(note()).toHaveTextContent('It adds a second sheet.');
    expect(o.store.getState().explains[0]).toMatchObject({ sent: 'you:ex2', line: 'reply:mine' });
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

describe('speed with notes present (fix round 1, I3)', () => {
  const CONVO = { kind: 'conversation' as const, id: 'conversation' };
  const best = (xs: number[]) => Math.min(...xs);
  /** Best of five opens of `target`, each from the ticket. */
  const opens = (o: NotesPage, target: { kind: 'conversation' | 'doc'; id: string }) => {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      act(() => { o.store.setReader({ kind: 'ticket', id: 'ticket' }); });
      const t0 = performance.now();
      act(() => { o.store.setReader(target); });
      times.push(performance.now() - t0);
    }
    return times;
  };
  /**
   * The clock, held only on a quiet machine: under 100 ms when the same open without notes takes at most
   * 50 ms (alone it reads about 40 ms). Inside a whole suite, or on CI, the clock says little (both
   * numbers swing by 3×), so there the node counts are the check, as the lead ruled.
   */
  const fastEnough = (withNotes: number[], without: number[]) => {
    if (process.env.CI || best(without) > 50) return;
    expect(best(withNotes)).toBeLessThan(100);
  };

  it('200 items with notes on the open exchange: reopening stays under 100 ms, and a re-render searches for nothing', async () => {
    // Under 1100 px, where the reader opens the conversation (on a laptop it stays in its own column).
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    const o = await opened({ job: longJob200, read: CONVO });
    for (let i = 0; i < 20 && reader().querySelectorAll('.jp2-cv-item .jp2-prose p').length < 3; i++) await settle();
    // Three notes on paragraphs of the open messages.
    const paras = [...reader().querySelectorAll<HTMLElement>('.jp2-cv-item .jp2-prose p')].slice(0, 3);
    expect(paras.length).toBe(3);
    const without = opens(o, CONVO);
    for (let i = 0; i < 20 && reader().querySelectorAll('.jp2-cv-item .jp2-prose p').length < 3; i++) await settle();
    const s = o.store.getState();
    act(() => { o.store.setNotes([...reader().querySelectorAll<HTMLElement>('.jp2-cv-item .jp2-prose p')].slice(0, 3).map((p, i) => ({ n: i + 1, kind: 'drop' as const, note: '', ...describeBlock(p, CONVO, s) }))); });
    expect(reader().querySelectorAll('[data-pt-noted]')).toHaveLength(3);
    const searched = blockSearches.count;
    const times = opens(o, CONVO);
    // The hard check everywhere: each open looks inside each note's own message once, never more.
    expect(blockSearches.count - searched).toBeLessThanOrEqual(3 * 5);
    console.info(`[timing] 200-item conversation, five opens without notes: ${without.map((t) => t.toFixed(1)).join(', ')} ms; with 3 notes: ${times.map((t) => t.toFixed(1)).join(', ')} ms`);
    fastEnough(times, without);
    await settle();
    expect(reader().querySelectorAll('[data-pt-noted]')).toHaveLength(3);
    // New lines land five times: the view draws again each time; no block is searched for again.
    const before = blockSearches.count;
    for (let k = 0; k < 5; k++) {
      const next = JSON.parse(JSON.stringify(o.store.getState().payload)) as JobPagePayload;
      next.v += 1;
      next.thread.push({ id: `small:x${k}`, kind: 'small', at: '2026-11-04T16:00:00.000Z', step: 'review', headline: `A small event ${k}`, mine: false, hash: `x${k}` });
      await o.serve(next);
    }
    expect(blockSearches.count - before).toBe(0);
    expect(reader().querySelectorAll('[data-pt-noted]')).toHaveLength(3);
  });

  it('a long document (1,200 paragraphs) with five notes near its end opens under 100 ms; notes marked', async () => {
    const html = Array.from({ length: 1200 }, (_, i) => `<p>Paragraph ${i + 1}: the crew schedule export keeps the week in order for the office, line ${i + 1}.</p>`).join('');
    const long: JobBody = { id: PLAN, kind: 'doc', version: String(longJob200.bodies[PLAN]?.meta.hash ?? PLAN), text: '# Long', meta: {}, html };
    const o = await opened({ bodies: { [PLAN]: long } });
    await settle();
    const without = opens(o, { kind: 'doc', id: PLAN });
    await settle();
    const s = o.store.getState();
    const ends = [1196, 1197, 1198, 1199, 1200].map((n) => para(`Paragraph ${n}:`));
    act(() => { o.store.setNotes(ends.map((p, i) => ({ n: i + 1, kind: 'drop' as const, note: '', ...describeBlock(p, { kind: 'doc', id: PLAN }, s), block: { ...describeBlock(p, { kind: 'doc', id: PLAN }, s).block, at: roughIndex(host(), p) } }))); });
    const searched = blockSearches.count;
    const times = opens(o, { kind: 'doc', id: PLAN });
    // The hard check everywhere: each note's block is found where it was, with no search of the document.
    expect(blockSearches.count - searched).toBe(0);
    console.info(`[timing] 1,200-paragraph document, five opens without notes: ${without.map((t) => t.toFixed(1)).join(', ')} ms; with 5 notes: ${times.map((t) => t.toFixed(1)).join(', ')} ms`);
    fastEnough(times, without);
    await settle();
    expect(reader().querySelectorAll('[data-pt-noted]')).toHaveLength(5);
  });
});
