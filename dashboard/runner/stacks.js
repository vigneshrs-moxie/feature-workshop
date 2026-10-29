// Stacks, the runner's half (plan §6, packet K): the queue that starts each stack's sections as
// child jobs, the code-only merges into the parent's branch, and the messages the coordinator (the
// parent's Foreman) and the sections' Foremen are sent. lib/stack.js has the plain code it runs on.
//
// A stack is a job folder holding stack.md (the coordinator writes it). Once you approve the plan
// on the Stack page, the runner writes stack.json beside it and, from then on, is the only writer:
//   - every few seconds (and whenever a reply ends) it looks at each stack: a running section whose
//     own gates have passed (its status.json says review is done) becomes ready, and the
//     coordinator is told "Section <name> is ready to merge."; the runnable sections start, in the
//     plan's order, while the stack's cap and the global cap (Settings → Workflow) have room;
//   - a section starts as a child job: its worktree and branch from the repository's profile
//     (sectionWorktree, sectionBranch), made from the parent's branch, a port from the profile's
//     range, a job folder <parent>--<section> whose status.json names its stack and section, and a
//     Foreman (driver.startSection) at the stack's model and effort, kept to its owned paths;
//   - merging is code, never the model: the next section in order, once it is ready, on your yes
//     (or by itself with "Merge on its own" on), then the profile's checks on the merged branch. A
//     failure undoes the merge and goes back to the section's Foreman, counting toward its three;
//     a clash or a file outside its owned paths leaves the branch as it was and waits for you;
//   - pushing waits for your go on the Stack page, always. The coordinator is then told to push to
//     your fork, which goes through its normal push permission card and the hard lines.
// Each event is one line in stack.json's log and one audit line ('stack').
//
// The parent's decisions.md gathers each section's decisions under its "## Section: <name>"
// heading (lib/decisions.js), written again after anything is decided on a section's job.
//
// createStacks(...) returns the door the site's routes use (site/routes-stacks.js, local mode):
//   list(), view(slug), approvePlan(slug, body), settings(slug, body), merge(slug, body),
//   sendBack(slug, body), push(slug, body), setGlobalCap(n), tick(), on('change', fn)

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { HttpError } from '../lib/http-guard.js';
import { git } from '../lib/integrate.js';
import { readOptions, writeOptions } from '../lib/options.js';
import { fillPattern, stackNames, stackRules } from '../lib/profile.js';
import { writeDecisionsFile } from '../lib/decisions.js';
import {
  DEFAULT_CAP, SECTION_BRIEF_FILE, STACK_FILE, STACK_PLAN_FILE, STUCK_AT, StackError, WORD,
  afterChecks, cleanCap, cleanSettings, describeStack, ensureWorktree, logEvent, mergeSection, newStack, nextRunnable,
  nextToMerge, notchUp, readPlan, readStack, refExists, runningCount, sectionBrief, sectionReady, sectionSlug, stackPhase,
  stackSummary, writeStack,
} from '../lib/stack.js';

const SLUG = /^[a-z0-9][a-z0-9._-]{0,199}$/;
const ACTIVE = new Set(['starting', 'running', 'waiting_permission', 'stopping']);
const ENDED = new Set(['done', 'stopped', 'error', 'limited']);
// Ports a section never takes: the owner's own dashboards and test servers.
const NEVER_PORTS = new Set([4477, 4479, 4483, 4484, 4485]);
const cap0 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}
async function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(tmp, file);
}
const exists = (p) => fs.stat(p).then(() => true, () => false);

function canListen(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

/**
 * The runner's stacks. driver: lib/driver.js Driver. state: lib/state.js State. featuresDir: the
 * job folders. registry: lib/repos.js Registry (profileFor). integrator: the integration board
 * (its integrate.json gives the global cap's first value). readDirs(): the folders the Foreman may
 * read. models: the model ids a stack may pick. onChange(): something on a stack changed (the page
 * fetches again). onSettings(): the settings changed (the global cap: every open page hears). tickMs: how often it looks (WORKSHOP_STACK_TICK_MS; 0: only when asked).
 */
export function createStacks({ driver, state, featuresDir, registry = null, integrator = null, readDirs = async () => [], models = null, onChange = null, onSettings = null, tickMs = Number(process.env.WORKSHOP_STACK_TICK_MS) || 3000 }) {
  const out = new EventEmitter();
  out.setMaxListeners(0);
  if (onChange) out.on('change', onChange);
  const chains = new Map(); // slug -> the last operation's promise: one at a time per stack
  const busy = new Map(); // slug -> { what, section, words }
  const outbox = new Map(); // job folder -> [{ text, kind, words, at }]: messages waiting for the Foreman
  const told = new Map(); // parent slug -> [{ at, words, kind, sent }] (the last 20)
  const sectionParent = new Map(); // a section's job folder -> its parent's
  let capChecked = null; // the first start's look at integrate.json, once

  const dirOf = (slug) => path.join(featuresDir, slug);
  const changed = (slug) => out.emit('change', { slug, at: Date.now() });

  function withStack(slug, fn) {
    const before = chains.get(slug) ?? Promise.resolve();
    const mine = before.catch(() => {}).then(fn);
    chains.set(slug, mine);
    mine.finally(() => { if (chains.get(slug) === mine) chains.delete(slug); }).catch(() => {});
    return mine;
  }

  async function needStack(slug) {
    if (typeof slug !== 'string' || !SLUG.test(slug)) throw new StackError(404, 'No stack by that name.');
    const dir = dirOf(slug);
    if (!(await exists(path.join(dir, STACK_PLAN_FILE))) && !(await exists(path.join(dir, STACK_FILE)))) throw new StackError(404, 'No stack by that name.');
    return dir;
  }

  async function stackDirs() {
    let names = [];
    try { names = await fs.readdir(featuresDir, { withFileTypes: true }); } catch { return []; }
    const outList = [];
    for (const e of names) {
      if (!e.isDirectory() || e.name.startsWith('.') || !SLUG.test(e.name)) continue;
      const dir = dirOf(e.name);
      if ((await exists(path.join(dir, STACK_PLAN_FILE))) || (await exists(path.join(dir, STACK_FILE)))) outList.push(e.name);
    }
    return outList.sort();
  }

  async function audit(slug, event, words, extra = {}) {
    try { await state.audit({ action: 'stack', featureDir: dirOf(slug), slug, event, words, ...extra }); } catch { /* the stack's own log has it */ }
  }

  // ---------- The global cap (Settings → Workflow) ----------

  // On the first start the global cap takes the integration board's "packets at once".
  function firstCap() {
    capChecked ??= takeBoardCap();
    return capChecked;
  }
  async function takeBoardCap() {
    await state.getSettings();
    if (state.settings?.workflow?.sectionsAtOnce !== undefined || !integrator?.file) return;
    const raw = await readJson(integrator.file);
    const slots = raw?.slots;
    if (!Number.isInteger(slots) || slots < 1 || slots > 20) return;
    const was = (await state.getSettings()).workflow;
    await state.setSettings({ workflow: { ...was, sectionsAtOnce: slots } });
    await state.audit({ action: 'settings', workflow: { sectionsAtOnce: slots }, from: 'integrate.json' });
    try { onSettings?.(); } catch { /* the pages read it at their next fetch */ }
  }
  async function globalCap() {
    await firstCap();
    return (await state.getSettings()).workflow.sectionsAtOnce ?? DEFAULT_CAP;
  }
  async function setGlobalCap(n) {
    const cap = cleanCap(n, `${cap0(WORD.many)} at once, across every stack,`);
    await firstCap();
    const was = (await state.getSettings()).workflow;
    await state.setSettings({ workflow: { ...was, sectionsAtOnce: cap } });
    await state.audit({ action: 'settings', workflow: { sectionsAtOnce: cap } });
    try { onSettings?.(); } catch { /* the pages read it at their next fetch */ }
    tickSoon();
    return state.getSettings();
  }
  async function globalRunning() {
    let n = 0;
    for (const slug of await stackDirs()) n += runningCount(await readStack(dirOf(slug)));
    return n;
  }

  // ---------- The parent and its repository ----------

  async function parentInfo(slug) {
    const dir = dirOf(slug);
    const status = (await readJson(path.join(dir, 'status.json'))) ?? {};
    const options = (await readOptions(dir)) ?? {};
    const ticketKey = typeof status.ticket?.key === 'string' ? status.ticket.key : typeof options.ticket?.key === 'string' ? options.ticket.key : null;
    return {
      dir, slug, status, options, ticketKey,
      title: status.title ?? options.title ?? slug,
      repo: status.repo?.path ?? options.repo ?? null,
      kind: status.kind === 'bug' || options.kind === 'bug' ? 'bug' : 'feature',
      n: ticketKey ? /(\d+)$/.exec(ticketKey)?.[1] ?? null : null,
    };
  }

  async function rulesFor(repo) {
    const hit = registry && repo ? await registry.profileFor(repo).catch(() => null) : null;
    return stackRules(hit?.ok ? hit.profile : null);
  }

  // Where the stack merges: the parent's branch, checked out in its worktree (made now if it isn't there).
  async function parentWhere(p) {
    if (!p.repo) throw new StackError(409, 'The stack’s job doesn’t name its repository yet (status.json repo.path), so its branch can’t be found.');
    if (!(await exists(p.repo))) throw new StackError(409, `The stack’s repository (${p.repo}) isn’t there.`);
    const rules = await rulesFor(p.repo);
    const values = { slug: p.slug, n: p.n, kind: rules.kinds[p.kind] ?? 'feature' };
    const parentBranch = p.status.branch ?? p.options.branch ?? fillPattern(rules.branch, values);
    const parentWorktree = p.status.worktree ?? (registry ? await registry.worktreeFor(p.repo, p.slug) : path.resolve(p.repo, fillPattern(rules.worktree, values)));
    let base = rules.base && (await refExists(p.repo, rules.base)) ? rules.base : null;
    if (!base) base = (await git(p.repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim() || 'HEAD';
    const made = await ensureWorktree({ repo: p.repo, worktree: parentWorktree, branch: parentBranch, from: base });
    if (!made.ok) throw new StackError(409, made.message);
    return { repo: p.repo, parentBranch, parentWorktree, base, remote: rules.fork, made: made.made };
  }

  // A port from the profile's range that no other section holds and nothing listens on. stack: the
  // stack being looked at, as it is in hand (its sections started in this same look aren't saved yet).
  async function pickPort(ports, stack = null) {
    const held = new Set();
    for (const slug of await stackDirs()) {
      for (const s of (await readStack(dirOf(slug)))?.sections ?? []) if (s.port && s.state !== 'integrated') held.add(s.port);
    }
    for (const s of stack?.sections ?? []) if (s.port && s.state !== 'integrated') held.add(s.port);
    const first = ports?.first ?? null;
    if (!first) return null;
    const last = ports.last ?? first + 99;
    for (let p = first; p <= last; p++) {
      if (held.has(p) || NEVER_PORTS.has(p)) continue;
      if (await canListen(p)) return p;
    }
    return null;
  }

  // ---------- Messages to the Foremen ----------

  function remember(slug, entry) {
    const listFor = told.get(slug) ?? [];
    listFor.push(entry);
    told.set(slug, listFor.slice(-20));
  }

  // A message for a job's Foreman: sent now when it is free, else when its reply ends.
  function sendTo(featureDir, { text, kind, words, parent }) {
    const entry = { text, kind, words, at: new Date().toISOString(), parent };
    outbox.set(featureDir, [...(outbox.get(featureDir) ?? []), entry]);
    flush(featureDir).catch((err) => console.error('stacks:', err.message));
  }
  const tellCoordinator = (slug, kind, text, words = text) => sendTo(dirOf(slug), { text, kind, words, parent: slug });

  const flushing = new Set();
  async function flush(featureDir) {
    if (flushing.has(featureDir)) return;
    const waiting = outbox.get(featureDir);
    if (!waiting?.length) return;
    if (driver.activeRunFor({ featureDir })) return; // goes when the reply ends
    flushing.add(featureDir);
    try {
      const session = await state.sessionFor(featureDir);
      if (!session?.sessionId) return; // waits until the job has a Foreman session here
      const msg = waiting[0];
      const stack = msg.parent ? await readStack(dirOf(msg.parent)) : null;
      const isCoordinator = msg.parent && featureDir === dirOf(msg.parent);
      const sec = stack?.sections.find((s) => s.slug && dirOf(s.slug) === featureDir) ?? null;
      try {
        await driver.start({
          featureDir, slug: path.basename(featureDir), title: null, cwd: session.cwd ?? sec?.worktree ?? stack?.parentWorktree ?? featureDir,
          sessionId: session.sessionId, model: session.model ?? stack?.model ?? null,
          effort: isCoordinator ? notchUp(stack?.effort) : sec?.effort ?? stack?.effort ?? null,
          text: msg.text, kind: msg.kind, additionalDirectories: await readDirs(),
        });
        waiting.shift();
        if (!waiting.length) outbox.delete(featureDir);
        if (msg.parent) remember(msg.parent, { at: new Date().toISOString(), kind: msg.kind, words: msg.words, sent: true, to: isCoordinator ? 'coordinator' : sec?.name ?? null });
        if (msg.parent) changed(msg.parent);
      } catch { /* busy, locked or paused: tried again at the next look */ }
    } finally {
      flushing.delete(featureDir);
    }
  }

  // ---------- Starting a section ----------

  async function startSection(slug, stack, sec, index) {
    const p = await parentInfo(slug);
    const rules = await rulesFor(stack.repo);
    const names = stackNames(rules, stack.repo, { slug, n: p.n, kind: p.kind, section: sec.name });
    const port = sec.port ?? (await pickPort(rules.ports, stack));
    const made = await ensureWorktree({ repo: stack.repo, worktree: names.worktree, branch: names.branch, from: stack.parentBranch });
    if (!made.ok) throw new StackError(409, made.message);
    const child = sectionSlug(slug, sec.name);
    const dir = dirOf(child);
    await fs.mkdir(dir, { recursive: true });
    const plan = (await readPlan(dirOf(slug)))?.plan;
    const fromPlan = plan?.sections.find((s) => s.name === sec.name) ?? { name: sec.name, brief: '', owns: sec.owns, dependsOn: sec.dependsOn };
    const title = `${p.title} · ${sec.name}`;
    const brief = sectionBrief({ parent: slug, ticketKey: p.ticketKey, section: { ...fromPlan, owns: sec.owns, dependsOn: sec.dependsOn }, index, total: stack.sections.length, parentBranch: stack.parentBranch, worktree: names.worktree, branch: names.branch, port });
    await fs.writeFile(path.join(dir, SECTION_BRIEF_FILE), brief);
    // The section's options: the parent's, with clarify and spec skipped and the brief as its spec.
    const { from_session: _from, updated_at: _u, ...parentOptions } = p.options ?? {};
    const skip = [...new Set([...(parentOptions.skip ?? []), 'clarify', 'spec', 'refine'])];
    await writeOptions(dir, { ...parentOptions, skip, provided: { ...(parentOptions.provided ?? {}), spec: path.join(dir, SECTION_BRIEF_FILE) } }, { title, repo: stack.repo, kind: p.kind, branch: names.branch, ticket: parentOptions.ticket ?? undefined });
    const ticket = p.status.ticket && typeof p.status.ticket === 'object' ? p.status.ticket : null;
    if (!(await exists(path.join(dir, 'status.json')))) {
      await writeJson(path.join(dir, 'status.json'), {
        schema_version: ticket ? 2 : 1, slug: child, title, kind: p.kind, route: null,
        stage: 'plan', stage_state: 'working', waiting_for: null, waiting_since: null,
        next_proposed: `Plan ${WORD.one} ${sec.name} from its brief`,
        repo: { path: stack.repo, base_branch: stack.parentBranch }, branch: names.branch, worktree: names.worktree,
        ...(ticket ? { ticket } : {}),
        stack: slug, section: sec.name, updated_at: new Date().toISOString(),
      });
    }
    sectionParent.set(dir, dirOf(slug));
    const model = sec.model ?? stack.model;
    const effort = sec.effort ?? stack.effort;
    const text = [
      `/feature ${title} Private folder: ${dir}`,
      '',
      `This job is ${WORD.one} ${index} of ${stack.sections.length} (${sec.name}) of stack ${p.ticketKey ?? slug}. Its spec is the ${WORD.one} brief in ${SECTION_BRIEF_FILE} in that folder; the whole plan is ${path.join(dirOf(slug), STACK_PLAN_FILE)}.`,
      `Start at plan: clarify and spec are skipped, because the stack plan is the spec. Work only in the worktree ${names.worktree} on the branch ${names.branch} (made from ${stack.parentBranch}), and change only these paths: ${sec.owns.join(', ')}. Writes anywhere else are refused.`,
      `Try it on port ${port ?? 'none'}. Don’t push and don’t open pull requests: the coordinator merges your branch into ${stack.parentBranch} once your checks pass. When review is done, write status.json with stage "review" and stage_state "done", keeping its stack and section fields.`,
      '',
      fromPlan.brief ? `The brief: ${fromPlan.brief}` : '',
    ].join('\n').trim();
    await driver.startSection({
      featureDir: dir, slug: child, title, cwd: names.worktree, model, effort, text,
      owned: { section: sec.name, owns: sec.owns, worktree: names.worktree, jobDir: dir },
      additionalDirectories: await readDirs(),
    });
    Object.assign(sec, { state: 'running', slug: child, branch: names.branch, worktree: names.worktree, port, startedAt: new Date().toISOString(), startError: null, retryAt: null });
    logEvent(stack, 'started', `${cap0(WORD.one)} ${sec.name} started on ${names.branch} (worktree ${names.worktree}${port ? `, port ${port}` : ''}).`, { section: sec.name });
    await audit(slug, 'started', `${cap0(WORD.one)} ${sec.name} started.`, { section: sec.name, branch: names.branch });
  }

  // ---------- One look at one stack ----------

  async function look(slug) {
    const dir = dirOf(slug);
    const stack = await readStack(dir);
    if (!stack) return;
    let dirty = false;
    const now = Date.now();

    for (const sec of stack.sections) {
      if (sec.slug) sectionParent.set(dirOf(sec.slug), dir);
      if (sec.state !== 'running' || !sec.slug) continue;
      // Its gates passed: its status.json says review is done (written after it was last sent back).
      const file = path.join(dirOf(sec.slug), 'status.json');
      const status = await readJson(file);
      const mtime = await fs.stat(file).then((st) => st.mtimeMs, () => 0);
      const since = sec.sentBackAt ? Date.parse(sec.sentBackAt) : 0;
      if (!sectionReady(status) || mtime <= since) continue;
      Object.assign(sec, { state: 'ready', readyAt: new Date().toISOString(), problem: null });
      logEvent(stack, 'ready', `${cap0(WORD.one)} ${sec.name} is ready to merge.`, { section: sec.name });
      await audit(slug, 'ready', `${cap0(WORD.one)} ${sec.name} is ready to merge.`, { section: sec.name });
      tellCoordinator(slug, 'stack-ready', `${cap0(WORD.one)} ${sec.name} is ready to merge.${stack.autoIntegrate ? ' “Merge on its own” is on: the runner merges it when it is next in order.' : ' The person says yes to the merge on the Stack page.'}`);
      dirty = true;
    }

    // Pushed: your fork's copy of the branch (as this computer last saw it) is the parent's branch now.
    if (stack.push?.state === 'approved' && stack.parentWorktree) {
      const remote = stack.push.remote ?? 'origin';
      const head = (await git(stack.parentWorktree, ['rev-parse', 'HEAD'])).stdout.trim();
      const theirs = (await git(stack.parentWorktree, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${stack.parentBranch}`])).stdout.trim();
      if (head && theirs && head === theirs) {
        stack.push = { ...stack.push, state: 'pushed', pushedAt: new Date().toISOString() };
        logEvent(stack, 'pushed', `${stack.parentBranch} is on your fork (${remote}).`);
        await audit(slug, 'pushed', `${stack.parentBranch} is pushed to ${remote}.`);
        dirty = true;
      }
    }

    // Start what can start, in the plan's order, while both caps have room.
    const gcap = await globalCap();
    const { start } = nextRunnable(stack, { globalRunning: await globalRunning(), globalCap: gcap });
    for (const name of start) {
      const sec = stack.sections.find((s) => s.name === name);
      if (sec.retryAt && Date.parse(sec.retryAt) > now) continue;
      try {
        await startSection(slug, stack, sec, stack.sections.indexOf(sec) + 1);
      } catch (err) {
        const words = `${cap0(WORD.one)} ${sec.name} couldn’t start: ${String(err?.message ?? err).split('\n')[0].slice(0, 300)}`;
        if (sec.startError !== words) { logEvent(stack, 'start-failed', words, { section: sec.name }); await audit(slug, 'start-failed', words, { section: sec.name }); }
        Object.assign(sec, { startError: words, retryAt: new Date(now + 60_000).toISOString() });
      }
      dirty = true;
    }
    if (dirty) { await writeStack(dir, stack); changed(slug); }

    // "Merge on its own": the next section in order, once it is ready. Pushing still waits.
    const next = nextToMerge(stack);
    if (stack.autoIntegrate && next.ready && !busy.has(slug)) queueMerge(slug, { by: 'auto' });
  }

  // ---------- Merging (code only) ----------

  function queueMerge(slug, { by }) {
    busy.set(slug, { what: 'merging', words: 'Merging and running the checks…' });
    changed(slug);
    return withStack(slug, () => doMerge(slug, { by })).catch((err) => console.error('stacks:', err.message)).finally(() => { busy.delete(slug); changed(slug); tickSoon(); });
  }

  async function doMerge(slug, { by }) {
    const dir = dirOf(slug);
    const stack = await readStack(dir);
    if (!stack) return;
    const next = nextToMerge(stack);
    if (!next.ready) return;
    const sec = next.section;
    busy.set(slug, { what: 'merging', section: sec.name, words: `Merging ${WORD.one} ${sec.name} into ${stack.parentBranch} and running the checks…` });
    changed(slug);
    const rules = await rulesFor(stack.repo);
    logEvent(stack, 'merge-started', `${by === 'auto' ? 'Merging on its own' : 'You said yes'}: merging ${WORD.one} ${sec.name} into ${stack.parentBranch}${rules.checks.length ? `, then ${rules.checks.join('; ')}` : ''}.`, { section: sec.name, by });
    await writeStack(dir, stack);
    const r = await mergeSection({ parentWorktree: stack.parentWorktree, parentBranch: stack.parentBranch, section: sec, checks: rules.checks });
    const fresh = (await readStack(dir)) ?? stack;
    const s = fresh.sections.find((x) => x.name === sec.name);
    const at = new Date().toISOString();
    fresh.lastMerge = { section: sec.name, outcome: r.outcome, words: r.words, at };
    const tail = (r.checks ?? []).filter((c) => !c.ok).map((c) => `${c.command}:\n${c.tail}`).join('\n\n');
    if (r.outcome === 'merged') {
      Object.assign(s, { state: 'integrated', mergedAt: at, mergeSha: r.sha, problem: null });
      logEvent(fresh, 'merged', r.words, { section: s.name, sha: r.sha, checks: (r.checks ?? []).map((c) => ({ command: c.command, ok: c.ok })) });
      tellCoordinator(slug, 'stack-merged', `${r.words.replace(/\.$/, '')} (merge commit ${String(r.sha).slice(0, 12)}).${fresh.sections.every((x) => x.state === 'integrated') ? ` Every ${WORD.one} is merged. Pushing waits for the person’s go on the Stack page: don’t push before you are told.` : ''}`);
    } else if (r.outcome === 'checks-failed') {
      const after = afterChecks(s, false);
      Object.assign(s, after, { problem: { kind: 'checks', words: r.words, files: [], tail: tail.slice(-3000) }, sentBackAt: at, readyAt: null });
      logEvent(fresh, 'checks-failed', `${r.words} That is ${s.failures} of ${STUCK_AT}.`, { section: s.name, before: r.before, undone: r.undone });
      if (s.state === 'failed') {
        logEvent(fresh, 'stuck', `${cap0(WORD.one)} ${s.name} failed its checks ${STUCK_AT} times. It has stopped and needs you.`, { section: s.name });
        tellCoordinator(slug, 'stack-stuck', `${cap0(WORD.one)} ${s.name} failed its checks ${STUCK_AT} times and has stopped. The person decides what happens next.`);
      } else {
        sendTo(dirOf(s.slug), { parent: slug, kind: 'stack-checks-failed', words: `Sent the failure to ${WORD.one} ${s.name}.`, text: `The checks failed after your branch ${s.branch} was merged into ${fresh.parentBranch}, so the merge was undone. This is ${s.failures} of ${STUCK_AT}: at ${STUCK_AT} the ${WORD.one} stops and waits for the person.\n\n${tail}\n\nFix it on your branch, run the checks, and write status.json again (stage "review", stage_state "done") when your gates pass.` });
        tellCoordinator(slug, 'stack-checks-failed', `${r.words} It went back to ${WORD.one} ${s.name}’s Foreman (${s.failures} of ${STUCK_AT}).`);
      }
    } else if (['conflict', 'outside', 'empty'].includes(r.outcome)) {
      Object.assign(s, { state: 'blocked', problem: { kind: r.outcome === 'conflict' ? 'conflict' : r.outcome, words: r.words, files: r.files ?? [] }, readyAt: null });
      logEvent(fresh, r.outcome, r.words, { section: s.name, files: r.files ?? [] });
      tellCoordinator(slug, `stack-${r.outcome}`, `${r.words} The person hands it back to the ${WORD.one}’s Foreman from the Stack page.`);
    } else {
      logEvent(fresh, 'merge-refused', r.words, { section: s.name });
    }
    await audit(slug, r.outcome === 'merged' ? 'merged' : `merge-${r.outcome}`, r.words, { section: s.name, by });
    await writeStack(dir, fresh);
    writeParentDecisions(dir);
  }

  // ---------- The parent's decisions.md ----------

  const decisionTimers = new Map();
  function writeParentDecisions(parentDir) {
    clearTimeout(decisionTimers.get(parentDir));
    const t = setTimeout(() => {
      decisionTimers.delete(parentDir);
      writeDecisionsFile(parentDir, { auditFor: (d) => state.auditFor(d, Infinity) }).catch((err) => console.error('stacks decisions:', err.message));
    }, 500);
    t.unref?.();
    decisionTimers.set(parentDir, t);
  }
  // Something decided on a section's job (or the parent's, which the runner writes first): again.
  state.on('audit', (e) => {
    if (!e?.featureDir) return;
    if (e.action === 'stack') return;
    const parent = sectionParent.get(e.featureDir) ?? ([...sectionParent.values()].includes(e.featureDir) ? e.featureDir : null);
    if (parent) writeParentDecisions(parent);
  });

  // ---------- When a reply ends ----------

  driver.on('run', (r) => {
    if (!ENDED.has(r.status) || !r.featureDir) return;
    if (outbox.has(r.featureDir)) setTimeout(() => { flush(r.featureDir).catch(() => {}); }, 50).unref?.();
    if (sectionParent.has(r.featureDir) || [...sectionParent.values()].includes(r.featureDir)) tickSoon();
  });

  // ---------- The looks ----------

  let ticking = null;
  async function tick() {
    if (ticking) return ticking;
    ticking = (async () => {
      for (const slug of await stackDirs()) {
        try { await withStack(slug, () => look(slug)); } catch (err) { console.error(`stacks (${slug}):`, err.message); }
      }
      for (const dir of [...outbox.keys()]) await flush(dir).catch(() => {});
    })().finally(() => { ticking = null; });
    return ticking;
  }
  let soon = null;
  function tickSoon() {
    if (soon) return;
    soon = setTimeout(() => { soon = null; tick().catch(() => {}); }, 200);
    soon.unref?.();
  }
  // The global cap takes the board's "packets at once" on the first start, before any stack is
  // looked at, so Settings → Workflow shows the number that holds.
  firstCap().catch(() => { capChecked = null; });
  if (tickMs > 0) {
    const timer = setInterval(() => { tick().catch(() => {}); }, tickMs);
    timer.unref?.();
  }

  // ---------- What the page reads ----------

  async function view(slug) {
    const dir = await needStack(slug);
    const p = await parentInfo(slug);
    const planRead = await readPlan(dir);
    const stack = await readStack(dir);
    const statuses = {};
    const runs = {};
    for (const s of stack?.sections ?? []) {
      if (!s.slug) continue;
      statuses[s.name] = await readJson(path.join(dirOf(s.slug), 'status.json'));
      const run = driver.activeRunFor({ featureDir: dirOf(s.slug) });
      runs[s.name] = run && ACTIVE.has(run.status) ? run.status : null;
    }
    const session = await state.sessionFor(dir);
    const waiting = (outbox.get(dir) ?? []).map((m) => ({ at: m.at, kind: m.kind, words: m.words }));
    return describeStack({
      slug, title: p.title, ticketKey: p.ticketKey, plan: planRead?.plan ?? null, planText: planRead?.text ?? null, stack, statuses, runs,
      busy: busy.get(slug) ?? null, globalRunning: await globalRunning(), globalCap: await globalCap(),
      coordinator: { session: Boolean(session?.sessionId), waiting, told: [...(told.get(slug) ?? [])].reverse() },
    });
  }

  async function listAll() {
    const stacks = [];
    for (const slug of await stackDirs()) {
      try { stacks.push(stackSummary(await view(slug))); } catch { /* gone meanwhile */ }
    }
    return { stacks, globalCap: await globalCap(), globalRunning: await globalRunning() };
  }

  // ---------- What the page changes ----------

  async function approvePlan(slug, body = {}) {
    const dir = await needStack(slug);
    return withStack(slug, async () => {
      if (await readStack(dir)) throw new StackError(409, 'This stack’s plan is approved already.');
      const read = await readPlan(dir);
      if (!read) throw new StackError(409, 'There is no stack plan (stack.md) to approve yet.');
      if (!read.plan.ok) throw new StackError(409, `The plan has problems to fix first: ${read.plan.errors.join(' ')}`, { errors: read.plan.errors });
      const settings = cleanSettings(body ?? {}, { models });
      const p = await parentInfo(slug);
      const where = await parentWhere(p);
      const stack = newStack({ parent: slug, plan: read.plan, planText: read.text, where, ...settings });
      if (where.made) logEvent(stack, 'parent-worktree', `Made the stack’s worktree ${where.parentWorktree} on ${where.parentBranch} from ${where.base}.`);
      await writeStack(dir, stack);
      for (const s of read.plan.sections) sectionParent.set(dirOf(sectionSlug(slug, s.name)), dir);
      await audit(slug, 'plan-approved', stack.log[0].words, { cap: stack.cap, autoIntegrate: stack.autoIntegrate });
      tellCoordinator(slug, 'stack-plan', `The person approved the stack plan (stack.md) on the Stack page. The runner starts the ${WORD.many} now, at most ${stack.cap} at once, each in its own worktree from ${stack.parentBranch}. Don’t start ${WORD.many} yourself: you are told as each one is ready to merge, and when it has merged. Pushing waits for the person’s go.`);
      changed(slug);
      tickSoon();
      return view(slug);
    });
  }

  async function settings(slug, body = {}) {
    const dir = await needStack(slug);
    const patch = cleanSettings(body ?? {}, { models });
    if (!Object.keys(patch).length) throw new StackError(400, `Send a setting to change: cap (${WORD.many} at once), autoIntegrate (merge on its own), model or effort.`);
    await withStack(slug, async () => {
      const stack = await readStack(dir);
      if (!stack) throw new StackError(409, 'Approve the plan first; its settings come with it.');
      Object.assign(stack, patch);
      const words = [
        patch.cap !== undefined ? `${cap0(WORD.many)} at once: ${patch.cap}` : null,
        patch.autoIntegrate !== undefined ? `Merge on its own: ${patch.autoIntegrate ? 'on' : 'off'}` : null,
        patch.model ? `Model: ${patch.model}` : null,
        patch.effort ? `Effort: ${patch.effort}` : null,
      ].filter(Boolean).join('. ');
      logEvent(stack, 'settings', `${words}.`);
      await writeStack(dir, stack);
      await audit(slug, 'settings', `${words}.`, { patch });
    });
    changed(slug);
    tickSoon();
    return view(slug);
  }

  async function merge(slug, body = {}) {
    const dir = await needStack(slug);
    if (busy.has(slug)) throw new StackError(409, busy.get(slug).words ?? 'Something is running on this stack already.');
    const stack = await readStack(dir);
    if (!stack) throw new StackError(409, 'Approve the plan first.');
    const next = nextToMerge(stack);
    if (!next.section) throw new StackError(409, next.reason);
    if (typeof body.section === 'string' && body.section && body.section !== next.section.name) {
      throw new StackError(409, `${cap0(WORD.many)} merge only in order: ${next.section.name} is next, not ${body.section}.`);
    }
    if (!next.ready) throw new StackError(409, next.reason);
    await audit(slug, 'merge-yes', `You said yes to merging ${WORD.one} ${next.section.name}.`, { section: next.section.name });
    queueMerge(slug, { by: 'you' });
    return { started: true, section: next.section.name, view: await view(slug) };
  }

  async function sendBack(slug, body = {}) {
    const dir = await needStack(slug);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 4000) : '';
    const name = typeof body.section === 'string' && body.section ? body.section : null;
    if (!name) {
      if (!note) throw new StackError(400, 'Say what to change: the note goes to the Foreman.');
      tellCoordinator(slug, 'stack-plan-change', `The person asks for a change to the stack plan from the Stack page: ${note}\n\nWrite stack.md again; the page shows the new plan for approval.`, 'Sent your note about the plan to the coordinator.');
      await audit(slug, 'plan-change', 'You asked the coordinator to change the plan.', { note });
      if (await readStack(dir)) await withStack(slug, async () => { const s = await readStack(dir); logEvent(s, 'plan-change', `You asked for a change to the plan: ${note}`); await writeStack(dir, s); });
      changed(slug);
      return view(slug);
    }
    await withStack(slug, async () => {
      const stack = await readStack(dir);
      if (!stack) throw new StackError(409, 'Approve the plan first.');
      const s = stack.sections.find((x) => x.name === name);
      if (!s) throw new StackError(404, `There is no ${WORD.one} ${name} in this stack.`);
      if (!s.slug) throw new StackError(409, `${cap0(WORD.one)} ${name} hasn’t started yet, so it has no Foreman to send it to.`);
      if (s.state === 'integrated') throw new StackError(409, `${cap0(WORD.one)} ${name} is merged already.`);
      const p = s.problem;
      const files = p?.files?.length ? `: ${p.files.join(', ')}` : '';
      const why = s.state === 'failed'
        ? `The person has looked at the failed checks and sends this ${WORD.one} back to you. The count of failed checks starts again.`
        : p?.kind === 'conflict' ? `Your branch ${s.branch} clashes with ${stack.parentBranch}${files}. Merge ${stack.parentBranch} into your branch, settle those files, and run the checks.`
          : p?.kind === 'outside' ? `Your branch ${s.branch} changes files outside the paths this ${WORD.one} owns${files}. Take those changes out (they belong to another ${WORD.one}, or ask the coordinator to change the plan).`
            : p?.kind === 'empty' ? `Your branch ${s.branch} has nothing committed to merge. Commit your work on it.`
              : s.state === 'ready' ? `The person isn’t merging this ${WORD.one} yet.` : 'A note from the person.';
      const text = `${why}${note ? `\n\nThe person’s note: ${note}` : ''}\n\nWhen your gates pass again, write status.json with stage "review" and stage_state "done".`;
      Object.assign(s, { state: 'running', sentBackAt: new Date().toISOString(), problem: null, readyAt: null, ...(s.state === 'failed' ? { failures: 0 } : {}) });
      logEvent(stack, 'sent-back', `You sent ${WORD.one} ${name} back to its Foreman${note ? `: ${note}` : '.'}`, { section: name });
      await writeStack(dir, stack);
      await audit(slug, 'sent-back', `You sent ${WORD.one} ${name} back.`, { section: name, note: note || undefined });
      sendTo(dirOf(s.slug), { parent: slug, kind: 'stack-sendback', words: `Sent ${WORD.one} ${name} back to its Foreman.`, text });
    });
    changed(slug);
    return view(slug);
  }

  async function push(slug, body = {}) {
    const dir = await needStack(slug);
    if (body.go !== true && body.go !== false) throw new StackError(400, 'Say go or no go: nothing is pushed without a go.');
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';
    await withStack(slug, async () => {
      const stack = await readStack(dir);
      if (!stack) throw new StackError(409, 'Approve the plan first.');
      const phase = stackPhase(stack);
      if (phase === 'pushed') throw new StackError(409, `${stack.parentBranch} is pushed already.`);
      if (phase !== 'push') {
        const left = stack.sections.filter((s) => s.state !== 'integrated').map((s) => s.name);
        throw new StackError(409, `Not every ${WORD.one} is merged yet (${list(left)}), so there is nothing to push.`);
      }
      if (busy.has(slug)) throw new StackError(409, busy.get(slug).words);
      if (stack.push?.state === 'approved') throw new StackError(409, 'You said go already: the coordinator is pushing.');
      const rules = await rulesFor(stack.repo);
      const remote = stack.push?.remote ?? rules.fork;
      if (body.go === false) {
        stack.push = { ...stack.push, state: 'declined', note: note || null };
        logEvent(stack, 'push-no', `You said no go: nothing is pushed${note ? `. Your note: ${note}` : '.'}`);
        await writeStack(dir, stack);
        await audit(slug, 'push-no', 'You said no go to the push.', { note: note || undefined });
        if (note) tellCoordinator(slug, 'stack-push-no', `The person said no go to pushing ${stack.parentBranch}, with this note: ${note}. Don’t push.`, 'Sent your no go and note to the coordinator.');
        return;
      }
      stack.push = { ...stack.push, state: 'approved', approvedAt: new Date().toISOString(), note: note || null, remote };
      logEvent(stack, 'push-yes', `You said go: the coordinator pushes ${stack.parentBranch} to your fork (${remote}).`);
      await writeStack(dir, stack);
      await audit(slug, 'push-yes', `You said go to pushing ${stack.parentBranch}.`, { remote, note: note || undefined });
      tellCoordinator(slug, 'stack-push', `The person said go on the Stack page: push ${stack.parentBranch} to your fork now, with git push -u ${remote} ${stack.parentBranch}, from ${stack.parentWorktree}. Push only to your fork (${remote})${rules.org ? `, never to ${rules.org}` : ''}. The push asks for its own permission as usual.${note ? ` The person’s note: ${note}` : ''}`, `Told the coordinator to push ${stack.parentBranch} to ${remote}.`);
    });
    changed(slug);
    return view(slug);
  }

  return {
    list: listAll, view, approvePlan, settings, merge, sendBack, push, setGlobalCap, tick,
    /** A stack refusal (StackError) as the answer the page gets, with its extra fields (errors). */
    httpError: (err) => (err instanceof StackError ? new HttpError(err.status, err.message, err.extra) : err),
    on: (type, fn) => { out.on(type, fn); return () => out.off(type, fn); },
  };
}
