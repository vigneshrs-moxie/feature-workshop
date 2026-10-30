// While something loads (packet R, principle 5): nothing for the first 200 ms, then the indicator
// for at least 400 ms (lib/useDelayedFlag.ts), and only then the content. The indicator's space is
// taken from the start, so nothing jumps when it appears. `skeleton` is a stand-in the shape of the
// content (Skeleton below); without one it is a quiet line of words.
import type { ReactNode } from 'react';
import { useDelayedFlag } from '../lib/useDelayedFlag';

export function Pending({ loading, say, skeleton, className, children }: {
  loading: boolean;
  /** What is loading, in words: shown as the line, or read out with a skeleton. */
  say: string;
  skeleton?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const shown = useDelayedFlag(loading);
  if (!loading && !shown) return <>{children}</>;
  return (
    <div className={`pending${shown ? '' : ' is-waiting'}${className ? ` ${className}` : ''}`} role="status" aria-busy="true">
      {skeleton ? <><span className="sr-only">{say}</span>{skeleton}</> : <p className="muted">{say}</p>}
    </div>
  );
}

/** A stand-in card: `rows` lines of a quiet shine, the first wide, the last short. */
export function Skeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={`skeleton-card${className ? ` ${className}` : ''}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className={`skeleton-line${i === 0 ? ' is-wide' : i === rows - 1 && rows > 1 ? ' is-short' : ''}`} />
      ))}
    </div>
  );
}
