// The open step's own body: one place for the laptop page and the phone's step screen, so a step
// reads the same on both. Investigate has no body. Each body draws its own Auto line.

import type { ReactNode } from 'react';
import type { EvidenceView, Job, JobDetail, StageView, StopId } from '../../api/types';
import { BuildStep, PlanStep } from './BuildStep';
import { ReviewStep } from './ReviewStep';
import { ShipStep } from './ShipStep';
import { SpecStep } from './SpecStep';
import { TestStep } from './TestStep';

export function StepBody({ stop, job, detail, view, now, evidence, onRecorded, watching, onWatching, tryOpen, onTryOpen }: {
  stop: StopId; job: Job; detail: JobDetail | null; view: StageView; now: Date;
  evidence: EvidenceView | null; onRecorded(): void;
  watching: boolean; onWatching(on: boolean): void; tryOpen: boolean; onTryOpen(open: boolean): void;
}): ReactNode {
  const slug = job.slug;
  switch (stop) {
    case 'spec': return <SpecStep slug={slug} job={job} view={view} />;
    case 'plan': return <PlanStep slug={slug} job={job} view={view} />;
    case 'build': return <BuildStep slug={slug} job={job} view={view} />;
    case 'test':
      return (
        <TestStep
          slug={slug} job={job} detail={detail} view={view} evidence={evidence} now={now} onRecorded={onRecorded}
          watching={watching} onWatching={onWatching} tryOpen={tryOpen} onTryOpen={onTryOpen}
        />
      );
    case 'review': return <ReviewStep slug={slug} job={job} view={view} />;
    case 'ship': return <ShipStep slug={slug} job={job} view={view} />;
    default: return null;
  }
}
