// <StageStrip job stop agents />: the Stage's bench in 3D (packet S), Play full only. A fixed band
// 220 px tall at the top of a stop's page: this job's bench with the Foreman and the crew the Stage
// lists at this stop, each in the pose of what it is really doing, and their words beside it. It
// folds to a slim line (remembered per browser), which keeps the words and loads no 3D; the crew
// rows below are unchanged. Without WebGL the band shows the same words.
import { useMemo } from 'react';
import type { Job, StageAgent, StopId } from '../../api/types';
import { Button } from '../../components/Button';
import { useStored } from '../../lib/stored';
import { useNow } from '../../lib/time';
import { useWorkshopState } from '../../state/store';
import { Floor3D } from './Floor3D';
import { stripLayout } from './layout';
import { stageBench } from './model';

export const STRIP_FOLD_KEY = 'gc.stage.strip';

/** The band's layout for any width (one bench, always 220 px tall). */
const stripFor = (width: number) => stripLayout(width);

export function StageStrip({ job, stop, agents }: { job: Job; stop: StopId; agents: readonly StageAgent[] | null }) {
  const state = useWorkshopState();
  const now = useNow();
  const [stored, setStored] = useStored(STRIP_FOLD_KEY);
  const folded = stored === 'folded';
  // Until the Stage has answered, the job card's own now lines (so nothing pops in later).
  const bench = useMemo(() => stageBench(job, stop, agents ?? (Array.isArray(job.nowDoing) ? (job.nowDoing as StageAgent[]) : []), {
    permissions: state.permissions, usage: state.usage, run: (state.runs?.[job.slug] ?? null) as never, now,
  }), [job, stop, agents, state.permissions, state.usage, state.runs, now]);
  const benches = useMemo(() => [bench], [bench]);
  const fold = (
    <Button
      kind="quiet" size="sm" className="stage-strip-fold"
      icon={folded ? 'chevron-down' : undefined}
      aria-expanded={!folded}
      onClick={() => setStored(folded ? null : 'folded')}
      title={folded ? 'Show the bench in 3D again.' : 'Fold the bench to one line of words.'}
    >
      {folded ? 'Show the bench' : 'Fold'}
    </Button>
  );
  if (folded) {
    return (
      <section className="stage-strip is-folded" aria-label="The bench at this stop">
        <p className="stage-strip-line">
          {bench.figures.map((f) => <span key={f.key} className="stage-strip-who">{f.label}</span>)}
        </p>
        {fold}
      </section>
    );
  }
  return (
    <section className="stage-strip" aria-label="The bench at this stop">
      <Floor3D benches={benches} layoutFor={stripFor} bar={false} label="The bench at this stop, in 3D" />
      {fold}
    </section>
  );
}
