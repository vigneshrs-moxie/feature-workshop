// Auto mode's fixed stop list: the things that always need the person, decided by code from facts,
// never by a model. If this code misses a case, an unattended job does the thing, so the rule is:
// when something can't be understood, it stops. Stopping too often is accepted; missing one is not.
//
// fixedStop(input, ctx) is a pure function of its input and ctx: no model, no network, no file reads
// beyond following symlinks to see where a path really lands. input is one of
//   { kind: 'gate', stage, nextStage }
//   { kind: 'card', toolName, input, hardLine, blockedPath }
//   { kind: 'job', level, suggestedLevel, triggers, stageState, statusCard, step, failures, problem }
// ctx = { worktrees, featureDir, specDirs, cwd, forkRemote, remoteUrl(name, dir), branches?, stateDir? }
//   remoteUrl(name, dir) is the push address of that remote in that folder ('' means the branch's own
//   push remote, as orgPushCheck looks it up), or null when git can't say. branches is the job's own
//   branch and its stack's parts, when known.
// It returns null or { rule, reason }: rule is one of AUTO_RULES, reason the sentence shown after
// "Auto stopped: ".
//
// The rules, by what a command does (see the tests for every case):
//   merge     gh pr merge; a gate past PR #1
//   database  a database client or migration tool, however it is wrapped; any .sql file given to a program
//   push      a git push whose remote is not the fork remote (a URL, no remote, another folder with
//             git -C, --repo, --all, --mirror, --tags, --delete, a refspec that lands on another branch)
//   outside   a write (an edit tool, a redirect, cp, mv, rm, tee, curl -o, git config --global, brew, kill, …)
//             that lands outside the worktrees, the job folder, the spec folders and the temp folders,
//             or where we can't tell; a gh or hub command that writes to a remote; a command whose
//             content is hidden (eval, a variable as the command, a here-document fed to a shell,
//             inline python or node code); a tool we don't know
// A deny hard line (a force push, an org push, the state folder) stays a refusal: it never reaches here.

import fs from 'node:fs';
import path from 'node:path';

import { autoAllowed } from './auto.js';
import { classify, commandParts, isInside, TEMP_DIRS } from './policy.js';
import { hardLine, namesStarbaseAddress, namesThisComputer, ORG_URL, physicalPath, rmInsideJob, WRAPPERS } from './hard-lines.js';
import { STAGES, STAGE_IDS } from './stages.js';

export const AUTO_STOP_REASONS = Object.freeze({
  merge: 'merging a pull request needs you.',
  database: 'a database change needs you.',
  outside: "this would change or delete something outside the job's own folders.",
  push: 'this would push somewhere other than your fork.',
  level: 'the job is now L3, and L3 jobs need you to approve each step.',
  blocked: "the Foreman says it can't do the ticket as written.",
  status: "the Foreman can't write a valid status.json.",
  tool: 'this tool is not one Auto can judge.',
});

/** Tools known to only read (or to hand work to the crew, whose own calls come through the hook too). Any other tool on an Auto job asks. */
export const READ_ONLY_TOOLS = Object.freeze(new Set([
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite', 'TaskOutput', 'TaskGet', 'TaskList', 'TaskCreate', 'TaskUpdate',
  'BashOutput', 'ToolSearch', 'Skill', 'SendMessage', 'Agent', 'Task', 'AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode',
  'WebFetch', 'WebSearch', 'ListMcpResources', 'ReadMcpResource',
]));
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const stop = (rule, extra = {}) => ({ rule, reason: AUTO_STOP_REASONS[rule], ...extra });

/** The job's own branch and its stack's part branches: the ones a push of Auto's may go to. */
export function branchesOf(branch, stack) {
  return [...new Set([branch, ...(stack?.sections ?? []).map((x) => x?.branch)].filter((b) => typeof b === 'string' && b))];
}

/** The fixed stop rules. Returns { rule, reason } or null. Throws on a malformed input (the hook then asks). */
export function fixedStop(input, ctx = {}) {
  switch (input?.kind) {
    case 'gate': return gateStop(input);
    case 'job': return jobStop(input);
    case 'card': return cardStop(input, ctx);
    default: throw new TypeError('fixedStop: unknown kind');
  }
}

// ---------- gate and job ----------

function gateStop({ nextStage }) {
  const at = STAGE_IDS.indexOf(nextStage);
  const pr1 = STAGE_IDS.indexOf('pr1');
  // Auto finishes at PR #1: a gate to anything after it (or to something unknown) is the merge rule.
  return at >= 0 && at <= pr1 ? null : stop('merge');
}

const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label ?? String(id ?? 'this');

function jobStop(j) {
  const ids = (j.triggers ?? []).map((t) => (typeof t === 'string' ? t : t?.id));
  if (ids.includes('migrations')) return stop('database');
  if (!autoAllowed({ level: j.level ?? null, suggestedLevel: j.suggestedLevel ?? null }).ok) return stop('level');
  if ((j.step?.count ?? 0) >= 3) return { rule: 'loop', reason: `the ${stageLabel(j.step.stage)} step came back for approval three times without moving on.` };
  if ((j.failures ?? 0) >= 2) return { rule: 'approver', reason: `the Approver failed twice running (${j.problem ?? 'no usable answer'}).` };
  if (j.stageState === 'blocked') return stop('blocked');
  if (j.statusCard) return stop('status');
  return null;
}

// ---------- card ----------

const PRIORITY = ['merge', 'database', 'push', 'outside'];

function cardStop(inp, ctx) {
  const toolName = inp.toolName;
  const input = inp.input ?? {};
  // A command too long to read, or made of too many commands, stops without being read (I9).
  if (toolName === 'Bash' && tooBig(String(input.command ?? ''))) return stop('outside');
  const own = hardLine(toolName, input, { cwd: ctx.cwd ?? null, stateDir: ctx.stateDir });
  const hard = inp.hardLine ?? own;
  if (own?.decision === 'deny' || hard?.decision === 'deny') return null; // refused outright, never asked
  if (typeof inp.blockedPath === 'string' && inp.blockedPath) return stop('outside');
  if (EDIT_TOOLS.has(toolName)) {
    const file = input.file_path ?? input.notebook_path;
    const where = typeof file === 'string' ? physicalPath(file, ctx.cwd ?? null) : null;
    return where && inRoots(where, jobRoots(ctx)) ? null : stop('outside');
  }
  if (toolName === 'Bash') return bashStop(String(input.command ?? ''), hard, ctx);
  if (READ_ONLY_TOOLS.has(toolName)) return null;
  return stop('tool', { unknownTool: true });
}

const MAX_COMMAND = 20_000;
const MAX_SIMPLE = 200;
const tooBig = (command) => command.length > MAX_COMMAND || command.split(/&&|\|\||[;&|\n]/).filter((x) => x.trim()).length > MAX_SIMPLE;

// The folders a job may change: its worktrees, record folder, spec folders and the temp folders, as
// written and as they really are (/tmp is /private/tmp on a Mac).
function jobRoots(ctx) {
  const roots = [...(ctx.worktrees ?? []), ctx.featureDir, ...(ctx.specDirs ?? []), ...TEMP_DIRS].filter((r) => typeof r === 'string' && path.isAbsolute(r));
  const out = new Set();
  for (const r of roots) { out.add(path.resolve(r)); const p = physicalPath(r, null); if (p) out.add(p); }
  return [...out];
}
const inRoots = (p, roots, strict = false) => roots.some((r) => isInside(p, r) && !(strict && p === r));

function bashStop(command, hard, ctx) {
  const st = { ctx, hits: new Set(), unknown: false, runs: [], written: [], touched: [], cloneDirs: [], branchChange: false, pushed: false, funcs: functionNames(command), roots: jobRoots(ctx), work: [...(ctx.worktrees ?? []), ctx.cwd].filter(Boolean).map((d) => physicalPath(d, null)).filter(Boolean) };
  if (hard?.line === 'gh-pr-merge') st.hits.add('merge');
  if (hard?.line === 'database') st.hits.add('database');
  if (DB_ADDRESS.test(command)) st.hits.add('database'); // a database address anywhere in the call
  analyze(command, ctx.cwd ?? null, st, 0, null);
  // A branch changed and a push in one call: where the push goes can't be told from here (C3).
  if (st.branchChange && st.pushed) st.hits.add('push');
  // A file this call writes and then runs, and what a clone just brought in, are not known (I8, C1).
  if (st.runs.some((r) => st.written.includes(r)) || st.cloneDirs.some((d) => st.touched.some((p) => p !== d && isInside(p, d)))) st.hits.add('outside');
  const verdict = classify('Bash', { command }, { mode: 'hands-off', stage: 'implement', worktrees: ctx.worktrees ?? [], specDirs: ctx.specDirs ?? [], featureDir: ctx.featureDir ?? null, cwd: ctx.cwd ?? null, rules: [] });
  if (verdict.outside) st.hits.add('outside');
  const rule = PRIORITY.find((r) => st.hits.has(r));
  return rule ? stop(rule, rule === 'outside' && st.unknown ? { unknownProgram: true } : {}) : null;
}

// Names a command defines as shell functions (their bodies are read as commands; a use of one is not an unknown program).
function functionNames(command) {
  const out = new Set();
  for (const m of command.matchAll(/(?:^|[;&|\n{(]\s*)(?:function\s+)?([A-Za-z_][\w.-]*)\s*\(\s*\)/g)) out.add(m[1]);
  for (const m of command.matchAll(/(?:^|[;&|\n{(]\s*)function\s+([A-Za-z_][\w.-]*)/g)) out.add(m[1]);
  return out;
}

// ---------- reading a command ----------

const words = (text) => {
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
};
const name = (x) => x.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
const SQL = /\.sql$/i;
const DB_ADDRESS = /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?):\/\//i;

// Splits a command we could not read properly (backticks, comments, here-documents, a trailing &) at
// ; & | ( ) and newlines outside quotes, lifting $( … ) and `…` out to be read on their own.
function rawSplit(src) {
  const pieces = [];
  const inner = [];
  let cur = '';
  let q = null;
  const flush = () => { if (cur.trim()) pieces.push(cur.trim()); cur = ''; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (q === "'") { cur += c; if (c === "'") q = null; continue; }
    if (c === '\\') { cur += c + (n ?? ''); i++; continue; }
    if (c === '$' && n === '(') {
      let d = 1;
      let j = i + 2;
      for (; j < src.length && d > 0; j++) { if (src[j] === '(') d++; else if (src[j] === ')') d--; }
      inner.push(src.slice(i + 2, d === 0 ? j - 1 : j));
      cur += '$SUB';
      i = j - 1;
      continue;
    }
    if (c === '`') {
      const j = src.indexOf('`', i + 1);
      const end = j < 0 ? src.length : j;
      inner.push(src.slice(i + 1, end));
      cur += '$SUB';
      i = end;
      continue;
    }
    if (q === '"') { cur += c; if (c === '"') q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '&' && (n === '>' || src[i - 1] === '>' || src[i - 1] === '<')) { cur += c; continue; }
    if (';&|\n()'.includes(c)) { flush(); continue; }
    cur += c;
  }
  flush();
  return { pieces, inner };
}

// Words and redirections of one raw piece: the same shape commandParts gives.
function rawWords(piece) {
  const ws = [];
  const redirects = [];
  const all = words(piece);
  for (let i = 0; i < all.length; i++) {
    if (/^<<-?$/.test(all[i])) { i++; continue; } // a here-document's end word
    if (/^<<-?\S/.test(all[i])) continue;
    const input = /^<([^<].*)?$/.exec(all[i]);
    if (input) { const target = input[1] || all[++i] || ''; redirects.push({ op: '<', target, dyn: target.includes('$') }); continue; }
    const m = /^(?:\d+|&)?(>{1,2}\|?|<>)(.*)$/.exec(all[i]);
    if (!m) { ws.push({ t: all[i], dyn: all[i].includes('$') }); continue; }
    if (m[2].startsWith('&')) continue; // 2>&1
    const target = m[2] || all[++i] || '';
    redirects.push({ op: '>', target, dyn: target.includes('$') });
  }
  return { ws, redirects };
}

function analyze(command, cwd, st, depth, viaXargs) {
  if (depth > 4) { st.hits.add('outside'); return; }
  // The hard lines' own reading of the same text (it also looks inside bash -c and eval).
  const h = hardLine('Bash', { command }, { cwd });
  if (h?.line === 'gh-pr-merge') st.hits.add('merge');
  if (h?.line === 'database') st.hits.add('database');
  const parts = commandParts(command, cwd);
  if (parts) {
    let lost = false;
    let guess = null; // where a script lookup may look, taking a plain `cd name` as a folder of that name (writes never use it)
    for (const part of parts) {
      const first = part.words.find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w.t))?.t;
      st.hint = lost ? null : part.cwd ?? guess;
      simple(part.words, part.redirects ?? [], lost ? null : part.cwd, st, depth, viaXargs);
      if (first === 'pushd' || first === 'popd') lost = true; // where later commands run is no longer known
      const ws = part.words.filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w.t));
      if (ws[0]?.t === 'cd' && ws.length === 2 && !ws[1].dyn && /^[^/~.-]/.test(ws[1].t) && (part.cwd ?? guess)) guess = path.resolve(part.cwd ?? guess, ws[1].t);
      else if (ws[0]?.t === 'cd') guess = null;
    }
    return;
  }
  const { pieces, inner } = rawSplit(command);
  for (const piece of pieces) { const { ws, redirects } = rawWords(piece); simple(ws, redirects, null, st, depth, viaXargs); }
  for (const s of inner) analyze(s, null, st, depth + 1, viaXargs);
}

// Wrappers beyond hard-lines' list. Each maps to its options that take a value.
const EXTRA_WRAPPERS = new Map([['setsid', []], ['stdbuf', ['-i', '-o', '-e']], ['watch', ['-n', '--interval']], ['ionice', ['-c', '-n', '-p']], ['unbuffer', []], ['arch', []], ['doas', ['-u', '-C']], ['chronic', []], ['sudoedit', []]]);

function unwrap(ws, st, cwd, depth) {
  let i = 0;
  const assigns = [];
  const wrappers = [];
  for (;;) {
    const x = ws[i];
    if (!x) break;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(x.t)) { assigns.push(x.t); i++; continue; }
    const wrapper = name(x.t);
    const takes = WRAPPERS.get(wrapper) ?? EXTRA_WRAPPERS.get(wrapper);
    if (!takes) break;
    wrappers.push(wrapper);
    i++;
    while (ws[i]?.t.startsWith('-') && ws[i].t !== '-') {
      const opt = ws[i++].t;
      if (opt === '--') break;
      if (takes.includes(opt)) {
        const v = ws[i++];
        if (wrapper === 'env' && (opt === '-S' || opt === '--split-string') && v) analyze(v.t, cwd, st, depth + 1, null); // a command inside the option
      }
      if (wrapper === 'env' && /^--split-string=/.test(opt)) analyze(opt.slice(15), cwd, st, depth + 1, null);
    }
    if (wrapper === 'timeout') i++; // the duration
  }
  return { rest: ws.slice(i), assigns, wrappers };
}

// ---------- the programs ----------

const DB_CLIENTS = new Set(['psql', 'pgcli', 'pg_restore', 'pg_dump', 'pg_dumpall', 'createdb', 'dropdb', 'createuser', 'dropuser', 'mysql', 'mysqldump', 'mysqlsh', 'mariadb', 'mariadb-dump', 'sqlite', 'sqlite3', 'litecli', 'mongosh', 'mongo', 'mongorestore', 'mongodump', 'redis-cli', 'cqlsh', 'sqlcmd', 'sqlplus', 'usql', 'clickhouse-client', 'duckdb', 'alembic', 'flyway', 'liquibase', 'dbmate', 'goose', 'atlas', 'bq', 'tsql', 'isql', 'turso', 'pscale', 'drizzle-kit']);
const RUNNERS = new Set(['iex', 'elixir', 'mix', 'npx', 'bunx', 'pnpx', 'npm', 'pnpm', 'yarn', 'bun', 'dlx', 'exec', 'uvx', 'poetry', 'pipenv', 'bundle']);
const EXEC_LIKE = new Set(['docker', 'podman', 'nerdctl', 'kubectl', 'oc', 'ssh', 'heroku', 'fly', 'flyctl', 'railway', 'vercel', 'nix-shell', 'direnv', 'devbox', 'doppler', 'dotenv', 'op', 'aws', 'gcloud', 'az']);
// Programs that only print their arguments or move files about: a client's name among them is just text.
const TEXTY = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'echo', 'printf', 'cat', 'head', 'tail', 'less', 'more', 'ls', 'man', 'which', 'whereis', 'type', 'sed', 'awk', 'wc', 'stat', 'file', 'git', 'gh', 'hub', 'npm', 'pnpm', 'yarn', 'bun', 'brew', 'cp', 'mv', 'rm', 'touch', 'mkdir', 'tee', 'code', 'vim', 'nano', 'open', 'diff', 'cmp', 'basename', 'dirname', 'realpath', 'test', '[', 'read']);

function dbTool(t, rest) {
  const r = rest.filter((x) => typeof x === 'string');
  switch (t) {
    case 'prisma': return r.some((x) => x === 'migrate' || x === 'db') && true;
    case 'cockroach': case 'dolt': return r.some((x) => /^sql/.test(x));
    case 'mix': return r.some((x) => /^ecto(\.|$)/.test(x));
    case 'php': case 'artisan': { const k = t === 'artisan' ? -1 : r.findIndex((x) => /(^|\/)artisan$/.test(x)); return (t === 'artisan' || k >= 0) && r.slice(k + 1).some((x) => /^(migrate|db)(:|$)/.test(x)); }
    case 'flask': return r.includes('db');
    case 'wrangler': return r.includes('d1');
    case 'heroku': return r.some((x) => /^pg(:|$)/.test(x));
    case 'aws': return r.some((x) => /^rds/.test(x));
    case 'gcloud': return r.includes('sql');
    case 'az': return r.some((x) => /^(sql|mysql|postgres|cosmosdb|redis)$/.test(x));
    case 'supabase': return r.some((x) => x === 'db' || x === 'migration');
    case 'knex': case 'sequelize': case 'sequelize-cli': case 'typeorm': case 'alembic': case 'flyway': case 'liquibase': case 'dbmate': case 'goose': case 'sqitch': case 'atlas': case 'node-pg-migrate': case 'mikro-orm': case 'umzug': case 'migrate': case 'db-migrate':
      return r.some((x) => /migrat|db:|seed|^(up|down|upgrade|downgrade|push|reset|rollback|apply|deploy)$/i.test(x));
    case 'rails': case 'rake': case 'padrino': case 'bin/rails': case 'bin/rake': return r.some((x) => /^db(:|$)/.test(x) || x === 'dbconsole');
    case 'manage.py': case 'django-admin': return r.some((x) => /^(migrate|flush|dbshell|loaddata|sqlmigrate|sqlflush|sqlsequencereset|squashmigrations)$/.test(x));
    case 'make': case 'just': case 'task': case 'mage': return r.some((x) => /migrat|^db[:-]|^seed/i.test(x));
    default:
      if (/^python[\d.]*$/.test(t)) {
        const m = r.indexOf('-m');
        if (m >= 0 && r[m + 1]) { const mod = r[m + 1] === 'django' ? 'django-admin' : r[m + 1]; return DB_CLIENTS.has(mod) || dbTool(mod, r.slice(m + 2)); }
        return r.some((x) => /manage\.py$/.test(x)) && dbTool('manage.py', r);
      }
      return false;
  }
}

function dbCommand(cmd, args) {
  const a = args.map((x) => x.t);
  if (DB_CLIENTS.has(cmd) || dbTool(cmd, a)) return true;
  const through = RUNNERS.has(cmd) || EXEC_LIKE.has(cmd);
  if (through) {
    for (let k = 0; k < a.length; k++) {
      const c = name(a[k]);
      if (DB_CLIENTS.has(c) || dbTool(c, a.slice(k + 1))) return true;
    }
  }
  return false;
}

// S1: for a job on Auto a program is let in by name. Anything not in a group stops (outside, unknownProgram).
// Reads: only read, so they pass whatever path they read.
const READS = new Set(['cat', 'ls', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'head', 'tail', 'wc', 'diff', 'cmp', 'find', 'file', 'stat', 'du', 'df', 'pwd', 'echo', 'printf', 'date', 'which', 'whereis', 'type', 'env', 'printenv', 'test', '[', '[[', ']]', 'true', 'false', 'sort', 'uniq', 'cut', 'tr', 'jq', 'yq', 'basename', 'dirname', 'realpath', 'readlink', 'tree', 'less', 'more', 'man', 'column', 'comm', 'join', 'paste', 'nl', 'fold', 'fmt', 'tac', 'rev', 'od', 'hexdump', 'xxd', 'strings', 'md5', 'md5sum', 'shasum', 'sha1sum', 'sha256sum', 'cksum', 'seq', 'sleep', 'id', 'whoami', 'uname', 'hostname', 'getconf', 'nproc', 'expr', 'wait', 'xargs',
  // shell builtins and keywords
  'cd', 'pushd', 'popd', 'exit', 'return', 'break', 'continue', 'export', 'unset', 'set', 'shift', 'local', 'declare', 'typeset', 'readonly', 'let', 'read', 'getopts', 'hash', 'ulimit', ':', '}', 'if', 'fi', 'for', 'done', 'while', 'until', 'case', 'esac', 'elif', 'in', 'select', 'function']);
// File changes: pass only when every path argument is inside the job's folders (a path we can't place stops).
const FILE_CHANGES = new Set(['cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'ln', 'chmod', 'chown', 'chgrp', 'sed', 'gsed', 'awk', 'gawk', 'perl', 'tee', 'tar', 'unzip', 'zip', 'rsync', 'install', 'truncate', 'dd', 'patch', 'ed', 'unlink', 'shred', 'mkfifo', 'mknod', 'chflags', 'xattr', 'split', 'csplit', 'cpio', 'ditto', 'gzip', 'gunzip', 'bzip2', 'bunzip2', 'xz', 'unxz', 'unrar', '7z', '7za', 'mktemp']);
// Build and test: they pass unless a rule stops them (a database tool, -e/-c code, a global install, a publish).
const BUILD = new Set(['node', 'nodejs', 'npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx', 'deno', 'tsc', 'tsx', 'ts-node', 'vitest', 'jest', 'eslint', 'prettier', 'pip', 'pip3', 'pytest', 'ruby', 'bundle', 'rake', 'rails', 'mix', 'elixir', 'flask', 'go', 'cargo', 'rustc', 'make', 'mvn', 'gradle', 'dotnet', 'php', 'composer', 'uv', 'poetry', 'pipenv', 'vite', 'webpack', 'rollup', 'esbuild', 'turbo', 'nx', 'lerna', 'playwright', 'cypress', 'mocha', 'ruff', 'black', 'mypy', 'flake8', 'swift', 'xcodebuild', 'gcc', 'cc', 'clang', 'java', 'javac', 'just', 'tox', 'nox', 'perl']);
const programGroup = (cmd) => (READS.has(cmd) ? 'read' : FILE_CHANGES.has(cmd) ? 'file' : BUILD.has(cmd) || /^python[\d.]*$/.test(cmd) ? 'build' : cmd === 'git' || cmd === 'gh' || cmd === 'hub' ? 'git' : cmd === 'curl' || cmd === 'wget' ? 'net' : null);
const NPM_PUBLISH = /^(publish|unpublish|deprecate|adduser|login|logout|dist-tag|access|owner|token|team|profile|set|link|ln)$/;

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh']);
const INLINE = { node: /^-[A-Za-z]*[ep]$|^--(eval|print)(=|$)/, nodejs: /^-[A-Za-z]*[ep]$|^--(eval|print)(=|$)/, ruby: /^-[A-Za-z]*e$/, perl: /^-[A-Za-z]*[eE]$/, php: /^-[A-Za-z]*r$/, lua: /^-e$/, deno: /^eval$/ };
const PY_INLINE = /^-[A-Za-z]*c$/;
const NO_STDIN = /^(-V|--version|-v|-h|--help|--test|-m|--check|-c|-p|-e|-E|-r|--eval|--print)$/;
const DANGEROUS = new Set(['launchctl', 'crontab', 'at', 'osascript', 'open', 'kill', 'pkill', 'killall', 'systemctl', 'service', 'defaults', 'scutil', 'diskutil', 'hdiutil', 'pmset', 'networksetup', 'dscl', 'tmutil', 'shutdown', 'reboot', 'halt', 'mount', 'umount', 'chsh', 'passwd', 'security', 'spctl', 'csrutil', 'nvram', 'pfctl', 'sysadminctl', 'softwareupdate', 'pkgutil', 'installer', 'xcode-select', 'ssh', 'sftp', 'sudo', 'su', 'doas', 'sudoedit', 'systemsetup', 'dseditgroup', 'ifconfig', 'route']);
const BREW_READ = new Set(['list', 'ls', 'info', 'search', '--prefix', '--version', '--cellar', '--repository', 'config', 'doctor', 'outdated', 'deps', 'uses', 'leaves', 'desc', 'home', 'log', 'cat']);
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'describe', 'blame', 'merge-base', 'for-each-ref', 'shortlog', 'cat-file', 'ls-tree', 'grep', 'check-ignore', 'rev-list', 'name-rev', 'cherry', 'range-diff', 'count-objects', 'whatchanged', 'help', 'version']);
const PROTECTED = /^(main|master|staging|stage|production|prod|develop|development|trunk|release([/-].*)?|releases\/.*|hotfix\/.*)$/i;
const PUSH_STOP_LONG = ['all', 'mirror', 'tags', 'prune', 'delete', 'follow-tags', 'force', 'force-with-lease', 'force-if-includes', 'repo', 'receive-pack', 'exec', 'signed'];
const GH_OK = { pr: ['view', 'list', 'status', 'checks', 'diff', 'create', 'checkout'], issue: ['view', 'list', 'status'], repo: ['view'], run: ['view', 'list', 'watch'], release: ['view', 'list'], auth: ['status'], workflow: ['view', 'list'], search: null, status: null };

function simple(ws, redirects, cwd, st, depth, viaXargs) {
  const { ctx } = st;
  const out = (word) => pathOutside(word, cwd, st);
  const recordWrite = (word) => { const p = physicalPath(word.t, cwd); if (p) st.written.push(p); };
  const hit = (rule) => st.hits.add(rule);
  // Redirections: output anywhere but /dev/null and the job's folders stops; input from a .sql file is a database change.
  for (const r of redirects) {
    if (r.op === '<' || r.op === '<&' || (r.op === '>&' && /^(\d+|-)$/.test(r.target))) { if (SQL.test(r.target)) hit('database'); continue; }
    if (!r.dyn && /^\/dev\/(null|stdout|stderr|tty)$/.test(r.target)) continue;
    if (SQL.test(r.target)) hit('database');
    if (out({ t: r.target, dyn: r.dyn })) hit('outside');
    recordWrite({ t: r.target, dyn: r.dyn });
  }
  if (ws.some((w) => SQL.test(w.t))) hit('database'); // a .sql file given to any program
  const { rest, assigns, wrappers } = unwrap(ws, st, cwd, depth);
  if (wrappers.some((w) => DANGEROUS.has(w))) hit('outside');
  if (!rest.length) return;
  const cmdWord = rest[0];
  if (cmdWord.dyn) { hit('outside'); return; } // a command chosen while it runs
  const cmd = name(cmdWord.t);
  const args = rest.slice(1);
  const a = args.map((x) => x.t);
  const xargs = wrappers.includes('xargs') || viaXargs === true;
  const pos = (list = args) => { const o = []; let opts = true; for (const x of list) { if (opts && x.t === '--') { opts = false; continue; } if (opts && x.t.startsWith('-') && x.t !== '-') continue; o.push(x); } return o; };
  const valueOf = (re) => { const k = a.findIndex((x) => re.test(x)); return k < 0 ? null : (/=/.test(a[k]) && a[k].startsWith('--') ? { t: a[k].slice(a[k].indexOf('=') + 1), dyn: args[k].dyn } : args[k + 1] ?? { t: '', dyn: true }); };
  // A write program's targets can't be known when xargs feeds them in.
  const writes = (targets, content = true) => { if (xargs) hit('outside'); for (const t of targets) { if (out(t)) hit('outside'); if (content) recordWrite(t); } };

  if (DANGEROUS.has(cmd)) hit('outside');
  if (/^(nc|ncat|netcat|telnet|socat)$/.test(cmd) && a.some((x) => /(^|:)(5432|3306|1433|27017|6379|9042)$/.test(x))) hit('database'); // a database port, on any host
  if (/^(curl|wget|nc|ncat|netcat|telnet|ssh|socat|sftp|scp)$/.test(cmd) && a.some((x) => namesThisComputer(x))) hit('outside'); // a call to this computer, on any port
  if (dbCommand(cmd, args)) hit('database');
  else if (!TEXTY.has(cmd) && args.some((x) => DB_CLIENTS.has(name(x.t)))) hit('database'); // a client named under a wrapper we don't know
  if (EXEC_LIKE.has(cmd)) for (const x of args) if (/\s/.test(x.t)) analyze(x.t, cwd, st, depth + 1, null);

  // S1: a program is let in by name.
  const inside = cmdWord.t.includes('/') ? physicalPath(cmdWord.t, cwd) : null;
  const ownBin = inside && inRoots(inside, st.roots) && /\/node_modules\/\.bin\/[^/]+$/.test(inside);
  const byFile = inside && inRoots(inside, st.roots) && !ownBin; // a file of the job's own, run by its path
  const known = byFile || (!cmdWord.t.includes('/') || ownBin) && (programGroup(cmd) || SHELLS.has(cmd) || cmd === 'eval' || cmd === 'source' || cmd === '.' || cmd === 'alias' || st.funcs.has(cmd.replace(/\(\)$/, '')));
  if (!known) { hit('outside'); st.unknown = true; return; }
  if (cmd === 'alias') { hit('outside'); for (const x of a) { const eq = x.indexOf('='); if (eq > 0) analyze(x.slice(eq + 1), cwd, st, depth + 1, null); } return; }
  if (byFile) { scriptFile(cmdWord, cwd, st); return; }

  if (SHELLS.has(cmd)) {
    const c = args.findIndex((x) => /^-[A-Za-z]*c$/.test(x.t));
    if (c >= 0) {
      const script = args[c + 1];
      if (!script || script.dyn) hit('outside'); else analyze(script.t, cwd, st, depth + 1, null);
    } else if (!pos().filter((x) => x.t !== '-').length || a.includes('-s')) hit('outside'); // reads its commands from a pipe or here-document
    else scriptFile(pos().filter((x) => x.t !== '-')[0], cwd, st); // the file it runs
    return;
  }
  if (cmd === 'eval') { hit('outside'); analyze(a.join(' '), cwd, st, depth + 1, null); return; }
  if (cmd === 'source' || cmd === '.') { hit('outside'); return; }
  const inline = /^python[\d.]*$/.test(cmd) ? PY_INLINE : INLINE[cmd];
  if (inline || /^(python[\d.]*|node|nodejs|ruby|perl|php|deno|lua)$/.test(cmd)) {
    const mod = a.indexOf('-m');
    if (mod >= 0 && a[mod + 1] === 'pip') pipStep(a.slice(mod + 2), (r) => hit(r));
    if (a.some((x) => inline?.test(x))) hit('outside'); // code we can't read
    else if (!pos().filter((x) => x.t !== '-').length && !a.some((x) => NO_STDIN.test(x))) hit('outside'); // code from stdin
    if (cmd === 'perl' || cmd === 'ruby') { if (a.some((x) => /^-[A-Za-z]*i/.test(x))) writes(pos()); }
    if (!(mod >= 0) && !a.some((x) => inline?.test(x))) { const file = interpreterFile(cmd, args); if (file) scriptFile(file, cwd, st); }
    return;
  }

  if (cmd === 'git') { gitStep(args, assigns, cwd, st, xargs); return; }
  if (cmd === 'gh' || cmd === 'hub') { ghStep(cmd, args, a, st); return; }

  switch (cmd) {
    case 'rm': {
      const targets = pos();
      writes(targets);
      const r = a.some((x) => x === '--recursive' || /^-[A-Za-z]*[rR]/.test(x));
      const f = a.some((x) => x === '--force' || /^-[A-Za-z]*f/.test(x));
      if (r && f && !rmInsideJob(ws.map((x) => x), cwd, { worktrees: ctx.worktrees ?? [], featureDir: ctx.featureDir })) hit('outside');
      for (const t of targets) if (pathOutside(t, cwd, st, true)) hit('outside');
      return;
    }
    case 'mv': writes(pos()); for (const t of pos()) if (pathOutside(t, cwd, st, true)) hit('outside'); return;
    case 'tee': case 'truncate': case 'split': writes(pos().filter((x) => x.t !== '-')); return;
    case 'rmdir': case 'unlink': case 'touch': case 'mkdir': case 'shred': case 'mkfifo': case 'mknod': case 'chflags': case 'xattr': writes(pos().filter((x) => x.t !== '-'), false); return;
    case 'chmod': case 'chown': case 'chgrp': {
      let skipped = false;
      const rest2 = args.filter((x) => !(x.t.startsWith('-') && /^-[A-Za-z]+$/.test(x.t) && !/^-[rwxXst]+$/.test(x.t)) && !/^--/.test(x.t));
      const targets = rest2.filter((x) => { if (!skipped && (cmd === 'chmod' ? /^([0-7]{3,4}|[ugoa]*[-+=][rwxXstugo]*(,[ugoa]*[-+=][rwxXstugo]*)*)$/.test(x.t) : true)) { skipped = true; return false; } return true; });
      writes(targets, false);
      return;
    }
    case 'ln': lnStep(a, args, pos, valueOf, cwd, st, writes); return;
    case 'cp': case 'install': case 'rsync': case 'ditto': case 'scp': {
      if (cmd === 'install' && a.includes('-d')) { writes(pos()); return; }
      const t = valueOf(/^(-t|--target-directory(=.*)?)$/);
      const p = pos().filter((x) => !(t && x === t));
      const dest = t ?? (p.length >= 2 ? p[p.length - 1] : null);
      if (!dest) { writes([{ t: '.', dyn: false }]); return; }
      for (const x of [...p, dest]) if (/^[^/]*:/.test(x.t) && !x.t.startsWith('/')) hit('outside'); // a remote host
      writes([...p, dest]); // every path argument, sources too
      return;
    }
    case 'dd': writes(a.filter((x) => /^(of|if)=/.test(x)).map((x) => ({ t: x.slice(3), dyn: x.includes('$') }))); return;
    case 'curl': {
      const targets = [];
      for (let k = 0; k < a.length; k++) {
        if (/^(--output|--output-dir|-o|--dump-header|-D|--cookie-jar|-c|--trace|--trace-ascii)$/.test(a[k]) || /^-[A-Za-z]*[oDc]$/.test(a[k])) targets.push(args[k + 1] ?? { t: '', dyn: true });
        else if (/^--(output|output-dir|dump-header|cookie-jar|trace|trace-ascii)=/.test(a[k])) targets.push({ t: a[k].slice(a[k].indexOf('=') + 1), dyn: args[k].dyn });
        else if (a[k] === '--remote-name' || a[k] === '--remote-name-all' || a[k] === '-J' || /^-[A-Za-z]*O$/.test(a[k])) targets.push({ t: '.', dyn: false });
        // Only a plain download passes: nothing sent, no method but GET, no @file, no config file.
        const x = a[k];
        if (/^(-X|--request)$/.test(x)) { if ((a[k + 1] ?? '').toUpperCase() !== 'GET') hit('outside'); } else if (/^-X./.test(x) || /^--request=/.test(x)) { if (x.replace(/^(-X|--request=)/, '').toUpperCase() !== 'GET') hit('outside'); }
        if (/^(-d|-F|-T|-K|--json|--config|--upload-file|--unix-socket|--resolve|--connect-to)$/.test(x) || /^--(data|form|json|upload-file|config|resolve|connect-to|unix-socket)/.test(x) || (/^-[A-Za-z]+$/.test(x) && /[dFTK]/.test(x))) hit('outside');
        if (x.startsWith('@') || /^-[-A-Za-z]+[=:]@/.test(x) || /=@/.test(x)) hit('outside');
      }
      writes(targets);
      return;
    }
    case 'wget': {
      const targets = [];
      for (let k = 0; k < a.length; k++) {
        if (/^(-O|-P|--output-document|--directory-prefix|-o|--output-file|-a|--append-output)$/.test(a[k])) { if (args[k + 1]?.t !== '-') targets.push(args[k + 1] ?? { t: '', dyn: true }); }
        else if (/^--(output-document|directory-prefix|output-file)=/.test(a[k])) targets.push({ t: a[k].slice(a[k].indexOf('=') + 1), dyn: args[k].dyn });
        else if (/^-O./.test(a[k]) && a[k] !== '-O-') targets.push({ t: a[k].slice(2), dyn: false });
        if (/^--(post-data|post-file|body-data|body-file|method)(=|$)/.test(a[k]) || /^(-e|--execute)/.test(a[k])) hit('outside');
      }
      if (!a.some((x) => /^(-O|--output-document)/.test(x))) targets.push({ t: '.', dyn: false });
      writes(targets);
      return;
    }
    case 'tar': case 'unzip': case 'gunzip': case 'bunzip2': case 'unrar': case '7z': case '7za': writes([...pos(), { t: '.', dyn: false }]); return;
    case 'sed': case 'gsed': case 'awk': case 'gawk': {
      const sed = cmd.endsWith('sed');
      const scripts = [];
      const files = [];
      let own = false; // a script given with -e / -f / --expression / --file
      for (let k = 0; k < args.length; k++) {
        const x = a[k];
        if (/^(-e|--expression|--program)$/.test(x)) { own = true; scripts.push(args[++k]?.t ?? ''); continue; }
        if (!sed && /^--(expression|program)=/.test(x)) { own = true; scripts.push(x.slice(x.indexOf('=') + 1)); continue; }
        if (/^(-f|--file)$/.test(x) || /^--file=/.test(x)) { hit('outside'); own = true; if (!x.includes('=')) k++; continue; } // a script file we don't read
        if (x.startsWith('-') && x !== '-') { if (!sed && /^(-v|-F)$/.test(x)) k++; continue; }
        files.push(args[k]);
      }
      if (!own && files.length) scripts.push(files.shift().t);
      const inPlace = a.some((x) => /^-[A-Za-z]*i|^--in-place/.test(x) && (sed || x === '-i' || x === '--in-place'));
      const real = files.filter((x) => x.t !== '');
      if (inPlace) writes(real);
      for (const sc of scripts) scriptWrites(sed, sc, cwd, st, writes);
      return;
    }
    case 'npm': case 'pnpm': case 'yarn': case 'bun': case 'npx': case 'bunx': case 'pnpx': {
      const sub1 = a.find((x) => !x.startsWith('-')) ?? '';
      const sub2 = a.filter((x) => !x.startsWith('-'))[1] ?? '';
      if (a.some((x) => x === '-g' || /^--(global|location=global)$/.test(x)) || a[0] === 'global' || NPM_PUBLISH.test(sub1) || (sub1 === 'config' && /^(set|delete|edit|rm)$/.test(sub2))) hit('outside');
      else if (cmd !== 'npx' && cmd !== 'bunx' && cmd !== 'pnpx') packageScripts(cmd, args, cwd, st);
      return;
    }
    case 'pip': case 'pip3': pipStep(a, hit); return;
    case 'brew': if (!BREW_READ.has(a[0] ?? '')) hit('outside'); return;
    case 'pipx': case 'gem': case 'cargo': case 'go': case 'uv': if (['install', 'tool', 'uninstall', 'upgrade'].includes(a[0]) || cmd === 'pipx') hit('outside'); return;
    case 'find': findStep(args, a, cwd, st); return;
    case 'pushd': case 'popd': return;
    default:
      if (FILE_CHANGES.has(cmd)) writes(pos().filter((x) => x.t !== '-' && x.t !== '')); // we can't tell which argument is a path: every one is
  }
}

// ln: the link's own name, and where it points. A link made here and used in this call is never resolved,
// so a target outside the job's folders (or one we can't place) stops. A symbolic link's relative target is
// relative to the folder the link is in.
function lnStep(a, args, pos, valueOf, cwd, st, writes) {
  const hit = (rule) => st.hits.add(rule);
  const sym = a.some((x) => x === '--symbolic' || /^-[A-Za-z]*s/.test(x));
  const t = valueOf(/^(-t|--target-directory(=.*)?)$/);
  const p = pos().filter((x) => !(t && x === t) && x.t !== '');
  let linkDir;
  let targets;
  let links;
  if (t) { linkDir = t; targets = p; links = [t]; } else if (p.length <= 1) { targets = p; linkDir = { t: '.', dyn: false }; links = [linkDir]; } else {
    const dest = p[p.length - 1];
    targets = p.slice(0, -1);
    links = [dest];
    const there = physicalPath(dest.t, cwd);
    let isDir = false;
    try { isDir = Boolean(there) && fs.statSync(there).isDirectory(); } catch { /* not there yet */ }
    linkDir = isDir || targets.length > 1 || dest.t.endsWith('/') ? dest : { t: path.posix.dirname(dest.t), dyn: dest.dyn };
  }
  writes(links);
  const base = physicalPath(linkDir.t, cwd);
  for (const x of targets) {
    const at = sym ? (base ? physicalPath(x.t, base) : null) : physicalPath(x.t, cwd);
    if (!at || !inRoots(at, st.roots)) hit('outside');
  }
}

// ---------- scripts run by file (I8) ----------

const MAX_SCRIPT = 200 * 1024;
// What a script's text may not name. A plain text search: over-stopping is accepted.
const DB_CLIENT_TEXT = /\b(psql|pgcli|pg_restore|pg_dump(?:all)?|createdb|dropdb|createuser|dropuser|mysql(?:dump|sh)?|mariadb(?:-dump)?|sqlite3?|litecli|mongosh?|mongorestore|mongodump|redis-cli|cqlsh|sqlcmd|sqlplus|usql|clickhouse-client|duckdb|alembic|flyway|liquibase|dbmate|goose|atlas|bq|tsql|isql|turso|pscale|drizzle-kit|sqitch|db-migrate|node-pg-migrate)\b/i;
const DB_TOOL_TEXT = /\b(prisma|supabase|wrangler|rails|rake|artisan|flask|mix|heroku|aws|gcloud|az|knex|sequelize(?:-cli)?|typeorm|manage\.py|django-admin|cockroach|dolt)\b[^\n]*(?:\bmigrat\w*|\bdb\b|\bdb:\S*|\bseed\S*|\becto\.\S+|\brds\S*|\bsql\b|\bd1\b|\bpg:\S*|\bdbshell|\bflush\b|\bloaddata)/i;
const SENDING = /\b(curl|wget)\b[^\n]*\s(?:-X\s*(?!GET\b)\w+|--request|-d\b|--data\S*|-F\b|--form|-T\b|--upload-file|--post-\w+|--body-\w+|--json|--method)/i;

function scanScript(text, st) {
  if (DB_CLIENT_TEXT.test(text) || DB_TOOL_TEXT.test(text) || DB_ADDRESS.test(text)) st.hits.add('database');
  if (/\bgit\b[^\n]*\bpush\b/.test(text)) st.hits.add('push');
  if (/\bgh\s+(?:pr\s+merge|api)\b/.test(text)) st.hits.add('merge');
  const dir = st.ctx.stateDir;
  if (/\.starbase\b/i.test(text) || (typeof dir === 'string' && dir && text.includes(dir)) || namesStarbaseAddress(text, st.ctx.apiPort)) st.hits.add('outside');
  if (SENDING.test(text)) st.hits.add('outside');
}

// A file a program runs: it must be a readable file of the job's own, not over 200 KB, and not written by this call.
function scriptFile(word, cwd, st) {
  const at = word && !word.dyn ? physicalPath(word.t, cwd ?? st.hint ?? null) : null;
  if (!at || !inRoots(at, st.roots)) { st.hits.add('outside'); return; }
  let text;
  try {
    const info = fs.statSync(at);
    if (!info.isFile() || info.size > MAX_SCRIPT) { st.hits.add('outside'); return; }
    text = fs.readFileSync(at, 'utf8');
  } catch { st.hits.add('outside'); return; }
  st.runs.push(at);
  scanScript(text, st);
}

// The file a language runtime is given to run: its first argument that is not an option (or an option's value).
const RUNTIME_VALUE = /^(-r|--require|--import|--loader|--experimental-loader|-C|--conditions|--env-file|--eval-file|-W|-I|-X|-Z)$/;
function interpreterFile(cmd, args) {
  const list = [];
  for (let k = 0; k < args.length; k++) {
    const x = args[k].t;
    if (x === '--') { list.push(...args.slice(k + 1)); break; }
    if (RUNTIME_VALUE.test(x)) { k++; continue; }
    if (x.startsWith('-')) continue;
    list.push(args[k]);
  }
  if (cmd === 'deno' && /^(run|test|bench|task)$/.test(list[0]?.t ?? '')) list.shift();
  return list[0] && !/^python[\d.]*$/.test(cmd) || (list[0] && !args.some((x) => x.t === '-m')) ? list[0] : null;
}

// npm run <name>, npm test, pnpm <name>, yarn <name>: the scripts.<name> text (and its pre and post) in the nearest package.json.
const PKG_VALUE = /^(--prefix|-C|--cwd|--dir|-w|--workspace|--filter|-F|--registry|--loglevel)$/;
const PKG_BUILTIN = new Set(['install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'upgrade', 'exec', 'dlx', 'x', 'init', 'create', 'list', 'ls', 'outdated', 'audit', 'why', 'pack', 'cache', 'config', 'info', 'view', 'link', 'unlink', 'prune', 'rebuild', 'dedupe', 'version', 'help', 'store', 'env', 'fetch', 'patch', 'import', 'root', 'bin', 'prefix', 'pkg', 'doctor', 'explain', 'diff', 'set', 'get', 'workspaces', 'workspace', 'global', 'dev', 'completion']);
function packageScripts(cmd, args, cwd, st) {
  let base = cwd ?? st.hint ?? null;
  const rest = [];
  for (let k = 0; k < args.length; k++) {
    const x = args[k].t;
    if (x === '--') break;
    if (/^(--prefix|-C|--cwd|--dir)$/.test(x)) { const d = args[++k]; base = d && !d.dyn && base ? physicalPath(d.t, base) : null; continue; }
    if (/^--(prefix|cwd|dir)=/.test(x)) { base = base ? physicalPath(x.slice(x.indexOf('=') + 1), base) : null; continue; }
    if (PKG_VALUE.test(x)) { k++; continue; }
    if (!x.startsWith('-')) rest.push(x);
  }
  const names = [];
  const sub = rest[0];
  if (!sub) return;
  if (/^(run|run-script|rum|urun)$/.test(sub)) { if (rest[1]) names.push(rest[1]); } else if (/^(test|t|tst|start|stop|restart)$/.test(sub)) names.push(sub === 't' || sub === 'tst' ? 'test' : sub);
  else if (cmd !== 'npm' && !PKG_BUILTIN.has(sub) && !(cmd === 'bun' && sub === 'test')) names.push(sub);
  if (!names.length) return;
  if (!base) { st.hits.add('outside'); return; }
  // The nearest package.json at or above the folder, inside the job's folders. None at all: npm would fail, nothing runs.
  let dir = base;
  let file = null;
  for (let guard = 0; guard < 40 && dir && inRoots(dir, st.roots); guard++) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) { file = candidate; break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (!file) return;
  let scripts;
  try {
    const info = fs.statSync(file);
    if (info.size > MAX_SCRIPT) { st.hits.add('outside'); return; }
    scripts = JSON.parse(fs.readFileSync(file, 'utf8'))?.scripts ?? {};
  } catch { st.hits.add('outside'); return; }
  for (const n of names) for (const key of [`pre${n}`, n, `post${n}`]) if (typeof scripts[key] === 'string') scanScript(scripts[key], st);
}

// pip: reading is fine; installing needs a virtual env of the job's own (run by its path), never --user or the system.
function pipStep(a, hit) {
  const sub = a.find((x) => !x.startsWith('-')) ?? '';
  if (['list', 'show', 'freeze', 'check', 'help', 'inspect', 'search', 'config', 'debug', 'hash'].includes(sub) || (!sub && a.some((x) => /^(--version|-V|--help|-h)$/.test(x)))) return;
  hit('outside');
}

// What a sed or awk script writes: the files it names for output, and anything it runs.
function scriptWrites(sed, script, cwd, st, writes) {
  if (sed) {
    for (const m of script.matchAll(/(?:^|[;{}\n]|\/[gpiImM0-9]*)\s*[wW]\s*([^\s;}]+)/g)) writes([{ t: m[1], dyn: m[1].includes('$') }]);
    if (/(?:^|[;{}\n])\s*e\b|\/[gpiImM0-9]*e\s*(?:$|[;}\n])/.test(script)) st.hits.add('outside'); // sed's e runs a command
    return;
  }
  for (const m of script.matchAll(/>>?\s*"?([^"\s;}]+)"?/g)) writes([{ t: m[1], dyn: m[1].includes('$') }]);
  if (/system\s*\(|getline|close\s*\(/.test(script) || /\|/.test(script.replace(/\|\|/g, ''))) st.hits.add('outside'); // awk's pipes and system() run commands
}

function findStep(args, a, cwd, st) {
  const starts = [];
  for (const x of args) { if (x.t.startsWith('-') || x.t === '!' || x.t === '(') break; starts.push(x); }
  const execAt = a.map((x, k) => (/^-(exec|execdir|ok|okdir)$/.test(x) ? k : -1)).filter((k) => k >= 0);
  const writes = a.some((x) => x === '-delete' || /^-(fprint0?|fprintf|fls)$/.test(x)) || execAt.length;
  if (writes) for (const s of starts.length ? starts : [{ t: '.', dyn: false }]) if (pathOutside(s, cwd, st)) st.hits.add('outside');
  for (const k of execAt) {
    const cmd = [];
    for (let j = k + 1; j < args.length && !(a[j] === ';' || a[j] === '+'); j++) cmd.push(args[j]);
    st.inFind = true;
    try { simple(cmd, [], cwd, st, 1, 'find'); } finally { st.inFind = false; } // its targets come from the folders just checked
  }
  for (let k = 0; k < a.length; k++) if (/^-(fprint0?|fprintf|fls)$/.test(a[k]) && pathOutside(args[k + 1] ?? { t: '', dyn: true }, cwd, st)) st.hits.add('outside');
}

function ghStep(cmd, args, a, st) {
  const hit = (rule) => st.hits.add(rule);
  const p = args.filter((x, k) => !(x.t.startsWith('-') || ['-R', '--repo'].includes(a[k - 1])) ).map((x) => x.t);
  const [group, action] = p;
  if (cmd === 'hub') {
    if (!['pull-request', 'ci-status', 'browse'].includes(group) && !(group === 'pr' && ['list', 'show', 'checkout'].includes(action))) { hit('outside'); st.unknown = true; }
    return;
  }
  if (group === 'pr' && action === 'merge') { hit('merge'); return; }
  if (group === 'api') {
    const method = a.findIndex((x) => /^(-X|--method)$/.test(x));
    const m = (method >= 0 ? a[method + 1] : (a.find((x) => /^--method=/.test(x)) ?? '').slice(9)) || 'GET';
    if (/\/merge(\?|$)/.test(a.join(' ')) && /pulls\/\d+\/merge/.test(a.join(' '))) hit('merge');
    if (m.toUpperCase() !== 'GET' || a.some((x) => /^(-f|-F|--field|--raw-field|--input)$/.test(x) || /^-[fF]./.test(x))) hit('outside');
    return;
  }
  if (a.some((x) => x === '--version' || x === '--help') && !group) return;
  const ok = GH_OK[group];
  if (ok === null && group) return; // gh search / gh status only read
  if (!ok || !ok.includes(action)) { hit('outside'); if (!ok) st.unknown = true; }
}

// ---------- git ----------

// Subcommands that work on the repository and the worktree (push, remote, config, worktree, clone and init have their own rules below).
const GIT_LOCAL = new Set(['add', 'commit', 'checkout', 'switch', 'restore', 'reset', 'stash', 'branch', 'tag', 'merge', 'rebase', 'cherry-pick', 'revert', 'fetch', 'pull', 'clean', 'mv', 'rm', 'notes', 'reflog', 'bisect', 'sparse-checkout', 'symbolic-ref', 'ls-remote', 'show-ref', 'show-branch', 'diff-tree', 'diff-index', 'diff-files', 'push', 'send-pack', 'remote', 'config', 'worktree', 'clone', 'init', 'gc']);
const GIT_ENV = /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|NAMESPACE|CONFIG|SSH|EXEC_PATH|PROXY|ASKPASS)/;
const GIT_CFG_RISKY = /^(remote\.|url\.|core\.(sshcommand|gitproxy|hookspath|fsmonitor|pager|editor)|push\.|include|alias\.|credential|http\.|submodule\.|filter\.|diff\.[^.]*\.(command|textconv))/i;
const normUrl = (u) => String(u ?? '').trim().replace(/\/+$/, '').replace(/\.git$/, '').toLowerCase();

function gitStep(args, assigns, cwd, st, xargs) {
  const { ctx } = st;
  const hit = (rule) => st.hits.add(rule);
  let i = 0;
  let eff = cwd;
  let foreign = assigns.some((x) => GIT_ENV.test(x));
  let risky = false;
  while (args[i]?.t.startsWith('-')) {
    const t = args[i].t;
    if (t === '-C') { const d = args[i + 1]; eff = !d || d.dyn || !eff ? null : physicalPath(d.t, eff); i += 2; continue; }
    if (t === '-c') { if (GIT_CFG_RISKY.test(args[i + 1]?.t ?? '') || args[i + 1]?.dyn) risky = true; i += 2; continue; }
    if (/^--(git-dir|work-tree|exec-path|config-env|super-prefix)(=|$)/.test(t)) { foreign = true; i += t.includes('=') ? 1 : 2; continue; }
    i++;
  }
  const sub = args[i]?.t;
  const sargs = args.slice(i + 1);
  const a = sargs.map((x) => x.t);
  if (!sub) return;
  if (!GIT_READ.has(sub) && !GIT_LOCAL.has(sub)) { hit('outside'); st.unknown = true; return; } // a subcommand (or alias) we don't know
  const inWork = eff && st.work.some((w) => isInside(eff, w));
  if (a.some((x) => /^--(git-dir|work-tree)(=|$)/.test(x))) { hit('outside'); return; } // acts on another folder
  if (changesBranch(sub, a)) st.branchChange = true;
  if (sub === 'push' || sub === 'send-pack') {
    st.pushed = true;
    if (foreign || risky || !inWork || pushStops(sargs, eff, ctx)) hit('push');
    return;
  }
  if (risky || foreign) { hit(foreign && !GIT_READ.has(sub) ? 'outside' : 'outside'); return; }
  if (sub === 'remote' && ['add', 'set-url', 'rename', 'remove', 'rm', 'set-head', 'set-branches'].includes(a[0])) { hit('push'); return; }
  if (sub === 'config') {
    const read = a.some((x) => /^(--get|--get-all|--get-regexp|--list|-l|--get-urlmatch)$/.test(x));
    if (a.some((x) => /^--(global|system|file|worktree|includes)|^-f$/.test(x))) { hit('outside'); return; }
    const key = a.find((x) => !x.startsWith('-')) ?? '';
    if (!read && GIT_CFG_RISKY.test(key)) hit('push');
    return;
  }
  if (sub === 'worktree' && ['add', 'move', 'remove', 'prune', 'repair'].includes(a[0])) {
    const skipValue = ['-b', '-B', '--reason'];
    const targets = [];
    for (let k = 1; k < sargs.length; k++) { if (skipValue.includes(a[k])) { k++; continue; } if (!a[k].startsWith('-')) targets.push(sargs[k]); }
    if (xargs || !eff) hit('outside');
    for (const t of targets.slice(0, a[0] === 'add' ? 1 : 2)) if (pathOutside(t, eff, st)) hit('outside');
    return;
  }
  if (sub === 'clone' || sub === 'init') {
    const CLONE_VALUE = /^(-b|--branch|--depth|-o|--origin|--reference|--reference-if-able|-c|--config|--template|-j|--jobs|--filter|--shallow-since|--shallow-exclude|-u|--upload-pack|--server-option|--bundle-uri|--separate-git-dir)$/;
    if (a.some((x) => /^--(separate-git-dir|reference|reference-if-able|template)(=|$)/.test(x))) hit('outside'); // a folder elsewhere comes into it
    const p = [];
    for (let k = 0; k < sargs.length; k++) { if (CLONE_VALUE.test(a[k])) { k++; continue; } if (!a[k].startsWith('-')) p.push(sargs[k]); }
    let dest = sub === 'clone' ? p[1] : p[0];
    if (!dest && sub === 'clone' && p[0]) dest = { t: p[0].t.replace(/[/\\]+$/, '').replace(/\.git$/, '').replace(/^.*[/:\\]/, ''), dyn: p[0].dyn };
    if (!dest) dest = { t: '.', dyn: false };
    if (!eff || pathOutside(dest, eff, st)) hit('outside');
    else if (sub === 'clone') { const at = physicalPath(dest.t, eff); if (at) st.cloneDirs.push(at); } // what it brings in is not known
    return;
  }
  // Any other git command run in another folder (git -C <elsewhere>) acts there.
  if (!GIT_READ.has(sub) && eff !== cwd && !(eff && inRoots(eff, st.roots))) hit('outside');
}

// Does this git command change which branch the worktree has checked out (or move a branch)?
function changesBranch(sub, a) {
  const positional = a.filter((x) => !x.startsWith('-'));
  if (sub === 'checkout' || sub === 'switch') return true;
  if (sub === 'branch') return a.some((x) => /^--(force|move|copy|delete)$/.test(x) || /^-[A-Za-z]*[fMmCcDd]/.test(x));
  if (sub === 'reset') return positional.some((x) => !/^(HEAD|@)([~^]\d*)*$/.test(x));
  if (sub === 'worktree') return a[0] === 'add';
  return false;
}

// Does this git push go anywhere but the fork, or to a branch that isn't the job's own?
function pushStops(sargs, eff, ctx) {
  const positional = [];
  let literal = false;
  for (let k = 0; k < sargs.length; k++) {
    const { t, dyn } = sargs[k];
    if (dyn) return true;
    if (!literal && t === '--') { literal = true; continue; }
    if (!literal && t.startsWith('--')) {
      const n = t.slice(2).split('=')[0];
      if (n.length >= 2 && PUSH_STOP_LONG.some((x) => x.startsWith(n))) return true;
      if (['push-option'].some((x) => x.startsWith(n)) && !t.includes('=')) k++;
      continue;
    }
    if (!literal && t.startsWith('-') && t !== '-') {
      if (/^-[A-Za-z]*[fd]/.test(t)) return true;
      if (t === '-o') k++;
      continue;
    }
    positional.push(t);
  }
  const remote = positional[0] ?? '';
  const refspecs = positional.slice(1);
  if (/[:/\\]|^[.~-]/.test(remote)) return true; // an address or a folder
  const fork = ctx.forkRemote || 'origin';
  const lookup = (n) => { try { return typeof ctx.remoteUrl === 'function' ? ctx.remoteUrl(n, eff) : null; } catch { return null; } };
  if (remote === fork) {
    const url = lookup(remote);
    if (!url || ORG_URL.test(url)) return true; // an address we can't read is not known to be the fork's
  } else {
    const target = lookup(remote);
    const mine = lookup(fork);
    if (!target || !mine || normUrl(target) !== normUrl(mine) || ORG_URL.test(target)) return true;
  }
  const own = (ctx.branches ?? []).filter(Boolean);
  if (!own.length) return true; // the job's branches are not known: no push is known to be its own
  // The branch a push with no refspec (or HEAD, or @) sends is the one checked out in the session's folder.
  let there = null;
  try { there = ctx.cwd && eff ? physicalPath(ctx.cwd, null) : null; } catch { there = null; }
  const hereOwn = typeof ctx.currentBranch === 'string' && own.includes(ctx.currentBranch) && Boolean(there) && isInside(eff, there);
  if (!refspecs.length && !hereOwn) return true;
  const strip = (r) => r.replace(/^refs\/heads\//, '');
  for (const r of refspecs) {
    if (r.startsWith('+') || r.startsWith(':') || /[*]/.test(r)) return true;
    const colon = r.indexOf(':');
    const src = colon < 0 ? r : r.slice(0, colon);
    const dst = colon < 0 ? null : strip(r.slice(colon + 1));
    const landing = dst ?? strip(src);
    if (colon < 0 && (src === 'HEAD' || src === '@')) { if (!hereOwn) return true; continue; }
    if (/^refs\//.test(landing)) return true; // tags and other refs
    if (PROTECTED.test(landing) || !own.includes(landing)) return true;
  }
  return false;
}

// ---------- paths ----------

// Is this path word outside the job's folders (or somewhere we can't tell)? A symlink inside the
// worktree that points out lands outside; .. that climbs out does too.
function pathOutside(word, cwd, st, strict = false) {
  if (word.t === '{}' && st.inFind) return false; // find's own results, from the folders it was checked on
  const p = physicalPath(word.t, cwd);
  if (p) st.touched.push(p);
  return !p || !inRoots(p, st.roots, strict);
}
