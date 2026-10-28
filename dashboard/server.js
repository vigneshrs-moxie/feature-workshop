// Feature Workshop: local-only dashboard server.
// Listens on 127.0.0.1 only. Reads workflow files, session logs and git (read-only).
// What it changes goes through a job's Foreman session, and only when you click. The one exception
// is "Try it on your computer" (lib/local.js): on your click it runs the job's app, your commands
// and database switches in the job's own worktree.
//
// This file is the host: it reads the environment, makes the two halves and opens the ports.
//   the runner (runner/index.js)  the machine half: the Foreman driver, job folders and locks, git,
//                                 Try it, usage, notifications, the Orbit token
//   the site (site/index.js)      the web half: the page, its routes (site/routes-*.js) and streams
// They talk only through lib/protocol.js: the site gives the runner one checked command at a time
// (runner.handle), reads through runner.read and listens on runner.on. Still one process.
// (A new job from a ticket, POST /api/jobs with `ticket`, starts its status.json at schema
// version 2 in the runner's start: lib/options.js startFromTicket(featureDir, …).)

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRunner } from './runner/index.js';
import { createSite } from './site/index.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4477;
// The screens server: a job's wireframes.html is served from this SECOND origin (PORT + 1 unless
// WIREFRAMES_PORT says otherwise), so the page's own script can't reach this dashboard's document,
// storage or token however it was written. The web frames it from meta.wireframesOrigin.
const WIREFRAMES_PORT = Number(process.env.WIREFRAMES_PORT) || PORT + 1;
const WIREFRAMES_ORIGIN = `http://${HOST}:${WIREFRAMES_PORT}`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const FEATURES_DIR = path.resolve(process.env.WORKSHOP_FEATURES_DIR || path.join(CLAUDE_DIR, 'feature-work'));
const PROJECTS_DIR = path.resolve(process.env.WORKSHOP_PROJECTS_DIR || path.join(CLAUDE_DIR, 'projects'));
const DEMO = Boolean(process.env.WORKSHOP_DEMO);
const TOKEN = crypto.randomBytes(24).toString('hex');

const runner = await createRunner({
  host: HOST, port: PORT, token: TOKEN, dashboardDir: HERE, claudeDir: CLAUDE_DIR,
  featuresDir: FEATURES_DIR, projectsDir: PROJECTS_DIR,
  agentsDir: path.resolve(process.env.WORKSHOP_AGENTS_DIR || path.join(CLAUDE_DIR, 'agents')),
  skillsDir: path.resolve(process.env.WORKSHOP_SKILLS_DIR || path.join(CLAUDE_DIR, 'skills')),
  stateDir: process.env.WORKSHOP_STATE_DIR || (DEMO ? path.join(path.dirname(FEATURES_DIR), 'state') : undefined),
  demo: DEMO, claudePath: process.env.WORKSHOP_CLAUDE_PATH || null,
  claudeSettingsFile: path.resolve(process.env.WORKSHOP_CLAUDE_SETTINGS || path.join(CLAUDE_DIR, 'settings.json')),
  gateParkMs: process.env.WORKSHOP_GATE_PARK_MS,
  planUsage: !DEMO && process.env.WORKSHOP_PLAN_USAGE !== 'off',
  orbitStore: DEMO || process.env.WORKSHOP_ORBIT_STORE === 'file' ? 'file' : 'auto',
  integrateDir: path.resolve(process.env.GROUND_CONTROL_DIR || path.join(os.homedir(), '.ground-control')),
  integrateRoot: path.resolve(process.env.INTEGRATE_ROOT || path.join(HERE, '..')),
});
// The site: the page, its routes and its streams, on PORT (site/index.js); the screens server's
// pages on WIREFRAMES_PORT. Both ask the runner for everything.
const site = createSite({ runner, port: PORT, token: TOKEN, wireframesOrigin: WIREFRAMES_ORIGIN, dashboardDir: HERE });
const server = http.createServer(site);
const screensServer = http.createServer(site.screens);

// The screens server starts with the dashboard (its own origin; see WIREFRAMES_PORT). When it can't
// listen (the port is taken), the dashboard runs without it: meta.wireframesOrigin is null, and the
// 'change' event makes open pages fetch a fresh snapshot (with that meta) so their Screens tab stops
// framing the port.
screensServer.on('error', (err) => {
  console.error(`screens server: couldn’t listen at ${WIREFRAMES_ORIGIN} (${err.code ?? err.message}); the Screens tab is off. Set WIREFRAMES_PORT to a free port and restart.`);
  site.screensOff();
});

await runner.start({
  listen: () => new Promise((resolve) => {
    server.listen(PORT, HOST, () => {
      console.log(`Feature Workshop running at http://${HOST}:${PORT}  (Ctrl+C to stop)`);
      console.log(`  jobs:     ${FEATURES_DIR}`);
      console.log(`  sessions: ${PROJECTS_DIR}`);
      if (DEMO) console.log('  demo mode: a pretend Foreman answers; nothing real runs.');
      resolve();
    });
    screensServer.listen(WIREFRAMES_PORT, HOST, () => {
      console.log(`  screens:  ${WIREFRAMES_ORIGIN} (a job’s wireframes page, framed by the dashboard)`);
    });
  }),
});

// Stopping the dashboard pauses any reply in progress; sessions stay resumable.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    Promise.resolve(runner.stop()).catch((err) => console.error(err)).finally(() => {
      screensServer.close(); // the screens server stops with the dashboard
      setTimeout(() => process.exit(0), 400);
    });
  });
}
