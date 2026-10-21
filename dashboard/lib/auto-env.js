// The auto mode environment for a job's Foreman session: a few lines Claude Code's safety model
// reads (settings autoMode.environment, added to yours) so it knows where this job's work belongs.
// Without them it knows only what your own settings say (often another repo), and treats a push to
// the job's fork or a pull request on the org repo as work leaving the trusted repo.
//
// Only facts the dashboard can see are stated: the job's repo and worktrees, its record folder, and
// each remote's address (git remote -v). The dashboard's own hard lines still apply on top
// (lib/hard-lines.js): org pushes and force pushes are refused, merges and migrations ask.

import { execFile } from 'node:child_process';

import { ORG_REMOTES, ORG_URL } from './hard-lines.js';

/** The repo's remotes as [{ name, url }] (push addresses), [] when git can't say. */
export function remotesOf(repo) {
  return new Promise((resolve) => {
    if (!repo) return resolve([]);
    execFile('git', ['remote', '-v'], { cwd: repo, timeout: 3000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve([]);
      const out = new Map();
      for (const line of String(stdout).split('\n')) {
        const m = line.match(/^(\S+)\s+(\S+)\s+\(push\)$/);
        if (m) out.set(m[1], m[2]);
      }
      resolve([...out].map(([name, url]) => ({ name, url })));
    });
  });
}

const isOrg = ({ name, url }) => ORG_REMOTES.includes(name) || ORG_URL.test(url);
const list = (xs) => xs.map((x) => `\`${x}\``).join(', ');

/**
 * The environment lines for one job. job: { title, slug, repoPath, worktrees[], featureDir };
 * remotes: from remotesOf(repoPath). Returns [] when the job's repo isn't known.
 */
export function autoModeEnvironment({ title, slug, repoPath, worktrees = [], featureDir }, remotes = []) {
  if (!repoPath) return [];
  const lines = [
    `**Feature Workshop job**: this session is the Feature Workshop's Foreman for the job "${title || slug}" (${slug}). The user decides each stage on the dashboard, and those decisions arrive as the user's messages in this conversation.`,
  ];
  const folders = [repoPath, ...worktrees.filter((w) => w && w !== repoPath)];
  const own = remotes.filter((r) => !isOrg(r));
  const org = remotes.filter(isOrg);
  let repo = `**Trusted repo (this job)**: ${list(folders)} (the job's repository and its worktrees).`;
  if (own.length) repo += ` Its own remote${own.length > 1 ? 's' : ''}: ${own.map((r) => `\`${r.name}\` = ${r.url}`).join(', ')}, the user's fork, where the job's branches are pushed for review.`;
  if (org.length) repo += ` The organization's repository: ${org.map((r) => `\`${r.name}\` = ${r.url}`).join(', ')}. Pull requests from the fork into it are how this work is reviewed; the dashboard refuses any direct push to it and any force push.`;
  lines.push(repo);
  if (featureDir) lines.push(`**Job records**: ${list([featureDir])} holds this job's own records (status, briefs, plans, check logs); reading and writing there is routine bookkeeping.`);
  return lines;
}
