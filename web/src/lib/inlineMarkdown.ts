// Short Markdown-ish text from the Foreman (a headline, a question, a reason, the live row's last
// lines) read as a few inline marks: `code`, **bold**, *emphasis* and [links](https://…). It only
// splits the text into pieces; components/InlineText.tsx shows them as React elements, so nothing is
// ever inserted as HTML. Whole documents and replies are rendered by the dashboard instead
// (dashboard/lib/markdown.js, shown with ServerHtml).

export type InlinePiece =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: InlinePiece[] }
  | { kind: 'em'; children: InlinePiece[] }
  | { kind: 'link'; href: string; children: InlinePiece[] };

// One alternative per mark; the first that matches at a position wins.
const MARKS = new RegExp([
  '(`+)([^`]|[^`][\\s\\S]*?[^`])\\1(?!`)', // 1, 2: code
  '\\*\\*(?=\\S)([\\s\\S]*?\\S)\\*\\*', // 3: strong
  '__(?=\\S)([\\s\\S]*?\\S)__(?![\\w])', // 4: strong
  '\\*(?=[^\\s*])([^*]*?[^\\s*])\\*', // 5: em (also one character: *a*)
  '(?<![\\w])_(?=[^\\s_])([^_]*?[^\\s_])_(?![\\w])', // 6: em, not inside snake_case words
  '\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)', // 7, 8: link (http and https only)
  '\\\\([\\\\`*_\\[\\]#>])', // 9: an escaped mark, shown as itself
].join('|'), 'g');

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
  kind: 'heading' | 'bullet' | 'numbered' | 'quote' | 'text' | 'rule';
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
