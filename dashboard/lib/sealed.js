// A sealed answer (packet 2B): how a live answer from the laptop (a commit's diff) reaches the one
// page that asked, through the site, without the site ever holding it readable.
//
// The site's request that asks makes a key pair in memory (answerKeys) and hands the runner only the
// public half, with the command. The runner seals its answer to it (seal: X25519 with a key of its
// own made for this answer, HKDF-SHA256, AES-256-GCM). The site keeps the sealed answer for at most
// a minute, until the request that asked opens it (open) with the private half, which never left
// that request's memory; then the sealed copy is deleted. A copy of the database alone opens nothing.

import crypto from 'node:crypto';

const INFO = Buffer.from('sealed answer v1');

const pub = (b64) => crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
const keyFrom = (secret, salt) => Buffer.from(crypto.hkdfSync('sha256', secret, salt, INFO, 32));

/** { publicKey: base64 (to hand out), privateKey: a KeyObject (kept in memory only) }. */
export function answerKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return { publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey };
}

/** Seals a JSON value to a public key (base64). */
export function seal(publicKeyB64, value) {
  const eph = crypto.generateKeyPairSync('x25519');
  const epk = eph.publicKey.export({ type: 'spki', format: 'der' });
  const key = keyFrom(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: pub(publicKeyB64) }), epk);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(value ?? null), 'utf8'), c.final()]);
  return { v: 1, epk: epk.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/** Opens a sealed answer with the private key it was sealed to. Throws when it can't. */
export function open(privateKey, sealed) {
  if (!sealed || sealed.v !== 1) throw new Error('That isn’t a sealed answer.');
  const epk = Buffer.from(sealed.epk, 'base64');
  const key = keyFrom(crypto.diffieHellman({ privateKey, publicKey: pub(sealed.epk) }), epk);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  d.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const text = Buffer.concat([d.update(Buffer.from(sealed.data, 'base64')), d.final()]).toString('utf8');
  return JSON.parse(text);
}
