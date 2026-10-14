// Reads workflow-status.md, the human record each feature keeps.
// The format is defined in workflow-gates.md, but older or hand-written files
// differ, so every field is optional and the reader never throws.

import { splitSections, findSection, parseTable, parseBullets, stripInline } from './markdown-tables.js';
import { detectStage, detectState } from './stages.js';

function headerFields(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    // "**Key:** value" and "**Key:** value · **Other:** value" on one line.
    const re = /\*\*([^*:]+):\*\*\s*([^*]*?)(?=\s*·\s*\*\*|$)/g;
    let m;
    while ((m = re.exec(line))) fields[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return fields;
}

function parseRoute(text) {
  if (!text) return null;
  if (/^\s*quick/i.test(text)) return 'quick';
  if (/^\s*small/i.test(text)) return 'small';
  if (/^\s*large/i.test(text)) return 'large';
  return null;
}

// "<path> · current version 0.4 · status DRAFT (…)"
function parseSpec(text) {
  if (!text) return null;
  const parts = text.split('·').map((p) => p.trim());
  const version = /version\s+v?([\w.]+)/i.exec(text)?.[1] ?? null;
  const status = /status\s+(DRAFT|IN REVIEW|APPROVED)/i.exec(text)?.[1]?.toUpperCase() ?? null;
  return { path: stripInline(parts[0]) || null, version, status, raw: text };
}

function parseRepository(text) {
  if (!text) return null;
  return {
    path: stripInline(text.split('·')[0]) || null,
    branch: /branch\s+`?([^\s`·]+)`?/i.exec(text)?.[1] ?? null,
    commit: /commit\s+`?([0-9a-f]{7,40})`?/i.exec(text)?.[1] ?? null,
    raw: text,
  };
}

function normaliseApproval(row) {
  const state = row.state || '';
  return {
    date: row.date || null,
    who: row.who || null,
    said: row['what they said or did (quote or invocation)'] ?? row['what they said or did'] ?? row.said ?? null,
    artifact: row['artifact + version'] ?? row.artifact ?? null,
    authorizes: row.authorizes ?? null,
    scope: row['scope / limits'] ?? row.scope ?? null,
    superseded: /supersed/i.test(state),
    state: state || null,
  };
}

// Free-form files list approvals as bullets with quoted words; keep them as plain entries.
function approvalsFromBullets(body) {
  return parseBullets(body)
    .filter((b) => b.depth === 0)
    .map((b) => ({
      date: /\b(\d{4}-\d{2}-\d{2})\b/.exec(b.text)?.[1] ?? null,
      who: null,
      said: b.text,
      artifact: null,
      authorizes: null,
      scope: null,
      superseded: /supersed/i.test(b.text),
      state: null,
    }));
}

export function parseWorkflowStatus(text) {
  const warnings = [];
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, warnings: ['workflow-status.md is empty'] };
  }
  const { preamble, sections } = splitSections(text);
  const title = /^#\s+(.+?)\s*$/m.exec(preamble)?.[1]
    ?.replace(/\s*[:—–-]\s*workflow status\s*$/i, '')
    .trim() ?? null;
  const fields = headerFields(preamble);

  const currentSection = findSection(sections, /^current stage/i);
  const currentRaw = fields['current stage']
    ?? currentSection?.body.split(/\r?\n/).map(stripInline).find((l) => l.trim())
    ?? null;
  if (!currentRaw) warnings.push('No current stage found');

  const nextSection = findSection(sections, /^next/i);
  const nextRaw = fields['next proposed']
    ?? nextSection?.body.split(/\r?\n/).find((l) => l.trim())?.trim()
    ?? null;

  const artifactsSection = findSection(sections, /^artifacts/i);
  const artifacts = parseTable(artifactsSection?.body).map((r) => ({
    name: stripInline(r.artifact ?? ''),
    path: stripInline(r.path ?? '') || null,
    version: stripInline(r.version ?? r['version / status'] ?? '') || null,
    basedOn: r['based on'] ?? null,
  }));

  const authSection = findSection(sections, /authori[sz]ation|review and/i);
  let approvals = parseTable(authSection?.body).map(normaliseApproval);
  if (!approvals.length && authSection) approvals = approvalsFromBullets(authSection.body);

  const historySection = findSection(sections, /stage history/i);
  const history = parseTable(historySection?.body).map((r) => ({
    date: r.date || null,
    stage: r.stage || null,
    outcome: r.outcome || null,
    artifacts: r['artifacts produced'] || null,
  }));

  const worktreeField = fields.worktree && !/not created/i.test(fields.worktree) ? fields.worktree : null;

  return {
    ok: true,
    warnings,
    title,
    slug: fields['feature slug'] ?? null,
    updated: fields.updated ?? null,
    route: parseRoute(fields.route),
    routeRaw: fields.route ?? null,
    spec: parseSpec(fields.spec),
    refinement: fields.refinement ?? null,
    repository: parseRepository(fields.repository),
    worktree: worktreeField ? stripInline(worktreeField.split('·')[0]) : null,
    stage: detectStage(currentRaw),
    stageState: detectState(currentRaw),
    currentRaw,
    nextProposed: nextRaw ? stripInline(nextRaw.replace(/^`|`$/g, '')) : null,
    artifacts,
    approvals,
    history,
    sections: sections.map((s) => s.heading),
  };
}
