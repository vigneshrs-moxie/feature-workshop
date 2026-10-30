// Each person's Orbit token on the site (packet 2C, decision G11, plan §3.2): kept encrypted, used
// only by the inbox poller (lib/poller.js), for that person.
//
//   readTokenKey(b64)        TOKEN_KEY → { id, key }: 32 bytes in base64 (openssl rand -base64 32),
//                            with a key id (a hash of the key, never the key) so it can be rotated
//   seal / unseal            AES-256-GCM with a fresh 12-byte IV each time; the person's id is the
//                            additional data, so a sealed token copied to another person's row
//                            doesn't open. A wrong key, or anything changed, refuses to open.
//   createTokenStore(...)    save, remove, status (never the token), and open (the poller's only)
//
// The token is never logged, returned by a route, sent to a runner, or put in an event, the mirror
// or the audit: only `sealed` is stored, and only open() ever turns it back into the token.

import crypto from 'node:crypto';

export const SEAL_VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** TOKEN_KEY is missing or isn't 32 bytes, or a sealed token can't be opened with it. */
export class TokenKeyError extends Error {
  constructor(message, kind = 'key') { super(message); this.name = 'TokenKeyError'; this.kind = kind; }
}

const b64url = (buf) => buf.toString('base64url');

/** TOKEN_KEY as { id, key }. Throws TokenKeyError in plain words (it never repeats the value). */
export function readTokenKey(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new TokenKeyError('TOKEN_KEY isn’t set in Vercel, so the site can’t keep Orbit tokens yet.', 'missing');
  const key = B64.test(text) ? Buffer.from(text, 'base64') : Buffer.alloc(0);
  if (key.length !== 32) throw new TokenKeyError('TOKEN_KEY in Vercel isn’t 32 bytes in base64. Make one with openssl rand -base64 32.', 'bad');
  const id = `k${crypto.createHash('sha256').update('orbit-token-key\0').update(key).digest('hex').slice(0, 12)}`;
  return Object.freeze({ id, key });
}

const aad = (personId) => Buffer.from(`orbit-token:person:${Number(personId)}`);

/** The token sealed for one person: v1.<key id>.<iv>.<ciphertext>.<tag>. */
export function seal(token, { id, key }, personId) {
  const iv = crypto.randomBytes(IV_BYTES);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  c.setAAD(aad(personId));
  const ct = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return [SEAL_VERSION, id, b64url(iv), b64url(ct), b64url(c.getAuthTag())].join('.');
}

const CANT_OPEN = 'The Orbit token saved on the site can’t be read with the site’s key any more. Paste a new one in Settings → Orbit.';

/** The token back, for the person it was sealed for. keys: one key or several (a rotation). */
export function unseal(sealed, keys, personId) {
  const parts = String(sealed ?? '').split('.');
  if (parts.length !== 5 || parts[0] !== SEAL_VERSION) throw new TokenKeyError(CANT_OPEN);
  const [, kid, iv, ct, tag] = parts;
  const k = [].concat(keys).find((x) => x?.id === kid);
  if (!k) throw new TokenKeyError(CANT_OPEN);
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', k.key, Buffer.from(iv, 'base64url'), { authTagLength: TAG_BYTES });
    d.setAAD(aad(personId));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    throw new TokenKeyError(CANT_OPEN);
  }
}

const iso = (ms) => new Date(ms).toISOString();
const isoOrNull = (v) => (v ? new Date(v).toISOString() : null);

/**
 * The store over the site's database. config: readConfig() (tokenKey). now: the site's clock.
 *   problem()                         null, or TokenKeyError when TOKEN_KEY can't be used
 *   save(personId, token, { expiresAt })   seals and keeps it; the poller starts afresh for this person
 *   remove(personId)                  the token and the inbox read with it, gone
 *   row(personId)                     everything but `sealed`, or null
 *   open(personId)                    the token itself: lib/poller.js only
 */
export function createTokenStore({ db, config, now = () => Date.now() }) {
  let key = null;
  let problem = null;
  try { key = readTokenKey(config.tokenKey); } catch (err) { problem = err; }

  const COLUMNS = 'person_id, key_id, saved_at, expires_at, refused_at, polled_at, full_at, tried_at, error, error_kind, wait_until';

  return {
    problem: () => problem,
    keyId: () => key?.id ?? null,

    async save(personId, token, { expiresAt = null } = {}) {
      if (problem) throw problem;
      const sealed = seal(token, key, personId);
      await db.query(
        `INSERT INTO orbit_tokens (person_id, sealed, key_id, saved_at, expires_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (person_id) DO UPDATE SET sealed = EXCLUDED.sealed, key_id = EXCLUDED.key_id, saved_at = EXCLUDED.saved_at,
           expires_at = EXCLUDED.expires_at, refused_at = NULL, polled_at = NULL, full_at = NULL, tried_at = NULL,
           error = NULL, error_kind = NULL, wait_until = NULL`,
        [personId, sealed, key.id, iso(now()), expiresAt],
      );
    },

    async remove(personId) {
      await db.tx(async (q) => {
        await q.query('DELETE FROM orbit_tokens WHERE person_id = $1', [personId]);
        await q.query('DELETE FROM orbit_inbox WHERE person_id = $1', [personId]);
      });
    },

    async row(personId) {
      const r = (await db.query(`SELECT ${COLUMNS} FROM orbit_tokens WHERE person_id = $1`, [personId])).rows[0];
      if (!r) return null;
      return {
        personId: Number(r.person_id), keyId: r.key_id, savedAt: isoOrNull(r.saved_at), expiresAt: isoOrNull(r.expires_at),
        refusedAt: isoOrNull(r.refused_at), polledAt: isoOrNull(r.polled_at), fullAt: isoOrNull(r.full_at), triedAt: isoOrNull(r.tried_at),
        error: r.error ?? null, errorKind: r.error_kind ?? null, waitUntil: isoOrNull(r.wait_until),
      };
    },

    /** The token, opened for its person. Throws TokenKeyError when it can't be. */
    async open(personId) {
      if (problem) throw problem;
      const r = (await db.query('SELECT sealed FROM orbit_tokens WHERE person_id = $1', [personId])).rows[0];
      if (!r) return null;
      return unseal(r.sealed, key, personId);
    },
  };
}
