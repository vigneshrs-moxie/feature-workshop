// Repositories to offer when starting a job: the folders recent Claude Code sessions ran in
// that are git repositories, plus any the person types in (checked before use).

import fs from 'node:fs/promises';
import path from 'node:path';
import { isGitRepo } from './git.js';

export async function recentRepos(sessionIndex, extra = []) {
  const seen = new Map();
  for (const s of await sessionIndex.allSessions()) {
    const cwd = s.parsed.cwd;
    if (!cwd) continue;
    const at = s.parsed.lastAt ?? '';
    if (!seen.has(cwd) || seen.get(cwd) < at) seen.set(cwd, at);
  }
  for (const p of extra) if (p && !seen.has(p)) seen.set(p, '');
  const out = [];
  for (const [cwd, lastUsed] of seen) {
    const top = await isGitRepo(cwd);
    if (!top || out.some((r) => r.path === top)) continue;
    out.push({ path: top, name: path.basename(top), lastUsed: lastUsed || null });
  }
  return out.sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? ''));
}

export async function checkRepo(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return { ok: false, reason: 'Use a full path, starting with /.' };
  try {
    if (!(await fs.stat(p)).isDirectory()) return { ok: false, reason: 'That is not a folder.' };
  } catch {
    return { ok: false, reason: 'That folder doesn’t exist.' };
  }
  const top = await isGitRepo(p);
  if (!top) return { ok: false, reason: 'That folder isn’t a git repository.' };
  return { ok: true, path: top };
}
