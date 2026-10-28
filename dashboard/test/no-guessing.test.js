// No repository guessing is left in the dashboard's code (plan §11 J): Try it's first port, the org
// remote's name, the settings file, the dev command and the ticket folder pattern come from the
// repository's profile (lib/profile.js, lib/repos.js, profiles/orbit.md). This reads every .js file
// in lib/, runner/ and site/, drops the comments, and looks for those guesses in what is left.
// profile.js (the general case lives there) and the hard lines' floor are allowed; anything else
// still here is in EXCEPTIONS with the reason, and each exception must still match (so the list
// shrinks as they go).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['lib', 'runner', 'site'];
const ALLOWED_FILES = new Set(['lib/profile.js']);

// Each rule: a name, where it looks (code: strings and code without comments; regex: regex literals), and what it finds.
const RULES = [
  { name: 'the first port 3001', where: 'code', re: /\b3001\b/ },
  { name: 'the org remote "moxie"', where: 'code', re: /(['"`])moxie\1/ },
  { name: 'the org on GitHub (moxie…) in a pattern', where: 'regex', re: /moxie/i },
  { name: 'the settings file .env.local', where: 'code', re: /\.env\.local/ },
  { name: 'the dev command npm run dev', where: 'code', re: /npm run dev/ },
  { name: 'the ticket folder pattern orbit-…', where: 'code', re: /orbit-(?:\$\{|\{|\(|\\d|['"`<])/ },
];

// What is left on purpose, each with why. file + a piece of the line + the rule's name.
const EXCEPTIONS = [
  { file: 'lib/hard-lines.js', has: "Object.freeze(['moxie'])", rule: 'the org remote "moxie"', why: 'the hard lines’ floor: the org remote is never pushed to, whatever the registry holds' },
  { file: 'lib/hard-lines.js', has: 'ORG_URL_FLOOR = /github', rule: 'the org on GitHub (moxie…) in a pattern', why: 'the hard lines’ floor: a github.com/moxie… address is the org’s' },
  { file: 'lib/hard-lines.js', has: 'repos\\/moxie[^\\n;&|]*\\/git\\/refs', rule: 'the org on GitHub (moxie…) in a pattern', why: 'the org-branch hard line (gh api …/git/refs): not J’s to change; under Needs from others' },
  { file: 'lib/policy.js', has: 'ORG_REFS_PATH', rule: 'the org on GitHub (moxie…) in a pattern', why: 'the same hard line for the GitHub connection’s calls: not J’s to change; under Needs from others' },
  { file: 'lib/decisions.js', has: '/^orbit-(\\d+)', rule: 'the ticket folder pattern orbit-…', why: 'reads an Orbit ticket number back out of a job’s folder name: not J’s to change; under Needs from others' },
  { file: 'lib/orbit.js', has: '/^orbit-(\\d{1,9})', rule: 'the ticket folder pattern orbit-…', why: 'the Orbit inbox reads a ticket number back out of a job’s folder name: not J’s to change; under Needs from others' },
];

/**
 * The file's text split into code and regex literals, with the comments taken out. Strings and
 * template literals stay in the code (a guess in a string is still a guess). Line breaks are kept,
 * so line numbers still match the file.
 */
function splitSource(src) {
  let code = '';
  const regexes = []; // { line, text }
  let i = 0;
  let line = 1;
  let lastSignificant = ''; // the last non-space character of code, to tell a regex from a division
  let lastWord = '';
  const templateDepth = []; // brace depth at each open ${ in a template literal
  let braces = 0;
  const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);
  const emit = (s) => { code += s; for (const ch of s) if (ch === '\n') line++; };
  let word = ''; // the identifier being read, so "return /re/" is known for a regex
  const significant = (ch) => {
    lastSignificant = ch;
    if (/[\w$]/.test(ch)) { word += ch; lastWord = word; } else { word = ''; lastWord = ''; }
  };
  function readString(q) {
    let s = q;
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') { s += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
      if (src[i] === '\n') break;
      s += src[i++];
    }
    s += src[i] ?? '';
    i++;
    return s;
  }
  function readTemplate() {
    // From a ` (or after a closing } of ${…}) to the closing ` or the next ${.
    let s = '';
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') { s += ch + (src[i + 1] ?? ''); i += 2; continue; }
      if (ch === '`') { s += ch; i++; return { s, open: false }; }
      if (ch === '$' && src[i + 1] === '{') { s += '${'; i += 2; return { s, open: true }; }
      s += ch;
      i++;
    }
    return { s, open: false };
  }
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const body = src.slice(i, end < 0 ? src.length : end + 2);
      emit(body.replace(/[^\n]/g, ''));
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") { const s = readString(ch); emit(s); significant('x'); continue; }
    if (ch === '`') {
      i++;
      const t = readTemplate();
      emit('`' + t.s);
      if (t.open) templateDepth.push(braces);
      significant('x');
      continue;
    }
    if (ch === '{') { braces++; emit(ch); significant(ch); i++; continue; }
    if (ch === '}') {
      if (templateDepth.length && templateDepth[templateDepth.length - 1] === braces) {
        templateDepth.pop();
        i++;
        const t = readTemplate();
        emit('}' + t.s);
        if (t.open) templateDepth.push(braces);
        significant('x');
        continue;
      }
      braces--;
      emit(ch);
      significant(ch);
      i++;
      continue;
    }
    if (ch === '/' && (REGEX_AFTER.has(lastSignificant) || REGEX_WORDS.has(lastWord))) {
      // A regex literal: to the closing / outside a [class], then its flags.
      const start = i;
      let inClass = false;
      i++;
      while (i < src.length && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        i++;
      }
      i++;
      while (i < src.length && /[a-z]/i.test(src[i])) i++;
      const text = src.slice(start, i);
      regexes.push({ line, text });
      emit(text);
      significant('x');
      continue;
    }
    emit(ch);
    if (/\s/.test(ch)) word = '';
    else significant(ch);
    i++;
  }
  return { code, regexes };
}

function* sourceFiles() {
  for (const dir of DIRS) {
    const walk = function* (d) {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) yield* walk(p);
        else if (ent.name.endsWith('.js')) yield p;
      }
    };
    yield* walk(path.join(ROOT, dir));
  }
}

/** Every guess left: { file, line, rule, text }. */
function findGuesses() {
  const found = [];
  for (const abs of sourceFiles()) {
    const file = path.relative(ROOT, abs).split(path.sep).join('/');
    if (ALLOWED_FILES.has(file)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    const { code, regexes } = splitSource(src);
    const lines = src.split('\n');
    const codeLines = code.split('\n');
    for (const rule of RULES) {
      if (rule.where === 'code') {
        codeLines.forEach((l, n) => { if (rule.re.test(l)) found.push({ file, line: n + 1, rule: rule.name, text: lines[n].trim() }); });
      } else {
        for (const r of regexes) if (rule.re.test(r.text)) found.push({ file, line: r.line, rule: rule.name, text: lines[r.line - 1].trim() });
      }
    }
  }
  return found;
}

test('the comment stripper keeps code, strings, templates and regex literals, and drops comments', () => {
  const src = [
    "const a = 'x // not a comment'; // a comment with 3001",
    '/* a block',
    '   with npm run dev */ const b = `t ${ { c: 1 }.c } npm run dev`;',
    'const r = /a\\/b[/]c/i.test(s) ? 10 / 2 / 1 : 0;',
    "if (x) return /moxie/.test(y); // moxie",
  ].join('\n');
  const { code, regexes } = splitSource(src);
  assert.equal(code.split('\n').length, 5, 'the line breaks are kept');
  assert.doesNotMatch(code, /3001/);
  assert.match(code, /x \/\/ not a comment/);
  assert.match(code.split('\n')[2], /npm run dev`/);
  assert.doesNotMatch(code.split('\n')[1], /npm run dev/);
  assert.deepEqual(regexes.map((r) => [r.line, r.text]), [[4, '/a\\/b[/]c/i'], [5, '/moxie/']]);
});

test('no repository guess is left in lib/, runner/ or site/ outside profile.js, the hard lines’ floor and comments', () => {
  const found = findGuesses();
  const excused = (g) => EXCEPTIONS.some((e) => e.file === g.file && e.rule === g.rule && g.text.includes(e.has));
  const left = found.filter((g) => !excused(g));
  assert.deepEqual(left.map((g) => `${g.file}:${g.line} ${g.rule}: ${g.text}`), [], 'take these from the repository’s profile (lib/profile.js), or add an exception with the reason');
  // Each exception is still there: drop it from the list once its line is gone.
  for (const e of EXCEPTIONS) {
    assert.ok(found.some((g) => g.file === e.file && g.rule === e.rule && g.text.includes(e.has)), `the exception in ${e.file} (${e.has}) is gone: take it off the list`);
  }
});
