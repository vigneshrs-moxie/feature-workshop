// `npm run build -w hosted`, which Vercel runs (vercel.json buildCommand):
//   1. refuses a production build with AUTH_FAKE on (site/config.js), before anything is built;
//   2. builds the same web/ app the laptop serves, for the site's root: its files go to
//      hosted/public/ (vercel.json outputDirectory), and web/dist (the laptop's copy, at /next/) is
//      left alone;
//   3. marks that index.html as the hosted page (<meta name="dashboard-mode" content="hosted">),
//      so the app opens its hosted screens at once; /api/meta then says mode 'hosted' as well;
//   4. applies the database migrations (scripts/migrate.js).
// --no-migrate skips step 4 (the local end-to-end run migrates its own PGlite database).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, readConfig } from '../site/config.js';

const HOSTED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(HOSTED, '..');
export const PUBLIC_DIR = path.join(HOSTED, 'public');
export const HOSTED_MARK = '<meta name="dashboard-mode" content="hosted" />';

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

try { readConfig(process.env); } catch (err) {
  if (err instanceof ConfigError) { console.error(`build: ${err.message}`); process.exit(1); }
  throw err;
}

run('npm', ['run', 'build', '-w', 'web', '--', '--base=/', `--outDir=${PUBLIC_DIR}`, '--emptyOutDir'], ROOT);

const index = path.join(PUBLIC_DIR, 'index.html');
const html = fs.readFileSync(index, 'utf8');
if (!html.includes(HOSTED_MARK)) fs.writeFileSync(index, html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    ${HOSTED_MARK}`));
if (!fs.readFileSync(index, 'utf8').includes(HOSTED_MARK)) { console.error('build: couldn’t mark index.html as the hosted page.'); process.exit(1); }
console.log(`build: the page is in ${path.relative(ROOT, PUBLIC_DIR)}/`);

if (!process.argv.includes('--no-migrate')) run(process.execPath, [path.join(HOSTED, 'scripts', 'migrate.js')], HOSTED);
