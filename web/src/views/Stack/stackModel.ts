// What the Stack pages say, as plain functions of the dashboard's view (dashboard/lib/stack.js
// describeStack), so every word can be tested on its own. "Part" on screen, "section" in the files:
// the dashboard's own sentences already say part.
//
//   partLook(part, view)   one part's state for its line on the map and its card: a word (never a
//                          colour alone), a tone, how full its line is, and a short readout
//   nextStep(view)         the one next step: what it is in a sentence, one primary button and its
//                          key, and at most one second button
//   STEP_INFO / stepLine   each of the four steps in one plain line: what happens, what you do
//   splitWhy(view)         why the plan splits the work the way it does, in words
//   mapParts(parts)        the parts the map draws (4 to 6 bunch closer; above 6, the ones at work
//                          plus "and 3 more waiting")
//   summaryChip(summary)   a stack's word on the Stacks list
import type { IconName } from '../../components/Icon';
import type { NextTone } from '../../components/page/Page';
import type { KeyId } from '../../app/keyRegistry';
import type { StackPart, StackStepId, StackSummary, StackView } from '../../api/types';

export const PART = { one: 'part', many: 'parts' } as const;
/** "1 part", "3 parts". */
export const parts = (n: number) => `${n} ${n === 1 ? PART.one : PART.many}`;

/** Checks fail this many times and a part stops (dashboard/lib/stack.js STUCK_AT). */
export const STUCK_AT = 3;

const list = (words: string[]) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);
const cap0 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clock = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const base = (file: string) => file.split('/').pop() || file;

// ---------- One part ----------

/** A part's name on screen: its brief's first words ("The export button"), else its name in the plan. */
export function partTitle(p: Pick<StackPart, 'name' | 'brief'>): string {
  const s = (p.brief ?? '').split(/(?<=[a-z0-9)])[.:;](?:\s|$)/i)[0].trim();
  if (!s) return p.name;
  return s.length > 60 ? `${s.slice(0, 57).trimEnd()}…` : s;
}

/** A part's tone: what colour repeats its word. */
export type PartTone = 'waiting' | 'building' | 'ready' | 'merged' | 'needs-you' | 'problem';

export interface PartLook {
  tone: PartTone;
  /** The word on its line on the map and on its card: never the colour alone. */
  word: string;
  /** The card's word before the plan is approved, when it differs ("Ready to start", "After part 2"). */
  cardWord: string;
  icon: IconName;
  /** How far its line is filled, 0 to 1. */
  fill: number;
  /** The card's small readout: "Step 2 of 4 · Building", "Merged · 14:46", "4 files". */
  readout: string;
  /** Its Foreman is at work right now (the light; it pulses in Play full). */
  live: boolean;
  /** It went wrong at the merge point: a red mark where the lines meet. */
  atMerge: boolean;
}

/** The parts a part waits for, by number: "part 2", "parts 1 and 2". */
function waitsFor(part: StackPart, view: Pick<StackView, 'parts'>): string | null {
  const open = part.dependsOn
    .map((d) => view.parts.find((p) => p.name === d))
    .filter((p): p is StackPart => Boolean(p) && p!.state !== 'integrated');
  if (!open.length) return null;
  return open.length === 1 ? `${PART.one} ${open[0].n}` : `${PART.many} ${list(open.map((p) => String(p.n)))}`;
}

export function partLook(part: StackPart, view: Pick<StackView, 'parts' | 'approved'>): PartLook {
  const files = part.owns.length === 1 ? '1 file' : `${part.owns.length} files`;
  const wait = waitsFor(part, view);
  const base0 = { cardWord: '', live: false, atMerge: false };
  if (!view.approved) {
    return {
      ...base0, tone: 'waiting', icon: 'circle-dashed', fill: 0, readout: files,
      word: wait ? `Waits for ${wait}` : 'Waits for your yes',
      cardWord: wait ? `After ${wait}` : 'Ready to start',
    };
  }
  const step = `Step ${Math.min(part.progress.step + 1, part.progress.of)} of ${part.progress.of}`;
  const p = part.problem;
  switch (part.state) {
    case 'integrated':
      return { ...base0, tone: 'merged', icon: 'check', fill: 1, word: '✓ Merged', cardWord: 'Merged', readout: ['Merged', clock(part.mergedAt)].filter(Boolean).join(' · ') };
    case 'ready':
      return { ...base0, tone: 'ready', icon: 'circle-check', fill: 1, word: 'Ready to merge', cardWord: 'Ready to merge', readout: 'Checks passed' };
    case 'failed':
      return { ...base0, tone: 'needs-you', icon: 'hand', fill: Math.max(0.15, part.progress.step / part.progress.of), word: 'Needs you', cardWord: 'Needs you', readout: `Try ${part.failures || STUCK_AT} of ${STUCK_AT} · stopped` };
    case 'blocked': {
      const word = p?.kind === 'conflict' ? 'Conflict' : p?.kind === 'outside' ? 'Outside its files' : p?.kind === 'empty' ? 'Nothing to merge' : p?.kind === 'checks' ? 'Tests failed' : 'Back with its Foreman';
      const readout = p?.files?.length ? `${base(p.files[0])}${p.files.length > 1 ? ` and ${p.files.length - 1} more` : ''}` : 'Not merged';
      return { ...base0, tone: 'problem', icon: 'warn', fill: 1, word, cardWord: word, readout, atMerge: p?.kind === 'conflict' || p?.kind === 'checks' };
    }
    case 'running': {
      if (p?.kind === 'checks') {
        return { ...base0, tone: 'problem', icon: 'warn', fill: 1, word: 'Tests failed', cardWord: 'Tests failed', readout: `Try ${part.failures} of ${STUCK_AT}`, live: Boolean(part.run), atMerge: true };
      }
      const asks = /waiting for you/i.test(part.progress.words);
      const fill = Math.max(0.12, Math.min(0.92, (part.progress.step + 0.5) / part.progress.of));
      if (asks) return { ...base0, tone: 'needs-you', icon: 'hand', fill, word: 'Needs you', cardWord: 'Needs you', readout: `${step} · waiting for you` };
      const doing = part.progress.words && part.progress.words !== 'Building' ? ` · ${part.progress.words}` : '';
      return { ...base0, tone: 'building', icon: 'loader', fill, word: 'Building', cardWord: 'Building', readout: `${step}${doing}`, live: Boolean(part.run) };
    }
    default: {
      const word = wait ? `Waits for ${wait}` : /free slot/i.test(part.reason ?? '') ? 'Waits for a free slot' : 'Starting soon';
      return { ...base0, tone: 'waiting', icon: 'circle-dashed', fill: 0, word, cardWord: word, readout: 'Not started' };
    }
  }
}

// ---------- The steps ----------

export const STEP_INFO: Record<StackStepId, { label: string; icon: IconName; sub: string }> = {
  plan: { label: 'Plan', icon: 'clipboard', sub: 'Check the parts' },
  build: { label: 'Build', icon: 'hammer', sub: 'Side by side' },
  merge: { label: 'Merge', icon: 'merge', sub: 'One at a time' },
  push: { label: 'Push', icon: 'rocket', sub: 'With your yes' },
};

/** Each step in one plain line: what happens there, and what you do. */
export function stepLine(step: StackStepId, view: Pick<StackView, 'autoIntegrate'>): string {
  switch (step) {
    case 'plan': return 'The Foreman splits the ticket into parts that each change their own files. You check them and approve.';
    case 'build': return 'Each part is built side by side, by its own Foreman on its own copy of the code. You wait, or answer a part that asks.';
    case 'merge': return view.autoIntegrate
      ? 'Finished parts join your branch one at a time, in order, and the tests run after each. “Merge on its own” is on, so they join by themselves.'
      : 'Finished parts join your branch one at a time, in order, and the tests run after each. You say yes to each one.';
    default: return 'Your branch goes to your fork, never the team’s repository. Nothing leaves your computer until you say go.';
  }
}

/** Where the "You are here" marker sits. */
export function hereStep(view: Pick<StackView, 'phase'>): StackStepId | null {
  return view.phase === 'pushed' ? null : view.phase;
}

// ---------- Why the plan splits this way ----------

/** The plan's own reason (the paragraph under its title), then what the parts and their order mean. */
export function splitWhy(view: Pick<StackView, 'parts' | 'plan' | 'cap'>): string[] {
  const out: string[] = [];
  if (view.plan?.why) out.push(view.plan.why);
  const n = view.parts.length;
  if (!n) return out;
  out.push(n === 1
    ? 'There is one part, so it builds on its own copy of the code and merges once its checks pass.'
    : `Each of the ${n} parts changes only its own files, so they can be built side by side without getting in each other’s way.`);
  for (const p of view.parts) {
    const deps = p.dependsOn.map((d) => view.parts.find((x) => x.name === d)?.n).filter((x): x is number => typeof x === 'number');
    if (deps.length) out.push(`${cap0(PART.one)} ${p.n} waits for ${deps.length === 1 ? `${PART.one} ${deps[0]}` : `${PART.many} ${list(deps.map(String))}`}, because it builds on ${deps.length === 1 ? 'it' : 'them'}.`);
  }
  if (n > 1) out.push(`They merge in this order, one at a time: ${view.parts.map((p) => p.n).join(', ')}.`);
  return out;
}

/** "Parts 1 and 2 start right away. Part 3 waits for part 2." for the plan check. */
export function startLine(view: Pick<StackView, 'parts' | 'cap'>): string {
  const free = view.parts.filter((p) => !p.dependsOn.length);
  const now = free.slice(0, view.cap);
  const later = free.slice(view.cap);
  const out: string[] = [];
  if (now.length) out.push(`${now.length === 1 ? `${cap0(PART.one)} ${now[0].n} starts` : `${cap0(PART.many)} ${list(now.map((p) => String(p.n)))} start`} right away.`);
  if (later.length) out.push(`${later.length === 1 ? `${cap0(PART.one)} ${later[0].n} starts` : `${cap0(PART.many)} ${list(later.map((p) => String(p.n)))} start`} when one of those finishes (${view.cap} at once).`);
  for (const p of view.parts.filter((x) => x.dependsOn.length)) {
    const w = waitsFor(p, { parts: view.parts });
    if (w) out.push(`${cap0(PART.one)} ${p.n} waits for ${w}.`);
  }
  return out.join(' ');
}

// ---------- The map's rows ----------

/** At most this many lines; more and the map keeps the ones at work and counts the rest. */
export const MAP_MAX = 6;

export interface MapRows { shown: StackPart[]; waiting: number; merged: number; dense: boolean }

export function mapParts(all: readonly StackPart[]): MapRows {
  if (all.length <= MAP_MAX) return { shown: [...all], waiting: 0, merged: 0, dense: all.length > 3 };
  const atWork = all.filter((p) => p.state !== 'pending' && p.state !== 'integrated');
  const shown = atWork.slice(0, MAP_MAX);
  return { shown, waiting: all.filter((p) => p.state === 'pending').length + (atWork.length - shown.length), merged: all.filter((p) => p.state === 'integrated').length, dense: true };
}

/** "and 3 more waiting · 2 merged". */
export function moreLine(rows: MapRows): string | null {
  const bits = [rows.waiting ? `and ${rows.waiting} more waiting` : null, rows.merged ? `${rows.merged} merged` : null].filter(Boolean);
  return bits.length ? bits.join(' · ') : null;
}

// ---------- The next step ----------

export type StackAction =
  | { kind: 'approve' } | { kind: 'change' } | { kind: 'not-yet'; section: string } | { kind: 'merge'; section: string }
  | { kind: 'push' } | { kind: 'open-part'; slug: string } | { kind: 'open-job' } | { kind: 'fix'; section: string }
  | { kind: 'fix-plan' } | { kind: 'see-failed'; section: string } | { kind: 'editor'; href: string };

export interface StackButton { label: string; key?: KeyId; action: StackAction; hint: string; disabled?: boolean }

export interface StackNextStep {
  tone: NextTone;
  icon: IconName;
  /** A decision for you (go / no go in Play). */
  call: boolean;
  /** Something went wrong at the merge (a clash, files not its own, failed tests): the bar is red as well as worded. */
  problem?: boolean;
  say: string;
  sub: string;
  primary: StackButton | null;
  second: StackButton | null;
}

/** A merged part that owns one of these files: the one a clash is with. */
function clashWith(part: StackPart, view: StackView): StackPart | null {
  const files = part.problem?.files ?? [];
  return view.parts.find((p) => p !== part && p.state === 'integrated' && files.some((f) => p.owns.some((o) => ownsFile(o, f)))) ?? null;
}

/** Whether an owned path ("app/**", "app/*.ts", "app/x.ts") covers a file (lib/integrate.js ownedMatcher, simply). */
export function ownsFile(owned: string, file: string): boolean {
  const re = new RegExp(`^${owned.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
  return re.test(file) || file.startsWith(`${owned.replace(/\/$/, '')}/`);
}

const fileWords = (files: string[]) => (files.length ? list(files.slice(0, 3).map(base)) + (files.length > 3 ? ` and ${files.length - 3} more` : '') : 'the same files');

/** The editor link for a file in a part's worktree (the dashboard opens vscode:// links). */
export const editorHref = (dir: string, file: string) => {
  const full = file.startsWith('/') ? file : `${dir.replace(/\/$/, '')}/${file}`;
  return `vscode://file${full.startsWith('/') ? '' : '/'}${full.split('/').map(encodeURIComponent).join('/')}`;
};

export function nextStep(view: StackView): StackNextStep {
  const n = view.parts.length;
  const part = (name: string | null | undefined) => view.parts.find((p) => p.name === name) ?? null;
  const fix = (p: StackPart, label = 'Let the Foreman fix it'): StackButton => ({ label, key: 'stack-fix', action: { kind: 'fix', section: p.name }, hint: `Send it back to ${PART.one} ${p.n}’s Foreman with what went wrong (key: f).` });
  const open = (p: StackPart): StackButton | null => (p.slug ? { label: `Open ${PART.one} ${p.n}`, key: 'stack-open', action: { kind: 'open-part', slug: p.slug }, hint: `Open ${PART.one} ${p.n}’s own job page (key: o).` } : null);

  if (!view.approved) {
    if (!view.plan) {
      return { tone: 'quiet', icon: 'clipboard', call: false, say: 'The Foreman is writing the plan', sub: 'It splits the ticket into parts in stack.md. They show here as soon as it is written, for you to check.', primary: { label: 'Open the job', key: 'stack-open', action: { kind: 'open-job' }, hint: 'Open the job the Foreman works in (key: o).' }, second: null };
    }
    if (!view.plan.ok) {
      const k = view.plan.errors.length;
      return { tone: 'warn', icon: 'warn', call: false, say: `The plan has ${k === 1 ? 'a problem' : `${k} problems`} to fix first`, sub: view.plan.errors[0] ?? '', primary: { label: 'Ask the Foreman to fix it', key: 'stack-fix', action: { kind: 'fix-plan' }, hint: 'Send the Foreman the problems listed here; it writes the plan again (key: f).' }, second: null };
    }
    return {
      tone: 'go', icon: 'clipboard', call: true, say: `Check the ${parts(n)}, then approve`, sub: startLine(view),
      primary: { label: 'Approve plan', key: 'stack-approve', action: { kind: 'approve' }, hint: 'Approve the plan: the parts start building, each in its own copy of the code (key: a).' },
      second: { label: 'Change something', key: 'stack-change', action: { kind: 'change' }, hint: 'Send the Foreman a note about the plan; it writes the plan again for you to check (key: r).' },
    };
  }

  if (view.busy) {
    return { tone: 'quiet', icon: 'loader', call: false, say: view.busy.words, sub: 'This takes a minute or two. The page updates by itself.', primary: null, second: null };
  }

  const stuck = view.parts.find((p) => p.state === 'failed');
  if (stuck) {
    return { tone: 'stop', icon: 'hand', call: false, say: `${cap0(PART.one)} ${stuck.n} got stuck`, sub: `Its tests failed ${stuck.failures || STUCK_AT} times. The Foreman stopped to ask you.`, primary: open(stuck), second: fix(stuck, 'Let the Foreman try again') };
  }

  const blocked = view.parts.find((p) => p.state === 'blocked' && p.problem);
  if (blocked?.problem) {
    const files = blocked.problem.files ?? [];
    const editor: StackButton | null = files.length === 1 && blocked.worktree ? { label: 'Open in editor', action: { kind: 'editor', href: editorHref(blocked.worktree, files[0]) }, hint: `Open ${files[0]} in your editor, in ${PART.one} ${blocked.n}’s copy of the code.` } : null;
    if (blocked.problem.kind === 'conflict') {
      const other = clashWith(blocked, view);
      return { tone: 'stop', icon: 'warn', call: false, problem: true, say: `${cap0(PART.one)} ${blocked.n} clashes with ${other ? `${PART.one} ${other.n}` : 'what is merged'}`, sub: `${other ? 'Both changed' : 'Changed on both sides:'} ${fileWords(files)}. Nothing was merged.`, primary: fix(blocked), second: editor };
    }
    if (blocked.problem.kind === 'outside') {
      return { tone: 'stop', icon: 'warn', call: false, problem: true, say: `${cap0(PART.one)} ${blocked.n} changed files that aren’t its own`, sub: `${fileWords(files)}. Nothing was merged: each part may change only its own files.`, primary: fix(blocked), second: editor };
    }
    if (blocked.problem.kind === 'empty') {
      return { tone: 'stop', icon: 'warn', call: false, problem: true, say: `${cap0(PART.one)} ${blocked.n} has nothing to merge yet`, sub: 'Its branch has no new commits. Nothing was merged.', primary: fix(blocked), second: open(blocked) };
    }
    return { tone: 'stop', icon: 'warn', call: false, problem: true, say: `${cap0(PART.one)} ${blocked.n} needs its Foreman`, sub: blocked.problem.words, primary: fix(blocked), second: open(blocked) };
  }

  const broke = view.parts.find((p) => p.state === 'running' && p.problem?.kind === 'checks');
  if (broke) {
    return {
      tone: 'stop', icon: 'refresh', call: false, problem: true, say: `${cap0(PART.one)} ${broke.n} broke the tests, so we undid it`,
      sub: `The stack is back where it was. Its Foreman has what failed and is fixing it (try ${broke.failures} of ${STUCK_AT}).`,
      primary: open(broke), second: { label: 'See what failed', action: { kind: 'see-failed', section: broke.name }, hint: 'Show the end of the failed tests’ output.' },
    };
  }

  if (view.next.action === 'merge' && view.next.section) {
    const p = part(view.next.section)!;
    return {
      tone: 'go', icon: 'merge', call: true, say: `${cap0(PART.one)} ${p.n} is ready to merge`, sub: 'Its checks passed. We’ll run them again after merging.',
      primary: { label: `Merge ${PART.one} ${p.n}`, key: 'stack-merge', action: { kind: 'merge', section: p.name }, hint: `Merge ${PART.one} ${p.n} into ${view.parentBranch ?? 'the stack’s branch'}, then run the checks (key: m).` },
      second: { label: 'Not yet', key: 'stack-change', action: { kind: 'not-yet', section: p.name }, hint: `Don’t merge it: send ${PART.one} ${p.n} back to its Foreman with a note (key: r).` },
    };
  }

  if (view.phase === 'push') {
    if (view.push?.state === 'approved') return { tone: 'quiet', icon: 'rocket', call: false, say: 'You said go: the Foreman is pushing', sub: `${view.parentBranch ?? 'The branch'} goes to your fork. The push asks for its own permission as usual.`, primary: null, second: null };
    return {
      tone: 'go', icon: 'rocket', call: true, say: `All ${parts(n)} merged and checked`, sub: view.push?.state === 'declined' ? 'You said no go last time. One step left when you are ready: push to GitHub.' : 'One step left: push to GitHub.',
      primary: { label: 'Push', key: 'stack-push', action: { kind: 'push' }, hint: 'Push asks go / no go first (key: p).' }, second: null,
    };
  }

  if (view.phase === 'pushed') {
    return { tone: 'go', icon: 'rocket', call: false, say: `Pushed${clock(view.push?.pushedAt) ? ` at ${clock(view.push?.pushedAt)}` : ''}`, sub: 'Next: open the pull request from the job.', primary: { label: 'Open the job', key: 'stack-open', action: { kind: 'open-job' }, hint: 'Open the job, where the pull request is opened (key: o).' }, second: null };
  }

  const asks = view.parts.find((p) => p.state === 'running' && /waiting for you/i.test(p.progress.words));
  if (asks) {
    return { tone: 'stop', icon: 'hand', call: false, say: `${cap0(PART.one)} ${asks.n} needs your go-ahead`, sub: `Its Foreman waits for you (${asks.progress.words.toLowerCase()}). Open it to answer; the other parts carry on.`, primary: open(asks), second: null };
  }

  if (view.next.action === 'wait' && view.autoIntegrate && view.next.section) {
    const p = part(view.next.section);
    return { tone: 'quiet', icon: 'merge', call: false, say: `${cap0(PART.one)} ${p?.n ?? ''} is ready and merges on its own`.replace('  ', ' '), sub: '“Merge on its own” is on. Pushing still waits for your go.', primary: null, second: null };
  }

  const nextUp = part(view.nextToMerge);
  return {
    tone: 'quiet', icon: 'clock', call: false, say: 'Nothing to do right now',
    sub: nextUp ? `We’ll tell you when ${PART.one} ${nextUp.n} is ready to merge.` : view.next.words,
    primary: nextUp ? { label: `Merge ${PART.one} ${nextUp.n}`, key: 'stack-merge', action: { kind: 'merge', section: nextUp.name }, hint: `Off until ${PART.one} ${nextUp.n} is ready: ${nextUp.reason ?? nextUp.stateWords}.`, disabled: true } : null,
    second: null,
  };
}

// ---------- The Stacks list ----------

export type SummaryTone = 'needs-you' | 'working' | 'done';

/** A stack's word on the Stacks list: what it needs, never a colour alone. */
export function summaryChip(s: Pick<StackSummary, 'action' | 'phase' | 'needs'>): { word: string; tone: SummaryTone } {
  switch (s.action) {
    case 'approve-plan': return { word: 'Needs you: check the plan', tone: 'needs-you' };
    case 'fix-plan': return /no stack plan/i.test(s.needs) ? { word: 'The plan is being written', tone: 'working' } : { word: 'Needs you: the plan has a problem', tone: 'needs-you' };
    case 'open-part': return { word: 'Needs you: a part is stuck', tone: 'needs-you' };
    case 'hand-back': return { word: 'Needs you: a part came back', tone: 'needs-you' };
    case 'merge': return { word: 'Needs you: merge a part', tone: 'needs-you' };
    case 'push': return { word: 'Needs you: push', tone: 'needs-you' };
    case 'open-job': return { word: 'Pushed', tone: 'done' };
    default: return { word: s.phase === 'merge' ? 'Merging' : s.phase === 'push' ? 'Pushing' : 'Building', tone: 'working' };
  }
}

/** "ORBIT-512 · 3 parts". */
export const summaryLine = (s: Pick<StackSummary, 'ticketKey' | 'parts'>) => [s.ticketKey, parts(s.parts)].filter(Boolean).join(' · ');
