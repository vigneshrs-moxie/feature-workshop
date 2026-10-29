// Invented review rounds for the web tests (packet Q): the shapes GET /api/review/:slug answers with,
// as dashboard/lib/review-round.js reviewView draws them. The reviewer is a made-up "Raj" with the
// made-up login raj-moxie; the repository and PR numbers are invented. No real person, no GitHub.
import type { FlowView, GithubLine, ReviewAction, ReviewItemView, ReviewRoundPanel, ReviewSendStep, ReviewState, ReviewView, RoundState } from '../../api/types';

export const PR_URL = 'https://github.com/acme/sample-repo/pull/179';
export const AT = '2026-10-29T18:48:00.000Z';

export function action(id: string, label: string, over: Partial<ReviewAction> = {}): ReviewAction {
  const go = over.go ?? null;
  const lower = `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
  return { id, label, playLabel: go === true ? `Go: ${lower}` : go === false ? `No go: ${lower}` : label, key: null, go, enabled: true, reason: null, client: false, confirm: null, ...over };
}

export function item(id: string, over: Partial<ReviewItemView> = {}): ReviewItemView {
  return {
    id, type: 'line', kind: 'change', kindWords: 'Change', kindBy: 'guess', author: 'raj-moxie', file: 'web/src/feedback/FeedbackForm.tsx', line: 42,
    outdated: false, outdatedWords: null, quote: 'Disable Send while the request is in flight.', name: null, link: `${PR_URL}#discussion_r${id}`, at: AT,
    included: true, state: 'todo', stateWords: 'To do', commit: null, plan: null, planText: null, reply: null, replyDropped: false, replyState: 'Not posted yet',
    reason: null, log: null, late: false, newWords: null, changeAfterAll: null, ...over,
  };
}

export const ITEMS: ReviewItemView[] = [
  item('c7001'),
  item('c7002', { kind: 'nit', kindWords: 'Nit', line: 88, quote: 'Nit: `fbId` → `feedbackId`, to match the API.' }),
  item('c7003', { file: 'api/src/feedback/feedback.controller.ts', line: 31, quote: 'This should check the user can see the work order first.' }),
  item('c7004', { kind: 'question', kindWords: 'Question', file: 'api/src/feedback/feedback.controller.ts', line: 57, quote: 'Why 2,000 characters? I thought the spec said 5,000.' }),
  item('k:lint@aaa1111', { type: 'check', kind: 'check', kindWords: 'Check', author: null, file: null, line: null, quote: null, name: 'lint', replyState: null, log: "14:9  error  'feedbackId' is not defined  no-undef" }),
];

export function round(over: Partial<ReviewRoundPanel> = {}, items: ReviewItemView[] = ITEMS): ReviewRoundPanel {
  const byFile = new Map<string, ReviewItemView[]>();
  for (const i of items) {
    const key = i.type === 'check' ? '~checks' : i.file ?? '~general';
    byFile.set(key, [...(byFile.get(key) ?? []), i]);
  }
  return {
    round: 1, pr: 2, prLabel: 'PR #2', state: 'asked', title: 'Round 1 · PR #2',
    from: 'From Raj’s review at 11:48 (Request changes) and the lint check on the same commit', reviewer: { login: 'raj-moxie', name: 'Raj' },
    counts: { items: items.length, included: items.filter((i) => i.included).length, done: 0, commits: 0, replies: 0 },
    includedWords: `${items.filter((i) => i.included).length} of ${items.length} included`, kindsWords: 'Kinds are the Foreman’s first guess: click one to change it.',
    footer: 'The Foreman fixes, commits and drafts replies on this job’s own branch. It doesn’t push, reply or merge: that waits for Send back.',
    note: null,
    groups: [...byFile.entries()].map(([key, list]) => ({ heading: key === '~checks' ? 'Checks on the same commit' : key === '~general' ? 'On the whole pull request' : key, file: key.startsWith('~') ? null : key, items: list })),
    pending: [], foreman: null,
    timeline: [{ at: AT, time: '11:48', words: 'Raj asked for changes on PR #2 · 4 comments · round 1' }, { at: AT, time: '14:02', words: 'You said go: send back to Raj · pushed 4 · 3 replies · Raj asked again' }],
    timelineHeading: 'Round 1, start to end',
    ...over,
  };
}

const STEPS: ReviewSendStep[] = [
  { id: 'push', number: 1, words: 'Push 4 commits to your fork', detail: 'git push origin feature/sample-job · never forced', state: 'will', stateWords: 'Will do' },
  { id: 'follow-up', number: 2, words: 'PR #2 is Raj’s, from the moxie branch: open the follow-up PR #1, your fork → the moxie branch, and merge it once its checks pass', detail: '“Follow-up for Raj’s review on PR #2” · body from pr-body.md', choice: 'This go also merges PR #1 once its checks pass · or I’ll merge PR #1 myself', mergeFollowUp: true, state: 'will', stateWords: 'Will do' },
  { id: 'replies', number: 3, words: 'Reply on GitHub to each of Raj’s 3 comments', detail: 'Each drafted reply below: edit or drop any of them.', count: 3, state: 'will', stateWords: 'Will do' },
  { id: 'resolve', number: 4, words: 'Mark the 2 fixed comments resolved', detail: 'Only the ones Fixed', count: 2, state: 'will', stateWords: 'Will do' },
  { id: 'request', number: 5, words: 'Ask Raj to review PR #2 again', detail: 'gh pr edit · re-request review from Raj', state: 'will', stateWords: 'Will do' },
];
export const steps = (states: ReviewSendStep['state'][] = [], over: Partial<ReviewSendStep>[] = []): ReviewSendStep[] => STEPS.map((s, i) => ({ ...s, ...(states[i] ? { state: states[i], stateWords: ({ will: 'Will do', working: 'Working', done: 'Done', stopped: 'Stopped here', 'not-run': 'Not run', 'after-pr1': 'After PR #1 is merged', skipped: 'Not needed' })[states[i]] } : {}), ...(over[i] ?? {}) }));

/** The items as the Foreman left them: two fixed, a question answered, the check fixed. */
export const DONE_ITEMS: ReviewItemView[] = [
  item('c7001', { state: 'fixed', stateWords: 'Fixed in 3f9c2e1', commit: '3f9c2e1', plan: 'fix', planText: 'turn Send off while it posts.', reply: 'Fixed in 3f9c2e1: Send is off while the request is in flight.' }),
  item('c7002', { kind: 'nit', kindWords: 'Nit', line: 88, quote: 'Nit: rename it.', state: 'fixed', stateWords: 'Fixed in 8a41d07', commit: '8a41d07', plan: 'fix', planText: 'rename it.', reply: 'Fixed in 8a41d07: renamed to `feedbackId`.' }),
  item('c7004', { kind: 'question', kindWords: 'Question', file: 'api/src/feedback/feedback.controller.ts', line: 57, quote: 'Why 2,000 characters?', state: 'answered', stateWords: 'Answered', plan: 'answer', planText: 'the column holds 2,000.', reply: '2,000 matches the column.' }),
  item('k:lint@aaa1111', { type: 'check', kind: 'check', kindWords: 'Check', author: null, file: null, line: null, quote: null, name: 'lint', replyState: null, state: 'fixed', stateWords: 'Fixed in c27b9e4', commit: 'c27b9e4' }),
];

/** One job's view in a state, with the bar the dashboard draws for it. */
export function view(state: ReviewState, over: Partial<ReviewView> = {}): ReviewView {
  const fix = action('fix', 'Fix with the Foreman', { key: 'a', go: true });
  const leave = action('leave', 'Leave it for now', { key: 'r', go: false });
  const open = action('open', 'Open the round', { key: 'o', client: true });
  const openPr = action('open-pr', 'Open PR #2', { key: 'p', client: true });
  const bars: Partial<Record<ReviewState, ReviewView['bar']>> = {
    asked: { headline: 'Raj asked for changes on PR #2 · 4 comments, 1 question', detail: 'And lint failed on the same commit.', hint: 'Untick anything to leave out, add a note if you like, then say go.', actions: [fix, leave, open] },
    fixing: { headline: 'The Foreman is on round 1: 2 of 5 done', detail: 'It has planned all 5.', progress: '2 of 5 done · 2 commits so far', replies: 'Replies drafted for 2', doing: 'the access check', next: 'the lint check', phase: 'working', actions: [action('send', 'Send back to Raj', { key: 'a', go: true, enabled: false, reason: 'The Foreman is still on it.' }), open] },
    ready: { headline: 'Round 1 is ready to send back', detail: '2 fixed, 1 answered and the lint fix.', actions: [action('send', 'Send back to Raj', { key: 'a', go: true }), action('not-yet', 'Not yet', { key: 'r', go: false }), open] },
    sending: { headline: 'Sending round 1 back: step 3 of 5', detail: 'Reply on GitHub to each of Raj’s 3 comments Each step is in the job’s history as it happens.', actions: [action('stop-after-step', 'Stop after this step')] },
    stopped: { headline: 'Stopped at step 3: reply 2 of 3 didn’t post', detail: 'GitHub had a problem (502). Steps 1 and 2 are done, 1 reply is posted, and steps 4 and 5 didn’t run.', error: '502 Bad Gateway', actions: [action('retry', 'Try again from here', { key: 'a', go: true }), action('not-yet', 'Not yet', { key: 'r', go: false })] },
    waiting: { headline: 'Waiting on Raj to review PR #2 again', detail: 'Round 1 went back at 14:02. Nothing for you to do.', on: 'reviewer', actions: [openPr] },
    'check-failed': { headline: 'lint failed on the push for round 1', detail: 'One check out of 6. The Foreman gets the log and fixes it in the same loop.', actions: [action('fix-checks', 'Fix with the Foreman', { key: 'a', go: true }), leave, open] },
    conflicts: { headline: 'PR #2 conflicts with staging in 2 files', detail: 'staging changed under PR #2.', actions: [action('sync', 'Bring in staging with the Foreman', { key: 'a', go: true }), openPr] },
    'new-comment': { headline: 'Raj added a comment while the Foreman works on round 1', detail: 'It joins round 1.', actions: [action('add-new', 'Add it to the Foreman’s list', { key: 'a', go: true }), action('leave-new', 'Leave it out', { key: 'r', go: false }), open] },
    'approval-reset': { headline: 'Approval reset by your push: waiting on Raj again', detail: 'Raj has been asked again; nothing for you to do.', on: 'reviewer', actions: [openPr] },
    'no-reviewer': { headline: 'No one has been asked to review PR #2', detail: 'The route says Raj reviews PR #2.', reviewer: { name: 'Raj', login: 'raj-moxie' }, actions: [action('ask-review', 'Ask for a review', { key: 'a', go: true })] },
    closed: { headline: 'PR #2 was closed without merging', detail: 'Closed by Raj at 15:00: “Not needed any more.”', actions: [action('reopen', 'Reopen PR #2', { key: 'a', go: true }), action('drop', 'Mark the job dropped', { key: 'r', go: false, client: true })] },
    'approved-you-merge': {
      headline: 'PR #2 is approved and green: merge it into staging?', detail: 'The route lets you merge PR #2.',
      actions: [action('merge', 'Merge PR #2…', { key: 'm', confirm: { headline: 'Merge PR #2 into staging?', hardLine: 'Hard line', step: 'gh pr merge 179 --repo acme/sample-repo --merge', go: action('merge', 'Merge PR #2', { go: true, playLabel: 'Go: merge PR #2' }), noGo: action('cancel', 'Not now', { key: 'Escape', go: false }), keyNote: 'The a key never merges.' } }), openPr],
    },
    'approved-they-merge': { headline: 'Waiting for Raj to merge PR #2', detail: 'Approved, checks green.', actions: [action('remind', 'Remind Raj…', { key: 'a', enabled: false, reason: 'From 15:10, a day after the approval.' }), openPr] },
    merged: { headline: 'PR #2 is merged into staging', detail: 'Merged by Raj at 16:40.', actions: [action('open-base', 'Open staging', { key: 'o', client: true })] },
  };
  const send = state === 'ready' ? { steps: steps(), stopAfter: false, mergeFollowUp: true, questionOnly: false }
    : state === 'sending' ? { steps: steps(['done', 'done', 'working']), stopAfter: false, mergeFollowUp: true }
      : state === 'stopped' ? { steps: steps(['done', 'done', 'stopped', 'not-run', 'not-run'], [{}, {}, { failWords: 'reply 2 of 3 didn’t post', error: '502 Bad Gateway' }]), stopAfter: false, mergeFollowUp: true }
        : null;
  const ROUND_STATE: Partial<Record<ReviewState, RoundState>> = { asked: 'asked', fixing: 'fixing', ready: 'fixing', 'new-comment': 'fixing', sending: 'sending', stopped: 'stopped', 'check-failed': 'check-failed' };
  const roundState: RoundState = ROUND_STATE[state] ?? 'sent';
  const withRound = !['no-reviewer', 'closed'].includes(state);
  const items = ['ready', 'sending', 'stopped', 'waiting', 'approval-reset', 'approved-you-merge', 'approved-they-merge', 'merged'].includes(state) ? DONE_ITEMS : ITEMS;
  const bar = bars[state] ?? { headline: state, detail: null, actions: [] };
  const approved = state === 'approved-you-merge' || state === 'approved-they-merge';
  return {
    slug: 'feedback-api', state, bar,
    desk: ['asked', 'ready', 'stopped', 'check-failed', 'conflicts', 'new-comment', 'closed', 'no-reviewer'].includes(state) ? { headline: bar!.headline, sentence: 'Say go and the Foreman says what it will do with each one.', actions: bar!.actions.filter((a) => a.go !== null) } : null,
    card: { line: state === 'waiting' ? 'Waiting on Raj since 14:02 · round 2' : bar!.headline, place: 'Ship · PR #2 · round 1' },
    phone: bar!.headline,
    round: withRound ? round({ state: roundState }, items) : null,
    send,
    merge: approved ? { who: state === 'approved-you-merge' ? 'you' : 'Raj', line: `${state === 'approved-you-merge' ? 'you' : 'Raj'} · from the route (PR #1: you · PR #2: Raj · PR #3: the release owner)`, method: 'merge', command: 'gh pr merge 179 --repo acme/sample-repo --merge' } : null,
    remind: state === 'approved-they-merge' ? { at: AT, can: false, text: 'Hi Raj, PR #2 (Feedback API) is approved and its checks are green. Could you merge it into staging when you get a moment? Thanks!', note: 'Posted as a comment from you, on GitHub, exactly as written here. Edit it first if you like.' } : null,
    held: null,
    pr: {
      number: 179, label: 'PR #2', routeNumber: 2, repo: 'acme/sample-repo', url: PR_URL, title: 'Feedback API', state: state === 'merged' ? 'merged' : state === 'closed' ? 'closed' : 'open',
      review: approved ? 'approved' : 'changes_requested', reviewRequests: [], mergeable: state === 'conflicts' ? 'CONFLICTING' : 'MERGEABLE', head: 'aaa1111', base: 'staging',
      checks: approved ? 'passing' : 'failing', checkCount: 6, mergedAt: null, mergedBy: null, closedAt: null, closedBy: null, closeReason: null, approvedAt: approved ? AT : null, lastReviewer: 'raj-moxie',
    },
    rounds: [{ round: 1, pr: 2, prLabel: 'PR #2', state: roundState, items: items.length, openedAt: AT, sentAt: roundState === 'sent' ? AT : null }],
    title: 'Feedback API',
    who: { reviewer: 'Raj', mergesLine: 'PR #1: you · PR #2: Raj · PR #3: the release owner' },
    ...over,
  };
}

/** The view while a terminal holds the job's lock: the same state underneath, its buttons off. */
export function held(state: ReviewState): ReviewView {
  const v = view(state);
  const reason = 'Send back is off until the terminal lets go.';
  return {
    ...v, state: 'held', heldState: state, held: { pid: 4182, branch: 'feature/sample-job', since: AT },
    bar: { ...v.bar!, headline: 'This job is being driven from a terminal', detail: 'pid 4182, branch feature/sample-job, since 11:48.', was: { headline: v.bar!.headline, detail: v.bar!.detail }, actions: v.bar!.actions.map((a) => (a.client ? a : { ...a, enabled: false, reason })) },
  };
}

export function github(over: Partial<GithubLine> = {}): GithubLine {
  return { checkedAt: new Date(Date.now() - 3 * 60000).toISOString(), triedAt: null, checking: false, problem: null, everyMs: 60000, waiting: true, nextAt: null, ...over };
}

export function flow(line: Partial<GithubLine> = {}): FlowView {
  return { repos: [], fetchedAt: new Date().toISOString(), checkedAt: null, refreshing: false, nextFetchAt: null, github: github(line) };
}
