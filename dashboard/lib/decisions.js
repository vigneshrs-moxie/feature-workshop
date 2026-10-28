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

const GATE_KINDS = ['approve', 'changes', 'stop'];
const GATE_CHOICE = { approve: 'approve', changes: 'send back', stop: 'stop' };
const PERMISSION_CHOICE = { allow: 'allow', 'allow-run': 'allow for this reply', deny: 'say no' };
// The fixed sentences a gate reply's own words follow (lib/compose.js composeReply).
const GATE_ANCHOR = { approve: /^I approve\./, changes: /^Please make changes before moving on/, stop: /^Stop here\./ };
const HEAD_LINE = /^(My answers to |\d+\.\s.*\s→\s|Decided on my behalf|Not confirmed yet|Option change for the next step:|At these versions:)/;

const oneLine = (s, max = 200) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The note typed on the gate card, read back out of the reply it was composed into ('' when none). */
export function gateNote(kind, text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim());
  const at = lines.findIndex((l) => GATE_ANCHOR[kind]?.test(l));
  // A reply you edited before sending: its first line of your own words.
  if (at < 0) return oneLine(lines.find((l) => l && !HEAD_LINE.test(l)) ?? '');
  const own = lines.slice(at + 1).filter((l) => l && !/^At these versions:/.test(l) && l !== '(describe the changes)');
  return oneLine(own.join(' '));
}

/** The answers in a gate reply ("My answers to brief 3:" then "1. question → b) choice"). */
export function gateAnswers(text) {
  const out = [];
  let inside = false;
  for (const l of String(text ?? '').split('\n').map((x) => x.trim())) {
    if (/^My answers to /.test(l)) { inside = true; continue; }
    if (!inside) continue;
    const m = /^\d+\.\s+(.+?)\s+→\s+(.+)$/.exec(l);
    if (!m) break;
    out.push({ question: m[1], choice: m[2].replace(/^[a-z0-9]{1,3}\)\s+/i, '') });
  }
  return out;
}

const day = (at) => (typeof at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : '');

function briefQuestion(e, briefs) {
  const n = Number.isInteger(e.gateBrief) && e.gateBrief > 0 ? e.gateBrief : null;
  if (!n) return 'The Foreman’s latest brief: go ahead?';
  const name = briefs?.[n];
  return `Brief ${n}${name ? ` (${name})` : ''}: go ahead?`;
}

/**
 * The decisions in a job's audit lines (oldest first), as rows for decisions.md, each with its id.
 * Gate decisions (approve, send back, stop) and the answers given with them; level changes;
 * questions answered; permissions allowed or refused with a reason. Anything else is left out.
 * person: the name in the "who" column. briefs: { [number]: short name } for the gate's question.
 */
export function decisionRows(audit = [], { prefix = 'job', person = 'You', briefs = {} } = {}) {
  const rows = [];
  const add = (e, r) => rows.push({ id: decisionId(prefix, rows.length + 1), who: person, when: day(e.at), options: '', why: '', ...r });
  for (const e of audit) {
    if (!e || typeof e !== 'object') continue;
    if (e.action === 'send' && GATE_KINDS.includes(e.kind)) {
      for (const a of gateAnswers(e.text)) add(e, { question: a.question, choice: a.choice });
      add(e, { question: briefQuestion(e, briefs), options: 'approve · send back · stop', choice: GATE_CHOICE[e.kind], why: gateNote(e.kind, e.text) });
    } else if (e.action === 'options') {
      const level = e.options?.level;
      if (!Number.isInteger(level) || level === e.was) continue;
      const why = [Number.isInteger(e.was) ? `was L${e.was}` : '', e.overrode === 'auto' ? 'over the automatic pick' : '', e.via === 'gate' ? 'from a gate' : ''].filter(Boolean).join(', ');
      add(e, { question: 'Level for this job', options: 'L0 · L1 · L2 · L3', choice: `L${level}`, why });
    } else if (e.action === 'permission') {
      const answers = e.answers && typeof e.answers === 'object' ? Object.entries(e.answers) : [];
      if (answers.length) for (const [q, label] of answers) add(e, { question: oneLine(q), choice: oneLine(label), why: oneLine(e.note) });
      else if (oneLine(e.note) && PERMISSION_CHOICE[e.decision]) add(e, { question: `Allow “${oneLine(e.headline ?? e.tool ?? 'a step', 120)}”?`, options: 'allow · allow for this reply · say no', choice: PERMISSION_CHOICE[e.decision], why: oneLine(e.note) });
    }
  }
  return rows;
}
