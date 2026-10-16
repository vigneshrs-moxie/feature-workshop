// The gate card's logic, without React: when it shows, what Approve is called, which next-step
// chips apply, and the request the card sends (POST /api/job/:slug/gate, dashboard/server.js).
// The chips' words and stage lists come from the dashboard's own compose.js (bundled by Vite), so
// the page and the dashboard never disagree about a line.
import { CHIP_POINTS, CHIP_SKIPPABLE, CHIP_STAGES, type ChipPoint, type ChipStage } from '../../../dashboard/lib/compose.js';
import type { DecidedItem, Gate, GateRequest, JobDetail, LevelNumber } from '../api/types';
import { stageLabel } from '../panes/Jobs/stages';
import type { ComposeAnswers, ComposeVerdicts, GateChip, GateKind } from './compose';
import { isLevel } from './levels';

// ---------- When the card shows ----------

/** The replies that decide a brief (dashboard/lib/gate.js DECIDING_KINDS); "Other guidance" leaves it open. */
export const DECIDING_KINDS: GateKind[] = ['approve', 'changes', 'stop'];

/**
 * The gate the card shows, or null: the Foreman waits for a decision on a brief that no deciding
 * reply answered yet (sent, or held until the usage limit resets), on a job that isn't marked done.
 */
export function openGate(detail: Pick<JobDetail, 'gate' | 'answeredBriefs' | 'heldReply'> | null | undefined, closed = false): Gate | null {
  const gate = detail?.gate ?? null;
  if (!gate || closed) return null;
  const n = gate.briefNumber ?? null;
  if (n !== null && (detail?.answeredBriefs ?? []).includes(n)) return null;
  const held = detail?.heldReply ?? null;
  if (held && (held.gateBrief ?? null) === n && DECIDING_KINDS.includes(held.kind)) return null;
  return gate;
}

// ---------- What Approve is called ----------

// Which artifact a stage's gate approves, by its name in status.json ("Quick plan", "Findings").
// Each matches only that stage's own: the plan gate not the test plan, the build gate not the
// implementation plan, the test gate not the test plan, the review gate not the investigation's findings.
const STAGE_ARTIFACT: Record<string, RegExp> = {
  plan: /^(?!test\b).*\bplan\b/i,
  investigate: /finding|investigat/i,
  test: /\btest[-_ ]?(report|results?)\b|\bmanual[-_ ]test\b/i,
  review: /review/i,
  implement: /\bbuild\b|\bimplement(ed|ing)?\b/i,
};
const SPEC_STAGES = ['spec', 'refine', 'spec-update'];

function friendly(name: string): string {
  const words = name.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return words === 'implementation plan' ? 'plan' : words;
}

/**
 * What the gate proposes, by name and the version it was raised at: "plan v2", "spec v0.3",
 * "quick plan v1". Only the stage's own artifact counts (the spec for the spec stages): a gate whose
 * stage names none says nothing rather than borrowing the spec or the last artifact. Null then.
 */
export function proposedPhrase(gate: Pick<Gate, 'stage' | 'raisedVersions' | 'versions'>): string | null {
  const v = gate.raisedVersions ?? gate.versions;
  if (!v) return null;
  const stage = gate.stage ?? '';
  if (SPEC_STAGES.includes(stage)) return v.spec != null ? `spec v${v.spec}` : null;
  const want = STAGE_ARTIFACT[stage];
  if (!want) return null;
  const match = Object.entries(v.artifacts ?? {}).find(([name, ver]) => ver != null && want.test(name));
  return match ? `${friendly(match[0])} v${match[1]}` : null;
}

/**
 * The Approve button's words, naming what it approves and what starts: "Approve plan v2 and start
 * Build". With "Skip next" pressed, the next stage is skipped instead; with "I'll do this part",
 * you do it yourself. Falls back to "Approve and start Build" / "Approve and go ahead" when the
 * gate names no version of its own artifact.
 */
export function approveLabel(gate: Pick<Gate, 'stage' | 'nextStage' | 'raisedVersions' | 'versions'>, chips: ChipId[] = []): string {
  const what = proposedPhrase(gate);
  const next = gate.nextStage ? stageLabel(gate.nextStage) : null;
  const head = what ? `Approve ${what}` : 'Approve';
  if (next && chips.includes('skip')) return `${head}, skip ${next} and go ahead`;
  if (next && chips.includes('self')) return `${head}; you do ${next} yourself`;
  if (next) return `${head} and start ${next}`;
  return `${head} and go ahead`;
}

// ---------- The next-step chips ----------

export type ChipId = 'skip' | 'lighter' | 'heavier' | 'fable' | 'self' | 'up' | 'down';
export const CHIP_IDS: ChipId[] = ['skip', 'lighter', 'heavier', 'fable', 'self', 'up', 'down'];
/** How the next stage runs: one of these at a time (pressing one releases the others). */
const STEP_GROUP: ChipId[] = ['skip', 'lighter', 'heavier', 'self'];
const LEVEL_GROUP: ChipId[] = ['up', 'down'];

// The first Fable second-look point at or after each stage, in workflow order: after the spec
// (and its product interview), before the plan is approved, when the review is wrapped up, and
// before the PR.
const NEXT_POINT: Record<string, ChipPoint> = {
  spec: 'spec', refine: 'spec',
  investigate: 'plan', 'spec-update': 'plan', plan: 'plan',
  implement: 'review', test: 'review', review: 'review',
  pr1: 'pr', pr2: 'pr', 'staging-qa': 'pr', pr3: 'pr',
};

/** The Fable point "Ask Fable" adds for a next stage: the first one at or after it (NEXT_POINT); null when there is none. */
export function fablePoint(stage: string | null | undefined): ChipPoint | null {
  const p = stage ? NEXT_POINT[stage] : undefined;
  return p && (CHIP_POINTS as string[]).includes(p) ? p : null;
}

export interface ChipView {
  id: ChipId;
  label: string;
  /** The accessible name, when it differs from the label ("Raise the level to L3"). */
  name: string;
  enabled: boolean;
  /** The hover hint: what it does, or why it doesn't apply here. */
  hint: string;
  /** What it sends when pressed (null when it doesn't apply). */
  chip: GateChip | null;
}

const FABLE_WORDS: Record<string, string> = { spec: 'the spec', plan: 'the plan', review: 'the review', pr: 'the PR' };

/**
 * Each chip for this gate's next stage: whether it applies, its hint, and what it sends.
 * level: the job's level now (null: none chosen). fableChecks: the job's Fable points now.
 */
export function chipViews(gate: Pick<Gate, 'nextStage'>, { level = null, fableChecks = [] }: { level?: LevelNumber | null; fableChecks?: string[] } = {}): ChipView[] {
  const stage = gate.nextStage ?? null;
  const name = stage ? stageLabel(stage) : null;
  const inFlow = stage !== null && (CHIP_STAGES as string[]).includes(stage);
  const noNext = 'There’s no next stage to change here.';
  const notFlow = name ? `${name} is outside the build workflow; this chip is for spec to review.` : noNext;
  const point = fablePoint(stage);
  const lv = isLevel(level) ? level : null;
  const views: ChipView[] = [];

  const skippable = stage !== null && (CHIP_SKIPPABLE as string[]).includes(stage);
  views.push({
    id: 'skip', label: 'Skip next', name: name ? `Skip next (${name})` : 'Skip next', enabled: skippable,
    hint: skippable ? `Skip ${name} for this job: it’s added to the job’s skipped stages, and your reply says so.`
      : stage === 'implement' ? 'Build can’t be skipped: it’s the work itself.' : stage ? notFlow : noNext,
    chip: skippable ? { kind: 'skip', stage: stage as Exclude<ChipStage, 'implement'> } : null,
  });
  views.push({
    id: 'lighter', label: 'Lighter', name: name ? `Lighter (${name})` : 'Lighter', enabled: inFlow,
    hint: inFlow ? `A lighter ${name} this time only: ${stage === 'review' ? 'the head inspector alone' : stage === 'implement' ? 'no tester after it, just the checks' : 'a shorter artifact'}. Nothing else changes.` : notFlow,
    chip: inFlow ? { kind: 'lighter', stage: stage as ChipStage } : null,
  });
  views.push({
    id: 'heavier', label: 'Heavier', name: name ? `Heavier (${name})` : 'Heavier', enabled: inFlow,
    hint: inFlow ? `A fuller ${name} this time only: ${stage === 'review' ? 'every reviewer, as at L3' : stage === 'implement' ? 'the tester runs after it (at L0, a 5-line “what I’ll change” card first)' : 'a fuller artifact'}. Nothing else changes.` : notFlow,
    chip: inFlow ? { kind: 'heavier', stage: stage as ChipStage } : null,
  });
  const already = point !== null && fableChecks.includes(point);
  views.push({
    id: 'fable', label: 'Ask Fable', name: point ? `Ask Fable (${FABLE_WORDS[point]})` : 'Ask Fable', enabled: point !== null && !already,
    hint: point === null ? `Fable takes second looks at the spec, the plan, the review or the PR only${name ? `; there’s none left after ${name}` : ''}.`
      : already ? `Fable already looks at ${FABLE_WORDS[point]} for this job.`
        : `Fable takes a short second look at ${FABLE_WORDS[point]}${stage !== point ? `, the first point it can look at from ${name} on` : ''}: added to the job’s Fable points. It costs more than Opus.`,
    chip: point !== null && !already ? { kind: 'fable', point } : null,
  });
  views.push({
    id: 'self', label: 'I’ll do this part', name: name ? `I’ll do this part (${name})` : 'I’ll do this part', enabled: inFlow,
    hint: inFlow ? `You do ${name} yourself: the Foreman doesn’t start it and waits for you, as for a manual test.` : notFlow,
    chip: inFlow ? { kind: 'self', stage: stage as ChipStage } : null,
  });
  const noLevel = 'Pick a level first: this job has none yet.';
  views.push({
    id: 'up', label: 'L↑', name: lv !== null && lv < 3 ? `Raise the level to L${lv + 1}` : 'Raise the level', enabled: lv !== null && lv < 3,
    hint: lv === null ? noLevel : lv >= 3 ? 'Already L3, the highest level.' : `Raise this job to L${lv + 1} from the next stage.`,
    chip: lv !== null && lv < 3 ? { kind: 'level', level: (lv + 1) as LevelNumber, was: lv } : null,
  });
  views.push({
    id: 'down', label: 'L↓', name: lv !== null && lv > 0 ? `Lower the level to L${lv - 1}` : 'Lower the level', enabled: lv !== null && lv > 0,
    hint: lv === null ? noLevel : lv <= 0 ? 'Already L0, the lowest level.' : `Lower this job to L${lv - 1} from the next stage. An approval still owed is still asked for.`,
    chip: lv !== null && lv > 0 ? { kind: 'level', level: (lv - 1) as LevelNumber, was: lv } : null,
  });
  return views;
}

/** Press or release a chip; pressing one of a group (how the next stage runs, or the level) releases the others. */
export function toggleChip(pressed: ChipId[], id: ChipId): ChipId[] {
  if (pressed.includes(id)) return pressed.filter((c) => c !== id);
  const group = STEP_GROUP.includes(id) ? STEP_GROUP : LEVEL_GROUP.includes(id) ? LEVEL_GROUP : [];
  return [...pressed.filter((c) => !group.includes(c)), id].sort((a, b) => CHIP_IDS.indexOf(a) - CHIP_IDS.indexOf(b));
}

/** The chips to send for the pressed ones, in the card's order (only ones that apply). */
export function chipsFor(views: ChipView[], pressed: ChipId[]): GateChip[] {
  return views.filter((v) => v.enabled && v.chip && pressed.includes(v.id)).map((v) => v.chip as GateChip);
}

// ---------- The card's choices, and the request it sends ----------

/** "Other…" in a question's choices: your own answer in words. */
export const OTHER = '__other';

export interface GateChoices {
  /** By question id: an option id, OTHER, or null (nothing picked). */
  choices: Record<string, string | null>;
  /** By question id: the words for "Other…" (or for a question with no options). */
  others: Record<string, string>;
  /** By decision key: overridden, with what it should be instead. */
  overrides: Record<string, string>;
  chips: ChipId[];
}

/** A decision's key in the verdicts: its id, else its words (dashboard/lib/compose.js does the same). */
export const decidedKey = (d: Pick<DecidedItem, 'id' | 'decision'>) => d.id ?? d.decision;

/** The decisions still to confirm (ones already confirmed aren't listed again). */
export const openDecisions = (gate: Pick<Gate, 'decided'>) => (gate.decided ?? []).filter((d) => !d.confirmed);

/** Fresh choices: each question's recommendation picked (when it is one of its options). */
export function initialChoices(gate: Pick<Gate, 'questions'>): GateChoices {
  const choices: Record<string, string | null> = {};
  for (const q of gate.questions ?? []) {
    const rec = q.recommendation && q.options.some((o) => o.id === q.recommendation) ? q.recommendation : null;
    choices[q.id] = rec;
  }
  return { choices, others: {}, overrides: {}, chips: [] };
}

/** The answers: an option picked, or your own words (for "Other…", or a question without options). */
export function answersFor(gate: Pick<Gate, 'questions'>, c: GateChoices): ComposeAnswers {
  const out: ComposeAnswers = {};
  for (const q of gate.questions ?? []) {
    const pick = c.choices[q.id] ?? null;
    const words = (c.others[q.id] ?? '').trim();
    if (pick === OTHER || q.options.length === 0) { if (words) out[q.id] = { other: words }; }
    else if (pick && q.options.some((o) => o.id === pick)) out[q.id] = { choice: pick };
  }
  return out;
}

/**
 * The first question (1-based) an approval would leave unanswered: nothing picked, or "Other…" (or a
 * question without options) with no words. A question whose recommendation is still picked is
 * answered. Null when every question has an answer.
 */
export function unansweredQuestion(gate: Pick<Gate, 'questions'>, c: GateChoices): number | null {
  const answers = answersFor(gate, c);
  const i = (gate.questions ?? []).findIndex((q) => !(q.id in answers));
  return i < 0 ? null : i + 1;
}

/** The verdicts: each override as "change" with its note; when approving, every other open decision as "confirm". */
export function verdictsFor(gate: Pick<Gate, 'decided'>, c: GateChoices, kind: GateKind): ComposeVerdicts {
  const out: ComposeVerdicts = {};
  for (const d of openDecisions(gate)) {
    const key = decidedKey(d);
    if (key in c.overrides) out[key] = { verdict: 'change', note: c.overrides[key].trim() };
    else if (kind === 'approve') out[key] = { verdict: 'confirm' };
  }
  return out;
}

/** An override with nothing said yet: the decision's words, so the card can ask for them. */
export function emptyOverride(gate: Pick<Gate, 'decided'>, c: GateChoices): DecidedItem | null {
  return openDecisions(gate).find((d) => decidedKey(d) in c.overrides && !c.overrides[decidedKey(d)].trim()) ?? null;
}

/**
 * The body of POST /api/job/:slug/gate for one of the card's buttons. A stop carries no answers,
 * verdicts or chips (it has no next stage).
 */
export function gateRequest(kind: GateKind, gate: Gate, c: GateChoices, views: ChipView[], extra: Partial<GateRequest> = {}): GateRequest {
  if (kind === 'stop') return { kind, briefNumber: gate.briefNumber, ...extra };
  return {
    kind,
    briefNumber: gate.briefNumber,
    answers: answersFor(gate, c),
    verdicts: verdictsFor(gate, c, kind),
    chips: chipsFor(views, c.chips),
    ...extra,
  };
}

// ---------- A gate reply kept in the composer while the Foreman finishes ----------

/** Where the composer remembers that its draft is a gate reply (localStorage via lib/stored.ts). */
export const gateDraftKey = (slug: string) => `fw.draftGate.${slug}`;

export interface GateDraftMemo {
  /** The brief the reply answers (sent as gateBrief with /send). */
  brief: number;
  kind: GateKind;
  /**
   * The reply as the card composed it (the part of the draft that is the decision). "Decide again
   * here" uses it to replace that decision rather than send two.
   */
  text?: string;
}

const KINDS: GateKind[] = ['approve', 'changes', 'message', 'stop'];

function parseMemo(raw: string | null): (GateDraftMemo & { reopened: boolean }) | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<GateDraftMemo> & { reopened?: unknown };
    if (!(Number.isInteger(v.brief) && (v.brief as number) > 0 && KINDS.includes(v.kind as GateKind))) return null;
    return { brief: v.brief as number, kind: v.kind as GateKind, ...(typeof v.text === 'string' && v.text ? { text: v.text } : {}), reopened: v.reopened === true };
  } catch { return null; }
}

const plainMemo = ({ brief, kind, text }: GateDraftMemo): GateDraftMemo => ({ brief, kind, ...(text ? { text } : {}) });

/** The draft is a gate reply waiting to be sent: the brief it answers and its kind. Null otherwise (or after "Decide again here"). */
export function readGateMemo(raw: string | null): GateDraftMemo | null {
  const m = parseMemo(raw);
  return m && !m.reopened ? plainMemo(m) : null;
}

/**
 * The memo as "Decide again here" left it: the draft counts as an ordinary message now, but the
 * decision it held is remembered so deciding again can replace it (placeGateReply).
 */
export function readReopenedMemo(raw: string | null): GateDraftMemo | null {
  const m = parseMemo(raw);
  return m && m.reopened ? plainMemo(m) : null;
}

/** "Decide again here": the memo, marked so the draft no longer counts as the reply to its brief. */
export const reopenMemo = (memo: GateDraftMemo) => JSON.stringify({ ...plainMemo(memo), reopened: true });

/** Between an earlier draft and a gate reply added to it (the composer shows both). */
export const DRAFT_SEPARATOR = '\n\n';

/**
 * Where a gate reply goes in the composer's draft. A reply decided again for the same brief
 * replaces the earlier decision when the draft is still exactly that decision (memo.text), or ends
 * with it unchanged; otherwise it is added after what is there, and `kept` says the earlier text
 * is still in the box (so two decisions never go silently).
 */
export function placeGateReply(draft: string, reply: string, memo: GateDraftMemo | null): { text: string; replaced: boolean; kept: boolean } {
  const existing = draft.trim();
  if (!existing || existing === reply) return { text: reply, replaced: false, kept: false };
  const before = memo?.text?.trim();
  if (before && existing === before) return { text: reply, replaced: true, kept: false };
  if (before && existing.endsWith(`${DRAFT_SEPARATOR}${before}`)) {
    return { text: `${existing.slice(0, -before.length).trimEnd()}${DRAFT_SEPARATOR}${reply}`, replaced: true, kept: true };
  }
  return { text: `${existing}${DRAFT_SEPARATOR}${reply}`, replaced: false, kept: true };
}

export const KIND_WORDS: Record<GateKind, string> = { approve: 'an approval', changes: 'changes asked for', message: 'guidance', stop: 'a stop' };
