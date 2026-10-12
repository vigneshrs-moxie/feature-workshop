// Reads Claude Code session logs (~/.claude/projects/<dir>/<session>.jsonl and
// <session>/subagents/agent-<id>.jsonl + .meta.json) for activity and cost.
// The log format is internal to Claude Code and may change: unknown lines are skipped.

import path from 'node:path';
import { tokensFromUsage, addTokens, ZERO_TOKENS, estimateCost } from './cost.js';

// One line describing what a tool call is doing, in plain words.
export function describeTool(name, input = {}) {
  const base = (p) => (p ? path.basename(String(p)) : '');
  const cut = (s, n = 70) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  switch (name) {
    case 'Read': return `Reading ${base(input.file_path)}`;
    case 'Write': return `Writing ${base(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit': return `Editing ${base(input.file_path)}`;
    case 'Grep': return `Searching the code for “${cut(input.pattern, 40)}”`;
    case 'Glob': return `Looking for files (${cut(input.pattern, 40)})`;
    case 'Bash': return input.description ? cut(input.description) : `Running ${cut(input.command, 50)}`;
    case 'Agent':
    case 'Task': return `Sending work to ${input.subagent_type || 'a helper'}${input.description ? `: ${cut(input.description, 50)}` : ''}`;
    case 'SendMessage': return 'Sending a follow-up to a worker';
    case 'WebFetch': return 'Reading a web page';
    case 'WebSearch': return 'Searching the web';
    case 'Skill': return `Loading skill ${input.skill || ''}`.trim();
    default: return `Using ${name}`;
  }
}

function lastTextOf(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : null;
  const t = content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n').trim();
  return t || null;
}

// Parse one JSONL log's text.
export function parseSessionLog(text) {
  const out = {
    sessionId: null,
    agentId: null,
    cwd: null,
    firstPrompt: null,
    firstAt: null,
    lastAt: null,
    // message id -> { model, tokens, at, stopReason }
    messages: new Map(),
    cliCost: null, // { totalUsd, byModel: { model: usd } } from the latest cost-state line
    dispatches: [], // Agent/Task tool calls: { toolUseId, agentType, description, at }
    lastAction: null, // { text, at }
    lastStopReason: null,
    lastMessageId: null,
    lastAssistantText: null,
    pendingToolUse: false,
    lastToolName: null,
    badLines: 0,
  };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { out.badLines++; continue; }
    out.sessionId ??= d.sessionId ?? null;
    out.agentId ??= d.agentId ?? null;
    out.cwd ??= d.cwd ?? null;
    if (d.timestamp) {
      out.firstAt ??= d.timestamp;
      if (!out.lastAt || d.timestamp > out.lastAt) out.lastAt = d.timestamp;
    }

    if (d.type === 'queue-operation' && d.operation === 'enqueue' && !out.firstPrompt) {
      out.firstPrompt = d.content ?? null;
    } else if (d.type === 'user' && d.message) {
      const c = d.message.content;
      if (!out.firstPrompt && !d.isMeta) out.firstPrompt = lastTextOf(c);
      if (Array.isArray(c) && c.some((x) => x?.type === 'tool_result')) out.pendingToolUse = false;
    } else if (d.type === 'cost-state' && typeof d.totalCostUSD === 'number') {
      // Cumulative for the whole session (a resumed run includes earlier runs), so keep the latest.
      const byModel = {};
      for (const [model, u] of Object.entries(d.modelUsage || {})) {
        if (typeof u?.costUSD === 'number') byModel[model] = u.costUSD;
      }
      out.cliCost = { totalUsd: d.totalCostUSD, byModel };
    } else if (d.type === 'assistant' && d.message) {
      const m = d.message;
      // A message is logged once per content block; the same id repeats. Keep the latest usage.
      const id = m.id || d.uuid;
      if (m.usage && m.model && m.model !== '<synthetic>') {
        out.messages.set(id, { model: m.model, tokens: tokensFromUsage(m.usage), at: d.timestamp ?? null });
      }
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c?.type === 'tool_use') {
          out.lastAction = { text: describeTool(c.name, c.input), at: d.timestamp ?? null };
          out.lastToolName = c.name;
          out.pendingToolUse = true;
          if (c.name === 'Agent' || c.name === 'Task') {
            out.dispatches.push({
              toolUseId: c.id,
              agentType: c.input?.subagent_type ?? null,
              description: c.input?.description ?? null,
              at: d.timestamp ?? null,
            });
          }
        } else if (c?.type === 'text' && c.text?.trim()) {
          out.lastAssistantText = c.text;
        }
      }
      // A new message resets the stop reason; repeated lines of the same message may omit it.
      if (id !== out.lastMessageId) out.lastStopReason = null;
      out.lastMessageId = id;
      if (m.stop_reason) out.lastStopReason = m.stop_reason;
    }
  }
  return out;
}

// Token totals and estimated cost per model for one parsed log.
export function usageByModel(parsed) {
  const byModel = {};
  for (const msg of parsed.messages.values()) {
    const cur = byModel[msg.model] || { tokens: { ...ZERO_TOKENS }, estimateUsd: 0 };
    cur.tokens = addTokens(cur.tokens, msg.tokens);
    cur.estimateUsd += estimateCost(msg.model, msg.tokens) ?? 0;
    byModel[msg.model] = cur;
  }
  return byModel;
}

// Is the agent behind this log working right now? There is no time limit: long runs are
// normal, so an agent counts as working until its log shows it finished.
// "finished": its last message ended its turn.
// "delegating": the conductor is waiting for a worker it sent work to.
// "running": anything else.
export function activityState(parsed) {
  if (parsed.lastStopReason === 'end_turn' && !parsed.pendingToolUse) return 'finished';
  if (parsed.pendingToolUse && (parsed.lastToolName === 'Agent' || parsed.lastToolName === 'Task')) return 'delegating';
  return 'running';
}

// A hint, never a state change: the agent asked to use a tool and has been quiet for a while.
// Often a permission prompt waiting in its terminal; sometimes just a slow command.
export const QUIET_HINT_MS = 5 * 60 * 1000;
export function quietHint(parsed, now = Date.now()) {
  if (!parsed.pendingToolUse || !parsed.lastAt) return null;
  const quietMs = now - Date.parse(parsed.lastAt);
  return quietMs >= QUIET_HINT_MS ? { quietMs, tool: parsed.lastToolName } : null;
}

// Estimated spend and tokens for messages at or after `sinceMs`.
export function spendSince(parsed, sinceMs) {
  let usd = 0;
  let tokens = 0;
  for (const msg of parsed.messages.values()) {
    if (!msg.at || Date.parse(msg.at) < sinceMs) continue;
    usd += estimateCost(msg.model, msg.tokens) ?? 0;
    const t = msg.tokens;
    tokens += t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
  }
  return { usd, tokens };
}
