// Pasted pictures (job page rebuild, Task 17 fix round 1, the lead's ruling): a picture he pastes to
// pin a note on is saved in the job's own folder as pictures/<sha256>.<ext>, so the Foreman can open the
// file the note names. PNG, JPEG, WebP and GIF only, at most 10 MB, read by their own first bytes,
// written whole, never through a link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PICTURE_MAX, pictureFile, savePicture, sniffPicture } from '../lib/pictures.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a made-up picture')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const GIF = Buffer.from('GIF89a and so on');

async function jobDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'sb-pictures-'));
}

test('the kinds are read by their first bytes', () => {
  assert.equal(sniffPicture(PNG), 'png');
  assert.equal(sniffPicture(JPEG), 'jpg');
  assert.equal(sniffPicture(WEBP), 'webp');
  assert.equal(sniffPicture(GIF), 'gif');
  assert.equal(sniffPicture(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(sniffPicture(Buffer.from([0x89, 0x50])), null);
});

test('a picture is saved whole as pictures/<sha256>.<ext>; the same picture again is the same file', async () => {
  const dir = await jobDir();
  const sha = createHash('sha256').update(PNG).digest('hex');
  const r = await savePicture(dir, PNG);
  assert.deepEqual(r, { path: `pictures/${sha}.png`, size: PNG.length });
  assert.deepEqual(await fs.readFile(path.join(dir, r.path)), PNG);
  assert.deepEqual(await savePicture(dir, PNG), r);
  // No temporary file is left beside it.
  assert.deepEqual(await fs.readdir(path.join(dir, 'pictures')), [`${sha}.png`]);
  await fs.rm(dir, { recursive: true, force: true });
});

test('anything else is refused, and nothing is written: another kind, an empty file, one over 10 MB', async () => {
  const dir = await jobDir();
  await assert.rejects(savePicture(dir, Buffer.from('<svg/>')), (e) => e.status === 415 && /PNG, JPEG, WebP or GIF/.test(e.message));
  await assert.rejects(savePicture(dir, Buffer.alloc(0)), (e) => e.status === 400);
  const big = Buffer.concat([PNG, Buffer.alloc(PICTURE_MAX)]);
  await assert.rejects(savePicture(dir, big), (e) => e.status === 413 && /10 MB/.test(e.message));
  await assert.rejects(fs.stat(path.join(dir, 'pictures')), { code: 'ENOENT' });
  await fs.rm(dir, { recursive: true, force: true });
});

test('a pictures folder that is a link elsewhere is never written through or read through', async () => {
  const dir = await jobDir();
  const elsewhere = await jobDir();
  await fs.symlink(elsewhere, path.join(dir, 'pictures'));
  await assert.rejects(savePicture(dir, PNG), (e) => e.status === 409);
  assert.deepEqual(await fs.readdir(elsewhere), []);
  await assert.rejects(pictureFile(dir, `${'a'.repeat(64)}.png`), (e) => e.status === 404);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(elsewhere, { recursive: true, force: true });
});

test('a saved picture is read back only by its own name: no other path, no link, no other kind', async () => {
  const dir = await jobDir();
  const { path: rel } = await savePicture(dir, GIF);
  const name = rel.slice('pictures/'.length);
  const f = await pictureFile(dir, name);
  assert.equal(f.type, 'image/gif');
  assert.equal(f.size, GIF.length);
  assert.equal(f.abs, path.join(dir, rel));
  for (const bad of ['../options.json', `${name}/x`, 'x.png', `${'a'.repeat(64)}.svg`, '', `../pictures/${name}`]) {
    await assert.rejects(pictureFile(dir, bad), (e) => e.status === 404, bad);
  }
  // A file swapped for a link is not followed.
  const other = path.join(dir, 'secret.txt');
  await fs.writeFile(other, 'not a picture');
  const linked = `${'b'.repeat(64)}.png`;
  await fs.symlink(other, path.join(dir, 'pictures', linked));
  await assert.rejects(pictureFile(dir, linked), (e) => e.status === 404);
  await fs.rm(dir, { recursive: true, force: true });
});
