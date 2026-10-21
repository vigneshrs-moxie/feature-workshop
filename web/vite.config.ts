// Vite config for the new Feature Workshop UI.
// The dashboard serves the built files at /next/ (see dashboard/lib/web-app.js), so every
// asset URL starts with /next/. `npm run web:dev` runs Vite on its own port and forwards
// /api to a running dashboard (default http://127.0.0.1:4477, or set WORKSHOP_URL, e.g. the
// demo on http://127.0.0.1:4479).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { tokensCss } from './src/theme/tokens.ts';
import { classicThemeCss } from './src/theme/classicSheet.ts';

const target = process.env.WORKSHOP_URL || 'http://127.0.0.1:4477';

// Writes src/theme/tokens.css from src/theme/tokens.ts when they differ, at the start of every
// dev server and build. After editing tokens.ts while `npm run web:dev` runs, restart it.
function themeTokens(): Plugin {
  return {
    name: 'workshop-theme-tokens',
    buildStart() {
      const file = fileURLToPath(new URL('./src/theme/tokens.css', import.meta.url));
      const css = tokensCss();
      if (!existsSync(file) || readFileSync(file, 'utf8') !== css) writeFileSync(file, css);
    },
  };
}

// Writes dist/theme.css for the classic view (dashboard/public/index.html links /next/theme.css), so
// it wears the theme you picked here: the tokens, each theme's page-level rules and its fonts, in
// the order themes/index.css imports them (src/theme/classicSheet.ts).
function classicTheme(): Plugin {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  return {
    name: 'workshop-classic-theme',
    apply: 'build',
    generateBundle() {
      const themes = [...read('./src/theme/themes/index.css').matchAll(/@import\s+'\.\/([\w-]+\.css)'/g)].map((m) => m[1]);
      const files = [{ name: 'tokens.css', css: read('./src/theme/tokens.css') }, ...themes.map((f) => ({ name: `themes/${f}`, css: read(`./src/theme/themes/${f}`) }))];
      this.emitFile({ type: 'asset', fileName: 'theme.css', source: classicThemeCss(files) });
    },
  };
}

export default defineConfig({
  base: '/next/',
  plugins: [themeTokens(), classicTheme(), react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The dashboard's CSP has no `data:` for fonts or scripts, so never inline assets.
    assetsInlineLimit: 0,
    sourcemap: true,
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
  },
});
