// What a decision was made on (packet 2B): a decision made on the hosted site may run much later,
// when the laptop is back, so it carries what the card showed when you decided, and runs only when
// that is still so. The site checks it against its mirror before handing the decision over, and the
// runner (runner/site-link.js) checks it again against the job as it is now, just before running it.
//
//   gate        { kind: 'gate', slug, brief, mark }  Go / No go, send back, stop, or a reply from
//               the gate card: the brief's number and its mark (gateMark: the brief's file, stage
//               and the versions it was raised at), so another brief, another stage or a plan that
//               changed under it is caught even when the number happens to match
//   job         { kind: 'job', slug, stage }         a reply from the message box: the job's stage
//   permission  { kind: 'permission', slug, id }     allow or deny: that request, still waiting
//   stack       { kind: 'stack', slug, section }     merge next: that section, still next in order
//
// madeOnFor(command, now) makes one from the command and what is shown now; stillMadeOn(madeOn, now)
// says whether it still holds: { ok: true } or { ok: false, why } in plain words. `now` is
// { job, permissions } (job: GET /api/job/:slug's answer, or null; permissions: the waiting cards).

import crypto from 'node:crypto';

const GATE_TYPES = new Set(['approve', 'send-back', 'stop']);

/** JSON with every object's keys in order, so the same value gives the same mark wherever it was kept (Postgres jsonb reorders keys). */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** The gate card's mark: which brief, at which stage, raised at which versions. Null: no gate. */
export function gateMark(gate) {
  if (!gate || typeof gate !== 'object') return null;
  const parts = [gate.briefNumber ?? null, gate.briefFile ?? null, gate.stage ?? null, gate.raisedVersions ?? null];
  return crypto.createHash('sha256').update(canonical(parts)).digest('hex').slice(0, 32);
}

/** The kind of decision a command is, for the card and the audit (null: not a queued decision). */
export function decisionKind(command) {
  const t = command?.type;
  if (GATE_TYPES.has(t)) return t;
  if (t === 'reply') return 'reply';
  if (t === 'allow' || t === 'deny') return t;
  if (t === 'stack-merge') return 'stack-merge';
  return null;
}

/**
 * What a decision is made on. Throws an Error with plain words when there is nothing to decide on
 * (the Foreman isn't waiting any more, or the request was answered).
 */
export function madeOnFor(command, { job = null, permissions = [] } = {}) {
  const t = command?.type;
  if (t === 'allow' || t === 'deny') {
    const p = permissions.find((x) => x.id === command.requestId);
    if (!p) throw new Error('That request was already answered or has expired.');
    return { kind: 'permission', slug: p.slug ?? null, id: p.id };
  }
  if (t === 'stack-merge') return { kind: 'stack', slug: command.slug, section: command.section ?? null };
  if (!job) throw new Error('There is no job like that among yours.');
  if (t === 'reply' && command.via !== 'card') return { kind: 'job', slug: job.slug, stage: job.stage ?? null };
  if (GATE_TYPES.has(t) || t === 'reply') {
    if (!job.gate) throw new Error('The Foreman isn’t waiting for a decision on this job any more. Look again.');
    return { kind: 'gate', slug: job.slug, brief: job.gate.briefNumber ?? null, mark: gateMark(job.gate) };
  }
  throw new Error(`“${t}” isn’t a decision that can wait for your laptop.`);
}

/** Whether a decision still holds against what is shown now. */
export function stillMadeOn(madeOn, { job = null, permissions = [] } = {}) {
  const changed = (why) => ({ ok: false, why });
  if (!madeOn || typeof madeOn !== 'object') return changed('It doesn’t say what it was decided on.');
  switch (madeOn.kind) {
    case 'gate':
      if (!job?.gate) return changed('The Foreman isn’t waiting for this decision any more.');
      if (gateMark(job.gate) !== madeOn.mark) return changed(job.gate.briefNumber !== madeOn.brief ? `The Foreman moved on to brief ${job.gate.briefNumber}.` : 'The brief changed since you decided.');
      return { ok: true };
    case 'job':
      if (!job) return changed('The job isn’t open any more.');
      if ((job.stage ?? null) !== madeOn.stage) return changed(`The job moved on to ${job.stage ?? 'another stage'}.`);
      return { ok: true };
    case 'permission':
      return permissions.some((p) => p.id === madeOn.id) ? { ok: true } : changed('That request was already answered on your laptop, or has expired.');
    case 'stack':
      return { ok: true }; // the stack itself refuses a section that isn't next (runner/stacks.js merge)
    default:
      return changed('It doesn’t say what it was decided on.');
  }
}
