// Suggesting a level (L0–L3) for a job without asking a model: scan the description, and once a
// worktree exists the paths `git diff --numstat` reports, for risk triggers. A trigger sets a floor
// the suggestion never goes under; with none, size words in the description decide. The Foreman's
// own suggestion (status.json `suggested_level`) arrives with its first brief; the page shows both.
//
// The rules themselves (RISK_TRIGGERS, suggestLevel) live in level-rules.js, which has no Node
// built-ins so the new UI imports the same file; this module adds reading the changed paths.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export { RISK_TRIGGERS, suggestLevel } from './level-rules.js';

const SAFE_REF = /^[A-Za-z0-9_][A-Za-z0-9_./@^~-]{0,199}$/;

/**
 * The paths changed on a worktree's branch since it left `base`: `git diff --numstat -z base...HEAD`
 * (--stat's machine-readable form, so long paths aren't shortened with "...", and -z so odd file
 * names come through as they are). No shell, a timeout, no external diff or textconv drivers, no
 * optional locks. [] when nothing changed; null on any trouble (not a repository, unknown base,
 * git missing), so the caller can fall back to the description alone.
 */
export function changedPaths(worktree, base = 'main', { timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    if (typeof worktree !== 'string' || !path.isAbsolute(worktree) || !SAFE_REF.test(String(base)) || String(base).includes('..')) return resolve(null);
    try { if (!fs.statSync(worktree).isDirectory()) return resolve(null); } catch { return resolve(null); }
    const args = ['-C', worktree, 'diff', '--numstat', '-z', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', `${base}...HEAD`, '--'];
    execFile('git', args, { timeout, maxBuffer: 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } }, (err, stdout) => {
      if (err) return resolve(null);
      // Each record is "added<TAB>deleted<TAB>path<NUL>" (no renames, so never the two-path form).
      const out = [];
      for (const rec of String(stdout).split('\0')) {
        const a = rec.indexOf('\t');
        const b = a >= 0 ? rec.indexOf('\t', a + 1) : -1;
        if (b > 0 && b < rec.length - 1) out.push(rec.slice(b + 1));
      }
      resolve(out);
    });
  });
}
