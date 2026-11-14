// Types for notes-block.js, so the new job page (web/, TypeScript) composes its notes with the very
// same code the Foreman's text is fixed by, instead of a copy.

export type NoteKind = 'change' | 'drop' | 'explain' | 'pin';

export interface BlockNote {
  kind: NoteKind;
  /** The place: the document and its version, then the step, line or heading; for a pin, the picture. */
  place: string;
  /** The words he pointed at (cut at QUOTE_MAX). */
  quote?: string | null;
  /** His note. */
  note?: string | null;
  /** A pin: its number and where it is on the picture, in per cent from the top left. */
  pin?: { n: number; x: number; y: number } | null;
}

export const NOTE_KINDS: NoteKind[];
export const QUOTE_MAX: number;
export function cutQuote(s: string | null | undefined): string;
export function pinPlace(picture: string, pin: { n: number; x: number; y: number }): string;
export function composeNotes(o?: { notes?: BlockNote[]; words?: string | null }): string;
export function explainedAnswer(reply: string | null | undefined): string | null;
