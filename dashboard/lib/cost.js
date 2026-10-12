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
