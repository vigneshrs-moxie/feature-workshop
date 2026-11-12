// The job page's steps row (design 3.2): seven large steps across the work column, each with its
// icon at 36 px (the crew member who works it, in Play full), its name, its state in words and how
// long. One is open; a click (or the arrow keys, as the app's other tab lists) asks for another. A
// tab list for the keyboard and a screen reader; the open step's panel (StepPanel) is its tab panel.
import { useRef, type KeyboardEvent } from 'react';
import type { Job, JobPageFacts, StopId } from '../../api/types';
import { Icon } from '../../components/Icon';
import { STOPS } from '../../components/stops/stops';
import type { GateKind } from '../../lib/compose';
import { CrewMember } from '../../play/CrewMember';
import { STOP_CREW } from '../../play/crewPack';
import { usePlay } from '../../play/usePlay';
import { STEP_PANEL_ID, stepTabId } from './StepPanel';
import { stepState, stepTimeWords } from './stepWords';
import './page.css';

export function StepsRow({ job, times, open, sent, now, onOpen }: {
  job: Job;
  /** When each step ran (JobDetail.page.times); missing or null: not known. */
  times: JobPageFacts['times'];
  open: StopId;
  /** The bar's sent line (useSentShown), so the job's step reads Approved after your Go. */
  sent: { kind: GateKind | null } | null;
  now: Date;
  onOpen(stop: StopId): void;
}) {
  const play = usePlay();
  const refs = useRef<Partial<Record<StopId, HTMLButtonElement | null>>>({});
  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = STOPS[(i + (e.key === 'ArrowRight' ? 1 : -1) + STOPS.length) % STOPS.length].id;
    onOpen(next);
    refs.current[next]?.focus();
  }
  return (
    <div className="sb-steps" role="tablist" aria-label="The job’s seven steps">
      {STOPS.map((s, i) => {
        const state = stepState(job, s.id, sent);
        const time = stepTimeWords(job, s.id, times?.[s.id], now);
        const isOpen = s.id === open;
        const face = state.cls === 'is-now' ? 'working' : state.cls === 'is-wait' ? 'waiting' : 'idle';
        return (
          <button
            key={s.id}
            ref={(el) => { refs.current[s.id] = el; }}
            type="button"
            role="tab"
            id={stepTabId(s.id)}
            aria-selected={isOpen}
            aria-controls={STEP_PANEL_ID}
            tabIndex={isOpen ? 0 : -1}
            className={['sb-step', state.cls, isOpen && 'is-open'].filter(Boolean).join(' ')}
            aria-label={`${s.label}: ${state.words}${time ? `, ${time}` : ''}`}
            title={`Open ${s.label} here`}
            onClick={() => onOpen(s.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className="sb-step-icon" aria-hidden="true">
              {play.full ? <CrewMember type={STOP_CREW[s.id]} size={36} label="" state={face} /> : <Icon name={s.icon} size={36} />}
            </span>
            <span className="sb-step-name">{s.label}</span>
            <span className="sb-step-state">{state.words}</span>
            {time && <span className="sb-step-time num">{time}</span>}
          </button>
        );
      })}
    </div>
  );
}
