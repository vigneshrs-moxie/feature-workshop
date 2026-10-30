// Repositories: the ones to offer when starting a job (recentRepos: the folders recent Claude Code
// sessions ran in that are git repositories, plus any the person types in, checked before use),
// and the runner's registry of repositories with their profiles (lib/profile.js, plan G10, G31).
//
// The registry is repos.json in the state folder: [{ path, github, profile }], where profile is the
// profile file to use (a path inside the dashboard folder, like profiles/orbit.md, or a full path).
// A ground-control.md in the repository's own root always wins over that file.
//
//   openRegistry({ dir })   the registry for a state folder (one per folder in this process)
//   listRepos()             each repository with its profile checked: name, GitHub, file, ports
//   addRepo(path, { profileFile })   checks it is a git repository and that the profile loads
//   removeRepo(path)
//   repoFor(path)           the registered repository a folder belongs to, worktrees included
//   profileFor(path)        that repository's profile, read again whenever its file changes
//   worktreeFor(repo, slug) where a job's worktree goes (the profile's worktree, else GENERAL's)
//   seed(paths)             first start only: registers the repositories a bundled profile
//                           (dashboard/profiles/*.md) names by GitHub, such as Orbit
//   reposDoor(registry)     what Settings → Repos asks (site/routes-repos.js), through the runner
//   ticketRepo(registry)    where a ticket's job goes when the hosted site's Start names no folder
//
// Whenever the list or a registered profile is read anew, lib/hard-lines.js learns the profiles'
// org remotes and GitHub orgs (on top of its floor), so pushes there are refused too.
//
// Nothing here writes to a repository: git is only asked where a folder's checkout and remotes are.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGitRepo } from './git.js';
import { setProfileOrgs } from './hard-lines.js';
import { GENERAL, PROFILE_FILE, fillPattern, githubOfUrl, githubOrg, loadProfile, portsLabel } from './profile.js';

export const REPOS_FILE = 'repos.json';
/** The profiles Ground Control carries for repositories that don't carry their own yet. */
export const BUNDLED_DIR = fileURLToPath(new URL('../profiles/', import.meta.url));
const LOOKUP_MS = 60_000; // how long a folder's checkout and remotes are remembered

export async function recentRepos(sessionIndex, extra = [], { registry = currentRegistry() } = {}) {
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
  // Which ones are in the registry (the New job picker can say so).
  const listed = registry ? await registry.entries().catch(() => []) : [];
  for (const r of out) r.registered = listed.some((e) => samePath(e.path, r.path));
  return out.sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? ''));
}

export async function checkRepo(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return { ok: false, reason: 'Use a full path, starting with /.' };
  try {
    if (!(await fsp.stat(p)).isDirectory()) return { ok: false, reason: 'That is not a folder.' };
  } catch {
    return { ok: false, reason: 'That folder doesn’t exist.' };
  }
  const top = await isGitRepo(p);
  if (!top) return { ok: false, reason: 'That folder isn’t a git repository.' };
  return { ok: true, path: top };
}

// ---------- git, read only ----------

function git(dir, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { timeout: 5000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const samePath = (a, b) => real(a) === real(b);
const isInside = (p, dir) => {
  const rel = path.relative(real(dir), real(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** The main checkout a folder belongs to (a worktree's is its main repository's), or null. */
async function mainCheckout(dir) {
  const common = await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) return null;
  return path.basename(common) === '.git' ? path.dirname(common) : git(dir, ['rev-parse', '--show-toplevel']);
}

/** The "org/repo" of every GitHub remote of a folder. */
async function githubsOf(dir) {
  const out = await git(dir, ['remote', '-v']);
  return [...new Set((out ?? '').split('\n').map((l) => githubOfUrl(l.split(/\s+/)[1])).filter(Boolean))];
}

// ---------- The registry ----------

const OPEN = new Map(); // state folder → Registry
let current = null;

/** The registry for a state folder: the same one for every caller in this process. */
export function openRegistry({ dir, bundledDir = BUNDLED_DIR } = {}) {
  const key = path.resolve(dir);
  if (!OPEN.has(key)) {
    const reg = new Registry({ dir: key, bundledDir });
    OPEN.set(key, reg);
    reg.refreshHardLines().catch(() => {});
  }
  current = OPEN.get(key);
  return current;
}

/** The registry opened last in this process (the runner's), or null. */
export const currentRegistry = () => current;

const NOT_READABLE = (file) => `The list of repositories (${file}) can’t be read, so nothing was changed. Fix or remove that file.`;

export class Registry {
  constructor({ dir, bundledDir = BUNDLED_DIR }) {
    this.dir = dir;
    this.file = path.join(dir, REPOS_FILE);
    this.bundledDir = bundledDir;
    this.home = path.dirname(path.resolve(bundledDir)); // what a profile path like profiles/orbit.md is inside
    this.saved = null; // { exists, broken, mtimeMs, size, list }
    this.profiles = new Map(); // profile file → { mtimeMs, size, result }
    this.lookups = new Map(); // folder → { at, main, githubs }
    this.queue = Promise.resolve(); // changes, one at a time
    this.telling = null; // a hard-lines refresh in progress, and whether another is wanted after it
  }

  // ----- repos.json -----

  async #read() {
    let st = null;
    try { st = await fsp.stat(this.file); } catch { /* not there yet */ }
    if (!st) { this.saved = { exists: false, broken: false, list: [] }; return this.saved; }
    if (this.saved?.exists && this.saved.mtimeMs === st.mtimeMs && this.saved.size === st.size) return this.saved;
    let list = null;
    try { list = JSON.parse(await fsp.readFile(this.file, 'utf8')); } catch { /* broken */ }
    const ok = Array.isArray(list) && list.every((e) => e && typeof e.path === 'string');
    this.saved = { exists: true, broken: !ok, mtimeMs: st.mtimeMs, size: st.size, list: ok ? list.map((e) => ({ path: e.path, github: e.github ?? null, profile: e.profile ?? null })) : [] };
    this.refreshHardLines().catch(() => {});
    return this.saved;
  }

  async #write(list) {
    await fsp.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 });
    await fsp.rename(tmp, this.file);
    this.saved = null;
    await this.#read();
  }

  // One change at a time (first-start registration included), each on the list as it is then.
  #queued(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  #change(fn) {
    return this.#queued(async () => {
      const saved = await this.#read();
      if (saved.broken) return { ok: false, errors: [NOT_READABLE(this.file)], warnings: [] };
      return fn(saved.list.slice());
    });
  }

  /** The saved entries, as they are in repos.json. */
  async entries() { return (await this.#read()).list; }

  // ----- profiles -----

  /** A profile file as repos.json names it → a full path. */
  resolveProfile(ref) { return ref ? (path.isAbsolute(ref) ? ref : path.join(this.home, ref)) : null; }

  /** A full path → how repos.json names it (inside the dashboard folder: relative, with /). */
  #profileRef(file) {
    const rel = path.relative(this.home, file);
    return !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : file;
  }

  /** loadProfile, read again only when the file's time or size has changed. */
  async readProfile(file) {
    let st = null;
    try { st = await fsp.stat(file); } catch { /* loadProfile says so */ }
    const hit = this.profiles.get(file);
    if (st && hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.result;
    const result = await loadProfile(file);
    if (st) this.profiles.set(file, { mtimeMs: st.mtimeMs, size: st.size, result });
    if (hit) this.refreshHardLines().catch(() => {}); // a file read before has changed
    return result;
  }

  async #bundled() {
    let names = [];
    try { names = (await fsp.readdir(this.bundledDir)).filter((n) => n.endsWith('.md')).sort(); } catch { /* none */ }
    const out = [];
    for (const n of names) {
      const file = path.join(this.bundledDir, n);
      const r = await this.readProfile(file);
      if (r.ok && r.profile.github) out.push({ file, profile: r.profile });
    }
    return out;
  }

  async #lookup(dir) {
    const key = path.resolve(dir);
    const hit = this.lookups.get(key);
    if (hit && Date.now() - hit.at < LOOKUP_MS) return hit;
    const main = await mainCheckout(key);
    const entry = { at: Date.now(), main, githubs: main ? await githubsOf(main) : [] };
    this.lookups.set(key, entry);
    return entry;
  }

  /** The bundled profile naming one of this checkout's GitHub remotes, or null. */
  async #bundledFor(dir) {
    const { githubs } = await this.#lookup(dir);
    const lower = githubs.map((g) => g.toLowerCase());
    return lower.length ? (await this.#bundled()).find((b) => lower.includes(b.profile.github.toLowerCase())) ?? null : null;
  }

  /** The profile file a registered repository uses: its own ground-control.md, else the saved one. */
  #profileFileOf(entry) {
    const own = path.join(entry.path, PROFILE_FILE);
    if (fs.existsSync(own)) return { file: own, source: 'repo' };
    const saved = this.resolveProfile(entry.profile);
    return saved ? { file: saved, source: 'registry' } : { file: null, source: null };
  }

  // ----- the list -----

  /** Each registered repository with its profile checked. */
  async listRepos() {
    const out = [];
    for (const e of await this.entries()) out.push(await this.#view(e));
    return out;
  }

  /** { repos, file, unreadable }: unreadable names repos.json when it can't be read. */
  async list() {
    const saved = await this.#read();
    return { repos: await this.listRepos(), file: this.file, unreadable: saved.broken ? this.file : null };
  }

  async #view(e) {
    const { file, source } = this.#profileFileOf(e);
    const r = file ? await this.readProfile(file) : { ok: false, profile: null, errors: ['No profile file is named for this repository.'], warnings: [] };
    const p = r.ok ? r.profile : null;
    return {
      path: e.path, folder: path.basename(e.path), name: p?.name ?? path.basename(e.path),
      github: p?.github ?? e.github ?? null, profileFile: file, profileSource: source,
      ok: r.ok, errors: r.errors, warnings: r.warnings,
      ports: p ? portsLabel(p.tryIt?.ports ?? GENERAL.tryIt.ports) : null,
      exists: fs.existsSync(e.path),
    };
  }

  /**
   * Adds a repository. p: any folder in it (its top is saved). profileFile: the profile to use when
   * the repository has no ground-control.md of its own; with neither, a bundled profile naming its
   * GitHub repository is used. Returns { ok, repo, warnings } or { ok: false, errors, warnings }.
   */
  addRepo(p, { profileFile = null } = {}) {
    return this.#change(async (list) => {
      const checked = await checkRepo(p);
      if (!checked.ok) return { ok: false, errors: [checked.reason], warnings: [] };
      const top = checked.path;
      if (list.some((e) => samePath(e.path, top))) return { ok: false, errors: ['That repository is already in the list.'], warnings: [] };
      const picked = await this.#pickProfile(top, profileFile);
      if (picked.errors) return { ok: false, errors: picked.errors, warnings: [] };
      const r = await this.readProfile(picked.file);
      if (!r.ok) return { ok: false, errors: r.errors, warnings: r.warnings, file: picked.file };
      const github = r.profile.github ?? (await this.#lookup(top)).githubs[0] ?? null;
      const entry = { path: top, github, profile: picked.own ? null : this.#profileRef(picked.file) };
      await this.#write([...list, entry]);
      return { ok: true, repo: await this.#view(entry), warnings: r.warnings };
    });
  }

  async #pickProfile(top, profileFile) {
    const own = path.join(top, PROFILE_FILE);
    if (fs.existsSync(own)) return { file: own, own: true };
    if (profileFile) {
      if (typeof profileFile !== 'string' || !path.isAbsolute(profileFile)) return { errors: ['Name the profile file with a full path, starting with /.'] };
      if (!profileFile.endsWith('.md')) return { errors: ['A profile is a Markdown file: its name ends in .md.'] };
      return { file: profileFile };
    }
    const bundled = await this.#bundledFor(top);
    if (bundled) return { file: bundled.file };
    return { errors: [`This repository has no ${PROFILE_FILE} in its root. Write one there, or name a profile file to use.`] };
  }

  /** Takes a repository off the list (its files and its profile are left alone). */
  removeRepo(p) {
    return this.#change(async (list) => {
      const left = list.filter((e) => !(e.path === p || (typeof p === 'string' && samePath(e.path, p))));
      if (left.length === list.length) return { ok: false, errors: ['That repository isn’t in the list.'], warnings: [] };
      await this.#write(left);
      return { ok: true, removed: p };
    });
  }

  /** The registered repository a folder belongs to (its checkout, a worktree of it, or a folder in either), or null. */
  async repoFor(p) {
    if (!p) return null;
    const list = await this.entries();
    if (!list.length) return null;
    const direct = list.find((e) => isInside(p, e.path));
    if (direct) return direct;
    const { main } = await this.#lookup(p);
    return main ? list.find((e) => samePath(e.path, main)) ?? null : null;
  }

  /**
   * The profile for the repository a folder belongs to: { repo, file, source, ok, profile, errors,
   * warnings } (repo is null when it isn't registered but carries its own ground-control.md), or
   * null when it has none. On a first start (no repos.json yet), a repository a bundled profile
   * names is registered on the way.
   */
  async profileFor(p) {
    if (!p) return null;
    let entry = await this.repoFor(p);
    if (!entry && !(await this.#read()).exists && await this.#bundledFor(p)) {
      await this.seed([p]);
      entry = await this.repoFor(p);
    }
    if (entry) {
      const { file, source } = this.#profileFileOf(entry);
      if (!file) return { repo: entry, file: null, source: null, ok: false, profile: null, errors: ['No profile file is named for this repository.'], warnings: [] };
      return { repo: entry, file, source, ...(await this.readProfile(file)) };
    }
    const { main } = await this.#lookup(p);
    const own = main ? path.join(main, PROFILE_FILE) : null;
    if (own && fs.existsSync(own)) return { repo: null, file: own, source: 'repo', ...(await this.readProfile(own)) };
    return null;
  }

  /** Where a job's worktree goes: the profile's worktree pattern next to the repository, else GENERAL's. */
  async worktreeFor(repoPath, slug) {
    const hit = await this.profileFor(repoPath).catch(() => null);
    const pattern = hit?.ok && hit.profile.worktree ? hit.profile.worktree : GENERAL.worktree;
    return path.resolve(repoPath, fillPattern(pattern, { slug }));
  }

  /**
   * First start only (no repos.json yet): registers each of `paths` (folders, or { path }) whose
   * GitHub remote a bundled profile names, then writes the list (empty when none matched), so a
   * repository you remove later stays removed. Returns the entries added.
   */
  seed(paths = []) {
    return this.#queued(async () => {
      if ((await this.#read()).exists) return [];
      const added = [];
      for (const item of paths) {
        const p = typeof item === 'string' ? item : item?.path;
        if (!p) continue;
        const { main } = await this.#lookup(p);
        if (!main || added.some((e) => samePath(e.path, main))) continue;
        const bundled = await this.#bundledFor(main);
        if (bundled) added.push({ path: main, github: bundled.profile.github, profile: this.#profileRef(bundled.file) });
      }
      await this.#write(added);
      return added;
    }).catch((err) => { console.error('repos: first start:', err); return []; });
  }

  /**
   * Reads a profile and says what is wrong with it, for Settings → Repos: the file named, else the
   * profile of the repository at `path`. Returns { ok, file, errors, warnings, name, github, ports }.
   */
  async checkProfile({ path: p = null, profileFile = null } = {}) {
    const no = (msg) => ({ ok: false, file: null, errors: [msg], warnings: [], name: null, github: null, ports: null });
    let r;
    if (profileFile) {
      if (typeof profileFile !== 'string' || !path.isAbsolute(profileFile)) return no('Name the profile file with a full path, starting with /.');
      r = await this.readProfile(profileFile);
    } else if (p) {
      const checked = await checkRepo(p);
      if (!checked.ok) return no(checked.reason);
      r = await this.profileFor(checked.path);
      if (!r) {
        const picked = await this.#pickProfile(checked.path, null);
        if (picked.errors) return no(picked.errors[0]);
        r = await this.readProfile(picked.file);
      }
    } else {
      return no('Give a repository’s folder or a profile file to check.');
    }
    const prof = r.ok ? r.profile : null;
    return { ok: r.ok, file: r.file ?? profileFile, errors: r.errors, warnings: r.warnings, name: prof?.name ?? null, github: prof?.github ?? null, ports: prof ? portsLabel(prof.tryIt?.ports ?? GENERAL.tryIt.ports) : null };
  }

  /** The org remotes and GitHub orgs the registered profiles name. */
  async orgs() {
    const out = [];
    for (const e of await this.entries()) {
      const { file } = this.#profileFileOf(e);
      const r = file ? await this.readProfile(file) : null;
      const p = r?.ok ? r.profile : null;
      out.push({ remote: p?.remotes?.org ?? null, fork: p?.remotes?.fork ?? null, org: githubOrg(p) ?? (e.github ? e.github.split('/')[0] : null) });
    }
    return out;
  }

  /** Tells lib/hard-lines.js the registered org remotes and orgs (one refresh at a time; asked again while one runs, it runs once more). */
  refreshHardLines() {
    if (this.telling) { this.telling.again = true; return this.telling.done; }
    const telling = { again: false, done: null };
    this.telling = telling;
    telling.done = (async () => {
      try {
        do { telling.again = false; setProfileOrgs(await this.orgs()); } while (telling.again);
      } finally { this.telling = null; }
    })();
    return telling.done;
  }
}

/**
 * The repository a ticket's job goes in when a Start names none: the hosted site's Inbox (packet
 * 2C) knows the ticket but not this laptop's folders. The one registered repository whose profile
 * is Orbit's (the tickets are Orbit's), else the only registered repository. Null when neither is
 * clear: the runner then says so in plain words instead of guessing.
 */
export async function ticketRepo(registry) {
  const repos = ((await registry?.listRepos().catch(() => [])) ?? []).filter((r) => r.ok);
  const orbit = repos.filter((r) => String(r.name ?? '').trim().toLowerCase() === 'orbit');
  if (orbit.length === 1) return orbit[0].path;
  if (!orbit.length && repos.length === 1) return repos[0].path;
  return null;
}

/**
 * What Settings → Repos asks the runner (site/routes-repos.js). recent(): the folders to look at on
 * a first start (recentRepos's entries, or plain paths).
 */
export function reposDoor(registry, { recent = async () => [] } = {}) {
  return {
    async list() {
      if (!fs.existsSync(registry.file)) await registry.seed(await recent().catch(() => []));
      return registry.list();
    },
    add: ({ path: p, profileFile = null } = {}) => registry.addRepo(p, { profileFile: profileFile || null }),
    remove: (p) => registry.removeRepo(p),
    check: ({ path: p = null, profileFile = null } = {}) => registry.checkProfile({ path: p || null, profileFile: profileFile || null }),
  };
}
