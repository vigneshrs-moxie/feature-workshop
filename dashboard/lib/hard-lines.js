// Hard lines: shell commands that always come to you as a card, whatever the permission setting
// (ask about everything, routine steps automatic, or auto mode), and the few the dashboard refuses
// outright. Enforced by a PreToolUse hook the driver gives every Foreman session (it runs before
// Claude Code's own permission check, auto mode's safety model included), and checked again
// when a request reaches the dashboard, so neither a saved "Always allow" rule nor the routine
// list can let one through.
//
// TO REVISIT (the user's note, 2026-10-15): today a hard line asks even when your own message
// told the Foreman to do exactly that ("push it now"). The plan is to let "your own message asked
// for it" count as the yes for ASK lines. Never for NEVER lines. Keep the whole list here, in this
// one file, so that change is made in one place.
//
// ASK: a card, always.
//   git push            any push (the remote and branch are on the card)
//   gh pr create        opening a pull request
//   gh pr merge         merging one
//   rm -rf              recursive, forced deletes (-rf, -fr, -r -f, --recursive --force, …)
//   database changes    package scripts named db:* or *migrat*, and the usual migration tools
// NEVER: refused without asking, in every mode.
//   pushes to the org repo (the "moxie" remote, a github.com/moxie… address, or any other remote
//   whose push address is one: orgPushCheck() asks git in the job's folder)
//   force pushes (--force, -f, --force-with-lease, --force-if-includes, a +refspec, --mirror)
//
// Matching reads the command word by word, through && ; | and $( … ), past VAR=value prefixes and
// wrappers such as sudo, env, command, nohup, time and timeout (and their options' values). When
// the command can't be read that way, or sits behind a wrapper, the raw text is searched too:
// asking about something harmless is fine; missing one is not.

import { execFile } from 'node:child_process';
import path from 'node:path';

import { splitCommand } from './policy.js';

/** Remote names and addresses that mean the org repository. Pushing there is never allowed. */
export const ORG_REMOTES = ['moxie'];
export const ORG_URL = /github\.com[:/]+moxie[\w.-]*\//i;

// Wrappers, each with its options that take a value (the next word, unless written --opt=value).
const WRAPPERS = new Map([
  ['sudo', ['-u', '-g', '-C', '-D', '-h', '-p', '-U', '-r', '-t', '-T', '-R', '--user', '--group', '--close-from', '--chdir', '--host', '--prompt', '--other-user', '--role', '--type', '--command-timeout', '--chroot']],
  ['env', ['-u', '-C', '-S', '-P', '--unset', '--chdir', '--split-string']],
  ['timeout', ['-s', '-k', '--signal', '--kill-after']],
  ['nice', ['-n', '--adjustment']],
  ['time', ['-f', '-o', '--format', '--output']],
  ['xargs', ['-I', '-J', '-L', '-n', '-P', '-R', '-S', '-s', '-E', '-d', '-a', '--max-args', '--max-procs', '--max-lines', '--replace', '--delimiter', '--arg-file', '--eof']],
  ['caffeinate', ['-t', '-w']],
  ['command', []], ['builtin', []], ['exec', ['-a']], ['nohup', []], ['then', []], ['do', []], ['else', []], ['!', []], ['{', []],
]);
const PKG = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const DB_SCRIPT = /^db:|migrat/i;

// Words of one simple command, quotes removed (good enough here: over-reading only asks more).
function words(simple) {
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(simple))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// The command word and its arguments, past assignments and wrappers.
function strip(w) {
  let i = 0;
  for (;;) {
    if (i >= w.length) return [];
    const x = w[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(x)) { i++; continue; }
    const takesValue = WRAPPERS.get(x.replace(/^.*\//, ''));
    if (takesValue) {
      i++;
      while (w[i]?.startsWith('-') && w[i] !== '-') {
        const opt = w[i++];
        if (opt === '--') break;
        if (takesValue.includes(opt)) i++; // -u me, --signal KILL
      }
      if (x.endsWith('timeout')) i++; // timeout [options] <duration> <command>
      continue;
    }
    break;
  }
  if (i >= w.length) return [];
  const [cmd, ...rest] = w.slice(i);
  return [cmd.replace(/^.*\//, ''), ...rest]; // /usr/bin/git is git
}

// git [global options] <sub> <args>: the subcommand and its arguments.
function gitSub(rest) {
  let i = 0;
  let dir = null;
  while (rest[i]?.startsWith('-')) {
    if (rest[i] === '-C') dir = dir ? `${dir}/${rest[i + 1]}` : rest[i + 1];
    i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(rest[i]) ? 2 : 1;
  }
  return { sub: rest[i], args: rest.slice(i + 1), dir };
}

// gh [-R repo] <group> <action>
function ghSub(rest) {
  const args = rest.filter((a, k) => !(a.startsWith('-') || ['-R', '--repo'].includes(rest[k - 1])));
  return [args[0], args[1]];
}

function pushVerdict(args, dir = null) {
  const force = args.some((a) => /^--(force|force-with-lease|force-if-includes|mirror)(=|$)/.test(a) || /^-[A-Za-z]*f/.test(a))
    || args.filter((a) => !a.startsWith('-')).slice(1).some((a) => a.startsWith('+'));
  if (force) return { decision: 'deny', line: 'force-push', reason: 'Force pushes are never allowed from the dashboard.' };
  const positional = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (['-o', '--push-option', '--repo', '--receive-pack', '--exec'].includes(a)) { if (a === '--repo') positional.unshift(args[k + 1] ?? ''); k++; continue; }
    if (a.startsWith('--repo=')) { positional.unshift(a.slice(7)); continue; }
    if (!a.startsWith('-')) positional.push(a);
  }
  const remote = positional[0] ?? '';
  if (ORG_REMOTES.includes(remote) || ORG_URL.test(remote)) return { decision: 'deny', line: 'org-push', reason: 'Pushing to the org repository is never allowed from the dashboard. Push to your fork (origin) instead.' };
  // remote ('' when the command names none) and dir (git -C) let orgPushCheck() look up where a
  // remote with another name really points.
  return { decision: 'ask', line: 'git-push', reason: 'Pushing is a hard line: it always asks you, whatever the setting.', remote, dir };
}

function rmVerdict(args) {
  let r = false;
  let f = false;
  for (const a of args) {
    if (a === '--') break;
    if (a === '--recursive') r = true;
    else if (a === '--force') f = true;
    else if (/^-[A-Za-z]+$/.test(a)) { if (/[rR]/.test(a)) r = true; if (a.includes('f')) f = true; }
  }
  return r && f ? { decision: 'ask', line: 'rm-rf', reason: 'Deleting with rm -rf is a hard line: it always asks you, whatever the setting.' } : null;
}

const DB = { decision: 'ask', line: 'database', reason: 'Database migrations are a hard line: they always ask you, whatever the setting.' };

function dbVerdict(cmd, rest) {
  // Any word naming a db:* or migration script, wherever it sits (npm run --silent db:reset,
  // npm --prefix x run db:migrate, pnpm -C dir db:push, yarn workspace api db:push). Over-asking
  // (npm install some-migrate-tool) is fine; missing one is not.
  if (PKG.has(cmd) && rest.some((a) => DB_SCRIPT.test(a.replace(/^-[^=]*=/, '')))) return DB;
  const tool = cmd === 'npx' || cmd === 'bunx' || (cmd === 'pnpm' && rest[0] === 'exec') || (cmd === 'pnpm' && rest[0] === 'dlx')
    ? rest.filter((a) => !a.startsWith('-') && !['exec', 'dlx'].includes(a)) : [cmd, ...rest];
  const [t, a, b] = tool;
  if (t === 'prisma' && (a === 'migrate' || (a === 'db' && ['push', 'execute'].includes(b)))) return DB;
  if (t === 'drizzle-kit' && ['migrate', 'push', 'drop'].includes(a)) return DB;
  if (t === 'supabase' && ((a === 'db' && ['push', 'reset'].includes(b)) || a === 'migration')) return DB;
  if ((t === 'knex' || t === 'sequelize' || t === 'sequelize-cli') && /migrat/.test(a ?? '')) return DB;
  return null;
}

function judgeSimple(simple) {
  const all = words(simple);
  const verdict = judgeWords(strip(all));
  // Behind a wrapper (sudo, env, timeout, …) an option we don't know could hide the command, so
  // the raw text is searched too and the stricter answer kept.
  const first = all.find((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x));
  if (first && WRAPPERS.has(first.replace(/^.*\//, ''))) return strictest([verdict, judgeRaw(simple)]);
  return verdict;
}

function judgeWords(w) {
  if (!w.length) return null;
  const [cmd, ...rest] = w;
  if (cmd === 'git') {
    const { sub, args, dir } = gitSub(rest);
    return sub === 'push' ? pushVerdict(args, dir) : null;
  }
  if (cmd === 'gh') {
    const [group, action] = ghSub(rest);
    if (group === 'pr' && (action === 'create' || action === 'merge')) return { decision: 'ask', line: `gh-pr-${action}`, reason: `gh pr ${action} is a hard line: it always asks you, whatever the setting.` };
    return null;
  }
  if (cmd === 'rm') return rmVerdict(rest);
  return dbVerdict(cmd, rest);
}

// When the command can't be split into simple commands: search the raw text.
function judgeRaw(text) {
  if (/\bgit\b[^\n;&|]*\bpush\b/.test(text)) {
    const tail = text.slice(text.search(/\bpush\b/)).split(/[\n;&|)`]/)[0].replace(/["'\\]/g, ' ');
    return pushVerdict(words(tail).slice(1));
  }
  if (/\bgh\b[^\n;&|]*\bpr\s+(create|merge)\b/.test(text)) return { decision: 'ask', line: 'gh-pr', reason: 'Opening or merging a pull request is a hard line: it always asks you.' };
  if (/\brm\b[^\n;&|]*\s-(?:[A-Za-z]*[rR][A-Za-z]*f|[A-Za-z]*f[A-Za-z]*[rR])/.test(text) || /\brm\b[^\n;&|]*--recursive[^\n;&|]*--force|\brm\b[^\n;&|]*--force[^\n;&|]*--recursive/.test(text)) return rmVerdict(['-rf']);
  if (/\b(npm|pnpm|yarn|bun)\b[^\n;&|]*\b(db:|\S*migrat)/i.test(text) || /\b(prisma\s+(migrate|db\s+push)|drizzle-kit\s+(migrate|push)|supabase\s+(db\s+(push|reset)|migration))\b/.test(text)) return DB;
  return null;
}

const RANK = { deny: 2, ask: 1 };
const strictest = (verdicts) => verdicts.filter(Boolean).sort((a, b) => RANK[b.decision] - RANK[a.decision])[0] ?? null;

/**
 * Is this request on a hard line? Returns null, or { decision: 'ask' | 'deny', line, reason }.
 * Only shell commands (the Bash tool) are checked. With several, the strictest wins.
 */
export function hardLine(toolName, input = {}) {
  if (toolName !== 'Bash') return null;
  const command = String(input?.command ?? '');
  if (!command.trim()) return null;
  const parts = splitCommand(command);
  const verdicts = parts ? parts.map(judgeSimple) : [judgeRaw(command)];
  // A command we could split may still hide one where the splitter can't see (eval "git push").
  if (parts && /\b(eval|sh|bash|zsh)\b/.test(command)) verdicts.push(judgeRaw(command));
  const verdict = strictest(verdicts);
  if (verdict?.decision !== 'ask') return verdict;
  // Every push in the command, for orgPushCheck().
  const pushes = verdicts.filter((v) => v?.line === 'git-push').map((v) => ({ remote: v.remote ?? '', dir: v.dir ?? null }));
  return { ...verdict, pushes };
}

const ORG_PUSH = { decision: 'deny', line: 'org-push', reason: 'That remote points at the org repository, and pushing there is never allowed from the dashboard. Push to your fork (origin) instead.' };

function git(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 3000, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

/**
 * A remote named something other than "moxie" (upstream, org, …) can still point at the org repo.
 * Returns check(verdict, cwd): the verdict, turned into an org-push refusal when one of its pushes
 * goes to a remote whose push address is the org's. Asks `git remote get-url --push` in the job's
 * folder (or git -C's), remembering each answer for this reply. With no remote named, the branch's
 * push remote is looked up. When git can't answer, the push still asks you.
 * Not seen: a `cd` earlier in the same command (the lookup uses the job's folder).
 */
export function orgPushCheck() {
  const cache = new Map();
  const urlOf = async (remote, dir) => {
    const key = `${dir}\0${remote}`;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        let name = remote;
        if (!name) {
          const push = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{push}'], dir);
          name = push ? push.split('/')[0] : 'origin';
        }
        return git(['remote', 'get-url', '--push', name], dir);
      })());
    }
    return cache.get(key);
  };
  return async (verdict, cwd) => {
    if (verdict?.decision !== 'ask' || !verdict.pushes?.length || !cwd) return verdict;
    for (const { remote, dir } of verdict.pushes) {
      if (/[:/]/.test(remote)) continue; // an address, already judged
      const where = dir ? path.resolve(cwd, dir) : cwd;
      const url = await urlOf(remote, where);
      if (url && ORG_URL.test(url)) return ORG_PUSH;
    }
    return verdict;
  };
}

/**
 * The PreToolUse hook callback (SDK `hooks` option). onVerdict(verdict, input) is told about every
 * hard line it meets (the driver records refusals). Returns the hook's answer: 'ask' forces a
 * card, 'deny' refuses; anything else is left to the permission setting. check (from
 * orgPushCheck()) looks up where pushes really go; cwd is the job's folder when the hook input
 * has none.
 */
export function hardLineHook(onVerdict = () => {}, { check = orgPushCheck(), cwd = null } = {}) {
  return async (input) => {
    if (input?.hook_event_name !== 'PreToolUse') return {};
    let verdict = hardLine(input.tool_name, input.tool_input);
    if (!verdict) return {};
    try { verdict = await check(verdict, input.cwd || cwd); } catch { /* a failed lookup still asks */ }
    try { await onVerdict(verdict, input); } catch { /* recording must not change the answer */ }
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason } };
  };
}
