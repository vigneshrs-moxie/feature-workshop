// Packet 2D: the Lounge (decision G13). Three made-up people, each with a laptop: one online with two
// jobs, one away, one off. The answer carries only the fields G13 allows, and the list of every
// field it returns is written out here, so a new one fails until it is decided on. Everyone gets
// the same answer whatever their role; only your own jobs carry their slug (so they open).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, makeSite, SITE } from './helpers.js';
import { paired } from './laptops.js';

const MIN = 60 * 1000;
const T0 = Date.parse('2026-10-30T16:00:00Z');
const at = (ms) => new Date(ms).toISOString();

let eids = 0;
/** What a laptop sends up, straight to the site (as runner/site-link.js would). */
async function up(s, token, events) {
  const r = await s.fetch(`${SITE}/api/runner/events`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ events: events.map(([type, data, job = null]) => ({ v: 1, eid: `e-lounge-${++eids}`, type, job, data })) }),
  });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.deepEqual(body.refused, []);
}
/** The laptop calls in (its long-poll), so the site counts it on. */
async function seen(s, token) {
  const r = await s.fetch(`${SITE}/api/runner/commands?wait=0`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
}
const row = (slug, title, extra = {}) => ({ slug, title, ticket: null, stage: 'implement', state: 'working', stateWords: 'Working: the builder writes the tests', now: 'Builder: Writing the tests', updatedAt: null, ...extra });
const lounge = async (who) => { const r = await who.json('/api/lounge'); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const byName = (body) => Object.fromEntries(body.people.map((p) => [p.name, p]));

/** Olive (owner) online with two jobs; Mia (made a manager) away; Sam (member) off. */
async function threePeople() {
  const s = await makeSite({ clock: { t: T0 } });
  const olive = await paired(s, 'olive.owner@example.test', 'Olive’s Mac');
  const mia = await paired(s, 'mia.member@example.test', 'Mia’s laptop');
  const sam = await paired(s, 'sam.sample@example.test', 'Sam’s laptop');
  const ids = Object.fromEntries((await s.db.query('SELECT id, email FROM people')).rows.map((r) => [r.email.split('.')[0], Number(r.id)]));
  // The fake Google gives each a name; set them as Google would.
  await s.db.query("UPDATE people SET name = CASE split_part(email, '.', 1) WHEN 'olive' THEN 'Olive Owner' WHEN 'mia' THEN 'Mia Member' ELSE 'Sam Sample' END");
  assert.equal((await olive.person.send('POST', `/api/people/${ids.mia}/role`, { role: 'manager' })).status, 200);

  // At T0: Mia's laptop sends its job (last moved an hour before); Sam's sends one and then closes.
  await up(s, mia.token, [['job-list', { jobs: [row('mia-tidy', 'Tidy the settings', { updatedAt: at(T0 - 60 * MIN) })] }]]);
  await up(s, sam.token, [['hello', { name: 'Sam’s laptop', os: 'Windows', version: '0.1.0' }], ['job-list', { jobs: [row('sam-quiet', 'A quiet job', { updatedAt: at(T0) })] }]]);

  // Twenty minutes on: Olive's laptop comes on with two running jobs and one done; Mia's laptop is
  // still on but nothing has happened there; Sam's laptop hasn't called in since T0.
  s.clock.t = T0 + 20 * MIN;
  await up(s, olive.token, [
    ['hello', { name: 'Olive’s Mac', os: 'macOS', version: '0.1.0' }],
    ['job-list', { jobs: [
      row('orbit-479-tidy-button', 'Tidy button', { ticket: 'ORBIT-479', stage: 'review', state: 'in-review', updatedAt: at(T0 + 19 * MIN) }),
      row('add-export', 'Add export', { updatedAt: at(T0 + 18 * MIN) }),
      row('old-thing', 'Old thing', { state: 'done', updatedAt: at(T0 + 2 * MIN) }),
    ] }],
  ]);
  await seen(s, mia.token);
  return { s, olive, mia, sam, ids };
}

test('the Lounge answers only the fields G13 allows: this list is every field, so an addition fails until decided on', async () => {
  const { s, olive } = await threePeople();
  try {
    const body = await lounge(olive.person);
    // Every field, at every level.
    assert.deepEqual(Object.keys(body).sort(), ['activeMinutes', 'people']);
    assert.equal(body.activeMinutes, 15);
    for (const p of body.people) assert.deepEqual(Object.keys(p).sort(), ['id', 'jobs', 'lastActiveAt', 'name', 'presence', 'you']);
    const p = byName(body);
    const theirJob = ['stage', 'ticket', 'title'];
    const myJob = ['slug', 'stage', 'ticket', 'title'];
    for (const j of p['Olive Owner'].jobs) assert.deepEqual(Object.keys(j).sort(), myJob);
    for (const j of p['Mia Member'].jobs) assert.deepEqual(Object.keys(j).sort(), theirJob);

    // What each person shows.
    assert.deepEqual(body.people.map((x) => x.name), ['Mia Member', 'Olive Owner', 'Sam Sample']);
    assert.deepEqual({ ...p['Olive Owner'], id: 0 }, {
      id: 0, name: 'Olive Owner', you: true, presence: 'online', lastActiveAt: at(T0 + 20 * MIN),
      jobs: [
        { ticket: null, title: 'Add export', stage: 'implement', slug: 'add-export' },
        { ticket: 'ORBIT-479', title: 'Tidy button', stage: 'review', slug: 'orbit-479-tidy-button' },
      ],
    });
    assert.deepEqual({ ...p['Mia Member'], id: 0 }, {
      id: 0, name: 'Mia Member', you: false, presence: 'away', lastActiveAt: at(T0),
      jobs: [{ ticket: null, title: 'Tidy the settings', stage: 'implement' }],
    });
    // Off: no laptop on, so nothing is running there.
    assert.deepEqual({ ...p['Sam Sample'], id: 0 }, { id: 0, name: 'Sam Sample', you: false, presence: 'off', lastActiveAt: at(T0), jobs: [] });

    // Never: emails, laptop names, what a job is doing, its lane or its words, a done job.
    const text = JSON.stringify(body);
    for (const never of ['@', 'example.test', 'Olive’s Mac', 'Mia’s laptop', 'Writing the tests', 'Working:', 'in-review', 'Old thing', 'macOS', '"role"', '"email"', '"now"', '"state"']) {
      assert.ok(!text.includes(never), `The Lounge must not carry “${never}”: ${text}`);
    }
  } finally { await s.close(); }
});

test('everyone signed in gets the same Lounge, whatever their role; only your own jobs carry their slug', async () => {
  const { s, olive, mia, sam } = await threePeople();
  try {
    // Each asking marks them as on the site; ask once each, then compare a second round at one time.
    for (const b of [olive, mia, sam]) await lounge(b.person);
    const views = await Promise.all([olive, mia, sam].map((b) => lounge(b.person)));
    const plain = (body) => body.people.map(({ you: _you, jobs, ...rest }) => ({ ...rest, jobs: jobs.map(({ slug: _slug, ...j }) => j) }));
    assert.deepEqual(plain(views[1]), plain(views[0]), 'the manager sees what the owner sees');
    assert.deepEqual(plain(views[2]), plain(views[0]), 'a member sees what the owner sees');
    // `you` is the asker alone, and slugs are on the asker's own jobs only.
    views.forEach((v, i) => {
      const me = ['Olive Owner', 'Mia Member', 'Sam Sample'][i];
      for (const p of v.people) {
        assert.equal(p.you, p.name === me);
        for (const j of p.jobs) assert.equal('slug' in j, p.name === me, `${me} looking at ${p.name}’s ${j.title}`);
      }
    });
    // Signed out: nothing.
    assert.equal((await browser(s.fetch).json('/api/lounge')).status, 401);
  } finally { await s.close(); }
});

test('online, away and off follow what happens: quiet for 15 minutes is away, a laptop unseen for a minute is off', async () => {
  const s = await makeSite({ clock: { t: T0 } });
  const olive = await paired(s, 'olive.owner@example.test', 'Olive’s Mac');
  const sam = await paired(s, 'sam.sample@example.test', 'Sam’s laptop');
  const samIs = async () => byName(await lounge(olive.person))[(await s.db.query("SELECT name FROM people WHERE email LIKE 'sam.%'")).rows[0].name];
  try {
    // Sam's laptop comes on: online.
    await up(s, sam.token, [['hello', { name: 'Sam’s laptop', os: 'Windows', version: '0.1.0' }], ['job-list', { jobs: [row('route-sharing', 'Route sharing', { updatedAt: at(T0) })] }]]);
    assert.equal((await samIs()).presence, 'online');
    // Sixteen quiet minutes, the laptop still calling in: away, its job still listed.
    s.clock.t = T0 + 16 * MIN;
    await seen(s, sam.token);
    let sam1 = await samIs();
    assert.equal(sam1.presence, 'away');
    assert.deepEqual(sam1.jobs.map((j) => j.title), ['Route sharing']);
    assert.equal(sam1.lastActiveAt, at(T0));
    // The job moves: online again.
    await up(s, sam.token, [['status', row('route-sharing', 'Route sharing', { stage: 'test', updatedAt: at(T0 + 16 * MIN) }), 'route-sharing']]);
    sam1 = await samIs();
    assert.equal(sam1.presence, 'online');
    assert.deepEqual(sam1.jobs, [{ ticket: null, title: 'Route sharing', stage: 'test' }]);
    // The laptop closes (not seen for over a minute): off, and nothing is running there.
    s.clock.t = T0 + 18 * MIN;
    sam1 = await samIs();
    assert.equal(sam1.presence, 'off');
    assert.deepEqual(sam1.jobs, []);
    assert.equal(sam1.lastActiveAt, at(T0 + 16 * MIN));
    // Sam opens the Lounge from a phone: online, on the site; still nothing running.
    await lounge(sam.person);
    sam1 = await samIs();
    assert.equal(sam1.presence, 'online');
    assert.equal(sam1.lastActiveAt, at(T0 + 18 * MIN));
    assert.deepEqual(sam1.jobs, []);
    // A decision made on the laptop counts too.
    s.clock.t = T0 + 60 * MIN;
    await up(s, sam.token, [['audit', { at: at(T0 + 59 * MIN), who: 'Sam, on the laptop', from: 'laptop', action: 'approve', job: 'route-sharing', outcome: 'done' }, 'route-sharing']]);
    sam1 = await samIs();
    assert.equal(sam1.lastActiveAt, at(T0 + 59 * MIN));
    assert.equal(sam1.presence, 'online');
    // A laptop clock that runs ahead is never "later than now".
    await up(s, sam.token, [['job-list', { jobs: [row('route-sharing', 'Route sharing', { updatedAt: at(T0 + 5 * 60 * MIN) })] }]]);
    sam1 = await samIs();
    assert.equal(sam1.lastActiveAt, at(T0 + 60 * MIN));
    assert.equal(sam1.presence, 'online');
  } finally { await s.close(); }
});

test('a removed laptop’s jobs leave the Lounge; a person with no laptop and no name still has a row', async () => {
  const s = await makeSite({ clock: { t: T0 } });
  const olive = await paired(s, 'olive.owner@example.test', 'Olive’s Mac');
  const nia = browser(s.fetch);
  await (await import('./helpers.js')).signIn(nia, { email: 'nia.new@example.test' });
  try {
    await s.db.query("UPDATE people SET name = '' WHERE email LIKE 'nia.%'");
    await up(s, olive.token, [['job-list', { jobs: [row('add-export', 'Add export', { updatedAt: at(T0) })] }]]);
    let body = await lounge(olive.person);
    const mine = body.people.find((p) => p.you);
    assert.deepEqual(mine.jobs.map((j) => j.title), ['Add export']);
    const nobody = body.people.find((p) => !p.you);
    assert.equal(nobody.name, '');
    assert.deepEqual(nobody.jobs, []);
    const laptopId = (await olive.person.json('/api/laptops')).body.laptops[0].id;
    assert.equal((await olive.person.send('DELETE', `/api/laptops/${laptopId}`, {})).status, 200);
    body = await lounge(olive.person);
    assert.deepEqual(body.people.find((p) => p.you).jobs, []);
  } finally { await s.close(); }
});
