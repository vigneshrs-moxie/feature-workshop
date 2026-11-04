// A Bug fix job: its own stage names in status.json, its stops, its crew, its option defaults, and
// the /bugfix conductor (the workflow repo's bugfix/ skill and agents).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize, defaultsForBugLevel, defaultsForLevel, optionsAtLevel, SKIPPABLE, REVIEWERS, BUG_LEVELS, LEVELS, levelLabel, levelsForClient, describeOptions, levelChangeLine } from '../lib/options.js';
import { stopOf } from '../lib/stage-view.js';
import { STAGE_IDS, agentInfo, detectStage } from '../lib/stages.js';

const schema = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../lib/status-schema.json'), 'utf8'));

test('bug stages: status.json accepts triage, reproduce and diagnose, and they are known stages', () => {
  for (const s of ['triage', 'reproduce', 'diagnose']) {
    assert.ok(schema.properties.stage.enum.includes(s), `${s} in the schema`);
    assert.ok(STAGE_IDS.includes(s), `${s} in STAGES`);
  }
});

test('bug stages fold into the stops: triage is Spec, reproduce is Investigate, diagnose is Plan', () => {
  assert.equal(stopOf('triage'), 'spec');
  assert.equal(stopOf('reproduce'), 'investigate');
  assert.equal(stopOf('diagnose'), 'plan');
  assert.equal(stopOf('implement'), 'build', 'the fix is the build stop');
});

test('bug stages are found in free text, before the words they contain', () => {
  assert.equal(detectStage('Reproduce stage: presented for review'), 'reproduce');
  assert.equal(detectStage('diagnosis v1 written; fix next'), 'diagnose');
  assert.equal(detectStage('Triage: two questions'), 'triage');
});

test('the bug crew is drawn by existing characters, at its own stages', () => {
  assert.deepEqual({ name: agentInfo('bug-reproducer').name, stage: agentInfo('bug-reproducer').stage }, { name: 'Tester', stage: 'reproduce' });
  assert.deepEqual({ name: agentInfo('bug-diagnoser').name, stage: agentInfo('bug-diagnoser').stage }, { name: 'Sleuth', stage: 'diagnose' });
  assert.deepEqual({ name: agentInfo('bug-review-fix').name, stage: agentInfo('bug-review-fix').stage }, { name: 'Head inspector', stage: 'review' });
});

test('a bug job at each level gets the bug skip list and the bug lens; a feature job is unchanged', () => {
  for (let level = 0; level <= 3; level++) {
    const bug = normalize({ level }, { kind: 'bug' });
    assert.deepEqual(bug.skip, BUG_LEVELS[level].skip, `L${level} skip`);
    assert.deepEqual(bug.reviewers, BUG_LEVELS[level].reviewers, `L${level} reviewers`);
    assert.deepEqual(bug.models, LEVELS[level].models, `L${level} models follow the level`);
    assert.equal(bug.manual_test, LEVELS[level].manualTest);
    assert.deepEqual(normalize({ level }, { kind: 'feature' }).skip, defaultsForLevel(level).skip, `L${level} feature skip`);
  }
  assert.ok(!normalize({ level: 1 }, { kind: 'bug' }).skip.includes('spec'), 'no feature stage names on a bug job');
  assert.ok(!defaultsForBugLevel(2).skip.includes('diagnose'), 'diagnose is never skipped');
  assert.ok(!SKIPPABLE.some((s) => s.id === 'diagnose'), 'and the page cannot offer it');
  assert.ok(REVIEWERS.some((r) => r.id === 'bug-review-fix'), 'the bug lens is a reviewer the page knows');
});

test('editing a bug job keeps its kind: previous options carry it, and a level change keeps the bug defaults', () => {
  const previous = { ...normalize({ level: 1 }, { kind: 'bug' }), kind: 'bug' };
  const edited = normalize({ level: 1, skip: ['triage'] }, { previous });
  assert.deepEqual(edited.skip, ['triage'], 'a bug stage can be skipped from the page');
  const up = optionsAtLevel(previous, 2);
  assert.deepEqual(up.skip, BUG_LEVELS[2].skip);
  assert.equal(up.reviewers, 'auto');
  const feature = optionsAtLevel({ ...normalize({ level: 1 }), kind: 'feature' }, 2);
  assert.deepEqual(feature.skip, defaultsForLevel(2).skip);
});

test('a reviewer list on a bug job may name the bug lens and still drops names the page does not know', () => {
  const o = normalize({ level: 2, reviewers: ['bug-review-fix', 'feature-review-db', 'nope'] }, { kind: 'bug' });
  assert.deepEqual(o.reviewers, ['bug-review-fix', 'feature-review-db']);
});

test('a bug job labels L0 "Tweak (hotfix)"; the other levels and every feature level keep their names', () => {
  assert.equal(levelLabel(0, 'bug'), 'L0 Tweak (hotfix)');
  assert.equal(levelLabel(0), 'L0 Tweak');
  assert.equal(levelLabel(0, 'feature'), 'L0 Tweak');
  assert.equal(levelLabel(1, 'bug'), 'L1 Small');
  assert.equal(levelLabel(3, 'bug'), 'L3 Large');
  const client = levelsForClient();
  assert.equal(client[0].bugLabel, 'L0 Tweak (hotfix)');
  assert.equal(client[0].label, 'L0 Tweak');
  assert.deepEqual(client.slice(1).map((l) => l.bugLabel), client.slice(1).map((l) => l.label));
  assert.match(describeOptions({ ...normalize({ level: 0 }, { kind: 'bug' }), kind: 'bug' })[0], /^Level: L0 Tweak \(hotfix\)/);
  assert.match(describeOptions(normalize({ level: 0 }))[0], /^Level: L0 Tweak \(/);
  assert.equal(levelChangeLine(1, 0, 'bug'), 'Level changed from L1 Small to L0 Tweak (hotfix).');
});

test('the page gets each level’s bug defaults, and each skippable stage says which kind of job runs it', () => {
  const client = levelsForClient();
  for (const l of client) {
    const b = defaultsForBugLevel(l.level);
    assert.deepEqual(l.bug, { skip: b.skip, reviewers: b.reviewers }, `L${l.level}`);
  }
  assert.deepEqual(client[1].bug.reviewers, ['bug-review-fix'], 'L1 on a bug job: the Examiner, not the head inspector');
  client[1].bug.skip.push('x');
  assert.ok(!BUG_LEVELS[1].skip.includes('x'), 'a copy, not the table itself');
  // A feature's own stages say feature, a bug's say bug, and test and review are both kinds'.
  const kindOf = (id) => { const s = SKIPPABLE.find((x) => x.id === id); return s.bug ? 'bug' : s.feature ? 'feature' : 'both'; };
  assert.deepEqual(['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'spec-update', 'plan'].map(kindOf), Array(7).fill('feature'));
  assert.deepEqual(['triage', 'reproduce'].map(kindOf), ['bug', 'bug']);
  assert.deepEqual(['test', 'review'].map(kindOf), ['both', 'both']);
  assert.ok(REVIEWERS.find((r) => r.id === 'bug-review-fix').bug && REVIEWERS.filter((r) => r.bug).length === 1, 'the Examiner is the only bug-only lens');
});
