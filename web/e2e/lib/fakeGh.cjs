#!/usr/bin/env node
// A fake gh for the PR path check (web/e2e/prPath.mjs), handed to the demo as STARBASE_GH.
// It never reaches GitHub. Every call is written to $FAKE_GH_DIR/calls.jsonl ({ at, args, write });
// it answers from $FAKE_GH_DIR/state.json, which the check rewrites as the scripted PR moves on:
//   { mode: 'ok' | 'signed-out' | 'offline', login,
//     prs: { '<number>': { view, reviews, comments, issues, log } } }
// A write (a POST, a graphql mutation, pr create / merge / edit / comment / reopen) is answered and
// kept in state.json's `posted` list; anything it doesn't know is refused with exit 1.
const fs = require('node:fs');
const path = require('node:path');

const dir = process.env.FAKE_GH_DIR;
if (!dir) { process.stderr.write('fake gh: FAKE_GH_DIR is not set\n'); process.exit(1); }
const args = process.argv.slice(2);
const stateFile = path.join(dir, 'state.json');
const fx = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const save = () => fs.writeFileSync(stateFile, JSON.stringify(fx, null, 2));

const isGet = args[0] === 'api' && args[1] === '--method' && args[2] === 'GET';
const isQuery = args[0] === 'api' && args[1] === 'graphql' && args.some((x) => x.startsWith('query=query'));
const isRead = isGet || isQuery || (args[0] === 'pr' && args[1] === 'view') || (args[0] === 'run' && args[1] === 'view') || (args[0] === 'pr' && args[1] === 'list') || (args[0] === 'auth' && args[1] === 'status');
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify({ at: new Date().toISOString(), args, write: !isRead }) + '\n');

if (fx.mode === 'signed-out') {
  process.stderr.write('To get started with GitHub CLI, please run:  gh auth login\n');
  process.exit(4);
}
if (fx.mode === 'offline') {
  process.stderr.write('error connecting to api.github.com\n');
  process.exit(1);
}

const pr = (n) => fx.prs?.[String(n)] ?? null;
let out = null;
if (args[0] === 'pr' && args[1] === 'view' && pr(args[2])) {
  const v = pr(args[2]).view;
  const fields = String(args[args.indexOf('--json') + 1] ?? '').split(',');
  out = JSON.stringify(Object.fromEntries(fields.filter((f) => f in v).map((f) => [f, v[f]])));
} else if (isGet) {
  const m = /^repos\/[\w.-]+\/[\w.-]+\/(pulls|issues)\/(\d+)\/(reviews|comments|events)/.exec(args[3]);
  if (args[3] === 'user') out = JSON.stringify({ login: fx.login ?? 'you' });
  else if (m && pr(m[2])) {
    const p = pr(m[2]);
    out = JSON.stringify(m[3] === 'reviews' ? p.reviews ?? [] : m[3] === 'events' ? [] : m[1] === 'issues' ? p.issues ?? [] : p.comments ?? []);
  } else if (m) out = '[]';
} else if (args[0] === 'run' && args[1] === 'view') {
  const p = Object.values(fx.prs ?? {}).find((x) => x.log && x.log[args[2]]);
  out = p ? p.log[args[2]] : '';
} else if (isQuery) {
  const n = (args.find((x) => x.startsWith('number=')) ?? 'number=0').slice(7);
  const nodes = (pr(n)?.comments ?? []).filter((c) => !c.in_reply_to_id).map((c) => ({ id: `PRRT_${c.id}`, isResolved: false, comments: { nodes: [{ databaseId: c.id }] } }));
  out = JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes } } } } });
} else if (!isRead) {
  // A write: answered, and kept so the check can show what went.
  fx.nextId = (fx.nextId ?? 9000) + 1;
  fx.posted = [...(fx.posted ?? []), { id: fx.nextId, args }];
  if (args[0] === 'api' && args[2] === 'POST') {
    const body = (args.find((x) => x.startsWith('body=')) ?? 'body=').slice(5);
    const reply = /\/pulls\/(\d+)\/comments\/(\d+)\/replies$/.exec(args[3]);
    const issue = /\/issues\/(\d+)\/comments$/.exec(args[3]);
    const at = new Date().toISOString();
    const user = { login: fx.login ?? 'you', type: 'User' };
    if (reply && pr(reply[1])) {
      const first = pr(reply[1]).comments.find((c) => String(c.id) === reply[2]);
      pr(reply[1]).comments.push({ ...first, id: fx.nextId, user, body, in_reply_to_id: Number(reply[2]), created_at: at, html_url: `${first?.html_url ?? ''}-${fx.nextId}` });
    } else if (issue && pr(issue[1])) pr(issue[1]).issues.push({ id: fx.nextId, user, body, created_at: at, html_url: `https://github.com/x/y/pull/${issue[1]}#issuecomment-${fx.nextId}` });
    out = JSON.stringify({ id: fx.nextId });
  } else if (args[0] === 'api' && args[1] === 'graphql') out = JSON.stringify({ data: { resolveReviewThread: { thread: { isResolved: true } } } });
  else if (args[0] === 'pr' && args[1] === 'create') out = `https://github.com/acme/acme-portal/pull/${fx.nextId}\n`;
  else if (args[0] === 'pr' && ['merge', 'edit', 'comment', 'reopen'].includes(args[1])) out = '';
  save();
}
if (out === null) { process.stderr.write(`fake gh: not expected: ${args.join(' ')}\n`); process.exit(1); }
process.stdout.write(out);
