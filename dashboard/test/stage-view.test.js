// The Stage (packet M): one stop of a job and everyone who works or worked it (lib/stage-view.js),
// and its two routes on a demo dashboard (site/routes-stage.js, try-it 'follow' in the runner).
// No terminal is ever opened: the pure view is tested with platform names, and the demo dashboard
// (WORKSHOP_DEMO=1) answers 'follow' without launching anything.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stageView, stopStates, crewRef, resolveRef, followPlan, findCrewLog, continueScript, followScript, readableLines, shellQuote, stageOfCrew, roleWord, followLog,
} from '../lib/stage-view.js';
import { startDashboard } from './helpers/dashboard.js';

const FIXTURE_PROJECTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'projects');
const T = (m) => `2026-10-20T10:${String(m).padStart(2, '0')}:00.000Z`;
const DRIVE = { sessionId: 'sess-1', cwd: '/tmp/repo', mode: 'workshop', model: 'claude-fable-5-1' };
const MAC = { platform: 'darwin' };

/** A job as read.job answers it, at `stage`, with the activity and cost rows given. */
const job = (over = {}) => ({
  slug: 'hours-column', stage: 'review', stageState: 'working', needsYou: false, skipped: [], waitingFor: null, waitingSince: null,
  nowDoing: [], drive: DRIVE, lock: null, history: [], permissionsPending: [], activity: [], costDetail: { agents: [] }, ...over,
});
const conductor = (over = {}) => ({ who: 'conductor', name: 'Foreman', sessionId: 'sess-1', state: 'delegating', doing: 'Sending work to feature-reviewer', since: T(1), lastAt: T(2), ...over });
const crew = (who, over = {}) => ({ who, description: `${who} task`, sessionId: 'sess-1', state: 'running', doing: 'Reading app.js', startedAt: T(3), lastAt: T(4), ...over });

describe('stageView', () => {
  test('the Foreman first, then the crew by role, each with its model and how to open it', () => {
    const activity = [
      conductor(),
      crew('feature-review-ui', { startedAt: T(5) }),
      crew('feature-reviewer', { startedAt: T(6) }),
      crew('feature-review-tests', { startedAt: T(4) }),
      crew('feature-planner', { state: 'finished' }), // another stop's
    ];
    const agents = [
      { agentType: 'conductor', model: 'claude-fable-5-1', stage: 'review', usd: 3 },
      { agentType: 'feature-reviewer', model: 'claude-opus-5-5', stage: 'review', usd: 2 },
      { agentType: 'feature-review-tests', model: 'claude-sonnet-5-5', stage: 'review', usd: 1 },
    ];
    const v = stageView(job({ activity, costDetail: { agents } }), 'review', { ...MAC, local: { terminalApp: 'Terminal', terminalApps: ['iTerm', 'Terminal'] } });
    assert.equal(v.slug, 'hours-column');
    assert.equal(v.stop, 'review');
    assert.equal(v.label, 'Review');
    assert.equal(v.state, 'now');
    assert.equal(v.stateWords, 'Working now');
    assert.deepEqual(v.stages, ['review']);
    assert.deepEqual(v.agents.map((a) => a.role), ['Foreman', 'Reviewer', 'Test reviewer', 'Screens reviewer']);
    assert.deepEqual(v.agents.map((a) => a.who), ['conductor', 'feature-reviewer', 'feature-review-tests', 'feature-review-ui']);
    const [foreman, lead, tests, ui] = v.agents;
    assert.deepEqual(foreman.terminal, { kind: 'continue', ready: true, why: null });
    assert.equal(foreman.ref, 'foreman');
    assert.equal(foreman.status, 'working');
    assert.equal(foreman.model, 'Fable 5.1');
    assert.equal(foreman.doing, 'Sending work to feature-reviewer');
    assert.equal(lead.model, 'Opus 5.5');
    assert.equal(tests.model, 'Sonnet 5.5');
    assert.equal(ui.model, null, 'no cost row: the model is unknown');
    assert.deepEqual(lead.terminal, { kind: 'watch', ready: true, why: null });
    assert.equal(lead.ref, crewRef(activity[2], 2));
    assert.ok(v.agents.every((a) => a.ref.length <= 20));
    assert.equal(lead.since, T(6));
    assert.equal(lead.lastAt, T(4));
    assert.equal(v.since, T(4), 'when its first crew member started');
    assert.deepEqual(v.finished, []);
    assert.equal(v.terminalApp, 'Terminal');
    assert.deepEqual(v.terminalApps, ['iTerm', 'Terminal']);
    // Exactly the fields of StageView and StageAgent (web/src/api/types.ts).
    assert.deepEqual(Object.keys(v).sort(), ['agents', 'finished', 'label', 'since', 'slug', 'stages', 'state', 'stateWords', 'stop', 'terminalApp', 'terminalApps'].sort());
    for (const a of v.agents) assert.deepEqual(Object.keys(a).sort(), ['doing', 'lastAt', 'model', 'ref', 'role', 'since', 'status', 'terminal', 'who'].sort());
  });

  test('agents no longer running fold into finished: done, or stopped mid-task', () => {
    const activity = [conductor(), crew('feature-implementer', { state: 'finished', doing: 'Committing step 3' }), crew('feature-implementer', { state: 'stopped', startedAt: T(8) }), crew('feature-implementer', { startedAt: T(9) })];
    const v = stageView(job({ stage: 'implement', activity }), 'build', MAC);
    assert.deepEqual(v.agents.map((a) => [a.role, a.status]), [['Foreman', 'working'], ['Builder', 'working']]);
    assert.deepEqual(v.finished.map((a) => [a.role, a.status]), [['Builder', 'done'], ['Builder', 'stopped']]);
    assert.equal(v.finished[0].doing, 'Committing step 3', 'its last step');
  });

  test('a done stop: the Foreman and its crew are all finished', () => {
    const activity = [conductor(), crew('feature-planner', { state: 'finished' })];
    const agents = [{ agentType: 'conductor', model: 'claude-opus-5-5', stage: 'plan', usd: 1 }];
    const v = stageView(job({ activity, costDetail: { agents } }), 'plan', MAC);
    assert.equal(v.state, 'done');
    assert.equal(v.stateWords, 'Done');
    assert.deepEqual(v.agents, []);
    assert.deepEqual(v.finished.map((a) => [a.who, a.status]), [['conductor', 'done'], ['feature-planner', 'done']]);
    assert.equal(v.finished[0].model, 'Opus 5.5', 'the model the Foreman used at that stop');
  });

  test('waiting for you: the stop waits, and an agent waiting on a permission says so', () => {
    const activity = [conductor(), crew('feature-tester'), crew('feature-tester', { description: 'Second batch', startedAt: T(7) })];
    const pending = [{ id: 'p1', agentID: null, agentType: 'feature-tester', toolName: 'Bash', displayName: 'Run npm test', kind: 'permission' }];
    const v = stageView(job({ stage: 'test', needsYou: true, waitingFor: 'permission', activity, permissionsPending: pending }), 'test', MAC);
    assert.equal(v.state, 'waiting');
    assert.equal(v.stateWords, 'Waiting for you');
    const tester = v.agents.find((a) => a.who === 'feature-tester');
    assert.equal(tester.status, 'waiting');
    assert.equal(tester.doing, 'Waiting for you to allow a step (Run npm test)');
    assert.equal(v.agents[0].status, 'working', 'the Foreman is still waiting on its crew');

    // The Foreman's own permission (no agent named), and a gate waiting for your decision.
    const own = stageView(job({ stage: 'test', needsYou: true, activity: [conductor()], permissionsPending: [{ id: 'p2', agentID: null, agentType: null, toolName: 'Edit', kind: 'permission' }] }), 'test', MAC);
    assert.equal(own.agents[0].status, 'waiting');
    assert.equal(own.agents[0].doing, 'Waiting for you to allow a step (Edit)');
    const gate = stageView(job({ stage: 'test', needsYou: true, activity: [conductor({ state: 'finished' })] }), 'test', MAC);
    assert.equal(gate.agents[0].status, 'waiting');
    assert.equal(gate.agents[0].doing, 'Waiting for your decision');
    assert.equal(stageView(job({ stage: 'test', lane: 'needs-you' }), 'test', MAC).state, 'waiting', 'the Jobs lane counts too');

    // With the agent's own id in the activity, only that one waits.
    const byId = stageView(job({ stage: 'test', activity: [crew('feature-tester', { agentId: 'a1' }), crew('feature-tester', { agentId: 'a2' })], permissionsPending: [{ id: 'p3', agentID: 'a2', agentType: 'feature-tester', kind: 'question' }] }), 'test', MAC);
    assert.deepEqual(byId.agents.filter((a) => a.who === 'feature-tester').map((a) => a.status), ['working', 'waiting']);
    assert.equal(byId.agents.find((a) => a.status === 'waiting').doing, 'Waiting for your answer to a question');
  });

  test('the Foreman stopped at the stop it is on: still listed there, to carry on', () => {
    const v = stageView(job({ stage: 'plan', stageState: 'paused', paused: true, activity: [conductor({ state: 'stopped' })] }), 'plan', MAC);
    assert.equal(v.agents.length, 1);
    assert.equal(v.agents[0].status, 'stopped');
    assert.equal(v.agents[0].doing, 'Paused');
  });

  test('a skipped stop and a stop still to come list nobody', () => {
    const skipped = stageView(job({ stage: 'plan', skipped: ['investigate', 'spec-update'] }), 'investigate', MAC);
    assert.equal(skipped.state, 'skipped');
    assert.equal(skipped.stateWords, 'Skipped');
    assert.deepEqual(skipped.stages, ['investigate', 'spec-update'], 'every stage skipped: all are named');
    assert.deepEqual(skipped.agents, []);
    assert.deepEqual(skipped.finished, []);
    const next = stageView(job({ stage: 'plan' }), 'ship', MAC);
    assert.equal(next.state, 'next');
    assert.equal(next.stateWords, 'Not yet');
    assert.deepEqual([next.agents, next.finished], [[], []]);
    assert.deepEqual(stageView(job({ stage: 'plan', skipped: ['refine'] }), 'spec', MAC).stages, ['clarify', 'spec', 'wireframe'], 'a skipped stage is left out');
  });

  test('a closed job: every stop it reached is done', () => {
    const v = stageView(job({ stage: 'pr1', closed: { as: 'done', at: T(9) }, activity: [conductor({ state: 'finished' })] }), 'ship', MAC);
    assert.equal(v.state, 'done');
    assert.deepEqual(v.agents, []);
    assert.equal(v.finished[0].who, 'conductor');
  });

  test('which stop a crew member works', () => {
    assert.equal(stageOfCrew('feature-spec-writer', 'Post-investigation spec update'), 'spec-update');
    assert.equal(stageOfCrew('feature-wireframer', 'Draw the screens'), 'wireframe');
    assert.equal(stageOfCrew('feature-fable-check', 'Fable check of the plan'), 'plan');
    assert.equal(stageOfCrew('feature-fable-check', 'A second look'), null);
    const activity = [crew('feature-spec-writer', { description: 'Post-investigation spec update', state: 'finished' }), crew('feature-wireframer', { state: 'finished' }), crew('feature-fable-check', { description: 'Second look' })];
    const at = (stop) => { const v = stageView(job({ stage: 'investigate', activity }), stop, MAC); return [...v.agents, ...v.finished].filter((a) => a.who !== 'conductor').map((a) => a.role); };
    assert.deepEqual(at('investigate'), ['Second look', 'Writer'], 'the spec update, and a running agent with no stage of its own where the job is');
    assert.deepEqual(at('spec'), ['Designer']);
    assert.equal(roleWord('something-new'), 'Helper');
  });

  test('when it can’t be opened in a terminal, it says why in plain words', () => {
    const why = (over, stop = 'review') => stageView(job({ activity: [conductor(), crew('feature-reviewer')], ...over }), stop, over.platform ? { platform: over.platform } : MAC);
    assert.deepEqual(why({ drive: { ...DRIVE, sessionId: null } }).agents[0].terminal, { kind: 'continue', ready: false, why: 'The Foreman hasn’t started a conversation for this job yet.' });
    assert.match(why({ drive: { ...DRIVE, mode: 'running' } }).agents[0].terminal.why, /answering a message sent from here/);
    assert.match(why({ lock: { owner: 'terminal', pid: 9 } }).agents[0].terminal.why, /Another program/);
    assert.match(why({ drive: { ...DRIVE, terminalSession: { sessionId: 'sess-1', ended: false } } }).agents[0].terminal.why, /already open in a terminal/);
    const linux = why({ platform: 'linux' });
    assert.equal(linux.agents[0].terminal.why, 'Opening the Foreman in a terminal works on macOS for now.');
    assert.deepEqual(linux.agents[1].terminal, { kind: 'watch', ready: false, why: 'Following a log in a terminal works on macOS for now.' });
    const noLog = stageView(job({ activity: [crew('feature-reviewer', { sessionId: null })] }), 'review', MAC);
    assert.deepEqual(noLog.agents[1].terminal, { kind: 'watch', ready: false, why: 'This crew member’s log isn’t known yet.' });
    assert.throws(() => stageView(job(), 'nowhere'), /Unknown stop/);
  });

  test('stopStates matches the Job map', () => {
    assert.deepEqual(stopStates({ stage: 'test', stageState: 'working', skipped: ['investigate', 'spec-update'] }), {
      spec: 'done', investigate: 'skipped', plan: 'done', build: 'done', test: 'now', review: 'next', ship: 'next',
    });
    assert.equal(stopStates({ stage: 'test', stageState: 'done' }).test, 'done');
  });
});

describe('refs and following', () => {
  const activity = [conductor(), crew('feature-reviewer'), crew('feature-review-ui')];

  test('a ref names one crew member, even when the activity moved', () => {
    const ref = crewRef(activity[2], 2);
    assert.match(ref, /^c2\.[0-9a-f]{8}$/);
    assert.equal(resolveRef(activity, ref).entry, activity[2]);
    const moved = [activity[0], crew('feature-review-db'), activity[1], activity[2]];
    assert.deepEqual(resolveRef(moved, ref), { entry: activity[2], index: 3 });
    assert.equal(resolveRef(activity, 'c1.00000000'), null);
    assert.equal(resolveRef(activity, 'foreman'), null);
  });

  test('followPlan: the Foreman continues its session; a crew member is watched; anything else is refused', () => {
    assert.deepEqual(followPlan({ ref: 'foreman', activity, drive: DRIVE, platform: 'darwin' }), { kind: 'continue', sessionId: 'sess-1', cwd: '/tmp/repo' });
    assert.deepEqual(followPlan({ ref: 'foreman', activity, drive: { ...DRIVE, sessionId: null }, platform: 'darwin' }), { why: 'The Foreman hasn’t started a conversation for this job yet.' });
    assert.match(followPlan({ ref: 'foreman', activity, drive: { ...DRIVE, mode: 'running' }, platform: 'darwin' }).why, /answering a message/);
    const watch = followPlan({ ref: crewRef(activity[1], 1), activity, drive: DRIVE, platform: 'darwin' });
    assert.equal(watch.kind, 'watch');
    assert.equal(watch.entry, activity[1]);
    assert.equal(watch.role, 'Reviewer');
    assert.equal(followPlan({ ref: crewRef(activity[1], 1), activity, drive: DRIVE, platform: 'win32' }).why, 'Following a log in a terminal works on macOS for now.');
    assert.equal(followPlan({ ref: '../etc', activity, platform: 'darwin' }).why, 'That isn’t one of this job’s agents.');
    assert.match(followPlan({ ref: 'c9.12345678', activity, platform: 'darwin' }).why, /isn’t in this job’s activity any more/);
  });

  test('findCrewLog finds a crew member’s transcript among Claude Code’s logs', async () => {
    const entry = { who: 'feature-spec-writer', description: 'Draft widget spec', sessionId: 'sess-widget-1', startedAt: '2026-10-03T09:00:07.000Z' };
    const file = path.join(FIXTURE_PROJECTS, '-tmp-widget-repo', 'sess-widget-1', 'subagents', 'agent-a1.jsonl');
    assert.equal(await findCrewLog({ projectsDir: FIXTURE_PROJECTS, entry }), file);
    assert.equal(await findCrewLog({ projectsDir: FIXTURE_PROJECTS, entry: { ...entry, startedAt: null } }), file, 'by kind and task alone');
    assert.equal(await findCrewLog({ projectsDir: FIXTURE_PROJECTS, entry: { ...entry, agentId: 'a1', description: 'other' } }), file, 'by its id');
    assert.equal(await findCrewLog({ projectsDir: FIXTURE_PROJECTS, entry: { ...entry, who: 'feature-planner' } }), null);
    assert.equal(await findCrewLog({ projectsDir: FIXTURE_PROJECTS, entry: { ...entry, sessionId: '../..' } }), null);
  });

  test('the terminal scripts quote what they run', () => {
    assert.equal(shellQuote("it's"), `'it'\\''s'`);
    const cont = continueScript({ claude: '/usr/local/bin/claude', cwd: "/tmp/o'brien", sessionId: 'sess-1' });
    assert.match(cont, /^#!\/bin\/sh\n/);
    assert.match(cont, /cd '\/tmp\/o'\\''brien'/);
    assert.match(cont, /exec '\/usr\/local\/bin\/claude' --resume 'sess-1'/);
    assert.throws(() => continueScript({ cwd: '/tmp', sessionId: 'a; rm -rf /' }));
    const follow = followScript({ node: '/usr/bin/node', file: '/logs/agent-a1.jsonl', role: 'Planner' });
    assert.match(follow, /'\/usr\/bin\/node' '[^']*stage-view\.js' follow '\/logs\/agent-a1\.jsonl' 'Planner'/);
    assert.match(follow, /Press Return to close this window/);
  });

  test('a followed log reads as plain lines and says when the agent has finished', async () => {
    const track = { pending: false, prompted: false };
    const line = (d) => JSON.stringify({ timestamp: T(1), ...d });
    assert.match(readableLines(line({ type: 'user', message: { content: 'Plan the hours column' } }), 'Planner', track).lines[0], /Its task: Plan the hours column/);
    const tool = readableLines(line({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/r/app.js' } }] } }), 'Planner', track);
    assert.match(tool.lines[0], /→ Reading app\.js/);
    assert.equal(tool.finished, false);
    assert.match(readableLines(line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'no such file' }] } }), 'Planner', track).lines[0], /That step didn’t work: no such file/);
    const end = readableLines(line({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Plan written.' }] } }), 'Planner', track);
    assert.match(end.lines[0], /Planner: Plan written\./);
    assert.equal(end.finished, true);
    assert.deepEqual(readableLines('not json', 'Planner', track), { lines: [], finished: false });

    const lines = [];
    await followLog(path.join(FIXTURE_PROJECTS, '-tmp-widget-repo', 'sess-widget-1', 'subagents', 'agent-a1.jsonl'), 'Writer', { out: (s) => lines.push(s), pollMs: 20 });
    assert.match(lines.join('\n'), /→ Writing spec\.md/);
    assert.match(lines.at(-1), /The Writer has finished/);
  });
});

// ---------- The routes, on a demo dashboard ----------

describe('the Stage routes', () => {
  let root;
  let dashboard;
  let base;
  let token;
  const output = [];
  const get = (p) => fetch(base + p);
  const post = (p, body = {}, { withToken = true } = {}) => fetch(base + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(withToken ? { 'X-Workshop-Token': token } : {}) }, body: JSON.stringify(body),
  });
  const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

  before(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-stage-server-')));
    const dirs = { features: path.join(root, 'feature-work'), projects: path.join(root, 'projects'), agents: path.join(root, 'agents'), skills: path.join(root, 'skills'), state: path.join(root, 'state'), home: path.join(root, 'home'), repo: path.join(root, 'repo') };
    for (const d of Object.values(dirs)) await fs.mkdir(d, { recursive: true });
    const jobDir = path.join(dirs.features, 'stage-job');
    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(path.join(jobDir, 'status.json'), JSON.stringify({
      schema_version: 1, slug: 'stage-job', title: 'Stage job', route: 'small', stage: 'plan', stage_state: 'working',
      session_id: 'sess-stage-1', repo: { path: dirs.repo, base_branch: 'main' }, updated_at: T(0),
    }, null, 2));
    // The Foreman's session, which sent work to the planner; the planner is still at it.
    const proj = path.join(dirs.projects, '-tmp-stage-repo');
    const subs = path.join(proj, 'sess-stage-1', 'subagents');
    await fs.mkdir(subs, { recursive: true });
    const line = (d) => ({ sessionId: 'sess-stage-1', cwd: dirs.repo, ...d });
    await fs.writeFile(path.join(proj, 'sess-stage-1.jsonl'), jsonl([
      line({ type: 'user', timestamp: T(1), message: { role: 'user', content: `/feature Stage job. Private folder: ${jobDir}` } }),
      line({ type: 'assistant', timestamp: T(2), message: { id: 'm1', model: 'claude-fable-5-1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { subagent_type: 'feature-planner', description: 'Plan the job', prompt: `Private folder: ${jobDir}` } }], usage: { input_tokens: 10, output_tokens: 100 } } }),
    ]));
    await fs.writeFile(path.join(subs, 'agent-p1.meta.json'), JSON.stringify({ agentType: 'feature-planner', description: 'Plan the job' }));
    await fs.writeFile(path.join(subs, 'agent-p1.jsonl'), jsonl([
      line({ agentId: 'p1', isSidechain: true, type: 'user', timestamp: T(3), message: { role: 'user', content: 'Plan the job' } }),
      line({ agentId: 'p1', isSidechain: true, type: 'assistant', timestamp: T(4), message: { id: 's1', model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu2', name: 'Read', input: { file_path: `${dirs.repo}/app.js` } }], usage: { input_tokens: 5, output_tokens: 50 } } }),
    ]));
    dashboard = await startDashboard({
      env: {
        HOME: dirs.home, WORKSHOP_DEMO: '1', WORKSHOP_FEATURES_DIR: dirs.features, WORKSHOP_PROJECTS_DIR: dirs.projects,
        WORKSHOP_AGENTS_DIR: dirs.agents, WORKSHOP_SKILLS_DIR: dirs.skills, WORKSHOP_STATE_DIR: dirs.state,
      },
      output,
    });
    ({ base, token } = dashboard);
  });

  after(async () => {
    await dashboard?.stop();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  test('GET a stop: the Foreman and the planner at work', async () => {
    const res = await get('/api/job/stage-job/stage/plan');
    assert.equal(res.status, 200, output.join(''));
    const v = await res.json();
    assert.equal(v.slug, 'stage-job');
    assert.equal(v.stop, 'plan');
    assert.equal(v.state, 'now');
    assert.equal(v.stateWords, 'Working now');
    assert.deepEqual(v.agents.map((a) => [a.role, a.status]), [['Foreman', 'working'], ['Planner', 'working']]);
    assert.equal(v.agents[1].model, 'Opus 5.5');
    assert.equal(v.agents[1].doing, 'Reading app.js');
    assert.equal(v.agents[0].terminal.kind, 'continue');
    assert.equal(v.agents[1].terminal.kind, 'watch');
    assert.ok(Array.isArray(v.terminalApps));

    const spec = await (await get('/api/job/stage-job/stage/spec')).json();
    assert.equal(spec.state, 'done');
    assert.deepEqual(spec.agents, []);
    assert.equal(spec.finished[0].who, 'conductor');
  });

  test('an unknown stop is a 400 in plain words; an unknown job a 404', async () => {
    const bad = await get('/api/job/stage-job/stage/deploy');
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /There’s no stop by that name\. The stops are spec, investigate, plan, build, test, review and ship\./);
    assert.equal((await get('/api/job/no-such-job/stage/plan')).status, 404);
  });

  test('POST …/terminal: needs the token, a known ref, and opens nothing in the demo', async () => {
    const v = await (await get('/api/job/stage-job/stage/plan')).json();
    const planner = v.agents.find((a) => a.who === 'feature-planner');
    assert.equal((await post('/api/job/stage-job/stage/plan/terminal', { ref: planner.ref }, { withToken: false })).status, 403);
    const watch = await post('/api/job/stage-job/stage/plan/terminal', { ref: planner.ref });
    assert.equal(watch.status, 200, output.join(''));
    assert.deepEqual(await watch.json(), { ok: true, demo: true, kind: 'watch' });
    const cont = await post('/api/job/stage-job/stage/plan/terminal', { ref: 'foreman' });
    assert.equal(cont.status, 200);
    assert.deepEqual(await cont.json(), { ok: true, demo: true, kind: 'continue' });
    const bad = await post('/api/job/stage-job/stage/plan/terminal', { ref: 'rm -rf' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'That isn’t one of this job’s agents.');
    const gone = await post('/api/job/stage-job/stage/plan/terminal', { ref: 'c7.00000000' });
    assert.equal(gone.status, 400);
    assert.match((await gone.json()).error, /isn’t in this job’s activity any more/);
    assert.equal((await post('/api/job/stage-job/stage/nowhere/terminal', { ref: 'foreman' })).status, 400);
  });
});
