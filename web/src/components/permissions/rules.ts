// Plain words for "Always allow" rules, matching dashboard/lib/rules.js (describeRule). The
// dashboard decides what a rule really covers (matchRule in lib/policy.js) and refuses anything
// broader than its kind allows; the checks here only spare you a refused save.
import type { RuleKind } from '../../api/types';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export function describeRule(tool: string, kind: RuleKind, value: string): string {
  if (tool === 'Bash') return kind === 'exact' ? `run exactly “${value}”` : `run any command starting with “${value}”`;
  if (EDIT_TOOLS.has(tool)) {
    const verb = tool === 'Write' ? 'create or overwrite' : 'change';
    return kind === 'exact' ? `${verb} the file ${value}` : `${verb} any file inside ${value}`;
  }
  if (tool === 'WebFetch') return `read web pages on ${value}`;
  if (tool.startsWith('mcp__')) {
    const [, server, name] = tool.split('__');
    return `use “${name}” from the ${server} connection`;
  }
  return `use ${tool}`;
}

/** The radio label for one kind of rule. */
export function kindLabel(tool: string, kind: RuleKind): string {
  if (tool === 'Bash') return kind === 'exact' ? 'Exactly this command' : 'Any command starting with…';
  if (EDIT_TOOLS.has(tool)) return kind === 'exact' ? 'Only this file' : 'Any file inside this folder…';
  if (kind === 'domain') return 'Pages on this site';
  return 'This connection tool';
}

/** Can you edit the value for this kind? Only the wider kinds; "exact" must stay the request itself. */
export const editable = (tool: string, kind: RuleKind) => kind === 'prefix' && (tool === 'Bash' || EDIT_TOOLS.has(tool));

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/**
 * A quick check that an edited value still covers the request: null when it seems fine, else why
 * not. The dashboard checks again properly before it saves anything.
 */
export function coverProblem(tool: string, kind: RuleKind, value: string, input: Record<string, unknown> | undefined): string | null {
  const v = value.trim();
  if (!v) return tool === 'Bash' ? 'Write the start of the command.' : 'Write the folder.';
  if (tool === 'Bash' && kind === 'prefix') {
    const want = words(v);
    const got = words(String(input?.command ?? ''));
    if (want.length < 2) return 'Use at least two words, so the rule can’t allow every command of that kind.';
    if (want.some((w, i) => got[i] !== w)) return 'The command waiting now doesn’t start with this, so the rule wouldn’t cover it.';
    return null;
  }
  if (EDIT_TOOLS.has(tool) && kind === 'prefix') {
    const file = String(input?.file_path ?? input?.notebook_path ?? '');
    const dir = v.replace(/\/+$/, '');
    if (!dir.startsWith('/')) return 'Give the full path, starting with /.';
    if (!file.startsWith(`${dir}/`)) return 'The file waiting now isn’t inside this folder, so the rule wouldn’t cover it.';
    return null;
  }
  return null;
}

/** "run exactly …" → "Run exactly …". */
export const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
