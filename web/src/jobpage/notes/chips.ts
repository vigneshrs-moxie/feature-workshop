// The notes he has pointed (R4, Task 17), as the message box shows them and as they go.
//
// - The text that goes is the server's own composeNotes (dashboard/lib/notes-block.js, imported here:
//   one implementation), so `Show what will be sent` shows exactly what the Foreman reads.
// - The buttons say what they carry: `Send · 3 notes`; at a gate `Send back · 3 notes` and
//   `Go · and do these 3`.
// - A chip names the place, then what the note does (`Plan step 4 · drop`, `EmployeesTable.tsx:88 ·
//   use the existing badge`, `Recording 0:14 · pin 1`).
// - A note on a block that a newer version of its document (or a newer findings list, decisions list,
//   …) no longer has is not dropped: its chip says `Not in Spec v4` and it still goes, about the version
//   he looked at (the Foreman says it is not done; notes-and-comments.md).

import { composeNotes, type BlockNote } from '../../../../dashboard/lib/notes-block.js';
import type { Explained, PageNote } from '../jobStore';
import type { JobBody, JobPagePayload, Output, ReaderTarget } from '../types';

export const notesWord = (n: number) => `${n} note${n === 1 ? '' : 's'}`;
/** The message box's Send away from a gate. */
export const sendLabel = (n: number) => (n ? `Send · ${notesWord(n)}` : 'Send');
/** Send back at a gate (Your move's, and the message box's while notes wait at a gate). */
export const backLabel = (n: number) => (n ? `Send back · ${notesWord(n)}` : 'Send back');
/** Go at a gate, with notes: they are part of the go. */
export const goLabel = (n: number) => (n === 1 ? 'Go · and do this one' : `Go · and do these ${n}`);

/** The notes as the notes block takes them (a pin's picture key stays on the page). */
export function blockOf(notes: PageNote[]): BlockNote[] {
  return notes.map((n) => ({ kind: n.kind, place: n.place, quote: n.quote, note: n.note, ...(n.pin ? { pin: { n: n.pin.n, x: n.pin.x, y: n.pin.y } } : {}) }));
}

/** What goes: the notes block, then his words; only his words with no notes. */
export const composeFor = (notes: PageNote[], words: string) => composeNotes({ notes: blockOf(notes), words });

export const oneLine = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();
const CHIP_NOTE = 36;
const cut = (s: string, most: number) => (s.length > most ? `${s.slice(0, most - 1).trimEnd()}…` : s);

/** A chip's words: the place, then what the note does. */
export function chipWords(n: PageNote): string {
  const what = n.kind === 'drop' ? 'drop' : n.kind === 'pin' ? `pin ${n.pin?.n ?? ''}`.trim() : n.kind === 'explain' ? 'explain' : cut(oneLine(n.note), CHIP_NOTE);
  return `${n.chip} · ${what}`;
}

/** The next note number (never one a kept note or Explain already has). */
export const nextNoteN = (notes: PageNote[], explains: Explained[]) => Math.max(0, ...notes.map((x) => x.n), ...explains.map((x) => x.n)) + 1;

/** The note added with the next number. */
export function addNote(notes: PageNote[], note: Omit<PageNote, 'n'>, explains: Explained[]): PageNote[] {
  return [...notes, { ...note, n: nextNoteN(notes, explains) }];
}

// ---------- A block a newer version removed ----------

const plain = new WeakMap<JobBody, string>();
/** A body's words on one line (its HTML's text, then its own text), worked out once per body. */
function wordsOf(body: JobBody): string {
  let w = plain.get(body);
  if (w === undefined) {
    let fromHtml = '';
    if (typeof document !== 'undefined' && body.html) {
      const t = document.createElement('template');
      t.innerHTML = body.html;
      fromHtml = t.content.textContent ?? '';
    }
    w = oneLine(`${fromHtml} ${body.text ?? ''}`);
    plain.set(body, w);
  }
  return w;
}

const docOutput = (p: JobPagePayload, id: string): Output | null => {
  for (const s of p.steps) for (const o of [...s.outputs, ...(s.more ?? [])]) if (o.kind === 'doc' && o.id === id) return o;
  return null;
};

/** The body that holds a note's block, and the payload's hash for it now (null: the payload names none). */
function bodyOf(t: ReaderTarget | null, p: JobPagePayload): { id: string; hash: string | null; label: string } | null {
  if (!t) return null;
  if (t.kind === 'doc') {
    const o = docOutput(p, t.id);
    return o ? { id: t.id, hash: o.hash ?? null, label: `${o.label}${o.version ? ` v${o.version}` : ''}` } : null;
  }
  if (t.kind === 'findings') return { id: 'findings', hash: p.hashes?.findings ?? null, label: 'the findings now' };
  if (t.kind === 'decisions') return { id: 'decisions', hash: p.hashes?.decisions ?? null, label: 'the decisions now' };
  if (t.kind === 'ticket') return { id: 'ticket', hash: p.hashes?.ticket ?? null, label: 'the ticket now' };
  return null;
}

/** Whether what a note points at has a newer version than the one he pointed at (its body is then worth reading). */
export function moved(note: PageNote, p: JobPagePayload): boolean {
  const b = bodyOf(note.target, p);
  return Boolean(b && b.hash && note.block?.hash && b.hash !== note.block.hash);
}

/** The body to read to tell whether a moved note's block is still there (null: nothing to read). */
export function bodyToRead(note: PageNote, p: JobPagePayload): string | null {
  return moved(note, p) ? bodyOf(note.target, p)!.id : null;
}

/**
 * Why a note's block is no longer there, in a few words (`Not in Spec v4`), or null while it is (or
 * while that cannot be told yet: the newer body not held).
 */
export function goneFrom(note: PageNote, p: JobPagePayload, bodies: Record<string, JobBody>): string | null {
  if (note.target?.kind === 'doc' && !docOutput(p, note.target.id)) return 'This document is no longer listed for the job';
  if (!moved(note, p) || !note.block?.text) return null;
  const b = bodyOf(note.target, p)!;
  const body = bodies[b.id];
  if (!body || body.version !== b.hash) return null;
  return wordsOf(body).includes(oneLine(note.block.text).replace(/…$/, '')) ? null : `Not in ${b.label}`;
}
