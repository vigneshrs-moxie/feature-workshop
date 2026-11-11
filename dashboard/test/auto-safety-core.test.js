// Deep review A (the safety core of Auto): the fixed rules after its fixes. Pure functions only, with
// made-up input whose paths have the real shapes: home /Users/test, the job folder under
// ~/.claude/feature-work, the skills under ~/.claude/skills, the repository in ~/Projects. Nothing is
// created under a home folder, no git is run (git is a stand-in), and no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.HOME = '/Users/test'; // before the modules below read it
const { autoVerdict } = await import('../lib/auto-rules.js');
const { hardLine, goAheadCovers } = await import('../lib/hard-lines.js');
const { verifiedJobContext } = await import('../lib/auto-context.js');
const { approverRoots, approverMayRead } = await import('../lib/approver.js');

const HOME = '/Users/test';
const JOB = `${HOME}/.claude/feature-work/orbit-500-thing`;
const SKILLS = `${HOME}/.claude/skills`;
const AGENTS = `${HOME}/.claude/agents`;
const REPO = `${HOME}/Projects/orbit`;
const WT = `${HOME}/Projects/orbit-orbit-500-thing`;
const BRANCH = 'feature/orbit-500-thing';
const STATE = `${HOME}/.starbase`;
const FORK = 'git@github.com:test/orbit.git';
const ORG = 'git@github.com:moxie-org/orbit.git';

// git as a stand-in: the repository's worktree list (main checkout first) and the org remote's default branch.
const gitOf = ({ list = [{ path: REPO, branch: 'main' }, { path: WT, branch: BRANCH }], defaults = ['main'], fail = false } = {}) => ({
  worktrees: async () => (fail ? null : list),
  defaultBranch: async () => defaults,
});
// What a Foreman can write with one Write call to its own status.json (deep review A, C1).
const lying = { repoPath: REPO, worktree: '/Users/nobody-probe', statusWorktree: '/Users/nobody-probe', spec: { path: '/Users/nobody-probe/Documents/spec.md' }, branch: 'main', stage: 'pr1' };

const ctxOf = (v, over = {}) => ({
  worktrees: v.worktrees, featureDir: JOB, specDirs: v.specDirs, cwd: WT, forkRemote: 'origin',
  remoteUrl: (name) => ({ '': FORK, origin: FORK, moxie: ORG }[name ?? ''] ?? null), currentBranch: BRANCH, branches: v.branches,
  stateDir: STATE, apiPort: 4477, ...over,
});
const card = (toolName, input, ctx) => {
  const v = autoVerdict({ kind: 'card', toolName, input, hardLine: hardLine(toolName, input, { cwd: ctx.cwd }), blockedPath: null }, ctx);
  return v ? (v.verdict === 'ask' ? 'ask' : v.rule) : null;
};
const bash = (command, ctx) => card('Bash', { command }, ctx);

// ---------- C1: folders, branch and repository come from Starbase and git ----------

test('C1: a worktree, branch and spec folder named by status.json alone are not the job\'s', async () => {
  const v = await verifiedJobContext({ featureDir: JOB, f: lying, recordedRepo: REPO, profileWorktree: WT, git: gitOf() });
  assert.deepEqual(v.worktrees, [WT], 'only the worktree git lists for the repository');
  assert.deepEqual(v.branches, [BRANCH], 'the branch git says is checked out there, not "main"');
  assert.deepEqual(v.specDirs, [`${REPO}/docs/plans`], 'the spec folder outside the repository, worktrees and job folder is dropped');
  assert.equal(v.repo, REPO);
  const ctx = ctxOf(v);
  // Each row: what the status.json context gives now, and the same row in the honest context (the control).
  const honest = ctxOf({ worktrees: [WT], specDirs: [`${REPO}/docs/plans`], branches: [BRANCH] });
  const rows = [
    ['Edit', { file_path: '/Users/nobody-probe/.zshrc', old_string: 'a', new_string: 'b' }],
    ['Write', { file_path: '/Users/nobody-probe/Library/LaunchAgents/x.plist', content: 'x' }],
    ['Write', { file_path: '/Users/nobody-probe/Projects/other-repo/src/a.js', content: 'x' }],
    ['Write', { file_path: '/Users/nobody-probe/Documents/spec.md', content: 'x' }],
    ['Bash', { command: 'echo x >> /Users/nobody-probe/.zshrc' }],
    ['Bash', { command: 'rm -r /Users/nobody-probe/Documents' }],
    ['Bash', { command: 'rm -rf /Users/nobody-probe/Documents' }],
    ['Bash', { command: 'git push origin main' }],
  ];
  for (const [tool, input] of rows) {
    const got = card(tool, input, ctx);
    assert.equal(got, card(tool, input, honest), `${tool} ${JSON.stringify(input)}`);
    assert.notEqual(got, null, `${tool} ${JSON.stringify(input)} is not a pass`);
  }
  assert.equal(bash('git push origin feature/orbit-500-thing', ctx), null, 'the job\'s own branch, as git names it, still pushes');
  // The rm -rf cover uses the same folders.
  assert.equal(goAheadCovers('Bash', { command: 'rm -rf /Users/nobody-probe/Documents' }, { mode: 'auto', stage: 'implement', worktrees: v.worktrees, featureDir: JOB, cwd: WT }), null);
  // The Approver may not read under the named folder.
  const roots = approverRoots({ featureDir: JOB, worktrees: v.worktrees, specDirs: v.specDirs });
  assert.equal(approverMayRead('/Users/nobody-probe/Documents/notes.md', roots), false);
  assert.equal(roots.includes('/Users/nobody-probe'), false);
});

test('C1: a worktree git lists is kept, with the branch git names; a failed answer keeps none', async () => {
  const listed = await verifiedJobContext({ featureDir: JOB, f: { ...lying, worktree: WT, statusWorktree: WT, branch: 'whatever' }, recordedRepo: REPO, git: gitOf() });
  assert.deepEqual(listed.worktrees, [WT]);
  assert.deepEqual(listed.branches, [BRANCH]);
  assert.equal(bash('touch src/a.ts', ctxOf(listed)), null, 'a write in the verified worktree passes');
  const failed = await verifiedJobContext({ featureDir: JOB, f: { ...lying, worktree: WT, statusWorktree: WT }, recordedRepo: REPO, git: gitOf({ fail: true }) });
  assert.deepEqual(failed.worktrees, [], 'git could not say: no status.json worktree');
  assert.deepEqual(failed.branches, []);
  assert.equal(bash('git push origin feature/orbit-500-thing', ctxOf(failed)), 'push', 'with no known branch every push stops');
  // The profile's own worktree, before it exists, stays (the Foreman makes it there); git says nothing yet.
  const before = await verifiedJobContext({ featureDir: JOB, f: null, recordedRepo: REPO, profileWorktree: WT, git: gitOf({ list: [{ path: REPO, branch: 'main' }] }) });
  assert.deepEqual(before.worktrees, [WT]);
  assert.deepEqual(before.branches, []);
});

test('C1: the main checkout, a protected branch and the org default branch are never the job\'s', async () => {
  const onMain = await verifiedJobContext({ featureDir: JOB, f: { worktree: REPO, statusWorktree: REPO }, recordedRepo: REPO, git: gitOf() });
  assert.deepEqual(onMain.worktrees, [], 'the main checkout is not a worktree of the job');
  for (const b of ['main', 'master', 'staging', 'develop', 'trunk-default']) {
    const v = await verifiedJobContext({ featureDir: JOB, f: { worktree: WT }, recordedRepo: REPO, git: gitOf({ list: [{ path: REPO, branch: 'main' }, { path: WT, branch: b }], defaults: ['trunk-default'] }) });
    assert.deepEqual(v.branches, [], b);
    assert.deepEqual(v.worktrees, [], `a worktree with ${b} checked out is not the job's`);
  }
  // Stack parts count only when git shows them checked out in a worktree of the repository.
  const stack = { sections: [{ branch: `${BRANCH}--api` }, { branch: `${BRANCH}--ui` }, { branch: 'main' }] };
  const v = await verifiedJobContext({ featureDir: JOB, f: { worktree: WT }, recordedRepo: REPO, stack, git: gitOf({ list: [{ path: REPO, branch: 'main' }, { path: WT, branch: BRANCH }, { path: `${WT}--api`, branch: `${BRANCH}--api` }] }) });
  assert.deepEqual(v.branches, [BRANCH, `${BRANCH}--api`]);
});

test('C1: the repository is Starbase\'s record; the job\'s word only for a repository the registry knows', async () => {
  const moved = await verifiedJobContext({ featureDir: JOB, f: { ...lying, repoPath: '/Users/nobody-probe' }, recordedRepo: REPO, git: gitOf() });
  assert.equal(moved.repo, REPO, 'status.json may not move the repository');
  const terminal = await verifiedJobContext({ featureDir: JOB, f: { repoPath: '/Users/nobody-probe' }, recordedRepo: null, knownRepos: [REPO], git: gitOf() });
  assert.deepEqual(terminal, { repo: null, mainCheckout: null, worktrees: [], specDirs: [], branches: [] });
  const known = await verifiedJobContext({ featureDir: JOB, f: { repoPath: REPO, worktree: WT }, recordedRepo: null, knownRepos: [REPO], git: gitOf() });
  assert.equal(known.repo, REPO);
  assert.deepEqual(known.worktrees, [WT]);
  // The spec folder counts inside the repository (not its top), a worktree or the job folder.
  for (const [spec, want] of [[`${REPO}/docs/specs/x.md`, `${REPO}/docs/specs`], [`${WT}/docs/x.md`, `${WT}/docs`], [`${JOB}/spec.md`, JOB], [`${REPO}/spec.md`, null], ['/Users/test/Documents/x.md', null]]) {
    const v = await verifiedJobContext({ featureDir: JOB, f: { worktree: WT, spec: { path: spec } }, recordedRepo: REPO, git: gitOf() });
    assert.deepEqual(v.specDirs, [`${REPO}/docs/plans`, ...(want ? [want] : [])], spec);
  }
});

test('C1: /, the home folder, a folder above it, the state folder and ~/.claude are never a job root', () => {
  for (const root of ['/', HOME, '/Users', STATE, `${HOME}/.claude`]) {
    const ctx = ctxOf({ worktrees: [root], specDirs: [root], branches: [BRANCH] }, { featureDir: root === STATE ? JOB : JOB });
    assert.equal(card('Write', { file_path: `${HOME}/.zshrc`, content: 'x' }, ctx), 'outside', root);
    assert.equal(bash(`touch ${HOME}/Documents/x`, ctx), 'outside', root);
    assert.equal(bash(`rm -rf ${HOME}/Documents`, ctx), 'outside', root);
    assert.equal(goAheadCovers('Bash', { command: `rm -rf ${HOME}/Documents` }, { mode: 'auto', stage: 'implement', worktrees: [root], featureDir: JOB, cwd: WT }), null, root);
    assert.equal(approverRoots({ featureDir: JOB, worktrees: [root], specDirs: [] }).includes(root), false, root);
  }
});

