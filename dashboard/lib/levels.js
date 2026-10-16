// Suggesting a level (L0–L3) for a job without asking a model: scan the description, and once a
// worktree exists the paths `git diff --stat` reports, for risk triggers. A trigger sets a floor
// the suggestion never goes under; with none, size words in the description decide. The Foreman's
// own suggestion (status.json `suggested_level`) arrives with its first brief; the page shows both.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Risk triggers and the lowest level each allows.
 * KEEP IN STEP with the /feature skill's level-floor rule (job-options.md, "Levels" in
 * claude-feature-workflow): same triggers, same floors. Change one, change the other.
 *   text: matched against the job's description. path: matched against each changed file path.
 */
export const RISK_TRIGGERS = [
  {
    id: 'migrations', label: 'database migrations', floor: 3,
    text: /\bmigrat(e|es|ed|ing|ion|ions)\b|\bschema change|\balter table\b|\b(add|new|drop|rename) (a |the )?(db |database )?(table|column)s?\b/i,
    path: /(^|\/)(migrations?|migrate)\/|migration/i,
  },
  {
    id: 'auth', label: 'sign-in, roles or permissions', floor: 3,
    text: /\bauth(entication|entication's|orization|orisation|z|n)?\b|\bsign[- ]?(in|on|up)s?\b|\blog[- ]?ins?\b|\b(sso|oauth|rbac)\b|\broles?\b|\bpermissions?\b|\baccess control\b/i,
    path: /(^|\/)[^/]*(auth(?!or)|signin|sign-in|login|permission|roles?\b|rbac)[^/]*(\/|$)/i,
  },
  {
    id: 'scope', label: 'data scoping (getScope, scopeWhere)', floor: 3,
    text: /\bgetScope\b|\bscopeWhere\b|\b(data|row|record|office|branch|user|access)[- ]scop(e|es|ed|ing)\b|\bscop(ed|ing) (to|by)\b/i,
    path: /scope/i,
  },
  {
    id: 'office-visibility', label: 'office visibility (entity_branches)', floor: 2,
    text: /\bentity_branches\b|\boffice (visibility|access)\b|\bwhich offices?\b|\bbranch(es)? visibility\b/i,
    path: /entity[_-]?branches/i,
  },
  {
    id: 'people', label: 'people or profile queries', floor: 2,
    text: /\bpeople\b|\bprofiles?\b|\bpersons?\b|\buser (list|lookup|search|query|queries|records?|details)\b/i,
    path: /(^|\/)[^/]*(people|person|profile)[^/]*(\/|$)/i,
  },
  {
    id: 'email', label: 'sending email or notifications', floor: 2,
    text: /\be-?mails?\b|\bnotifications?\b|\bnotify\b|\bsms\b|\btext messages?\b/i,
    path: /(^|\/)[^/]*(e-?mail|mailer|notif)[^/]*(\/|$)/i,
  },
  {
    id: 'shared-config', label: 'shared config', floor: 2,
    text: /\bshared config\b|\bconfig(uration)? files?\b|\benv(ironment)? var(iable)?s?\b|\.env\b|\bfeature flags?\b|\bsettings file\b/i,
    path: /(^|\/)(\.env[^/]*|config\/[^/]+|[^/]+\.config\.(js|cjs|mjs|ts|json)|package\.json|tsconfig[^/]*\.json)$/i,
  },
];

// Size words: a change this small is a tweak (L0) when the description is short.
const TWEAK_WORDS = /\b(typos?|spelling|wording|rename[ds]?|renaming|colou?rs?|tweaks?|padding|margins?|spacing|font( size)?|copy (change|edit|fix|tweak|update)s?|(change|fix|update) the (copy|text|label)|button (text|label))\b/i;
// Words that say it is more than one small change.
const BIG_WORDS = /\b(refactor\w*|redesign\w*|rewrite|overhaul|new (page|screen|feature|report|workflow|module|service)|integrat\w+|across|every (page|screen)|end[- ]to[- ]end|import|export)\b/i;
// Joins that usually mean several changes in one description.
const SEVERAL = /\band (also )?(add|change|make|update|fix|remove|show|let)\b|;|\balso\b|\bplus\b|\bthen\b/i;

const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/**
 * Suggest a level from the description and, when there is one, the list of changed paths.
 * Returns { level, floor, reasons, triggers }: floor 0 means no risk trigger fired; reasons are
 * plain sentences for the page; triggers the ids of RISK_TRIGGERS that fired.
 */
export function suggestLevel({ description = '', paths = [] } = {}) {
  const text = String(description ?? '');
  const files = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p);
  const reasons = [];
  const triggers = [];
  let floor = 0;
  for (const t of RISK_TRIGGERS) {
    const said = t.text.test(text);
    const touched = files.filter((p) => t.path.test(p));
    if (!said && !touched.length) continue;
    triggers.push(t.id);
    floor = Math.max(floor, t.floor);
    const where = [said ? 'the description mentions it' : null, touched.length ? `changes ${touched.slice(0, 3).join(', ')}${touched.length > 3 ? ` and ${touched.length - 3} more` : ''}` : null].filter(Boolean).join('; ');
    reasons.push(`Touches ${t.label} (${where}), so at least L${t.floor}.`);
  }

  const words = wordCount(text);
  let size;
  if (BIG_WORDS.test(text) || words > 30) { size = 2; reasons.push('Sounds like more than one small change, so L2.'); }
  else if (TWEAK_WORDS.test(text) && words <= 25 && !SEVERAL.test(text)) { size = 0; reasons.push('Sounds like a small tweak (wording, a rename, a colour), so L0.'); }
  else if (words <= 20 && !SEVERAL.test(text)) { size = 1; reasons.push('A short, single change, so L1.'); }
  else { size = 2; reasons.push('Not obviously a one-line change, so L2.'); }
  if (files.length > 15 && size < 2) { size = 2; reasons.push(`Already ${files.length} files changed, so L2.`); }

  const level = Math.max(floor, size);
  return { level, floor, reasons, triggers };
}

const SAFE_REF = /^[A-Za-z0-9_][A-Za-z0-9_./@^~-]{0,199}$/;

/**
 * The paths changed on a worktree's branch since it left `base`: `git diff --numstat base...HEAD`
 * (--stat's machine-readable form, so long paths aren't shortened with "..."). No shell, a
 * timeout, and [] on any trouble (not a repository, unknown base, git missing).
 */
export function changedPaths(worktree, base = 'main', { timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    if (typeof worktree !== 'string' || !path.isAbsolute(worktree) || !SAFE_REF.test(String(base)) || String(base).includes('..')) return resolve([]);
    try { if (!fs.statSync(worktree).isDirectory()) return resolve([]); } catch { return resolve([]); }
    execFile('git', ['-C', worktree, 'diff', '--numstat', '--no-renames', '--no-color', `${base}...HEAD`, '--'], { timeout, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) return resolve([]);
      const out = [];
      for (const line of String(stdout).split('\n')) {
        const parts = line.split('\t');
        if (parts.length >= 3 && parts[2]) out.push(parts.slice(2).join('\t'));
      }
      resolve(out);
    });
  });
}
