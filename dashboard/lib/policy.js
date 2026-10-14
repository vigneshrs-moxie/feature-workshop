// Which tool requests are routine (handled automatically, and logged) and which need a person.
// Mirrors the workflow's own rules (workflow-gates.md): the stage go-ahead covers reading, writing the
// job's own records, and — once building is approved — edits, commits and read-only checks inside the
// job's worktree. Pushing, PRs, merges, migrations, database writes, servers, installs, deleting,
// network access and anything that writes outside the job's folders always come to the person.
// Reading is fine anywhere (the Read tool already is), so moving around with cd is too.
// When unsure, ask. Mode 'ask-all' asks about everything.

import os from 'node:os';
import path from 'node:path';

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'TodoWrite', 'TaskOutput', 'SendMessage', 'Agent', 'Task']);
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const BUILD_STAGES = new Set(['implement', 'test', 'review']);
const SPEC_STAGES = new Set(['spec', 'refine', 'spec-update']);
// Scratch output (check logs and the like) may go to the temp folders.
const TEMP_DIRS = [...new Set(['/tmp', '/private/tmp', os.tmpdir(), path.join('/private', os.tmpdir())])];

const inside = (p, dir) => {
  if (!p || !dir) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Read-only shell commands (first word), plus a few harmless helpers. Words that only shape a
// command (if, for, do, done …) are read past; what they wrap is judged on its own.
const READONLY_CMDS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'pwd', 'echo', 'printf', 'date', 'which', 'sort', 'uniq', 'cut', 'tr', 'jq', 'diff', 'cmp', 'comm', 'test', '[', '[[', ']]', 'true', 'false', 'file', 'stat', 'du', 'basename', 'dirname', 'realpath', 'tree', 'nl', 'column', 'awk', 'sed', 'find', 'xargs', 'seq', 'rev', 'shasum', 'sha256sum', 'md5', 'od', 'read', 'type', 'cd']);
const PREFIX_WORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', 'time']);
const CLOSING_WORDS = new Set(['done', 'fi', '}']);
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'describe', 'blame', 'merge-base', 'for-each-ref', 'shortlog', 'cat-file', 'ls-tree', 'grep', 'fetch', 'check-ignore', 'ls-remote', 'rev-list', 'name-rev', 'cherry', 'range-diff', 'count-objects', 'whatchanged']);
const GIT_BRANCH_LIST = /^(-l|--list|--show-current|--contains|--no-contains|--merged|--no-merged|--points-at)$/;
const GH_READ = { auth: ['status'], pr: ['view', 'list', 'status', 'checks', 'diff'], issue: ['view', 'list'], repo: ['view'], run: ['view', 'list'], release: ['view', 'list'] };
// Variables that change which program runs or what it loads; setting them always asks.
const RISKY_ENV = /^(PATH|BASH_ENV|ENV|SHELL|PAGER|GIT_[A-Z_]*|LD_[A-Z_]*|DYLD_[A-Z_]*|NODE_OPTIONS|NODE_PATH|EDITOR|VISUAL|PYTHON[A-Z_]*|PERL[A-Z0-9_]*|RUBY[A-Z_]*|npm_config_[a-z_]*|PROMPT_COMMAND|IFS)=/i;
const CHECK_SCRIPTS = /^(check|lint|typecheck|type-check|build|test|test:unit|format:check|lint:check)$/;
const SUB = '\u0000sub\u0000'; // stands in for a $( … ) whose own commands are judged separately

// Index of the ")" closing a "$(" whose contents start at `start`; -1 when it can't be read safely.
function closeParen(src, start) {
  let depth = 1;
  let q = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (q === "'") { if (c === "'") q = null; continue; }
    if (c === '\\') { i++; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === '$' && src[i + 1] === '(') return -1; // nested inside quotes: not judged
      continue;
    }
    if (c === "'" || c === '"') q = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

// One pass over a command line, honouring quotes. Cuts it into simple commands at ; && || | and
// newlines, each with the separator that follows it, and lifts out $( … ) contents.
// Returns null for what we won't judge: backticks, here-documents, subshells and process
// substitution, $(( )) arithmetic, unfinished quotes and running in the background.
function scan(src) {
  const parts = [];
  const subs = [];
  let cur = '';
  let q = null;
  const cut = (sep) => {
    if (cur.trim()) parts.push({ text: cur.trim(), sep });
    cur = '';
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (q === "'") { cur += c; if (c === "'") q = null; continue; }
    if (c === '\\') { cur += c + (n ?? ''); i++; continue; }
    if (c === '`') return null;
    if (c === '$' && n === '(') {
      if (src[i + 2] === '(') return null;
      const end = closeParen(src, i + 2);
      if (end < 0) return null;
      subs.push(src.slice(i + 2, end));
      cur += SUB;
      i = end;
      continue;
    }
    if (q === '"') { cur += c; if (c === '"') q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '(' || c === ')') return null;
    if (c === '<' && n === '<') return null;
    if (c === ';' || c === '\n') { cut(';'); continue; }
    if (c === '|') {
      if (n === '|') { cut('||'); i++; } else { cut('|'); if (n === '&') i++; }
      continue;
    }
    if (c === '&') {
      if (n === '&') { cut('&&'); i++; continue; }
      if (n === '>' || src[i - 1] === '>' || src[i - 1] === '<') { cur += c; continue; } // &> and 2>&1
      return null;
    }
    cur += c;
  }
  if (q) return null;
  cut(null);
  return { parts, subs };
}

// The simple commands of a command line, including those inside $( … ); null when it can't be judged.
function parseCommand(cmd, depth = 0) {
  if (depth > 4) return null;
  const top = scan(String(cmd ?? '').trim());
  if (!top || !top.parts.length) return null;
  const subs = [];
  for (const s of top.subs) {
    const inner = parseCommand(s, depth + 1);
    if (!inner) return null;
    subs.push(...inner.parts, ...inner.subs);
  }
  return { parts: top.parts, subs };
}

// Split a shell command into simple commands (those inside $( … ) come after the rest).
// Returns null when it uses features we won't judge automatically.
export function splitCommand(cmd) {
  const parsed = parseCommand(cmd);
  return parsed ? [...parsed.parts, ...parsed.subs].map((p) => p.text) : null;
}

// Words (quotes removed) and redirections of one simple command; null when it can't be read cleanly.
function tokenize(simple) {
  const words = [];
  const redirects = [];
  let w = null;
  let q = null;
  let op = null;
  const end = () => {
    if (w === null) return;
    if (op) { redirects.push({ op, target: w }); op = null; } else words.push(w);
    w = null;
  };
  for (let i = 0; i < simple.length; i++) {
    const c = simple[i];
    const n = simple[i + 1];
    if (q === "'") { if (c === "'") q = null; else w += c; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === '\\' && /["\\$`]/.test(n ?? '')) { w += n; i++; } else w += c;
      continue;
    }
    if (c === '\\') {
      i++;
      if (n !== '\n' && n !== undefined) w = (w ?? '') + n;
      continue;
    }
    if (c === "'" || c === '"') { q = c; w = w ?? ''; continue; }
    if (/\s/.test(c)) { end(); continue; }
    if (c === '>' || c === '<' || (c === '&' && n === '>')) {
      // A word made only of digits right before it is the stream number, as in 2>.
      if (w !== null && /^\d+$/.test(w) && !op) w = null; else end();
      if (op) return null;
      if (c === '&') { op = simple[i + 2] === '>' ? '&>>' : '&>'; i += op.length - 1; continue; }
      op = c;
      if (c === '>' && /[>|&]/.test(n ?? '')) { op += n; i++; }
      if (c === '<' && /[&>]/.test(n ?? '')) { op += n; i++; }
      continue;
    }
    w = (w ?? '') + c;
  }
  if (q) return null;
  end();
  if (op) return null;
  return { words, redirects };
}

const expandHome = (p) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

// An absolute path for a word, or null when it depends on something we can't see.
function resolvePath(word, cwd) {
  if (!word || word.includes(SUB) || word.includes('$') || /[*?]/.test(word)) return null;
  const p = expandHome(word);
  if (path.isAbsolute(p)) return path.resolve(p);
  return cwd ? path.resolve(cwd, p) : null;
}

// Output redirection is fine only to /dev/null, a temp folder, or inside the allowed folders.
function redirectVerdict(redirects, ctx) {
  for (const { op, target } of redirects) {
    if ((op === '<' || op === '<&') || ((op === '>&' || op === '<&') && /^(\d+|-)$/.test(target))) continue;
    if (/^\/dev\/(null|stdout|stderr)$/.test(target)) continue;
    const abs = resolvePath(target, ctx.cwd);
    if (!abs || ![...ctx.writableDirs, ...TEMP_DIRS].some((d) => inside(abs, d))) return 'writes output somewhere outside the job’s folders';
  }
  return 'ok';
}

// sed is fine when it only prints or rewrites what it streams: no in-place edits, script files,
// or the commands that write files (w) or run commands (e).
function sedVerdict(args) {
  const scripts = [];
  let explicit = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-e' || a === '--expression') { scripts.push(args[++i] ?? ''); explicit = true; } else if (/^-[nEr]+$/.test(a) || a === '--quiet' || a === '-u') continue;
    else if (a.startsWith('-')) return /^-i|--in-place/.test(a) ? 'edits files in place' : `sed ${a} needs your OK`;
    else if (!explicit && !scripts.length) scripts.push(a);
  }
  for (const s of scripts) {
    let rest = s.replace(/s(.)((?:\\.|(?!\1).)*)\1((?:\\.|(?!\1).)*)\1([a-zA-Z0-9]*)/g, (m, d, a, b, flags) => (/[we]/.test(flags) ? ' \u0001 ' : ' s '));
    rest = rest.replace(/\/(?:\\.|[^/])*\//g, ' ');
    if (/[\u0001weW]/.test(rest)) return 'sed that writes files or runs commands';
  }
  return 'ok';
}

// awk is fine unless it pipes to a command, writes with print >, or calls system().
function awkVerdict(args) {
  let prog = '';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-f' || a.startsWith('-f') || a === '--file') return 'awk program from a file needs your OK';
    if (a === '-F' || a === '-v') i++;
    else if (!a.startsWith('-')) { prog = a; break; }
  }
  if (/system\s*\(|(?<!\|)\|(?!\|)|\bprintf?\b[^;}]*>/.test(prog)) return 'awk that runs commands or writes files';
  return 'ok';
}

function gitVerdict(rest, ctx) {
  // git -C <dir> <sub> …
  let i = 0;
  let dirArg = null;
  while (rest[i]?.startsWith('-')) {
    // -c and --exec-path can make git run other programs.
    if (rest[i] === '-c' || rest[i].startsWith('--exec-path') || rest[i].startsWith('--config-env')) return 'git with its settings overridden needs your OK';
    if (rest[i] === '-C') dirArg = rest[i + 1];
    i += rest[i] === '-C' ? 2 : 1;
  }
  const sub = rest[i];
  const args = rest.slice(i + 1);
  if (args.some((a) => a.startsWith('--output'))) return 'git writing to a file needs your OK';
  if (args.some((a) => /^--(upload-pack|receive-pack|exec)\b|^--open-files-in-pager|^-O/.test(a))) return 'git that runs another program needs your OK';
  if (GIT_READ.has(sub)) return 'ok';
  if (sub === 'remote' && (!args.length || args.every((a) => a === '-v' || a === '--verbose') || ['show', 'get-url'].includes(args[0]))) return 'ok';
  if (sub === 'reflog' && !['expire', 'delete'].includes(args[0])) return 'ok';
  if (sub === 'stash' && ['list', 'show'].includes(args[0])) return 'ok';
  if (sub === 'config' && args.some((a) => /^(--get|--get-all|--get-regexp|--list|-l)$/.test(a))) return 'ok';
  if (sub === 'branch') {
    if (args.some((a) => /^-(d|D|m|M|c|C|f)$|^--(delete|move|copy|force|set-upstream-to|unset-upstream|edit-description)/.test(a))) return 'git branch needs your OK';
    if (args.some((a) => GIT_BRANCH_LIST.test(a)) || args.every((a) => a.startsWith('-'))) return 'ok';
    return 'creates or renames a branch';
  }
  if (sub === 'worktree' && args[0] === 'list') return 'ok';
  if (sub === 'worktree' && args[0] === 'add' && (ctx.stage === 'plan' || BUILD_STAGES.has(ctx.stage))) return 'ok';
  const where = dirArg ? resolvePath(dirArg, ctx.cwd) : ctx.cwd;
  const inWorktree = Boolean(where) && ctx.worktrees.some((d) => inside(where, d));
  if ((sub === 'add' || sub === 'commit') && BUILD_STAGES.has(ctx.stage) && inWorktree) return 'ok';
  return `git ${sub ?? ''} needs your OK`.trim();
}

function judgeWords(w, ctx, simple) {
  w = [...w];
  while (w.length && (PREFIX_WORDS.has(w[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) {
    if (RISKY_ENV.test(w[0])) return 'changes how programs start (' + w[0].split('=')[0] + ')';
    w.shift();
  }
  if (!w.length || CLOSING_WORDS.has(w[0]) || w[0] === 'for') return 'ok'; // a for loop's list is only data
  const [cmd, ...rest] = w;
  if (cmd.includes(SUB)) return 'runs a command chosen while it runs';
  if (cmd === 'timeout' && rest.length > 1) return judgeWords(rest.slice(1), ctx, simple);
  if (cmd === 'mkdir') {
    const dirs = rest.filter((a) => !a.startsWith('-'));
    return dirs.every((a) => { const abs = resolvePath(a, ctx.cwd); return abs && ctx.writableDirs.some((d) => inside(abs, d)); }) ? 'ok' : 'creates a folder outside the job’s folders';
  }
  if (cmd === 'sed') return sedVerdict(rest);
  if (cmd === 'awk') return awkVerdict(rest);
  if (cmd === 'find' && rest.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(a))) return 'find that deletes, writes or runs commands';
  if (cmd === 'sort' && rest.some((a) => /^-o|^--output|^--compress-program/.test(a))) return 'sort writing to a file needs your OK';
  if (cmd === 'rg' && rest.some((a) => /^--pre\b/.test(a))) return 'rg that runs another program needs your OK';
  if (cmd === 'file' && rest.some((a) => /^-[a-zA-Z]*C/.test(a))) return 'file writing a file needs your OK';
  if (cmd === 'tree' && rest.includes('-o')) return 'tree writing to a file needs your OK';
  if (cmd === 'xargs') {
    // xargs <options> <command>: the command it runs is what counts.
    let i = 0;
    while (rest[i]?.startsWith('-')) i += /^-[nIPLsdEJRS]$/.test(rest[i]) ? 2 : 1;
    return rest.length > i ? judgeWords(rest.slice(i), ctx, rest.slice(i).join(' ')) : 'ok';
  }
  if (READONLY_CMDS.has(cmd)) return 'ok';
  if (cmd === 'git') return gitVerdict(rest, ctx);
  if (cmd === 'gh') {
    const args = rest.filter((a, k) => !(a.startsWith('-') || ['-R', '--repo'].includes(rest[k - 1])));
    if (rest.some((a) => a === '--show-token' || a === '-t')) return 'gh showing your token needs your OK';
    return GH_READ[args[0]]?.includes(args[1]) ? 'ok' : `gh ${args.slice(0, 2).join(' ')} needs your OK`.trim();
  }
  if ((cmd === 'npm' || cmd === 'pnpm' || cmd === 'yarn') && BUILD_STAGES.has(ctx.stage)) {
    const script = rest[0] === 'run' ? rest[1] : rest[0];
    if (rest[0] === 'test' || (rest[0] === 'run' && CHECK_SCRIPTS.test(script ?? ''))) return /db|e2e|integration|migrat/i.test(simple) ? 'touches a database or runs end-to-end tests' : 'ok';
    return `${cmd} ${rest[0] ?? ''} needs your OK`.trim();
  }
  if (cmd === 'npx' && BUILD_STAGES.has(ctx.stage) && /^(tsc|vitest|eslint|prettier|jest)$/.test(rest[0] ?? '') && !rest.includes('--write') && !rest.includes('--fix')) return 'ok';
  if (cmd === 'node' && rest[0] === '--test' && BUILD_STAGES.has(ctx.stage)) return 'ok';
  return `${cmd} needs your OK`;
}

// Where a cd goes (absolute), null when unknown; undefined when the command isn't a cd.
function cdTarget(words, cwd) {
  const w = words.filter((x) => !PREFIX_WORDS.has(x));
  if (w[0] !== 'cd') return undefined;
  const to = w.slice(1).find((a) => !/^-[LPe@]+$/.test(a));
  if (!to) return os.homedir();
  return to === '-' ? null : resolvePath(to, cwd);
}

/**
 * toolName, input: the request. ctx: { mode, stage, featureDir, worktrees[], repoPath, specDirs[], cwd, defaultToNo }
 * Returns { auto: boolean, reason }.
 */
export function classify(toolName, input = {}, ctx = {}) {
  if (ctx.mode === 'ask-all') return { auto: false, reason: 'You asked to approve every step.' };
  if (ctx.defaultToNo) return { auto: false, reason: 'Claude Code flagged this one as risky.' };
  if (toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') return { auto: false, reason: 'A question for you.' };
  if (READ_TOOLS.has(toolName)) return { auto: true, reason: toolName === 'Agent' || toolName === 'Task' ? 'The Foreman handing work to its crew.' : 'Reading only.' };
  if (String(toolName).startsWith('mcp__') || toolName === 'WebFetch' || toolName === 'WebSearch') return { auto: false, reason: 'Reaches outside your computer.' };

  const worktrees = (ctx.worktrees ?? []).filter(Boolean);
  const specDirs = (ctx.specDirs ?? []).filter(Boolean);
  const writableDirs = [ctx.featureDir, ...(BUILD_STAGES.has(ctx.stage) ? worktrees : []), ...(SPEC_STAGES.has(ctx.stage) ? specDirs : [])].filter(Boolean);

  if (EDIT_TOOLS.has(toolName)) {
    const file = input.file_path ?? input.notebook_path;
    if (!file) return { auto: false, reason: 'No file named.' };
    if (inside(file, ctx.featureDir)) return { auto: true, reason: 'Updating the job’s own records.' };
    if (BUILD_STAGES.has(ctx.stage) && worktrees.some((d) => inside(file, d))) return { auto: true, reason: 'Building in the job’s own worktree (you approved the plan).' };
    if (SPEC_STAGES.has(ctx.stage) && specDirs.some((d) => inside(file, d))) return { auto: true, reason: 'Writing the spec.' };
    return { auto: false, reason: 'Changes a file outside the job’s own folders.' };
  }

  if (toolName === 'Bash') {
    const parsed = parseCommand(input.command);
    if (!parsed) return { auto: false, reason: 'A complex command; please check it.' };
    const say = (verdict) => ({ auto: false, reason: verdict[0].toUpperCase() + verdict.slice(1) + '.' });
    const base = { ...ctx, worktrees, writableDirs };
    // Follow cd through && only: after ; || or | a failed cd would leave us somewhere else.
    let cwd = ctx.cwd ?? null;
    let moved = false;
    for (const part of parsed.parts) {
      const t = tokenize(part.text);
      if (!t) return { auto: false, reason: 'A complex command; please check it.' };
      const local = { ...base, cwd };
      for (const verdict of [redirectVerdict(t.redirects, local), judgeWords(t.words, local, part.text)]) {
        if (verdict !== 'ok') return say(verdict);
      }
      const to = cdTarget(t.words, cwd);
      if (to !== undefined) { cwd = part.sep === '&&' ? to : null; moved = true; } else if (moved && part.sep !== '&&') cwd = null;
    }
    // Commands inside $( … ) run before their line; judge them where we can't be sure where that is.
    for (const part of parsed.subs) {
      const t = tokenize(part.text);
      if (!t) return { auto: false, reason: 'A complex command; please check it.' };
      const local = { ...base, cwd: null };
      for (const verdict of [redirectVerdict(t.redirects, local), judgeWords(t.words, local, part.text)]) {
        if (verdict !== 'ok') return say(verdict);
      }
    }
    return { auto: true, reason: 'A routine, safe command.' };
  }
  return { auto: false, reason: 'Not on the routine list.' };
}
