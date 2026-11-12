// The stand-in app's dev server. It reads .env.local as Next.js does (settings.mjs: a value already
// in the process wins); with --override the file wins, as an app that ignores the address it is given.
//   GET /     answers the database address it uses. The first one "connects": one connection is
//             added to that database in $FAKE_PG_STATE (fixtures/fake-pg), and taken away again
//             when the app is stopped. No real database is ever touched.
//   GET /env  answers the database settings in its environment (settings.mjs databaseSettings).
import fs from 'node:fs';
import http from 'node:http';
import { databaseSettings, dbName, loadSettings } from './settings.mjs';

loadSettings({ override: process.argv.includes('--override') });
const url = process.env.DATABASE_URL ?? '';

const STATE = process.env.FAKE_PG_STATE;
let connected = null;
function connections(name, by) {
  if (!STATE) return;
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const db = state.databases?.[name];
  if (!db) return;
  db.connections = Math.max(0, (db.connections ?? 0) + by);
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
}

const server = http.createServer((req, res) => {
  if (req.url === '/env') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(databaseSettings()));
    return;
  }
  if (!connected && url) {
    try { connected = dbName(url); connections(connected, 1); } catch { connected = null; }
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(url);
});

const stop = () => {
  if (connected) { try { connections(connected, -1); } catch { /* the state is gone with the test */ } }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.listen(Number(process.env.PORT), process.env.HOSTNAME || '127.0.0.1');
