// The walk (deep review A, second re-check, section 3): an ordinary Orbit job from its first step to PR #1, each line as
// the skills spell it, from the session's folder (the repository's main checkout). Every row passes but six that ask
// (rows 6, 9, 12, 14, 18 and 24); no row stops. The layout is the owner's, on disk in a temp folder: the job folder under
// ~/.claude/feature-work, skills installed as links into a checkout, the handbook a link into ~/Projects, the app's
// packages installed in the worktree. No git is run and no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-walk-')));
const HOME = path.join(ROOT, 'Users', 'test');
process.env.HOME = HOME; // before the modules below read it
const { autoVerdict } = await import('../lib/auto-rules.js');
const { hardLine } = await import('../lib/hard-lines.js');

const JOB = `${HOME}/.claude/feature-work/orbit-500-thing`;
const SKILLS = `${HOME}/.claude/skills`;
const AGENTS = `${HOME}/.claude/agents`;
const M = `${HOME}/Projects/orbit`;
const W = `${HOME}/Projects/orbit-orbit-500-thing`;
const A = `${W}/app`;
const B = 'feature/orbit-500-thing';
const SHA = 'a'.repeat(40);
const FORK = 'git@github.com:test/orbit.git';
const ORG = 'git@github.com:moxie-org/orbit.git';

const put = (p, text = 'x\n') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const link = (to, at) => { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(to, at); };
// The skills: a checkout of the workflow's skills, each installed as a link (N9).
for (const [skill, files] of Object.entries({ feature: ['SKILL.md', 'job-options.md', 'brief.md'], 'feature-spec': ['workflow-gates.md'], 'workflow-common': ['status-json.md', 'lock.md', 'git-workflow.md', 'worker-rules.md', 'checklists/all.md', 'review-lens-rules.md'], wireframe: ['SKILL.md', 'build.py'], ship: ['pr-body.md'] })) {
  for (const f of files) put(`${HOME}/Projects/workflow-skills/skills/${skill}/${f}`, f.endsWith('.py') ? 'import json, sys\nprint(json.dumps({}))\n' : '# x\n');
  link(`${HOME}/Projects/workflow-skills/skills/${skill}`, `${SKILLS}/${skill}`);
}
put(`${AGENTS}/feature-implementer.md`);
put(`${HOME}/Projects/orbit-design-work/ops-handbook.md`);
link(`${HOME}/Projects/orbit-design-work/ops-handbook.md`, `${HOME}/.claude/ops-handbook.md`);
put(`${HOME}/Projects/moxie-portal-git-workflow/docs/engineering/git-workflow/agent-rules.md`);
for (const f of ['options.json', 'lock.json', 'workflow-status.md', 'status.json', 'decisions.md', 'briefs/001-quick-plan.md', 'implementation-plan.md', 'implementation-log.md', 'check.log', 'pr1-body.md']) put(`${JOB}/${f}`);
for (const f of ['CLAUDE.md', 'app/src/lib/auth.ts', 'app/package.json', 'app/prisma/schema.prisma', 'docs/plans/.keep']) put(`${M}/${f}`);
for (const f of ['AGENTS.md', 'app/src/lib/x.ts', 'app/src/components/TicketRow.tsx']) put(`${W}/${f}`);
put(`${A}/package.json`, JSON.stringify({ name: 'app', scripts: {
  dev: 'next dev --turbopack', build: 'next build', start: 'next start', lint: 'eslint', typecheck: 'tsc --noEmit', test: 'vitest run',
  check: 'npm run typecheck && npm run lint && npm run test', 'db:migrate': 'tsx prisma/apply-migration.ts', postinstall: 'prisma generate', prepare: 'cd .. && husky app/.husky',
} }));
for (const [bin, file] of [['next', 'next/dist/bin/next'], ['eslint', 'eslint/bin/eslint.js'], ['tsc', 'typescript/bin/tsc'], ['vitest', 'vitest/vitest.mjs'], ['tsx', 'tsx/dist/cli.mjs'], ['prisma', 'prisma/build/index.js'], ['husky', 'husky/bin.js']]) {
  put(`${A}/node_modules/${file}`, '#!/usr/bin/env node\n');
  link(`../${file}`, `${A}/node_modules/.bin/${bin}`);
}

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const ctxOf = (phase, over = {}) => ({
  worktrees: phase === 'pre' ? [] : [W], featureDir: JOB, specDirs: [`${M}/docs/plans`], cwd: M, forkRemote: 'origin',
  remoteUrl: (name) => ({ '': FORK, origin: FORK, moxie: ORG }[name ?? ''] ?? null), currentBranch: 'main', branches: phase === 'pre' ? [] : [B],
  stateDir: `${HOME}/.starbase`, apiPort: 4477, mainCheckout: M, readRoots: [SKILLS, AGENTS], orgRemote: 'moxie', orgRepo: 'moxie-org/orbit', orgShas: { [SHA]: true },
  filesToCopy: [{ from: 'app/.env.local', to: 'app/.env.local' }],
  setup: { worktrees: [W], taken: ['main'], never: ['main'], starts: ['moxie/main'], worktreeBranches: phase === 'pre' ? {} : { [W]: B } },
  tempDirs: [], // the whole layout sits in a temp folder; on the laptop it does not
  ...over,
});
const answer = (toolName, input, ctx) => {
  const h = hardLine(toolName, input, { cwd: ctx.cwd, stateDir: ctx.stateDir });
  if (h?.decision === 'deny') return 'refused';
  const v = autoVerdict({ kind: 'card', toolName, input, hardLine: h, blockedPath: null }, ctx);
  return v === null ? 'pass' : v.verdict === 'ask' ? 'ask' : `stop:${v.rule}`;
};
const sh = (command) => ['Bash', { command }];

// [row, phase, want, calls]
const WALK = [
  [1, 'pre', 'pass', [['Skill', { skill: 'feature', args: 'ORBIT-500 add the thing' }], ...['feature-spec/workflow-gates.md', 'feature/job-options.md', 'feature/brief.md', 'workflow-common/status-json.md', 'workflow-common/lock.md'].map((f) => ['Read', { file_path: `${SKILLS}/${f}` }])]],
  [2, 'pre', 'pass', ['options.json', 'lock.json', 'workflow-status.md', 'briefs/001-quick-plan.md'].map((f) => ['Read', { file_path: `${JOB}/${f}` }])],
  [3, 'pre', 'pass', [sh('ps -o ppid= -p $PPID')]],
  [4, 'pre', 'pass', [sh('git status --short'), sh('git rev-parse --abbrev-ref HEAD'), sh(`git -C ${M} status --short`), sh(`git -C ${M} log -1 --format='%h %s'`)]],
  [5, 'pre', 'pass', [['Write', { file_path: `${JOB}/workflow-status.md`, content: '# status' }], ['Write', { file_path: `${JOB}/status.json`, content: '{}' }], ['Write', { file_path: `${JOB}/briefs/002-spec.md`, content: '# brief' }], ['Edit', { file_path: `${JOB}/decisions.md`, old_string: 'a', new_string: 'b' }], ['TodoWrite', { todos: [] }]]],
  [6, 'pre', 'ask', [['Read', { file_path: `${HOME}/.claude/ops-handbook.md` }]]],
  [7, 'pre', 'pass', [['Read', { file_path: `${M}/app/src/lib/auth.ts` }], sh('ls app/src'), sh('cat app/package.json'), sh('head -40 app/package.json'), sh('wc -l app/src/lib/auth.ts'), sh('grep -n "copyTicketId" app/src/lib/auth.ts')]],
  [8, 'pre', 'pass', [['Grep', { pattern: 'copyTicketId' }], ['Glob', { pattern: 'app/src/**/*.tsx' }]]],
  [9, 'pre', 'ask', [['Grep', { pattern: 'copyTicketId', path: `${M}/app/src` }], ['Glob', { pattern: '**/*.tsx', path: `${M}/app/src` }], ['Glob', { pattern: `${M}/app/src/**/*.test.ts` }], sh('grep -rn "copyTicketId" app/src'), sh(`grep -rn "copyTicketId" ${M}/app/src --include="*.ts"`), sh('rg -n "copyTicketId" app/src'), sh('find app/src -name "*.test.ts"'), sh('tree -L 2 app/src'), sh('du -sh app')]],
  [10, 'pre', 'pass', [['Agent', { subagent_type: 'feature-spec-writer', description: 'Spec', prompt: 'Stage: spec' }], ['SendMessage', { to: 'agent-1', message: 'Fix: …' }]]],
  [11, 'pre', 'pass', [['Write', { file_path: `${JOB}/spec.md`, content: '# spec' }], ['Write', { file_path: `${M}/docs/plans/2026-11-11-thing-product-spec.md`, content: '# spec' }], ['Edit', { file_path: `${JOB}/workflow-status.md`, old_string: 'a', new_string: 'b' }]]],
  [12, 'pre', 'ask', [sh(`python3 ${SKILLS}/wireframe/build.py --job orbit-500-thing ${JOB}/wireframes.src.json`)]],
  [13, 'pre', 'pass', [sh(`git -C ${M} rev-parse HEAD`), sh(`git -C ${M} grep -n "copyTicketId" -- app/src`), sh(`git -C ${M} ls-files app/src/lib`)]],
  [14, 'pre', 'ask', [sh(`git -C ${M} log --oneline -15 -- app/src/lib`)]],
  [15, 'pre', 'pass', [['Write', { file_path: `${JOB}/findings.md`, content: '# findings' }]]],
  [16, 'pre', 'pass', ['implementation-plan.md', 'test-plan.md', 'acceptance.md', 'dev-tests.md', 'quick-plan.md'].map((f) => ['Write', { file_path: `${JOB}/${f}`, content: '# plan' }])],
  [17, 'pre', 'pass', [['Read', { file_path: `${SKILLS}/workflow-common/git-workflow.md` }]]],
  [18, 'pre', 'ask', [['Read', { file_path: `${HOME}/Projects/moxie-portal-git-workflow/docs/engineering/git-workflow/agent-rules.md` }]]],
  [19, 'pre', 'pass', [sh('git remote -v'), sh(`git -C ${M} remote -v`)]],
  [20, 'pre', 'pass', [sh(`git ls-remote --heads origin ${B}`), sh(`git ls-remote --heads moxie ${B}`)]],
  [21, 'pre', 'pass', [sh('git fetch moxie --prune')]],
  [22, 'pre', 'pass', [sh(`git worktree add -b ${B} ../orbit-orbit-500-thing moxie/main`)]],
  [23, 'post', 'pass', [sh('git rev-parse moxie/main'), sh(`git -C ${W} rev-parse HEAD`)]],
  [24, 'post', 'ask', [sh(`gh api -X POST repos/moxie-org/orbit/git/refs -f ref=refs/heads/${B} -f sha=${SHA}`)]],
  [25, 'post', 'pass', [sh(`cd ${A} && npm ci`)]],
  [26, 'post', 'pass', [['Agent', { subagent_type: 'feature-implementer', description: 'Step 1', prompt: 'Stage: implement' }]]],
  [27, 'post', 'pass', [['Read', { file_path: `${SKILLS}/workflow-common/checklists/all.md` }], ['Read', { file_path: `${JOB}/implementation-plan.md` }], ['Read', { file_path: `${W}/AGENTS.md` }], ['Read', { file_path: `${M}/app/src/lib/auth.ts` }], ['Grep', { pattern: 'copyTicketId', path: `${A}/src` }], ['Glob', { pattern: '**/*.test.ts', path: A }]]],
  [28, 'post', 'pass', [sh(`git -C ${W} status --short`), sh(`git -C ${W} rev-parse --abbrev-ref HEAD`), sh(`git -C ${W} branch --show-current`)]],
  [29, 'post', 'pass', [['Edit', { file_path: `${A}/src/lib/x.ts`, old_string: 'a', new_string: 'b' }], ['Write', { file_path: `${A}/src/lib/x.test.ts`, content: 'test' }], ['MultiEdit', { file_path: `${A}/src/components/TicketRow.tsx`, edits: [] }]]],
  [30, 'post', 'pass', [sh(`cd ${A} && npx vitest run src/lib/x.test.ts`), sh(`cd ${A} && npx tsc --noEmit`)]],
  [31, 'post', 'pass', [sh(`cd ${A} && npm run typecheck`), sh(`cd ${A} && npm run lint`), sh(`cd ${A} && npm run check`), sh(`cd ${A} && npm run check 2>&1 | tail -40`)]],
  [32, 'post', 'pass', [sh(`git -C ${W} add app/src/lib/x.ts app/src/lib/x.test.ts`), sh(`git -C ${W} add -A`), sh(`git -C ${W} commit -m "feat(tickets): add copy ID button"`), sh(`git -C ${W} add -A && git -C ${W} commit -m "feat(tickets): add copy ID button"`),
    sh(`git -C ${W} commit -m "$(cat <<'EOF'\nfeat(tickets): add copy ID button\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nEOF\n)"`)]],
  [33, 'post', 'pass', [sh(`git -C ${W} log -1 --format=%H`), sh(`git -C ${W} diff --stat`), ['Edit', { file_path: `${JOB}/implementation-log.md`, old_string: 'a', new_string: 'b' }]]],
  [34, 'post', 'pass', [sh(`git -C ${W} diff --stat ${SHA}..HEAD`), sh(`git -C ${W} diff ${SHA}..HEAD -- app/src/lib/x.ts`), sh(`git -C ${W} diff --name-only ${SHA}..HEAD`)]],
  [35, 'post', 'pass', [sh(`cd ${A} && npm run check`), sh(`cd ${A} && npm run build`), sh(`cd ${A} && npm run check > ${JOB}/check.log 2>&1`), sh(`tail -40 ${JOB}/check.log`)]],
  [36, 'post', 'pass', [['Write', { file_path: `${JOB}/test-report.md`, content: '# report' }], ['Write', { file_path: `${JOB}/evidence/specs/AC-1.spec.mjs`, content: 'test' }]]],
  [37, 'post', 'pass', [sh(`git -C ${W} rev-parse HEAD`), sh(`git -C ${W} diff --stat ${SHA}..HEAD`), sh(`git -C ${W} log -10 --format='%h %s' HEAD`), sh(`git -C ${W} diff --shortstat ${SHA}..HEAD`),
    sh(`git -C ${W} diff ${SHA}..HEAD -- . ':(exclude,glob)**/package-lock.json' ':(exclude,glob)**/yarn.lock' ':(exclude,glob)**/pnpm-lock.yaml'`), sh(`git -C ${W} diff ${SHA}..HEAD -- ':(glob)**/*.tsx' ':(glob)**/*.css' ':(exclude,glob)**/*.test.*'`)]],
  [38, 'post', 'pass', [['Write', { file_path: `${JOB}/review/facts.md`, content: '# facts' }], ['Agent', { subagent_type: 'feature-reviewer', description: 'Review', prompt: 'facts' }], ['Read', { file_path: `${SKILLS}/workflow-common/review-lens-rules.md` }], ['Read', { file_path: `${A}/src/lib/x.ts` }], ['Grep', { pattern: 'requireRole', path: A }], ['Write', { file_path: `${JOB}/review/spec.md`, content: '# review' }], ['Write', { file_path: `${JOB}/review.md`, content: '# review' }]]],
  [39, 'post', 'pass', [sh(`git ls-remote --heads moxie ${B}`)]],
  [40, 'post', 'pass', [sh(`git -C ${W} fetch moxie`), sh(`git -C ${W} merge moxie/main`)]],
  [41, 'post', 'pass', [sh(`starbase decisions orbit-500-thing --worktree ${W}`)]],
  [42, 'post', 'pass', [sh(`git -C ${W} status --short`), sh(`git -C ${W} add docs/decisions/ORBIT-0500-add-the-thing.md docs/decisions/README.md`), sh(`git -C ${W} commit -m "docs(decisions): ORBIT-500 decisions"`)]],
  [43, 'post', 'pass', [sh(`git -C ${W} push -u origin ${B}`)]],
  [44, 'post', 'pass', [['Read', { file_path: `${SKILLS}/ship/pr-body.md` }], ['Write', { file_path: `${JOB}/pr1-body.md`, content: '## What' }]]],
  [45, 'post', 'pass', [sh(`gh pr create --repo moxie-org/orbit --head test:${B} --base ${B} --title "feat(tickets): ORBIT-500 add copy ID button" --body-file ${JOB}/pr1-body.md`)]],
];

test('the walk: from the main checkout, rows 6, 9, 12, 14, 18 and 24 ask, every other row passes, and no row stops', () => {
  assert.equal(WALK.length, 45);
  const wrong = [];
  for (const [row, phase, want, calls] of WALK) {
    for (const [tool, input] of calls) {
      const got = answer(tool, input, ctxOf(phase));
      if (got !== want) wrong.push({ row, want, got, call: `${tool} ${JSON.stringify(input).split(HOME).join('~').slice(0, 160)}` });
    }
  }
  assert.deepEqual(wrong, []);
});

test('the walk\'s set-up in the skill\'s other spellings passes from the main checkout (finding 4)', () => {
  const rows = [
    `git -C ${M} fetch moxie --prune`,
    `git -C ${M} worktree add -b ${B} ../orbit-orbit-500-thing moxie/main`,
    `git -C ${M} worktree add -b ${B} ${W} moxie/main`,
    `git ls-remote --heads origin ${B} && git ls-remote --heads moxie ${B}`,
    `git fetch moxie --prune && git worktree add -b ${B} ../orbit-orbit-500-thing moxie/main`,
    `git -C ${M} ls-remote --heads origin ${B}`,
  ];
  const wrong = rows.map((c) => ({ c: c.split(HOME).join('~'), got: answer('Bash', { command: c }, ctxOf('pre')) })).filter((r) => r.got !== 'pass');
  assert.deepEqual(wrong, []);
});

test('R4: the rulings, each with its controls, from the main checkout', () => {
  const pre = ctxOf('pre');
  const post = ctxOf('post');
  const run = (c, ctx = post) => answer('Bash', { command: c }, ctx);
  const rows = [];
  const want = (c, w, ctx) => rows.push({ c, w, got: run(c, ctx) });
  // ps reads only with -o <one word> and -p <a number, $PPID or $$>.
  for (const c of ['ps -o ppid= -p $PPID', 'ps -p $$ -o comm=', 'ps -p 123', 'ps -o pid=']) want(c, 'pass', pre);
  for (const c of ['ps aux', 'ps -o ppid= -p $PPID -e', 'ps -p $HOME', 'ps -ef | grep node']) want(c, c === 'ps -ef | grep node' || c === 'ps aux' || c.endsWith(' -e') || c.includes('$HOME') ? 'stop:outside' : 'pass', pre);
  // git's read forms pass where git status passes, with or without -C; the rest of the same subcommands still stop.
  const reads = ['remote', 'remote -v', 'remote get-url origin', 'branch --show-current', 'branch --list "feature/*"', 'branch', 'branch -a', 'branch -r', 'branch -v', 'branch -vv', 'branch -a -vv',
    'worktree list', 'worktree list --porcelain', 'stash list', 'tag', 'tag --list', 'tag -l', 'config --get remote.origin.url'];
  for (const r of reads) { want(`git ${r}`, 'pass', pre); want(`git -C ${M} ${r}`, 'pass', pre); want(`git -C ${W} ${r}`, 'pass', post); }
  for (const r of ['branch spec-draft', 'branch -D spec-draft', 'branch --list -D x', 'tag v9', 'tag -l -d v9', 'stash', 'stash drop', 'worktree remove x', 'worktree prune', 'config --get-all remote.origin.url', 'remote show moxie']) want(`git ${r}`, 'stop:outside', pre);
  for (const r of ['remote add x https://example.com/x.git', 'remote set-url origin x', 'remote remove moxie', 'config remote.origin.url x']) want(`git ${r}`, 'stop:push', pre);
  // starbase decisions, only for the job's slug and one of its worktrees.
  want(`starbase decisions orbit-500-thing --worktree ${W}`, 'pass', post);
  want(`cd ${W} && starbase decisions orbit-500-thing --worktree .`, 'pass', post);
  for (const c of [`starbase decisions orbit-501-other --worktree ${W}`, `starbase decisions orbit-500-thing --worktree ${M}`, `starbase decisions orbit-500-thing --worktree ${HOME}/Projects/other`, 'starbase stop orbit-500-thing', `starbase decisions orbit-500-thing --worktree ${W} --force`, `starbase decisions orbit-500-thing --worktree $WT`]) want(c, 'stop:outside', post);
  // gh pr create by its own rule whatever the folder; a here-document body is text.
  want(`gh pr create --repo moxie-org/orbit --head test:${B} --base ${B} --title "T" --body "$(cat <<'EOF'\n## What\n- one\nEOF\n)"`, 'pass', post);
  for (const c of [`gh pr create --repo moxie-org/orbit --head test:${B} --base main --title T --body-file ${JOB}/pr1-body.md`, `gh pr create --repo moxie-org/orbit --head someone:${B} --base ${B} --title T --body-file ${JOB}/pr1-body.md`,
    `gh pr create --repo other/orbit --head test:${B} --base ${B} --title T --body-file ${JOB}/pr1-body.md`, `gh pr create --base ${B} --title T --reviewer someone --body-file ${JOB}/pr1-body.md`]) want(c, 'ask', post);
  want('gh pr merge 12', 'stop:merge', post);
  want('gh issue create --title x', 'stop:outside', post);
  // A script of the installed skills, run by an interpreter, asks; anything else of the kind still stops.
  for (const c of [`python3 ${SKILLS}/wireframe/build.py --job orbit-500-thing ${JOB}/wireframes.src.json`, `python ${SKILLS}/wireframe/build.py`, `node ${SKILLS}/wireframe/build.py`, `bash ${SKILLS}/wireframe/build.py`, `sh ${SKILLS}/wireframe/build.py`,
    `python3 ${HOME}/Projects/workflow-skills/skills/wireframe/build.py`]) want(c, 'ask', pre);
  for (const c of [`python3 ${HOME}/Projects/other/x.py`, `python3 ${SKILLS}/wireframe/build.py ${HOME}/.ssh/id_rsa`, `python3 -c "print(1)" ${SKILLS}/wireframe/build.py`, `bash -c "rm -rf ~" ${SKILLS}/wireframe/build.py`, `python3 ${SKILLS}/wireframe/build.py > ${HOME}/.zshrc`]) want(c, 'stop:outside', pre);
  // A push reads HEAD, or no branch named, in the worktree it runs in.
  for (const c of [`git -C ${W} push -u origin ${B}`, `git -C ${W} push -u origin HEAD`, `git -C ${W} push`, `cd ${W} && git push`, `cd ${W} && git push -u origin HEAD`, `cd ${A} && git push origin HEAD`]) want(c, 'pass', post);
  for (const c of ['git push -u origin HEAD', 'git push', `git -C ${M} push origin HEAD`, `git -C ${W} push origin HEAD:main`]) want(c, 'stop:push', post);
  want(`git -C ${W} push moxie HEAD`, 'refused', post);
  want(`git -C ${W} push origin HEAD`, 'stop:push', ctxOf('post', { setup: { ...post.setup, worktreeBranches: { [W]: 'main' } } }));
  want(`git -C ${W} push origin HEAD`, 'stop:push', ctxOf('post', { setup: { ...post.setup, worktreeBranches: { [W]: 'feature/other' } } }));
  const wrong = rows.filter((r) => r.got !== r.w).map((r) => ({ ...r, c: r.c.split(HOME).join('~') }));
  assert.deepEqual(wrong, []);
});

test('R4: a read refused for another reason says so, not that it would change something', () => {
  const v = autoVerdict({ kind: 'card', toolName: 'Bash', input: { command: 'GIT_DIR=/elsewhere/.git git log -1' }, hardLine: null, blockedPath: null }, ctxOf('pre'));
  assert.equal(v?.verdict, 'stop');
  assert.match(v.reason, /only reads/);
  const w = autoVerdict({ kind: 'card', toolName: 'Bash', input: { command: 'git checkout -b x' }, hardLine: null, blockedPath: null }, ctxOf('pre'));
  assert.match(w.reason, /change or delete something/);
});
