// Jobs' Auto tab (design section 2, decision 11): three groups, side by side on a laptop and one
// after another on a phone. Working, with the places in its heading ("Working · 3 of 5"), as the
// lanes' cards: each says its own lane reason, so a job waiting for the test place says the
// server's "Waiting for its turn to test". Needs you: stopped jobs with their reason, and jobs set
// aside as Too big for Auto with theirs. Ready for you to try: PR #1 is open; each row has its
// level and its risky calls. Why Auto is paused, when it is, sits at the top. The groups are the
// server's (job.auto.group, autoTab.ts); a fact an older laptop doesn't send is left out.
import type { ReactNode } from 'react';
import type { AutoQueue, Job } from '../api/types';
import { jobHref } from '../app/router';
import { Chip } from '../components/Chip';
import { Icon } from '../components/Icon';
import type { StackIndex } from '../views/Stack/StackRows';
import { autoGroups, autoPausedLine, riskyWords, TOO_BIG, tooBigTitle, workingHeading } from './autoTab';
import { Cards } from './JobsPage';

type Play = 'full' | 'subtle' | 'off';

/** The words for an empty group (plan's words). */
export const AUTO_EMPTY = {
  working: 'No Auto job is working.',
  'needs-you': 'Nothing here needs you.',
  ready: 'Nothing is ready yet.',
} as const;

/**
 * Why a stopped job waits: the card's own lane reason, else the reason its record keeps. In another
 * lane than Needs you (a reply of yours is running, so the lane's words are the reply's): the record's.
 */
function stopReason(job: Job): string | null {
  const s = job.auto?.stopped;
  const kept = typeof s === 'string' ? s : s?.reason ?? null;
  if (job.lane !== 'needs-you') return kept;
  return job.laneReason || kept;
}

/** One row of Needs you or Ready: its title opens the job; a click on the row, or Space on the title, takes the quick look. */
function Row({ job, onPeek, peeked, children }: { job: Job; onPeek?: (slug: string) => void; peeked: boolean; children: ReactNode }) {
  const name = job.title || job.slug;
  return (
    <li
      className={`sb-auto-row${onPeek ? ' can-peek' : ''}${peeked ? ' is-peeked' : ''}`}
      onClick={onPeek ? (e) => { if (!(e.target as Element).closest('a, button, [tabindex]')) onPeek(job.slug); } : undefined}
    >
      <a
        className="job-card-title"
        href={jobHref(job.slug)}
        title={onPeek ? `Open ${name}. Space, or a click on the row, takes a quick look instead.` : `Open ${name}.`}
        onKeyDown={onPeek ? (e) => { if (e.key === ' ') { e.preventDefault(); onPeek(job.slug); } } : undefined}
      >
        {name}
      </a>
      {children}
    </li>
  );
}

function Group({ id, heading, label, count, icon, children }: { id: string; heading: string; label: string; count: number | null; icon: 'activity' | 'hand' | 'flask'; children: ReactNode }) {
  return (
    <section className={`lane sb-auto-group lane-${id}${count ? ' has-cards' : ''}`} aria-label={label}>
      <header className="lane-head">
        <span className="lane-icon"><Icon name={icon} size={16} /></span>
        <h3 className="lane-word">{heading}</h3>
        {count !== null && <span className="lane-count num">{count}</span>}
      </header>
      {children}
    </section>
  );
}

export function AutoJobs({ jobs, queue, now, play, stacks, onPeek, peeked = null }: {
  jobs: readonly Job[];
  /** The snapshot's Auto queue; null or missing from an older laptop: no places and no paused line. */
  queue?: AutoQueue | null;
  now: Date;
  play: Play;
  /** The page's stacks, so a stack's card opens into its parts as on the lanes. */
  stacks?: StackIndex;
  onPeek?: (slug: string) => void;
  peeked?: string | null;
}) {
  const groups = autoGroups(jobs);
  const paused = autoPausedLine(queue?.paused);
  const working = workingHeading(groups.working.length, typeof queue?.max === 'number' ? queue.max : null);
  const need = groups['needs-you'];
  const ready = groups.ready;
  return (
    <div className="sb-auto-tab">
      {paused && <p className="sb-auto-paused" role="status"><Icon name="pause" size={16} />{paused}</p>}
      <div className="sb-auto-groups">
        <Group id="working" heading={working} label={working} count={null} icon="activity">
          {groups.working.length
            ? <Cards jobs={groups.working} now={now} play={play} stacks={stacks} onPeek={onPeek} peeked={peeked} />
            : <p className="lane-empty">{AUTO_EMPTY.working}</p>}
        </Group>
        <Group id="needs-you" heading="Needs you" label={`Needs you, ${need.length}`} count={need.length} icon="hand">
          {need.length ? (
            <ul className="sb-auto-rows">
              {need.map((j) => {
                const big = j.auto?.tooBig ?? null;
                // The reason trimmed; one that is only spaces is none.
                const why = big ? tooBigTitle(big.reason) ?? null : stopReason(j);
                return (
                  <Row key={j.slug} job={j} onPeek={onPeek} peeked={peeked === j.slug}>
                    {big && <Chip tone="warn" icon="layers" className="sb-auto-big" title={tooBigTitle(big.reason)}>{TOO_BIG}</Chip>}
                    {why && <span className="sb-auto-reason">{why}</span>}
                  </Row>
                );
              })}
            </ul>
          ) : <p className="lane-empty">{AUTO_EMPTY['needs-you']}</p>}
        </Group>
        <Group id="ready" heading="Ready for you to try" label={`Ready for you to try, ${ready.length}`} count={ready.length} icon="flask">
          {ready.length ? (
            <ul className="sb-auto-rows">
              {ready.map((j) => (
                <Row key={j.slug} job={j} onPeek={onPeek} peeked={peeked === j.slug}>
                  <span className="sb-auto-facts">
                    {typeof j.level === 'number' && <Chip tone="outline" className="sb-auto-level">{`L${j.level}`}</Chip>}
                    {typeof j.auto?.risky === 'number' && <span className="sb-auto-risky">{riskyWords(j.auto.risky)}</span>}
                  </span>
                </Row>
              ))}
            </ul>
          ) : <p className="lane-empty">{AUTO_EMPTY.ready}</p>}
        </Group>
      </div>
    </div>
  );
}
