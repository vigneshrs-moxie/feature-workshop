// Is the installed /feature skill new enough to know levels? The dashboard writes `level` (L0–L3)
// and gate-card chip lines into a job's options and replies; a skill from before levels doesn't know
// them (it reads `flow`, so L0 runs like L1, and it ignores chip lines it doesn't recognise).
//
// Reads <skills dir>/feature/job-options.md, READ ONLY, and looks for its Levels table: a
// "## Levels" heading and a table whose header starts "| Level |". The skills dir is the
// dashboard's SKILLS_DIR (WORKSHOP_SKILLS_DIR overrides ~/.claude/skills, so tests never read the
// real one). The answer is kept until the file's modification time or size changes, so asking on
// every /api/meta costs one stat.

import fsp from 'node:fs/promises';
import path from 'node:path';

/** Whether a job-options.md's text has the Levels table. */
export function hasLevelsTable(text) {
  return /^#{2,3}\s+Levels\b/m.test(text) && /^\|\s*Level\s*\|/m.test(text);
}

/**
 * A checker for one skills folder. check() resolves to
 *   { installed, levels, path }:
 *   installed: job-options.md is there and readable as a plain file (or a link to one, as install.sh makes);
 *   levels: it has the Levels table (false when it isn't installed);
 *   path: the file it reads.
 */
export function skillChecker(skillsDir) {
  const file = path.join(skillsDir, 'feature', 'job-options.md');
  let cache = null; // { key, result }
  return {
    path: file,
    async check() {
      let st;
      try { st = await fsp.stat(file); } catch { st = null; }
      if (!st || !st.isFile()) {
        cache = null;
        return { installed: false, levels: false, path: file };
      }
      const key = `${st.mtimeMs}:${st.size}`;
      if (cache?.key === key) return cache.result;
      let result;
      try {
        const text = await fsp.readFile(file, 'utf8');
        result = { installed: true, levels: hasLevelsTable(text), path: file };
      } catch {
        result = { installed: false, levels: false, path: file };
      }
      cache = { key, result };
      return result;
    },
  };
}
