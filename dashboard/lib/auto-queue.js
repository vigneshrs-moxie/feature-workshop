// The Auto queue (design sections 2 to 4): what the snapshot carries to the laptop's pages and,
// through the board record, to the website. Pure: the board cards, the Inbox's items and the
// starter's memory are given.
//
// AutoQueue  { on, tag, max, working, unfinished, ceiling, paused, testing, tickets }
//   on, tag, max   Auto start's setting (max is N, how many work at once)
//   working        open jobs whose Auto is on and not stopped (each holds one of the N places)
//   unfinished     open jobs whose Auto is on, stopped or not (against the ceiling)
//   ceiling        AUTO_CEILING (10)
//   paused         why Auto start is paused: 'limit' | 'limit-reading' | 'orbit' | 'memory' | null
//   testing        the slug of the job holding the test place, else null
//   tickets        the Inbox's Auto groups, in the Inbox's order:
//                  { key, title, group: 'next' | 'working' | 'too-big' | 'failed', slug, reason }
// It never carries a database address, and no key is named diff, patch, env, token or source.

import { AUTO_CEILING, countAuto, normalizeAutoStart, startsByItself } from './auto-start.js';

const PAUSED = new Set(['limit', 'limit-reading', 'orbit', 'memory']);

/**
 * One Inbox item's place in the Auto queue, or null when it is not listed. A ticket with a job is
 * listed by its job, whatever its tags now (a started job stays an Auto job): too-big when the job is
 * set aside, working when its Auto group is working or needs-you (a stopped job), else not listed
 * (ready, or in Yours). A ticket with no job: failed when its start failed and it is still his, open
 * and tagged (removing the tag or the assignment takes it off the list); next when it would start by
 * itself and never had a job (hadJobs; while that is not known yet, nothing is next).
 */
function ticketOf(item, { s, bySlug, failedBy, memory, hadJobs }) {
  const base = { key: item.key, title: item.title ?? item.key };
  if (item.job) {
    const auto = bySlug.get(item.job.slug)?.auto;
    if (!auto) return null;
    if (auto.tooBig) return { ...base, group: 'too-big', slug: item.job.slug, reason: auto.tooBig.reason ?? null };
    if (auto.group === 'working' || auto.group === 'needs-you') return { ...base, group: 'working', slug: item.job.slug, reason: null };
    return null;
  }
  if (failedBy.has(item.key)) {
    // The starter's own rule with Auto start taken as on and nothing tried: assigned, open, tagged.
    const stillTagged = startsByItself(item, { ...s, on: true }, { started: [], failed: [] });
    return stillTagged ? { ...base, group: 'failed', slug: null, reason: failedBy.get(item.key) } : null;
  }
  if (hadJobs && !hadJobs.has(item.key) && startsByItself(item, s, memory)) return { ...base, group: 'next', slug: null, reason: null };
  return null;
}

/**
 * The queue. Pure.
 *   setting  Auto start's setting ({ on, tag, max }; normalized here)
 *   paused   as the runner's autoStartView gives it
 *   cards    the board cards ({ slug, title, closed, auto }, auto as lib/auto.js autoCardView); closed ones count in no place
 *   items    the Inbox's items with their open job (the runner's withJobs: job { slug, title } or null)
 *   failed   the starter's failed starts, [{ key, reason }]
 *   started  the tickets the starter started, [{ key }]: never next again
 *   hadJobs  the ticket keys that have or had a job, closed ones too (the starter's last pass), or null
 *            while the starter has not looked yet: then nothing is next
 *   places   { working, unfinished } as the starter counts them (the runner's autoPlaces); when not
 *            given, counted from the cards
 *   testing  the slug holding the test place, else null
 */
export function autoQueueView({ setting, paused = null, cards = [], items = [], failed = [], started = [], hadJobs = [], places = null, testing = null } = {}) {
  const s = normalizeAutoStart(setting);
  const open = (cards ?? []).filter((c) => c && !c.closed);
  const { working, unfinished } = places && Number.isInteger(places.working) && Number.isInteger(places.unfinished)
    ? places : countAuto(open.map((c) => c.auto));
  const bySlug = new Map((cards ?? []).filter((c) => c?.slug).map((c) => [c.slug, c]));
  const fails = (failed ?? []).filter((e) => e && typeof e.key === 'string');
  const failedBy = new Map(fails.map((e) => [e.key, typeof e.reason === 'string' ? e.reason : null]));
  const memory = { started: (started ?? []).filter((e) => e && typeof e.key === 'string'), failed: fails };
  const had = Array.isArray(hadJobs) ? new Set(hadJobs) : null;
  const tickets = [];
  for (const item of items ?? []) {
    if (!item || typeof item.key !== 'string') continue;
    const t = ticketOf(item, { s, bySlug, failedBy, memory, hadJobs: had });
    if (t) tickets.push(t);
  }
  return {
    on: s.on, tag: s.tag, max: s.max,
    working, unfinished, ceiling: AUTO_CEILING,
    paused: PAUSED.has(paused) ? paused : null,
    testing: typeof testing === 'string' && testing ? testing : null,
    tickets,
  };
}
