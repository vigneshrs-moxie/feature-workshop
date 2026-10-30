// Team Telemetry (packet 2E, decision G30's v2 half): the people who share one Claude account see
// one picture of that account's limit, gathered from every paired laptop's usage numbers.
//
//   POST /api/runner/usage   a laptop's usage lines, Claude Code replies outside the app and meter
//        (runner)            readings (lib/team-usage.js: numbers only, each line checked again here;
//                            a line with a text field the site doesn't expect is refused whole)
//        → { accepted: { app, claudeCode, readings }, refused: [{ kind, id, error }] }
//
// The person on every line is the laptop's person on the site, never anything the laptop says.

import { HttpError, sendJson } from './http.js';
import { iso } from './sessions.js';
import { BatchError, checkUsageBatch, KEEP_DAYS } from '../lib/team-usage.js';

/** The most one batch may be (the link's own limit). */
export const USAGE_BATCH_BYTES = 256 * 1024;
const DAY = 24 * 3600e3;
const CHUNK = 200;
const COLS = ['person_id', 'kind', 'id', 'runner_id', 't', 'job', 'stage', 'model', 'input', 'output', 'cache_read', 'cache_write_5m', 'cache_write_1h', 'usd', 'week_percent', 'week_resets_at', 'five_hour_percent', 'five_hour_resets_at', 'received_at'];

export default function telemetryRoutes(ctx) {
  const { db, now } = ctx;

  /** Stores checked lines for one laptop; a line it sent before keeps its first copy. Resolves the counts newly kept. */
  async function store(runner, lines) {
    const received = iso(now());
    const kept = { app: 0, claudeCode: 0, readings: 0 };
    const key = { app: 'app', 'claude-code': 'claudeCode', reading: 'readings' };
    for (let i = 0; i < lines.length; i += CHUNK) {
      const part = lines.slice(i, i + CHUNK);
      const values = [];
      const rows = part.map((l, j) => {
        const v = [runner.personId, l.kind, l.id, runner.id, iso(l.t), l.job, l.stage, l.model, l.tokens.input, l.tokens.output, l.tokens.cacheRead, l.tokens.cacheWrite5m, l.tokens.cacheWrite1h, l.usd,
          l.meters.week?.percent ?? null, l.meters.week?.resetsAt ?? null, l.meters.fiveHour?.percent ?? null, l.meters.fiveHour?.resetsAt ?? null, received];
        values.push(...v);
        return `(${v.map((_, k) => `$${j * COLS.length + k + 1}`).join(', ')})`;
      });
      const r = await db.query(`INSERT INTO usage_lines (${COLS.join(', ')}) VALUES ${rows.join(', ')} ON CONFLICT (person_id, kind, id) DO NOTHING RETURNING kind`, values);
      for (const row of r.rows) kept[key[row.kind]]++;
    }
    return kept;
  }

  return [
    {
      method: 'POST', path: '/api/runner/usage', auth: 'runner',
      async run({ req, res, runner }) {
        const body = await ctx.readJson(req, { max: USAGE_BATCH_BYTES });
        let checked;
        try { checked = checkUsageBatch(body, { now: now() }); } catch (err) {
          if (err instanceof BatchError) throw new HttpError(400, err.message);
          throw err;
        }
        const kept = await store(runner, checked.lines);
        await db.query(
          `INSERT INTO usage_sources (runner_id, person_id, claude_code, sent_at) VALUES ($1, $2, $3, $4)
             ON CONFLICT (runner_id) DO UPDATE SET claude_code = EXCLUDED.claude_code, sent_at = EXCLUDED.sent_at, person_id = EXCLUDED.person_id`,
          [runner.id, runner.personId, checked.counting, iso(now())],
        );
        await db.query('DELETE FROM usage_lines WHERE t < $1', [iso(now() - KEEP_DAYS * DAY)]);
        const accepted = { app: 0, claudeCode: 0, readings: 0 };
        for (const l of checked.lines) accepted[{ app: 'app', 'claude-code': 'claudeCode', reading: 'readings' }[l.kind]]++;
        sendJson(res, 200, { accepted, kept, refused: checked.refused });
      },
    },
  ];
}
