// Peek before you open (packet R, principle 10): Space or a click on a card opens a sheet over the
// right side of the list with the job's ask, its now line and the next step (Go / No go when it
// waits). j and k move through the list, ↵ opens the whole job, Esc closes it, and the list behind
// hasn't moved. Used by Jobs; the Desk, Inbox and Stacks have their own way to the same detail.
import { useEffect, useRef } from 'react';
import type { Job } from '../api/types';
import { jobHref, navigate } from '../app/router';
import { isTypingTarget } from '../app/keyRegistry';
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
  const latest = useRef({ job, order, onPick, onClose });
  latest.current = { job, order, onPick, onClose };
  const chip = stateChip(job, permissions);
  const lane = laneOf(job);
  const name = job.title || job.slug;

  // j k ↵ Esc while it is open, ahead of the page's own keys (which would open the next job's page).
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const { job: j, order: o, onPick: pick, onClose: close } = latest.current;
      const at = o.indexOf(j.slug);
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault(); e.stopImmediatePropagation();
        const next = o[(at + (e.key === 'j' ? 1 : -1) + o.length) % o.length];
        if (next) pick(next);
        return;
      }
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement)) {
        e.preventDefault(); e.stopImmediatePropagation(); navigate({ name: 'job', slug: j.slug });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

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
