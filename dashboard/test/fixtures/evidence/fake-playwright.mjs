#!/usr/bin/env node
// A stand-in for `playwright test` in the tests (and a demo): no browser. Called the way the runner
// calls Playwright (`node <this> test --config <evidence/playwright.config.mjs>`), it reads that
// config and copies this folder's output/ into the config's outputDir and report.json (its paths
// filled in) to the config's JSON report. Each call is added to calls.jsonl next to the config.
// It prints the progress reporter's lines (lib/evidence.js progressReporter) as the real one does:
// `@@starbase {...}` when each spec that is there starts and ends.
// FAKE_PLAYWRIGHT=no-browser says what Playwright says when Chromium isn't installed, and stops.
// STARBASE_FAKE_HOLD=<file>: after the first line's begin it waits until that file exists (30 seconds
// at most). When the file says `exit 1` it stops there, as a Playwright that died part way: exit
// code 1 and no report. When it says `one` the first line ends, then it waits again (30 seconds at
// most) until the file says something else, so a test sees the run between its first line and its end.
// While the run's watch file is fresh it saves a picture to the live file, as the guard does.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const configFile = path.resolve(args[args.indexOf('--config') + 1]);
fs.appendFileSync(path.join(path.dirname(configFile), 'calls.jsonl'), `${JSON.stringify({ args, cwd: process.cwd() })}\n`);
if (process.env.FAKE_PLAYWRIGHT === 'no-browser') {
  process.stderr.write("Error: browserType.launch: Executable doesn't exist at /nowhere/chrome-headless-shell\nLooks like Playwright was just installed or updated. Please run the following command to download new browsers:\n    npx playwright install\n");
  process.exit(1);
}
const config = (await import(pathToFileURL(configFile).href)).default;
const reportFile = config.reporter.find((r) => r[0] === 'json')[1].outputFile;
fs.cpSync(path.join(here, 'output'), config.outputDir, { recursive: true });
const output = config.outputDir.split(path.sep).join('/');
const report = fs.readFileSync(path.join(here, 'report.json'), 'utf8').replaceAll('{{output}}', output);
// Only the specs that are there ran.
const ran = new Set(fs.readdirSync(config.testDir));
const parsed = JSON.parse(report);
parsed.suites = parsed.suites.filter((s) => ran.has(s.file));
process.stdout.write(`Running ${parsed.suites.length} tests using 1 worker\n`);

// Watch: as the guard does (lib/evidence.js guardModule), with the two paths the run's guard.mjs names,
// every 500 ms while the watch file was touched under 5 s ago it saves a picture (beside it, then a rename).
const guard = (() => { try { return fs.readFileSync(path.join(path.dirname(config.testDir), 'guard.mjs'), 'utf8'); } catch { return ''; } })();
const named = (name) => { const m = new RegExp(`^const ${name} = ("[^"\\n]*");$`, 'm').exec(guard); return m ? JSON.parse(m[1]) : null; };
const [LIVE, WATCH] = [named('LIVE'), named('WATCH')];
const FRAME = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a live picture, not really'), Buffer.from([0xff, 0xd9])]);
const frames = LIVE && WATCH ? setInterval(() => {
  try {
    if (Date.now() - fs.statSync(WATCH).mtimeMs >= 5000) return;
    fs.writeFileSync(`${LIVE}.part`, FRAME);
    fs.renameSync(`${LIVE}.part`, LIVE);
  } catch { /* nobody watching, or the run's folder is gone: no picture */ }
}, 500) : null;

const STATUS = { passed: 'passed', skipped: 'skipped', failed: 'failed', timedOut: 'failed', interrupted: 'failed' };
const say = (o) => process.stdout.write(`\n@@starbase ${JSON.stringify(o)}\n`);
const hold = process.env.STARBASE_FAKE_HOLD;
const readHold = () => { try { return fs.readFileSync(hold, 'utf8').trim(); } catch { return null; } };
let first = true;
for (const suite of parsed.suites) {
  for (const spec of suite.specs) {
    const id = /^AC-\d+/.exec(spec.file)[0];
    const title = spec.title.replace(/^AC-\d+\s*[:.–—-]?\s*/, '');
    say({ at: 'begin', id, title, status: null, video: null });
    if (first && hold) {
      for (const until = Date.now() + 30_000; !fs.existsSync(hold) && Date.now() < until;) await new Promise((r) => { setTimeout(r, 50); });
      if (fs.existsSync(hold) && fs.readFileSync(hold, 'utf8').trim() === 'exit 1') {
        process.stderr.write('Error: browserContext.newPage: Target page, context or browser has been closed\n');
        process.exit(1);
      }
    }
    const result = spec.tests[0].results.at(-1);
    const video = result.attachments.find((a) => a.name === 'video')?.path ?? null;
    say({ at: 'end', id, title, status: STATUS[result.status] ?? 'failed', video });
    if (first && hold) {
      for (const until = Date.now() + 30_000; readHold() === 'one' && Date.now() < until;) await new Promise((r) => { setTimeout(r, 50); });
    }
    first = false;
  }
}
clearInterval(frames);
fs.writeFileSync(reportFile, JSON.stringify(parsed, null, 2));
process.exit(parsed.suites.some((s) => s.specs.some((x) => !x.ok)) ? 1 : 0);
