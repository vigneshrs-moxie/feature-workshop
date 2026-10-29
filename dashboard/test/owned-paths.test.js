// The owned-paths hook (packet K, step 5): a section's Foreman may write only inside its owned
// paths in its worktree, and anywhere in its own job folder. A write anywhere else is refused by a
// PreToolUse hook on Edit|Write|MultiEdit|NotebookEdit with "This section may only change: <paths>."
// Through the hook itself, and through the Driver with a pretend Claude that runs the hooks as
// Claude Code does. No model calls.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Driver } from '../lib/driver.js';
import { State } from '../lib/state.js';
import { WRITE_TOOLS_MATCHER, ownedPathsHook, ownedRefusal, ownedWrite, sectionOwnership } from '../lib/stack.js';

const roots = [];
after(async () => { for (const r of roots) await fs.rm(r, { recursive: true, force: true }); });
const tmp = async (name) => { const d = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), name))); roots.push(d); return d; };

const WT = path.resolve('/work/orbit-512-api');
const JOB = path.resolve('/jobs/orbit-512--api');
const owned = { section: 'api', owns: ['app/api/**', 'app/lib/work-orders.ts'], worktree: WT, jobDir: JOB };
const pre = (tool, input, cwd = WT) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: `t-${Math.random()}`, cwd });

test('ownedWrite: owned paths in the worktree and the job folder yes; anything else no, in words', () => {
  assert.equal(ownedWrite(path.join(WT, 'app/api/orders.ts'), owned).ok, true);
  assert.equal(ownedWrite('app/api/deep/x.ts', owned, WT).ok, true, 'a path relative to the worktree');
  assert.equal(ownedWrite(path.join(WT, 'app/lib/work-orders.ts'), owned).ok, true);
  assert.equal(ownedWrite(path.join(JOB, 'status.json'), owned).ok, true, 'its job folder stays writable');
  const no = ownedWrite(path.join(WT, 'app/ui/page.tsx'), owned);
  assert.deepEqual(no, { ok: false, reason: 'This section may only change: app/api/**, app/lib/work-orders.ts.' });
  assert.equal(ownedWrite(path.resolve('/etc/hosts'), owned).ok, false, 'outside the worktree');
  assert.equal(ownedWrite(path.join(WT, '..', 'orbit-512-ui', 'app/api/x.ts'), owned).ok, false, 'another section’s worktree');
  assert.equal(ownedWrite(path.join(WT, 'app/api/../ui/x.ts'), owned).ok, false, 'no way out with ..');
  assert.equal(ownedRefusal(['a/**']), 'This section may only change: a/**.');
});

test('ownedPathsHook: refuses a write outside with the words; lets the rest through and other tools alone', async () => {
  const refused = [];
  const hook = ownedPathsHook(owned, (v, input) => refused.push([v.file, input.tool_name]));
  assert.deepEqual(await hook(pre('Write', { file_path: path.join(WT, 'app/api/x.ts'), content: 'y' })), {});
  assert.deepEqual(await hook(pre('Bash', { command: 'echo hi > app/ui/x' })), {}, 'Bash is the hard-line hook’s, and the merge check catches it');
  for (const [tool, input] of [
    ['Write', { file_path: path.join(WT, 'app/ui/x.tsx'), content: 'y' }],
    ['Edit', { file_path: path.join(WT, 'package.json'), old_string: 'a', new_string: 'b' }],
    ['MultiEdit', { file_path: path.join(WT, 'README.md'), edits: [] }],
    ['NotebookEdit', { notebook_path: path.join(WT, 'nb.ipynb'), new_source: '' }],
  ]) {
    const out = await hook(pre(tool, input));
    assert.deepEqual(out, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'This section may only change: app/api/**, app/lib/work-orders.ts.' } }, tool);
  }
  assert.deepEqual(refused.map((r) => r[1]), ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
  assert.equal(WRITE_TOOLS_MATCHER, 'Edit|Write|MultiEdit|NotebookEdit');
});

test('sectionOwnership: a job whose status.json names a stack and a section gets that section’s owned paths', async () => {
  const features = await tmp('gc-owned-');
  const parent = path.join(features, 'orbit-512');
  const child = path.join(features, 'orbit-512--api');
  await fs.mkdir(parent);
  await fs.mkdir(child);
  await fs.writeFile(path.join(parent, 'stack.json'), JSON.stringify({ version: 1, parent: 'orbit-512', sections: [{ name: 'api', state: 'running', owns: ['app/api/**'], worktree: '/w/api' }] }));
  await fs.writeFile(path.join(child, 'status.json'), JSON.stringify({ schema_version: 1, slug: 'orbit-512--api', stack: 'orbit-512', section: 'api', stage: 'plan' }));
  assert.deepEqual(await sectionOwnership(child), { section: 'api', owns: ['app/api/**'], worktree: '/w/api', jobDir: child });
  assert.equal(await sectionOwnership(parent), null, 'the parent is not a section');
  await fs.writeFile(path.join(child, 'status.json'), JSON.stringify({ schema_version: 1, slug: 'x', stack: '../elsewhere', section: 'api' }));
  assert.equal(await sectionOwnership(child), null, 'a stack name that leaves the folder is not followed');
});

// A pretend Claude Code that runs the PreToolUse hooks before each write, as the real one does.
function hookedSession(writes) {
  return ({ prompt, options }) => (async function* () {
    await prompt[Symbol.asyncIterator]().next();
    yield { type: 'system', subtype: 'init', session_id: 's-section', model: 'claude-opus-5-5', apiKeySource: 'none' };
    const results = [];
    for (const [i, w] of writes.entries()) {
      const input = { hook_event_name: 'PreToolUse', tool_name: w.tool, tool_input: w.input, tool_use_id: `t${i}`, cwd: options.cwd, session_id: 's-section' };
      let decision = null;
      for (const m of options.hooks?.PreToolUse ?? []) {
        if (!new RegExp(`^(?:${m.matcher})$`).test(w.tool)) continue;
        for (const h of m.hooks) {
          const out = await h(input, `t${i}`, { signal: new AbortController().signal });
          if (out?.hookSpecificOutput?.permissionDecision === 'deny') decision = out.hookSpecificOutput;
        }
      }
      results.push(decision ? `refused: ${decision.permissionDecisionReason}` : 'written');
    }
    hookedSession.results = results;
    hookedSession.options = options;
    yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: results.join(' | ') }] } };
    yield { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0, permission_denials: [] };
  })();
}

test('driver.startSection: a section’s Foreman is refused a write outside its owned paths; its own and its job folder go through', async () => {
  const root = await tmp('gc-owned-driver-');
  const state = new State(path.join(root, 'state'));
  const wt = path.join(root, 'orbit-512-api');
  const job = path.join(root, 'jobs', 'orbit-512--api');
  await fs.mkdir(wt, { recursive: true });
  await fs.mkdir(job, { recursive: true });
  const queryFn = hookedSession([
    { tool: 'Write', input: { file_path: path.join(wt, 'app/api/orders.ts'), content: 'ok' } },
    { tool: 'Edit', input: { file_path: path.join(wt, 'app/ui/page.tsx'), old_string: 'a', new_string: 'b' } },
    { tool: 'Write', input: { file_path: path.join(job, 'status.json'), content: '{}' } },
  ]);
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent', locks: null });
  driver.idleGraceMs = 30;
  const ended = new Promise((resolve) => driver.on('run', (r) => { if (['done', 'error'].includes(r.status)) resolve(r); }));
  await driver.startSection({ featureDir: job, slug: 'orbit-512--api', title: 'Work orders · api', cwd: wt, model: 'claude-opus-5-5', effort: 'medium', text: 'Build the api section.', owned: { section: 'api', owns: ['app/api/**'], worktree: wt, jobDir: job } });
  const r = await ended;
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(hookedSession.results, ['written', 'refused: This section may only change: app/api/**.', 'written']);
  assert.equal(hookedSession.options.effort, 'medium', 'the section’s effort reaches Claude Code');
  assert.ok(hookedSession.options.hooks.PreToolUse.some((m) => m.matcher === 'Bash'), 'the hard-line hook is still there');
  const audit = (await state.auditFor(job)).filter((e) => e.action === 'outside-owned-refused');
  assert.equal(audit.length, 1);
  assert.deepEqual([audit[0].tool, audit[0].section, audit[0].file, audit[0].reason], ['Edit', 'api', path.join(wt, 'app/ui/page.tsx'), 'This section may only change: app/api/**.']);
});

test('driver: a job that isn’t a section gets no owned-paths hook', async () => {
  const root = await tmp('gc-owned-plain-');
  const state = new State(path.join(root, 'state'));
  const job = path.join(root, 'jobs', 'plain');
  await fs.mkdir(job, { recursive: true });
  const queryFn = hookedSession([{ tool: 'Write', input: { file_path: path.join(root, 'anywhere.txt'), content: 'x' } }]);
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent', locks: null });
  driver.idleGraceMs = 30;
  const ended = new Promise((resolve) => driver.on('run', (r) => { if (['done', 'error'].includes(r.status)) resolve(r); }));
  await driver.start({ featureDir: job, slug: 'plain', title: 'Plain', cwd: root, text: 'go' });
  assert.equal((await ended).status, 'done');
  assert.deepEqual(hookedSession.results, ['written']);
  assert.ok(!hookedSession.options.hooks.PreToolUse.some((m) => m.matcher === WRITE_TOOLS_MATCHER));
});
