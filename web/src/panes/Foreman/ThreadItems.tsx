// The thread's other items: your messages, the Foreman's replies, folds of routine steps it took
// by itself, problems, short notes, your permission decisions, and steps refused without a card
// (by auto mode or a hard line), shown as dim lines. Text you typed is always shown as plain
// text; short AI-written reasons go through InlineText (React elements, no HTML); only the
// dashboard-rendered reply HTML goes through ServerHtml.
// With Play on (Subtle or Full) the workers on these lines appear as small crew characters with
// their names (play/ThreadCrew.tsx); with Play Off these lines are exactly as before. Whether Play
// is on comes from the pane (playOn), read once there rather than per line; a routine-steps fold
// draws its per-step characters only while it is open.
import { useMemo, useState } from 'react';
import type { AutoItem, SteerState, ThreadItem } from '../../api/types';
import { settingsHref } from '../../app/router';
import { InlineText } from '../../components/InlineText';
import { fullTime, relativeTime } from '../../lib/time';
import { crewInfo } from '../../play/crew';
import { CrewTag, HandoffSummary } from '../../play/ThreadCrew';
import { dispatchType, handoffLine } from '../../play/crewLines';
import { ExtrasLines } from './ExtrasLines';
import { ServerHtml } from './ServerHtml';
import { STEER_LABELS } from './thread';

function When({ at, now }: { at: string | null; now: Date }) {
  if (!at) return null;
  return <time className="thread-time num" dateTime={at} title={fullTime(at)}>{relativeTime(at, now)}</time>;
}

/**
 * " · feature-tester": the worker that took a step. With Play on, the worker's character and name
 * (" · [Tester] Tester"; just the name while `faces` is false); Off, the agent type as phase 2 showed it.
 */
function Worker({ who, className, playOn, faces = true }: { who: string; className?: string; playOn: boolean; faces?: boolean }) {
  if (!playOn) return <span className={className}> · {who}</span>;
  return <span className={className}> · {faces ? <CrewTag type={who} /> : crewInfo(who).name}</span>;
}

/** A step that started a worker: " · [Sleuth] Sleuth started investigating" with Play on; nothing Off. */
function Handoff({ headline, faces }: { headline: string; faces: boolean }) {
  const type = dispatchType(headline);
  if (!type) return null;
  return <span className="muted"> · {faces ? <CrewTag type={type} text={handoffLine(type)} /> : handoffLine(type)}</span>;
}

function AutoFold({ item, now, playOn }: { item: AutoItem; now: Date; playOn: boolean }) {
  const steps = item.items ?? [];
  const n = steps.length;
  // The per-step characters are drawn only while the fold is open (a long thread has many folds).
  const [open, setOpen] = useState(false);
  // The workers this fold handed work to (Play shows them on the folded line).
  const handedTo = useMemo(
    () => [...new Set((item.items ?? []).map((s) => dispatchType(s.headline)).filter((t): t is string => t !== null))],
    [item.items],
  );
  return (
    <details className="thread-item auto-fold" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary title="Steps the Foreman took without asking, because your settings count them as routine. Open to see each one.">
        <span className="glyph" aria-hidden="true">✓</span> {n} routine step{n === 1 ? '' : 's'} done automatically
        {playOn && <HandoffSummary types={handedTo} />}
        <When at={item.at} now={now} />
      </summary>
      <ul className="auto-steps">
        {steps.map((s, i) => (
          <li key={i}>
            <span>{s.headline}</span>
            {playOn && <Handoff headline={s.headline} faces={open} />}
            {s.who && s.who !== 'conductor' ? <Worker who={s.who} className="muted" playOn={playOn} faces={open} /> : null}
            {s.reason ? <span className="muted" title="Why this counted as routine."> · <InlineText text={s.reason} /></span> : null}
            {s.rule ? <> · <a href={settingsHref()} title="One of your “Always allow” rules let this run. See or remove it in Settings.">see rule</a></> : null}
          </li>
        ))}
      </ul>
      <ExtrasLines item={item} />
    </details>
  );
}

/** Your message; one you steered into a reply in progress also shows where it is (`steer`). */
export function YouMessage({ text, at, now, steer = null, steered = false }: { text: string; at: string | null; now: Date; steer?: SteerState | null; steered?: boolean }) {
  const s = steer ? STEER_LABELS[steer] : null;
  return (
    <article className={`thread-item you${steered ? ' is-steer' : ''}`} aria-label="You">
      <header className="thread-meta">
        <span className="who">You</span>
        {steered && <span className="chip" title="You sent this while the Foreman was replying, so it joined that reply.">Steer</span>}
        {s && <span className={`steer-state steer-${steer}`} title={s.hint}>{s.label}</span>}
        <When at={at} now={now} />
      </header>
      <p className="you-text">{text}</p>
    </article>
  );
}

/** playOn: Play mode isn't Off (the pane reads it once for every line). */
export function ThreadItemView({ item, now, steer = null, playOn }: { item: ThreadItem; now: Date; steer?: SteerState | null; playOn: boolean }) {
  switch (item.kind) {
    case 'you':
      return <YouMessage text={item.text} at={item.at} now={now} steer={steer} steered={item.sendKind === 'steer'} />;
    case 'reply':
      return (
        <article className="thread-item reply" aria-label="Foreman">
          <header className="thread-meta">
            <span className="who">Foreman</span>
            {item.stopped ? <span className="chip" title="You stopped this reply before the Foreman finished.">Stopped early</span> : null}
            <When at={item.at} now={now} />
          </header>
          <ServerHtml html={String(item.html ?? '')} />
          <ExtrasLines item={item} />
        </article>
      );
    case 'auto':
      return <AutoFold item={item} now={now} playOn={playOn} />;
    case 'problem':
      return (
        <article className="thread-item problem" aria-label="Problem">
          <header className="thread-meta">
            <span className="who"><span aria-hidden="true">⚠ </span>Problem</span>
            <When at={item.at} now={now} />
          </header>
          <p className="problem-text">{item.text}</p>
          <ExtrasLines item={item} />
        </article>
      );
    case 'decision':
      return (
        <p className="thread-item decision thread-line">
          <span className="glyph" aria-hidden="true">›</span> {item.text} <When at={item.at} now={now} />
        </p>
      );
    case 'blocked':
      // Refused without a card: dim, so nothing is hidden but it doesn't shout.
      return (
        <p
          className={`thread-item thread-line blocked-line by-${item.by}`}
          data-ask="blocked"
          title={item.by === 'auto'
            ? 'Auto mode’s safety model refused this step by itself, so it never came to you. The Foreman was told and carries on without it.'
            : 'The dashboard refuses this step in every setting (a hard line). The Foreman was told and carries on without it.'}
        >
          <span className="glyph" aria-hidden="true">⊘</span> {item.text}
          {item.who && item.who !== 'conductor' ? <Worker who={item.who} playOn={playOn} /> : null}
          {item.preview ? <> · <code className="blocked-preview">{item.preview}</code></> : null}
          {item.reason ? <span> · <InlineText text={item.reason} /></span> : null}
          {' '}<When at={item.at} now={now} />
        </p>
      );
    case 'note':
      return (
        <p className="thread-item note thread-line">
          <span className="glyph" aria-hidden="true">·</span> {item.text} <When at={item.at} now={now} />
        </p>
      );
    default:
      return null; // a kind this page doesn't know yet
  }
}
