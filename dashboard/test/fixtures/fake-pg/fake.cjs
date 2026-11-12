// Fake Postgres tools for dashboard/test/local-db.test.js. No real database is ever touched.
// Each tool (psql, createdb, dropdb, and migrate for the app's "db:migrate" script) appends one JSON
// line to $FAKE_PG_LOG ({ tool, args, url }) and answers from the JSON state file $FAKE_PG_STATE:
//   { version: 170000, databases: { <name>: { ledger: [migration names] | null, connections: n } } }
// createdb fails when $FAKE_PG_FAIL names its target; migrate fails when it names the migration.
'use strict';
const fs = require('node:fs');

const STATE = process.env.FAKE_PG_STATE;
const read = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const write = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const fail = (msg, code = 1) => { process.stderr.write(`${msg}\n`); process.exit(code); };
const lastArg = (args) => args.filter((a) => !a.startsWith('-')).at(-1);

module.exports = function fake(tool) {
  const args = process.argv.slice(2);
  if (process.env.FAKE_PG_LOG) {
    fs.appendFileSync(process.env.FAKE_PG_LOG, `${JSON.stringify({ tool, args, url: process.env.DATABASE_URL ?? null })}\n`);
  }
  const state = read();
  const dbs = state.databases;

  if (tool === 'psql') {
    const db = args[args.indexOf('-d') + 1];
    const sql = args[args.indexOf('-c') + 1];
    if (db !== 'postgres' && !dbs[db]) fail(`psql: error: FATAL:  database "${db}" does not exist`, 2);
    let m;
    if (/show server_version_num/.test(sql)) return console.log(String(state.version ?? 170000));
    if ((m = /from pg_database where datname in \((.*)\)/.exec(sql))) {
      const names = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
      return console.log(names.filter((n) => dbs[n]).join('\n'));
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
      process.exit(1);
    }
    const db = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
    if (!dbs[db]) fail(`migrate: database "${db}" does not exist`);
    dbs[db].ledger = [...(dbs[db].ledger ?? []), name];
    return write(state);
  }

  return fail(`fake: unknown tool ${tool}`);
};
