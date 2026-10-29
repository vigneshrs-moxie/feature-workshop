// A job's decisions in the repository (lib/decisions.js, packet O): the file's name, the copy written
// into a worktree's docs/decisions/ (refused while the folder is ignored), the folder's index, and the
// `ground-control decisions` command. Temp git repositories only: no network, no Orbit checkout.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IGNORED_REASON, indexEntry, indexText, render, renderIndex, repoFileName, withoutAgentNotes, writeRepoCopy } from '../lib/decisions.js';
import { main } from '../../bin/ground-control.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

/** A temp repository with one commit; its .gitignore as given. */
function repo(gitignore = 'node_modules/\ndocs/*\n!docs/decisions/\n') {
  const dir = tmp('gc-o-repo-');
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, '.gitignore'), gitignore);
  fs.writeFileSync(path.join(dir, 'app.js'), 'export {};\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
}

// A stack's decisions.md as lib/decisions.js writes it: the note to agents, the rows, a Foreman
// row, a section with its own rows, and the Not doing list.
const DECISIONS = render({
  prefix: 'ORBIT-479',
  title: 'Feedback API',
  rows: [
    { id: 'ORBIT-479.D1', question: 'Brief 2 (spec): go ahead?', options: 'approve · send back · stop', choice: 'approve', who: 'Vignesh', when: '2026-10-27', why: '' },
    { id: 'ORBIT-479.D2', question: 'Level for this job', options: 'L0 · L1 · L2 · L3', choice: 'L2', who: 'Vignesh', when: '2026-10-28', why: 'was L1' },
  ],
  sections: [{ name: 'api', rows: [{ id: 'ORBIT-479.D3', question: 'Brief 1 (plan): go ahead?', options: 'approve · send back · stop', choice: 'approve', who: 'Vignesh', when: '2026-10-29', why: 'keep a | b apart' }] }],
  existing: [
    '| ORBIT-479.F1 | Store feedback per office? | yes · no | yes | Foreman | 2026-10-27 | the spec says offices differ | <!-- foreman -->',
    '## Section: api',
    '| ORBIT-479.F2 | Page size? | 20 · 50 | 50 | Foreman | 2026-10-28 | the list is short | <!-- foreman -->',
    '## Not doing',
    '- Email on new feedback (the spec leaves it for later)',
    '- An export button (nobody asked)',
  ].join('\n'),
});

/** A job folder named orbit-479-feedback-api with its status.json and decisions.md. */
function job({ status = { ticket: { key: 'ORBIT-479', title: 'Feedback API' } }, decisions = DECISIONS, features = tmp('gc-o-features-'), slug = 'orbit-479-feedback-api' } = {}) {
  const dir = path.join(features, slug);
  fs.mkdirSync(dir, { recursive: true });
  if (status) fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status));
  if (decisions !== null) fs.writeFileSync(path.join(dir, 'decisions.md'), decisions);
  return { dir, features, slug };
}

// ---------- The file name ----------

test('the file name: the number padded to four, a short slug from the title, no ticket gives null', () => {
  assert.equal(repoFileName({ ticketKey: 'ORBIT-479', title: 'Feedback API' }), 'ORBIT-0479-feedback-api.md');
  assert.equal(repoFileName({ ticketKey: 'ORBIT-7', title: 'Fix: the login page’s “Remember me”!' }), 'ORBIT-0007-fix-the-login-page-s-remember.md', 'lowercase, words joined by -, at most 6');
  assert.equal(repoFileName({ ticketKey: 'ORBIT-12345', title: 'Big one' }), 'ORBIT-12345-big-one.md', 'a longer number stays whole');
  assert.equal(repoFileName({ ticketKey: 'orbit-479', title: 'ORBIT-479: Feedback API' }), 'ORBIT-0479-feedback-api.md', 'the ticket number is not repeated');
  assert.equal(repoFileName({ ticketKey: 'ORBIT-479', title: '[ORBIT 479] Feedback API (#479)' }), 'ORBIT-0479-feedback-api.md');
  assert.equal(repoFileName({ ticketKey: 'ORBIT-479', title: 'Café déjà vu' }), 'ORBIT-0479-cafe-deja-vu.md');
  assert.equal(repoFileName({ ticketKey: 'ORBIT-479', slug: 'orbit-479-feedback-api' }), 'ORBIT-0479-feedback-api.md', 'no title: the job’s slug, without its ticket');
  assert.equal(repoFileName({ ticketKey: 'ORBIT-479', title: '479' }), 'ORBIT-0479.md', 'nothing left of the title');
  for (const t of [{}, { ticketKey: null, title: 'Feedback API', slug: 'feedback-api' }, { ticketKey: 'job' }, { ticketKey: 'ORBIT-0' }, { ticketKey: 'ORBIT-479x' }]) {
    assert.equal(repoFileName(t), null, JSON.stringify(t));
  }
});

// ---------- The notes meant for agents ----------

test('the copy has no notes for agents, and the sections and Not doing come through unchanged', () => {
  const copy = withoutAgentNotes(DECISIONS);
  assert.doesNotMatch(copy, /<!--|-->/);
  assert.equal(copy, [
    '# ORBIT-479 · Feedback API',
    '',
    '| id | question | options | choice | who | when | why |',
    '|---|---|---|---|---|---|---|',
    '| ORBIT-479.D1 | Brief 2 (spec): go ahead? | approve · send back · stop | approve | Vignesh | 2026-10-27 |  |',
    '| ORBIT-479.D2 | Level for this job | L0 · L1 · L2 · L3 | L2 | Vignesh | 2026-10-28 | was L1 |',
    '| ORBIT-479.F1 | Store feedback per office? | yes · no | yes | Foreman | 2026-10-27 | the spec says offices differ |',
    '',
    '## Section: api',
    '| ORBIT-479.D3 | Brief 1 (plan): go ahead? | approve · send back · stop | approve | Vignesh | 2026-10-29 | keep a \\| b apart |',
    '| ORBIT-479.F2 | Page size? | 20 · 50 | 50 | Foreman | 2026-10-28 | the list is short |',
    '',
    '## Not doing',
    '- Email on new feedback (the spec leaves it for later)',
    '- An export button (nobody asked)',
    '',
  ].join('\n'));
  // Only the comments go: a file without any is left exactly as it is, and a comment over lines goes whole.
  const plain = '# ORBIT-1\n\n\n| id |\n|---|\n\n## Not doing\n- x  \n';
  assert.equal(withoutAgentNotes(plain), plain);
  assert.equal(withoutAgentNotes('# A\n\n<!-- one\ntwo -->\n\nkept <!-- gone --> too\n'), '# A\n\nkept  too\n');
});

// ---------- Writing into a worktree ----------

test('the write refuses while docs/decisions/ is ignored, and writes nothing', async () => {
  const wt = repo('node_modules/\ndocs/\n'); // Orbit's rule today
  const { dir } = job();
  const r = await writeRepoCopy({ jobDir: dir, worktree: wt });
  assert.deepEqual(r, { ok: false, code: 'ignored', reason: IGNORED_REASON });
  assert.equal(r.reason, 'Orbit still ignores docs/decisions/. Its .gitignore needs `docs/*` and `!docs/decisions/` first.');
  assert.equal(fs.existsSync(path.join(wt, 'docs')), false);
  assert.equal(git(wt, 'status', '--porcelain'), '');
});

test('with docs/decisions/ tracked it writes the file and the index, and stages and commits nothing', async () => {
  const wt = repo();
  const head = git(wt, 'rev-parse', 'HEAD');
  const { dir } = job();
  const sub = path.join(wt, 'app');
  fs.mkdirSync(sub);
  const r = await writeRepoCopy({ jobDir: dir, worktree: sub }); // from a folder inside the checkout: its root
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.name, 'ORBIT-0479-feedback-api.md');
  assert.equal(r.file, path.join(wt, 'docs', 'decisions', 'ORBIT-0479-feedback-api.md'));
  assert.equal(r.index, path.join(wt, 'docs', 'decisions', 'README.md'));
  assert.deepEqual(r.paths, ['docs/decisions/ORBIT-0479-feedback-api.md', 'docs/decisions/README.md']);
  assert.deepEqual(r.changed, { file: true, index: true });
  assert.equal(fs.readFileSync(r.file, 'utf8'), withoutAgentNotes(DECISIONS));
  assert.match(fs.readFileSync(r.index, 'utf8'), /^\| \[ORBIT-479\]\(ORBIT-0479-feedback-api\.md\) \| Feedback API \| 5 \| 2026-10-29 \|$/m);
  // Nothing staged, nothing committed: the two files are new and untracked, and only they.
  assert.equal(git(wt, 'rev-parse', 'HEAD'), head);
  assert.equal(git(wt, 'diff', '--cached', '--name-only'), '');
  assert.deepEqual(git(wt, 'status', '--porcelain', '--untracked-files=all').trim().split('\n').sort(), ['?? docs/decisions/ORBIT-0479-feedback-api.md', '?? docs/decisions/README.md']);
  // The job's own file is untouched, and a second run changes nothing.
  assert.equal(fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8'), DECISIONS);
  const again = await writeRepoCopy({ jobDir: dir, worktree: wt });
  assert.deepEqual(again.changed, { file: false, index: false });
});

test('the ticket comes from the argument, status.json or the slug; no ticket, no file, no checkout are refused', async () => {
  const wt = repo();
  // status.json without a ticket, a slug made from one: the slug's key, the job's title.
  const a = job({ status: { title: 'Feedback API v2' } });
  assert.equal((await writeRepoCopy({ jobDir: a.dir, worktree: wt })).name, 'ORBIT-0479-feedback-api-v2.md');
  const b = job({ status: null, slug: 'feedback-api' });
  assert.equal((await writeRepoCopy({ jobDir: b.dir, worktree: wt, ticket: { key: 'ORBIT-512', title: 'Stack test' } })).name, 'ORBIT-0512-stack-test.md');

  const none = await writeRepoCopy({ jobDir: job({ status: { title: 'x' }, slug: 'tidy-up' }).dir, worktree: wt });
  assert.equal(none.ok, false);
  assert.equal(none.code, 'no-ticket');
  assert.match(none.reason, /no ticket/);
  const nofile = await writeRepoCopy({ jobDir: job({ decisions: null }).dir, worktree: wt });
  assert.equal(nofile.code, 'no-file');
  assert.match(nofile.reason, /no decisions\.md yet/);
  const plainDir = tmp('gc-o-plain-');
  const notGit = await writeRepoCopy({ jobDir: job().dir, worktree: plainDir });
  assert.equal(notGit.code, 'not-git');
  assert.match(notGit.reason, /isn’t a git checkout/);
  assert.deepEqual(fs.readdirSync(plainDir), []);
  assert.equal((await writeRepoCopy({ jobDir: job().dir, worktree: path.join(plainDir, 'missing') })).code, 'not-git');
});

test('never writes through a link', { skip: process.platform === 'win32' && 'links need admin rights on Windows' }, async () => {
  const wt = repo();
  const elsewhere = tmp('gc-o-elsewhere-');
  fs.mkdirSync(path.join(wt, 'docs'));
  fs.symlinkSync(elsewhere, path.join(wt, 'docs', 'decisions'));
  const r = await writeRepoCopy({ jobDir: job().dir, worktree: wt });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'in-the-way');
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

// ---------- The index ----------

test('the index: sorted by ticket number, general/ apart, identical on a second build', async () => {
  const dir = path.join(tmp('gc-o-index-'), 'docs', 'decisions');
  fs.mkdirSync(path.join(dir, 'general'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ORBIT-1000-later.md'), '# ORBIT-1000 · Later one\n\n| id | question | options | choice | who | when | why |\n|---|---|---|---|---|---|---|\n\n## Not doing\n');
  fs.writeFileSync(path.join(dir, 'ORBIT-0479-feedback-api.md'), withoutAgentNotes(DECISIONS));
  fs.writeFileSync(path.join(dir, 'ORBIT-0012-old-thing.md'), '# ORBIT-12\n\n| id | when |\n|---|---|\n| ORBIT-12.D1 | 2026-09-01 |\n| ORBIT-12.D2 | 2026-09-03 |\n');
  fs.writeFileSync(path.join(dir, 'general', '0002-ports.md'), '# 0002 · Ports\n\n| id | when |\n|---|---|\n| P1 | 2026-10-01 |\n');
  fs.writeFileSync(path.join(dir, 'general', '0001-naming.md'), '# 0001 · Naming\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a decision file');
  fs.writeFileSync(path.join(dir, 'README.md'), 'an old index\n');

  const first = await renderIndex(dir);
  assert.equal(first.changed, true);
  assert.equal(first.file, path.join(dir, 'README.md'));
  const text = fs.readFileSync(first.file, 'utf8');
  assert.equal(text, first.text);
  const lines = text.split('\n');
  assert.equal(lines[0], '# Decisions');
  assert.ok(lines[2].length > 0 && !lines[2].includes('\n'), 'one line on what the folder is');
  const tickets = lines.filter((l) => /^\| \[ORBIT-/.test(l));
  assert.deepEqual(tickets, [
    '| [ORBIT-12](ORBIT-0012-old-thing.md) | old thing | 2 | 2026-09-03 |',
    '| [ORBIT-479](ORBIT-0479-feedback-api.md) | Feedback API | 5 | 2026-10-29 |',
    '| [ORBIT-1000](ORBIT-1000-later.md) | Later one | 0 | — |',
  ]);
  assert.ok(lines.includes('| Ticket | Title | Decisions | Last updated |'));
  const across = lines.slice(lines.indexOf('## Across tickets'));
  assert.ok(across.length > 1, 'general/ has its own table');
  assert.deepEqual(across.filter((l) => /^\| \[/.test(l)), ['| [0001](general/0001-naming.md) | Naming | 0 | — |', '| [0002](general/0002-ports.md) | Ports | 1 | 2026-10-01 |']);
  assert.doesNotMatch(text, /README|notes\.txt|an old index/);

  const second = await renderIndex(dir);
  assert.equal(second.changed, false);
  assert.equal(fs.readFileSync(second.file, 'utf8'), text, 'the same files give the same bytes');
  // The order the files are read in makes no difference either.
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'README.md').map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
  const general = fs.readdirSync(path.join(dir, 'general')).map((n) => ({ name: `general/${n}`, text: fs.readFileSync(path.join(dir, 'general', n), 'utf8') }));
  assert.equal(indexText({ files: [...files].reverse(), general: [...general].reverse() }), text);
});

test('an empty folder has an index that says so; a stack’s section rows are counted with their dates', () => {
  assert.match(indexText({}), /^No decision files yet\.$/m);
  assert.doesNotMatch(indexText({}), /Across tickets/);
  const e = indexEntry('ORBIT-0479-feedback-api.md', DECISIONS);
  assert.deepEqual(e, { name: 'ORBIT-0479-feedback-api.md', ticket: 'ORBIT-479', prefix: 'ORBIT', number: 479, title: 'Feedback API', count: 5, updated: '2026-10-29' });
});

test('Ground Control’s own docs/decisions/README.md is the index its files give', async () => {
  const dir = path.join(ROOT, 'docs', 'decisions');
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'README.md').map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
  assert.ok(files.some((f) => f.name === '0001-next-phase-register.md'));
  assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), indexText({ files }));
  const register = indexEntry('0001-next-phase-register.md', files.find((f) => f.name === '0001-next-phase-register.md').text);
  assert.equal(register.count, 33, 'G1 to G33');
  assert.match(files.find((f) => f.name === '0001-next-phase-register.md').text, /^## Not doing\n- Sandcastle as a library/m);
});

// ---------- The command ----------

async function cli(argv, o = {}) {
  const out = [];
  const err = [];
  const code = await main(argv, { env: {}, home: tmp('gc-o-home-'), stateDir: tmp('gc-o-state-'), running: () => null, interactive: false, ...o, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out, err, text: [...out, ...err].join('\n') };
}

test('ground-control decisions <job> --worktree <path> writes the two files and prints their paths', async () => {
  const wt = repo();
  const { features, slug } = job();
  const env = { WORKSHOP_FEATURES_DIR: features };
  const r = await cli(['decisions', slug, '--worktree', wt], { env });
  assert.equal(r.code, 0, r.text);
  assert.ok(r.out.some((l) => l.includes(path.join(wt, 'docs', 'decisions', 'ORBIT-0479-feedback-api.md'))));
  assert.ok(r.out.some((l) => l.includes(path.join(wt, 'docs', 'decisions', 'README.md'))));
  assert.match(r.text, /docs\(decisions\): ORBIT-479 decisions/);
  assert.equal(git(wt, 'diff', '--cached', '--name-only'), '');

  // By the ticket key, with the worktree from status.json; by the job's folder.
  const k = job({ status: { ticket: { key: 'ORBIT-88', title: 'Key lookup' }, worktree: wt }, slug: 'orbit-88-key-lookup' });
  assert.equal((await cli(['decisions', 'ORBIT-88'], { env: { WORKSHOP_FEATURES_DIR: k.features } })).code, 0);
  assert.ok(fs.existsSync(path.join(wt, 'docs', 'decisions', 'ORBIT-0088-key-lookup.md')));
  assert.equal((await cli(['decisions', k.dir, '--worktree', wt])).code, 0);

  // Refusals: in plain words, exit 1.
  const ignored = repo('docs/\n');
  const no = await cli(['decisions', slug, '--worktree', ignored], { env });
  assert.equal(no.code, 1);
  assert.deepEqual(no.err, [IGNORED_REASON]);
  const missing = await cli(['decisions', 'nope', '--worktree', wt], { env });
  assert.equal(missing.code, 1);
  assert.match(missing.err[0], /There is no job “nope”/);
  const noWorktree = await cli(['decisions', slug], { env });
  assert.equal(noWorktree.code, 1);
  assert.match(noWorktree.err[0], /--worktree/);
  const help = await cli(['decisions', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.out[0], /^Usage: ground-control decisions <job>/);
});
