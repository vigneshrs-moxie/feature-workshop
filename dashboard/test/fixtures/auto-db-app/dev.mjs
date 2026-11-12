// The stand-in app's dev server. It reads .env.local as Next.js does (settings.mjs: a value already
// in the process wins); with --override the file wins, as an app that ignores the address it is given.
// With --both it also "connects" to the database its .env.local names, as an app with a second client
// that reads its own file.
//   GET /     answers the database address it uses. The first one "connects": one connection (with
//             this process's id) is added to that database in $FAKE_PG_STATE (fixtures/fake-pg), and
//             taken away again when the app is stopped. No real database is ever touched.
//   GET /env  answers the database settings in its environment (settings.mjs databaseSettings).
import fs from 'node:fs';
import http from 'node:http';
import { databaseSettings, dbName, loadSettings, readSettings } from './settings.mjs';

const fromFile = readSettings().DATABASE_URL ?? '';
loadSettings({ override: process.argv.includes('--override') });
const url = process.env.DATABASE_URL ?? '';
const urls = [url, ...(process.argv.includes('--both') && fromFile ? [fromFile] : [])].filter(Boolean);

const STATE = process.env.FAKE_PG_STATE;
let connected = [];
const me = `app-${process.pid}`;
function connections(name, by) {
  if (!STATE) return;
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const db = state.databases?.[name];
  if (!db) return;
  db.connections = Math.max(0, (db.connections ?? 0) + by);
  if (by > 0) db.sessions = (db.sessions ?? 0) + 1;
  db.pids = by > 0 ? [...(db.pids ?? []), me] : (db.pids ?? []).filter((p) => p !== me);
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
}

const server = http.createServer((req, res) => {
  if (req.url === '/env') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(databaseSettings()));
    return;
  }
  if (!connected.length) {
    for (const u of urls) { try { const name = dbName(u); connections(name, 1); connected.push(name); } catch { /* not an address */ } }
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(url);
});

const stop = () => {
  for (const name of connected) { try { connections(name, -1); } catch { /* the state is gone with the test */ } }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.listen(Number(process.env.PORT), process.env.HOSTNAME || '127.0.0.1');
