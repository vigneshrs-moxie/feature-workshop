// ---------- Stacks (packet K): /api/stacks/* (runner/stacks.js, lib/stack.js) ----------
// A big job split into sections that run side by side, merged in order into the stack's branch,
// pushed only on your go. The queue and the merges are the runner's (local mode only): this is the
// Stack page's half.
//   GET  /api/stacks                       every stack in a line each, and the global cap; each line
//                                          also carries its card on the Stacks home (packet V)
//   GET  /api/stacks/:slug                 one stack: its steps, its sections in merge order, what's
//                                          next; and each part's lane, now line, cost, waits on and
//                                          unblocks, the stack's risks, its ask and its times (packet V)
//   GET  /api/stacks/:slug/part/:n         a part's own page: its place, its history, its merge
//                                          checklist and its changed files (packet V)
//   GET  /api/stacks/:slug/part/:n/diff?file=  one changed file's diff against the stack's branch (read-only)
//   POST /api/stacks/cap                   { cap: 3 }  sections at once across every stack (Settings → Workflow)
//   POST /api/stacks/:slug/approve-plan    { cap?, autoIntegrate?, model?, effort? }  approve stack.md: the sections start
//   POST /api/stacks/:slug/settings        { cap?, autoIntegrate?, model?, effort? }
//   POST /api/stacks/:slug/merge           { section? }  your yes to merging the next section (202; the view shows it)
//   POST /api/stacks/:slug/send-back       { section?, note? }  back to a section's Foreman, or a plan change to the coordinator
//   POST /api/stacks/:slug/push            { go: true | false, note? }  pushing waits for this, always
//   POST /api/stacks/:slug/check           look at the stack now (it looks every few seconds anyway)
//
// Packet V's fields are added from the part jobs' cards (read.features(): who is at work and on
// what) and Telemetry's record (usage.jsonl: what each part's job cost), by lib/stack-parts.js. The
// changed files come from git, read-only, through the reader the view carries (lib/stack.js
// withChanges, view.readChanges): this side never runs git itself.

import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../lib/http-guard.js';
import { enrichView, partPage, stackCard, usageByJob } from '../lib/stack-parts.js';
import { USAGE_FILE, parseLine, usageDir } from '../lib/usage-log.js';

const ONE = /^\/api\/stacks\/([a-z0-9][a-z0-9._-]{0,199})(?:\/([a-z-]+))?$/;
const PART = /^\/api\/stacks\/([a-z0-9][a-z0-9._-]{0,199})\/part\/([1-9]\d{0,2})(\/diff)?$/;
const ACTIONS = new Set(['approve-plan', 'settings', 'merge', 'send-back', 'push', 'check']);
/** How long the jobs' cards are reused between pages' looks, in ms. */
const FRESH_MS = 1500;

/**
 * The live half of the Stack pages: the part jobs' cards by slug, and Telemetry's record added up
 * by job. The cards are read at most once every FRESH_MS; the record again only when it changed.
 */
export function liveReader({ read = null, usageFile = null, now = () => Date.now() } = {}) {
  let cards = { at: -Infinity, value: new Map() };
  let usage = { key: null, value: usageByJob([]) };
  async function readCards() {
    if (!read?.features) return new Map();
    if (now() - cards.at < FRESH_MS) return cards.value;
    try {
      const r = await read.features();
      cards = { at: now(), value: new Map((r?.features ?? []).map((c) => [c.slug, c])) };
    } catch { cards = { at: now(), value: cards.value }; }
    return cards.value;
  }
  async function readUsage() {
    const file = usageFile ?? path.join(usageDir({ stateDir: process.env.WORKSHOP_STATE_DIR || null }), USAGE_FILE);
    const st = await fs.stat(file).catch(() => null);
    if (!st) return usageByJob([]);
    const key = `${st.mtimeMs}:${st.size}`;
    if (usage.key === key) return usage.value;
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    usage = { key, value: usageByJob(text.split('\n').map(parseLine).filter(Boolean)) };
    return usage.value;
  }
  return async () => ({ cards: await readCards(), usage: await readUsage(), now: now() });
}

export default function stacksRoutes({ local, read = null, sendJson, readBody, checkWrite, usageFile = null }) {
  const stacks = local?.stacks ?? null;
  const live = liveReader({ read, usageFile });
  // A POST's answer is a view (or { view }): it gets the same fields as GET, so the page never loses them.
  const withLive = async (r) => (r?.parts ? enrichView(r, await live()) : r?.view?.parts ? { ...r, view: enrichView(r.view, await live()) } : r);

  async function routeStacks(req, res, urlPath, url) {
    try {
      if (!stacks) throw new HttpError(404, 'Stacks run only on the dashboard on your own computer.');
      if (req.method === 'GET') {
        if (urlPath === '/api/stacks') {
          const list = await stacks.list();
          const l = await live();
          return sendJson(res, 200, { ...list, stacks: (list.stacks ?? []).map((s) => stackCard(s, l)) });
        }
        const p = PART.exec(urlPath);
        if (p) {
          const [, slug, nText, diff] = p;
          const raw = await stacks.view(slug);
          const view = enrichView(raw, await live());
          const page = partPage(view, Number(nText));
          if (!page) throw new HttpError(404, `This stack has no part ${nText}.`);
          const name = page.part.name;
          const reader = raw.readChanges ?? null;
          if (diff) {
            if (!reader) return sendJson(res, 200, { error: 'This dashboard can’t show a part’s changes.' });
            return sendJson(res, 200, await reader.diff(name, url?.searchParams?.get('file') ?? ''));
          }
          const changes = reader
            ? await reader.files(name).catch((err) => ({ error: String(err?.message ?? err).split('\n')[0], files: [], added: 0, removed: 0 }))
            : { error: 'This dashboard can’t list a part’s changed files.', files: [], added: 0, removed: 0 };
          return sendJson(res, 200, { ...page, changes });
        }
        const m = ONE.exec(urlPath);
        if (m && !m[2]) return sendJson(res, 200, enrichView(await stacks.view(m[1]), await live()));
        throw new HttpError(404, 'Not found');
      }
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
      checkWrite(req);
      const body = await readBody(req);
      if (urlPath === '/api/stacks/cap') return sendJson(res, 200, { settings: await stacks.setGlobalCap(body.cap), ...(await stacks.list()) });
      const m = ONE.exec(urlPath);
      if (!m || !m[2] || !ACTIONS.has(m[2])) throw new HttpError(404, 'Not found');
      const [, slug, action] = m;
      if (action === 'approve-plan') return sendJson(res, 200, await withLive(await stacks.approvePlan(slug, body)));
      if (action === 'settings') return sendJson(res, 200, await withLive(await stacks.settings(slug, body)));
      if (action === 'merge') return sendJson(res, 202, await withLive(await stacks.merge(slug, body)));
      if (action === 'send-back') return sendJson(res, 200, await withLive(await stacks.sendBack(slug, body)));
      if (action === 'push') return sendJson(res, 200, await withLive(await stacks.push(slug, body)));
      await stacks.view(slug); // 404 when there is no such stack
      await stacks.tick();
      return sendJson(res, 200, await withLive(await stacks.view(slug)));
    } catch (err) {
      throw stacks ? stacks.httpError(err) : err;
    }
  }

  return { owns: (urlPath) => urlPath === '/api/stacks' || urlPath.startsWith('/api/stacks/'), mount: routeStacks };
}
