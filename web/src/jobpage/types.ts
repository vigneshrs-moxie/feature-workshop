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
  'walkthrough', 'ship', 'pr', 'ticket', 'conversation', 'decisions', 'details', 'not-yet'] as const;
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

export interface GateMove {
  kind: 'gate';
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

export interface QuestionMove { kind: 'question'; ask: string; since: string | null; quick: string[]; itemId: string }

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

export interface PrLine {
  n: 1 | 2 | 3;
  number: number | null;
  url: string | null;
  state: string;
  word: string;
  next: null | { id: string; label: string; says: string[] };
  comments: null | { fresh: number; total: number };
}

export interface NoteAnswer { n: number; note: string; done: boolean; what: string; target: ReaderTarget | null }

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
  local?: { dir: string | null; worktree: string | null; policyOverride: PolicyId | null; started: boolean };
  heldReply: null | { kind: string; gateBrief: number | null; at: string };
  usage: null | { limited: boolean; resetsAt: string | null; label: string | null; line: string | null };
  closed: Closed | null;
  skipped: string[];
  parked: boolean;
  move: Move | null;
  /** R5 (Task 18); null until then. */
  asked: null | { total: number; done: number; notes: NoteAnswer[] };
  steps: StepRow[];
  /** conversation.more: older items left out (the website keeps the newest 60). */
  rows: { conversation: { count: number; more?: boolean }; decisions: { count: number } };
  open: ReaderTarget;
  thread: ThreadLine[];
  /** R8 (Task 16): the one message waiting for the Foreman; null until then. */
  waiting: null | { text: string; at: string; why: string | null };
  prs: PrLine[];
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
