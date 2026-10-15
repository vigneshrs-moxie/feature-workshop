// The thread's other items: your messages, the Foreman's replies, folds of routine steps it took
// by itself, problems, short notes, your permission decisions, and steps refused without a card
// (by auto mode or a hard line), shown as dim lines. Text you or the Foreman typed is
// always shown as plain text; only the dashboard-rendered reply HTML goes through ServerHtml.
import type { AutoItem, ThreadItem } from '../../api/types';
import { settingsHref } from '../../app/router';
import { fullTime, relativeTime } from '../../lib/time';
import { ExtrasLines } from './ExtrasLines';
import { ServerHtml } from './ServerHtml';

function When({ at, now }: { at: string | null; now: Date }) {
  if (!at) return null;
  return <time className="thread-time num" dateTime={at} title={fullTime(at)}>{relativeTime(at, now)}</time>;
}

function AutoFold({ item, now }: { item: AutoItem; now: Date }) {
  const steps = item.items ?? [];
  const n = steps.length;
  return (
    <details className="thread-item auto-fold">
      <summary title="Steps the Foreman took without asking, because your settings count them as routine. Open to see each one.">
        <span className="glyph" aria-hidden="true">✓</span> {n} routine step{n === 1 ? '' : 's'} done automatically
        <When at={item.at} now={now} />
      </summary>
      <ul className="auto-steps">
        {steps.map((s, i) => (
          <li key={i}>
            <span>{s.headline}</span>
            {s.who && s.who !== 'conductor' ? <span className="muted"> · {s.who}</span> : null}
            {s.reason ? <span className="muted" title="Why this counted as routine."> · {s.reason}</span> : null}
            {s.rule ? <> · <a href={settingsHref()} title="One of your “Always allow” rules let this run. See or remove it in Settings.">see rule</a></> : null}
          </li>
        ))}
      </ul>
      <ExtrasLines item={item} />
    </details>
  );
}

export function ThreadItemView({ item, now }: { item: ThreadItem; now: Date }) {
  switch (item.kind) {
    case 'you':
      return (
        <article className="thread-item you" aria-label="You">
          <header className="thread-meta">
            <span className="who">You</span>
            <When at={item.at} now={now} />
          </header>
          <p className="you-text">{item.text}</p>
        </article>
      );
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
      return <AutoFold item={item} now={now} />;
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
          title={item.by === 'auto'
            ? 'Auto mode’s safety model refused this step by itself, so it never came to you. The Foreman was told and carries on without it.'
            : 'The dashboard refuses this step in every setting (a hard line). The Foreman was told and carries on without it.'}
        >
          <span className="glyph" aria-hidden="true">⊘</span> {item.text}
          {item.who && item.who !== 'conductor' ? <span> · {item.who}</span> : null}
          {item.preview ? <> · <code className="blocked-preview">{item.preview}</code></> : null}
          {item.reason ? <span> · {item.reason}</span> : null}
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
