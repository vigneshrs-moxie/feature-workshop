// The website's New job form lists the Foreman models itself (SITE_MODELS in the web source, since
// it has no laptop to ask). It must hold exactly the ids the laptop accepts (FOREMAN_MODEL_IDS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOREMAN_MODEL_IDS } from '../lib/options.js';

const SHEET = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'src', 'views', 'JobSheets', 'NewJobSheet.tsx');

test('the website form’s model list holds exactly the Foreman model ids the laptop accepts', () => {
  const text = fs.readFileSync(SHEET, 'utf8');
  const block = /const SITE_MODELS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(text)?.[1];
  assert.ok(block, 'SITE_MODELS was found in NewJobSheet.tsx');
  const ids = [...block.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...ids].sort(), [...FOREMAN_MODEL_IDS].sort());
});
