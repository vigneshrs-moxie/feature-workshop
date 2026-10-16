// `npm run demo`: builds invented features in a temp folder and starts the dashboard on them.
// Nothing here touches ~/.claude. One worker keeps "working" so the live view has something to show.
//
// Levels and gate cards (phase 2): every job has a level (options.json), and seven more jobs show
// the gate card's cases: an L0 job showing its diff, an L1 quick-plan card, an L2 plan card with
// decisions, an L3 plan card with Fable's second look, a card gone stale (raised at plan v2; the
// plan moves to v3 a moment after start), a gate parked 5 hours, and a job with no level yet (the
// LevelCard). Settings warns that the skill is out of date: the demo reads its own pre-levels copy
// of job-options.md (set WORKSHOP_SKILLS_DIR to a folder with a current one to see it go away).

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defaultsFor, defaultsForLevel, writeOptions } from '../lib/options.js';
import { suggestLevel } from '../lib/level-rules.js';

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

  await levelJobs();
  return [bulkLog, ...reviewLogs];
}

// ---------- levels and gate cards (phase 2) ----------

// A job's options.json at a level (null: none yet), as the New job sheet writes it.
const options = (slug, level, description, extra = {}) => writeOptions(path.join(FEATURES, slug), { ...(level === null ? defaultsFor('auto') : defaultsForLevel(level)), ...extra }, { title: description, repo: ACME, kind: 'feature' });
// The Foreman's first-brief suggestion: the level picked, with the rules' reasons when they agree
// (these jobs show no LevelCard; visit-reminder is the one that does).
const suggestion = (description, level) => {
  const s = suggestLevel({ description });
  return { suggested_level: level, level_reason: s.level === level ? s.reasons.join(' ') : `The rules say L${s.level}, but it changes a query and more than one screen, so I’d keep L${level}: the tester and 3–4 reviewers are worth it.` };
};
const repo = { path: ACME, base_branch: 'main' };
const PLAN_QUESTIONS = [
  { id: '1', text: 'Build it in how many steps?', recommendation: 'a', options: [{ id: 'a', label: 'Three steps, one commit each' }, { id: 'b', label: 'One step' }] },
  { id: '2', text: 'Which data should the tester use?', recommendation: 'a', options: [{ id: 'a', label: 'The demo seed data' }, { id: 'b', label: 'An empty copy' }] },
];
const planArtifacts = (v) => [
  { name: 'Findings', path: 'findings.md', version: '1' },
  { name: 'Implementation plan', path: 'implementation-plan.md', version: String(v) },
  { name: 'Test plan', path: 'test-plan.md', version: String(v) },
];
const planFiles = (v) => ({
  'findings.md': '# Findings v1 (demo)\n\nThe change fits in one page, its query and its tests.\n',
  'implementation-plan.md': `# Implementation plan v${v} (demo)\n\n| Step | What |\n|---|---|\n| S1 | The data |\n| S2 | The page |\n| S3 | The tests |\n`,
  'test-plan.md': `# Test plan v${v} (demo)\n\n- One check per acceptance criterion (5 in all)\n`,
});
const planBrief = ({ title, v, spec, fable = null, decided }) => [
  `**${title} · plan v${v} ready** · spec v${spec} · plan v${v} · test plan v${v}`, '',
  '**What happened**', `- Spec v${spec}, findings v1, plan v${v} (3 steps) and test plan v${v} (5 checks).`, ...(fable ? [fable] : []), '',
  '**Decisions for you**', '1. Build it in how many steps? — Recommended: three steps, one commit each.', '2. Which data should the tester use? — Recommended: the demo seed data.', '',
  '**Decided on your behalf**', `- ${decided.id}: ${decided.decision} (${decided.reason}).`, '',
  `**Next:** build S1–S3 once you approve plan v${v}, then the tester.`,
].join('\n');

// Put the stale job's plan on v3 once the dashboard has seen its card at v2 (the card then greys out).
const STALE_SLUG = 'tech-next-stops';

async function levelJobs() {
  // The older demo jobs get the level their flow stood for.
  for (const [slug, level, description] of [
    ['widget-export', 2, 'Add a CSV export to the widgets page.'], ['bulk-archive', 3, 'Let admins archive many tickets at once.'],
    ['saved-filters', 2, 'Let people save the filters they use on the tickets page.'], ['dark-mode-toggle', 1, 'Add a dark mode toggle to the field app.'],
    ['report-scheduler', 3, 'Schedule reports to run every week.'], ['fix-login-loop', 3, 'Fix the login redirect loop for expired sessions.'],
    ['route-optimizer', 3, 'Suggest the shortest route for each technician’s day.'],
  ]) await options(slug, level, description);

  // L0: built straight from the request; the brief shows the diff and asks nothing.
  {
    const description = 'Fix the typo in the invoice footer';
    const file = 'app/src/invoices/InvoiceFooter.tsx';
    await feature('invoice-footer-typo', {
      status: {
        title: 'Invoice footer typo', kind: 'feature', route: 'quick', stage: 'implement', stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: iso(6 * MIN),
        brief: { number: 1, path: 'briefs/001-implement.md', headline: 'Invoice footer typo · built; here’s the diff' },
        questions: [], decided_on_your_behalf: [], next_proposed: 'PR #1: push the branch to your fork and open it (each needs your yes)',
        branch: 'feature/invoice-footer-typo', repo, ...suggestion(description, 0), updated_at: iso(6 * MIN),
      },
      briefs: [{ stage: 'implement', text: [
        '**Invoice footer typo · built; here’s the diff** (L0: your request was the go-ahead for this one build)', '',
        '**What changed**', `- ${file}: one line (commit S1 on feature/invoice-footer-typo).`, '',
        '**Checks**', '- npm run check: pass', '- npm run build: pass', '',
        '**The diff**', '', '```diff', `--- a/${file}`, `+++ b/${file}`, '@@ -9,7 +9,7 @@ export function InvoiceFooter() {', '   return (', '     <footer className="invoice-foot">',
        '-      <p>Thank you for your buisness.</p>', '+      <p>Thank you for your business.</p>', '     </footer>', '   );', ' }', '```', '',
        '**Next:** PR #1: push the branch to your fork and open it (each push and PR needs your yes).',
      ].join('\n') }],
    });
    await options('invoice-footer-typo', 0, description);
  }

  // L1 at its quick-plan card: one question.
  {
    const description = 'Add a copy link button to the job card';
    await feature('copy-link-button', {
      status: {
        title: 'Copy link button', kind: 'feature', route: 'quick', stage: 'plan', stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: iso(9 * MIN),
        brief: { number: 1, path: 'briefs/001-plan.md', headline: 'Quick plan v1 for the copy link button' },
        questions: [{ id: '1', text: 'Where should the button go?', recommendation: 'a', options: [{ id: 'a', label: 'Next to the job title' }, { id: 'b', label: 'In the card’s ⋯ menu' }] }],
        decided_on_your_behalf: [], next_proposed: 'Build it in one step, run the checks, then you try it',
        artifacts: [{ name: 'Quick plan', path: 'quick-plan.md', version: '1' }], repo, ...suggestion(description, 1), updated_at: iso(9 * MIN),
      },
      briefs: [{ stage: 'plan', text: '**Quick plan v1 for the copy link button**\n\n**Quick plan v1**\n- What: a “Copy link” button on each job card; it copies the job’s address and says “Copied”.\n- Where: app/src/jobs/JobCard.tsx and its test.\n- Checks: npm run check and npm run build, then you try it.\n\n**Decisions for you**\n1. Where should the button go? — Recommended: next to the job title.\n\n**Next:** build it in one step once you approve quick plan v1.\n' }],
      files: { 'quick-plan.md': '# Quick plan v1 (demo)\n\n- What: a Copy link button on each job card\n- Where: app/src/jobs/JobCard.tsx and its test\n- Checks: npm run check, npm run build\n' },
    });
    await options('copy-link-button', 1, description);
  }

  // L2 at its plan card: two questions, one decision on your behalf, versioned artifacts.
  {
    const description = 'Let office managers filter tickets by tag';
    const decided = { id: 'D-001', decision: 'Tags combine with AND, like the other filters', reason: 'the filter bar already works that way', where: 'plan v1', confirmed: false };
    await feature('ticket-tag-filter', {
      status: {
        title: 'Ticket tag filter', kind: 'feature', route: 'small', stage: 'plan', stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: iso(14 * MIN),
        brief: { number: 3, path: 'briefs/003-plan.md', headline: 'Ticket tag filter · plan v1 ready' },
        questions: PLAN_QUESTIONS, decided_on_your_behalf: [decided], next_proposed: 'Build S1–S3, then the tester',
        spec: { path: `${ACME}/docs/plans/2026-10-15-ticket-tag-filter-product-spec.md`, version: '0.2', status: 'DRAFT' },
        artifacts: planArtifacts(1), repo, ...suggestion(description, 2), updated_at: iso(14 * MIN),
      },
      briefs: [
        { stage: 'spec', text: '**Ticket tag filter · spec v0.1 ready**\n\nDemo brief.' },
        { stage: 'investigate', text: '**Ticket tag filter · investigate done**\n\nDemo brief.' },
        { stage: 'plan', text: planBrief({ title: 'Ticket tag filter', v: 1, spec: '0.2', decided }) },
      ],
      files: planFiles(1),
    });
    await options('ticket-tag-filter', 2, description);
  }

  // L3 at its plan card, with Fable's second look at the plan.
  {
    const description = 'Merge duplicate customer records, with a database migration for the merged_into column';
    const decided = { id: 'D-003', decision: 'A merge can be undone for 30 days', reason: 'Fable’s second look: merges are hard to reverse', where: 'plan v2', confirmed: false };
    await feature('customer-merge', {
      status: {
        title: 'Customer merge', kind: 'feature', route: 'large', stage: 'plan', stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: iso(22 * MIN),
        brief: { number: 5, path: 'briefs/005-plan.md', headline: 'Customer merge · plan v2 ready' },
        questions: [
          { id: '1', text: 'Which record wins when both have a phone number?', recommendation: 'a', options: [{ id: 'a', label: 'The most recently updated one' }, { id: 'b', label: 'Ask each time' }] },
          { id: '2', text: 'Run the migration in one go or in batches?', recommendation: 'b', options: [{ id: 'a', label: 'One go' }, { id: 'b', label: 'Batches of 1,000' }] },
        ],
        decided_on_your_behalf: [decided], next_proposed: 'Build S1–S4 (the migration first), then the tester',
        spec: { path: `${ACME}/docs/plans/2026-10-14-customer-merge-product-spec.md`, version: '0.4', status: 'DRAFT' },
        artifacts: planArtifacts(2), repo, ...suggestion(description, 3), updated_at: iso(22 * MIN),
      },
      briefs: [
        { stage: 'spec', text: '**Customer merge · spec v0.1 ready**\n\nDemo brief.' },
        { stage: 'refine', text: '**Customer merge · product interview done**\n\nDemo brief.' },
        { stage: 'investigate', text: '**Customer merge · investigate done**\n\nDemo brief.' },
        { stage: 'plan', text: '**Customer merge · plan v1 ready**\n\nDemo brief.' },
        { stage: 'plan', text: planBrief({ title: 'Customer merge', v: 2, spec: '0.4', decided, fable: '- **Fable second look at plan v2** (feature-fable-check): 2 points: a merge must be reversible (now D-003), and the migration needs a dry run on a copy. Both are in plan v2. Fable looks again when the review is wrapped up.' }) },
      ],
      files: planFiles(2),
    });
    await options('customer-merge', 3, description);
  }

  // A card that goes stale: raised at plan v2; a moment after start the plan moves to v3 (staleAfterStart).
  {
    const description = 'Show each technician’s next three stops on the map';
    const decided = { id: 'D-002', decision: 'Stops come from today’s schedule only', reason: 'the map has no date picker', where: 'plan v2', confirmed: false };
    await feature(STALE_SLUG, {
      status: {
        title: 'Next stops on the map', kind: 'feature', route: 'small', stage: 'plan', stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: iso(31 * MIN),
        brief: { number: 4, path: 'briefs/004-plan.md', headline: 'Next stops on the map · plan v2 ready' },
        questions: PLAN_QUESTIONS, decided_on_your_behalf: [decided], next_proposed: 'Build S1–S3, then the tester',
        spec: { path: `${ACME}/docs/plans/2026-10-13-tech-next-stops-product-spec.md`, version: '0.3', status: 'DRAFT' },
        artifacts: planArtifacts(2), repo, ...suggestion(description, 2), updated_at: iso(31 * MIN),
      },
      briefs: [
        { stage: 'spec', text: '**Next stops on the map · spec v0.1 ready**\n\nDemo brief.' },
        { stage: 'investigate', text: '**Next stops on the map · investigate done**\n\nDemo brief.' },
        { stage: 'plan', text: '**Next stops on the map · plan v1 ready**\n\nDemo brief.' },
        { stage: 'plan', text: planBrief({ title: 'Next stops on the map', v: 2, spec: '0.3', decided }) },
      ],
      files: planFiles(2),
    });
    await options(STALE_SLUG, 2, description);
  }

  // A gate left 5 hours: parked (still under Needs you, with a "parked" chip and one alert).
  {
    const description = 'Add a notes tab to the customer page';
    await feature('customer-notes-tab', {
      status: {
        title: 'Customer notes tab', kind: 'feature', route: 'small', stage: 'implement', stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: iso(5 * HOUR),
        brief: { number: 5, path: 'briefs/005-implement.md', headline: 'Customer notes tab · build done' },
        questions: [], decided_on_your_behalf: [], next_proposed: 'The tester runs test plan v1',
        spec: { path: `${ACME}/docs/plans/2026-10-12-customer-notes-tab-product-spec.md`, version: '0.2', status: 'APPROVED' },
        artifacts: planArtifacts(1), branch: 'feature/customer-notes-tab', repo, ...suggestion(description, 2), updated_at: iso(5 * HOUR),
      },
      briefs: [
        { stage: 'spec', text: '**Customer notes tab · spec v0.1 ready**\n\nDemo brief.' },
        { stage: 'investigate', text: '**Customer notes tab · investigate done**\n\nDemo brief.' },
        { stage: 'plan', text: '**Customer notes tab · plan v1 ready**\n\nDemo brief.' },
        { stage: 'plan', text: '**Customer notes tab · plan v1 approved**\n\nDemo brief.' },
        { stage: 'implement', text: '**Customer notes tab · build done**\n\n**What happened**\n- The Builder committed S1, S2, S3.\n- Next the Tester runs test plan v1.\n\n**Next:** the tester, then you try it, then the review.\n' },
      ],
      files: planFiles(1),
    });
    await options('customer-notes-tab', 2, description);
  }

  // No level yet: the Foreman's first brief suggests L3, the rules L2 (the LevelCard shows both).
  {
    const description = 'Email customers a reminder the day before their visit';
    await feature('visit-reminder', {
      status: {
        title: 'Visit reminder', kind: 'feature', route: 'small', stage: 'spec', stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: iso(3 * MIN),
        brief: { number: 1, path: 'briefs/001-spec.md', headline: 'Visit reminder · spec v0.1 ready' },
        questions: [], decided_on_your_behalf: [], next_proposed: 'Investigate the code (read-only), then plan',
        spec: { path: `${ACME}/docs/plans/2026-10-16-visit-reminder-product-spec.md`, version: '0.1', status: 'DRAFT' },
        repo, suggested_level: 3,
        level_reason: 'It sends email to customers on a schedule, and a mistake reaches people outside the company, so I’d run the full review panel with Fable.',
        updated_at: iso(3 * MIN),
      },
      briefs: [{ stage: 'spec', text: '**Visit reminder · spec v0.1 ready**\n\n**What happened**\n- The Scribe wrote spec v0.1: who gets the reminder, when, and what it says.\n\n**Level**\nI suggest **L3 Large**: it sends email to customers on a schedule, and a mistake reaches people outside the company. The rules say L2. Pick a level on the card below; approving the spec goes on at the level you pick.\n\n**Next:** investigate the code (read-only), then the plan.\n' }],
    });
    await options('visit-reminder', null, description);
  }
}

// A skill from before levels, so Settings shows its "out of date" warning (the demo never reads ~/.claude).
async function oldSkill() {
  const dir = path.join(ROOT, 'skills', 'feature');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'job-options.md'), '# Job options (demo copy from before levels)\n\n## Reading them\n\n| Field | Meaning |\n|---|---|\n| `flow` | quick, small, large or auto |\n');
}

// The stale card: once the dashboard has noted the card at plan v2, the plan moves to v3.
async function staleAfterStart(port) {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { if ((await fetch(`http://127.0.0.1:${port}/api/job/${STALE_SLUG}`)).ok) break; } catch { /* not listening yet */ }
  }
  const file = path.join(FEATURES, STALE_SLUG, 'status.json');
  const s = JSON.parse(await fs.readFile(file, 'utf8'));
  s.artifacts = planArtifacts(3);
  s.next_proposed = 'Plan v3 adds the stop times; I’ll brief you on it';
  await fs.writeFile(file, JSON.stringify(s, null, 2));
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
await oldSkill();
process.env.WORKSHOP_FEATURES_DIR = FEATURES;
process.env.WORKSHOP_PROJECTS_DIR = path.dirname(PROJECTS);
process.env.WORKSHOP_DEMO = '1';
process.env.WORKSHOP_EXTRA_REPOS = ACME;
process.env.WORKSHOP_SKILLS_DIR ||= path.join(ROOT, 'skills');
console.log(`Demo data in ${ROOT} (invented; safe to delete).`);
await tick(logFiles);
await import('../server.js');
staleAfterStart(Number(process.env.PORT) || 4477).catch((err) => console.error('Demo: could not move the stale job’s plan on:', err.message));
