// What a Postgres client does first, for the tests of Auto's fence (lib/db-door.js): connect to a
// host and port and send a startup message that names a database. It answers what came back:
//   { connected: false, code }      the connection was not made (EPERM inside the sandbox, ECONNREFUSED…)
//   { connected: true, answer }     what the other side wrote before it closed, or within 3 seconds
// It never dials port 5432, whatever it is asked: no test may reach a real Postgres server.
import net from 'node:net';

/** A protocol 3.0 startup message for `database`. */
export function startupMessage(database, user = 'u') {
  const body = Buffer.concat([...['user', user, 'database', database].map((s) => Buffer.from(`${s}\0`)), Buffer.from([0])]);
  const head = Buffer.alloc(8);
  head.writeInt32BE(8 + body.length, 0);
  head.writeInt32BE(196608, 4);
  return Buffer.concat([head, body]);
}

export function ask({ host = '127.0.0.1', port, database }) {
  if (Number(port) === 5432) return Promise.resolve({ connected: false, code: 'NOT-IN-A-TEST' });
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(port) });
    let got = Buffer.alloc(0);
    let connected = false;
    let timer = null;
    const end = (extra = {}) => { clearTimeout(timer); socket.destroy(); resolve({ connected, ...(connected ? { answer: got.toString('latin1') } : {}), ...extra }); };
    timer = setTimeout(end, 3000);
    socket.on('connect', () => { connected = true; socket.write(startupMessage(database)); });
    socket.on('data', (d) => { got = Buffer.concat([got, d]); });
    socket.on('error', (err) => end({ code: err.code }));
    socket.on('close', () => end());
  });
}
