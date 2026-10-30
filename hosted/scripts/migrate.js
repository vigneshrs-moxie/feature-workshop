// `npm run migrate -w hosted`, and the build's last step on Vercel: applies hosted/migrations/ to
// the database (site/migrate.js), in one transaction behind an advisory lock.
//
// It uses DATABASE_URL_UNPOOLED when Neon's integration set it (a direct connection, best for
// schema changes), else DATABASE_URL. With neither there is nothing to migrate, and the build goes
// on: the database is connected for Production only (docs/hosting/vercel-setup.md 2.3), so a
// preview build has none and must never touch the real one; on a laptop the local server migrates
// its own PGlite database.

import { openPostgres } from '../site/db.js';
import { migrate, MigrationError } from '../site/migrate.js';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log(process.env.VERCEL
    ? `No database for this deployment; migrations skipped.${process.env.VERCEL_ENV === 'production' ? ' This is the production build: connect the Neon database to Production (Storage → Neon) and deploy again.' : ''}`
    : 'No DATABASE_URL here, so nothing to migrate. (The local server migrates its own PGlite database.)');
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
