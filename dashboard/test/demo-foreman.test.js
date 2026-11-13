// The demo's pretend Foreman (dashboard/demo/fake-query.js) by level: what it writes to a job's
// status.json and briefs for L0–L3 and for a job with no level, and how it reads the gate card's
// option lines. No Claude: the fake runs through the real Driver with its pauses shortened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { State } from '../lib/state.js';
import { Driver } from '../lib/driver.js';
import { defaultsForLevel, ticketStatus, writeAutoOption, writeOptions } from '../lib/options.js';
import { nextStageAfter } from '../lib/gate.js';
import { fixedStop } from '../lib/auto-rules.js';
import { stagesFor } from '../lib/stages.js';
import { makeFakeQuery, readReply } from '../demo/fake-query.js';
import { parseReviewFindings } from '../lib/play.js';
import { createRunner } from '../runner/index.js';
import { autoRecord, refuseNote, refuseReason, YOURS_NOW } from '../lib/auto.js';
import { answerSchema, approverOptions, askApprover, checkAnswer } from '../lib/approver.js';
import { makeFakeApprover } from '../demo/fake-approver.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACE = 0.02;

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-demo-foreman-'));
  const featuresDir = path.join(root, 'feature-work');
  await fs.mkdir(featuresDir, { recursive: true });
  const driver = new Driver({ queryFn: makeFakeQuery({ featuresDir, pace: PACE }), state: new State(path.join(root, 'state')), projectsDir: '/nonexistent' });
  driver.idleGraceMs = 20;
  driver.on('permission', (p) => driver.decide(p.id, { decision: 'allow' }));
  return { root, featuresDir, driver };
}

// One reply, start to end; `seen` collects every stage_state status.json passed through.
async function reply(driver, dir, text, { sessionId = null } = {}) {
  const seen = [];
  let polling = true;
  const poll = (async () => {
    while (polling) {
      try { seen.push(JSON.parse(await fs.readFile(path.join(dir, 'status.json'), 'utf8')).stage_state); } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 5));
    }
  })();
  const run = await driver.start({ featureDir: dir, slug: path.basename(dir), title: path.basename(dir), cwd: '/repo', sessionId, text });
  const done = await new Promise((resolve) => driver.on('run', (r) => { if (r.id === run.id && ['done', 'error', 'stopped'].includes(r.status)) resolve(r); }));
  polling = false;
  await poll;
  assert.equal(done.status, 'done', done.error);
  return { status: JSON.parse(await fs.readFile(path.join(dir, 'status.json'), 'utf8')), seen };
}

async function newJob(featuresDir, slug, description, level) {
  const dir = path.join(featuresDir, slug);
  if (level !== undefined) await writeOptions(dir, defaultsForLevel(level), { title: description, repo: '/repo' });
  else await fs.mkdir(dir, { recursive: true });
  return { dir, text: `/feature ${description} Private folder: ${dir}\n\nJob options (also in options.json in that folder; read it before every stage):\n- …` };
}
const briefText = (dir, s) => fs.readFile(path.join(dir, s.brief.path), 'utf8');

test('demo Foreman reads a reply: approvals, option lines, guidance and a new job’s description', () => {
  const r = readReply([
    'My answers to brief 3:', '1. Steps? → a) Three', '',
    'Option change for the next step: skip test', 'Option change for the next step: heavier implement',
    'Option change for the next step: ask Fable at review', "Option change for the next step: I'll do implement myself",
    'Option change for the next step: level L3 (was L2)', '', 'I approve. Go ahead with the next stage: Build',
  ].join('\n'));
  assert.deepEqual(r.chips, [
    { kind: 'skip', stage: 'test' }, { kind: 'heavier', stage: 'implement' }, { kind: 'fable', point: 'review' },
    { kind: 'self', stage: 'implement' }, { kind: 'level', level: 3, was: 2 },
  ]);
  assert.equal(r.approve, true);
  assert.equal(readReply('go').approve, true);
  assert.equal(readReply('Edited: approve plan v2 with the smaller table').approve, true, 'an edited approval (Edit, then approve)');
  assert.equal(readReply('I approve, with the smaller table.').approve, true);
  const guidance = readReply('My answers to brief 2:\n1. Where? → a) Next to it\n\nCould the button be grey?');
  assert.equal(guidance.approve, false);
  assert.equal(guidance.own, 'Could the button be grey?');
  assert.equal(readReply('/feature Fix the typo in the footer Private folder: /x').description, 'Fix the typo in the footer');
  assert.equal(readReply('/feature Fix the login (This is a bug fix.) Private folder: /x').description, 'Fix the login');
  assert.equal(readReply('Stop here. Record where things stand').stopping, true);
});

test('demo Foreman, a bug ticket\'s job (as Auto start makes one): it runs a bug job\'s stages, so its gates are ones Auto can answer up to PR #1', async () => {
  const { featuresDir, driver } = await setup();
  const { dir, text } = await newJob(featuresDir, 'orbit-7-dial-drops', 'ORBIT-7: The dial drops calls', 1);
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify(ticketStatus({ ticket: { key: 'ORBIT-7', title: 'The dial drops calls', url: null }, slug: 'orbit-7-dial-drops', title: 'ORBIT-7: The dial drops calls', kind: 'bug', level: 1, repo: '/repo' }), null, 2));
  let { status } = await reply(driver, dir, text);
  for (let i = 0; i < 12 && !status.prs?.[0]?.url; i++) {
    assert.equal(status.kind, 'bug');
    assert.ok(stagesFor('bug').includes(status.stage), `a bug stage: ${status.stage}`);
    const next = nextStageAfter(status.stage, [], 'bug');
    assert.equal(fixedStop({ kind: 'gate', stage: status.stage, nextStage: next }), null, `no merge stop at ${status.stage} (next ${next})`);
    if (next === 'pr1') break;
    ({ status } = await reply(driver, dir, 'I approve. Go ahead with the next stage.', { sessionId: status.session_id }));
  }
});

test('demo Foreman, L0: no plan card; one build after a working status, then a diff brief with no questions', async () => {
  const { root, featuresDir, driver } = await setup();
  const { dir, text } = await newJob(featuresDir, 'footer-typo', 'Fix the typo in the invoice footer', 0);
  const { status, seen } = await reply(driver, dir, text);
  assert.ok(seen.includes('working'), 'a working status before the build');
  assert.equal(status.stage, 'implement');
  assert.equal(status.stage_state, 'waiting_for_you');
  assert.equal(status.waiting_for, 'approval');
  assert.deepEqual(status.questions, []);
  assert.equal(status.suggested_level, 0);
  assert.ok(status.level_reason);
  assert.equal(status.route, 'quick');
  assert.ok(status.session_id, 'its session is recorded, so a later reply finds the job');
  assert.match(await briefText(dir, status), /```diff[\s\S]*\+\s+<h2>Fix the typo in the invoice footer<\/h2>/);
  // Approving the diff goes on to PR #1 (test and review are skipped at L0).
  const next = await reply(driver, dir, 'I approve. Go ahead with the next stage: PR #1', { sessionId: status.session_id });
  assert.equal(next.status.stage, 'pr1');
  await fs.rm(root, { recursive: true, force: true });
});

test('demo Foreman, L0 that isn’t a tweak: no build; a quick plan proposing a higher level', async () => {
  const { root, featuresDir, driver } = await setup();
  const { dir, text } = await newJob(featuresDir, 'roles-tweak', 'Rename the admin role to owner', 0);
  const { status, seen } = await reply(driver, dir, text);
  assert.ok(!seen.includes('working'), 'nothing was dispatched');
  assert.equal(status.stage, 'plan');
  assert.match(status.questions[0].text, /Raise this job to L3/);
  await fs.rm(root, { recursive: true, force: true });
});

test('demo Foreman, L1: a quick plan card (quick plan v1, one question); approving builds and waits for your test', async () => {
  const { root, featuresDir, driver } = await setup();
  const { dir, text } = await newJob(featuresDir, 'copy-link', 'Add a copy link button to the job card', 1);
  const { status } = await reply(driver, dir, text);
  assert.equal(status.stage, 'plan');
  assert.equal(status.waiting_for, 'approval');
  assert.deepEqual(status.artifacts, [{ name: 'Quick plan', path: 'quick-plan.md', version: '1' }]);
  assert.equal(status.questions.length, 1);
  const built = await reply(driver, dir, 'I approve. Go ahead with the next stage: Build', { sessionId: status.session_id });
  assert.ok(built.seen.includes('working'));
  assert.equal(built.status.stage, 'test');
  assert.equal(built.status.waiting_for, 'answers', 'L1 has you try it');
  const reviewed = await reply(driver, dir, 'Tried it: works.', { sessionId: status.session_id });
  assert.equal(reviewed.status.stage, 'review');
  await fs.rm(root, { recursive: true, force: true });
});

test('demo Foreman, L2 and L3: a plan card with two questions, a decision on your behalf and versioned artifacts', async () => {
  const { root, featuresDir, driver } = await setup();
  const two = await newJob(featuresDir, 'tag-filter', 'Let office managers filter tickets by tag', 2);
  const { status } = await reply(driver, two.dir, two.text);
  assert.equal(status.stage, 'plan');
  assert.equal(status.questions.length, 2);
  assert.ok(status.questions.every((q) => q.recommendation && q.options.length === 2));
  assert.equal(status.decided_on_your_behalf.length, 1);
  assert.equal(status.spec.version, '0.2');
  assert.deepEqual(status.artifacts.map((a) => `${a.name} v${a.version}`), ['Findings v1', 'Implementation plan v1', 'Test plan v1']);
  assert.ok(status.next_proposed);
  assert.doesNotMatch(await briefText(two.dir, status), /Fable/);

  const three = await newJob(featuresDir, 'merge-customers', 'Merge duplicate customers with a database migration', 3);
  const l3 = await reply(driver, three.dir, three.text);
  assert.equal(l3.status.stage, 'plan');
  assert.match(await briefText(three.dir, l3.status), /Fable second look at plan v1/);
  assert.match(await briefText(three.dir, l3.status), /Fable looks again when the review is wrapped up/);
  await fs.rm(root, { recursive: true, force: true });
});

test('demo Foreman: with no level, the spec first and its own suggested level', async () => {
  const { root, featuresDir, driver } = await setup();
  const { dir, text } = await newJob(featuresDir, 'visit-reminder', 'Email customers a reminder the day before their visit');
  const { status } = await reply(driver, dir, text);
  assert.equal(status.stage, 'spec');
  assert.equal(status.suggested_level, 2);
  assert.match(status.level_reason, /email/);
  assert.match(await briefText(dir, status), /I suggest \*\*L2 Standard\*\*/);
  await fs.rm(root, { recursive: true, force: true });
});

test('demo Foreman at a plan card: guidance keeps it open, changes bump the plan, option lines steer the next stage', async () => {
  const { root, featuresDir, driver } = await setup();
  const { dir, text } = await newJob(featuresDir, 'next-stops', 'Show each technician’s next three stops', 2);
  const first = (await reply(driver, dir, text)).status;
  const sid = first.session_id;

  const guided = (await reply(driver, dir, 'Could the stops be numbered?', { sessionId: sid })).status;
  assert.equal(guided.brief.number, first.brief.number, 'Other guidance: the same brief, still open');
  assert.equal(guided.stage_state, 'waiting_for_you');

  const revised = (await reply(driver, dir, 'Please make changes before moving on, and stay in the current stage:\nNumber the stops.', { sessionId: sid })).status;
  assert.equal(revised.stage, 'plan');
  assert.equal(revised.brief.number, first.brief.number + 1);
  assert.equal(revised.artifacts.find((a) => a.name === 'Implementation plan').version, '2');

  // I'll do the build myself: it waits for you instead of building.
  const mine = await reply(driver, dir, "Option change for the next step: I'll do implement myself\n\nI approve. Go ahead with the next stage: Build", { sessionId: sid });
  assert.ok(!mine.seen.includes('working'), 'nothing was dispatched');
  assert.equal(mine.status.stage, 'implement');
  assert.equal(mine.status.waiting_for, 'answers');

  // Skip next: the dashboard has already put test in options.json's skip; the review comes next.
  const opts = JSON.parse(await fs.readFile(path.join(dir, 'options.json'), 'utf8'));
  await writeOptions(dir, { ...opts, skip: [...opts.skip, 'test'] });
  const skipped = await reply(driver, dir, 'Option change for the next step: skip test\n\nDone: my commits are on the branch.', { sessionId: sid });
  assert.equal(skipped.status.stage, 'review');
  await fs.rm(root, { recursive: true, force: true });
});

test('demo Foreman: at L0, “heavier implement” brings the 5-line card; approving it builds', async () => {
  const { root, featuresDir, driver } = await setup();
  const { dir, text } = await newJob(featuresDir, 'banner-text', 'Change the banner text on the quotes page', 1);
  const plan = (await reply(driver, dir, text)).status;
  await writeOptions(dir, defaultsForLevel(0)); // the L↓ chip, as the dashboard saves it
  const card = (await reply(driver, dir, 'Option change for the next step: heavier implement\nOption change for the next step: level L0 (was L1)\n\nI approve.', { sessionId: plan.session_id })).status;
  assert.equal(card.stage, 'plan');
  assert.match(card.brief.headline, /^What I’ll change \(quick plan v2\)/);
  const built = (await reply(driver, dir, 'I approve. Go ahead with the next stage: Build', { sessionId: plan.session_id })).status;
  assert.equal(built.stage, 'implement');
  assert.deepEqual(built.questions, []);
  assert.match(await briefText(dir, built), /```diff/);
  await fs.rm(root, { recursive: true, force: true });
});

test('demo Foreman: raising the level once the build has started asks which stages to add', async () => {
  const { root, featuresDir, driver } = await setup();
  const { dir, text } = await newJob(featuresDir, 'price-round', 'Round quote totals to the cent', 2);
  const sid = (await reply(driver, dir, text)).status.session_id;
  await reply(driver, dir, 'I approve. Go ahead with the next stage: Build', { sessionId: sid });
  await writeOptions(dir, defaultsForLevel(3));
  const asked = (await reply(driver, dir, 'Option change for the next step: level L3 (was L2)\n\nI approve.', { sessionId: sid })).status;
  assert.equal(asked.stage, 'implement');
  assert.match(asked.brief.headline, /^Which stages should I add at L3 Large/);
  assert.equal(asked.waiting_for, 'answers');
  await fs.rm(root, { recursive: true, force: true });
});

test('demo Foreman, L3 review: a boss round, a fix round that leaves only the minor, then PR #1 gets its link', async () => {
  const { root, featuresDir, driver } = await setup();
  const { dir } = await newJob(featuresDir, 'invoice-merge', 'Merge duplicate invoices', 3);
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({
    schema_version: 1, slug: 'invoice-merge', title: 'Invoice merge', route: 'large', stage: 'test', stage_state: 'waiting_for_you', waiting_for: 'approval',
    brief: { number: 6, path: 'briefs/006-test.md', headline: 'Invoice merge · test done' }, session_id: 'demo-l3', prs: [{ number: 1, url: null, state: 'not_started' }],
  }));
  const go = (text = 'I approve. Go ahead with the next stage') => reply(driver, dir, text, { sessionId: 'demo-l3' });
  const findings = async () => parseReviewFindings(await fs.readFile(path.join(dir, 'review.md'), 'utf8'));

  const one = await go();
  assert.equal(one.status.stage, 'review');
  assert.deepEqual(await findings().then((f) => [f.blockers, f.majors, f.minors]), [1, 2, 1]);
  assert.match(one.status.next_proposed, /Fix round/);

  const two = await go();
  assert.equal(two.status.stage, 'review', 'a fix round stays in the review');
  assert.deepEqual(await findings().then((f) => [f.blockers, f.majors, f.minors, f.round]), [0, 0, 1, 2]);
  assert.match(two.status.next_proposed, /PR #1/);

  const pr = await go();
  assert.equal(pr.status.stage, 'pr1');
  assert.equal(pr.status.prs[0].url, null, 'ready, not opened yet');
  const open = await go();
  assert.equal(open.status.stage, 'pr1');
  assert.match(open.status.prs[0].url, /^https:\/\/github\.com\/example\/acme-portal\/pull\/\d+$/);
  assert.equal(open.status.prs[0].state, 'open');

  // Each worker was handed the work with an Agent step the dashboard allowed as routine.
  const audit = (await fs.readFile(path.join(root, 'state', 'audit.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  const helpers = audit.filter((e) => e.tool === 'Agent').map((e) => e.headline);
  assert.ok(helpers.includes('Start a helper: feature-implementer'), helpers.join(' · '));
  assert.ok(helpers.includes('Start a helper: feature-reviewer'));
  await fs.rm(root, { recursive: true, force: true });
});

test('demo Foreman: a hand-off you deny runs nothing; the job stays as it was', async () => {
  const { root, featuresDir, driver } = await setup();
  driver.removeAllListeners('permission');
  driver.on('permission', (p) => driver.decide(p.id, { decision: p.toolName === 'Agent' ? 'deny' : 'allow' }));
  const { dir } = await newJob(featuresDir, 'invoice-merge', 'Merge duplicate invoices', 3);
  const before = {
    schema_version: 1, slug: 'invoice-merge', title: 'Invoice merge', route: 'large', stage: 'test', stage_state: 'waiting_for_you', waiting_for: 'approval',
    brief: { number: 6, path: 'briefs/006-test.md', headline: 'Invoice merge · test done' }, session_id: 'demo-l3',
  };
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify(before));
  const { status } = await reply(driver, dir, 'I approve. Go ahead with the next stage', { sessionId: 'demo-l3' });
  assert.equal(status.stage, 'test');
  assert.equal(status.stage_state, 'waiting_for_you');
  assert.equal(status.brief.number, 6, 'no new brief');
  await assert.rejects(fs.access(path.join(dir, 'review.md')), 'no review was written');
  await fs.rm(root, { recursive: true, force: true });
});

// ---------- Auto in the demo: the stand-in Approver ----------

const DASH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const task = (kind, questions = []) => ({ kind, job: { title: 'T', slug: 't', level: 1 }, stage: 'plan', brief: null, paths: [], questions, request: kind === 'permission' ? { tool: 'Bash', headline: 'Run npm run check', preview: '' } : null });
const QS = [
  { id: '1', text: 'Where?', recommendation: 'b', options: [{ id: 'a', label: 'Here' }, { id: 'b', label: 'There' }] },
  { id: '2', text: 'Which?', recommendation: null, options: [{ id: '0', label: 'First' }, { id: '1', label: 'Second' }] },
  { id: '3', text: 'Say it', recommendation: null, options: [] },
];
const ask = (t, fake) => askApprover(t, { query: fake, options: approverOptions({ featureDir: '/x', emptyDir: '/y', kind: t.kind }), roots: [] });

test('the stand-in Approver answers a gate, a question and a permission in the shape checkAnswer accepts', async () => {
  const fake = makeFakeApprover({ fail: false });
  const gate = await ask(task('gate', QS), fake);
  assert.equal(gate.ok, true, gate.problem);
  assert.deepEqual(gate.answer.answers.map((a) => [a.id, a.choice]), [['1', 'b'], ['2', '0'], ['3', null]]);
  assert.equal(gate.answer.why, 'The recommended answer, as the brief proposes.');
  assert.equal(gate.answer.risk, 'low');
  assert.equal(gate.costUsd, 0.02);
  const question = await ask(task('question', QS.slice(0, 2)), fake);
  assert.equal(question.ok, true, question.problem);
  assert.deepEqual(question.answer.answers.map((a) => a.choice), ['b', '0']);
  const permission = await ask(task('permission'), fake);
  assert.deepEqual(permission.answer, { decision: 'allow', why: 'An ordinary step of this job.', risk: 'low' });
});

test('K6: the stand-in Approver still answers a gate whose prompt lists decided items', async () => {
  const gate = await ask({ ...task('gate', QS), decided: [{ id: 'D-1', decision: 'Reviewers: head inspector', why: 'L2 defaults' }, { id: 'D-2', decision: 'Keep the column', why: '' }] }, makeFakeApprover({ fail: false }));
  assert.equal(gate.ok, true, gate.problem);
  assert.deepEqual(gate.answer.answers.map((a) => a.id), ['1', '2', '3'], 'no answer for a decided item');
});

test('the stand-in Approver with fail answers a shape checkAnswer refuses, and takes only Read and Glob', async () => {
  const bad = await ask(task('gate', QS), makeFakeApprover({ fail: true }));
  assert.equal(bad.ok, false);
  assert.match(bad.problem, /agreed shape/);
  assert.throws(() => makeFakeApprover({ fail: false })({ prompt: 'x', options: { tools: ['Read', 'Bash'] } }), /Read and Glob/);
  assert.throws(() => makeFakeApprover({ fail: false })({ prompt: 'x', options: { tools: ['Read', 'Glob'], allowedTools: ['Bash'] } }), /Read and Glob/);
  assert.equal(checkAnswer(task('gate', []), { decision: 'maybe' }).ok, false);
  assert.ok(answerSchema('gate'));
});

// A real runner on temp folders in demo mode: the pretend Foreman, the demo's own stand-in Approver
// (approverQuery: a query in its place, to see what the Approver was asked).
async function demoWorld(jobs, { approverQuery = null } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-demo-auto-')));
  const dirs = Object.fromEntries(['claude', 'features', 'projects', 'agents', 'skills', 'state', 'repo'].map((n) => [n, path.join(root, n)]));
  for (const d of Object.values(dirs)) await fs.mkdir(d);
  const git = (...a) => execFileSync('git', ['-C', dirs.repo, '-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  await fs.writeFile(path.join(dirs.repo, 'README.md'), 'hi\n');
  git('add', '.'); git('commit', '-q', '-m', 'base');
  const sessions = {};
  const made = {};
  for (const [slug, description] of jobs) {
    const dir = path.join(dirs.features, slug);
    await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
    await writeOptions(dir, defaultsForLevel(1), { title: description, repo: dirs.repo, kind: 'feature' });
    await writeAutoOption(dir, { on: true, since: '2026-10-01T10:00:00Z' });
    await fs.writeFile(path.join(dir, 'briefs', '001-plan.md'), '**Quick plan v1**\n');
    await fs.writeFile(path.join(dir, 'quick-plan.md'), '# Quick plan v1 (demo)\n');
    await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({
      schema_version: 1, slug, title: slug, kind: 'feature', route: 'quick', stage: 'plan', stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: '2026-10-01T10:00:00Z',
      brief: { number: 1, path: 'briefs/001-plan.md', headline: 'Quick plan v1' }, questions: [{ id: '1', text: 'Where should the button go?', recommendation: 'a', options: [{ id: 'a', label: 'Next to the title' }, { id: 'b', label: 'In the menu' }] }],
      decided_on_your_behalf: [], next_proposed: 'Build it', artifacts: [{ name: 'Quick plan', path: 'quick-plan.md', version: '1' }], suggested_level: 1, level_reason: 'Small.',
      repo: { path: dirs.repo, base_branch: 'main' }, updated_at: '2026-10-01T10:00:00Z',
    }));
    sessions[dir] = { cwd: dirs.repo, repoPath: dirs.repo, auto: autoRecord(null, { on: true, now: '2026-10-01T10:00:00Z' }) };
    made[slug] = dir;
  }
  await fs.writeFile(path.join(dirs.state, 'sessions.json'), JSON.stringify(sessions));
  const runner = await createRunner({
    host: '127.0.0.1', port: 1, token: 't', dashboardDir: DASH, claudeDir: dirs.claude, featuresDir: dirs.features, projectsDir: dirs.projects,
    agentsDir: dirs.agents, skillsDir: dirs.skills, stateDir: dirs.state, demo: true, claudePath: null,
    claudeSettingsFile: path.join(root, 'claude.json'), legacySettingsFile: null, planUsage: false, orbitStore: 'file',
    integrateDir: dirs.state, integrateRoot: path.join(DASH, '..'), siteLink: false, env: {},
    queryFn: makeFakeQuery({ featuresDir: dirs.features, pace: PACE }),
    ...(approverQuery ? { approverQuery } : {}),
  });
  runner.auto.pass(); // what start() does: jobs in Auto that waited carry on
  const lines = async () => (await fs.readFile(path.join(dirs.state, 'audit.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const until = async (fn, what) => {
    for (let i = 0; i < 400; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error(`Timed out waiting for ${what}; the audit says ${JSON.stringify((await lines()).map((l) => [l.action, l.what, l.rule, l.reason, l.tool, l.headline]))}`);
  };
  const record = async (dir) => JSON.parse(await fs.readFile(path.join(dirs.state, 'sessions.json'), 'utf8'))[dir]?.auto ?? null;
  return { runner, root, dirs, made, lines, until, record };
}

test('the demo\'s Auto job reaches PR #1 with the stand-in Approver', async () => {
  const w = await demoWorld([['auto-demo', 'Add a copy link button to the job card']]);
  try {
    const dir = w.made['auto-demo'];
    await w.until(async () => (await w.lines()).some((l) => l.action === 'auto' && l.what === 'finished'), 'Auto to finish');
    const status = JSON.parse(await fs.readFile(path.join(dir, 'status.json'), 'utf8'));
    assert.equal(status.stage, 'pr1');
    assert.equal(status.prs[0].state, 'open');
    const mine = (await w.lines()).filter((l) => l.action === 'auto');
    assert.ok(mine.filter((l) => l.what === 'gate').length >= 2, 'a decision per approval');
    assert.ok(mine.every((l) => l.what === 'finished' || l.why), 'each decision says why');
    assert.equal(mine.some((l) => l.what === 'stop'), false, JSON.stringify(mine.filter((l) => l.what === 'stop')));
    const rec = await w.record(dir);
    assert.equal(rec.on, false);
    assert.ok(rec.finished);
  } finally {
    w.runner.stop();
    await fs.rm(w.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  }
});

test('the demo\'s migrate job has its database card refused before the Approver is asked anything, and still reaches PR #1', async () => {
  // The demo's own stand-in Approver, with every prompt it is given kept.
  const prompts = [];
  const fake = makeFakeApprover();
  const w = await demoWorld([['auto-demo-migrate', 'Add a copy link button to the job card (demo: migrate)']], { approverQuery: (args) => { prompts.push(String(args.prompt)); return fake(args); } });
  try {
    const dir = w.made['auto-demo-migrate'];
    await w.until(async () => (await w.lines()).some((l) => l.action === 'auto' && l.what === 'finished'), 'Auto to finish');
    const lines = await w.lines();
    // The pretend Foreman's npm run db:migrate card is refused with the product's database note, by Auto.
    const denied = lines.filter((l) => l.action === 'permission' && l.decision === 'deny');
    assert.deepEqual(denied.map((l) => [l.by, l.tool, l.note]), [['auto', 'Bash', refuseNote('database', refuseReason({ rule: 'database' }))]]);
    const mine = lines.filter((l) => l.action === 'auto');
    assert.deepEqual(mine.filter((l) => l.what === 'refuse').map((l) => l.rule), ['database'], 'one refuse line');
    // The Approver was asked about the gates and the other cards, never about that one.
    assert.ok(prompts.some((p) => /^A worker on this job asks permission/.test(p) && p.includes('npm run ')), 'the Approver was asked about other cards, and their commands are in what it reads');
    assert.equal(prompts.some((p) => p.includes('db:migrate')), false, 'the Approver was never asked about the database card');
    // No stop: the job carries on to PR #1, and Auto finished it.
    assert.equal(mine.some((l) => l.what === 'stop'), false, JSON.stringify(mine.filter((l) => l.what === 'stop')));
    const rec = await w.record(dir);
    assert.deepEqual([rec.on, rec.stopped ?? null], [false, null]);
    assert.ok(rec.finished);
    const status = JSON.parse(await fs.readFile(path.join(dir, 'status.json'), 'utf8'));
    assert.equal(status.stage, 'pr1');
    assert.equal(status.prs[0].state, 'open');
  } finally {
    w.runner.stop();
    await fs.rm(w.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  }
});

// ---------- The demo's jobs for the new job page (Part 3, Task 17) ----------

// The whole demo as run-demo.js writes it, in a temp folder of this test's own, with a real runner
// on it in demo mode (no server, no port): the pretend Foreman, the demo's stand-in Approver.
// The caller sets STARBASE_DIR to the root's state/ (the demo's usage lines go there) and puts it back.
async function wholeDemo(root) {
  const { buildDemo } = await import('../demo/run-demo.js');
  const demo = await buildDemo({ root });
  assert.equal(demo.root, root);
  await fs.mkdir(path.join(root, 'claude'), { recursive: true });
  const runner = await createRunner({
    host: '127.0.0.1', port: 1, token: 't', dashboardDir: DASH, claudeDir: path.join(root, 'claude'), featuresDir: demo.features, projectsDir: demo.projects,
    agentsDir: path.join(root, 'agents'), skillsDir: path.join(root, 'skills'), stateDir: demo.state, demo: true, claudePath: null,
    claudeSettingsFile: path.join(root, 'claude.json'), legacySettingsFile: null, planUsage: false, orbitStore: 'file',
    integrateDir: demo.state, integrateRoot: path.join(DASH, '..'), siteLink: false, env: {},
    queryFn: makeFakeQuery({ featuresDir: demo.features, pace: PACE }),
  });
  const lines = async () => (await fs.readFile(path.join(demo.state, 'audit.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const until = async (fn, what) => {
    for (let i = 0; i < 400; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error(`Timed out waiting for ${what}; Auto's lines say ${JSON.stringify((await lines()).filter((l) => l.action === 'auto').map((l) => [l.slug, l.what, l.rule, l.reason]))}`);
  };
  const record = async (slug) => JSON.parse(await fs.readFile(path.join(demo.state, 'sessions.json'), 'utf8'))[path.join(demo.features, slug)]?.auto ?? null;
  const cardOf = async (slug) => (await runner.read.features()).features.find((c) => c.slug === slug);
  // Auto's last line for a job has its auto-log.md written too (the runner writes it after the audit line).
  const settled = async (slug) => {
    const last = (await lines()).filter((l) => l.action === 'auto' && l.slug === slug).at(-1);
    if (!last) return true;
    const st = await fs.stat(path.join(demo.features, slug, 'auto-log.md')).catch(() => null);
    return Boolean(st && st.mtimeMs >= Date.parse(last.at));
  };
  return { root, demo, runner, lines, until, record, cardOf, settled };
}

test('buildDemo refuses a root outside the temp folder and deletes nothing', async () => {
  const { buildDemo } = await import('../demo/run-demo.js');
  // A path under this test file: outside the temp folder, and nothing can be made or removed there (its parent is a file).
  const self = fileURLToPath(import.meta.url);
  const before = await fs.readFile(self, 'utf8');
  const root = path.join(self, 'demo-root');
  await assert.rejects(buildDemo({ root }), /only inside the system’s temp folder/);
  assert.equal(await fs.readFile(self, 'utf8'), before, 'the file is untouched');
  await assert.rejects(fs.lstat(root), { code: 'ENOTDIR' });
});

test('a link inside the temp folder that points outside it is refused', async () => {
  const { buildDemo } = await import('../demo/run-demo.js');
  // The demo's temp folder is, for this test, a fresh folder (os.tmpdir() answers it), so the
  // link's target, a fresh folder beside it, is outside it without leaving the real temp folder.
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-demo-link-'));
  const temp = path.join(base, 'temp');
  const outside = path.join(base, 'outside');
  await fs.mkdir(path.join(temp, 'fresh'), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep.txt'), 'mine');
  try {
    const link = path.join(temp, 'fresh', 'demo-root');
    await fs.symlink(outside, link);
    const realTmpdir = os.tmpdir;
    os.tmpdir = () => temp;
    let built;
    try { built = buildDemo({ root: link }); } finally { os.tmpdir = realTmpdir; }
    await assert.rejects(built, /only inside the system’s temp folder/);
    assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'mine', 'the target folder still holds its file');
    assert.deepEqual(await fs.readdir(outside), ['keep.txt']);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('a root with .. after a link is resolved before anything is deleted', { timeout: 120_000 }, async () => {
  const { buildDemo } = await import('../demo/run-demo.js');
  // <base>/temp stands for the temp folder; <base>/temp/fresh/link points at <base>/outside, and
  // <base>/victim holds a file. Followed link first, <temp>/fresh/link/../victim is <base>/victim
  // (outside); read by its text it is <temp>/fresh/victim (inside), which is where the demo goes.
  // Not realpath'd: the demo writes only inside the system's temp folder as os.tmpdir() names it.
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-demo-dotdot-'));
  const temp = path.join(base, 'temp');
  const outside = path.join(base, 'outside');
  const victim = path.join(base, 'victim');
  const hadDir = Object.hasOwn(process.env, 'STARBASE_DIR');
  const oldDir = process.env.STARBASE_DIR;
  try {
    await fs.mkdir(path.join(temp, 'fresh'), { recursive: true });
    await fs.mkdir(outside);
    await fs.mkdir(victim);
    await fs.writeFile(path.join(victim, 'keep.txt'), 'mine');
    await fs.symlink(outside, path.join(temp, 'fresh', 'link'));
    const root = `${path.join(temp, 'fresh', 'link')}${path.sep}..${path.sep}victim`;
    // The demo's usage lines go to the root's own state folder (see wholeDemo).
    process.env.STARBASE_DIR = path.join(temp, 'fresh', 'victim', 'state');
    const realTmpdir = os.tmpdir;
    os.tmpdir = () => temp;
    let built;
    try { built = buildDemo({ root }); } finally { os.tmpdir = realTmpdir; }
    const demo = await built.catch((err) => err);
    assert.equal(await fs.readFile(path.join(victim, 'keep.txt'), 'utf8').catch((err) => err.code), 'mine', 'the folder the link leads to is untouched');
    assert.deepEqual(await fs.readdir(victim), ['keep.txt']);
    assert.deepEqual(await fs.readdir(outside), []);
    assert.equal(demo.root, path.join(temp, 'fresh', 'victim'), `the demo is built at the resolved root (${demo.message ?? 'built'})`);
  } finally {
    if (hadDir) process.env.STARBASE_DIR = oldDir; else delete process.env.STARBASE_DIR;
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('the demo has a job with an overview and plan steps, one with a recording under way, and an Auto job he wrote to that waits for him with its sentence', { timeout: 120_000 }, async () => {
  // Not realpath'd: the demo writes only inside the system's temp folder as os.tmpdir() names it.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-demo-page-'));
  const hadDir = Object.hasOwn(process.env, 'STARBASE_DIR');
  const oldDir = process.env.STARBASE_DIR;
  process.env.STARBASE_DIR = path.join(root, 'state');
  let w = null;
  try {
    w = await wholeDemo(root);
    // Bulk Archive, at Build: its ticket with who filed it and when, its acceptance lines, and a plan of six steps, three built.
    const bulk = await w.runner.read.job('bulk-archive');
    assert.equal(bulk.stage, 'implement');
    const ticket = bulk.page.ticket;
    assert.ok(ticket, 'the overview has its ticket');
    assert.match(ticket.key, /^[A-Z]+-\d+$/);
    assert.ok(ticket.title);
    assert.ok(ticket.filedBy, 'an invented filer');
    assert.ok(Number.isFinite(Date.parse(ticket.filedAt)), 'and a date');
    assert.ok(ticket.description, 'the ticket’s own words, from ticket.md');
    assert.ok(bulk.page.check?.worksWhen?.length >= 3, 'It works when lines from acceptance.md');
    assert.ok(bulk.page.check.mustNot?.length >= 1, 'It must not lines');
    assert.deepEqual(bulk.page.plan?.steps?.map((s) => s.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    assert.deepEqual(bulk.page.plan.steps.map((s) => s.state), ['done', 'done', 'done', 'now', 'next', 'next'], 'commits [S1] to [S3] are on its branch; the Builder is on S4');

    // Nightly Export, at Test (L2, so its evidence is wanted): a recording under way, line 4 of 19, and Watch's picture.
    const nightly = await w.runner.read.job('nightly-export');
    assert.equal(nightly.stage, 'test');
    const view = await w.runner.local.evidence.view('nightly-export');
    assert.equal(view.wanted, true, view.why);
    assert.equal(view.recording, true);
    assert.equal(view.watch, true);
    assert.equal(view.progress?.line, 4);
    assert.equal(view.progress.of, 19);
    assert.equal(view.progress.lines.length, 19);
    assert.deepEqual(view.progress.lines.slice(0, 5).map((l) => l.state), ['passed', 'passed', 'passed', 'running', 'waiting']);
    assert.ok(view.progress.lines.every((l) => /^AC-\d+$/.test(l.id) && l.title), 'each line has its id and words');
    assert.ok(Number.isFinite(Date.parse(view.progress.startedAt)));
    const frame = await w.runner.local.evidence.live('nightly-export');
    assert.equal(frame.type, 'image/jpeg');
    const onDisk = await fs.readFile(path.join(w.demo.features, 'nightly-export', 'evidence', 'demo-live.jpg'));
    assert.ok(frame.bytes.equals(onDisk), 'the demo’s picture');
    assert.equal(frame.size, onDisk.length);
    assert.deepEqual([...onDisk.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
    assert.deepEqual([...onDisk.subarray(-2)], [0xff, 0xd9]);
    assert.ok(onDisk.length < 20 * 1024, 'a small one');

    // The job he wrote to while its step waited: his already, on the board, before Auto's pass.
    const before = await w.cardOf('auto-yours');
    assert.ok(before, 'the job is on the board');
    assert.doesNotMatch(before.title, /Auto demo/, 'autoRun.mjs tells the Auto demo cards apart by their titles');
    assert.equal(before.auto.yours, true);
    assert.equal(before.laneReason, `Auto stopped: ${YOURS_NOW}`);

    // Auto's own first pass leaves the step to him with the sentence; nothing is put to the Approver for it.
    w.runner.auto.pass();
    const stop = await w.until(async () => (await w.lines()).find((l) => l.action === 'auto' && l.what === 'stop' && l.slug === 'auto-yours'), 'Auto to stop auto-yours');
    assert.equal(stop.reason, YOURS_NOW);
    const rec = await w.record('auto-yours');
    assert.equal(rec.on, true);
    assert.equal(rec.stopped?.reason, YOURS_NOW);
    const mine = (await w.lines()).filter((l) => l.action === 'auto' && l.slug === 'auto-yours');
    assert.equal(mine.some((l) => ['gate', 'permission', 'finished'].includes(l.what)), false, 'nothing was approved for it');
    const after = await w.cardOf('auto-yours');
    assert.deepEqual({ lane: after.lane, laneReason: after.laneReason }, { lane: 'needs-you', laneReason: `Auto stopped: ${YOURS_NOW}` });
    // The migrate job's database card is refused with the product's database note, and the job still reaches PR #1: no stop,
    // one refuse line, finished, under Ready for you to try.
    await w.until(async () => (await w.lines()).some((l) => l.action === 'auto' && l.what === 'finished' && l.slug === 'auto-demo-migrate'), 'Auto to finish auto-demo-migrate');
    const migrateLines = (await w.lines()).filter((l) => l.slug === 'auto-demo-migrate');
    assert.deepEqual(migrateLines.filter((l) => l.action === 'permission' && l.decision === 'deny').map((l) => [l.by, l.tool, l.note]), [['auto', 'Bash', refuseNote('database', refuseReason({ rule: 'database' }))]]);
    assert.deepEqual(migrateLines.filter((l) => l.action === 'auto' && l.what === 'refuse').map((l) => l.rule), ['database'], 'one refuse line');
    assert.equal(migrateLines.some((l) => l.action === 'auto' && l.what === 'stop'), false, 'Auto never stopped it');
    const migrateRec = await w.record('auto-demo-migrate');
    assert.deepEqual([migrateRec.on, migrateRec.stopped ?? null, Boolean(migrateRec.finished)], [false, null, true]);
    const migrateStatus = JSON.parse(await fs.readFile(path.join(w.demo.features, 'auto-demo-migrate', 'status.json'), 'utf8'));
    assert.deepEqual([migrateStatus.stage, migrateStatus.prs?.[0]?.state], ['pr1', 'open']);
    await new Promise((r) => setTimeout(r, 1600)); // the job list is cached for 1.5 seconds
    assert.equal((await w.cardOf('auto-demo-migrate')).auto?.group, 'ready', 'under Ready for you to try');
    // And nothing holds the Approver back: the demo's Auto job still runs to PR #1 with no click.
    await w.until(async () => (await w.lines()).some((l) => l.action === 'auto' && l.what === 'finished' && l.slug === 'auto-demo'), 'Auto to finish auto-demo');
    const autoDemo = JSON.parse(await fs.readFile(path.join(w.demo.features, 'auto-demo', 'status.json'), 'utf8'));
    assert.equal(autoDemo.stage, 'pr1');
    assert.equal(autoDemo.prs?.[0]?.state, 'open');
    // Quiet before the folder goes: each Auto job's auto-log.md has caught up with its last line.
    for (const slug of ['auto-demo', 'auto-demo-migrate', 'auto-yours']) await w.until(() => w.settled(slug), `${slug}’s auto-log.md`);
  } finally {
    w?.runner.stop();
    if (hadDir) process.env.STARBASE_DIR = oldDir;
    else delete process.env.STARBASE_DIR;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  }
});

test('demo Foreman: a job whose description says (demo: migrate) asks to run npm run db:migrate when it builds', async () => {
  const { root, featuresDir, driver } = await setup();
  const cards = [];
  driver.removeAllListeners('permission');
  driver.on('permission', (p) => { if (p.toolName === 'Bash') cards.push(p.input.command); driver.decide(p.id, { decision: 'allow' }); });
  const { dir, text } = await newJob(featuresDir, 'copy-link-migrate', 'Add a copy link button (demo: migrate)', 1);
  const { status } = await reply(driver, dir, text);
  await reply(driver, dir, 'I approve. Go ahead with the next stage: Build', { sessionId: status.session_id });
  assert.ok(cards.includes('npm run db:migrate'), cards.join(' · '));
  const plain = await newJob(featuresDir, 'copy-link-plain', 'Add a copy link button', 1);
  const first = await reply(driver, plain.dir, plain.text);
  cards.length = 0;
  await reply(driver, plain.dir, 'I approve. Go ahead with the next stage: Build', { sessionId: first.status.session_id });
  assert.ok(!cards.includes('npm run db:migrate'), 'a job without the words never asks for it');
  await fs.rm(root, { recursive: true, force: true });
});

test('the demo has the made-up long job (test/fixtures/long-job.js) as the runner reads it: its conversation, review files, findings, commits and recording', { timeout: 120_000 }, async () => {
  const { LONG_JOB, LONG_JOB_COUNTS, longJobFacts } = await import('./fixtures/long-job.js');
  const c = LONG_JOB_COUNTS[52];
  const slug = LONG_JOB[52].slug;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-demo-long-'));
  const hadDir = Object.hasOwn(process.env, 'STARBASE_DIR');
  const oldDir = process.env.STARBASE_DIR;
  process.env.STARBASE_DIR = path.join(root, 'state');
  let w = null;
  try {
    w = await wholeDemo(root);
    const job = await w.runner.read.job(slug);
    assert.deepEqual([job.stage, job.stageState, job.gate?.briefNumber, job.gate?.nextStage], ['review', 'waiting_for_you', c.briefs, 'pr1']);
    // The same conversation as the fixture's: the same kinds in the same order, the same brief headlines.
    const facts = longJobFacts({ size: 52 });
    assert.equal(job.thread.length, c.items);
    assert.equal(job.threadMore, false);
    assert.deepEqual(job.thread.map((it) => it.kind), facts.thread.map((it) => it.kind));
    assert.deepEqual(job.thread.filter((it) => it.kind === 'brief').map((it) => it.headline), facts.thread.filter((it) => it.kind === 'brief').map((it) => it.headline));
    // The step facts: 22 review files, 2 findings (1 open), 14 checks passed, every plan step built from 9 commits over 14 files.
    assert.equal(job.page.docs.review.length, c.reviewFiles);
    assert.deepEqual(job.page.review.rows.map((r) => r.status), facts.detail.page.review.rows.map((r) => r.status));
    assert.equal(job.page.checks.passed, c.checks);
    assert.deepEqual(job.page.plan.steps.map((s) => s.state), Array(c.planSteps).fill('done'));
    const { commits } = await w.runner.read.commits(slug);
    assert.equal(commits.length, c.commits);
    assert.equal(new Set(commits.flatMap((x) => x.files.map((f) => f.path))).size, c.commitFiles);
    assert.equal(job.page.prs.length, c.prs);
    // The recording: its evidence record, one line per check.
    const view = await w.runner.local.evidence.view(slug);
    assert.equal(view.evidence?.criteria.length, c.checks);
  } finally {
    w?.runner.stop();
    if (hadDir) process.env.STARBASE_DIR = oldDir;
    else delete process.env.STARBASE_DIR;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  }
});
