// Small helpers for reading the Markdown records the workflow writes.

// Split a document into { preamble, sections: [{ heading, body }] } on "## " headings.
export function splitSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  const preamble = [];
  let current = null;
  for (const line of lines) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = { heading: h[1], body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  return {
    preamble: preamble.join('\n'),
    sections: sections.map((s) => ({ heading: s.heading, body: s.body.join('\n') })),
  };
}

export function findSection(sections, pattern) {
  return sections.find((s) => pattern.test(s.heading)) || null;
}

function splitRow(line) {
  // Split on pipes that are not escaped and not inside `code`.
  const cells = [];
  let cell = '';
  let inCode = false;
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') { cell += '|'; i++; continue; }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) { cells.push(cell.trim()); cell = ''; continue; }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

const isSeparator = (line) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line.trim());

// Parse the first Markdown table in `text` into an array of objects keyed by lower-cased header.
export function parseTable(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim().startsWith('|') && isSeparator(lines[i + 1])) {
      const headers = splitRow(lines[i]).map((h) => stripInline(h).toLowerCase());
      const rows = [];
      for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
        const cells = splitRow(lines[j]);
        if (cells.every((c) => c === '')) continue;
        const row = {};
        headers.forEach((h, k) => { row[h || `col${k}`] = cells[k] ?? ''; });
        rows.push(row);
      }
      return rows;
    }
  }
  return [];
}

// Remove bold/italic markers and surrounding backticks; keep the words.
export function stripInline(s) {
  return String(s ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S.*?)\*(?=\s|$)/g, '$1$2')
    .replace(/^`(.+)`$/, '$1')
    .trim();
}

// "- item" / "* item" bullets (top level and nested), with their text.
export function parseBullets(text) {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((l) => /^(\s*)[-*]\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ depth: Math.floor(m[1].length / 2), text: m[2].trim() }));
}
