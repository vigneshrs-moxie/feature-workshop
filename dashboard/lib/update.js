// `ground-control update`: moves Ground Control to the newest release, after checking the download
// against the release's checksum file (packet I step 4, plan G18, §4.3).
//
//   1. gh release view --repo <repo> --json tagName,assets: the newest release's tag and files
//   2. newer than the running version? gh release download it: the package file (*.tgz) and SHA256SUMS
//   3. the package file's SHA-256 (node:crypto) must be the one SHA256SUMS names for it; if not:
//      "The download didn't match its checksum. Nothing was changed."
//   4. npm i -g <file>, then the caller restarts the service
//
// `ground-control start` checks first unless --no-update is given; a check that fails (no network,
// no gh) never stops the start. Every command goes through an injected `run(file, args)` that
// resolves { code, stdout, stderr }, so tests use a fake release folder and never call GitHub.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellFor } from './platform.js';
import { runCommand } from './service.js';
import { PRODUCT } from './state.js';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The GitHub repository the releases come from (GROUND_CONTROL_RELEASE_REPO overrides it). */
export const RELEASE_REPO = 'vigneshrs-moxie/feature-workshop';
export const SUMS_FILE = 'SHA256SUMS';
export const CHECKSUM_MISMATCH = 'The download didn’t match its checksum. Nothing was changed.';

export const releaseRepo = (env = process.env) => env.GROUND_CONTROL_RELEASE_REPO || RELEASE_REPO;

/** The running version, from package.json. */
export function currentVersion(root = PACKAGE_ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? '0.0.0'; } catch { return '0.0.0'; }
}

/** True when this copy runs from a git checkout (a developer's), which updates with git pull instead. */
export const isCheckout = (root = PACKAGE_ROOT) => fs.existsSync(path.join(root, '.git'));

/** "v1.5.2" or "1.5.2" → [1, 5, 2, pre] (pre: true for 1.5.2-beta.1); null when it isn't a version. */
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Boolean(m[4])] : null;
}

/** 1 when a is newer than b, -1 when older, 0 when the same (a pre-release comes before its release). */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  if (x[3] !== y[3]) return x[3] ? -1 : 1;
  return 0;
}

const said = (r) => `${r.stderr || ''}\n${r.stdout || ''}`.trim();
const OFFLINE = /could not resolve|error connecting|dial tcp|no such host|network is unreachable|timed? ?out|connection refused|ENOTFOUND|ECONNRESET|EAI_AGAIN/i;

/**
 * Asks GitHub for the newest release. Resolves one of
 *   { status: 'newer', current, latest, tag, asset }   asset: the package file's name
 *   { status: 'same' | 'older', current, latest, tag }
 *   { status: 'offline' | 'unavailable', current, message }   the check couldn't be made
 */
export async function checkForUpdate({ run = runCommand, env = process.env, current = currentVersion() } = {}) {
  const repo = releaseRepo(env);
  const r = await run('gh', ['release', 'view', '--repo', repo, '--json', 'tagName,assets'], { timeout: 15_000 });
  if (r.missing) return { status: 'unavailable', current, message: 'GitHub CLI (gh) isn’t on this computer, so updates can’t be checked. Install it (ground-control doctor says how).' };
  if (r.code !== 0) {
    if (OFFLINE.test(said(r))) return { status: 'offline', current, message: 'GitHub can’t be reached right now (no network?), so updates weren’t checked.' };
    if (/auth|login|401|403/i.test(said(r))) return { status: 'unavailable', current, message: 'GitHub CLI isn’t signed in, so updates can’t be checked. Run gh auth login.' };
    if (/not found|404|no releases?/i.test(said(r))) return { status: 'unavailable', current, message: `There is no release of ${PRODUCT} on ${repo} yet.` };
    return { status: 'unavailable', current, message: `GitHub didn’t say what the newest release is (${said(r).split('\n')[0] || `gh stopped with code ${r.code}`}).` };
  }
  let body;
  try { body = JSON.parse(r.stdout); } catch { return { status: 'unavailable', current, message: 'GitHub’s answer about the newest release couldn’t be read.' }; }
  const tag = String(body?.tagName ?? '');
  const latest = tag.replace(/^v/, '');
  if (!parseVersion(tag)) return { status: 'unavailable', current, message: `The newest release’s tag (${tag || 'none'}) isn’t a version number.` };
  const order = compareVersions(latest, current);
  if (order <= 0) return { status: order === 0 ? 'same' : 'older', current, latest, tag };
  const names = (body.assets ?? []).map((a) => a?.name).filter(Boolean);
  const asset = names.find((n) => n.endsWith('.tgz'));
  if (!asset || !names.includes(SUMS_FILE)) return { status: 'unavailable', current, latest, tag, message: `Release ${tag} doesn’t have both its package file and ${SUMS_FILE}, so it can’t be checked. Nothing was changed.` };
  return { status: 'newer', current, latest, tag, asset };
}

/** The SHA-256 SHA256SUMS gives for `name` (lines "<hash>  <name>", as sha256sum writes them), or null. */
export function sumFor(sumsText, name) {
  for (const line of String(sumsText).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m && path.basename(m[2]) === name) return m[1].toLowerCase();
  }
  return null;
}

/** A file's SHA-256, as hex. */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * Downloads release `tag`'s package file and SHA256SUMS into a new temp folder and checks the one
 * against the other. Resolves { ok: true, file, dir, sha256 } or { ok: false, message } (nothing
 * installed either way).
 */
export async function downloadVerified({ run = runCommand, env = process.env, tag, asset, tmpRoot = os.tmpdir() }) {
  const dir = await fsp.mkdtemp(path.join(tmpRoot, 'ground-control-update-'));
  const r = await run('gh', ['release', 'download', tag, '--repo', releaseRepo(env), '--pattern', asset, '--pattern', SUMS_FILE, '--dir', dir], { timeout: 300_000 });
  if (r.code !== 0) return { ok: false, dir, message: `The download of ${tag} didn’t finish (${said(r).split('\n')[0] || `gh stopped with code ${r.code}`}). Nothing was changed.` };
  const file = path.join(dir, asset);
  let sums;
  try { sums = await fsp.readFile(path.join(dir, SUMS_FILE), 'utf8'); } catch { return { ok: false, dir, message: CHECKSUM_MISMATCH }; }
  const want = sumFor(sums, asset);
  let got;
  try { got = await sha256File(file); } catch { return { ok: false, dir, message: CHECKSUM_MISMATCH }; }
  if (!want || want !== got) return { ok: false, dir, message: CHECKSUM_MISMATCH };
  return { ok: true, dir, file, sha256: got };
}

/** npm i -g <file>. npm is npm.cmd on Windows, which only runs through cmd.exe (lib/platform.js shellFor). */
export async function npmInstallGlobal(file, { run = runCommand, platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    if (file.includes('"')) return { code: 1, stdout: '', stderr: 'The package file’s path has a quote in it.' };
    const sh = shellFor(`npm i -g "${file}"`, { platform, env });
    return run(sh.file, sh.args, { timeout: 600_000 });
  }
  return run('npm', ['i', '-g', file], { timeout: 600_000 });
}

/**
 * The whole update. Resolves { status, message, ... }:
 *   'updated'      installed the newer version (the caller restarts the service)
 *   'same'         already the newest
 *   'checkout'     this copy runs from a git checkout: update it with git pull
 *   'offline' | 'unavailable'   the check couldn't be made; nothing changed
 *   'mismatch'     the download didn't match its checksum; nothing changed
 *   'failed'       npm couldn't install it
 */
export async function update({ run = runCommand, env = process.env, platform = process.platform, root = PACKAGE_ROOT, current = currentVersion(root), tmpRoot = os.tmpdir(), checkout = isCheckout(root) } = {}) {
  if (checkout) return { status: 'checkout', current, message: `This copy of ${PRODUCT} runs from a git checkout (${root}). Update it there with git pull.` };
  const found = await checkForUpdate({ run, env, current });
  if (found.status === 'same' || found.status === 'older') return { ...found, status: 'same', message: `${PRODUCT} ${current} is the newest version.` };
  if (found.status !== 'newer') return found;
  const got = await downloadVerified({ run, env, tag: found.tag, asset: found.asset, tmpRoot });
  if (!got.ok) {
    await fsp.rm(got.dir, { recursive: true, force: true }).catch(() => {});
    return { ...found, status: got.message === CHECKSUM_MISMATCH ? 'mismatch' : 'unavailable', message: got.message };
  }
  const r = await npmInstallGlobal(got.file, { run, platform, env });
  await fsp.rm(got.dir, { recursive: true, force: true }).catch(() => {});
  if (r.code !== 0) return { ...found, status: 'failed', message: `npm couldn’t install ${found.tag}: ${said(r).split('\n').find((l) => l.trim()) || `it stopped with code ${r.code}`}. ${PRODUCT} ${current} is still the one installed.` };
  return { ...found, status: 'updated', sha256: got.sha256, message: `Updated ${PRODUCT} from ${current} to ${found.latest} (checksum checked).` };
}
