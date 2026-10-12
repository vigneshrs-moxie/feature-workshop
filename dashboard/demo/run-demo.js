// `npm run demo`: builds invented features in a temp folder and starts the dashboard on them.
// Nothing here touches ~/.claude. One worker keeps "working" so the live view has something to show.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(os.tmpdir(), 'feature-workshop-demo');
const FEATURES = path.join(ROOT, 'feature-work');
const PROJECTS = path.join(ROOT, 'projects', '-demo-acme-portal');
const ACME = path.join(ROOT, 'acme-portal');
let BASE = null;

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
  type: 'assistant', sessionId, agentId, timestamp: at, cwd: ACME,
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
      // `waiting`: the Foreman is still waiting for this worker, so no result yet.
      if (!t.waiting) rows.push(toolResult(sessionId, iso(t.ago - 1000)));
    } else {
      rows.push(assistant(sessionId, iso(t.ago), 'claude-fable-5-1', [{ type: 'text', text: t.text ?? 'Brief.' }], usage(t.out ?? 1500, 90000), 'end_turn'));
    }
  }
  if (cost) rows.push({ type: 'cost-state', sessionId, totalCostUSD: cost.total, modelUsage: cost.byModel });
  await fs.writeFile(path.join(PROJECTS, `${sessionId}.jsonl`), jsonl(rows));

  const subDir = path.join(PROJECTS, sessionId, 'subagents');
  await fs.mkdir(subDir, { recursive: true });
  const files = [];
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
    files.push(path.join(subDir, `agent-${agentId}.jsonl`));
  }
  return files;
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
**Spec:** ${ACME}/docs/plans/2026-10-01-${slug}-product-spec.md · current version 0.2 · status DRAFT
**Refinement:** NOT REQUIRED — demo
**Repository:** ${ACME} · branch main · commit 9f8e7d6 · working tree clean (from investigation)
**Current stage:** ${stage}
**Next proposed:** \`${next}\`

## Artifacts
| Artifact | Path | Version | Based on |
|---|---|---|---|
| Spec | ${ACME}/docs/plans/2026-10-01-${slug}-product-spec.md | 0.2 | |

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

// A real (throwaway) git repo so the Code tab and the New job dialog have something to show.
async function makeRepo() {
  const git = (...args) => execFileSync('git', ['-C', ACME, ...args], { stdio: 'pipe' }).toString().trim();
  await fs.mkdir(path.join(ACME, 'docs', 'plans'), { recursive: true });
  await fs.mkdir(path.join(ACME, 'app'), { recursive: true });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Demo'); git('config', 'user.email', 'demo@example.invalid');
  await fs.writeFile(path.join(ACME, 'README.md'), '# Acme portal (demo)\nA pretend app for Feature Workshop\'s demo.\n');
  await fs.writeFile(path.join(ACME, 'docs', 'plans', '2026-10-01-widget-export-product-spec.md'), [
    '# Widget Export: product spec (demo)', '', '**Version:** 0.3 · **Status:** DRAFT', '', '## Requirements', '',
    '| ID | Requirement |', '|---|---|',
    '| FR-001 | Admins can download every widget as a CSV file. |',
    '| FR-002 | The export button sits next to the widgets table heading. |',
    '| FR-003 | Exports stop at 10,000 rows with a clear message. |', '',
    '## Acceptance criteria', '',
    'AC-001: the CSV has one row per widget and a header row.',
    'AC-002: clicking Export downloads `widgets-YYYY-MM-DD.csv`.',
    'AC-003: with more than 10,000 widgets, the message explains the limit.',
    'AC-004: non-admins don’t see the button.', '',
  ].join('\n'));
  await fs.writeFile(path.join(ACME, 'app', 'widgets.js'), 'export function listWidgets(db) {\n  return db.all(\'select * from widgets\');\n}\n');
  git('add', '-A'); git('commit', '-q', '-m', 'Start the demo app');
  BASE = git('rev-parse', '--short', 'HEAD');
  git('switch', '-q', '-c', 'feature/widget-export');
  await fs.writeFile(path.join(ACME, 'app', 'csv.js'), 'export function toCsv(rows) {\n  const head = Object.keys(rows[0] ?? {});\n  return [head, ...rows.map((r) => head.map((k) => r[k]))].map((l) => l.join(\',\')).join(\'\\n\');\n}\n');
  git('add', '-A'); git('commit', '-q', '-m', 'feat(widgets): CSV builder [S1]');
  await fs.appendFile(path.join(ACME, 'app', 'widgets.js'), '\nexport const exportButton = \'<button>Export</button>\';\n');
  git('commit', '-qam', 'feat(widgets): export button next to the table [S2]');
  await fs.appendFile(path.join(ACME, 'app', 'csv.js'), '\nexport const LIMIT = 10000; // FR-003\n');
  git('commit', '-qam', 'feat(widgets): stop at 10,000 rows with a message [S3]');
  git('switch', '-q', 'main');
}

async function build() {
  await fs.rm(ROOT, { recursive: true, force: true });
  await fs.mkdir(PROJECTS, { recursive: true });
  await makeRepo();

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
      spec: { path: `${ACME}/docs/plans/2026-10-01-widget-export-product-spec.md`, version: '0.3', status: 'DRAFT' },
      branch: 'feature/widget-export', worktree: null, base_sha: BASE, repo: { path: ACME, base_branch: 'main' },
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
    files: {
      'findings.md': '# Findings (demo)\n\n## Summary\nThe widgets page already loads every row, so FR-001 needs no new query. FR-002 touches the export button only.\n\n## Spec impact\n- AC-003 should say what happens with more than 10,000 rows (became D-005).\n',
      'implementation-plan.md': '# Implementation plan (demo)\n\n| Step | What | Covers |\n|---|---|---|\n| S1 | CSV builder | FR-001, AC-001 |\n| S2 | Export button | FR-002, AC-002 |\n| S3 | Row limit message | FR-003, AC-003, AC-004 |\n',
      'test-plan.md': '# Test plan (demo)\n\n- AC-001: unit test for the CSV builder\n- AC-002: the button downloads a file\n- AC-003: 10,001 rows shows the limit message\n',
      'review.md': '# Review (demo)\n\n- **R-2 (major):** the file name ignores the time zone (FR-002).\n- **R-3 (major):** no test for an empty table (AC-001).\n',
      'review/permissions.md': '# Permissions lens (demo)\n\nOnly admins see the export button, as FR-002 requires. No findings.\n',
    },
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
      branch: 'feature/bulk-archive', worktree: '/demo/orbit-bulk-archive', base_sha: '1234abc', repo: { path: ACME, base_branch: 'main' },
      session_id: 'demo-sess-0002', updated_at: iso(20 * MIN),
    },
    workflowStatus: wsDoc({ title: 'Bulk Archive', slug: 'bulk-archive', route: 'LARGE — new lifecycle state', stage: 'implement · in progress', next: 'brief after S3' }),
    briefs: [{ stage: 'spec', text: 'Demo.' }, { stage: 'refine', text: 'Demo.' }, { stage: 'investigate', text: 'Demo.' }, { stage: 'spec-update', text: 'Demo.' }, { stage: 'plan', text: 'Demo.' }],
  });
  const [bulkLog] = await writeSession({
    sessionId: 'demo-sess-0002', featureDir: bulk, prompt: '/feature Let admins archive many tickets at once.', startAgo: 50 * HOUR,
    conductorTurns: [
      { dispatch: 'feature-spec-writer', description: 'Draft spec', ago: 50 * HOUR }, { ago: 49 * HOUR },
      { dispatch: 'feature-spec-writer', description: 'Refine interview', ago: 40 * HOUR }, { ago: 39 * HOUR },
      { dispatch: 'feature-investigator', description: 'Investigate', ago: 30 * HOUR }, { ago: 29 * HOUR },
      { dispatch: 'feature-planner', description: 'Plan', ago: 10 * HOUR }, { ago: 9 * HOUR },
      { dispatch: 'feature-implementer', description: 'Implement S3: archive job', ago: 12 * MIN, waiting: true },
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
      next_proposed: 'Waiting for Raj’s approval on PR #2', branch: 'feature/dark-mode-toggle', repo: { path: '/demo/field-app' },
      prs: [
        { number: 1, label: 'fork → org branch', url: 'https://github.com/example/acme-portal/pull/41', state: 'merged' },
        { number: 2, label: 'org branch → staging', url: 'https://github.com/example/acme-portal/pull/42', state: 'open' },
      ],
      updated_at: iso(26 * HOUR),
    },
  });

  // 5. Finished.
  await feature('report-scheduler', {
    status: { title: 'Report Scheduler', route: 'large', stage: 'pr3', stage_state: 'done', next_proposed: 'Released', updated_at: iso(5 * 24 * HOUR), repo: { path: '/demo/field-app' },
      prs: [1, 2, 3].map((n) => ({ number: n, state: 'merged', url: `https://github.com/example/acme-portal/pull/${30 + n}` })) },
  });

  // 6. A bug whose builder is stuck on a permission prompt in a terminal.
  const login = await feature('fix-login-loop', {
    status: {
      title: 'Login redirect loop', kind: 'bug', route: 'small', stage: 'implement', stage_state: 'working',
      next_proposed: 'Finish S2, then brief you', branch: 'fix/login-loop', repo: { path: ACME },
      session_id: 'demo-sess-0003', updated_at: iso(40 * MIN),
    },
  });
  await writeSession({
    sessionId: 'demo-sess-0003', featureDir: login, prompt: '/feature Fix the login redirect loop for expired sessions.', startAgo: 4 * HOUR,
    conductorTurns: [{ dispatch: 'feature-implementer', description: 'Implement S2: session refresh', ago: 30 * MIN, waiting: true }],
    workers: [{ type: 'feature-implementer', description: 'Implement S2: session refresh', model: 'claude-opus-5-5', startAgo: 30 * MIN, finished: false,
      steps: [['Edit', { file_path: `${ACME}/app/src/auth/session.ts` }], ['Bash', { description: 'Run the database session tests (npm run test:db)' }]] }],
  });
  // The last step is a tool call with no result: the worker is waiting for a permission click.
  {
    const dir = path.join(PROJECTS, 'demo-sess-0003', 'subagents');
    const file = path.join(dir, (await fs.readdir(dir)).find((f) => f.endsWith('.jsonl')));
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
    lines.pop();
    await fs.writeFile(file, lines.join('\n') + '\n');
  }

  // 7. Three reviewers working at once, in another project.
  const route = await feature('route-optimizer', {
    status: {
      title: 'Route Optimizer', route: 'large', stage: 'review', stage_state: 'working',
      next_proposed: 'Combine the reviews, then brief you', branch: 'feature/route-optimizer', repo: { path: '/demo/field-app' },
      session_id: 'demo-sess-0004', updated_at: iso(15 * MIN),
    },
  });
  const reviewLogs = await writeSession({
    sessionId: 'demo-sess-0004', featureDir: route, prompt: '/feature Suggest the shortest route for each technician’s day.', startAgo: 70 * HOUR,
    conductorTurns: [{ dispatch: 'feature-reviewer', description: 'Review', ago: 9 * MIN, waiting: true }],
    workers: ['feature-reviewer', 'feature-review-performance', 'feature-review-db'].map((type) => ({
      type, description: 'Review lens', model: type === 'feature-reviewer' ? 'claude-opus-5-5' : 'claude-sonnet-5-5', startAgo: 9 * MIN, finished: false,
      steps: [['Read', { file_path: '/demo/field-app/src/routing/plan.ts' }]],
    })),
  });

  return [bulkLog, ...reviewLogs];
}

// Keep the Bulk Archive builder busy: a new step every few seconds.
function tick(logFiles) {
  const steps = [
    ['Read', { file_path: '/demo/orbit-bulk-archive/app/src/tickets/archive.ts' }],
    ['Edit', { file_path: '/demo/orbit-bulk-archive/app/src/tickets/archive.ts' }],
    ['Grep', { pattern: 'archivedAt' }],
    ['Bash', { description: 'Run the archive unit tests' }],
    ['Edit', { file_path: '/demo/orbit-bulk-archive/app/src/tickets/archive.test.ts' }],
    ['Bash', { description: 'Typecheck and lint (npm run check)' }],
  ];
  let i = 0;
  const reviewSteps = [
    ['Read', { file_path: '/demo/field-app/src/routing/plan.ts' }],
    ['Grep', { pattern: 'technicianId' }],
    ['Bash', { description: 'Show the diff for the routing module' }],
    ['Read', { file_path: '/demo/field-app/src/routing/plan.test.ts' }],
  ];
  const step = () => Promise.all(logFiles.map((file, n) => {
    const list = n === 0 ? steps : reviewSteps;
    const [name, input] = list[(i + n) % list.length];
    const line = assistant('demo', new Date().toISOString(), 'claude-opus-5-5', [toolUse(name, input)], usage(300, 30000), 'tool_use', 'demo');
    return fs.appendFile(file, JSON.stringify(line) + '\n').catch(() => {});
  })).then(() => { i++; });
  setInterval(step, 6000);
  return step();
}

const logFiles = await build();
process.env.WORKSHOP_FEATURES_DIR = FEATURES;
process.env.WORKSHOP_PROJECTS_DIR = path.dirname(PROJECTS);
process.env.WORKSHOP_DEMO = '1';
process.env.WORKSHOP_EXTRA_REPOS = ACME;
console.log(`Demo data in ${ROOT} (invented; safe to delete).`);
await tick(logFiles);
await import('../server.js');
