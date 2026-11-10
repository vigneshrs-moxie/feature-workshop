import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFeatures, SessionIndex, projectFor, kindFor } from '../lib/features.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
let tmp;
let featuresDir;
let projectsDir;

// Build a throwaway features folder and projects folder from the fixtures.
before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-test-'));
  featuresDir = path.join(tmp, 'feature-work');
  projectsDir = path.join(tmp, 'projects');

  const widget = path.join(featuresDir, 'widget-export');
  await fs.mkdir(path.join(widget, 'briefs'), { recursive: true });
  await fs.mkdir(path.join(widget, 'review'), { recursive: true });
  await fs.copyFile(path.join(FIX, 'workflow-status-standard.md'), path.join(widget, 'workflow-status.md'));
  await fs.copyFile(path.join(FIX, 'status-valid.json'), path.join(widget, 'status.json'));
  await fs.writeFile(path.join(widget, 'briefs', '001-spec.md'), 'brief one');
  await fs.writeFile(path.join(widget, 'briefs', '002-review.md'), 'brief two');
  await fs.writeFile(path.join(widget, 'findings.md'), '# Findings');
  await fs.writeFile(path.join(widget, 'review', 'permissions.md'), '# Permissions lens');

  const bulk = path.join(featuresDir, 'bulk-archive');
  await fs.mkdir(bulk, { recursive: true });
  await fs.copyFile(path.join(FIX, 'workflow-status-freeform.md'), path.join(bulk, 'workflow-status.md'));

  await fs.mkdir(path.join(featuresDir, 'empty-idea'), { recursive: true });

  // Copy the logs, pointing their folder mentions at this temp features folder.
  await fs.cp(path.join(FIX, 'projects'), projectsDir, { recursive: true });
  const walk = async (dir) => {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (p.endsWith('.jsonl')) {
        const t = await fs.readFile(p, 'utf8');
        await fs.writeFile(p, t.replaceAll('__FEATURES__', featuresDir));
      }
    }
  };
  await walk(projectsDir);
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

test('loads every feature folder, waiting ones first', async () => {
  const features = await loadFeatures({ featuresDir, sessionIndex: new SessionIndex(projectsDir), now: Date.parse('2026-10-03T12:00:00Z') });
  assert.deepEqual(features.map((f) => f.slug), ['widget-export', 'bulk-archive', 'empty-idea']);
  const [widget, bulk, empty] = features;

  assert.equal(widget.needsYou, true);
  assert.equal(widget.title, 'Widget Export');
  assert.equal(widget.stage, 'review');
  assert.deepEqual(widget.skipped, ['refine']);
  assert.equal(widget.waitingFor, 'answers');
  assert.equal(widget.latestBrief.number, 2);
  assert.equal(widget.briefs.length, 2);
  assert.ok(widget.artifacts.some((a) => a.file === 'review/permissions.md'));
  assert.equal(widget.approvals.length, 3, 'approvals come from workflow-status.md');
  assert.deepEqual(widget.sources, { workflowStatus: true, statusJson: true });

  assert.equal(bulk.needsYou, true);
  assert.equal(bulk.stage, 'plan');
  assert.equal(bulk.sources.statusJson, false);

  assert.equal(empty.title, 'empty-idea');
  assert.equal(empty.stage, null);
  assert.equal(empty.cost.source, 'none');
  // When each job started (the 3D floor's bench order): its folder's birth time where the file
  // system keeps one, and the Foreman's first session where the logs have one.
  for (const f of features) assert.ok(f.folderCreatedAt === null || Number.isFinite(Date.parse(f.folderCreatedAt)));
  assert.ok(widget.firstSessionAt === null || Number.isFinite(Date.parse(widget.firstSessionAt)));
});

test('project and feature-or-bug labels', async () => {
  const features = await loadFeatures({ featuresDir, sessionIndex: new SessionIndex(projectsDir), now: Date.parse('2026-10-03T12:00:00Z') });
  const widget = features.find((f) => f.slug === 'widget-export');
  assert.deepEqual(widget.project, { name: 'widget-repo', path: '/tmp/widget-repo' });
  assert.equal(widget.kind, 'feature');
  assert.equal(features.find((f) => f.slug === 'empty-idea').project.name, 'Unknown project');
  assert.deepEqual(projectFor('/a/b/acme-portal/'), { name: 'acme-portal', path: '/a/b/acme-portal' });
  assert.equal(kindFor(null, 'fix/login-loop', 'x'), 'bug');
  assert.equal(kindFor(null, null, 'bug-123-crash'), 'bug');
  assert.equal(kindFor('bug', 'feature/x', 'x'), 'bug');
  assert.equal(kindFor(null, 'feature/x', 'x'), 'feature');
});

test('spend across all sessions counts every log, workflow or not', async () => {
  const s = await new SessionIndex(projectsDir).spendSince({ all: 0 });
  // widget session (fable 0.51515 + opus 0.102012) + the unrelated chat (opus, 99999 output).
  close(s.all.usd, 0.51515 + 0.102012 + (4 + 99999 * 20) / 1e6);
});

test('attributes only the workflow session, using Claude Code’s own cost', async () => {
  const features = await loadFeatures({ featuresDir, sessionIndex: new SessionIndex(projectsDir), now: Date.parse('2026-10-03T12:00:00Z') });
  const widget = features.find((f) => f.slug === 'widget-export');
  assert.deepEqual(widget.sessionIds, ['sess-widget-1'], 'the chat that only mentions the folder is not counted');
  assert.equal(widget.cost.source, 'claude-code');
  close(widget.cost.totalUsd, 0.702012);
  close(widget.cost.perModel['claude-fable-5-1'], 0.6);
  const writer = widget.cost.agents.find((a) => a.agentType === 'feature-spec-writer');
  assert.equal(writer.stage, 'spec');
  close(writer.usd, 0.102012);
  assert.equal(widget.activity.length, 2);
  assert.ok(widget.activity.every((a) => a.state === 'finished'));
  assert.equal(widget.working, false);
});

// A job whose Foreman sent one worker; the worker's log stops on a Bash call with no result.
// `answered`: the Foreman's log holds the worker's report (the result of its Agent call).
async function jobWithOneWorker(answered) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-worker-'));
  const dir = path.join(root, 'feature-work', 'one-worker');
  await fs.mkdir(dir, { recursive: true });
  const session = path.join(root, 'projects', '-tmp-repo', 'sess-one');
  await fs.mkdir(path.join(session, 'subagents'), { recursive: true });
  const line = (o) => JSON.stringify({ sessionId: 'sess-one', cwd: '/tmp/repo', ...o });
  const foreman = [
    line({ type: 'user', timestamp: '2026-11-10T09:00:00Z', message: { role: 'user', content: `/feature One worker. Private folder: ${dir}` } }),
    line({ type: 'assistant', timestamp: '2026-11-10T09:00:05Z', message: { id: 'f1', model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_W', name: 'Agent', input: { subagent_type: 'feature-implementer', description: 'Build it' } }] } }),
    ...(answered ? [
      line({ type: 'user', timestamp: '2026-11-10T09:30:00Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_W', content: 'done' }] } }),
      line({ type: 'assistant', timestamp: '2026-11-10T09:30:05Z', message: { id: 'f2', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Built.' }] } }),
    ] : []),
  ];
  const worker = [
    line({ agentId: 'w1', isSidechain: true, type: 'user', timestamp: '2026-11-10T09:00:06Z', message: { role: 'user', content: 'Stage: Implement.' } }),
    line({ agentId: 'w1', isSidechain: true, type: 'assistant', timestamp: '2026-11-10T09:10:00Z', message: { id: 'w1m', model: 'claude-opus-5-5', stop_reason: null, content: [{ type: 'tool_use', id: 'toolu_B', name: 'Bash', input: { command: 'npm test' } }] } }),
  ];
  await fs.writeFile(`${session}.jsonl`, `${foreman.join('\n')}\n`);
  await fs.writeFile(path.join(session, 'subagents', 'agent-w1.jsonl'), `${worker.join('\n')}\n`);
  await fs.writeFile(path.join(session, 'subagents', 'agent-w1.meta.json'), JSON.stringify({ agentType: 'feature-implementer', description: 'Build it', toolUseId: 'toolu_W' }));
  try {
    const [job] = await loadFeatures({ featuresDir: path.join(root, 'feature-work'), sessionIndex: new SessionIndex(path.join(root, 'projects')) });
    return job;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('a worker whose result the Foreman holds is finished', async () => {
  const job = await jobWithOneWorker(true);
  const worker = job.activity.find((a) => a.who === 'feature-implementer');
  assert.equal(worker.state, 'finished');
  assert.equal(job.working, false);
});

test('a worker the Foreman still waits on is running', async () => {
  const job = await jobWithOneWorker(false);
  const worker = job.activity.find((a) => a.who === 'feature-implementer');
  assert.equal(worker.state, 'running');
});
