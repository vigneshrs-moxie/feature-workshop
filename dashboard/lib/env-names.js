// The environment variables' names, and the names they had before Starbase (decision G36).
// Code reads only the new STARBASE_* names. An old name still works, read only while its new name
// is unset: each program's first import (dashboard/server.js, bin/starbase.js, the demo, the hosted
// site's local runs) calls withOldNames(process.env) before anything else reads it, so a service
// file, a shell profile or a test written with the old names keeps working.
//
// The /feature skill reads STARBASE_FEATURES_DIR (and, while an older copy is installed,
// WORKSHOP_FEATURES_DIR): both are set for the Claude Code sessions this program starts, so either
// copy of the skill finds the jobs.
//
// env-names.test.js lists every old name and its new one.

/** New name → the old name it replaces. */
export const OLD_NAMES = Object.freeze({
  STARBASE_DIR: 'GROUND_CONTROL_DIR',
  STARBASE_USER: 'GROUND_CONTROL_USER',
  STARBASE_RELEASE_REPO: 'GROUND_CONTROL_RELEASE_REPO',
  STARBASE_ORBIT_URL: 'GROUND_CONTROL_ORBIT_URL',
  STARBASE_NO_SERVICE: 'GROUND_CONTROL_NO_SERVICE',
  STARBASE_FROM: 'GROUND_CONTROL_FROM',
  STARBASE_STATE_DIR: 'WORKSHOP_STATE_DIR',
  STARBASE_DEMO: 'WORKSHOP_DEMO',
  STARBASE_DEMO_NO_AUTO: 'WORKSHOP_DEMO_NO_AUTO',
  STARBASE_FEATURES_DIR: 'WORKSHOP_FEATURES_DIR',
  STARBASE_PROJECTS_DIR: 'WORKSHOP_PROJECTS_DIR',
  STARBASE_AGENTS_DIR: 'WORKSHOP_AGENTS_DIR',
  STARBASE_SKILLS_DIR: 'WORKSHOP_SKILLS_DIR',
  STARBASE_WALKTHROUGHS_DIR: 'WORKSHOP_WALKTHROUGHS_DIR',
  STARBASE_ORBIT_STORE: 'WORKSHOP_ORBIT_STORE',
  STARBASE_GH: 'WORKSHOP_GH',
  STARBASE_PLAYWRIGHT: 'WORKSHOP_PLAYWRIGHT',
  STARBASE_PLAN_USAGE: 'WORKSHOP_PLAN_USAGE',
  STARBASE_EXTRA_REPOS: 'WORKSHOP_EXTRA_REPOS',
  STARBASE_GATE_PARK_MS: 'WORKSHOP_GATE_PARK_MS',
  STARBASE_STACK_TICK_MS: 'WORKSHOP_STACK_TICK_MS',
  STARBASE_CLAUDE_SETTINGS: 'WORKSHOP_CLAUDE_SETTINGS',
  STARBASE_CLAUDE_PATH: 'WORKSHOP_CLAUDE_PATH',
  STARBASE_URL: 'WORKSHOP_URL',
});

/** Old names that are also set from the new one, for programs that still read only the old name. */
export const KEEP_OLD_TOO = Object.freeze(['STARBASE_FEATURES_DIR']);

const set = (v) => v !== undefined && v !== '';

/**
 * Fills each unset new name from its old name, in place, and returns env. For KEEP_OLD_TOO it
 * also fills the old name from the new one, so an older /feature skill sees it too.
 */
export function withOldNames(env = process.env) {
  for (const [now, was] of Object.entries(OLD_NAMES)) {
    if (!set(env[now]) && set(env[was])) env[now] = env[was];
  }
  for (const now of KEEP_OLD_TOO) {
    const was = OLD_NAMES[now];
    if (set(env[now]) && !set(env[was])) env[was] = env[now];
  }
  return env;
}

/** One variable by its new name, falling back to the old one. */
export const envOf = (env, name) => (set(env?.[name]) ? env[name] : OLD_NAMES[name] && set(env?.[OLD_NAMES[name]]) ? env[OLD_NAMES[name]] : undefined);
