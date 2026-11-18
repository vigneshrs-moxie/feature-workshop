// The new job page's payload and bodies, as the server sends them. The names and shapes are the
// server's: dashboard/lib/job-payload.js (the comment at its top) builds the payload, and
// dashboard/lib/job-payload-cache.js answers one body by its id.
//   GET /api/job/:slug/page?v=<n>    JobPagePayload, or SamePage when n is the current v
//   GET /api/job/:slug/item?id=<id>  JobBody
// On the website (hosted/site/routes-mirror.js, mirrorJobPage) the payload has hosted: true and no
// `drive`, `lock` or `local` (LOCAL_ONLY), so all three are optional here.

import type { Closed, JobAuto, JobLockInfo, PolicyId, StopId } from '../api/types';

export type { StopId };

export type JobState = 'needs-you' | 'working' | 'waiting-github' | 'paused' | 'done';

/** What the reader can show; also the <kind> of the page's reader address (app/router.ts). */
export const READER_KINDS = ['message', 'brief', 'permission', 'doc', 'changes', 'checks', 'findings',
  'walkthrough', 'screens', 'ship', 'pr', 'ticket', 'conversation', 'decisions', 'details', 'not-yet', 'picture'] as const;
export type ReaderKind = (typeof READER_KINDS)[number];
export const isReaderKind = (v: unknown): v is ReaderKind => (READER_KINDS as readonly unknown[]).includes(v);

/** What the reader shows: a kind and the id of the thing in it. */
export interface ReaderTarget { kind: ReaderKind; id: string }

export type OutputKind = 'doc' | 'screens' | 'changes' | 'checks' | 'recording' | 'hand-test' | 'findings' | 'walkthrough' | 'pr';

/** One thing a step made. id: a doc's file, a PR's '1' | '2' | '3', else the kind. */
export interface Output {
  kind: OutputKind;
  id: string;
  label: string;
  meta: string | null;
  /** Versions are strings in the code ('0.5', '3'). */
  version: string | null;
  /** A doc's text hash, stamped by the cache (null on the website); says when a kept body is out of date. */
  hash?: string | null;
  /** A doc's older versions, newest first (the job's versions/ folder, lib/doc-versions.js; laptop only).
   *  n: its version ('0.3', or '2 (earlier 1)' for words rewritten under the same number); id: its body's id. */
  versions?: { n: string; id: string }[];
}

export interface StepRow {
  id: StopId;
  label: string;
  state: 'done' | 'current' | 'todo' | 'skipped';
  /** The result ('v3', '19 passed', '2 open', 'PR #1 open'), only on done and current steps. */
  word: string | null;
  durationMs: number | null;
  startedAt: string | null;
  /** What the left pane lists (only the current step's show). */
  outputs: Output[];
  /** What the reader shows when the step is opened; `not-yet` for a step not started or skipped. */
  main: ReaderTarget;
  /** The step's other documents, for the reader only: lens rounds, review facts, second looks, Build's plan and log. */
  more: Output[];
}

export type LineKind = 'reply' | 'you' | 'brief' | 'problem' | 'small';

/** One conversation item, no body. `hash` (12 hex of the body) says when a kept body is out of date. */
export interface ThreadLine {
  id: string;
  kind: LineKind;
  at: string | null;
  step: StopId | null;
  headline: string;
  mine: boolean;
  hash: string;
  /** Briefs: the answer ('Go' | 'Send back' | 'Stop'), true or false. */
  answered?: 'Go' | 'Send back' | 'Stop' | boolean;
  by?: 'auto';
}

export interface GateOption { id: string; label: string; consequence: string | null; recommended: boolean }
export interface GateQuestion { id: string; text: string; options: GateOption[] }

/** What a short id in a decision means (dashboard/lib/doc-refs.js), and where its words are. */
export interface RefMeaning { id: string; title: string; text: string; where: { kind: 'doc' | 'decisions' | 'findings'; id: string; name: string } }

export interface GateMove {
  kind: 'gate';
  /** The ids the ask, questions and options mention, with their meanings (left/Refs.tsx); absent when none is known. */
  refs?: Record<string, RefMeaning>;
  /** The waiting brief's "What happened", at most three lines: the brief's one place while it waits. */
  happened?: string[];
  brief: number | null;
  ask: string;
  since: string | null;
  stage: string | null;
  nextStage: string | null;
  goSays: string;
  questions: GateQuestion[];
  /** Shown: "13 decided for you". */
  decided: number;
  /** id ?? decision of the unconfirmed ones: what Go confirms. */
  openDecisions: string[];
  stale: boolean;
  parked: boolean;
}

export interface QuestionMove { kind: 'question'; ask: string; since: string | null; quick: string[]; itemId: string; refs?: Record<string, RefMeaning> }

export interface PermissionMove {
  kind: 'permission';
  id: string;
  card: 'permission' | 'question';
  what: string;
  command: string | null;
  questions: { question: string; options: { label: string }[] }[] | null;
  risk: string | null;
  since: string | null;
  canAllowForRun: boolean;
  hardLine: boolean;
  defaultToNo: boolean;
  canAlwaysAllow: boolean;
}

export type Move = GateMove | QuestionMove | PermissionMove;

/** A PR line's one next action (R2, dashboard/lib/pr-lines.js): what its yes sends to the Foreman and what will go. */
export interface PrNext {
  id: 'push-open' | 'open-pr1' | 'push-update' | 'push-fixes' | 'open-pr2' | 'request-review';
  /** The line's button: `Push and open PR #1`, `Push update (2 commits)`, `Open PR #2`, `Request review`. */
  label: string;
  /** The yes button, under what will go: `Push and open`, `Push`. */
  go: string;
  /** What will go, line by line: the commits (`abc1234 subject`), from which branch to which, the title. */
  says: string[];
  /** The exact sentence the Foreman gets. */
  sends: string;
  /** The server sends only while the line still gives this (12 hex). */
  check: string;
  /** Task 21: `Push the fixes` while a review round is ready: Starbase runs the round's Send back itself (no sentence). */
  round?: boolean;
}

export interface PrLine {
  n: 1 | 2 | 3;
  number: number | null;
  url: string | null;
  /** Absent from an older Starbase. */
  title?: string | null;
  state: string;
  word: string;
  /** Merged: when; open: when it was opened. Absent from an older Starbase. */
  at?: string | null;
  next: null | PrNext;
  /** Why the line has no button, or what it waits for (`after PR #1 is merged`, `Sent to the Foreman`). */
  why?: string | null;
  /** Task 21: the PR's comments as last read: new ones, all, fixed ones, failing checks, and the rows' version. */
  comments: null | { fresh: number; total: number; fixed?: number; failing?: number; v?: string | null };
}

/** One PR comment (Task 21, dashboard/lib/pr-comments.js): a line-comment thread, a review's text or a conversation comment. */
export interface PrRow {
  id: string;
  kind: 'line' | 'review' | 'conversation';
  author: string;
  mine: boolean;
  file: string | null;
  line: number | null;
  outdated?: boolean;
  body: string;
  /** The three code lines it sits on, and the first one's number. */
  context: string[] | null;
  contextAt?: number | null;
  link: string | null;
  at: string | null;
  replies?: { author: string; mine: boolean; body: string; at: string | null }[];
  state: 'new' | 'fixing' | 'fixed' | 'answered' | 'left';
  commit: string | null;
  why?: string | null;
  reply: null | { draft: string; posted: string | null };
  /** In a review round still going: its reply goes with Push the fixes (the round's Send back), never by Post it. */
  round?: true;
  /** The round's state (asked, fixing, sending, stopped, after-pr1, …) when `round`. */
  roundState?: string | null;
  /** Answered on GitHub by hand (his reply after the reviewer's last word). */
  onGithub?: true;
  /** When the mark it shows was made. */
  markAt?: string | null;
}
/** A failed check on the PR's newest commit, with the end of its log. */
export interface PrCheck { name: string; link: string | null; runId: string | null; head: string | null; log: string | null; state: 'failed' | 'fixing' }
/** GET /api/job/:slug/pr/:n (Task 21). */
export interface PrView {
  n: number;
  line: PrLine;
  github: GithubRead | null;
  rows: PrRow[];
  checks?: PrCheck[];
  verdict: null | { by: string | null; state: 'changes_requested' | 'approved' | 'commented' | string; at: string | null };
  readAt?: string | null;
  problem?: string | null;
  number?: number | null;
  reading?: boolean;
}

/** When GitHub was last read for the PR lines (the flow map's read), and why it could not be. */
export interface GithubRead {
  at: string | null;
  triedAt: string | null;
  reading: boolean;
  problem: string | null;
  run: string | null;
}

/**
 * The Foreman's answer to one note he sent (R5, dashboard/lib/job-payload.js askedOf).
 * note: his note's words (or what it asked: `Drop this`, `Explain`); place: where he pointed, as sent
 * (null when his message is not found); what: where the change is and what changed (`Plan v3 · step 4
 * removed`), the answer to an Explain, or why it was not done; target: where a click opens (with
 * `commit`: that commit and file in Changes); ask: the note as sent, for `Ask again`.
 */
export interface NoteAnswer {
  n: number;
  note: string;
  place: string | null;
  done: boolean;
  what: string;
  target: ReaderTarget | null;
  explained?: true;
  commit?: { sha: string; file: string | null };
  ask: { kind: 'change' | 'drop' | 'explain' | 'pin'; place: string; quote: string | null; note: string | null } | null;
}

export interface JobPagePayload {
  v: number;
  slug: string;
  key: string | null;
  keyUrl: string | null;
  title: string;
  kind: 'feature' | 'bug';
  state: JobState;
  lane: string | null;
  laneReason: string | null;
  stateLine: string;
  facts: { level: number | null; repo: string | null; branch: string | null; cost: number; model: string | null };
  auto: (JobAuto & Record<string, unknown>) | null;
  run: null | { id: string | null; status: string | null; startedAt: string | null; lastAction: string | null };
  /** Laptop only. */
  drive?: { mode: 'none' | 'workshop' | 'running' | 'terminal' | 'terminal-open' };
  /** Laptop only: another process holds the job. */
  lock?: JobLockInfo | null;
  /** Laptop only: what the ⋯ menu's laptop items need (the job's folder, its worktree, its own
   *  permission setting, whether its Foreman has a session). */
  local?: { dir: string | null; worktree: string | null; policyOverride: PolicyId | null; started: boolean;
    /** A branch Starbase only guessed, with the repository it is in (left/BranchGuess.tsx); null or absent when the branch is known. */
    guess?: { branch: string; repoPath: string | null } | null };
  heldReply: null | { kind: string; gateBrief: number | null; at: string };
  usage: null | { limited: boolean; resetsAt: string | null; label: string | null; line: string | null };
  closed: Closed | null;
  skipped: string[];
  parked: boolean;
  move: Move | null;
  /** R5 (Task 18): the Foreman's answer to each note of his last notes block; null when its newest reply has none. */
  asked: null | { total: number; done: number; notes: NoteAnswer[] };
  steps: StepRow[];
  /** conversation.more: older items left out (the website keeps the newest 60). */
  rows: { conversation: { count: number; more?: boolean }; decisions: { count: number } };
  open: ReaderTarget;
  thread: ThreadLine[];
  /** R8 (Task 16): the one message waiting for the Foreman (dashboard/lib/queued.js); why: a refusal when it was time to send. */
  waiting: null | { text: string; at: string; why: string | null; toBox?: true };
  prs: PrLine[];
  /** R2 (Task 20): the GitHub read the PR lines come from; null when none is known (the website). Absent from an older Starbase. */
  github?: GithubRead | null;
  /** Task 21: the PR comments not answered yet, one line under Your move (`PR #1 · 3 new comments`). Absent from an older Starbase. */
  prMove?: null | { n: number; fresh: number; since: string | null };
  hosted: boolean;
  /** The hashes of the bodies no line or output names (the ticket and goal, the decisions list): a kept
   *  copy whose hash moved on is dropped. Absent from an older Starbase. */
  hashes?: { ticket: string | null; decisions: string | null; findings?: string | null; checks?: string | null };
  /** Website only: the decision made there for this job's gate (the old page's `queued`), until it is put away. */
  queuedDecision?: unknown;
  /** Website only: every decision made there and still shown for the job, newest first (each followed by its id). */
  queuedDecisions?: unknown[];
}

/** The page route's answer when the caller's v is current. */
export interface SamePage { same: true; v: number }

/** One body (GET /api/job/:slug/item). version: a thread item's line hash, a doc's text hash. */
export interface JobBody {
  id: string;
  kind: string;
  version: string;
  html: string;
  text: string;
  meta: Record<string, unknown>;
}
