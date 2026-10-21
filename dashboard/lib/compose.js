// Builds the exact message the dashboard sends to a job's Foreman (conductor).
// The page shows this text, editable, before anything is sent.

const line = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function answersBlock(questions = [], answers = {}) {
  const out = [];
  questions.forEach((q, i) => {
    const a = answers[q.id];
    if (!a) return;
    let text;
    if (a.choice) {
      const opt = q.options.find((o) => o.id === a.choice);
      text = opt ? `${opt.id}) ${line(opt.label)}` : line(a.choice);
    }
    if (a.other) text = text ? `${text}. ${line(a.other)}` : line(a.other);
    if (text) out.push(`${i + 1}. ${line(q.text)} → ${text}`);
  });
  return out;
}

function decisionsBlock(decided = [], verdicts = {}) {
  const confirmed = [];
  const changed = [];
  const open = [];
  for (const d of decided) {
    if (d.confirmed) continue;
    const v = verdicts[d.id ?? d.decision];
    if (v?.verdict === 'confirm') confirmed.push(d.id ?? line(d.decision));
    else if (v?.verdict === 'change' && line(v.note)) changed.push(`${d.id ?? line(d.decision)}: ${line(v.note)}`);
    else open.push(d.id ?? line(d.decision));
  }
  const out = [];
  if (confirmed.length) out.push(`Decided on my behalf, confirmed: ${confirmed.join(', ')}.`);
  for (const c of changed) out.push(`Decided on my behalf, changed: ${c}`);
  if (open.length) out.push(`Not confirmed yet: ${open.join(', ')}.`);
  return out;
}

function versionsLine(status) {
  const parts = [];
  if (status?.spec?.version) parts.push(`spec v${status.spec.version}${status.spec.status ? ` (${status.spec.status})` : ''}`);
  for (const a of status?.artifacts ?? []) if (a.version) parts.push(`${a.name} v${a.version}`);
  return parts.length ? `At these versions: ${parts.join(', ')}.` : null;
}

// Next-step chips from the gate card: one line each, in the exact words the workflow's
// job-options.md ("Option lines from the gate card") defines. This file is also served to the
// browser on its own (/shared/compose.js), so the stage lists live here. KEEP IN STEP with
// STAGES in stages.js and SKIPPABLE / FABLE_POINTS in options.js (a test checks it).
export const CHIP_STAGES = ['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'spec-update', 'plan', 'implement', 'test', 'review'];
export const CHIP_SKIPPABLE = ['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'spec-update', 'plan', 'test', 'review'];
export const CHIP_POINTS = ['spec', 'plan', 'review', 'pr'];
export const CHIP_KINDS = ['skip', 'lighter', 'heavier', 'fable', 'self', 'level'];
export const MAX_CHIPS = 8;
const PREFIX = 'Option change for the next step:';
const isLevelNumber = (v) => Number.isInteger(v) && v >= 0 && v <= 3;

/** One chip's line, or null when the chip is malformed. */
export function chipLine(chip) {
  if (!chip || typeof chip !== 'object') return null;
  const { kind, stage, point, level, was } = chip;
  if (kind === 'skip') return CHIP_SKIPPABLE.includes(stage) ? `${PREFIX} skip ${stage}` : null;
  if (kind === 'lighter' || kind === 'heavier') return CHIP_STAGES.includes(stage) ? `${PREFIX} ${kind} ${stage}` : null;
  if (kind === 'fable') return CHIP_POINTS.includes(point) ? `${PREFIX} ask Fable at ${point}` : null;
  if (kind === 'self') return CHIP_STAGES.includes(stage) ? `${PREFIX} I'll do ${stage} myself` : null;
  if (kind === 'level') return isLevelNumber(level) && isLevelNumber(was) && level !== was ? `${PREFIX} level L${level} (was L${was})` : null;
  return null;
}

/**
 * The chips worth sending: malformed ones and repeats left out, one level change at most (the
 * first), and at most MAX_CHIPS. Each kept chip comes back with only its own fields.
 */
export function cleanChips(chips) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(chips) ? chips : []) {
    const text = chipLine(c);
    if (!text) continue;
    const key = c.kind === 'level' ? 'level' : text;
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.kind === 'fable') out.push({ kind: c.kind, point: c.point });
    else if (c.kind === 'level') out.push({ kind: c.kind, level: c.level, was: c.was });
    else out.push({ kind: c.kind, stage: c.stage });
    if (out.length === MAX_CHIPS) break;
  }
  return out;
}

/**
 * kind: 'approve' | 'changes' | 'stop' | 'message'
 * status: the job's status (questions, decidedOnYourBehalf, nextProposed, spec, artifacts, brief)
 * chips: next-step chips from the gate card ([{ kind, stage?, point?, level?, was? }]): one line
 * each after the answers and verdicts, before the rest. Malformed ones are left out.
 */
export function composeReply({ kind, status = {}, answers = {}, verdicts = {}, note = '', chips = [] }) {
  const head = [];
  const brief = status.brief?.number ? `brief ${status.brief.number}` : 'your last brief';
  const ans = answersBlock(status.questions, answers);
  const dec = decisionsBlock(status.decidedOnYourBehalf, verdicts);
  const opt = cleanChips(chips).map(chipLine);
  if (ans.length) head.push(`My answers to ${brief}:`, ...ans);
  if (dec.length) head.push(...(ans.length ? [''] : []), ...dec);
  if (opt.length) head.push(...(head.length ? [''] : []), ...opt);

  const body = [];
  if (kind === 'approve') {
    const next = line(status.nextProposed);
    body.push(next ? `I approve. Go ahead with the next stage: ${next}` : 'I approve. Go ahead with the next stage you proposed.');
    const v = versionsLine(status);
    if (v) body.push(v);
    if (line(note)) body.push(line(note));
  } else if (kind === 'changes') {
    body.push('Please make changes before moving on, and stay in the current stage:');
    body.push(line(note) || '(describe the changes)');
  } else if (kind === 'stop') {
    body.push('Stop here. Record where things stand in workflow-status.md and don’t start anything else.');
    if (line(note)) body.push(line(note));
  } else {
    body.push(String(note ?? '').trim());
  }
  return [...head, ...(head.length ? [''] : []), ...body].join('\n').trim();
}
