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
import { defaultsForLevel, writeOptions } from '../lib/options.js';
import { makeFakeQuery, readReply } from '../demo/fake-query.js';
import { parseReviewFindings } from '../lib/play.js';

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
