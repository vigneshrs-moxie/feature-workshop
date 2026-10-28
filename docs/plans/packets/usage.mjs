#!/usr/bin/env node
// Prints the Claude plan's weekly and 5-hour usage, the same numbers the dashboard's top bar shows.
// Read-only. Run from the repo root: node docs/plans/packets/usage.mjs
import { readClaudeToken, parseUsage, USAGE_URL } from '../../../dashboard/lib/plan-usage.js';

const token = await readClaudeToken();
if (!token) { console.log('usage: unknown (no Claude Code sign-in found)'); process.exit(0); }
const res = await fetch(USAGE_URL, { headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' } });
if (!res.ok) { console.log(`usage: unknown (HTTP ${res.status})`); process.exit(0); }
const { fiveHour, week } = parseUsage(await res.json());
const fmt = (m) => (m ? `${m.percent}% (resets ${new Date(m.resetsAt).toLocaleString()})` : 'n/a');
console.log(`week: ${fmt(week)}`);
console.log(`five-hour: ${fmt(fiveHour)}`);
if (week && week.percent >= 95) console.log('WARNING: weekly usage is at or above 95%');
