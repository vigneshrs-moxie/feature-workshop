// The live row at the foot of the thread while the Foreman is replying: a typing indicator, what
// it's doing (its last tool step) and the last thing it wrote, updated by 'run' events. Gone once
// the reply ends; the finished reply then appears in the thread.
import type { Run } from '../../api/types';
import { ShortMarkdown } from '../../components/InlineText';
import { isActiveRun, liveLabel } from './thread';

export function LiveRow({ run }: { run: Run | null | undefined }) {
  if (!isActiveRun(run)) return null;
  const text = run.lastText?.trim();
  return (
    <section className="thread-item live-row" aria-label="Foreman, replying now">
      <header className="thread-meta">
        <span className="who">Foreman</span>
        <span className="typing" aria-hidden="true"><span /><span /><span /></span>
        <span className="live-label" role="status">{liveLabel(run)}</span>
      </header>
      {run.lastAction && (
        <p className="live-action muted" title="The step the Foreman is on right now.">{run.lastAction}</p>
      )}
      {text && <div className="live-text" title="The latest thing the Foreman wrote. The full reply appears here when it finishes."><ShortMarkdown text={text} /></div>}
    </section>
  );
}
