// Puts on the theme you picked in the new view (Settings → Theme) before the page draws, so the
// classic view looks like the new one. Both pages are served from the same address, so they share
// localStorage 'workshop.theme'. A ?theme=<id> in the address wins, as in the new view.
// The two hidden themes (CRT Terminal, Gold) wait for the play ledger: app.js puts them on once
// /api/play says they are unlocked. Keep THEMES in step with web/src/theme/theme.ts.
(function () {
  var THEMES = ['default', 'neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop', 'glass'];
  var id = null;
  try { id = new URLSearchParams(location.search).get('theme') || localStorage.getItem('workshop.theme'); } catch (e) { id = null; }
  document.documentElement.setAttribute('data-theme', THEMES.indexOf(id) >= 0 ? id : 'default');
})();
