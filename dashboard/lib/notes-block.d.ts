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

/** One line of the Foreman's `--- Notes answered ---` block (Task 18). */
export interface AnsweredLine { n: number; done: boolean; explained: boolean; where: string | null; what: string }
/** A note he sent, read back from his message. */
export interface SentNote { n: number; kind: NoteKind; place: string; quote: string | null; note: string | null }
export function parseAnswered(reply: string | null | undefined): AnsweredLine[];
export function parseNotes(text: string | null | undefined): SentNote[];
export const REPLY_KEPT: number;
export function keptReply(full: string | null | undefined): string;
