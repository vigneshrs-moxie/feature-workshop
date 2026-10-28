// A job's routes: its page and documents, and everything you do to it (a new job, a message, a gate
// decision, a permission, pausing and steering a reply, closing, options, Try it, notes). Each change
// is one command to the runner (lib/protocol.js); what is read here is only the page's request,
// checked and shaped into that command, with the same refusals as before.

import { HttpError } from '../lib/http-guard.js';
import { NUDGE_IDS } from '../lib/nudges.js';
import { MAX_CHIPS } from '../lib/compose.js';
import { NOTES_MAX } from '../lib/protocol.js';

const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');

// ---------- Reading what the page sent (…/send and …/gate) ----------

// The gate card's body, checked: kind, the brief it answers, at most 3 answers, 20 verdicts,
// MAX_CHIPS chips and a 4,000-character note. Anything off is a 400, and nothing is sent.
const GATE_KINDS = ['approve', 'changes', 'message', 'stop'];
const GATE_NOTE_MAX = 4000;
function byId(v, max, what, each) {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, `${what}: expected them by id.`);
  const entries = Object.entries(v);
  if (entries.length > max) throw new HttpError(400, `${what}: at most ${max}.`);
  return Object.fromEntries(entries.map(([k, x]) => {
    if (k.length > 100 || !x || typeof x !== 'object' || Array.isArray(x)) throw new HttpError(400, `${what}: one of them isn’t readable.`);
    return [k, each(x)];
  }));
}
// A brief number from the page (1–99,999), or null when none is given.
function readBriefNumber(v) {
  if (v === undefined || v === null) return null;
  if (!Number.isInteger(v) || v < 1 || v > 99999) throw new HttpError(400, 'That isn’t a brief number.');
  return v;
}
function readGateBody(body) {
  const kind = GATE_KINDS.includes(body.kind) ? body.kind : null;
  if (!kind) throw new HttpError(400, 'Unknown decision: approve, changes, message or stop.');
  const briefNumber = readBriefNumber(body.briefNumber);
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') throw new HttpError(400, 'The note must be text.');
  const note = body.note ?? '';
  if (note.length > GATE_NOTE_MAX) throw new HttpError(400, `The note is too long (at most ${GATE_NOTE_MAX.toLocaleString('en')} characters).`);
  if (kind === 'changes' && !note.trim()) throw new HttpError(400, 'Say what to change.');
  const answers = byId(body.answers, 3, 'Answers', (a) => ({ ...(str(a.choice, 100) ? { choice: str(a.choice, 100) } : {}), ...(str(a.other, 1000) ? { other: str(a.other, 1000) } : {}) }));
  const verdicts = byId(body.verdicts, 20, 'Verdicts', (v) => {
    if (!['confirm', 'change'].includes(v.verdict)) throw new HttpError(400, 'Verdicts: confirm or change.');
    return { verdict: v.verdict, ...(str(v.note, 1000) ? { note: str(v.note, 1000) } : {}) };
  });
  if (body.chips !== undefined && body.chips !== null && !Array.isArray(body.chips)) throw new HttpError(400, 'Chips: expected a list.');
  const chips = body.chips ?? [];
  if (chips.length > MAX_CHIPS) throw new HttpError(400, `Chips: at most ${MAX_CHIPS}.`);
  // Chips change how the next stage runs; a stop has no next stage.
  if (kind === 'stop' && chips.length) throw new HttpError(400, 'A stop can’t carry option changes.');
  // "Edit, then approve": the reply as you edited it, sent instead of the composed one (the chips
  // still change the options). Approvals only; the same 20,000 characters as /send.
  if (body.text !== undefined && body.text !== null && typeof body.text !== 'string') throw new HttpError(400, 'The edited reply must be text.');
  tooLong(body.text, 'The edited reply');
  const edited = str(body.text ?? '').trim() || null;
  if (edited && kind !== 'approve') throw new HttpError(400, 'Only an approval can carry an edited reply.');
  return { kind, briefNumber, note, answers, verdicts, chips, edited, startAfterReset: body.startAfterReset === true };
}

// A reply (…/send text, …/gate edited text) longer than this is refused, not cut short.
const TEXT_MAX = 20000;
function tooLong(v, what) {
  if (typeof v === 'string' && v.length > TEXT_MAX) throw new HttpError(400, `${what} is too long (at most ${TEXT_MAX.toLocaleString('en')} characters).`);
}
// The most text POST /api/job/:slug/render previews at once (characters).
const RENDER_MAX = 100000;

/** What every message to a Foreman may say about how it is sent: the model, despite the limit, no terminal open. */
const sendFields = (body) => ({
  model: typeof body.model === 'string' ? body.model.slice(0, 100) : undefined,
  despiteLimit: body.despiteLimit === true ? true : undefined,
  confirmNoTerminal: body.confirmNoTerminal === true ? true : undefined,
});

export default function jobRoutes({ runner, read, send, sendJson, needJob, wireframesOrigin, LOCAL }) {
  const command = async (res, c) => sendJson(res, 200, await runner.handle(c, LOCAL));
  const post = (path, run) => ({ method: 'POST', path, run });
  return [
    {
      // The job's decisions.md (lib/decisions.js), written again first so it has every decision so
      // far. As JSON for the Decisions tab (the text and "Copy for the ticket"), else the file itself.
      method: 'GET', path: /^\/api\/jobs\/([^/]+)\/decisions\.md$/,
      run: async ({ req, res, m }) => {
        const d = await read.decisionsFile(decodeURIComponent(m[1]));
        if (!String(req.headers.accept ?? '').includes('application/json')) return send(res, 200, d.text, 'text/plain; charset=utf-8', { 'Cache-Control': 'no-store' });
        return sendJson(res, 200, d);
      },
    },
    {
      // The job page and its parts.
      method: 'GET', path: /^\/api\/job\/([^/]+)(\/.*)?$/,
      run: async ({ res, url, m: jm }) => {
        const slug = await needJob(jm[1]);
        const sub = jm[2] ?? '';
        let m;
        // "Load older": only the thread items before the given one.
        if (!sub && url.searchParams.has('before')) return sendJson(res, 200, await read.threadBefore(slug, str(url.searchParams.get('before'), 300)));
        if (!sub) return sendJson(res, 200, await read.job(slug));
        if (sub === '/notes') return sendJson(res, 200, await read.notes(slug));
        // The Decisions tab: every choice you made on this job, newest first (lib/decisions.js).
        if (sub === '/decisions') return sendJson(res, 200, await read.decisions(slug));
        // The Docs tab's list: every document of the job, grouped, with versions and times (lib/docs.js).
        if (sub === '/docs') return sendJson(res, 200, await read.docs(slug));
        if (sub === '/wireframes') {
          // The screens page is never served from this origin: an HTML file a model wrote would share
          // the dashboard's document, storage and token. The screens server serves it instead.
          throw new HttpError(410, `The screens page is served from its own address: ${wireframesOrigin}/job/<slug>/wireframes (meta.wireframesOrigin).`);
        }
        // One document, rendered (sanitised, lib/markdown.js) and as its source text.
        if (sub === '/doc') return sendJson(res, 200, await read.doc(slug, url.searchParams.get('file') ?? ''));
        if ((m = /^\/ids\/([^/]+)$/.exec(sub))) return sendJson(res, 200, await read.ids(slug, decodeURIComponent(m[1])));
        if (sub === '/local') return sendJson(res, 200, await read.localView(slug, { fresh: url.searchParams.get('fresh') === '1' }));
        if (sub === '/commits') return sendJson(res, 200, await read.commits(slug));
        // One commit's diff, for the live view: answered to the asker only.
        if ((m = /^\/commit\/([0-9a-fA-F]{4,40})$/.exec(sub))) return command(res, { type: 'fetch-diff', slug, commit: m[1] });
        throw new HttpError(404, 'Not found');
      },
    },
    post(/^\/api\/job\/([^/]+)\/render$/, async ({ res, m, body }) => {
      // Markdown you are writing (the drawer's notes Preview), rendered by the same sanitising renderer
      // as every document. Nothing is saved or sent anywhere; a POST only so the text isn't in a URL.
      const slug = await needJob(m[1]);
      if (typeof body.text !== 'string') throw new HttpError(400, 'The text to preview must be text.');
      if (body.text.length > RENDER_MAX) throw new HttpError(413, `Too long to preview (at most ${RENDER_MAX.toLocaleString('en')} characters).`);
      return sendJson(res, 200, await read.render(slug, body.text));
    }),
    post(/^\/api\/job\/([^/]+)\/send$/, async ({ res, m, body }) => {
      const slug = await needJob(m[1]);
      tooLong(body.text, 'The message');
      const text = str(body.text).trim();
      if (!text) throw new HttpError(400, 'The message is empty.');
      // gateBrief: a gate reply composed while a reply was in progress (…/gate gave the text back) and
      // sent now; it still answers that brief, so it must still be the current one (as …/gate checks).
      const gateBrief = readBriefNumber(body.gateBrief);
      const kind = str(body.kind, 20) || 'message';
      return command(res, { type: 'reply', slug, via: 'box', text, kind, gateBrief, ...sendFields(body) });
    }),
    post(/^\/api\/job\/([^/]+)\/nudge\/([\w-]+)\/(dismiss|yes)$/, async ({ res, m, body }) => {
      // A hand-off nudge on the Desk (lib/nudges.js): dismiss it, or send its one sentence to the Foreman.
      const slug = await needJob(m[1]);
      if (!NUDGE_IDS.includes(m[2])) throw new HttpError(404, 'No nudge by that name.');
      return command(res, { type: 'nudge', slug, nudge: m[2], answer: m[3], ...sendFields(body) });
    }),
    post(/^\/api\/job\/([^/]+)\/gate$/, async ({ res, m, body }) => {
      // A decision from the gate card: answers, verdicts, next-step chips and a note (readGateBody),
      // composed into the reply by the runner.
      const slug = await needJob(m[1]);
      const g = readGateBody(body);
      const type = { approve: 'approve', changes: 'send-back', stop: 'stop', message: 'reply' }[g.kind];
      return command(res, {
        type, slug, briefNumber: g.briefNumber, note: g.note, answers: g.answers, verdicts: g.verdicts, chips: g.chips, startAfterReset: g.startAfterReset,
        ...(type === 'reply' ? { via: 'card' } : {}), ...(g.edited ? { text: g.edited } : {}), ...sendFields(body),
      });
    }),
    post(/^\/api\/job\/([^/]+)\/takeover$/, async ({ res, m }) => command(res, { type: 'take-over', slug: await needJob(m[1]) })),
    post(/^\/api\/job\/([^/]+)\/repo$/, async ({ res, m, body }) => {
      const slug = await needJob(m[1]);
      return command(res, { type: 'repo', slug, repoPath: str(body.repoPath, 1000), branch: str(body.branch, 200).trim() || null });
    }),
    // One job's own permission setting; null clears it (the job follows your global setting again).
    post(/^\/api\/job\/([^/]+)\/policy$/, async ({ res, m, body }) => command(res, { type: 'policy', slug: await needJob(m[1]), policy: body.policy })),
    post(/^\/api\/job\/([^/]+)\/(close|reopen)$/, async ({ res, m, body }) => {
      const slug = await needJob(m[1]);
      if (m[2] === 'reopen') return command(res, { type: 'reopen', slug });
      return command(res, { type: 'close', slug, as: body.as === 'dropped' ? 'dropped' : 'done', note: str(body.note, 300).trim() || null, removeWorktree: body.removeWorktree === true });
    }),
    post(/^\/api\/job\/([^/]+)\/options$/, async ({ res, m, body }) => {
      const slug = await needJob(m[1]);
      // The new UI's options editor sends the updated_at it loaded; the classic page sends none.
      return command(res, { type: 'options', slug, options: body.options, level: body.level, ...(Object.hasOwn(body, 'updated_at') ? { updated_at: body.updated_at ?? null } : {}) });
    }),
    post(/^\/api\/job\/([^/]+)\/local$/, async ({ res, m, body }) => {
      // "Try it on your computer".
      const slug = await needJob(m[1]);
      const word = (v) => (typeof v === 'string' ? v.slice(0, 20) : undefined);
      return command(res, {
        type: 'try-it', slug, action: str(body.action, 20), preset: str(body.preset, 40), command: str(body.command, 4000),
        where: body.where === 'root' ? 'root' : 'app', what: word(body.what), name: word(body.name), db: str(body.db, 20),
      });
    }),
    {
      // The job's notes (notes.md), saved whole from the job drawer. Audited by size only.
      method: 'PUT', path: /^\/api\/job\/([^/]+)\/notes$/,
      run: async ({ res, m, body }) => {
        const slug = await needJob(m[1]);
        if (typeof body.text !== 'string') throw new HttpError(400, 'The notes must be text.');
        if (body.text.length > NOTES_MAX) throw new HttpError(413, `The notes are too long (at most ${NOTES_MAX.toLocaleString('en')} characters).`);
        return command(res, { type: 'notes', slug, text: body.text });
      },
    },
    post(/^\/api\/runs\/([\w-]+)\/stop$/, ({ res, m }) => {
      if (m[1].length > 128) throw new HttpError(404, 'That reply already finished.');
      return command(res, { type: 'pause', runId: m[1] });
    }),
    post(/^\/api\/runs\/([\w-]+)\/steer$/, ({ res, m, body }) => {
      // Steer: add a message to a reply in progress (see lib/driver.js). Its states arrive as 'steer' events.
      const text = str(body.text).trim();
      if (!text) throw new HttpError(400, 'The message is empty.');
      if (m[1].length > 128) throw new HttpError(404, 'That reply already finished. Send your message as a new one.', { code: 'finished' });
      return command(res, { type: 'steer', runId: m[1], text });
    }),
    post(/^\/api\/permissions\/([\w-]+)$/, ({ res, m, body }) => {
      const decision = ['allow', 'allow-run', 'deny'].includes(body.decision) ? body.decision : null;
      if (!decision) throw new HttpError(400, 'Choose allow or deny.');
      const answers = body.answers && typeof body.answers === 'object' ? Object.fromEntries(Object.entries(body.answers).map(([k, v]) => [str(k, 500), str(v, 2000)])) : null;
      if (m[1].length > 128) throw new HttpError(404, 'That request was already answered or has expired.');
      return command(res, decision === 'deny'
        ? { type: 'deny', requestId: m[1], note: str(body.note, 2000), answers }
        : { type: 'allow', requestId: m[1], note: str(body.note, 2000), answers, scope: decision === 'allow-run' ? 'run' : 'once' });
    }),
    post('/api/jobs', ({ res, body }) => {
      // A new job. A ticket's job starts with a status.json of schema version 2 holding the ticket
      // block (the runner's start: lib/options.js startFromTicket(), packet B).
      const from = body.fromSession?.id ? { id: str(body.fromSession.id, 40), mode: body.fromSession.mode === 'continue' ? 'continue' : 'summary' } : undefined;
      return command(res, {
        type: 'start', description: str(body.description, 600), repoPath: str(body.repoPath, 1000), options: body.options, model: body.model,
        kind: body.kind === 'bug' ? 'bug' : 'feature', ticket: body.ticket, fromSession: from, despiteLimit: body.despiteLimit === true ? true : undefined,
      });
    }),
  ];
}
