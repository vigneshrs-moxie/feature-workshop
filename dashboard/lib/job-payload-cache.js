// The new job page's warm cache (the job page rebuild, Task 4; plan "Speed rules" 6). One entry per
// job the page has opened: { v, payload, sources, html }. The runner rebuilds an entry when it sees
// that job change (the same moments it sends `thread`, `run` status, `permission`, `gate-stale`,
// `evidence` and `change`: runner/index.js), 150 ms after the last change and never more than 1 s
// behind a stream of them. A request is answered from the entry as it is: no database query, no
// psql, no git, no read of an agent's log, and no rebuild.
//
//   jobPageCache({ build, onVersion, log })
//     build(slug)          → null (no such job) | { payload, sources }: the payload (lib/job-payload.js
//                            buildJobPage) and one source per body the page may fetch (itemSources)
//     onVersion(slug, v)   called when a job's v goes up (the runner sends SSE `job-page` { slug, v })
//   .page(slug, v?)        the payload, or { same: true, v } when v is the current one
//   .item(slug, id)        one body: { id, kind, version, html, text, meta }; its html is rendered on the
//                          first ask and kept until its version changes
//   .touch(slug)           the job changed: rebuild it (only when it is in the cache)
//   .touchAll()            something changed that names no job: rebuild the jobs opened in the last
//                          10 minutes; the others are rebuilt behind their next request
//   .has(slug), .stats() → { builds, renders, jobs }, .close()
//
// `v` goes up by one only when the payload's JSON (without its own v) changed; a job's last v is kept
// when its entry goes, so a page never sees a v used for other content.
//
// The first request for a job not in the cache waits for that job's first build (the one time a
// request starts a build: there is nothing to answer from yet). Every later request answers at once.

import { createHash } from 'node:crypto';
import { HttpError } from './http-guard.js';

export const REBUILD_DELAY_MS = 150;
export const REBUILD_MAX_WAIT_MS = 1000;
/** A job asked for in the last 10 minutes counts as open: a change that names no job rebuilds it. */
export const OPEN_MS = 10 * 60 * 1000;
/** At most this many jobs are kept; the one asked for longest ago goes first. */
export const MAX_JOBS = 16;

const NO_JOB = 'No job by that name.';
const NO_ITEM = 'That isn’t on this job’s page. Reload the job.';

const hashOf = (text) => createHash('sha1').update(String(text ?? '')).digest('hex').slice(0, 12);

/** @param {{ build: (slug: string) => Promise<null | { payload: object, sources: Map<string, object> }>, onVersion?: Function, log?: Function, delayMs?: number, maxWaitMs?: number, openMs?: number, maxJobs?: number }} o */
export function jobPageCache({ build, onVersion = () => {}, log = console.error, delayMs = REBUILD_DELAY_MS, maxWaitMs = REBUILD_MAX_WAIT_MS, openMs = OPEN_MS, maxJobs = MAX_JOBS }) {
  const entries = new Map(); // slug -> entry
  const versions = new Map(); // slug -> the last v given (kept when the entry goes)
  let builds = 0;
  let renders = 0;

  function entryFor(slug) {
    const e = {
      slug, v: 0, payload: null, json: null, sources: new Map(), html: new Map(), seenAt: Date.now(), stale: false,
      timer: null, firstAt: null, building: null, again: false, endedAt: null, lastMs: 0,
    };
    e.ready = new Promise((resolve, reject) => { e.resolve = resolve; e.reject = reject; });
    e.ready.catch(() => {}); // a first build that fails is answered to its waiters, never left unhandled
    return e;
  }

  function apply(e, { payload, sources }) {
    const { v: _own, ...rest } = payload ?? {};
    const json = JSON.stringify(rest);
    let moved = false;
    if (json !== e.json) {
      e.v = (versions.get(e.slug) ?? 0) + 1;
      versions.set(e.slug, e.v);
      e.json = json;
      e.payload = { v: e.v, ...rest };
      moved = true;
    }
    // Rendered bodies whose version is unchanged are kept; the rest go.
    const next = sources instanceof Map ? sources : new Map();
    const html = new Map();
    for (const [id, s] of next) {
      const key = `${id}\n${s.version}`;
      if (e.html.has(key)) html.set(key, e.html.get(key));
    }
    e.sources = next;
    e.html = html;
    e.resolve();
    if (moved) {
      try { onVersion(e.slug, e.v); } catch (err) { log(`job page: ${err.message}`); }
    }
  }

  function drop(e) {
    clearTimeout(e.timer);
    if (entries.get(e.slug) === e) entries.delete(e.slug);
  }

  function run(e) {
    clearTimeout(e.timer);
    e.timer = null;
    e.firstAt = null;
    if (e.building) { e.again = true; return e.building; }
    const started = Date.now();
    builds++;
    e.building = (async () => {
      let out;
      try {
        out = await build(e.slug);
      } catch (err) {
        log(`job page: ${e.slug} couldn’t be rebuilt: ${err.message}`);
        // What the page already has stays; a first build that fails is the waiters' error, tried again next time.
        if (!e.payload) { drop(e); e.reject(err); }
        return;
      }
      if (entries.get(e.slug) !== e) return; // pushed out meanwhile
      if (!out) { drop(e); e.reject(new HttpError(404, NO_JOB)); return; }
      apply(e, out);
    })().finally(() => {
      e.building = null;
      e.endedAt = Date.now();
      e.lastMs = e.endedAt - started;
      if (e.again && entries.get(e.slug) === e) { e.again = false; schedule(e); }
    });
    return e.building;
  }

  function schedule(e) {
    const now = Date.now();
    e.firstAt ??= now;
    let wait = Math.min(delayMs, Math.max(0, e.firstAt + maxWaitMs - now));
    // A slow build is not started again at once: at least its own length (up to the max wait) after the last one ended.
    if (e.endedAt !== null) wait = Math.max(wait, Math.min(e.lastMs, maxWaitMs) - (now - e.endedAt));
    clearTimeout(e.timer);
    e.timer = setTimeout(() => { run(e); }, Math.max(0, wait));
    e.timer.unref?.();
  }

  /** Asked for: counts as open; one that went quiet and missed a change rebuilds behind this answer. */
  function seen(e) {
    e.seenAt = Date.now();
    if (e.stale) { e.stale = false; schedule(e); }
  }

  function trim() {
    while (entries.size > maxJobs) {
      let oldest = null;
      for (const e of entries.values()) if (!oldest || e.seenAt < oldest.seenAt) oldest = e;
      drop(oldest);
    }
  }

  async function warm(slug) {
    let e = entries.get(slug);
    if (!e) {
      e = entryFor(slug);
      entries.set(slug, e);
      trim();
      run(e);
    } else {
      seen(e);
    }
    if (!e.payload) await e.ready;
    return e;
  }

  return {
    async page(slug, v = null) {
      const e = await warm(slug);
      return v === e.v ? { same: true, v: e.v } : e.payload;
    },
    async item(slug, id) {
      const e = await warm(slug);
      const s = e.sources.get(id);
      if (!s) throw new HttpError(404, NO_ITEM);
      const key = `${id}\n${s.version}`;
      let html = e.html.get(key);
      if (html === undefined) {
        renders++;
        html = s.html();
        e.html.set(key, html);
      }
      return { id, kind: s.kind, version: s.version, html, text: s.text, meta: s.meta };
    },
    touch(slug) {
      const e = slug ? entries.get(slug) : null;
      if (e) schedule(e);
    },
    touchAll() {
      const now = Date.now();
      for (const e of entries.values()) {
        if (now - e.seenAt <= openMs) schedule(e);
        else e.stale = true;
      }
    },
    has: (slug) => entries.has(slug),
    stats: () => ({ builds, renders, jobs: entries.size }),
    close() { for (const e of entries.values()) clearTimeout(e.timer); },
  };
}

// ---------- The bodies ----------

const DETAIL_FILE = /^briefs\/(\d+)-(?:.+-)?detail\.md$/;
const BODY_KEYS = new Set(['reply', 'text', 'html']);
const metaOf = (it) => Object.fromEntries(Object.entries(it).filter(([k]) => !BODY_KEYS.has(k)));

/**
 * One source per body the page may fetch by id (the item route), from what a rebuild read:
 *   - every conversation item (lib/thread.js buildThread, whole): a reply's markdown, a brief's file
 *     text (briefTexts: file -> text), his message, a note; versioned by its payload line's hash;
 *     a detail brief (folded out of the payload) by its own id, named on its brief as meta.detail
 *   - every document a step shows (docs: { file, name, type, text, updatedAt, size, summary }), id its
 *     file, versioned by its text
 *   - 'decisions': what was decided for him (and what Auto decided), one line each
 * Each is { kind, version, text, meta, html() }; html() renders (render(text, { json })) and is called
 * only when the body is first asked for.
 * @param {{ payload: object, thread?: object[], briefTexts?: Map<string, string>, docs?: object[], decided?: object[], autoDecided?: object[], render: (text: string, o?: { json?: boolean }) => string }} o
 */
export function itemSources({ payload, thread = [], briefTexts = new Map(), docs = [], decided = [], autoDecided = [], render }) {
  const sources = new Map();
  const lines = new Map((payload?.thread ?? []).map((l) => [l.id, l]));
  const items = (Array.isArray(thread) ? thread : []).filter((it) => it && typeof it === 'object' && it.id != null);
  const detailOf = new Map();
  for (const it of items) {
    const m = it.kind === 'brief' ? DETAIL_FILE.exec(String(it.file ?? '')) : null;
    if (m) detailOf.set(Number(m[1]), String(it.id));
  }
  for (const it of items) {
    const id = String(it.id);
    const line = lines.get(id);
    const text = it.kind === 'reply' ? String(it.reply ?? '') : it.kind === 'brief' ? String(briefTexts.get(it.file) ?? '') : typeof it.text === 'string' ? it.text : '';
    const meta = { ...metaOf(it), step: line?.step ?? null };
    if (line && 'answered' in line) meta.answered = line.answered;
    if (it.kind === 'brief' && !DETAIL_FILE.test(String(it.file ?? '')) && detailOf.has(it.number)) meta.detail = detailOf.get(it.number);
    sources.set(id, { kind: line?.kind ?? (it.kind === 'brief' ? 'brief' : 'small'), version: line?.hash ?? hashOf(text), text, meta, html: () => render(text) });
  }
  const shown = new Map();
  for (const step of payload?.steps ?? []) for (const o of step.outputs ?? []) if (o.kind === 'doc' && !shown.has(o.id)) shown.set(o.id, { version: o.version, step: step.id });
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || typeof d.text !== 'string') continue;
    const id = String(d.file);
    const json = d.type === 'json';
    sources.set(id, {
      kind: 'doc', version: hashOf(d.text), text: d.text,
      meta: { name: d.name ?? id, type: json ? 'json' : 'md', updatedAt: d.updatedAt ?? null, size: d.size ?? null, summary: d.summary ?? null, version: shown.get(id)?.version ?? null, step: shown.get(id)?.step ?? null },
      html: () => render(d.text, { json }),
    });
  }
  const rows = [...(Array.isArray(decided) ? decided : []), ...(Array.isArray(autoDecided) ? autoDecided : [])];
  const text = rows.map((r) => {
    const what = String(r?.decision ?? r?.chose ?? r?.text ?? '').trim();
    const why = String(r?.reason ?? r?.why ?? '').trim();
    return `- ${what}${why ? ` — ${why}` : ''}`;
  }).join('\n');
  sources.set('decisions', { kind: 'decisions', version: hashOf(text), text, meta: { rows }, html: () => render(text) });
  return sources;
}
