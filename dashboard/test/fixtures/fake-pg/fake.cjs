// Fake Postgres tools for dashboard/test/local-db.test.js. No real database is ever touched.
// Each tool (psql, createdb, dropdb, and migrate for the app's "db:migrate" script) appends one JSON
// line to $FAKE_PG_LOG ({ tool, args, url }) and answers from the JSON state file $FAKE_PG_STATE:
//   { version: 170000, databases: { <name>: { ledger: [migration names] | null, connections: n, pids?: [ids] } } }
// createdb fails when $FAKE_PG_FAIL names its target; migrate fails when it names the migration.
// migrate exits 0 having written nothing when $FAKE_PG_SILENT names the migration (a script that went elsewhere).
// Each database counts its sessions (psql to it, the fixture app's connections); $FAKE_PG_NO_SESSIONS: a server
// whose pg_stat_database has no sessions column (before Postgres 14).
// $FAKE_PG_HANG = '<tool>:<target>' (psql's -d, createdb's and dropdb's database, migrate's migration):
// that call logs, then never ends. $FAKE_PG_SLOW, the same form: that call waits 1 s, then carries on.
// The server's version is state.versionByPort[$PGPORT], else state.version ('fail': psql can't read it);
// `<tool> --version` prints state.clientVersion (else 17.2) and isn't logged. createdb refuses
// --strategy when the server or the client is older than 15, as the real ones do. Log lines carry the pid.
// $FAKE_PG_REACH = '<host>:<port>' (a plain listener of the test's; port 5432 is never dialled): each call
// first tries to connect there, from a child of its own, and logs what happened as `reach`: 'connected',
// or the error's code (EPERM inside Auto's sandbox). $FAKE_PG_REACH_OUT: the same for migrate only,
// logged as `out` (the tests name 192.0.2.1 only, an address routed nowhere).
'use strict';
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const PROBE = `const s = require('node:net').connect({ host: process.argv[1], port: Number(process.argv[2]) });
const end = (w) => { clearTimeout(t); s.destroy(); process.stdout.write(w); };
const t = setTimeout(() => end('timeout'), 1500);
s.on('connect', () => end('connected'));
s.on('error', (e) => end(e.code));`;
function reach(where) {
  const [host, port] = String(where).split(/:(?=\d+$)/);
  if (!port || Number(port) === 5432) return 'not-in-a-test';
  return spawnSync(process.execPath, ['-e', PROBE, host, port], { encoding: 'utf8', timeout: 5000 }).stdout || 'no answer';
}

const STATE = process.env.FAKE_PG_STATE;
const read = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const write = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const fail = (msg, code = 1) => { process.stderr.write(`${msg}\n`); process.exit(code); };
const lastArg = (args) => args.filter((a) => !a.startsWith('-')).at(-1);

module.exports = function fake(tool) {
  const args = process.argv.slice(2);
  if (args[0] === '--version') return console.log(`${tool} (PostgreSQL) ${read().clientVersion ?? '17.2'}`);
  if (process.env.FAKE_PG_LOG) {
    const reached = {
      ...(process.env.FAKE_PG_REACH ? { reach: reach(process.env.FAKE_PG_REACH) } : {}),
      ...(process.env.FAKE_PG_REACH_OUT && tool === 'migrate' ? { out: reach(process.env.FAKE_PG_REACH_OUT) } : {}),
    };
    fs.appendFileSync(process.env.FAKE_PG_LOG, `${JSON.stringify({ tool, args, url: process.env.DATABASE_URL ?? null, pid: process.pid, ...reached })}\n`);
  }
  const target = tool === 'psql' ? args[args.indexOf('-d') + 1] : tool === 'migrate' ? args.at(-1) : lastArg(args.filter((a, i) => args[i - 1] !== '-T'));
  if (process.env.FAKE_PG_HANG === `${tool}:${target}`) { setInterval(() => {}, 1 << 30); return undefined; }
  if (process.env.FAKE_PG_SLOW === `${tool}:${target}`) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  const state = read();
  const dbs = state.databases;
  const serverVersion = state.versionByPort?.[process.env.PGPORT] ?? state.version ?? 170000;

  if (tool === 'psql') {
    const db = args[args.indexOf('-d') + 1];
    const sql = args[args.indexOf('-c') + 1];
    if (db !== 'postgres' && !dbs[db]) fail(`psql: error: FATAL:  database "${db}" does not exist`, 2);
    // A connection to a database is a session on it (pg_stat_database's sessions), however short.
    if (db !== 'postgres') { dbs[db].sessions = (dbs[db].sessions ?? 0) + 1; write(state); }
    let m;
    if ((m = /select sessions from pg_stat_database where datname = '([^']*)'/.exec(sql))) {
      if (process.env.FAKE_PG_NO_SESSIONS) fail('ERROR:  column "sessions" does not exist');
      return console.log(String(dbs[m[1]]?.sessions ?? 0));
    }
    if (/show server_version_num/.test(sql)) return serverVersion === 'fail' ? fail('psql: error: connection to server failed') : console.log(String(serverVersion));
    if ((m = /from pg_database where datname in \((.*)\)/.exec(sql))) {
      const names = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
      return console.log(names.filter((n) => dbs[n]).join('\n'));
    }
    // The backends on a database: its pids (an app's own, from the fixture app), else one made-up id per connection.
    if ((m = /select pid from pg_stat_activity where datname = '([^']*)'/.exec(sql))) {
      const d = dbs[m[1]] ?? { connections: 0 };
      const pids = [...(d.pids ?? [])];
      for (let i = pids.length; i < (d.connections ?? 0); i++) pids.push(`${m[1]}-${i + 1}`);
      return console.log(pids.join('\n'));
    }
    if ((m = /from pg_stat_activity where datname = '([^']*)'/.exec(sql))) return console.log(String(dbs[m[1]]?.connections ?? 0));
    if (/to_regclass\('public\.applied_migrations'\)/.test(sql)) return console.log(Array.isArray(dbs[db].ledger) ? 't' : 'f');
    if (/select name from applied_migrations/.test(sql)) return console.log((dbs[db].ledger ?? []).join('\n'));
    if ((m = /alter database "([^"]+)" rename to "([^"]+)"/.exec(sql))) {
      if (!dbs[m[1]] || dbs[m[2]]) fail(`ERROR:  cannot rename ${m[1]} to ${m[2]}`);
      dbs[m[2]] = dbs[m[1]];
      delete dbs[m[1]];
      return write(state);
    }
    return fail(`fake psql: unknown query: ${sql}`);
  }

  if (tool === 'createdb') {
    const from = args.includes('-T') ? args[args.indexOf('-T') + 1] : null;
    const to = lastArg(args.filter((a, i) => args[i - 1] !== '-T'));
    if (process.env.FAKE_PG_FAIL && process.env.FAKE_PG_FAIL === to) fail(`createdb: error: database creation failed: ERROR:  could not write to file (fake failure for ${to})`);
    if (args.some((a) => a.startsWith('--strategy')) && (Number(serverVersion) < 150000 || parseInt(state.clientVersion ?? '17', 10) < 15)) fail('createdb: error: unrecognized option --strategy');
    if (dbs[to]) fail(`createdb: error: database creation failed: ERROR:  database "${to}" already exists`);
    if (from && !dbs[from]) fail(`createdb: error: database creation failed: ERROR:  template database "${from}" does not exist`);
    if (from && dbs[from].connections > 0) fail(`createdb: error: database creation failed: ERROR:  source database "${from}" is being accessed by other users`);
    dbs[to] = from ? { ...JSON.parse(JSON.stringify(dbs[from])), connections: 0 } : { ledger: null, connections: 0 };
    return write(state);
  }

  if (tool === 'dropdb') {
    const name = lastArg(args);
    if (!dbs[name]) return args.includes('--if-exists') ? undefined : fail(`dropdb: error: database removal failed: ERROR:  database "${name}" does not exist`);
    if (dbs[name].connections > 0 && !args.includes('--force')) fail(`dropdb: error: database removal failed: ERROR:  database "${name}" is being accessed by other users`);
    delete dbs[name];
    return write(state);
  }

  if (tool === 'migrate') {
    const name = args.at(-1);
    if (process.env.FAKE_PG_FAIL && process.env.FAKE_PG_FAIL === name) {
      for (let i = 1; i <= 25; i++) process.stderr.write(`migrate ${name}: error line ${i}\n`);
      process.stderr.write(`migrate ${name}: could not apply on ${process.env.DATABASE_URL}\n`); // as many scripts do
      process.exit(1);
    }
    if (process.env.FAKE_PG_SILENT && process.env.FAKE_PG_SILENT === name) return console.log(`migrate ${name}: done`);
    const db = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
    if (!dbs[db]) fail(`migrate: database "${db}" does not exist`);
    dbs[db].ledger = [...(dbs[db].ledger ?? []), name];
    return write(state);
  }

  return fail(`fake: unknown tool ${tool}`);
};
