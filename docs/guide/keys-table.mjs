// Prints the Markdown key tables for docs/guide/keys.md from web/src/app/keyRegistry.ts, so the
// guide's keys come from the code, not from memory. Run from the repository's root:
//   node docs/guide/keys-table.mjs > /tmp/keys.md
// then paste the output between the GENERATED lines of keys.md.
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../../web/src/app/keyRegistry.ts', import.meta.url), 'utf8');
const block = (start, end) => {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`keyRegistry.ts changed: ${start} not found`);
  return src.slice(from + start.length - 1, to + 2);
};
// Both blocks are plain object literals: read them as such.
const KEYS = Function(`return (${block('export const KEYS = {', '\n} as const')})`)();
const SCOPES = Function(`return (${block('export const SCOPES: Record<KeyScope, { title: string; where: string }> = {', '\n};')})`)();

const WORDS = { ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', ' ': 'Space' };
const label = (k) => (k === ' ' ? 'Space' : k.startsWith('Mod+') ? `⌘${k.slice(4) === 'Enter' ? '↵' : k.slice(4)} (Ctrl+${k.slice(4)})` : k.split(' ').map((x) => WORDS[x] ?? x).join(' then '));
const cell = (s) => String(s).replace(/\|/g, '\\|');

// The order a new person meets them in.
const ORDER = ['global', 'rows', 'jobs', 'jobpage', 'job', 'gate', 'alert', 'desk', 'review', 'stack', 'inbox', 'map', 'table', 'floor', 'settings', 'sheet'];
const out = [];
for (const scope of ORDER) {
  const rows = Object.values(KEYS).filter((d) => d.scope === scope && !d.hidden);
  if (!rows.length) continue;
  out.push(`### ${SCOPES[scope].title}`, '', SCOPES[scope].where, '', '| Key | What it does | Where |', '|---|---|---|');
  for (const d of rows) out.push(`| ${d.keys.map((k) => `\`${cell(label(k))}\``).join(' or ')} | ${cell(d.label)} | ${cell(d.where ?? '')} |`);
  out.push('');
}
process.stdout.write(out.join('\n'));
