// Stacks (plan G14, G15, §6): one parent job whose plan splits a big ticket into sections, each a
// child job with its own worktree, branch, port and Foreman. This file is the plain-code half:
//
//   stack.md     the plan, in the parent's job folder, written by the coordinator (the parent's
//                Foreman). One "## Section: <name>" per section: a one-paragraph brief, Owns:
//                (paths, with * and **), Depends on: (other sections), optional Model: and Effort:.
//                It ends with Order: (the merge order, every section once).
//   parseStackPlan(text)       the sections, or errors in plain words
//   stack.json   the task list, also in the parent's folder, written only by the runner:
//                { version, parent, cap, autoIntegrate, model, effort, sections: [...], log: [...] }
//                Section states: pending, running, blocked, ready, integrated, failed (plan §6.3).
//   nextRunnable(stack, { globalRunning, globalCap })  who starts now, and why the rest wait
//   afterChecks(section, passed)                        the stuck rule: failed at three
//   nextToMerge(stack)                                  the next section in order, never out of it
//   mergeSection(...)            merges one section into the parent's branch, runs the checks,
//                                undoes the merge when they fail (git, no shell, a time limit)
//   ownedPathsHook(owned)        the PreToolUse hook that keeps a section's writes in its paths
//   describeStack(...)           what the Stack page shows: the four steps, the parts, words
//
// The coordinator never decides who runs next: the runner (runner/stacks.js) does, from here.

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { conflictedFiles, git, outsideOwned, ownedMatcher } from './integrate.js';
import { diffStat, fileDiff } from './stack-parts.js';

export const STACK_PLAN_FILE = 'stack.md';
export const STACK_FILE = 'stack.json';
export const SECTION_BRIEF_FILE = 'section.md';
export const STACK_VERSION = 1;

export const SECTION_STATES = ['pending', 'running', 'blocked', 'ready', 'integrated', 'failed'];
/** A section whose checks fail this many times stops and needs you (plan §6.2). */
export const STUCK_AT = 3;
/** Sections at once: per stack and, in Settings → Workflow, across every stack (plan §6.2). */
export const DEFAULT_CAP = 3;
export const MAX_CAP = 20;
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const DEFAULT_EFFORT = 'high';
/** The coordinator works one notch higher than its sections (plan §6.2). */
export const notchUp = (effort) => EFFORTS[Math.min(EFFORTS.indexOf(EFFORTS.includes(effort) ? effort : DEFAULT_EFFORT) + 1, EFFORTS.length - 1)];

/**
 * The word for one piece of a stack (settled in the Stack review): "part" in everything a person
 * reads (the Stack page, its history, its refusals), "section" in the files (stack.md's
 * "## Section:" headings, section.md) and in what the Foremen are told, which follows the files.
 * Every sentence takes its noun from one of these two.
 */
export const WORD = { one: 'part', many: 'parts' };
export const FILE_WORD = { one: 'section', many: 'sections' };

/** A section's name: it goes into folder and branch names. */
export const SECTION_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]{0,60}$/;

const list = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);
const NONE = /^(none|nothing|no|-|—|n\/a)\.?$/i;

// "a, b" or "`a`, `b`" (or several such lines, or "- a" lines below the label) → ['a', 'b'].
function items(text) {
  return String(text ?? '')
    .split(/[\n,]/)
    .map((s) => s.replace(/^\s*[-*]\s+/, '').replace(/`/g, '').trim().replace(/\.$/, ''))
    .filter((s) => s && !NONE.test(s));
}

// ---------- The plan: stack.md ----------

/**
 * stack.md → { ok, title, why, sections, order, errors, warnings }. why: the paragraph under the
 * title, before the first section (why the work splits this way), or null. sections come in the plan's order
 * (the Order line), each { name, brief, owns, dependsOn, model, effort }. errors are plain lines:
 * a name used twice, an unknown dependency, a dependency loop, a section missing from Order, no
 * owned paths (and a few more a person can fix in the file).
 */
export function parseStackPlan(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const errors = [];
  const warnings = [];
  const found = [];
  let title = null;
  let order = null;
  let current = null;
  let field = null; // the label a "- item" line below it belongs to
  let inOrderList = false;
  const why = []; // the paragraph under the title, before the first section: why the work splits this way
  let beforeSections = true;

  const startField = (sec, key, rest) => {
    field = key;
    sec[key].push(rest);
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const t = line.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(t);
    if (heading) {
      field = null;
      inOrderList = false;
      const sec = /^Section:\s*(.*)$/i.exec(heading[2].trim());
      if (sec) {
        beforeSections = false;
        current = { raw: sec[1].trim(), name: sec[1].trim(), brief: [], owns: [], dependsOn: [], model: [], effort: [] };
        found.push(current);
        continue;
      }
      if (/^Order\b:?\s*$/i.test(heading[2].trim())) { current = null; order = order ?? []; inOrderList = true; continue; }
      if (heading[1] === '#' && !title) title = heading[2].trim();
      current = null;
      continue;
    }
    const orderLine = /^\**Order\**\s*:\s*(.*)$/i.exec(t);
    if (orderLine) { order = items(orderLine[1]); field = null; inOrderList = !orderLine[1].trim(); continue; }
    if (inOrderList) {
      const it = /^(?:[-*]|\d+[.)])\s+(.+)$/.exec(t);
      if (it) { order.push(...items(it[1])); continue; }
      if (t) inOrderList = false;
    }
    if (!current) { if (beforeSections && t && !/^(Owns|Depends on|Model|Effort)\s*:/i.test(t)) why.push(t); continue; }
    const label = /^\**(Owns|Depends on|Model|Effort)\**\s*:\s*(.*)$/i.exec(t);
    if (label) {
      const key = { owns: 'owns', 'depends on': 'dependsOn', model: 'model', effort: 'effort' }[label[1].toLowerCase()];
      startField(current, key, label[2]);
      continue;
    }
    if (field && /^[-*]\s+/.test(t)) { current[field].push(t); continue; }
    if (!t) { field = null; continue; }
    field = null;
    current.brief.push(t);
  }

  const sections = found.map((s) => {
    const model = items(s.model.join('\n'))[0] ?? null;
    const effort = items(s.effort.join('\n'))[0]?.toLowerCase() ?? null;
    return {
      name: s.name,
      brief: s.brief.join(' ').replace(/\s+/g, ' ').trim(),
      owns: [...new Set(items(s.owns.join('\n')).map((p) => p.replace(/^\.\//, '')))],
      dependsOn: [...new Set(items(s.dependsOn.join('\n')))],
      model,
      effort,
    };
  });

  if (!sections.length) errors.push('There are no sections: add a “## Section: <name>” heading for each one.');
  const names = new Set();
  for (const s of sections) {
    if (!SECTION_NAME.test(s.name)) errors.push(`“${s.name.slice(0, 60)}” can’t be a section name: use lower-case letters, numbers and dashes (up to 40), like api or work-order.`);
    if (names.has(s.name)) errors.push(`The section name “${s.name}” is used twice. Give each section its own name.`);
    names.add(s.name);
    if (!s.owns.length) errors.push(`Section ${s.name} owns no paths: add an “Owns:” line naming the files and folders it may change.`);
    for (const p of s.owns) if (path.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.split(/[\\/]/).includes('..')) errors.push(`Section ${s.name} owns “${p}”: owned paths must be inside the repository, like app/api/**.`);
    if (!s.brief) warnings.push(`Section ${s.name} has no brief: add a paragraph saying what it builds.`);
    if (s.effort && !EFFORTS.includes(s.effort)) errors.push(`Section ${s.name}: Effort must be ${list(EFFORTS)}, not “${s.effort}”.`);
    if (s.model && !MODEL_ID.test(s.model)) errors.push(`Section ${s.name}: Model must be a model’s name, like ${DEFAULT_MODEL}, not “${s.model.slice(0, 60)}”.`);
    for (const d of s.dependsOn) {
      if (d === s.name) errors.push(`Section ${s.name} depends on itself.`);
      else if (!sections.some((x) => x.name === d)) errors.push(`Section ${s.name} depends on “${d}”, which isn’t a section in this plan.`);
    }
  }

  // A dependency loop: no section in it could ever start.
  const loop = findLoop(sections);
  if (loop) errors.push(`Sections ${list(loop)} depend on each other in a loop, so none of them could start. Take one dependency out.`);

  if (order === null) {
    if (sections.length) errors.push('There is no Order line: end the plan with “Order: …” naming every section once, in the order they merge.');
  } else {
    const seen = new Set();
    for (const n of order) {
      if (!names.has(n)) errors.push(`The Order line names “${n}”, which isn’t a section in this plan.`);
      if (seen.has(n)) errors.push(`The Order line names ${n} twice.`);
      seen.add(n);
    }
    for (const s of sections) if (!seen.has(s.name)) errors.push(`Section ${s.name} is missing from the Order line.`);
    // Merging goes in this order, and a section waits for what it depends on to merge: a section
    // ordered before one it depends on would wait for ever.
    if (!loop) {
      for (const s of sections) {
        for (const d of s.dependsOn) {
          if (order.includes(s.name) && order.includes(d) && order.indexOf(d) > order.indexOf(s.name)) errors.push(`Section ${s.name} depends on ${d}, but comes before it in the Order line: put ${d} first.`);
        }
      }
    }
  }

  // Owned paths should not overlap: the same entry in two sections, or one section's entry inside another's.
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const a = sections[i];
      const b = sections[j];
      const ma = ownedMatcher(a.owns);
      const mb = ownedMatcher(b.owns);
      const shared = [...a.owns.filter((p) => !/[*…]/.test(p) && mb(p)), ...b.owns.filter((p) => !/[*…]/.test(p) && ma(p))];
      if (shared.length) warnings.push(`Sections ${a.name} and ${b.name} both own ${list([...new Set(shared)])}. Owned paths shouldn’t overlap, or their merges may clash.`);
    }
  }

  const ordered = order && !errors.length ? order.map((n) => sections.find((s) => s.name === n)) : sections;
  return { ok: errors.length === 0, title, why: why.join(' ').replace(/\s+/g, ' ').trim() || null, sections: ordered, order: order ?? [], errors, warnings };
}

function findLoop(sections) {
  const by = new Map(sections.map((s) => [s.name, s]));
  const state = new Map(); // 1 visiting, 2 done
  const stack = [];
  let loop = null;
  const visit = (n) => {
    if (loop) return;
    state.set(n, 1);
    stack.push(n);
    for (const d of by.get(n)?.dependsOn ?? []) {
      if (!by.has(d) || d === n) continue;
      if (state.get(d) === 1) { loop = stack.slice(stack.indexOf(d)); return; }
      if (!state.get(d)) visit(d);
      if (loop) return;
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const s of sections) if (!state.get(s.name)) visit(s.name);
  return loop;
}

/** A short fingerprint of the plan's text, so the page can say when it changed after approval. */
export const planHash = (text) => createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 16);

// ---------- The task list: stack.json ----------

const whole = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
export class StackError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

/** A cap as the stack keeps it: a whole number from 1 to MAX_CAP. Throws StackError in plain words. */
export function cleanCap(cap, what = `${cap0(WORD.many)} at once`) {
  const n = Number(cap);
  if (!whole(n, 1, MAX_CAP)) throw new StackError(400, `${what} must be a whole number from 1 to ${MAX_CAP}.`);
  return n;
}
function cap0(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** The stack's settings from a page's patch: { cap, autoIntegrate, model, effort }; only what was sent. */
export function cleanSettings(body = {}, { models = null } = {}) {
  const out = {};
  if (body.cap !== undefined) out.cap = cleanCap(body.cap);
  if (body.autoIntegrate !== undefined) {
    if (typeof body.autoIntegrate !== 'boolean') throw new StackError(400, '“Merge on its own” is on or off.');
    out.autoIntegrate = body.autoIntegrate;
  }
  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || !MODEL_ID.test(body.model) || (models && !models.includes(body.model))) throw new StackError(400, `Pick one of the offered models${models ? ` (${list(models)})` : ''}.`);
    out.model = body.model;
  }
  if (body.effort !== undefined) {
    if (!EFFORTS.includes(body.effort)) throw new StackError(400, `Effort must be ${list(EFFORTS)}.`);
    out.effort = body.effort;
  }
  return out;
}

/**
 * A new stack.json from an approved plan. parent: the parent job's slug. where: { repo,
 * parentBranch, parentWorktree, base }. Every section starts pending.
 */
export function newStack({ parent, plan, cap = DEFAULT_CAP, autoIntegrate = false, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, where = {}, planText = '', at = new Date().toISOString() }) {
  return {
    version: STACK_VERSION,
    parent,
    cap,
    autoIntegrate,
    model,
    effort,
    repo: where.repo ?? null,
    parentBranch: where.parentBranch ?? null,
    parentWorktree: where.parentWorktree ?? null,
    base: where.base ?? null,
    planApprovedAt: at,
    planHash: planHash(planText),
    push: { state: 'waiting', approvedAt: null, pushedAt: null, note: null, remote: where.remote ?? null },
    sections: plan.sections.map((s) => ({
      name: s.name, state: 'pending', slug: null, branch: null, worktree: null, port: null,
      failures: 0, mergedAt: null, mergeSha: null,
      owns: s.owns, dependsOn: s.dependsOn, model: s.model ?? null, effort: s.effort ?? null,
      startedAt: null, readyAt: null, sentBackAt: null, problem: null,
    })),
    log: [{ at, event: 'plan-approved', words: `The plan was approved: ${plan.sections.length} ${plan.sections.length === 1 ? WORD.one : WORD.many}, merging in the order ${plan.sections.map((s) => s.name).join(', ')}.` }],
  };
}

/** One line in stack.json's log (kept to the last 500). */
export function logEvent(stack, event, words, extra = {}) {
  stack.log = [...(stack.log ?? []), { at: new Date().toISOString(), event, words, ...extra }].slice(-500);
  return stack;
}

/** Read <dir>/stack.json, or null when there is none (or it can't be read). */
export async function readStack(dir) {
  try {
    const s = JSON.parse(await fs.readFile(path.join(dir, STACK_FILE), 'utf8'));
    return s && typeof s === 'object' && Array.isArray(s.sections) ? s : null;
  } catch { return null; }
}

/** Write <dir>/stack.json through a temp file (only the runner writes it). */
export async function writeStack(dir, stack) {
  const file = path.join(dir, STACK_FILE);
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(stack, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
  return stack;
}

/** Read <dir>/stack.md: { text, plan }, or null when there is none. */
export async function readPlan(dir) {
  let text;
  try { text = await fs.readFile(path.join(dir, STACK_PLAN_FILE), 'utf8'); } catch { return null; }
  return { text, plan: parseStackPlan(text) };
}

// ---------- The scheduler (plan §6.3) ----------

// What holds a slot: a section whose Foreman has work in hand (building, or back with a problem).
const HOLDS_SLOT = new Set(['running', 'blocked']);
/** How many of a stack's sections hold a slot now. */
export const runningCount = (stack) => (stack?.sections ?? []).filter((s) => HOLDS_SLOT.has(s.state)).length;

/**
 * The sections to start now, and why each other pending one waits. A pending section is runnable
 * when every section it depends on has integrated; runnable ones start in the plan's order while
 * the stack's cap and the global cap (Settings → Workflow) both have room. globalRunning counts the
 * running sections of every stack, this one included.
 * Returns { start: [name], queued: [{ name, reason }] }.
 */
export function nextRunnable(stack, { globalRunning = null, globalCap = DEFAULT_CAP } = {}) {
  const sections = stack?.sections ?? [];
  const cap = whole(stack?.cap, 1, MAX_CAP) ? stack.cap : DEFAULT_CAP;
  const gcap = whole(globalCap, 1, MAX_CAP) ? globalCap : DEFAULT_CAP;
  let here = runningCount(stack);
  let everywhere = Number.isInteger(globalRunning) ? Math.max(globalRunning, here) : here;
  const integrated = new Set(sections.filter((s) => s.state === 'integrated').map((s) => s.name));
  const start = [];
  const queued = [];
  for (const s of sections) {
    if (s.state !== 'pending') continue;
    const waitingFor = (s.dependsOn ?? []).filter((d) => !integrated.has(d));
    if (waitingFor.length) {
      queued.push({ name: s.name, reason: `Waiting for ${waitingFor.length === 1 ? `${WORD.one} ${waitingFor[0]}` : `${WORD.many} ${list(waitingFor)}`} to merge` });
      continue;
    }
    if (here >= cap) { queued.push({ name: s.name, reason: `Waiting for a free slot: ${here} of ${cap} in use` }); continue; }
    if (everywhere >= gcap) { queued.push({ name: s.name, reason: `Waiting for a free slot: ${everywhere} of ${gcap} in use across every stack` }); continue; }
    start.push(s.name);
    here += 1;
    everywhere += 1;
  }
  return { start, queued };
}

/**
 * After the checks ran on a section's merge: a pass changes nothing; a failure counts one, and
 * the third makes the section failed (stuck: it stops and needs you). Returns the new section.
 */
export function afterChecks(section, passed) {
  if (passed) return { ...section };
  const failures = (section.failures ?? 0) + 1;
  return { ...section, failures, state: failures >= STUCK_AT ? 'failed' : 'running' };
}

/** Whether a section is stuck (failed at three, or failed any other way). */
export const isStuck = (section) => section?.state === 'failed';

/**
 * The next section to merge: the first in the plan's order that hasn't integrated. Returns
 * { section, ready, reason } (section null when every one has merged). Never out of order.
 */
export function nextToMerge(stack) {
  const next = (stack?.sections ?? []).find((s) => s.state !== 'integrated') ?? null;
  if (!next) return { section: null, ready: false, reason: `Every ${WORD.one} is merged.` };
  if (next.state === 'ready') return { section: next, ready: true, reason: null };
  const why = {
    pending: 'hasn’t started yet',
    running: 'is still being built',
    blocked: 'is back with its Foreman',
    failed: 'is stuck and needs you',
  }[next.state] ?? 'isn’t ready';
  return { section: next, ready: false, reason: `${cap0(WORD.one)} ${next.name} is next to merge, and it ${why}. ${cap0(WORD.many)} merge only in order.` };
}

/**
 * Whether a section's own gates have passed, from its status.json (the raw object): review is
 * done (stage "review", stage_state "done"), or it has gone past review.
 */
export function sectionReady(status) {
  if (!status || typeof status !== 'object') return false;
  if (status.stage === 'review' && status.stage_state === 'done') return true;
  return ['pr1', 'pr2', 'staging-qa', 'pr3'].includes(status.stage);
}

// ---------- Names, folders and the section's brief ----------

/** The section's job folder name: <parent-slug>--<section>. */
export const sectionSlug = (parent, name) => `${parent}--${name}`;

/** The section's brief (section.md in its job folder): its spec, as the stack plan has it. */
export function sectionBrief({ parent, ticketKey = null, section, index, total, parentBranch, worktree, branch, port }) {
  return [
    `# ${cap0(FILE_WORD.one)} ${index} of ${total}: ${section.name}`,
    '',
    `Part of stack ${ticketKey ?? parent}. The stack plan (stack.md in the parent's job folder, ${parent}) is this job's spec.`,
    '',
    section.brief || '(The plan gives no brief for this section: ask the coordinator.)',
    '',
    `- Owns (the only paths you may change): ${section.owns.map((p) => `\`${p}\``).join(', ')}`,
    `- Depends on: ${section.dependsOn?.length ? section.dependsOn.join(', ') : 'nothing'}`,
    `- Worktree: ${worktree}`,
    `- Branch: ${branch} (from ${parentBranch})`,
    `- Port for trying it: ${port ?? 'none'}`,
    '',
    'Start at plan: clarify and spec are skipped. Don’t push and don’t open pull requests: the coordinator merges this branch into the parent’s once your checks pass. When review is done, write status.json with stage "review" and stage_state "done".',
    '',
  ].join('\n');
}

// ---------- Git: worktrees and the merge (code only) ----------

const firstLine = (s) => String(s ?? '').trim().split('\n').pop() || 'no reason given';
async function gitOk(dir, args, opts) {
  const r = await git(dir, args, opts);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** Whether `ref` names a commit in the repository at `dir`. */
export async function refExists(dir, ref) {
  return (await git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).code === 0;
}

/**
 * A worktree at `worktree` on `branch`, made from `from` when the branch is new. One already there
 * on that branch is kept. Returns { ok, made, message }.
 */
export async function ensureWorktree({ repo, worktree, branch, from }) {
  const there = await fs.stat(worktree).then((s) => s.isDirectory(), () => false);
  if (there) {
    const on = await gitOk(worktree, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (on === branch) return { ok: true, made: false };
    return { ok: false, message: `The folder ${worktree} is already there${on ? ` on ${on}` : ''}, not on ${branch}. Move it, or remove it with git worktree remove.` };
  }
  const has = await refExists(repo, `refs/heads/${branch}`);
  const args = has ? ['worktree', 'add', worktree, branch] : ['worktree', 'add', '-b', branch, worktree, from];
  const r = await git(repo, args, { timeout: 120000 });
  if (r.code !== 0) return { ok: false, message: `git couldn’t make the worktree ${worktree} on ${branch}: ${firstLine(r.stderr || r.stdout)}.` };
  return { ok: true, made: true };
}

/** One check command (the profile's checks: lines), run in `dir` through the shell. */
export function runCheck({ dir, command, timeoutMs = 20 * 60 * 1000, onOutput = () => {} }) {
  return new Promise((resolve) => {
    const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' };
    delete env.PORT; delete env.WIREFRAMES_PORT;
    let out = '';
    const keep = (d) => { out = (out + String(d)).slice(-6000); onOutput(String(d)); };
    let child;
    try { child = spawn(command, { cwd: dir, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (err) { resolve({ command, ok: false, code: null, tail: `Couldn’t start it: ${err.message}` }); return; }
    const timer = setTimeout(() => { keep(`\nIt took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped.\n`); child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', (err) => { clearTimeout(timer); resolve({ command, ok: false, code: null, tail: `Couldn’t start it: ${err.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ command, ok: code === 0, code, tail: out.trim().split('\n').slice(-15).join('\n') }); });
  });
}

/**
 * Merge one section into the parent's branch, checked out at `parentWorktree`, then run `checks`
 * there (the profile's checks: commands). Code only; nothing is pushed.
 *   - A diff that touches files outside the section's owned paths is refused, with the list.
 *   - A conflict leaves the branch as it was (git merge --abort) and names the files.
 *   - A failed check undoes the merge (git reset --hard to the commit before it, on the parent's
 *     branch only), so the branch always passes.
 * Resolves { outcome, words, files?, checks?, sha?, before? }, outcome one of:
 *   refused | empty | outside | conflict | failed | checks-failed | merged
 */
export async function mergeSection({ parentWorktree, parentBranch, section, checks = [], onOutput = () => {}, runCheckFn = runCheck }) {
  const name = section.name;
  const on = await gitOk(parentWorktree, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (on !== parentBranch) return { outcome: 'refused', words: `The parent’s worktree (${parentWorktree}) is on ${on ?? 'no branch'}, not ${parentBranch}, so nothing was merged.` };
  if ((await git(parentWorktree, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).code === 0) return { outcome: 'refused', words: `A merge is already under way in ${parentWorktree}. Finish it or undo it there first.` };
  const dirty = await gitOk(parentWorktree, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty === null) return { outcome: 'refused', words: `git couldn’t read ${parentWorktree}.` };
  if (dirty) return { outcome: 'refused', words: `The parent’s worktree has changes that aren’t committed, so nothing was merged. Commit them or put them aside first.` };
  if (!(await refExists(parentWorktree, `refs/heads/${section.branch}`))) return { outcome: 'failed', words: `There is no branch ${section.branch} to merge.` };

  const ahead = Number(await gitOk(parentWorktree, ['rev-list', '--count', `HEAD..${section.branch}`, '--']));
  if (!ahead) return { outcome: 'empty', words: `${cap0(WORD.one)} ${name} has nothing committed that ${parentBranch} doesn’t already have.` };
  const changedOut = await gitOk(parentWorktree, ['diff', '--name-only', '--no-renames', `HEAD...${section.branch}`, '--']);
  const changed = changedOut === null ? null : changedOut.split('\n').map((s) => s.trim()).filter(Boolean);
  const outside = outsideOwned(changed, section.owns ?? []);
  if (outside === null) return { outcome: 'failed', words: `git couldn’t list what ${section.branch} changed.` };
  if (outside.length) {
    return { outcome: 'outside', files: outside, words: `${cap0(WORD.one)} ${name} changed ${outside.length === 1 ? 'a file' : `${outside.length} files`} outside its owned paths, so it wasn’t merged: ${list(outside.slice(0, 10))}${outside.length > 10 ? ` and ${outside.length - 10} more` : ''}.` };
  }

  const before = await gitOk(parentWorktree, ['rev-parse', 'HEAD']);
  const message = `Merge ${FILE_WORD.one} ${name} into ${parentBranch}`;
  onOutput(`$ git merge --no-ff ${section.branch}\n`);
  const merged = await git(parentWorktree, ['merge', '--no-ff', '--no-edit', section.branch, '-m', message], { timeout: 120000 });
  if (merged.code !== 0) {
    const files = await conflictedFiles(parentWorktree);
    await git(parentWorktree, ['merge', '--abort']);
    if (files.length) return { outcome: 'conflict', files, before, words: `${cap0(WORD.one)} ${name} clashes with ${parentBranch} in ${list(files.slice(0, 10))}${files.length > 10 ? ` and ${files.length - 10} more` : ''}. Nothing was merged: the branch is as it was.` };
    return { outcome: 'failed', before, words: `git couldn’t merge ${section.branch}: ${firstLine(merged.stderr || merged.stdout)}. Nothing was merged.` };
  }
  const sha = await gitOk(parentWorktree, ['rev-parse', 'HEAD']);
  const results = [];
  for (const command of checks) {
    onOutput(`$ ${command}\n`);
    const r = await runCheckFn({ dir: parentWorktree, command, onOutput });
    results.push(r);
    if (!r.ok) break;
  }
  const failed = results.find((r) => !r.ok);
  if (failed) {
    const undo = await git(parentWorktree, ['reset', '--hard', before]);
    const undone = undo.code === 0;
    return {
      outcome: 'checks-failed', checks: results, before, sha, undone,
      words: `The checks failed after merging ${WORD.one} ${name} (${failed.command}), so ${undone ? 'the merge was undone and ' : ''}${parentBranch} is ${undone ? 'back where it was' : `NOT back where it was: run git reset --hard ${before} in ${parentWorktree}`}.`,
    };
  }
  return {
    outcome: 'merged', sha, before, checks: results,
    words: `${cap0(WORD.one)} ${name} is merged into ${parentBranch}${results.length ? `, and the checks passed (${results.map((r) => r.command).join('; ')})` : ' (no checks are set for this repository, so none ran)'}.`,
  };
}

// ---------- The owned-paths hook (plan §6.5) ----------

const inside = (p, dir) => {
  if (!p || !dir) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** The tools that write files, which the hook watches. */
export const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
export const WRITE_TOOLS_MATCHER = WRITE_TOOLS.join('|');

/** The words a refused write gets. */
export const ownedRefusal = (owns) => `This ${FILE_WORD.one} may only change: ${owns.join(', ')}.`;

/**
 * Whether a section may write `file`: inside its job folder always; inside its worktree only on
 * an owned path; nowhere else. owned: { owns, worktree, jobDir }. Returns { ok, reason }.
 */
export function ownedWrite(file, { owns = [], worktree = null, jobDir = null } = {}, cwd = null) {
  if (typeof file !== 'string' || !file) return { ok: true }; // nothing named: Claude Code refuses it itself
  const abs = path.resolve(cwd ?? worktree ?? '.', file);
  if (jobDir && inside(abs, jobDir)) return { ok: true };
  if (worktree && inside(abs, worktree)) {
    const rel = path.relative(path.resolve(worktree), abs).split(path.sep).join('/');
    if (ownedMatcher(owns)(rel)) return { ok: true };
  }
  return { ok: false, reason: ownedRefusal(owns) };
}

/**
 * The PreToolUse hook on Edit|Write|MultiEdit|NotebookEdit for a section's Foreman (and its crew):
 * a write outside the section's owned paths, or outside its worktree, is refused with
 * "This section may only change: <paths>." Its job folder stays writable. onRefuse(verdict, input)
 * is told about each refusal (for the audit).
 */
export function ownedPathsHook(owned, onRefuse = () => {}) {
  return async (input) => {
    if (input?.hook_event_name !== 'PreToolUse' || !WRITE_TOOLS.includes(input.tool_name)) return {};
    const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? null;
    const v = ownedWrite(file, owned, input.cwd || owned.worktree);
    if (v.ok) return {};
    try { await onRefuse({ decision: 'deny', reason: v.reason, file }, input); } catch { /* recording must not change the answer */ }
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: v.reason } };
  };
}

async function readJsonFile(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

/**
 * The owned paths of the section a job folder is, or null when it isn't one: its status.json names
 * a `stack` (the parent's folder name, beside it) and a `section`, and the parent's stack.json (or
 * its stack.md) has that section. Returns { section, owns, worktree, jobDir }.
 */
export async function sectionOwnership(featureDir) {
  if (!featureDir) return null;
  const status = await readJsonFile(path.join(featureDir, 'status.json'));
  const stackSlug = typeof status?.stack === 'string' ? status.stack : null;
  const name = typeof status?.section === 'string' ? status.section : null;
  if (!stackSlug || !name || stackSlug.includes('/') || stackSlug.includes('\\') || stackSlug.startsWith('.')) return null;
  const parentDir = path.join(path.dirname(featureDir), stackSlug);
  const stack = await readStack(parentDir);
  let sec = stack?.sections?.find((s) => s.name === name) ?? null;
  if (!sec) sec = (await readPlan(parentDir))?.plan.sections.find((s) => s.name === name) ?? null;
  if (!sec) return null;
  return { section: name, owns: sec.owns ?? [], worktree: sec.worktree ?? (typeof status.worktree === 'string' ? status.worktree : null), jobDir: featureDir };
}

// ---------- What the Stack page shows ----------

export const STEPS = [
  { id: 'plan', label: 'Plan' },
  { id: 'build', label: 'Build' },
  { id: 'merge', label: 'Merge' },
  { id: 'push', label: 'Push' },
];

/** Where a stack is: plan (not approved), build, merge (one is ready or merged), push, pushed. */
export function stackPhase(stack) {
  if (!stack) return 'plan';
  const secs = stack.sections ?? [];
  if (secs.length && secs.every((s) => s.state === 'integrated')) return stack.push?.state === 'pushed' ? 'pushed' : 'push';
  if (secs.some((s) => s.state === 'ready' || s.state === 'integrated')) return 'merge';
  return 'build';
}

/** A section state in words (never colour alone). */
export const STATE_WORDS = {
  pending: 'Queued',
  running: 'Building',
  blocked: 'Back with its Foreman',
  ready: 'Ready to merge',
  integrated: 'Merged',
  failed: 'Stuck: needs you',
};

// The section's own stages, in order, for its line on the map.
const SECTION_STAGES = ['plan', 'implement', 'test', 'review'];
const STAGE_WORDS = { plan: 'Planning', implement: 'Building', test: 'Testing', review: 'In review' };

/** How far a section's own job has got: { stage, step, of, words } from its status.json. */
export function sectionProgress(status, state) {
  const of = SECTION_STAGES.length;
  if (state === 'integrated') return { stage: 'merged', step: of, of, words: 'Merged' };
  if (state === 'ready') return { stage: 'review', step: of, of, words: 'Done: its checks passed' };
  if (!status || state === 'pending') return { stage: null, step: 0, of, words: state === 'pending' ? 'Not started' : 'Starting' };
  const i = SECTION_STAGES.indexOf(status.stage);
  const step = i < 0 ? 0 : i + (status.stage_state === 'done' ? 1 : 0);
  const waiting = status.stage_state === 'waiting_for_you' ? ': waiting for you' : status.stage_state === 'blocked' ? ': blocked' : '';
  return { stage: status.stage ?? null, step, of, words: `${STAGE_WORDS[status.stage] ?? 'Working'}${waiting}` };
}

/**
 * The Stack page's view of one stack. plan: parseStackPlan's result (or null); stack: stack.json
 * (null before the plan is approved); statuses: { [section]: its status.json }; runs: { [section]:
 * its Foreman's reply status }; busy: what runs now ({ what, section }), or null.
 */
export function describeStack({ slug, title = null, ticketKey = null, plan = null, planText = null, stack = null, statuses = {}, runs = {}, busy = null, globalRunning = 0, globalCap = DEFAULT_CAP, coordinator = null }) {
  const phase = stackPhase(stack);
  const at = STEPS.findIndex((s) => s.id === (phase === 'pushed' ? 'push' : phase));
  const steps = STEPS.map((s, i) => ({ ...s, state: phase === 'pushed' || i < at ? 'done' : i === at ? 'now' : 'next' }));
  steps.forEach((s) => { s.words = s.state === 'done' ? 'Done' : s.state === 'now' ? 'Now' : 'Not yet'; });

  const sections = stack?.sections ?? (plan?.sections ?? []).map((s) => ({ ...s, state: 'pending', failures: 0 }));
  const queue = stack ? nextRunnable(stack, { globalRunning, globalCap }) : { start: [], queued: [] };
  const reasons = Object.fromEntries(queue.queued.map((q) => [q.name, q.reason]));
  const planSecs = plan?.sections ?? [];
  const parts = sections.map((s, i) => {
    const fromPlan = planSecs.find((p) => p.name === s.name) ?? {};
    return {
      n: i + 1,
      name: s.name,
      brief: fromPlan.brief ?? s.brief ?? '',
      owns: s.owns ?? fromPlan.owns ?? [],
      dependsOn: s.dependsOn ?? fromPlan.dependsOn ?? [],
      state: s.state,
      stateWords: STATE_WORDS[s.state] ?? s.state,
      reason: !stack ? 'Starts once you approve the plan' : s.state === 'pending' ? reasons[s.name] ?? 'Starting soon' : s.state === 'failed' ? `Its checks failed ${s.failures ?? STUCK_AT} times. It has stopped and needs you.` : s.problem?.words ?? null,
      progress: sectionProgress(statuses[s.name] ?? null, s.state),
      run: runs[s.name] ?? null,
      slug: s.slug ?? null,
      branch: s.branch ?? null,
      worktree: s.worktree ?? null,
      port: s.port ?? null,
      failures: s.failures ?? 0,
      stuck: s.state === 'failed',
      problem: s.problem ?? null,
      model: s.model ?? fromPlan.model ?? null,
      effort: s.effort ?? fromPlan.effort ?? null,
      mergedAt: s.mergedAt ?? null,
      mergeSha: s.mergeSha ?? null,
      // Packet V: when it started and became ready, and when it was last sent back (stack.json).
      startedAt: s.startedAt ?? null,
      readyAt: s.readyAt ?? null,
      sentBackAt: s.sentBackAt ?? null,
    };
  });

  const merge = stack ? nextToMerge(stack) : { section: null, ready: false, reason: null };
  let next;
  const stuck = parts.find((p) => p.stuck);
  const blocked = parts.find((p) => p.state === 'blocked');
  if (!stack) {
    next = plan?.ok
      ? { action: 'approve-plan', label: 'Approve plan', key: 'a', words: `The Foreman has split the ticket into ${parts.length} ${parts.length === 1 ? WORD.one : WORD.many}. Approve the plan to start building.` }
      : { action: 'fix-plan', label: 'Change something', key: 'r', words: plan ? `The plan has ${plan.errors.length === 1 ? 'a problem' : `${plan.errors.length} problems`} to fix first: ${plan.errors[0]}` : 'There is no stack plan (stack.md) yet. The Foreman writes it.' };
  } else if (busy) {
    next = { action: 'wait', label: null, key: null, words: busy.words ?? 'Working…' };
  } else if (stuck) {
    next = { action: 'open-part', label: `Open ${WORD.one} ${stuck.n}`, key: 'o', section: stuck.name, words: `${cap0(WORD.one)} ${stuck.n} (${stuck.name}) failed its checks ${stuck.failures} times and stopped. It needs you.` };
  } else if (merge.section?.state === 'blocked' && blocked) {
    next = { action: 'hand-back', label: `Send ${WORD.one} ${blocked.n} back`, key: 'r', section: blocked.name, words: blocked.problem?.words ?? `${cap0(WORD.one)} ${blocked.n} needs its Foreman.` };
  } else if (merge.ready) {
    const p = parts.find((x) => x.name === merge.section.name);
    next = stack.autoIntegrate
      ? { action: 'wait', label: null, key: null, section: p.name, words: `${cap0(WORD.one)} ${p.n} is ready and merges on its own.` }
      : { action: 'merge', label: `Merge ${WORD.one} ${p.n}`, key: 'm', section: p.name, words: `${cap0(WORD.one)} ${p.n} (${p.name}) is ready. Merge it into ${stack.parentBranch}?` };
  } else if (phase === 'push') {
    next = stack.push?.state === 'approved'
      ? { action: 'wait', label: null, key: null, words: 'You said go. The coordinator is pushing to your fork.' }
      : { action: 'push', label: 'Push', key: 'p', words: `Every ${WORD.one} is merged and the checks pass. Push ${stack.parentBranch} to your fork?` };
  } else if (phase === 'pushed') {
    next = { action: 'open-job', label: 'Open the job', key: null, words: `${stack.parentBranch} is pushed to your fork. Open the job to open the pull request.` };
  } else {
    next = { action: 'wait', label: null, key: null, words: merge.reason ?? 'Building.' };
  }

  return withChanges({
    slug, title, ticketKey,
    phase, steps, next,
    plan: plan ? { ok: plan.ok, why: plan.why ?? null, errors: plan.errors, warnings: plan.warnings, changedSinceApproval: Boolean(stack && planText !== null && planHash(planText) !== stack.planHash), text: planText ?? null } : null,
    approved: Boolean(stack),
    planApprovedAt: stack?.planApprovedAt ?? null,
    cap: stack?.cap ?? DEFAULT_CAP,
    autoIntegrate: stack?.autoIntegrate ?? false,
    model: stack?.model ?? DEFAULT_MODEL,
    effort: stack?.effort ?? DEFAULT_EFFORT,
    coordinatorEffort: notchUp(stack?.effort ?? DEFAULT_EFFORT),
    globalCap, globalRunning,
    running: stack ? runningCount(stack) : 0,
    parentBranch: stack?.parentBranch ?? null,
    parentWorktree: stack?.parentWorktree ?? null,
    repo: stack?.repo ?? null,
    push: stack?.push ?? null,
    nextToMerge: merge.section?.name ?? null,
    busy,
    parts,
    log: [...(stack?.log ?? [])].reverse().slice(0, 100),
    coordinator,
  });
}

/**
 * A part's changed files and one file's diff against the stack's branch, read-only (packet V). They
 * ride on the view as a reader that isn't part of its JSON (view.readChanges), so the site's routes
 * can ask without running git themselves. Git runs in the part's worktree when it is there, else in
 * the repository. gitFn: for tests.
 */
export function withChanges(view, gitFn = git) {
  const where = async (name) => {
    const p = view.parts.find((x) => x.name === name);
    if (!p) return null;
    const there = p.worktree ? await fs.stat(p.worktree).then((st) => st.isDirectory(), () => false) : false;
    return { dir: there ? p.worktree : view.repo, base: view.parentBranch, branch: p.branch };
  };
  Object.defineProperty(view, 'readChanges', {
    enumerable: false,
    configurable: true,
    value: {
      async files(name) { const w = await where(name); return w ? diffStat({ git: gitFn, ...w }) : { error: 'No such part.', files: [], added: 0, removed: 0 }; },
      async diff(name, file) { const w = await where(name); return w ? fileDiff({ git: gitFn, ...w, file }) : { error: 'No such part.' }; },
    },
  });
  return view;
}

/** One stack's line on the Stacks list: its steps, where it is, and what it needs, in words. */
export function stackSummary(view) {
  const counts = {};
  for (const p of view.parts) counts[p.state] = (counts[p.state] ?? 0) + 1;
  return {
    slug: view.slug, title: view.title, ticketKey: view.ticketKey, phase: view.phase, steps: view.steps,
    parts: view.parts.length, counts, needs: view.next.words, action: view.next.action,
    // Each part's job, so Jobs can show a stack as one row that opens into its parts.
    sections: view.parts.map((p) => ({ n: p.n, name: p.name, slug: p.slug, state: p.state, stateWords: p.stateWords })),
    // Packet V: what the Stacks home's card is worked out from (lib/stack-parts.js stackCard); the
    // route turns it into the card's fields and leaves it out of the answer.
    detail: { ...view, log: view.log.slice(0, 60), plan: view.plan ? { ...view.plan, text: null } : null },
  };
}
