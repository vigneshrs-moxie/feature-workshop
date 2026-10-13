#!/usr/bin/env node
// Feature Workshop "live link": records Claude Code hook events for the local dashboard.
// Claude Code passes each event as JSON on stdin. This keeps only what the dashboard shows
// (session, folder, event, tool name, file path, a shortened command or prompt), drops file
// contents and edits, appends one line to ~/.feature-workshop/hook-events/events.jsonl, and exits.
// It never blocks, never changes what Claude Code does, and always exits successfully.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cut = (s, n) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : undefined);
try {
  const e = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const ti = e.tool_input && typeof e.tool_input === 'object' ? e.tool_input : {};
  const keep = {
    session_id: e.session_id, transcript_path: e.transcript_path, cwd: e.cwd, hook_event_name: e.hook_event_name,
    prompt: cut(e.prompt, 600), message: cut(e.message, 300), notification_type: e.notification_type,
    source: e.source, reason: e.reason, agent_type: e.agent_type, tool_name: e.tool_name,
    tool_input: e.tool_name ? {
      file_path: ti.file_path, command: cut(ti.command, 300), description: cut(ti.description, 200),
      subagent_type: ti.subagent_type, pattern: cut(ti.pattern, 120), url: cut(ti.url, 200),
    } : undefined,
  };
  const dir = path.join(process.env.WORKSHOP_STATE_DIR || path.join(os.homedir(), '.feature-workshop'), 'hook-events');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.appendFileSync(path.join(dir, 'events.jsonl'), `${new Date().toISOString()}\t${JSON.stringify(keep)}\n`, { mode: 0o600 });
} catch { /* never disturb the session */ }
process.exit(0);
