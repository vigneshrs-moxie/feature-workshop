// Renders workflow Markdown (specs, findings, plans, reports) to safe HTML.
// Raw HTML in the source is shown as text, unsafe link schemes are dropped, and
// requirement IDs (FR-001, AC-003, D-005, …) become links to their definition.

import MarkdownIt from 'markdown-it';

// IDs the workflow uses: FR/AC/D/Q/R/S/M/P/A/G and review prefixes, e.g. FR-001, AC-9, G1b, R-2.
export const ID_PATTERN = /\b(?:FR|AC|NFR|D|Q|R|S|M|P|A|T|CONV|PERM|ERR|DB|UI|PERF|TEST|REV)-\d{1,3}[a-z]?\b/g;

const SAFE_LINK = /^(https?:|mailto:|#|vscode:\/\/file\/)/i;

function slugify(s) {
  return String(s).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80);
}

export function createRenderer() {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });
  md.validateLink = (url) => SAFE_LINK.test(url.trim()) || !/^[a-z][a-z0-9+.-]*:/i.test(url.trim());

  // Mark text tokens that sit inside links so IDs aren't nested inside another link.
  md.core.ruler.push('workshop_ids', (state) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue;
      let depth = 0;
      for (const tok of block.children) {
        if (tok.type === 'link_open') depth++;
        else if (tok.type === 'link_close') depth--;
        else if (tok.type === 'text' && depth > 0) tok.meta = { ...(tok.meta ?? {}), inLink: true };
      }
    }
  });

  const escape = md.utils.escapeHtml;
  md.renderer.rules.text = (tokens, idx, _opts, env) => {
    const tok = tokens[idx];
    const html = escape(tok.content);
    if (tok.meta?.inLink || !env?.idHref) return html;
    // IDs contain only [A-Za-z0-9-], so inserting them after escaping is safe.
    return html.replace(ID_PATTERN, (id) => `<a class="id-link" href="${escape(env.idHref(id))}" data-id="${id}">${id}</a>`);
  };

  // Headings get anchors; links open in a new tab and never send a referrer.
  md.renderer.rules.heading_open = (tokens, idx, opts, env, self) => {
    const inline = tokens[idx + 1];
    const text = inline?.children?.map((c) => c.content).join('') ?? '';
    tokens[idx].attrSet('id', `h-${slugify(text)}`);
    return self.renderToken(tokens, idx, opts);
  };
  const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const href = tokens[idx].attrGet('href') ?? '';
    if (/^https?:/i.test(href)) {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
    }
    return defaultLinkOpen(tokens, idx, opts, env, self);
  };
  md.renderer.rules.table_open = () => '<div class="table-wrap"><table>';
  md.renderer.rules.table_close = () => '</table></div>';
  return md;
}

const renderer = createRenderer();

export function renderMarkdown(text, { idHref = null } = {}) {
  return renderer.render(String(text ?? ''), { idHref });
}

// Where each ID appears across a set of documents: { [id]: { definition, mentions[] } }.
// The definition is the first line that looks like it defines the ID (table row, bold or "ID:"),
// preferring the spec; otherwise the first mention.
export function indexIds(docs) {
  const index = {};
  for (const doc of docs) {
    const lines = String(doc.text ?? '').split(/\r?\n/);
    lines.forEach((lineText, i) => {
      const ids = lineText.match(ID_PATTERN);
      if (!ids) return;
      for (const id of new Set(ids)) {
        const entry = (index[id] ??= { id, definition: null, mentions: [] });
        const snippet = lineText.trim().slice(0, 300);
        entry.mentions.push({ doc: doc.name, file: doc.file, line: i + 1, text: snippet });
        const defines = new RegExp(`^\\s*(?:\\|\\s*\\**${id}\\**\\s*\\||[-*]?\\s*\\*\\*${id}\\b|#{1,6}\\s*${id}\\b|${id}\\s*[:—–-])`).test(lineText);
        if (defines && (!entry.definition || (doc.isSpec && !entry.definition.isSpec))) {
          entry.definition = { doc: doc.name, file: doc.file, line: i + 1, text: snippet, isSpec: Boolean(doc.isSpec) };
        }
      }
    });
  }
  for (const entry of Object.values(index)) entry.definition ??= { ...entry.mentions[0], isSpec: false };
  return index;
}
