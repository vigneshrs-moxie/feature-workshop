// The stand-in app's "db:migrate" script (`npm run db:migrate -- <name>`). It reads .env.local as the
// owner's migrate script does (dotenv without override: a value already in the process wins), then:
// writes the address it got to migrated.txt and the database settings in its environment to
// migrate-env.json (both in the app's folder), logs { tool: 'migrate', args, url } to $FAKE_PG_LOG,
// and adds the migration to that database's ledger in $FAKE_PG_STATE (fixtures/fake-pg). No real
// database is ever touched.
import fs from 'node:fs';
import { databaseSettings, dbName, loadSettings } from './settings.mjs';

loadSettings();
const url = process.env.DATABASE_URL ?? '';
const args = process.argv.slice(2);
fs.writeFileSync('migrated.txt', url);
fs.writeFileSync('migrate-env.json', JSON.stringify(databaseSettings()));
if (process.env.FAKE_PG_LOG) fs.appendFileSync(process.env.FAKE_PG_LOG, `${JSON.stringify({ tool: 'migrate', args, url })}\n`);

const STATE = process.env.FAKE_PG_STATE;
if (STATE) {
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const db = state.databases?.[dbName(url)];
  if (!db) { process.stderr.write(`migrate: database "${dbName(url)}" does not exist\n`); process.exit(1); }
  db.ledger = [...(db.ledger ?? []), args.at(-1)];
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
}
