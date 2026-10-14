import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { classify, splitCommand } from '../lib/policy.js';
import { locateJob, pathsIn, branchesIn } from '../lib/locate.js';
import { parseBrief, overviewFromRecord, buildOverview } from '../lib/overview.js';
import { parseEvents, summariseSessions } from '../lib/hook-events.js';
import { parsePs } from '../lib/live.js';

// ---------- routine steps ----------

const ctx = { stage: 'implement', featureDir: '/h/.claude/feature-work/x', worktrees: ['/r/orbit-x'], repoPath: '/r/app', specDirs: ['/r/app/docs/plans'], cwd: '/r/app' };
const auto = (tool, input, c = ctx) => classify(tool, input, c).auto;

test('routine steps run on their own', () => {
  assert.equal(auto('Read', { file_path: '/anywhere' }), true);
  assert.equal(auto('Agent', { subagent_type: 'feature-implementer' }), true);
  assert.equal(auto('Write', { file_path: '/h/.claude/feature-work/x/status.json' }), true);
  assert.equal(auto('Edit', { file_path: '/r/orbit-x/app/src/a.ts' }), true);
  assert.equal(auto('Bash', { command: 'git status --short && git branch --show-current 2>&1' }), true);
  assert.equal(auto('Bash', { command: 'cd /r/orbit-x/app && npm run check' }), true);
  assert.equal(auto('Bash', { command: 'git -C /r/orbit-x commit -m "feat: x [S1]"' }), true);
  assert.equal(auto('Bash', { command: 'git fetch moxie --prune && git worktree add -b feature/x ../orbit-x moxie/main' }), true);
  assert.equal(auto('Write', { file_path: '/r/app/docs/plans/2026-10-13-x-product-spec.md' }, { ...ctx, stage: 'spec' }), true);
});

test('risky or unknown steps always come to you', () => {
  for (const command of ['git push origin feature/x', 'git reset --hard HEAD~1', 'npm run test:db', 'npm install left-pad', 'rm -rf build', 'curl https://example.com', 'sleep 5 &', 'echo $(whoami)', 'echo hi > /etc/hosts', 'find . -delete', 'git add -A', 'git switch main', 'npx prisma migrate deploy', 'gh pr create']) {
    assert.equal(auto('Bash', { command }), false, command);
  }
  assert.equal(auto('Edit', { file_path: '/r/app/src/a.ts' }), false, 'edits in the main folder ask');
  assert.equal(auto('Edit', { file_path: '/r/orbit-x/a.ts' }, { ...ctx, stage: 'plan' }), false, 'no building before the plan is approved');
  assert.equal(auto('WebFetch', { url: 'https://x' }), false);
  assert.equal(auto('mcp__github__create_pr', {}), false);
  assert.equal(auto('Read', {}, { ...ctx, mode: 'ask-all' }), false, 'ask-all asks about everything');
  assert.equal(auto('Bash', { command: 'ls' }, { ...ctx, defaultToNo: true }), false, 'Claude Code’s own risk flag wins');
  assert.equal(splitCommand('a && b || c; d | e').length, 5);
  assert.deepEqual(splitCommand('ls 2>&1'), ['ls 2>&1']);
});

test('quoted patterns, substitutions and loops are read properly', () => {
  for (const command of [
    'grep -rn "createRoleTemplate\\|templateName" src | head -5',
    "sed -n '/^## 6\\./,/^## 8\\./p;/^## 12\\./,/^## 14\\./p' docs/plans/x.md",
    'ls /r/app 2>/dev/null; echo ---; git -C /r/app log --oneline -3',
    'cd /r/orbit-x/app && npm run check > /tmp/orbit-check-s1.log 2>&1; tail -5 /tmp/orbit-check-s1.log',
    'echo "moxie/main is $(git rev-parse --short moxie/main)"',
    'for c in 81d217c cd64f28; do printf "%s: " $c; git show "$c:app/x.ts" | head -3; done',
    'if [ -n "${DATABASE_URL:-}" ]; then echo set; else echo unset; fi',
    'git check-ignore -v docs/plans/x.md; git ls-remote --heads origin; git rev-list --count main..HEAD',
    "git branch -a --list '*in-progress*'",
    'cd /anywhere/else && ls',
    'find src -type f | xargs wc -l',
    'gh pr view 12 --json state',
  ]) {
    assert.equal(auto('Bash', { command }), true, command);
  }
  for (const command of [
    'echo $(rm -rf build)', 'diff <(ls) b', 'cat <<EOF > /etc/x\nEOF', 'git -c core.pager=sh log', 'PATH=/tmp/x:$PATH ls',
    'git fetch --upload-pack=evil origin', "sed 's/a/b/w /etc/x' f", "awk '{ print > \"/etc/x\" }' f", 'rg --pre ./x foo',
    'git remote add evil https://x', 'cd /r/app; git commit -m x', 'cd /r/orbit-x; git commit -m x', 'echo hi > relative.txt',
    'gh auth status --show-token', 'xargs rm < list', 'sort -o /etc/x f', 'git -C /r/app add -A',
  ]) {
    assert.equal(auto('Bash', { command }), false, command);
  }
  assert.equal(auto('Bash', { command: 'cd /r/orbit-x && git add -A && git commit -m "x"' }), true, 'cd through && into the worktree');
});

// ---------- finding the repository and branch ----------

test('locateJob: finds the repo, branch and worktree from text and git', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-locate-')));
  const repo = path.join(root, 'acme');
  const run = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  await fs.mkdir(repo);
  run('init', '-q', '-b', 'main'); run('config', 'user.email', 't@example.invalid'); run('config', 'user.name', 'T');
  await fs.writeFile(path.join(repo, 'a'), 'a'); run('add', '.'); run('commit', '-qm', 'a');
  run('branch', 'feature/widget-export');
  run('worktree', 'add', '-q', path.join(root, 'orbit-widget-export'), 'feature/widget-export');

  const text = `## Repository revision\n\n\`${repo}\`, branch \`feature/widget-export\` at abc1234, clean.\n`;
  const fromText = await locateJob({ slug: 'widget-export', title: 'Widget Export', wsText: text });
  assert.equal(fromText.path, repo);
  assert.equal(fromText.branch, 'feature/widget-export');
  assert.equal(fromText.worktree, path.join(root, 'orbit-widget-export'));
  assert.equal(fromText.checkoutBranch, 'main');

  const fromGit = await locateJob({ slug: 'widget-export', title: 'Widget Export', wsText: '', knownRepos: [repo] });
  assert.equal(fromGit.path, repo, 'found by a branch named after the job');
  assert.equal(fromGit.branch, 'feature/widget-export');

  const fromWorktree = await locateJob({ slug: 'x', title: 'X', statusWorktree: path.join(root, 'orbit-widget-export') });
  assert.equal(fromWorktree.path, repo, 'a worktree resolves to its main repository');

  const chosen = await locateJob({ slug: 'x', title: 'X', override: { repoPath: repo, branch: 'feature/x' } });
  assert.equal(chosen.source, 'your choice');
  assert.equal(chosen.branchExists, false);
  assert.equal((await locateJob({ slug: 'nothing', title: 'Nothing' })).path, null);
  await fs.rm(root, { recursive: true, force: true });
});

test('pathsIn and branchesIn read free-form records', () => {
  assert.deepEqual(pathsIn('Repo `/Users/a/p`, see /Users/a/q/file.md. And (/tmp/x).'), ['/Users/a/p', '/Users/a/q/file.md', '/tmp/x']);
  assert.deepEqual(branchesIn('on branch `feature/a-b` at e6d7422; also `fix/c` and branch main'), ['feature/a-b', 'fix/c']);
});

// ---------- the Foreman's overview ----------

test('overview: from a brief, from a free-form record, and needs from questions', () => {
  const b = parseBrief('**Widget · review done** · spec v0.3\n\n**What happened**\n- 7 reviewers looked.\n\n**Concerns** (mine)\n- Thin tests.\n\n**Decisions for you**\n1. Fix R-2? — yes\n\n**Next:** fix round, then PR #1.\nReply "go" to proceed.');
  assert.deepEqual(b, { headline: 'Widget · review done · spec v0.3', happened: ['7 reviewers looked.'], concerns: ['Thin tests.'], decisions: ['Fix R-2? — yes'], next: 'fix round, then PR #1.' });
  const r = overviewFromRecord('# X\n\n## Current stage\n\n**Planning: complete. Awaiting review.**\n\n## Open items\n\n- G1 open\n  - detail\n\n## Next stage (proposed)\n\nReview the plan on `feature/x`.\n');
  assert.equal(r.headline, 'Planning: complete. Awaiting review.');
  assert.deepEqual(r.concerns, ['G1 open']);
  assert.equal(r.next, 'Review the plan on feature/x.');
  const o = buildOverview({ recordText: '## Current stage\n\nWaiting.', questions: [{ text: 'Pick a name?' }], decided: [{ decision: 'CSV only', confirmed: false }] });
  assert.equal(o.source, 'record');
  assert.deepEqual(o.needs, ['Pick a name?', 'Confirm or change: CSV only']);
  assert.equal(buildOverview({ status: { summary: { headline: 'Building S2', now: 'Tests running', next: 'Review' } } }).source, 'summary');
});

// ---------- live link events and terminals ----------

test('hook events: one summary per session, with job mentions and permission waits', () => {
  const lines = [
    '2026-10-13T10:00:00Z\t{"session_id":"s1","cwd":"/r","hook_event_name":"UserPromptSubmit","prompt":"go ahead with the plan"}',
    '2026-10-13T10:00:05Z\t{"session_id":"s1","hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"/h/.claude/feature-work/widget-export/status.json"}}',
    '2026-10-13T10:00:09Z\t{"session_id":"s1","hook_event_name":"Notification","message":"Claude needs your permission to use Bash"}',
    'broken line',
    '2026-10-13T10:01:00Z\t{"session_id":"s2","hook_event_name":"SessionEnd"}',
  ].join('\n');
  const [s1, s2] = summariseSessions(parseEvents(lines));
  assert.equal(s1.cwd, '/r');
  assert.equal(s1.lastPrompt, 'go ahead with the plan');
  assert.deepEqual(s1.mentions, ['widget-export']);
  assert.equal(s1.waitingForPermission, true);
  assert.equal(s1.lastAt, '2026-10-13T10:00:09Z');
  assert.equal(s2.ended, true);
});

test('process list: only interactive Claude Code terminals', () => {
  const out = [
    '  6076 Mon Oct 12 11:26:41 2026     claude',
    ' 50686 Mon Oct  5 15:52:33 2026     /x/claude.exe --chrome-native-host',
    ' 70000 Mon Oct 12 16:00:00 2026     /x/cli.js --output-format stream-json --input-format stream-json',
    ' 70001 Mon Oct 12 16:00:00 2026     claude -p "hello"',
    ' 70002 Mon Oct 12 16:00:00 2026     /usr/local/bin/claude --resume abc',
    ' 70003 Mon Oct 12 16:00:00 2026     node server.js',
  ].join('\n');
  assert.deepEqual(parsePs(out).map((p) => p.pid), [6076, 70002]);
});
