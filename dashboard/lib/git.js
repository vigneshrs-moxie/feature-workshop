// Read-only git: the commits on a job's branch and one commit's diff.
// Commands run through execFile (no shell) with validated arguments and a time limit.

import { execFile } from 'node:child_process';

const REF = /^(?!-)[\w./@{}^~-]{1,200}$/;
const SHA = /^[0-9a-f]{4,40}$/i;

function git(dir, args, { maxBuffer = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', dir, ...args], { timeout: 15000, maxBuffer, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

export async function isGitRepo(dir) {
  try { return (await git(dir, ['rev-parse', '--show-toplevel'])).trim(); } catch { return null; }
}

// Commits in base..head, newest first.
export async function commits(dir, { base, head = 'HEAD', limit = 100 }) {
  if (!REF.test(head) || (base && !REF.test(base))) throw new Error('Unexpected branch or commit name');
  const range = base ? `${base}..${head}` : head;
  const out = await git(dir, ['log', '--no-color', `--max-count=${limit}`, '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e', range, '--']);
  return parseLog(out);
}

export function parseLog(out) {
  return out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [sha, short, author, date, subject] = r.split('\x1f');
    return { sha, short, author, date, subject, step: /\[(S\d+[a-z]?)\]|^(S\d+[a-z]?)[:\s]/.exec(subject)?.slice(1).find(Boolean) ?? null };
  });
}

// One commit: message, changed files and the patch (trimmed for very large changes).
export async function show(dir, sha, { maxLines = 4000 } = {}) {
  if (!SHA.test(sha)) throw new Error('Unexpected commit id');
  const meta = await git(dir, ['show', '--no-color', '--no-patch', '--format=%H%x1f%an%x1f%aI%x1f%B', sha]);
  const [full, author, date, message] = meta.split('\x1f');
  const stat = await git(dir, ['show', '--no-color', '--format=', '--numstat', '--find-renames', sha]);
  const patch = await git(dir, ['show', '--no-color', '--format=', '--patch', '--find-renames', sha]);
  return { sha: full.trim(), author, date, message: (message ?? '').trim(), files: parseNumstat(stat), ...splitPatch(patch, maxLines) };
}

export function parseNumstat(out) {
  return out.split('\n').filter(Boolean).map((l) => {
    const [add, del, ...rest] = l.split('\t');
    return { path: rest.join('\t'), added: add === '-' ? null : Number(add), removed: del === '-' ? null : Number(del) };
  });
}

// Split a patch into per-file sections for display.
export function splitPatch(patch, maxLines = 4000) {
  const lines = patch.split('\n');
  const truncated = lines.length > maxLines;
  const files = [];
  let cur = null;
  for (const l of lines.slice(0, maxLines)) {
    const m = /^diff --git a\/(.+) b\/(.+)$/.exec(l);
    if (m) { cur = { path: m[2], lines: [] }; files.push(cur); continue; }
    if (!cur) continue;
    if (/^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to))/.test(l)) continue;
    cur.lines.push(l);
  }
  return { patchFiles: files, truncated, totalLines: lines.length };
}
