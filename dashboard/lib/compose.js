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

/**
 * kind: 'approve' | 'changes' | 'stop' | 'message'
 * status: the job's status (questions, decidedOnYourBehalf, nextProposed, spec, artifacts, brief)
 */
export function composeReply({ kind, status = {}, answers = {}, verdicts = {}, note = '' }) {
  const head = [];
  const brief = status.brief?.number ? `brief ${status.brief.number}` : 'your last brief';
  const ans = answersBlock(status.questions, answers);
  const dec = decisionsBlock(status.decidedOnYourBehalf, verdicts);
  if (ans.length) head.push(`My answers to ${brief}:`, ...ans);
  if (dec.length) head.push(...(ans.length ? [''] : []), ...dec);

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
