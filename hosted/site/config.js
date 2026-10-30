// The site's settings, read once from the environment (docs/hosting/vercel-setup.md step 2.4 sets
// them on Vercel; hosted/.env.example lists the names with empty values).
//
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   the Internal OAuth client (step 1.5)
//   ALLOWED_DOMAIN                           the Workspace domain: only its accounts may sign in (hd)
//   SESSION_SECRET                           signs the session cookie (HMAC-SHA256)
//   TOKEN_KEY                                encrypts each person's Orbit token (lib/token-store.js)
//   CRON_SECRET                              Vercel Cron sends it as "Authorization: Bearer …"
//   OWNER_EMAIL                              the first sign-in with it becomes the owner
//   ORBIT_BASE_URL                           Orbit's address, for the inbox poller (lib/poller.js)
//   SITE_URL                                 the site's own address; on a preview, VERCEL_URL stands in
//   DATABASE_URL                             Neon's pooled address (set by the Marketplace integration)
//   AUTH_FAKE=1                              the fake Google of site/fake-google.js, for tests and a
//                                            laptop only: refused on Vercel and with NODE_ENV=production
//
// A missing setting doesn't crash the function: the routes that need it answer 503 and say which
// setting is missing (names only, never a value), and /api/meta lists them for the sign-in page.
// No DATABASE_URL in a production build is its own case (noDatabase): the database and every
// variable are set for Production only (docs/hosting/vercel-setup.md 2.3, 2.5), so a preview
// deployment has none, and says calmly that it has no database instead of failing.

export class ConfigError extends Error {}

export const DEV_PORT = 4507;
const REQUIRED = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ALLOWED_DOMAIN', 'SESSION_SECRET', 'OWNER_EMAIL', 'DATABASE_URL'];

const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const noSlash = (u) => u.replace(/\/+$/, '');

/** Whether this is a production build: any Vercel deployment, or NODE_ENV=production. */
export const isProduction = (env) => Boolean(clean(env.VERCEL)) || clean(env.NODE_ENV) === 'production';

/**
 * The settings. Throws ConfigError when AUTH_FAKE is on in a production build: the fake sign-in
 * lets anyone in as anyone, so such a build must not start at all.
 * overrides: what the tests and the local server set directly (a db url isn't needed with PGlite).
 */
export function readConfig(env = process.env, overrides = {}) {
  const production = isProduction(env);
  const authFake = clean(env.AUTH_FAKE) === '1';
  if (authFake && production) {
    throw new ConfigError('AUTH_FAKE is on in a production build. The fake Google sign-in is only for tests and a laptop; remove AUTH_FAKE from this deployment’s environment.');
  }
  const siteUrl = noSlash(clean(env.SITE_URL) || (clean(env.VERCEL_URL) ? `https://${clean(env.VERCEL_URL)}` : `http://localhost:${clean(env.PORT) || DEV_PORT}`));
  const config = {
    production,
    authFake,
    siteUrl,
    siteOrigin: new URL(siteUrl).origin,
    google: {
      clientId: clean(env.GOOGLE_CLIENT_ID),
      clientSecret: clean(env.GOOGLE_CLIENT_SECRET),
      // Google's discovery document (OpenID Connect). The fake one is served by this site itself.
      discovery: authFake ? `${siteUrl}/fake-google/.well-known/openid-configuration` : 'https://accounts.google.com/.well-known/openid-configuration',
      issuers: authFake ? [`${siteUrl}/fake-google`] : ['https://accounts.google.com', 'accounts.google.com'],
    },
    allowedDomain: clean(env.ALLOWED_DOMAIN).toLowerCase(),
    ownerEmail: clean(env.OWNER_EMAIL).toLowerCase(),
    sessionSecret: clean(env.SESSION_SECRET),
    cronSecret: clean(env.CRON_SECRET),
    databaseUrl: clean(env.DATABASE_URL),
    tokenKey: clean(env.TOKEN_KEY),
    orbitBaseUrl: noSlash(clean(env.ORBIT_BASE_URL)),
    ...overrides,
  };
  if (authFake) {
    config.google = { ...config.google, clientId: config.google.clientId || 'fake-client', clientSecret: config.google.clientSecret || 'fake-secret' };
  }
  config.redirectUri = `${config.siteUrl}/api/auth/callback`;
  config.missing = missingSettings(config);
  config.noDatabase = config.production && !config.databaseUrl;
  return Object.freeze(config);
}

/** The required settings this config lacks, by their environment names (a laptop's PGlite needs no DATABASE_URL). */
function missingSettings(c) {
  const have = {
    GOOGLE_CLIENT_ID: c.google.clientId, GOOGLE_CLIENT_SECRET: c.google.clientSecret, ALLOWED_DOMAIN: c.allowedDomain,
    SESSION_SECRET: c.sessionSecret, OWNER_EMAIL: c.ownerEmail, DATABASE_URL: c.databaseUrl || !c.production,
  };
  return REQUIRED.filter((k) => !have[k]);
}
