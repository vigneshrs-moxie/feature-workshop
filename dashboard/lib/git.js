// Read-only git: the commits on a job's branch and one commit's diff. And read-only GitHub (gh,
// at the end): a pull request's checks, its review comments and a failed check's log.
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

// The commit a branch or ref points at (full sha), or null when it can't be read.
export async function headOf(dir, ref) {
  if (!REF.test(ref)) return null;
  try { return (await git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim() || null; } catch { return null; }
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

// ---------- Read-only GitHub (gh) ----------
//
// What a job's pull request says: its checks, its review comments and the log of a failed check
// (lib/pr-feedback.js). Each helper takes a `gh` runner, gh(args) -> { ok, out, err }, the same
// shape lib/flow.js gatherRepo uses (tests pass a fake). Only reads: `gh pr view`, `gh run view`
// and `gh api` with --method GET; nothing here can post, edit or merge.

const REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;
const RUN_ID = /^\d{1,20}$/;

/** A gh runner for this executable (default: gh on PATH): gh(args) -> { ok, out, err }. Never rejects. */
export function ghRunner(bin = 'gh', { timeout = 30000 } = {}) {
  return (args) => new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' } },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout ?? ''), err: err ? String(stderr || err.message).split('\n')[0] : null }));
  });
}

const defaultGh = ghRunner();

function checkRepo(repo, number) {
  if (!REPO.test(String(repo ?? ''))) throw new Error('Unexpected GitHub repository name');
  if (number !== undefined && !(Number.isInteger(number) && number > 0)) throw new Error('Unexpected pull request number');
}

function readJson(res, what) {
  if (!res?.ok) throw new Error(`${what}: ${res?.err ?? 'gh failed'}`);
  try { return JSON.parse(res.out); } catch { throw new Error(`${what}: unreadable output`); }
}

const FAIL = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const PASS = new Set(['SUCCESS', 'NEUTRAL']);
const SKIP = new Set(['SKIPPED', 'STALE']);

/** One rollup entry (a CheckRun or a StatusContext) -> { name, state: fail | pass | skipped | pending, link, runId }. */
export function checkOf(c) {
  const word = String(c?.conclusion || c?.state || c?.status || '').toUpperCase();
  const state = FAIL.has(word) ? 'fail' : PASS.has(word) ? 'pass' : SKIP.has(word) ? 'skipped' : 'pending';
  const link = c?.detailsUrl ?? c?.targetUrl ?? null;
  const runId = /\/actions\/runs\/(\d+)/.exec(String(link ?? ''))?.[1] ?? null;
  return { name: String(c?.name ?? c?.context ?? 'a check'), state, link, runId };
}

/**
 * A PR's checks on its newest commit: { head: <sha> | null, checks: [{ name, state, link, runId }] }.
 * From `gh pr view <n> --repo <repo> --json statusCheckRollup,headRefOid`. Throws on a gh failure.
 */
export async function prChecks(repo, number, { gh = defaultGh } = {}) {
  checkRepo(repo, number);
  const data = readJson(await gh(['pr', 'view', String(number), '--repo', repo, '--json', 'statusCheckRollup,headRefOid']), 'gh pr view');
  const rollup = Array.isArray(data?.statusCheckRollup) ? data.statusCheckRollup : [];
  return { head: typeof data?.headRefOid === 'string' ? data.headRefOid : null, checks: rollup.map(checkOf) };
}

const ghGet = (gh, apiPath) => gh(['api', '--method', 'GET', apiPath]);

/**
 * A PR's review comments (on a line of a file) and its reviews that have a body, oldest first:
 * [{ id, kind: 'line' | 'review', author, bot, file, line, body, link, at }]. From
 * `gh api repos/<repo>/pulls/<n>/comments` and `.../reviews`. Throws on a gh failure.
 */
export async function prComments(repo, number, { gh = defaultGh } = {}) {
  checkRepo(repo, number);
  const lineComments = readJson(await ghGet(gh, `repos/${repo}/pulls/${number}/comments?per_page=100`), 'gh api comments');
  const reviews = readJson(await ghGet(gh, `repos/${repo}/pulls/${number}/reviews?per_page=100`), 'gh api reviews');
  const who = (u) => ({ author: String(u?.login ?? 'someone'), bot: u?.type === 'Bot' || /\[bot\]$/i.test(String(u?.login ?? '')) });
  const out = [];
  for (const c of Array.isArray(lineComments) ? lineComments : []) {
    if (!String(c?.body ?? '').trim()) continue;
    out.push({ id: `c${c.id}`, kind: 'line', ...who(c.user), file: c.path ?? null, line: Number.isInteger(c.line) ? c.line : Number.isInteger(c.original_line) ? c.original_line : null, body: String(c.body), link: c.html_url ?? null, at: c.created_at ?? null });
  }
  for (const r of Array.isArray(reviews) ? reviews : []) {
    if (!String(r?.body ?? '').trim()) continue;
    out.push({ id: `r${r.id}`, kind: 'review', ...who(r.user), file: null, line: null, body: String(r.body), link: r.html_url ?? null, at: r.submitted_at ?? null });
  }
  return out.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
}

/** The last `lines` lines of a run's failed steps (`gh run view <id> --repo <repo> --log-failed`), as one string. Throws on a gh failure. */
export async function failedLog(repo, runId, { lines = 80, gh = defaultGh } = {}) {
  checkRepo(repo);
  if (!RUN_ID.test(String(runId ?? ''))) throw new Error('Unexpected run id');
  const res = await gh(['run', 'view', String(runId), '--repo', repo, '--log-failed']);
  if (!res?.ok) throw new Error(`gh run view: ${res?.err ?? 'gh failed'}`);
  // eslint-disable-next-line no-control-regex
  const all = res.out.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '').split('\n');
  while (all.length && !all.at(-1).trim()) all.pop();
  return all.slice(-Math.max(1, lines)).join('\n');
}

/** The GitHub login gh is signed in as (`gh api user`), or null. */
export async function ghLogin({ gh = defaultGh } = {}) {
  try { return readJson(await ghGet(gh, 'user'), 'gh api user')?.login ?? null; } catch { return null; }
}
