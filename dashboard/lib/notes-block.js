// The notes block (job page rebuild, Task 17; design brief R4 "Point, then say"): he points at places
// on the job page (a plan step, a spec line, a diff line, a finding, a check, a paragraph of a Foreman
// message, a decision, a spot on a picture), leaves a note on each, and they go to the Foreman together
// as one message. The text is exact: the Foreman reads it (the skills' workflow-common
// notes-and-comments.md), and the page shows it under `Show what will be sent`. The web page imports
// this very file (web/src/jobpage/notes/chips.ts), so the text it shows is the text that goes.
//
//   --- Notes (3) ---
//   1. [change] Plan v2 · step 4 "Add the filter to the table"
//      > the words he pointed at, at most 300 characters
//      Note: use the existing badge
//   2. [drop] Spec v3 · acceptance line 6
//      > …
//   3. [pin] Recording 0:14 · pin 1 at 62% across, 18% down
//      Note: the Apply button sits on top of the table
//   --- End of notes ---
//
// followed by his typed words, if any, after one blank line. Every part of a note is one line (line
// breaks inside his words become spaces), so the block always reads the same way.

/** The kinds the Foreman knows. */
export const NOTE_KINDS = ['change', 'drop', 'explain', 'pin'];
/** The pointed words are cut at this many characters (the ellipsis counts). */
export const QUOTE_MAX = 300;

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Words on one line, at most QUOTE_MAX characters, a cut marked with `…`. */
export function cutQuote(s) {
  const t = oneLine(s);
  return t.length > QUOTE_MAX ? `${t.slice(0, QUOTE_MAX - 1).trimEnd()}…` : t;
}

const pct = (v) => Math.round(Math.min(100, Math.max(0, Number(v) || 0)));

/** A pin's place: the picture, then the pin and where it is from the picture's top left. */
export function pinPlace(picture, pin) {
  return `${oneLine(picture)} · pin ${pin.n} at ${pct(pin.x)}% across, ${pct(pin.y)}% down`;
}

/**
 * The message for his notes and words.
 * @param {{ notes?: { kind: string, place: string, quote?: string | null, note?: string | null, pin?: { n: number, x: number, y: number } | null }[], words?: string | null }} o
 * @returns {string} the block then his words, or only his words when there are no notes
 */
export function composeNotes({ notes = [], words = '' } = {}) {
  const typed = String(words ?? '').trim();
  if (!notes.length) return typed;
  const lines = [`--- Notes (${notes.length}) ---`];
  notes.forEach((n, i) => {
    if (!NOTE_KINDS.includes(n.kind)) throw new Error(`A note's kind is one of ${NOTE_KINDS.join(', ')}, not ${n.kind}.`);
    const place = n.pin ? pinPlace(n.place, n.pin) : oneLine(n.place);
    lines.push(`${i + 1}. [${n.kind}] ${place}`);
    const quote = cutQuote(n.quote);
    if (quote) lines.push(`   > ${quote}`);
    const note = oneLine(n.note);
    if (note) lines.push(`   Note: ${note}`);
  });
  lines.push('--- End of notes ---');
  return typed ? `${lines.join('\n')}\n\n${typed}` : lines.join('\n');
}

/**
 * The answer to an `explain` note sent alone (Notes (1)), from the end of the Foreman's reply:
 * `1. done · explained · <the answer>` inside its `--- Notes answered ---` block. null when the reply
 * has no such line. (Task 18's parser reads every line of that block; this reads only the one answer
 * the page shows beside the block he asked about.)
 * @param {string | null | undefined} reply
 */
export function explainedAnswer(reply) {
  const text = String(reply ?? '');
  const start = text.lastIndexOf('--- Notes answered ---');
  if (start < 0) return null;
  const block = text.slice(start).split('\n').slice(1);
  for (const raw of block) {
    const line = raw.trim();
    if (line === '--- End ---') break;
    const m = /^1\.\s*done\s*·\s*explained\s*·\s*(.+)$/.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}
