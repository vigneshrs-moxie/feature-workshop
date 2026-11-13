// The stand-in app's dev server. It reads .env.local as Next.js does (settings.mjs: a value already
// in the process wins); with --override the file wins, as an app that ignores the address it is given.
// With --both it also "connects" to the database its .env.local names, as an app with a second client
// that reads its own file.
//   GET /     answers the database address it uses. The first one "connects": one connection (with
//             this process's id) is added to that database in $FAKE_PG_STATE (fixtures/fake-pg), and
//             taken away again when the app is stopped. No real database is ever touched.
//   GET /env  answers the database settings in its environment (settings.mjs databaseSettings).
//   GET /reach  tries every Postgres address in its own .env.local the way a driver that reads the
//             file itself would (reach, below), and answers what happened. Only tests with a plain
//             listener standing for his server ask for it.
//   GET /move?socket=<path>  tries to get around the fence by moving a socket file: it connects to
//             the socket, renames it to "moved" in the same folder and connects under that name, and
//             answers what each met. Only for a socket in a folder named sb-fence-…, which a test
//             made: never a real server's.
// With --ask-his its first GET / also asks the server its environment names (PGHOST, PGPORT) for the
// database its .env.local names, with a real startup message (ask.mjs): Auto's door refuses it.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { ask } from './ask.mjs';
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

/**
 * Every Postgres address in .env.local, read as dotenv reads it (a quoted value may run over lines)
 * and taken apart as a driver's URL parser does (line ends dropped, the first part of the path the
 * database), tried two ways: straight at its own host and port, and at the server the environment
 * names with a startup message for its database. { KEY: { database, direct, door } }.
 */
async function reach() {
  const out = {};
  for (const m of fs.readFileSync('.env.local', 'utf8').matchAll(/^([A-Z_]+)=(?:"([^"]*)"|(\S*))$/gm)) {
    let u;
    try { u = new URL(m[2] ?? m[3]); } catch { continue; }
    if (!/^postgres(ql)?:$/.test(u.protocol)) continue;
    const database = decodeURIComponent(u.pathname.split('/')[1] ?? '');
    out[m[1]] = {
      database,
      direct: await ask({ host: u.hostname, port: u.port || 5432, database }),
      door: await ask({ host: process.env.PGHOST, port: process.env.PGPORT, database }),
    };
  }
  return out;
}

/** What a connection to a socket file meets: 'connected', or the error's code. */
const meet = (file) => new Promise((resolve) => {
  const s = net.connect({ path: file });
  s.on('connect', () => { s.destroy(); resolve('connected'); });
  s.on('error', (err) => resolve(err.code));
});
/** A test's stand-in socket, tried, renamed to a name with no .s.PGSQL. in it, and tried there: { direct, rename, moved }. */
async function move(socket) {
  const dir = path.dirname(socket);
  if (!path.basename(dir).startsWith('sb-fence-')) return { error: 'not a test\'s socket' };
  const out = { direct: await meet(socket) };
  try { fs.renameSync(socket, path.join(dir, 'moved')); out.rename = 'renamed'; } catch (err) { out.rename = err.code; }
  out.moved = await meet(path.join(dir, 'moved'));
  return out;
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/move?')) {
    move(new URL(req.url, 'http://app.test').searchParams.get('socket') ?? '').then((r) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r)); });
    return;
  }
  if (req.url === '/env') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(databaseSettings()));
    return;
  }
  if (req.url === '/reach') {
    reach().then((r) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r)); });
    return;
  }
  let asked = null;
  if (!connected.length) {
    for (const u of urls) { try { const name = dbName(u); connections(name, 1); connected.push(name); } catch { /* not an address */ } }
    if (process.argv.includes('--ask-his') && fromFile) asked = ask({ host: process.env.PGHOST, port: process.env.PGPORT, database: dbName(fromFile) });
  }
  Promise.resolve(asked).then(() => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(url);
  });
});

const stop = () => {
  for (const name of connected) { try { connections(name, -1); } catch { /* the state is gone with the test */ } }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.listen(Number(process.env.PORT), process.env.HOSTNAME || '127.0.0.1');
