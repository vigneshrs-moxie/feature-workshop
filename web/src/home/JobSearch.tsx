// The Jobs page's search (16 Nov). A box in the page's heading: / puts the focus in it from anywhere on
// Jobs. Typing shows every job that matches (both tabs, Resting and Done too; home/findJobs.ts),
// best first, in place of the board; ↓ ↑ move the pick, Enter opens it, Escape clears the box (a second
// Escape leaves it). Nothing is fetched: the jobs are the ones the app already holds.

import type { KeyboardEvent, RefObject } from 'react';
import type { Job } from '../api/types';
import { jobHref, navigate, stackHref } from '../app/router';
import { Chip } from '../components/Chip';
import { Icon } from '../components/Icon';
import { KeyText } from '../components/Kbd';
import { StopMap } from '../components/stops/StopMap';
import { relativeTime } from '../lib/time';
import { chipTone, LANE_INFO, laneOf } from './JobsPage';
import { keyOfSlug } from './findJobs';

export interface JobFindProps {
  value: string;
  onChange(q: string): void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** The matches as shown, for ↓ ↑ and Enter. */
  results: readonly Job[];
  active: number;
  onActive(i: number): void;
  /** A job that is a stack's: its stack's page opens. */
  stackOf(slug: string): boolean;
}

export const hrefOfJob = (slug: string, inStack: boolean) => (inStack ? stackHref(slug) : jobHref(slug));

export function JobFind({ value, onChange, inputRef, results, active, onActive, stackOf }: JobFindProps) {
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      const by = e.key === 'ArrowDown' ? 1 : -1;
      onActive((active + by + results.length) % results.length);
    } else if (e.key === 'Enter') {
      const job = results[active];
      if (!job || !value.trim()) return;
      e.preventDefault();
      if (stackOf(job.slug)) window.location.hash = stackHref(job.slug);
      else navigate({ name: 'job', slug: job.slug });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (value) onChange('');
      else e.currentTarget.blur();
    }
  }
  return (
    <label className="jobs-find">
      <Icon name="search" size={14} />
      <input
        ref={inputRef}
        type="search"
        className="jobs-find-in"
        aria-label="Find a job"
        placeholder="Find a job: title, ticket, branch…"
        value={value}
        onChange={(e) => { onChange(e.target.value); onActive(0); }}
        onKeyDown={onKeyDown}
        aria-controls="jobs-found"
        aria-activedescendant={value && results[active] ? `jobs-found-${results[active].slug}` : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      {!value && <KeyText keys="/" shown />}
    </label>
  );
}

export interface JobResultsProps {
  query: string;
  results: readonly Job[];
  total: number;
  active: number;
  onActive(i: number): void;
  stackOf(slug: string): boolean;
  now: Date;
}

/** The matches, one line each: the lane, the ticket key and title, its stops, and why it is where it is. */
export function JobResults({ query, results, total, active, onActive, stackOf, now }: JobResultsProps) {
  return (
    <section className="jobs-found" aria-label="Jobs found">
      <p className="jobs-found-count" role="status">
        {results.length === 0 ? `No job has “${query.trim()}”.` : `${results.length} of ${total} ${total === 1 ? 'job' : 'jobs'}`}
        {results.length > 0 && <span className="muted"> · ↓ ↑ to pick, Enter to open, Esc to clear</span>}
      </p>
      <ul className="jobs-list jobs-found-list" id="jobs-found" role="listbox" aria-label="Matching jobs">
        {results.map((j, i) => {
          const l = laneOf(j);
          const key = keyOfSlug(j.slug);
          const when = j.waitingSince ?? j.updatedAt ?? null;
          return (
            <li
              key={j.slug}
              id={`jobs-found-${j.slug}`}
              role="option"
              aria-selected={i === active}
              className={`jobs-list-row jobs-found-row lane-${l}${i === active ? ' is-active' : ''}`}
              onMouseEnter={() => onActive(i)}
            >
              <Chip tone={chipTone(l, LANE_INFO[l].word)} icon={LANE_INFO[l].icon} className={`state-chip is-${l}`}>{LANE_INFO[l].word}</Chip>
              <a className="job-card-title" href={hrefOfJob(j.slug, stackOf(j.slug))}>
                {key && <span className="jobs-found-key">{key}</span>}
                {j.title || j.slug}
              </a>
              <StopMap job={{ ...j, lane: l }} compact tips label={`${j.title || j.slug}: its stops`} />
              <span className="muted jobs-list-reason">{[j.laneReason, when ? relativeTime(when, now) : null].filter(Boolean).join(' · ')}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
