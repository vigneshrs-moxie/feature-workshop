// A pretend Approver for demo mode (lib/approver.js askApprover's `query`). No Claude, no cost.
// It checks it was handed the Approver's two read-only tools and nothing else, reads the question
// ids out of the prompt, and answers each with the recommendation (the first option when there is
// none), the way the real Approver's system text says to. A permission card it allows as an
// ordinary step. A call Auto may never allow (a database command, a push elsewhere) is refused on its
// card first, in runner/auto.js, and the job carries on, so this is never asked about those.
//
// With `fail` (STARBASE_DEMO_APPROVER=fail) it answers in a shape checkAnswer refuses, so the demo
// can show Auto stopping when the Approver fails twice.

const TOOLS = ['Read', 'Glob'];

/** The questions in the prompt's <material> block: { id, recommendation, firstOption }. */
function questionsIn(prompt) {
  const out = [];
  // Only the Questions section: the decided items and the request come after it, in their own sections.
  const text = String(prompt);
  const from = text.indexOf('\nQuestions:\n');
  const section = from < 0 ? '' : text.slice(from + 1).split('\n\n')[0];
  for (const line of section.split('\n')) {
    let m = /^- id: (.*)$/.exec(line);
    if (m) { out.push({ id: m[1], recommendation: null, firstOption: null }); continue; }
    const q = out.at(-1);
    if (!q) continue;
    if ((m = /^ {2}recommendation: (.*)$/.exec(line))) q.recommendation = m[1] === 'none' ? null : m[1];
    else if ((m = /^ {2}options: (\S+) \(/.exec(line))) q.firstOption = m[1];
  }
  return out;
}

export function makeFakeApprover({ fail = process.env.STARBASE_DEMO_APPROVER === 'fail' } = {}) {
  return function fakeApprover({ prompt, options = {} }) {
    const tools = [...(options.tools ?? []), ...(options.allowedTools ?? [])];
    if (!tools.length || tools.some((t) => !TOOLS.includes(t))) throw new Error('The Approver is given only Read and Glob.');
    const text = String(prompt);
    const permission = /^A worker on this job asks permission/.test(text);
    let answer;
    if (fail) answer = { decision: 'maybe' };
    else if (permission) answer = { decision: 'allow', why: 'An ordinary step of this job.', risk: 'low' };
    else {
      answer = {
        decision: 'go',
        answers: questionsIn(text).map((q) => {
          const choice = q.recommendation ?? q.firstOption;
          return choice === null
            ? { id: q.id, choice: null, other: 'As the brief proposes.', reason: 'No options were given, so this follows the brief.' }
            : { id: q.id, choice, other: null, reason: q.recommendation !== null ? 'It is the recommendation.' : 'No recommendation, so the first option.' };
        }),
        why: 'The recommended answer, as the brief proposes.',
        risk: 'low',
      };
    }
    return (async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, structured_output: answer, total_cost_usd: 0.02, session_id: 'demo-approver', permission_denials: [] };
    })();
  };
}
