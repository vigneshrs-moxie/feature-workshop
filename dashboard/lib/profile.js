// A repository's profile: how work is done there (plan G10, §5 "Repos"). It is a short Markdown
// file, ground-control.md, in the repository's root (or a copy the runner's registry keeps, as for
// Orbit: dashboard/profiles/orbit.md). The settings sit in a block between two --- lines at the top;
// everything below is free notes for people.
//
// Only a small, strict part of YAML is read, with no extra dependency:
//   key: value              a setting (quotes are optional; "…" or '…' keep a # or leading spaces)
//   key:                    followed by lines two spaces further in: settings inside it,
//     inner: value
//   key:                    or a list, one "- " line per item; an item can hold settings of its own
//     - item
//     - from: a
//       to: b
//   # a comment             on a line of its own, or after a value that has no quotes
// Anything else (tabs, odd indents, [a, b], {a: b}, several documents) is an error in plain words.
//
//   parseProfile(text)        the text → { ok, profile, errors, warnings }
//   loadProfile(dirOrFile)    reads <dir>/ground-control.md, or the file named, the same way
//   fillPattern(p, values)    fills {slug}, {n}, {kind}, {title}, {port} (and {key}, {app})
//   GENERAL                   what a repository with no profile gets: today's general case
//   tryItRules(profile)       the Try it rules for a job: the profile's, or GENERAL's
//   devCommand(rules, …)      the command that starts the app on a port
//
// Unknown keys are kept (profile.extra) and named in `warnings`; they never stop a profile loading.

import fsp from 'node:fs/promises';
import path from 'node:path';

/** The profile's file name in a repository's root. */
export const PROFILE_FILE = 'ground-control.md';
/** The largest profile read (bytes): a profile is a short file. */
export const PROFILE_MAX_BYTES = 64 * 1024;

// ---------- The general case ----------

// A repository with no profile works as it always has: the app is looked for in the usual folders,
// .env.local is copied and pointed at the job's port with the local sign-in skip turned on, the app
// starts with its dev script, ports count up from 3001, and the worktree is the /feature skill's own
// default (SKILL.md, Implement step 3) until the skill reads the profile too.
const GENERAL_URL_KEYS = ['AUTH_URL', 'NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL', 'APP_URL', 'NEXT_PUBLIC_SITE_URL', 'SITE_URL'];
const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };
export const GENERAL = deepFreeze({
  name: null,
  github: null,
  slug: '{key}-{title}',
  branch: '{kind}/{slug}',
  kinds: { feature: 'feature', bug: 'fix' },
  worktree: '../orbit-{slug}',
  tryIt: {
    app: null,
    appSearch: ['', 'app', 'web', 'frontend', 'client', 'apps/web'],
    command: null, // the dev script, with the port and this computer only when it is a Next.js app
    ports: { first: 3001, last: null },
    url: 'http://localhost:{port}',
  },
  filesToCopy: [{ from: '{app}/.env.local', to: '{app}/.env.local', portKeys: GENERAL_URL_KEYS, signInSkip: 'DEV_BYPASS_AUTH' }],
  database: { urlKey: 'DATABASE_URL', name: null, check: null },
});

// ---------- Patterns ----------

const PLACEHOLDER = /\{([a-z]+)\}/g;
const SEPARATORS = '-_./';

/**
 * Fills {name} with values[name]. A value that is missing or empty takes one separator next to it
 * with it (the one before, else the one after), so "orbit-{n}-{title}" with no title is "orbit-7".
 * A placeholder with no entry in `values` at all is left as it is.
 */
export function fillPattern(pattern, values = {}) {
  const text = String(pattern ?? '');
  let out = '';
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const [whole, name] = m;
    out += text.slice(last, m.index);
    last = m.index + whole.length;
    if (!Object.hasOwn(values, name)) { out += whole; continue; }
    const v = values[name] === null || values[name] === undefined ? '' : String(values[name]);
    if (v) { out += v; continue; }
    if (out && SEPARATORS.includes(out.at(-1))) out = out.slice(0, -1);
    else if (SEPARATORS.includes(text[last] ?? '')) last += 1;
  }
  return out + text.slice(last);
}

const placeholders = (pattern) => [...String(pattern).matchAll(PLACEHOLDER)].map((m) => m[1]);

// ---------- Reading the block ----------

/** The settings block and the notes below it, or { error }. */
export function splitFrontMatter(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return { error: 'The file must start with a line of three dashes (---), then the settings, then another line of three dashes.' };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return { error: 'The settings at the top never end: put a line of three dashes (---) after them.' };
  return { block: lines.slice(1, end), firstLine: 2, notes: lines.slice(end + 1).join('\n').trim() };
}

const KEY = /^([A-Za-z][\w-]*):(?:\s+(.*)|\s*)$/;
const isItem = (t) => t === '-' || t.startsWith('- ');
const isMapItem = (t) => /^[A-Za-z][\w-]*:(\s|$)/.test(t);

// One value: quoted ("…" with \" and \\, or '…' with ''), or plain text up to a " #" comment.
function scalar(raw, no, errors) {
  const t = raw.trim();
  const q = t[0];
  if (q === '"' || q === "'") {
    let out = '';
    let i = 1;
    for (; i < t.length; i++) {
      const c = t[i];
      if (q === '"' && c === '\\' && i + 1 < t.length) { const n = t[++i]; out += n === 'n' ? '\n' : n; continue; }
      if (c === q) {
        if (q === "'" && t[i + 1] === "'") { out += "'"; i++; continue; }
        break;
      }
      out += c;
    }
    if (i >= t.length) { errors.push(`Line ${no}: a quote is opened and never closed.`); return out; }
    const after = t.slice(i + 1).trim();
    if (after && !after.startsWith('#')) errors.push(`Line ${no}: there is text after the closing quote.`);
    return out;
  }
  if (q === '[' || (q === '{' && /^\{[^}]*:/.test(t))) errors.push(`Line ${no}: write lists and groups on lines of their own (- item, or key: value two spaces in), not in brackets.`);
  return t.replace(/\s+#.*$/, '');
}

function parseNode(lines, i, indent, errors) {
  return isItem(lines[i].text) ? parseList(lines, i, indent, errors) : parseMap(lines, i, indent, errors);
}

// Lines deeper than they should be: one error, then skipped.
function skipDeeper(lines, i, indent, errors) {
  if (i < lines.length && lines[i].indent > indent) {
    errors.push(`Line ${lines[i].no}: this line is further in than the line above allows.`);
    while (i < lines.length && lines[i].indent > indent) i++;
  }
  return i;
}

// What follows "key:" or "-" with nothing after it: a block two spaces further in, or nothing.
function parseChild(lines, i, indent, errors) {
  if (i < lines.length && lines[i].indent > indent) {
    if (lines[i].indent !== indent + 2) {
      errors.push(`Line ${lines[i].no}: indent with two spaces per level.`);
      return [null, skipDeeper(lines, i, indent, errors)];
    }
    return parseNode(lines, i, indent + 2, errors);
  }
  return [null, i];
}

function parseMap(lines, i, indent, errors) {
  const out = {};
  while (i < lines.length && lines[i].indent === indent && !isItem(lines[i].text)) {
    const { no, text } = lines[i];
    const m = KEY.exec(text);
    if (!m) { errors.push(`Line ${no}: expected a setting written as “name: value”.`); i = skipDeeper(lines, i + 1, indent, errors); continue; }
    const [, key, rest] = m;
    if (Object.hasOwn(out, key)) errors.push(`Line ${no}: “${key}” is given twice.`);
    const value = rest === undefined ? '' : rest.replace(/^#.*$/, '');
    if (value.trim()) { out[key] = scalar(value, no, errors); i = skipDeeper(lines, i + 1, indent, errors); continue; }
    let child;
    [child, i] = parseChild(lines, i + 1, indent, errors);
    out[key] = child;
  }
  return [out, i];
}

function parseList(lines, i, indent, errors) {
  const out = [];
  while (i < lines.length && lines[i].indent === indent && isItem(lines[i].text)) {
    const { no, text } = lines[i];
    const rest = text.slice(1).trim();
    if (!rest || rest.startsWith('#')) {
      let child;
      [child, i] = parseChild(lines, i + 1, indent, errors);
      out.push(child);
    } else if (isMapItem(rest)) {
      // "- key: value": the item's settings start here, two spaces in from the dash.
      const copy = lines.slice();
      copy[i] = { no, indent: indent + 2, text: rest };
      let item;
      [item, i] = parseMap(copy, i, indent + 2, errors);
      out.push(item);
    } else {
      out.push(scalar(rest, no, errors));
      i = skipDeeper(lines, i + 1, indent, errors);
    }
  }
  return [out, i];
}

/** The settings block's lines → a value (an object at the top), with errors in plain words. */
export function parseBlock(block, firstLine = 1) {
  const errors = [];
  const lines = [];
  block.forEach((raw, k) => {
    const no = firstLine + k;
    if (!raw.trim() || /^\s*#/.test(raw)) return;
    if (/^\s*\t/.test(raw)) { errors.push(`Line ${no}: use spaces, not tabs, to indent.`); return; }
    const indent = raw.length - raw.trimStart().length;
    if (indent % 2) { errors.push(`Line ${no}: indent with two spaces per level.`); return; }
    lines.push({ no, indent, text: raw.trim() });
  });
  if (!lines.length) return { data: {}, errors };
  if (lines[0].indent !== 0) errors.push(`Line ${lines[0].no}: the first setting must start at the left edge.`);
  if (isItem(lines[0].text)) { errors.push(`Line ${lines[0].no}: the settings must be “name: value” lines, not a list.`); return { data: {}, errors }; }
  const [data, end] = parseMap(lines, 0, lines[0].indent, errors);
  if (end < lines.length) errors.push(`Line ${lines[end].no}: this line doesn’t fit under the settings above it (check its indent).`);
  return { data, errors };
}

// ---------- The fields ----------

const isMap = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const REMOTE = /^[\w][\w.-]{0,99}$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const SAFE_REL = (p) => Boolean(p) && !path.isAbsolute(p) && !/^[A-Za-z]:/.test(p) && !p.split(/[\\/]/).includes('..');

// Each known key: its check. A check gets (value, say) and returns the normal form, or calls
// say(message) for each problem. Groups ({ keys }) and lists of groups ({ each }) hold their own.
const KNOWN = {
  name: { check: (v, say) => text(v) || say('must be the repository’s name, like Orbit.') },
  github: { check: (v, say) => (/^[\w.-]+\/[\w.-]+$/.test(text(v)) ? text(v) : say('must look like org/repo, like Moxie-Pest-Control-Phoenix/moxie-portal.')) },
  remotes: {
    keys: {
      fork: { check: (v, say) => (REMOTE.test(text(v)) ? text(v) : say('must be a remote’s name, like origin.')) },
      org: { check: (v, say) => (REMOTE.test(text(v)) ? text(v) : say('must be a remote’s name, like moxie.')) },
    },
  },
  base: { check: (v, say) => (/^[\w.-]+\/[\w./-]+$/.test(text(v)) ? text(v) : say('must be a remote and a branch, like moxie/main.')) },
  worktree: { check: (v, say) => pattern(v, say, { need: ['slug'], allow: ['slug', 'n', 'title'], like: '../orbit-{slug}', path: true }) },
  branch: { check: (v, say) => pattern(v, say, { needOne: ['slug', 'n', 'title'], allow: ['kind', 'slug', 'n', 'title'], like: '{kind}/{slug}', ref: true }) },
  slug: { check: (v, say) => pattern(v, say, { needOne: ['n', 'title', 'key'], allow: ['n', 'title', 'key'], like: 'orbit-{n}-{title}', slug: true }) },
  kinds: {
    keys: {
      feature: { check: (v, say) => (/^[\w.-]+$/.test(text(v)) ? text(v) : say('must be one word for a branch, like feature.')) },
      bug: { check: (v, say) => (/^[\w.-]+$/.test(text(v)) ? text(v) : say('must be one word for a branch, like fix.')) },
    },
  },
  prRoute: { check: (v, say) => lines(v, say, 'must be a list of steps, one “- ” line each.') },
  riskFloors: {
    each: {
      path: { required: true, check: (v, say) => text(v) || say('must name the files it covers, like app/prisma/**.') },
      level: { required: true, check: (v, say) => (/^[0-3]$/.test(text(v)) ? Number(text(v)) : say('must be a level from 0 to 3.')) },
      why: { check: (v, say) => text(v) || say('must say in a few words why, or be left out.') },
    },
    says: 'must be a list, one “- path: …” item with its level for each.',
  },
  tryIt: {
    keys: {
      app: { check: (v, say) => (text(v) === '.' ? '' : SAFE_REL(text(v)) ? text(v).replace(/[\\/]+$/, '') : say('must be the app’s folder inside the repository, like app.')) },
      command: { check: (v, say) => text(v) || say('must be the command that starts the app, like npm run dev -- -p {port}.') },
      ports: { check: (v, say) => portRange(v, say) },
      url: {
        check: (v, say) => (/^https?:\/\/\S+$/.test(text(v)) && placeholders(text(v)).includes('port') && placeholders(text(v)).every((p) => p === 'port')
          ? text(v) : say('must be a web address with {port} in it, like http://localhost:{port}.')),
      },
    },
  },
  filesToCopy: {
    each: {
      from: { required: true, check: (v, say) => (SAFE_REL(text(v)) ? text(v) : say('must be a file inside your main checkout, like app/.env.local.')) },
      to: { required: true, check: (v, say) => (SAFE_REL(text(v)) ? text(v) : say('must be a file inside the worktree, like app/.env.local.')) },
      portKeys: { check: (v, say) => keyList(v, say) },
      signInSkip: { check: (v, say) => (ENV_KEY.test(text(v)) ? text(v) : say('must be the name of one setting, like DEV_BYPASS_AUTH.')) },
    },
    says: 'must be a list, one “- from: …” item with its “to:” for each file.',
  },
  database: {
    keys: {
      urlKey: { check: (v, say) => (ENV_KEY.test(text(v)) ? text(v) : say('must be the name of the setting holding the database address, like DATABASE_URL.')) },
      name: { check: (v, say) => (/^[A-Za-z0-9_]{1,50}$/.test(text(v)) ? text(v) : say('must be the local database’s name: letters, numbers and _ only.')) },
      check: { check: (v, say) => text(v) || say('must be a command that says whether the database is up, or be left out.') },
    },
  },
  setup: { check: (v, say) => lines(v, say, 'must be a list of commands, one “- ” line each.') },
  cleanup: { check: (v, say) => lines(v, say, 'must be a list of commands, one “- ” line each.') },
};

function pattern(v, say, { need = [], needOne = null, allow, like, path: isPath = false, ref = false, slug = false }) {
  const t = text(v);
  if (!t) return say(`must be a pattern, like ${like}.`);
  const used = placeholders(t);
  const odd = used.filter((p) => !allow.includes(p));
  if (odd.length) return say(`can’t use {${odd[0]}}: it can use ${allow.map((p) => `{${p}}`).join(', ')}.`);
  if (need.some((p) => !used.includes(p)) || (needOne && !needOne.some((p) => used.includes(p)))) {
    return say(`must have ${needOne ? needOne.map((p) => `{${p}}`).join(' or ') : need.map((p) => `{${p}}`).join(' and ')} in it, like ${like}.`);
  }
  const bare = t.replace(PLACEHOLDER, 'x');
  if (slug && !/^[a-z0-9-]+$/.test(bare)) return say(`may use only lower-case letters, numbers and dashes, like ${like}.`);
  if (ref && (!/^[\w./-]+$/.test(bare) || /(^|\/)\.|\.\.|\/$|^\//.test(bare))) return say(`must make a usable branch name, like ${like}.`);
  if (isPath && path.isAbsolute(bare)) return say(`must be a folder next to the repository, like ${like}.`);
  return t;
}

function portRange(v, say) {
  const m = /^(\d{2,5})\s*-\s*(\d{2,5})$/.exec(text(v));
  const [first, last] = m ? [Number(m[1]), Number(m[2])] : [];
  if (!m || first < 1024 || last > 65535 || first > last) return say('must look like 3001-3099: the first and the last port, from 1024 to 65535.');
  return { first, last };
}

function lines(v, say, says) {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) return say(says);
  return v.map((x) => x.trim());
}

function keyList(v, say) {
  if (!Array.isArray(v) || v.some((x) => !ENV_KEY.test(text(x)))) return say('must be a list of setting names, one “- ” line each, like - AUTH_URL.');
  return v.map(text);
}

// Checks `data` against `spec` (a map of known keys). where: how a person finds the place ("" at the
// top, " (under tryIt)", " (in filesToCopy, item 2)"). Unknown keys go to extra and warnings.
function checkKeys(data, spec, where, errors, warnings, extra) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    const rule = spec[key];
    if (!rule) {
      extra[key] = value;
      warnings.push(`Ground Control doesn’t know “${key}”${where}, so it is kept but not used.`);
      continue;
    }
    const say = (msg) => { errors.push(`${key}${where} ${msg}`); return undefined; };
    if (value === null || value === '') { say(rule.keys ? 'is empty: put its settings on the lines below it, two spaces in.' : rule.each ? rule.says : 'is empty.'); continue; }
    if (rule.keys) {
      if (!isMap(value)) { say('must hold settings of its own, on the lines below it, two spaces in.'); continue; }
      const inner = {};
      out[key] = checkKeys(value, rule.keys, ` (under ${key})`, errors, warnings, inner);
      if (Object.keys(inner).length) extra[key] = inner;
      continue;
    }
    if (rule.each) {
      if (!Array.isArray(value) || value.some((x) => !isMap(x))) { say(rule.says); continue; }
      out[key] = value.map((item, k) => {
        const inner = {};
        const at = ` (in ${key}, item ${k + 1})`;
        const got = checkKeys(item, rule.each, at, errors, warnings, inner);
        for (const [name, r] of Object.entries(rule.each)) if (r.required && !Object.hasOwn(item, name)) errors.push(`${name}${at} is missing.`);
        return got;
      });
      continue;
    }
    const got = rule.check(value, say);
    if (got !== undefined) out[key] = got;
  }
  return out;
}

/** A profile's text → { ok, profile, errors, warnings }. ok: no errors (warnings don't count). */
export function parseProfile(source) {
  const split = splitFrontMatter(source);
  if (split.error) return { ok: false, profile: null, errors: [split.error], warnings: [] };
  const { data, errors } = parseBlock(split.block, split.firstLine);
  const warnings = [];
  const extra = {};
  const profile = checkKeys(isMap(data) ? data : {}, KNOWN, '', errors, warnings, extra);
  if (!profile.name && !errors.some((e) => e.startsWith('name '))) errors.push('name is missing: say which repository this is, like “name: Orbit”.');
  if (profile.remotes?.fork && profile.remotes.fork === profile.remotes.org) errors.push('remotes: fork and org must be two different remotes.');
  if (profile.base && profile.remotes?.org && !profile.base.startsWith(`${profile.remotes.org}/`)) warnings.push(`base (${profile.base}) isn’t on the org remote (${profile.remotes.org}): check that is what you meant.`);
  const keyed = (profile.filesToCopy ?? []).filter((f) => f.portKeys?.length || f.signInSkip);
  if (keyed.length > 1) warnings.push('Only the first file in filesToCopy with portKeys or signInSkip is shown as the job’s settings file.');
  profile.extra = extra;
  profile.notes = split.notes;
  return { ok: errors.length === 0, profile, errors, warnings };
}

/**
 * Reads a profile: `dirOrFile` is a repository folder (its ground-control.md) or a profile file.
 * Returns { ok, profile, errors, warnings, file }; a file that can't be read is an error, too.
 */
export async function loadProfile(dirOrFile) {
  let file = String(dirOrFile ?? '');
  try {
    if ((await fsp.stat(file)).isDirectory()) file = path.join(file, PROFILE_FILE);
  } catch { /* reported below */ }
  let st;
  try { st = await fsp.stat(file); } catch { return { ok: false, profile: null, errors: [`There is no profile at ${file}.`], warnings: [], file }; }
  if (!st.isFile()) return { ok: false, profile: null, errors: [`${file} isn’t a file.`], warnings: [], file };
  if (st.size > PROFILE_MAX_BYTES) return { ok: false, profile: null, errors: [`${file} is too big for a profile (more than 64 KB).`], warnings: [], file };
  let source;
  try { source = await fsp.readFile(file, 'utf8'); } catch (err) { return { ok: false, profile: null, errors: [`${file} can’t be read (${err.code ?? err.message}).`], warnings: [], file }; }
  return { ...parseProfile(source), file };
}

// ---------- What the rest of Ground Control reads ----------

/** The GitHub org of a profile (the part before the slash), or null. */
export const githubOrg = (profile) => (profile?.github ? profile.github.split('/')[0] : null);

/** "Owner/name" for a GitHub address (https or ssh), or null. */
export function githubOfUrl(url) {
  const m = /github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(String(url ?? ''));
  return m ? `${m[1]}/${m[2]}` : null;
}

/** "3001-3099" (or "3001 and up") for a port range. */
export const portsLabel = (ports) => (ports ? (ports.last ? `${ports.first}-${ports.last}` : `${ports.first} and up`) : null);

/**
 * The Try it rules for a job in a repository with this profile (null: no profile, the general case):
 * { profile, appDirs, command, ports, url, files, dbUrlKey, dbName }. files keep {app} for the app
 * folder found; the caller fills it.
 */
export function tryItRules(profile) {
  const t = profile?.tryIt ?? {};
  const files = profile ? (profile.filesToCopy ?? []) : GENERAL.filesToCopy;
  return {
    profile: profile ? { name: profile.name, github: profile.github ?? null } : null,
    appDirs: t.app !== undefined ? [t.app] : [...GENERAL.tryIt.appSearch],
    command: profile ? t.command ?? null : GENERAL.tryIt.command,
    ports: t.ports ?? GENERAL.tryIt.ports,
    url: t.url ?? GENERAL.tryIt.url,
    files: files.map((f) => ({ from: f.from, to: f.to, portKeys: f.portKeys ?? [], signInSkip: f.signInSkip ?? null })),
    dbUrlKey: profile?.database?.urlKey ?? (profile ? null : GENERAL.database.urlKey),
    dbName: profile?.database?.name ?? null,
  };
}

/** The general rule for a settings file (lib/local.js envChanges without a rule). */
export const GENERAL_FILE_RULE = GENERAL.filesToCopy[0];

/**
 * The command that starts the app on `port`: the profile's (its {port} filled), else the app's own
 * dev script, told the port and to listen on this computer only when it is a Next.js app.
 */
export function devCommand(rules, devScript, port) {
  if (rules?.command) return fillPattern(rules.command, { port });
  return `npm run dev${/\bnext\b/.test(String(devScript ?? '')) ? ` -- -p ${port} -H 127.0.0.1` : ''}`;
}
