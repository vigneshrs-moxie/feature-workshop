// Reads status.json, the machine-readable summary the conductor writes after every brief
// (schema: ~/.claude/skills/feature/status-json.md). Unknown values become null with a warning.

import { STAGE_IDS } from './stages.js';

const STAGE_STATES = ['working', 'waiting_for_you', 'blocked', 'done'];
const WAITING_FOR = ['approval', 'answers', 'permission'];
const PR_STATES = ['not_started', 'open', 'changes_requested', 'approved', 'merged', 'closed'];

const str = (v) => (typeof v === 'string' && v.trim() ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);
// The Foreman's one-line reason for the level it suggests; longer text is cut, not refused.
export const LEVEL_REASON_MAX = 400;
export const MAX_QUESTIONS = 3;
export const MAX_CLARIFY_QUESTIONS = 5;
// An option's consequence is one line (status-json.md says under 120 characters); longer text is cut.
export const CONSEQUENCE_MAX = 200;

// suggested_level (optional, schema 1): the level L0–L3 the Foreman proposes in its first brief.
// Missing or null is fine; anything but a whole number 0–3 becomes null with a warning.
function suggestedLevel(v, warnings) {
  if (v === null || v === undefined) return null;
  if (Number.isInteger(v) && v >= 0 && v <= 3) return v;
  warnings.push(`suggested_level: unexpected value "${String(v).slice(0, 40)}"; expected 0, 1, 2 or 3`);
  return null;
}

function oneOf(value, allowed, field, warnings) {
  if (value === null || value === undefined) return null;
  if (allowed.includes(value)) return value;
  warnings.push(`${field}: unexpected value "${value}"`);
  return null;
}

export function parseStatusJson(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, warnings: [`status.json is not valid JSON: ${err.message}`] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, warnings: ['status.json is not an object'] };
  }
  const warnings = [];
  if (raw.schema_version !== 1) warnings.push(`schema_version ${raw.schema_version ?? 'missing'}; expected 1`);

  // At most three questions per brief; a clarify brief (the questions before the spec) may ask five.
  // Each option may carry a consequence: one line on what changes if it is picked.
  const questions = arr(raw.questions).slice(0, raw.stage === 'clarify' ? MAX_CLARIFY_QUESTIONS : MAX_QUESTIONS).map((q, i) => {
    const options = arr(q?.options)
      .map((o) => ({ id: String(o?.id ?? ''), label: str(o?.label) ?? String(o?.id ?? ''), consequence: str(o?.consequence)?.slice(0, CONSEQUENCE_MAX) ?? null }))
      .filter((o) => o.id);
    return {
      id: String(q?.id ?? i + 1),
      text: str(q?.text) ?? '',
      recommendation: q?.recommendation != null ? String(q.recommendation) : null,
      options,
    };
  });

  const prs = [1, 2, 3].map((n) => {
    const p = arr(raw.prs).find((x) => Number(x?.number) === n) || {};
    return {
      number: n,
      label: str(p.label),
      url: /^https:\/\/github\.com\//.test(p.url ?? '') ? p.url : null,
      state: oneOf(p.state ?? 'not_started', PR_STATES, `prs[${n}].state`, warnings),
    };
  });

  return {
    ok: true,
    warnings,
    slug: str(raw.slug),
    title: str(raw.title),
    route: oneOf(raw.route, ['quick', 'small', 'large'], 'route', warnings),
    kind: oneOf(raw.kind ?? null, ['feature', 'bug'], 'kind', warnings),
    stage: oneOf(raw.stage, STAGE_IDS, 'stage', warnings),
    stageState: oneOf(raw.stage_state, STAGE_STATES, 'stage_state', warnings),
    waitingFor: oneOf(raw.waiting_for, WAITING_FOR, 'waiting_for', warnings),
    waitingSince: str(raw.waiting_since),
    brief: raw.brief && typeof raw.brief === 'object'
      ? { number: Number(raw.brief.number) || null, path: str(raw.brief.path), headline: str(raw.brief.headline) }
      : null,
    questions,
    decidedOnYourBehalf: arr(raw.decided_on_your_behalf).map((d) => ({
      id: str(d?.id),
      decision: str(d?.decision) ?? '',
      reason: str(d?.reason),
      where: str(d?.where),
      confirmed: d?.confirmed === true,
    })),
    nextProposed: str(raw.next_proposed),
    spec: raw.spec && typeof raw.spec === 'object'
      ? { path: str(raw.spec.path), version: raw.spec.version != null ? String(raw.spec.version) : null, status: str(raw.spec.status) }
      : null,
    artifacts: arr(raw.artifacts).map((a) => ({
      name: str(a?.name) ?? '',
      path: str(a?.path),
      version: a?.version != null ? String(a.version) : null,
      basedOn: str(a?.based_on),
    })),
    repo: raw.repo && typeof raw.repo === 'object' ? { path: str(raw.repo.path), baseBranch: str(raw.repo.base_branch) } : null,
    branch: str(raw.branch),
    worktree: str(raw.worktree),
    baseSha: str(raw.base_sha),
    prs,
    sessionId: str(raw.session_id),
    cwd: str(raw.cwd),
    updatedAt: str(raw.updated_at),
    suggestedLevel: suggestedLevel(raw.suggested_level, warnings),
    levelReason: str(raw.level_reason)?.trim().slice(0, LEVEL_REASON_MAX) ?? null,
  };
}
