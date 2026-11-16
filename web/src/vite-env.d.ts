/// <reference types="vite/client" />

// The user guide's pages, made at build time by vite.config.ts's starbase-guide plugin.
declare module 'virtual:starbase-guide' {
  const pages: import('./views/Guide/guideBuild').GuidePage[];
  export default pages;
}
