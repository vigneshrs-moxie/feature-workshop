// Auto's fixed stop rules (lib/auto-rules.js): decided from facts by code. A case that must stop
// is named with its rule; a near miss is null. A refusal (a deny hard line) stays a refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { fixedStop, AUTO_STOP_REASONS } from '../lib/auto-rules.js';
import { hardLine, hardLineHook, rmInsideJob, setStateDir } from '../lib/hard-lines.js';
import { classify, commandParts } from '../lib/policy.js';
import { Driver } from '../lib/driver.js';
import { State } from '../lib/state.js';

const HOME = os.homedir();
const W = '/Users/test/work/orbit-x';
const F = '/Users/test/features/job-x';
const URLS = { origin: 'git@github.com:me/orbit.git', fork: 'git@github.com:me/orbit.git', upstream: 'git@github.com:other/orbit.git', moxie: 'git@github.com:moxie-org/orbit.git', '': 'git@github.com:me/orbit.git' };
const ctx = (over = {}) => ({
  worktrees: [W], featureDir: F, specDirs: ['/Users/test/repo/docs/plans'], cwd: W, forkRemote: 'origin',
  remoteUrl: (name) => URLS[name] ?? null, branches: ['feature/x'], ...over,
});
const bash = (command, over) => {
  const c = ctx(over);
  const verdict = hardLine('Bash', { command }, { cwd: c.cwd });
  return fixedStop({ kind: 'card', toolName: 'Bash', input: { command }, hardLine: verdict, blockedPath: null }, c)?.rule ?? null;
};
const table = (rows, over) => {
  const wrong = rows.map(([command, rule]) => ({ command, want: rule, got: bash(command, over) })).filter((r) => r.want !== r.got);
  assert.deepEqual(wrong, []);
};

test('reasons are the exact sentences', () => {
  assert.deepEqual(AUTO_STOP_REASONS, {
    merge: 'merging a pull request needs you.',
    database: 'a database change needs you.',
    outside: "this would change or delete something outside the job's own folders.",
    push: 'this would push somewhere other than your fork.',
    level: 'the job is now L3, and L3 jobs need you to approve each step.',
    blocked: "the Foreman says it can't do the ticket as written.",
    status: "the Foreman can't write a valid status.json.",
  });
});

test('gate and job rules', () => {
  assert.equal(fixedStop({ kind: 'gate', stage: 'pr1', nextStage: 'pr2' }, ctx()).rule, 'merge');
  assert.equal(fixedStop({ kind: 'gate', stage: 'review', nextStage: 'pr1' }, ctx()), null);
  assert.equal(fixedStop({ kind: 'gate', stage: 'plan', nextStage: 'implement' }, ctx()), null);
  const job = (over) => fixedStop({ kind: 'job', level: 1, suggestedLevel: null, triggers: [], stageState: 'running', statusCard: null, step: null, failures: 0, ...over }, ctx());
  assert.equal(job({}), null);
  assert.equal(job({ triggers: ['migrations'] }).rule, 'database');
  assert.equal(job({ level: 3 }).rule, 'level');
  assert.equal(job({ suggestedLevel: 3 }).rule, 'level');
  assert.deepEqual(job({ step: { stage: 'plan', count: 3 } }), { rule: 'loop', reason: 'the Plan step came back for approval three times without moving on.' });
  assert.equal(job({ step: { stage: 'plan', count: 2 } }), null);
  assert.equal(job({ step: { stage: 'implement', count: 1 } }), null, 'a new stage starts again');
  assert.deepEqual(job({ failures: 2, problem: 'it timed out' }), { rule: 'approver', reason: 'the Approver failed twice running (it timed out).' });
  assert.equal(job({ failures: 1 }), null);
  assert.equal(job({ stageState: 'blocked' }).rule, 'blocked');
  assert.equal(job({ statusCard: { parked: true } }).rule, 'status');
  assert.throws(() => fixedStop({ kind: 'nope' }, ctx()));
});

test('merge', () => {
  table([
    ['gh pr merge 12', 'merge'], ['gh pr merge 12 --squash', 'merge'], ['sudo gh pr merge 1', 'merge'], ['cd . && gh pr merge 3', 'merge'],
    ['git merge moxie/main', null], ['gh pr create --fill', null], ['gh pr view 12', null],
    ['gh api -X PUT repos/me/orbit/pulls/3/merge', 'merge'],
  ]);
});

test('database: clients, tools, wrappers, sql files', () => {
  table([
    ['npm run db:migrate', 'database'], ['npm run db:status', null], ['psql -c "update users set x = 1"', 'database'],
    ['sqlite3 app.db < fix.sql', 'database'], ['grep psql README.md', null], ['echo psql', null],
    ['npx prisma db push', 'database'], ['npx prisma migrate deploy', 'database'], ['pnpm drizzle-kit push', 'database'],
    ['supabase db reset', 'database'], ['docker exec db psql -U x', 'database'], ['rails db:migrate', 'database'],
    ['python manage.py migrate', 'database'], ['knex migrate:latest', 'database'], ['npx knex migrate:latest', 'database'],
    ['cat db/schema.sql', 'database'], ['node load.js seed.sql', 'database'], ['mysql < dump.sql', 'database'],
    ['env X=1 psql -c x', 'database'], ['sudo psql -c x', 'database'], ['nohup psql -c x', 'database'], ['time psql -c x', 'database'],
    ['echo q | xargs psql -c', 'database'], ['bash -c "psql -c x"', 'database'], ["sh -c 'psql -c x'", 'database'],
    ['true && psql -c x', 'database'], ['false || psql -c x', 'database'], ['true; psql -c x', 'database'], ['echo | psql', 'database'],
    ['echo $(psql -c x)', 'database'], ['echo `psql -c x`', 'database'], ['ls\npsql -c x', 'database'],
    ['watch psql -c x', 'database'], ['kubectl exec pod -- psql', 'database'], ['mongosh --eval x', 'database'],
    ['env -S "psql -c x"', 'database'], ['eval "psql -c x"', 'database'],
  ]);
});

test('push: only the fork, only the job branch', () => {
  table([
    ['git push origin feature/x', null], ['git push -u origin feature/x', null], ['git push origin HEAD', null], ['git push origin', null],
    ['git push', null],
    ['git push upstream feature/x', 'push'], ['git push https://github.com/me/orbit.git feature/x', 'push'], ['git push git@github.com:me/orbit.git feature/x', 'push'],
    ['git -C /Users/other/repo push origin feature/x', 'push'], ['git push --repo=upstream', 'push'], ['git push --repo upstream', 'push'],
    ['git push origin feature/x:main', 'push'], ['git push origin HEAD:main', 'push'], ['git push origin feature/x:feature/y', 'push'],
    ['git push origin feature/y', 'push'], ['git push origin --all', 'push'], ['git push origin --tags', 'push'], ['git push origin --follow-tags', 'push'],
    ['git push origin --delete feature/x', 'push'], ['git push origin :feature/x', 'push'], ['git push origin -d feature/x', 'push'],
    ['git push origin refs/tags/v1', 'push'], ['git push --del origin feature/x', 'push'],
    ['sudo git push upstream feature/x', 'push'], ['env GIT_DIR=/other git push origin feature/x', 'push'],
    ['cd /Users/other && git push origin feature/x', 'push'], ['git -c remote.origin.pushurl=x push origin feature/x', 'push'],
    ['git remote set-url origin git@github.com:other/orbit.git', 'push'], ['git push $R feature/x', 'push'],
  ]);
  // a push with no remote is looked up as orgPushCheck does: where the branch's own push remote points
  assert.equal(bash('git push', { remoteUrl: (n) => (n === '' ? URLS.upstream : URLS.origin) }), 'push');
  assert.equal(bash('git push', { remoteUrl: () => null }), 'push', 'a lookup that fails stops');
  assert.equal(bash('git push origin feature/x', { remoteUrl: () => 'git@github.com:moxie-org/orbit.git' }), 'push', 'a fork remote that really points at the org');
  // another remote name for the same address is still the fork
  assert.equal(bash('git push mirror feature/x', { remoteUrl: () => URLS.origin }), null);
  // without a known branch, only name-for-name refspecs pass
  assert.equal(bash('git push origin feature/x', { branches: [] }), null);
  assert.equal(bash('git push origin HEAD:feature/x', { branches: [] }), 'push');
  assert.equal(bash('git push origin HEAD:main', { branches: [] }), 'push');
});

test('push: refusals stay refusals', () => {
  const hook = hardLineHook(() => {}, { check: async (v) => v, cwd: W, autoStop: (tool, input, verdict) => fixedStop({ kind: 'card', toolName: tool, input, hardLine: verdict, blockedPath: null }, ctx()) });
  const answer = async (command) => (await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: W })).hookSpecificOutput?.permissionDecision ?? null;
  return Promise.all(['git push --force origin feature/x', 'git push --force-with-lease origin feature/x', 'git push -f origin feature/x', 'git push origin +feature/x', 'git push --mirror origin', 'git push moxie feature/x']
    .map(async (c) => assert.equal(await answer(c), 'deny', c)));
});

test('outside: wrappers, redirects, copies, installs, system tools', () => {
  table([
    ['echo x > /etc/hosts', 'outside'], ['echo x >> /etc/hosts', 'outside'], ['echo x > build/out.txt', null], ['echo x > /dev/null', null], ['ls 2>&1', null],
    ['echo x | tee /etc/hosts', 'outside'], ['echo x | tee notes.txt', null], ['echo x &> /etc/hosts', 'outside'],
    ['echo x > ../elsewhere', 'outside'], ['echo x > ../../../etc/hosts', 'outside'], ['echo x > ~/x', 'outside'], ['echo x > $HOME/x', 'outside'], ['echo x > "$DEST"', 'outside'],
    ['cp a.txt ~/a.txt', 'outside'], ['cp a.txt b.txt', null], ['cp -r build ../other', 'outside'], ['mv a b', null], ['mv a ~/b', 'outside'], ['mv ~/a b', 'outside'],
    ['ln -s a ~/link', 'outside'], ['install -m 755 x /usr/local/bin/x', 'outside'], ['rsync -a build/ ~/backup/', 'outside'], ['rsync -a build/ host:/srv/', 'outside'],
    ['curl -o ~/x https://example.com', 'outside'], ['curl -sSo /etc/x https://example.com', 'outside'], ['curl https://example.com', null], ['curl -o out.html https://example.com', null],
    ['git config --global user.name x', 'outside'], ['git config user.name x', null], ['git config --get remote.origin.url', null],
    ['npm install -g foo', 'outside'], ['npm install foo', null], ['pnpm add --global foo', 'outside'], ['brew install jq', 'outside'], ['brew list', 'outside'],
    ['chmod +x run.sh', null], ['chmod 755 ~/run.sh', 'outside'], ['chown me ~/x', 'outside'], ['chmod -R 700 /etc/x', 'outside'],
    ['git worktree add ../other-wt feature/y', 'outside'], ['git worktree add /Users/test/work/orbit-y -b feature/y', 'outside'], ['git worktree list', null],
    ['launchctl load x.plist', 'outside'], ['crontab -e', 'outside'], ['open https://x.test', 'outside'], ['osascript -e "beep"', 'outside'],
    ['kill 123', 'outside'], ['pkill node', 'outside'], ['killall Finder', 'outside'],
    ['rm -rf build', null], ['rm -rf /Users/test/work/orbit-x/build', null], ['rm -rf ~/x', 'outside'], ['rm -rf /Users/test/work/orbit-x', 'outside'], ['rm file.txt', null], ['rm ~/file.txt', 'outside'], ['rm -rf ../x', 'outside'],
    ['rm -rf build/../..', 'outside'], ['rm -rf $X', 'outside'], ['cd /tmp && rm -rf scratch', null], ['cd /Users/other && rm -rf x', 'outside'],
    ['sed -i s/a/b/ ~/.zshrc', 'outside'], ['sed -i s/a/b/ src/a.js', null], ['dd if=a of=/dev/sda', 'outside'],
    ['sudo rm -rf build', 'outside'], ['sudo ls', 'outside'], ['xargs rm', 'outside'], ['find . -name x -delete', null], ['find ~ -name x -delete', 'outside'],
    ['find . -name x -exec rm {} \\;', null], ['find /etc -exec rm {} \\;', 'outside'], ['find . | xargs rm', 'outside'],
    ['gh repo sync', 'outside'], ['gh release create v1', 'outside'], ['gh api -X POST repos/me/orbit/issues', 'outside'], ['gh api repos/me/orbit/issues -f title=x', 'outside'],
    ['gh workflow run ci.yml', 'outside'], ['gh api repos/me/orbit', null], ['gh pr view 1', null], ['gh issue create', 'outside'], ['hub release create v1', 'outside'],
    ['git status', null], ['npm test', null], ['git add -A && git commit -m "x"', null], ['ls -la', null],
  ]);
});

test('outside: what a command hides stops', () => {
  table([
    ['eval "ls"', 'outside'], ['$CMD x', 'outside'], ['bash <<EOF\nls\nEOF', 'outside'], ["bash <<'EOF'\nls\nEOF", 'outside'], ['echo ls | sh', 'outside'], ['bash', 'outside'],
    ['bash -c "$X"', 'outside'], ['bash scripts/check.sh', null], ['source .env', 'outside'], ['. ./env.sh', 'outside'],
    ['python3 -c "print(1)"', 'outside'], ['node -e "1"', 'outside'], ["python - <<'EOF'\nprint(1)\nEOF", 'outside'], ['node --test', null], ['python3 script.py', null], ['node build.js', null],
    ['pushd /Users/other; rm -rf x', 'outside'], ['(cd /Users/other && rm -rf x)', 'outside'],
    ['git commit -m "$(cat <<\'EOF\'\nFix it\n\nCo-Authored-By: x\nEOF\n)"', null],
    ['echo `date`', null],
  ]);
});

test('S1: a program Starbase does not know stops; the ones it does pass', () => {
  table([
    // not in any group
    ['docker run x', 'outside'], ['docker ps', 'outside'], ['kubectl apply -f x.yaml', 'outside'], ['terraform apply', 'outside'], ['aws s3 ls', 'outside'], ['gcloud compute list', 'outside'],
    ['az vm list', 'outside'], ['vercel deploy', 'outside'], ['vercel --prod', 'outside'], ['netlify deploy --prod', 'outside'], ['fly deploy', 'outside'], ['heroku apps', 'outside'],
    ['ssh host ls', 'outside'], ['scp host:y .', 'outside'], ['nc host 1', 'outside'], ['nc -l 1234', 'outside'], ['osascript -e "beep"', 'outside'], ['open https://x.test', 'outside'],
    ['launchctl list', 'outside'], ['crontab -l', 'outside'], ['brew install jq', 'outside'], ['some-unknown-tool --flag', 'outside'], ['say hi', 'outside'], ['helm install x y', 'outside'],
    ['pbcopy < x.txt', 'outside'], ['etcdctl del x', 'outside'], ['/usr/local/bin/tool x', 'outside'], ['~/bin/tool x', 'outside'], ['/bin/ls', 'outside'], ['true && some-unknown-tool', 'outside'],
    ['echo x | pbcopy', 'outside'], ['xargs unknown-tool', 'outside'], ['env FOO=1 unknown-tool', 'outside'], ['alias p=psql; p', 'database'], ['alias p=ls', 'outside'], ['code x.js', 'outside'], ['vim x', 'outside'],
    // reads pass, wherever they read
    ['cat ~/.zshrc', null], ['ls /', null], ['grep -r x .', null], ['head -n 3 /etc/hosts', null], ['wc -l a b', null], ['diff a b', null], ['find . -name x', null], ['stat /etc/hosts', null],
    ['du -sh ~', null], ['pwd', null], ['echo hi', null], ['printf x', null], ['date', null], ['which node', null], ['env', null], ['test -f a', null], ['true', null], ['false', null],
    ['sort a | uniq | cut -d, -f1 | tr a b', null], ['jq . a.json', null], ['basename a', null], ['dirname a', null], ['realpath a', null], ['tree', null], ['less a', null], ['cat ~/.ssh/id_rsa', null],
    ['ls ~', null], ['rg foo src', null], ['cd sub && ls', null], ['for f in a b; do echo $f; done', null], ['if test -f a; then echo y; fi', null],
    // build and test pass
    ['npm test', null], ['npm run build', null], ['npx vitest run', null], ['node scripts/gen.js', null], ['pnpm test', null], ['yarn build', null], ['bun test', null], ['tsc --noEmit', null],
    ['vitest', null], ['jest', null], ['eslint .', null], ['prettier --check .', null], ['python3 script.py', null], ['pytest -q', null], ['cargo build', null], ['go test ./...', null],
    ['make', null], ['make build', null], ['mvn test', null], ['gradle build', null], ['dotnet build', null], ['bundle exec rspec', null], ['rake test', null], ['deno test', null], ['bunx tsc', null],
    ['cd packages/a && npm test', null], ['/Users/test/work/orbit-x/node_modules/.bin/vitest run', null], ['./node_modules/.bin/eslint .', null],
    // git and gh: by subcommand
    ['git status', null], ['git add -A && git commit -m "x"', null], ['git push origin feature/x', null], ['git diff', null], ['git log --oneline', null], ['git fetch origin', null], ['git merge moxie/main', null],
    ['git bogus-subcommand', 'outside'], ['git fast-import', 'outside'], ['git bundle create x', 'outside'], ['git p upstream x', 'outside'], ['git apply x.patch', 'outside'], ['git hook run x', 'outside'], ['git filter-branch x', 'outside'],
    ['gh pr create --fill', null], ['gh pr view 1', null], ['gh bogus thing', 'outside'], ['gh extension install x', 'outside'],
    // file changes pass only inside
    ['cp a b', null], ['cp ~/.zshrc x', 'outside'], ['cp /etc/passwd .', 'outside'], ['mv a b', null], ['mkdir -p sub/x', null], ['mkdir ../x', 'outside'], ['touch .', null], ['touch ~/x', 'outside'],
    ['zip ~/x.zip y', 'outside'], ['zip out.zip y', null], ['unzip a.zip', null], ['ed ~/x', 'outside'], ['cpio -p ~/x', 'outside'], ['patch ~/x', 'outside'], ['truncate -s 0 ~/x', 'outside'], ['dd if=a of=b', null],
    ['sed -i s/a/b/ file', null], ['sed -i s/a/b/ ~/x', 'outside'], ['sed "s/a/b/w ~/x" f', 'outside'], ['sed -n "w ~/x" f', 'outside'], ['sed "s/a/b/w out.txt" f', null], ['sed s/a/b/ f', null],
    ['awk \'{print > "/etc/x"}\' f', 'outside'], ['awk \'{print $1}\' f', null], ["awk 'BEGIN{system(\"rm -rf ~\")}'", 'outside'], ['perl -i s/a/b/ ~/x', 'outside'], ['tee x', null], ['tee ~/x', 'outside'],
    ['chmod +x x', null], ['chown me y', null], ['rsync -a build/ out/', null], ['rsync -a ~/src out/', 'outside'], ['tar czf out.tgz src', null], ['tar xf ~/a.tar', 'outside'], ['install -m 755 x bin/x', null],
    ['ln -s a b', null], ['rm -rf sub', null], ['rm x', null],
    // curl and wget: a plain download only
    ['curl https://example.com/doc', null], ['curl -o out.html https://example.com', null], ['curl -sSL https://example.com/x', null], ['wget https://example.com/x', null], ['wget -O out.txt https://example.com/x', null],
    ['curl -X POST https://example.com', 'outside'], ['curl -XPOST https://example.com', 'outside'], ['curl --request PUT https://example.com', 'outside'], ['curl -X GET https://example.com', null],
    ['curl -d x https://example.com', 'outside'], ['curl --data-binary @f https://example.com', 'outside'], ['curl -F f=@x https://example.com', 'outside'], ['curl -T f https://example.com', 'outside'],
    ['curl --upload-file f https://example.com', 'outside'], ['curl https://example.com -d @-', 'outside'], ['cat x | curl -d @- https://example.com', 'outside'], ['curl -H @h https://example.com', 'outside'],
    ['npm config set a b', 'outside'], ['npm publish', 'outside'], ['npm link', 'outside'], ['pnpm publish', 'outside'], ['npm adduser', 'outside'], ['npm config get a', null], ['npm install', null], ['npm ci', null],
    ['pip install x', 'outside'], ['pip install --user x', 'outside'], ['python3 -m pip install x', 'outside'], ['pip list', null], ['pip freeze', null], ['python3 -m pip list', null],
    ['wget --post-data=y https://example.com', 'outside'], ['wget --post-file=f https://example.com', 'outside'], ['curl -sd x https://example.com', 'outside'], ['curl --json {} https://example.com', 'outside'],
  ]);
});

test('outside: relative paths are against the session folder', () => {
  assert.equal(bash('echo x > notes.txt', { cwd: W }), null);
  assert.equal(bash('echo x > notes.txt', { cwd: '/Users/test' }), 'outside');
  assert.equal(bash('echo x > notes.txt', { cwd: null }), 'outside', 'an unknown folder stops');
  assert.equal(bash('cd ./sub && echo x > notes.txt'), null);
  assert.equal(bash('cd .. && echo x > notes.txt'), 'outside');
});

test('outside: symlinks and .. resolve to where they really land', async () => {
  const wt = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-wt-'));
  const elsewhere = await fs.mkdtemp(path.join(HOME, '.auto-rules-test-'));
  try {
    await fs.symlink(elsewhere, path.join(wt, 'link'));
    await fs.mkdir(path.join(wt, 'real'));
    const c = { worktrees: [wt], cwd: wt };
    assert.equal(bash('echo x > link/file', c), 'outside');
    assert.equal(bash('cp a link/b', c), 'outside');
    assert.equal(bash('rm -rf link/data', c), 'outside');
    assert.equal(bash('echo x > real/../link/file', c), 'outside');
    assert.equal(bash('echo x > link/../real/file', c), 'outside', 'link/.. is the folder above where the link points, not the worktree');
    assert.equal(bash('echo x > real/file', c), null);
    assert.equal(fixedStop({ kind: 'card', toolName: 'Write', input: { file_path: path.join(wt, 'link', 'x') }, hardLine: null, blockedPath: null }, ctx(c))?.rule, 'outside');
    assert.equal(fixedStop({ kind: 'card', toolName: 'Write', input: { file_path: path.join(wt, 'real', 'x') }, hardLine: null, blockedPath: null }, ctx(c)), null);
  } finally {
    await fs.rm(wt, { recursive: true, force: true });
    await fs.rm(elsewhere, { recursive: true, force: true });
  }
});

const tool = (toolName, input, over) => fixedStop({ kind: 'card', toolName, input, hardLine: null, blockedPath: null }, ctx(over))?.rule ?? null;

test('outside: edit tools and blockedPath', () => {
  assert.equal(tool('Edit', { file_path: `${W}/src/a.js` }), null);
  assert.equal(tool('Write', { file_path: `${F}/status.json` }), null);
  assert.equal(tool('Write', { file_path: '/Users/test/repo/docs/plans/x.md' }), null);
  assert.equal(tool('Write', { file_path: path.join(os.tmpdir(), 'x') }), null);
  assert.equal(tool('Edit', { file_path: `${HOME}/.zshrc` }), 'outside');
  assert.equal(tool('Write', { file_path: '~/.zshrc' }), 'outside');
  assert.equal(tool('MultiEdit', { file_path: `${W}/../other/a.js` }), 'outside');
  assert.equal(tool('NotebookEdit', { notebook_path: '/etc/x.ipynb' }), 'outside');
  assert.equal(tool('Edit', { file_path: 'src/a.js' }), null, 'relative to the session folder');
  assert.equal(tool('Edit', { file_path: 'src/a.js' }, { cwd: '/Users/test' }), 'outside');
  assert.equal(tool('Edit', {}), 'outside');
  assert.equal(fixedStop({ kind: 'card', toolName: 'Edit', input: { file_path: `${W}/a.js` }, hardLine: null, blockedPath: '/etc/x' }, ctx()).rule, 'outside');
  // rm -rf: the hard line's own test clears it only when everything is inside
  const parts = (c) => commandParts(c, W)[0].words;
  assert.equal(rmInsideJob(parts(`rm -rf ${W}/build`), W, ctx()), true);
  assert.equal(rmInsideJob(parts('rm -rf ~/x'), W, ctx()), false);
});

test('known tools pass, unknown tools stop', () => {
  for (const t of ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite', 'Agent', 'Task']) assert.equal(tool(t, {}), null, t);
  for (const t of ['mcp__orbit-feedback__post', 'FancyNewTool']) {
    const stop = fixedStop({ kind: 'card', toolName: t, input: {}, hardLine: null, blockedPath: null }, ctx());
    assert.equal(stop.rule, 'outside', t);
    assert.equal(stop.unknownTool, true);
  }
});

test('classify says outside: true exactly where it refuses a write outside the job folders', () => {
  const c = { stage: 'implement', worktrees: [W], featureDir: F, specDirs: [], cwd: W, mode: 'hands-off' };
  assert.equal(classify('Bash', { command: 'echo x > /etc/hosts' }, c).outside, true);
  assert.equal(classify('Bash', { command: 'mkdir /etc/x' }, c).outside, true);
  assert.equal(classify('Edit', { file_path: '/etc/x' }, c).outside, true);
  assert.equal(classify('Edit', { file_path: `${HOME}/.zshrc` }, c).outside, true);
  // refused for another reason: the stage is too early, or the program needs your OK
  assert.equal(classify('Edit', { file_path: `${W}/a.js` }, { ...c, stage: 'plan' }).outside, undefined);
  assert.equal(classify('Bash', { command: 'echo x > a.txt' }, { ...c, stage: 'plan' }).outside, undefined);
  assert.equal(classify('Bash', { command: 'curl https://x.test' }, c).outside, undefined);
  assert.equal(classify('Bash', { command: 'echo hi' }, c).outside, undefined);
});

// ---------- starbase-state ----------

test('starbase-state: denied for every job, reading is not', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-state-'));
  const link = path.join(dir, 'sb');
  const real = path.join(dir, 'real-state');
  await fs.mkdir(real);
  await fs.symlink(real, link);
  const opts = { stateDir: real, cwd: W };
  const line = (tool, input, o = opts) => hardLine(tool, input, o)?.line ?? null;
  const REASON = "Starbase's own state folder is not for jobs to change.";
  try {
    assert.deepEqual(hardLine('Write', { file_path: `${real}/sessions.json` }, opts), { decision: 'deny', line: 'starbase-state', reason: REASON });
    for (const [t, i] of [['Edit', { file_path: `${real}/sessions.json` }], ['MultiEdit', { file_path: `${link}/sessions.json` }], ['NotebookEdit', { notebook_path: `${real}/a/../sessions.json` }],
      ['Write', { file_path: `${HOME}/.starbase/sessions.json` }], ['Write', { file_path: '~/.starbase/sessions.json' }], ['Write', { file_path: `${HOME}/Projects/../.starbase/x` }]]) assert.equal(line(t, i), 'starbase-state', JSON.stringify(i));
    assert.equal(line('Write', { file_path: `${W}/a.js` }), null);
    const cmds = [
      [`echo x >> ~/.starbase/sessions.json`, 'starbase-state'], [`echo x > $HOME/.starbase/sessions.json`, 'starbase-state'], [`echo x > ${HOME}/.starbase/sessions.json`, 'starbase-state'],
      [`echo x > ${real}/sessions.json`, 'starbase-state'], [`echo x > ${link}/sessions.json`, 'starbase-state'], [`echo x > ${real}/a/../sessions.json`, 'starbase-state'],
      ['cp x ~/.starbase/sessions.json', 'starbase-state'], ['mv x ~/.starbase/sessions.json', 'starbase-state'], ['rm ~/.starbase/sessions.json', 'starbase-state'], ['rm -rf $HOME/.starbase', 'starbase-state'],
      ['sed -i s/on/off/ ~/.starbase/sessions.json', 'starbase-state'], ['echo x | tee ~/.starbase/sessions.json', 'starbase-state'],
      [`python3 -c "open('${HOME}/.starbase/sessions.json','w')"`, 'starbase-state'], [`node -e "require('fs').writeFileSync(process.env.HOME + '/.starbase/s', 'x')"`, 'starbase-state'],
      ['cd ~/.starbase && rm sessions.json', 'starbase-state'], ['cd ~/.starbase; rm sessions.json', 'starbase-state'], [`cp x ${real}/y`, 'starbase-state'],
      ['cat ~/.starbase/usage.jsonl', null], ['ls ~/.starbase', null], ['grep on ~/.starbase/sessions.json', null], [`cat ${real}/sessions.json`, null], ['cat ~/.starbase/usage.jsonl > /dev/null', null],
      ['git commit -m "reads ~/.starbase on start"', null], ['echo x > a.txt', null],
    ];
    assert.deepEqual(cmds.map(([c, want]) => ({ c, want, got: line('Bash', { command: c }) })).filter((r) => r.want !== r.got), []);
    // the default folder is always one, and setStateDir adds the configured one
    assert.equal(line('Bash', { command: 'rm /srv/state/x' }, { cwd: W }), null);
    setStateDir('/srv/state');
    assert.equal(line('Bash', { command: 'rm /srv/state/x' }, { cwd: W }), 'starbase-state');
    assert.equal(line('Write', { file_path: '/srv/state/sessions.json' }, { cwd: W }), 'starbase-state');
    setStateDir(null);
    // through the hook, for a job whose Auto is off, and a deny stays a deny for one whose Auto is on
    for (const autoStop of [null, () => ({ rule: 'outside', reason: 'x' })]) {
      const hook = hardLineHook(() => {}, { check: async (v) => v, cwd: W, autoStop });
      const r = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: `${HOME}/.starbase/sessions.json` }, cwd: W });
      assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
      assert.equal(r.hookSpecificOutput.permissionDecisionReason, REASON);
    }
  } finally {
    setStateDir(null);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------- the hook ----------

const call = (hook, tool_name, tool_input) => hook({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: W });
const decision = (r) => r.hookSpecificOutput?.permissionDecision ?? null;
const reason = (r) => r.hookSpecificOutput?.permissionDecisionReason ?? null;
const autoOn = (over = {}) => hardLineHook(() => {}, {
  check: async (v) => v, cwd: W, ...over,
  autoStop: (t, i, v) => fixedStop({ kind: 'card', toolName: t, input: i, hardLine: v, blockedPath: null }, ctx()),
});

test('hook: with Auto on, a stop asks whatever cover says; ordinary steps are left to the setting', async () => {
  const cover = async () => ({ reason: 'covered' });
  const hook = autoOn({ cover });
  let r = await call(hook, 'Bash', { command: 'git push upstream feature/x' });
  assert.equal(decision(r), 'ask');
  assert.equal(reason(r), AUTO_STOP_REASONS.push);
  r = await call(hook, 'Edit', { file_path: `${HOME}/.zshrc` });
  assert.equal(decision(r), 'ask');
  assert.equal(reason(r), AUTO_STOP_REASONS.outside);
  assert.equal(decision(await call(hook, 'Bash', { command: 'psql -c x' })), 'ask');
  assert.equal(decision(await call(hook, 'Bash', { command: 'gh pr merge 3' })), 'ask');
  // the PR stage covers pushing the fork's branch: not a stop, and cover still applies
  assert.deepEqual(await call(hook, 'Bash', { command: 'git push origin feature/x' }), {});
  assert.deepEqual(await call(hook, 'Edit', { file_path: `${W}/a.js` }), {});
  assert.deepEqual(await call(hook, 'Read', { file_path: '/etc/hosts' }), {});
  assert.deepEqual(await call(hook, 'Bash', { command: 'npm test' }), {});
});

test('hook: an unknown tool on an Auto job asks; a failing check asks and never lets it through', async () => {
  const hook = autoOn();
  assert.equal(decision(await call(hook, 'mcp__x__y', {})), 'ask');
  assert.equal(decision(await call(hook, 'BrandNewTool', {})), 'ask');
  for (const throwing of [() => { throw new Error('boom'); }, async () => { throw new Error('boom'); }]) {
    const bad = hardLineHook(() => {}, { check: async (v) => v, cwd: W, autoStop: throwing });
    for (const [t, i] of [['Bash', { command: 'ls' }], ['Read', { file_path: 'x' }], ['Edit', { file_path: `${W}/a` }]]) {
      assert.equal(decision(await call(bad, t, i)), 'ask', t);
    }
  }
  // a thrown error inside fixedStop itself: a ctx whose lookup blows up
  const blow = hardLineHook(() => {}, { check: async (v) => v, cwd: W, autoStop: (t, i, v) => fixedStop({ kind: 'card', toolName: t, input: i, hardLine: v, blockedPath: null }, { get worktrees() { throw new Error('boom'); } }) });
  assert.equal(decision(await call(blow, 'Bash', { command: 'ls' })), 'ask');
});

test('hook: with Auto off the answers are the same as before', async () => {
  const off = hardLineHook(() => {}, { check: async (v) => v, cwd: W });
  const offNull = hardLineHook(() => {}, { check: async (v) => v, cwd: W, autoStop: () => null });
  for (const hook of [off, offNull]) {
    assert.equal(decision(await call(hook, 'Bash', { command: 'git push upstream feature/x' })), 'ask');
    assert.equal(decision(await call(hook, 'Bash', { command: 'git push --force origin x' })), 'deny');
    assert.equal(reason(await call(hook, 'Bash', { command: 'npm run db:migrate' })), 'Database migrations are a hard line: they ask you before they run.');
    assert.deepEqual(await call(hook, 'Edit', { file_path: `${HOME}/.zshrc` }), {});
    assert.deepEqual(await call(hook, 'mcp__x__y', {}), {});
    assert.deepEqual(await call(hook, 'Bash', { command: 'echo x > /etc/hosts' }), {});
  }
  // with cover, a covered ask still steps aside
  const covered = hardLineHook(() => {}, { check: async (v) => v, cwd: W, cover: async () => ({ reason: 'ok' }), autoStop: () => null });
  assert.deepEqual(await call(covered, 'Bash', { command: 'git push origin feature/x' }), {});
});

// ---------- the driver passes autoStop ----------

test('driver: the hook sees every tool; autoStop answers only for a job whose record says Auto is on', async () => {
  const state = new State(await fs.mkdtemp(path.join(os.tmpdir(), 'auto-driver-state-')));
  const answers = {};
  const make = (dir) => new Driver({
    queryFn: ({ prompt, options }) => {
      const gen = (async function* () {
        await prompt[Symbol.asyncIterator]().next();
        yield { type: 'system', subtype: 'init', session_id: `s-${dir}`, permissionMode: 'default' };
        const entries = options.hooks.PreToolUse;
        assert.equal(entries[0].matcher, 'Bash');
        const reaches = (tool) => entries.filter((m) => new RegExp(`^(?:${m.matcher})$`).test(tool)).length;
        assert.deepEqual(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'mcp__x__y', 'NewTool'].map(reaches), [1, 1, 1, 1, 1, 1, 1], 'every tool reaches the hook once');
        const hook = entries[0];
        const ask = async (tool_name, tool_input) => (await hook.hooks[0]({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: W })).hookSpecificOutput?.permissionDecision ?? null;
        answers[dir] = { push: await ask('Bash', { command: 'git push upstream feature/x' }), edit: await ask('Edit', { file_path: `${HOME}/.zshrc` }), mcp: await ask('mcp__x__y', {}), state: await ask('Write', { file_path: `${HOME}/.starbase/sessions.json` }), read: await ask('Read', { file_path: 'x' }) };
        yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0 };
      })();
      gen.interrupt = async () => {};
      return gen;
    },
    state, projectsDir: '/nonexistent', autoCtx: async () => ctx(),
  });
  const run = async (dir, auto) => {
    if (auto) await state.setSession(dir, { auto: { on: true, since: 'now', by: 'you', tag: null, ran: true, stopped: null, step: null, failures: 0, lastBrief: null } });
    const driver = make(dir);
    driver.idleGraceMs = 30;
    const started = await driver.start({ featureDir: dir, slug: 'j', title: 'J', cwd: W, text: 'go' });
    await new Promise((resolve) => { const on = (r) => { if (r.id === started.id && ['done', 'error', 'stopped'].includes(r.status)) { driver.off('run', on); resolve(); } }; driver.on('run', on); });
  };
  await run('/f/off', false);
  await run('/f/on', true);
  assert.deepEqual(answers['/f/off'], { push: 'ask', edit: null, mcp: null, state: 'deny', read: null });
  assert.deepEqual(answers['/f/on'], { push: 'ask', edit: 'ask', mcp: 'ask', state: 'deny', read: null });
});
