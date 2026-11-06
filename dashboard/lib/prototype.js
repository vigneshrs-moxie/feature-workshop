// The prototypes site, as Starbase sees it: whether this laptop is set up to publish, what a job's
// last publish was, and the one way Starbase talks to the site, which is running the wireframe
// skill's publish.py. The contract is the skill's reference/publish.md.
//
// The token stays with publish.py. It lives in ~/.claude/prototypes.json, and prototypesSetup takes
// only `site` out of that file. publish.py never prints the token, on stdout or on stderr, so what
// it says can be passed back to the page; nothing here logs it all the same.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http-guard.js';

export const TOKEN_FILE = 'prototypes.json';
export const RECORD_FILE = 'prototype.json';
export const DEFAULT_SITE = 'https://prototypes.moxieorbit.com';
export const PUBLISH_TIMEOUT_MS = 60 * 1000;
const OUTPUT_MAX = 8 * 1024 * 1024;

export const NOT_SET_UP = 'Publishing isn’t set up on this laptop: see the prototypes plan §9 step 10.';
export const NOT_PRIVATE = 'Publishing is off: other people can read ~/.claude/prototypes.json. Run chmod 600 on it.';
export const BROKEN_FILE = 'Publishing is off: ~/.claude/prototypes.json isn’t readable JSON.';
export const DEMO_OFF = 'Publishing is off in the demo.';

const off = (why) => ({ prototypes: null, prototypesWhy: why });
const isWebUrl = (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v);

/** For meta: { prototypes: { site }, prototypesWhy: null } when this laptop can publish, else { prototypes: null, prototypesWhy: <one line> }. */
export async function prototypesSetup(claudeDir, { platform = process.platform } = {}) {
  const file = path.join(claudeDir, TOKEN_FILE);
  const st = await fs.stat(file).catch(() => null);
  if (!st?.isFile()) return off(NOT_SET_UP);
  if (platform !== 'win32' && (st.mode & 0o077) !== 0) return off(NOT_PRIVATE);
  let site;
  try {
    ({ site } = JSON.parse(await fs.readFile(file, 'utf8')));
  } catch {
    return off(BROKEN_FILE);
  }
  return { prototypes: { site: isWebUrl(site) ? site.replace(/\/+$/, '') : DEFAULT_SITE }, prototypesWhy: null };
}

/** A job's last publish, from <job folder>/prototype.json: { url, revision, publishedAt }, or null when it has none. */
export async function prototypeInfo(dir) {
  const file = path.join(dir, RECORD_FILE);
  const st = await fs.lstat(file).catch(() => null);
  if (!st?.isFile()) return null;
  try {
    const { url, revision, published_at: publishedAt } = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!isWebUrl(url) || !Number.isInteger(revision) || revision < 1) return null;
    return { url, revision, publishedAt: typeof publishedAt === 'string' ? publishedAt : null };
  } catch {
    return null;
  }
}

/** The script to run: the wireframe skill's, followed through its link. STARBASE_SKILLS_DIR points the tests at a stand-in. */
export const publishScript = (skillsDir) => path.join(skillsDir, 'wireframe', 'publish.py');

const lines = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

/** What went wrong, in the script's one line: its last line that isn't a warning. */
function failure(err, stderr, timeout) {
  if (err.code === 'ENOENT') return 'Python 3 isn’t on this laptop, so the page can’t be published from here.';
  if (err.killed || err.signal) return `The prototypes site didn’t answer in ${Math.round(timeout / 1000)} seconds. Try again.`;
  return lines(stderr).filter((l) => !l.startsWith('warning:')).at(-1)?.slice(0, 500) ?? 'publish.py stopped without saying why.';
}

/**
 * Run publish.py for a job: action 'publish' or 'notes'.
 * Publish answers with the site's reply. Notes answer with the feedback lines and the time they
 * start from, and leave out the people's addresses the site's reply carries. Both add `warnings`.
 * Any failure is a 502 with one line.
 */
export async function runPublish({ slug, action, script, featuresDir, env = process.env, platform = process.platform, timeout = PUBLISH_TIMEOUT_MS }) {
  if (!(await fs.stat(script).catch(() => null))?.isFile()) throw new HttpError(502, 'The wireframe skill on this laptop has no publish.py. Update the skill and try again.');
  const [file, ...first] = platform === 'win32' ? ['py', '-3'] : ['python3'];
  const args = [...first, script, ...(action === 'notes' ? ['--notes'] : []), '--job', slug, '--json'];
  const options = { timeout, maxBuffer: OUTPUT_MAX, windowsHide: true, env: { ...env, STARBASE_FEATURES_DIR: featuresDir } };
  const { stdout, stderr } = await new Promise((resolve, reject) => {
    execFile(file, args, options, (err, out, errOut) => (err ? reject(new HttpError(502, failure(err, errOut, timeout))) : resolve({ stdout: out, stderr: errOut })));
  });
  let reply;
  try {
    reply = JSON.parse(stdout);
  } catch {
    throw new HttpError(502, 'publish.py gave an answer Starbase can’t read.');
  }
  const warnings = lines(stderr).filter((l) => l.startsWith('warning:')).map((l) => l.slice('warning:'.length).trim());
  if (action === 'publish') return { ...reply, warnings };
  return { lines: Array.isArray(reply.lines) ? reply.lines : [], since: reply.since ?? null, revision: reply.feature?.latest_revision ?? null, warnings };
}
