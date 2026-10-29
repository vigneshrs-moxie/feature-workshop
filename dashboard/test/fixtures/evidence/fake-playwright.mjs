#!/usr/bin/env node
// A stand-in for `playwright test` in the tests (and a demo): no browser. Called the way the runner
// calls Playwright (`node <this> test --config <evidence/playwright.config.mjs>`), it reads that
// config and copies this folder's output/ into the config's outputDir and report.json (its paths
// filled in) to the config's JSON report. Each call is added to calls.jsonl next to the config.
// FAKE_PLAYWRIGHT=no-browser says what Playwright says when Chromium isn't installed, and stops.
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
const report = fs.readFileSync(path.join(here, 'report.json'), 'utf8').replaceAll('{{output}}', config.outputDir.split(path.sep).join('/'));
// Only the specs that are there ran.
const ran = new Set(fs.readdirSync(config.testDir));
const parsed = JSON.parse(report);
parsed.suites = parsed.suites.filter((s) => ran.has(s.file));
fs.writeFileSync(reportFile, JSON.stringify(parsed, null, 2));
process.stdout.write(`Running ${parsed.suites.length} tests using 1 worker\n`);
process.exit(parsed.suites.some((s) => s.specs.some((x) => !x.ok)) ? 1 : 0);
