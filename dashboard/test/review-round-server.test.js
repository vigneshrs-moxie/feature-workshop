// Review rounds through the real dashboard in demo mode (packet Q). The demo's flow map puts the job
// at PR #2 (PR #1 merged, PR #2 open into staging); a fake gh (WORKSHOP_GH) says Raj asked for
// changes with two line comments. The job's worktree is a real local clone whose fork (origin) is a
// local bare repository, so the push is real and goes nowhere else. Every step asks (ask-all).
//
// The round opens with one card; Fix with the Foreman carries on the job's own session (kind
// review-round); the Foreman's reply is stopped and its report written to status.json as it would
// write it, with two commits; Send back runs on one go: the push to the bare fork, the follow-up
// PR #1 opened and merged once green, one reply per comment, the fixed ones resolved, Raj asked
// again, in that order, each in the audit with the go. Raj approves; Merge PR #2 needs the ask's
// confirm. gh never sees a force, an --admin or an org push; nothing reaches GitHub.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startDashboard } from './helpers/dashboard.js';

const roots = [];
const dashboards = [];
after(async () => {
  for (const d of dashboards) await d.stop();
  for (const r of roots) await fs.rm(r, { recursive: true, force: true });
});

const sh = (dir, args) => new Promise((resolve, reject) => {
  execFile('git', ['-C', dir, ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }, (err, stdout, stderr) => (err ? reject(new Error(`git ${args.join(' ')}: ${stderr || err.message}`)) : resolve(String(stdout).trim())));
});

// The demo's PR numbers (demo/fake-flow.js): from the repo's name; at PR #2, #n is PR #1 (merged), #n+1 PR #2.
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const PR1 = 140 + (hash('sample-repo') % 40);
const PR2 = PR1 + 1;
const FOLLOW_UP = 777;
const REPO = 'acme/sample-repo';

// A fake gh: answers from fixture.json, writes each call to calls.jsonl, refuses anything else.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const here = path.dirname(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(path.join(here, 'calls.jsonl'), JSON.stringify(args) + '\\n');
const file = path.join(here, 'fixture.json');
const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
const save = () => fs.writeFileSync(file, JSON.stringify(fx));
const a = args.join(' ');
let out = null;
const pr = (n) => fx.prs[String(n)];
if (args[0] === 'pr' && args[1] === 'view' && pr(args[2])) {
  const v = pr(args[2]).view;
  const json = args[args.indexOf('--json') + 1];
  out = JSON.stringify(json === 'statusCheckRollup,headRefOid' ? { headRefOid: v.headRefOid, statusCheckRollup: v.statusCheckRollup } : v);
} else if (args[0] === 'api' && args[1] === '--method' && args[2] === 'GET') {
  const m = /^repos\\/acme\\/sample-repo\\/(pulls|issues)\\/(\\d+)\\/(reviews|comments|events)/.exec(args[3]);
  if (args[3] === 'user') out = JSON.stringify({ login: 'you' });
  else if (m && pr(m[2])) out = JSON.stringify(m[3] === 'reviews' ? pr(m[2]).reviews : m[3] === 'events' ? [] : m[1] === 'issues' ? pr(m[2]).issues : pr(m[2]).comments);
} else if (args[0] === 'api' && args[1] === '--method' && args[2] === 'POST') {
  fx.posted = (fx.posted || 9000) + 1; save();
  out = JSON.stringify({ id: fx.posted });
} else if (args[0] === 'api' && args[1] === 'graphql') {
  if (args.some((x) => x.startsWith('query=query'))) {
    const n = args.find((x) => x.startsWith('number=')).slice(7);
    out = JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: (pr(n) ? pr(n).comments : []).map((c) => ({ id: 'PRRT_' + c.id, isResolved: false, comments: { nodes: [{ databaseId: c.id }] } })) } } } } });
  } else out = JSON.stringify({ data: { resolveReviewThread: { thread: { isResolved: true } } } });
} else if (args[0] === 'pr' && args[1] === 'create') {
  fx.prs['${FOLLOW_UP}'] = { view: Object.assign({}, fx.prs['${PR2}'].view, { number: ${FOLLOW_UP}, reviewDecision: null, baseRefName: args[args.indexOf('--base') + 1], url: 'https://github.com/${REPO}/pull/${FOLLOW_UP}' }), reviews: [], comments: [], issues: [] };
  save();
  out = 'https://github.com/${REPO}/pull/${FOLLOW_UP}\\n';
} else if (args[0] === 'pr' && args[1] === 'merge' && pr(args[2])) {
  pr(args[2]).view.state = 'MERGED'; save();
  out = '';
} else if (args[0] === 'pr' && ['edit', 'comment', 'reopen'].includes(args[1])) out = '';
else if (args[0] === 'run' && args[1] === 'view') out = '';
if (out === null) { process.stderr.write('fake gh: not expected: ' + a + '\\n'); process.exit(1); }
process.stdout.write(out);
`;

const HEAD0 = 'aaa1111aaa1111aaa1111aaa1111aaa1111aaaa';
const green = [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: `https://github.com/${REPO}/actions/runs/11/job/1` }];
const prView = (over = {}) => ({
  number: PR2, state: 'OPEN', isDraft: false, reviewDecision: 'CHANGES_REQUESTED', reviewRequests: [], mergeable: 'MERGEABLE', headRefOid: HEAD0,
  headRefName: 'feature/sample-job', baseRefName: 'staging', statusCheckRollup: green, url: `https://github.com/${REPO}/pull/${PR2}`, title: 'Sample job',
  mergedAt: null, mergedBy: null, closedAt: null, ...over,
});
const user = (login) => ({ login, type: 'User' });

async function makeJob() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-review-server-')));
  roots.push(root);
  const featuresDir = path.join(root, 'feature-work');
  const fork = path.join(root, 'fork.git');
  const clone = path.join(root, 'sample-repo');
  const ghDir = path.join(root, 'gh');
  const dirs = { projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home') };
  for (const d of [featuresDir, fork, clone, ghDir, ...Object.values(dirs)]) await fs.mkdir(d, { recursive: true });

  // Your fork: a local bare repository. The job's worktree: a clone of it on feature/sample-job, pushed.
  await sh(fork, ['init', '--bare', '-q', '-b', 'main']);
  await sh(clone, ['init', '-q', '-b', 'main']);
  await sh(clone, ['config', 'user.email', 'test@example.com']);
  await sh(clone, ['config', 'user.name', 'Test']);
  await sh(clone, ['remote', 'add', 'origin', fork]);
  await fs.writeFile(path.join(clone, 'App.tsx'), 'let id = 1;\n');
  await sh(clone, ['add', '.']);
  await sh(clone, ['commit', '-q', '-m', 'Start']);
  await sh(clone, ['checkout', '-q', '-b', 'feature/sample-job']);
  await sh(clone, ['push', '-q', 'origin', 'feature/sample-job']);

  const job = path.join(featuresDir, 'sample-job');
  await fs.mkdir(path.join(job, 'briefs'), { recursive: true });
  const status = {
    schema_version: 1, slug: 'sample-job', title: 'Sample job', route: 'small', stage: 'pr2', stage_state: 'in_progress',
    repo: { path: clone }, branch: 'feature/sample-job', worktree: clone, updated_at: '2026-10-28T09:00:00Z',
  };
  await fs.writeFile(path.join(job, 'status.json'), JSON.stringify(status, null, 2));
  await fs.writeFile(path.join(dirs.state, 'sessions.json'), JSON.stringify({ [job]: { sessionId: 'sess-review', cwd: clone, model: 'claude-opus-5-5' } }));
  await fs.writeFile(path.join(dirs.state, 'settings.json'), JSON.stringify({ policy: 'ask-all' }));

  await fs.writeFile(path.join(ghDir, 'fixture.json'), JSON.stringify({
    prs: {
      [PR2]: {
        view: prView(),
        reviews: [{ id: 5001, user: user('raj-moxie'), state: 'CHANGES_REQUESTED', body: 'A few things before this goes in.', submitted_at: '2026-10-28T09:00:00Z', commit_id: HEAD0, html_url: `https://github.com/${REPO}/pull/${PR2}#pullrequestreview-5001` }],
        comments: [
          { id: 7001, user: user('raj-moxie'), path: 'App.tsx', line: 1, position: 1, body: 'Please rename this to feedbackId.', pull_request_review_id: 5001, commit_id: HEAD0, created_at: '2026-10-28T08:59:00Z', html_url: `https://github.com/${REPO}/pull/${PR2}#discussion_r7001` },
          { id: 7002, user: user('raj-moxie'), path: 'App.tsx', line: 1, position: 1, body: 'Why is this a let?', pull_request_review_id: 5001, commit_id: HEAD0, created_at: '2026-10-28T08:59:30Z', html_url: `https://github.com/${REPO}/pull/${PR2}#discussion_r7002` },
        ],
        issues: [],
      },
    },
  }));
  const gh = path.join(ghDir, 'gh.cjs');
  await fs.writeFile(gh, FAKE_GH, { mode: 0o755 });

  const env = {
    HOME: dirs.home, WORKSHOP_FEATURES_DIR: featuresDir, WORKSHOP_PROJECTS_DIR: dirs.projects,
    WORKSHOP_AGENTS_DIR: dirs.agents, WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_GH: gh,
  };
  const lines = (file) => (fsSync.existsSync(file) ? fsSync.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const audit = () => lines(path.join(dirs.state, 'audit.jsonl'));
  const ghCalls = () => lines(path.join(ghDir, 'calls.jsonl'));
  const fixture = {
    read: () => JSON.parse(fsSync.readFileSync(path.join(ghDir, 'fixture.json'), 'utf8')),
    write: (fx) => fsSync.writeFileSync(path.join(ghDir, 'fixture.json'), JSON.stringify(fx)),
  };
  return { env, stateDir: dirs.state, audit, ghCalls, fixture, job, clone, fork, status };
}

function client(d, output) {
  const get = async (p) => (await fetch(d.base + p)).json();
  const write = async (p, body = {}) => {
    const res = await fetch(d.base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workshop-Token': d.token }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const waitFor = async (fn, what, ms = 20000) => {
    const end = Date.now() + ms;
    let last;
    for (;;) {
      last = await fn();
      if (last) return last;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.\n${output.join('').slice(-4000)}`);
      await sleep(150);
    }
  };
  return { get, write, waitFor };
}

const isRead = (args) => (args[0] === 'pr' && args[1] === 'view') || (args[0] === 'run' && args[1] === 'view') || (args[0] === 'api' && args[1] === '--method' && args[2] === 'GET')
  || (args[0] === 'api' && args[1] === 'graphql' && args.some((x) => x.startsWith('query=query')));

test('a round at PR #2: one card, Fix with the Foreman, the report in status.json, Send back on one go (each write in order, in the audit), then Merge PR #2 only with its confirm', async () => {
  const j = await makeJob();
  const output = [];
  const d = await startDashboard({ env: j.env, stateDir: j.stateDir, output });
  dashboards.push(d);
  const c = client(d, output);
  const view = () => c.get('/api/review/sample-job');

  // The first look at PR #2: Raj's Request changes on its newest commit opens round 1, one card.
  let v = await c.waitFor(async () => { const x = await view(); return x.state === 'asked' ? x : null; }, 'round 1');
  assert.equal(v.bar.headline, 'raj-moxie asked for changes on PR #2 · 2 comments, 1 question');
  assert.equal(v.pr.number, PR2);
  assert.equal(v.round.title, 'Round 1 · PR #2');
  assert.ok(v.github?.checkedAt, 'the GitHub line says when GitHub was last checked');
  const cards = (await c.get('/api/snapshot')).permissions.filter((p) => p.slug === 'sample-job');
  assert.deepEqual(cards.filter((p) => p.roundCard).map((p) => p.input.questions[0].options.map((o) => o.label)), [['Fix with the Foreman', 'Leave it for now']]);
  assert.equal(cards.filter((p) => p.feedbackCard).length, 0, 'no single card for a comment the round holds');
  const opened = j.audit().find((e) => e.action === 'review-round-opened');
  assert.equal(opened.prNumber, PR2);
  assert.equal(opened.items, 3);
  const list = await c.get('/api/review');
  assert.deepEqual(list.jobs.map((x) => [x.slug, x.state]), [['sample-job', 'asked']]);
  assert.deepEqual(list.settings, { githubEveryMin: 1, mergeFollowUp: true });

  // Fix with the Foreman: the job's own session, kind review-round. Every step asks, so its reply waits.
  const fix = await c.write('/api/review/sample-job/fix', { note: 'Keep the old name as an alias.' });
  assert.equal(fix.status, 200, JSON.stringify(fix.body));
  const send = await c.waitFor(() => j.audit().find((e) => e.action === 'send' && e.kind === 'review-round'), 'the round’s message');
  assert.equal(send.sessionId, 'sess-review', 'the same session');
  assert.match(send.text, /^raj-moxie asked for changes on PR #2: this is round 1\./);
  assert.match(send.text, /A note from the person: Keep the old name as an alias\./);
  assert.match(send.text, /Don’t push, don’t reply on GitHub, and don’t merge/);
  v = await view();
  assert.equal(v.state, 'fixing');
  assert.equal(v.bar.actions.find((a) => a.id === 'send').enabled, false, 'Send back waits for the Foreman');
  const early = await c.write('/api/review/sample-job/send', { go: true });
  assert.equal(early.status, 409);

  // The Foreman's reply is stopped here; it commits twice and writes its report, as the Foreman would.
  await c.waitFor(async () => (await c.get('/api/runs')).runs.find((r) => r.id === send.runId), 'the reply');
  const stop = await c.write(`/api/runs/${send.runId}/stop`);
  assert.ok([200, 202].includes(stop.status), JSON.stringify(stop.body));
  await c.waitFor(async () => { const r = (await c.get('/api/runs')).runs.find((x) => x.id === send.runId); return !r || !['running', 'starting', 'waiting'].includes(r.status); }, 'the reply to end');
  await sleep(500);
  await fs.writeFile(path.join(j.clone, 'App.tsx'), 'let feedbackId = 1;\n');
  await sh(j.clone, ['commit', '-q', '-am', 'Rename id to feedbackId (review: c7001)']);
  const fix1 = (await sh(j.clone, ['rev-parse', 'HEAD'])).slice(0, 7);
  await fs.writeFile(path.join(j.clone, 'App.tsx'), 'let feedbackId = 1;\nexport const id = feedbackId;\n');
  await sh(j.clone, ['commit', '-q', '-am', 'Keep id as an alias (note)']);
  const head = await sh(j.clone, ['rev-parse', 'HEAD']);
  const st = JSON.parse(await fs.readFile(path.join(j.job, 'status.json'), 'utf8'));
  st.prs = [{ number: 2, rounds: [{ round: 1, state: 'ready', doing: null, next: null, checks: 'npm test passes.', items: [
    { id: 'c7001', kind: 'change', plan: 'fix', plan_text: 'Rename to feedbackId', state: 'fixed', commit: fix1, reply: `Fixed in ${fix1}: renamed to feedbackId.` },
    { id: 'c7002', kind: 'question', plan: 'answer', plan_text: 'Say why', state: 'answered', reply: 'It is reassigned below, so it stays a let.' },
    { id: 'r5001', kind: 'change', plan: 'answer', state: 'answered', reply: 'Thanks: both done.' },
  ] }] }];
  await fs.writeFile(path.join(j.job, 'status.json'), JSON.stringify(st, null, 2));

  v = await c.waitFor(async () => { const x = await view(); return x.state === 'ready' ? x : null; }, 'ready to send back');
  assert.equal(v.bar.headline, 'Round 1 is ready to send back');
  assert.deepEqual(v.send.steps.map((s) => [s.number, s.id]), [[1, 'push'], [2, 'follow-up'], [3, 'replies'], [4, 'resolve'], [5, 'request']]);
  assert.equal(v.send.steps[0].words, 'Push 2 commits to your fork');
  assert.equal(v.send.steps[0].detail, 'git push origin feature/sample-job · never forced');
  const readyCard = await c.waitFor(async () => (await c.get('/api/snapshot')).permissions.find((p) => p.roundCard && p.slug === 'sample-job' && p.review?.state === 'ready'), 'the ready card');
  assert.deepEqual(readyCard.input.questions[0].options.map((o) => o.label), ['Send back to raj-moxie', 'Not yet']);
  assert.deepEqual(j.ghCalls().filter((x) => !isRead(x)), [], 'nothing written to GitHub yet');

  // Send back: refused without the go; then one go runs every step.
  assert.equal((await c.write('/api/review/sample-job/send', {})).status, 400);
  const go = await c.write('/api/review/sample-job/send', { go: true });
  assert.equal(go.status, 200, JSON.stringify(go.body));
  v = await c.waitFor(async () => { const x = await view(); return x.state === 'waiting' ? x : x.state === 'stopped' ? x : null; }, 'round 1 sent');
  assert.equal(v.state, 'waiting', JSON.stringify(v.bar));
  assert.equal(v.bar.headline, 'Waiting on raj-moxie to review PR #2 again');

  // The push went to the bare fork, with the Foreman's commits.
  assert.equal(await sh(j.fork, ['rev-parse', 'feature/sample-job']), head);
  // The writes, in order.
  const writes = j.ghCalls().filter((x) => !isRead(x));
  const short = (w) => (w[1] === 'graphql' ? 'resolve' : w[2] === 'POST' ? w[3] : w.slice(0, 3).join(' '));
  assert.deepEqual(writes.map(short), [
    'pr create --repo',
    `pr merge ${FOLLOW_UP}`,
    `repos/${REPO}/pulls/${PR2}/comments/7001/replies`,
    `repos/${REPO}/pulls/${PR2}/comments/7002/replies`,
    `repos/${REPO}/issues/${PR2}/comments`,
    'resolve',
    `pr edit ${PR2}`,
  ]);
  assert.deepEqual(writes[0].slice(0, 10), ['pr', 'create', '--repo', REPO, '--base', 'feature/sample-job', '--head', 'you:feature/sample-job', '--title', 'Follow-up for raj-moxie’s review on PR #2']);
  assert.deepEqual(writes[1], ['pr', 'merge', String(FOLLOW_UP), '--repo', REPO, '--merge']);
  assert.deepEqual(writes[2].slice(4), ['-f', `body=Fixed in ${fix1}: renamed to feedbackId.`]);
  assert.equal(writes[5].at(-1), 'id=PRRT_7001', 'only the fixed one is resolved');
  assert.deepEqual(writes[6], ['pr', 'edit', String(PR2), '--repo', REPO, '--add-reviewer', 'raj-moxie']);
  // The audit: each write with the go, each step, the round sent.
  const audit = j.audit();
  const gw = audit.filter((e) => e.action === 'gh-write');
  assert.deepEqual(gw.map((e) => e.what), ['push', 'open-pr', 'merge', 'reply', 'reply', 'reply', 'resolve', 'request-review']);
  assert.ok(gw.every((e) => e.ok === true && e.yes === 'Send back round 1 on PR #2'), JSON.stringify(gw));
  assert.equal(gw[0].command, 'git push origin feature/sample-job');
  assert.deepEqual(audit.filter((e) => e.action === 'review-round-step').map((e) => [e.number, e.ok]), [[1, true], [2, true], [3, true], [4, true], [5, true]]);
  assert.ok(audit.some((e) => e.action === 'review-round-sent' && e.reviewer === 'raj-moxie'));
  const detail = await c.get('/api/job/sample-job');
  const notes = detail.thread.filter((t) => t.kind === 'note').map((t) => t.text);
  assert.ok(notes.some((t) => /went back to raj-moxie\.$/.test(t)), JSON.stringify(notes));
  assert.ok(!detail.thread.some((t) => t.kind === 'you' && t.sendKind === 'review-round'), 'the round’s message is a note, not a message from you');

  // While it waits on Raj, GitHub is checked every minute (1, 5, 10 or 30 in the settings).
  const flowView = await c.waitFor(async () => { const f = await c.get('/api/flow'); return f.github?.waiting ? f : null; }, 'the faster checking');
  assert.equal(flowView.github.everyMs, 60000);
  assert.equal((await c.write('/api/review/settings', { githubEveryMin: 7 })).status, 400);
  const set = await c.write('/api/review/settings', { githubEveryMin: 5 });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  await c.waitFor(async () => (await c.get('/api/flow')).github?.everyMs === 300000, 'every five minutes');

  // Raj approves the new commit; Check now (POST /api/flow/refresh). Nobody named merges PR #2 here,
  // so you may: Merge PR #2 needs the ask's go and its confirm.
  const fx = j.fixture.read();
  fx.prs[PR2].view = { ...fx.prs[PR2].view, reviewDecision: 'APPROVED', headRefOid: head, state: 'OPEN' };
  fx.prs[PR2].reviews.push({ id: 5009, user: user('raj-moxie'), state: 'APPROVED', body: '', submitted_at: '2026-10-28T12:00:00Z', commit_id: head });
  j.fixture.write(fx);
  assert.equal((await c.write('/api/flow/refresh')).status < 300, true);
  v = await c.waitFor(async () => { const x = await view(); return x.state === 'approved-you-merge' ? x : null; }, 'ready to merge');
  assert.equal(v.bar.headline, 'PR #2 is approved and green: merge it into staging?');
  const noConfirm = await c.write('/api/review/sample-job/merge', { go: true });
  assert.equal(noConfirm.status, 400);
  assert.match(noConfirm.body.error ?? noConfirm.body.message ?? '', /hard line/);
  assert.ok(!j.ghCalls().some((x) => x[0] === 'pr' && x[1] === 'merge' && x[2] === String(PR2)), 'not merged');
  const merged = await c.write('/api/review/sample-job/merge', { go: true, confirm: 'merge PR #2' });
  assert.equal(merged.status, 200, JSON.stringify(merged.body));
  assert.equal(merged.body.state, 'merged');
  assert.deepEqual(j.ghCalls().filter((x) => !isRead(x)).at(-1), ['pr', 'merge', String(PR2), '--repo', REPO, '--merge']);
  assert.ok(j.audit().some((e) => e.action === 'gh-write' && e.what === 'merge' && e.yes === 'Merge PR #2 into staging'));

  // Never a force, an --admin, an --auto or the org remote; gh only ever saw these commands.
  for (const args of j.ghCalls()) {
    for (const bad of ['--force', '--admin', '--auto', '--rebase', 'moxie']) assert.ok(!args.includes(bad), `gh ${args.join(' ')}`);
    const known = isRead(args) || ['create', 'merge', 'edit'].includes(args[1]) || (args[0] === 'api' && (args[2] === 'POST' || args[1] === 'graphql'));
    assert.ok(known, `unexpected gh ${args.join(' ')}`);
  }
  assert.ok(!output.join('').includes('not expected'), output.join('').slice(-2000));
  await d.stop();
});
