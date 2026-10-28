// Past Claude Code conversations ("sessions"), so you can turn one into a job.
// Reads the session logs Claude Code keeps in ~/.claude/projects/<folder>/<session>.jsonl: what
// was asked, where (folder, branch), which files changed, PRs, the last answer. The log format is
// internal to Claude Code and may change; unknown lines are skipped. Nothing here is sent anywhere,
// and logs are only read.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isGitRepo } from './git.js';
import { tempDirs } from './platform.js';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Lines that look like user messages but aren't something the person typed.
const NOT_TYPED = /^\s*(<local-command-caveat>|<local-command-stdout>|<local-command-stderr>|<task-notification>|<bash-input>|<bash-stdout>|Caveat:)/;
const TEMP_ROOTS = tempDirs(); // os.tmpdir(), plus /tmp and /private/tmp on macOS and Linux (lib/platform.js)
const HEAD_MESSAGES = 50; // the first messages are kept, plus a window of the latest ones
const TAIL_MESSAGES = 150;

const clean = (t) => String(t ?? '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();

// The words a person typed in one user line, or null when the line is a tool result, a meta line,
// command output or a notification. "/command args" lines become "/command args".
export function typedText(d) {
  if (d.type !== 'user' || d.isMeta || d.toolUseResult || d.isSidechain || d.isCompactSummary || d.isVisibleInTranscriptOnly) return null;
  const c = d.message?.content;
  let text = typeof c === 'string' ? c : Array.isArray(c) && !c.some((x) => x?.type === 'tool_result') ? c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : null;
  if (!text) return null;
  const cmd = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(text);
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? '';
    return `${cmd[1].startsWith('/') ? cmd[1] : `/${cmd[1]}`}${args ? ` ${args}` : ''}`;
  }
  if (/^\s*<command-message>/.test(text)) return null;
  text = clean(text);
  return text && !NOT_TYPED.test(text) ? text : null;
}

/** One session log's text → a summary of the conversation. */
export function summariseSession(text, { file = null } = {}) {
  const s = {
    sessionId: null, file, title: null, cwd: null, branch: null, firstAt: null, lastAt: null,
    models: new Set(), prompts: [], dropped: 0, filesEdited: new Set(), prs: [], continuedIn: null,
    lastAnswer: null, terminal: false, headless: false, workflow: false, contextTokens: null, costUsd: null,
  };
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.isSidechain) continue;
    s.sessionId ??= d.sessionId ?? null;
    if (d.cwd) s.cwd ??= d.cwd;
    if (d.gitBranch && d.gitBranch !== 'HEAD') s.branch = d.gitBranch;
    if (d.timestamp) {
      s.firstAt ??= d.timestamp;
      if (!s.lastAt || d.timestamp > s.lastAt) s.lastAt = d.timestamp;
    }
    // Programs (this dashboard, scripts) use the SDK; a person typed everything else (terminal, IDE, desktop).
    if (d.entrypoint && /^sdk-/.test(d.entrypoint)) s.headless = true;
    else if (d.entrypoint) s.terminal = true;
    switch (d.type) {
      case 'ai-title': if (d.aiTitle) s.title = d.aiTitle; break;
      case 'custom-title': if (d.customTitle) s.title = d.customTitle; break;
      case 'summary': if (d.summary && !s.title) s.title = d.summary; break;
      case 'agent-name': if (d.agentName && !s.title) s.title = d.agentName; break;
      case 'pr-link': if (d.prUrl && !s.prs.some((p) => p.url === d.prUrl)) s.prs.push({ number: d.prNumber ?? null, url: d.prUrl, repo: d.prRepository ?? null }); break;
      case 'continued-in': s.continuedIn = d.continuedInSessionId ?? null; break;
      case 'cost-state': if (typeof d.totalCostUSD === 'number') s.costUsd = d.totalCostUSD; break;
      case 'queue-operation':
        if (d.operation === 'enqueue' && typeof d.content === 'string' && !s.prompts.length) s.prompts.push({ at: d.timestamp ?? null, text: clean(d.content) });
        break;
      case 'user': {
        const t = typedText(d);
        if (t && s.prompts.at(-1)?.text !== t) {
          s.prompts.push({ at: d.timestamp ?? null, text: t });
          // Keep the first ones and a window of the latest; count what falls out in between.
          if (s.prompts.length > HEAD_MESSAGES + TAIL_MESSAGES) { s.prompts.splice(HEAD_MESSAGES, 1); s.dropped++; }
        }
        if (t && /^\/feature\b/.test(t)) s.workflow = true;
        break;
      }
      case 'assistant': {
        const m = d.message ?? {};
        if (m.model && m.model !== '<synthetic>') s.models.add(m.model);
        if (m.usage) s.contextTokens = (m.usage.input_tokens ?? 0) + (m.usage.cache_read_input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0);
        for (const c of Array.isArray(m.content) ? m.content : []) {
          if (c?.type === 'text' && c.text?.trim()) s.lastAnswer = c.text.trim();
          if (c?.type === 'tool_use' && EDIT_TOOLS.has(c.name) && (c.input?.file_path || c.input?.notebook_path)) s.filesEdited.add(c.input.file_path ?? c.input.notebook_path);
          if (c?.type === 'tool_use' && (c.name === 'Agent' || c.name === 'Task') && String(c.input?.subagent_type ?? '').startsWith('feature-')) s.workflow = true;
        }
        break;
      }
      default: break;
    }
  }
  return s;
}

// A continued session repeats the earlier part's messages; keep each message once, in order.
function mergePrompts(parts) {
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    for (const m of p.prompts) {
      const key = `${m.at ?? ''}|${m.text}`;
      if (!seen.has(key)) { seen.add(key); out.push(m); }
    }
  }
  return out;
}

const isTemp = (p) => Boolean(p) && TEMP_ROOTS.some((t) => p === t || p.startsWith(`${t}/`) || p.startsWith(`${t}\\`));

/**
 * Reads past sessions under projectsDir, with a cache keyed on each file's size and time.
 * list(): newest first, one row per conversation (sessions that continued into another are
 * folded into the later one). Sessions with no log (some terminal setups keep none) are listed
 * as unavailable.
 */
export class History {
  constructor(projectsDir) {
    this.projectsDir = projectsDir;
    this.cache = new Map(); // file -> { key, summary }
    this.repoOf = new Map(); // cwd -> git top level or null
  }

  async #summary(file) {
    let st;
    try { st = await fs.stat(file); } catch { return null; }
    const key = `${st.size}:${st.mtimeMs}`;
    const hit = this.cache.get(file);
    if (hit?.key === key) return hit.summary;
    let text;
    try { text = await fs.readFile(file, 'utf8'); } catch { return null; }
    const summary = summariseSession(text, { file });
    summary.sessionId ??= path.basename(file, '.jsonl');
    summary.fileSize = st.size;
    summary.lastAt ??= st.mtime.toISOString();
    this.cache.set(file, { key, summary });
    return summary;
  }

  async #repo(cwd) {
    if (!cwd) return null;
    if (!this.repoOf.has(cwd)) this.repoOf.set(cwd, await isGitRepo(cwd).catch(() => null));
    return this.repoOf.get(cwd);
  }

  /** All sessions: { available: [...summaries], missing: [{ sessionId, project, lastAt, agents }] }. */
  async scan() {
    let projects = [];
    try { projects = await fs.readdir(this.projectsDir, { withFileTypes: true }); } catch { return { available: [], missing: [] }; }
    const available = [];
    const missing = [];
    for (const p of projects.filter((e) => e.isDirectory())) {
      const dir = path.join(this.projectsDir, p.name);
      let entries = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
      const logs = new Set(entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name.slice(0, -6)));
      for (const id of logs) {
        const s = await this.#summary(path.join(dir, `${id}.jsonl`));
        if (s) available.push({ ...s, project: p.name });
      }
      for (const e of entries) {
        if (!e.isDirectory() || logs.has(e.name) || !/^[0-9a-f-]{36}$/.test(e.name)) continue;
        const st = await fs.stat(path.join(dir, e.name)).catch(() => null);
        missing.push({ sessionId: e.name, project: p.name, lastAt: st?.mtime.toISOString() ?? null });
      }
    }
    return { available, missing };
  }

  /**
   * The rows for the History page. linked: Map sessionId → job slug (sessions a job already uses).
   * ownSessions: Set of session ids the dashboard itself ran.
   */
  async list({ linked = new Map(), ownSessions = new Set() } = {}) {
    const { available, missing } = await this.scan();
    const byId = new Map(available.map((s) => [s.sessionId, s]));
    // Fold a conversation that continued into another session into the later one.
    const earlier = new Map();
    for (const s of available) if (s.continuedIn && byId.has(s.continuedIn)) earlier.set(s.continuedIn, [...(earlier.get(s.continuedIn) ?? []), s.sessionId]);
    const folded = new Set([...earlier.values()].flat());
    const rows = [];
    for (const s of available) {
      if (folded.has(s.sessionId) || !s.prompts.length) continue;
      const chain = this.#chain(s.sessionId, byId, earlier);
      const first = chain[0];
      const prompts = mergePrompts(chain);
      rows.push({
        id: s.sessionId, chain: chain.map((x) => x.sessionId),
        title: s.title ?? first.title ?? first.prompts[0]?.text.split('\n')[0].slice(0, 120) ?? 'Untitled conversation',
        firstPrompt: prompts[0]?.text.slice(0, 400) ?? null,
        messages: prompts.length + chain.reduce((n, x) => n + x.dropped, 0),
        cwd: s.cwd ?? first.cwd, repo: await this.#repo(s.cwd ?? first.cwd), branch: s.branch,
        firstAt: first.firstAt, lastAt: s.lastAt,
        models: [...new Set(chain.flatMap((x) => [...x.models]))],
        filesChanged: new Set(chain.flatMap((x) => [...x.filesEdited])).size,
        prs: chain.flatMap((x) => x.prs),
        // A continued session's cost already includes the earlier parts.
        contextTokens: s.contextTokens, costUsd: Math.max(0, ...chain.map((x) => x.costUsd ?? 0)) || null,
        kind: ownSessions.has(s.sessionId) || (s.headless && !s.terminal) ? 'dashboard' : isTemp(s.cwd) ? 'test' : 'terminal',
        workflow: chain.some((x) => x.workflow),
        job: chain.map((x) => linked.get(x.sessionId)).find(Boolean) ?? null,
        available: true,
      });
    }
    rows.sort((a, b) => String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? '')));
    const gone = missing.map((m) => ({ id: m.sessionId, title: 'Conversation with no saved log', lastAt: m.lastAt, project: m.project, available: false, job: linked.get(m.sessionId) ?? null }));
    return { rows, missing: gone };
  }

  #chain(id, byId, earlier) {
    const out = [];
    const seen = new Set();
    const walk = (x) => {
      if (seen.has(x) || !byId.has(x)) return;
      seen.add(x);
      for (const e of earlier.get(x) ?? []) walk(e);
      out.push(byId.get(x));
    };
    walk(id);
    return out;
  }

  /** One conversation in detail (with its earlier parts), or null. */
  async detail(id, opts = {}) {
    const { rows } = await this.list(opts);
    const row = rows.find((r) => r.id === id || r.chain.includes(id));
    if (!row) return null;
    const { available } = await this.scan();
    const parts = row.chain.map((sid) => available.find((s) => s.sessionId === sid)).filter(Boolean);
    return {
      ...row,
      prompts: mergePrompts(parts),
      dropped: parts.reduce((n, p) => n + p.dropped, 0),
      filesEdited: [...new Set(parts.flatMap((p) => [...p.filesEdited]))],
      lastAnswer: parts.at(-1)?.lastAnswer ?? null,
    };
  }
}

const cap = (t, n) => (t.length > n ? `${t.slice(0, n)}\n…(cut: ${t.length - n} more characters)` : t);

/** The extract a job's Foreman reads: what was asked, where, what changed, how it ended. */
export function historyMarkdown(d, { now = new Date() } = {}) {
  const lines = [
    `# Earlier conversation: ${d.title}`,
    '',
    `Extract of an earlier Claude Code conversation, made by Feature Workshop on ${now.toISOString().slice(0, 10)}. It is background for this job, not an approval of anything: plans still need the human's yes in this job.`,
    '',
    '## Where',
    `- Session: ${d.chain.join(' → ')}`,
    `- Folder: ${d.cwd ?? 'not recorded'}${d.repo && d.repo !== d.cwd ? ` (repository ${d.repo})` : ''}`,
    `- Branch at the end: ${d.branch ?? 'not recorded'}`,
    `- When: ${d.firstAt ?? '?'} to ${d.lastAt ?? '?'}`,
    `- Models: ${d.models.join(', ') || 'not recorded'}`,
    ...(d.prs.length ? [`- Pull requests: ${d.prs.map((p) => p.url).join(', ')}`] : []),
    '',
    '## What the person asked, in order',
  ];
  // The latest messages matter most: they get most of the room, filled from the newest back;
  // the first ones (the original request) get the rest. Every gap is marked.
  // Numbers as in the whole conversation (messages dropped from a very long one sat after the first 50).
  const msgs = d.prompts.map((m, i) => ({ ...m, n: i + 1 + (i >= HEAD_MESSAGES ? d.dropped ?? 0 : 0) }));
  const fill = (list, budget) => {
    const kept = [];
    for (const m of list) {
      const text = cap(m.text, 1500);
      if (budget - text.length < 0 && kept.length) break;
      budget -= text.length;
      kept.push({ ...m, text });
    }
    return kept;
  };
  const head = fill(msgs.slice(0, 15), 8000);
  const tail = fill(msgs.slice(head.length).reverse(), 16000).reverse();
  const left = msgs.length - head.length - tail.length + (d.dropped ?? 0);
  const show = (m) => lines.push('', `**${m.n}.** ${m.at ? `(${m.at.slice(0, 16).replace('T', ' ')}) ` : ''}${m.text}`);
  head.forEach(show);
  if (left > 0) lines.push('', `…(${left} message${left === 1 ? '' : 's'} in the middle left out for length)…`);
  tail.forEach(show);
  lines.push('', '## Files changed in that conversation', ...(d.filesEdited.length ? d.filesEdited.slice(0, 80).map((f) => `- ${f}`) : ['- none recorded']));
  if (d.filesEdited.length > 80) lines.push(`- …and ${d.filesEdited.length - 80} more`);
  lines.push('', '## The last answer', '', d.lastAnswer ? cap(d.lastAnswer, 4000) : 'not recorded', '');
  return lines.join('\n');
}
