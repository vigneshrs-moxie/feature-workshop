// Peek before you open (packet R, principle 10): Space or a click on a card opens a sheet over the
// right side of the list with the job's ask, its now line and the next step (Go / No go when it
// waits). j and k move through the list, ↵ opens the whole job, Esc closes it, and the list behind
// hasn't moved. Used by Jobs; the keys are components/Peek.tsx's, shared with the Inbox's ticket peek.
import { useRef } from 'react';
import type { Job } from '../api/types';
import { jobHref, navigate } from '../app/router';
import { usePeekKeys } from '../components/Peek';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { NowLine, nowOf } from '../components/NowLine';

const sameWords = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
import { useNow } from '../lib/time';
import { useJobConversation } from '../panes/Foreman/ForemanPane';
import { NextStep } from '../job/JobPage';
import { chipTone, laneOf, stateChip } from './JobsPage';
import { useWorkshopState } from '../state/store';

function PeekBody({ job }: { job: Job }) {
  const now = useNow();
  const conversation = useJobConversation(job);
  return (
    <div className="peek-body">
      <NowLine job={job} now={now} />
      {job.laneReason && !sameWords(job.laneReason, nowOf(job).what) && <p className="peek-reason">{job.laneReason}</p>}
      <NextStep job={job} conversation={conversation} now={now} />
    </div>
  );
}

export function JobPeek({ job, order, onPick, onClose }: { job: Job; order: readonly string[]; onPick(slug: string): void; onClose(): void }) {
  const { permissions } = useWorkshopState();
  const box = useRef<HTMLElement>(null);
  const chip = stateChip(job, permissions);
  const lane = laneOf(job);
  const name = job.title || job.slug;

  // j k ↵ Esc while it is open, ahead of the page's own keys (which would open the next job's page).
  usePeekKeys({ current: job.slug, order, onPick, onClose, onEnter: (slug) => navigate({ name: 'job', slug }) });

  return (
    <aside ref={box} className="peek" role="dialog" aria-modal="false" aria-label={`${name}: a quick look`}>
      <header className="peek-head">
        <h3 className="peek-title">{name}</h3>
        <Chip tone={chipTone(lane, chip.word)} icon={chip.icon} className={`state-chip is-${lane}`}>{chip.word}</Chip>
        <span className="spacer" />
        <Button kind="quiet" size="sm" href={jobHref(job.slug)} title="Open the whole job: its stops, work and conversation (key: Enter).">Open the job</Button>
        <Button kind="quiet" size="sm" iconOnly icon="x" aria-label="Close" title="Close this quick look; the list stays as it was (key: Esc)." onClick={onClose} />
      </header>
      <PeekBody key={job.slug} job={job} />
      <footer className="peek-foot">
        <span><kbd className="kbd">j</kbd> <kbd className="kbd">k</kbd> the next or previous job</span>
        <span><kbd className="kbd">↵</kbd> open it</span>
        <span><kbd className="kbd">Esc</kbd> close</span>
      </footer>
    </aside>
  );
}
