// The Ship step's body in the open step (design 3.2): the three pull requests (job.page.prs through
// the step's view), each with where it goes, its state in words, its checks and when it was opened,
// and Open on GitHub; then today's review panel, the hand-off nudges and the GitHub line, as the Job
// page's Ship tab draws them. While Auto is on, a line says where Auto stops (or that it stopped here).
// Nothing here hides or turns off anything because of Auto. A record from an older laptop (no pull
// requests known) says so in a sentence and the rest draws.
import type { Job, PrRow, StageView } from '../../api/types';
import { Button } from '../../components/Button';
import { Chip, type ChipTone } from '../../components/Chip';
import { Icon, type IconName } from '../../components/Icon';
import { useNow } from '../../lib/time';
import { stopOf } from '../../components/stops/stops';
import { JobGithub } from '../../panes/Foreman/JobGithub';
import { GithubLine, agoWords } from '../../views/Review/GithubLine';
import { ReviewPanel } from '../../views/Review/ReviewPanel';
import { ROUND_NUDGES, useReview } from '../../views/Review/useReview';
import { AutoLine, autoStoppedNow, stopHere, stoppedWords, useAutoEntries } from './stepAuto';
import './page.css';

type Chipped = { words: string; tone: ChipTone; icon: IconName };

/** A pull request's state in words, from its state and review. Null when its state is not known. */
export function prChip(pr: PrRow): Chipped | null {
  switch (pr.state) {
    case 'open':
      if (pr.review === 'approved') return { words: 'Open, approved', tone: 'ok', icon: 'check' };
      if (pr.review === 'changes') return { words: 'Open, changes asked for', tone: 'warn', icon: 'pencil' };
      return { words: 'Open, waiting for a review', tone: 'review', icon: 'eye' };
    case 'draft': return { words: 'Draft', tone: 'outline', icon: 'pencil' };
    case 'merged': return { words: 'Merged', tone: 'ok', icon: 'merge' };
    case 'closed': return { words: 'Closed', tone: 'outline', icon: 'x' };
    case 'not-started': return { words: 'Not started', tone: 'outline', icon: 'circle-dashed' };
    default: return null;
  }
}

const CHECKS: Record<NonNullable<PrRow['checks']>, string> = { passed: 'Checks passed', running: 'Checks running', failed: 'Checks failed' };

/** Under an open one: "Checks running · opened 20 min ago"; each part left out when not known. */
export function prMeta(pr: PrRow, now: number): string {
  if (pr.state !== 'open') return '';
  const opened = agoWords(pr.openedAt, now);
  const line = [pr.checks ? CHECKS[pr.checks] : null, opened ? `opened ${opened}` : null].filter(Boolean).join(' · ');
  return line ? `${line.charAt(0).toUpperCase()}${line.slice(1)}` : '';
}

const isWebUrl = (url: string | null | undefined): url is string => typeof url === 'string' && /^https?:\/\//i.test(url.trim());

function titleOf(n: 1 | 2 | 3, pr: PrRow | undefined): string {
  if (n === 2) return 'PR #2 · Into staging';
  if (n === 3) return 'PR #3 · Into main';
  const title = pr?.title?.trim();
  return title ? `PR #1 · ${title}` : 'PR #1';
}

function whereOf(n: 1 | 2 | 3, pr: PrRow | undefined): string | null {
  if (n === 1) return 'From your fork into the team’s feature branch';
  if (pr?.state !== 'not-started') return null;
  return n === 2 ? 'After PR #1 is merged, with its own go-ahead' : 'After staging is checked';
}

/** The hand-off nudges under the review panel: the PR ones a review round covers stay hidden while it shows (as the Ship tab). */
function ShipNudges({ job }: { job: Job }) {
  const { view } = useReview(job.slug);
  return <JobGithub job={job} check={false} hide={view ? ROUND_NUDGES : undefined} />;
}

export function ShipStep({ slug, job, view }: { slug: string; job: Job; view: StageView | null | undefined }) {
  const entries = useAutoEntries(slug, job);
  // Auto stopped now, at Ship: its stop. Else, only while Auto is on: where it stops.
  const stop = entries && entries.some((e) => e.kind) && autoStoppedNow(job) ? stopHere(entries, 'ship') : null;
  const stopped = stop ? stoppedWords(stop) : null;
  const autoOn = job.auto?.on === true;
  const prs = Array.isArray(view?.prs) ? view.prs.filter((p) => p && typeof p === 'object') : null;
  const shipping = stopOf(job.stage) === 'ship' || (job.nudges?.length ?? 0) > 0;
  const now = useNow().getTime();
  return (
    <div className="sb-step-body">
      {stopped ? <AutoLine icon="octagon" words={stopped} />
        : autoOn && <AutoLine icon="git-pr" words="Auto stops once PR #1 is open. It never merges." />}
      <section className="sb-block sb-prs" aria-label="The pull requests">
        <h3 className="eyebrow">The pull requests</h3>
        {!prs ? <p className="sb-step-note">The pull requests aren’t known for this job yet.</p> : (
          <ul className="sb-pr-list" aria-label="The pull requests">
            {([1, 2, 3] as const).map((n) => {
              const pr = prs.find((p) => p.n === n);
              const chip = pr ? prChip(pr) : null;
              const where = whereOf(n, pr);
              const meta = pr ? prMeta(pr, now) : '';
              const url = pr && isWebUrl(pr.url) ? pr.url.trim() : null;
              return (
                <li key={n} className="sb-pr">
                  <div className="sb-pr-what">
                    <Icon name="git-pr" size={18} />
                    <div className="sb-pr-words">
                      <b className="sb-pr-title">{titleOf(n, pr)}</b>
                      {where && <div className="sb-pr-where">{where}</div>}
                    </div>
                  </div>
                  <div className="sb-pr-state">
                    {chip && <Chip tone={chip.tone} icon={chip.icon}>{chip.words}</Chip>}
                    {meta && <span className="sb-pr-meta">{meta}</span>}
                    {url && <Button size="sm" href={url} target="_blank" rel="noreferrer" title={`Open PR #${n} on GitHub, in a new tab.`}>Open on GitHub</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {shipping && <><ReviewPanel slug={slug} /><ShipNudges job={job} /></>}
      <GithubLine />
    </div>
  );
}
