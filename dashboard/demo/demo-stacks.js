// The demo's stacks (packet V): three stacks in the demo's own temp folder, so every state of the
// Stack pages can be seen and screenshotted. Nothing here touches a real folder: the stacks' job
// folders go in the demo's feature-work folder, their code in a throwaway git repository beside it,
// their Foremen's session logs in the demo's projects folder, and their cost lines in the demo's own
// usage.jsonl (only when that is inside the temp folder).
//
//   Team invites (ORBIT-530)     at Plan: six parts, waiting for your approval
//   Invoice export (ORBIT-521)   mid-build, twelve parts in every state: merged, a clash at its merge
//                                (parts 3 and 4 both change billing.ts), ready to merge, tests failed
//                                after merging and undone, stuck, checks running, at work, waiting
//                                for your go-ahead, ready to start, waiting on other parts
//   Single sign-on (ORBIT-488)   finished: five parts merged and pushed
//
// The parts at work keep "working": a new step lands in their session logs every few seconds.
// run-demo.js calls demoStacks() once, after its own jobs are written.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MODEL = 'claude-opus-5-5';

const iso = (agoMs) => new Date(Date.now() - agoMs).toISOString();
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

// ---------- The plans ----------

const INVITES_PLAN = `# Team invites

Inviting a teammate touches the data, the email, the settings screen and the permissions, and each of those can be built and checked on its own. The invite record comes first because everything else reads it.

## Section: invite-model
The invite record and its migration: who invited whom, to which team, with which role, and when it expires.
Owns: app/invites/model.ts, db/migrations/**

## Section: invite-email
The invitation email and its link, with the expiry in plain words.
Owns: app/invites/email/**
Depends on: invite-model

## Section: accept-flow
Accepting an invite: the sign-up page that the link opens, and joining the team.
Owns: app/invites/accept/**
Depends on: invite-model

## Section: settings-screen
The Team settings screen: invite by email, pending invites, resend and cancel.
Owns: app/settings/team/**
Depends on: invite-model

## Section: roles
Roles for invited people: member or admin, checked on every team page.
Owns: app/auth/roles.ts

## Section: invite-audit
An audit line for every invite sent, accepted, resent or cancelled.
Owns: app/audit/invites.ts
Depends on: invite-model

Order: invite-model, roles, invite-email, accept-flow, settings-screen, invite-audit
`;

const EXPORT_SECTIONS = [
  { name: 'invoice-model', brief: 'The invoice model and its migration: lines, totals and the currency of each invoice.', owns: ['app/invoices/model.ts', 'db/migrations/**'], deps: [], file: 'app/invoices/model.ts' },
  { name: 'tax-rules', brief: 'Tax rules per region, worked out from the customer’s address.', owns: ['app/tax/**'], deps: [], file: 'app/tax/rules.ts' },
  { name: 'billing-api', brief: 'The billing API endpoints: list, get and export invoices.', owns: ['app/billing/**'], deps: ['invoice-model'], file: 'app/billing/billing.ts' },
  { name: 'email-delivery', brief: 'Email delivery: send an invoice as a PDF attachment, with a retry.', owns: ['app/email/**', 'app/billing/billing.ts'], deps: ['billing-api'], file: 'app/email/send.ts' },
  { name: 'csv-export', brief: 'The CSV export: one row per invoice line, in the customer’s currency.', owns: ['app/export/csv/**'], deps: ['invoice-model'], file: 'app/export/csv/invoices.ts' },
  { name: 'refunds', brief: 'Refunds: a negative invoice linked to the one it refunds.', owns: ['app/refunds/**'], deps: ['invoice-model'], file: 'app/refunds/refund.ts' },
  { name: 'dunning', brief: 'Dunning: reminders for unpaid invoices at 7, 14 and 30 days.', owns: ['app/dunning/**'], deps: ['billing-api'], file: 'app/dunning/reminders.ts' },
  { name: 'invoice-ui', brief: 'The invoice screens: the list, one invoice, and the Export button.', owns: ['app/ui/invoices/**'], deps: ['billing-api'], file: 'app/ui/invoices/InvoiceList.tsx' },
  { name: 'payment-links', brief: 'Payment links: a link on each invoice that opens the payment page.', owns: ['app/payments/links/**'], deps: ['invoice-model'], file: 'app/payments/links/link.ts' },
  { name: 'audit-log', brief: 'The audit log: who exported, emailed or refunded which invoice, and when.', owns: ['app/audit/invoices.ts'], deps: [], file: 'app/audit/invoices.ts' },
  { name: 'pdf-renderer', brief: 'The PDF renderer: the invoice layout, the logo and page numbers.', owns: ['app/pdf/**'], deps: [], file: 'app/pdf/render.ts' },
  { name: 'reports', brief: 'Reports: monthly totals per region from the exports and refunds.', owns: ['app/reports/invoices/**'], deps: ['csv-export', 'refunds'], file: 'app/reports/invoices/monthly.ts' },
];

const EXPORT_PLAN = `# Invoice export

Big enough for a stack: twelve pieces that each own their own files. The invoice model goes first because almost everything reads it; the API before email and the screens, which call it; reports last, because they add up the exports and refunds.

${EXPORT_SECTIONS.map((s) => `## Section: ${s.name}\n${s.brief}\nOwns: ${s.owns.join(', ')}\n${s.deps.length ? `Depends on: ${s.deps.join(', ')}\n` : ''}`).join('\n')}
Order: ${EXPORT_SECTIONS.map((s) => s.name).join(', ')}
`;

const SSO_SECTIONS = [
  { name: 'saml-config', brief: 'The SAML settings per team: the identity provider’s address and certificate.', owns: ['app/sso/config/**'], deps: [], file: 'app/sso/config/saml.ts' },
  { name: 'login-flow', brief: 'Signing in with single sign-on: the redirect and the answer.', owns: ['app/sso/login/**'], deps: ['saml-config'], file: 'app/sso/login/flow.ts' },
  { name: 'just-in-time', brief: 'New people get an account the first time they sign in.', owns: ['app/sso/jit/**'], deps: ['login-flow'], file: 'app/sso/jit/create.ts' },
  { name: 'admin-screen', brief: 'The single sign-on screen in Team settings, with a test sign-in.', owns: ['app/settings/sso/**'], deps: ['saml-config'], file: 'app/settings/sso/Screen.tsx' },
  { name: 'enforce', brief: 'Make single sign-on the only way in for a team, with an admin backdoor.', owns: ['app/sso/enforce.ts'], deps: ['login-flow'], file: 'app/sso/enforce.ts' },
];

const SSO_PLAN = `# Single sign-on

Five parts, so the settings, the sign-in, new accounts and the admin screen could be built side by side.

${SSO_SECTIONS.map((s) => `## Section: ${s.name}\n${s.brief}\nOwns: ${s.owns.join(', ')}\n${s.deps.length ? `Depends on: ${s.deps.join(', ')}\n` : ''}`).join('\n')}
Order: ${SSO_SECTIONS.map((s) => s.name).join(', ')}
`;

// ---------- The repository ----------

function gitIn(dir) {
  return (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString().trim();
}

/** A few lines of made-up code for a file, so the diffs read like code. */
function code(file, variant = 0) {
  const name = path.basename(file).replace(/\.\w+$/, '').replace(/[^A-Za-z0-9]/g, '');
  const lines = [
    `// ${file} (demo)`,
    `export function ${name || 'part'}(input) {`,
    `  const rows = input?.rows ?? [];`,
    ...Array.from({ length: 6 + ((variant * 7) % 18) }, (_, i) => `  const step${i} = rows.filter((r) => r.kind === 'k${(i + variant) % 5}').length;`),
    `  return { rows, total: rows.length${variant ? `, variant: ${variant}` : ''} };`,
    '}',
    '',
  ];
  return lines.join('\n');
}

async function write(repo, file, text) {
  await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true });
  await fs.writeFile(path.join(repo, file), text);
}

/** Commit a part's work on its own branch, made from `from`: its main file and a test beside it. */
async function partBranch(repo, g, { branch, from, files, variant }) {
  g('switch', '-q', '-c', branch, from);
  for (const [i, f] of files.entries()) {
    await write(repo, f, code(f, variant + i));
    if (/\.(ts|tsx)$/.test(f)) await write(repo, f.replace(/\.(tsx?)$/, '.test.$1'), `// ${f} tests (demo)\nimport { test } from 'node:test';\ntest('works', () => {});\n`);
  }
  g('add', '-A');
  g('commit', '-q', '-m', `${branch.split('--').pop()}: first cut`);
  await fs.appendFile(path.join(repo, files[0]), `\nexport const NOTE_${variant} = 'checked';\n`);
  g('commit', '-qam', `${branch.split('--').pop()}: tidy and test`);
}

// ---------- Job folders ----------

async function job(features, slug, status, files = {}) {
  const dir = path.join(features, slug);
  await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), json({ schema_version: 2, slug, ...status }));
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(dir, name), text);
  return dir;
}

const STAGE_OF = { working: 'implement', checks: 'test', asks: 'plan' };

// ---------- Session logs: the parts at work ----------

const usage = (out) => ({ input_tokens: 4, output_tokens: out, cache_read_input_tokens: 40000, cache_creation_input_tokens: 0, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 } });
let counter = 0;
const line = (sessionId, at, content, agentId, stop = 'tool_use', cwd) => ({ type: 'assistant', sessionId, agentId, timestamp: at, cwd, message: { id: `msg_stack_${++counter}`, model: MODEL, stop_reason: stop, content, usage: usage(400) } });
const tool = (name, input) => ({ type: 'tool_use', id: `tu_stack_${++counter}`, name, input });

/** A Foreman session with one crew member still at work; returns the crew member's log file. */
async function workingSession({ projects, sessionId, dir, cwd, worker, description, startAgo, steps }) {
  await fs.mkdir(path.join(projects, sessionId, 'subagents'), { recursive: true });
  const rows = [
    { type: 'queue-operation', operation: 'enqueue', sessionId, timestamp: iso(startAgo + 5 * MIN), content: `/feature part. Private folder: ${dir}` },
    line(sessionId, iso(startAgo), [tool('Agent', { subagent_type: worker, description, prompt: `Private folder: ${dir}` })], undefined, 'tool_use', cwd),
  ];
  await fs.writeFile(path.join(projects, `${sessionId}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const agentId = `a${sessionId.slice(-6)}`;
  const sub = [{ type: 'user', sessionId, agentId, timestamp: iso(startAgo), message: { role: 'user', content: `Stage work. Private folder: ${dir}` } }];
  steps.forEach((s, i) => {
    sub.push(line(sessionId, iso(startAgo - (i + 1) * 30000), [tool(s[0], s[1])], agentId, 'tool_use', cwd));
    sub.push({ type: 'user', sessionId, agentId, timestamp: iso(startAgo - (i + 1) * 30000 - 2000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } });
  });
  const file = path.join(projects, sessionId, 'subagents', `agent-${agentId}.jsonl`);
  await fs.writeFile(file, sub.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await fs.writeFile(path.join(projects, sessionId, 'subagents', `agent-${agentId}.meta.json`), JSON.stringify({ agentType: worker, description, requestShape: 'background' }));
  return { file, sessionId, agentId, cwd, steps };
}

// ---------- The stacks ----------

/**
 * Writes the three stacks. features: the demo's job folders. root: the demo's temp folder (the
 * repository and session logs go under it). Returns the stacks' slugs.
 */
export async function demoStacks({ features, root, now = Date.now() } = {}) {
  if (!features || !root) throw new Error('demoStacks needs the demo’s features and root folders.');
  const tmp = path.resolve(os.tmpdir());
  if (path.relative(tmp, path.resolve(root)).startsWith('..')) throw new Error('The demo stacks are written only inside the temp folder.');
  const repo = path.join(root, 'stacks-repo');
  const projects = path.join(root, 'projects', '-demo-stacks');
  await fs.mkdir(repo, { recursive: true });
  await fs.mkdir(projects, { recursive: true });
  const g = gitIn(repo);
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Demo'); g('config', 'user.email', 'demo@example.invalid');
  await write(repo, 'README.md', '# Billing app (demo)\nA pretend app for the demo stacks.\n');
  for (const s of [...EXPORT_SECTIONS, ...SSO_SECTIONS]) for (const o of s.owns) if (!o.includes('*') && o !== s.file) await write(repo, o, code(o, 1));
  await write(repo, 'app/billing/billing.ts', code('app/billing/billing.ts', 0));
  g('add', '-A'); g('commit', '-q', '-m', 'Start the billing app');

  const slugs = [];

  // 1. Team invites: the plan waits for you.
  slugs.push(await job(features, 'team-invites', {
    title: 'Team invites', kind: 'feature', route: 'large', stage: 'plan', stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: iso(26 * MIN),
    next_proposed: 'Approve the stack plan on the Stack page', ticket: { key: 'ORBIT-530', title: 'Invite teammates by email' },
    repo: { path: repo, base_branch: 'main' }, branch: 'feature/orbit-530-team-invites', updated_at: iso(26 * MIN),
  }, { 'stack.md': INVITES_PLAN }).then(() => 'team-invites'));

  // 2. Invoice export: mid-build.
  slugs.push(await invoiceExport({ features, repo, g, projects, now }));

  // 3. Single sign-on: finished and pushed.
  slugs.push(await singleSignOn({ features, repo, g }));

  g('switch', '-q', 'main');
  await demoCost(slugs);
  return slugs;
}

async function invoiceExport({ features, repo, g, projects }) {
  const slug = 'invoice-export';
  const parentBranch = 'feature/orbit-521-invoice-export';
  g('switch', '-q', '-c', parentBranch, 'main');
  // Each part: its state and how it got there. merged (minutes ago), or the state it is in now.
  const LOOK = {
    'invoice-model': { state: 'integrated', mergedAgo: 3 * DAY + 2 * HOUR, startedAgo: 4 * DAY },
    'tax-rules': { state: 'integrated', mergedAgo: 2 * DAY + 5 * HOUR, startedAgo: 4 * DAY },
    'billing-api': { state: 'integrated', mergedAgo: 3 * HOUR + 10 * MIN, startedAgo: 3 * DAY },
    'email-delivery': { state: 'blocked', startedAgo: 2 * DAY, problem: { kind: 'conflict', files: ['app/billing/billing.ts'] }, at: 40 * MIN },
    'csv-export': { state: 'ready', startedAgo: 2 * DAY + 3 * HOUR, readyAgo: 55 * MIN },
    refunds: { state: 'running', startedAgo: 30 * HOUR, failures: 1, problem: { kind: 'checks' }, at: 2 * HOUR, look: 'working', worker: 'feature-implementer', doing: 'Fix the refund total test' },
    dunning: { state: 'failed', startedAgo: 2 * DAY, failures: 3, at: 5 * HOUR },
    'invoice-ui': { state: 'running', startedAgo: 20 * HOUR, look: 'checks', worker: 'feature-tester', doing: 'Run the invoice screen tests' },
    'payment-links': { state: 'running', startedAgo: 9 * HOUR, look: 'working', worker: 'feature-implementer', doing: 'Edit link.ts' },
    'audit-log': { state: 'running', startedAgo: 6 * HOUR, look: 'asks', waitingAgo: 18 * MIN },
    'pdf-renderer': { state: 'pending' },
    reports: { state: 'pending' },
  };
  const log = [{ at: iso(4 * DAY + 40 * MIN), event: 'plan-approved', words: `The plan was approved: 12 parts, merging in the order ${EXPORT_SECTIONS.map((s) => s.name).join(', ')}.` }];
  const sections = [];
  let variant = 2;
  const sessions = [];
  for (const s of EXPORT_SECTIONS) {
    const look = LOOK[s.name];
    const started = look.state !== 'pending';
    const branch = `feature/orbit-521-invoice-export--${s.name}`;
    const sec = {
      name: s.name, state: look.state, slug: started ? `${slug}--${s.name}` : null, branch: started ? branch : null,
      worktree: started ? path.join(path.dirname(repo), 'stacks-worktrees', s.name) : null, port: started ? 4600 + sections.length : null,
      failures: look.failures ?? 0, mergedAt: null, mergeSha: null, owns: s.owns, dependsOn: s.deps, model: null, effort: null,
      startedAt: started ? iso(look.startedAgo) : null, readyAt: look.readyAgo ? iso(look.readyAgo) : null, sentBackAt: null, problem: null,
    };
    if (started) {
      log.push({ at: iso(look.startedAgo), event: 'started', section: s.name, words: `Part ${s.name} started on ${branch} (worktree ${sec.worktree}, port ${sec.port}).` });
      // Its work, on its own branch from the stack's branch as it is now.
      const files = s.name === 'email-delivery' ? [s.file, 'app/billing/billing.ts'] : [s.file];
      await partBranch(repo, g, { branch, from: parentBranch, files, variant: variant++ });
      g('switch', '-q', parentBranch);
    }
    if (look.state === 'integrated') {
      log.push({ at: iso(look.mergedAgo + 4 * MIN), event: 'merge-started', section: s.name, words: `You said yes: merging part ${s.name} into ${parentBranch}, then npm test.` });
      g('merge', '-q', '--no-ff', '--no-edit', branch, '-m', `Merge section ${s.name} into ${parentBranch}`);
      sec.mergedAt = iso(look.mergedAgo);
      sec.mergeSha = g('rev-parse', 'HEAD');
      log.push({ at: sec.mergedAt, event: 'merged', section: s.name, sha: sec.mergeSha, checks: [{ command: 'npm test', ok: true }], words: `Part ${s.name} is merged into ${parentBranch}, and the checks passed (npm test).` });
    }
    if (look.readyAgo) log.push({ at: sec.readyAt, event: 'ready', section: s.name, words: `Part ${s.name} is ready to merge.` });
    if (look.state === 'blocked') {
      const words = `Part ${s.name} clashes with ${parentBranch} in app/billing/billing.ts. Nothing was merged: the branch is as it was.`;
      sec.problem = { kind: 'conflict', words, files: look.problem.files };
      log.push({ at: iso(look.at + 2 * MIN), event: 'merge-started', section: s.name, words: `You said yes: merging part ${s.name} into ${parentBranch}, then npm test.` });
      log.push({ at: iso(look.at), event: 'conflict', section: s.name, files: look.problem.files, words });
    }
    if (look.problem?.kind === 'checks') {
      const words = `The checks failed after merging part ${s.name} (npm test), so the merge was undone and ${parentBranch} is back where it was.`;
      sec.problem = { kind: 'checks', words, files: [], tail: 'not ok 14 - refund total is negative\n  ---\n  expected: -120.00\n  actual: 120.00\n  at: app/refunds/refund.test.ts:31\n  ...\n# tests 48\n# pass 47\n# fail 1' };
      sec.sentBackAt = iso(look.at);
      log.push({ at: iso(look.at + 3 * MIN), event: 'merge-started', section: s.name, words: `You said yes: merging part ${s.name} into ${parentBranch}, then npm test.` });
      log.push({ at: iso(look.at), event: 'checks-failed', section: s.name, undone: true, words: `${words} That is 1 of 3.` });
    }
    if (look.state === 'failed') {
      for (let i = 3; i >= 1; i--) {
        log.push({ at: iso(look.at + i * 50 * MIN), event: 'checks-failed', section: s.name, undone: true, words: `The checks failed after merging part ${s.name} (npm test), so the merge was undone and ${parentBranch} is back where it was. That is ${4 - i} of 3.` });
      }
      log.push({ at: iso(look.at), event: 'stuck', section: s.name, words: `Part ${s.name} failed its checks 3 times. It has stopped and needs you.` });
      sec.problem = { kind: 'checks', words: 'Its checks failed 3 times.', files: [], tail: 'not ok 3 - the 30-day reminder is sent once\n  expected: 1\n  actual: 2\n# tests 22\n# pass 21\n# fail 1' };
    }
    sections.push(sec);

    // Its own job folder, as the runner makes it (status.json names its stack and section).
    if (started) {
      const stage = look.state === 'integrated' || look.state === 'ready' || look.state === 'blocked' ? 'review' : STAGE_OF[look.look] ?? 'implement';
      const stageState = look.state === 'integrated' || look.state === 'ready' || look.state === 'blocked' ? 'done' : look.look === 'asks' ? 'waiting_for_you' : look.state === 'failed' ? 'blocked' : 'working';
      const sessionId = `demo-stack-${s.name}`;
      const dir = await job(features, sec.slug, {
        title: `Invoice export · ${s.name}`, kind: 'feature', route: null, stage, stage_state: stageState,
        waiting_for: stageState === 'waiting_for_you' ? 'approval' : null, waiting_since: look.waitingAgo ? iso(look.waitingAgo) : null,
        next_proposed: look.doing ?? (look.look === 'asks' ? 'Approve the plan for the audit log' : look.state === 'failed' ? 'Stopped after three failed checks' : 'Done: waiting for its merge'),
        ticket: { key: 'ORBIT-521' }, repo: { path: repo, base_branch: parentBranch }, branch, worktree: sec.worktree,
        stack: slug, section: s.name, session_id: look.worker ? sessionId : null,
        updated_at: iso(look.waitingAgo ?? look.readyAgo ?? look.at ?? look.mergedAgo ?? 12 * MIN),
      }, { 'section.md': `# Section ${sections.length} of 12: ${s.name}\n\n${s.brief}\n` });
      if (look.worker) {
        sessions.push(await workingSession({
          projects, sessionId, dir, cwd: repo, worker: look.worker, description: look.doing, startAgo: 25 * MIN,
          steps: look.worker === 'feature-tester'
            ? [['Bash', { description: 'Run the invoice screen tests (npm test -- invoices)' }], ['Read', { file_path: `${repo}/app/ui/invoices/InvoiceList.tsx` }]]
            : [['Read', { file_path: `${repo}/${s.file}` }], ['Edit', { file_path: `${repo}/${s.file}` }]],
        }));
      }
    }
  }
  g('switch', '-q', 'main');
  log.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  await job(features, slug, {
    title: 'Invoice export', kind: 'feature', route: 'large', stage: 'implement', stage_state: 'working', waiting_for: null,
    next_proposed: 'Merge the parts in order as they finish', ticket: { key: 'ORBIT-521', title: 'Export invoices as CSV and PDF' },
    repo: { path: repo, base_branch: 'main' }, branch: parentBranch, worktree: repo, updated_at: iso(12 * MIN),
  }, {
    'stack.md': EXPORT_PLAN,
    'stack.json': json({
      version: 1, parent: slug, cap: 5, autoIntegrate: false, model: MODEL, effort: 'high',
      repo, parentBranch, parentWorktree: repo, base: 'main', planApprovedAt: iso(4 * DAY + 40 * MIN), planHash: null,
      push: { state: 'waiting', approvedAt: null, pushedAt: null, note: null, remote: 'origin' },
      sections, log,
    }),
  });
  keepWorking(sessions);
  return slug;
}

async function singleSignOn({ features, repo, g }) {
  const slug = 'single-sign-on';
  const parentBranch = 'feature/orbit-488-single-sign-on';
  g('switch', '-q', '-c', parentBranch, 'main');
  const log = [{ at: iso(12 * DAY), event: 'plan-approved', words: 'The plan was approved: 5 parts.' }];
  const sections = [];
  for (const [i, s] of SSO_SECTIONS.entries()) {
    const branch = `${parentBranch}--${s.name}`;
    await partBranch(repo, g, { branch, from: parentBranch, files: [s.file], variant: 40 + i });
    g('switch', '-q', parentBranch);
    g('merge', '-q', '--no-ff', '--no-edit', branch, '-m', `Merge section ${s.name} into ${parentBranch}`);
    const startedAt = iso((11 - i) * DAY);
    const mergedAt = iso((9 - i * 1.5) * DAY);
    log.push({ at: startedAt, event: 'started', section: s.name, words: `Part ${s.name} started on ${branch}.` });
    log.push({ at: mergedAt, event: 'merged', section: s.name, checks: [{ command: 'npm test', ok: true }], words: `Part ${s.name} is merged into ${parentBranch}, and the checks passed (npm test).` });
    sections.push({
      name: s.name, state: 'integrated', slug: `${slug}--${s.name}`, branch, worktree: null, port: null, failures: 0,
      mergedAt, mergeSha: g('rev-parse', 'HEAD'), owns: s.owns, dependsOn: s.deps, model: null, effort: null, startedAt, readyAt: null, sentBackAt: null, problem: null,
    });
    await job(features, `${slug}--${s.name}`, {
      title: `Single sign-on · ${s.name}`, kind: 'feature', stage: 'review', stage_state: 'done', stack: slug, section: s.name,
      ticket: { key: 'ORBIT-488' }, repo: { path: repo, base_branch: parentBranch }, branch, updated_at: mergedAt,
    });
  }
  log.push({ at: iso(2 * DAY + 3 * HOUR), event: 'push-approved', words: 'You said go: pushing to your fork.' });
  log.push({ at: iso(2 * DAY), event: 'pushed', words: `${parentBranch} is on your fork (origin).` });
  log.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  await job(features, slug, {
    title: 'Single sign-on', kind: 'feature', route: 'large', stage: 'pr1', stage_state: 'working',
    ticket: { key: 'ORBIT-488', title: 'Sign in with the company’s identity provider' },
    repo: { path: repo, base_branch: 'main' }, branch: parentBranch, worktree: repo, updated_at: iso(2 * DAY),
  }, {
    'stack.md': SSO_PLAN,
    'stack.json': json({
      version: 1, parent: slug, cap: 3, autoIntegrate: true, model: MODEL, effort: 'high',
      repo, parentBranch, parentWorktree: repo, base: 'main', planApprovedAt: iso(12 * DAY), planHash: null,
      push: { state: 'pushed', approvedAt: iso(2 * DAY + 3 * HOUR), pushedAt: iso(2 * DAY), note: null, remote: 'origin' },
      sections, log,
    }),
  });
  return slug;
}

// What each stack's parts have cost: lines in the demo's own usage.jsonl (Telemetry's record), only
// when that file is in the temp folder.
async function demoCost(slugs) {
  const dir = process.env.GROUND_CONTROL_DIR;
  if (!dir || path.relative(path.resolve(os.tmpdir()), path.resolve(dir)).startsWith('..')) return;
  const lines = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const jobs = [
    ...EXPORT_SECTIONS.slice(0, 10).map((s) => [`invoice-export--${s.name}`, 'ORBIT-521', 3 + Math.round(rnd() * 6)]),
    ['invoice-export', 'ORBIT-521', 4],
    ...SSO_SECTIONS.map((s) => [`single-sign-on--${s.name}`, 'ORBIT-488', 3 + Math.round(rnd() * 4)]),
    ['single-sign-on', 'ORBIT-488', 3], ['team-invites', 'ORBIT-530', 2],
  ];
  for (const [job, ticket, turns] of jobs) {
    for (let i = 0; i < turns; i++) {
      lines.push({
        t: iso((1 + rnd() * 70) * HOUR), user: 'demo', account: 'acc-demo', job, ticket, stage: 'implement', section: null, worker: i % 2 ? 'feature-implementer' : 'foreman', model: i % 3 ? 'claude-sonnet-5-5' : MODEL,
        tokens: { input: 2000, output: 900, cacheRead: 50000, cacheWrite5m: 0, cacheWrite1h: 0 }, costUsd: Math.round((0.3 + rnd() * 1.9) * 100) / 100, costSource: 'cli', meters: null, turn: `demo-stack-turn-${lines.length}`, session: `demo-${job}`, cliTotalUsd: null,
      });
    }
  }
  lines.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(path.join(dir, 'usage.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return slugs;
}

// The parts at work keep working: a new step in each one's log every few seconds.
function keepWorking(sessions) {
  let i = 0;
  const step = () => Promise.all(sessions.map((s) => {
    const [name, input] = s.steps[i % s.steps.length];
    return fs.appendFile(s.file, JSON.stringify(line(s.sessionId, new Date().toISOString(), [tool(name, input)], s.agentId, 'tool_use', s.cwd)) + '\n').catch(() => {});
  })).then(() => { i++; });
  const t = setInterval(step, 7000);
  t.unref?.();
  return step();
}
