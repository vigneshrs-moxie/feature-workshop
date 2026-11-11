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

import path from 'node:path';

import { autoAllowed } from './auto.js';
import { classify, commandParts, isInside, TEMP_DIRS } from './policy.js';
import { hardLine, ORG_URL, physicalPath, rmInsideJob, WRAPPERS } from './hard-lines.js';
import { STAGES, STAGE_IDS } from './stages.js';

export const AUTO_STOP_REASONS = Object.freeze({
  merge: 'merging a pull request needs you.',
  database: 'a database change needs you.',
  outside: "this would change or delete something outside the job's own folders.",
  push: 'this would push somewhere other than your fork.',
  level: 'the job is now L3, and L3 jobs need you to approve each step.',
  blocked: "the Foreman says it can't do the ticket as written.",
  status: "the Foreman can't write a valid status.json.",
});

/** Tools known to only read (or to hand work to the crew, whose own calls come through the hook too). Any other tool on an Auto job asks. */
export const READ_ONLY_TOOLS = Object.freeze(new Set([
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite', 'TaskOutput', 'TaskGet', 'TaskList', 'TaskCreate', 'TaskUpdate',
  'BashOutput', 'ToolSearch', 'Skill', 'SendMessage', 'Agent', 'Task', 'AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode',
  'WebFetch', 'WebSearch', 'ListMcpResources', 'ReadMcpResource',
]));
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const stop = (rule, extra = {}) => ({ rule, reason: AUTO_STOP_REASONS[rule], ...extra });

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
  return stop('outside', { unknownTool: true });
}

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
  const st = { ctx, hits: new Set(), roots: jobRoots(ctx), work: [...(ctx.worktrees ?? []), ctx.cwd].filter(Boolean).map((d) => physicalPath(d, null)).filter(Boolean) };
  if (hard?.line === 'gh-pr-merge') st.hits.add('merge');
  if (hard?.line === 'database') st.hits.add('database');
  analyze(command, ctx.cwd ?? null, st, 0, null);
  const verdict = classify('Bash', { command }, { mode: 'hands-off', stage: 'implement', worktrees: ctx.worktrees ?? [], specDirs: ctx.specDirs ?? [], featureDir: ctx.featureDir ?? null, cwd: ctx.cwd ?? null, rules: [] });
  if (verdict.outside) st.hits.add('outside');
  const rule = PRIORITY.find((r) => st.hits.has(r));
  return rule ? stop(rule) : null;
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
    for (const part of parts) {
      const first = part.words.find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w.t))?.t;
      simple(part.words, part.redirects ?? [], lost ? null : part.cwd, st, depth, viaXargs);
      if (first === 'pushd' || first === 'popd') lost = true; // where later commands run is no longer known
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

const DB_CLIENTS = new Set(['psql', 'pgcli', 'pg_restore', 'pg_dump', 'pg_dumpall', 'createdb', 'dropdb', 'createuser', 'dropuser', 'mysql', 'mysqldump', 'mysqlsh', 'mariadb', 'mariadb-dump', 'sqlite', 'sqlite3', 'litecli', 'mongosh', 'mongo', 'mongorestore', 'mongodump', 'redis-cli', 'cqlsh', 'sqlcmd', 'sqlplus', 'usql', 'clickhouse-client', 'duckdb']);
const RUNNERS = new Set(['npx', 'bunx', 'pnpx', 'npm', 'pnpm', 'yarn', 'bun', 'dlx', 'exec', 'uvx', 'poetry', 'pipenv', 'bundle']);
const EXEC_LIKE = new Set(['docker', 'podman', 'nerdctl', 'kubectl', 'oc', 'ssh', 'heroku', 'fly', 'flyctl', 'railway', 'vercel', 'nix-shell', 'direnv', 'devbox', 'doppler', 'dotenv', 'op', 'aws', 'gcloud', 'az']);
// Programs that only print their arguments or move files about: a client's name among them is just text.
const TEXTY = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'echo', 'printf', 'cat', 'head', 'tail', 'less', 'more', 'ls', 'man', 'which', 'whereis', 'type', 'sed', 'awk', 'wc', 'stat', 'file', 'git', 'gh', 'hub', 'npm', 'pnpm', 'yarn', 'bun', 'brew', 'cp', 'mv', 'rm', 'touch', 'mkdir', 'tee', 'code', 'vim', 'nano', 'open', 'diff', 'cmp', 'basename', 'dirname', 'realpath', 'test', '[', 'read']);

function dbTool(t, rest) {
  const r = rest.filter((x) => typeof x === 'string');
  switch (t) {
    case 'prisma': return r.some((x) => x === 'migrate' || x === 'db') && true;
    case 'drizzle-kit': return r.some((x) => /^(push|migrate|drop|up)/.test(x));
    case 'supabase': return r.some((x) => x === 'db' || x === 'migration');
    case 'knex': case 'sequelize': case 'sequelize-cli': case 'typeorm': case 'alembic': case 'flyway': case 'liquibase': case 'dbmate': case 'goose': case 'sqitch': case 'atlas': case 'node-pg-migrate': case 'mikro-orm': case 'umzug': case 'migrate': case 'db-migrate':
      return r.some((x) => /migrat|db:|seed|^(up|down|upgrade|downgrade|push|reset|rollback|apply|deploy)$/i.test(x));
    case 'rails': case 'rake': case 'padrino': case 'bin/rails': case 'bin/rake': return r.some((x) => /^db(:|$)/.test(x) || x === 'dbconsole');
    case 'manage.py': case 'django-admin': return r.some((x) => /^(migrate|flush|dbshell|loaddata|sqlmigrate|sqlflush|sqlsequencereset|squashmigrations)$/.test(x));
    case 'make': case 'just': case 'task': case 'mage': return r.some((x) => /migrat|^db[:-]|^seed/i.test(x));
    default:
      if (/^python[\d.]*$/.test(t)) return r.some((x) => /manage\.py$/.test(x)) && dbTool('manage.py', r);
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
  const hit = (rule) => st.hits.add(rule);
  // Redirections: output anywhere but /dev/null and the job's folders stops; input from a .sql file is a database change.
  for (const r of redirects) {
    if (r.op === '<' || r.op === '<&' || (r.op === '>&' && /^(\d+|-)$/.test(r.target))) { if (SQL.test(r.target)) hit('database'); continue; }
    if (!r.dyn && /^\/dev\/(null|stdout|stderr|tty)$/.test(r.target)) continue;
    if (SQL.test(r.target)) hit('database');
    if (out({ t: r.target, dyn: r.dyn })) hit('outside');
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
  const writes = (targets) => { if (xargs) hit('outside'); for (const t of targets) if (out(t)) hit('outside'); };

  if (DANGEROUS.has(cmd)) hit('outside');
  if (dbCommand(cmd, args)) hit('database');
  else if (!TEXTY.has(cmd) && args.some((x) => DB_CLIENTS.has(name(x.t)))) hit('database'); // a client named under a wrapper we don't know
  if (EXEC_LIKE.has(cmd)) for (const x of args) if (/\s/.test(x.t)) analyze(x.t, cwd, st, depth + 1, null);

  if (SHELLS.has(cmd)) {
    const c = args.findIndex((x) => /^-[A-Za-z]*c$/.test(x.t));
    if (c >= 0) {
      const script = args[c + 1];
      if (!script || script.dyn) hit('outside'); else analyze(script.t, cwd, st, depth + 1, null);
    } else if (!pos().filter((x) => x.t !== '-').length || a.includes('-s')) hit('outside'); // reads its commands from a pipe or here-document
    return;
  }
  if (cmd === 'eval') { hit('outside'); analyze(a.join(' '), cwd, st, depth + 1, null); return; }
  if (cmd === 'source' || cmd === '.') { hit('outside'); return; }
  const inline = /^python[\d.]*$/.test(cmd) ? PY_INLINE : INLINE[cmd];
  if (inline || /^(python[\d.]*|node|nodejs|ruby|perl|php|deno|lua)$/.test(cmd)) {
    if (a.some((x) => inline?.test(x))) hit('outside'); // code we can't read
    else if (!pos().filter((x) => x.t !== '-').length && !a.some((x) => NO_STDIN.test(x))) hit('outside'); // code from stdin
    if (cmd === 'perl' || cmd === 'ruby') { if (a.some((x) => /^-[A-Za-z]*i/.test(x))) writes(pos()); }
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
    case 'rmdir': case 'unlink': case 'touch': case 'mkdir': case 'truncate': case 'shred': case 'mkfifo': case 'mknod': case 'tee': case 'chflags': case 'xattr': case 'split': writes(pos().filter((x) => x.t !== '-')); return;
    case 'chmod': case 'chown': case 'chgrp': {
      let skipped = false;
      const rest2 = args.filter((x) => !(x.t.startsWith('-') && /^-[A-Za-z]+$/.test(x.t) && !/^-[rwxXst]+$/.test(x.t)) && !/^--/.test(x.t));
      const targets = rest2.filter((x) => { if (!skipped && (cmd === 'chmod' ? /^([0-7]{3,4}|[ugoa]*[-+=][rwxXstugo]*(,[ugoa]*[-+=][rwxXstugo]*)*)$/.test(x.t) : true)) { skipped = true; return false; } return true; });
      writes(targets);
      return;
    }
    case 'cp': case 'install': case 'rsync': case 'ditto': case 'scp': case 'ln': {
      if (cmd === 'install' && a.includes('-d')) { writes(pos()); return; }
      const t = valueOf(/^(-t|--target-directory(=.*)?)$/);
      const p = pos().filter((x) => !(t && x === t));
      const dest = t ?? (p.length >= 2 ? p[p.length - 1] : null);
      if (!dest) { writes([{ t: '.', dyn: false }]); return; }
      if (/^[^/]*:/.test(dest.t) && !dest.t.startsWith('/')) hit('outside'); // a remote host
      writes([dest]);
      return;
    }
    case 'dd': writes(a.filter((x) => x.startsWith('of=')).map((x) => ({ t: x.slice(3), dyn: x.includes('$') }))); return;
    case 'curl': {
      const targets = [];
      for (let k = 0; k < a.length; k++) {
        if (/^(--output|--output-dir|-o|--dump-header|-D|--cookie-jar|-c|--trace|--trace-ascii|-K|--config)$/.test(a[k]) || /^-[A-Za-z]*[oDc]$/.test(a[k])) targets.push(args[k + 1] ?? { t: '', dyn: true });
        else if (/^--(output|output-dir|dump-header|cookie-jar|trace|trace-ascii)=/.test(a[k])) targets.push({ t: a[k].slice(a[k].indexOf('=') + 1), dyn: args[k].dyn });
        else if (a[k] === '--remote-name' || a[k] === '--remote-name-all' || a[k] === '-J' || /^-[A-Za-z]*O$/.test(a[k])) targets.push({ t: '.', dyn: false });
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
      }
      if (!a.some((x) => /^(-O|--output-document)/.test(x))) targets.push({ t: '.', dyn: false });
      writes(targets);
      return;
    }
    case 'tar': case 'unzip': case 'gunzip': case 'bunzip2': case 'unrar': case '7z': case '7za': writes([...pos(), { t: '.', dyn: false }]); return;
    case 'sed': case 'gsed': if (a.some((x) => /^-[A-Za-z]*i|^--in-place/.test(x))) writes(pos()); return;
    case 'awk': case 'gawk': if (a.some((x) => x === '-i' || x === '--in-place')) writes(pos()); return;
    case 'npm': case 'pnpm': case 'yarn': case 'bun': case 'npx':
      if (a.some((x) => x === '-g' || /^--(global|location=global)$/.test(x)) || a[0] === 'global' || (a[0] === 'link' && cmd === 'npm')) hit('outside');
      return;
    case 'brew': if (!BREW_READ.has(a[0] ?? '')) hit('outside'); return;
    case 'pipx': case 'gem': case 'cargo': case 'go': case 'uv': if (['install', 'tool', 'uninstall', 'upgrade'].includes(a[0]) || cmd === 'pipx') hit('outside'); return;
    case 'find': findStep(args, a, cwd, st); return;
    case 'pushd': case 'popd': return;
    default:
  }
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
    if (!['pull-request', 'ci-status', 'browse'].includes(group) && !(group === 'pr' && ['list', 'show', 'checkout'].includes(action))) hit('outside');
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
  if (!ok || !ok.includes(action)) hit('outside');
}

// ---------- git ----------

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
  const inWork = eff && st.work.some((w) => isInside(eff, w));
  if (sub === 'push' || sub === 'send-pack') {
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
    const p = sargs.filter((x) => !x.t.startsWith('-'));
    const dest = sub === 'clone' ? (p.length >= 2 ? p[1] : { t: '.', dyn: false }) : p[0] ?? { t: '.', dyn: false };
    if (!eff || pathOutside(dest, eff, st)) hit('outside');
    return;
  }
  // Any other git command run in another folder (git -C <elsewhere>) acts there.
  if (!GIT_READ.has(sub) && eff !== cwd && !(eff && inRoots(eff, st.roots))) hit('outside');
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
    if (url && ORG_URL.test(url)) return true;
  } else {
    const target = lookup(remote);
    const mine = lookup(fork);
    if (!target || !mine || normUrl(target) !== normUrl(mine) || ORG_URL.test(target)) return true;
  }
  const own = (ctx.branches ?? []).filter(Boolean);
  const strip = (r) => r.replace(/^refs\/heads\//, '');
  for (const r of refspecs) {
    if (r.startsWith('+') || r.startsWith(':') || /[*]/.test(r)) return true;
    const colon = r.indexOf(':');
    const src = colon < 0 ? r : r.slice(0, colon);
    const dst = colon < 0 ? null : strip(r.slice(colon + 1));
    const landing = dst ?? strip(src);
    if (/^refs\//.test(landing)) return true; // tags and other refs
    if (colon < 0 && src === 'HEAD') continue;
    if (PROTECTED.test(landing)) return true;
    if (own.length) { if (!own.includes(landing)) return true; } else if (dst !== null && strip(src) !== dst) return true;
  }
  return false;
}

// ---------- paths ----------

// Is this path word outside the job's folders (or somewhere we can't tell)? A symlink inside the
// worktree that points out lands outside; .. that climbs out does too.
function pathOutside(word, cwd, st, strict = false) {
  if (word.t === '{}' && st.inFind) return false; // find's own results, from the folders it was checked on
  const p = physicalPath(word.t, cwd);
  return !p || !inRoots(p, st.roots, strict);
}
