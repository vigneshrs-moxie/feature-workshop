// The notes in the message box (Task 17, R4): chips that jump to their place and come off with ×,
// kept over a reload; the buttons say what they carry (at a gate `Send back · 3 notes` and
// `Go · and do these 3`, elsewhere `Send · 3 notes`); `Show what will be sent` shows the exact text;
// one send carries all of it, and a refusal gives the notes back.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { clearAllSent } from '../../lib/sentState';
import { clearGateSent } from '../../panes/Foreman/gateSent';
import { box, chipText, openNotes, para, PLAN, reader, settle } from '../fixtures/notesPage';
import { notesKey, type PageNote } from '../jobStore';
import { forgetSentGo } from '../left/YourMove';
import { forgetRecentPages } from '../recent';
import { THREE, THREE_TEXT } from './chips.test';

const SLUG = 'orbit-905-crew-schedule-export';
const S1 = 'The schedule page waits for the van number';
const S1_NOTE: PageNote = { n: 7, kind: 'drop', target: { kind: 'doc', id: PLAN }, place: 'Implementation plan v2 · step S1 "The row limit adds a second" · paragraph 1', chip: 'Implementation plan step S1 paragraph 1', quote: 'The schedule page waits', note: '', block: { text: '', version: '2', hash: null } };
const keep = (notes: PageNote[]) => localStorage.setItem(notesKey(SLUG), JSON.stringify({ notes, explains: [] }));
const footer = () => within(document.querySelector<HTMLElement>('.jp2-mbw')!);
const card = () => within(document.querySelector<HTMLElement>('.jp2-ym')!);

let offKeys: () => void = () => {};
beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear(); forgetRecentPages(); forgetSentGo(); offKeys = installKeyListener(); resetChord();
});
afterEach(() => { offKeys(); vi.unstubAllGlobals(); localStorage.clear(); clearAllSent(); clearGateSent(); window.history.replaceState(null, '', '/'); });

describe('chips', () => {
  it('the notes gather as chips in the message box, and survive a reload', async () => {
    expect(SLUG).toBe(openNotes({ read: null }).store.getState().slug);
    document.body.innerHTML = '';
    keep(THREE);
    const first = openNotes({ read: null, patch: (p) => { p.move = null; } });
    await settle();
    expect(chipText()).toEqual(['Plan step 4 · use the existing badge', 'Spec acceptance line 6 · drop', 'Recording 0:14 · pin 1']);
    first.unmount();
    // A reload: a new page and store, the same browser.
    openNotes({ read: null, patch: (p) => { p.move = null; } });
    await settle();
    expect(chipText()).toHaveLength(3);
  });

  it('× removes a chip (and it stays removed after a reload)', async () => {
    keep(THREE);
    const o = openNotes({ read: null, patch: (p) => { p.move = null; } });
    await settle();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Remove the note: Spec acceptance line 6 · drop' })); });
    expect(chipText()).toEqual(['Plan step 4 · use the existing badge', 'Recording 0:14 · pin 1']);
    expect(JSON.parse(localStorage.getItem(notesKey(SLUG))!).notes.map((n: PageNote) => n.n)).toEqual([1, 3]);
    o.unmount();
  });

  it('a chip jumps to its place: its document opens in the reader and its block flashes', async () => {
    keep([{ ...S1_NOTE, block: { text: '', version: '2', hash: null } }]);
    const o = openNotes({ read: { kind: 'conversation', id: 'conversation' } });
    await settle();
    // Its words, as the page finds them.
    const s1 = o.store.getState().bodies[PLAN];
    expect(s1 ?? null).toBeNull();
    act(() => { o.store.setReader({ kind: 'doc', id: PLAN }); });
    await settle();
    const words = (para(S1).textContent ?? '').replace(/\s+/g, ' ').trim();
    act(() => { o.store.setNotes([{ ...S1_NOTE, block: { text: words, version: '2', hash: null } }]); o.store.setReader({ kind: 'conversation', id: 'conversation' }); });
    await settle();
    act(() => { fireEvent.click(document.querySelector<HTMLElement>('.jp2-chip-l')!); });
    await settle();
    expect(reader().querySelector('.jp2-rv-top h2')).toHaveTextContent('Implementation plan');
    expect(para(S1)).toHaveAttribute('data-pt-flash');
    expect(para(S1)).toHaveAttribute('data-pt-noted');
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/doc/${PLAN}`);
  });
});

describe('the buttons say what they carry', () => {
  it('elsewhere: Send · 3 notes', async () => {
    keep(THREE);
    openNotes({ read: null, patch: (p) => { p.move = null; } });
    await settle();
    expect(footer().getByRole('button', { name: 'Send · 3 notes' })).toBeInTheDocument();
  });

  it('at a gate: Send back · 3 notes and Go · and do these 3 (and the box’s button is Send back too)', async () => {
    keep(THREE);
    openNotes({ read: null });
    await settle();
    expect(card().getByRole('button', { name: /Go · and do these 3/ })).toBeInTheDocument();
    expect(card().getByRole('button', { name: /Send back · 3 notes/ })).toBeInTheDocument();
    expect(footer().getByRole('button', { name: 'Send back · 3 notes' })).toBeInTheDocument();
  });
});

describe('what is sent', () => {
  it('Show what will be sent shows the exact text, his words after the block', async () => {
    keep(THREE);
    openNotes({ read: null, patch: (p) => { p.move = null; } });
    await settle();
    act(() => { fireEvent.change(box(), { target: { value: 'And keep the old export.' } }); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Show what will be sent' })); });
    expect(screen.getByRole('region', { name: 'What will be sent' }).querySelector('pre')!.textContent).toBe(`${THREE_TEXT}\n\nAnd keep the old export.`);
  });

  it('at a gate it shows what the gate sends: the block on its lines, his words after it on one line', async () => {
    keep(THREE);
    const o = openNotes({ read: null });
    await settle();
    act(() => { fireEvent.change(box(), { target: { value: 'And keep\nthe old export.' } }); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Show what will be sent' })); });
    const shown = screen.getByRole('region', { name: 'What will be sent' }).querySelector('pre')!.textContent;
    expect(shown).toBe(`${THREE_TEXT}\n\nAnd keep the old export.`);
    await act(async () => { fireEvent.click(card().getByRole('button', { name: /Send back · 3 notes/ })); });
    // The server composes the reply from that note (lib/compose.js): its note lines are what was shown.
    const { composeReply } = await import('../../../../dashboard/lib/compose.js');
    const note = (o.post.mock.calls.find((c) => String(c[0]).endsWith('/gate'))![1] as { note: string }).note;
    expect(composeReply({ kind: 'changes', note })).toBe(`Please make changes before moving on, and stay in the current stage:\n${shown}`);
  });

  it('Send · 3 notes posts exactly that text, once; the chips and the box empty', async () => {
    keep(THREE);
    const o = openNotes({ read: null, patch: (p) => { p.move = null; } });
    await settle();
    act(() => { fireEvent.change(box(), { target: { value: 'And keep the old export.' } }); });
    await act(async () => { fireEvent.click(footer().getByRole('button', { name: 'Send · 3 notes' })); });
    expect(o.post).toHaveBeenCalledTimes(1);
    expect(o.post.mock.calls[0][1]).toMatchObject({ kind: 'message', text: `${THREE_TEXT}\n\nAnd keep the old export.` });
    expect(chipText()).toEqual([]);
    expect(box()).toHaveValue('');
    expect(localStorage.getItem(notesKey(SLUG))).toBeNull();
  });

  it('a refusal gives the notes back as chips and the words back to the box', async () => {
    keep(THREE);
    const post = vi.fn(async () => { throw new ApiError(409, 'limit', { code: 'limited' }); });
    openNotes({ read: null, post, patch: (p) => { p.move = null; } });
    await settle();
    act(() => { fireEvent.change(box(), { target: { value: 'And this.' } }); });
    await act(async () => { fireEvent.click(footer().getByRole('button', { name: 'Send · 3 notes' })); });
    expect(chipText()).toHaveLength(3);
    expect(box()).toHaveValue('And this.');
    expect(footer().getByRole('alert')).toHaveTextContent('Not sent: Claude’s usage limit is reached.');
  });

  it('at a gate, Go · and do these 3 carries the notes block as the go’s note', async () => {
    keep(THREE);
    const o = openNotes({ read: null });
    await settle();
    await act(async () => { fireEvent.click(card().getByRole('button', { name: /Go · and do these 3/ })); });
    const call = o.post.mock.calls.find((c) => String(c[0]).endsWith('/gate'))!;
    expect(call[1]).toMatchObject({ kind: 'approve', note: THREE_TEXT });
    expect(chipText()).toEqual([]);
  });

  it('at a gate, Send back · 3 notes goes with no words typed: the notes are the change', async () => {
    keep(THREE);
    const o = openNotes({ read: null });
    await settle();
    await act(async () => { fireEvent.click(card().getByRole('button', { name: /Send back · 3 notes/ })); });
    const call = o.post.mock.calls.find((c) => String(c[0]).endsWith('/gate'))!;
    expect(call[1]).toMatchObject({ kind: 'changes', note: THREE_TEXT });
  });
});
