// The map of seven stops: ticks for done, the hand where it waits for you, a spinner where the crew
// works, plain circles for what is next. Each stop says its state in words (title and screen
// readers); colour is never the only sign. With `hrefFor`, each stop is a link (to its Stage).
import { useId } from 'react';
import type { StopId } from '../../api/types';
import { Icon, type IconName } from '../Icon';
import { STOPS, STOP_STATE_WORDS, stopStates, type StopState } from './stops';

const STATE_ICON: Partial<Record<StopState, IconName>> = { done: 'check', waiting: 'hand', skipped: 'skip' };

export function StopMap({ job, hrefFor, current, compact = false, tips = false, label = 'Where the job is' }: {
  job: Parameters<typeof stopStates>[0];
  /** Make each stop a link, such as to its Stage. */
  hrefFor?: (stop: StopId) => string;
  /** The stop this page is about (the Stage page): marked as the current page. */
  current?: StopId;
  /** Dots only, no names (phone, job cards). */
  compact?: boolean;
  /** Each stop takes the focus (Tab moves along them) and shows its own small tooltip at once, on hover and on focus. */
  tips?: boolean;
  label?: string;
}) {
  const states = stopStates(job);
  const uid = useId();
  return (
    <ol className={`stop-map${compact ? ' is-compact' : ''}`} aria-label={label}>
      {STOPS.map((s) => {
        const state = states[s.id];
        const words = `${s.label}: ${STOP_STATE_WORDS[state]}`;
        const tip = `${s.label} · ${STOP_STATE_WORDS[state].toLowerCase()}`;
        const body = (
          <>
            <span className="stop-dot" aria-hidden="true"><Icon name={STATE_ICON[state] ?? s.icon} size={compact ? 12 : 16} /></span>
            <span className={compact ? 'sr-only' : 'stop-name'}>{s.label}</span>
            <span className="sr-only">, {STOP_STATE_WORDS[state]}</span>
          </>
        );
        return (
          <li key={s.id} className={`stop is-${state}${current === s.id ? ' is-current' : ''}`} title={tips ? undefined : words}>
            {hrefFor
              ? <a className="stop-link" href={hrefFor(s.id)} aria-current={current === s.id ? 'page' : undefined}>{body}</a>
              : tips
                ? <span className="stop-link has-tip" tabIndex={0} aria-describedby={`${uid}-${s.id}`}>{body}<span className="stop-tip" role="tooltip" id={`${uid}-${s.id}`}>{tip}</span></span>
                : <span className="stop-link">{body}</span>}
          </li>
        );
      })}
    </ol>
  );
}

