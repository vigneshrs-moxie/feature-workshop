// Reads status.json, the machine-readable summary the conductor writes after every brief
// (schema: ~/.claude/skills/feature/status-json.md). Unknown values become null with a warning.

import { STAGE_IDS } from './stages.js';

const STAGE_STATES = ['working', 'waiting_for_you', 'blocked', 'done'];
const WAITING_FOR = ['approval', 'answers', 'permission'];
const PR_STATES = ['not_started', 'open', 'changes_requested', 'approved', 'merged', 'closed'];

const str = (v) => (typeof v === 'string' && v.trim() ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);

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

  const questions = arr(raw.questions).slice(0, 3).map((q, i) => {
    const options = arr(q?.options)
      .map((o) => ({ id: String(o?.id ?? ''), label: str(o?.label) ?? String(o?.id ?? '') }))
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
  };
}
