// A part's quick look on a stack's page (packet V), borrowed from the Desk's console: the part's
// place ("Part 4 of 12"), its one decision when it needs you (with "Go / no go" above it in Play),
// its now line, its four stages with the current one lit in its stop's hue, what it waits on and
// what waits on it, its files, branch, port and cost; and an action row fixed at the bottom that is
// the same for every part, so j / k through the parts keeps the buttons under the hand. It is R's
// shared Peek (components/Peek.tsx): its sheet, its keys (j / k, Enter for the part's page, Esc)
// and its place in the address (#/stack/<slug>?peek=<n>).
import type { ReactNode } from 'react';
import type { StackPart, StackView } from '../../api/types';
import { jobHref, partHref } from '../../app/router';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Icon } from '../../components/Icon';
import { Peek, usePeekKeys } from '../../components/Peek';
import { relativeTime } from '../../lib/time';
import { LANE_LOOK, money } from './stackLook';
import { partProblem } from './StackViews';

const STAGES = [
  { id: 'plan', word: 'Plan' },
  { id: 'implement', word: 'Build' },
  { id: 'test', word: 'Test' },
  { id: 'review', word: 'Review' },
] as const;

export type PartAction = { kind: 'merge' | 'fix' | 'open-job'; label: string; hint: string };

/** The part's own one action, when it has one. */
export function partAction(p: StackPart, view: StackView): PartAction | null {
  if (p.state === 'ready' && view.nextToMerge === p.name && !view.autoIntegrate && !view.busy) return { kind: 'merge', label: `Merge part ${p.n}`, hint: `Merge part ${p.n} into ${view.parentBranch ?? 'the stack’s branch'}, then run the checks. Asks first.` };
  if (p.state === 'blocked' || p.state === 'failed') return { kind: 'fix', label: p.state === 'failed' ? 'Let the Foreman try again' : 'Let the Foreman fix it', hint: `Send part ${p.n} back to its Foreman with what went wrong.` };
  if (p.lane === 'needs-you' && p.slug) return { kind: 'open-job', label: 'Answer in its job', hint: `Its Foreman waits for your go-ahead. Open part ${p.n}’s job to answer.` };
  return null;
}

export function PartPeek({ view, part: p, now, play, busy, onAction, onPick, onOpen, onClose }: {
  view: StackView; part: StackPart; now: Date; play: boolean; busy: boolean;
  onAction: (a: PartAction, p: StackPart) => void;
  /** j / k: the next or previous part, by number. */
  onPick: (n: number) => void;
  /** Enter: the part's own page. */
  onOpen: (n: number) => void;
  onClose: () => void;
}) {
  usePeekKeys({ current: String(p.n), order: view.parts.map((x) => String(x.n)), onPick: (id) => onPick(Number(id)), onClose, onEnter: (id) => onOpen(Number(id)) });
  const lane = p.lane ?? 'waiting';
  const look = LANE_LOOK[lane];
  const problem = partProblem(p, view);
  const action = partAction(p, view);
  const at = STAGES.findIndex((s) => s.id === (p.stage ?? p.progress.stage));
  const doneAll = lane === 'merged' || lane === 'ready' || lane === 'merging';
  const link = (n: number) => {
    const x = view.parts.find((q) => q.n === n);
    return <a key={n} className="peek-part-link" href={partHref(view.slug, n)} title={x ? `${x.title ?? x.name}: ${x.laneWords ?? ''}` : undefined}>Part {n}</a>;
  };
  return (
    <Peek
      label={`Part ${p.n}: a quick look`}
      className="part-peek"
      title={<><span className="eyebrow part-peek-of">Part {p.n} of {view.parts.length}</span><span className="part-peek-title">{p.title ?? p.name}</span></>}
      chip={<Chip tone={look.chip} icon={look.icon}>{p.laneWords ?? look.word}</Chip>}
      keys={[['j k', 'the next or previous part'], ['↵', 'its page'], ['Esc', 'close']]}
      onClose={onClose}
    >
      {(action || problem) && (
        <section className={`part-peek-call${problem ? ' is-problem' : ''}`} aria-label="What it needs">
          {play && action && action.kind !== 'open-job' && <span className="eyebrow">Go / no go</span>}
          <p className="part-peek-say">{problem ?? (lane === 'needs-you' ? 'Its Foreman waits for your go-ahead.' : `Ready, and next in the merge order.`)}</p>
          {p.problem?.words && problem && <p className="part-peek-sub">{p.problem.words}</p>}
        </section>
      )}
      {p.now ? (
        <p className={`now-line is-${p.now.tone}`} aria-label="Now">
          <Icon name={p.now.tone === 'waiting' ? 'hand' : p.now.tone === 'quiet' ? 'circle-check' : 'loader'} size={14} className="now-icon" />
          <b className="now-who">{p.now.who}</b><span className="now-sep" aria-hidden="true">·</span><span className="now-what">{p.now.what}</span>
          {p.now.since && <><span className="now-sep" aria-hidden="true">·</span><time className="now-time num" dateTime={p.now.since}>{relativeTime(p.now.since, now)}</time></>}
        </p>
      ) : <p className="part-peek-quiet muted">{lane === 'merged' ? `Merged${p.mergedAt ? ` ${relativeTime(p.mergedAt, now)} ago`.replace('just now ago', 'just now') : ''}.` : p.reason ?? p.laneWords ?? 'Not started.'}</p>}

      <ol className="part-stages" aria-label="Its own stages">
        {STAGES.map((s, i) => {
          const state = doneAll || i < at ? 'done' : i === at ? 'now' : 'next';
          return (
            <li key={s.id} className={`part-stage stop-${s.id} is-${state}`}>
              <span className="part-stage-dot" aria-hidden="true">{state === 'done' ? <Icon name="check" size={11} /> : null}</span>
              <span className="part-stage-word">{s.word}</span>
              <span className="sr-only">{state === 'done' ? 'done' : state === 'now' ? 'now' : 'not yet'}</span>
            </li>
          );
        })}
      </ol>

      <dl className="part-peek-facts">
        {p.brief && <><dt>For</dt><dd>{p.brief}</dd></>}
        <dt>Waits on</dt><dd>{p.dependsOnN?.length ? p.dependsOnN.map((n) => link(n)).reduce<ReactNode[]>((a, x, i) => (i ? [...a, ', ', x] : [x]), []) : 'Nothing'}{p.waitsOn?.length ? <span className="muted"> · {p.waitsOn.length} not merged yet</span> : null}</dd>
        <dt>Unblocks</dt><dd>{p.unblocks?.length ? p.unblocks.map((n) => link(n)).reduce<ReactNode[]>((a, x, i) => (i ? [...a, ', ', x] : [x]), []) : 'No other part'}</dd>
        <dt>Owns</dt><dd><span className="num">{p.owns.length}</span> {p.owns.length === 1 ? 'path' : 'paths'}: <span className="part-peek-owns num">{p.owns.slice(0, 3).join(', ')}{p.owns.length > 3 ? ` and ${p.owns.length - 3} more` : ''}</span></dd>
        {p.branch && <><dt>Branch</dt><dd className="num part-peek-mono">{p.branch}</dd></>}
        {p.port && <><dt>Port</dt><dd className="num">{p.port}</dd></>}
        {(p.costUsd ?? 0) > 0 && <><dt>Claude cost</dt><dd className="num">{money(p.costUsd)}</dd></>}
      </dl>
      {/* The action row: the same spot at the foot of the sheet for every part. */}
      <div className="part-peek-actions">
        {p.slug ? <Button kind="quiet" href={jobHref(p.slug)} title={`Open part ${p.n}’s own job: its conversation and crew.`}>Open the job</Button> : <span />}
        <span className="spacer" />
        <Button href={partHref(view.slug, p.n)} title={`Open part ${p.n}’s page: its changes, checks and merge checklist (key: Enter).`} kind={action ? 'secondary' : 'primary'}>Open part {p.n}</Button>
        {action && <Button kind="primary" busy={busy} onClick={() => onAction(action, p)} title={action.hint}>{action.label}</Button>}
      </div>
    </Peek>
  );
}
