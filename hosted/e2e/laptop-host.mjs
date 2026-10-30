// A made-up laptop for the end-to-end run (two-laptops.mjs): the demo's runner, exactly as
// dashboard/server.js makes it (WORKSHOP_DEMO=1: a pretend Foreman, nothing real runs), but its
// local page opens no port. The demo's own start-up calls to that page are answered in this
// process. The runner's link to the hosted site starts by itself once `ground-control login` has
// paired this laptop. E2E_KEEP_JOBS (slugs, comma-separated) keeps only those demo jobs, so the
// two laptops have different lists.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../../dashboard/runner/index.js';
import { createSite } from '../../dashboard/site/index.js';
import { inProcessFetch } from '../test/helpers.js';

const DASH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT);
const ORIGIN = `http://${HOST}:${PORT}`;
const FEATURES_DIR = path.resolve(process.env.WORKSHOP_FEATURES_DIR);
const CLAUDE_DIR = path.join(os.homedir(), '.claude');

const keep = (process.env.E2E_KEEP_JOBS ?? '').split(',').filter(Boolean);
if (keep.length) {
  for (const name of fs.readdirSync(FEATURES_DIR)) {
    if (!keep.includes(name) && fs.statSync(path.join(FEATURES_DIR, name)).isDirectory()) fs.rmSync(path.join(FEATURES_DIR, name), { recursive: true, force: true });
  }
}

const TOKEN = crypto.randomBytes(24).toString('hex');
const runner = await createRunner({
  host: HOST, port: PORT, token: TOKEN, dashboardDir: DASH, claudeDir: CLAUDE_DIR,
  featuresDir: FEATURES_DIR, projectsDir: path.resolve(process.env.WORKSHOP_PROJECTS_DIR),
  agentsDir: path.resolve(process.env.WORKSHOP_AGENTS_DIR), skillsDir: path.resolve(process.env.WORKSHOP_SKILLS_DIR),
  stateDir: process.env.WORKSHOP_STATE_DIR, demo: true, claudePath: null,
  claudeSettingsFile: path.join(os.homedir(), '.claude.json'), legacySettingsFile: null,
  planUsage: false, orbitStore: 'file',
  integrateDir: path.resolve(process.env.GROUND_CONTROL_DIR), integrateRoot: path.join(DASH, '..'),
});
const site = createSite({ runner, port: PORT, token: TOKEN, wireframesOrigin: `http://${HOST}:${PORT + 1}`, dashboardDir: DASH });
// The demo's start-up calls to its own page reach that page here, never a port.
const realFetch = globalThis.fetch;
globalThis.fetch = inProcessFetch(() => site, { origin: ORIGIN, fallback: realFetch });

await runner.start({ listen: async () => { console.log(`laptop ready: ${FEATURES_DIR}`); } });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { Promise.resolve(runner.stop()).finally(() => process.exit(0)); });
