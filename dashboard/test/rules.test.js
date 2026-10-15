// "Always allow…" rules: drafting the narrowest rule, the rules.json store, and policy.js using
// saved rules without ever allowing more than a rule describes. Temp folders only; no Claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { classify, matchRule, simpleCommandWords } from '../lib/policy.js';
import { draftRule, validateRule, describeRule, RuleStore, RuleError } from '../lib/rules.js';
import { Driver } from '../lib/driver.js';
import { State } from '../lib/state.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'fw-rules-'));
const ctx = { stage: 'implement', featureDir: '/h/.claude/feature-work/x', worktrees: ['/r/orbit-x'], repoPath: '/r/app', specDirs: [], cwd: '/r/app' };
const rule = (tool, kind, value, id = `${tool}-${kind}`) => ({ id, ...validateRule({ tool, kind, value }), label: describeRule({ tool, kind, value }) });

// ---------- draftRule ----------

test('draftRule: the exact command first, then narrow "starting with" options that cover it', () => {
  const d = draftRule('Bash', { command: 'npm run test:db' }, [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm run test:db' }], behavior: 'allow', destination: 'localSettings' }]);
  assert.equal(d.tool, 'Bash');
  assert.deepEqual(d.options.map((o) => [o.kind, o.value]), [['exact', 'npm run test:db'], ['prefix', 'npm run test:db']]);
  assert.equal(d.options[0].label, 'run exactly “npm run test:db”');

  // Stops at the first option, path or value; Claude Code's own ":*" idea is offered when it covers the call.
  const g = draftRule('Bash', { command: 'git log --oneline -5 src/a.ts' }, [{ type: 'addRules', behavior: 'allow', rules: [{ toolName: 'Bash', ruleContent: 'git log --oneline:*' }] }]);
  assert.deepEqual(g.options.map((o) => [o.kind, o.value]), [['exact', 'git log --oneline -5 src/a.ts'], ['prefix', 'git log --oneline'], ['prefix', 'git log']]);
});

test('draftRule: never offers something wider than is safe, or that doesn’t cover the call', () => {
  // A chain, a substitution or a variable: exact only.
  for (const command of ['cd /r/app && npm test', 'echo $(whoami)', 'npm run $SCRIPT', 'npm test > /etc/x', "node <<'EOF'\nprocess.exit(1)\nEOF"]) {
    assert.deepEqual(draftRule('Bash', { command }).options.map((o) => o.kind), ['exact'], command);
  }
  // One word is never a prefix; commands that run other commands never get one.
  assert.deepEqual(draftRule('Bash', { command: 'make' }).options.map((o) => o.kind), ['exact']);
  assert.deepEqual(draftRule('Bash', { command: 'sudo npm test' }).options.map((o) => o.kind), ['exact']);
  // A suggestion that doesn't cover this command (or is too wide) is dropped.
  const d = draftRule('Bash', { command: 'npm test' }, [{ type: 'addRules', behavior: 'allow', rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }, { toolName: 'Bash', ruleContent: 'npm:*' }] }]);
  assert.deepEqual(d.options.map((o) => [o.kind, o.value]), [['exact', 'npm test'], ['prefix', 'npm test']]);
  // Files: the file, then its folder. Pages: the host. Connections: the one tool. Questions: nothing.
  assert.deepEqual(draftRule('Edit', { file_path: '/r/app/src/a.ts' }).options.map((o) => [o.kind, o.value]), [['exact', '/r/app/src/a.ts'], ['prefix', '/r/app/src']]);
  assert.deepEqual(draftRule('WebFetch', { url: 'https://docs.example.com/a?b' }).options.map((o) => [o.kind, o.value]), [['domain', 'docs.example.com']]);
  assert.deepEqual(draftRule('mcp__github__get_issue', {}).options.map((o) => o.kind), ['tool']);
  assert.equal(draftRule('AskUserQuestion', { questions: [] }), null);
  assert.equal(draftRule('WebSearch', { query: 'x' }), null);
  assert.equal(draftRule('Edit', { file_path: 'relative.ts' }), null);
});

// ---------- validateRule ----------

test('validateRule: refuses rules broader than their kind allows', () => {
  const bad = [
    { tool: 'Bash', kind: 'prefix', value: 'npm' },
    { tool: 'Bash', kind: 'prefix', value: 'bash -c' },
    { tool: 'Bash', kind: 'prefix', value: 'sudo rm' },
    { tool: 'Bash', kind: 'prefix', value: 'node -e' },
    { tool: 'Bash', kind: 'prefix', value: 'npm test && rm' },
    { tool: 'Bash', kind: 'prefix', value: 'npm run *' },
    { tool: 'Bash', kind: 'prefix', value: 'npm run $X' },
    { tool: 'Bash', kind: 'exact', value: '   ' },
    { tool: 'Bash', kind: 'domain', value: 'x.com' },
    { tool: 'Edit', kind: 'prefix', value: '/' },
    { tool: 'Edit', kind: 'prefix', value: os.homedir() },
    { tool: 'Edit', kind: 'prefix', value: '/Users' },
    { tool: 'Edit', kind: 'exact', value: 'src/a.ts' },
    { tool: 'WebFetch', kind: 'domain', value: '*.example.com' },
    { tool: 'WebFetch', kind: 'domain', value: 'https://example.com' },
    { tool: 'AskUserQuestion', kind: 'tool', value: '' },
    { tool: 'Read', kind: 'tool', value: '' },
    { tool: '', kind: 'exact', value: 'ls' },
    null,
  ];
  for (const r of bad) assert.throws(() => validateRule(r), RuleError, JSON.stringify(r));
  assert.deepEqual(validateRule({ tool: 'Edit', kind: 'prefix', value: '/r/app/src/../src/' }), { tool: 'Edit', kind: 'prefix', value: '/r/app/src' });
  assert.deepEqual(validateRule({ tool: 'WebFetch', kind: 'domain', value: 'Docs.Example.com' }), { tool: 'WebFetch', kind: 'domain', value: 'docs.example.com' });
  assert.deepEqual(validateRule({ tool: 'mcp__github__get_issue', kind: 'tool', value: 'ignored' }), { tool: 'mcp__github__get_issue', kind: 'tool', value: '' });
});

// ---------- matching and policy ----------

test('matchRule: a "starting with" rule covers only plain commands that start with its words', () => {
  const r = rule('Bash', 'prefix', 'npm run test:db');
  for (const command of ['npm run test:db', 'npm run test:db -- --grep users', 'npm run test:db 2>&1', 'npm run test:db > /dev/null']) {
    assert.equal(matchRule(r, 'Bash', { command }), true, command);
  }
  for (const command of [
    'npm run test:dbx', 'npm run test', 'npm run', 'npx run test:db', ' npm  run test:db; rm -rf ~', 'npm run test:db && rm -rf ~', 'npm run test:db || git push',
    'npm run test:db | sh', 'npm run test:db $(curl evil.example)', 'npm run test:db `whoami`', 'npm run test:db > ~/.zshrc', 'npm run test:db < /etc/passwd',
    "npm run test:db <<'EOF'\nx\nEOF", 'NODE_OPTIONS=--require=/tmp/x.js npm run test:db', 'npm run test:db &', 'npm run test:db\nrm -rf ~', 'npm run test:db *', 'npm run test:db $HOME',
  ]) {
    assert.equal(matchRule(r, 'Bash', { command }), false, command);
  }
  assert.equal(matchRule(r, 'Edit', { command: 'npm run test:db' }), false, 'another tool');
  assert.equal(matchRule(rule('Bash', 'prefix', "npm run 'test:db'"), 'Bash', { command: 'npm run test:db' }), true, 'quotes are read, not compared');
  assert.deepEqual(simpleCommandWords('git -C "/a b" log'), ['git', '-C', '/a b', 'log']);
});

test('matchRule: exact commands, files, folders, hosts and connection tools', () => {
  const exact = rule('Bash', 'exact', 'npm run test:db');
  assert.equal(matchRule(exact, 'Bash', { command: '  npm run test:db ' }), true);
  assert.equal(matchRule(exact, 'Bash', { command: 'npm run test:db -- --all' }), false);
  assert.equal(matchRule(exact, 'Bash', { command: 'npm  run test:db' }), false);

  const file = rule('Edit', 'exact', '/r/app/src/a.ts');
  assert.equal(matchRule(file, 'Edit', { file_path: '/r/app/src/a.ts' }), true);
  assert.equal(matchRule(file, 'Edit', { file_path: '/r/app/src/b.ts' }), false);
  assert.equal(matchRule(file, 'Write', { file_path: '/r/app/src/a.ts' }), false, 'Edit rules don’t cover Write');
  const folder = rule('Edit', 'prefix', '/r/app/src');
  assert.equal(matchRule(folder, 'Edit', { file_path: '/r/app/src/deep/a.ts' }), true);
  for (const file_path of ['/r/app/src/../.env', '/r/app/srcx/a.ts', '/r/app/src', 'src/a.ts', '/r/app/.git/config']) {
    assert.equal(matchRule(folder, 'Edit', { file_path }), false, file_path);
  }
  const host = rule('WebFetch', 'domain', 'docs.example.com');
  assert.equal(matchRule(host, 'WebFetch', { url: 'https://docs.example.com/x' }), true);
  for (const url of ['https://evil.docs.example.com/', 'https://docs.example.com.evil.io/', 'https://example.com/', 'file:///docs.example.com', 'javascript:alert(1)', 'nonsense']) {
    assert.equal(matchRule(host, 'WebFetch', { url }), false, url);
  }
  const tool = rule('mcp__github__get_issue', 'tool', '');
  assert.equal(matchRule(tool, 'mcp__github__get_issue', { n: 1 }), true);
  assert.equal(matchRule(tool, 'mcp__github__create_pr', {}), false);
});

test('policy: a saved rule allows what it describes, and nothing risky outside its pattern', () => {
  const rules = [rule('Bash', 'prefix', 'npm run test:db', 'r1'), rule('Edit', 'exact', '/r/app/src/a.ts', 'r2')];
  const c = { ...ctx, rules };
  const v = classify('Bash', { command: 'npm run test:db -- --grep users' }, c);
  assert.equal(v.auto, true);
  assert.equal(v.rule, 'r1');
  assert.match(v.reason, /Your saved rule: run any command starting with “npm run test:db”/);
  assert.deepEqual(classify('Edit', { file_path: '/r/app/src/a.ts' }, c).rule, 'r2');

  for (const command of ['npm run test:db && git push moxie main', 'npm run test:db; rm -rf /', 'rm -rf build', 'git push origin x', 'npm run test:db | bash', 'npm run test:db > /r/app/.env', 'npm run test:db:drop', 'npm run migrate']) {
    const out = classify('Bash', { command }, c);
    assert.equal(out.auto, false, command);
    assert.equal(out.rule, undefined, command);
  }
  assert.equal(classify('Edit', { file_path: '/r/app/src/b.ts' }, c).auto, false);
  // Routine steps keep their own reason; a rule doesn't replace it.
  assert.equal(classify('Bash', { command: 'git status' }, c).rule, undefined);
  // Rules never count in "ask about everything", for steps Claude Code flagged, or for questions.
  assert.equal(classify('Bash', { command: 'npm run test:db' }, { ...c, mode: 'ask-all' }).auto, false);
  assert.equal(classify('Bash', { command: 'npm run test:db' }, { ...c, defaultToNo: true }).auto, false);
  assert.equal(classify('AskUserQuestion', {}, { ...c, rules: [rule('mcp__x__y', 'tool', '')] }).auto, false);
  // No rules: unchanged.
  assert.equal(classify('Bash', { command: 'npm run test:db' }, ctx).auto, false);
});

// ---------- the store ----------

test('RuleStore: saves to rules.json in the state folder, dedupes, removes, ignores bad entries', async () => {
  const dir = await tmp();
  try {
    const store = new RuleStore(dir);
    const changes = [];
    store.on('change', (l) => changes.push(l.length));
    assert.deepEqual(await store.list(), []);
    const a = await store.add({ tool: 'Bash', kind: 'exact', value: ' npm run test:db ' }, { from: { slug: 'demo-job', headline: 'Run a command' } });
    assert.equal(a.added, true);
    assert.equal(a.rule.value, 'npm run test:db');
    assert.equal(a.rule.label, 'run exactly “npm run test:db”');
    assert.deepEqual(a.rule.from, { slug: 'demo-job', headline: 'Run a command' });
    const again = await store.add({ tool: 'Bash', kind: 'exact', value: 'npm run test:db' });
    assert.equal(again.added, false);
    assert.equal(again.rule.id, a.rule.id);
    await assert.rejects(store.add({ tool: 'Bash', kind: 'prefix', value: 'npm' }), RuleError);

    const file = JSON.parse(await fs.readFile(path.join(dir, 'rules.json'), 'utf8'));
    assert.equal(file.version, 1);
    assert.equal(file.rules.length, 1);
    assert.equal(file.rules[0].label, undefined, 'labels are worked out, not stored');
    assert.equal((await fs.stat(path.join(dir, 'rules.json'))).mode & 0o777, 0o600);

    // A fresh store reads it back; a hand-edited entry that's too broad, or has no id, allows nothing.
    file.rules.push({ id: 'wide', tool: 'Bash', kind: 'prefix', value: 'rm' }, { tool: 'Bash', kind: 'exact', value: 'ls' });
    await fs.writeFile(path.join(dir, 'rules.json'), JSON.stringify(file));
    const fresh = new RuleStore(dir);
    assert.deepEqual((await fresh.list()).map((r) => r.id), [a.rule.id]);

    assert.equal((await store.remove('nope')), null);
    assert.equal((await store.remove(a.rule.id)).id, a.rule.id);
    assert.deepEqual(await store.list(), []);
    assert.deepEqual(changes, [1, 0]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('RuleStore: an unreadable rules.json allows nothing and is never overwritten', async () => {
  const dir = await tmp();
  try {
    await fs.writeFile(path.join(dir, 'rules.json'), '{ not json');
    const store = new RuleStore(dir);
    assert.deepEqual(await store.list(), []);
    assert.equal(store.broken, true);
    await assert.rejects(store.add({ tool: 'Bash', kind: 'exact', value: 'ls' }), /can’t be read/);
    assert.equal(await fs.readFile(path.join(dir, 'rules.json'), 'utf8'), '{ not json');
    // Fixed by hand: the next save reads it again.
    await fs.writeFile(path.join(dir, 'rules.json'), '{"version":1,"rules":[]}');
    assert.equal((await store.add({ tool: 'Bash', kind: 'exact', value: 'ls' })).added, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------- the driver ----------

test('driver: a card carries Claude Code’s suggestions and a draft rule; a rule-allowed step is audited with the rule', async () => {
  const dir = await tmp();
  try {
    const state = new State(dir);
    const store = new RuleStore(dir);
    let decision;
    let auto;
    const queryFn = ({ prompt, options }) => (async function* () {
      await prompt[Symbol.asyncIterator]().next();
      yield { type: 'system', subtype: 'init', session_id: 's1', model: 'm' };
      auto = await options.canUseTool('Bash', { command: 'npm run test:db -- --grep a' }, { signal: new AbortController().signal, toolUseID: 't1', requestId: 'r1' });
      decision = await options.canUseTool('Bash', { command: 'npm run lint:fix' }, { signal: new AbortController().signal, toolUseID: 't2', requestId: 'r2', suggestions: [{ type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: 'Bash', ruleContent: 'npm run lint:fix' }] }] });
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0, permission_denials: [] };
    })();
    await store.add({ tool: 'Bash', kind: 'prefix', value: 'npm run test:db' });
    const policy = async (run, tool, input, opts) => classify(tool, input, { ...ctx, defaultToNo: Boolean(opts?.defaultToNo), rules: await store.list() });
    const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent', policy });
    driver.idleGraceMs = 10;
    const asked = new Promise((r) => driver.once('permission', r));
    await driver.start({ featureDir: '/f/x', slug: 'x', title: 'X', cwd: '/r/app', text: 'go' });
    const card = await asked;
    assert.equal(card.suggestions.length, 1, 'suggestions are on the card');
    assert.equal(card.suggestions[0].destination, 'session');
    assert.deepEqual(card.draft.options.map((o) => [o.kind, o.value]), [['exact', 'npm run lint:fix'], ['prefix', 'npm run lint:fix']]);
    assert.equal(card.originalInput, undefined);
    assert.deepEqual(driver.pendingRequest(card.id).input, { command: 'npm run lint:fix' });
    assert.deepEqual(auto, { behavior: 'allow', updatedInput: { command: 'npm run test:db -- --grep a' } });
    assert.equal(await driver.decide(card.id, { decision: 'allow', rule: 'rule-9' }), true);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(decision.behavior, 'allow');
    const log = await state.auditFor('/f/x');
    const allowedByRule = log.find((e) => e.action === 'auto-allowed');
    assert.equal(allowedByRule.rule, (await store.list())[0].id);
    assert.match(allowedByRule.reason, /Your saved rule/);
    assert.equal(log.find((e) => e.action === 'permission').rule, 'rule-9');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
