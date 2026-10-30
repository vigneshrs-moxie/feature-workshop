// The check packet Y leaves behind: the product is called Starbase (decision G36), so no file says
// "Ground Control", "Feature Workshop", ground-control, feature-workshop, GROUND_CONTROL or
// WORKSHOP_, nor "Dashboard" as the product's name, except where an old name is the point:
//
//   the migration code    a line that says it is about the old name (old, older, before, rename,
//                         OLD_…, oldService and the like): the folder move, the old service, the
//                         old profile file, the old token names, the fallbacks. Only in code and
//                         its tests, never in a doc a person reads;
//   the fallback table    lib/env-names.js and its test;
//   the alias             bin/ground-control.js, and package.json's bin line for it;
//   the dated docs        docs/plans/, docs/research/, the copied register in docs/decisions/;
//   the changelog         CHANGELOG.md;
//   what can't change     the GitHub repository and the folder it is cloned to (both still called
//                         feature-workshop until Vignesh renames them), and the hosted site's
//                         migrations, which the site refuses to run once changed.
//
// "dashboard" in lower case is fine: the code folder dashboard/, and plain sentences like "the
// Telemetry dashboard". A second test looks at the built pages (web/dist and hosted/public).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const OLD_NAME = /Ground Control|Feature Workshop|ground-control|feature-workshop|GROUND_CONTROL|WORKSHOP_/;
/** "Dashboard" with a capital, as a name: the placeholder the product had until G36. */
export const OLD_PLACEHOLDER = /\bDashboard\b/;

/** Whole files where the old names are the point (see the top of this file). */
const ALLOWED_FILES = [
  /^docs\/plans\//, /^docs\/research\//, /^docs\/decisions\/0001-next-phase-register\.md$/,
  /^CHANGELOG\.md$/,
  /^dashboard\/lib\/env-names\.js$/, /^dashboard\/test\/env-names\.test\.js$/,
  /^dashboard\/lib\/state-folder\.js$/, /^dashboard\/test\/state-move\.test\.js$/,
  /^dashboard\/hooks\/record\.mjs$/, // the live-link hook: reads the old folders and the old variable itself
  /^bin\/ground-control\.js$/,
  /^hosted\/migrations\//,
  /^dashboard\/test\/old-names\.test\.js$/,
];

/** Bits of a line that are fine anywhere: names that are not the product's to change. */
const ALLOWED_BITS = [
  /vigneshrs-moxie\/feature-workshop/g, // the GitHub repository (renaming it is Vignesh's step)
  /Projects\/feature-workshop/g, /cd feature-workshop\b/g, /\/path\/to\/feature-workshop\//g, /C:\/Users\/you\/feature-workshop\//g, // the folder it is cloned to
  /"ground-control": "bin\/ground-control\.js"/g, // the alias, in package.json and its lockfile
  /\[Dashboard redesign\]\(https:\/\/vercel\.com\/blog\/dashboard-redesign\)/g, // Vercel's own dashboard, in a design reference
];

/** A line in code that says it is about the old name (the migration code and its tests). */
const SAYS_OLD = /\b(old|older|before|renamed?|previous)\b|OLD_|[oO]ld[A-Z]|'old-|G36/;
const isCode = (file) => /\.(c?m?js|tsx?|sh|ps1|json|ya?ml|sql)$/.test(file) && !/\.md$/.test(file);
const TEXT = /\.(c?m?js|tsx?|jsx|json|md|txt|html|css|svg|sh|ps1|ya?ml|sql|plist|service|xml)$|^[^.]+$|\.gitignore$/;

/** The lines of `text` that use an old name where they shouldn't: [{ line, text }]. */
export function oldNameHits(file, text) {
  if (ALLOWED_FILES.some((r) => r.test(file))) return [];
  const hits = [];
  text.split('\n').forEach((raw, i) => {
    let line = raw;
    for (const bit of ALLOWED_BITS) line = line.replace(bit, '');
    if (!OLD_NAME.test(line) && !OLD_PLACEHOLDER.test(line)) return;
    if (isCode(file) && SAYS_OLD.test(line)) return;
    hits.push({ line: i + 1, text: raw.trim().slice(0, 160) });
  });
  return hits;
}

const tracked = () => execFileSync('git', ['-C', ROOT, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f) => fs.existsSync(path.join(ROOT, f)));

test('the check itself: what it finds and what it lets through', () => {
  assert.equal(oldNameHits('dashboard/lib/x.js', "const name = 'Ground Control';").length, 1);
  assert.equal(oldNameHits('dashboard/lib/x.js', 'process.env.WORKSHOP_DEMO').length, 1);
  assert.equal(oldNameHits('web/src/x.tsx', '<h1>Dashboard</h1>').length, 1, 'the placeholder name');
  assert.equal(oldNameHits('README.md', 'Run ground-control start.').length, 1);
  assert.equal(oldNameHits('README.md', 'The old ground-control command still works.').length, 1, 'a doc must not lean on “old”');
  assert.equal(oldNameHits('dashboard/lib/x.js', "export const OLD_SERVICE = 'Ground Control Orbit token';").length, 0, 'the migration code');
  assert.equal(oldNameHits('dashboard/lib/x.js', '// the state folder, ground-control.md').length, 1, '“folder” is not “old”');
  assert.equal(oldNameHits('README.md', 'git clone https://github.com/vigneshrs-moxie/feature-workshop.git').length, 0);
  assert.equal(oldNameHits('README.md', 'the Telemetry dashboard, and dashboard/server.js').length, 0, 'lower case is fine');
  assert.equal(oldNameHits('docs/plans/2026-10-27-ground-control-decisions.md', 'Ground Control').length, 0, 'a dated doc');
});

test('no file in the repository uses an old name outside the allowlist', () => {
  const files = tracked().filter((f) => TEXT.test(path.basename(f)));
  assert.ok(files.length > 500, `read ${files.length} files`);
  const found = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (text.includes('\u0000')) continue;
    for (const h of oldNameHits(file, text)) found.push(`${file}:${h.line}: ${h.text}`);
  }
  assert.deepEqual(found, [], `old names in:\n${found.join('\n')}`);
});

test('the built pages (web/dist, hosted/public) use no old name', (t) => {
  const dirs = ['web/dist', 'hosted/public'].map((d) => path.join(ROOT, d)).filter((d) => fs.existsSync(d));
  if (!dirs.length) { t.skip('neither is built here (npm run web:build, npm run build -w hosted)'); return; }
  const found = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(html|js|css|json|txt|svg|map)$/.test(name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      const m = text.match(OLD_NAME) ?? text.match(OLD_PLACEHOLDER);
      if (m) found.push(`${path.relative(ROOT, p)}: …${text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' ')}…`);
    }
  };
  for (const d of dirs) walk(d);
  assert.deepEqual(found, [], `old names in the built pages:\n${found.join('\n')}`);
});
