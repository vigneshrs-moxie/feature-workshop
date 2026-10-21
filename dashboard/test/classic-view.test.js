// The classic view next to the new one (2026-10-21): it wears the theme picked in the new view, its
// New view button goes back to the same page, and its words match. Pure checks on dashboard/public
// and the new view's sources: no browser, no server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { THEMES, HIDDEN_THEMES, newViewHref } from '../public/ui.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFile(path.join(root, rel), 'utf8');

// theme-boot.js run as the page runs it, with a given address and stored theme.
async function boot({ search = '', stored = null, storageThrows = false } = {}) {
  const attrs = {};
  const sandbox = {
    location: { search },
    URLSearchParams,
    localStorage: { getItem: (k) => { if (storageThrows) throw new Error('blocked'); return k === 'workshop.theme' ? stored : null; } },
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
  };
  vm.runInNewContext(await read('dashboard/public/theme-boot.js'), sandbox);
  return attrs['data-theme'];
}

test('classic: the theme picked in the new view is put on before the page draws', async () => {
  assert.equal(await boot({ stored: 'glass' }), 'glass');
  assert.equal(await boot({ stored: 'sunset-paper', search: '?theme=pixel-crew' }), 'pixel-crew', 'the address wins, as in the new view');
  for (const stored of [null, 'light', 'dark', 'auto', 'crt', 'gold', 'nonsense']) assert.equal(await boot({ stored }), 'default', String(stored));
  assert.equal(await boot({ storageThrows: true }), 'default', 'storage blocked: the default');
});

test('classic: its theme lists match the new view’s', async () => {
  const themeTs = await read('web/src/theme/theme.ts');
  const entries = [...themeTs.matchAll(/\{ id: '([\w-]+)',[^}]*?(unlock: '(\w+)')?\s*\}/g)];
  const originals = entries.filter((m) => !m[2]).map((m) => m[1]);
  const hidden = entries.filter((m) => m[2]).map((m) => m[1]);
  assert.deepEqual(THEMES, originals);
  assert.deepEqual(HIDDEN_THEMES, hidden);
  const bootList = /var THEMES = \[([^\]]*)\]/.exec(await read('dashboard/public/theme-boot.js'))[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  assert.deepEqual(bootList, originals);
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
