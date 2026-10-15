// Your "Always allow" rules: the dashboard's own list, kept in rules.json in its state folder
// (~/.feature-workshop by default). Never written to ~/.claude/settings.json, so they only apply
// to jobs the dashboard runs. policy.js checks them (matchRule) before a request comes to you.
//
// A rule is { id, tool, kind, value, label, createdAt, from? }. What each kind covers is described
// above matchRule in policy.js; validateRule() refuses anything broader than those kinds allow.
// draftRule() proposes the narrowest rule that covers one request, plus wider options you can
// pick and edit; nothing is saved until you confirm.

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { matchRule, simpleCommandWords, RULE_EDIT_TOOLS } from './policy.js';

// Commands that run whatever comes after them: a prefix rule may not start with one, because
// "sudo …" or "bash …" would cover any command at all.
const RUNS_ANYTHING = new Set(['sudo', 'su', 'doas', 'bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'eval', 'exec', 'env', 'xargs', 'command', 'builtin', 'nohup', 'time', 'timeout', 'nice', 'watch', 'ssh', 'script', 'unbuffer', 'stdbuf', 'caffeinate']);
// Interpreters: a prefix rule must name what they run ("node scripts/check.js"), not an option
// such as -e that runs code written on the spot.
const INTERPRETERS = new Set(['node', 'python', 'python3', 'ruby', 'perl', 'php', 'deno', 'bun', 'osascript', 'lua', 'Rscript']);
const KINDS = { Bash: ['exact', 'prefix'], WebFetch: ['domain'] };
const kindsFor = (tool) => KINDS[tool] ?? (RULE_EDIT_TOOLS.has(tool) ? ['exact', 'prefix'] : String(tool).startsWith('mcp__') ? ['tool'] : []);

export class RuleError extends Error {}

/** True when the dashboard can save "Always allow" rules for this tool at all. */
export const canHaveRules = (tool) => kindsFor(tool).length > 0;

/** Plain words for what a rule allows. */
export function describeRule({ tool, kind, value }) {
  if (tool === 'Bash') return kind === 'exact' ? `run exactly “${value}”` : `run any command starting with “${value}”`;
  if (RULE_EDIT_TOOLS.has(tool)) {
    const verb = tool === 'Write' ? 'create or overwrite' : 'change';
    return kind === 'exact' ? `${verb} the file ${value}` : `${verb} any file inside ${value}`;
  }
  if (tool === 'WebFetch') return `read web pages on ${value}`;
  if (String(tool).startsWith('mcp__')) {
    const [, server, name] = String(tool).split('__');
    return `use “${name}” from the ${server} connection`;
  }
  return `use ${tool}`;
}

/**
 * Check and tidy a rule someone wants saved. Throws RuleError (with a message for the person)
 * when it would cover more than its kind allows. Returns { tool, kind, value }.
 */
export function validateRule(raw) {
  const tool = typeof raw?.tool === 'string' ? raw.tool.trim() : '';
  if (!/^[A-Za-z][\w-]{0,200}$/.test(tool)) throw new RuleError('That rule names no tool.');
  const kinds = kindsFor(tool);
  if (!kinds.length) throw new RuleError(`The dashboard can’t save “Always allow” rules for ${tool}.`);
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  if (!kinds.includes(kind)) throw new RuleError('That kind of rule doesn’t fit this tool.');
  let value = typeof raw.value === 'string' ? raw.value.trim() : '';
  if (value.length > 2000) throw new RuleError('That rule is too long.');

  if (tool === 'Bash') {
    if (!value) throw new RuleError('Write the command the rule allows.');
    if (kind === 'prefix') {
      const words = simpleCommandWords(value);
      if (!words) throw new RuleError('A “starting with” rule must be one plain command: no ; && || | $( ), $variables, wildcards or redirections.');
      if (words.length < 2) throw new RuleError(`“${value}” alone would allow every ${words[0]} command. Add at least one more word, such as “${words[0]} test”.`);
      if (RUNS_ANYTHING.has(words[0])) throw new RuleError(`${words[0]} runs other commands, so a rule starting with it could allow anything. Allow the exact command instead.`);
      if (INTERPRETERS.has(words[0]) && words[1].startsWith('-')) throw new RuleError(`“${words[0]} ${words[1]}” can run any code. Name the script it runs, or allow the exact command.`);
    }
  } else if (RULE_EDIT_TOOLS.has(tool)) {
    if (!path.isAbsolute(value)) throw new RuleError('Give the full path, starting with /.');
    value = path.resolve(value);
    if (kind === 'prefix') {
      const tooWide = [path.parse(value).root, os.homedir(), path.dirname(os.homedir())].map((p) => path.resolve(p));
      if (tooWide.includes(value)) throw new RuleError(`${value} is too wide a folder to allow every change in. Pick the project or a folder inside it.`);
      if (value.split(path.sep).filter(Boolean).length < 2) throw new RuleError(`${value} is too wide a folder to allow every change in.`);
    }
  } else if (tool === 'WebFetch') {
    value = value.toLowerCase();
    if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(value)) throw new RuleError('Write one host name, such as docs.example.com.');
  } else {
    value = '';
  }
  return { tool, kind, value };
}

/**
 * The narrowest rule covering this one request, and wider ones you could pick instead.
 * suggestions: Claude Code's own (PermissionUpdate[]): its "toolName(ruleContent)" ideas, where a
 * Bash ruleContent ending in ":*" means "starting with". They are only used to offer a wider
 * option; the first option is always the narrowest.
 * Returns { tool, options: [{ kind, value, label }] } (first = narrowest), or null when no rule
 * can be saved for this request.
 */
export function draftRule(toolName, input = {}, suggestions = []) {
  if (!canHaveRules(toolName)) return null;
  const options = [];
  const add = (kind, value) => {
    let v;
    try { v = validateRule({ tool: toolName, kind, value }); } catch { return; }
    if (!matchRule(v, toolName, input)) return; // must cover this very request
    if (options.some((o) => o.kind === v.kind && o.value === v.value)) return;
    options.push({ ...v, label: describeRule(v) });
  };

  if (toolName === 'Bash') {
    const cmd = String(input.command ?? '').trim();
    if (!cmd) return null;
    add('exact', cmd);
    const words = simpleCommandWords(cmd);
    if (words) {
      // Claude Code's own "starting with" idea, when it covers this command.
      for (const s of Array.isArray(suggestions) ? suggestions : []) {
        for (const r of s?.type === 'addRules' && s.behavior !== 'deny' ? s.rules ?? [] : []) {
          if (r?.toolName === 'Bash' && typeof r.ruleContent === 'string' && r.ruleContent.endsWith(':*')) add('prefix', r.ruleContent.slice(0, -2).trim());
        }
      }
      // The command's name and sub-commands, up to its first option, path or value.
      const lead = [];
      for (const w of words) {
        if (lead.length >= 3 || w.startsWith('-') || /[/=.~@]/.test(w)) break;
        lead.push(w);
      }
      if (lead.length >= 2) add('prefix', lead.join(' '));
    }
  } else if (RULE_EDIT_TOOLS.has(toolName)) {
    const file = input.file_path ?? input.notebook_path;
    if (typeof file !== 'string' || !path.isAbsolute(file)) return null;
    add('exact', file);
    add('prefix', path.dirname(path.resolve(file)));
  } else if (toolName === 'WebFetch') {
    try { add('domain', new URL(String(input.url ?? '')).hostname); } catch { return null; }
  } else {
    add('tool', '');
  }
  return options.length ? { tool: toolName, options } : null;
}

/** rules.json in the dashboard's state folder. Emits 'change' after every save. */
export class RuleStore extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.file = path.join(dir, 'rules.json');
    this.rules = null;
    this.broken = false;
  }

  async list() {
    if (!this.rules) {
      try {
        const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
        this.rules = (Array.isArray(data?.rules) ? data.rules : []).flatMap((r) => {
          // A hand-edited entry that isn't a valid rule is ignored (it allows nothing).
          if (typeof r?.id !== 'string' || !r.id) return [];
          try {
            const v = validateRule(r);
            return [{ id: r.id, ...v, label: describeRule(v), createdAt: typeof r.createdAt === 'string' ? r.createdAt : null, ...(r.from && typeof r.from === 'object' ? { from: r.from } : {}) }];
          } catch { return []; }
        });
        this.broken = false;
      } catch (err) {
        this.rules = [];
        this.broken = err?.code !== 'ENOENT';
      }
    }
    return this.rules;
  }

  async #save() {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, rules: this.rules.map(({ label, ...r }) => r) }, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
    this.emit('change', this.rules);
  }

  /** Save a rule (validated). from: { slug, title, headline } of the request it came from. Same rule twice → the existing one. */
  async add(raw, { from = null } = {}) {
    const v = validateRule(raw);
    if (this.broken) this.rules = null; // read it again: it may have been fixed meanwhile
    const rules = await this.list();
    if (this.broken) throw new RuleError(`${this.file} can’t be read, so nothing was saved. Fix or remove that file, then try again.`);
    const same = rules.find((r) => r.tool === v.tool && r.kind === v.kind && r.value === v.value);
    if (same) return { rule: same, added: false };
    const rule = { id: randomUUID(), ...v, label: describeRule(v), createdAt: new Date().toISOString(), ...(from ? { from } : {}) };
    this.rules = [...rules, rule];
    await this.#save();
    return { rule, added: true };
  }

  /** Remove a rule by id; returns it, or null when there was none. */
  async remove(id) {
    const rules = await this.list();
    const rule = rules.find((r) => r.id === id) ?? null;
    if (!rule) return null;
    this.rules = rules.filter((r) => r.id !== id);
    await this.#save();
    return rule;
  }
}
