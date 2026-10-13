// Reads the "live link" events written by hooks/record.mjs (only present if the person turned it on).
// Gives the dashboard each terminal session's folder, latest prompt, current tool, whether it is
// waiting for a permission click, and when it stopped — even when the session keeps no log file.

import fs from 'node:fs/promises';
import path from 'node:path';

// Each line is "<ISO time><TAB><event JSON>", as written by hooks/record.mjs.
export function parseEvents(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    const at = tab > 0 && /^\d{4}-\d\d-\d\dT/.test(line) ? line.slice(0, tab) : null;
    try { out.push({ ...JSON.parse(at ? line.slice(tab + 1) : line), _at: at }); } catch { /* skip a broken line */ }
  }
  return out;
}

const short = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// Fold events into one summary per session.
export function summariseSessions(events, { now = Date.now() } = {}) {
  const sessions = new Map();
  for (const e of events) {
    const id = e.session_id;
    if (!id) continue;
    const s = sessions.get(id) ?? { sessionId: id, cwd: null, transcriptPath: null, firstAt: null, lastAt: null, lastPrompt: null, lastTool: null, waitingForPermission: false, waitingMessage: null, stopped: false, ended: false, mentions: new Set() };
    const at = e._at ?? e.timestamp ?? null;
    s.cwd = e.cwd ?? s.cwd;
    s.transcriptPath = e.transcript_path ?? s.transcriptPath;
    if (at) { s.firstAt ??= at; s.lastAt = at; }
    const ev = e.hook_event_name;
    if (ev === 'UserPromptSubmit') { s.lastPrompt = short(e.prompt, 400); s.stopped = false; s.waitingForPermission = false; }
    if (ev === 'PreToolUse') { s.lastTool = { name: e.tool_name, input: e.tool_input }; s.stopped = false; s.waitingForPermission = false; }
    if (ev === 'PostToolUse') s.waitingForPermission = false;
    if (ev === 'PermissionRequest' || (ev === 'Notification' && /permission/i.test(e.message ?? e.notification_type ?? ''))) { s.waitingForPermission = true; s.waitingMessage = short(e.message ?? e.tool_name ?? 'Waiting for a permission click', 200); }
    if (ev === 'Stop' || ev === 'StopFailure') { s.stopped = true; s.waitingForPermission = false; }
    if (ev === 'SessionEnd') s.ended = true;
    if (ev === 'SessionStart') { s.ended = false; s.stopped = false; }
    // Remember which job folders a session touched, to link it to jobs.
    const blob = JSON.stringify(e.tool_input ?? '') + (e.prompt ?? '');
    for (const m of blob.matchAll(/feature-work\/([\w.-]+)/g)) s.mentions.add(m[1]);
    sessions.set(id, s);
  }
  return [...sessions.values()].map((s) => ({ ...s, mentions: [...s.mentions] }));
}

export async function readHookSessions(stateDir) {
  const file = path.join(stateDir, 'hook-events', 'events.jsonl');
  let text;
  try {
    const st = await fs.stat(file);
    // Only the recent part matters; read at most the last 4 MB.
    const fh = await fs.open(file, 'r');
    const size = Math.min(st.size, 4 * 1024 * 1024);
    const buf = Buffer.alloc(size);
    await fh.read(buf, 0, size, st.size - size);
    await fh.close();
    text = buf.toString('utf8');
    if (size < st.size) text = text.slice(text.indexOf('\n') + 1);
  } catch {
    return { enabled: false, sessions: [] };
  }
  return { enabled: true, sessions: summariseSessions(parseEvents(text)) };
}
