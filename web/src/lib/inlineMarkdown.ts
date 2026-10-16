// Short Markdown-ish text from the Foreman (a headline, a question, a reason, the live row's last
// lines) read as a few inline marks: `code`, **bold**, *emphasis* and [links](https://…). It only
// splits the text into pieces; components/InlineText.tsx shows them as React elements, so nothing is
// ever inserted as HTML. Whole documents and replies are rendered by the dashboard instead
// (dashboard/lib/markdown.js, shown with ServerHtml).
//
// Marks never start inside a word, so names stay as written: __pycache__, __init__.py, a*b*c and
// snake_case_names are plain text, not emphasis.

export type InlinePiece =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: InlinePiece[] }
  | { kind: 'em'; children: InlinePiece[] }
  | { kind: 'link'; href: string; children: InlinePiece[] };

// A bold or emphasis mark opens only at the start, after a space or after an opening bracket or
// quote, and closes only before a space or punctuation: never in the middle of a name or a path
// (src/*.ts, a*b*c, __init__.py, snake_case).
const OPEN = '(?<![^\\s(\\[{"\'])';

// One alternative per mark; the first that matches at a position wins.
const MARKS = new RegExp([
  '(`+)([^`]|[^`][\\s\\S]*?[^`])\\1(?!`)', // 1, 2: code
  `${OPEN}\\*\\*(?=\\S)([\\s\\S]*?\\S)\\*\\*(?![\\w*])`, // 3: strong
  `${OPEN}__(?=\\S)([\\s\\S]*?\\S)__(?![\\w])`, // 4: strong
  `${OPEN}\\*(?=[^\\s*])([^*]*?[^\\s*])\\*(?![\\w*])`, // 5: em (also one character: *a*)
  `${OPEN}_(?=[^\\s_])([^_]*?[^\\s_])_(?![\\w])`, // 6: em
  '\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)', // 7, 8: link (http and https only)
  '\\\\([\\\\`*_\\[\\]#>])', // 9: an escaped mark, shown as itself
].join('|'), 'g');

// "__name__" around one bare name (a Python dunder, a file name) is the name, not bold.
const BARE_NAME = /^[\w.-]+$/;

function pushText(out: InlinePiece[], text: string) {
  if (!text) return;
  const last = out.at(-1);
  if (last?.kind === 'text') last.text += text;
  else out.push({ kind: 'text', text });
}

/** The pieces of one line or paragraph of inline Markdown. */
export function parseInline(text: string, depth = 0): InlinePiece[] {
  const out: InlinePiece[] = [];
  const src = String(text ?? '');
  if (depth > 3) { pushText(out, src); return out; }
  let at = 0;
  const re = new RegExp(MARKS.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    pushText(out, src.slice(at, m.index));
    if (m[2] !== undefined) out.push({ kind: 'code', text: m[2].replace(/^ (.*) $/, '$1') });
    else if (m[4] !== undefined && BARE_NAME.test(m[4])) pushText(out, m[0]);
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ kind: 'strong', children: parseInline(m[3] ?? m[4], depth + 1) });
    else if (m[5] !== undefined || m[6] !== undefined) out.push({ kind: 'em', children: parseInline(m[5] ?? m[6], depth + 1) });
    else if (m[7] !== undefined) out.push({ kind: 'link', href: m[8], children: parseInline(m[7], depth + 1) });
    else pushText(out, m[9]);
    at = m.index + m[0].length;
  }
  pushText(out, src.slice(at));
  return out;
}

/** A line's block marks, stripped: "## Heading" is a heading, "- item" a bullet, "> x" a quote. */
export interface ShortLine {
  kind: 'heading' | 'bullet' | 'numbered' | 'quote' | 'text' | 'rule' | 'code';
  /** For a numbered item, its number as written. */
  marker?: string;
  text: string;
}

export function readLine(line: string): ShortLine {
  let m: RegExpExecArray | null;
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return { kind: 'rule', text: '' };
  if ((m = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line))) return { kind: 'heading', text: m[1] };
  if ((m = /^\s*>\s?(.*)$/.exec(line))) return { kind: 'quote', text: m[1] };
  if ((m = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line))) return { kind: 'bullet', text: m[1] };
  if ((m = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line))) return { kind: 'numbered', marker: m[1], text: m[2] };
  return { kind: 'text', text: line };
}

/** One line of text with its leading block mark ("## ", "- ", "> ") taken off. */
export function withoutBlockMark(text: string): string {
  const l = readLine(String(text ?? '').trim());
  if (l.kind === 'rule') return '';
  return l.kind === 'numbered' ? `${l.marker}. ${l.text}` : l.text;
}

/** The pieces as plain text (for aria labels and titles). */
export function inlinePlain(pieces: InlinePiece[]): string {
  return pieces.map((p) => (p.kind === 'text' || p.kind === 'code' ? p.text : inlinePlain(p.children))).join('');
}

/** Short Foreman text as plain words, marks taken off: for titles, aria labels and list rows. */
export function plainInline(text: string | null | undefined): string {
  return inlinePlain(parseInline(withoutBlockMark(String(text ?? ''))));
}

/** How many lines ShortMarkdown shows, at most. */
export const SHORT_MAX_LINES = 8;
// Only this much of the text is read at all, and this much of each line, so a long reply in
// progress costs the same as a short one.
const SHORT_MAX_INPUT = 4000;
const SHORT_MAX_LINE = 400;

/**
 * The first few non-empty lines of short Markdown, each read with readLine: lines inside a ``` (or
 * ~~~) fence come back as 'code', exactly as written; a table row's cells are joined with " · " and
 * its |---| line left out; rules and blank lines are left out.
 */
export function shortLines(text: string, max = SHORT_MAX_LINES): ShortLine[] {
  const out: ShortLine[] = [];
  let fence: string | null = null;
  for (const whole of String(text ?? '').slice(0, SHORT_MAX_INPUT).split(/\r?\n/)) {
    if (out.length >= max) break;
    const raw = whole.slice(0, SHORT_MAX_LINE);
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) {
      if (raw.trim()) out.push({ kind: 'code', text: raw });
      continue;
    }
    const t = raw.trim();
    if (t.startsWith('|') || (t.endsWith('|') && t.includes('|', 1))) {
      const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // the |---|---| line
      const row = cells.filter(Boolean).join(' · ');
      if (row) out.push({ kind: 'text', text: row });
      continue;
    }
    const l = readLine(raw);
    if (l.kind === 'rule' || !l.text.trim()) continue;
    out.push(l);
  }
  return out;
}
