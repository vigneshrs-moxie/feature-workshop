// Nov 17: the Auto-mode stops that held up a real Auto job (an L1 run by the skills), each fixed with its controls. The
// layout is the owner's, on disk in a temp folder, as in auto-walk.test.js: the job folder under ~/.claude/feature-work,
// the main checkout and the worktree under ~/Projects. No git is run and no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-nov17-')));
const HOME = path.join(ROOT, 'Users', 'test');
process.env.HOME = HOME; // before the modules below read it
const { autoVerdict, OUTSIDE_REASONS } = await import('../lib/auto-rules.js');
const { hardLine } = await import('../lib/hard-lines.js');
const { REFUSE_REASONS, refuseNote, refuseReason } = await import('../lib/auto.js');

const JOB = `${HOME}/.claude/feature-work/orbit-500-thing`;
const SKILLS = `${HOME}/.claude/skills`;
const AGENTS = `${HOME}/.claude/agents`;
const M = `${HOME}/Projects/orbit`;
const W = `${HOME}/Projects/orbit-orbit-500-thing`;
const A = `${W}/app`;
const B = 'feature/orbit-500-thing';
const SHA = 'a'.repeat(40);
const LATER = 'b'.repeat(40);
const FORK = 'git@github.com:test/orbit.git';
const ORG = 'git@github.com:moxie-org/orbit.git';

const put = (p, text = 'x\n') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const link = (to, at) => { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(to, at); };
for (const f of ['options.json', 'status.json', 'decisions.md', 'workflow-status.md', 'implementation-plan.md']) put(`${JOB}/${f}`);
fs.mkdirSync(SKILLS, { recursive: true });
fs.mkdirSync(AGENTS, { recursive: true });
for (const f of ['CLAUDE.md', 'app/package.json', 'app/src/lib/auth.ts', 'docs/plans/.keep']) put(`${M}/${f}`);
for (const f of ['AGENTS.md', 'app/src/lib/x.ts']) put(`${W}/${f}`);
put(`${W}/.git`, `gitdir: ${M}/.git/worktrees/orbit-orbit-500-thing\n`);
fs.mkdirSync(`${M}/.git`, { recursive: true });
put(`${A}/package.json`, JSON.stringify({ name: 'app', scripts: { build: 'next build', lint: 'eslint', typecheck: 'tsc --noEmit', test: 'vitest run', check: 'npm run typecheck && npm run lint && npm run test' } }));
for (const [bin, file] of [['next', 'next/dist/bin/next'], ['eslint', 'eslint/bin/eslint.js'], ['tsc', 'typescript/bin/tsc'], ['vitest', 'vitest/vitest.mjs']]) {
  put(`${A}/node_modules/${file}`, '#!/usr/bin/env node\n');
  link(`../${file}`, `${A}/node_modules/.bin/${bin}`);
}
put(`${HOME}/Projects/other/notes.md`);
// A clone inside the worktree: its remotes are not the job's.
put(`${W}/vendor/lib/.git/HEAD`, 'ref: refs/heads/main\n');

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const ctxOf = (cwd, over = {}) => ({
  worktrees: [W], featureDir: JOB, specDirs: [`${M}/docs/plans`], cwd, forkRemote: 'origin',
  remoteUrl: (name) => ({ '': FORK, origin: FORK, moxie: ORG }[name ?? ''] ?? null), currentBranch: cwd === M ? 'main' : B, branches: [B],
  stateDir: `${HOME}/.starbase`, apiPort: 4477, mainCheckout: M, readRoots: [SKILLS, AGENTS], orgRemote: 'moxie', orgRepo: 'moxie-org/orbit', orgShas: { [SHA]: true, [LATER]: false },
  filesToCopy: [], setup: { worktrees: [W], taken: ['main', B], never: ['main'], starts: ['moxie/main'], worktreeBranches: { [W]: B } },
  tempDirs: [], // the whole layout sits in a temp folder; on the laptop it does not
  ...over,
});
const verdict = (command, ctx) => autoVerdict({ kind: 'card', toolName: 'Bash', input: { command }, hardLine: hardLine('Bash', { command }, { cwd: ctx.cwd, stateDir: ctx.stateDir }), blockedPath: null }, ctx);
const answer = (command, ctx) => {
  const h = hardLine('Bash', { command }, { cwd: ctx.cwd, stateDir: ctx.stateDir });
  if (h?.decision === 'deny') return 'refused';
  const v = verdict(command, ctx);
  return v === null ? 'pass' : v.verdict === 'ask' ? 'ask' : `stop:${v.rule}`;
};
const at = (where) => ({ M, W, A, JOB }[where]);
// rows: [where the command runs (M, W, A or JOB), command, want ('pass' | 'not pass' | an answer)]
const table = (rows, over = {}) => {
  const wrong = [];
  for (const [where, command, want] of rows) {
    const got = answer(command, ctxOf(at(where), over));
    if (want === 'not pass' ? got === 'pass' : got !== want) wrong.push({ where, command: command.split(HOME).join('~'), want, got });
  }
  assert.deepEqual(wrong, []);
};

// ---------- 2: git fetch and git ls-remote against the job's own repository's remotes ----------

test('Nov 17 (2): git fetch and git ls-remote against the job\'s remotes pass from the main checkout and from the worktree', () => {
  const reads = [
    'git fetch moxie --prune', 'git fetch moxie', 'git fetch origin', 'git fetch -p moxie', 'git fetch --prune moxie', 'git fetch --all --prune', 'git fetch moxie main', 'git fetch --quiet moxie main',
    'git ls-remote moxie refs/heads/main', `git ls-remote --heads origin ${B}`, `git ls-remote --heads moxie ${B}`, 'git ls-remote moxie', 'git ls-remote --heads moxie', `git ls-remote --exit-code --heads origin ${B}`, 'git ls-remote --heads moxie "feature/*"',
    'git fetch moxie --prune && git ls-remote moxie refs/heads/main', 'git fetch moxie --prune && git rev-parse moxie/main', `git ls-remote --heads origin ${B} && git ls-remote moxie refs/heads/main`,
  ];
  const rows = [];
  for (const c of reads) {
    rows.push(['M', c, 'pass'], ['W', c, 'pass'], ['A', c, 'pass']);
    const sub = c.replace(/^git /, '').replace(/ && git /g, ` && git -C ${M} `);
    rows.push(['JOB', `git -C ${M} ${sub}`, 'pass']);
    rows.push(['M', `git -C ${W} ${c.replace(/^git /, '').replace(/ && git /g, ` && git -C ${W} `)}`, 'pass']);
    rows.push(['M', `cd ${W} && ${c}`, 'pass']);
  }
  table(rows);
});

test('Nov 17 (2): what stays as it was: addresses, refspecs that write, options that run a program, other folders and other git commands', () => {
  const notPass = [
    'git fetch https://github.com/someone/orbit.git', 'git fetch git@github.com:someone/orbit.git main', 'git fetch ../elsewhere', `git fetch ${HOME}/Projects/other`,
    'git ls-remote https://github.com/someone/orbit.git', 'git ls-remote git@github.com:someone/orbit.git', 'git ls-remote ../elsewhere',
    'git fetch moxie main:main', 'git fetch moxie +main:main', 'git fetch moxie refs/heads/main:refs/remotes/moxie/main', 'git fetch moxie "+refs/heads/*:refs/remotes/moxie/*"',
    'git fetch --upload-pack=/tmp/x moxie', 'git fetch --upload-pack /tmp/x moxie', 'git ls-remote --upload-pack=/tmp/x moxie', 'git fetch --exec=/tmp/x moxie',
    'git -c core.sshCommand=/tmp/x fetch moxie', 'git -c protocol.ext.allow=always fetch moxie', 'git -c credential.helper=/tmp/x ls-remote moxie',
    'git fetch moxie $BRANCH', 'git fetch $REMOTE',
    'GIT_SSH_COMMAND=/tmp/x git fetch moxie', 'git --git-dir=/tmp/x/.git fetch moxie',
  ];
  const rows = [];
  for (const c of notPass) rows.push(['M', c, 'not pass'], ['W', c, 'not pass']);
  // A remote git does not name in the repository, from the main checkout (in the worktree any fetch was already the job's).
  for (const c of ['git fetch evil', 'git ls-remote evil refs/heads/main']) rows.push(['M', c, 'not pass'], ['JOB', `git -C ${M} ${c.slice(4)}`, 'not pass']);
  // From a folder that is not the job's repository, or a clone inside the worktree.
  for (const c of ['git fetch moxie --prune', 'git ls-remote moxie refs/heads/main']) {
    rows.push(['M', `git -C ${HOME}/Projects/other ${c.slice(4)}`, 'not pass'], ['M', `cd ${HOME}/Projects/other && ${c}`, 'not pass'], ['W', `git -C ${HOME}/Projects/other ${c.slice(4)}`, 'not pass']);
  }
  // The main checkout's own state is still the person's: pushes, resets, checkouts and branch changes there stop as before.
  for (const c of ['git push moxie main', 'git push origin main', 'git reset --hard moxie/main', 'git checkout -b x', 'git checkout main', 'git branch -D x', 'git merge moxie/main', 'git pull moxie main', 'git fetch moxie main:main']) rows.push(['M', c, 'not pass']);
  table(rows);
  // And the ones that are not reads in the worktree are judged there as before (a sample).
  assert.equal(answer('git push moxie HEAD', ctxOf(W)), 'refused');
});

// ---------- 3: the org-branch call, from a commit the org's main has, and from one it does not have yet ----------

test('Nov 17 (3): the org-branch call goes to the Approver once its commit is on the org\'s main, from the main checkout and the worktree', () => {
  const call = (sha) => `gh api -X POST repos/moxie-org/orbit/git/refs -f ref=refs/heads/${B} -f sha=${sha}`;
  for (const where of ['M', 'W']) {
    const v = verdict(call(SHA), ctxOf(at(where)));
    assert.equal(v?.verdict, 'ask', where);
    assert.match(v.why, /the workflow's org branch step/);
  }
});

test('Nov 17 (3): a commit not on the org\'s main as git knows it is refused, and it says to fetch the org\'s main first', () => {
  const call = (sha) => `gh api -X POST repos/moxie-org/orbit/git/refs -f ref=refs/heads/${B} -f sha=${sha}`;
  for (const where of ['M', 'W']) {
    for (const shas of [{ [LATER]: false }, { [LATER]: null }, {}]) {
      const v = verdict(call(LATER), ctxOf(at(where), { orgShas: shas }));
      assert.deepEqual({ verdict: v?.verdict, rule: v?.rule, reason: v?.reason }, { verdict: 'stop', rule: 'outside', reason: OUTSIDE_REASONS.orgMain }, `${where} ${JSON.stringify(shas)}`);
    }
  }
  assert.match(OUTSIDE_REASONS.orgMain, /fetch the org's main first/);
  // The crew's words: the same advice, and not "don't try it another way".
  const why = refuseReason({ rule: 'outside', outside: 'orgMain' });
  assert.equal(why, REFUSE_REASONS['outside-orgMain']);
  assert.match(why, /fetch the org's main first/);
  const note = refuseNote('outside', why);
  assert.match(note, /^Auto refused this: .*fetch the org's main first/);
  assert.equal(/Don't try the same thing another way/.test(note), false);
  // Any other gh api write to the org repository keeps the plain outside refusal.
  for (const c of [`gh api -X POST repos/moxie-org/orbit/git/refs -f ref=refs/heads/main -f sha=${LATER}`, `gh api -X PATCH repos/moxie-org/orbit/git/refs/heads/${B} -f sha=${SHA}`, `gh api -X POST repos/moxie-org/other/git/refs -f ref=refs/heads/${B} -f sha=${LATER}`]) {
    assert.ok(['refused', 'stop:outside', 'stop:merge'].includes(answer(c, ctxOf(M))), c);
    assert.notEqual(verdict(c, ctxOf(M))?.reason, OUTSIDE_REASONS.orgMain, c);
  }
});

// ---------- 4: BSD sed -i '' (and -i.bak, --in-place) ----------

test('Nov 17 (4): sed in place on the job\'s own file, in every spelling of its backup suffix, passes from the main checkout and the worktree', () => {
  const file = `${JOB}/decisions.md`;
  const forms = [
    `sed -i '' 's/Status: open/Status: done/' ${file}`,
    `sed -i '' 's/Status: open/Status: done/' ${file} && grep -c 'Status: done' ${file}`,
    `sed -i '' -e 's/a/b/' ${file}`,
    `sed -i '' -e 's/a/b/' -e 's/c/d/' ${file}`,
    `sed -i.bak 's/a/b/' ${file}`,
    `sed -i .bak 's/a/b/' ${file}`,
    `sed -E -i '' 's/a+/b/' ${file}`,
    `sed -Ei '' 's/a+/b/' ${file}`,
    `sed --in-place 's/a/b/' ${file}`,
    `sed --in-place=.bak 's/a/b/' ${file}`,
    `sed -i '' 's/a/b/' ${file} ${JOB}/workflow-status.md`,
    `sed -n '1,20p' ${file}`,
  ];
  const rows = [];
  for (const c of forms) for (const where of ['M', 'W', 'JOB']) rows.push([where, c, 'pass']);
  // In the worktree too, by a relative path.
  rows.push(['W', "sed -i '' 's/a/b/' app/src/lib/x.ts", 'pass'], ['A', "sed -i.bak 's/a/b/' src/lib/x.ts", 'pass']);
  table(rows);
});

test('Nov 17 (4): sed in place on a real file outside the job stays refused, in every spelling', () => {
  const out = `${HOME}/Projects/other/notes.md`;
  const rows = [];
  for (const c of [
    `sed -i '' 's/a/b/' ${out}`, `sed -i.bak 's/a/b/' ${out}`, `sed -i '' -e 's/a/b/' ${out}`, `sed --in-place 's/a/b/' ${out}`, `sed -Ei '' 's/a/b/' ${out}`,
    `sed -i '' 's/a/b/' ${JOB}/decisions.md ${out}`, `sed -i '' 's/a/b/' ${M}/CLAUDE.md`,
    // A backup that lands elsewhere, or a w command that writes outside.
    `sed -i '../../../x' 's/a/b/' ${JOB}/decisions.md`, `sed -i '' 's/a/b/w ${out}' ${JOB}/decisions.md`,
    // Starbase's own record in the job folder.
    `sed -i '' 's/a/b/' ${JOB}/options.json`,
  ]) for (const where of ['M', 'W']) rows.push([where, c, 'stop:outside']);
  rows.push(['M', "sed -i '' 's/a/b/' CLAUDE.md", 'stop:outside'], ['W', "sed -i '' 's/a/b/' ../orbit/CLAUDE.md", 'stop:outside']);
  table(rows);
});

test('Nov 17 (4): sed -i\'\' (no space) is -i on its own: judged as a Mac\'s sed reads it and as a GNU sed would, so only the job\'s file may be touched', () => {
  // The shell turns -i'' into -i. macOS's sed then takes the script as the backup's suffix (and fails); a GNU sed earlier on
  // the PATH edits the file. Either way only the job's file is touched: it passes. Its GNU spelling (-i 's/…/' file) too.
  for (const where of ['M', 'W']) {
    assert.equal(answer(`sed -i'' 's/a/b/' ${JOB}/decisions.md`, ctxOf(at(where))), 'pass', where);
    assert.equal(answer(`sed -i 's/a/b/' ${JOB}/decisions.md`, ctxOf(at(where))), 'pass', where);
    // And a file outside is refused by both readings.
    assert.equal(answer(`sed -i'' 's/a/b/' ${HOME}/Projects/other/notes.md`, ctxOf(at(where))), 'stop:outside', where);
    assert.equal(answer(`sed -i 's/a/b/w ${HOME}/Projects/other/x' ${JOB}/decisions.md`, ctxOf(at(where))), 'stop:outside', where);
    // A GNU backup suffix with a * can put the backup in another folder.
    assert.equal(answer(`sed -i'bak/*' 's/a/b/' ${JOB}/decisions.md`, ctxOf(at(where))), 'stop:outside', where);
  }
  // gsed is GNU sed everywhere: -i takes no word of its own (Starbase's plain reading does not know gsed: it asks).
  assert.equal(answer(`gsed -i 's/a/b/' ${JOB}/decisions.md`, ctxOf(M)), 'ask');
  assert.equal(answer(`gsed -i 's/a/b/' ${HOME}/Projects/other/notes.md`, ctxOf(M)), 'stop:outside');
});
