// Vite config for the new Feature Workshop UI.
// The dashboard serves the built files at /next/ (see dashboard/lib/web-app.js), so every
// asset URL starts with /next/. `npm run web:dev` runs Vite on its own port and forwards
// /api to a running dashboard (default http://127.0.0.1:4477, or set WORKSHOP_URL, e.g. the
// demo on http://127.0.0.1:4479).
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const target = process.env.WORKSHOP_URL || 'http://127.0.0.1:4477';

export default defineConfig({
  base: '/next/',
  plugins: [react()],
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
