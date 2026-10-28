// status.json's schema (lib/status-schema.json) and the strict check validate() in lib/status-json.js
// (plan D11): versions 1 and 2, wrong types and values outside their lists refused, unknown keys
// warned about, the ticket block required in version 2 and for a job started from a ticket.
// parseStatusJson stays lenient for display (its own tests are in parsers.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { STATUS_SCHEMA, STAGE_STATES, WAITING_FOR, PR_STATES, validate, parse, parseStatusJson, MAX_ERRORS } from '../lib/status-json.js';
import { STAGE_IDS } from '../lib/stages.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (f) => fs.readFile(path.join(FIX, f), 'utf8');

// The skill's own example (skills/feature/status-json.md §2), version 1.
const V1 = {
  schema_version: 1, slug: 'copy-ticket-id', title: 'Copy Ticket ID', route: 'small', suggested_level: 2,
  predicted_paths: ['app/src/routes/jobs.ts'], level_reason: 'Adds a button to one existing page.',
  stage: 'review', stage_state: 'waiting_for_you', waiting_for: 'approval', waiting_since: '2026-10-12T15:42:00-07:00',
  brief: { number: 7, path: 'briefs/007-review.md', headline: 'Copy Ticket ID · review done' },
  questions: [{ id: '1', text: 'Fix R-2 and R-3 now?', recommendation: 'a', options: [
    { id: 'a', label: 'Yes, small fix round', consequence: 'One more implementer dispatch' },
    { id: 'b', label: 'No, leave as minors', consequence: 'Both go in the PR body' },
  ] }],
  decided_on_your_behalf: [{ id: 'D-005', decision: 'Toast text is "Copied"', reason: 'use your recommendations', where: 'spec v0.4 §3', confirmed: false }],
  next_proposed: 'Fix round, then PR #1',
  spec: { path: '/abs/docs/plans/spec.md', version: '0.4', status: 'DRAFT' },
  artifacts: [{ name: 'Findings', path: 'findings.md', version: '1', based_on: 'spec v0.3' }],
  repo: { path: '/abs/repo', base_branch: 'moxie/main' },
  branch: 'feature/orbit-479-copy-id', worktree: '/abs/orbit-copy-ticket-id', base_sha: '2ed7bd1',
  prs: [
    { number: 1, label: 'fork → org branch', url: null, state: 'not_started' },
    { number: 2, label: 'org branch → staging', url: null, state: 'not_started' },
    { number: 3, label: 'staging → main (release)', url: null, state: 'not_started' },
  ],
  session_id: null, cwd: '/abs/repo', updated_at: '2026-10-12T15:42:00-07:00',
};
const TICKET = { key: 'ORBIT-479', title: 'Feedback API and MCP', url: 'https://orbit.example.com/feedback/ORBIT-479', level: 'L2' };
const V2 = { ...V1, schema_version: 2, ticket: TICKET };

test('schema: its lists are the dashboard’s own (stages, stage states, waiting for, PR states)', () => {
  const p = STATUS_SCHEMA.properties;
  assert.deepEqual(p.stage.enum, [...STAGE_IDS, null]);
  assert.deepEqual(p.stage_state.enum, STAGE_STATES);
  assert.deepEqual(p.waiting_for.enum, [...WAITING_FOR, null]);
  assert.deepEqual(p.prs.items.properties.state.enum, PR_STATES);
  assert.deepEqual(p.ticket.properties.level.enum, ['L0', 'L1', 'L2', 'L3', null]);
  assert.deepEqual(p.schema_version.enum, [1, 2]);
});

test('validate: the skill’s examples pass, version 1 and version 2', () => {
  assert.deepEqual(validate(V1), { ok: true, errors: [], warnings: [] });
  assert.deepEqual(validate(V2), { ok: true, errors: [], warnings: [] });
  assert.deepEqual(validate(JSON.stringify(V2, null, 2), { ticketKey: 'ORBIT-479' }), { ok: true, errors: [], warnings: [] }, 'text works as well as an object');
  // The least a file may hold.
  assert.equal(validate({ schema_version: 1, slug: 'x', stage: null, stage_state: 'working' }).ok, true);
});

test('validate: the parser fixture passes but for its one deliberate bad value', async () => {
  // status-valid.json is the lenient parser's sample: it carries one PR state outside the list
  // ("weird") on purpose, which the strict check refuses; with that value right it passes.
  const text = await read('status-valid.json');
  const v = validate(text);
  assert.deepEqual(v.errors, ['prs[1].state: "weird" is not one of not_started, open, changes_requested, approved, merged, closed']);
  const fixed = JSON.parse(text);
  fixed.prs[1].state = 'not_started';
  const again = validate(fixed);
  assert.equal(again.ok, true, again.errors.join('; '));
  // What the display cuts or drops is a warning, not an error: a fourth question, a link not on GitHub.
  assert.deepEqual(again.warnings, ['questions: 4; only the first 3 are shown', 'prs[1].url: only https://github.com/ links are shown']);
});

test('validate: wrong types are refused, each with a plain line naming the field', () => {
  const bad = {
    ...V1,
    slug: 42,
    suggested_level: 5,
    predicted_paths: 'app/src/x.ts',
    brief: { number: '7', path: 'briefs/007-review.md', headline: null },
    questions: [{ id: '1', text: 'Q?', options: [{ id: 'a' }] }],
    decided_on_your_behalf: [{ decision: 'x', confirmed: 'no' }],
    spec: 'docs/spec.md',
    prs: [{ number: 4, state: 'open' }],
  };
  const v = validate(bad);
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors, [
    'slug: expected text, got a whole number 42',
    'suggested_level: 5 is above 3',
    'predicted_paths: expected a list or null, got text "app/src/x.ts"',
    'brief.number: expected a whole number or null, got text "7"',
    'questions[0].options[0].label: missing (it is required)',
    'decided_on_your_behalf[0].confirmed: expected true or false, got text "no"',
    'spec: expected an object or null, got text "docs/spec.md"',
    'prs[0].number: 4 is not one of 1, 2, 3',
  ]);
});

test('validate: values outside their lists are refused (stage, stage state, waiting for, PR state, level)', () => {
  const v = validate({ ...V2, stage: 'deploy', stage_state: 'in_progress', waiting_for: 'coffee', prs: [{ number: 1, state: 'draft' }], ticket: { ...TICKET, level: 'L4' } });
  assert.deepEqual(v.errors, [
    'stage: "deploy" is not one of clarify, spec, refine, wireframe, investigate, spec-update, plan, implement, test, review, pr1, pr2, staging-qa, pr3 (or null)',
    'stage_state: "in_progress" is not one of working, waiting_for_you, blocked, done',
    'waiting_for: "coffee" is not one of approval, answers, permission (or null)',
    'prs[0].state: "draft" is not one of not_started, open, changes_requested, approved, merged, closed',
    'ticket.level: "L4" is not one of L0, L1, L2, L3 (or null)',
  ]);
});

test('validate: required fields, unknown keys, bad JSON', () => {
  const v = validate({ schema_version: 1, title: 'No slug' });
  assert.deepEqual(v.errors, ['slug: missing (it is required)', 'stage: missing (it is required)', 'stage_state: missing (it is required)']);
  const extra = validate({ ...V1, mood: 'sunny', brief: { ...V1.brief, colour: 'red' } });
  assert.equal(extra.ok, true, 'an unknown key is allowed');
  assert.deepEqual(extra.warnings, ['brief.colour: not in the schema, so the dashboard ignores it', 'mood: not in the schema, so the dashboard ignores it'], 'in the order of the file');
  assert.deepEqual(validate('{nope'), { ok: false, errors: [validate('{nope').errors[0]], warnings: [] });
  assert.match(validate('{nope').errors[0], /^status\.json is not valid JSON: /);
  assert.deepEqual(validate('[]').errors, ['status.json: expected an object, got a list []']);
  assert.deepEqual(validate({ ...V1, schema_version: 3 }).errors, ['schema_version: 3 is not one of 1, 2']);
  assert.deepEqual(validate({ ...V1, schema_version: '1' }).errors, ['schema_version: expected a whole number, got text "1"']);
});

test('validate: version 2 needs its ticket block; a job started from a ticket needs version 2 and that key', () => {
  const { ticket: _t, ...noTicket } = V2;
  assert.deepEqual(validate(noTicket).errors, ['ticket: missing (it is required)']);
  assert.deepEqual(validate({ ...V2, ticket: null }).errors, ['ticket: expected an object, got null']);
  assert.deepEqual(validate({ ...V2, ticket: { title: 'x' } }).errors, ['ticket.key: missing (it is required)']);
  assert.deepEqual(validate({ ...V2, ticket: { ...TICKET, key: 'orbit-479', url: 'http://orbit/x' } }).errors, [
    'ticket.key: "orbit-479" is not a ticket key like ORBIT-479',
    'ticket.url: "http://orbit/x" is not an https:// link',
  ]);
  // Started from ORBIT-479: version 1 is not enough, and the key must be that ticket's.
  assert.deepEqual(validate(V1, { ticketKey: 'ORBIT-479' }).errors, ['schema_version: this job was started from ORBIT-479, so write schema_version 2 with the ticket block { key, title, url, level }']);
  assert.deepEqual(validate({ ...V2, ticket: { ...TICKET, key: 'ORBIT-12' } }, { ticketKey: 'ORBIT-479' }).errors, ['ticket.key: "ORBIT-12", but this job is on ORBIT-479']);
  assert.equal(validate(V2, { ticketKey: 'orbit-479' }).ok, true, 'the job’s key in any case');
  // A ticket block in a version 1 file is not read: a warning, not an error.
  assert.deepEqual(validate({ ...V1, ticket: TICKET }), { ok: true, errors: [], warnings: ['ticket: read only in schema_version 2'] });
});

test('validate: a long error list is cut', () => {
  const v = validate({ ...V1, questions: Array.from({ length: 40 }, () => ({ id: 1 })) });
  assert.equal(v.errors.length, MAX_ERRORS + 1);
  assert.equal(v.errors.at(-1), `…and ${40 - MAX_ERRORS} more`);
});

test('parse: lenient as before; version 2 reads the ticket block, version 1 still parses', async () => {
  assert.equal(parse, parseStatusJson);
  const two = parseStatusJson(JSON.stringify(V2));
  assert.equal(two.ok, true);
  assert.deepEqual(two.warnings, []);
  assert.deepEqual(two.ticket, TICKET);
  const one = parseStatusJson(JSON.stringify(V1));
  assert.deepEqual(one.warnings, []);
  assert.equal(one.ticket, null);
  assert.equal(one.stage, 'review');
  const old = parseStatusJson(await read('status-valid.json'));
  assert.equal(old.ok, true, 'the version 1 fixture still parses for display');
  // A version 2 file without its ticket block is shown, with a warning; a bad block is dropped.
  assert.deepEqual(parseStatusJson(JSON.stringify({ ...V1, schema_version: 2 })).warnings, ['schema_version 2 without its ticket block']);
  const odd = parseStatusJson(JSON.stringify({ ...V2, ticket: { key: 'orbit-12', title: 7, url: 'javascript:alert(1)', level: 'L9' } }));
  assert.deepEqual(odd.ticket, { key: 'ORBIT-12', title: null, url: null, level: null });
  assert.equal(parseStatusJson(JSON.stringify({ ...V2, ticket: { key: 'ticket' } })).ticket, null);
});
