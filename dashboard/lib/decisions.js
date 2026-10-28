// A job's "Your decisions" log: every choice you made on it, newest first, read from its audit
// lines. Approvals, changes asked for and stops sent from a gate; permissions allowed or refused;
// level and option changes; the job's own permission setting; closing and reopening; nudges taken
// or dismissed. Plain messages, steers and anything the workshop did by itself are left out.
// Pure: no files, no clock.

const firstLine = (text, max = 160) => {
  const line = String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

const SEND = {
  approve: (e) => ({ kind: 'approve', text: Number.isInteger(e.gateBrief) ? `Approved brief ${e.gateBrief}` : 'Approved' }),
  changes: (e) => ({ kind: 'changes', text: `Sent back${Number.isInteger(e.gateBrief) ? ` brief ${e.gateBrief}` : ''} for changes`, note: firstLine(e.text) }),
  stop: () => ({ kind: 'stop', text: 'Stopped the job' }),
};

/** One entry for an audit line that records a decision of yours, else null. */
export function decisionOf(e) {
  if (!e || typeof e !== 'object') return null;
  const at = e.at ?? null;
  let d = null;
  if (e.action === 'send' && SEND[e.kind]) d = SEND[e.kind](e);
  else if (e.action === 'permission') d = { kind: e.decision === 'deny' ? 'deny' : 'allow', text: `${e.decision === 'deny' ? 'Said no to' : 'Allowed'}: ${e.headline ?? e.tool ?? 'a step'}`, note: e.note ? firstLine(e.note) : undefined };
  else if (e.action === 'options') {
    const level = e.options?.level;
    d = Number.isInteger(level) && level !== e.was ? { kind: 'level', text: `Level ${Number.isInteger(e.was) ? `L${e.was} → ` : ''}L${level}${e.via === 'gate' ? ' (from a gate)' : ''}${e.overrode === 'auto' ? ' (you changed the automatic pick)' : ''}` } : { kind: 'options', text: 'Changed the job’s options' };
  } else if (e.action === 'auto-level') d = { kind: 'level', text: `Level ${Number.isInteger(e.was) ? `L${e.was} → ` : ''}L${e.level} (automatic${e.how === 'diff' ? ', after a build' : ''})` };
  else if (e.action === 'job-policy') d = { kind: 'policy', text: e.policy ? `Permissions set to ${e.policy}` : 'Permissions back to your global setting' };
  else if (e.action === 'close') d = { kind: 'close', text: e.as === 'dropped' ? 'Dropped the job' : 'Marked the job done', note: e.note ? firstLine(e.note) : undefined };
  else if (e.action === 'reopen') d = { kind: 'reopen', text: 'Reopened the job' };
  else if (e.action === 'nudge') d = { kind: 'nudge', text: `Said yes: ${firstLine(e.text, 100)}` };
  else if (e.action === 'nudge-dismissed') d = { kind: 'nudge', text: 'Dismissed a suggestion' };
  if (!d) return null;
  if (!d.note) delete d.note;
  return { at, ...d };
}

/** The log, newest first. */
export function decisionLog(audit = []) {
  return audit.map(decisionOf).filter(Boolean).sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
}

// ---------- decisions.md: the job's decision file (plan §8) ----------
// One plain file in the job folder, for engineers and agents: a table of the decisions made on the
// job (id, question, options, choice, who, when, why), the Foreman's own rows, and a "Not doing"
// list. The rows made from the audit are written again after every gate; the Foreman's rows and
// the "Not doing" list are kept as they are.

/**
 * What every decision id starts with: the job's ticket key ("ORBIT-479") when it has one, from
 * status.json's ticket.key, else from a slug that starts "orbit-<n>-"; otherwise the slug.
 */
export function decisionPrefix({ slug = '', ticketKey = null } = {}) {
  const key = String(ticketKey ?? '').trim();
  if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(key)) return key.toUpperCase();
  const m = /^orbit-(\d+)(?:-|$)/i.exec(String(slug));
  if (m) return `ORBIT-${Number(m[1])}`;
  return String(slug || 'job');
}

/** The k-th decision's id (k from 1, in audit order): "ORBIT-479.D3". */
export const decisionId = (prefix, k) => `${prefix}.D${k}`;
