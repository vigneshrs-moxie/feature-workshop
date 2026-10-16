// Turns a tool-permission request into plain words for an Approve/Deny card.
// Inputs come from Claude Code; everything here is display text, escaped by the page. The one
// exception is previewHtml: a Markdown file being written, rendered by the dashboard's sanitising
// renderer (lib/markdown.js), so the new UI can show it as a page next to its source. Only the
// card asks for it (opts.renderPreview); the audit lines that also call this don't render anything.
//
// An approval card never alters what it asks about: the path outside the project comes as its own
// field (blockedPath) for the page to show as written, and a preview cut short says so (previewCut).

import path from 'node:path';
import { renderMarkdown } from './markdown.js';

// The first n characters, then "…" when there was more.
const cut = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const longer = (s, n) => String(s ?? '').length > n;

// Instructions and settings files that steer Claude: a Markdown write to one of these starts on its
// exact source on the card, never on a formatted page that could hide what it says.
const STEERING_FILE = /^(claude|agents|skill)\.md$/i;

/**
 * Does a Markdown write start on its source? Yes for CLAUDE.md, AGENTS.md and SKILL.md, anything in
 * a .claude folder, and any file outside the job's own folder (featureDir); without a featureDir,
 * always.
 */
export function markdownStartsOnSource(file, { cwd = null, featureDir = null } = {}) {
  const abs = path.resolve(cwd ?? '/', String(file ?? ''));
  if (STEERING_FILE.test(path.basename(abs))) return true;
  if (!featureDir) return true;
  const rel = path.relative(path.resolve(featureDir), abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return true;
  return rel.split(path.sep).includes('.claude');
}

// Returns { headline, detail, preview, risk } where preview is code-like text (command, diff, …),
// plus blockedPath, previewCut (the length it was cut to), previewHtml and previewStart ('source')
// when they apply. detail is the tool's own description (AI-written; the page may format it).
export function describePermission(toolName, input = {}, opts = {}) {
  const file = input.file_path || input.notebook_path || input.path;
  const rel = (p) => (p && opts.cwd && String(p).startsWith(opts.cwd + path.sep) ? path.relative(opts.cwd, p) : p);
  let headline;
  let detail = null;
  let preview = null;
  let previewCut = null;
  let risk = 'normal';
  let previewHtml = null;
  let previewStart = null;
  const shown = (s, n) => {
    if (longer(s, n)) previewCut = n;
    return cut(s, n);
  };

  switch (toolName) {
    case 'Bash':
      headline = 'Run a command in the terminal';
      detail = input.description ? String(input.description) : null;
      preview = shown(input.command, 4000);
      if (/\b(rm\s+-rf|git\s+push|git\s+reset\s+--hard|npm\s+publish|curl|wget|sudo|chmod|drop\s+table)\b/i.test(input.command ?? '')) risk = 'high';
      break;
    case 'Edit':
      headline = `Change a file: ${rel(file)}`;
      preview = `- ${shown(input.old_string, 1500).split('\n').join('\n- ')}\n+ ${shown(input.new_string, 1500).split('\n').join('\n+ ')}`;
      if (input.replace_all) detail = 'Replaces every match in the file.';
      break;
    case 'MultiEdit':
      headline = `Make ${input.edits?.length ?? 'several'} changes to ${rel(file)}`;
      break;
    case 'Write':
      headline = `Create or overwrite a file: ${rel(file)}`;
      preview = shown(input.content, 2500);
      if (/\.(md|markdown)$/i.test(String(file ?? ''))) {
        if (opts.renderPreview) previewHtml = renderMarkdown(preview);
        if (markdownStartsOnSource(file, { cwd: opts.cwd, featureDir: opts.featureDir })) previewStart = 'source';
      }
      break;
    case 'NotebookEdit':
      headline = `Change a notebook: ${rel(file)}`;
      break;
    case 'Read':
      headline = `Read a file: ${rel(file)}`;
      break;
    case 'WebFetch':
      headline = 'Read a web page';
      preview = shown(input.url, 500);
      break;
    case 'WebSearch':
      headline = 'Search the web';
      preview = shown(input.query, 500);
      break;
    case 'Agent':
    case 'Task':
      headline = `Start a helper: ${input.subagent_type || 'general'}`;
      detail = input.description ? String(input.description) : null;
      break;
    case 'AskUserQuestion':
      headline = 'Asks you a question';
      break;
    default:
      if (String(toolName).startsWith('mcp__')) {
        const [, server, tool] = String(toolName).split('__');
        headline = `Use “${tool}” from the ${server} connection`;
      } else {
        headline = `Use the ${toolName} tool`;
      }
      preview = shown(JSON.stringify(input, null, 2), 2500);
  }
  if (opts.defaultToNo) risk = 'high';
  const out = { headline, detail, preview, risk };
  if (opts.blockedPath) out.blockedPath = String(opts.blockedPath);
  if (previewCut !== null) out.previewCut = previewCut;
  if (previewHtml !== null) out.previewHtml = previewHtml;
  if (previewStart !== null) out.previewStart = previewStart;
  return out;
}
