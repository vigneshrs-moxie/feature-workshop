// Cost from token counts, and helpers to combine it with Claude Code's own figures.
//
// Prices are per million tokens (reference dated 2026-10-06). Cache writes are priced
// at 1.25x input for the 5-minute cache and 2x input for the 1-hour cache. Checked
// against the CLI's own totals on the sample run: within 0.3%.
// Anything computed here is an ESTIMATE; Claude Code's cost-state figure is preferred.

export const PRICES_AS_OF = '2026-10-06';

export const PRICES = {
  fable: { label: 'Fable 5.1', input: 10, output: 50, cacheRead: 0.25 },
  opus: { label: 'Opus 5.5', input: 4, output: 20, cacheRead: 0.2 },
  sonnet: { label: 'Sonnet 5.5', input: 2, output: 10, cacheRead: 0.2 },
  // Haiku's cache-read rate was not in the reference; 10% of input is assumed.
  haiku: { label: 'Haiku 5.5', input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export function modelFamily(model) {
  const m = String(model || '').toLowerCase();
  return Object.keys(PRICES).find((f) => m.includes(f)) || null;
}

export function modelLabel(model) {
  const f = modelFamily(model);
  return f ? PRICES[f].label : String(model || 'unknown');
}

// Normalise the many usage shapes into one token breakdown.
export function tokensFromUsage(usage = {}) {
  const cc = usage.cache_creation || null;
  const write1h = cc ? cc.ephemeral_1h_input_tokens || 0 : 0;
  const write5m = cc ? cc.ephemeral_5m_input_tokens || 0 : usage.cache_creation_input_tokens || 0;
  return {
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
    cacheWrite5m: write5m,
    cacheWrite1h: write1h,
  };
}

export function addTokens(a, b) {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  };
}

export const ZERO_TOKENS = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });

// Returns USD, or null when the model has no known price.
export function estimateCost(model, tokens) {
  const p = PRICES[modelFamily(model)];
  if (!p) return null;
  return (
    tokens.input * p.input +
    tokens.output * p.output +
    tokens.cacheRead * p.cacheRead +
    tokens.cacheWrite5m * p.input * 1.25 +
    tokens.cacheWrite1h * p.input * 2
  ) / 1e6;
}

// Scale per-agent estimates so each model's total matches Claude Code's own figure.
// `estimates` and `actualByModel` are { [model]: usd }. Returns { [model]: factor }.
export function calibrationFactors(estimates, actualByModel) {
  const factors = {};
  for (const [model, est] of Object.entries(estimates)) {
    const actual = actualByModel?.[model];
    factors[model] = est > 0 && typeof actual === 'number' ? actual / est : 1;
  }
  return factors;
}

export function formatUsd(usd) {
  if (usd === null || usd === undefined || Number.isNaN(usd)) return '—';
  return usd < 0.01 && usd > 0 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

// CSV with proper quoting; rows are arrays of primitives.
export function toCsv(header, rows) {
  const q = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Prefix formula-looking cells so spreadsheets don't execute them.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n') + '\n';
}

// ---------- Reports ----------

const MODEL_IDS = { fable: 'claude-fable-5-1', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };

// What the Foreman's (conductor's) share of a job would cost on other models, from its token counts.
export function whatIfConductor(agents) {
  const rows = agents.filter((a) => a.agentType === 'conductor');
  if (!rows.length) return null;
  const actual = rows.reduce((s, r) => s + r.usd, 0);
  const actualModels = [...new Set(rows.map((r) => modelLabel(r.model)))];
  const alternatives = {};
  for (const fam of Object.keys(PRICES)) {
    alternatives[fam] = rows.reduce((s, r) => s + (estimateCost(MODEL_IDS[fam], r.tokens) ?? 0), 0);
  }
  return { actual, actualModels, alternatives };
}

const STAGE_ORDER = ['spec', 'refine', 'investigate', 'spec-update', 'plan', 'implement', 'test', 'review', 'pr1', 'pr2', 'staging-qa', 'pr3', 'other'];

export function costRows(features) {
  const rows = [];
  for (const f of features) {
    for (const a of f.cost.agents) {
      rows.push({
        job: f.title, slug: f.slug, project: f.project?.name ?? '', kind: f.kind ?? '', route: f.route ?? '',
        stage: a.stage, crew: a.agentType === 'conductor' ? 'Foreman (conductor)' : a.agentType, model: modelLabel(a.model),
        inputTokens: a.tokens.input, outputTokens: a.tokens.output, cacheReadTokens: a.tokens.cacheRead,
        cacheWriteTokens: a.tokens.cacheWrite5m + a.tokens.cacheWrite1h, usd: a.usd, source: f.cost.source,
      });
    }
  }
  return rows.sort((x, y) => x.job.localeCompare(y.job) || STAGE_ORDER.indexOf(x.stage) - STAGE_ORDER.indexOf(y.stage) || y.usd - x.usd);
}

export function costCsv(features) {
  const header = ['Job', 'Project', 'Kind', 'Route', 'Stage', 'Crew member', 'Model', 'Input tokens', 'Output tokens', 'Cache read tokens', 'Cache write tokens', 'Cost (USD)', 'Cost source'];
  const rows = costRows(features).map((r) => [r.job, r.project, r.kind, r.route, r.stage, r.crew, r.model, r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheWriteTokens, r.usd.toFixed(4), r.source === 'claude-code' ? 'Claude Code figure' : 'estimate from tokens']);
  return toCsv(header, rows);
}

export function costMarkdown(features, { generatedAt = new Date() } = {}) {
  const usd = (n) => `$${(n ?? 0).toFixed(2)}`;
  const md = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const total = features.reduce((s, f) => s + f.cost.totalUsd, 0);
  const byModel = {};
  const byStage = {};
  for (const f of features) {
    for (const [m, v] of Object.entries(f.cost.perModel)) byModel[modelLabel(m)] = (byModel[modelLabel(m)] ?? 0) + v;
    for (const a of f.cost.agents) byStage[a.stage] = (byStage[a.stage] ?? 0) + a.usd;
  }
  const lines = [
    `# Feature workflow costs`,
    '',
    `Generated ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC from Claude Code session logs. Prices as of ${PRICES_AS_OF}.`,
    '',
    `**Total across ${features.length} job${features.length === 1 ? '' : 's'}: ${usd(total)}**`,
    '',
    '## By job',
    '',
    '| Job | Project | Stage now | Cost | Foreman share | Source |',
    '|---|---|---|---:|---:|---|',
    ...features.map((f) => {
      const foreman = f.cost.agents.filter((a) => a.agentType === 'conductor').reduce((s, a) => s + a.usd, 0);
      const share = f.cost.totalUsd ? `${Math.round((foreman / f.cost.totalUsd) * 100)}%` : '—';
      return `| ${md(f.title)} | ${md(f.project?.name)} | ${md(f.stage ?? '—')} | ${usd(f.cost.totalUsd)} | ${share} | ${f.cost.source === 'claude-code' ? 'Claude Code figure' : f.cost.source === 'estimate' ? 'estimate' : 'no sessions'} |`;
    }),
    '',
    '## By model',
    '',
    '| Model | Cost | Share |',
    '|---|---:|---:|',
    ...Object.entries(byModel).sort((a, b) => b[1] - a[1]).map(([m, v]) => `| ${md(m)} | ${usd(v)} | ${total ? Math.round((v / total) * 100) : 0}% |`),
    '',
    '## By stage',
    '',
    '| Stage | Cost |',
    '|---|---:|',
    ...STAGE_ORDER.filter((s) => byStage[s]).map((s) => `| ${s} | ${usd(byStage[s])} |`),
    '',
    '## Notes',
    '',
    '- Where Claude Code recorded its own cost figure, the numbers use it; otherwise they are estimates from token counts.',
    '- These are client-side estimates, not a bill.',
  ];
  const whatIfs = features.map((f) => ({ f, w: whatIfConductor(f.cost.agents) })).filter((x) => x.w);
  if (whatIfs.length) {
    lines.push('', '## What if the Foreman ran on another model', '', '| Job | Actual Foreman cost | On Fable 5.1 | On Opus 5.5 | On Sonnet 5.5 |', '|---|---:|---:|---:|---:|');
    for (const { f, w } of whatIfs) lines.push(`| ${md(f.title)} | ${usd(w.actual)} (${md(w.actualModels.join(', '))}) | ≈${usd(w.alternatives.fable)} | ≈${usd(w.alternatives.opus)} | ≈${usd(w.alternatives.sonnet)} |`);
    lines.push('', 'The “what if” columns re-price the same tokens; a different model would also use a different number of tokens.');
  }
  return lines.join('\n') + '\n';
}
