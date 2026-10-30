// `npm run dev -w hosted`: the hosted site on this laptop, at http://localhost:4507, running the
// very handler Vercel runs (site/router.js) under node:http, with:
//   - PGlite for Postgres, kept in hosted/.data/ (--memory: a fresh one each start);
//   - the fake Google (AUTH_FAKE=1) unless GOOGLE_CLIENT_ID is set, for trying it with no account;
//   - the built page from hosted/public/ (npm run build -w hosted -- --no-migrate makes it).
// Settings come from the environment, then hosted/.env.local if there is one (never committed).
// With the fake Google, made-up defaults fill in what is missing: the people are at example.test,
// and owner@example.test becomes the owner.
//
// startLocalSite({ port, env, dataDir, quiet }) is the same, for the end-to-end run.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_PORT, readConfig } from './site/config.js';
import { openPglite } from './site/db.js';
import { migrate } from './site/migrate.js';
import { createSite } from './site/router.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function startLocalSite({ port = DEV_PORT, env = process.env, dataDir = path.join(HERE, '.data'), quiet = false } = {}) {
  const fake = env.AUTH_FAKE === '1' || !env.GOOGLE_CLIENT_ID;
  const merged = {
    ...env,
    PORT: String(port),
    SITE_URL: env.SITE_URL || `http://localhost:${port}`,
    ...(fake ? {
      AUTH_FAKE: '1',
      ALLOWED_DOMAIN: env.ALLOWED_DOMAIN || 'example.test',
      OWNER_EMAIL: env.OWNER_EMAIL || 'owner@example.test',
      SESSION_SECRET: env.SESSION_SECRET || crypto.randomBytes(32).toString('base64'),
      CRON_SECRET: env.CRON_SECRET || crypto.randomBytes(32).toString('base64'),
    } : {}),
  };
  delete merged.VERCEL;
  const config = readConfig(merged);
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const db = await openPglite(dataDir ?? 'memory://');
  await migrate(db);
  const staticDir = path.join(HERE, 'public');
  if (!fs.existsSync(path.join(staticDir, 'index.html')) && !quiet) console.log('The page isn’t built yet: run npm run build -w hosted -- --no-migrate, then reload.');
  const site = createSite({ db, config, staticDir });
  const server = http.createServer(site);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  if (!quiet) {
    console.log(`The hosted site is running at ${config.siteUrl}  (Ctrl+C to stop)`);
    if (config.authFake) console.log(`  sign-in: the fake Google (AUTH_FAKE); people at ${config.allowedDomain}, owner ${config.ownerEmail}`);
    console.log(`  database: PGlite ${dataDir ? `in ${dataDir}` : 'in memory'}`);
  }
  return {
    url: config.siteUrl, config, db, site,
    async close() {
      await site.close();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      await db.close();
    },
  };
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { process.loadEnvFile(path.join(HERE, '.env.local')); } catch { /* none: the environment and the defaults */ }
  const s = await startLocalSite({ dataDir: process.argv.includes('--memory') ? null : path.join(HERE, '.data') });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { s.close().finally(() => process.exit(0)); });
}
