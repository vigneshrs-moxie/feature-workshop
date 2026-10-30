// The classic view next to the new one (2026-10-21): it wears the theme picked in the new view, its
// New view button goes back to the same page, and its words match. Pure checks on dashboard/public
// and the new view's sources: no browser, no server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { THEMES, HIDDEN_THEMES, THEME_PAIRS, TEXT_SIZES, newViewHref } from '../public/ui.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFile(path.join(root, rel), 'utf8');

// theme-boot.js run as the page runs it, with a given address, stored look and system scheme.
async function bootAttrs({ search = '', stored = null, textSize = null, follow = null, system = null, storageThrows = false } = {}) {
  const attrs = {};
  const values = { 'workshop.theme': stored, 'workshop.textSize': textSize, 'workshop.themeFollow': follow };
  const sandbox = {
    location: { search },
    URLSearchParams,
    localStorage: { getItem: (k) => { if (storageThrows) throw new Error('blocked'); return values[k] ?? null; } },
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
  };
  if (system) sandbox.matchMedia = (q) => ({ matches: q.includes(system) });
  vm.runInNewContext(await read('dashboard/public/theme-boot.js'), sandbox);
  return attrs;
}
const boot = async (opts) => (await bootAttrs(opts))['data-theme'];

test('classic: the theme picked in the new view is put on before the page draws', async () => {
  assert.equal(await boot({ stored: 'glass' }), 'glass');
  assert.equal(await boot({ stored: 'light-glass' }), 'light-glass');
  assert.equal(await boot({ stored: 'sunset-paper', search: '?theme=pixel-crew' }), 'pixel-crew', 'the address wins, as in the new view');
  for (const stored of [null, 'dark', 'auto', 'crt', 'gold', 'nonsense']) assert.equal(await boot({ stored }), 'light', String(stored));
  assert.equal(await boot({ storageThrows: true }), 'light', 'storage blocked: the default, Light');
});

test('classic: the text size picked in the new view goes on html[data-text] before the page draws', async () => {
  assert.equal((await bootAttrs({ textSize: 'xl' }))['data-text'], 'xl');
  for (const textSize of [null, 'huge', 'XL']) assert.equal((await bootAttrs({ textSize }))['data-text'], 'm', String(textSize));
  assert.equal((await bootAttrs({ storageThrows: true }))['data-text'], 'm');
});

test('classic: Follow the system swaps the stored theme for its twin by the system scheme, never one from the address', async () => {
  assert.equal(await boot({ follow: 'on', system: 'light' }), 'light', 'nothing stored: Light, and following a light system it stays Light');
  assert.equal(await boot({ stored: 'light', follow: 'on', system: 'dark' }), 'default');
  assert.equal(await boot({ stored: 'glass', follow: 'on', system: 'light' }), 'light-glass');
  assert.equal(await boot({ stored: 'light-glass', follow: 'on', system: 'dark' }), 'glass');
  assert.equal(await boot({ stored: 'blueprint', follow: 'on', system: 'light' }), 'blueprint', 'no twin: as chosen');
  assert.equal(await boot({ stored: 'light', follow: 'off', system: 'dark' }), 'light', 'off: as chosen');
  assert.equal(await boot({ stored: 'light', follow: 'on' }), 'light', 'no matchMedia: as chosen');
  assert.equal(await boot({ stored: 'light', follow: 'on', system: 'light', search: '?theme=glass' }), 'glass', 'the address is a request');
});

test('classic: its theme lists match the new view’s', async () => {
  const themeTs = await read('web/src/theme/theme.ts');
  const entries = [...themeTs.matchAll(/\{ id: '([\w-]+)',[^}]*?(unlock: '(\w+)')?\s*\}/g)];
  const originals = entries.filter((m) => !m[2]).map((m) => m[1]);
  const hidden = entries.filter((m) => m[2]).map((m) => m[1]);
  assert.deepEqual(THEMES, originals);
  assert.deepEqual(HIDDEN_THEMES, hidden);
  const boot = await read('dashboard/public/theme-boot.js');
  const bootList = /var THEMES = \[([^\]]*)\]/.exec(boot)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  assert.deepEqual(bootList, originals);
  // The dark/light pairs and the text sizes too (web/src/theme/theme.ts THEME_PAIRS, textSize.ts TEXT_SIZES).
  const pairsOf = (src, name) => [...new RegExp(`${name} = \\[((?:\\s*\\[[^\\]]*\\],?)*)\\s*\\]`).exec(src)[1].matchAll(/\[([^\]]*)\]/g)].map((m) => m[1].split(',').map((x) => x.trim().replace(/'/g, '')));
  const tsPairs = pairsOf(themeTs, 'export const THEME_PAIRS: readonly \\(readonly \\[dark: string, light: string\\]\\)\\[\\]');
  assert.deepEqual(tsPairs, [['default', 'light'], ['glass', 'light-glass']]);
  assert.deepEqual(THEME_PAIRS, tsPairs);
  assert.deepEqual(pairsOf(boot, 'var PAIRS'), tsPairs);
  const sizes = /var TEXT_SIZES = \[([^\]]*)\]/.exec(boot)[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  assert.deepEqual(sizes, ['s', 'm', 'l', 'xl']);
  assert.deepEqual(TEXT_SIZES, sizes);
  assert.match(await read('web/src/theme/textSize.ts'), /TEXT_SIZES: readonly TextSize\[\] = \['s', 'm', 'l', 'xl'\]/);
});

test('classic: New view goes back to the same page', () => {
  assert.equal(newViewHref('#/job/widget-export'), '/next/#/job/widget-export');
  assert.equal(newViewHref('#/job/a%20b'), '/next/#/job/a%20b');
  assert.equal(newViewHref('#/crew'), '/next/#/crew');
  for (const hash of ['', '#/', '#/costs', '#/history']) assert.equal(newViewHref(hash), '/next/', hash);
});

test('classic: the page links the shared theme sheet, the boot script, Settings and the new view', async () => {
  const html = await read('dashboard/public/index.html');
  assert.ok(html.indexOf('/next/theme.css') < html.indexOf('styles.css'), 'the theme first, then the page’s styles');
  assert.ok(html.indexOf('theme-boot.js') < html.indexOf('app.js'));
  assert.match(html, /href="\/next\/#\/settings"/);
  assert.match(html, /id="to-new" href="\/next\/"/);
  assert.doesNotMatch(html, /id="clock"|id="theme"/, 'no day/night toggle: the theme comes from the new view');
});

test('classic: status words and levels match the new view', async () => {
  const app = await read('dashboard/public/app.js');
  for (const word of ['Go-ahead', 'Question', 'Your turn', 'Permission', 'Idle', 'Paused', 'Done', 'Dropped']) assert.match(app, new RegExp(`'${word}'`), word);
  assert.doesNotMatch(app, /Resting|green light|Green: working/);
  const panels = await read('dashboard/public/panels.js');
  assert.match(panels, /levelFields\(meta\.levels\)/);
  assert.match(panels, /options: fd\.get\('level'\) \? \{ level: Number\(fd\.get\('level'\)\) \} : \{\}/);
  assert.doesNotMatch(panels, /optionsFields|name="flow"/, 'no schema 1 flows left');
  const job = await read('dashboard/public/job.js');
  assert.match(job, /\/next\/#\/job\/\$\{encodeURIComponent\(d\.slug\)\}\?open=options/);
});
