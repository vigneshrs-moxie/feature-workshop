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
  // By character, not by UTF-16 unit, so an emoji at the cut is never split in two.
  const chars = Array.from(t);
  return chars.length > QUOTE_MAX ? `${chars.slice(0, QUOTE_MAX - 1).join('').trimEnd()}…` : t;
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
const KINDS = NOTE_KINDS.join('|');
/** A note's first line in the block as composeNotes writes it: `n. [kind] place`. */
const NOTE_HEAD = new RegExp(String.raw`^(\d+)\.\s\[(${KINDS})\]\s(.*)$`);

/** The block as composeNotes writes it: each note's first line, then `> quote` and `Note: note` lines under it. */
function notesByLine(lines) {
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    const head = NOTE_HEAD.exec(line);
    if (head) { out.push({ n: Number(head[1]), kind: head[2], place: head[3].trim(), quote: null, note: null }); continue; }
    const last = out.at(-1);
    if (!last) continue;
    if (line.startsWith('> ') && last.quote === null && last.note === null) last.quote = line.slice(2).trim() || null;
    else if (line.startsWith('Note: ') && last.note === null) last.note = line.slice(6).trim() || null;
  }
  return out;
}

/** The first ` > ` not inside double quotes (a place names a heading or a line in quotes), or -1. */
function quoteMark(s) {
  let inside = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') inside = !inside;
    else if (!inside && s.startsWith(' > ', i)) return i;
  }
  return -1;
}

/**
 * The block on one line (a gate reply before compose.js kept its lines): `1. [kind] place > quote Note:
 * note 2. [kind] …`. The notes are numbered 1 to n in order, so each one starts at the last `k. [kind] `
 * before the next one's start (a quote that names the next number stays in its note); the place ends at
 * the first ` > ` outside quoted words, the note starts at the last ` Note: `.
 */
function notesOnOneLine(flat, count) {
  const starts = [];
  let end = flat.length;
  for (let k = count; k >= 1; k--) {
    const re = new RegExp(String.raw`(?:^|\s)${k}\.\s\[(${KINDS})\]\s`, 'g');
    let found = null;
    for (const m of flat.slice(0, end).matchAll(re)) found = m;
    if (!found) return [];
    starts.unshift({ k, kind: found[1], at: found.index, body: found.index + found[0].length });
    end = found.index;
  }
  return starts.map((st, i) => {
    const body = flat.slice(st.body, i + 1 < starts.length ? starts[i + 1].at : flat.length).trim();
    const q = quoteMark(body);
    const noteAt = body.lastIndexOf(' Note: ');
    const n = noteAt > q ? noteAt : -1;
    const head = n < 0 ? body : body.slice(0, n);
    return {
      n: st.k, kind: st.kind,
      place: (q < 0 ? head : head.slice(0, q)).trim(),
      quote: q < 0 ? null : head.slice(q + 3).trim() || null,
      note: n < 0 ? null : body.slice(n + 7).trim() || null,
    };
  });
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
  const lines = inner.split(/\r?\n/).filter((l) => l.trim());
  return lines.length > 1 ? notesByLine(lines) : notesOnOneLine(oneLine(inner), Number(open[1]));
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
  // The fence and end lines in order; a block is a fence whose next such line is its `--- End ---`
  // (a fence quoted on its own earlier in the reply is followed by another fence, not by an end).
  const marks = [];
  let pos = 0;
  for (const l of text.split('\n')) {
    const t = l.trim();
    if (t === NOTES_ANSWERED || t === COMMENTS_ANSWERED || t === ANSWER_END) marks.push({ t, pos });
    pos += l.length + 1;
  }
  const last = {};
  marks.forEach((m, i) => { if (m.t !== ANSWER_END && marks[i + 1]?.t === ANSWER_END) last[m.t] = m.pos; });
  const found = Object.values(last);
  if (!found.length) return text.slice(0, REPLY_KEPT);
  const at = Math.min(...found);
  const tail = text.slice(at);
  if (tail.length > TAIL_KEPT) return text.slice(0, REPLY_KEPT);
  if (at <= REPLY_KEPT) return text;
  return `${text.slice(0, REPLY_KEPT).trimEnd()}\n\n…\n\n${tail}`;
}
