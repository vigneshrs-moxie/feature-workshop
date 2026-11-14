// Pictures he pastes on the job page to pin notes on (Task 17 fix round 1, the lead's ruling). Each is
// saved in the job's own folder as pictures/<sha256>.<ext>, so a pin's note can name the file and the
// Foreman can open it (notes-and-comments.md: a pin is "a spot on a picture"). The same picture twice
// is the same file.
//
// - Only PNG, JPEG, WebP and GIF, told by the file's own first bytes (never by what the page says, so
//   an SVG or a page dressed as a picture is refused); at most 10 MB.
// - Written whole (atomic-write.js), never through a link: a pictures folder that is a symbolic link is
//   refused, and a picture is read back only by its own name (64 hex + its kind), as a plain file.
// - Laptop only: the website keeps pasted pictures in the browser (site/routes-pictures.js).

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http-guard.js';
import { writeFileAtomic } from './atomic-write.js';

export const PICTURE_MAX = 10 * 1024 * 1024;
export const PICTURE_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const NAME = /^[0-9a-f]{64}\.(png|jpg|webp|gif)$/;
const DIR = 'pictures';

const starts = (b, bytes, at = 0) => b.length >= at + bytes.length && bytes.every((x, i) => b[at + i] === x);

/** The picture's kind from its first bytes ('png', 'jpg', 'webp', 'gif'), or null. */
export function sniffPicture(b) {
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts(b, [0xff, 0xd8, 0xff])) return 'jpg';
  if (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (starts(b, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  return null;
}

/** The job's pictures folder, made when it is missing; refused when it is anything but a folder of its own. */
async function picturesDir(jobDir, { make }) {
  const dir = path.join(jobDir, DIR);
  const st = await fs.lstat(dir).catch((err) => (err.code === 'ENOENT' ? null : Promise.reject(err)));
  if (!st) {
    if (!make) throw new HttpError(404, 'No such picture.');
    await fs.mkdir(dir);
    return dir;
  }
  if (!st.isDirectory() || st.isSymbolicLink()) throw new HttpError(make ? 409 : 404, make ? 'This job’s pictures folder isn’t a plain folder, so nothing was saved.' : 'No such picture.');
  return dir;
}

/**
 * Save a pasted picture in the job's folder.
 * @param {string} jobDir the job's own folder
 * @param {Buffer} bytes
 * @returns {Promise<{ path: string, size: number }>} its path inside the job folder (pictures/<sha256>.<ext>)
 */
export async function savePicture(jobDir, bytes) {
  if (!bytes?.length) throw new HttpError(400, 'The picture is empty.');
  if (bytes.length > PICTURE_MAX) throw new HttpError(413, 'The picture is too big: at most 10 MB.');
  const ext = sniffPicture(bytes);
  if (!ext) throw new HttpError(415, 'Only a PNG, JPEG, WebP or GIF picture can be saved.');
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
  const dir = await picturesDir(jobDir, { make: true });
  const file = path.join(dir, name);
  const was = await fs.lstat(file).catch(() => null);
  if (!was) await writeFileAtomic(file, bytes);
  else if (!was.isFile()) throw new HttpError(409, 'That picture’s name is taken by something that isn’t a picture, so nothing was saved.');
  return { path: `${DIR}/${name}`, size: bytes.length };
}

/**
 * A saved picture, by its own name only.
 * @returns {Promise<{ abs: string, type: string, size: number }>}
 */
export async function pictureFile(jobDir, name) {
  const m = NAME.exec(String(name ?? ''));
  if (!m) throw new HttpError(404, 'No such picture.');
  const dir = await picturesDir(jobDir, { make: false });
  const abs = path.join(dir, m[0]);
  const st = await fs.lstat(abs).catch(() => null);
  if (!st || !st.isFile()) throw new HttpError(404, 'No such picture.');
  return { abs, type: PICTURE_TYPES[m[1]], size: st.size };
}
