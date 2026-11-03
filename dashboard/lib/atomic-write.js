// Saving a file whole: the words go to a temporary file beside it, which then replaces the file in
// one step, so a reader never sees half a file. Every save in dashboard/lib goes through here.
//
// On Windows the replacing step is sometimes refused for a moment (EPERM, EACCES or EBUSY) while
// something else has the file open: a virus scanner looking at the new file, or a reader of the
// old one. Saves then failed at random (seen on Windows CI: Send back stopped, a stack never
// merged). The step is tried again for up to about three seconds before the error is passed on.
// Anywhere else those codes mean what they say, and the first error is passed on at once.
//
//   writeFileAtomic(file, data, { mode })   the temporary file's name is never shared
//   replaceFile(tmp, file)                  for a caller that prepares the temporary file itself

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const GIVE_UP_MS = 3000;

/** The temporary file's name for a save of file: this process, and a part no other save shares. */
export const tmpNameFor = (file) => `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;

/** tmp replaces file. On failure tmp is removed and the error passed on. */
export async function replaceFile(tmp, file, { platform = process.platform, rename = fs.rename, wait = sleep, now = Date.now } = {}) {
  const started = now();
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, file);
      return;
    } catch (err) {
      if (platform === 'win32' && BUSY.has(err?.code) && now() - started < GIVE_UP_MS) {
        await wait(Math.min(10 * 2 ** i, 200));
        continue;
      }
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }
}

/** Saves data as file, whole. mode is the new file's (as fs.writeFile takes it). */
export async function writeFileAtomic(file, data, { mode, ...replace } = {}) {
  const tmp = tmpNameFor(file);
  try {
    await fs.writeFile(tmp, data, mode === undefined ? undefined : { mode });
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  await replaceFile(tmp, file, replace);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
