// The conversation with a job's Foreman, as shown on the job page: its briefs and replies, your
// messages, decisions and short notes, oldest first.
//
// Every item has a stable `id`, the same on every fetch while the job's records only grow:
//   brief:<file>         a brief file
//   <kind>:<hash>        an item made from one line of the dashboard's audit log
//   auto:<hash>          a fold of routine steps, named after its first step
// so the page can keep what it has and add only what's new, and ask for older items with
// ?before=<id>.

import { createHash } from 'node:crypto';
import { describeOptions, levelChangeLine } from './options.js';

export const PAGE = 60;

const POLICY_LABELS = { 'hands-off': 'Routine steps automatic', 'ask-all': 'Ask about everything', auto: 'Auto mode' };

const hash = (entry) => createHash('sha1').update(JSON.stringify(entry)).digest('hex').slice(0, 12);

/**
 * briefs: [{ number, stage, file, at, headline, point, versions }]. versions: the spec and artifact
 * versions status.json named when this brief was raised ({ spec, artifacts: { name: version } }),
 * known only for the brief status.json names now; null for older briefs. Never part of the id.
 * audit: the job's audit entries, oldest
 * first (all of them, so ids don't depend on how far back was read). autoResume: whether jobs
 * carry on by themselves after a usage limit (changes one note's wording).
 * Replies carry their markdown in `reply`; the caller renders the ones it sends.
 */
export function buildThread({ briefs = [], audit = [], autoResume = true }) {
  const thread = [];
  for (const b of briefs) {
    thread.push({ id: `brief:${b.file}`, kind: 'brief', at: b.at ?? null, number: b.number, stage: b.stage, file: b.file, headline: b.headline ?? null, point: b.point ?? null, versions: b.versions ?? null });
  }
  let autoGroup = null;
  for (const e of audit) {
    const id = (kind) => `${kind}:${hash(e)}`;
    if (e.action === 'auto-allowed') {
      if (!autoGroup || autoGroup.runId !== e.runId) { autoGroup = { id: id('auto'), kind: 'auto', at: e.at, runId: e.runId, items: [] }; thread.push(autoGroup); }
      autoGroup.items.push({ at: e.at, headline: e.headline, who: e.agentType ?? 'conductor', reason: e.reason, ...(e.rule ? { rule: e.rule } : {}) });
      continue;
    }
    const note = (text) => thread.push({ id: id('note'), kind: 'note', at: e.at, text });
    if (e.action === 'send' && e.kind === 'resume') note('Claude’s usage limit reset, so the workshop told the Foreman to carry on.');
    // gateBrief: sent from a gate card, answering that brief.
    else if (e.action === 'send') thread.push({ id: id('you'), kind: 'you', at: e.at, text: e.text, sendKind: e.kind, ...(Number.isInteger(e.gateBrief) ? { gateBrief: e.gateBrief } : {}) });
    // A gate reply held until Claude's usage limit resets (lib/limits.js hold); sent then as a 'send'.
    else if (e.action === 'send-held') note(`Your reply${Number.isInteger(e.gateBrief) ? ` to brief ${e.gateBrief}` : ''} waits for Claude’s usage limit to reset${e.autoResume === false ? ' and for you to press “Carry on now”' : ''}; it goes to the Foreman then.`);
    // A held reply dropped because you sent a message yourself meanwhile (lib/limits.js forget).
    else if (e.action === 'send-held-dropped') note('Your held reply wasn’t sent: you sent a message yourself.');
    else if (e.action === 'usage-limit-skip' && e.held) note(`Your reply held for the usage-limit reset wasn’t sent: ${e.reason ?? 'the job couldn’t be carried on from here.'}`);
    // notes.md saved from the job drawer: one dim line for a run of saves with nothing else between.
    else if (e.action === 'notes') {
      const last = thread.at(-1);
      if (last?.kind === 'note' && last.notes) last.at = e.at;
      else thread.push({ id: id('note'), kind: 'note', at: e.at, text: 'You updated this job’s notes (notes.md).', notes: true });
    }
    // A message you steered into a reply in progress; the page shows its delivery state by steerId.
    else if (e.action === 'steer') thread.push({ id: id('you'), kind: 'you', at: e.at, text: e.text, sendKind: 'steer', steerId: e.steerId, runId: e.runId });
    else if (e.action === 'run-ended') {
      if (e.status === 'limited' || (e.status === 'stopped' && e.stopReason === 'usage-limit')) note(`Paused: Claude’s usage limit was reached.${autoResume ? ' The job carries on by itself once the limit resets.' : ' Send a message to carry on once the limit resets.'}`);
      else if (e.status === 'error') thread.push({ id: id('problem'), kind: 'problem', at: e.at, text: e.error ?? 'The reply hit a problem.' });
      else if (e.reply) thread.push({ id: id('reply'), kind: 'reply', at: e.at, reply: e.reply, stopped: e.status === 'stopped' });
      else if (e.status === 'stopped') note('You paused this reply.');
    } else if (e.action === 'permission') thread.push({ id: id('decision'), kind: 'decision', at: e.at, text: `${e.decision === 'deny' ? 'You said no to' : 'You allowed'}: ${e.headline ?? e.tool}${e.note ? ` (“${e.note}”)` : ''}` });
    // Actions refused without a card: by auto mode's safety model, or by a hard line (lib/hard-lines.js).
    else if (e.action === 'auto-blocked') thread.push({ id: id('blocked'), kind: 'blocked', at: e.at, by: 'auto', text: `Auto mode blocked: ${e.headline ?? e.tool}`, preview: e.preview ?? null, reason: e.reason ?? null, who: e.agentType ?? 'conductor' });
    else if (e.action === 'hard-line-refused') thread.push({ id: id('blocked'), kind: 'blocked', at: e.at, by: 'hard-line', text: `Refused: ${e.headline ?? e.tool}`, preview: e.preview ?? null, reason: e.reason ?? null, who: e.agentType ?? 'conductor' });
    else if (e.action === 'auto-unavailable') note('Auto mode isn’t available for your account, so this reply ran with routine steps automatic instead.');
    else if (e.action === 'job-policy') note(e.policy ? `You set this job’s permissions to “${POLICY_LABELS[e.policy] ?? e.policy}”. It applies straight away, also to a reply in progress.` : 'This job follows your global permission setting again.');
    else if (e.action === 'rule-added') note(`You saved an “Always allow” rule: ${e.label ?? 'see Settings'}. It applies to every job run from the dashboard until you remove it in Settings.`);
    else if (e.action === 'takeover') note('You took this job over from the terminal.');
    else if (e.action === 'close') note(`You marked this job ${e.as === 'dropped' ? 'dropped' : 'done'}${e.note ? ` (“${e.note}”)` : ''}${e.worktreeRemoved ? `, and removed its worktree (${e.worktreeRemoved}); the branch is kept` : ''}.`);
    else if (e.action === 'reopen') note(e.how === 'message' ? 'Reopened: you sent the Foreman a message.' : 'You reopened this job.');
    else if (e.action === 'options') {
      // `was`: the level before the change (audit lines from before it was recorded have none).
      const changed = levelChangeLine(e.was, e.options?.level);
      note(`You changed how this job runs (from the next stage): ${changed ? `${changed} ` : ''}${describeOptions(e.options).join(' ')}`);
    }
  }
  thread.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  // Two identical audit lines (same moment, same words) would share an id: number the repeats.
  const seen = new Map();
  for (const it of thread) {
    const n = (seen.get(it.id) ?? 0) + 1;
    seen.set(it.id, n);
    if (n > 1) it.id = `${it.id}~${n}`;
  }
  return thread;
}

/**
 * One page of the thread: the newest `limit` items, or the `limit` items just before the item
 * with id `before`. more: whether older items exist. Returns null when `before` isn't in the thread.
 */
export function pageThread(thread, { before = null, limit = PAGE } = {}) {
  let end = thread.length;
  if (before) {
    end = thread.findIndex((it) => it.id === before);
    if (end < 0) return null;
  }
  const start = Math.max(0, end - limit);
  return { items: thread.slice(start, end), more: start > 0 };
}
