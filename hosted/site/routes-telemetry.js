// Team Telemetry (packet 2E, decision G30's v2 half): the people who share one Claude account see
// one picture of that account's limit, gathered from every paired laptop's usage numbers.
//
//   POST /api/runner/usage        a laptop's usage lines, Claude Code replies outside the app and
//        (runner)                 meter readings (lib/team-usage.js: numbers only, each line checked
//                                 again here; a line with a text field the site doesn't expect is
//                                 refused whole)
//        → { accepted: { app, claudeCode, readings }, kept, refused: [{ kind, id, error }] }
//   GET  /api/telemetry/team?tz=  the shared account's three graphs (lib/team-telemetry.js): the
//        (anyone signed in)       gauge with the forecast, share by model, who used this week's
//                                 limit. The same for everyone, the manager too; no job names.
//                                 tz: the page's time zone, for the plan week's Wednesday 16:00
//   GET  /api/telemetry/people/:id?tz=
//        (that person only)       their own two graphs: usage by day by job, cost per ticket and
//                                 stage. Anyone else's id is a 404, as if there were nothing there.
//
// The person on every line is the laptop's person on the site, never anything the laptop says.

import { HttpError, sendJson } from './http.js';
import { iso } from './sessions.js';
import { BatchError, checkUsageBatch, KEEP_DAYS } from '../lib/team-usage.js';
import { accountRatio, privateTelemetry, teamTelemetry, zoneOf } from '../lib/team-telemetry.js';

/** The most one batch may be (the link's own limit). */
export const USAGE_BATCH_BYTES = 256 * 1024;
const DAY = 24 * 3600e3;
const CHUNK = 200;
/** How far back the team page reads: six plan weeks for Share by model, and a day over. */
const TEAM_DAYS = 43;
const COLS = ['person_id', 'kind', 'id', 'runner_id', 't', 'job', 'stage', 'model', 'input', 'output', 'cache_read', 'cache_write_5m', 'cache_write_1h', 'usd', 'week_percent', 'week_resets_at', 'five_hour_percent', 'five_hour_resets_at', 'received_at'];
// The team page reads no job names: what it draws is about the whole account.
const TEAM_COLS = 'person_id, kind, t, model, input, output, cache_read, cache_write_5m, cache_write_1h, usd, week_percent, week_resets_at, five_hour_percent, five_hour_resets_at';

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

  /** Everyone on the site, by the name the site shows. */
  async function everyone() {
    const { rows } = await db.query('SELECT id, email, name, role FROM people ORDER BY lower(name), email');
    return rows.map((r) => { const v = ctx.personView({ id: Number(r.id), email: r.email, name: r.name, role: r.role }); return { id: v.id, name: v.name }; });
  }

  async function teamRows(since) {
    return (await db.query(`SELECT ${TEAM_COLS} FROM usage_lines WHERE t >= $1 ORDER BY t`, [iso(since)])).rows;
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
    {
      method: 'GET', path: '/api/telemetry/team', auth: 'session',
      async run({ res, url, person }) {
        const t = now();
        const sources = (await db.query('SELECT s.person_id, s.claude_code FROM usage_sources s JOIN runners r ON r.id = s.runner_id WHERE r.revoked_at IS NULL')).rows;
        const body = teamTelemetry({ rows: await teamRows(t - TEAM_DAYS * DAY), people: await everyone(), sources, now: t, timeZone: zoneOf(url.searchParams.get('tz')), me: person.id });
        sendJson(res, 200, body);
      },
    },
    {
      method: 'GET', path: /^\/api\/telemetry\/people\/(\d{1,15})$/, auth: 'session',
      async run({ res, url, m, person }) {
        // Your own jobs only: anyone else's is answered as if there were nothing at this address.
        if (Number(m[1]) !== person.id) throw new HttpError(404, 'There is nothing at this address.');
        const t = now();
        const rows = (await db.query("SELECT * FROM usage_lines WHERE person_id = $1 AND kind = 'app' AND t >= $2 ORDER BY t", [person.id, iso(t - 31 * DAY)])).rows;
        const jobs = (await db.query('SELECT slug, title, ticket_key FROM jobs WHERE person_id = $1', [person.id])).rows;
        const ratio = accountRatio(await teamRows(t - 31 * DAY), { now: t });
        sendJson(res, 200, { person: { id: person.id, name: ctx.personView(person).name }, ...privateTelemetry({ rows, jobs, now: t, timeZone: zoneOf(url.searchParams.get('tz')), ratio }) });
      },
    },
  ];
}
