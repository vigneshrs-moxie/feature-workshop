// Shapes the dashboard sends. Only the fields the new UI reads are typed; the rest pass through.
// Sources: GET /api/snapshot and /api/events?v=2 in dashboard/server.js, lib/events.js,
// lib/snapshot.js, lib/driver.js (view, viewPermission) and lib/limits.js (view).

export type JobGroup = 'needs-you' | 'running' | 'paused' | 'idle' | 'done';
export const JOB_GROUPS: JobGroup[] = ['needs-you', 'running', 'paused', 'idle', 'done'];

export interface Job {
  slug: string;
  title: string;
  kind?: string;
  group: JobGroup;
  stage?: string;
  stageState?: string;
  needsYou?: boolean;
  working?: boolean;
  permissions?: number;
  waitingFor?: string | null;
  waitingSince?: string | null;
  headline?: string | null;
  updatedAt?: string | null;
  limitPaused?: string | null;
  project?: { name: string; path?: string };
  repo?: { name: string; branch?: string | null } | null;
  cost?: { totalUsd: number; source?: string } | null;
  [key: string]: unknown;
}

/** One question in a Foreman's AskUserQuestion request. */
export interface AskedQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
}

/** What a saved "Always allow" rule covers (dashboard/lib/rules.js, matchRule in lib/policy.js). */
export type RuleKind = 'exact' | 'prefix' | 'domain' | 'tool';

export interface RuleOption {
  kind: RuleKind;
  value: string;
  /** Plain words, lower case: "run exactly “npm test”". */
  label: string;
}

/** The narrowest rule covering one request first, then wider ones you may pick and edit. */
export interface RuleDraft {
  tool: string;
  options: RuleOption[];
}

export interface Rule {
  id: string;
  tool: string;
  kind: RuleKind;
  value: string;
  label: string;
  createdAt: string | null;
  from?: { slug?: string; title?: string | null; headline?: string | null };
}

/** GET /api/rules. active: false while "ask about everything" is on (the rules wait). */
export interface RulesList {
  rules: Rule[];
  active: boolean;
  unreadable: string | null;
}

export interface Permission {
  id: string;
  slug: string;
  runId?: string;
  featureDir?: string;
  /** Which job it belongs to (its title), for cards shown outside the job. */
  title?: string;
  /** 'question' for AskUserQuestion; anything else is a permission. */
  kind?: string;
  toolName?: string;
  createdAt?: string;
  /** Who asks: a crew member's agent type, or null for the Foreman itself. */
  agentType?: string | null;
  input?: Record<string, unknown> & { questions?: AskedQuestion[]; command?: string };
  plain?: { headline: string; detail?: string | null; preview?: string | null; risk?: string; [key: string]: unknown };
  decisionReason?: string | null;
  /** Claude Code flagged it as risky: "Always allow" isn't offered. */
  defaultToNo?: boolean;
  /** "Allow for this reply" is offered (Claude Code suggested a rule for this reply). */
  canAllowForRun?: boolean;
  suggestions?: unknown[];
  draft?: RuleDraft | null;
  /** On a hard line (dashboard/lib/hard-lines.js): it asks every time, whatever your setting. */
  hardLine?: { line: string; reason: string } | null;
  /** Auto mode's safety model couldn't decide this one, so it came to you. */
  fromAutoMode?: boolean;
  [key: string]: unknown;
}

/** The permission settings: routine steps automatic (the default), ask about everything, auto mode. */
export type PolicyId = 'hands-off' | 'ask-all' | 'auto';

/** Whether auto mode works for this account. available: null until a reply has tried it. */
export interface AutoModeStatus {
  available: boolean | null;
  reason: string | null;
  checkedAt: string | null;
}

/** The dashboard's settings (meta.settings; also sent whole in the 'settings' live event). */
export interface Settings {
  policy: PolicyId;
  /** Jobs with their own setting, by job folder (JobDetail.dir). */
  jobPolicy?: Record<string, PolicyId>;
  autoMode?: AutoModeStatus;
  [key: string]: unknown;
}

export interface Run {
  id: string;
  slug: string;
  status: string;
  startedAt?: string;
  endedAt?: string | null;
  lastAction?: string | null;
  lastText?: string | null;
  error?: string | null;
  [key: string]: unknown;
}

export interface Usage {
  limited: boolean;
  blocking: boolean;
  label: string | null;
  resetsAt: string | null;
  [key: string]: unknown;
}

export interface Meta {
  token: string;
  demo?: boolean;
  settings?: Settings;
  [key: string]: unknown;
}

export interface Snapshot {
  v: 2;
  seq: number;
  epoch: string;
  meta: Meta;
  jobs: Job[];
  needsYou: number;
  permissions: Permission[];
  usage: Usage;
  generatedAt: string;
}

/** One event on /api/events?v=2. */
export interface LiveEvent {
  v: 2;
  type: string;
  job: string | null;
  data: unknown;
  seq: number;
}

// ---------- One job's conversation (GET /api/job/:slug, lib/thread.js) ----------

/** Shown only when present (workflow draft): judgement calls a worker made, and its proof lines. */
export interface Extras {
  rulings?: string | string[] | null;
  proof?: string | string[] | null;
}

interface ItemBase extends Extras {
  /** Stable across fetches: brief:<file>, <kind>:<hash>, auto:<hash> (lib/thread.js). */
  id: string;
  at: string | null;
}

export interface BriefItem extends ItemBase {
  kind: 'brief';
  number: number;
  stage: string;
  file: string;
  headline: string | null;
  point: string | null;
}
export interface YouItem extends ItemBase { kind: 'you'; text: string; sendKind?: string }
/** `html` is rendered and sanitised by the dashboard (lib/markdown.js: raw HTML escaped, unsafe links dropped). */
export interface ReplyItem extends ItemBase { kind: 'reply'; html: string; stopped?: boolean }
/** rule: the id of your saved "Always allow" rule that let it run, when one did. */
export interface AutoStep { at: string | null; headline: string; who?: string; reason?: string; rule?: string }
export interface AutoItem extends ItemBase { kind: 'auto'; runId?: string; items: AutoStep[] }
export interface ProblemItem extends ItemBase { kind: 'problem'; text: string }
export interface NoteItem extends ItemBase { kind: 'note'; text: string }
export interface DecisionItem extends ItemBase { kind: 'decision'; text: string }

/** An action refused without a card: by auto mode's safety model, or by a hard line. */
export interface BlockedItem extends ItemBase { kind: 'blocked'; by: 'auto' | 'hard-line'; text: string; preview?: string | null; reason?: string | null; who?: string }

export type ThreadItem = BriefItem | YouItem | ReplyItem | AutoItem | ProblemItem | NoteItem | DecisionItem | BlockedItem;

/** The parts of GET /api/job/:slug the Foreman pane reads. */
export interface JobDetail {
  slug: string;
  title?: string;
  kind?: string;
  branch?: string | null;
  repoPath?: string | null;
  run?: Run | null;
  thread: ThreadItem[];
  threadMore: boolean;
  /** The job's folder (the key of Settings.jobPolicy). */
  dir?: string;
  /** The permission setting in force for this job, and its own one (null: it follows yours). */
  policy?: PolicyId;
  policyOverride?: PolicyId | null;
  [key: string]: unknown;
}

/** POST /api/job/:slug/policy. */
export interface JobPolicyResult {
  policy: PolicyId;
  policyOverride: PolicyId | null;
  globalPolicy: PolicyId;
  autoMode: AutoModeStatus;
}

/** GET /api/job/:slug?before=<id>: the page of items just before that one. */
export interface ThreadPage {
  slug: string;
  thread: ThreadItem[];
  threadMore: boolean;
}

/** GET /api/job/:slug/doc?file=<file>: one file from the job's folder, rendered and sanitised. */
export interface JobDoc {
  file: string;
  name: string;
  html: string;
}
