// Puts on the look you picked in the new view (Settings → Look) before the page draws, so the
// classic view looks like the new one. Both pages are served from the same address, so they share
// localStorage: 'workshop.theme' (the theme; a ?theme=<id> in the address wins, as in the new view),
// 'workshop.textSize' (s, m, l or xl, set as html[data-text]) and 'workshop.themeFollow' ('on' swaps
// the chosen theme for its dark/light twin by prefers-color-scheme: Default ↔ Light, Glass ↔ Light
// glass; a theme from the address is never swapped).
// The two hidden themes (CRT Terminal, Gold) wait for the play ledger: app.js puts them on once
// /api/play says they are unlocked. Keep THEMES, PAIRS and TEXT_SIZES in step with
// web/src/theme/theme.ts and textSize.ts (ui.js has the same lists; a test checks all agree).
(function () {
  var THEMES = ['default', 'neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop', 'glass', 'light', 'light-glass'];
  var PAIRS = [['default', 'light'], ['glass', 'light-glass']];
  var TEXT_SIZES = ['s', 'm', 'l', 'xl'];
  var read = function (key) { try { return localStorage.getItem(key); } catch (e) { return null; } };
  var fromUrl = null;
  try { fromUrl = new URLSearchParams(location.search).get('theme'); } catch (e) { fromUrl = null; }

  var id;
  if (THEMES.indexOf(fromUrl) >= 0) {
    id = fromUrl;
  } else {
    var stored = read('workshop.theme');
    id = THEMES.indexOf(stored) >= 0 ? stored : 'light';
    if (read('workshop.themeFollow') === 'on' && typeof matchMedia === 'function') {
      var light = matchMedia('(prefers-color-scheme: light)').matches;
      for (var i = 0; i < PAIRS.length; i++) {
        if (PAIRS[i].indexOf(id) >= 0) { id = PAIRS[i][light ? 1 : 0]; break; }
      }
    }
  }
  document.documentElement.setAttribute('data-theme', id);

  var size = read('workshop.textSize');
  document.documentElement.setAttribute('data-text', TEXT_SIZES.indexOf(size) >= 0 ? size : 'm');
})();
