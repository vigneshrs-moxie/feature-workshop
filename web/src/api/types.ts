// Shapes the dashboard sends. Only the fields the new UI reads are typed; the rest pass through.
// Sources: GET /api/snapshot and /api/events?v=2 in dashboard/server.js, lib/events.js,
// lib/snapshot.js, lib/driver.js (view, viewPermission) and lib/limits.js (view).

import type { ComposeAnswers, ComposeStatus, ComposeVerdicts, GateChip, GateKind } from '../lib/compose';

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
  /** Marked done or dropped (POST /api/job/:slug/close), and nothing has happened since. */
  closed?: Closed | null;
  /** Marked done or dropped earlier, but it changed since, so it's back among the open jobs. */
  closedEarlier?: Closed | null;
  /** The level chosen for the job (options.json; null: none yet). */
  level?: LevelNumber | null;
  /** The Foreman's suggested level and its one-line reason (status.json, with its first brief). */
  suggestedLevel?: LevelNumber | null;
  levelReason?: string | null;
  /** The rules' suggestion (lib/levels.js): from the description here, plus changed paths on the job page. */
  rulesLevel?: RulesLevel | null;
  /** Its gate has waited past the parking time (4 hours): still under Needs you, shown as parked. */
  parked?: boolean;
  [key: string]: unknown;
}

export type LevelNumber = 0 | 1 | 2 | 3;

/** The rules' level suggestion (dashboard/lib/levels.js suggestLevel), no model involved. */
export interface RulesLevel {
  level: LevelNumber;
  /** The lowest level a risk trigger allows (0: none fired). */
  floor: number;
  /** Plain sentences, one per reason. */
  reasons: string[];
  /** Only the reasons that set the floor (dashboards from before this send none). */
  floorReasons?: string[];
  /** Ids of the risk triggers that fired ('migrations', 'auth', ...). */
  triggers: string[];
  /** Whether the branch's changed paths were read too (the job page only, once a worktree exists). */
  fromDiff: boolean;
  /** How many files the branch changes (null when not read). */
  changedFiles: number | null;
}

/** Spec and artifact versions as status.json names them: { spec: '0.3', artifacts: { 'implementation-plan': '2' } }. */
export interface Versions {
  spec: string | null;
  artifacts: Record<string, string | null>;
}

/** One of the Foreman's questions in its brief (status.json `questions`, at most three). */
export interface GateQuestion {
  id: string;
  text: string;
  recommendation: string | null;
  options: { id: string; label: string }[];
}

/** Something the Foreman decided on your behalf (status.json `decided_on_your_behalf`). */
export interface DecidedItem {
  id: string | null;
  decision: string;
  reason: string | null;
  where: string | null;
  confirmed: boolean;
}

/**
 * What the Foreman waits for you to decide (GET /api/job/:slug `gate`, dashboard/lib/gate.js);
 * null when it isn't waiting.
 */
export interface Gate {
  briefNumber: number | null;
  /** The brief's file in the job folder, e.g. briefs/002-plan.md. */
  briefFile: string | null;
  headline: string | null;
  stage: string | null;
  /** The stage that runs after this one (skipped stages left out). */
  nextStage: string | null;
  nextProposed: string | null;
  questions: GateQuestion[];
  /** decided_on_your_behalf: the "Also decided" list. */
  decided: DecidedItem[];
  /** The versions status.json names now. */
  versions: Versions | null;
  /** The versions this gate was raised at (remembered for its brief; the ones now when none were). */
  raisedVersions: Versions | null;
  /** The spec or an artifact named at raise time has a different version now: the card greys out. */
  stale: boolean;
  waitingSince: string | null;
  /** The Foreman is working on a reply for this job right now. */
  runActive: boolean;
  /** Waited past the parking time with nothing running (never true while runActive). */
  parked: boolean;
  level: LevelNumber | null;
  suggestedLevel: LevelNumber | null;
  levelReason: string | null;
  /** One line about Claude's usage limit when the next stage is build, test or review and the limit is reached or close. */
  usage: string | null;
}

/** 'gate-stale' event data: a gate waited past the parking time (sent once per gate, also across restarts). */
export interface GateStale {
  job: string;
  briefNumber: number | null;
  waitingSince: string | null;
}

/** How a job was marked: done or dropped, with your note. */
export interface Closed {
  as: 'done' | 'dropped';
  note?: string | null;
  at?: string;
  worktreeRemoved?: string | null;
}

/** A repository you can start a job in (GET /api/repos, lib/repos.js), most recently used first. */
export interface Repo {
  path: string;
  name: string;
  lastUsed?: string | null;
}

/** One past Claude Code conversation (GET /api/history, lib/history.js). */
export interface HistoryRow {
  id: string;
  title: string;
  firstPrompt?: string | null;
  messages?: number;
  cwd?: string | null;
  /** The git repository it ran in, or null when it ran outside one. */
  repo?: string | null;
  branch?: string | null;
  lastAt?: string | null;
  contextTokens?: number | null;
  [key: string]: unknown;
}

/** GET /api/history?q=... canContinue: false in the demo or with a custom history folder. */
export interface HistoryList {
  rows: HistoryRow[];
  matched: number;
  total: number;
  canContinue: boolean;
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

/**
 * GET /api/rules. active: false while your (global) setting is "ask about everything" (the rules
 * wait). jobOverrides: jobs whose own setting makes that different for them.
 */
export interface RulesList {
  rules: Rule[];
  active: boolean;
  jobOverrides?: number;
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

/**
 * Where a message you steered into a reply in progress is (dashboard/lib/driver.js): accepted by the
 * dashboard, handed to Claude Code, answered by the Foreman, never read (the reply stopped first), or
 * handed over but never answered (the reply ended first).
 */
export type SteerState = 'queued' | 'delivered' | 'acted-on' | 'cancelled' | 'unanswered';

/** A steered message (POST /api/runs/:id/steer, 'steer' events, Run.steers). */
export interface Steer {
  id: string;
  runId: string;
  slug: string;
  text: string;
  state: SteerState;
  queuedAt?: string;
  deliveredAt?: string | null;
  actedAt?: string | null;
}

/** A Foreman model you can choose (meta.models). */
export interface ModelChoice {
  id: string;
  label: string;
  note?: string;
}

export interface Run {
  id: string;
  slug: string;
  status: string;
  model?: string | null;
  steers?: Steer[];
  startedAt?: string;
  endedAt?: string | null;
  lastAction?: string | null;
  lastText?: string | null;
  error?: string | null;
  [key: string]: unknown;
}

/** Claude's usage limit as the dashboard sees it (lib/limits.js view()). */
export interface Usage {
  limited: boolean;
  blocking: boolean;
  label: string | null;
  resetsAt: string | null;
  /** Claude said when it resets (else the dashboard just tries again then). */
  resetKnown?: boolean;
  /** The reset time has gone by (it still blocks while automatic carry-on is off). */
  passed?: boolean;
  /** The jobs it paused; they carry on once it lifts. held: a gate reply waits to be sent then. */
  jobs?: { slug: string; title: string; held?: boolean }[];
  /** Paused jobs carry on by themselves when it resets. */
  autoResume?: boolean;
  /** Close to the limit, not there yet. */
  warning?: { label: string; percent: number | null; resetsAt: string | null } | null;
  [key: string]: unknown;
}

/** One workflow level, L0 Tweak to L3 Large (meta.levels, lib/options.js LEVELS). */
export interface LevelInfo {
  level: 0 | 1 | 2 | 3;
  /** "L2 Standard". */
  label: string;
  name: string;
  /** One line: what runs at this level. */
  hint: string;
  /** The flow an un-updated skill reads for it. */
  flow: 'quick' | 'small' | 'large';
  models: { foreman: string; build: string; checks: string };
  /** Stages this level skips by default (ids as in the job options). */
  skip: string[];
  /** Its default reviewers: agent ids, or 'auto' (the Foreman picks the usual ones). */
  reviewers: string[] | 'auto';
  /** You try it yourself before review, by default at this level. */
  manualTest?: boolean;
  /** Fable second-look points by default ('plan', 'review', ...). */
  fable?: string[];
}

/** One reviewer (lens) the job options can name (meta.jobOptions.reviewers, lib/options.js REVIEWERS). */
export interface ReviewerInfo {
  id: string;
  /** Its friendly name: "Locksmith". */
  label: string;
  what?: string;
  model?: string;
}

/** A job's options.json as the dashboard reads it (lib/options.js); only what the new UI reads is typed. */
export interface JobOptions {
  schema_version?: number;
  level?: LevelNumber | null;
  flow?: string;
  skip?: string[];
  provided?: Record<string, string>;
  reviewers?: string[] | 'auto';
  review_rounds?: number;
  manual_test?: boolean;
  fable_checks?: string[];
  models?: { foreman?: string; build?: string; checks?: string };
  notes?: string;
  [key: string]: unknown;
}

/** POST /api/job/:slug/options: the options as saved, and the plain lines describing them. */
export interface OptionsResult {
  ok: true;
  options: JobOptions;
  summary: string[];
}

export interface Meta {
  token: string;
  demo?: boolean;
  /** The Foreman models you can choose, the everyday one first. */
  models?: ModelChoice[];
  settings?: Settings;
  /** L0–L3 with their hints, for the level picker. */
  levels?: LevelInfo[];
  /** The job options' lists (lib/options.js), for the options editor and the reviewers' names. */
  jobOptions?: JobOptionLists;
  /** Whether the installed /feature skill knows levels (dashboard/lib/skill-check.js). */
  skill?: SkillStatus;
  [key: string]: unknown;
}

/** One choice in a job options list: a stage to skip, a Fable point, a document you can provide. */
export interface OptionChoice {
  id: string;
  label: string;
  /** PROVIDABLE only: the stages a provided document skips. */
  skips?: string[];
}

/** One model the options can name, with its friendly name (lib/options.js MODEL_CHOICES). */
export interface ModelInfo {
  id: string;
  label: string;
  note?: string;
}

/** meta.jobOptions. */
export interface JobOptionLists {
  skippable?: OptionChoice[];
  providable?: OptionChoice[];
  reviewers?: ReviewerInfo[];
  fablePoints?: OptionChoice[];
  /** The ids allowed for the Foreman and for the crew (build, checks), and every model's name. */
  models?: { foreman?: string[]; crew?: string[]; choices?: ModelInfo[] };
  /** notes.md's size cap, in characters. */
  notesMax?: number;
  [key: string]: unknown;
}

/** meta.skill: the installed skill's job-options.md, read only. levels: it has the Levels table. */
export interface SkillStatus {
  installed: boolean;
  levels: boolean;
  path: string;
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
  /** The versions it was raised at: only on the brief status.json names (null for older ones). */
  versions?: Versions | null;
}
/**
 * steerId: set when you steered it into a reply in progress (its delivery state is in the store).
 * gateBrief: sent from a gate card, answering that brief.
 */
export interface YouItem extends ItemBase { kind: 'you'; text: string; sendKind?: string; steerId?: string; runId?: string; gateBrief?: number }
/** `html` is rendered and sanitised by the dashboard (lib/markdown.js: raw HTML escaped, unsafe links dropped). */
export interface ReplyItem extends ItemBase { kind: 'reply'; html: string; stopped?: boolean }
/** rule: the id of your saved "Always allow" rule that let it run, when one did. */
export interface AutoStep { at: string | null; headline: string; who?: string; reason?: string; rule?: string }
export interface AutoItem extends ItemBase { kind: 'auto'; runId?: string; items: AutoStep[] }
export interface ProblemItem extends ItemBase { kind: 'problem'; text: string }
/** notes: the line for saves of the job's notes.md (a run of saves is one line). */
export interface NoteItem extends ItemBase { kind: 'note'; text: string; notes?: boolean }
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
  /** Who drives the job's Foreman, and the model it last used (the composer's default). */
  drive?: { mode?: string; model?: string | null; [key: string]: unknown } | null;
  /** What composeReply needs to build your message (dashboard/lib/compose.js). */
  statusForCompose?: ComposeStatus | null;
  thread: ThreadItem[];
  threadMore: boolean;
  /** The job's folder (the key of Settings.jobPolicy). */
  dir?: string;
  /** Its own git worktree, when it has one (Mark done can remove it). */
  worktree?: string | null;
  /** The permission setting in force for this job, and its own one (null: it follows yours). */
  policy?: PolicyId;
  policyOverride?: PolicyId | null;
  /** Levels, as on Job; rulesLevel here also reads the branch's changed paths when it can. */
  level?: LevelNumber | null;
  suggestedLevel?: LevelNumber | null;
  levelReason?: string | null;
  rulesLevel?: RulesLevel | null;
  parked?: boolean;
  /** Its options.json (null: none yet), and the plain lines describing it. */
  options?: JobOptions | null;
  optionsSummary?: string[] | null;
  /** The gate card's content; null when the Foreman isn't waiting for you. */
  gate?: Gate | null;
  /** Brief numbers a gate reply was already sent for. */
  answeredBriefs?: number[];
  /** A gate reply held until Claude's usage limit resets ("Approve, start after reset"), or null. */
  heldReply?: { kind: GateKind; gateBrief: number | null; at: string } | null;
  [key: string]: unknown;
}

/** POST /api/job/:slug/gate: a decision from the gate card (dashboard/server.js). */
export interface GateRequest {
  kind: GateKind;
  /** The brief this card answers; an approval for an older brief than the Foreman's is refused (409 stale-brief). */
  briefNumber?: number | null;
  /** By question id; at most 3. */
  answers?: ComposeAnswers;
  /** By decision id; at most 20. */
  verdicts?: ComposeVerdicts;
  /** At most 4,000 characters. */
  note?: string;
  /** At most 8; malformed ones are left out (chipsDropped). A level chip's `was` is the job's level now. */
  chips?: GateChip[];
  model?: string;
  despiteLimit?: boolean;
  confirmNoTerminal?: boolean;
  /** With the usage limit reached: hold the reply and send it when the limit resets. */
  startAfterReset?: boolean;
  /** "Edit, then approve": the reply as you edited it, sent instead of the composed one (approvals only). */
  text?: string;
}

/**
 * The gate route's answer. sent: it went to the Foreman (run). Otherwise held (until the usage
 * limit resets), or nothing was sent because a reply is in progress (queued: false): `text` is
 * the composed reply for the composer to hold. options/summary: the job's options after the chips.
 */
export interface GateResult {
  ok: true;
  sent: boolean;
  text: string;
  run?: Run;
  held?: boolean;
  resetsAt?: string;
  queued?: false;
  message?: string;
  chipsDropped?: number;
  options?: Record<string, unknown>;
  summary?: string[];
}

/** GET /api/job/:slug/notes (PUT saves { text }). */
export interface JobNotes {
  text: string;
  updatedAt: string | null;
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
