import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { summariseSession, typedText, History, historyMarkdown } from '../lib/history.js';

// An invented conversation in Claude Code's log shape.
const line = (o) => JSON.stringify(o);
const user = (text, extra = {}) => line({ type: 'user', sessionId: 'S', cwd: '/w/acme', gitBranch: 'feature/x', entrypoint: 'cli', timestamp: extra.at ?? '2026-10-01T10:00:00Z', message: { role: 'user', content: text }, ...extra });
const assistant = (content, at = '2026-10-01T10:01:00Z') => line({ type: 'assistant', sessionId: 'S', cwd: '/w/acme', gitBranch: 'feature/x', entrypoint: 'cli', timestamp: at, message: { model: 'claude-opus-5-5', content, usage: { input_tokens: 10, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 } } });
const LOG = [
  user('<local-command-caveat>Caveat: ignore</local-command-caveat>'),
  user('Add a Copy ID button to the ticket page<system-reminder>noise</system-reminder>'),
  user([{ type: 'tool_result', content: 'ok' }]),
  user('meta', { isMeta: true }),
  assistant([{ type: 'text', text: 'Looking.' }, { type: 'tool_use', name: 'Edit', input: { file_path: '/w/acme/src/a.ts' } }]),
  user('<command-name>/feature</command-name><command-args>copy id</command-args>', { at: '2026-10-01T10:02:00Z' }),
  line({ type: 'ai-title', aiTitle: 'Copy ID button' }),
  line({ type: 'pr-link', prUrl: 'https://github.com/o/r/pull/7', prNumber: 7, prRepository: 'o/r' }),
  assistant([{ type: 'text', text: 'Done: button added.' }], '2026-10-01T11:00:00Z'),
  'not json',
].join('\n');

test('history: reads what was asked, where, what changed and how it ended', () => {
  assert.equal(typedText({ type: 'user', message: { content: [{ type: 'tool_result' }] } }), null);
  assert.equal(typedText({ type: 'user', message: { content: '<command-name>/feature</command-name><command-args>x y</command-args>' } }), '/feature x y');
  const s = summariseSession(LOG);
  assert.equal(s.title, 'Copy ID button');
  assert.deepEqual(s.prompts.map((p) => p.text), ['Add a Copy ID button to the ticket page', '/feature copy id'], 'no caveats, tool results, meta lines or reminders');
  assert.equal(s.branch, 'feature/x');
  assert.deepEqual([...s.filesEdited], ['/w/acme/src/a.ts']);
  assert.equal(s.lastAnswer, 'Done: button added.');
  assert.equal(s.workflow, true);
  assert.equal(s.contextTokens, 5010);
  assert.equal(s.prs[0].number, 7);
});

test('history: lists conversations, folds continued ones, flags jobs and missing logs; the extract is capped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-history-'));
  const proj = path.join(root, '-w-acme');
  await fs.mkdir(proj, { recursive: true });
  const a = '11111111-1111-1111-1111-111111111111';
  const b = '22222222-2222-2222-2222-222222222222';
  await fs.writeFile(path.join(proj, `${a}.jsonl`), `${user('First part', { sessionId: a })}\n${line({ type: 'continued-in', continuedInSessionId: b })}\n`);
  await fs.writeFile(path.join(proj, `${b}.jsonl`), LOG.replaceAll('"S"', `"${b}"`));
  await fs.mkdir(path.join(proj, '33333333-3333-3333-3333-333333333333'));

  const h = new History(root);
  const { rows, missing } = await h.list({ linked: new Map([[a, 'copy-id']]) });
  assert.equal(rows.length, 1, 'the earlier part is folded into the later one');
  assert.deepEqual(rows[0].chain, [a, b]);
  assert.equal(rows[0].messages, 3);
  assert.equal(rows[0].job, 'copy-id', 'a job using any part counts');
  assert.equal(missing.length, 1, 'a session folder with no log is listed as unavailable');

  const d = await h.detail(b);
  assert.equal(d.prompts[0].text, 'First part');
  const md = historyMarkdown({ ...d, prompts: Array.from({ length: 60 }, (_, i) => ({ at: null, text: `message ${i} ${'x'.repeat(2000)}` })) });
  assert.match(md, /not an approval/);
  assert.match(md, /left out/);
  assert.ok(md.length < 40000, 'the extract stays a few pages long');
  await fs.rm(root, { recursive: true, force: true });
});
