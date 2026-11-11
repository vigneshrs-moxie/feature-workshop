// Auto mode's fixed stop list: the things that always need the person, decided by code from facts,
// never by a model. If this code misses a case, an unattended job does the thing, so the rule is:
// when something can't be understood, it stops. Stopping too often is accepted; missing one is not.
//
// fixedStop(input, ctx) is a pure function of its input and ctx: no model, no network, no file reads
// beyond following symlinks to see where a path really lands. input is one of
//   { kind: 'gate', stage, nextStage }
//   { kind: 'card', toolName, input, hardLine, blockedPath }
//   { kind: 'job', level, suggestedLevel, triggers, stageState, statusCard, step, failures, problem }
// ctx = { worktrees, featureDir, specDirs, cwd, forkRemote, remoteUrl(name, dir), branches?, stateDir?, mainCheckout?, readRoots? }
//   mainCheckout is the repository's own checkout and readRoots the session's read folders (skills, agents):
//   places the job may read but not change.
//   remoteUrl(name, dir) is the push address of that remote in that folder ('' means the branch's own
//   push remote, as orgPushCheck looks it up), or null when git can't say. branches is the job's own
//   branch and its stack's parts, when known.
// It returns null or { rule, reason }: rule is one of AUTO_RULES, reason the sentence shown after
// "Auto stopped: ".
//
// The rules, by what a command does (see the tests for every case):
//   merge     gh pr merge; a gate past PR #1
//   database  a database client or migration tool, however it is wrapped; any .sql file given to a program
//   push      a git push whose remote is not the fork remote (a URL, no remote, another folder with
//             git -C, --repo, --all, --mirror, --tags, --delete, a refspec that lands on another branch)
//   outside   a write (an edit tool, a redirect, cp, mv, rm, tee, curl -o, git config --global, brew, kill, …)
//             that lands outside the worktrees, the job folder, the spec folders and the temp folders,
//             or where we can't tell; a gh or hub command that writes to a remote; a command whose
//             content is hidden (eval, a variable as the command, a here-document fed to a shell,
//             inline python or node code); a tool we don't know
// A deny hard line (a force push, an org push, the state folder) stays a refusal: it never reaches here.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { autoAllowed } from './auto.js';
import { classify, commandParts, isInside, TEMP_DIRS } from './policy.js';
import { hardLine, namesStarbaseAddress, namesThisComputer, ORG_REMOTES, ORG_URL, physicalPath, rmInsideJob, withPathMemo, WRAPPERS } from './hard-lines.js';
import { envCopy, gitReadForm, localPlain, plainWhy, psRead, starbaseDecisions } from './auto-plain.js';
import { STAGES, STAGE_IDS } from './stages.js';

export const AUTO_STOP_REASONS = Object.freeze({
  merge: 'merging a pull request needs you.',
  database: 'a database change needs you.',
  outside: "this would change or delete something outside the job's own folders.",
  push: 'this would push somewhere other than your fork.',
  level: 'the job is now L3, and L3 jobs need you to approve each step.',
  blocked: "the Foreman says it can't do the ticket as written.",
  status: "the Foreman can't write a valid status.json.",
  tool: 'this tool is not one Auto can judge.',
});

/** Tools known to only read (or to hand work to the crew, whose own calls come through the hook too). Any other tool on an Auto job stops. */
export const READ_ONLY_TOOLS = Object.freeze(new Set([
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite', 'TaskOutput', 'TaskGet', 'TaskList', 'TaskCreate', 'TaskUpdate',
  'BashOutput', 'ToolSearch', 'Skill', 'SendMessage', 'Agent', 'Task', 'AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode',
  'ListMcpResources', 'ReadMcpResource',
]));
/** Web lookups: what they send leaves the computer, so on an Auto job each one is a question for the Approver (C5). */
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'ReadMcpResource']);
// An address with a name and password in it (https://user:pass@host/).
const URL_CREDENTIALS = /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]*@/i;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const stop = (rule, extra = {}) => ({ rule, reason: AUTO_STOP_REASONS[rule], ...extra });
/** The outside rule's sentence when what happened is one of these (m14): the owner reads it in a notification. */
export const OUTSIDE_REASONS = Object.freeze({
  secret: 'this reads a place that holds secrets (keys, tokens or passwords), so it needs you.',
  unknown: 'this runs a program Auto does not know, so it needs you.',
  deploy: 'this would deploy or publish something, so it needs you.',
  read: 'this only reads, but in a way Auto cannot judge (another folder, a setting or a place it cannot work out), so it needs you.',
});

/** The job's own branch and its stack's part branches: the ones a push of Auto's may go to. */
export function branchesOf(branch, stack) {
  return [...new Set([branch, ...(stack?.sections ?? []).map((x) => x?.branch)].filter((b) => typeof b === 'string' && b))];
}

export const ASK_REASON = "Auto can't tell what this command does, so it needs an answer.";

/**
 * The three answers for a tool call on an Auto job:
 *   { verdict: 'stop', rule, reason, … }  a fixed rule matches: Auto stops and the person answers
 *   { verdict: 'ask', why }               Starbase can't tell what the call does (it is not plain): a card
 *                                         that nothing answers by itself
 *   null                                  plain: Starbase understands every word of it
 * Gates and jobs have only stops (see fixedStop). Throws on a malformed input (the hook then asks).
 */
export function autoVerdict(input, ctx = {}) {
  if (input?.kind !== 'card') {
    const s = fixedStop(input, ctx);
    return s ? { verdict: 'stop', ...s } : null;
  }
  const r = judgeCard(input, ctx);
  if (!r) return null;
  return r.stop ? { verdict: 'stop', ...r.stop } : { verdict: 'ask', why: r.ask };
}

/** autoVerdict as the hook and the driver use it: the stop object, or { rule: null, ask: true, why, reason } for an ask, or null. */
export function autoAnswer(input, ctx = {}) {
  const v = autoVerdict(input, ctx);
  if (!v) return null;
  if (v.verdict === 'ask') return { rule: null, ask: true, why: v.why, reason: ASK_REASON };
  const { verdict, ...stopObject } = v; // eslint-disable-line no-unused-vars
  return stopObject;
}

/** The fixed stop rules. Returns { rule, reason } or null. For a tool call it answers only for a stop: a call that is not plain
 *  (an ask) comes back null here; autoVerdict tells the two apart. Throws on a malformed input (the hook then asks). */
export function fixedStop(input, ctx = {}) {
  switch (input?.kind) {
    case 'gate': return gateStop(input);
    case 'job': return jobStop(input);
    case 'card': return judgeCard(input, ctx)?.stop ?? null;
    default: throw new TypeError('fixedStop: unknown kind');
  }
}

// ---------- gate and job ----------

function gateStop({ nextStage }) {
  const at = STAGE_IDS.indexOf(nextStage);
  const pr1 = STAGE_IDS.indexOf('pr1');
  // Auto finishes at PR #1: a gate to anything after it (or to something unknown) is the merge rule.
  return at >= 0 && at <= pr1 ? null : stop('merge');
}

const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label ?? String(id ?? 'this');

function jobStop(j) {
  const ids = (j.triggers ?? []).map((t) => (typeof t === 'string' ? t : t?.id));
  if (ids.includes('migrations')) return stop('database');
  if (!autoAllowed({ level: j.level ?? null, suggestedLevel: j.suggestedLevel ?? null }).ok) return stop('level');
  if ((j.step?.count ?? 0) >= 3) return { rule: 'loop', reason: `the ${stageLabel(j.step.stage)} step came back for approval three times without moving on.` };
  if ((j.failures ?? 0) >= 2) return { rule: 'approver', reason: `the Approver failed twice running (${j.problem ?? 'no usable answer'}).` };
  if (j.stageState === 'blocked') return stop('blocked');
  if (j.statusCard) return stop('status');
  return null;
}

// ---------- card ----------

const PRIORITY = ['merge', 'database', 'push', 'outside'];

// { stop } | { ask: why } | null
function judgeCard(inp, ctx) {
  return withPathMemo(() => judgeCardOf(inp, ctx));
}

function judgeCardOf(inp, ctx) {
  const toolName = inp.toolName;
  const input = inp.input ?? {};
  // A command too long to read, or made of too many commands, stops without being read (I9).
  if (toolName === 'Bash' && tooBig(String(input.command ?? ''))) return { stop: stop('outside') };
  const own = hardLine(toolName, input, { cwd: ctx.cwd ?? null, stateDir: ctx.stateDir });
  const hard = inp.hardLine ?? own;
  if (own?.decision === 'deny' || hard?.decision === 'deny') return null; // refused outright, never asked
  if (typeof inp.blockedPath === 'string' && inp.blockedPath) return { stop: stop('outside') };
  // A secret place named by any tool (T3a).
  if (toolName !== 'Bash' && toolPaths(input).some((x) => secretPlace(physicalPath(x, ctx.cwd ?? null), jobRoots(ctx), ctx))) return { stop: stop('outside', { reason: OUTSIDE_REASONS.secret }) };
  // A search whose root is outside the job's folders can read anything under it (C1).
  if (toolName === 'Grep' || toolName === 'Glob') {
    const roots = [...jobRoots(ctx), ...readFolders(ctx)]; // the skills and agents folders hold no secrets; the main checkout does (.env)
    const where = [input.path, /^[/~]/.test(String(input.pattern ?? '')) && toolName === 'Glob' ? input.pattern : null].filter((x) => typeof x === 'string' && x);
    if (where.some((x) => !inRoots(physicalPath(x, ctx.cwd ?? null), roots))) return { ask: 'a search that starts outside the job' };
  }
  if (EDIT_TOOLS.has(toolName)) {
    const file = input.file_path ?? input.notebook_path;
    const where = typeof file === 'string' ? physicalPath(file, ctx.cwd ?? null) : null;
    if (!(where && inRoots(where, jobRoots(ctx))) || codeLater(where, codeRoots(ctx)) || autoRecordFile(where, ctx)) return { stop: stop('outside') };
    if (/[\\/]node_modules[\\/]\.bin[\\/]/.test(where)) return { ask: 'a program in node_modules/.bin that a plain command would then run' }; // N19
    return ASK_FILES.has(path.basename(where)) ? { ask: 'a file that changes how tools run' } : null;
  }
  if (toolName === 'Bash') return bashVerdict(String(input.command ?? ''), hard, ctx);
  // A helper sent to run elsewhere: its calls leave the computer, and the hook does not follow them (m10).
  if ((toolName === 'Agent' || toolName === 'Task') && input.isolation === 'remote') return { stop: stop('outside') };
  if (WEB_TOOLS.has(toolName)) return URL_CREDENTIALS.test(String(input.url ?? '').trim()) ? { stop: stop('outside') } : { ask: 'a web lookup: what it sends leaves the computer' };
  // A read in the home folder (or on another disk) outside the job's folders, its repository and the session's read folders asks (C5).
  if (READ_TOOLS.has(toolName) && toolPaths(input).some((x) => readElsewhere(physicalPath(x, ctx.cwd ?? null), readRoots(ctx)))) return { ask: 'a read outside the job\'s folders' };
  if (READ_ONLY_TOOLS.has(toolName)) return null;
  return { stop: stop('tool', { unknownTool: true }) };
}

// ---------- secret places (T3a) and files that run code later (T3h) ----------

const SECRET_DIRS = ['.ssh', '.aws', '.gnupg', '.config/gh', '.config/gcloud', '.azure', '.docker', '.kube', '.starbase', 'Library/Keychains'];
const SECRET_FILES = ['.claude.json', '.netrc', '.npmrc', '.pypirc', '.git-credentials', '.zsh_history', '.bash_history'];
const SECRET_NAME = /^(\.env(\..*)?|id_rsa.*|id_ed25519.*|.*\.(pem|key|p12))$/i;
const MAC = process.platform === 'darwin';
const fold = (x) => (MAC ? String(x).toLowerCase() : String(x));
const homes = () => [...new Set([os.homedir(), physicalPath(os.homedir(), null)].filter(Boolean))];

/** Is this resolved path a secret place? (null: not known, not a secret.) */
function secretPlace(p, roots, ctx = {}) {
  if (!p) return false;
  const q = fold(p);
  for (const h of homes()) {
    if (SECRET_DIRS.some((d) => isInside(q, fold(path.join(h, d)))) || SECRET_FILES.some((f) => q === fold(path.join(h, f)))) return true;
    if (claudeSecret(q, h, ctx)) return true;
  }
  if (typeof ctx.stateDir === 'string' && ctx.stateDir && isInside(q, fold(ctx.stateDir))) return true;
  return SECRET_NAME.test(path.basename(p)) && !inRoots(p, roots);
}

// ~/.claude is a secret place, but for the job's own folder and the session's read folders (skills, agents) when
// they sit there (I1); its sign-in (.credentials.json) and every settings*.json under it stay secret wherever they are.
function claudeSecret(q, home, ctx) {
  const dir = fold(path.join(home, '.claude'));
  if (!isInside(q, dir)) return false;
  if (q === fold(path.join(home, '.claude', '.credentials.json')) || /^settings[^/]*\.json$/.test(path.basename(q))) return true;
  const open = [ctx.featureDir, ...(ctx.readRoots ?? [])].filter((r) => typeof r === 'string' && path.isAbsolute(r));
  return !open.some((r) => [path.resolve(r), physicalPath(r, null)].filter(Boolean).some((x) => fold(x) !== dir && isInside(q, fold(x))));
}

// The path-like fields of a tool's input.
function toolPaths(input) {
  const out = [];
  for (const k of ['file_path', 'notebook_path', 'path']) if (typeof input?.[k] === 'string') out.push(input[k]);
  if (typeof input?.pattern === 'string' && /^[/~]/.test(input.pattern)) out.push(input.pattern);
  if (typeof input?.uri === 'string' && /^file:\/\//i.test(input.uri)) { try { out.push(decodeURIComponent(new URL(input.uri).pathname)); } catch { out.push(input.uri.slice(7)); } } // a file:// resource (N16)
  return out;
}

// Does a path sit where a file runs code later or elsewhere: .git/, .github/workflows/, .husky/, .claude/, .mcp.json?
// It is read from the root the path sits in (the deepest of roots), so a .claude above the job's folder does not count (I1).
function codeLater(p, roots = []) {
  if (!p) return false;
  const root = roots.filter((r) => isInside(p, r) && p !== r).sort((a, b) => b.length - a.length)[0];
  const segs = (root ? path.relative(root, p) : p).toLowerCase().split(/[\\/]/); // a Mac's disk does not tell .GIT from .git
  if (segs.some((x) => x === '.git' || x === '.husky' || x === '.claude' || x === '.githooks') || ['.mcp.json', 'lefthook.yml'].includes(segs[segs.length - 1])) return true;
  return segs.some((x, k) => x === '.github' && (segs[k + 1] === 'workflows' || segs[k + 1] === 'actions'));
}
// The job folder's options.json and auto-log.md are Starbase's (the level, Auto's own lines): a job never writes them (I8).
function autoRecordFile(p, ctx) {
  if (!p || typeof ctx.featureDir !== 'string' || !path.isAbsolute(ctx.featureDir)) return false;
  const dirs = [path.resolve(ctx.featureDir), physicalPath(ctx.featureDir, null)].filter(Boolean).map(fold);
  return ['options.json', 'auto-log.md'].some((n) => dirs.some((d) => fold(p) === path.join(d, n)));
}
const ASK_FILES = new Set(['.npmrc', '.envrc', '.yarnrc', '.yarnrc.yml', '.pypirc']);

const MAX_COMMAND = 20_000;
const MAX_SIMPLE = 200;
const tooBig = (command) => command.length > MAX_COMMAND || command.split(/&&|\|\||[;&|\n]/).filter((x) => x.trim()).length > MAX_SIMPLE;

// The folders a job may change: its worktrees, record folder, spec folders and the temp folders, as
// written and as they really are (/tmp is /private/tmp on a Mac).
// A root that is /, the home folder or a folder above it, the state folder or a folder above it, or
// ~/.claude itself, is never one: everything the job must not touch would be inside it (C1).
function jobRoots(ctx) {
  const temps = Array.isArray(ctx.tempDirs) ? ctx.tempDirs : TEMP_DIRS; // ctx.tempDirs: tests whose folders all sit in a temp folder
  const roots = [...(ctx.worktrees ?? []), ctx.featureDir, ...(ctx.specDirs ?? []), ...temps].filter((r) => typeof r === 'string' && path.isAbsolute(r));
  const out = new Set();
  for (const r of roots) {
    const forms = [path.resolve(r), physicalPath(r, null)].filter(Boolean);
    // The temp folders are Starbase's own list, never a job's word; a state folder kept inside one (tests do) is still refused by its own rules.
    if (forms.some((x) => tooWideRoot(x, temps.includes(r) ? {} : ctx))) continue;
    for (const x of forms) out.add(x);
  }
  return [...out];
}
export function tooWideRoot(r, ctx = {}) {
  const q = fold(r);
  if (q === fold(path.parse(q).root)) return true;
  for (const h of homes()) if (isInside(fold(h), q) || q === fold(path.join(h, '.claude'))) return true;
  const state = typeof ctx.stateDir === 'string' && ctx.stateDir ? [ctx.stateDir, physicalPath(ctx.stateDir, null)].filter(Boolean) : [];
  return state.some((s) => isInside(fold(s), q));
}
// The roots codeLater measures from: the worktrees, the job folder and the temp folders, never a spec folder (N1).
const codeRoots = (ctx) => jobRoots({ ...ctx, specDirs: [] });
// The roots git may change something in: the job's worktrees alone. A spec folder sits in the owner's main checkout, and
// git there acts on the whole checkout (R1).
const gitRoots = (ctx) => jobRoots({ ...ctx, featureDir: null, specDirs: [], tempDirs: [] });
const inRoots = (p, roots, strict = false) => roots.some((r) => isInside(p, r) && !(strict && p === r));

// The session's read folders (skills, agents), as written and as they really are.
function readFolders(ctx) {
  const own = (ctx.readRoots ?? []).filter((r) => typeof r === 'string' && path.isAbsolute(r)).flatMap((r) => [path.resolve(r), physicalPath(r, null)].filter(Boolean)).filter((x) => !tooWideRoot(x, ctx));
  return [...new Set([...own, ...own.flatMap((r) => linkLandings(r, own, ctx))])];
}

// Where each entry of a read folder that is a link really lands (skills and agents are often installed as links into a
// checkout): read once a minute per folder. A landing in a secret place, in ~/.claude outside the read folders, or at /
// or the home folder (or above it) is left out (N9).
const landingsCache = new Map(); // folder -> { at, list }
function linkLandings(dir, own, ctx) {
  const hit = landingsCache.get(dir);
  let list = hit && Date.now() - hit.at < 60_000 ? hit.list : null;
  if (!list) {
    list = [];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { entries = []; }
    for (const e of entries.slice(0, 500)) {
      if (!e.isSymbolicLink()) continue;
      try { list.push(fs.realpathSync(path.join(dir, e.name))); } catch { /* a link that goes nowhere */ }
    }
    landingsCache.set(dir, { at: Date.now(), list });
  }
  return list.filter((p) => {
    if (tooWideRoot(p, ctx) || secretPlace(p, [], ctx)) return false;
    const q = fold(p);
    const inClaude = homes().some((h) => isInside(q, fold(path.join(h, '.claude'))));
    return !inClaude || own.some((r) => isInside(q, fold(r)));
  });
}

// The places a job may read without a question: its own roots, the repository's main checkout and the
// session's read folders (skills, agents). Secret places are judged apart and stop wherever they are.
function readRoots(ctx) {
  const out = new Set(jobRoots(ctx));
  for (const r of [ctx.mainCheckout]) {
    if (typeof r !== 'string' || !path.isAbsolute(r)) continue;
    const forms = [path.resolve(r), physicalPath(r, null)].filter(Boolean);
    if (forms.some((x) => tooWideRoot(x, ctx))) continue;
    for (const x of forms) out.add(x);
  }
  for (const x of readFolders(ctx)) out.add(x); // the read folders, and where their linked entries land (N9)
  return [...out];
}
/** Is this resolved path a read that asks: under the home folder or /Volumes and outside the read roots? (null: not known, it asks.) */
function readElsewhere(p, roots) {
  if (!p) return true;
  const q = fold(p);
  const far = homes().some((h) => isInside(q, fold(h))) || isInside(q, fold('/Volumes'));
  return far && !roots.some((r) => isInside(q, fold(r)));
}

// A Bash call: a fixed stop if a rule matches; else an ask if it is not plain; else null (pass).
function bashVerdict(command, hard, ctx) {
  // The workflow's set-up lines, in their exact forms, from the main checkout or a folder of the job's (N7).
  const setup = setupStep(command, ctx);
  if (setup) return setup === true ? null : { ask: setup };
  const st = { ctx, asks: [], cdTargets: [], hits: new Set(), unknown: false, ranRunner: false, ranMake: false, pkgEdit: false, runs: [], written: [], touched: [], cloneDirs: [], branchChange: false, pushed: false, funcs: functionNames(command), roots: jobRoots(ctx), codeRoots: codeRoots(ctx), gitRoots: gitRoots(ctx), readRoots: readRoots(ctx), work: [...(ctx.worktrees ?? []), ctx.cwd].filter(Boolean).map((d) => physicalPath(d, null)).filter(Boolean) };
  if (hard?.line === 'gh-pr-merge') st.hits.add('merge');
  if (hard?.line === 'database') st.hits.add('database');
  if (DB_ADDRESS.test(command)) st.hits.add('database'); // a database address anywhere in the call
  analyze(command, ctx.cwd ?? null, st, 0, null);
  // A branch changed and a push in one call: where the push goes can't be told from here (C3).
  if (st.branchChange && st.pushed) st.hits.add('push');
  if (st.gitSetting && st.pushed) st.hits.add('push'); // a git setting changed and a push in one call: the remembered lookups are stale (I6)
  // A file this call writes and then runs, and what a clone just brought in, are not known (I8, C1).
  if (st.runs.some((r) => st.written.includes(r)) || st.cloneDirs.some((d) => st.touched.some((p) => p !== d && isInside(p, d)))) st.hits.add('outside');
  const verdict = classify('Bash', { command }, { mode: 'hands-off', stage: 'implement', worktrees: ctx.worktrees ?? [], specDirs: ctx.specDirs ?? [], featureDir: ctx.featureDir ?? null, cwd: ctx.cwd ?? null, rules: [] });
  if (verdict.outside) st.hits.add('outside');
  // package.json or a Makefile written and a runner started in one call (T3e).
  const wroteBase = (names) => st.pkgEdit && names.includes('package.json') || st.written.some((w) => names.includes(path.basename(w)));
  if ((st.ranRunner && wroteBase(['package.json'])) || (st.ranMake && wroteBase(['Makefile', 'makefile', 'GNUmakefile']))) st.hits.add('outside');
  const rule = PRIORITY.find((r) => st.hits.has(r));
  if (rule) {
    const why = rule !== 'outside' ? null : st.deploy ? OUTSIDE_REASONS.deploy : st.secret ? OUTSIDE_REASONS.secret : st.unknown ? OUTSIDE_REASONS.unknown : !st.nonRead ? OUTSIDE_REASONS.read : null;
    return { stop: stop(rule, { ...(rule === 'outside' && st.unknown ? { unknownProgram: true } : {}), ...(why ? { reason: why } : {}) }) };
  }
  const why = st.asks[0] ?? plainWhy(command, plainEnv(st, ctx.cwd ?? null));
  return why ? { ask: why } : null;
}

/**
 * The workflow's set-up, before the job's worktree exists, run from the repository's main checkout (or a folder of the
 * job's), as one command with nothing else (N7). true (plain) for:
 *   git fetch <fork|org remote> [--prune]
 *   git ls-remote --heads <fork|org remote> <a branch name>
 *   git worktree add -b <branch> <the profile's place for this job or a stack part> <org remote>/main (or its default)
 *     where the branch is never main, master, staging, develop or the org default, and no worktree git lists has it;
 * the Approver's reason for the exact org-branch call (an ask, as from the worktree); null for anything else.
 */
function setupStep(command, ctx) {
  const at = typeof ctx.cwd === 'string' && ctx.cwd ? physicalPath(ctx.cwd, null) : null;
  const main = typeof ctx.mainCheckout === 'string' ? physicalPath(ctx.mainCheckout, null) : null;
  if (!at || !((main && at === main) || inRoots(at, jobRoots(ctx)))) return null;
  const parts = commandParts(command, ctx.cwd);
  // One form, or two of the git forms joined by && (R4): each half is judged by its own form, and one wrong half is the whole line's.
  if (!parts || !(parts.length === 1 || (parts.length === 2 && parts[0].sep === '&&')) || parts.some((p) => p.sub || (p.redirects ?? []).length || p.words.some((w) => w.dyn))) return null;
  const answers = parts.map((p) => setupForm(p.words.map((x) => x.t), at, main, ctx));
  if (parts.length === 1) return answers[0];
  return answers.every((x) => x === true) ? true : null;
}

// One set-up form. A leading -C names the main checkout and nothing else (R4).
function setupForm(words, at, main, ctx) {
  let w = words;
  let here = at;
  if (w[0] === 'git' && w[1] === '-C') {
    const d = w[2] ? physicalPath(w[2], at) : null;
    if (!d || !main || d !== main) return null;
    here = main;
    w = ['git', ...w.slice(3)];
  }
  const remotes = [ctx.forkRemote || 'origin', ctx.orgRemote].filter((r) => typeof r === 'string' && r && (() => { try { return Boolean(ctx.remoteUrl?.(r)); } catch { return false; } })());
  const branchName = (b) => /^[A-Za-z0-9][\w./-]*$/.test(b) && !b.split('/').includes('..') && !b.endsWith('/') && !b.endsWith('.lock');
  if (w[0] === 'git' && w[1] === 'fetch' && (w.length === 3 || (w.length === 4 && w[3] === '--prune')) && remotes.includes(w[2])) return true;
  if (w[0] === 'git' && w[1] === 'ls-remote' && w.length === 5 && w[2] === '--heads' && remotes.includes(w[3]) && branchName(w[4])) return true;
  if (w[0] === 'git' && w[1] === 'worktree' && w[2] === 'add' && w[3] === '-b' && w.length === 7) {
    const s = ctx.setup ?? {};
    const [branch, place, start] = w.slice(4);
    const where = physicalPath(place, here);
    const places = (s.worktrees ?? []).map((x) => physicalPath(x, null)).filter(Boolean);
    const never = PROTECTED.test(branch) || /^(main|master|staging|develop)$/i.test(branch) || (s.never ?? []).includes(branch);
    if (where && places.includes(where) && (s.starts ?? []).includes(start) && branchName(branch) && !never && !(s.taken ?? []).includes(branch)) return true;
    return null;
  }
  if (words === w && w[0] === 'gh' && w[1] === 'api' && main && at === main) { const why = orgBranchCall(w.slice(2), ctx); if (why) return why; }
  return null;
}

// Plain: Starbase understands every word of the command (lib/auto-plain.js).
const plainEnv = (st, cwd) => ({ cwd: cwd ?? st.hint ?? st.ctx.cwd ?? null, roots: st.roots, ctx: st.ctx, binBase: st.scriptBin ?? null });

// Names a command defines as shell functions (their bodies are read as commands; a use of one is not an unknown program).
function functionNames(command) {
  const out = new Set();
  for (const m of command.matchAll(/(?:^|[;&|\n{(]\s*)(?:function\s+)?([A-Za-z_][\w.-]*)\s*\(\s*\)/g)) out.add(m[1]);
  for (const m of command.matchAll(/(?:^|[;&|\n{(]\s*)function\s+([A-Za-z_][\w.-]*)/g)) out.add(m[1]);
  return out;
}

// ---------- reading a command ----------

const words = (text) => {
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
};
const name = (x) => x.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
const SQL = /\.sql$/i;
const DB_ADDRESS = /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?):\/\//i;

// Splits a command we could not read properly (backticks, comments, here-documents, a trailing &) at
// ; & | ( ) and newlines outside quotes, lifting $( … ) and `…` out to be read on their own.
function rawSplit(src) {
  const pieces = [];
  const inner = [];
  let cur = '';
  let q = null;
  const flush = () => { if (cur.trim()) pieces.push(cur.trim()); cur = ''; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (q === "'") { cur += c; if (c === "'") q = null; continue; }
    if (c === '\\') { cur += c + (n ?? ''); i++; continue; }
    if (c === '$' && n === '(') {
      let d = 1;
      let j = i + 2;
      for (; j < src.length && d > 0; j++) { if (src[j] === '(') d++; else if (src[j] === ')') d--; }
      inner.push(src.slice(i + 2, d === 0 ? j - 1 : j));
      cur += '$SUB';
      i = j - 1;
      continue;
    }
    if (c === '`') {
      const j = src.indexOf('`', i + 1);
      const end = j < 0 ? src.length : j;
      inner.push(src.slice(i + 1, end));
      cur += '$SUB';
      i = end;
      continue;
    }
    if (q === '"') { cur += c; if (c === '"') q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '&' && (n === '>' || src[i - 1] === '>' || src[i - 1] === '<')) { cur += c; continue; }
    if (';&|\n()'.includes(c)) { flush(); continue; }
    cur += c;
  }
  flush();
  return { pieces, inner };
}

// Words and redirections of one raw piece: the same shape commandParts gives.
function rawWords(piece) {
  const ws = [];
  const redirects = [];
  const all = words(piece);
  for (let i = 0; i < all.length; i++) {
    if (/^<<-?$/.test(all[i])) { i++; continue; } // a here-document's end word
    if (/^<<-?\S/.test(all[i])) continue;
    const input = /^<([^<].*)?$/.exec(all[i]);
    if (input) { const target = input[1] || all[++i] || ''; redirects.push({ op: '<', target, dyn: target.includes('$') }); continue; }
    const m = /^(?:\d+|&)?(>{1,2}\|?|<>)(.*)$/.exec(all[i]);
    if (!m) { ws.push({ t: all[i], dyn: all[i].includes('$') }); continue; }
    if (m[2].startsWith('&')) continue; // 2>&1
    const target = m[2] || all[++i] || '';
    redirects.push({ op: '>', target, dyn: target.includes('$') });
  }
  return { ws, redirects };
}

function analyze(command, cwd, st, depth, viaXargs) {
  if (depth > 4) { st.hits.add('outside'); return; }
  // The hard lines' own reading of the same text (it also looks inside bash -c and eval).
  const h = hardLine('Bash', { command }, { cwd });
  if (h?.line === 'gh-pr-merge') st.hits.add('merge');
  if (h?.line === 'database') st.hits.add('database');
  const parts = commandParts(command, cwd);
  const noCd = !/\b(cd|pushd|popd)\b/.test(command); // with no cd in it, every command runs where the session does
  if (parts) {
    // Where each command may run (C2). A cd moves the commands joined to it by an unbroken && chain;
    // after any other separator the cd may have failed (or been skipped), so a later command is judged
    // in the folder before it as well as the one it names, and the stricter answer is kept (st.hits
    // gathers both). A plain `cd name` is taken as that folder (CDPATH is not set in a plain call).
    let lost = false; // where later commands run is no longer known (pushd, popd, a cd behind a wrapper)
    let cands = [cwd]; // the folders the next command may run in (null: not known)
    let open = []; // the folders before each cd of the && chain now running
    let chainOk = true; // the next command starts a list, or follows only && since its start
    for (const part of parts) {
      if (part.sub) { st.hint = noCd ? cwd : null; simple(part.words, part.redirects ?? [], null, st, depth, viaXargs); continue; }
      const ws = part.words.filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w.t));
      for (const c of lost ? [null] : cands) { st.hint = c; simple(part.words, part.redirects ?? [], c, st, depth, viaXargs); }
      const isCd = ws[0]?.t === 'cd';
      if (ws[0]?.t === 'pushd' || ws[0]?.t === 'popd' || (!isCd && ws.some((w) => /^(cd|pushd|popd)$/.test(w.t)))) lost = true;
      if ((isCd || ws[0]?.t === 'pushd') && ws.length === 2 && !ws[1].dyn) for (const c of cands) { const at = physicalPath(ws[1].t, c ?? cwd); if (at) st.cdTargets.push(at); }
      let next = cands;
      if (isCd) {
        const targets = cands.map((c) => cdWhere(ws, c));
        if (chainOk && part.sep === '&&') { open.push(...cands); next = targets; } else next = [...cands, ...targets];
      }
      if (part.sep !== '&&') { next = [...open, ...next]; open = []; chainOk = part.sep === ';' || part.sep === null; }
      cands = [...new Set(next)];
      if (cands.length > 8) lost = true;
    }
    return;
  }
  const { pieces, inner } = rawSplit(command);
  for (const piece of pieces) { const { ws, redirects } = rawWords(piece); st.hint = noCd ? cwd : null; simple(ws, redirects, null, st, depth, viaXargs); }
  for (const s of inner) analyze(s, null, st, depth + 1, viaXargs);
}

// Where `cd <word>` (the words without assignments) goes from folder c: absolute, or null when not known.
function cdWhere(ws, c) {
  if (ws.length === 1) return os.homedir();
  if (ws.length !== 2 || ws[1].dyn || ws[1].t.startsWith('-')) return null;
  const t = ws[1].t;
  if (t === '~' || t.startsWith('~/')) return path.join(os.homedir(), t.slice(1));
  if (t.startsWith('~')) return null;
  if (path.isAbsolute(t)) return path.resolve(t);
  return c ? path.resolve(c, t) : null;
}

// Wrappers beyond hard-lines' list. Each maps to its options that take a value.
const EXTRA_WRAPPERS = new Map([['setsid', []], ['stdbuf', ['-i', '-o', '-e']], ['watch', ['-n', '--interval']], ['ionice', ['-c', '-n', '-p']], ['unbuffer', []], ['arch', []], ['doas', ['-u', '-C']], ['chronic', []], ['sudoedit', []]]);

function unwrap(ws, st, cwd, depth) {
  let i = 0;
  const assigns = [];
  const wrappers = [];
  for (;;) {
    const x = ws[i];
    if (!x) break;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(x.t)) { assigns.push(x.t); i++; continue; }
    const wrapper = name(x.t);
    const takes = WRAPPERS.get(wrapper) ?? EXTRA_WRAPPERS.get(wrapper);
    if (!takes) break;
    wrappers.push(wrapper);
    i++;
    while (ws[i]?.t.startsWith('-') && ws[i].t !== '-') {
      const opt = ws[i++].t;
      if (opt === '--') break;
      if (takes.includes(opt)) {
        const v = ws[i++];
        if (wrapper === 'env' && (opt === '-S' || opt === '--split-string') && v) analyze(v.t, cwd, st, depth + 1, null); // a command inside the option
      }
      if (wrapper === 'env' && /^--split-string=/.test(opt)) analyze(opt.slice(15), cwd, st, depth + 1, null);
    }
    if (wrapper === 'timeout') i++; // the duration
  }
  return { rest: ws.slice(i), assigns, wrappers };
}

// ---------- the programs ----------

const DB_CLIENTS = new Set(['psql', 'pgcli', 'pg_restore', 'pg_dump', 'pg_dumpall', 'createdb', 'dropdb', 'createuser', 'dropuser', 'mysql', 'mysqldump', 'mysqlsh', 'mariadb', 'mariadb-dump', 'sqlite', 'sqlite3', 'litecli', 'mongosh', 'mongo', 'mongorestore', 'mongodump', 'redis-cli', 'cqlsh', 'sqlcmd', 'sqlplus', 'usql', 'clickhouse-client', 'duckdb', 'alembic', 'flyway', 'liquibase', 'dbmate', 'goose', 'atlas', 'bq', 'tsql', 'isql', 'turso', 'pscale', 'drizzle-kit']);
const RUNNERS = new Set(['iex', 'elixir', 'mix', 'npx', 'bunx', 'pnpx', 'npm', 'pnpm', 'yarn', 'bun', 'dlx', 'exec', 'uvx', 'poetry', 'pipenv', 'bundle']);
const EXEC_LIKE = new Set(['docker', 'podman', 'nerdctl', 'kubectl', 'oc', 'ssh', 'heroku', 'fly', 'flyctl', 'railway', 'vercel', 'nix-shell', 'direnv', 'devbox', 'doppler', 'dotenv', 'op', 'aws', 'gcloud', 'az']);
// Programs that only print their arguments or move files about: a client's name among them is just text.
const TEXTY = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'echo', 'printf', 'cat', 'head', 'tail', 'less', 'more', 'ls', 'man', 'which', 'whereis', 'type', 'sed', 'awk', 'wc', 'stat', 'file', 'git', 'gh', 'hub', 'npm', 'pnpm', 'yarn', 'bun', 'brew', 'cp', 'mv', 'rm', 'touch', 'mkdir', 'tee', 'code', 'vim', 'nano', 'open', 'diff', 'cmp', 'basename', 'dirname', 'realpath', 'test', '[', 'read']);

function dbTool(t, rest) {
  const r = rest.filter((x) => typeof x === 'string');
  switch (t) {
    case 'prisma': { const sub = r.find((x) => !x.startsWith('-')); return Boolean(sub) && !['generate', 'format', 'validate', 'version'].includes(sub); }
    case 'typeorm': case 'mikro-orm': return r.some((x) => /^(schema:|migration)|^query$/.test(x));
    case 'cockroach': case 'dolt': return r.some((x) => /^sql/.test(x));
    case 'mix': return r.some((x) => /^ecto(\.|$)/.test(x));
    case 'php': case 'artisan': { const k = t === 'artisan' ? -1 : r.findIndex((x) => /(^|\/)artisan$/.test(x)); return (t === 'artisan' || k >= 0) && r.slice(k + 1).some((x) => /^(migrate|db)(:|$)/.test(x)); }
    case 'flask': return r.includes('db');
    case 'wrangler': return r.includes('d1');
    case 'heroku': return r.some((x) => /^pg(:|$)/.test(x));
    case 'aws': return r.some((x) => /^rds/.test(x));
    case 'gcloud': return r.includes('sql');
    case 'az': return r.some((x) => /^(sql|mysql|postgres|cosmosdb|redis)$/.test(x));
    case 'supabase': return r.some((x) => x === 'db' || x === 'migration');
    case 'knex': case 'sequelize': case 'sequelize-cli': case 'alembic': case 'flyway': case 'liquibase': case 'dbmate': case 'goose': case 'sqitch': case 'atlas': case 'node-pg-migrate': case 'umzug': case 'migrate': case 'db-migrate':
      return r.some((x) => /migrat|db:|seed|^(up|down|upgrade|downgrade|push|reset|rollback|apply|deploy)$/i.test(x));
    case 'rails': case 'rake': case 'padrino': case 'bin/rails': case 'bin/rake': return r.some((x) => /^db(:|$)/.test(x) || x === 'dbconsole');
    case 'manage.py': case 'django-admin': return r.some((x) => /^(migrate|flush|dbshell|loaddata|sqlmigrate|sqlflush|sqlsequencereset|squashmigrations)$/.test(x));
    case 'make': case 'just': case 'task': case 'mage': return r.some((x) => /migrat|^db[:-]|^seed/i.test(x));
    default:
      if (/^python[\d.]*$/.test(t)) {
        const m = r.indexOf('-m');
        if (m >= 0 && r[m + 1]) { const mod = r[m + 1] === 'django' ? 'django-admin' : r[m + 1]; return DB_CLIENTS.has(mod) || dbTool(mod, r.slice(m + 2)); }
        return r.some((x) => /manage\.py$/.test(x)) && dbTool('manage.py', r);
      }
      return false;
  }
}

function dbCommand(cmd, args) {
  const a = args.map((x) => x.t);
  if (DB_CLIENTS.has(cmd) || dbTool(cmd, a)) return true;
  const through = RUNNERS.has(cmd) || EXEC_LIKE.has(cmd);
  if (through) {
    for (let k = 0; k < a.length; k++) {
      const c = name(a[k]);
      if (DB_CLIENTS.has(c) || dbTool(c, a.slice(k + 1))) return true;
    }
  }
  return false;
}

// S1: for a job on Auto a program is let in by name. Anything not in a group stops (outside, unknownProgram).
// Reads: only read, so they pass whatever path they read.
const READS = new Set(['cat', 'ls', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'head', 'tail', 'wc', 'diff', 'cmp', 'find', 'file', 'stat', 'du', 'df', 'pwd', 'echo', 'printf', 'date', 'which', 'whereis', 'type', 'env', 'printenv', 'test', '[', '[[', ']]', 'true', 'false', 'sort', 'uniq', 'cut', 'tr', 'jq', 'yq', 'basename', 'dirname', 'realpath', 'readlink', 'tree', 'less', 'more', 'man', 'column', 'comm', 'join', 'paste', 'nl', 'fold', 'fmt', 'tac', 'rev', 'od', 'hexdump', 'xxd', 'strings', 'md5', 'md5sum', 'shasum', 'sha1sum', 'sha256sum', 'cksum', 'seq', 'sleep', 'id', 'whoami', 'uname', 'hostname', 'getconf', 'nproc', 'expr', 'wait', 'xargs',
  // shell builtins and keywords
  'cd', 'pushd', 'popd', 'exit', 'return', 'break', 'continue', 'export', 'unset', 'set', 'shift', 'local', 'declare', 'typeset', 'readonly', 'let', 'read', 'getopts', 'hash', 'ulimit', ':', '}', 'if', 'fi', 'for', 'done', 'while', 'until', 'case', 'esac', 'elif', 'in', 'select', 'function']);
// File changes: pass only when every path argument is inside the job's folders (a path we can't place stops).
// The read programs whose words name what they read (echo, test and the like only print or compare text).
const READ_PATHS = new Set(['cat', 'ls', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'head', 'tail', 'wc', 'diff', 'cmp', 'find', 'file', 'stat', 'du', 'tree', 'less', 'more', 'sort', 'uniq', 'cut', 'column', 'comm', 'join', 'paste', 'nl', 'fold', 'fmt', 'tac', 'rev', 'od', 'hexdump', 'xxd', 'strings', 'md5', 'md5sum', 'shasum', 'sha1sum', 'sha256sum', 'cksum', 'jq', 'yq', 'realpath', 'readlink']);
// Programs whose every word may be a path that is read or copied: a word with a space in it is still looked at (N2).
const READ_OR_COPY = new Set([...READ_PATHS, 'cp', 'mv', 'rsync', 'ditto', 'scp', 'install', 'tar', 'zip', 'unzip', 'sed', 'gsed', 'awk', 'gawk', 'tee', 'ln', 'base64', 'xxd', 'od', 'openssl', 'gzip', 'bzip2', 'xz']);
const FILE_CHANGES = new Set(['cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'ln', 'chmod', 'chown', 'chgrp', 'sed', 'gsed', 'awk', 'gawk', 'perl', 'tee', 'tar', 'unzip', 'zip', 'rsync', 'install', 'truncate', 'dd', 'patch', 'ed', 'unlink', 'shred', 'mkfifo', 'mknod', 'chflags', 'xattr', 'split', 'csplit', 'cpio', 'ditto', 'gzip', 'gunzip', 'bzip2', 'bunzip2', 'xz', 'unxz', 'unrar', '7z', '7za', 'mktemp']);
// Build and test: they pass unless a rule stops them (a database tool, -e/-c code, a global install, a publish).
const BUILD = new Set(['node', 'nodejs', 'npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx', 'deno', 'tsc', 'tsx', 'ts-node', 'vitest', 'jest', 'eslint', 'prettier', 'pip', 'pip3', 'pytest', 'ruby', 'bundle', 'rake', 'rails', 'mix', 'elixir', 'flask', 'go', 'cargo', 'rustc', 'make', 'mvn', 'gradle', 'dotnet', 'php', 'composer', 'uv', 'poetry', 'pipenv', 'vite', 'webpack', 'rollup', 'esbuild', 'turbo', 'nx', 'lerna', 'playwright', 'cypress', 'mocha', 'ruff', 'black', 'mypy', 'flake8', 'swift', 'xcodebuild', 'gcc', 'cc', 'clang', 'java', 'javac', 'just', 'tox', 'nox', 'perl']);
const programGroup = (cmd) => (READS.has(cmd) ? 'read' : FILE_CHANGES.has(cmd) ? 'file' : BUILD.has(cmd) || /^python[\d.]*$/.test(cmd) ? 'build' : cmd === 'git' || cmd === 'gh' || cmd === 'hub' ? 'git' : cmd === 'curl' || cmd === 'wget' ? 'net' : null);
const NPM_PUBLISH = /^(publish|unpublish|deprecate|adduser|login|logout|dist-tag|access|owner|token|team|profile|set|link|ln)$/;

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh']);
const INLINE = { node: /^-[A-Za-z]*[ep]$|^--(eval|print)(=|$)/, nodejs: /^-[A-Za-z]*[ep]$|^--(eval|print)(=|$)/, ruby: /^-[A-Za-z]*e$/, perl: /^-[A-Za-z]*[eE]$/, php: /^-[A-Za-z]*r$/, lua: /^-e$/, deno: /^eval$/ };
const PY_INLINE = /^-[A-Za-z]*c$/;
const NO_STDIN = /^(-V|--version|-v|-h|--help|--test|-m|--check|-c|-p|-e|-E|-r|--eval|--print)$/;
const DANGEROUS = new Set(['launchctl', 'crontab', 'at', 'osascript', 'open', 'kill', 'pkill', 'killall', 'systemctl', 'service', 'defaults', 'scutil', 'diskutil', 'hdiutil', 'pmset', 'networksetup', 'dscl', 'tmutil', 'shutdown', 'reboot', 'halt', 'mount', 'umount', 'chsh', 'passwd', 'security', 'spctl', 'csrutil', 'nvram', 'pfctl', 'sysadminctl', 'softwareupdate', 'pkgutil', 'installer', 'xcode-select', 'ssh', 'sftp', 'sudo', 'su', 'doas', 'sudoedit', 'systemsetup', 'dseditgroup', 'ifconfig', 'route']);
const BREW_READ = new Set(['list', 'ls', 'info', 'search', '--prefix', '--version', '--cellar', '--repository', 'config', 'doctor', 'outdated', 'deps', 'uses', 'leaves', 'desc', 'home', 'log', 'cat']);
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'describe', 'blame', 'merge-base', 'for-each-ref', 'shortlog', 'cat-file', 'ls-tree', 'grep', 'check-ignore', 'rev-list', 'name-rev', 'cherry', 'range-diff', 'count-objects', 'whatchanged', 'help', 'version']);
const PROTECTED = /^(main|master|staging|stage|production|prod|develop|development|trunk|release([/-].*)?|releases\/.*|hotfix\/.*)$/i;
const PUSH_STOP_LONG = ['all', 'mirror', 'tags', 'prune', 'delete', 'follow-tags', 'force', 'force-with-lease', 'force-if-includes', 'repo', 'receive-pack', 'exec', 'signed'];
const GH_OK = { pr: ['view', 'list', 'status', 'checks', 'diff', 'create', 'checkout'], issue: ['view', 'list', 'status'], repo: ['view'], run: ['view', 'list', 'watch'], release: ['view', 'list'], auth: ['status'], workflow: ['view', 'list'], search: null, status: null };

function simple(ws, redirects, cwd, st, depth, viaXargs) {
  const { ctx } = st;
  const out = (word) => pathOutside(word, cwd, st);
  const recordWrite = (word) => { const p = physicalPath(word.t, cwd); if (p) st.written.push(p); };
  // A file that runs code later (T3h), or that changes how tools run (asks).
  const noteWrite = (word) => {
    const p = physicalPath(word.t, cwd ?? st.hint ?? null);
    if (codeLater(p, st.codeRoots) || autoRecordFile(p, ctx)) st.hits.add('outside');
    if (p && ASK_FILES.has(path.basename(p))) st.asks.push('a file that changes how tools run');
    if (p && /[\\/]node_modules[\\/]\.bin[\\/]/.test(p)) st.asks.push('a program in node_modules/.bin that a plain command would then run'); // N19
  };
  // A word with a space in it is a path too (N2): always for the read and copy programs, and for any program when it starts with / ~ or .
  const secretWord = (t, every = false) => {
    if (typeof t !== 'string' || !t || (/\s/.test(t) && !every && !/^[/~.]/.test(t))) return false;
    for (const x of t.startsWith('-') && t.includes('=') ? [t.slice(t.indexOf('=') + 1)] : t.startsWith('-') ? [] : [t, t.includes('=') ? t.slice(t.indexOf('=') + 1) : t]) {
      if (secretPlace(physicalPath(x, cwd ?? st.hint ?? null), st.roots, ctx)) return true;
      // a word relative to a folder an earlier cd went to, however the commands are joined (C1)
      if (!/^[/~]/.test(x) && st.cdTargets.some((d) => secretPlace(physicalPath(x, d), st.roots, ctx))) return true;
    }
    return false;
  };
  const hit = (rule) => st.hits.add(rule);
  // The profile's env file copied from the main checkout into a worktree of the job (I2): its source is not a secret read here.
  const plainWords = ws.filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w.t));
  const here = cwd ?? st.hint ?? null;
  const isEnvCopy = Boolean(here) && name(plainWords[0]?.t ?? '') === 'cp' && !plainWords[0].t.includes('/') && plainWords.every((w) => !w.dyn) && !redirects.length && envCopy(plainWords.slice(1).map((w) => w.t), [here], ctx);
  // Redirections: output anywhere but /dev/null and the job's folders stops; input from a .sql file is a database change.
  for (const r of redirects) {
    if (r.op === '<' || r.op === '<&' || (r.op === '>&' && /^(\d+|-)$/.test(r.target))) { if (SQL.test(r.target)) hit('database'); continue; }
    if (!r.dyn && /^\/dev\/(null|stdout|stderr|tty)$/.test(r.target)) continue;
    if (SQL.test(r.target)) hit('database');
    st.nonRead = true;
    if (out({ t: r.target, dyn: r.dyn })) hit('outside');
    noteWrite({ t: r.target, dyn: r.dyn });
    recordWrite({ t: r.target, dyn: r.dyn });
  }
  const readsAll = READ_OR_COPY.has(name(plainWords[0]?.t ?? ''));
  for (const r of redirects) if (secretWord(r.target, true)) { hit('outside'); st.secret = true; }
  for (const r of redirects) if ((r.op === '<' || r.op === '<&') && !r.dyn && !/^(\d+|-)$/.test(r.target) && readElsewhere(physicalPath(r.target, cwd ?? st.hint ?? null), st.readRoots)) st.asks.push('a read outside the job\'s folders');
  for (const w of ws) if (/\/dev\/(tcp|udp)\//.test(w.t)) hit('outside'); else if (!isEnvCopy && secretWord(w.t, readsAll)) { hit('outside'); st.secret = true; } // a network file of bash's; a secret place
  for (const r of redirects) if (/\/dev\/(tcp|udp)\//.test(r.target)) hit('outside');
  if (ws.some((w) => SQL.test(w.t))) hit('database'); // a .sql file given to any program
  const { rest, assigns, wrappers } = unwrap(ws, st, cwd, depth);
  if (wrappers.some((w) => DANGEROUS.has(w))) hit('outside');
  if (assigns.some((x) => REDIRECT_VAR.test(x.split('=')[0]))) hit('outside'); // a variable that redirects a tool (T3d)
  if (!rest.length) return;
  const cmdWord = rest[0];
  if (cmdWord.dyn) { hit('outside'); st.nonRead = true; return; } // a command chosen while it runs
  const cmd = name(cmdWord.t);
  const args = rest.slice(1);
  const a = args.map((x) => x.t);
  const xargs = wrappers.includes('xargs') || viaXargs === true;
  const pos = (list = args) => { const o = []; let opts = true; for (const x of list) { if (opts && x.t === '--') { opts = false; continue; } if (opts && x.t.startsWith('-') && x.t !== '-') continue; o.push(x); } return o; };
  const valueOf = (re) => { const k = a.findIndex((x) => re.test(x)); return k < 0 ? null : (/=/.test(a[k]) && a[k].startsWith('--') ? { t: a[k].slice(a[k].indexOf('=') + 1), dyn: args[k].dyn } : args[k + 1] ?? { t: '', dyn: true }); };
  // A write program's targets can't be known when xargs feeds them in.
  const writes = (targets, content = true) => { if (xargs) hit('outside'); for (const t of targets) { if (out(t)) hit('outside'); noteWrite(t); if (content) recordWrite(t); } };

  if (DANGEROUS.has(cmd)) hit('outside');
  if (/^(nc|ncat|netcat|telnet|socat)$/.test(cmd) && a.some((x) => /(^|:)(5432|3306|1433|27017|6379|9042)$/.test(x))) hit('database'); // a database port, on any host
  if (/^(curl|wget|nc|ncat|netcat|telnet|ssh|socat|sftp|scp)$/.test(cmd) && a.some((x) => namesThisComputer(x))) hit('outside'); // a call to this computer, on any port
  if ((cmd === 'curl' || cmd === 'wget') && a.some((x) => URL_CREDENTIALS.test(x))) hit('outside'); // a name and password in an address (C5)
  // A read program's path words in the home folder (or on another disk) outside the job's folders ask (C5).
  if (READ_PATHS.has(cmd) && a.some((x) => (x.includes('/') || x.startsWith('~') || x === '..') && readElsewhere(physicalPath(x.includes('=') && x.startsWith('-') ? x.slice(x.indexOf('=') + 1) : x, cwd ?? st.hint ?? null), st.readRoots))) st.asks.push('a read outside the job\'s folders');
  if (dbCommand(cmd, args)) hit('database');
  else if (!TEXTY.has(cmd) && args.some((x) => DB_CLIENTS.has(name(x.t)))) hit('database'); // a client named under a wrapper we don't know
  if (EXEC_LIKE.has(cmd)) for (const x of args) if (/\s/.test(x.t)) analyze(x.t, cwd, st, depth + 1, null);

  // A deploy or a publish stops, by whatever road it is started (I3).
  if (deploys(cmd, a)) { hit('outside'); st.deploy = true; }
  // starbase decisions <the job's slug> --worktree <a worktree of the job>, from any folder; nothing else of starbase (R4).
  if (cmd === 'starbase' && !cmdWord.t.includes('/')) {
    st.nonRead = true;
    if (args.some((x) => x.dyn) || !starbaseDecisions(a, [cwd ?? st.hint ?? null].filter(Boolean), ctx)) { hit('outside'); st.unknown = true; }
    return;
  }
  const psOk = cmd === 'ps' && !cmdWord.t.includes('/') && psRead(a); // is the lock Starbase's own (lock.md): a read (R4)
  // S1: a program is let in by name.
  const inside = cmdWord.t.includes('/') ? physicalPath(cmdWord.t, cwd) : null;
  // A program of node_modules/.bin by the path as written (made absolute, the link not followed: a real install links each
  // entry into its package), whose file really is the job's (R2).
  const written = cmdWord.t.includes('/') ? writtenPath(cmdWord.t, cwd ?? st.hint ?? null) : null;
  const ownBin = Boolean(written && inside) && inRoots(written, st.roots) && inRoots(inside, st.roots) && /\/node_modules\/\.bin\/[^/]+$/.test(written);
  const byFile = inside && inRoots(inside, st.roots) && !ownBin; // a file of the job's own, run by its path
  const known = psOk || byFile || (!cmdWord.t.includes('/') || ownBin) && (programGroup(cmd) || SHELLS.has(cmd) || cmd === 'eval' || cmd === 'source' || cmd === '.' || cmd === 'alias' || st.funcs.has(cmd.replace(/\(\)$/, '')));
  // A program found in the job's node_modules/.bin (as npx finds it, or a package script's own) and not otherwise known
  // is a question, not a stop; a few of its uses are plain (I2).
  const localBin = !known && /^[\w.-]+$/.test(cmd) && (ownBin || (!cmdWord.t.includes('/') && binNear(cmd, cwd ?? st.hint ?? null, st)));
  if (!known && !localBin) { hit('outside'); st.unknown = true; return; }
  if (localBin) {
    // husky pointed at a folder outside the job stops, whatever the use: that test runs first (R2, finding 6).
    if (cmd === 'husky' && args.some((x) => !x.t.startsWith('-') && (x.dyn || pathOutside(x, cwd ?? st.hint ?? null, st)))) hit('outside');
    else if (!localPlain(cmd, a)) st.asks.push(`${cmd}, a program of the job's node_modules/.bin that Starbase does not read in this use`);
  }
  // T3c: a command that is not a read runs from a folder inside the job's (a cd moves it; a folder we can't tell stops).
  const readOnly = psOk || programGroup(cmd) === 'read' || (cmd === 'git' && gitReads(args));
  if (!readOnly) st.nonRead = true;
  // A script of the installed workflow run by an interpreter asks, whatever the folder (R4); gh pr create is judged by its own rule (R4).
  const skill = skillScript(cmd, cmdWord, args, a, cwd ?? st.hint ?? null, st);
  const prCreate = cmd === 'gh' && (() => { const p = args.filter((x, k) => !(x.t.startsWith('-') || ['-R', '--repo'].includes(a[k - 1]))).map((x) => x.t); return p[0] === 'pr' && p[1] === 'create'; })();
  if (!readOnly && !byFile && !skill && !prCreate) {
    const eff = cmd === 'git' ? gitFolder(args, cwd ?? st.hint ?? null) : cwd ?? st.hint ?? null; // git -C runs it there (m11)
    const at = eff ? physicalPath(eff, null) : null;
    if (!at || !inRoots(at, cmd === 'git' ? st.gitRoots : st.roots)) hit('outside'); // git changes something only in a worktree (R1)
  }
  if (secretPlace(cwd ?? st.hint ? physicalPath(cwd ?? st.hint, null) : null, st.roots, ctx)) { hit('outside'); st.secret = true; } // running inside one
  if (/^(export|declare|typeset|readonly|local)$/.test(cmd)) for (const x of a) { if (!x.startsWith('-') && REDIRECT_VAR.test(x.split('=')[0])) hit('outside'); }
  if (/^(npm|pnpm|yarn|bun|npx|pnpx|bunx)$/.test(cmd) && !/^(pkg|set-script)$/.test(a.find((x) => !x.startsWith('-')) ?? '')) st.ranRunner = true;
  if (cmd === 'make' || cmd === 'gmake') st.ranMake = true;
  if (cmd === 'npm' && (/^(pkg|set-script)$/.test(a.find((x) => !x.startsWith('-')) ?? ''))) st.pkgEdit = a.includes('set') || a.includes('delete') || a.includes('fix') || a.includes('set-script') || a[0] === 'set-script';
  optionStops(cmd, args, a, cwd, st);
  const positional = [cmd, ...a.filter((x) => !x.startsWith('-'))];
  if (PUBLISH.some(([head, ...tail]) => head === positional[0] && positional.slice(1).some((_, k) => tail.every((t, j) => positional[k + 1 + j] === t)))) hit('outside');
  if (cmd === 'alias') { hit('outside'); for (const x of a) { const eq = x.indexOf('='); if (eq > 0) analyze(x.slice(eq + 1), cwd, st, depth + 1, null); } return; }
  if (byFile) { scriptFile(cmdWord, cwd, st, 'shell', depth); return; }
  if (skill) {
    if (!skill.dyn && DATA_FILE.test(skill.t)) hit('database');
    st.asks.push(`a script of the installed workflow (${path.basename(skill.t)} in the skills folder), run by ${cmd}`);
    return;
  }

  if (SHELLS.has(cmd)) {
    const c = args.findIndex((x) => /^-[A-Za-z]*c$/.test(x.t));
    if (c >= 0) {
      const script = args[c + 1];
      if (!script || script.dyn) hit('outside'); else analyze(script.t, cwd, st, depth + 1, null);
    } else if (!pos().filter((x) => x.t !== '-').length || a.includes('-s')) hit('outside'); // reads its commands from a pipe or here-document
    else scriptFile(pos().filter((x) => x.t !== '-')[0], cwd, st, 'shell!', depth); // the file it runs, read as shell whatever its first line (m5)
    return;
  }
  if (cmd === 'eval') { hit('outside'); analyze(a.join(' '), cwd, st, depth + 1, null); return; }
  if (cmd === 'source' || cmd === '.') { hit('outside'); return; }
  const inline = /^python[\d.]*$/.test(cmd) ? PY_INLINE : INLINE[cmd];
  if (inline || /^(python[\d.]*|node|nodejs|ruby|perl|php|deno|lua)$/.test(cmd)) {
    const mod = a.indexOf('-m');
    if (mod >= 0 && a[mod + 1] === 'pip') pipStep(a.slice(mod + 2), (r) => hit(r));
    const codeAt = a.findIndex((x) => inline?.test(x));
    if (codeAt >= 0) {
      // Code given on the command line: it asks, and stops only if a plain text search of it finds something.
      const code = /^-[A-Za-z]*[ep]$|^-[A-Za-z]*[cEr]$/.test(a[codeAt]) || /^--(eval|print)$/.test(a[codeAt]) || a[codeAt] === 'eval' ? args[codeAt + 1] : { t: a[codeAt].replace(/^--[a-z]+=/, ''), dyn: args[codeAt].dyn };
      if (!code || code.dyn) hit('outside'); else { scanOther(code.t, st); st.asks.push(`code written on the command line (${cmd} ${a[codeAt]})`); }
    }
    else if (!pos().filter((x) => x.t !== '-').length && !a.some((x) => NO_STDIN.test(x))) hit('outside'); // code from stdin
    if (cmd === 'perl' || cmd === 'ruby') { if (a.some((x) => /^-[A-Za-z]*i/.test(x))) writes(pos()); }
    if (!(mod >= 0) && !a.some((x) => inline?.test(x))) {
      const file = interpreterFile(cmd, args);
      // node given a file of a package (node_modules/.bin/<name> or node_modules/<package>/…) runs that package's program (R2).
      const prog = file && !file.dyn && (cmd === 'node' || cmd === 'nodejs') ? packageProgram(file.t, cwd ?? st.hint ?? null, st) : null;
      if (prog?.bin) { simple([{ t: prog.bin, dyn: false }, ...args.slice(args.indexOf(file) + 1)], [], cwd, st, depth + 1, viaXargs); return; }
      if (prog) st.asks.push(`a file of the package ${prog.pkg} in node_modules that is none of its programs`);
      if (file) runtimeFile(file, cwd, st, depth);
    }
    return;
  }

  // TypeScript runners and bun given a file: the same reading as node's (I4).
  if (cmd === 'tsx' || cmd === 'ts-node' || cmd === 'ts-node-esm') { const file = interpreterFile('node', args); if (file) runtimeFile(file, cwd, st, depth); return; }
  if (cmd === 'bun') { const list = a[0] === 'run' ? args.slice(1) : args; const first = list.find((x) => !x.t.startsWith('-')); if (first && (first.t.includes('/') || BUN_FILE.test(first.t))) { runtimeFile(first, cwd, st, depth); return; } }
  if (cmd === 'git') { gitStep(args, assigns, cwd, st, xargs); return; }
  if (cmd === 'gh' || cmd === 'hub') { ghStep(cmd, args, a, st); return; }

  switch (cmd) {
    case 'rm': {
      const targets = pos();
      writes(targets);
      const r = a.some((x) => x === '--recursive' || /^-[A-Za-z]*[rR]/.test(x));
      const f = a.some((x) => x === '--force' || /^-[A-Za-z]*f/.test(x));
      if (r && f && !rmInsideJob(ws.map((x) => x), cwd, { worktrees: ctx.worktrees ?? [], featureDir: ctx.featureDir })) hit('outside');
      for (const t of targets) if (pathOutside(t, cwd, st, true)) hit('outside');
      return;
    }
    case 'mv': writes(pos()); for (const t of pos()) if (pathOutside(t, cwd, st, true)) hit('outside'); if (pos().length >= 2 && movesCodeLater(pos().slice(0, -1), pos().at(-1), cwd ?? st.hint ?? null, st)) hit('outside'); return;
    case 'tee': case 'truncate': case 'split': writes(pos().filter((x) => x.t !== '-')); return;
    case 'rmdir': case 'unlink': case 'touch': case 'mkdir': case 'shred': case 'mkfifo': case 'mknod': case 'chflags': case 'xattr': writes(pos().filter((x) => x.t !== '-'), false); return;
    case 'chmod': case 'chown': case 'chgrp': {
      let skipped = false;
      const rest2 = args.filter((x) => !(x.t.startsWith('-') && /^-[A-Za-z]+$/.test(x.t) && !/^-[rwxXst]+$/.test(x.t)) && !/^--/.test(x.t));
      const targets = rest2.filter((x) => { if (!skipped && (cmd === 'chmod' ? /^([0-7]{3,4}|[ugoa]*[-+=][rwxXstugo]*(,[ugoa]*[-+=][rwxXstugo]*)*)$/.test(x.t) : true)) { skipped = true; return false; } return true; });
      writes(targets, false);
      return;
    }
    case 'ln': lnStep(a, args, pos, valueOf, cwd, st, writes); return;
    case 'cp': case 'install': case 'rsync': case 'ditto': case 'scp': {
      if (isEnvCopy) { writes([pos()[1]]); return; }
      if (cmd === 'install' && a.includes('-d')) { writes(pos()); return; }
      const t = valueOf(/^(-t|--target-directory(=.*)?)$/);
      const p = pos().filter((x) => !(t && x === t));
      const dest = t ?? (p.length >= 2 ? p[p.length - 1] : null);
      if (!dest) { writes([{ t: '.', dyn: false }]); return; }
      for (const x of [...p, dest]) if (/^[^/]*:/.test(x.t) && !x.t.startsWith('/')) hit('outside'); // a remote host
      writes([...p, dest]); // every path argument, sources too
      if (a.some((x) => /^-[A-Za-z]*[rRa]/.test(x) || x === '--recursive' || x === '--archive') && movesCodeLater(p.filter((x) => x !== dest), dest, cwd ?? st.hint ?? null, st)) hit('outside');
      return;
    }
    case 'dd': writes(a.filter((x) => /^(of|if)=/.test(x)).map((x) => ({ t: x.slice(3), dyn: x.includes('$') }))); return;
    case 'curl': {
      // Only a plain download passes: nothing sent, no method but GET, no @file, no config file; short flags
      // can be clustered (-sX POST, -XPOST, -da=b, -T-, -sSLo/path), so each letter is read.
      const targets = [];
      const SEND = 'dFTK';
      const TAKES = 'AbcCdDeEFHKmoPQrtTuUwxXyYz';
      if (a.some((x) => x.startsWith('@'))) hit('outside');
      for (let k = 0; k < a.length; k++) {
        const x = a[k];
        if (x.startsWith('@') || /^-[-A-Za-z]+[=:]@/.test(x) || /=@/.test(x)) hit('outside');
        if (/^--/.test(x)) {
          const eq = x.indexOf('=');
          const flag = eq < 0 ? x : x.slice(0, eq);
          const value = eq < 0 ? args[k + 1] : { t: x.slice(eq + 1), dyn: args[k].dyn };
          if (/^--(request)$/.test(flag)) { if ((value?.t ?? '').toUpperCase() !== 'GET') hit('outside'); } else if (/^--(data|form|json|upload-file|config|resolve|connect-to|unix-socket)/.test(flag)) hit('outside');
          else if (/^--(output|output-dir|dump-header|cookie-jar|trace|trace-ascii|stderr|libcurl|etag-save|hsts|alt-svc|ssl-sessions)$/.test(flag)) targets.push(value ?? { t: '', dyn: true });
          else if (flag === '--remote-name' || flag === '--remote-name-all') targets.push({ t: '.', dyn: false });
          continue;
        }
        if (!/^-[A-Za-z0-9#]/.test(x)) continue;
        for (let i = 1; i < x.length; i++) {
          const ch = x[i];
          const rest = x.slice(i + 1);
          const value = rest ? { t: rest, dyn: args[k].dyn } : args[k + 1];
          if (SEND.includes(ch)) { hit('outside'); break; }
          if (ch === 'X') { if ((value?.t ?? '').toUpperCase() !== 'GET') hit('outside'); if (!rest) k++; break; }
          if ('oDc'.includes(ch)) { targets.push(value ?? { t: '', dyn: true }); if (!rest) k++; break; }
          if (ch === 'O' || ch === 'J') { targets.push({ t: '.', dyn: false }); continue; }
          if (TAKES.includes(ch)) { if (!rest) k++; break; }
        }
      }
      writes(targets.filter((x) => x.dyn || x.t !== '/dev/null'));
      return;
    }
    case 'wget': {
      const targets = [];
      for (let k = 0; k < a.length; k++) {
        if (/^(-O|-P|--output-document|--directory-prefix|-o|--output-file|-a|--append-output)$/.test(a[k])) { if (args[k + 1]?.t !== '-') targets.push(args[k + 1] ?? { t: '', dyn: true }); }
        else if (/^--(output-document|directory-prefix|output-file)=/.test(a[k])) targets.push({ t: a[k].slice(a[k].indexOf('=') + 1), dyn: args[k].dyn });
        else if (/^-O./.test(a[k]) && a[k] !== '-O-') targets.push({ t: a[k].slice(2), dyn: false });
        if (/^--(post-data|post-file|body-data|body-file|method)(=|$)/.test(a[k]) || /^(-e|--execute)/.test(a[k])) hit('outside');
      }
      if (!a.some((x) => /^(-O|--output-document)/.test(x))) targets.push({ t: '.', dyn: false });
      writes(targets);
      return;
    }
    case 'tar': case 'unzip': case 'gunzip': case 'bunzip2': case 'unrar': case '7z': case '7za': writes([...pos(), { t: '.', dyn: false }]); return;
    case 'sed': case 'gsed': case 'awk': case 'gawk': {
      const sed = cmd.endsWith('sed');
      const scripts = [];
      const files = [];
      let own = false; // a script given with -e / -f / --expression / --file
      for (let k = 0; k < args.length; k++) {
        const x = a[k];
        if (/^(-e|--expression|--program)$/.test(x)) { own = true; scripts.push(args[++k]?.t ?? ''); continue; }
        if (!sed && /^--(expression|program)=/.test(x)) { own = true; scripts.push(x.slice(x.indexOf('=') + 1)); continue; }
        if (/^(-f|--file)$/.test(x) || /^--file=/.test(x)) { hit('outside'); own = true; if (!x.includes('=')) k++; continue; } // a script file we don't read
        if (x.startsWith('-') && x !== '-') { if (!sed && /^(-v|-F)$/.test(x)) k++; continue; }
        files.push(args[k]);
      }
      if (!own && files.length) scripts.push(files.shift().t);
      const inPlace = a.some((x) => /^-[A-Za-z]*i|^--in-place/.test(x) && (sed || x === '-i' || x === '--in-place'));
      const real = files.filter((x) => x.t !== '');
      if (inPlace) writes(real);
      // Without -i they read their files: the read test runs on each (N4).
      else if (real.some((x) => x.dyn || readElsewhere(physicalPath(x.t, cwd ?? st.hint ?? null), st.readRoots))) st.asks.push('a read outside the job\'s folders');
      for (const sc of scripts) scriptWrites(sed, sc, cwd, st, writes);
      return;
    }
    case 'npm': case 'pnpm': case 'yarn': case 'bun': case 'npx': case 'bunx': case 'pnpx': {
      const sub1 = a.find((x) => !x.startsWith('-')) ?? '';
      const sub2 = a.filter((x) => !x.startsWith('-'))[1] ?? '';
      if (a.some((x) => x === '-g' || /^--(global|location=global)$/.test(x)) || a[0] === 'global' || NPM_PUBLISH.test(sub1) || (sub1 === 'config' && /^(set|delete|edit|rm)$/.test(sub2))) hit('outside');
      // The program a runner starts is judged as that program: a deploy or an unknown program stops behind it too (I3).
      else if (cmd === 'npx' || cmd === 'bunx' || cmd === 'pnpx') runnerProgram(args, 0, cwd, st, depth, viaXargs);
      else {
        const how = packageScripts(cmd, args, cwd, st, depth);
        const at = args.findIndex((x) => x.t === sub1);
        if (/^(exec|dlx|x)$/.test(sub1)) runnerProgram(args, at + 1, cwd, st, depth, viaXargs);
        else if (typeof how === 'number') runnerProgram(args, how, cwd, st, depth, viaXargs); // yarn, pnpm and bun run a program of that name when no script has it
      }
      return;
    }
    case 'pip': case 'pip3': pipStep(a, hit); return;
    case 'brew': if (!BREW_READ.has(a[0] ?? '')) hit('outside'); return;
    case 'pipx': case 'gem': case 'cargo': case 'go': case 'uv': if (['install', 'tool', 'uninstall', 'upgrade'].includes(a[0]) || cmd === 'pipx') hit('outside'); return;
    case 'find': findStep(args, a, cwd, st); return;
    case 'pushd': case 'popd': return;
    default:
      if (FILE_CHANGES.has(cmd)) writes(pos().filter((x) => x.t !== '-' && x.t !== '')); // we can't tell which argument is a path: every one is
  }
}

// Programs that deploy or publish: always, or with these first words.
const DEPLOY_ANY = new Set(['vercel', 'netlify', 'surge', 'gh-pages', 'semantic-release', 'np', 'release-it', 'heroku', 'fly', 'flyctl', 'railway', 'eas', 'amplify']);
const DEPLOY_SUB = { firebase: /^(deploy|hosting:channel:deploy)$/, wrangler: /^(deploy|publish|pages)$/, changeset: /^publish$/, lerna: /^publish$/, expo: /^publish$/, twine: /^upload$/, serverless: /^deploy$/, sls: /^deploy$/, cdk: /^deploy$/, pulumi: /^up$/, terraform: /^apply$/, npm: /^publish$/, yarn: /^publish$/, pnpm: /^publish$/ };
const deploys = (cmd, a) => DEPLOY_ANY.has(cmd) || Boolean(DEPLOY_SUB[cmd]?.test(a.find((x) => !x.startsWith('-')) ?? ''));
const REDIRECT_VAR = /^(GIT_.*|PATH|CDPATH|HOME|NODE_OPTIONS|LD_.*|DYLD_.*|SHELL|EDITOR|VISUAL|.*_PAGER|BASH_ENV|ENV|npm_config_.*|PIP_.*)$/i;
const PUBLISH = [['cargo', 'publish'], ['poetry', 'publish'], ['uv', 'publish'], ['yarn', 'npm', 'publish'], ['pnpm', 'publish'], ['npm', 'publish'], ['twine', 'upload'], ['gem', 'push']];

// The folder a git command acts in: its -C folders in turn from the one it runs in; null when one can't be placed.
function gitFolder(args, from) {
  let at = from;
  for (let i = 0; args[i]?.t.startsWith('-'); i += ['-C', '-c'].includes(args[i].t) ? 2 : 1) {
    if (args[i].t === '-C') { const d = args[i + 1]; at = !d || d.dyn || !at ? null : physicalPath(d.t, at); }
  }
  return at;
}

// Does this git command only read: a read word, or one of the read forms (R4)?
function gitReads(args) {
  let i = 0;
  while (args[i]?.t.startsWith('-')) i += ['-C', '-c'].includes(args[i].t) ? 2 : 1;
  const sub = args[i]?.t;
  return GIT_READ.has(sub) || gitReadForm(sub, args.slice(i + 1));
}

// The script an interpreter (python, node, bash, sh) runs, when it is a file in the installed skills (the session's read
// folders, or where their links land as N9 allows) and no code is given on the command line: the word, else null (R4).
function skillScript(cmd, cmdWord, args, a, here, st) {
  if (cmdWord.t.includes('/') || !(/^python[\d.]*$/.test(cmd) || ['node', 'nodejs', 'bash', 'sh'].includes(cmd))) return null;
  if (a.some((x) => x === '-m' || x === '-s' || x === '-' || PY_INLINE.test(x) || INLINE.node.test(x) || /^-[A-Za-z]*c$/.test(x))) return null;
  const file = SHELLS.has(cmd) ? args.find((x) => !x.t.startsWith('-')) : interpreterFile(cmd === 'nodejs' ? 'node' : cmd, args);
  if (!file || file.dyn) return null;
  const at = physicalPath(file.t, here);
  return at && inRoots(at, readFolders(st.ctx)) && !inRoots(at, st.roots) ? file : null;
}

function firstGitSub(args) {
  let i = 0;
  while (args[i]?.t.startsWith('-')) i += ['-C', '-c'].includes(args[i].t) ? 2 : 1;
  return args[i]?.t;
}

// Options that point a program at another folder or file: outside, or a value we can't place, stops (T3c).
const PATH_OPTIONS = [
  [/^(npm|pnpm|yarn|bun|npx|pnpx|bunx)$/, /^(--prefix|-C|--dir|--cwd)(=.*)?$/],
  [/^g?make$/, /^(-C|-f|--directory|--file|--makefile)(=.*)?$|^-[Cf]./],
  [/^cargo$/, /^--manifest-path(=.*)?$/],
  [/^tsc$/, /^--(outDir|outdir|declarationDir)(=.*)?$/],
  [/^go$/, /^-o$/],
  [/^pip3?$/, /^(--target|-t|--prefix|--root)(=.*)?$/],
];
function optionStops(cmd, args, a, cwd, st) {
  const progs = [cmd, ...a.filter((x) => !x.startsWith('-')).slice(0, 2).map(name)];
  for (const [prog, flag] of PATH_OPTIONS) {
    if (!progs.some((x) => prog.test(x))) continue;
    for (let k = 0; k < a.length; k++) {
      if (a[k] === '--') break;
      if (!flag.test(a[k])) continue;
      const m = /^(--[\w-]+)=(.*)$/.exec(a[k]);
      const glued = !m && /^-[A-Za-z]./.test(a[k]) ? { t: a[k].slice(2), dyn: args[k].dyn } : null;
      const value = m ? { t: m[2], dyn: args[k].dyn } : glued ?? args[k + 1];
      if (!value || value.dyn || pathOutside(value, cwd ?? st.hint ?? null, st)) st.hits.add('outside');
    }
  }
}

// ln: the link's own name, and where it points. A link made here and used in this call is never resolved,
// so a target outside the job's folders (or one we can't place) stops. A symbolic link's relative target is
// relative to the folder the link is in.
function lnStep(a, args, pos, valueOf, cwd, st, writes) {
  const hit = (rule) => st.hits.add(rule);
  const sym = a.some((x) => x === '--symbolic' || /^-[A-Za-z]*s/.test(x));
  const t = valueOf(/^(-t|--target-directory(=.*)?)$/);
  const p = pos().filter((x) => !(t && x === t) && x.t !== '');
  let linkDir;
  let targets;
  let links;
  if (t) { linkDir = t; targets = p; links = [t]; } else if (p.length <= 1) { targets = p; linkDir = { t: '.', dyn: false }; links = [linkDir]; } else {
    const dest = p[p.length - 1];
    targets = p.slice(0, -1);
    links = [dest];
    const there = physicalPath(dest.t, cwd);
    let isDir = false;
    try { isDir = Boolean(there) && fs.statSync(there).isDirectory(); } catch { /* not there yet */ }
    linkDir = isDir || targets.length > 1 || dest.t.endsWith('/') ? dest : { t: path.posix.dirname(dest.t), dyn: dest.dyn };
  }
  writes(links);
  const base = physicalPath(linkDir.t, cwd);
  for (const x of targets) {
    const at = sym ? (base ? physicalPath(x.t, base) : null) : physicalPath(x.t, cwd);
    if (!at || !inRoots(at, st.roots)) hit('outside');
  }
}

// ---------- scripts run by file (I8) ----------

const MAX_SCRIPT = 200 * 1024;
// What a script's text may not name. A plain text search: over-stopping is accepted.
const DB_CLIENT_TEXT = /\b(psql|pgcli|pg_restore|pg_dump(?:all)?|createdb|dropdb|createuser|dropuser|mysql(?:dump|sh)?|mariadb(?:-dump)?|sqlite3?|litecli|mongosh?|mongorestore|mongodump|redis-cli|cqlsh|sqlcmd|sqlplus|usql|clickhouse-client|duckdb|alembic|flyway|liquibase|dbmate|goose|atlas|bq|tsql|isql|turso|pscale|drizzle-kit|sqitch|db-migrate|node-pg-migrate)\b/i;
const DB_TOOL_TEXT = /\b(prisma|supabase|wrangler|rails|rake|artisan|flask|mix|heroku|aws|gcloud|az|knex|sequelize(?:-cli)?|typeorm|manage\.py|django-admin|cockroach|dolt)\b[^\n]*(?:\bmigrat\w*|\bdb\b|\bdb:\S*|\bseed\S*|\becto\.\S+|\brds\S*|\bsql\b|\bd1\b|\bpg:\S*|\bdbshell|\bflush\b|\bloaddata)/i;
const SENDING = /\b(curl|wget)\b[^\n]*\s(?:-X\s*(?!GET\b)\w+|--request|-d\b|--data\S*|-F\b|--form|-T\b|--upload-file|--post-\w+|--body-\w+|--json|--method)/i;

// Text of a script in another language (or code given with -e / -c): the plain text search, plus a list of things
// that make it ask (it runs programs, reaches the network, or names the home folder or an absolute place).
const SCRIPT_ASKS = /child_process|execSync|execFile|\bspawn|subprocess|os\.system|\bfetch\s*\(|http\.request|https\.request|net\.connect|\brequests\.|urllib|\/dev\/(?:tcp|udp)|process\.env|os\.environ|homedir|expanduser|\$HOME|['"`](?:\/(?:Users|home|etc|var|private|root|opt|usr|Library|System|Volumes|tmp|dev)\b|~\/)|\.(?:ssh|aws|gnupg|kube|docker|netrc|npmrc|pypirc)\b|id_rsa|id_ed25519|credentials/;
function scanOther(text, st) {
  scanScript(text, st);
  if (SCRIPT_ASKS.test(text)) st.asks.push('a script that runs programs, reaches the network or names places outside the job');
}

// Shell text (a .sh file, an npm script): every line goes through the same reading as a command, and the strictest
// answer wins (stop over ask over pass). The cheap searches for Starbase's own places and database addresses stay.
// tail: the words a package script is handed after its name, read by Auto's rules at the end of the text as npm puts them
// there (R2); the plain reading checks them as paths where the command is read, as before.
function scanShell(text, cwd, st, depth, tail = '') {
  if (DB_ADDRESS.test(text)) st.hits.add('database');
  const dir = st.ctx.stateDir;
  if (/\.starbase\b/i.test(text) || (typeof dir === 'string' && dir && text.includes(dir)) || namesStarbaseAddress(text, st.ctx.apiPort)) st.hits.add('outside');
  const lines = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (lines.length && lines[lines.length - 1].endsWith('\\')) lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)} ${line}`; else lines.push(line);
  }
  if (lines.length > MAX_SIMPLE) { st.hits.add('outside'); return; }
  analyze(`${lines.join('\n')}${tail}`, cwd, st, depth + 1, null); // all of it at once: a cd on one line moves the lines after it
  for (const line of lines) {
    const why = plainWhy(line, plainEnv(st, cwd));
    if (why) st.asks.push(why);
  }
}

function scanScript(text, st) {
  if (DB_CLIENT_TEXT.test(text) || DB_TOOL_TEXT.test(text) || DB_ADDRESS.test(text)) st.hits.add('database');
  if (/\bgit\b[^\n]*\bpush\b/.test(text)) st.hits.add('push');
  if (/\bgh\s+(?:pr\s+merge|api)\b/.test(text)) st.hits.add('merge');
  const dir = st.ctx.stateDir;
  if (/\.starbase\b/i.test(text) || (typeof dir === 'string' && dir && text.includes(dir)) || namesStarbaseAddress(text, st.ctx.apiPort)) st.hits.add('outside');
  if (SENDING.test(text)) st.hits.add('outside');
}

// A file a program runs: it must be a readable file of the job's own, not over 200 KB, and not written by this call.
function scriptFile(word, cwd, st, kind = 'shell', depth = 0) {
  const at = word && !word.dyn ? physicalPath(word.t, cwd ?? st.hint ?? null) : null;
  if (!at || !inRoots(at, st.roots)) { st.hits.add('outside'); return; }
  let text;
  try {
    const info = fs.statSync(at);
    if (!info.isFile() || info.size > MAX_SCRIPT) { st.hits.add('outside'); return; }
    text = fs.readFileSync(at, 'utf8');
  } catch { st.hits.add('outside'); return; }
  st.runs.push(at);
  // #!/usr/bin/env -S bash (and env's other options) is that shell (m5); a shell given the file reads it as shell.
  const shebang = /^#!\s*\S*\/(?:env(?:\s+-[-\w]+)*\s+)?(\w+)/.exec(text)?.[1] ?? '';
  const shell = kind === 'shell!' || (kind === 'shell' && (!shebang || SHELLS.has(shebang)));
  if (shell) scanShell(text, st.hint ?? cwd ?? path.dirname(at), st, depth); else scanOther(text, st);
}

// A file a runtime runs: a migration or data script by its path or name is the database rule; its text is searched (I4).
const DATA_FILE = /migrat|seed|backfill|(^|\/)db[/:._-]|prisma\//i;
const BUN_FILE = /\.(m?[jt]sx?|cjs|cts)$/;
function runtimeFile(word, cwd, st, depth) {
  if (!word.dyn && DATA_FILE.test(word.t)) st.hits.add('database');
  scriptFile(word, cwd, st, 'other', depth);
}

// The file a language runtime is given to run: its first argument that is not an option (or an option's value).
const RUNTIME_VALUE = /^(-r|--require|--import|--loader|--experimental-loader|-C|--conditions|--env-file|--eval-file|-W|-I|-X|-Z)$/;
function interpreterFile(cmd, args) {
  const list = [];
  for (let k = 0; k < args.length; k++) {
    const x = args[k].t;
    if (x === '--') { list.push(...args.slice(k + 1)); break; }
    if (RUNTIME_VALUE.test(x)) { k++; continue; }
    if (x.startsWith('-')) continue;
    list.push(args[k]);
  }
  if (cmd === 'deno' && /^(run|test|bench|task)$/.test(list[0]?.t ?? '')) list.shift();
  return list[0] && !/^python[\d.]*$/.test(cmd) || (list[0] && !args.some((x) => x.t === '-m')) ? list[0] : null;
}

// npm run <name>, npm test, pnpm <name>, yarn <name>: the scripts.<name> text (and its pre and post) in the nearest package.json,
// read together with the words handed on after the name (R2: `npm run hooks -- tools` is `husky tools`). Returns the index in
// args of a program word when yarn, pnpm or bun (or npm run, read as strictly) would run a program of that name: no script has it.
const PKG_VALUE = /^(--prefix|-C|--cwd|--dir|-w|--workspace|--filter|-F|--registry|--loglevel)$/;
const PKG_BUILTIN = new Set(['install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'upgrade', 'exec', 'dlx', 'x', 'init', 'create', 'list', 'ls', 'outdated', 'audit', 'why', 'pack', 'cache', 'config', 'info', 'view', 'link', 'unlink', 'prune', 'rebuild', 'dedupe', 'version', 'help', 'store', 'env', 'fetch', 'patch', 'import', 'root', 'bin', 'prefix', 'pkg', 'doctor', 'explain', 'diff', 'set', 'get', 'workspaces', 'workspace', 'global', 'dev', 'completion']);
const RUN_WORD = /^(run|run-script|rum|urun)$/;
function packageScripts(cmd, args, cwd, st, depth = 0) {
  let base = cwd ?? st.hint ?? null;
  const rest = []; // [word, index in args] of the words before -- that are not options
  for (let k = 0; k < args.length; k++) {
    const x = args[k].t;
    if (x === '--') break;
    if (/^(--prefix|-C|--cwd|--dir)$/.test(x)) { const d = args[++k]; base = d && !d.dyn && base ? physicalPath(d.t, base) : null; continue; }
    if (/^--(prefix|cwd|dir)=/.test(x)) { base = base ? physicalPath(x.slice(x.indexOf('=') + 1), base) : null; continue; }
    if (PKG_VALUE.test(x)) { k++; continue; }
    if (!x.startsWith('-')) rest.push([x, k]);
  }
  const names = [];
  const sub = rest[0]?.[0];
  if (!sub) return;
  let at = -1; // the index of the script's name: the words after it are handed on
  if (RUN_WORD.test(sub)) { if (rest[1]) { names.push(rest[1][0]); at = rest[1][1]; } } else if (/^(test|t|tst|start|stop|restart)$/.test(sub)) { names.push(sub === 't' || sub === 'tst' ? 'test' : sub); at = rest[0][1]; }
  else if (/^(install|i|ci|add)$/.test(sub)) {
    // the project's own lifecycle scripts (prepublish too), unless --ignore-scripts turns them off. npm reads a true or false
    // after it as its value, so that spelling asks and the scripts are read (N6).
    const k = args.findIndex((x) => x.t === '--ignore-scripts');
    const valued = k >= 0 && /^(true|false)$/i.test(args[k + 1]?.t ?? '');
    if (valued) st.asks.push('--ignore-scripts with a value after it');
    if (k < 0 || valued) names.push('install', 'prepare', 'prepublish');
  }
  else if (cmd !== 'npm' && !PKG_BUILTIN.has(sub) && !(cmd === 'bun' && sub === 'test')) { names.push(sub); at = rest[0][1]; }
  // A name that may be a program: yarn, pnpm and bun run one when no script has the name (npm run fails; read as strictly).
  const maybeBin = at >= 0 && names.length === 1 && !/^(test|start|stop|restart)$/.test(names[0]) && /^[\w.-]+$/.test(names[0]) && (cmd !== 'npm' || binNear(names[0], base, st));
  if (!names.length) return;
  if (!base) { st.hits.add('outside'); return; }
  // The nearest package.json at or above the folder, inside the job's folders. None at all: npm would fail, nothing runs.
  let dir = base;
  let file = null;
  for (let guard = 0; guard < 40 && dir && inRoots(dir, st.roots); guard++) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) { file = candidate; break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (!file) return maybeBin ? at : undefined;
  let scripts;
  try {
    const info = fs.statSync(file);
    if (info.size > MAX_SCRIPT) { st.hits.add('outside'); return; }
    scripts = JSON.parse(fs.readFileSync(file, 'utf8'))?.scripts ?? {};
  } catch { st.hits.add('outside'); return; }
  // The words handed on after the script's name: npm takes its own options before --; the others hand on everything.
  const after = at >= 0 ? args.slice(at + 1) : [];
  const dashes = after.findIndex((x) => x.t === '--');
  const handed = cmd === 'npm' ? [...(dashes < 0 ? after : after.slice(0, dashes)).filter((x) => !x.t.startsWith('-')), ...(dashes < 0 ? [] : after.slice(dashes + 1))] : after[0]?.t === '--' ? after.slice(1) : after;
  if (handed.some((x) => x.dyn)) st.asks.push('a word handed on to a package script that is not known until it runs');
  const tail = handed.filter((x) => !x.dyn).map((x) => ` ${shellQuote(x.t)}`).join('');
  // A script finds the programs in its package's own node_modules/.bin wherever it cd's to.
  const before = st.scriptBin;
  st.scriptBin = dir;
  try {
    for (const n of names) for (const key of [`pre${n}`, n, `post${n}`]) if (typeof scripts[key] === 'string') scanShell(scripts[key], dir, st, depth, key === n && at >= 0 ? tail : '');
  } finally { st.scriptBin = before; }
  return maybeBin && typeof scripts[names[0]] !== 'string' ? at : undefined;
}
const shellQuote = (t) => (/^[\w@%+=:,./-]+$/.test(t) ? t : `'${t.replace(/'/g, "'\\''")}'`);

// The path as written, made absolute from the folder, links not followed; null when it can't be placed.
function writtenPath(t, base) {
  if (typeof t !== 'string' || !t || /[$`\u0000*?[{]/.test(t)) return null;
  const x = t === '~' ? os.homedir() : t.startsWith('~/') ? path.join(os.homedir(), t.slice(2)) : t.startsWith('~') ? null : t;
  if (!x) return null;
  if (path.isAbsolute(x)) return path.resolve(x);
  return base && path.isAbsolute(base) ? path.resolve(base, x) : null;
}

// A file under node_modules/.bin/ or node_modules/<package>/ of the job's: the program it is ({ bin: the .bin entry's path as
// written }), or { pkg } when it is none of the package's programs; null for any other file (R2).
function packageProgram(t, base, st) {
  const p = writtenPath(t, base);
  const m = p ? /^(.*\/node_modules)\/(\.bin\/[^/]+|((?:@[^/]+\/)?[^/.][^/]*)\/.+)$/.exec(p) : null;
  if (!m || !inRoots(p, st.roots)) return null;
  if (m[2].startsWith('.bin/')) return { bin: p };
  const real = physicalPath(p, null);
  let entries = [];
  try { entries = fs.readdirSync(path.join(m[1], '.bin')); } catch { entries = []; }
  for (const e of entries.slice(0, 2000)) {
    let to = null;
    try { to = fs.realpathSync(path.join(m[1], '.bin', e)); } catch { to = null; }
    if (to && real && to === real) return { bin: path.join(m[1], '.bin', e) };
  }
  return { pkg: m[3] };
}

// The program after a runner's own options (npx -y, -p <package>, --): judged as that program. A shell command handed to the runner (-c) stops.
function runnerProgram(args, from, cwd, st, depth, viaXargs) {
  let k = from;
  for (; k < args.length; k++) {
    const t = args[k].t;
    if (t === '--') { k++; break; }
    if (!t.startsWith('-')) break;
    if (/^(-c|--call)(=|$)/.test(t)) { st.hits.add('outside'); return; }
    if (/^(-p|--package)$/.test(t)) k++;
  }
  const rest = args.slice(k);
  if (!rest.length) return;
  if (rest[0].dyn) { st.hits.add('outside'); return; }
  simple(rest, [], cwd, st, depth + 1, viaXargs);
}

// Is `name` in node_modules/.bin at or above the folder (or above the running package script's own folder), inside the job?
function binNear(name, from, st) {
  return [from, st.scriptBin].filter(Boolean).some((start) => {
    let dir = physicalPath(start, null);
    for (let guard = 0; guard < 40 && dir && inRoots(dir, st.roots); guard++) {
      try { if (fs.existsSync(path.join(dir, 'node_modules', '.bin', name))) return true; } catch { /* not there */ }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    return false;
  });
}

// pip: reading is fine; installing needs a virtual env of the job's own (run by its path), never --user or the system.
function pipStep(a, hit) {
  const sub = a.find((x) => !x.startsWith('-')) ?? '';
  if (['list', 'show', 'freeze', 'check', 'help', 'inspect', 'search', 'config', 'debug', 'hash'].includes(sub) || (!sub && a.some((x) => /^(--version|-V|--help|-h)$/.test(x)))) return;
  hit('outside');
}

// What a sed or awk script writes: the files it names for output, and anything it runs.
function scriptWrites(sed, script, cwd, st, writes) {
  if (sed) {
    for (const m of script.matchAll(/(?:^|[;{}\n]|\/[gpiImM0-9]*)\s*[wW]\s*([^\s;}]+)/g)) writes([{ t: m[1], dyn: m[1].includes('$') }]);
    if (/(?:^|[;{}\n])\s*e\b|\/[gpiImM0-9]*e\s*(?:$|[;}\n])/.test(script)) st.hits.add('outside'); // sed's e runs a command
    return;
  }
  for (const m of script.matchAll(/>>?\s*"?([^"\s;}]+)"?/g)) writes([{ t: m[1], dyn: m[1].includes('$') }]);
  if (/system\s*\(|getline|close\s*\(/.test(script) || /\|/.test(script.replace(/\|\|/g, ''))) st.hits.add('outside'); // awk's pipes and system() run commands
}

function findStep(args, a, cwd, st) {
  const starts = [];
  for (const x of args) { if (x.t.startsWith('-') || x.t === '!' || x.t === '(') break; starts.push(x); }
  const execAt = a.map((x, k) => (/^-(exec|execdir|ok|okdir)$/.test(x) ? k : -1)).filter((k) => k >= 0);
  const writes = a.some((x) => x === '-delete' || /^-(fprint0?|fprintf|fls)$/.test(x)) || execAt.length;
  if (writes) for (const s of starts.length ? starts : [{ t: '.', dyn: false }]) if (pathOutside(s, cwd, st)) st.hits.add('outside');
  for (const k of execAt) {
    const cmd = [];
    for (let j = k + 1; j < args.length && !(a[j] === ';' || a[j] === '+'); j++) cmd.push(args[j]);
    st.inFind = true;
    try { simple(cmd, [], cwd, st, 1, 'find'); } finally { st.inFind = false; } // its targets come from the folders just checked
  }
  for (let k = 0; k < a.length; k++) if (/^-(fprint0?|fprintf|fls)$/.test(a[k]) && pathOutside(args[k + 1] ?? { t: '', dyn: true }, cwd, st)) st.hits.add('outside');
}

function ghStep(cmd, args, a, st) {
  const hit = (rule) => st.hits.add(rule);
  const p = args.filter((x, k) => !(x.t.startsWith('-') || ['-R', '--repo'].includes(a[k - 1])) ).map((x) => x.t);
  const [group, action] = p;
  if (cmd === 'hub') {
    if (!['pull-request', 'ci-status', 'browse'].includes(group) && !(group === 'pr' && ['list', 'show', 'checkout'].includes(action))) { hit('outside'); st.unknown = true; }
    return;
  }
  if (group === 'pr' && action === 'merge') { hit('merge'); return; }
  if (group === 'auth' && action === 'token') { hit('outside'); st.secret = true; return; }
  // gh auth status printing the token is gh auth token by another name (m15).
  if (group === 'auth' && a.some((x) => x === '--show-token' || /^-[A-Za-z]*t/.test(x))) { hit('outside'); st.secret = true; return; }
  if (group === 'api') {
    const method = a.findIndex((x) => /^(-X|--method)$/.test(x));
    const glued = (a.find((x) => /^-X./.test(x)) ?? '').slice(2);
    const m = (method >= 0 ? a[method + 1] : glued || (a.find((x) => /^--method=/.test(x)) ?? '').slice(9)) || 'GET';
    if (a.some((x) => /\/merge(\?.*)?$/.test(x))) hit('merge');
    // The workflow's one write there, exactly: the job's branch made on its own org repository from a commit of the org's main (I2).
    const org = a[0] === 'api' && !args.some((x) => x.dyn) ? orgBranchCall(a.slice(1), st.ctx) : null;
    if (org) { st.asks.push(org); return; }
    if (m.toUpperCase() !== 'GET' || a.some((x) => /^(-f|-F|--field|--raw-field|--input)$/.test(x) || /^-[fF]./.test(x))) hit('outside');
    return;
  }
  if (a.some((x) => x === '--version' || x === '--help') && !group) return;
  const ok = GH_OK[group];
  if (ok === null && group) return; // gh search / gh status only read
  if (!ok || !ok.includes(action)) { hit('outside'); if (!ok) st.unknown = true; }
}

/**
 * `gh api -X POST repos/<org>/<repo>/git/refs -f ref=refs/heads/<branch> -f sha=<sha>` (the workflow's own spelling,
 * the method may be left to -f): the job's own org repository (ctx.orgRepo, from the org remote's address), exactly the
 * two fields, the job's own branch (ctx.branches, from git), and a commit git places on the org remote's main
 * (ctx.orgShas[sha] === true). Returns the Approver's reason with those facts, or null for anything else.
 */
function orgBranchCall(rest, ctx) {
  if (typeof ctx?.orgRepo !== 'string' || !ctx.orgRepo) return null;
  let endpoint = null;
  let method = null;
  const fields = [];
  for (let k = 0; k < rest.length; k++) {
    const x = rest[k];
    let m;
    if (x === '-X' || x === '--method') { method = String(rest[++k] ?? '').toUpperCase(); continue; }
    if ((m = /^(?:-X|--method=)(.+)$/.exec(x))) { method = m[1].toUpperCase(); continue; }
    if (['-f', '-F', '--field', '--raw-field'].includes(x)) { fields.push(String(rest[++k] ?? '')); continue; }
    if ((m = /^(?:-[fF]|--(?:raw-)?field=)(.+)$/.exec(x))) { fields.push(m[1]); continue; }
    if (x.startsWith('-') || endpoint !== null) return null;
    endpoint = x;
  }
  if (method !== null && method !== 'POST') return null;
  if (String(endpoint ?? '').replace(/^\//, '').toLowerCase() !== `repos/${ctx.orgRepo}/git/refs`.toLowerCase()) return null;
  const pairs = fields.map((x) => [x.slice(0, Math.max(0, x.indexOf('='))), x.slice(x.indexOf('=') + 1)]);
  if (pairs.length !== 2 || pairs.map(([k]) => k).sort().join() !== 'ref,sha') return null;
  const f = Object.fromEntries(pairs);
  const branch = /^refs\/heads\/([\w./-]+)$/.exec(f.ref)?.[1];
  if (!branch || branch.includes('..') || PROTECTED.test(branch) || !(ctx.branches ?? []).includes(branch)) return null;
  if (!/^[0-9a-f]{40}$/.test(f.sha) || ctx.orgShas?.[f.sha] !== true) return null;
  return `the workflow's org branch step: it makes the job's branch ${branch} on ${ctx.orgRepo} (the job's org repository) at ${f.sha}. Starbase checked the repository, that ${branch} is the job's own branch, and that the commit is on ${ctx.orgRemote ?? 'the org remote'}/main; GitHub refuses it if the branch exists.`;
}

// ---------- git ----------

// Subcommands that work on the repository and the worktree (push, remote, config, worktree, clone and init have their own rules below).
const GIT_LOCAL = new Set(['add', 'commit', 'checkout', 'switch', 'restore', 'reset', 'stash', 'branch', 'tag', 'merge', 'rebase', 'cherry-pick', 'revert', 'fetch', 'pull', 'clean', 'mv', 'rm', 'notes', 'reflog', 'bisect', 'sparse-checkout', 'symbolic-ref', 'ls-remote', 'show-ref', 'show-branch', 'diff-tree', 'diff-index', 'diff-files', 'push', 'send-pack', 'remote', 'config', 'worktree', 'clone', 'init', 'gc']);
const GIT_ENV = /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|NAMESPACE|CONFIG|SSH|EXEC_PATH|PROXY|ASKPASS)/;
const GIT_CFG_RISKY = /^(remote\.|branch\.|url\.|core\.(sshcommand|gitproxy|hookspath|fsmonitor|pager|editor)|push\.|include|alias\.|credential|http\.|submodule\.|filter\.|diff\.[^.]*\.(command|textconv))/i;
const normUrl = (u) => String(u ?? '').trim().replace(/\/+$/, '').replace(/\.git$/, '').toLowerCase();

function gitStep(args, assigns, cwd, st, xargs) {
  const { ctx } = st;
  const hit = (rule) => st.hits.add(rule);
  let i = 0;
  let eff = cwd;
  let foreign = assigns.some((x) => GIT_ENV.test(x));
  let risky = false;
  let withC = false; // any -c in front: a push with one stops, whatever the setting (I6)
  while (args[i]?.t.startsWith('-')) {
    const t = args[i].t;
    if (t === '-C') { const d = args[i + 1]; eff = !d || d.dyn || !eff ? null : physicalPath(d.t, eff); i += 2; continue; }
    if (t === '-c') { withC = true; if (GIT_CFG_RISKY.test(args[i + 1]?.t ?? '') || args[i + 1]?.dyn) risky = true; i += 2; continue; }
    if (/^--(git-dir|work-tree|exec-path|config-env|super-prefix)(=|$)/.test(t)) { foreign = true; i += t.includes('=') ? 1 : 2; continue; }
    i++;
  }
  const sub = args[i]?.t;
  const sargs = args.slice(i + 1);
  const a = sargs.map((x) => x.t);
  if (!sub) return;
  if (!GIT_READ.has(sub) && !GIT_LOCAL.has(sub)) { hit('outside'); st.unknown = true; return; } // a subcommand (or alias) we don't know
  const inWork = eff && st.work.some((w) => isInside(eff, w));
  if (a.some((x) => /^--(git-dir|work-tree)(=|$)/.test(x))) { hit('outside'); return; } // acts on another folder
  if (changesBranch(sub, a)) st.branchChange = true;
  if (sub === 'commit') { // a message read from a file: a literal file of the job's own, not a secret name (C2)
    for (let k = 0; k < sargs.length; k++) {
      const t = a[k];
      const m = /^(?:-[Ft]|--file=|--template=)(.*)$/.exec(t);
      const value = /^(-[Ft]|--file|--template)$/.test(t) ? sargs[k + 1] : m && m[1] !== undefined && (t.startsWith('--') || t.length > 2) ? { t: m[1], dyn: sargs[k].dyn } : null;
      if (!value) continue;
      const at = value.dyn ? null : physicalPath(value.t, eff);
      if (!at || !inRoots(at, st.roots) || SECRET_NAME.test(path.basename(at)) || value.t.includes('__HEREDOC__')) hit('outside');
    }
  }
  if (sub === 'push' || sub === 'send-pack') {
    st.pushed = true;
    if (foreign || risky || withC || !inWork || nestedRepo(eff, st) || pushStops(sargs, eff, ctx)) hit('push');
    return;
  }
  if (risky || foreign) { hit(foreign && !GIT_READ.has(sub) ? 'outside' : 'outside'); return; }
  if (sub === 'remote' && ['add', 'set-url', 'rename', 'remove', 'rm', 'set-head', 'set-branches'].includes(a[0])) { hit('push'); return; }
  // A branch's upstream set to anything but the fork redirects a later push (I6); any change of a git setting in the call holds a push in it.
  if (sub === 'branch') {
    const k = a.findIndex((x) => x === '-u' || x === '--set-upstream-to' || x.startsWith('--set-upstream-to=') || /^-u./.test(x));
    if (k >= 0) {
      st.gitSetting = true;
      const v = a[k].startsWith('--set-upstream-to=') ? a[k].slice(18) : /^-u./.test(a[k]) ? a[k].slice(2) : a[k + 1] ?? '';
      if (sargs.some((x) => x.dyn) || !v.startsWith(`${ctx.forkRemote || 'origin'}/`)) hit('push');
    }
  }
  const readForm = gitReadForm(sub, sargs);
  if (sub === 'remote' && a.length && !readForm) st.gitSetting = true;
  if (sub === 'config') {
    const read = a.some((x) => /^(--get|--get-all|--get-regexp|--list|-l|--get-urlmatch)$/.test(x));
    if (!read) st.gitSetting = true;
    if (a.some((x) => /^--(global|system|file|worktree|includes)|^-f$/.test(x))) { hit('outside'); return; }
    const key = a.find((x) => !x.startsWith('-')) ?? '';
    if (!read && GIT_CFG_RISKY.test(key)) hit('push');
    return;
  }
  if (sub === 'worktree' && ['add', 'move', 'remove', 'prune', 'repair'].includes(a[0])) {
    const skipValue = ['-b', '-B', '--reason'];
    const targets = [];
    for (let k = 1; k < sargs.length; k++) { if (skipValue.includes(a[k])) { k++; continue; } if (!a[k].startsWith('-')) targets.push(sargs[k]); }
    if (xargs || !eff) hit('outside');
    for (const t of targets.slice(0, a[0] === 'add' ? 1 : 2)) if (pathOutside(t, eff, st)) hit('outside');
    return;
  }
  if (sub === 'clone' || sub === 'init') {
    const CLONE_VALUE = /^(-b|--branch|--depth|-o|--origin|--reference|--reference-if-able|-c|--config|--template|-j|--jobs|--filter|--shallow-since|--shallow-exclude|-u|--upload-pack|--server-option|--bundle-uri|--separate-git-dir)$/;
    if (a.some((x) => /^--(separate-git-dir|reference|reference-if-able|template)(=|$)/.test(x))) hit('outside'); // a folder elsewhere comes into it
    const p = [];
    for (let k = 0; k < sargs.length; k++) { if (CLONE_VALUE.test(a[k])) { k++; continue; } if (!a[k].startsWith('-')) p.push(sargs[k]); }
    let dest = sub === 'clone' ? p[1] : p[0];
    if (!dest && sub === 'clone' && p[0]) dest = { t: p[0].t.replace(/[/\\]+$/, '').replace(/\.git$/, '').replace(/^.*[/:\\]/, ''), dyn: p[0].dyn };
    if (!dest) dest = { t: '.', dyn: false };
    if (!eff || pathOutside(dest, eff, st)) hit('outside');
    else if (sub === 'clone') { const at = physicalPath(dest.t, eff); if (at) st.cloneDirs.push(at); } // what it brings in is not known
    return;
  }
  // Bringing in work: only the org remote's main or the job's own branches, on the fork or the org remote (m3).
  if (sub === 'merge' || sub === 'pull' || sub === 'rebase') { if (foreignSource(sub, sargs, ctx)) hit('merge'); }
  if (sub === 'cherry-pick' && !a.some((x) => /^--(abort|continue|skip|quit)$/.test(x))) st.asks.push('a cherry-pick brings in someone else\'s commit');
  // Files that run code later put in place by git itself (I5).
  if (sub === 'mv') { const p = sargs.filter((x) => !x.t.startsWith('-')); if (p.length >= 2 && movesCodeLater(p.slice(0, -1), p.at(-1), eff, st)) hit('outside'); }
  if (sub === 'checkout' || sub === 'restore') {
    const dashes = a.indexOf('--');
    const list = [];
    for (let k = 0; k < sargs.length; k++) {
      if (dashes >= 0 && k <= dashes) continue;
      if (/^(-s|--source|-b|-B|--orphan|--conflict|--pathspec-from-file)$/.test(a[k])) { if (a[k] === '--pathspec-from-file') hit('outside'); k++; continue; }
      if (!a[k].startsWith('-')) list.push(sargs[k]);
    }
    const paths = dashes >= 0 || sub === 'restore' ? list : list.slice(1); // git checkout <ref> <path>…: the first word is the ref
    if (paths.some((x) => x.dyn || codeLater(physicalPath(x.t, eff), st.codeRoots))) hit('outside');
  }
  // Any other git command run in another folder (git -C <elsewhere>) acts there.
  if (!GIT_READ.has(sub) && !readForm && eff !== cwd && !(eff && inRoots(eff, st.gitRoots))) hit('outside');
}

// Is the source of a merge, pull or rebase anything but the org remote's main or one of the job's branches (m3)?
// No source (git pull, git rebase with their upstream) is not known to be one of them; --abort and the like have none to judge.
function foreignSource(sub, sargs, ctx) {
  const a = sargs.map((x) => x.t);
  if (a.some((x) => /^--(abort|continue|skip|quit|edit-todo|show-current-patch)$/.test(x))) return false;
  if (sargs.some((x) => x.dyn)) return true;
  const VALUE = /^(-m|-s|--strategy|-X|--strategy-option|-F|--file|--onto|--depth|-x|--exec)$/;
  const pos = [];
  for (let k = 0; k < a.length; k++) { if (VALUE.test(a[k])) { if (a[k] === '--onto') pos.push(a[k + 1] ?? ''); k++; continue; } if (!a[k].startsWith('-')) pos.push(a[k]); }
  const orgs = ctx.orgRemote ? [ctx.orgRemote] : ORG_REMOTES; // the org remote git names, else the known org remote names
  const fork = ctx.forkRemote || 'origin';
  const own = (ctx.branches ?? []).filter(Boolean);
  const ok = (ref) => orgs.some((org) => ref === `${org}/main` || own.some((b) => ref === `${org}/${b}`)) || own.some((b) => ref === b || ref === `${fork}/${b}` || ref === `refs/heads/${b}`);
  if (sub === 'pull') {
    if (!pos.length) return true;
    const [remote, ...refs] = pos;
    if (!orgs.includes(remote) && remote !== fork) return true;
    return !refs.length || refs.some((r) => !(r === 'main' && orgs.includes(remote)) && !own.includes(r));
  }
  if (!pos.length) return true;
  return pos.some((r) => !ok(r));
}

// A push from a folder with another repository between it and the worktree's top (a clone inside the job): its
// remotes are not the job's (I6). The worktree's own top is not counted; a folder git can't place counts.
function nestedRepo(eff, st) {
  if (!eff) return true;
  const top = st.work.filter((w) => isInside(eff, w)).sort((x, y) => y.length - x.length)[0];
  if (!top) return true;
  for (let dir = eff, guard = 0; dir !== top && guard < 64; guard++) {
    try { if (fs.existsSync(path.join(dir, '.git'))) return true; } catch { return true; }
    const up = path.dirname(dir);
    if (up === dir) return true;
    dir = up;
  }
  return false;
}

// Does this git command change which branch the worktree has checked out (or move a branch)?
function changesBranch(sub, a) {
  const positional = a.filter((x) => !x.startsWith('-'));
  if (sub === 'checkout' || sub === 'switch') return true;
  if (sub === 'branch') return a.some((x) => /^--(force|move|copy|delete)$/.test(x) || /^-[A-Za-z]*[fMmCcDd]/.test(x));
  if (sub === 'reset') return positional.some((x) => !/^(HEAD|@)([~^]\d*)*$/.test(x));
  if (sub === 'worktree') return a[0] === 'add';
  return false;
}

// Does this git push go anywhere but the fork, or to a branch that isn't the job's own?
function pushStops(sargs, eff, ctx) {
  const positional = [];
  let literal = false;
  for (let k = 0; k < sargs.length; k++) {
    const { t, dyn } = sargs[k];
    if (dyn) return true;
    if (!literal && t === '--') { literal = true; continue; }
    if (!literal && t.startsWith('--')) {
      const n = t.slice(2).split('=')[0];
      if (n.length >= 2 && PUSH_STOP_LONG.some((x) => x.startsWith(n))) return true;
      if (['push-option'].some((x) => x.startsWith(n)) && !t.includes('=')) k++;
      continue;
    }
    if (!literal && t.startsWith('-') && t !== '-') {
      if (/^-[A-Za-z]*[fd]/.test(t)) return true;
      if (t === '-o') k++;
      continue;
    }
    positional.push(t);
  }
  const remote = positional[0] ?? '';
  const refspecs = positional.slice(1);
  if (/[:/\\]|^[.~-]/.test(remote)) return true; // an address or a folder
  const fork = ctx.forkRemote || 'origin';
  const lookup = (n) => { try { return typeof ctx.remoteUrl === 'function' ? ctx.remoteUrl(n, eff) : null; } catch { return null; } };
  if (remote === fork) {
    const url = lookup(remote);
    if (!url || ORG_URL.test(url)) return true; // an address we can't read is not known to be the fork's
  } else {
    const target = lookup(remote);
    const mine = lookup(fork);
    if (!target || !mine || normUrl(target) !== normUrl(mine) || ORG_URL.test(target)) return true;
  }
  const own = (ctx.branches ?? []).filter(Boolean);
  if (!own.length) return true; // the job's branches are not known: no push is known to be its own
  // The branch a push with no refspec (or HEAD, or @) sends is the one checked out where it runs: in one of the job's
  // worktrees, the branch git lists there (R4); else the one checked out in the session's folder.
  let there = null;
  try { there = ctx.cwd && eff ? physicalPath(ctx.cwd, null) : null; } catch { there = null; }
  const branchOf = ctx.setup?.worktreeBranches && typeof ctx.setup.worktreeBranches === 'object' ? ctx.setup.worktreeBranches : {};
  const tree = eff ? (ctx.worktrees ?? []).map((w) => [w, physicalPath(w, null)]).filter(([, p]) => p && isInside(eff, p)).sort((x, y) => y[1].length - x[1].length)[0] : null;
  const treeBranch = tree ? branchOf[tree[0]] : undefined;
  const hereOwn = typeof treeBranch === 'string'
    ? own.includes(treeBranch) && !PROTECTED.test(treeBranch)
    : typeof ctx.currentBranch === 'string' && own.includes(ctx.currentBranch) && Boolean(there) && isInside(eff, there);
  if (!refspecs.length && !hereOwn) return true;
  const strip = (r) => r.replace(/^refs\/heads\//, '');
  for (const r of refspecs) {
    if (r.startsWith('+') || r.startsWith(':') || /[*]/.test(r)) return true;
    const colon = r.indexOf(':');
    const src = colon < 0 ? r : r.slice(0, colon);
    const dst = colon < 0 ? null : strip(r.slice(colon + 1));
    const landing = dst ?? strip(src);
    if (colon < 0 && (src === 'HEAD' || src === '@')) { if (!hereOwn) return true; continue; }
    if (/^refs\//.test(landing)) return true; // tags and other refs
    if (PROTECTED.test(landing) || !own.includes(landing)) return true;
  }
  return false;
}

// Does moving or copying these into dest put a file where code runs later: dest itself, dest joined with a source's
// name, or a source folder that holds workflows, actions, hooks or another such place (I5)? A path that can't be placed does.
const CODE_LATER_NAMES = /^(workflows|actions|hooks|\.git|\.github|\.husky|\.claude|\.githooks|\.mcp\.json|lefthook\.yml)$/i;
function movesCodeLater(sources, dest, cwd, st) {
  const d = dest && !dest.dyn ? physicalPath(dest.t, cwd) : null;
  if (!d) return true;
  if (codeLater(d, st.codeRoots)) return true;
  for (const s of sources) {
    const p = s && !s.dyn ? physicalPath(s.t, cwd) : null;
    if (!p) return true;
    if (codeLater(path.join(d, path.basename(p)), st.codeRoots)) return true;
    let list = [];
    try { if (fs.statSync(p).isDirectory()) list = fs.readdirSync(p); } catch { /* not there: judged by its name */ }
    if (list.some((n) => CODE_LATER_NAMES.test(n))) return true;
  }
  return false;
}
// ---------- paths ----------

// Is this path word outside the job's folders (or somewhere we can't tell)? A symlink inside the
// worktree that points out lands outside; .. that climbs out does too.
function pathOutside(word, cwd, st, strict = false) {
  if (word.t === '{}' && st.inFind) return false; // find's own results, from the folders it was checked on
  const p = physicalPath(word.t, cwd);
  if (p) st.touched.push(p);
  return !p || !inRoots(p, st.roots, strict);
}
