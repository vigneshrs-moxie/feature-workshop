#!/usr/bin/env node
// ground-control: Ground Control from the terminal (packet G: `resume` only; packet I adds the rest).
//
//   ground-control resume <job>   carry on a job's reply that a restart paused (a crash's waits for
//                                 this) or that you paused with Stop. <job> is the job's name (its
//                                 slug) or the ticket it is for (ORBIT-479).
//
// It finds the running service through service.json in the state folder (dashboard/runner/
// service-file.js: pid, port, write token) and sends it the `resume` command.

import { pidAlive } from '../dashboard/lib/lock.js';
import { readServiceFile, stateDirFor } from '../dashboard/runner/service-file.js';

const NOT_RUNNING = 'Ground Control isn’t running. Start it with npm start (ground-control start once it is installed). A job paused by a clean stop carries on by itself.';
const USAGE = 'Usage: ground-control resume <job>   (the job’s name, or its ticket, like ORBIT-479)';

async function resume(name) {
  if (!name) { console.error(USAGE); return 2; }
  const service = readServiceFile(stateDirFor(process.env));
  if (!service || !pidAlive(service.pid)) { console.error(NOT_RUNNING); return 1; }
  const url = `http://${service.host}:${service.port}/api/job/${encodeURIComponent(name)}/resume`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workshop-Token': service.token }, body: JSON.stringify({ via: 'cli' }) });
  } catch {
    console.error(NOT_RUNNING);
    return 1;
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    console.error(body?.error ?? `Ground Control said no (${res.status}).`);
    return 1;
  }
  console.log(`Resumed ${name}: the Foreman is carrying on${body?.run?.sessionId ? ` in the same session (${body.run.sessionId})` : ''}.`);
  return 0;
}

const [command, ...args] = process.argv.slice(2);
let code;
if (command === 'resume') code = await resume(args[0]);
else { console.error(USAGE); code = 2; }
process.exitCode = code;
