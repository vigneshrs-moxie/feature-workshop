// Tests only: preloaded into a test's dashboard (node --import). It hands server.js a test hook that
// holds a restart while the file named in STARBASE_TEST_HOLD_RESTART exists (it writes <file>.held
// first), so a test can act while a restart is under way without depending on timing. The runner
// itself never reads the environment for this: only a runner given this hook can be held.
import fs from 'node:fs';

/** The --import argument for this file. */
export const HOLD_HOOK = import.meta.url;

const file = process.env.STARBASE_TEST_HOLD_RESTART;
if (file) {
  globalThis.starbaseTestHooks = {
    async holdRestart(slug) {
      if (!fs.existsSync(file)) return;
      fs.writeFileSync(`${file}.held`, slug);
      const until = Date.now() + 30_000; // a test that forgets to release it cannot hang the server
      while (fs.existsSync(file) && Date.now() < until) await new Promise((r) => { setTimeout(r, 20); });
    },
  };
}
