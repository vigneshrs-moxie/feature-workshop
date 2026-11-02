// <FloorList benches onOpenJob />: the station as plain words, one row per bay: its sign (the kind's
// icon, "Building · Invoice export" or "Repairing · Footer typo"), the stop and how far the work has
// got, its status, and each figure's line. "Show as a list" switches to it, and it is what shows
// when the browser can't draw 3D and there is no 2D floor to fall back on.
// <FigureLine figure />: one figure's words, its role word first ("Builder · reading merge.ts").
// <BaySign bench /> and <BayStop bench />: a bay's first two lines, shared with the 3D plates.
import { jobHref } from '../../app/router';
import type { FloorBench, FloorFigure } from './types';
import { BAY_ICON, KIND_WORDS, type BayKind } from './bays';
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

/** The stop the job is at, in words, with its icon in the stop's hue (the bay's tile says the same in colour). */
export function StopWord({ bench }: { bench: FloorBench }) {
  const stop = STOPS.find((s) => s.id === bench.hue);
  return (
    <span className="floor3d-stop" data-stop={bench.hue}>
      {stop && <Icon name={stop.icon} size={12} className="floor3d-stop-icon" />}
      {bench.stop}
    </span>
  );
}

/** The bay's kind as an icon (a plus in a hexagon, a wrench), drawn like the app's own icons. */
export function BayIcon({ kind, size = 14 }: { kind: BayKind; size?: number }) {
  const paths = [...BAY_ICON[kind].matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
  return (
    <svg className="floor3d-kind-icon" data-kind={kind} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** The bay's sign as its link: the kind's icon, then "Building · Invoice export" (named "Feature: Building · Invoice export" for screen readers). */
export function BaySign({ bench, onOpenJob, title }: { bench: FloorBench; onOpenJob: (slug: string) => void; title?: string }) {
  const at = bench.sign.indexOf(' · ');
  const verb = at > 0 ? bench.sign.slice(0, at) : '';
  const name = at > 0 ? bench.sign.slice(at + 3) : bench.sign;
  return (
    <a
      className="floor3d-plate-title"
      data-kind={bench.kind}
      aria-label={`${KIND_WORDS[bench.kind]}: ${bench.sign}`}
      href={jobHref(bench.slug)}
      title={title}
      onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onOpenJob(bench.slug); }}
    >
      <BayIcon kind={bench.kind} />
      {verb && <span className="floor3d-verb">{verb}<span className="floor3d-sep" aria-hidden="true"> · </span></span>}
      <span className="floor3d-name">{name}</span>
    </a>
  );
}

/** The stop the job is at and how far the work has got: "Build · hull plates going on". */
export function BayStop({ bench }: { bench: FloorBench }) {
  return (
    <p className="floor3d-phase">
      {bench.stop && <StopWord bench={bench} />}
      {bench.stop && <span className="floor3d-sep" aria-hidden="true"> · </span>}
      <span className="floor3d-phase-words">{bench.phaseWords}</span>
    </p>
  );
}

export function FloorList({ benches, onOpenJob }: { benches: readonly FloorBench[]; onOpenJob: (slug: string) => void }) {
  if (!benches.length) return <p className="floor3d-empty muted">No jobs at the station. A new job takes the first bay.</p>;
  return (
    <ol className="floor3d-list" aria-label="The station, bay by bay">
      {[...benches].sort((a, b) => a.index - b.index).map((b) => (
        <li key={b.slug} className="floor3d-row" data-group={b.lamp}>
          <div className="floor3d-row-head">
            <BaySign bench={b} onOpenJob={onOpenJob} />
            <span className="floor3d-status" data-group={b.lamp}>
              <span className="floor3d-glyph" aria-hidden="true">{b.glyph}</span>
              {b.status}
            </span>
          </div>
          <BayStop bench={b} />
          <ul className="floor3d-lines">
            {b.figures.map((f) => <FigureLine key={f.key} figure={f} />)}
            {b.more > 0 && <li className="floor3d-line floor3d-more">and {b.more} more {b.more === 1 ? 'helper' : 'helpers'} at work</li>}
          </ul>
        </li>
      ))}
    </ol>
  );
}
