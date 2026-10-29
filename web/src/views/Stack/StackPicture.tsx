// The stack's progress picture, in the two forms the Stack review kept (c-map):
//   A. the merge map (the default): Plan on the left, one line per part through Build, the lines
//      meeting at Merge, then Push. Each line fills as its part is built; a word at its end says
//      where it is; "You are here" sits over the step you're at;
//   B. four big steps, with the part cards under them carrying a bar each (Settings → Look →
//      Stack picture), also what a phone shows, where the map has no room.
// Plus each step in one plain line (what happens there, what you do), under either picture.
// Every state is a word; the colours only repeat it. In Play full the map sits on faint grid lines
// and a building part's front dot pulses softly (still when the system asks for less motion).
import type { StackStepId, StackView } from '../../api/types';
import { Icon } from '../../components/Icon';
import { useStored } from '../../lib/stored';
import { hereStep, mapParts, moreLine, partLook, partTitle, PART, STEP_INFO, stepLine, type PartLook } from './stackModel';

export type StackPictureKind = 'map' | 'steps';
export const STACK_PICTURE_KEY = 'gc.stack.picture';

/** Settings → Look → Stack picture: the merge map (default) or four big steps, kept in this browser. */
export function useStackPicture(): [StackPictureKind, (kind: StackPictureKind) => void] {
  const [raw, set] = useStored(STACK_PICTURE_KEY);
  return [raw === 'steps' ? 'steps' : 'map', (k) => set(k === 'map' ? null : k)];
}

const STEPS: StackStepId[] = ['plan', 'build', 'merge', 'push'];

type StepState = 'done' | 'now' | 'next';
function stepState(view: StackView, id: StackStepId): StepState {
  return view.steps.find((s) => s.id === id)?.state ?? 'next';
}
const stateWord = (s: StepState, id: StackStepId) => (s === 'done' ? '✓ Done' : STEP_INFO[id].sub);

// ---------- A. The merge map ----------

// Across, in % of the map's width; down, in px.
const X = { plan: 7, buildL: 15, laneL: 17, laneR: 61, buildR: 66, merge: 77, push: 92 };
const TOP = 66;

export function MergeMap({ view, grid, pulse }: { view: StackView; grid: boolean; pulse: boolean }) {
  const rows = mapParts(view.parts);
  const n = Math.max(rows.shown.length, 1);
  const rh = rows.dense ? 28 : 34;
  const more = moreLine(rows);
  const bottomRows = TOP + n * rh + (more ? 18 : 0);
  const yc = TOP + ((n - 1) * rh) / 2 + 2;
  const height = Math.max(bottomRows + 14, yc + 70);
  const here = hereStep(view);
  const pushed = view.phase === 'pushed';
  const W = 1000;
  const px = (pct: number) => pct * 10;
  const yOf = (i: number) => TOP + i * rh + 2;
  const looks = rows.shown.map((p) => partLook(p, view));
  const buildDone = stepState(view, 'build') === 'done';

  const track = (y: number) => `M ${px(X.plan)} ${yc} C ${px(X.plan) + 50} ${yc}, ${px(X.laneL) - 40} ${y}, ${px(X.laneL)} ${y} L ${px(X.laneR)} ${y} C ${px(X.laneR) + 70} ${y}, ${px(X.merge) - 70} ${yc}, ${px(X.merge)} ${yc}`;
  const head = (y: number) => `M ${px(X.plan)} ${yc} C ${px(X.plan) + 50} ${yc}, ${px(X.laneL) - 40} ${y}, ${px(X.laneL)} ${y}`;
  const fillTo = (y: number, look: PartLook) => {
    if (look.tone === 'merged') return track(y);
    if (look.fill <= 0) return null;
    const x = px(X.laneL) + look.fill * (px(X.laneR) - px(X.laneL));
    return `${head(y)} L ${x} ${y}`;
  };
  const dotX = (look: PartLook) => X.laneL + look.fill * (X.laneR - X.laneL);

  return (
    <div className={`stack-map${grid ? ' has-grid' : ''}${rows.dense ? ' is-dense' : ''}`} style={{ height }} role="group" aria-label={`The stack’s map: Plan, then each ${PART.one} built side by side, joining one at a time at Merge, then Push`}>
      <div className={`map-build${here === 'build' ? ' is-here' : ''}`} style={{ left: `${X.buildL}%`, width: `${X.buildR - X.buildL}%`, top: 22, height: height - 30 }}>
        <span className="map-build-head"><Icon name="hammer" size={14} /> Build <span className="muted">· side by side{buildDone ? ' ✓' : ''}</span></span>
      </div>
      <svg className="map-lines" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {rows.shown.map((p, i) => {
          const y = yOf(i);
          const look = looks[i];
          const fill = fillTo(y, look);
          return (
            <g key={p.name}>
              <path d={track(y)} className="map-track" />
              {fill && <path d={fill} className={`map-fill tone-${look.atMerge ? 'building' : look.tone}`} />}
              {look.atMerge && <path d={`M ${px(X.laneR)} ${y} C ${px(X.laneR) + 70} ${y}, ${px(X.merge) - 70} ${yc}, ${px(X.merge)} ${yc}`} className="map-fill tone-problem" />}
            </g>
          );
        })}
        <path d={`M ${px(X.merge)} ${yc} L ${px(X.push)} ${yc}`} className={pushed ? 'map-fill tone-merged' : 'map-track'} />
      </svg>
      {rows.shown.map((p, i) => {
        const y = yOf(i);
        const look = looks[i];
        return (
          <div key={p.name} className="map-row" style={{ top: y - 19 }}>
            <span className="map-row-name" style={{ left: `${X.laneL}%`, maxWidth: `${X.laneR - X.laneL - 16}%` }} title={p.name}>
              <span className="part-n">{p.n}</span> {partTitle(p)}
            </span>
            <span className={`chip map-chip tone-${look.tone}`} style={{ right: `${100 - X.laneR}%` }}>{look.word}</span>
            {look.tone !== 'merged' && look.fill > 0 && !look.atMerge && (
              <span className={`map-dot tone-${look.tone}${pulse && look.live ? ' is-pulse' : ''}`} style={{ left: `${dotX(look)}%`, top: 19 }} aria-hidden="true" />
            )}
            {look.atMerge && <span className="map-dot tone-problem is-mark" style={{ left: `${X.merge - 3.2}%`, top: 19 + (yc - y) * 0.85 }} aria-hidden="true" />}
          </div>
        );
      })}
      {more && <span className="map-more muted" style={{ left: `${X.laneL}%`, top: TOP + n * rh - 4 }}>{more}</span>}
      <MapNode id="plan" x={X.plan} y={yc} view={view} here={here === 'plan'} />
      <MapNode id="merge" x={X.merge} y={yc} view={view} here={here === 'merge'} />
      <MapNode id="push" x={X.push} y={yc} view={view} here={here === 'push'} />
      {here === 'build' && <span className="map-here" style={{ left: `${(X.buildL + X.buildR) / 2}%`, top: 12 }}>You are here</span>}
    </div>
  );
}

function MapNode({ id, x, y, view, here }: { id: 'plan' | 'merge' | 'push'; x: number; y: number; view: StackView; here: boolean }) {
  const s = stepState(view, id);
  const info = STEP_INFO[id];
  return (
    <>
      {here && <span className="map-here" style={{ left: `${x}%`, top: y - 44 }}>You are here</span>}
      <span className={`map-node is-${s}${here ? ' is-here' : ''}`} style={{ left: `${x}%`, top: y }} title={stepLine(id, view)}>
        <Icon name={s === 'done' ? 'check' : info.icon} size={18} />
      </span>
      <span className="map-node-label" style={{ left: `${x}%`, top: y + 24 }}>
        <b>{info.label}</b>
        <span className="muted">{stateWord(s, id)}</span>
      </span>
    </>
  );
}

// ---------- B. Four big steps ----------

export function StepsPicture({ view }: { view: StackView }) {
  const here = hereStep(view);
  return (
    <ol className="stack-steps" aria-label="The four steps">
      {STEPS.map((id) => {
        const s = stepState(view, id);
        const info = STEP_INFO[id];
        return (
          <li key={id} className={`stack-step is-${s}${here === id ? ' is-here' : ''}`} aria-current={here === id ? 'step' : undefined}>
            <Icon name={s === 'done' ? 'check' : info.icon} size={20} />
            <b>{info.label}</b>
            <span className="muted">{here === id ? `Now · ${info.sub}` : stateWord(s, id)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Each step in one line ----------

export function StepLines({ view }: { view: StackView }) {
  const here = hereStep(view);
  return (
    <ul className="stack-step-lines" aria-label="What happens at each step">
      {STEPS.map((id) => (
        <li key={id} className={here === id ? 'is-here' : undefined}>
          <b>{STEP_INFO[id].label}{here === id ? ' · now' : ''}</b>
          <span>{stepLine(id, view)}</span>
        </li>
      ))}
    </ul>
  );
}
