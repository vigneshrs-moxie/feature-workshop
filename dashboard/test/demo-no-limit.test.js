// The regular demo never trips Claude's account-wide usage limit (packet W, fix 1): a limit there
// shows the "5-hour limit is reached" banner across the whole app and holds every send, in every
// copy of the demo. The floor's "paused for the limit" pose belongs to #/floor-lab's fixtures and
// the unit tests. A demo job may still look paused, by its own pause (its last reply was stopped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const demo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo');

test('no demo script writes a usage limit or sends past one', async () => {
  for (const name of (await fs.readdir(demo)).filter((n) => n.endsWith('.js'))) {
    const src = await fs.readFile(path.join(demo, name), 'utf8');
    assert.doesNotMatch(src, /usageLimit\s*:/, `${name} writes a usage limit into the state`);
    assert.doesNotMatch(src, /despiteLimit/, `${name} sends past a usage limit`);
  }
});

test('Route Sharing still looks paused, by its own pause: its last reply was stopped', async () => {
  const src = await fs.readFile(path.join(demo, 'run-demo.js'), 'utf8');
  assert.match(src, /action: 'run-ended', featureDir: sharing, slug: 'route-sharing'[^}]*status: 'stopped'/);
});
