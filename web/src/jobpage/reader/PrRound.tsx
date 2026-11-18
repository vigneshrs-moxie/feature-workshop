// A PR's review round in its reader view (18 Nov; what the old page's review-round panel showed that the
// PR view did not, views/Review/ReviewPanel.tsx): GET /api/review/:slug (lib/review-round.js reviewView).
//   - Where the round is, in the round's own words: `Round 2 · Waiting on Raj to review PR #2 again`, and
//     the line under it (`Round 1 went back at 14:02. …`): which round, who or what it waits on, since when.
//   - While Send back runs, and after it stopped: each step with its state, and what GitHub said.
//   - Approved: who merges it, into what, and how.
//   - The one plain next action the PR view does not already have (Try again from here, Bring in the base,
//     Reopen, Add it to the Foreman's list, merge the follow-up PR #1 from here), as the old panel's.
//   - The rounds so far, folded under one line, with the current round from start to end.
// Not here, because the PR view has them: the round's comments and replies (its rows), the verdict, the
// failed checks and their fix, Fix these (the round's Fix with the Foreman) and Push the fixes (Send back,
// whose `what will go` lists its steps). Merge, Remind and Ask for a review stay on the job's quick look
// (home/JobPeek's next-step bar, views/Review/ReviewBar).
//
// Speed: read when the view opens and again only when the PR line moves (its word, why, next action, the
// comments' version, or GitHub's read time); never on a timer and never on another live event (plan
// "Architecture": the page never asks /api/review/:slug after every event). A second visit paints what was
// read before. PrView holds its comments back until this has answered (a moment at most, ROUND_WAIT_MS),
// so the round's line never pushes them down when it lands. Not on the website (review rounds run on the
// laptop only).

import { memo, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../api/client';
import type { ReviewAction, ReviewView } from '../../api/types';
import { Button } from '../../components/Button';
import { WorkshopContext } from '../../state/store';
import { share } from '../../lib/share';
import { bodyFor } from '../../views/Review/ReviewBar';
import { viewOf } from '../../views/Review/useReview';
import { clockWords } from '../left/PrLines';
import { useJob } from '../useJob';

/** How long the PR view's comments wait for the round's line at most. */
export const ROUND_WAIT_MS = 300;

/** The bar's actions the PR view already has, or that need more than one click (the quick look's next-step bar has those). */
const ELSEWHERE = new Set(['fix', 'send', 'fix-checks', 'ask-review', 'remind', 'merge']);
/** States whose words the PR line already says. */
const LINE_SAYS = new Set(['merged']);
/** States whose Send back steps show here (ready: Push the fixes lists them before his yes). */
const STEPS_SHOWN = new Set(['sending', 'stopped', 'after-pr1']);

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What was last read for each job, per app. undefined: never read. */
const kept = new WeakMap<ApiClient, Map<string, ReviewView | null>>();
function keptOf(api: ApiClient): Map<string, ReviewView | null> {
  let m = kept.get(api);
  if (!m) { m = new Map(); kept.set(api, m); }
  return m;
}

/** The PR line's parts that move when the round can have moved: its word, why, next action, comments and GitHub's read. */
function useLineKey(n: number): string {
  return useJob((s) => {
    const l = s.payload?.prs.find((x) => x.n === n);
    return l ? `${l.word}|${l.why ?? ''}|${l.next?.check ?? ''}|${l.comments?.v ?? ''}|${s.payload?.github?.at ?? ''}` : '';
  });
}

export interface RoundRead {
  /** undefined while it has not answered yet (and nothing was read before). */
  view: ReviewView | null | undefined;
  /** It answered, or the wait is over: the PR view's comments show. */
  settled: boolean;
  problem: string | null;
  act(a: ReviewAction): Promise<void>;
}

/** The job's review round, read for PR view n (see the top). Off on the website. */
export function useRound(n: number, enabled: boolean): RoundRead {
  const api = useContext(WorkshopContext)?.api ?? null;
  const slug = useJob((s) => s.slug);
  const key = useLineKey(n);
  const held = api ? keptOf(api) : null;
  const [view, setView] = useState<ReviewView | null | undefined>(() => held?.get(slug));
  const [waited, setWaited] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const take = useCallback((next: ReviewView | null) => {
    if (!live.current) return;
    held?.set(slug, next);
    // The same answer as the one shown keeps it: nothing draws again.
    setView((was) => share(was, next));
  }, [held, slug]);

  const read = useCallback(async () => {
    if (!api) return;
    try { take(viewOf(await api.get<unknown>(`/api/review/${encodeURIComponent(slug)}`))); } catch { take(held?.get(slug) ?? null); }
  }, [api, slug, take, held]);

  useEffect(() => { if (enabled) void read(); }, [enabled, read, key]);
  // The comments wait for the first answer a moment at most. Only while there is none: once it is held,
  // no timer is left to draw the view again.
  const none = view === undefined;
  useEffect(() => {
    if (!enabled || !none || waited) return undefined;
    const t = setTimeout(() => setWaited(true), ROUND_WAIT_MS);
    return () => clearTimeout(t);
  }, [enabled, none, waited]);

  const act = useCallback(async (a: ReviewAction) => {
    if (!api || !view) return;
    setProblem(null);
    try {
      take(viewOf(await api.post<unknown>(`/api/review/${encodeURIComponent(slug)}/${a.id}`, bodyFor(a, view))));
    } catch (err) {
      if (live.current) setProblem(message(err));
      void read();
    }
  }, [api, slug, view, take, read]);

  return { view, settled: !enabled || view !== undefined || waited, problem, act };
}

/** The one plain next action the PR view does not have already, as the old panel's status line chose it. */
export function nextOf(view: ReviewView): ReviewAction | null {
  if (view.state === 'held') return null;
  return view.bar?.actions.find((a) => a.go === true && a.enabled && !a.confirm && !a.client && !ELSEWHERE.has(a.id)) ?? null;
}

export const PrRound = memo(function PrRound({ n, round }: { n: 1 | 2 | 3; round: RoundRead }) {
  const { view, problem, act } = round;
  const [busy, setBusy] = useState(false);
  if (!view || !view.state || !view.bar || view.pr.routeNumber !== n) return null;
  const state = view.heldState ?? view.state;
  if (LINE_SAYS.has(state)) return null;
  const r = view.round;
  const bar = view.bar;
  const go = nextOf(view);
  const steps = view.send && STEPS_SHOWN.has(state) ? view.send.steps : [];
  const merge = view.merge;
  const rounds = view.rounds.filter((x) => x.pr === n);
  const label = view.pr.label;
  return (
    <section className="jp2-prr" aria-label={r ? r.title : `${label} in review`}>
      <p className="jp2-prr-h">{r && <b>Round {r.round}</b>}{r && ' · '}<span>{bar.headline}</span></p>
      {bar.detail && <p className="jp2-prr-d">{bar.detail}</p>}
      {steps.length > 0 && (
        <ol className="jp2-prr-steps" aria-label="Send back, step by step">
          {steps.map((s) => (
            <li key={s.id} className="jp2-prr-step" data-st={s.state}>
              <span className="jp2-prr-sw">{s.number}. {s.words}</span>
              <span className="jp2-prr-ss">{s.stateWords}</span>
              {s.state === 'stopped' && (s.failWords || s.error) && (
                <span className="jp2-prr-fail">{s.failWords ?? ''}{s.failWords && s.error ? ' · ' : ''}{s.error ? `GitHub said: “${s.error}”` : ''}</span>
              )}
              {s.waiting && <span className="jp2-prr-sd">{s.waiting}</span>}
            </li>
          ))}
        </ol>
      )}
      {merge && (
        <p className="jp2-prr-d">
          {merge.who === 'you' ? 'You merge' : `${merge.who} merges`} {label} into {view.pr.base ?? 'its base'} · {merge.method === 'squash' ? 'squashed into one commit' : 'a merge commit'}
        </p>
      )}
      {go && (
        <div className="jp2-prr-acts">
          <Button size="sm" busy={busy} disabled={busy} title={`${go.label}: the round’s next step, the same as the quick look’s.`}
            onClick={async () => { setBusy(true); try { await act(go); } finally { setBusy(false); } }}>
            {go.label}
          </Button>
        </div>
      )}
      {problem && <p className="jp2-prv-problem" role="alert">{problem}</p>}
      {rounds.length > 0 && (
        <details className="jp2-prr-more">
          <summary>Rounds on {label} · {rounds.length}</summary>
          <ul className="jp2-prr-rounds">
            {rounds.map((x) => (
              <li key={x.round}>
                Round {x.round} · {x.items} {x.items === 1 ? 'item' : 'items'}
                {clockWords(x.openedAt) && ` · opened ${clockWords(x.openedAt)}`}
                {x.sentAt && clockWords(x.sentAt) && ` · sent back ${clockWords(x.sentAt)}`}
              </li>
            ))}
          </ul>
          {r && r.timeline.length > 0 && (
            <>
              <p className="jp2-prr-th">{r.timelineHeading}</p>
              <ol className="jp2-prr-tl">
                {r.timeline.map((t, i) => <li key={`${t.at}-${i}`}><time dateTime={t.at}>{t.time}</time> {t.words}</li>)}
              </ol>
            </>
          )}
        </details>
      )}
    </section>
  );
});
