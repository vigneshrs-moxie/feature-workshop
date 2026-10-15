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

export default defineConfig({
  base: '/next/',
  plugins: [themeTokens(), react()],
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
