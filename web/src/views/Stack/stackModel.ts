// What the Stack pages say, as plain functions of the dashboard's view (dashboard/lib/stack.js
// describeStack), so every word can be tested on its own. "Part" on screen, "section" in the files:
// the dashboard's own sentences already say part.
//
//   nextStep(view)         the one next step: what it is in a sentence, one primary button and its
//                          key, and at most one second button
//   STEP_INFO              each of the four steps' name, icon and short line
//   splitWhy(view)         why the plan splits the work the way it does, in words
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
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
const base = (file: string) => file.split('/').pop() || file;

// ---------- One part ----------

/** The parts a part waits for, by number: "part 2", "parts 1 and 2". */
function waitsFor(part: StackPart, view: Pick<StackView, 'parts'>): string | null {
  const open = part.dependsOn
    .map((d) => view.parts.find((p) => p.name === d))
    .filter((p): p is StackPart => Boolean(p) && p!.state !== 'integrated');
  if (!open.length) return null;
  return open.length === 1 ? `${PART.one} ${open[0].n}` : `${PART.many} ${list(open.map((p) => String(p.n)))}`;
}

// ---------- The steps ----------

export const STEP_INFO: Record<StackStepId, { label: string; icon: IconName; sub: string }> = {
  plan: { label: 'Plan', icon: 'clipboard', sub: 'Check the parts' },
  build: { label: 'Build', icon: 'hammer', sub: 'Side by side' },
  merge: { label: 'Merge', icon: 'merge', sub: 'One at a time' },
  push: { label: 'Push', icon: 'rocket', sub: 'With your yes' },
};

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
