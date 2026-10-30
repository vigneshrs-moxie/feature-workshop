// The site's own check of every event a runner sends up, before it is stored (plan §2.4).
// The runner already made each one with lib/protocol.js makeEvent (known types only, no diff,
// patch, env, token or source key at any depth, every string scrubbed of tokens). The site doesn't
// trust that: it runs makeEvent again on what arrived, and stores the event only when that is
// accepted and changes nothing. An event a scrub would have changed (a token the runner failed
// to hide) is refused whole, never scrubbed here and kept.

import { makeEvent } from '../../dashboard/lib/protocol.js';

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const EID = /^[\w-]{1,64}$/;
const JOB = (v) => v === null || (typeof v === 'string' && v.length > 0 && v.length <= 300 && !/[/\\\0]/.test(v) && v !== '.' && v !== '..');

/** { ok: true, event: { eid, type, job, data } } or { ok: false, error } in plain words. */
export function checkStoredEvent(raw) {
  if (!isPlain(raw)) return { ok: false, error: 'An event must be a set of named fields.' };
  if (typeof raw.eid !== 'string' || !EID.test(raw.eid)) return { ok: false, error: 'An event needs its own id.' };
  const job = raw.job ?? null;
  if (!JOB(job)) return { ok: false, error: 'An event’s job must be a job’s name.' };
  if (!isPlain(raw.data)) return { ok: false, error: 'An event’s data must be a set of named fields.' };
  const made = makeEvent(raw.type, raw.data, { job });
  if (!made.ok) return { ok: false, error: made.error };
  if (JSON.stringify(made.event.data) !== JSON.stringify(raw.data)) {
    return { ok: false, error: 'An event carried something that looks like a token or a secret, so it wasn’t stored.' };
  }
  return { ok: true, event: { eid: raw.eid, type: made.event.type, job, data: raw.data } };
}
