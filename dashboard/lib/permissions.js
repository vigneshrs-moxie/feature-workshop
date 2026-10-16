// Turns a tool-permission request into plain words for an Approve/Deny card.
// Inputs come from Claude Code; everything here is display text, escaped by the page. The one
// exception is previewHtml: a Markdown file being written, rendered by the dashboard's sanitising
// renderer (lib/markdown.js), so the new UI can show it as a page next to its source.

import path from 'node:path';
import { renderMarkdown } from './markdown.js';

const cut = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// Returns { headline, detail, preview, risk } where preview is code-like text (command, diff, …).
export function describePermission(toolName, input = {}, opts = {}) {
  const file = input.file_path || input.notebook_path || input.path;
  const rel = (p) => (p && opts.cwd && String(p).startsWith(opts.cwd + path.sep) ? path.relative(opts.cwd, p) : p);
  let headline;
  let detail = null;
  let preview = null;
  let risk = 'normal';
  let previewHtml = null;

  switch (toolName) {
    case 'Bash':
      headline = 'Run a command in the terminal';
      detail = input.description ? String(input.description) : null;
      preview = cut(input.command, 4000);
      if (/\b(rm\s+-rf|git\s+push|git\s+reset\s+--hard|npm\s+publish|curl|wget|sudo|chmod|drop\s+table)\b/i.test(input.command ?? '')) risk = 'high';
      break;
    case 'Edit':
      headline = `Change a file: ${rel(file)}`;
      preview = `- ${cut(input.old_string, 1500).split('\n').join('\n- ')}\n+ ${cut(input.new_string, 1500).split('\n').join('\n+ ')}`;
      if (input.replace_all) detail = 'Replaces every match in the file.';
      break;
    case 'MultiEdit':
      headline = `Make ${input.edits?.length ?? 'several'} changes to ${rel(file)}`;
      break;
    case 'Write':
      headline = `Create or overwrite a file: ${rel(file)}`;
      preview = cut(input.content, 2500);
      if (/\.(md|markdown)$/i.test(String(file ?? ''))) previewHtml = renderMarkdown(preview);
      break;
    case 'NotebookEdit':
      headline = `Change a notebook: ${rel(file)}`;
      break;
    case 'Read':
      headline = `Read a file: ${rel(file)}`;
      break;
    case 'WebFetch':
      headline = 'Read a web page';
      preview = cut(input.url, 500);
      break;
    case 'WebSearch':
      headline = 'Search the web';
      preview = cut(input.query, 500);
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
      preview = cut(JSON.stringify(input, null, 2), 2500);
  }
  if (opts.blockedPath) detail = [detail, `It touches a folder outside the project: ${opts.blockedPath}`].filter(Boolean).join(' ');
  if (opts.defaultToNo) risk = 'high';
  return previewHtml === null ? { headline, detail, preview, risk } : { headline, detail, preview, previewHtml, risk };
}
