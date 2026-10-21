// The workflow's stages and worker characters, in one place.

export const STAGES = [
  { id: 'clarify', label: 'Clarify', tip: 'A few questions before the spec, each with what your answer changes.' },
  { id: 'spec', label: 'Spec', tip: 'Write down what the feature should do, in product terms.' },
  { id: 'refine', label: 'Refine', tip: 'A detailed product interview. Large features only.' },
  { id: 'wireframe', label: 'Screens', tip: 'Draw the feature’s screens from the spec, for you to review before anyone builds.' },
  { id: 'investigate', label: 'Investigate', tip: 'Read the code to see how the feature fits. No changes.' },
  { id: 'spec-update', label: 'Spec update', tip: 'Adjust the spec when the code showed something new. Only when needed.' },
  { id: 'plan', label: 'Plan', tip: 'The step-by-step implementation plan and test plan.' },
  { id: 'implement', label: 'Build', tip: 'Code the approved plan, one commit per step, in its own folder (worktree).' },
  { id: 'test', label: 'Test', tip: 'Run the approved checks and report each acceptance criterion.' },
  { id: 'review', label: 'Review', tip: 'Several reviewers look at the change from different angles.' },
  { id: 'pr1', label: 'PR #1', tip: 'Your fork → the same-named org branch. You review and merge it.' },
  { id: 'pr2', label: 'PR #2', tip: 'Org branch → staging. Needs Raj’s approval on GitHub.' },
  { id: 'staging-qa', label: 'Staging QA', tip: 'Check the feature on staging.' },
  { id: 'pr3', label: 'PR #3', tip: 'Staging → main. The release owner runs it.' },
];

export const STAGE_IDS = STAGES.map((s) => s.id);

// Who does each stage. Characters are drawn in the front end; this is the mapping.
export const AGENTS = {
  conductor: { name: 'Foreman', role: 'Conductor: runs the workshop and talks to you', stage: null },
  'feature-spec-writer': { name: 'Scribe', role: 'Writes and updates the product spec', stage: 'spec' },
  'feature-investigator': { name: 'Sleuth', role: 'Investigates the code (read-only)', stage: 'investigate' },
  'feature-planner': { name: 'Draftsman', role: 'Draws up the implementation and test plans', stage: 'plan' },
  'feature-implementer': { name: 'Builder', role: 'Builds the plan, one commit per step', stage: 'implement' },
  'feature-tester': { name: 'Tester', role: 'Runs the approved checks', stage: 'test' },
  'feature-reviewer': { name: 'Head inspector', role: 'Review: spec conformance and correctness', stage: 'review' },
  'feature-review-permissions': { name: 'Locksmith', role: 'Review: who can see and do what', stage: 'review' },
  'feature-review-tests': { name: 'Gauge', role: 'Review: test coverage and quality', stage: 'review' },
  'feature-review-conventions': { name: 'Stickler', role: 'Review: the repo’s written rules', stage: 'review' },
  'feature-review-errors': { name: 'Fuse', role: 'Review: errors and edge cases', stage: 'review' },
  'feature-review-db': { name: 'Mason', role: 'Review: migrations, schema and data integrity', stage: 'review' },
  'feature-review-performance': { name: 'Stopwatch', role: 'Review: speed with lots of data', stage: 'review' },
  'feature-review-ui': { name: 'Painter', role: 'Review: screens, wording and accessibility', stage: 'review' },
  'feature-fable-check': { name: 'Oracle', role: 'Fable second look at one document or change', stage: null },
};

// Workers drawn by an existing character: the wireframer is the Painter at the screens stage (the
// crew stays the same 15 members; lib/play.js CREW_TYPES and the Crew-dex count on that).
export const AGENT_ALIASES = {
  'feature-wireframer': { as: 'feature-review-ui', role: 'Draws the feature’s screens (wireframes) from the spec', stage: 'wireframe' },
};

export function agentInfo(agentType) {
  const alias = AGENT_ALIASES[agentType];
  if (alias) return { ...AGENTS[alias.as], role: alias.role, stage: alias.stage };
  return AGENTS[agentType] || { name: agentType || 'Helper', role: 'Other agent', stage: null };
}

// Which stages a route skips outright. spec-update is decided later (only if findings changed the spec).
export function skippedStages(route) {
  return route === 'small' ? ['refine'] : [];
}

// Find the stage named in free text. The earliest mention wins, so
// "Planning: complete, awaiting review" is the plan stage, not review.
const STAGE_PATTERNS = [
  ['spec-update', /spec[\s-]update|post-investigation/i],
  ['clarify', /\bclarify\b/i],
  ['wireframe', /\bwireframes?\b/i],
  ['refine', /\brefine(ment)?\b/i],
  ['investigate', /\binvestigat/i],
  ['plan', /\bplan(ning)?\b/i],
  ['implement', /\bimplement(ation|ing)?\b|\bbuild(ing)?\b|\bcoding\b/i],
  ['test', /\btest(ing)?\b(?![-\s]plan)/i],
  ['review', /\breview\b/i],
  ['pr1', /\bPR\s*#?1\b/i],
  ['pr2', /\bPR\s*#?2\b/i],
  ['staging-qa', /staging\s*QA/i],
  ['pr3', /\bPR\s*#?3\b|\brelease\b/i],
  ['spec', /\bspec\b/i],
];

export function detectStage(text) {
  if (!text) return null;
  let best = null;
  for (const [id, re] of STAGE_PATTERNS) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) best = { id, index: m.index };
  }
  return best ? best.id : null;
}

export function detectState(text) {
  if (!text) return null;
  if (/presented for review|awaiting|waiting|pending (human|your)|needs? (your|human)/i.test(text)) return 'waiting_for_you';
  if (/\bblocked\b/i.test(text)) return 'blocked';
  if (/in progress|running|working/i.test(text)) return 'working';
  if (/stopped|\bdone\b|finished|released/i.test(text)) return 'done';
  return null;
}
