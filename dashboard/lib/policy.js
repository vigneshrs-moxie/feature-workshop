// Which tool requests are routine (handled automatically, and logged) and which need a person.
// Mirrors the workflow's own rules (workflow-gates.md): the stage go-ahead covers reading, writing the
// job's own records, and — once building is approved — edits, commits and read-only checks inside the
// job's worktree. Pushing, PRs, merges, migrations, database writes, servers, installs, deleting,
// network access and anything that writes outside the job's folders always come to the person.
// Reading is fine anywhere (the Read tool already is), so moving around with cd is too.
// When unsure, ask: anything the reader below can't follow exactly (comments, unusual expansions,
// values only known when the command runs) goes to the person. Mode 'ask-all' asks about everything.
// Mode 'auto' judges the same way as 'hands-off': in auto mode only the requests Claude Code's
// safety model couldn't decide reach the dashboard, and those go through this list as usual.
// The hard lines (lib/hard-lines.js) are checked before this, in every mode.

import os from 'node:os';
import path from 'node:path';

/** The permission settings, globally and per job. 'hands-off' is the default. */
export const POLICIES = ['hands-off', 'ask-all', 'auto'];

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'TodoWrite', 'TaskOutput', 'SendMessage', 'Agent', 'Task']);
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const BUILD_STAGES = new Set(['implement', 'test', 'review']);
const PR_STAGES = new Set(['pr1', 'pr2', 'staging-qa', 'pr3']);
const SPEC_STAGES = new Set(['spec', 'refine', 'spec-update']);
// Scratch output (check logs and the like) may go to the temp folders.
const TEMP_DIRS = [...new Set(['/tmp', '/private/tmp', os.tmpdir(), path.join('/private', os.tmpdir())])];

const inside = (p, dir) => {
  if (!p || !dir) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Read-only commands that stay harmless whatever their arguments turn out to be.
const SAFE_ANY_ARGS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'pwd', 'echo', 'date', 'which', 'cut', 'tr', 'jq', 'diff', 'cmp', 'comm', 'true', 'false', 'stat', 'du', 'basename', 'dirname', 'realpath', 'nl', 'column', 'seq', 'rev', 'shasum', 'sha256sum', 'md5', 'od', 'type']);
// Read-only commands judged by their arguments below (and only when those are written out in full).
const CHECKED_CMDS = new Set(['printf', 'test', '[', '[[', ']]', 'read', 'uniq', 'sort', 'rg', 'file', 'tree', 'awk', 'sed', 'find', 'xargs', 'cd', 'mkdir', 'git', 'gh', 'npm', 'pnpm', 'yarn', 'npx', 'node', 'timeout']);
// What xargs may run: commands that stay read-only whatever it appends.
const XARGS_OK = new Set(['cat', 'head', 'tail', 'wc', 'ls', 'grep', 'egrep', 'fgrep', 'stat', 'du', 'shasum', 'sha256sum', 'md5', 'basename', 'dirname', 'echo']);
const PREFIX_WORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', 'time']);
const CLOSING_WORDS = new Set(['done', 'fi', '}']);
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'describe', 'blame', 'merge-base', 'for-each-ref', 'shortlog', 'cat-file', 'ls-tree', 'grep', 'check-ignore', 'rev-list', 'name-rev', 'cherry', 'range-diff', 'count-objects', 'whatchanged']);
const GIT_NETWORK_READ = new Set(['fetch', 'ls-remote']);
const GIT_GLOBAL_OK = /^(--no-pager|-P|--no-optional-locks|--literal-pathspecs|--no-replace-objects)$/;
// Options that make git write somewhere or run another program; git accepts any unambiguous prefix.
const GIT_RISKY_LONG = ['upload-pack', 'receive-pack', 'exec', 'exec-path', 'open-files-in-pager', 'output', 'ext-diff', 'textconv', 'config', 'config-env'];
const GIT_BRANCH_LIST = /^(-l|--list|--show-current|--contains|--no-contains|--merged|--no-merged|--points-at)$/;
const GH_READ = { auth: ['status'], pr: ['view', 'list', 'status', 'checks', 'diff'], issue: ['view', 'list'], repo: ['view'], run: ['view', 'list'], release: ['view', 'list'] };
// Upper-case variables a command may set; anything else in capitals could change how programs start.
const SAFE_UPPER_VARS = new Set(['NO_COLOR', 'FORCE_COLOR', 'CI', 'TZ', 'LANG', 'LC_ALL', 'NODE_ENV', 'SKIP_ENV_VALIDATION', 'DEBUG', 'TERM', 'COLUMNS', 'LINES']);
const CHECK_SCRIPTS = /^(check|lint|typecheck|type-check|build|test|test:unit|format:check|lint:check)$/;
// db:* scripts that only read or rename migration files (Orbit's db:renumber checks their order).
// The one write to the org repository the Foreman may make (the user's ask, 2026-10-22: "allow the
// dashboard to create the feature branch on org repo"): creating the job's matching branch through
// GitHub's create-ref API, which fails when the branch already exists, so it can never move,
// overwrite or delete one. Pushing to the org stays refused (lib/hard-lines.js).
export const ORG_REFS_PATH = /^\/?repos\/moxie[\w.-]*\/[\w.-]+\/git\/refs(\/|$)/i;
const PROTECTED_BRANCH = /^(main|master|staging|develop|production|release([/-].*)?|HEAD)$/i;

/**
 * gh api arguments (after "api") that write to an org repo's branches: null when they don't touch
 * them; { branch, sha } for exactly one new branch from a written-out commit; 'other' for anything
 * else (updating, deleting, a protected name, options we don't read).
 */
export function orgRefWrite(args) {
  let endpoint = null;
  let method = null;
  const fields = [];
  let unknown = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    let m;
    if (a === '-X' || a === '--method') method = (args[++k] ?? '').toUpperCase();
    else if ((m = /^(?:-X|--method=)(.+)$/.exec(a))) method = m[1].toUpperCase();
    else if (['-f', '-F', '--field', '--raw-field'].includes(a)) fields.push(args[++k] ?? '');
    else if ((m = /^(?:-[fF]|--(?:raw-)?field=)(.+)$/.exec(a))) fields.push(m[1]);
    else if (['-q', '--jq', '-t', '--template'].includes(a)) k++; // only shape what's printed
    else if (['--silent', '--paginate', '-i', '--include'].includes(a) || /^--(jq|template)=/.test(a)) continue;
    else if (a.startsWith('-')) unknown = true; // --input, -H, --paginate, …
    else if (endpoint === null) endpoint = a;
  }
  if (!endpoint || !ORG_REFS_PATH.test(endpoint)) return null;
  method ??= fields.length ? 'POST' : 'GET';
  if (method === 'GET' && !fields.length && !unknown) return null;
  if (unknown || method !== 'POST' || !/\/git\/refs\/?$/.test(endpoint) || fields.length !== 2) return 'other';
  const f = Object.fromEntries(fields.map((x) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));
  const branch = /^refs\/heads\/([A-Za-z0-9._/-]+)$/.exec(f.ref ?? '')?.[1];
  if (!branch || branch.includes('..') || PROTECTED_BRANCH.test(branch) || !/^[0-9a-f]{40}$/.test(f.sha ?? '')) return 'other';
  return { branch, sha: f.sha };
}

export const NOT_DB_SCRIPT = /^db:(renumber|status|check|generate|validate|diff|lint|format)$/;
const SUB = '\u0000sub\u0000'; // stands in for a $( … ) whose own commands are judged separately
// ${name}, ${#name}, ${name:-word}, ${name%pat} and the like; not assignments, indirection, flags or @ operators.
const SIMPLE_PARAM = /^(#?[A-Za-z_][A-Za-z0-9_]*|[0-9#?$*@!-])((:?[-+?])|%{1,2}|#{1,2}|\/{1,2}|:\d+)?/;

const isWordStart = (cur) => cur === '' || /\s$/.test(cur);
// zsh ties these lower-case names to PATH, CDPATH and friends.
const ZSH_TIED = new Set(['path', 'cdpath', 'fpath', 'manpath', 'module_path', 'mailpath', 'psvar']);
const varNameOk = (name) => (/^[a-z_][a-z0-9_]*$/.test(name) && !ZSH_TIED.has(name)) || SAFE_UPPER_VARS.has(name);
// Does a long option name the user wrote ("--ou") abbreviate one of these?
const abbreviates = (arg, names) => {
  if (!arg.startsWith('--')) return false;
  const name = arg.slice(2).split('=')[0];
  return name.length >= 2 && names.some((n) => n.startsWith(name));
};

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
    if (c === '#' && (i === start || /[\s;|&(]/.test(src[i - 1]))) return -1; // a comment: not judged
    if (c === '<' && src[i + 1] === '<') return -1; // a here-document inside $( ): not judged
    if (c === "'" || c === '"') q = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

// One pass over a command line, honouring quotes. Cuts it into simple commands at ; && || | and
// newlines, each with the separator that follows it, and lifts out $( … ) contents.
// Here-documents with a quoted end word (<<'EOF') are plain text fed to the command, so their body
// is skipped and the command itself is judged; an unquoted one (<<EOF) expands $( … ) inside, so
// it isn't judged.
// Returns null for what we won't judge: comments, backticks, unquoted here-documents, here-strings,
// subshells and process substitution, $(( )) arithmetic, $'…' and $"…" quoting, unusual ${…}
// expansions, unfinished quotes and running in the background.
function scan(src) {
  const parts = [];
  const subs = [];
  let cur = '';
  let q = null;
  const heredocs = []; // end words waiting for their body, which starts on the next line
  const cut = (sep) => {
    if (cur.trim()) parts.push({ text: cur.trim(), sep });
    cur = '';
  };
  // Skip the bodies of the here-documents opened on the line that just ended; false if one never ends.
  const skipBodies = (from) => {
    let i = from;
    while (heredocs.length) {
      const { word, tabs } = heredocs.shift();
      let found = false;
      while (i < src.length) {
        const nl = src.indexOf('\n', i);
        const lineEnd = nl < 0 ? src.length : nl;
        const text = src.slice(i, lineEnd);
        i = nl < 0 ? src.length : nl + 1;
        if ((tabs ? text.replace(/^\t+/, '') : text) === word) { found = true; break; }
      }
      if (!found) return -1;
    }
    return i;
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
    if (c === '$' && (n === "'" || n === '"') && q !== '"') return null;
    if (c === '$' && n === '{') {
      const body = /^\$\{([^}]*)\}/.exec(src.slice(i))?.[1];
      if (body === undefined || !SIMPLE_PARAM.test(body)) return null;
      const m = SIMPLE_PARAM.exec(body);
      if (!m[2] && m[0].length !== body.length) return null; // something after the name we don't know
    }
    if (q === '"') { cur += c; if (c === '"') q = null; continue; }
    if (c === '#' && isWordStart(cur)) return null;
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '(' || c === ')') return null;
    if (c === '<' && n === '<') {
      const m = /^<<(-?)[ \t]*(?:'([A-Za-z0-9_.-]+)'|"([A-Za-z0-9_.-]+)")/.exec(src.slice(i));
      if (!m) return null; // here-strings and unquoted here-documents
      heredocs.push({ word: m[2] ?? m[3], tabs: m[1] === '-' });
      i += m[0].length - 1;
      continue;
    }
    if (c === ';' || c === '\n') {
      cut(';');
      if (c === '\n' && heredocs.length) {
        const next = skipBodies(i + 1);
        if (next < 0) return null;
        i = next - 1;
      }
      continue;
    }
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
  if (q || heredocs.length) return null;
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

// Words of one simple command, quotes removed, each marked `dyn` when its value is only known when
// it runs ($variables, $( … ), unquoted globs, ~user), and its redirections. null when unreadable.
function tokenize(simple) {
  const words = [];
  const redirects = [];
  let w = null;
  let dyn = false; // has $ or $( … ), or starts with ~user or =cmd
  let glob = false; // has an unquoted * ? [
  let brace = false; // has an unquoted {
  let q = null;
  let op = null;
  const add = (ch) => { w = (w ?? '') + ch; };
  const end = () => {
    if (w === null) return;
    // A lone [ or [[ is the test command, and {} with nothing to expand is literal.
    const d = dyn || (glob && !/^(\[\[?|\]\]?)$/.test(w)) || (brace && /\{[^}]*(,|\.\.)[^}]*\}/.test(w));
    if (op) { redirects.push({ op, target: w, dyn: d }); op = null; } else words.push({ t: w, dyn: d });
    w = null;
    dyn = glob = brace = false;
  };
  for (let i = 0; i < simple.length; i++) {
    const c = simple[i];
    const n = simple[i + 1];
    if (q === "'") { if (c === "'") q = null; else add(c); continue; }
    if (c === SUB[0] && simple.startsWith(SUB, i)) { add(SUB); dyn = true; i += SUB.length - 1; continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === '\\' && /["\\$`]/.test(n ?? '')) { add(n); i++; } else { if (c === '$') dyn = true; add(c); }
      continue;
    }
    if (c === '\\') {
      i++;
      if (n !== '\n' && n !== undefined) add(n);
      continue;
    }
    if (c === "'" || c === '"') { q = c; w = w ?? ''; continue; }
    if (/\s/.test(c)) { end(); continue; }
    if (c === '>' || c === '<' || (c === '&' && n === '>')) {
      // A word made only of digits right before it is the stream number, as in 2>.
      if (w !== null && /^\d+$/.test(w) && !op) { w = null; dyn = false; } else end();
      if (op) return null;
      if (c === '&') { op = simple[i + 2] === '>' ? '&>>' : '&>'; i += op.length - 1; continue; }
      op = c;
      if (c === '>' && /[>|&]/.test(n ?? '')) { op += n; i++; }
      if (c === '<' && /[&>]/.test(n ?? '')) { op += n; i++; }
      if (op.startsWith('>') && simple[i + 1] === '!') { op += '!'; i++; } // zsh's >! and >>!
      continue;
    }
    if (c === '$') dyn = true;
    if (c === '*' || c === '?' || c === '[') glob = true;
    if (c === '{') brace = true;
    if (c === '~' && w === null && !/^(~\/|~$)/.test(simple.slice(i, i + 2).replace(/\s$/, ''))) dyn = true; // ~user
    if (c === '=' && w === null && /[A-Za-z]/.test(n ?? '')) dyn = true; // zsh =cmd
    add(c);
  }
  if (q) return null;
  end();
  if (op) return null;
  return { words, redirects };
}

const expandHome = (p) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

// An absolute path for a word, or null when it depends on something we can't see. Callers pass only
// words tokenize() found literal (not dyn), so [id], * or $ left in them are plain characters
// (quoted in the command); $( … ) placeholders and ~user still count as unknown.
function resolvePath(word, cwd) {
  if (!word || word.includes(SUB)) return null;
  if (word.startsWith('~') && word !== '~' && !word.startsWith('~/')) return null;
  const p = expandHome(word);
  if (path.isAbsolute(p)) return path.resolve(p);
  return cwd ? path.resolve(cwd, p) : null;
}

// Output redirection is fine only to /dev/null, a temp folder, or inside the allowed folders.
function redirectVerdict(redirects, ctx) {
  for (const { op, target, dyn } of redirects) {
    if (op === '<' || op === '<&' || (op === '>&' && /^(\d+|-)$/.test(target))) continue;
    if (!dyn && /^\/dev\/(null|stdout|stderr)$/.test(target)) continue;
    const abs = dyn ? null : resolvePath(target, ctx.cwd);
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
    else if (a.startsWith('-')) return /^-i|^--in/.test(a) ? 'edits files in place' : `sed ${a} needs your OK`;
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
  if (/system\s*\(|(?<!\|)\|(?!\|)|\bprintf?\b[^;}]*>|getline/.test(prog)) return 'awk that runs commands or writes files';
  return 'ok';
}

function gitVerdict(rest, ctx) {
  // git [global options] <sub> …; each -C moves from the last place, as git does.
  let i = 0;
  let where = ctx.cwd;
  while (rest[i]?.startsWith('-')) {
    if (rest[i] === '-C') { where = resolvePath(rest[i + 1] ?? '', where); i += 2; continue; }
    if (!GIT_GLOBAL_OK.test(rest[i])) return `git ${rest[i]} needs your OK`;
    i++;
  }
  const sub = rest[i];
  const args = rest.slice(i + 1);
  if (args.some((a) => abbreviates(a, GIT_RISKY_LONG) || /^-O/.test(a))) return 'git that writes to a file or runs another program needs your OK';
  if (GIT_READ.has(sub)) return 'ok';
  // Network reads only towards your named remotes, never to an address made up on the spot.
  if (GIT_NETWORK_READ.has(sub)) return args.every((a) => a.startsWith('-') || /^[A-Za-z0-9._/-]+$/.test(a)) ? 'ok' : `git ${sub} to that address needs your OK`;
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
  const inWorktree = Boolean(where) && ctx.worktrees.some((d) => inside(where, d));
  if ((sub === 'add' || sub === 'commit') && BUILD_STAGES.has(ctx.stage) && inWorktree) return 'ok';
  return `git ${sub ?? ''} needs your OK`.trim();
}

// w: the words of one simple command ({ t, dyn }).
function judgeWords(w, ctx, simple) {
  w = [...w];
  while (w.length && (PREFIX_WORDS.has(w[0].t) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0].t))) {
    const name = w[0].t.split('=')[0];
    if (w[0].t.includes('=') && !PREFIX_WORDS.has(w[0].t) && !varNameOk(name)) return `changes how programs start (${name})`;
    w.shift();
  }
  if (!w.length || CLOSING_WORDS.has(w[0].t)) return 'ok';
  const words = w.map((x) => x.t);
  const [cmd, ...rest] = words;
  const dynArgs = w.slice(1).some((x) => x.dyn);
  if (w[0].dyn) return 'runs a command chosen while it runs';
  // A for loop's list is only data, but the loop variable must not be one programs read.
  if (cmd === 'for') return varNameOk(rest[0] ?? '') ? 'ok' : `a loop that sets ${rest[0]} needs your OK`;
  if (SAFE_ANY_ARGS.has(cmd)) return 'ok';
  if (!CHECKED_CMDS.has(cmd)) return `${cmd} needs your OK`;
  if (cmd === 'cd') return 'ok'; // where it goes is followed in classify()
  // From here on the arguments matter, so they must be written out in full.
  if (dynArgs && !['printf', 'test', '['].includes(cmd)) return `${cmd} with values only known when it runs needs your OK`;
  if (cmd === 'printf') {
    const v = rest.indexOf('-v');
    return v < 0 || varNameOk(rest[v + 1] ?? '') ? 'ok' : 'printf that sets a variable programs read needs your OK';
  }
  if (cmd === 'test' || cmd === '[') return rest.includes('-v') ? 'test -v needs your OK' : 'ok';
  if (cmd === '[[' || cmd === ']]') return 'ok';
  if (cmd === 'read') return rest.filter((a) => !a.startsWith('-')).every(varNameOk) && !rest.some((a) => /^-[a-zA-Z]*[aA]/.test(a)) ? 'ok' : 'read into a variable programs read needs your OK';
  if (cmd === 'timeout') return rest.length > 1 && /^\d+[smhd]?$/.test(rest[0]) ? judgeWords(w.slice(2), ctx, simple) : 'timeout needs your OK';
  if (cmd === 'uniq') return rest.filter((a) => !a.startsWith('-')).length <= 1 ? 'ok' : 'uniq writing to a file needs your OK';
  if (cmd === 'mkdir') {
    const dirs = rest.filter((a) => !a.startsWith('-'));
    return dirs.length && dirs.every((a) => { const abs = resolvePath(a, ctx.cwd); return abs && ctx.writableDirs.some((d) => inside(abs, d)); }) ? 'ok' : 'creates a folder outside the job’s folders';
  }
  if (cmd === 'sed') return sedVerdict(rest);
  if (cmd === 'awk') return awkVerdict(rest);
  if (cmd === 'find') return rest.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(a)) ? 'find that deletes, writes or runs commands' : 'ok';
  if (cmd === 'sort') return rest.some((a) => /^-[^-]*[oT]/.test(a) || abbreviates(a, ['output', 'compress-program', 'temporary-directory', 'random-source'])) ? 'sort writing to a file needs your OK' : 'ok';
  if (cmd === 'rg') return rest.some((a) => abbreviates(a, ['pre', 'pre-glob', 'search-zip'])) ? 'rg that runs another program needs your OK' : 'ok';
  if (cmd === 'file') return rest.some((a) => /^-[a-zA-Z]*C/.test(a) || abbreviates(a, ['compile'])) ? 'file writing a file needs your OK' : 'ok';
  if (cmd === 'tree') return rest.some((a) => a === '-o' || a.startsWith('-o')) ? 'tree writing to a file needs your OK' : 'ok';
  if (cmd === 'xargs') {
    // xargs <options> <command>: what it appends from its input is unknown, so only commands that
    // stay read-only whatever their arguments are allowed.
    let i = 0;
    while (rest[i]?.startsWith('-')) i += /^-[nIPLsdEJRS]$/.test(rest[i]) ? 2 : 1;
    const run = rest[i] ?? 'echo';
    return XARGS_OK.has(run) ? 'ok' : `xargs ${run} needs your OK`;
  }
  if (cmd === 'git') return gitVerdict(rest, ctx);
  if (cmd === 'gh') {
    if (rest.some((a) => a === '--show-token' || a === '-t')) return 'gh showing your token needs your OK';
    if (rest[0] === 'api') {
      const write = orgRefWrite(rest.slice(1));
      if (write && write !== 'other' && (BUILD_STAGES.has(ctx.stage) || PR_STAGES.has(ctx.stage))) return 'ok';
    }
    const args = rest.filter((a, k) => !(a.startsWith('-') || ['-R', '--repo'].includes(rest[k - 1])));
    return GH_READ[args[0]]?.includes(args[1]) ? 'ok' : `gh ${args.slice(0, 2).join(' ')} needs your OK`.trim();
  }
  if ((cmd === 'npm' || cmd === 'pnpm' || cmd === 'yarn') && BUILD_STAGES.has(ctx.stage)) {
    const script = rest[0] === 'run' ? rest[1] : rest[0];
    if (rest[0] === 'test' || (rest[0] === 'run' && CHECK_SCRIPTS.test(script ?? ''))) return /db|e2e|integration|migrat/i.test(simple) ? 'touches a database or runs end-to-end tests' : 'ok';
    // Scripts named db:* that never touch a database: they read or rename migration files in the worktree.
    if (rest[0] === 'run' && NOT_DB_SCRIPT.test(script ?? '')) return 'ok';
    return `${cmd} ${rest[0] ?? ''} needs your OK`.trim();
  }
  if (cmd === 'npx' && BUILD_STAGES.has(ctx.stage) && /^(tsc|vitest|eslint|prettier|jest)$/.test(rest[0] ?? '') && !rest.includes('--write') && !rest.includes('--fix')) return 'ok';
  if (cmd === 'node' && rest[0] === '--test' && BUILD_STAGES.has(ctx.stage)) return 'ok';
  return `${cmd} needs your OK`;
}

// Where a cd goes (absolute), null when unknown; undefined when the command isn't a cd.
function cdTarget(words, cwd) {
  const w = words.filter((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x.t) || x.t === '!');
  if (w[0]?.t === '!' && w[1]?.t === 'cd') return null; // a negated cd may have failed
  const at = w.findIndex((x) => !PREFIX_WORDS.has(x.t));
  if (w[at]?.t !== 'cd') return undefined;
  if (w.slice(0, at).some((x) => x.t === '!')) return null;
  let args = w.slice(at + 1);
  while (args[0] && /^-[LPe@]+$/.test(args[0].t)) args = args.slice(1);
  if (args[0]?.t === '--') args = args.slice(1);
  if (!args.length) return os.homedir();
  if (args.length > 1 || args[0].dyn || args[0].t === '-') return null;
  const to = args[0].t;
  // A plain name may be found through CDPATH; only ., .., ~ and absolute paths are certain.
  if (!/^(\/|\.\.?(\/|$)|~(\/|$))/.test(to)) return null;
  return resolvePath(to, cwd);
}

/**
 * The simple commands of a command line, each with the folder it runs in (absolute, or null when
 * unknown) and its words ({ t, dyn }), following cd the way classify() does. Commands inside $( … )
 * come last, in an unknown folder. null when the line can't be read.
 * lib/hard-lines.js uses it to see exactly what an rm -rf would delete.
 */
export function commandParts(cmd, cwd = null) {
  const parsed = parseCommand(cmd);
  if (!parsed) return null;
  const out = [];
  let here = cwd;
  let chainOk = true;
  let moved = false;
  for (const part of parsed.parts) {
    const t = tokenize(part.text);
    if (!t) return null;
    out.push({ text: part.text, cwd: here, words: t.words });
    const to = cdTarget(t.words, here);
    if (to !== undefined) { here = chainOk && part.sep === '&&' ? to : null; moved = true; }
    if (part.sep !== '&&') {
      if (moved) here = null;
      chainOk = part.sep === ';' || part.sep === null;
    }
  }
  for (const part of parsed.subs) {
    const t = tokenize(part.text);
    if (!t) return null;
    out.push({ text: part.text, cwd: null, words: t.words });
  }
  return out;
}

export { inside as isInside, resolvePath, TEMP_DIRS };

// ---------- Your saved "Always allow" rules (lib/rules.js keeps the list) ----------
// A rule only ever allows what it describes, never more:
//   Bash 'exact'   the command, character for character (spaces at the ends aside).
//   Bash 'prefix'  one simple command whose words start with the rule's words, word for word. It
//                  must be a single command (no ; && || | or $( … )), every word written out (no
//                  $variables or globs), no here-document or input from a file, and its output may
//                  only go to /dev/null or another stream. So "npm run test:db" covers
//                  "npm run test:db -- --grep x" but not "npm run test:dbx", nor
//                  "npm run test:db && rm -rf ~".
//   Edit tools     'exact' one file; 'prefix' any file inside one folder (.. can't climb out).
//   WebFetch       'domain' pages on exactly that host name (not its subdomains).
//   mcp__…         'tool' that one connection tool.

const OK_REDIRECT = (r) => (r.op === '>&' && /^(\d+|-)$/.test(r.target)) || (!r.dyn && /^>{1,2}$|^&>{1,2}$/.test(r.op) && r.target === '/dev/null');

/** The words of a command made of one simple, fully written-out command; null for anything else. */
export function simpleCommandWords(cmd) {
  const src = String(cmd ?? '').trim();
  if (!src || src.includes('\n') || src.includes('<<')) return null;
  const parsed = parseCommand(src);
  if (!parsed || parsed.parts.length !== 1 || parsed.subs.length) return null;
  const t = tokenize(parsed.parts[0].text);
  if (!t || !t.words.length || t.words.some((w) => w.dyn) || !t.redirects.every(OK_REDIRECT)) return null;
  return t.words.map((w) => w.t);
}

export const RULE_EDIT_TOOLS = EDIT_TOOLS;

/** Does this one saved rule cover this request? */
export function matchRule(rule, toolName, input = {}) {
  if (!rule || rule.tool !== toolName) return false;
  if (toolName === 'Bash') {
    const cmd = String(input.command ?? '').trim();
    if (!cmd) return false;
    if (rule.kind === 'exact') return cmd === String(rule.value).trim();
    if (rule.kind !== 'prefix') return false;
    const want = simpleCommandWords(rule.value);
    const got = simpleCommandWords(cmd);
    return Boolean(want && got && got.length >= want.length && want.every((w, i) => got[i] === w));
  }
  if (EDIT_TOOLS.has(toolName)) {
    const file = input.file_path ?? input.notebook_path;
    if (typeof file !== 'string' || !path.isAbsolute(file) || !path.isAbsolute(String(rule.value))) return false;
    if (rule.kind === 'exact') return path.resolve(file) === path.resolve(rule.value);
    if (rule.kind === 'prefix') return inside(file, rule.value) && path.resolve(file) !== path.resolve(rule.value);
    return false;
  }
  if (toolName === 'WebFetch') {
    if (rule.kind !== 'domain') return false;
    try {
      const u = new URL(String(input.url ?? ''));
      return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.toLowerCase() === String(rule.value).toLowerCase();
    } catch { return false; }
  }
  if (String(toolName).startsWith('mcp__')) return rule.kind === 'tool';
  return false;
}

/**
 * toolName, input: the request. ctx: { mode, stage, featureDir, worktrees[], repoPath, specDirs[], cwd, defaultToNo, rules[] }
 * Returns { auto: boolean, reason, rule? } (rule: the id of the saved rule that allowed it).
 * Saved rules count only where the dashboard would otherwise ask: never in "ask about everything",
 * never for a step Claude Code flagged as risky, and never for questions.
 */
export function classify(toolName, input = {}, ctx = {}) {
  if (ctx.mode === 'ask-all') return { auto: false, reason: 'You asked to approve every step.' };
  if (ctx.defaultToNo) return { auto: false, reason: 'Claude Code flagged this one as risky.' };
  if (toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') return { auto: false, reason: 'A question for you.' };
  const verdict = classifyRoutine(toolName, input, ctx);
  if (verdict.auto) return verdict;
  const rule = (ctx.rules ?? []).find((r) => matchRule(r, toolName, input));
  return rule ? { auto: true, reason: `Your saved rule: ${rule.label ?? rule.value}.`, rule: rule.id } : verdict;
}

function classifyRoutine(toolName, input, ctx) {
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
    // A cd counts for the commands joined to it by && when it starts its list (or follows only
    // &&): then they run only if it worked. After ; || or | it may have been skipped or failed,
    // so where later commands run is unknown.
    let cwd = ctx.cwd ?? null;
    let chainOk = true;
    let moved = false;
    for (const part of parsed.parts) {
      const t = tokenize(part.text);
      if (!t) return { auto: false, reason: 'A complex command; please check it.' };
      const local = { ...base, cwd };
      for (const verdict of [redirectVerdict(t.redirects, local), judgeWords(t.words, local, part.text)]) {
        if (verdict !== 'ok') return say(verdict);
      }
      const to = cdTarget(t.words, cwd);
      if (to !== undefined) { cwd = chainOk && part.sep === '&&' ? to : null; moved = true; }
      if (part.sep !== '&&') {
        if (moved) cwd = null;
        chainOk = part.sep === ';' || part.sep === null; // a new list starts after ; or a newline
      }
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
