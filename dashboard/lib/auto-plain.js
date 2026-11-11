// What "plain" means for an Auto job (see auto-rules.js): a Bash call is plain when its shape is plain and every
// simple command in it is plain. Anything else is not understood, and the call asks the person.
//
// The shape: commands joined only by && || ; | and newlines; redirects only 2>&1, to /dev/null or to a literal path
// inside the job's folders; no $, backtick, <( or >(, no unquoted brace, no here-document (but the commit message
// form below), no comment, backslash, subshell or background command, no NAME=value in front of a command but the
// few harmless names. Words are read by this file's own small reader, so a spelling it does not know asks.
//
// A simple command: its program is in PROGRAMS below, and every flag it carries is in that program's list by exact
// name. A flag that is not listed, a bundled short flag with a letter that is not listed, or a subcommand that is not
// listed, asks. When unsure whether a flag is safe it is left out of the list: the call then asks, which is safe.
//
// plainWhy(command, env) returns null (plain) or a short phrase saying what could not be understood.
// env = { cwd, roots[], ctx }: the folder the command runs in and the job's folders.

import fs from 'node:fs';
import path from 'node:path';

import { githubOwner, isInside, pathCandidates, prCreateProblem } from './policy.js';
import { namesThisComputer, physicalPath } from './hard-lines.js';

const inRoots = (p, roots, strict = false) => Boolean(p) && roots.some((r) => isInside(p, r) && !(strict && p === r));
const ALLOWED_ASSIGN = new Set(['NODE_ENV', 'CI', 'FORCE_COLOR', 'NO_COLOR', 'TZ', 'LANG', 'LC_ALL']);
const KEYWORDS = new Set(['if', 'elif', 'while', 'until', 'then', 'else', 'do', '!']);
const HEREDOC = '__HEREDOC__';
const SECRET_NAME = /^(\.env(\..*)?|id_rsa.*|id_ed25519.*|.*\.(pem|key|p12))$/i;


class Ask extends Error {}
const ask = (why) => { throw new Ask(why); };

// ---------- the reader ----------

// "$(cat <<'EOF' … EOF)" with a quoted delimiter expands nothing: the commit message form. The body is replaced by a
// literal word (and may be used only as a git commit message). A body holding a line that is the delimiter is not this form.
function liftHeredocs(src) {
  return src.replace(/"\$\(cat <<'(\w+)'\n([\s\S]*?)\n\1\n\)"/g, (all, delim, body) => (body.split('\n').includes(delim) ? all : `"${HEREDOC}"`));
}

/** Words and redirects of each command, or throws Ask. */
function lex(src) {
  const cmds = [];
  let cur = { sep: null, words: [], redirects: [] };
  let w = null; // the word being read
  let glob = false;
  let q = null;
  let pending = null; // a redirect waiting for its target
  const flushWord = () => {
    if (w === null) return;
    const word = { t: w, glob: glob && !/^(\[\[?|\]\]?)$/.test(w) };
    if (pending) { pending.target = word; cur.redirects.push(pending); pending = null; } else cur.words.push(word);
    w = null; glob = false;
  };
  const OPS = ['&&', '||', '|'];
  const endCmd = (sep) => {
    flushWord();
    if (pending) ask('a redirect with no target');
    const empty = !cur.words.length && !cur.redirects.length;
    if (empty && (OPS.includes(cur.sep) || OPS.includes(sep))) ask('an operator with no command next to it');
    if (!empty) cmds.push(cur);
    cur = { sep, words: [], redirects: [] };
  };
  const text = (c) => { w = (w ?? '') + c; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    const code = c.charCodeAt(0);
    if (q === "'") { if (c === "'") q = null; else { if (code < 32 && c !== '\n' && c !== '\t') ask('a control character'); text(c); } continue; }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === '$' || c === '`') ask('a variable or substitution in the command');
      else if (c === '\\') ask('a backslash');
      else if (code < 32 && c !== '\n' && c !== '\t') ask('a control character');
      else text(c);
      continue;
    }
    if (c === '$' || c === '`') ask('a variable or substitution in the command');
    if (c === '\\') ask('a backslash');
    if (code < 32 && c !== '\n' && c !== '\t') ask('a control character');
    if (code > 126) ask('characters outside plain ASCII');
    if (c === "'" || c === '"') { q = c; w = w ?? ''; continue; }
    if (c === ' ' || c === '\t') { flushWord(); continue; }
    if (c === '\n') { endCmd('\n'); continue; }
    if (c === ';') { if (n === ';' || n === '&') ask('a case arm'); endCmd(';'); continue; }
    if (c === '&') {
      if (n === '&') { endCmd('&&'); i++; continue; }
      if (n === '>') { flushWord(); const two = src[i + 2] === '>'; pending = { op: two ? '&>>' : '&>', fd: null }; i += two ? 2 : 1; continue; }
      ask('a background command');
    }
    if (c === '|') {
      if (n === '|') { endCmd('||'); i++; continue; }
      if (n === '&') ask('a pipe of both streams');
      endCmd('|'); continue;
    }
    if (c === '(' || c === ')') ask('a subshell or a function');
    if (c === '{' || c === '}') ask('a brace');
    if (c === '#' && w === null) ask('a comment');
    if (c === '=' && w === null) ask('a word starting with =');
    if (c === '>' || c === '<') {
      let fd = null;
      if (w !== null && /^\d+$/.test(w)) { fd = w; w = null; glob = false; } else flushWord();
      if (pending) ask('two redirects in a row');
      if (c === '<') {
        if (n === '<') ask('a here-document or here-string');
        if (n === '(' || n === '>' || n === '&') ask('a process substitution or a duplicated input');
        pending = { op: '<', fd };
        continue;
      }
      if (n === '(' || n === '|') ask('a process substitution or a forced redirect');
      if (n === '&') { // 2>&1, 1>&2, >&2
        const m = /^&([12])(?![0-9A-Za-z_-])/.exec(src.slice(i + 1));
        if (!m || !((fd === '2' && m[1] === '1') || ((fd === '1' || fd === null) && m[1] === '2'))) ask('a duplicated output other than 2>&1');
        i += m[0].length;
        continue;
      }
      if (n === '>') { pending = { op: '>>', fd }; i++; } else pending = { op: '>', fd };
      continue;
    }
    if (c === '*' || c === '?' || c === '[') glob = true;
    text(c);
  }
  if (q) ask('an unfinished quote');
  endCmd(null);
  return cmds;
}

// ---------- argument matcher ----------

/** flags: 'n b s' (short, bundle-able), 'n:' (short with a value), '--long', '--long:' (long with a value), '#' (-20). */
function spec(flags = '', opts = {}) {
  const s = { shortBool: new Set(), shortVal: new Set(), shortWords: new Set(), longBool: new Set(), longVal: new Set(), digits: false, pos: 'read', ...opts, text: new Set(opts.text ?? []) };
  for (const raw of flags.split(/\s+/).filter(Boolean)) {
    if (raw === '#') { s.digits = true; continue; }
    if (raw.startsWith('--')) { (raw.endsWith(':') ? s.longVal.add(raw.slice(0, -1)) : s.longBool.add(raw)); continue; }
    const f = raw.startsWith('-') ? raw.slice(1) : raw; // -p and p are the same flag; -nv (more than one letter) is a word of its own
    if (f.length > 1 && !f.endsWith(':')) s.shortWords.add(`-${f}`);
    else if (f.endsWith(':')) s.shortVal.add(f.slice(0, -1));
    else s.shortBool.add(f);
  }
  return s;
}

/** { pos: [word], vals: [[flag, word]] } or throws Ask. */
function parse(sp, args, prog) {
  const pos = [];
  const vals = [];
  const flags = new Set();
  let rest = false;
  const flagWhy = (f) => ask(`the option ${f} of ${prog}`);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (rest) { pos.push(a); continue; }
    if (a.glob && a.t.startsWith('-')) flagWhy(a.t);
    const t = a.t;
    if (t === '--') { rest = true; continue; }
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const name = eq < 0 ? t : t.slice(0, eq);
      if (sp.longBool.has(name) && eq < 0) { flags.add(name); continue; }
      if (sp.longVal.has(name)) {
        if (eq >= 0) vals.push([name, { t: t.slice(eq + 1), glob: a.glob }]);
        else { if (i + 1 >= args.length) flagWhy(name); vals.push([name, args[++i]]); }
        continue;
      }
      flagWhy(name);
    }
    if (sp.shortWords.has(t)) continue;
    if (t.length > 1 && t[0] === '-') {
      if (sp.digits && /^-\d+$/.test(t)) continue;
      let done = false;
      for (let k = 1; k < t.length && !done; k++) {
        const ch = t[k];
        if (sp.shortBool.has(ch)) { flags.add(`-${ch}`); continue; }
        if (sp.shortVal.has(ch)) {
          const attached = t.slice(k + 1);
          if (attached) vals.push([`-${ch}`, { t: attached, glob: false }]);
          else { if (i + 1 >= args.length) flagWhy(`-${ch}`); vals.push([`-${ch}`, args[++i]]); }
          done = true;
          continue;
        }
        flagWhy(`-${ch}`);
      }
      continue;
    }
    pos.push(a);
  }
  return { pos, vals, flags };
}

// ---------- paths ----------

const pathlike = (t) => /^[/~]|^\.\.(\/|$)|=[/~]|=\.\.(\/|$)/.test(t);

// The folders a command may be running in (after a cd joined by something other than && it may be either).
const insideAll = (word, ctx, strict = false) => ctx.cands.every((c) => inRoots(physicalPath(word.t, c), ctx.roots, strict));
function mustBeInside(word, ctx, strict = false, why = 'a path outside the job or one that cannot be placed') {
  if (!insideAll(word, ctx, strict)) ask(why);
}
/** Every part of a word that could be a path (pathCandidates, lib/policy.js) must be inside the job. */
function pathInside(word, ctx) {
  const t = String(word?.t ?? '');
  for (const v of pathCandidates(t)) if (v !== t || !t.startsWith('-')) mustBeInside({ ...word, t: v }, ctx);
}
function readablePath(word, ctx) {
  if (/^~[^/]/.test(word.t)) ask("a path in another user's home");
  if (word.glob && !insideAll(word, ctx)) ask('a pattern that reaches outside the job'); // it could match a secret place
}
// A recursive read from a root outside the job's folders can reach any secret place under it.
function rootsInside(roots, ctx) { for (const x of roots) if (!insideAll(x, ctx)) ask('a recursive read that starts outside the job'); }

// ---------- per-kind argument checks ----------

function check(sp, args, ctx, prog) {
  const { pos, vals, flags } = parse(sp, args, prog);
  const kind = sp.pos;
  if (typeof kind === 'function') { kind(pos, vals, ctx, flags); return { pos, vals, flags }; }
  if (kind === 'none' && pos.length) ask(`arguments to ${prog}`);
  if (kind === 'read') for (const x of [...pos, ...vals.map((v) => v[1])]) readablePath(x, ctx);
  if (kind === 'inside') for (const x of pos) mustBeInside(x, ctx, Boolean(sp.strict));
  if (kind === 'inside') for (const [, x] of vals) mustBeInside(x, ctx);
  if (kind === 'build') for (const [f, x] of vals) if (!sp.text.has(f)) pathInside(x, ctx); // a message or a title is text, not a path
  if (kind === 'build') for (const x of pos) pathInside(x, ctx);
  if (kind === 'digits' && pos.some((x) => !/^\d+(\.\d+)?$/.test(x.t))) ask(`arguments to ${prog}`);
  return { pos, vals, flags };
}

const READ = (flags, opts) => spec(flags, { pos: 'read', ...opts });
const INSIDE = (flags, opts) => spec(flags, { pos: 'inside', ...opts });
const BUILD = (flags, opts) => spec(flags, { pos: 'build', ...opts });

const GREP = READ('r R n i v l L c w x o h H s q E F P a I G b y A: B: C: m: e: f: --include: --exclude: --exclude-dir: --max-count: --regexp: --file: --color --color: --recursive --line-number --ignore-case --invert-match --files-with-matches --files-without-match --count --word-regexp --line-regexp --only-matching --no-filename --with-filename --quiet --extended-regexp --fixed-strings --perl-regexp --text --no-messages --context: --after-context: --before-context: #');

// ---------- the programs: reads (any path may be read; secret places are stops, judged elsewhere) ----------

const PROGRAMS = {
  cat: READ('n b s v E T A'),
  ls: READ('a A l h R 1 t r S d F G p i s k u c f U x C m @ O e --color --color: --all --almost-all --human-readable --recursive --classify'),
  head: READ('n: c: q v # --lines: --bytes:'),
  tail: READ('n: c: q v # --lines: --bytes:'),
  wc: READ('l w c m L'),
  grep: GREP,
  egrep: GREP,
  fgrep: GREP,
  rg: READ('n i v l c w x o h H s q u U F S a I N P L e: g: t: T: A: B: C: m: j: d: --files --hidden --no-ignore --no-ignore-vcs --line-number --ignore-case --files-with-matches --files-without-match --count --word-regexp --fixed-strings --no-heading --heading --column --smart-case --case-sensitive --glob: --type: --type-not: --max-count: --max-depth: --context: --after-context: --before-context: --threads: --regexp: --sort: --color: --no-line-number --null --json --type-list --follow --multiline'),
  echo: spec('n e E', { pos: 'text' }),
  printf: spec('', { pos: 'text' }),
  pwd: spec('', { pos: 'none' }),
  whoami: spec('', { pos: 'none' }),
  id: spec('u g n G', { pos: 'none' }),
  uname: spec('a s r m n v p', { pos: 'none' }),
  hostname: spec('', { pos: 'none' }),
  date: spec('u R', { pos: (pos) => { if (pos.some((x) => !x.t.startsWith('+'))) ask('a date that sets the clock'); } }),
  which: READ('a s'),
  basename: spec('a s:', { pos: 'text' }),
  dirname: spec('', { pos: 'text' }),
  realpath: READ('e m s q'),
  sort: READ('r n u f b c d g h i M R s V k: t: --reverse --numeric-sort --unique --ignore-case'),
  uniq: spec('c d u i f: s: w:', { pos: (pos, vals, ctx) => { if (pos.length > 1) ask('a uniq with an output file'); for (const x of pos) readablePath(x, ctx); } }),
  cut: READ('d: f: c: b: s n --delimiter: --fields: --characters:'),
  tr: spec('d s c C', { pos: 'text' }),
  tree: READ('a d f i l n p s h u g D F C N L: I: P:'),
  diff: READ('u r q N i w b B y c s a U: C: x: --brief --recursive --unified --color'),
  cmp: READ('s l'),
  file: READ('b i L h'),
  stat: READ('x s l L n r q f: c: t:'),
  du: READ('a c h k m s x L P d: --max-depth: --summarize --human-readable'),
  df: READ('h k m i H P a T'),
  shasum: READ('a: b c q t'), sha1sum: READ('b c t q'), sha256sum: READ('b c t q'), md5sum: READ('b c t q'), md5: READ('q r'), cksum: READ(''),
  test: spec('', { pos: 'free', free: true }), '[': spec('', { pos: 'free', free: true }), '[[': spec('', { pos: 'free', free: true }),
  true: spec('', { pos: 'none' }), false: spec('', { pos: 'none' }),
  sleep: spec('', { pos: 'digits' }), seq: spec('', { pos: 'digits' }),
  exit: spec('', { pos: 'digits' }),
  // ---------- file changes: every path inside the job ----------
  cp: INSIDE('r R a p f i n v t:'),
  mv: INSIDE('f i n v', { strict: true }),
  rm: INSIDE('r R f v i d --recursive --force --verbose', { strict: true }),
  mkdir: INSIDE('p v m:'),
  rmdir: INSIDE('p v'),
  touch: INSIDE('a m c'),
  ln: INSIDE('s f n v'),
  tee: INSIDE('a'),
  unzip: INSIDE('o q n l d:'),
  zip: INSIDE('r q'),
  // ---------- build and test ----------
  tsc: BUILD('--noEmit --pretty --build -b --incremental --skipLibCheck --strict --noEmitOnError --declaration --sourceMap --version -v --watch -w --listFiles --showConfig --project: -p: --target: --module: --lib: --jsx: --outDir: --declarationDir: --rootDir: --moduleResolution:'),
  eslint: BUILD('--fix --quiet --cache --no-cache --no-error-on-unmatched-pattern --fix-dry-run --version -v --debug --no-eslintrc --ext: --format: -f: --max-warnings: --config: -c: --ignore-path: --cache-location: --rule: --ignore-pattern: --output-file:'),
  prettier: BUILD('--write -w --check -c --list-different -l --version -v --cache --no-semi --single-quote --no-config --use-tabs --no-bracket-spacing --ignore-unknown -u --config: --ignore-path: --parser: --tab-width: --print-width: --trailing-comma: --end-of-line: --log-level: --arrow-parens: --quote-props:'),
  vitest: BUILD('--run --coverage --passWithNoTests --silent --no-color --watch --no-watch --globals -u --update --reporter: --bail: -t: --testNamePattern: --root: --config: -c: --dir: --project: --environment: --pool: --testTimeout:', { text: ['-t', '--testNamePattern'] }),
  jest: BUILD('--ci --coverage -u --bail --silent --watchAll --runInBand -i --forceExit --detectOpenHandles --passWithNoTests --verbose --colors --no-cache --onlyChanged -o --listTests --json -t: --testPathPattern: --config: --rootDir: --maxWorkers: -w: --testNamePattern: --findRelatedTests: --outputFile:', { text: ['-t', '--testNamePattern', '--testPathPattern'] }),
  pytest: BUILD('q v x s l --co --collect-only --lf --ff --no-header -k: -m: -n: --maxfail: --tb: --basetemp: -c: --cov: --cov-report: --durations: -W: -r:', { text: ['-k', '-m'] }),
};

// ---------- find, sed, awk, chmod, tar, set, cd ----------

const FIND_TESTS = new Set(['-name', '-iname', '-path', '-ipath', '-type', '-maxdepth', '-mindepth', '-mtime', '-mmin', '-newer', '-size', '-perm', '-user', '-regex', '-empty', '-print', '-print0', '-not', '!', '-and', '-or', '-o', '-a', '-prune']);
const FIND_VALUE = new Set(['-name', '-iname', '-path', '-ipath', '-type', '-maxdepth', '-mindepth', '-mtime', '-mmin', '-newer', '-size', '-perm', '-user', '-regex']);
function findCheck(args, ctx) {
  let i = 0;
  while (i < args.length && !args[i].t.startsWith('-') && args[i].t !== '!') { readablePath(args[i], ctx); rootsInside([args[i]], ctx); i++; }
  for (; i < args.length; i++) {
    const t = args[i].t;
    if (!FIND_TESTS.has(t)) ask(`the find test ${t}`);
    if (FIND_VALUE.has(t)) { if (i + 1 >= args.length) ask(`the find test ${t}`); i++; }
  }
}

// one s command: s<d>pattern<d>replacement<d>flags, with no e or w flag and no escaped delimiter
function sedSubstitutions(script) {
  let i = 0;
  while (i < script.length) {
    while (script[i] === ' ' || script[i] === ';') i++;
    if (i >= script.length) break;
    if (script[i] !== 's') return false;
    const d = script[i + 1];
    if (!d || /[A-Za-z0-9\s\\;]/.test(d)) return false;
    let at = i + 2;
    for (let part = 0; part < 2; part++) {
      for (; at < script.length && script[at] !== d; at++) {
        if (script[at] === '\\') { if (script[at + 1] === d || script[at + 1] === '\n' || script[at + 1] === undefined) return false; at++; }
        if (script[at] === '\n') return false;
      }
      if (script[at] !== d) return false;
      at++;
    }
    const m = /^[gpiImM0-9]*/.exec(script.slice(at));
    at += m[0].length;
    if (at < script.length && script[at] !== ';' && script[at] !== ' ') return false;
    i = at;
  }
  return true;
}
const SED_PRINT = /^(?:(?:\d+|\$|\/[^/\\]*\/)(?:,(?:\d+|\$|\/[^/\\]*\/))?)p$/;
function sedCheck(args, ctx) {
  let inPlace = false;
  let quiet = false;
  const scripts = [];
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i].t;
    if (t === '-n') { quiet = true; continue; }
    if (t === '-E' || t === '-r' || t === '-s') continue;
    if (t === '-e') { if (i + 1 >= args.length) ask('a sed with no script'); scripts.push(args[++i].t); continue; }
    if (t === '-i' || /^-i[^/]*$/.test(t) || t === '--in-place') { inPlace = true; if (t === '-i' && args[i + 1]?.t === '') i++; continue; }
    if (t.startsWith('-') && t !== '-') ask(`the option ${t} of sed`);
    files.push(args[i]);
  }
  if (!scripts.length) { if (!files.length) ask('a sed with no script'); scripts.push(files.shift().t); }
  for (const sc of scripts) {
    const ok = inPlace ? sedSubstitutions(sc) : quiet ? sc.split(';').every((x) => SED_PRINT.test(x.trim())) || sedSubstitutions(sc) : sedSubstitutions(sc);
    if (!ok) ask('a sed script Starbase does not read');
  }
  for (const f of files) { if (inPlace) mustBeInside(f, ctx, false); else readablePath(f, ctx); }
  if (inPlace && !files.length) ask('an in-place sed with no file');
}

function awkCheck(args, ctx) {
  const files = [];
  let program = null;
  for (let i = 0; i < args.length; i++) {
    const t = args[i].t;
    if (t === '-F') { i++; continue; }
    if (/^-F./.test(t)) continue;
    if (t.startsWith('-') && t !== '-') ask(`the option ${t} of awk`);
    if (program === null) program = t; else files.push(args[i]);
  }
  if (program === null) ask('an awk with no program');
  if (/system|getline|ENVIRON|close|fflush|[|>]/.test(program)) ask('an awk program that runs, writes or reads other places');
  for (const f of files) readablePath(f, ctx);
}

function chmodCheck(args, ctx) {
  const { pos } = parse(spec('R v'), args, 'chmod');
  if (pos.length < 2 || !/^([0-7]{3,4}|[ugoa]*[-+=][rwxXst]+(,[ugoa]*[-+=][rwxXst]+)*)$/.test(pos[0].t)) ask('a chmod Starbase does not read');
  for (const x of pos.slice(1)) mustBeInside(x, ctx);
}

function tarCheck(args, ctx) {
  const list = args.map((a) => ({ ...a }));
  if (list[0] && !list[0].t.startsWith('-') && /^[cxtzjJvpmkf]+$/.test(list[0].t)) list[0].t = `-${list[0].t}`;
  const { pos, vals } = parse(spec('c x t z j J v p m k f: C:', { pos: 'inside' }), list, 'tar');
  for (const x of pos) mustBeInside(x, ctx);
  for (const [, x] of vals) mustBeInside(x, ctx);
}

const SET_OK = /^-[eux]+$|^-o$|^pipefail$|^-euo$/;
function setCheck(args) { if (!args.length || args.some((x) => !SET_OK.test(x.t))) ask('a set that changes the shell'); }


// programs whose arguments are read by a function of their own (they get the raw word list)
const CUSTOM = {
  find: (args, ctx) => findCheck(args, ctx),
  sed: sedCheck,
  awk: (args, ctx) => awkCheck(args, ctx),
  chmod: chmodCheck,
  tar: tarCheck,
  set: (args) => setCheck(args),
};

// ---------- curl and wget ----------

function urlCheck(word) {
  const t = word.t;
  if (word.glob || !/^https?:\/\/[^\s]+$/i.test(t)) ask('an address that is not a literal http or https one');
  if (/[[\]{}*]/.test(t)) ask('an address with a pattern in it');
  if (namesThisComputer(t)) ask('an address on this computer');
}
function curlCheck(args, ctx) {
  const sp = spec('s S L f I k O --fail --silent --show-error --location --compressed o: --output: --max-time: --retry:', { pos: 'free' });
  const { pos, vals } = parse(sp, args, 'curl');
  if (!pos.length) ask('a curl with no address');
  for (const x of pos) urlCheck(x);
  for (const [f, x] of vals) {
    if (f === '-o' || f === '--output') { if (x.t !== '-' && x.t !== '/dev/null') mustBeInside(x, ctx); } else if (!/^\d+$/.test(x.t)) ask(`the value of ${f}`);
  }
  if (args.some((a) => /^-[A-Za-z]*O/.test(a.t) || a.t === '-O') && !ctx.cands.every((c) => inRoots(physicalPath('.', c), ctx.roots))) ask('a download into a folder outside the job');
}
function wgetCheck(args, ctx) {
  const sp = spec('q nv --quiet --no-verbose O: P: --tries: --timeout:', { pos: 'free' });
  const { pos, vals } = parse(sp, args, 'wget');
  if (!pos.length) ask('a wget with no address');
  for (const x of pos) urlCheck(x);
  for (const [f, x] of vals) { if (f === '-O' || f === '-P') { if (x.t !== '-') mustBeInside(x, ctx); } else if (!/^\d+$/.test(x.t)) ask(`the value of ${f}`); }
  if (!vals.some(([f]) => f === '-O' || f === '-P') && !ctx.cands.every((c) => inRoots(physicalPath('.', c), ctx.roots))) ask('a download into a folder outside the job');
}

// ---------- git ----------

const DIFF_FLAGS = '--stat --name-only --name-status --cached --staged --shortstat --numstat --no-color --color --check --summary --minimal --word-diff --patch -p w b U: --unified: --diff-filter: --find-renames M --no-ext-diff --no-textconv --ignore-space-change --ignore-all-space --exit-code --quiet --raw --compact-summary --stat: --abbrev --full-index --binary --text a';
const LOG_FLAGS = '--oneline --graph --decorate --stat --name-only --name-status --all --no-color --abbrev-commit --pretty: --format: n: --max-count: --since: --until: --author: --grep: --reverse -p --patch --follow --first-parent --merges --no-merges --date: --shortstat --numstat S: G: --left-right --cherry-pick --boundary --no-decorate --topo-order --date-order --skip: --all-match --branches --tags --remotes --summary --abbrev: --stat: #';
const LOG_TEXT = ['--pretty', '--format', '--since', '--until', '--author', '--grep', '--date', '-S', '-G'];
// git fetch and pull: a remote's name (never a path or an address), then branch names
function remoteName(pos, what) {
  pos.forEach((x, k) => { if (!(k === 0 ? /^[A-Za-z0-9_][\w-]*$/ : /^[A-Za-z0-9_][\w./-]*$/).test(x.t)) ask(`a ${what} from a path or an address`); });
}
const GIT = {
  status: BUILD('s b v u: --short --branch --porcelain --porcelain: --untracked-files: --ignored --long --no-color'),
  diff: BUILD(DIFF_FLAGS),
  log: BUILD(LOG_FLAGS, { text: LOG_TEXT }),
  show: BUILD(`${DIFF_FLAGS} ${LOG_FLAGS} s`, { text: LOG_TEXT }),
  add: INSIDE('A u n v N --all --update --dry-run --verbose --intent-to-add'),
  commit: BUILD('a q v s --all --amend --no-edit --quiet --verbose --allow-empty --no-verify --signoff m: --message: F: --file: --author: --date:', { text: ['-m', '--message', '--author', '--date'] }),
  fetch: spec('q v p t --all --prune --quiet --verbose --tags --no-tags --depth: --unshallow', { pos: (pos) => remoteName(pos, 'fetch') }),
  pull: spec('q v r --quiet --verbose --rebase --ff-only --no-rebase --no-edit --autostash --no-autostash --ff --no-ff --depth:', { pos: (pos) => remoteName(pos, 'pull') }),
  push: spec('u q v n --set-upstream --quiet --verbose --no-verify --dry-run --progress', { pos: (pos) => { if (pos.length > 2) ask('a push with several branches'); for (const x of pos) if (!/^[\w./@:^~-]+$/.test(x.t)) ask('an unusual push target'); } }),
  checkout: BUILD('b: B: q --detach --quiet', { pos: 'build' }),
  switch: BUILD('c: C: q --detach --quiet --create: --force-create:'),
  branch: spec('a r v --list --show-current --merged --no-merged --contains --all --remotes --verbose', { pos: (pos) => { if (pos.length > 1) ask('a branch command with several names'); } }),
  merge: BUILD('q --no-edit --no-ff --ff-only --ff --squash --abort --no-commit --no-verify --quiet m:'),
  rebase: BUILD('q --continue --abort --skip --autostash --no-autostash --quiet'),
  'cherry-pick': BUILD('n x --continue --abort --no-commit --skip --quit -m:'),
  revert: BUILD('n --continue --abort --no-commit --skip --quit --no-edit -m:'),
  reset: BUILD('q --soft --mixed --hard --keep --quiet'),
  restore: INSIDE('S W --staged --worktree s: --source:'),
  rm: INSIDE('r f q n --cached --quiet --dry-run --recursive'),
  mv: INSIDE('f n v k'),
  tag: spec('l n --list', { pos: (pos) => { if (pos.length > 1) ask('a tag command with several names'); } }),
  remote: spec('v --verbose', { pos: (pos) => { if (pos.length && !(pos.length === 1 && ['show'].includes(pos[0].t)) && !(pos.length === 2 && pos[0].t === 'get-url')) ask('a remote command that changes remotes'); } }),
  config: spec('l --list --get --get-all --get-regexp --local', { pos: (pos, vals, ctx, flags) => { if (!['-l', '--list', '--get', '--get-all', '--get-regexp'].some((f) => flags.has(f))) ask('a git config that changes settings'); } }),
  clean: spec('n d f q --dry-run --force', { pos: 'build' }),
  stash: spec('', { pos: (pos) => { if (!(pos.length === 1 && pos[0].t === 'list')) ask('a stash command that changes the stash'); } }),
  worktree: spec('', { pos: (pos) => { if (!(pos.length === 1 && pos[0].t === 'list')) ask('a worktree command that changes worktrees'); } }),
  'rev-parse': READ('q --abbrev-ref --short --show-toplevel --is-inside-work-tree --verify --symbolic-full-name --show-prefix --show-cdup --absolute-git-dir --git-dir --short: --abbrev-ref:'),
  'ls-files': READ('c o m d s u z i --cached --others --modified --deleted --stage --exclude-standard --full-name --error-unmatch'),
  describe: READ('--tags --always --abbrev: --dirty --long --match: --exact-match'),
  blame: READ('L: w e s l p --line-porcelain'),
  'merge-base': READ('a --is-ancestor --fork-point --all'),
  'for-each-ref': READ('--format: --sort: --count: --contains: --merged: --no-merged: --points-at:'),
  shortlog: READ('s n e --summary --numbered'),
  'cat-file': READ('t s p e --batch-check'),
  'ls-tree': READ('r d t l z --name-only --full-name --long'),
  grep: READ('n i v l c w E F P e: I h r --cached --count --line-number --files-with-matches --and --or --not A: B: C: --max-depth: #'),
  'check-ignore': READ('v n q'),
  'rev-list': READ('--count --max-count: n: --all --reverse --parents --no-merges --merges --first-parent --since: --until: --abbrev-commit --left-right'),
  'name-rev': READ('--name-only --tags --always'),
  'count-objects': READ('v H'),
  'show-ref': READ('--heads --tags --verify q --hash s --head'),
  'ls-remote': spec('--heads --tags q', { pos: (pos) => { for (const x of pos) if (!/^[\w.-]+$/.test(x.t)) ask('an address given to ls-remote'); } }),
  'symbolic-ref': spec('q --short', { pos: (pos) => { if (pos.length > 1) ask('a symbolic-ref that changes a reference'); } }),
  version: spec('', { pos: 'none' }),
};

/**
 * Local branches are shared by every worktree of the repository, so a commit or a merge made on
 * another branch moves it for the person too. A checkout or switch is plain only when it goes to
 * one of the job's own branches, makes a new branch, detaches, or brings files back (`-- paths`).
 */
function switchCheck(sub, { pos, vals, flags, paths }, ctx) {
  if (vals.some(([f]) => ['-B', '-C', '--force-create'].includes(f))) ask('a branch moved onto this commit');
  if (paths.length || flags.has('--detach')) return;
  if (vals.some(([f]) => ['-b', '-c', '--create'].includes(f))) return;
  const mine = new Set(Array.isArray(ctx.ctx?.branches) ? ctx.ctx.branches : []);
  const isFile = (t) => sub === 'checkout' && ctx.cands.length > 0 && ctx.cands.every((c) => { try { return fs.existsSync(path.resolve(c, t)); } catch { return false; } });
  for (const x of pos) {
    if (x.t === '--' || mine.has(x.t) || isFile(x.t)) continue;
    ask("a switch to a branch that is not the job's own");
  }
}

function gitCheck(args, ctx) {
  let i = 0;
  while (args[i] && (args[i].t === '--no-pager' || args[i].t === '-P')) i++;
  const sub = args[i]?.t;
  if (!sub) ask('git with no subcommand');
  if (sub === '--version' || sub === 'version') { if (args.length > i + 1) ask('arguments to git version'); return; }
  const sp = GIT[sub];
  if (!sp) ask(`the git subcommand ${sub.startsWith('-') ? 'option ' : ''}${sub}`);
  const rest = args.slice(i + 1);
  if (sub === 'commit') {
    const { vals } = parse(sp, rest.map((x) => (x.t === HEREDOC ? { ...x, t: 'message' } : x)), 'git commit');
    for (const [f, x] of vals) if (f === '-F' || f === '--file') { if (x.t === '-') ask('a commit message from standard input'); mustBeInside(x, ctx); }
    check(sp, rest.map((x) => (x.t === HEREDOC ? { ...x, t: 'message' } : x)), ctx, 'git commit');
    return;
  }
  if (sub === 'checkout' || sub === 'reset' || sub === 'restore' || sub === 'switch') {
    const { pos, vals, flags } = check(sp, rest, ctx, `git ${sub}`);
    const dashes = rest.findIndex((x) => x.t === '--');
    const paths = dashes >= 0 ? rest.slice(dashes + 1) : [];
    for (const x of paths) mustBeInside(x, ctx);
    if (sub === 'checkout' || sub === 'switch') switchCheck(sub, { pos, vals, flags, paths }, ctx);
    return;
  }
  check(sp, rest, ctx, `git ${sub}`);
}

// ---------- gh ----------

const GH_LIST = '--json: --jq: -q: --state: -s: --limit: -L: --author: --label: -l: --base: -B: --head: -H: --search: -S: --comments -c --watch --required --name-only --patch --draft --web';
const GH_TEXT = ['--json', '--jq', '-q', '--state', '-s', '--author', '--label', '-l', '--base', '-B', '--head', '-H', '--search', '-S'];
const GH = {
  pr: {
    create: BUILD('--fill --fill-first --fill-verbose --title: -t: --body: -b: --base: -B: --head: -H: --draft -d --label: -l: --reviewer: -r: --assignee: -a: --milestone: -m: --no-maintainer-edit --body-file: -F: --repo: -R:', { text: ['--title', '-t', '--body', '-b', '--base', '-B', '--head', '-H', '--label', '-l', '--reviewer', '-r', '--assignee', '-a', '--milestone', '-m', '--repo', '-R'] }),
    view: BUILD('--json: --jq: -q: --comments -c', { text: GH_TEXT }), list: BUILD(GH_LIST.replace('--web', ''), { text: GH_TEXT }), status: BUILD(''), checks: BUILD('--watch --required --json: --jq: -q: --interval: -i:'), diff: BUILD('--name-only --patch --color:'), // checkout: someone else's code arrives; it asks (m4)
  },
  issue: { view: BUILD('--json: --jq: -q: --comments -c'), list: BUILD(GH_LIST.replace('--web', '')), status: BUILD('') },
  repo: { view: BUILD('--json: --jq: -q') },
  run: { view: BUILD('--json: --jq: -q --log --log-failed --job: -j: --exit-status'), list: BUILD('--json: --jq: -q --limit: -L: --branch: -b: --status: -s: --workflow: -w:'), watch: BUILD('--exit-status --interval: -i:') },
  release: { view: BUILD('--json: --jq: -q'), list: BUILD('--limit: -L: --json: --jq: -q') },
  workflow: { view: BUILD(''), list: BUILD('--json: --jq: -q') },
  auth: { status: BUILD('') },
};
function ghCheck(args, ctx) {
  const words = args.filter((x) => !x.t.startsWith('-'));
  if (args.length === 1 && (args[0].t === '--version')) return;
  const [group, action] = words.map((x) => x.t);
  if (group === 'api') {
    const { pos } = check(spec('--paginate --jq: -q:', { pos: 'text' }), args.slice(args.findIndex((x) => x.t === 'api') + 1), ctx, 'gh api');
    if (pos.length !== 1 || /\/merge/.test(pos[0].t) || /:\/\//.test(pos[0].t)) ask('a gh api call Starbase does not read'); // only a path relative to the API
    return;
  }
  const sp = GH[group]?.[action];
  if (!sp) ask(`the gh command ${[group, action].filter(Boolean).join(' ')}`);
  const at = args.findIndex((x) => x.t === action);
  const rest = args.filter((_, k) => k !== args.findIndex((x) => x.t === group) && k !== at);
  const { pos, vals } = check(sp, rest, ctx, `gh ${group} ${action}`);
  for (const [f, x] of vals) if (['--body-file', '-F'].includes(f) && SECRET_NAME.test(path.basename(x.t))) ask('a body file with a secret name');
  // Only into the job's own branch, from it, and asking nobody to review (I7).
  if (group === 'pr' && action === 'create') {
    const c = ctx.ctx ?? {};
    const forkOwner = (() => { try { return githubOwner(typeof c.remoteUrl === 'function' ? c.remoteUrl(c.forkRemote || 'origin') : null); } catch { return null; } })();
    const problem = prCreateProblem(rest.map((x) => x.t), { branches: c.branches ?? [], forkOwner });
    if (problem) ask(problem);
  }
  // --repo / -R only names the job's own org repository, as its org remote's address says (I2).
  const own = typeof ctx.ctx?.orgRepo === 'string' ? ctx.ctx.orgRepo.toLowerCase() : null;
  for (const [f, x] of vals) if (['--repo', '-R'].includes(f) && !(own && String(x.t).toLowerCase() === own)) ask('a pull request on a repository that is not the job\'s own');
  if (pos.length > 1 || pos.some((x) => !/^[\w./#:-]+$/.test(x.t))) ask('arguments to gh Starbase does not read');
}

// ---------- package managers and runners ----------

const PKG_FLAGS = spec('s r w: F: --silent --if-present --workspaces --recursive --no-audit --no-fund --ignore-scripts --prefer-offline --legacy-peer-deps --frozen-lockfile --immutable --offline --no-progress --production --workspace: --filter: --loglevel: --reporter:', { pos: 'free' });
const SCRIPT_NAME = /^[\w:.@/-]+$/;
const BARE_SCRIPT = /^[\w:.-]+$/; // a script named directly (pnpm build, bun run build): not a path to a file
const FILE_LIKE = /\.(m?[jt]sx?|cjs|py|sh)$/;
const PKG_NAME = /^(@[\w.-]+\/)?[\w.-]+(@[\w.^~<>=*-]+)?$/;

function binExists(name, ctx) {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return false;
  // A package script also finds its package's own node_modules/.bin, wherever it has cd'd to (binBase).
  return ctx.cands.every((c) => (ctx.binBase ? [c, ctx.binBase] : [c]).some((start) => {
    let dir = physicalPath('.', start);
    for (let guard = 0; guard < 40 && dir && inRoots(dir, ctx.roots); guard++) {
      try { if (fs.existsSync(path.join(dir, 'node_modules', '.bin', name))) return true; } catch { /* not there */ }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    return false;
  }));
}

/**
 * Programs from the job's node_modules/.bin that are plain only in a few uses (I2): next build and next lint,
 * prisma generate, format and validate (every other prisma word is the database rule's), husky bare, husky
 * install and husky <a folder inside the job>. next dev and next start are not on the list.
 */
const LOCAL_PLAIN = {
  next: (args) => { if (!(args.length === 1 && ['build', 'lint'].includes(args[0].t))) ask('a next command Starbase does not read'); },
  prisma: (args) => { if (!(args.length === 1 && ['generate', 'format', 'validate'].includes(args[0].t))) ask('a prisma command Starbase does not read'); },
  // husky <folder> sets the whole repository's core.hooksPath (a worktree shares its config): only the repository's own
  // .husky folder, written relative and with no .. part, is plain (N3).
  husky: (args, ctx) => {
    if (!args.length || (args.length === 1 && args[0].t === 'install')) return;
    const t = args[0].t;
    const parts = t.split('/').filter((x) => x && x !== '.');
    if (args.length !== 1 || args[0].glob || t.startsWith('-') || t.startsWith('/') || t.startsWith('~') || parts.includes('..') || parts.at(-1) !== '.husky') ask('a husky command Starbase does not read');
    mustBeInside(args[0], ctx);
  },
};
export const LOCAL_PROGRAMS = Object.freeze(Object.keys(LOCAL_PLAIN));
/** Is this use of a node_modules/.bin program on the short plain list (words without the program name, as strings)? */
export function localPlain(name, words) {
  if (!Object.hasOwn(LOCAL_PLAIN, name)) return false;
  try { LOCAL_PLAIN[name](words.map((t) => ({ t, glob: /[*?[]/.test(t) })), { roots: [], cands: [] }, true); return true; } catch (e) { if (e instanceof Ask) return false; throw e; }
}

// A runner starts a program from the job's node_modules/.bin: its name must be there, and its arguments are read by that program's list.
// Is this name a script in the nearest package.json at or above the folder (inside the job)?
function scriptInPackage(name, ctx) {
  return ctx.cands.every((c) => {
    let dir = physicalPath('.', c);
    for (let guard = 0; guard < 40 && dir && inRoots(dir, ctx.roots); guard++) {
      const file = path.join(dir, 'package.json');
      try {
        if (fs.existsSync(file)) { const scripts = JSON.parse(fs.readFileSync(file, 'utf8'))?.scripts; return Boolean(scripts) && Object.prototype.hasOwnProperty.call(scripts, name) && typeof scripts[name] === 'string'; }
      } catch { return false; }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    return false;
  });
}

function runBin(args, ctx, via) {
  const i = args.findIndex((x) => !x.t.startsWith('-'));
  const flags = args.slice(0, i < 0 ? args.length : i);
  if (flags.some((f) => !['--no', '--no-install', '--'].includes(f.t))) ask(`the option ${flags.find((f) => !['--no', '--no-install', '--'].includes(f.t)).t} of ${via}`);
  if (i < 0) ask(`${via} with no program`);
  const bin = args[i].t;
  if (!binExists(bin, ctx)) ask(`${via} of ${bin}, which is not in the job's node_modules/.bin`);
  const rest = args.slice(i + 1);
  if (Object.hasOwn(LOCAL_PLAIN, bin)) { LOCAL_PLAIN[bin](rest, ctx); return; }
  if (!PROGRAMS[bin] || CUSTOM[bin]) ask(`${bin} is a program in node_modules/.bin that Starbase has no list of flags for`);
  check(PROGRAMS[bin], rest, ctx, bin);
}

function pkgCheck(prog, args, ctx) {
  if (prog === 'npx' || prog === 'bunx' || prog === 'pnpx') { runBin(args, ctx, prog); return; }
  const dd = args.findIndex((x) => x.t === '--');
  const before = dd < 0 ? args : args.slice(0, dd);
  const after = dd < 0 ? [] : args.slice(dd + 1);
  for (const x of after) pathInside(x, ctx);
  const { pos, vals } = parse(PKG_FLAGS, before, prog);
  for (const [, x] of vals) pathInside(x, ctx);
  const sub = pos[0]?.t;
  // workspace flags send a script to other packages, whose package.json is not the one read (C3)
  const wsFlag = before.some((x) => /^(-w|--workspace|--workspaces|-ws|--filter|-F|-r|--recursive)$/.test(x.t) || /^--(workspace|filter)=/.test(x.t) || /^-[wF]./.test(x.t));
  const noWorkspaces = () => { if (wsFlag) ask('a workspace flag with a script Starbase does not read'); };
  if (sub === 'config' || sub === 'c') ask(`${prog} config can print a token`);
  const more = pos.slice(1);
  const hasIgnore = before.some((x) => x.t === '--ignore-scripts');
  const names = (list) => { for (const x of list) if (!PKG_NAME.test(x.t) || pathlike(x.t) || /^(https?|git|file|github):/.test(x.t)) ask('a package that is not a plain registry name'); };
  const extraArgs = (list) => { for (const x of list) pathInside(x, ctx); };
  if (!sub) { if (prog === 'npm' || prog === 'pnpm' || prog === 'yarn' || prog === 'bun') { if (args.some((x) => x.t === '--version' || x.t === '-v')) return; if (prog === 'yarn' || prog === 'bun') ask(`${prog} with no command`); } ask(`${prog} with no command`); }
  if (['test', 't', 'tst', 'start', 'stop', 'restart'].includes(sub)) { noWorkspaces(); extraArgs(more); return; }
  if (['run', 'run-script', 'rum', 'urun'].includes(sub)) { noWorkspaces(); if (!more[0] || !SCRIPT_NAME.test(more[0].t) || (prog === 'bun' && (!BARE_SCRIPT.test(more[0].t) || FILE_LIKE.test(more[0].t)))) ask('a script name Starbase does not read'); extraArgs(more.slice(1)); return; }
  if (sub === 'ci') { if (more.length) ask('arguments to ci'); return; }
  if (['install', 'i', 'add'].includes(sub)) {
    if (sub === 'add' && !more.length) ask('add with no package');
    if (more.length) { names(more); if (!hasIgnore) ask('installing a package runs its install scripts'); }
    return;
  }
  if (['ls', 'list', 'outdated', 'view', 'info', 'root', 'bin'].includes(sub)) { names(more); return; }
  if (sub === 'audit' && !more.length) return;
  if (sub === 'pkg' && more[0]?.t === 'get') return;
  if (['exec', 'x'].includes(sub)) { noWorkspaces(); runBin(args.slice(args.findIndex((x) => x.t === sub) + 1), ctx, `${prog} ${sub}`); return; }
  if ((prog === 'pnpm' || prog === 'yarn' || prog === 'bun') && BARE_SCRIPT.test(sub) && !FILE_LIKE.test(sub) && !PKG_BUILTIN.has(sub) && scriptInPackage(sub, ctx)) { noWorkspaces(); extraArgs(more); return; }
  ask(`the ${prog} command ${sub}`);
}
const PKG_BUILTIN = new Set(['install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'upgrade', 'exec', 'dlx', 'x', 'init', 'create', 'list', 'ls', 'outdated', 'audit', 'why', 'pack', 'cache', 'config', 'info', 'view', 'link', 'unlink', 'prune', 'rebuild', 'dedupe', 'version', 'help', 'store', 'env', 'fetch', 'patch', 'import', 'root', 'bin', 'prefix', 'pkg', 'doctor', 'explain', 'diff', 'set', 'get', 'workspaces', 'workspace', 'global', 'dev', 'completion', 'publish', 'login', 'logout', 'npm', 'node', 'self-update', 'setup', 'star', 'org', 'hook', 'explore', 'team', 'token', 'access', 'owner']);

// ---------- language runtimes and shells ----------

function scriptRun(prog, flagSpec, args, ctx) {
  const { pos } = parse(flagSpec, args, prog);
  if (flagSpec.requireFile !== false) {
    if (!pos.length) ask(`${prog} with no script file`);
    mustBeInside(pos[0], ctx);
  }
  for (const x of pos.slice(1)) pathInside(x, ctx);
}
function nodeCheck(args, ctx) {
  const test = args.some((x) => x.t === '--test');
  const sp = spec('--test --enable-source-maps --trace-warnings --no-warnings --experimental-vm-modules --test-only --version -v --test-name-pattern: --test-reporter: --max-old-space-size:', {});
  if (args.length === 1 && (args[0].t === '--version' || args[0].t === '-v')) return;
  if (test) { const { pos } = parse(sp, args, 'node'); for (const x of pos) mustBeInside(x, ctx); return; }
  scriptRun('node', sp, args, ctx);
}
function pythonCheck(args, ctx) {
  if (args.length === 1 && /^(--version|-V)$/.test(args[0].t)) return;
  scriptRun('python', spec('u B O', {}), args, ctx);
}
function shellCheck(prog, args, ctx) { scriptRun(prog, spec('e u x', {}), args, ctx); }

function pipCheck(args) {
  const { pos } = parse(spec('--version -V', { pos: 'text' }), args, 'pip');
  if (!args.length || (pos.length === 0 && args.every((x) => /^(--version|-V)$/.test(x.t)))) { if (!args.length) ask('pip with no command'); return; }
  if (!['list', 'show', 'freeze', 'check'].includes(pos[0]?.t) || pos.length > 2) ask(`the pip command ${pos[0]?.t ?? ''}`);
}

// go and cargo: a subcommand table
const GO_BOOL = new Set(['-v', '-race', '-cover', '-short', '-failfast', '-json', '-benchmem', '-trimpath', '-n', '-x']);
const GO_VAL = new Set(['-run', '-count', '-timeout', '-bench', '-tags', '-coverprofile', '-p', '-parallel', '-cpu', '-vet', '-mod', '-o', '-ldflags']);
function goCheck(args, ctx) {
  const i = args.findIndex((x) => !x.t.startsWith('-'));
  if (i !== 0) ask('an option before the go command');
  const sub = args[0].t;
  if (sub === 'version') return;
  if (sub === 'mod') { if (!['tidy', 'download', 'verify'].includes(args[1]?.t) || args.length > 2) ask('a go mod command that changes modules'); return; }
  if (!['test', 'build', 'vet', 'fmt', 'env'].includes(sub)) ask(`the go command ${sub}`);
  for (let k = 1; k < args.length; k++) {
    const t = args[k].t;
    if (!t.startsWith('-')) { pathInside({ ...args[k], t: t.replace(/\/\.\.\.$/, '') || '.' }, ctx); continue; } // x/... is go's "every package under x"
    const name = t.split('=')[0];
    if (sub === 'env') ask('a go env option');
    if (GO_BOOL.has(name) && !t.includes('=')) continue;
    if (GO_VAL.has(name)) {
      const v = t.includes('=') ? { t: t.slice(t.indexOf('=') + 1), glob: false } : args[++k];
      if (!v) ask(`the value of ${name}`);
      if (name === '-o') mustBeInside(v, ctx); else pathInside(v, ctx);
      continue;
    }
    ask(`the option ${name} of go`);
  }
}
const CARGO_FLAGS = '--release -r --all-targets --workspace --all --lib --bin: --test: --example: --features: -F: --all-features --no-default-features --quiet -q --verbose -v --locked --frozen --offline --manifest-path: --target-dir: -p: --package: --jobs: -j: --no-run --no-fail-fast --check --no-deps';
const CARGO = Object.fromEntries(['build', 'test', 'check', 'clippy', 'fmt', 'doc', 'bench', 'tree', 'metadata', 'clean'].map((k) => [k, BUILD(CARGO_FLAGS)]));
function subTable(prog, table, args, ctx) {
  const i = args.findIndex((x) => !x.t.startsWith('-'));
  if (i < 0 || !table[args[i].t]) ask(`the ${prog} command ${args[i]?.t ?? ''}`);
  if (args.slice(0, i).length) ask(`an option before the ${prog} command`);
  const after = args.slice(i + 1);
  const dd = after.findIndex((x) => x.t === '--');
  const own = dd < 0 ? after : after.slice(0, dd);
  for (const x of dd < 0 ? [] : after.slice(dd + 1)) pathInside(x, ctx);
  check(table[args[i].t], own, ctx, `${prog} ${args[i].t}`);
}

// ---------- the env copy (I2) ----------

/**
 * `cp <main checkout>/<from> <to>` for a file the repository's profile copies into a worktree (filesToCopy):
 * from the repository's main checkout to the same relative place in one of the job's worktrees, judged from
 * each folder the command may run in. words: cp's arguments; cands: those folders; ctx: Auto's context.
 */
export function envCopy(words, cands, ctx) {
  if (!ctx || !Array.isArray(ctx.filesToCopy) || typeof ctx.mainCheckout !== 'string' || words.length !== 2) return false;
  if (words.some((t) => typeof t !== 'string' || !t || t.startsWith('-') || /[*?[\]{}$`\s]/.test(t))) return false;
  const main = physicalPath(ctx.mainCheckout, null);
  const trees = (ctx.worktrees ?? []).map((w) => physicalPath(w, null)).filter(Boolean);
  if (!main || !cands.length) return false;
  return cands.every((c) => {
    const from = physicalPath(words[0], c);
    const to = physicalPath(words[1], c);
    return Boolean(from && to) && ctx.filesToCopy.some((f) => typeof f?.from === 'string' && typeof f?.to === 'string'
      && from === path.join(main, f.from) && trees.some((w) => to === path.join(w, f.to)));
  });
}

// ---------- the dispatch ----------

const BASH_LIKE = new Set(['bash', 'sh', 'zsh']);

function runProgram(name, args, ctx, raw) {
  if (Object.hasOwn(LOCAL_PLAIN, name)) { if (!binExists(name, ctx)) ask(`${name}, which is not in the job's node_modules/.bin`); return LOCAL_PLAIN[name](args, ctx); }
  if (name === 'cp' && envCopy(args.map((x) => x.t), ctx.cands, ctx.ctx)) return; // the profile's env file into a worktree of the job (I2)
  if (CUSTOM[name]) return CUSTOM[name](args, ctx);
  if (name === 'git') return gitCheck(args, ctx);
  if (name === 'gh') return ghCheck(args, ctx);
  // Every lookup on the network is a question for the Approver on an Auto job: what it sends (an address can carry a secret) leaves the computer (C5).
  if (name === 'curl') { curlCheck(args, ctx); ask('a network lookup: what it sends leaves the computer'); }
  if (name === 'wget') { wgetCheck(args, ctx); ask('a network lookup: what it sends leaves the computer'); }
  if (['npm', 'pnpm', 'yarn', 'bun', 'npx', 'bunx', 'pnpx'].includes(name)) return pkgCheck(name, args, ctx);
  if (name === 'node') return nodeCheck(args, ctx);
  if (/^python[\d.]*$/.test(name)) return pythonCheck(args, ctx);
  if (BASH_LIKE.has(name)) return shellCheck(name, args, ctx);
  if (name === 'pip' || name === 'pip3') return pipCheck(args);
  if (name === 'go') return goCheck(args, ctx);
  if (name === 'cargo') return subTable('cargo', CARGO, args, ctx);
  const sp = PROGRAMS[name];
  if (!sp) ask(`${name} is not a program Starbase reads`);
  if (sp.free) return;
  const { pos, vals, flags } = check(sp, args, ctx, name);
  const hasPattern = vals.some(([f]) => ['-e', '--regexp', '-f', '--file'].includes(f)) || flags.has('--files') || flags.has('--type-list');
  if (['grep', 'egrep', 'fgrep'].includes(name) && ['-r', '-R', '--recursive'].some((f) => flags.has(f))) rootsInside(hasPattern ? pos : pos.slice(1), ctx);
  else if (name === 'rg') rootsInside(hasPattern ? pos : pos.slice(1), ctx);
  else if (name === 'diff' && ['-r', '--recursive'].some((f) => flags.has(f))) rootsInside(pos, ctx);
  else if (['tree', 'du'].includes(name) || (name === 'ls' && flags.has('-R')) ) rootsInside(pos, ctx);
  return raw;
}

function cdTargets(cmd, cands, roots) {
  const w = cmd.words.slice(1);
  if (w.length !== 1 || w[0].glob || w[0].t.startsWith('-') || w[0].t === '' || /^~[^/]/.test(w[0].t)) ask('a cd Starbase cannot follow');
  return cands.map((c) => {
    const p = physicalPath(w[0].t, c);
    if (!p) ask('a cd to a place Starbase cannot work out');
    return p;
  });
}

const GIT_READS = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'describe', 'blame', 'merge-base', 'for-each-ref', 'shortlog', 'cat-file', 'ls-tree', 'grep', 'check-ignore', 'rev-list', 'name-rev', 'count-objects', 'show-ref', 'symbolic-ref', 'ls-remote', 'version', 'config']);
const READ_ONLY = new Set(['cat', 'ls', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'echo', 'printf', 'pwd', 'whoami', 'id', 'uname', 'hostname', 'date', 'which', 'basename', 'dirname', 'realpath', 'sort', 'uniq', 'cut', 'tr', 'tree', 'diff', 'cmp', 'file', 'stat', 'du', 'df', 'shasum', 'sha1sum', 'sha256sum', 'md5sum', 'md5', 'cksum', 'test', '[', '[[', 'true', 'false', 'sleep', 'seq', 'exit']);

function redirectCheck(r, ctx) {
  if (/^\/dev\/null$/.test(r.target.t)) return;
  if (r.target.glob) ask('a redirect to a pattern');
  mustBeInside(r.target, ctx);
}

/** null when the command is plain, else a short phrase for the Approver and the audit. */
export function plainWhy(command, env = {}) {
  try {
    const cmds = lex(liftHeredocs(String(command ?? '')));
    if (!cmds.length) ask('an empty command');
    const roots = env.roots ?? [];
    const here = env.cwd ? physicalPath(env.cwd, null) : null;
    if (!here) ask('a folder Starbase cannot work out');
    let cands = [here];
    let pending = null;
    // A cd moves the commands joined to it by an unbroken && chain. Once any other separator follows, the
    // cd may have failed (or been skipped), so what comes next is judged against the old folders and the new (C2).
    let open = []; // the folders before each cd of the && chain now running
    let chainOk = true; // this command starts a list, or follows only && since its start
    let broughtIn = false; // an archive or a checkout just put files here: a link among them could be written through
    for (const cmd of cmds) {
      if (cmd.sep === '||' || cmd.sep === '|') chainOk = false; else if (cmd.sep !== '&&') chainOk = true;
      if (pending) {
        if (cmd.sep !== '&&') ask('a cd that is not followed by && (what comes next may run in either folder)');
        open.push(...pending.old);
        cands = pending.sure ? pending.news : [...new Set([...pending.old, ...pending.news])];
        pending = null;
      } else if (cmd.sep !== '&&' && open.length) { cands = [...new Set([...open, ...cands])]; open = []; }
      if (cands.length > 8) ask('a command that may run in too many folders');
      let ctx = { roots, cands, ctx: env.ctx, binBase: env.binBase ?? null };
      for (const r of cmd.redirects) { if (r.op === '<') { readablePath(r.target, ctx); } else redirectCheck(r, ctx); }
      let words = cmd.words;
      let i = 0;
      while (words[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i].t)) {
        if (!ALLOWED_ASSIGN.has(words[i].t.split('=')[0])) ask('an environment variable set before a command');
        i++;
      }
      words = words.slice(i);
      const before = words.length;
      while (words[0] && KEYWORDS.has(words[0].t)) words = words.slice(1);
      const keyword = words.length !== before; // if cd x, while cd x, ! cd x: the cd may fail and what follows still run
      if (!words.length) { if (i > 0) ask('a variable set on its own'); continue; }
      const head = words[0];
      if (head.glob) ask('a program chosen by a pattern');
      if (['fi', 'done'].includes(head.t) && words.length === 1) continue;
      if (head.t === 'for') {
        if (!(words[2]?.t === 'in') || !/^[A-Za-z_]\w*$/.test(words[1]?.t ?? '')) ask('a for loop Starbase does not read');
        continue;
      }
      if (head.t === 'cd') {
        const news = cdTargets(cmd, cands, roots);
        if (!news.every((p) => inRoots(p, roots))) ask('a cd to a folder outside the job');
        pending = { old: cands, news, sure: chainOk && !keyword };
        continue;
      }
      let args = words.slice(1);
      let name = head.t;
      let here = cands; // where this command runs
      // git -C <a worktree of the job> is that git command run there; the main checkout only for git's reads (m11).
      if (name === 'git' && args[0]?.t === '-C') {
        const d = args[1];
        if (!d || d.glob || d.t === '' || args[2]?.t === '-C') ask('the git subcommand option -C');
        const dirs = cands.map((c) => physicalPath(d.t, c));
        const trees = (Array.isArray(env.ctx?.worktrees) ? env.ctx.worktrees : []).map((w) => physicalPath(w, null)).filter(Boolean);
        const main = typeof env.ctx?.mainCheckout === 'string' ? physicalPath(env.ctx.mainCheckout, null) : null;
        const rest = args.slice(2);
        const sub = rest.find((x) => !x.t.startsWith('-'))?.t;
        const inTree = dirs.every((p) => p && trees.some((w) => isInside(p, w)));
        const mainRead = dirs.every((p) => p && main && isInside(p, main)) && GIT_READS.has(sub) && sub !== 'config';
        if (!inTree && !mainRead) ask('the git subcommand option -C');
        args = rest;
        here = dirs;
        ctx = { ...ctx, cands: dirs };
      }
      if (name.includes('/')) {
        const at = physicalPath(name, cands[0]);
        const bin = at && /\/node_modules\/\.bin\/([^/]+)$/.exec(at);
        if (!inRoots(at, roots) || !cands.every((c) => inRoots(physicalPath(name, c), roots))) ask('a program given by a path outside the job');
        if (bin) name = bin[1]; else { for (const x of args) pathInside(x, ctx); continue; } // a script of the job's own: its text is read by the caller
      }
      if (!READ_ONLY.has(name) && !(name === 'git' && GIT_READS.has(args.find((x) => !x.t.startsWith('-'))?.t)) && !here.every((c) => inRoots(physicalPath('.', c), roots))) ask('a command that changes things, run from a folder outside the job');
      words.forEach((x, k) => {
        if (!x.t.includes(HEREDOC)) return;
        const message = name === 'git' && args[0]?.t === 'commit' && ((x.t === HEREDOC && ['-m', '--message'].includes(words[k - 1]?.t)) || x.t === `--message=${HEREDOC}`);
        // The same form as a pull request's body (I2).
        const body = name === 'gh' && args.filter((y) => !y.t.startsWith('-'))[0]?.t === 'pr' && args.filter((y) => !y.t.startsWith('-'))[1]?.t === 'create' && ((x.t === HEREDOC && ['--body', '-b'].includes(words[k - 1]?.t)) || x.t === `--body=${HEREDOC}`);
        if (!message && !body) ask('a here-document that is not a commit message or a pull request body'); // -F, --file, -t and the rest read a file by that name
      });
      const sub = args.find((x) => !x.t.startsWith('-'))?.t;
      // After an archive or a checkout, merge, pull, reset… has changed the files, only reads and git go on: a link, a
      // package.json or a Makefile that just arrived could be written through or run in the same call.
      if (broughtIn && !READ_ONLY.has(name) && name !== 'git' && name !== 'gh') ask('a program run after an archive or a git command changed the files');
      if (broughtIn && cmd.redirects.some((r) => r.op !== '<')) ask('a file written after an archive or a git command changed the files');
      const newBranch = args.some((x) => ['-b', '-B', '-c', '-C'].includes(x.t));
      if (name === 'tar' || name === 'unzip' || (name === 'gh' && args.filter((x) => !x.t.startsWith('-'))[0]?.t === 'pr' && args.filter((x) => !x.t.startsWith('-'))[1]?.t === 'checkout') || (name === 'git' && !newBranch && ['checkout', 'switch', 'pull', 'merge', 'rebase', 'reset', 'restore', 'cherry-pick', 'revert', 'clone'].includes(sub))) broughtIn = true;
      runProgram(name, args, ctx, null);
    }
    return null;
  } catch (e) {
    if (e instanceof Ask) return e.message;
    throw e;
  }
}
