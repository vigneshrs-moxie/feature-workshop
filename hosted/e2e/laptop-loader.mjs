// `node --import ./laptop-loader.mjs dashboard/demo/run-demo.js`: the demo's laptop, without its
// local page on a port. The demo builds its invented jobs, then imports ../server.js; this hook
// hands it laptop-host.mjs instead (the same runner, no port opened). For the end-to-end run only.
import { registerHooks } from 'node:module';

const HOST = new URL('./laptop-host.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context);
    return r.url.endsWith('/dashboard/server.js') ? { ...r, url: HOST } : r;
  },
});
