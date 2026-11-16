// Vite config for the new Starbase UI.
// The dashboard serves the built files at /next/ (see dashboard/lib/web-app.js), so every
// asset URL starts with /next/. `npm run web:dev` runs Vite on its own port and forwards
// /api to a running dashboard (default http://127.0.0.1:4477, or set STARBASE_URL, e.g. the
// demo on http://127.0.0.1:4479).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { tokensCss } from './src/theme/tokens.ts';
import { classicThemeCss } from './src/theme/classicSheet.ts';
import { swatchCss } from './src/theme/swatchSheet.ts';
import { buildGuide, imageSizer, loadRenderer } from './src/views/Guide/guideBuild.ts';

const target = process.env.STARBASE_URL || process.env.WORKSHOP_URL || 'http://127.0.0.1:4477'; // the new name, else the old one

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const writeIfChanged = (rel: string, css: string) => {
  const file = fileURLToPath(new URL(rel, import.meta.url));
  if (!existsSync(file) || readFileSync(file, 'utf8') !== css) writeFileSync(file, css);
};
/** The theme files, in the order themes/index.css imports them. */
const themeFiles = () => [...read('./src/theme/themes/index.css').matchAll(/@import\s+'\.\/([\w-]+\.css)'/g)].map((m) => ({ name: `themes/${m[1]}`, css: read(`./src/theme/themes/${m[1]}`) }));

// Writes src/theme/tokens.css from src/theme/tokens.ts, and src/theme/swatches.css (the picker's
// swatches, from every theme file: src/theme/swatchSheet.ts) when they differ, at the start of every
// dev server and build. After editing tokens.ts or a theme while `npm run web:dev` runs, restart it.
function themeTokens(): Plugin {
  return {
    name: 'workshop-theme-tokens',
    buildStart() {
      writeIfChanged('./src/theme/tokens.css', tokensCss());
      writeIfChanged('./src/theme/swatches.css', swatchCss(themeFiles()));
    },
  };
}

// Writes dist/theme.css for the classic view (dashboard/public/index.html links /next/theme.css), so
// it wears the theme you picked here: the tokens, each theme's page-level rules and its fonts, in
// the order themes/index.css imports them (src/theme/classicSheet.ts).
function classicTheme(): Plugin {
  return {
    name: 'workshop-classic-theme',
    apply: 'build',
    generateBundle() {
      const files = [{ name: 'tokens.css', css: read('./src/theme/tokens.css') }, ...themeFiles()];
      this.emitFile({ type: 'asset', fileName: 'theme.css', source: classicThemeCss(files) });
    },
  };
}

// The user guide (docs/guide) as the module `virtual:starbase-guide`: its pages in the contents'
// order, { id, n, title, html }, rendered at build time by the server's own Markdown renderer
// (src/views/Guide/guideBuild.ts). Only the Guide page imports it, so it is in that page's chunk.
// The pictures are copied into the build as guide/img/<name> (next to the app: /next/guide/img/ on
// the laptop, /guide/img/ on the website); `npm run web:dev` serves them from docs/guide/img.
const GUIDE_ID = 'virtual:starbase-guide';
function starbaseGuide(): Plugin {
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const dir = fileURLToPath(new URL('../docs/guide/', import.meta.url));
  let base = '/';
  let building = false;
  return {
    name: 'starbase-guide',
    configResolved(config) { base = config.base; building = config.command === 'build'; },
    resolveId(id) { return id === GUIDE_ID ? `\0${GUIDE_ID}` : null; },
    async load(id) {
      if (id !== `\0${GUIDE_ID}`) return null;
      const guide = buildGuide({ dir, render: await loadRenderer(repo), base, size: imageSizer(dir) });
      for (const w of guide.warnings) this.warn(`guide: ${w}`);
      for (const f of readdirSync(dir)) if (f.endsWith('.md')) this.addWatchFile(join(dir, f));
      if (building) {
        for (const name of guide.images) this.emitFile({ type: 'asset', fileName: `guide/img/${name}`, source: readFileSync(join(dir, 'img', name)) });
      }
      return `export default ${JSON.stringify(guide.pages)};`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/(?:next\/)?guide\/img\/([\w.-]+\.png)$/.exec((req.url ?? '').split('?')[0]);
        const file = m ? join(dir, 'img', m[1]) : null;
        if (!file || !existsSync(file)) { next(); return; }
        res.setHeader('Content-Type', 'image/png');
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  base: '/next/',
  plugins: [themeTokens(), classicTheme(), starbaseGuide(), react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The dashboard's CSP has no `data:` for fonts or scripts, so never inline assets.
    assetsInlineLimit: 0,
    sourcemap: true,
    // Each page is its own chunk (src/app/pages.tsx), but the CSS stays one stylesheet, loaded with
    // the page, in the order src/main.tsx imports it: a page's look never waits for its code, and
    // what loaded first never changes which rule wins (src/app/cssOrder.test.ts).
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'styles', test: /\.css$/ }] } } },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target,
        // The dashboard only accepts Host 127.0.0.1/localhost (changeOrigin sets it to the
        // target) and writes only from its own Origin, so present the dashboard's own address.
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            if (proxyReq.getHeader('origin')) proxyReq.setHeader('origin', target);
          });
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // See test-setup.ts: a busy machine gets more time, not a failure.
    testTimeout: 20000,
    // Times are shown in the computer's own zone: one fixed zone (the team's, with no summer time)
    // makes a snapshot with a time in it the same on every machine, CI included.
    env: { TZ: 'America/Phoenix' },
  },
});
