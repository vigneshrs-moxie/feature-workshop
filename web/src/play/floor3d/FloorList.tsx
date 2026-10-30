// <FloorList benches onOpenJob />: the floor as plain words, one row per bench: the job, the stop
// it is at, its status, and each figure's line. "Show as a list" switches to it, and it is what
// shows when the browser can't draw 3D and there is no 2D floor to fall back on.
// <FigureLine figure />: one figure's words, its role word first ("Builder · reading merge.ts").
import { jobHref } from '../../app/router';
import type { FloorBench, FloorFigure } from './types';
import { Icon } from '../../components/Icon';
import { STOPS } from '../../components/stops/stops';

/** "Builder · reading merge.ts" → ["Builder", "reading merge.ts"]; a line without a role ("Done") → [null, "Done"]. */
export function splitLabel(label: string, role: string): [string | null, string] {
  const prefix = `${role} · `;
  return label.startsWith(prefix) ? [role, label.slice(prefix.length)] : [null, label];
}

export function FigureLine({ figure, hover = false }: { figure: FloorFigure; hover?: boolean }) {
  const [role, rest] = splitLabel(figure.label, figure.role);
  return (
    <li className={`floor3d-line${hover ? ' is-hover' : ''}`} data-pose={figure.pose} title={figure.label}>
      {role ? <><span className="floor3d-role">{role}</span><span className="floor3d-sep" aria-hidden="true"> · </span><span className="floor3d-now">{rest}</span></> : <span className="floor3d-now">{rest}</span>}
    </li>
  );
}

/** The stop the job is at, in words, with its icon in the stop's hue (the bench's edge says the same in colour). */
export function StopWord({ bench }: { bench: FloorBench }) {
  const stop = STOPS.find((s) => s.id === bench.hue);
  return (
    <span className="floor3d-stop" data-stop={bench.hue}>
      {stop && <Icon name={stop.icon} size={12} className="floor3d-stop-icon" />}
      {bench.stop}
    </span>
  );
}

export function FloorList({ benches, onOpenJob }: { benches: readonly FloorBench[]; onOpenJob: (slug: string) => void }) {
  if (!benches.length) return <p className="floor3d-empty muted">No jobs on the floor. A new job takes the first bench.</p>;
  return (
    <ol className="floor3d-list" aria-label="The floor, bench by bench">
      {[...benches].sort((a, b) => a.index - b.index).map((b) => (
        <li key={b.slug} className="floor3d-row" data-group={b.lamp}>
          <div className="floor3d-row-head">
            <a
              className="floor3d-plate-title"
              href={jobHref(b.slug)}
              onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onOpenJob(b.slug); }}
            >
              {b.title}
            </a>
            {b.stop && <StopWord bench={b} />}
            <span className="floor3d-status" data-group={b.lamp}>
              <span className="floor3d-glyph" aria-hidden="true">{b.glyph}</span>
              {b.status}
            </span>
          </div>
          <ul className="floor3d-lines">
            {b.figures.map((f) => <FigureLine key={f.key} figure={f} />)}
            {b.more > 0 && <li className="floor3d-line floor3d-more">and {b.more} more {b.more === 1 ? 'helper' : 'helpers'} at work</li>}
          </ul>
        </li>
      ))}
    </ol>
  );
}
