// A job's documents for the new UI's Docs tab: every .md (and .json) the crew writes in the job's
// private folder, plus the product spec in the repository, listed with a group, a version when
// status.json or workflow-status.md names one, and when it last changed. Read only.
//
// Which files: the folder's own top level and its briefs/, review/ and fable/ folders (one level
// each). Hidden files, symlinks and anything but plain .md/.json files are left out, so a link can't
// make the dashboard show a file from somewhere else.

import fs from 'node:fs/promises';
import path from 'node:path';

/** The largest document shown (bytes). Bigger ones are refused with a plain message. */
export const DOC_MAX_BYTES = 512 * 1024;

export const DOC_GROUPS = ['plan', 'briefs', 'review', 'notes', 'other'];

const SUBFOLDERS = ['briefs', 'review', 'fable'];
const DOC_FILE = /^[^.][^/\\]*\.(md|json)$/;

// Known files, in the order they show inside their group.
const KNOWN = [
  ['requirements.md', 'Requirements', 'plan'],
  ['findings.md', 'Findings', 'plan'],
  ['quick-plan.md', 'Quick plan', 'plan'],
  ['implementation-plan.md', 'Implementation plan', 'plan'],
  ['test-plan.md', 'Test plan', 'plan'],
  ['manual-test.md', 'Manual test', 'plan'],
  ['review.md', 'Review (combined)', 'review'],
  ['test-report.md', 'Test report', 'review'],
  ['notes.md', 'Notes', 'notes'],
  ['workflow-status.md', 'Workflow status', 'notes'],
  ['implementation-log.md', 'Implementation log', 'notes'],
  ['history.md', 'History', 'notes'],
  ['status.json', 'Status (status.json)', 'other'],
  ['options.json', 'Options (options.json)', 'other'],
];
const KNOWN_BY_FILE = new Map(KNOWN.map(([file, name, group], i) => [file, { name, group, order: i }]));

export class DocError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const words = (s) => s.replace(/[-_]+/g, ' ').trim();
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The group, display name and sort order of a document by its path inside the job folder. */
export function describeDoc(file) {
  const known = KNOWN_BY_FILE.get(file);
  if (known) return { ...known };
  let m;
  if ((m = /^briefs\/(\d+)-(.+)\.md$/.exec(file))) {
    const detail = /(^|-)detail$/.test(m[2]);
    return { name: `Brief #${Number(m[1])} · ${words(m[2])}`, group: 'briefs', order: -Number(m[1]) + (detail ? 0.5 : 0) };
  }
  if ((m = /^review\/(.+)\.md$/.exec(file))) return { name: `Review: ${words(m[1])}`, group: 'review', order: 100 };
  if ((m = /^fable\/(?:(\d+)-)?(.+)\.md$/.exec(file))) return { name: `Fable second look${m[1] ? ` #${Number(m[1])}` : ''} · ${words(m[2])}`, group: 'review', order: 200 + Number(m[1] ?? 0) };
  const base = file.replace(/\.(md|json)$/, '');
  if (/spec/i.test(base)) return { name: capital(words(path.basename(base))), group: 'plan', order: 50 };
  return { name: capital(words(base)), group: 'other', order: 1000 };
}

/** Versions the job's records name, by file inside the folder and by name. */
function versionIndex(dir, recorded = []) {
  const byFile = new Map();
  const byName = new Map();
  for (const a of recorded ?? []) {
    if (!a?.version) continue;
    if (a.name) byName.set(String(a.name).toLowerCase(), String(a.version));
    if (!a.path) continue;
    const abs = path.resolve(dir, a.path);
    const rel = path.relative(dir, abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) byFile.set(rel.split(path.sep).join('/'), String(a.version));
  }
  return { byFile, byName };
}

async function plainFiles(dir, sub) {
  const where = sub ? path.join(dir, sub) : dir;
  // A symlinked subfolder isn't followed.
  if (sub) {
    const st = await fs.lstat(where).catch(() => null);
    if (!st?.isDirectory()) return [];
  }
  let entries;
  try { entries = await fs.readdir(where, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || !DOC_FILE.test(e.name)) continue; // isFile() is false for a symlink
    if (sub && !e.name.endsWith('.md')) continue;
    const st = await fs.lstat(path.join(where, e.name)).catch(() => null);
    if (!st?.isFile()) continue;
    out.push({ file: sub ? `${sub}/${e.name}` : e.name, size: st.size, updatedAt: st.mtime.toISOString() });
  }
  return out;
}

/**
 * Every document of a job: [{ file, name, group, version, updatedAt, size, type }], grouped in
 * DOC_GROUPS order. `spec` is { path, version } for the product spec in the repository (file 'spec').
 */
export async function listJobDocs(dir, { spec = null, recorded = [] } = {}) {
  const versions = versionIndex(dir, recorded);
  const docs = [];
  if (spec?.path) {
    const st = await fs.stat(spec.path).catch(() => null);
    if (st?.isFile()) docs.push({ file: 'spec', name: 'Product spec', group: 'plan', order: -1, version: spec.version ?? null, updatedAt: st.mtime.toISOString(), size: st.size, type: 'md' });
  }
  const found = [...await plainFiles(dir, null)];
  for (const sub of SUBFOLDERS) found.push(...await plainFiles(dir, sub));
  for (const f of found) {
    const d = describeDoc(f.file);
    const version = versions.byFile.get(f.file) ?? versions.byName.get(d.name.toLowerCase()) ?? null;
    docs.push({ ...f, ...d, version, type: f.file.endsWith('.json') ? 'json' : 'md' });
  }
  docs.sort((a, b) => DOC_GROUPS.indexOf(a.group) - DOC_GROUPS.indexOf(b.group) || a.order - b.order || a.name.localeCompare(b.name));
  return docs.map(({ order, ...d }) => d);
}

/**
 * Read one document inside the job folder: { text, updatedAt, size }. Refuses (DocError) a path that
 * leaves the folder, goes through a symlink (the file or a folder on the way), isn't a plain .md or
 * .json file, is hidden (any part of its path starts with a dot, as the list leaves those out), or
 * is bigger than maxBytes.
 */
export async function readJobDoc(dir, rel, { maxBytes = DOC_MAX_BYTES } = {}) {
  const file = String(rel ?? '');
  if (!/\.(md|json)$/i.test(file)) throw new DocError(400, 'Only .md and .json documents are shown here.');
  const root = path.resolve(dir);
  const abs = path.resolve(root, file);
  if (!abs.startsWith(root + path.sep) || file.includes('\0')) throw new DocError(404, 'That file isn’t there (yet).');
  if (file.split(/[\\/]/).some((part) => part.startsWith('.'))) throw new DocError(404, 'That file isn’t there (yet).');
  const st = await fs.lstat(abs).catch(() => null);
  if (!st?.isFile()) throw new DocError(404, 'That file isn’t there (yet).');
  // A folder on the way that is a symlink would lead outside: compare the real paths.
  const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(abs)]).catch(() => [null, null]);
  if (!realRoot || !realFile || !realFile.startsWith(realRoot + path.sep)) throw new DocError(404, 'That file isn’t there (yet).');
  if (st.size > maxBytes) throw new DocError(413, `That document is too big to show here (${Math.round(st.size / 1024)} KB; at most ${Math.round(maxBytes / 1024)} KB). Open it in your editor instead.`);
  const text = await fs.readFile(abs, 'utf8').catch(() => null);
  if (text === null) throw new DocError(404, 'That file isn’t there (yet).');
  return { text, updatedAt: st.mtime.toISOString(), size: st.size };
}

/**
 * The product spec's real path when it may be shown, else null. Its path comes from status.json,
 * which the AI writes, so it is shown only when it is a .md file whose real path (symlinks followed)
 * lies inside one of `roots` (the job's repository and its own folder).
 */
export async function servableSpec(specPath, roots = []) {
  if (!specPath || !/\.md$/i.test(String(specPath)) || String(specPath).includes('\0')) return null;
  const real = await fs.realpath(specPath).catch(() => null);
  if (!real || !/\.md$/i.test(real)) return null;
  const st = await fs.stat(real).catch(() => null);
  if (!st?.isFile()) return null;
  for (const r of roots) {
    if (!r) continue;
    const realRoot = await fs.realpath(r).catch(() => null);
    if (realRoot && real.startsWith(realRoot + path.sep)) return real;
  }
  return null;
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** A JSON document as escaped, indented text in a <pre> (no colours); invalid JSON as it is. */
export function jsonHtml(text) {
  let pretty = text;
  try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* shown as written */ }
  return `<pre class="json-doc"><code>${escapeHtml(pretty)}</code></pre>`;
}
