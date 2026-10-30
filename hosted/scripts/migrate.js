// `npm run migrate -w hosted`, and the build's last step on Vercel: applies hosted/migrations/ to
// the database (site/migrate.js), in one transaction behind an advisory lock.
//
// It uses DATABASE_URL_UNPOOLED when Neon's integration set it (a direct connection, best for
// schema changes), else DATABASE_URL. With neither: on Vercel that is a mistake and the build stops
// in plain words; on a laptop there is nothing to migrate (the local server uses PGlite and
// migrates it itself), so it says so and stops cleanly.

import { openPostgres } from '../site/db.js';
import { migrate, MigrationError } from '../site/migrate.js';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  if (process.env.VERCEL) {
    console.error('No database to migrate: DATABASE_URL isn’t set. Connect the Neon database to this project for Production and Preview (Storage → Neon), then deploy again.');
    process.exit(1);
  }
  console.log('No DATABASE_URL here, so nothing to migrate. (The local server migrates its own PGlite database.)');
  process.exit(0);
}

const db = await openPostgres(url);
try {
  const r = await migrate(db, { log: (l) => console.log(`migrate: ${l}`) });
  console.log(r.applied.length ? `migrate: applied ${r.applied.length} (${r.applied.join(', ')}).` : `migrate: nothing new (${r.already} applied before).`);
} catch (err) {
  console.error(err instanceof MigrationError ? `migrate: ${err.message}` : `migrate: it failed, and nothing was changed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
