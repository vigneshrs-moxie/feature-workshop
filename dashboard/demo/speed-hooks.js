// The speed checks' window into a running demo (web/e2e/jobSpeed.mjs, speed rules 3, 5 and 6), loaded
// only as a preload of the demo, on a port of its own:
//
//   SPEED_HOOKS_PORT=4497 PORT=4495 node --import ./dashboard/demo/speed-hooks.js dashboard/demo/run-demo.js
//
// It does nothing unless the script it is loaded in front of is demo/run-demo.js and the port is set,
// so a real Starbase never has it, and the site has no route for it.
//
// What it counts, for each request the site answers (by an AsyncLocalStorage started at the server's
// `request`, so what a request starts is put down to it, and the demo's own background work is not):
// every program started (child_process: git, ps, psql …) and every read under the agents' log folder
// (the demo's projects folder). What it serves, on 127.0.0.1:<port>, GET only:
//   GET /io                   { requests: { "<METHOD> <path>": { n, spawns: [..], logReads: [..] } }, background: { spawns, logReads } }
//                             (what a request started after its answer had gone is under "<METHOD> <path> (after its answer)")
//   GET /io/reset             starts the counts again
//   GET /talk?slug=<slug>     one made-up Foreman reply arrives in that demo job: a `run-ended` audit line
//                             with the reply, then the job's status.json written again (same text) so the
//                             runner's watch of the jobs folder sees the job change, as it does when a
//                             real reply ends. Answers { at, n }.

import { AsyncLocalStorage } from 'node:async_hooks';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';

const main = process.argv[1] ? path.resolve(process.argv[1]) : '';
const PORT = Number(process.env.SPEED_HOOKS_PORT) || 0;
const isDemo = path.basename(main) === 'run-demo.js' && path.basename(path.dirname(main)) === 'demo';

if (isDemo && PORT) install();

function install() {
  // The demo's folders (run-demo.js setRoot: the system's temp folder's starbase-demo).
  const ROOT = path.join(os.tmpdir(), 'starbase-demo');
  const LOGS = path.join(ROOT, 'projects');
  const AUDIT = path.join(ROOT, 'state', 'audit.jsonl');
  const FEATURES = path.join(ROOT, 'feature-work');
  const realLogs = () => { try { return fs.realpathSync(LOGS); } catch { return LOGS; } };
  let logsReal = null;

  const als = new AsyncLocalStorage();
  let counts = fresh();
  function fresh() { return { since: new Date().toISOString(), requests: {}, background: { spawns: [], logReads: [] } }; }
  const bucket = () => {
    const s = als.getStore();
    if (!s) return counts.background;
    if (s.hooks) return null; // this port's own requests
    // Work a request started that runs on after its answer went (a rebuild behind the answer) is its own line.
    const key = `${s.method} ${s.path}${s.res?.writableFinished ? ' (after its answer)' : ''}`;
    return (counts.requests[key] ??= { n: 0, spawns: [], logReads: [] });
  };

  // The site's requests (and nothing else's): each one runs in its own store.
  const realEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function emit(type, req, ...rest) {
    if (type === 'request' && req && typeof req.url === 'string' && !this.__speedHooks) {
      const store = { method: req.method, path: new URL(req.url, 'http://x').pathname, res: rest[0] };
      return als.run(store, () => {
        const b = bucket();
        if (b) b.n++; // (counted as it comes in, before any answer)
        return realEmit.call(this, type, req, ...rest);
      });
    }
    return realEmit.call(this, type, req, ...rest);
  };

  // Programs started.
  // The program and its first word that is not an option (git -C <dir> log … → git log).
  const what = (cmd, args) => {
    const list = Array.isArray(args) ? args.map(String) : [];
    let i = 0;
    while (i < list.length && list[i].startsWith('-')) i += /^-[Cc]$/.test(list[i]) ? 2 : 1;
    return [path.basename(String(cmd ?? '')).split(' ')[0], list[i] ?? ''].join(' ').trim();
  };
  for (const name of ['spawn', 'execFile', 'exec', 'fork', 'spawnSync', 'execFileSync', 'execSync']) {
    const real = childProcess[name];
    if (typeof real !== 'function') continue;
    const spy = function (...args) { bucket()?.spawns.push(what(args[0], args[1])); return real.apply(this, args); };
    if (real[util.promisify.custom]) {
      const p = real[util.promisify.custom];
      spy[util.promisify.custom] = function (...args) { bucket()?.spawns.push(what(args[0], args[1])); return p.apply(this, args); };
    }
    childProcess[name] = spy;
  }

  // Reads under the agents' log folder.
  const underLogs = (p) => {
    if (typeof p !== 'string' && !(p instanceof URL) && !Buffer.isBuffer(p)) return false;
    const s = p instanceof URL ? p.pathname : String(p);
    logsReal ??= realLogs();
    return s.startsWith(LOGS) || s.startsWith(logsReal);
  };
  const spyReads = (mod, names) => {
    for (const name of names) {
      const real = mod[name];
      if (typeof real !== 'function') continue;
      mod[name] = function (p, ...rest) { if (underLogs(p)) bucket()?.logReads.push(path.basename(String(p))); return real.call(this, p, ...rest); };
    }
  };
  spyReads(fsp, ['readFile', 'open', 'readdir']);
  spyReads(fs, ['readFile', 'readFileSync', 'createReadStream', 'readdir', 'readdirSync', 'open', 'openSync']);
  syncBuiltinESMExports();

  // One made-up reply arriving in a job.
  let talked = 0;
  const WORDS = ['The export now groups shifts by crew.', 'I checked the week boundary again.', 'Nothing else changed in the plan.', 'The tests still pass on the branch.'];
  async function talk(slug) {
    if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(slug)) throw new Error('Name a demo job (?slug=…).');
    const dir = path.join(FEATURES, slug);
    const statusFile = path.join(dir, 'status.json');
    const status = await fsp.readFile(statusFile, 'utf8');
    const n = ++talked;
    const at = new Date().toISOString();
    const reply = `**Speed check reply ${n}.** ${WORDS[n % WORDS.length]} ${WORDS[(n + 1) % WORDS.length]}`;
    await fsp.appendFile(AUDIT, `${JSON.stringify({ at, action: 'run-ended', featureDir: dir, slug, sessionId: null, runId: `demo-speed-talk-${n}`, status: 'done', costUsd: 0.01, reply })}\n`);
    await fsp.writeFile(statusFile, status);
    return { at, n };
  }

  const server = http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    als.run({ hooks: true }, async () => {
      try {
        const url = new URL(req.url, 'http://x');
        if (req.method !== 'GET') return send(405, { error: 'GET only.' });
        if (url.pathname === '/io') return send(200, counts);
        if (url.pathname === '/io/reset') { counts = fresh(); return send(200, { ok: true }); }
        if (url.pathname === '/talk') return send(200, await talk(url.searchParams.get('slug') ?? ''));
        return send(404, { error: 'Not here.' });
      } catch (err) { return send(500, { error: err.message }); }
    });
  });
  server.__speedHooks = true;
  server.listen(PORT, '127.0.0.1', () => console.log(`  speed hooks: http://127.0.0.1:${PORT} (demo only: /io, /io/reset, /talk)`));
  server.unref();
}
