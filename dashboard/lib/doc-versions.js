// A job's older document versions (the job page rebuild, Task 12 fix round 1; lead's ruling I1). The
// job's documents are rewritten in place (spec.md v0.3 becomes v0.4 in the same file), so nothing kept
// the words of an earlier version. The new job page's reader lists them under `Older`, and Task 18's
// "What changed since vN" reads them.
//
// keepVersions(jobDir, docs) is called by the runner when it rebuilds a job's page (never on a
// request). For each document with a version number it keeps, in the job's own folder:
//   versions/<name>.v<n>.md      the last words seen for version n (written when missing or changed)
//   versions/<name>.v<n>.e<k>.md the earlier words of version n, when the document was rewritten
//                                without a new number (k = 1, 2, …; at most EARLIER_MAX kept, the
//                                newest in the highest k)
// <name> is the document's file without .md, with any folder part joined by `__` (review/db.md →
// review__db); the product spec (`spec`, kept in the repository) is `spec`. So when a document's
// number moves on, the copy of its previous version is already there, also across a restart, and a
// version is copied once: a rebuild that sees the same words writes nothing.
//
// It returns, per document, its older versions newest first ([{ n, id, name, text, updatedAt }]; id is
// the copy's path in the job folder, `versions/…`), for the payload's `versions` and the item route.
// It writes only inside <jobDir>/versions: never through a symlink (the folder or a copy), never a
// name with a path part. A document with no version, a JSON document, or one it cannot read is skipped.

import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './atomic-write.js';

export const VERSIONS_DIR = 'versions';
/** At most this many earlier copies of one version number. */
export const EARLIER_MAX = 5;
const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._-]{0,23}$/;
const MAX_BYTES = 1024 * 1024;

/** The copy's base name for a document's file: no folder part, no dots at the start, nothing odd. */
export function versionBase(file) {
  const s = String(file ?? '').replace(/\.md$/i, '').split(/[\\/]/).filter((p) => p && p !== '.' && p !== '..').join('__').replace(/[^0-9A-Za-z._-]/g, '_').replace(/^[.]+/, '');
  return s || null;
}

/** 1 when version a is newer than b, -1 when older, 0 when the same: number by number ('0.10' after '0.9'). */
export function compareVersionLabels(a, b) {
  const x = String(a).split('.');
  const y = String(b).split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? '0';
    const q = y[i] ?? '0';
    const np = Number(p);
    const nq = Number(q);
    if (Number.isFinite(np) && Number.isFinite(nq)) { if (np !== nq) return np > nq ? 1 : -1; }
    else if (p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A plain file's words, or null (missing, a symlink, too big). */
async function plain(abs) {
  const st = await fs.lstat(abs).catch(() => null);
  if (!st?.isFile() || st.size > MAX_BYTES) return null;
  const text = await fs.readFile(abs, 'utf8').catch(() => null);
  return text === null ? null : { text, updatedAt: st.mtime.toISOString() };
}

/**
 * Keep each document's words by version, and list its older versions (see the head of this file).
 * @param {string} jobDir the job's folder
 * @param {{ file: string, name?: string, version: string|null, text: string, type?: string }[]} docs
 * @returns {Promise<Map<string, { n: string, id: string, name: string, text: string, updatedAt: string }[]>>}
 */
export async function keepVersions(jobDir, docs) {
  const out = new Map();
  const root = path.resolve(jobDir);
  const rootSt = await fs.lstat(root).catch(() => null);
  if (!rootSt?.isDirectory()) return out;
  const dir = path.join(root, VERSIONS_DIR);
  let ready = null; // whether versions/ is a real folder of this job (made when first needed)
  const folder = async () => {
    if (ready !== null) return ready;
    let st = await fs.lstat(dir).catch(() => null);
    if (!st) { await fs.mkdir(dir).catch(() => {}); st = await fs.lstat(dir).catch(() => null); }
    ready = Boolean(st?.isDirectory() && !st.isSymbolicLink());
    return ready;
  };
  let names = null;
  const list = async () => (names ??= await fs.readdir(dir).catch(() => []));
  for (const d of Array.isArray(docs) ? docs : []) {
    const version = d?.version == null ? null : String(d.version);
    const base = versionBase(d?.file);
    if (!version || !SAFE_VERSION.test(version) || !base || d.type === 'json' || typeof d.text !== 'string') continue;
    const st = await fs.lstat(dir).catch(() => null);
    const exists = Boolean(st?.isDirectory() && !st.isSymbolicLink());
    if (st && !exists) continue; // versions is something else (a file, a symlink): never written through
    const current = path.join(dir, `${base}.v${version}.md`);
    const seen = exists ? await plain(current) : null;
    if (!seen || seen.text !== d.text) {
      if (!(await folder())) continue;
      const cst = await fs.lstat(current).catch(() => null);
      if (cst && !cst.isFile()) continue;
      if (seen) {
        // Rewritten under the same number: the words seen before become its newest earlier copy.
        const taken = (await list()).map((f) => new RegExp(`^${escape(base)}\\.v${escape(version)}\\.e(\\d+)\\.md$`).exec(f)).filter(Boolean).map((m) => Number(m[1]));
        const k = Math.min(EARLIER_MAX, (taken.length ? Math.max(...taken) : 0) + 1);
        if (k === EARLIER_MAX && taken.includes(EARLIER_MAX)) {
          // Full: the oldest goes, the rest move down one.
          for (let i = 1; i < EARLIER_MAX; i++) await fs.rename(path.join(dir, `${base}.v${version}.e${i + 1}.md`), path.join(dir, `${base}.v${version}.e${i}.md`)).catch(() => {});
        }
        await writeFileAtomic(path.join(dir, `${base}.v${version}.e${k}.md`), seen.text);
      }
      await writeFileAtomic(current, d.text);
      names = null;
    }
    // Its older versions: every other number, and the earlier copies of this one; newest first.
    const pattern = new RegExp(`^${escape(base)}\\.v(.+?)(?:\\.e(\\d+))?\\.md$`);
    const found = [];
    for (const f of await list()) {
      const m = pattern.exec(f);
      if (!m || !SAFE_VERSION.test(m[1])) continue;
      const k = m[2] ? Number(m[2]) : 0;
      if (m[1] === version && !k) continue; // the version shown now
      const copy = await plain(path.join(dir, f));
      if (!copy) continue;
      found.push({ v: m[1], k, n: k ? `${m[1]} (earlier ${k})` : m[1], id: `${VERSIONS_DIR}/${f}`, name: `${d.name ?? d.file} v${m[1]}${k ? ` (earlier ${k})` : ''}`, text: copy.text, updatedAt: copy.updatedAt });
    }
    // Newest first: the higher number first; within one number the kept words (k 0), then k high to low.
    found.sort((a, b) => compareVersionLabels(b.v, a.v) || (a.k === 0 ? -1 : b.k === 0 ? 1 : b.k - a.k));
    out.set(String(d.file), found.map(({ n, id, name, text, updatedAt }) => ({ n, id, name, text, updatedAt })));
  }
  return out;
}
