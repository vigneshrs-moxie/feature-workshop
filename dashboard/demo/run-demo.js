// `npm run demo`: builds invented features in a temp folder and starts the dashboard on them.
// Nothing here touches ~/.claude. One worker keeps "working" so the live view has something to show.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(os.tmpdir(), 'feature-workshop-demo');
const FEATURES = path.join(ROOT, 'feature-work');
const PROJECTS = path.join(ROOT, 'projects', '-demo-acme-portal');

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
let msgCounter = 0;

// ---------- log line builders ----------

const usage = (out, read = 40000, write1h = 0) => ({
  input_tokens: 4, output_tokens: out, cache_read_input_tokens: read,
  cache_creation_input_tokens: write1h, cache_creation: { ephemeral_1h_input_tokens: write1h, ephemeral_5m_input_tokens: 0 },
});
const assistant = (sessionId, at, model, content, u, stop = 'tool_use', agentId) => ({
  type: 'assistant', sessionId, agentId, timestamp: at, cwd: '/demo/acme-portal',
  message: { id: `msg_${++msgCounter}`, model, stop_reason: stop, content, usage: u },
});
const toolUse = (name, input) => ({ type: 'tool_use', id: `tu_${++msgCounter}`, name, input });
const toolResult = (sessionId, at) => ({ type: 'user', sessionId, timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

async function writeSession({ sessionId, featureDir, prompt, startAgo, conductorTurns, workers, cost }) {
  const rows = [
    { type: 'queue-operation', operation: 'enqueue', sessionId, timestamp: iso(startAgo), content: `${prompt} Private folder: ${featureDir}` },
  ];
  for (const t of conductorTurns) {
    if (t.dispatch) {
      rows.push(assistant(sessionId, iso(t.ago), 'claude-fable-5-1',
        [toolUse('Agent', { subagent_type: t.dispatch, description: t.description, prompt: `Private folder: ${featureDir}` })], usage(t.out ?? 900, 60000, 8000)));
      rows.push(toolResult(sessionId, iso(t.ago - 1000)));
    } else {
      rows.push(assistant(sessionId, iso(t.ago), 'claude-fable-5-1', [{ type: 'text', text: t.text ?? 'Brief.' }], usage(t.out ?? 1500, 90000), 'end_turn'));
    }
  }
  if (cost) rows.push({ type: 'cost-state', sessionId, totalCostUSD: cost.total, modelUsage: cost.byModel });
  await fs.writeFile(path.join(PROJECTS, `${sessionId}.jsonl`), jsonl(rows));

  const subDir = path.join(PROJECTS, sessionId, 'subagents');
  await fs.mkdir(subDir, { recursive: true });
  for (const [i, w] of workers.entries()) {
    const agentId = `a${sessionId.slice(-4)}${i}`;
    const lines = [{ type: 'user', sessionId, agentId, timestamp: iso(w.startAgo), message: { role: 'user', content: `Stage work. Private folder: ${featureDir}` } }];
    for (const [j, step] of w.steps.entries()) {
      lines.push(assistant(sessionId, iso(w.startAgo - (j + 1) * 40000), w.model, [toolUse(step[0], step[1])], usage(w.out ?? 1200, 30000, j === 0 ? 12000 : 0), 'tool_use', agentId));
      lines.push(toolResult(sessionId, iso(w.startAgo - (j + 1) * 40000 - 2000)));
    }
    if (w.finished) lines.push(assistant(sessionId, iso(w.endAgo), w.model, [{ type: 'text', text: 'STAGE: done' }], usage(600, 30000), 'end_turn', agentId));
    await fs.writeFile(path.join(subDir, `agent-${agentId}.jsonl`), jsonl(lines));
    await fs.writeFile(path.join(subDir, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: w.type, description: w.description, requestShape: 'background' }));
  }
  return subDir;
}

async function feature(slug, { status, workflowStatus, briefs = [], files = {} }) {
  const dir = path.join(FEATURES, slug);
  await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
  if (status) await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ schema_version: 1, slug, ...status }, null, 2));
  if (workflowStatus) await fs.writeFile(path.join(dir, 'workflow-status.md'), workflowStatus);
  for (const [i, b] of briefs.entries()) await fs.writeFile(path.join(dir, 'briefs', `${String(i + 1).padStart(3, '0')}-${b.stage}.md`), b.text);
  for (const [name, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), text);
  }
  return dir;
}

const wsDoc = ({ title, slug, route, stage, next, approvals = '' }) => `# ${title}: workflow status

**Feature slug:** ${slug}
**Route:** ${route}
**Spec:** /demo/acme-portal/docs/plans/2026-10-01-${slug}-product-spec.md · current version 0.2 · status DRAFT
**Refinement:** NOT REQUIRED — demo
**Repository:** /demo/acme-portal · branch main · commit 9f8e7d6 · working tree clean (from investigation)
**Current stage:** ${stage}
**Next proposed:** \`${next}\`

## Artifacts
| Artifact | Path | Version | Based on |
|---|---|---|---|
| Spec | /demo/acme-portal/docs/plans/2026-10-01-${slug}-product-spec.md | 0.2 | |

## Review and authorization log
| Date | Who | What they said or did (quote or invocation) | Artifact + version | Authorizes | Scope / limits | State |
|---|---|---|---|---|---|---|
${approvals}
## Stage history
| Date | Stage | Outcome | Artifacts produced |
|---|---|---|---|
| 2026-10-10 | spec | presented | spec v0.1 |
`;

// ---------- the demo features ----------

async function build() {
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(PROJECTS, { recursive: true });

  // 1. Waiting on answers after review.
  const widget = await feature('widget-export', {
    status: {
      title: 'Widget Export', route: 'small', stage: 'review', stage_state: 'waiting_for_you', waiting_for: 'answers',
      waiting_since: iso(47 * MIN),
      brief: { number: 6, path: 'briefs/006-review.md', headline: 'Widget Export · review done' },
      questions: [
        { id: '1', text: 'Fix R-2 and R-3 now in a small fix round?', recommendation: 'a', options: [{ id: 'a', label: 'Yes, fix both now' }, { id: 'b', label: 'Leave them as minors' }] },
        { id: '2', text: 'Export file name', recommendation: 'a', options: [{ id: 'a', label: 'widgets-YYYY-MM-DD.csv' }, { id: 'b', label: 'export.csv' }] },
      ],
      decided_on_your_behalf: [
        { id: 'D-004', decision: 'CSV only, no Excel', reason: 'your “use your recommendations” reply', where: 'spec v0.3', confirmed: false },
        { id: 'D-005', decision: 'Export is limited to 10,000 rows', reason: 'investigation found no paging', where: 'spec v0.3', confirmed: false },
      ],
      next_proposed: 'Small fix round for R-2/R-3, then PR #1 (needs its own go-ahead)',
      spec: { path: '/demo/acme-portal/docs/plans/2026-10-01-widget-export-product-spec.md', version: '0.3', status: 'DRAFT' },
      branch: 'feature/widget-export', worktree: '/demo/orbit-widget-export', base_sha: '9f8e7d6',
      prs: [{ number: 1, label: 'fork → org branch', url: null, state: 'not_started' }],
      session_id: 'demo-sess-0001', updated_at: iso(47 * MIN),
    },
    workflowStatus: wsDoc({
      title: 'Widget Export', slug: 'widget-export', route: 'SMALL — one export button', stage: 'review · presented for review',
      next: 'PR #1 after your go-ahead',
      approvals: '| 2026-10-10 | the user | "go ahead with investigation" | spec v0.2 | investigate | read-only | current |\n| 2026-10-11 | the user | "approve plan v1, implement" | plan v1 | implement | all steps | superseded (plan v2) |\n| 2026-10-11 | the user | "plan v2 is fine, implement" | plan v2 | implement | all steps | current |\n',
    }),
    briefs: [
      { stage: 'spec', text: '**Widget Export · spec done** · spec v0.1\n\nDemo brief.' },
      { stage: 'investigate', text: '**Widget Export · investigate done**\n\nDemo brief.' },
      { stage: 'plan', text: '**Widget Export · plan done**\n\nDemo brief.' },
      { stage: 'implement', text: '**Widget Export · implement done**\n\nDemo brief.' },
      { stage: 'test', text: '**Widget Export · test done**\n\nDemo brief.' },
      { stage: 'review', text: '**Widget Export · review done** · spec v0.3 · review.md v1\n\n**What happened**\n- 7 reviewers looked at the change; 0 blockers, 2 majors, 3 minors.\n\n**Decisions for you**\n1. Fix R-2 and R-3 now? — Recommended: yes.\n2. Export file name — Recommended: widgets-YYYY-MM-DD.csv.\n\n**Next:** fix round, then PR #1.' },
    ],
    files: { 'findings.md': '# Findings\n\nDemo.', 'implementation-plan.md': '# Plan\n\nDemo.', 'test-plan.md': '# Test plan\n\nDemo.', 'review.md': '# Review\n\nDemo.', 'review/permissions.md': '# Permissions lens\n\nDemo.' },
  });
  await writeSession({
    sessionId: 'demo-sess-0001', featureDir: widget, prompt: '/feature Add a CSV export to the widgets page.', startAgo: 30 * HOUR,
    conductorTurns: [
      { dispatch: 'feature-spec-writer', description: 'Draft spec', ago: 30 * HOUR }, { ago: 29 * HOUR },
      { dispatch: 'feature-investigator', description: 'Investigate', ago: 26 * HOUR }, { ago: 25 * HOUR },
      { dispatch: 'feature-planner', description: 'Plan', ago: 22 * HOUR }, { ago: 21 * HOUR },
      { dispatch: 'feature-implementer', description: 'Implement S1–S3', ago: 6 * HOUR }, { ago: 5 * HOUR },
      { dispatch: 'feature-tester', description: 'Run checks', ago: 3 * HOUR }, { ago: 2.5 * HOUR },
      { dispatch: 'feature-reviewer', description: 'Review', ago: 2 * HOUR }, { ago: 47 * MIN },
    ],
    workers: [
      { type: 'feature-spec-writer', description: 'Draft spec', model: 'claude-opus-5-5', startAgo: 30 * HOUR, endAgo: 29.5 * HOUR, finished: true, steps: [['Write', { file_path: '/demo/spec.md' }]] },
      { type: 'feature-investigator', description: 'Investigate', model: 'claude-opus-5-5', startAgo: 26 * HOUR, endAgo: 25.5 * HOUR, finished: true, steps: [['Grep', { pattern: 'export' }], ['Read', { file_path: '/demo/widgets.js' }]] },
      { type: 'feature-planner', description: 'Plan', model: 'claude-opus-5-5', startAgo: 22 * HOUR, endAgo: 21.5 * HOUR, finished: true, steps: [['Write', { file_path: '/demo/plan.md' }]] },
      { type: 'feature-implementer', description: 'Implement S1–S3', model: 'claude-opus-5-5', startAgo: 6 * HOUR, endAgo: 5.2 * HOUR, finished: true, out: 4000, steps: [['Edit', { file_path: '/demo/widgets.js' }], ['Bash', { description: 'Run the unit tests' }]] },
      { type: 'feature-tester', description: 'Run checks', model: 'claude-sonnet-5-5', startAgo: 3 * HOUR, endAgo: 2.7 * HOUR, finished: true, steps: [['Bash', { description: 'npm run check' }]] },
      { type: 'feature-reviewer', description: 'Review', model: 'claude-opus-5-5', startAgo: 2 * HOUR, endAgo: 1.5 * HOUR, finished: true, steps: [['Read', { file_path: '/demo/widgets.js' }]] },
      { type: 'feature-review-permissions', description: 'Review lens: permissions', model: 'claude-opus-5-5', startAgo: 2 * HOUR, endAgo: 1.6 * HOUR, finished: true, steps: [['Grep', { pattern: 'requireAdmin' }]] },
      { type: 'feature-review-conventions', description: 'Review lens: conventions', model: 'claude-haiku-5-5', startAgo: 2 * HOUR, endAgo: 1.8 * HOUR, finished: true, steps: [['Read', { file_path: '/demo/CLAUDE.md' }]] },
    ],
  });

  // 2. A worker is building right now.
  const bulk = await feature('bulk-archive', {
    status: {
      title: 'Bulk Archive', route: 'large', stage: 'implement', stage_state: 'working', waiting_for: null,
      brief: { number: 5, path: 'briefs/005-plan.md', headline: 'Bulk Archive · plan done' },
      questions: [], decided_on_your_behalf: [],
      next_proposed: 'Finish S3 (archive job), then brief you',
      branch: 'feature/bulk-archive', worktree: '/demo/orbit-bulk-archive', base_sha: '1234abc',
      session_id: 'demo-sess-0002', updated_at: iso(20 * MIN),
    },
    workflowStatus: wsDoc({ title: 'Bulk Archive', slug: 'bulk-archive', route: 'LARGE — new lifecycle state', stage: 'implement · in progress', next: 'brief after S3' }),
    briefs: [{ stage: 'spec', text: 'Demo.' }, { stage: 'refine', text: 'Demo.' }, { stage: 'investigate', text: 'Demo.' }, { stage: 'spec-update', text: 'Demo.' }, { stage: 'plan', text: 'Demo.' }],
  });
  const bulkSub = await writeSession({
    sessionId: 'demo-sess-0002', featureDir: bulk, prompt: '/feature Let admins archive many tickets at once.', startAgo: 50 * HOUR,
    conductorTurns: [
      { dispatch: 'feature-spec-writer', description: 'Draft spec', ago: 50 * HOUR }, { ago: 49 * HOUR },
      { dispatch: 'feature-spec-writer', description: 'Refine interview', ago: 40 * HOUR }, { ago: 39 * HOUR },
      { dispatch: 'feature-investigator', description: 'Investigate', ago: 30 * HOUR }, { ago: 29 * HOUR },
      { dispatch: 'feature-planner', description: 'Plan', ago: 10 * HOUR }, { ago: 9 * HOUR },
      { dispatch: 'feature-implementer', description: 'Implement S3: archive job', ago: 12 * MIN },
    ],
    workers: [
      { type: 'feature-implementer', description: 'Implement S3: archive job', model: 'claude-opus-5-5', startAgo: 12 * MIN, finished: false, out: 2500,
        steps: [['Read', { file_path: '/demo/orbit-bulk-archive/app/src/tickets/archive.ts' }]] },
    ],
  });

  // 3. Waiting for a go-ahead; only the older Markdown record (no status.json yet).
  await feature('saved-filters', {
    workflowStatus: wsDoc({ title: 'Saved Filters', slug: 'saved-filters', route: 'SMALL — reuse existing filter rules', stage: 'investigate · presented for review', next: '/feature-plan saved-filters' }),
  });

  // 4. Blocked on someone else.
  await feature('dark-mode-toggle', {
    status: {
      title: 'Dark Mode Toggle', route: 'small', stage: 'pr2', stage_state: 'blocked', waiting_for: null,
      next_proposed: 'Waiting for Raj’s approval on PR #2', branch: 'feature/dark-mode-toggle',
      prs: [
        { number: 1, label: 'fork → org branch', url: 'https://github.com/example/acme-portal/pull/41', state: 'merged' },
        { number: 2, label: 'org branch → staging', url: 'https://github.com/example/acme-portal/pull/42', state: 'open' },
      ],
      updated_at: iso(26 * HOUR),
    },
  });

  // 5. Finished.
  await feature('report-scheduler', {
    status: { title: 'Report Scheduler', route: 'large', stage: 'pr3', stage_state: 'done', next_proposed: 'Released', updated_at: iso(5 * 24 * HOUR),
      prs: [1, 2, 3].map((n) => ({ number: n, state: 'merged', url: `https://github.com/example/acme-portal/pull/${30 + n}` })) },
  });

  return path.join(bulkSub, (await fs.readdir(bulkSub)).find((f) => f.endsWith('.jsonl')));
}

// Keep the Bulk Archive builder busy: a new step every few seconds.
function tick(logFile) {
  const steps = [
    ['Read', { file_path: '/demo/orbit-bulk-archive/app/src/tickets/archive.ts' }],
    ['Edit', { file_path: '/demo/orbit-bulk-archive/app/src/tickets/archive.ts' }],
    ['Grep', { pattern: 'archivedAt' }],
    ['Bash', { description: 'Run the archive unit tests' }],
    ['Edit', { file_path: '/demo/orbit-bulk-archive/app/src/tickets/archive.test.ts' }],
    ['Bash', { description: 'Typecheck and lint (npm run check)' }],
  ];
  let i = 0;
  const step = () => {
    const [name, input] = steps[i++ % steps.length];
    const line = assistant('demo-sess-0002', new Date().toISOString(), 'claude-opus-5-5', [toolUse(name, input)], usage(300, 30000), 'tool_use', 'demo');
    return fs.appendFile(logFile, JSON.stringify(line) + '\n').catch(() => {});
  };
  setInterval(step, 6000);
  return step();
}

const logFile = await build();
process.env.WORKSHOP_FEATURES_DIR = FEATURES;
process.env.WORKSHOP_PROJECTS_DIR = path.dirname(PROJECTS);
process.env.WORKSHOP_DEMO = '1';
console.log(`Demo data in ${ROOT} (invented; safe to delete).`);
await tick(logFile);
await import('../server.js');
