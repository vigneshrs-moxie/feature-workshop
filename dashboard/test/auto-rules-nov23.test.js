// Nov 23: what kept two Auto jobs (ORBIT-526, ORBIT-518) from starting their builds, and the other refusals on the way to
// PR #1, each with its controls. The commands are the ones the Foremen wrote. The layout is the owner's, on disk in a temp
// folder, as in auto-rules-nov17.test.js. No git is run and no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-nov23-')));
const HOME = path.join(ROOT, 'Users', 'test');
process.env.HOME = HOME; // before the modules below read it
const { autoVerdict, OUTSIDE_REASONS } = await import('../lib/auto-rules.js');
const { hardLine } = await import('../lib/hard-lines.js');
const { REFUSE_REASONS, refuseNote, refuseReason } = await import('../lib/auto.js');
const { slugWorktreeOf, verifiedJobContext } = await import('../lib/auto-context.js');

const SLUG = 'orbit-500-thing';
const FEATURES = `${HOME}/.claude/feature-work`;
const JOB = `${FEATURES}/${SLUG}`;
const SKILLS = `${HOME}/.claude/skills`;
const AGENTS = `${HOME}/.claude/agents`;
const WIREFRAMES = `${HOME}/.claude/wireframes`;
const RESULTS = `${HOME}/.claude/projects/-Users-test-Projects-orbit/s1/tool-results`;
const M = `${HOME}/Projects/orbit`;
const P = `${HOME}/Projects/orbit-${SLUG}`; // the profile's place: ../orbit-{slug}
const W = `${HOME}/Projects/${SLUG}`; // what the Foreman writes: the slug starts with the ticket's own orbit-
const B = `feature/${SLUG}`;
const SHA = 'a'.repeat(40);
const LATER = 'b'.repeat(40);
const FORK = 'git@github.com:test/orbit.git';
const ORG = 'git@github.com:moxie-org/orbit.git';

const put = (p, text = 'x\n') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
for (const f of ['options.json', 'status.json', 'decisions.md']) put(`${JOB}/${f}`);
for (const d of [SKILLS, AGENTS, `${M}/.git`, `${M}/app`, `${M}/docs/plans`]) fs.mkdirSync(d, { recursive: true });
put(`${M}/app/.env.local`);
put(`${RESULTS}/b1.txt`);
put(`${WIREFRAMES}/a.html`);
put(`${FEATURES}/orbit-471-other/spec.md`);
put(`${HOME}/.claude/projects/-Users-test-Projects-orbit/other.jsonl`);
put(`${HOME}/.claude/.credentials.json`);
put(`${HOME}/.claude/settings.json`);
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

/** Before the worktree exists: nothing of the job's but its folder and the two places it may make its worktree. */
const ctxOf = (cwd, over = {}) => ({
  worktrees: [P], featureDir: JOB, specDirs: [`${M}/docs/plans`], cwd, forkRemote: 'origin',
  remoteUrl: (name) => ({ '': FORK, origin: FORK, moxie: ORG }[name ?? ''] ?? null), currentBranch: cwd === M ? 'main' : null, branches: [],
  stateDir: `${HOME}/.starbase`, apiPort: 4477, mainCheckout: M, readRoots: [SKILLS, AGENTS], lookRoots: [RESULTS, WIREFRAMES], askRoots: [FEATURES],
  orgRemote: 'moxie', orgRepo: 'moxie-org/orbit', orgShas: { [SHA]: true, [LATER]: false },
  filesToCopy: [], setup: { worktrees: [P, W], taken: ['main', 'feature/taken'], never: ['main'], starts: ['moxie/main'], worktreeBranches: {} },
  tempDirs: [],
  ...over,
});
const made = { worktrees: [W], branches: [B], setup: { worktrees: [P, W], taken: ['main', B], never: ['main'], starts: ['moxie/main'], worktreeBranches: { [W]: B } } };
const verdict = (command, ctx) => autoVerdict({ kind: 'card', toolName: 'Bash', input: { command }, hardLine: hardLine('Bash', { command }, { cwd: ctx.cwd, stateDir: ctx.stateDir }), blockedPath: null }, ctx);
const answer = (command, ctx) => {
  if (hardLine('Bash', { command }, { cwd: ctx.cwd, stateDir: ctx.stateDir })?.decision === 'deny') return 'refused';
  const v = verdict(command, ctx);
  return v === null ? 'pass' : v.verdict === 'ask' ? 'ask' : `stop:${v.rule}`;
};
const table = (rows, over = {}) => {
  const wrong = rows.map(([where, command, want]) => ({ command: command.split(HOME).join('~'), want, got: answer(command, ctxOf(where, over)) })).filter((r) => r.got !== r.want);
  assert.deepEqual(wrong, []);
};

// ---------- 1: the job's worktree ----------

test('Nov 23 (1): the job\'s worktree may be made where its slug names it, from the org\'s main or a commit on it, from any folder', () => {
  const rows = [];
  for (const where of [M, JOB]) {
    for (const place of [W, P]) {
      for (const start of ['moxie/main', SHA]) {
        for (const opts of [`-b ${B}`, `--no-track -b ${B}`, `-b ${B} --no-track`, `--quiet -b ${B}`]) rows.push([where, `git -C ${M} worktree add ${opts} ${place} ${start}`, 'pass']);
      }
    }
    rows.push([where, `cd ${M} && git worktree add -b ${B} ${W} moxie/main`, 'pass']);
    rows.push([where, `cd ${M} && git fetch moxie --prune && git worktree add -b ${B} ../${SLUG} moxie/main`, 'pass']);
    rows.push([where, `git -C ${M} worktree add -b ${B} ${W} moxie/main 2>&1 | tail -3`, 'pass']);
    rows.push([where, `git -C ${M} fetch moxie --prune 2>&1 | tail -n 3 && git -C ${M} worktree add -b ${B} ${W} moxie/main`, 'pass']);
  }
  table(rows);
});

test('Nov 23 (1): every other worktree is refused as before', () => {
  const add = (rest) => `git -C ${M} worktree add ${rest}`;
  const rows = [
    add(`-b main ${W} moxie/main`), add(`-b staging ${W} moxie/main`), add(`-b feature/taken ${W} moxie/main`), add(`-b moxie/x ${W} moxie/main`),
    add(`-B ${B} ${W} moxie/main`), add(`-f -b ${B} ${W} moxie/main`), add(`--force -b ${B} ${W} moxie/main`), add(`--orphan -b ${B} ${W}`), add(`--detach ${W} moxie/main`), add(`${W} moxie/main`),
    add(`-b ${B} ${HOME}/Projects/orbit-471-other moxie/main`), add(`-b ${B} ${HOME}/elsewhere moxie/main`), add(`-b ${B} ${M} moxie/main`), add(`-b ${B} ${HOME} moxie/main`),
    add(`-b ${B} ${W} ${LATER}`), add(`-b ${B} ${W} ${'c'.repeat(40)}`), add(`-b ${B} ${W} moxie/staging`), add(`-b ${B} ${W} HEAD`), add(`-b ${B} ${W}`), add(`-b $X ${W} moxie/main`),
    `git -C ${HOME}/Projects/other worktree add -b ${B} ${W} moxie/main`,
    add(`-b ${B} ${W} moxie/main > ${HOME}/out.txt`), add(`-b ${B} ${W} moxie/main && rm -r ${HOME}/Projects/orbit-471-other`), add(`-b ${B} ${W} moxie/main | sh`), add(`-b ${B} ${W} moxie/main | tee ${HOME}/x`),
    `git -C ${M} worktree remove ${W}`, `git -C ${M} worktree prune`,
  ];
  const passed = rows.filter((c) => answer(c, ctxOf(M)) === 'pass' || answer(c, ctxOf(M)) === 'ask');
  assert.deepEqual(passed, []);
});

test('Nov 23 (1): a worktree refused for how it is made says the form that works, and not "don\'t try it another way"', () => {
  const v = verdict(`git -C ${M} worktree add -b ${B} ${W} ${LATER}`, ctxOf(M));
  assert.equal(v?.reason, OUTSIDE_REASONS.worktree);
  const why = refuseReason({ rule: 'outside', outside: 'worktree' });
  assert.equal(why, REFUSE_REASONS['outside-worktree']);
  const note = refuseNote('outside', why);
  assert.match(note, /git -C <main checkout> worktree add -b <branch> \.\.\/<job's slug> <org remote>\/main/);
  assert.equal(/Don't try the same thing another way/.test(note), false);
  // Something else on the line that is refused keeps the plain refusal.
  assert.notEqual(verdict(`git -C ${M} worktree add -b ${B} ${W} moxie/main && rm ${HOME}/Projects/orbit-471-other/x`, ctxOf(M))?.reason, OUTSIDE_REASONS.worktree);
});

test('Nov 23 (1): the slug\'s place is next to the repository, never the repository, the profile\'s place or another job\'s', () => {
  assert.equal(slugWorktreeOf({ repo: M, slug: SLUG, profileWorktree: P, otherWorktrees: [] }), W);
  assert.equal(slugWorktreeOf({ repo: M, slug: SLUG, profileWorktree: W, otherWorktrees: [] }), null, 'the profile\'s own');
  assert.equal(slugWorktreeOf({ repo: M, slug: SLUG, profileWorktree: P, otherWorktrees: [W] }), null, 'another job\'s');
  assert.equal(slugWorktreeOf({ repo: M, slug: 'orbit', profileWorktree: P, otherWorktrees: [] }), null, 'the repository itself');
  for (const slug of ['', '.', '..', '../x', 'a/b', null]) assert.equal(slugWorktreeOf({ repo: M, slug, profileWorktree: P, otherWorktrees: [] }), null, String(slug));
});

test('Nov 23 (1): once git lists it, the worktree at the slug\'s place is the job\'s, with its branch, before status.json names it', async () => {
  const job = (list) => verifiedJobContext({ featureDir: JOB, slug: SLUG, f: null, recordedRepo: M, profileWorktree: P, slugWorktree: W, git: { worktrees: async () => list, defaultBranch: async () => ['main'] } });
  const main = { path: M, branch: 'main' };
  fs.mkdirSync(W, { recursive: true });
  try {
    const now = await job([main, { path: W, branch: B }]);
    assert.deepEqual([now.worktrees, now.branches], [[W], [B]], 'the profile\'s empty place is dropped once the job has its worktree');
    const never = await job([main, { path: W, branch: 'main' }]);
    assert.equal(never.worktrees.includes(W), false, 'not with main checked out');
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
  const before = await job([main]);
  assert.deepEqual([before.worktrees, before.branches], [[P], []], 'nothing there yet: as before');
});

// ---------- 2: the matching org branch ----------

const org = (more = '', { branch = B, sha = SHA } = {}) => `gh api -X POST repos/moxie-org/orbit/git/refs -f ref=refs/heads/${branch} -f sha=${sha}${more}`;

test('Nov 23 (2): the org-branch call may pick what it prints, and may come before the worktree is there', () => {
  for (const more of ['', ' --jq .ref', " --jq '.ref + \" \" + .object.sha'", ' -q .ref', ' --silent']) {
    for (const where of [M, JOB, W]) assert.equal(answer(org(more), ctxOf(where, made)), 'ask', more);
    assert.equal(answer(org(more), ctxOf(M)), 'ask', `before the worktree${more}`);
  }
  assert.match(verdict(org(' --jq .ref'), ctxOf(M)).why, /the workflow's org branch step/);
});

test('Nov 23 (2): any other branch, field or option is refused as before', () => {
  const rows = [
    org('', { branch: 'main' }), org('', { branch: 'staging' }), org('', { branch: 'feature/orbit-471-other' }), org('', { branch: `${SLUG}` }), org('', { branch: `hotfix/${SLUG}` }),
    org(' -f force=true'), org(' --input x.json'), org(' -H "X: y"'), org(' --hostname evil.example'), org('', { sha: LATER }), org('', { sha: 'main' }),
    org(' --jq $(id)'), org(` > ${HOME}/x`),
    `gh api -X PATCH repos/moxie-org/orbit/git/refs/heads/${B} -f sha=${SHA}`, `gh api -X POST repos/moxie-org/other/git/refs -f ref=refs/heads/${B} -f sha=${SHA}`,
  ];
  for (const c of rows) for (const over of [{}, made]) assert.ok(/^(stop:|refused)/.test(answer(c, ctxOf(M, over))), `${answer(c, ctxOf(M, over))}: ${c}`);
  // With the job's worktree there, its branch is the one git shows and no other.
  const other = { ...made, branches: ['feature/other-name'] };
  assert.ok(/^(stop:|refused)/.test(answer(org(), ctxOf(M, other))));
});

// ---------- 3: reads that were refused ----------

test('Nov 23 (3): listing branches, in any order of its words, is a read', () => {
  const rows = [];
  for (const c of ['branch -a --list "*526*" "*employees*"', 'branch --list -a "*526*"', 'branch -a', 'branch --list', 'branch -r --list "moxie/*"']) rows.push([M, `git ${c}`, 'pass'], [JOB, `git -C ${M} ${c}`, 'pass']);
  for (const c of ['branch x', 'branch -D x', 'branch -a -D x', 'branch --list -m x', 'branch -f x moxie/main']) rows.push([M, `git ${c}`, 'stop:outside']);
  table(rows);
});

test('Nov 23 (3): the session\'s own saved outputs and the wireframes folder are read, other jobs\' folders are a question; the rest of ~/.claude stays secret', () => {
  table([
    [M, `cat ${RESULTS}/b1.txt | tail -n +12`, 'pass'], [JOB, `ls ${WIREFRAMES}/ ${JOB}`, 'pass'],
    [M, `ls ${FEATURES} ${FEATURES}/orbit-471-other`, 'ask'], [M, `cat ${FEATURES}/orbit-471-other/spec.md`, 'ask'],
    [M, `cat ${HOME}/.claude/.credentials.json`, 'stop:outside'], [M, `cat ${HOME}/.claude/settings.json`, 'stop:outside'], [M, `ls ${HOME}/.claude`, 'stop:outside'],
    [M, `cat ${HOME}/.claude/projects/-Users-test-Projects-orbit/other.jsonl`, 'stop:outside'], [M, `grep -r token ${HOME}/.claude/projects`, 'stop:outside'],
    [M, `cat ${M}/app/.env.local`, 'stop:outside'], [M, `cat ${WIREFRAMES}/.env`, 'stop:outside'], [M, `cat ${FEATURES}/orbit-471-other/.env`, 'stop:outside'],
    // Read, never changed.
    [M, `echo x > ${FEATURES}/orbit-471-other/spec.md`, 'stop:outside'], [M, `rm ${WIREFRAMES}/a.html`, 'stop:outside'], [M, `cp ${JOB}/decisions.md ${FEATURES}/orbit-471-other/`, 'stop:outside'],
    [M, `python3 ${FEATURES}/orbit-471-other/x.py`, 'stop:outside'],
  ]);
});

// ---------- 4: what the rest of the way to PR #1 runs ----------

test('Nov 23 (4): with the worktree made, install, checks, commit and push pass', () => {
  put(`${W}/.git`, `gitdir: ${M}/.git/worktrees/${SLUG}\n`);
  put(`${W}/app/package.json`, JSON.stringify({ name: 'app', scripts: { build: 'next build', check: 'tsc --noEmit' } }));
  try {
    table([
      [M, `cd ${W}/app && npm ci > ${JOB}/npm-ci.log 2>&1`, 'pass'], [M, `npm ci --prefix ${W}/app`, 'pass'], [M, `git -C ${W} add -A && git -C ${W} commit -m "feat: x"`, 'pass'],
      [M, `sed -i '' 's/a/b/' ${JOB}/decisions.md`, 'pass'],
    ], made);
    // Elsewhere, the same commands are not the job's.
    table([[M, `cd ${M}/app && npm ci`, 'stop:outside'], [M, `git -C ${M} commit -am x`, 'stop:outside']], made);
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});
