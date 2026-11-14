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

// ---------- The answer (Task 18, R5 "See the answer to each request") ----------
//
// The Foreman answers every note at the very end of its final message (notes-and-comments.md):
//
//   --- Notes answered ---
//   1. done · Plan v3 · step 4 removed
//   2. done · commit abc1234 · EmployeesTable.tsx
//   3. not done · the badge component has no small size
//   --- End ---
//
// `<n>. done · explained · <the answer>` answers an `explain` note. A PR comments block
// (`--- Comments answered ---`, Task 21) may come first; it ends with the same `--- End ---`.
// Strict about the fence lines (each alone on its line, spelt exactly), forgiving about spacing.

const NOTES_ANSWERED = '--- Notes answered ---';
const COMMENTS_ANSWERED = '--- Comments answered ---';
const ANSWER_END = '--- End ---';
const ANSWER_LINE = /^(\d+)\s*\.\s*(not\s+done|done)\s*(?:·\s*(.*?))?\s*$/i;

/** The lines between the last `open` fence line and the first `--- End ---` line after it, trimmed; null when there is no such block. */
function lastBlock(text, open) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim());
  const start = lines.lastIndexOf(open);
  if (start < 0) return null;
  const end = lines.indexOf(ANSWER_END, start + 1);
  return end < 0 ? null : lines.slice(start + 1, end);
}

/**
 * The Foreman's answers to his notes, read from the last `--- Notes answered ---` block of its reply.
 * A line that is not an answer is left out; no block gives [].
 * where: the document and version, or `commit <sha>`, where he can see a change (null when not done
 * or explained); what: what changed, the answer to an explain note, or why it was not done.
 * @param {string | null | undefined} reply
 * @returns {{ n: number, done: boolean, explained: boolean, where: string | null, what: string }[]}
 */
export function parseAnswered(reply) {
  const block = lastBlock(reply, NOTES_ANSWERED);
  if (!block) return [];
  const out = [];
  for (const line of block) {
    const m = ANSWER_LINE.exec(line);
    if (!m) continue;
    const n = Number(m[1]);
    const rest = (m[3] ?? '').trim();
    if (/^not/i.test(m[2])) { out.push({ n, done: false, explained: false, where: null, what: rest }); continue; }
    const dot = rest.indexOf('·');
    const where = (dot < 0 ? rest : rest.slice(0, dot)).trim();
    const what = dot < 0 ? '' : rest.slice(dot + 1).trim();
    if (where.toLowerCase() === 'explained') out.push({ n, done: true, explained: true, where: null, what });
    else out.push({ n, done: true, explained: false, where: where || null, what });
  }
  return out;
}

const NOTES_OPEN = /--- Notes \((\d+)\) ---/g;
const NOTES_CLOSE = '--- End of notes ---';
const NOTE_ITEM = new RegExp(String.raw`(?:^|\s)(\d+)\.\s\[(${NOTE_KINDS.join('|')})\]\s`, 'g');

/** One sent note's words after its `n. [kind] `: the place, `> quote`, `Note: note` (on their own lines, or all on one). */
function sentParts(body) {
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const quote = lines.find((l) => l.startsWith('> '));
    const note = lines.find((l) => l.startsWith('Note: '));
    return { place: lines[0], quote: quote ? quote.slice(2).trim() : null, note: note ? note.slice(6).trim() || null : null };
  }
  // On one line (a gate reply's note: compose.js puts it on one line).
  const flat = oneLine(body);
  const n = flat.lastIndexOf(' Note: ');
  const head = n < 0 ? flat : flat.slice(0, n);
  const q = head.indexOf(' > ');
  return { place: (q < 0 ? head : head.slice(0, q)).trim(), quote: q < 0 ? null : head.slice(q + 3).trim() || null, note: n < 0 ? null : flat.slice(n + 7).trim() || null };
}

/**
 * The notes he sent, read back from a message of his (the last notes block in it): composeNotes's
 * block, on its lines or on one line. [] when there is none.
 * @param {string | null | undefined} text
 * @returns {{ n: number, kind: string, place: string, quote: string | null, note: string | null }[]}
 */
export function parseNotes(text) {
  const s = String(text ?? '');
  let open = null;
  for (const m of s.matchAll(NOTES_OPEN)) open = m;
  if (!open) return [];
  const from = open.index + open[0].length;
  const close = s.indexOf(NOTES_CLOSE, from);
  if (close < 0) return [];
  const inner = s.slice(from, close);
  const items = [...inner.matchAll(NOTE_ITEM)];
  return items.map((m, i) => {
    const body = inner.slice(m.index + m[0].length, i + 1 < items.length ? items[i + 1].index : inner.length);
    return { n: Number(m[1]), kind: m[2], ...sentParts(body) };
  });
}

/** How much of a reply the audit keeps (lib/driver.js, the `run-ended` line). */
export const REPLY_KEPT = 8000;
/** The answer blocks kept past that cut, at most this long (a longer end is cut as before). */
const TAIL_KEPT = 16000;

/**
 * The reply the audit keeps: whole when it is short; else its first REPLY_KEPT characters, and when
 * the answer blocks at its very end (`--- Comments answered ---`, `--- Notes answered ---`) would be
 * lost by that cut, `…` and the blocks whole after it, so the page can still read them.
 * @param {string | null | undefined} full
 */
export function keptReply(full) {
  const text = String(full ?? '');
  if (text.length <= REPLY_KEPT) return text;
  const lines = text.split('\n');
  let at = -1;
  let pos = 0;
  const found = {};
  for (const l of lines) {
    const t = l.trim();
    if (t === NOTES_ANSWERED || t === COMMENTS_ANSWERED) found[t] = pos;
    pos += l.length + 1;
  }
  for (const p of Object.values(found)) if (at < 0 || p < at) at = p;
  if (at < 0) return text.slice(0, REPLY_KEPT);
  const tail = text.slice(at);
  if (tail.length > TAIL_KEPT) return text.slice(0, REPLY_KEPT);
  if (at <= REPLY_KEPT) return text;
  return `${text.slice(0, REPLY_KEPT).trimEnd()}\n\n…\n\n${tail}`;
}
