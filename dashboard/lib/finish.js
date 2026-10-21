// The finish line: what counts as a job being done (Settings → Workflow, `workflow.finishLine`).
// One rule, read by the play ledger (a quest done), the Jobs list's groups (snapshot.js), the Done
// notification (server.js flowNotices) and, sent on each card as `finish`, the web, which never
// works it out again.
//
//   pr1-open     the Foreman opened PR #1 (the old quest rule)
//   pr1-merged   PR #1 merged: the work is on the org branch; from here on it waits on other people
//   staging      PR #2 merged: QA can see it
//   main         the release PR carried it to main
//   marked       only Mark done counts
//
// Marking a job done always counts, whatever the setting. `landed` says where the work is past
// staging (staging or main), whatever the setting: the quiet "Landed" marks after the line.
//
// Sources, all local: the job's status.json `prs` (prs[0]: PR #1's url and state), its flow lane
// (lib/flow.js laneOf: position local → fork → org → staging → main, pr1, pr2) and `closed`
// (Mark done). Pure: nothing here reads a file or calls anything.

export const FINISH_LINES = ['pr1-open', 'pr1-merged', 'staging', 'main', 'marked'];
export const DEFAULT_FINISH_LINE = 'pr1-merged';

/** Each choice's label and one line for the Settings page. */
export const FINISH_LINE_INFO = {
  'pr1-open': { label: 'PR #1 open', hint: 'Done when the Foreman has opened PR #1 from your fork.' },
  'pr1-merged': { label: 'PR #1 merged', hint: 'Done when your work is on the Moxie branch. From here on it waits on other people.' },
  staging: { label: 'In staging', hint: 'Done when PR #2 is merged and QA can see it.' },
  main: { label: 'In main', hint: 'Done when the release PR has carried it to main.' },
  marked: { label: 'When I mark it done', hint: 'Only Mark done counts.' },
};

const POSITIONS = ['local', 'fork', 'org', 'staging', 'main'];

/** The setting with an unknown value falling back to the default. */
export function finishLineOf(raw) {
  return FINISH_LINES.includes(raw) ? raw : DEFAULT_FINISH_LINE;
}

/** Where the lane's work is, as an index into local → fork → org → staging → main (-1: no lane). */
function reachedOf(lane) {
  if (!lane) return -1;
  if (Number.isInteger(lane.reached)) return lane.reached;
  return POSITIONS.indexOf(lane.position);
}

const prState = (p) => String(p?.state ?? '').toLowerCase();
const counts = (p) => p && ['open', 'draft', 'merged'].includes(prState(p));
// status.json's PR #1: its state decides when it has one (closed without merging, or not_started,
// is no open PR); an older record with only a url counts as open.
const statusCounts = (p) => Boolean(p) && (p.state == null || p.state === '' ? Boolean(p.url) : counts(p));

/**
 * Whether the job crossed the finish line, and where its work has landed.
 *   card     { prs, closed } as status.json and the session record have them (a board card does too)
 *   lane     the job's flow lane (flow.js laneOf), or null when the map doesn't know it
 *   setting  one of FINISH_LINES (anything else reads as the default)
 * Returns { reached, at, by, landed }: `by` is the place that crossed it ('marked' when only Mark
 * done did), `at` when that happened if known (a PR's merge time, the Mark done time), `landed`
 * 'staging' | 'main' | null whatever the setting.
 */
export function finishLineReached(card, lane, setting) {
  const rule = finishLineOf(setting);
  const prs = Array.isArray(card?.prs) ? card.prs : [];
  const pr1Status = prs[0] ?? null;
  const reached = reachedOf(lane);
  const closed = card?.closed && card.closed.as === 'done' ? card.closed : null;

  const places = {
    'pr1-open': {
      hit: counts(lane?.pr1) || statusCounts(pr1Status) || reached >= 2,
      at: null,
    },
    'pr1-merged': {
      hit: reached >= 2 || prState(lane?.pr1) === 'merged' || prState(pr1Status) === 'merged',
      at: prState(lane?.pr1) === 'merged' ? lane.pr1.mergedAt ?? null : null,
    },
    staging: {
      hit: reached >= 3,
      at: prState(lane?.pr2) === 'merged' ? lane.pr2.mergedAt ?? null : null,
    },
    main: {
      hit: reached >= 4,
      at: null,
    },
  };
  // A place further on counts for the ones before it (staging reached means PR #1 merged too).
  const landed = reached >= 4 ? 'main' : reached >= 3 ? 'staging' : null;

  let by = null;
  let at = null;
  if (rule !== 'marked' && places[rule].hit) { by = rule; at = places[rule].at; }
  else if (closed) { by = 'marked'; at = closed.at ?? null; }
  return { reached: by !== null, at, by, landed };
}
