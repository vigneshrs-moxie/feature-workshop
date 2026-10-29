// ---------- Review rounds (packet Q): /api/review/* (lib/review-round.js, lib/gh-write.js) ----------
// A reviewer's "Request changes" becomes one round: fixed with the Foreman on one yes, sent back on
// one go (push, the follow-up PR #1, a reply per comment, the fixed ones resolved, the reviewer
// asked again), then approved and merged. The rounds and every write are the runner's (local mode
// only): this is the panel's half. Every answer returns the job's view again.
//   GET  /api/review                     every job's review state, the GitHub line and the settings
//   GET  /api/review/:slug               one job's: { state, bar, desk, card, round, send, merge, remind, … }
//   POST /api/review/settings            { githubEveryMin: 1 | 5 | 10 | 30, mergeFollowUp?: boolean }
//   POST /api/review/:slug/fix           { note? }  Fix with the Foreman (or ask it to carry on)
//   POST /api/review/:slug/leave         { note? }  Leave it for now
//   POST /api/review/:slug/item          { id, included?, kind?, reply?, replyDropped?, reason? }
//   POST /api/review/:slug/note          { note }
//   POST /api/review/:slug/add-new       the comments that joined while the Foreman works: onto its list
//   POST /api/review/:slug/leave-new     … or left out
//   POST /api/review/:slug/change-after-all  { id }  an item kept as it is, fixed after all
//   POST /api/review/:slug/send          { go: true, mergeFollowUp? }  Send back (every step listed first)
//   POST /api/review/:slug/not-yet       Not yet
//   POST /api/review/:slug/stop-after-step   Send back stops once the step it is on is done
//   POST /api/review/:slug/retry         { go: true }  Try again from here
//   POST /api/review/:slug/merge-follow-up   { go: true }  merge the follow-up PR #1 from here after all
//   POST /api/review/:slug/fix-checks    { go: true }  a check failed after the push: to the Foreman
//   POST /api/review/:slug/sync          { go: true }  the base moved and conflicts: bring it in with the Foreman
//   POST /api/review/:slug/ask-review    { go: true, login }  ask someone to review
//   POST /api/review/:slug/reopen        { go: true }  reopen a PR closed without merging
//   POST /api/review/:slug/remind        { go: true, text }  remind the person who merges (a comment from you)
//   POST /api/review/:slug/merge         { go: true, confirm: 'merge PR #<n>' }  merge: a hard line, always asked
// Check now is POST /api/flow/refresh, as before.

import { HttpError } from '../lib/http-guard.js';

const ONE = /^\/api\/review\/([a-z0-9][a-z0-9._-]{0,199})(?:\/([a-z-]+))?$/;

export default function reviewRoutes({ local, sendJson, readBody, checkWrite }) {
  const review = local?.review ?? null;

  async function routeReview(req, res, urlPath) {
    try {
      if (!review) throw new HttpError(404, 'Review rounds run only on the dashboard on your own computer.');
      if (req.method === 'GET') {
        if (urlPath === '/api/review') return sendJson(res, 200, { ...(await review.list()), github: review.github() });
        const m = ONE.exec(urlPath);
        if (m && !m[2]) return sendJson(res, 200, { ...(await review.view(m[1])), github: review.github() });
        throw new HttpError(404, 'Not found');
      }
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
      checkWrite(req);
      const body = await readBody(req);
      if (urlPath === '/api/review/settings') return sendJson(res, 200, { settings: await review.setSettings(body), github: review.github() });
      const m = ONE.exec(urlPath);
      if (!m || !m[2]) throw new HttpError(404, 'Not found');
      return sendJson(res, 200, { ...((await review.act(m[1], m[2], body ?? {})) ?? { slug: m[1], state: null }), github: review.github() });
    } catch (err) {
      throw review ? review.httpError(err) : err;
    }
  }

  return { owns: (urlPath) => urlPath === '/api/review' || urlPath.startsWith('/api/review/'), mount: routeReview };
}
