// What the short ids in a job's questions mean (the glance layout, 16 Nov: "if it refers to things
// like R-01, FR-004, I can't understand it"). The job page's decision box shows each id's meaning beside
// it and its words under the question on a click, so he never leaves the decision to look one up.
//
// refsFrom reads the job's own documents (the spec, findings, the plan, the review and its lens files),
// its decisions and its review findings, and keeps, for each id, where it is defined:
//   - a heading that starts with it:           `## R-2 (major): the file name's date` + the paragraph under it
//   - a table row whose first cell is it:       `| FR-002 | The export button sits next to … |`
//   - a line (or list item) that starts with it: `AC-002: clicking Export downloads …`, `- R-3: …`
//   - a decision row's id (decisions.md):        D-005 → its decision and why
// A mention elsewhere ("Fix R-2 and R-3 now?") is not a definition. The first definition wins, headings
// and table rows before lines, documents before findings rows. Pure: no file is read here.

/** The ids the Foreman's skills write: findings R-n, requirements FR/NFR, acceptance AC, decisions D, questions Q, test cases TC, stories US. */
export const REF_ID = /\b(?:R|FR|NFR|AC|D|Q|TC|US)-\d{1,4}\b/;
const ID = REF_ID.source.replace(/^\\b|\\b$/g, '');

const HEADING = new RegExp(`^#{1,6}\\s+\\**(${ID})\\**\\b\\s*(.*)$`);
const TABLE = new RegExp(`^\\|\\s*\\**(${ID})\\**\\s*\\|(.*)$`);
const LINE = new RegExp(`^\\s*(?:[-*+]|\\d+[.)])?\\s*\\**(${ID})\\**\\s*(\\([^)]{0,40}\\))?\\s*[:.·—–-]\\s*(.+)$`);

const TITLE_MAX = 90;
const TEXT_MAX = 700;

/** Markdown down to plain words: no emphasis marks, backticks, links' targets or leading punctuation. */
export function plainWords(s) {
  return String(s ?? '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:—–\-.|]+/, '')
    .trim();
}

const capital = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);
const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** A title from the words after an id: up to the first sentence's end or colon, never past TITLE_MAX. */
function titleOf(rest) {
  const words = plainWords(rest);
  const end = words.search(/(?<=[.!?])\s|:\s/);
  return cut((end > 0 ? words.slice(0, end) : words).replace(/[.:]$/, ''), TITLE_MAX);
}

/**
 * @param {object} o
 * @param {{ file: string, name?: string, text: string }[]} [o.docs] the job's documents (itemSources' docs)
 * @param {object[]} [o.decided] decisions.md rows ({ id, decision, reason })
 * @param {{ text: string, severity?: string, status?: string }[]} [o.findings] the review's rows
 * @returns {Record<string, { id: string, title: string, text: string, where: { kind: string, id: string, name: string } }>}
 */
export function refsFrom({ docs = [], decided = [], findings = [] } = {}) {
  /** @type {Map<string, { rank: number, ref: object }>} */
  const found = new Map();
  const keep = (id, rank, ref) => {
    const had = found.get(id);
    if (!had || rank < had.rank) found.set(id, { rank, ref: { id, ...ref } });
  };

  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || typeof d.text !== 'string' || d.type === 'json') continue;
    const where = { kind: 'doc', id: String(d.file), name: String(d.name ?? d.file) };
    const lines = d.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m = HEADING.exec(line);
      if (m) {
        // The paragraph under the heading, to the next heading.
        const body = [];
        for (let j = i + 1; j < lines.length && !/^#{1,6}\s/.test(lines[j]) && body.join(' ').length < TEXT_MAX; j++) {
          if (lines[j].startsWith('```')) break;
          if (lines[j].trim()) body.push(lines[j].trim());
        }
        // `(major): the file name's date` → the tag goes in front of the text, the rest is the title.
        const h = /^(\([^)]{0,40}\))?\s*[:.·—–-]?\s*(.*)$/.exec(m[2]) ?? [m[2], '', m[2]];
        const tag = h[1] ? `${capital(plainWords(h[1].slice(1, -1)))} · ` : '';
        const head = plainWords(h[2]);
        const joined = body.length ? `${head}${/[.!?:]$/.test(head) ? '' : '.'} ${plainWords(body.join(' '))}` : head;
        keep(m[1], 0, { title: titleOf(h[2]), text: cut(`${tag}${joined}`, TEXT_MAX), where });
        continue;
      }
      m = TABLE.exec(line);
      if (m) {
        const cells = m[2].split('|').map(plainWords).filter(Boolean);
        // The title is the first cell that reads as words (`| R-3 | major | tests | No test for … |`), else the first.
        const title = cells.find((c) => c.split(' ').length >= 3) ?? cells[0];
        if (cells.length) keep(m[1], 1, { title: titleOf(title), text: cut(cells.join(' · '), TEXT_MAX), where });
        continue;
      }
      m = LINE.exec(line);
      if (m) {
        const tag = m[2] ? `${capital(plainWords(m[2].slice(1, -1)))} · ` : '';
        keep(m[1], 2, { title: titleOf(m[3]), text: cut(plainWords(`${tag}${m[3]}`), TEXT_MAX), where });
      }
    }
  }

  for (const r of Array.isArray(decided) ? decided : []) {
    const id = typeof r?.id === 'string' ? r.id.trim() : '';
    if (!new RegExp(`^${ID}$`).test(id)) continue;
    const what = plainWords(r.decision ?? r.chose ?? r.text ?? '');
    const why = plainWords(r.reason ?? r.why ?? '');
    if (!what) continue;
    keep(id, 1, { title: cut(what, TITLE_MAX), text: cut(why ? `${what} — ${why}` : what, TEXT_MAX), where: { kind: 'decisions', id: 'decisions', name: 'Decisions' } });
  }

  for (const f of Array.isArray(findings) ? findings : []) {
    const m = typeof f?.text === 'string' ? LINE.exec(f.text) : null;
    if (!m) continue;
    const sev = typeof f.severity === 'string' && f.severity ? `${capital(f.severity)} · ` : '';
    keep(m[1], 3, { title: titleOf(m[3]), text: cut(`${sev}${plainWords(m[3])}`, TEXT_MAX), where: { kind: 'findings', id: 'findings', name: 'Findings' } });
  }

  return Object.fromEntries([...found].map(([id, { ref }]) => [id, ref]));
}

const REF_ALL = new RegExp(REF_ID.source, 'g');

/**
 * The meanings of the ids a waiting decision mentions (its ask, questions and options), for the
 * payload's move: the page shows them on its first paint, with no request of its own. Null when none.
 * @param {Record<string, object>} refs refsFrom's answer
 * @param {{ ask?: string, questions?: { text?: string, options?: { label?: string, consequence?: string | null }[] }[] }} move
 */
export function mentionedRefs(refs, move) {
  const texts = [move?.ask, ...(move?.questions ?? []).flatMap((q) => [q?.text, ...(q?.options ?? []).flatMap((o) => [o?.label, o?.consequence])])];
  const ids = new Set(texts.flatMap((t) => (typeof t === 'string' ? t.match(REF_ALL) ?? [] : [])));
  const out = Object.fromEntries([...ids].filter((id) => refs?.[id]).map((id) => [id, refs[id]]));
  return Object.keys(out).length ? out : null;
}
