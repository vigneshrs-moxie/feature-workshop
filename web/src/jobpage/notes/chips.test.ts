// The notes as chips and as the text that goes (Task 17, R4): one implementation with the server
// (dashboard/lib/notes-block.js), the words on the buttons, and a note whose block a newer version
// removed.
import { describe, expect, it } from 'vitest';
import { composeNotes } from '../../../../dashboard/lib/notes-block.js';
import { longJob } from '../fixtures/longJob';
import type { PageNote } from '../jobStore';
import type { JobBody, JobPagePayload } from '../types';
import { addNote, backLabel, blockOf, chipWords, composeFor, goLabel, goneFrom, moved, sendLabel } from './chips';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The three notes of the brief's sample, as the page keeps them. */
export const THREE: PageNote[] = [
  { n: 1, kind: 'change', target: { kind: 'doc', id: 'implementation-plan.md' }, place: 'Plan v2 · step 4 "Add the filter to the table"', chip: 'Plan step 4', quote: 'the words he pointed at, at most 300 characters', note: 'use the existing badge' },
  { n: 2, kind: 'drop', target: { kind: 'doc', id: 'spec' }, place: 'Spec v3 · acceptance line 6', chip: 'Spec acceptance line 6', quote: '…', note: '' },
  { n: 3, kind: 'pin', target: { kind: 'checks', id: 'recording' }, place: 'Recording 0:14', chip: 'Recording 0:14', quote: null, note: 'the Apply button sits on top of the table', pin: { n: 1, x: 62, y: 18, picture: 'rec:AC-3' } },
];

/** The brief's text, character for character (the server's test fixes the same). */
export const THREE_TEXT = [
  '--- Notes (3) ---',
  '1. [change] Plan v2 · step 4 "Add the filter to the table"',
  '   > the words he pointed at, at most 300 characters',
  '   Note: use the existing badge',
  '2. [drop] Spec v3 · acceptance line 6',
  '   > …',
  '3. [pin] Recording 0:14 · pin 1 at 62% across, 18% down',
  '   Note: the Apply button sits on top of the table',
  '--- End of notes ---',
].join('\n');

describe('the text that goes', () => {
  it('is the server’s composeNotes, exactly the brief’s block, his words after a blank line', () => {
    expect(composeFor(THREE, '')).toBe(THREE_TEXT);
    expect(composeFor(THREE, ' And keep the old export. ')).toBe(`${THREE_TEXT}\n\nAnd keep the old export.`);
    expect(composeFor(THREE, 'x')).toBe(composeNotes({ notes: blockOf(THREE), words: 'x' }));
    expect(composeFor([], ' Just words ')).toBe('Just words');
  });

  it('a pin goes with its picture and spot; the picture key stays on the page', () => {
    expect(blockOf([THREE[2]])).toEqual([{ kind: 'pin', place: 'Recording 0:14', quote: null, note: 'the Apply button sits on top of the table', pin: { n: 1, x: 62, y: 18 } }]);
  });
});

describe('the buttons say what they carry', () => {
  it('Send · 3 notes elsewhere; at a gate Send back · 3 notes and Go · and do these 3', () => {
    expect(sendLabel(0)).toBe('Send');
    expect(sendLabel(1)).toBe('Send · 1 note');
    expect(sendLabel(3)).toBe('Send · 3 notes');
    expect(backLabel(0)).toBe('Send back');
    expect(backLabel(3)).toBe('Send back · 3 notes');
    expect(goLabel(3)).toBe('Go · and do these 3');
    expect(goLabel(1)).toBe('Go · and do this one');
  });
});

describe('chips', () => {
  it('a chip names the place, then what the note does', () => {
    expect(chipWords(THREE[0])).toBe('Plan step 4 · use the existing badge');
    expect(chipWords(THREE[1])).toBe('Spec acceptance line 6 · drop');
    expect(chipWords(THREE[2])).toBe('Recording 0:14 · pin 1');
    expect(chipWords({ ...THREE[0], note: 'make the badge the small one the header uses on the left' })).toBe('Plan step 4 · make the badge the small one the he…');
  });

  it('a new note takes the next number, never one an Explain or a removed note had', () => {
    const one = addNote([], { kind: 'drop', target: null, place: 'Spec v3 · line 1', chip: 'Spec line 1', quote: null, note: '' }, [{ n: 4, target: null, place: '', quote: null, block: null, after: null, answer: null, line: null }]);
    expect(one.map((x) => x.n)).toEqual([5]);
    expect(addNote(THREE, { ...THREE[1] }, []).map((x) => x.n)).toEqual([1, 2, 3, 4]);
  });
});

describe('a note on a block a newer version removed says so', () => {
  const payloadWith = (version: string, hash: string): JobPagePayload => {
    const p = clone(longJob.payload) as unknown as JobPagePayload;
    for (const s of p.steps) for (const o of s.outputs) if (o.id === 'spec') { o.version = version; o.hash = hash; }
    return p;
  };
  const NOTE: PageNote = { n: 1, kind: 'drop', target: { kind: 'doc', id: 'spec' }, place: 'Spec v3 · acceptance line 6', chip: 'Spec acceptance line 6', quote: 'Export as PDF too', note: '', block: { text: 'Export as PDF too.', version: '3', hash: 'h3' } };
  const body = (html: string, version: string): JobBody => ({ id: 'spec', kind: 'doc', version, html, text: '', meta: {} });
  const label = (p: JobPagePayload) => p.steps.flatMap((s) => s.outputs).find((o) => o.id === 'spec')!.label;

  it('same version: nothing to say, nothing to fetch', () => {
    const p = payloadWith('3', 'h3');
    expect(moved(NOTE, p)).toBe(false);
    expect(goneFrom(NOTE, p, {})).toBeNull();
  });

  it('a newer version that still has the words: nothing to say', () => {
    const p = payloadWith('4', 'h4');
    expect(moved(NOTE, p)).toBe(true);
    expect(goneFrom(NOTE, p, { spec: body('<ol><li>Export as <strong>PDF</strong> too.</li></ol>', 'h4') })).toBeNull();
  });

  it('a newer version without them: `Not in Spec v4`, and only once its body is held', () => {
    const p = payloadWith('4', 'h4');
    expect(goneFrom(NOTE, p, {})).toBeNull();
    expect(goneFrom(NOTE, p, { spec: body('<p>Export as CSV.</p>', 'h3') })).toBeNull();
    expect(goneFrom(NOTE, p, { spec: body('<p>Export as CSV.</p>', 'h4') })).toBe(`Not in ${label(p)} v4`);
  });

  it('the document gone from the job altogether says so too', () => {
    const p = clone(longJob.payload) as unknown as JobPagePayload;
    for (const s of p.steps) { s.outputs = s.outputs.filter((o) => o.id !== 'spec'); s.more = (s.more ?? []).filter((o) => o.id !== 'spec'); }
    expect(goneFrom(NOTE, p, {})).toBe('This document is no longer listed for the job');
  });
});
