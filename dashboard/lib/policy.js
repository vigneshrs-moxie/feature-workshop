// Which tool requests are routine (handled automatically, and logged) and which need a person.
// Mirrors the workflow's own rules (workflow-gates.md): the stage go-ahead covers reading, writing the
// job's own records, and — once building is approved — edits, commits and read-only checks inside the
// job's worktree. Pushing, PRs, merges, migrations, database writes, servers, installs, deleting,
// network access and anything outside the job's folders always come to the person.
// When unsure, ask. Mode 'ask-all' asks about everything.

import path from 'node:path';

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'TodoWrite', 'TaskOutput', 'SendMessage', 'Agent', 'Task']);
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const BUILD_STAGES = new Set(['implement', 'test', 'review']);
const SPEC_STAGES = new Set(['spec', 'refine', 'spec-update']);

const inside = (p, dir) => {
  if (!p || !dir) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Read-only shell commands (first word), plus a few harmless helpers.
const READONLY_CMDS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'pwd', 'echo', 'printf', 'date', 'which', 'sort', 'uniq', 'cut', 'tr', 'jq', 'diff', 'test', '[', 'true', 'file', 'stat', 'du', 'basename', 'dirname', 'realpath', 'tree', 'nl', 'column', 'awk', 'sed', 'find', 'xargs']);
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'remote', 'ls-files', 'describe', 'blame', 'merge-base', 'for-each-ref', 'shortlog', 'cat-file', 'ls-tree', 'grep', 'fetch', 'reflog']);
const CHECK_SCRIPTS = /^(check|lint|typecheck|type-check|build|test|test:unit|format:check|lint:check)$/;

// Split a shell command into simple commands. Returns null when it uses features we won't judge
// automatically (command substitution, subshells, backgrounding, here-docs, pipes into a shell…).
export function splitCommand(cmd) {
  const s = String(cmd ?? '').trim();
  // Refuse: backticks, $( ), here-docs, eval/exec, piping into a shell, and a lone & (running in the background).
  if (!s || /`|\$\(|<<|\beval\b|\bexec\b|\|\s*(sh|bash|zsh|node|python3?)\b|(?<![&>])&(?![&>\d])/.test(s)) return null;
  return s.split(/&&|\|\||;|\n|\|/).map((x) => x.trim()).filter(Boolean);
}

function words(simple) {
  // Rough tokenising is fine: anything we can't read cleanly falls back to asking.
  return simple.match(/"[^"]*"|'[^']*'|\S+/g)?.map((w) => w.replace(/^['"]|['"]$/g, '')) ?? [];
}

// Output redirection is fine only to /dev/null or inside the allowed folders.
function redirectsOk(simple, allowedDirs) {
  const re = /(?:^|\s)\d?>{1,2}\s*([^\s]+)/g;
  let m;
  while ((m = re.exec(simple))) {
    const target = m[1];
    if (target === '/dev/null' || target.startsWith('&')) continue;
    if (!path.isAbsolute(target) || !allowedDirs.some((d) => inside(target, d))) return false;
  }
  return true;
}

function judgeSimple(simple, ctx) {
  const w = words(simple.replace(/(?:^|\s)\d?>{1,2}\s*[^\s]+/g, ' '));
  if (!w.length) return 'ok';
  // Leading environment assignments (FOO=bar cmd) are fine.
  while (w.length && /^[A-Z_][A-Z0-9_]*=/.test(w[0])) w.shift();
  const [cmd, ...rest] = w;
  const writable = ctx.writableDirs;
  if (cmd === 'cd') return !rest[0] || ctx.readableDirs.some((d) => inside(rest[0], d)) ? 'ok' : 'cd outside the job’s folders';
  if (cmd === 'mkdir') return rest.filter((a) => !a.startsWith('-')).every((a) => writable.some((d) => inside(a, d))) ? 'ok' : 'creates a folder outside the job’s folders';
  if (cmd === 'sed' && rest.some((a) => /^-i/.test(a))) return 'edits files in place';
  if (cmd === 'find' && rest.some((a) => /^-(delete|exec|execdir|ok)$/.test(a))) return 'find that deletes or runs commands';
  if (cmd === 'xargs') return 'runs commands from a list';
  if (cmd === 'awk' && /system\s*\(|>\s*"/.test(simple)) return 'awk that runs commands or writes files';
  if (READONLY_CMDS.has(cmd)) return 'ok';
  if (cmd === 'git') {
    // git -C <dir> <sub> …
    let i = 0;
    while (rest[i]?.startsWith('-')) i += rest[i] === '-C' || rest[i] === '-c' ? 2 : 1;
    const dirArg = rest.indexOf('-C') >= 0 ? rest[rest.indexOf('-C') + 1] : null;
    const sub = rest[i];
    const args = rest.slice(i + 1);
    if (GIT_READ.has(sub)) return 'ok';
    if (sub === 'branch' && !args.some((a) => /^-(d|D|m|M|c|C|f)$|--delete|--move|--force/.test(a))) return args.length && !args.every((a) => a.startsWith('-')) ? 'creates or renames a branch' : 'ok';
    if (sub === 'worktree' && args[0] === 'list') return 'ok';
    if (sub === 'worktree' && args[0] === 'add' && (ctx.stage === 'plan' || BUILD_STAGES.has(ctx.stage))) return 'ok';
    const inWorktree = ctx.worktrees.some((d) => (dirArg && inside(dirArg, d)) || inside(ctx.cwdHint ?? '', d));
    if ((sub === 'add' || sub === 'commit') && BUILD_STAGES.has(ctx.stage) && inWorktree) return 'ok';
    return `git ${sub ?? ''} needs your OK`.trim();
  }
  if ((cmd === 'npm' || cmd === 'pnpm' || cmd === 'yarn') && BUILD_STAGES.has(ctx.stage)) {
    const script = rest[0] === 'run' ? rest[1] : rest[0];
    if (rest[0] === 'test' || (rest[0] === 'run' && CHECK_SCRIPTS.test(script ?? ''))) return /db|e2e|integration|migrat/i.test(simple) ? 'touches a database or runs end-to-end tests' : 'ok';
    return `${cmd} ${rest[0] ?? ''} needs your OK`.trim();
  }
  if (cmd === 'npx' && BUILD_STAGES.has(ctx.stage) && /^(tsc|vitest|eslint|prettier|jest)$/.test(rest[0] ?? '') && !rest.includes('--write') && !rest.includes('--fix')) return 'ok';
  if (cmd === 'node' && rest[0] === '--test' && BUILD_STAGES.has(ctx.stage)) return 'ok';
  return `${cmd} needs your OK`;
}

/**
 * toolName, input: the request. ctx: { mode, stage, featureDir, worktrees[], repoPath, specDirs[], defaultToNo }
 * Returns { auto: boolean, reason }.
 */
export function classify(toolName, input = {}, ctx = {}) {
  if (ctx.mode === 'ask-all') return { auto: false, reason: 'You asked to approve every step.' };
  if (ctx.defaultToNo) return { auto: false, reason: 'Claude Code flagged this one as risky.' };
  if (toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') return { auto: false, reason: 'A question for you.' };
  if (READ_TOOLS.has(toolName)) return { auto: true, reason: toolName === 'Agent' || toolName === 'Task' ? 'The Foreman handing work to its crew.' : 'Reading only.' };
  if (String(toolName).startsWith('mcp__') || toolName === 'WebFetch' || toolName === 'WebSearch') return { auto: false, reason: 'Reaches outside your computer.' };

  const worktrees = (ctx.worktrees ?? []).filter(Boolean);
  const specDirs = (ctx.specDirs ?? []).filter(Boolean);
  const writableDirs = [ctx.featureDir, ...(BUILD_STAGES.has(ctx.stage) ? worktrees : []), ...(SPEC_STAGES.has(ctx.stage) ? specDirs : [])].filter(Boolean);
  const readableDirs = [ctx.featureDir, ctx.repoPath, ...worktrees, ...specDirs, ...(ctx.extraReadable ?? [])].filter(Boolean);

  if (EDIT_TOOLS.has(toolName)) {
    const file = input.file_path ?? input.notebook_path;
    if (!file) return { auto: false, reason: 'No file named.' };
    if (inside(file, ctx.featureDir)) return { auto: true, reason: 'Updating the job’s own records.' };
    if (BUILD_STAGES.has(ctx.stage) && worktrees.some((d) => inside(file, d))) return { auto: true, reason: 'Building in the job’s own worktree (you approved the plan).' };
    if (SPEC_STAGES.has(ctx.stage) && specDirs.some((d) => inside(file, d))) return { auto: true, reason: 'Writing the spec.' };
    return { auto: false, reason: 'Changes a file outside the job’s own folders.' };
  }

  if (toolName === 'Bash') {
    const parts = splitCommand(input.command);
    if (!parts) return { auto: false, reason: 'A complex command; please check it.' };
    if (!redirectsOk(input.command, writableDirs)) return { auto: false, reason: 'Writes output somewhere outside the job’s folders.' };
    const cdTarget = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)/.exec(input.command)?.[1]?.replace(/^['"]|['"]$/g, '');
    const local = { ...ctx, worktrees, writableDirs, readableDirs, cwdHint: cdTarget ?? ctx.cwd };
    for (const part of parts) {
      const verdict = judgeSimple(part, local);
      if (verdict !== 'ok') return { auto: false, reason: verdict[0].toUpperCase() + verdict.slice(1) + '.' };
    }
    return { auto: true, reason: 'A routine, safe command.' };
  }
  return { auto: false, reason: 'Not on the routine list.' };
}
