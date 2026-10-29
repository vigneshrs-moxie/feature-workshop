// Shapes the dashboard sends. Only the fields the new UI reads are typed; the rest pass through.
// Sources: GET /api/snapshot and /api/events?v=2 in dashboard/server.js, lib/events.js,
// lib/snapshot.js, lib/driver.js (view, viewPermission) and lib/limits.js (view).

import type { ComposeAnswers, ComposeStatus, ComposeVerdicts, GateChip, GateKind } from '../lib/compose';

export type JobGroup = 'needs-you' | 'running' | 'paused' | 'idle' | 'shipping' | 'done';
export const JOB_GROUPS: JobGroup[] = ['needs-you', 'running', 'paused', 'idle', 'shipping', 'done'];

/** The finish line (Settings → Workflow, dashboard/lib/finish.js): what counts as done. */
export type FinishLine = 'pr1-open' | 'pr1-merged' | 'staging' | 'main' | 'marked';
export const FINISH_LINES: FinishLine[] = ['pr1-open', 'pr1-merged', 'staging', 'main', 'marked'];
export const DEFAULT_FINISH_LINE: FinishLine = 'pr1-merged';
/** What crossed the line: the line's own place, or Mark done. */
export type FinishBy = Exclude<FinishLine, 'marked'> | 'marked';
/** A card's `finish` (dashboard/lib/finish.js finishLineReached): the web never works this out itself. */
export interface JobFinish {
  reached: boolean;
  /** When it was crossed, if known (a PR's merge time, the Mark done time). */
  at: string | null;
  by: FinishBy | null;
  /** Where the work has landed past the line, whatever the setting. */
  landed: 'staging' | 'main' | null;
}

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
  /** The finish line: crossed or not, by what, and where the work has landed (dashboards from before send none). */
  finish?: JobFinish;
  /** The PR hand-offs waiting on someone (dashboard/lib/nudges.js): the Desk's nudge items (dashboards from before send none). */
  nudges?: Nudge[];
  /** The screens the wireframer drew (wireframes.html in the job folder), with their version; null or missing when there are none. */
  wireframes?: JobWireframes | null;
  /** The review walkthrough built for the job's branch (dashboard/lib/docs.js walkthroughInfo); url: its published page. */
  walkthrough?: { updatedAt: string; size: number; url: string | null } | null;
  /** Its lane on Jobs (dashboard/lib/snapshot.js laneFor) and the reason in words; dashboards from before send none. */
  lane?: JobLane;
  laneReason?: string;
  /** Who is working on it right now and on what (runner boardCard nowDoing). */
  nowDoing?: NowDoing[];
  /** Stages done out of the job's own stages. */
  progress?: { done: number; total: number };
  /** Stages the job's route or level skips. */
  skipped?: string[];
  route?: string | null;
  questions?: number;
  starting?: boolean;
  /** Another process holds the job (dashboard/lib/lock.js): a terminal, or another copy of the dashboard. */
  lock?: JobLockInfo | null;
  [key: string]: unknown;
}

/** The four lanes of Jobs, and the two folded under the board (dashboard/lib/snapshot.js LANES). */
export type JobLane = 'working' | 'needs-you' | 'in-review' | 'ready' | 'resting' | 'done';
export const JOB_LANES: JobLane[] = ['working', 'needs-you', 'in-review', 'ready', 'resting', 'done'];

/** One agent at work on a job right now (the Foreman, or a crew member by its agent type). */
export interface NowDoing {
  who: string;
  name?: string;
  doing?: string | null;
  since?: string | null;
  lastAt?: string | null;
  quietMs?: number | null;
}

/** Who holds a job elsewhere (dashboard/lib/lock.js; a refused send's 409 carries the same). */
export interface JobLockInfo {
  owner: 'runner' | 'terminal';
  pid: number | null;
  branch: string | null;
  acquiredAt: string | null;
}

export type NudgeId = 'pr1-merge' | 'pr2-open' | 'pr2-review' | 'pr2-changes' | 'pr2-merge' | 'pr1-merged' | 'pr2-merged';

/**
 * A hand-off nudge (dashboard/lib/nudges.js): one PR step that waits on you (a link to GitHub) or
 * that the Foreman can take on when you say yes (`action.send` is the sentence it gets, through
 * POST /api/job/:slug/nudge/:id/yes; …/dismiss puts it away for this job).
 */
export interface Nudge {
  id: NudgeId;
  kind: 'link' | 'ask';
  title: string;
  text: string;
  link: string | null;
  action: { send: string } | null;
  /** The job is past your finish line: the Desk lists it under Shipping, never first. */
  afterLine: boolean;
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

/** A job's wireframes page (GET /api/job/:slug/wireframes): its version as the records name it, and when it last changed. */
export interface JobWireframes {
  version: string | null;
  updatedAt?: string | null;
  size?: number;
}

/** Spec and artifact versions as status.json names them: { spec: '0.3', artifacts: { 'implementation-plan': '2' } }. */
export interface Versions {
  spec: string | null;
  artifacts: Record<string, string | null>;
}

/** One answer to a question. `consequence`: one line on what changes if it is picked (always on a clarify brief). */
export interface GateOption {
  id: string;
  label: string;
  consequence?: string | null;
}

/** One of the Foreman's questions in its brief (status.json `questions`, at most three; five on a clarify brief). */
export interface GateQuestion {
  id: string;
  text: string;
  recommendation: string | null;
  options: GateOption[];
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
  /** The proof stamp: the commit the test report checked and the branch's head now (lib/proof.js); absent without a test report. */
  proof?: { tested: string; head: string | null; stale: boolean; reportAt: string | null } | null;
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
  /** In Settings → Repos (the registry), so it has a profile. */
  registered?: boolean;
}

/** Where a registered repository's profile comes from: its own ground-control.md, or a file named in Settings → Repos. */
export type ProfileSource = 'repo' | 'registry';

/** One repository in Settings → Repos (GET /api/repos/registry, lib/repos.js), with what its profile says. */
export interface RegisteredRepo {
  path: string;
  /** The folder's name. */
  folder: string;
  /** The profile's name for it, or the folder's name when the profile can't be read. */
  name: string;
  github: string | null;
  profileFile: string | null;
  profileSource: ProfileSource | null;
  /** The profile loads with no errors. */
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Try it's ports, in words: "3001-3099" or "3001 and up". */
  ports: string | null;
  /** The folder is still there. */
  exists: boolean;
}

/** GET /api/repos/registry. unreadable: the list file, when it can't be read (then nothing can be saved). */
export interface RepoRegistry {
  repos: RegisteredRepo[];
  file: string;
  unreadable?: string | null;
}

/** POST /api/repos/registry/check: what a profile says, and what is wrong with it. */
export interface ProfileCheck {
  ok: boolean;
  file?: string | null;
  errors: string[];
  warnings: string[];
  name?: string | null;
  github?: string | null;
  ports?: string | null;
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
  /**
   * detail: the tool's own description (AI-written). blockedPath: a folder outside the project it
   * touches, shown exactly as written. previewCut: the preview was cut to this many characters.
   * previewHtml: a Markdown file being written, rendered and sanitised by the dashboard;
   * previewStart 'source': show its exact source first (instructions files, or outside the job folder).
   */
  plain?: {
    headline: string; detail?: string | null; blockedPath?: string | null; preview?: string | null; previewCut?: number | null;
    previewHtml?: string | null; previewStart?: 'source' | 'page' | null; risk?: string; [key: string]: unknown;
  };
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

/** Play mode (Settings → Play): Subtle is the default; Off is the Workshop without the Play layer. */
export type PlayMode = 'subtle' | 'full' | 'off';

/** settings.play (dashboard/lib/play.js playSettings). */
export interface PlaySettings {
  mode: PlayMode;
  /** Chiptune blips, Full mode only; off unless you turn them on. */
  sounds: boolean;
  /** Dashboards from before the finish line sent the quest rule here; it is ignored now. */
  questDone?: string;
}

/** Screens (wireframes) and Clarify questions for new jobs: Auto (the workflow decides), Always, or Off. */
export type WorkflowChoice = 'auto' | 'always' | 'off';
export const WORKFLOW_CHOICES: WorkflowChoice[] = ['auto', 'always', 'off'];

/** settings.workflow (Settings → Workflow): the finish line (dashboard/lib/finish.js) and the defaults a new job starts with. */
export interface WorkflowSettings {
  finishLine: FinishLine;
  wireframes?: WorkflowChoice;
  clarify?: WorkflowChoice;
  /** Let the dashboard pick each job's level (dashboard/lib/auto-level.js). Off by default. */
  autoLevel?: boolean;
  /** Sections of stacks that build at once, across every stack (1 to 20; absent: the default, 3). Saved by POST /api/stacks/cap. */
  sectionsAtOnce?: number;
}

/** The dashboard's settings (meta.settings; also sent whole in the 'settings' live event). */
export interface Settings {
  policy: PolicyId;
  /** Jobs with their own setting, by job folder (JobDetail.dir). */
  jobPolicy?: Record<string, PolicyId>;
  autoMode?: AutoModeStatus;
  play?: PlaySettings;
  notify?: NotifySettings;
  workflow?: WorkflowSettings;
  [key: string]: unknown;
}

// ---------- Notifications outside the browser (dashboard/lib/notify.js) ----------

export type NotifyLevel = 'needs' | 'problem' | 'done';
/** The usage warnings' own level (dashboard/lib/notify.js USAGE_LEVEL): one switch, usageWarnings. */
export type NotifyUsageLevel = 'usage';
export type NotifyMode = 'sound' | 'silent' | 'off';
export interface NotifySettings {
  enabled: boolean;
  levels: Record<NotifyLevel, NotifyMode>;
  quiet: { on: boolean; from: string; to: string };
  skipWhenWatching: boolean;
  /** The usage warnings' switch (on unless turned off). */
  usageWarnings?: boolean;
}
/** One notification, sent or not (GET /api/notifications history, newest first). */
export interface NotificationEntry {
  at: string;
  level: NotifyLevel | NotifyUsageLevel;
  title: string;
  body: string;
  slug: string | null;
  sent: boolean;
  why?: string;
  test?: boolean;
}
export interface NotificationsView {
  /** How notifications reach macOS here; null: they can't (not a Mac, or nothing to send them with). */
  method: 'terminal-notifier' | 'osascript' | null;
  /** macOS refused terminal-notifier the last time (its notifications aren't allowed yet); null otherwise. */
  blocked?: string | null;
  history: NotificationEntry[];
}

// ---------- The flow map (dashboard/lib/flow.js, GET /api/flow) ----------

/** Where a job's work is: its worktree, your fork, the org's branch, staging, main. */
export type FlowPosition = 'local' | 'fork' | 'org' | 'staging' | 'main';
export interface FlowPr {
  number: number;
  title: string;
  url: string | null;
  state: 'open' | 'draft' | 'merged' | 'closed';
  head: string;
  base: string;
  review: 'approved' | 'changes_requested' | 'review_required' | null;
  checks: 'passing' | 'pending' | 'failing' | null;
  mergedAt: string | null;
  updatedAt: string | null;
}
export interface FlowCounts { ahead: number; behind: number }
export interface FlowLane {
  slug: string;
  title: string | null;
  branch: string | null;
  worktree: string | null;
  position: FlowPosition;
  /** The index of `position` in local → fork → org → staging → main. */
  reached: number;
  vsMain: FlowCounts | null;
  vsStaging: FlowCounts | null;
  /** Commits not pushed to your fork yet; null when the branch isn't on the fork. */
  unpushed: number | null;
  forkBehind: number | null;
  /** Uncommitted files in the worktree; null without one. */
  dirty: number | null;
  pushed: boolean;
  orgBranch: boolean;
  /** Fork → the org's branch (PR #1); null in a repo without that step. */
  pr1: FlowPr | null;
  /** Into staging (PR #2), or into main where there is no staging. */
  pr2: FlowPr | null;
}
export interface FlowTip { sha: string; at: string; subject: string }
export interface FlowRepo {
  repo: string;
  name: string;
  org: { remote: string; slug: string | null } | null;
  fork: { remote: string; slug: string | null } | null;
  main: { ref: string; tip: FlowTip | null } | null;
  staging: { ref: string; tip: FlowTip | null; vsMain: FlowCounts | null } | null;
  /** The open release PR (staging → main), if any. */
  release: FlowPr | null;
  /** Whether the PRs were read (false until the first network refresh, or when gh isn't there). */
  prsKnown: boolean;
  lanes: FlowLane[];
  errors: string[];
}
export interface FlowView {
  repos: FlowRepo[];
  /** The last fetch and PR read (null before the first). */
  fetchedAt: string | null;
  /** The last local recount. */
  checkedAt: string | null;
  refreshing: boolean;
  nextFetchAt: string | null;
}

/** One achievement (dashboard/lib/play.js ACHIEVEMENTS). unlockedAt: null while still to get. */
export interface Achievement {
  id: string;
  name: string;
  howTo: string;
  /** An easter egg: listed only once found. */
  secret: boolean;
  unlockedAt: string | null;
}

/**
 * One crew member you have met, with their stats on this machine. The Foreman (conductor) is never
 * dispatched: its jobs are every job its crew worked on and its dispatches the work it handed out.
 */
export interface CrewStats {
  firstSeen: string;
  lastSeen: string;
  jobs: number;
  dispatches: number;
  /** Average time on a stage, when the session logs say. */
  avgStageMs: number | null;
  /** Raised as a review lens (review.md). */
  blockers: number;
  majors: number;
}

/** A quest just done (dashboard/lib/play.js newlyDone): the finish line it was counted under, and what crossed it. */
export interface QuestDone {
  slug: string;
  doneAt: string;
  kind: 'feature' | 'bug';
  level: number | null;
  /** The finish line (older ledgers: the old quest rule, 'first-pr' or 'marked-done'). */
  rule: FinishLine | 'first-pr' | 'marked-done';
  by?: FinishBy | null;
}

/** An L3 review's boss defeated (dashboard/lib/play.js newlyDefeated): once per job. hp: what it started with. */
export interface BossDefeated {
  slug: string;
  at: string;
  hp: number;
}

/** The 'play' live event: an achievement unlocked, a quest done, or a boss defeated (one of them). */
export interface PlayNewsData {
  achievement?: Achievement;
  quest?: QuestDone;
  boss?: BossDefeated;
}

/**
 * A job's latest review round for the boss fight (ledgerView reviews): its findings, the hit points
 * they make (blockers 5, majors 3, minors 1), the heaviest round seen (startHp) and when its boss
 * was defeated (L3 only).
 */
export interface ReviewBoss {
  at: string;
  blockers: number;
  majors: number;
  minors: number;
  hp: number;
  startHp: number;
  /** A round raised a blocker or a major: there was a boss to fight (dashboards from before send none). */
  hadBoss?: boolean;
  defeatedAt: string | null;
}

/** A 'play' event the page has heard, kept for the toasts (seq: the event's, so each is shown once). */
export interface PlayNews extends PlayNewsData {
  seq: number;
}

/** GET /api/play with Play mode Off: only that (nothing is read or built). */
export interface PlayOff {
  mode: 'off';
}

/** What GET /api/play answers. */
export type PlayResponse = PlayView | PlayOff;

/** GET /api/play (dashboard/lib/play.js ledgerView). Personal: from this machine's data only. */
export interface PlayView {
  schema: number;
  mode: PlayMode;
  /** The finish line the quests were counted under (dashboards from before send questDone instead). */
  finishLine?: FinishLine;
  questDone?: string;
  /** By agent type; only the crew met so far. */
  crew: Record<string, CrewStats>;
  crewMet: number;
  crewTotal: number;
  quests: {
    done: number;
    bugs: number;
    recent: { slug: string; doneAt: string; kind: 'feature' | 'bug'; level: number | null }[];
    /** Every done quest's slug (dashboards from before the quest track send none). */
    slugs?: string[];
  };
  achievements: Achievement[];
  secrets: { found: string[]; total: number };
  themesTried: string[];
  /** The hidden themes: CRT Terminal (the Konami code) and Gold (10 quests done). */
  unlocks: { crt: boolean; gold: boolean };
  /** Each job's latest review round, by slug (dashboards from before the boss fight send none). */
  reviews?: Record<string, ReviewBoss>;
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
  /** Screenshots and a video of each acceptance line at the test stage (never at L0). */
  evidence?: EvidenceChoice;
  /** When options.json was last written (the options editor's "changed elsewhere" check). */
  updated_at?: string;
  [key: string]: unknown;
}

/** POST /api/job/:slug/options: the options as saved, and the plain lines describing them. */
export interface OptionsResult {
  ok: true;
  options: JobOptions;
  summary: string[];
  /** The updated_at it wrote. */
  updated_at?: string;
}

export interface Meta {
  token: string;
  demo?: boolean;
  /** How the dashboard's notifications reach macOS here; null where they can't (or in the demo). */
  notifyMethod?: 'terminal-notifier' | 'osascript' | null;
  /** The origin a job's screens page is served from (its own, not the dashboard's): the Screens tab frames <origin>/job/<slug>/wireframes. Null when that server couldn't listen (its port was taken): the tab then frames nothing. */
  wireframesOrigin?: string | null;
  /** The Foreman models you can choose, the everyday one first. */
  models?: ModelChoice[];
  settings?: Settings;
  /** The finish line's choices with their words, for Settings → Workflow (dashboard/lib/finish.js). */
  finishLines?: { id: FinishLine; label: string; hint: string }[];
  /** L0–L3 with their hints, for the level picker. */
  levels?: LevelInfo[];
  /** The job options' lists (lib/options.js), for the options editor and the reviewers' names. */
  jobOptions?: JobOptionLists;
  /** Whether the installed /feature skill knows levels (dashboard/lib/skill-check.js). */
  skill?: SkillStatus;
  /** Each crew member's model and effort from its agent file (~/.claude/agents/<type>.md), read only; no Foreman. */
  crewModels?: Record<string, { model: string | null; effort: string | null }>;
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
  /** The plan's 5-hour and weekly usage, for the top bar's meters (lib/plan-usage.js). */
  planUsage?: PlanUsage;
  runTypical?: RunTypical;
  generatedAt: string;
}

/** One usage meter: percent used and when it resets. */
export interface UsageMeter {
  percent: number;
  resetsAt: string | null;
}

/** The plan's usage, read by the dashboard once a minute (GET api/oauth/usage, read-only). */
export interface PlanUsage {
  enabled: boolean;
  fiveHour: UsageMeter | null;
  week: UsageMeter | null;
  checkedAt: string | null;
  /** Why the last read failed, in words; the last good reading stays. */
  error: string | null;
  /** The 80 %, 90 % and full warnings (dashboard/lib/usage-warnings.js); dashboards from before send none. */
  warnings?: UsageWarning[];
}

/** One usage warning as the dashboard sends it (planUsage.warnings). */
export interface UsageWarning {
  id: string;
  meter: 'fiveHour' | 'week';
  threshold: 80 | 90 | 100;
  percent: number;
  resetsAt: string | null;
  text: string;
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

/**
 * A document's or brief's Key points, written by the Foreman (summaries/ in the job folder, read by
 * lib/docs.js readSummary): each part a few short lines, empty when there is nothing to say.
 */
export interface DocSummary {
  outcome: string[];
  risks: string[];
  decisions: { text: string; recommendation: string | null }[];
  changed: string[];
  written: string | null;
  /** The version it describes (null for a brief, or when the Foreman named none). */
  version: string | null;
  /** It describes another (older) version than the document's own. */
  stale: boolean;
  file: string;
}

/** GET /api/job/:slug/doc?file=<file>: one file from the job's folder, rendered and sanitised. */
export interface JobDoc {
  file: string;
  name: string;
  html: string;
  /** The file as written (Markdown or JSON), for the source view and Copy as markdown. */
  text?: string;
  type?: 'md' | 'json';
  updatedAt?: string | null;
  size?: number;
  /** Its Key points, when the Foreman wrote them; null when none. */
  summary?: DocSummary | null;
}

/** The Docs tab's groups, in the order the dashboard lists them. */
export type DocGroup = 'plan' | 'screens' | 'briefs' | 'review' | 'notes' | 'other';

/**
 * One entry of GET /api/job/:slug/docs. `file` is 'spec' for the product spec in the repository.
 * Type 'html' is the wireframes page (wireframes.html), shown in the Screens tab, not as a document.
 */
export interface JobDocEntry {
  file: string;
  name: string;
  group: DocGroup;
  version: string | null;
  updatedAt: string | null;
  size: number;
  type: 'md' | 'json' | 'html';
  /** Whether its Key points are there: for this version, for an older one, or none. */
  summary?: 'current' | 'stale' | null;
}

/** GET /api/job/:slug/docs: every document of the job, grouped. */
export interface JobDocList {
  docs: JobDocEntry[];
}

/** POST /api/job/:slug/render { text }: Markdown you're writing, rendered and sanitised. */
export interface RenderedMarkdown {
  html: string;
}

/** One entry of a job's "Your decisions" log (GET /api/job/:slug/decisions, dashboard/lib/decisions.js). */
export interface Decision {
  at: string | null;
  kind: 'approve' | 'changes' | 'stop' | 'allow' | 'deny' | 'level' | 'options' | 'policy' | 'close' | 'reopen' | 'nudge';
  text: string;
  note?: string;
}

/** How long a Foreman reply usually takes, in ms: overall and by send kind (dashboard/lib/run-typical.js). */
export interface RunTypical {
  all: number | null;
  byKind: Record<string, number>;
}

// ---------- Stacks (dashboard/lib/stack.js describeStack, runner/stacks.js, /api/stacks/*) ----------

/** Sections at once across every stack (Settings → Workflow), when the dashboard hasn't said. */
export const DEFAULT_SECTIONS_AT_ONCE = 3;
export const MAX_SECTIONS_AT_ONCE = 20;

/** A section's state in stack.json (plan §6.3); each comes with its words (StackPart.stateWords). */
export type StackSectionState = 'pending' | 'running' | 'blocked' | 'ready' | 'integrated' | 'failed';
/** Where a stack is: its plan waits for approval, its sections build, they merge, it waits for the push, it is pushed. */
export type StackPhase = 'plan' | 'build' | 'merge' | 'push' | 'pushed';
export type StackStepId = 'plan' | 'build' | 'merge' | 'push';

/** One of the four steps, Plan, Build, Merge and Push, with its state and the same in words. */
export interface StackStep {
  id: StackStepId;
  label: string;
  state: 'done' | 'now' | 'next';
  words: string;
}

/** The one next thing on a stack: the button (label and key) and the sentence that says why. */
export interface StackNext {
  action: 'approve-plan' | 'fix-plan' | 'wait' | 'open-part' | 'hand-back' | 'merge' | 'push' | 'open-job';
  label: string | null;
  key: string | null;
  /** The section the action is about (merge, open, hand back). */
  section?: string;
  words: string;
}

/** Why a section was stopped at its merge, or came back: a clash, files outside its owned paths, nothing to merge, failed checks. */
export interface StackProblem {
  kind: 'conflict' | 'outside' | 'empty' | 'checks';
  words: string;
  files: string[];
  /** The end of the failed check's output. */
  tail?: string;
}

/** One section of a stack, in merge order. */
export interface StackPart {
  /** Its place in the merge order, from 1. */
  n: number;
  name: string;
  brief: string;
  owns: string[];
  dependsOn: string[];
  state: StackSectionState;
  stateWords: string;
  /** Why it waits, or what went wrong, in one sentence (null when there is nothing to say). */
  reason: string | null;
  /** How far its own job has got: step of 4 (plan, implement, test, review), and in words. */
  progress: { stage: string | null; step: number; of: number; words: string };
  /** Its Foreman's reply right now (running, waiting_permission…), or null when none is running. */
  run: string | null;
  /** Its job folder's name (<parent>--<section>), once started. */
  slug: string | null;
  branch: string | null;
  worktree: string | null;
  port: number | null;
  failures: number;
  stuck: boolean;
  problem: StackProblem | null;
  model: string | null;
  effort: string | null;
  mergedAt: string | null;
  mergeSha: string | null;
}

/** One line of stack.json's log: what happened when, in words. */
export interface StackLogLine {
  at: string;
  event: string;
  words: string;
  section?: string;
  [key: string]: unknown;
}

/** One stack (GET /api/stacks/:slug and the answer of every POST on it). */
export interface StackView {
  slug: string;
  title: string | null;
  ticketKey: string | null;
  phase: StackPhase;
  steps: StackStep[];
  next: StackNext;
  /** stack.md as read now (null when there is none yet): its problems, and whether it changed after approval. */
  plan: { ok: boolean; errors: string[]; warnings: string[]; changedSinceApproval: boolean } | null;
  approved: boolean;
  /** Sections at once for this stack. */
  cap: number;
  /** "Merge on its own": pushing waits for a go whatever this says. */
  autoIntegrate: boolean;
  model: string;
  effort: string;
  coordinatorEffort: string;
  /** Sections at once across every stack (Settings → Workflow), and how many build now. */
  globalCap: number;
  globalRunning: number;
  running: number;
  parentBranch: string | null;
  parentWorktree: string | null;
  repo: string | null;
  push: { state: 'waiting' | 'declined' | 'approved' | 'pushed'; approvedAt: string | null; pushedAt: string | null; note: string | null; remote: string | null } | null;
  nextToMerge: string | null;
  /** What runs on the stack now (a merge and its checks), or null. */
  busy: { what: string; section?: string; words: string } | null;
  parts: StackPart[];
  /** Newest first. */
  log: StackLogLine[];
  /** The parent's Foreman: whether it has a session here, the messages waiting for it, and what it was told. */
  coordinator: {
    session: boolean;
    waiting: { at: string; kind: string; words: string }[];
    told: { at: string; kind: string; words: string; sent: boolean; to: string | null }[];
  } | null;
}

/** One stack's line on the Stacks list. */
export interface StackSummary {
  slug: string;
  title: string | null;
  ticketKey: string | null;
  phase: StackPhase;
  steps: StackStep[];
  parts: number;
  /** How many sections are in each state. */
  counts: Partial<Record<StackSectionState, number>>;
  /** What it needs, in words. */
  needs: string;
  action: StackNext['action'];
}

/** GET /api/stacks. */
export interface StacksList {
  stacks: StackSummary[];
  globalCap: number;
  globalRunning: number;
}

/** A job's evidence option (lib/options.js EVIDENCE_CHOICES): Auto is on at L2 and L3; never at L0. */
export type EvidenceChoice = 'auto' | 'always' | 'off';

/** One acceptance line's result in evidence.json (dashboard/lib/evidence.js). */
export type EvidenceStatus = 'passed' | 'failed' | 'skipped';

/** One picture of an acceptance line: its file (relative to the job's evidence/ folder) and what it shows. */
export interface EvidenceShot {
  file: string;
  description: string;
}

/** One acceptance line in evidence.json: AC-<n>, its result, its pictures and its video. */
export interface EvidenceCriterion {
  id: string;
  title: string;
  status: EvidenceStatus;
  /** Why it failed or was skipped ("Nothing to see: …" when it has no spec); null when it passed. */
  reason: string | null;
  /** The tester's spec, e.g. evidence/specs/AC-1.spec.mjs; null when the line has nothing to see. */
  spec: string | null;
  screenshots: EvidenceShot[];
  video: string | null;
}

/** A job's evidence/evidence.json: one recording, for one commit. */
export interface Evidence {
  version: 1;
  commit: string;
  at: string;
  level: LevelNumber | null;
  criteria: EvidenceCriterion[];
}

/** GET /api/job/:slug/evidence: evidence.json and what the strip says around it. */
export interface EvidenceView {
  evidence: Evidence | null;
  /** The commit the test report names now (null: no report yet). */
  commit: string | null;
  /** Whether this job records evidence (its level and its evidence option), and why in plain words. */
  wanted: boolean;
  why: string;
  /** A recording is under way now. */
  recording: boolean;
  /** The last recording that couldn't finish: what to do, and a line to run when there is one. */
  problem: { commit: string | null; message: string; fix: string | null; at: string } | null;
  /** The evidence folder on this computer, and its address (what "Copy link" copies). */
  folder: string;
  folderUrl: string;
}

/** POST /api/job/:slug/evidence/record: the view again; started when the recording carries on by itself. */
export interface EvidenceRecordResult extends EvidenceView {
  ok: true;
  started: boolean;
}

// ---------- The Inbox: your Orbit tickets (dashboard/lib/orbit.js, GET /api/orbit/*) ----------

export interface OrbitStatus {
  tokenPresent: boolean;
  /** Where the token is kept: keytar or keychain (the OS store), or file (a file only you can read). */
  store: 'keytar' | 'keychain' | 'file' | null;
  url: string | null;
  savedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  lastPoll: string | null;
  lastTryAt?: string | null;
  lastError: string | null;
  errorKind: string | null;
  everyMs: number;
  watchers: number;
  waitingMs: number;
  mcp?: { name: string; file: string };
}

/** One ticket in the Inbox. Orbit has no priority any more: the page reads severity only. */
export interface InboxItem {
  key: string;
  number: number;
  title: string;
  type: string | null;
  status: string | null;
  priority: string | null;
  severity: string | null;
  createdAt: string | null;
  changedAt: string | null;
  assignee: { name: string; you: boolean } | null;
  why: string[];
  url: string | null;
  /** The open job already on this ticket. */
  job: { slug: string; title: string } | null;
}

export type InboxAnswer = OrbitStatus & { items: InboxItem[]; view?: string; checkedAt?: string; truncated?: boolean };

// ---------- The Stage: one stop of a job (dashboard/lib/stage-view.js, GET /api/job/:slug/stage/:stop) ----------

/** The seven stops of the Job map; each groups one or more stages. */
export type StopId = 'spec' | 'investigate' | 'plan' | 'build' | 'test' | 'review' | 'ship';

export type StageAgentStatus = 'working' | 'waiting' | 'done' | 'stopped';

/** One agent who works (or worked) on a stop: the Foreman, or a crew member. */
export interface StageAgent {
  /** 'conductor' for the Foreman, else the crew member's agent type. */
  who: string;
  /** Its generic role word (Foreman, Planner, Builder…). */
  role: string;
  model: string | null;
  /** What it is doing now, in one plain line. */
  doing: string | null;
  since: string | null;
  lastAt: string | null;
  status: StageAgentStatus;
  /** How to open it in a terminal: continue the Foreman's session, or follow a crew member's log (read-only). */
  terminal: { kind: 'continue' | 'watch'; ready: boolean; why: string | null };
  /** Its index in the job's activity, which the terminal command names. */
  ref: string;
}

export interface StageView {
  slug: string;
  stop: StopId;
  label: string;
  state: 'done' | 'now' | 'waiting' | 'next' | 'skipped';
  stateWords: string;
  /** When the job reached this stop, if known. */
  since: string | null;
  stages: string[];
  agents: StageAgent[];
  finished: StageAgent[];
  /** The terminal app Open in terminal uses (Try it's choice), and the ones this computer has. */
  terminalApp: string | null;
  terminalApps: string[];
}

// ---------- Telemetry (packet P): GET /api/telemetry?window= (dashboard/lib/telemetry.js, lib/insights.js) ----------

export type TelemetryWindow = '5h' | 'week' | '30d';
/** private: your own jobs, with their names (the lock); common: the whole account, no job names (people). */
export type TelemetryAudience = 'private' | 'common';
export type GraphId = 'limit' | 'ticket-cost' | 'stages' | 'models' | 'people' | 'rework' | 'waiting' | 'pr1' | 'when' | 'cache';

/** One meter's window split into this app's people and Other use (estimated), adding up to the meter. */
export interface LimitSplit {
  meter: 'week' | 'fiveHour';
  /** split: both parts known; no-ratio: only the total; no-readings / stale: nothing to go by this window. */
  state: 'split' | 'no-ratio' | 'no-readings' | 'stale';
  from: string | null;
  to: string | null;
  total: number | null;
  free: number | null;
  app: number | null;
  people: { user: string; usd: number; percent: number }[];
  other: number | null;
  unknown: number | null;
  ratio: number | null;
  sentence: string;
}

export interface TelemetryForecast {
  state: 'fills' | 'resets-first' | 'flat' | 'full' | 'unknown';
  from: { t: string; percent: number } | null;
  to: { t: string; percent: number } | null;
  perHour: number | null;
  fullAt: string | null;
  resetsAt: string | null;
  atReset: number | null;
  sentence: string;
  driver: { app: number; other: number; words: string } | null;
}

export interface WeekStat { label: string; from: string }
export interface LimitData { window: TelemetryWindow; from: string; to: string; points: { t: string; week: number | null; fiveHour: number | null }[]; resets: string[]; forecast: TelemetryForecast; split: LimitSplit; fiveHour: LimitSplit }
export interface TicketCostData { unit: 'usd'; cap: number | null; weeks: (WeekStat & { tickets: number; median: number | null; low: number | null; high: number | null })[] }
export interface StagesData { months: [string, string]; stages: { stage: string | null; label: string; usd: number; share: number; lastUsd: number; lastShare: number | null }[] }
export interface ModelsData {
  series: { key: string; label: string; slot: number }[];
  bars: { label: string; usd: number; parts: { key: string; usd: number; share: number }[] }[];
  saving: { stage: string; stageLabel: string; from: string; fromLabel: string; to: string; toLabel: string; usd: number; fromModel: string; toModel: string } | null;
}
export interface PeopleData { window: TelemetryWindow; people: { user: string; usd: number; percent: number | null }[]; others: { label: string; percent: number; estimated: true } | null; free: number | null; unknown: number | null; state: LimitSplit['state'] }
export interface ReworkData { stages?: { stage: string | null; label: string; sendBacks: number; usd: number; share: number }[] }
export interface WaitingData { weeks?: (WeekStat & { day: number; night: number; answers: number; median: number | null })[] }
export interface Pr1Data { items: { label: string; size: 'small' | 'large' | 'unknown'; days: number }[]; medians: Record<'small' | 'large' | 'unknown', number | null>; cap: number | null }
export interface WhenData { unit: 'percent' | 'usd'; max: number; cells: { day: number; block: number; app: number; other: number; total: number }[] }
export interface CacheData { weeks: (WeekStat & { share: number | null; input: number })[]; least: { label: string; share: number; restarts: number; usd: number }[] }

interface GraphBase<I extends GraphId, D> {
  id: I;
  n: number;
  title: string;
  audience: TelemetryAudience;
  /** ok; not-enough (too little to say yet); cannot-see (its source isn't here); empty (nothing yet). */
  state: 'ok' | 'not-enough' | 'cannot-see' | 'empty';
  headline: string;
  todo: string;
  sub: string | null;
  data: D;
  table: { caption: string; head: string[]; rows: string[][] };
  notes: string[];
}
export type TelemetryGraph =
  | GraphBase<'limit', LimitData> | GraphBase<'ticket-cost', TicketCostData> | GraphBase<'stages', StagesData> | GraphBase<'models', ModelsData>
  | GraphBase<'people', PeopleData> | GraphBase<'rework', ReworkData> | GraphBase<'waiting', WaitingData> | GraphBase<'pr1', Pr1Data>
  | GraphBase<'when', WhenData> | GraphBase<'cache', CacheData>;

export interface TelemetryResponse {
  window: TelemetryWindow;
  windowLabel: string;
  from: string;
  to: string;
  /** The person this computer's page is for (the computer's user name). */
  me: string | null;
  percentPerDollar: number | null;
  /** Usage lines in the window. */
  lines: number;
  limits: { week: LimitSplit; fiveHour: LimitSplit; note: string };
  graphs: TelemetryGraph[];
  sources: { audit: boolean; jobs: boolean };
  meters: PlanUsage;
  file: string;
}
