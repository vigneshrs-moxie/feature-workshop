// The job page's overview facts (Part 3, design 3.1): what acceptance.md says the job is checked
// against. The rest of the overview (the ticket, what we're building) is put together by jobDetail
// in runner/index.js from ticket.md, the session record and the Key points in summaries/.

const WORKS_WHEN = /^##\s+It works when\s*:?\s*$/i;
const MUST_NOT = /^##\s+It must not\s*:?\s*$/i;
const NUMBERED = /^\s*\d+[.)]\s+(.*\S)\s*$/;
// The requirement ids the line is traced to, at its end: (FR-001) or (FR-002, FR-003).
const FR_BRACKETS = /\s*\(FR-[^()]*\)\s*$/;

/**
 * The numbered lines under `## It works when` and `## It must not` of an acceptance.md, without
 * their trailing (FR-…) brackets: { worksWhen, mustNot }, a list empty when its heading has no
 * numbered lines. Null when neither heading is there. A list ends at the next heading.
 */
export function readAcceptance(text) {
  if (typeof text !== 'string') return null;
  const out = { worksWhen: [], mustNot: [] };
  let list = null;
  let found = false;
  for (const line of text.split(/\r?\n/)) {
    if (WORKS_WHEN.test(line)) { list = out.worksWhen; found = true; continue; }
    if (MUST_NOT.test(line)) { list = out.mustNot; found = true; continue; }
    if (/^#/.test(line)) { list = null; continue; }
    const m = list ? NUMBERED.exec(line) : null;
    if (!m) continue;
    const item = m[1].replace(FR_BRACKETS, '').trim();
    if (item) list.push(item);
  }
  return found ? out : null;
}
