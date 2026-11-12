// The Plan and Build steps' bodies in the open step (design 3.2). PlanSteps: the plan's numbered
// steps (job.page.plan through the step's view), with each one's state on Build (Done, Building now,
// Not yet) and none on Plan. BuildStep: the plan's steps, then the commits on the job's branch
// (GET /api/job/:slug/commits, as the Code tab reads them), each with its files, New or Changed, and
// the lines added and removed; a commit's row opens its change (CommitChanges). Commits are read on
// the laptop only: the website says so. A record from an older laptop (no plan known, commits with
// no files) says so in a sentence and the rest draws. A commit lists its first 50 files, then a count.
import { useEffect, useState } from 'react';
import type { Job, PlanStepRow, StageView } from '../../api/types';
import { BRAND } from '../../app/brand';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Icon, type IconName } from '../../components/Icon';
import { versionLabel } from '../../panes/Preview/docs';
import { listOf } from '../../lib/lists';
import { useNow } from '../../lib/time';
import { useWorkshop } from '../../state/store';
import { agoWords } from '../../views/Review/GithubLine';
import { CommitChanges, message, type Load } from './CommitChanges';
import { StepAutoLine } from './stepAuto';
import './page.css';

type Plan = StageView['plan'];

const STATE: Record<NonNullable<PlanStepRow['state']>, { words: string; icon: IconName }> = {
  done: { words: 'Done', icon: 'circle-check' },
  now: { words: 'Building now', icon: 'loader' },
  next: { words: 'Not yet', icon: 'circle' },
};

const stepsOf = (plan: Plan): PlanStepRow[] => listOf<PlanStepRow>(plan?.steps);

/** The plan's steps, numbered; with states, each one's state in words and the one being built marked. Null when the plan has none. */
export function PlanSteps({ plan, states }: { plan: Plan; states: boolean }) {
  const steps = stepsOf(plan);
  if (!steps.length) return null;
  const version = versionLabel(plan?.version ?? null);
  return (
    <section className="sb-block sb-plan" aria-label="The plan’s steps">
      <h3 className="eyebrow">{version ? `The plan’s steps · Plan ${version}` : 'The plan’s steps'}</h3>
      <ol className="sb-plan-steps" aria-label="The plan’s steps">
        {steps.map((s, i) => {
          const st = states && s.state ? STATE[s.state] : null;
          const now = states && s.state === 'now';
          return (
            <li key={s.id ?? i} className={`sb-plan-step${now ? ' is-now' : ''}`} aria-current={now ? 'step' : undefined}>
              <span className="sb-plan-n num">{i + 1}</span>
              <span className="sb-plan-name">{s.name ?? s.id ?? ''}</span>
              {st && <span className={`sb-plan-state is-${s.state}`}><Icon name={st.icon} size={14} />{st.words}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The Plan step: the plan's steps with no states, under the step's Auto line; with none, a sentence says so. */
export function PlanStep({ slug, job, view }: { slug: string; job: Job; view: StageView | null | undefined }) {
  const plan = view?.plan;
  const version = versionLabel(plan?.version ?? null);
  return (
    <div className="sb-step-body">
      <StepAutoLine slug={slug} job={job} step="plan" approved={version ? `plan ${version}` : null} />
      {stepsOf(plan).length > 0 ? <PlanSteps plan={plan} states={false} /> : (
        <p className="sb-step-note">{plan === undefined ? 'The plan’s steps aren’t known for this job.' : 'No numbered plan steps yet.'}</p>
      )}
    </div>
  );
}

export function BuildStep({ slug, job, view }: { slug: string; job: Job; view: StageView | null | undefined }) {
  const { api } = useWorkshop();
  const hosted = api.hosted?.() ?? false;
  const plan = view?.plan;
  const known = plan !== undefined;
  const hasSteps = stepsOf(plan).length > 0;
  const below = hosted ? '' : ' The commits below show the work.';
  return (
    <div className="sb-step-body">
      <StepAutoLine slug={slug} job={job} step="build" />
      {hasSteps ? <PlanSteps plan={plan} states /> : (
        <p className="sb-step-note">{known ? `No numbered plan steps yet.${below}` : `The plan’s steps aren’t known for this job.${below}`}</p>
      )}
      {hosted ? <p className="sb-step-note">The commits show on your laptop.</p> : <Commits slug={slug} job={job} />}
    </div>
  );
}

interface CommitFile { path?: string; added?: number | null; removed?: number | null; isNew?: boolean }
interface Commit { sha: string; short: string; author: string; date: string; subject: string; step: string | null; files?: CommitFile[] }
interface CommitList { commits: Commit[]; note?: string; head?: string | null }

/** A commit lists this many files at most, then how many more. */
export const FILES_SHOWN = 50;
const moreFiles = (n: number) => `and ${n} more ${n === 1 ? 'file' : 'files'}`;

/** "+22 −4", "+58", "−3"; empty when neither is known (a binary file) or both are 0. */
export function linesWords(f: CommitFile): string {
  const parts: string[] = [];
  if (typeof f.added === 'number' && f.added > 0) parts.push(`+${f.added}`);
  if (typeof f.removed === 'number' && f.removed > 0) parts.push(`−${f.removed}`);
  return parts.join(' ');
}

function Commits({ slug, job }: { slug: string; job: Job }) {
  const { api } = useWorkshop();
  const [load, setLoad] = useState<Load<CommitList>>({ state: 'loading' });
  const [tries, setTries] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const now = useNow().getTime();
  const changedAt = job.updatedAt ?? null;
  useEffect(() => {
    let off = false;
    api.get<CommitList>(`/api/job/${encodeURIComponent(slug)}/commits`).then(
      (value) => { if (!off) setLoad({ state: 'ready', value: { commits: Array.isArray(value?.commits) ? value.commits : [], note: value?.note, head: typeof value?.head === 'string' ? value.head : null } }); },
      (err) => { if (!off) setLoad({ state: 'error', message: message(err) }); },
    );
    return () => { off = true; };
  }, [api, slug, tries, changedAt]);

  if (load.state === 'loading') return <p className="muted" role="status">Reading the job’s commits…</p>;
  if (load.state === 'error') {
    return (
      <div>
        <p className="thread-error" role="alert">Couldn’t read the commits: {load.message}</p>
        <Button onClick={() => setTries((n) => n + 1)} title={`Ask ${BRAND.name} for the commits again.`}>Try again</Button>
      </div>
    );
  }
  const { commits, note, head } = load.value;
  if (!commits.length) return <p className="muted">{note || 'No commits yet. They show up here once building starts.'}</p>;
  const branch = head || job.repo?.branch || null;
  return (
    <section className="sb-block sb-commits" aria-label="Commits">
      <h3 className="eyebrow">{`Commits so far · ${commits.length}${branch ? ` on ${branch}` : ''}`}</h3>
      <ul className="sb-commit-list" aria-label="Commits so far">
        {commits.map((c) => {
          const files = listOf<CommitFile>(c.files);
          const isOpen = open === c.sha;
          return (
            <li key={c.sha} className={`sb-commit${isOpen ? ' is-open' : ''}`}>
              <button type="button" className="sb-commit-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.sha)} title={isOpen ? 'Hide this change.' : 'Show what this commit changed.'}>
                <code className="sb-commit-sha">{c.short}</code>
                <span className="sb-commit-subject">{c.subject}</span>
                <span className="sb-commit-when">{agoWords(c.date, now) ?? ''}</span>
              </button>
              {files.length > 0 && (
                <ul className="sb-commit-files" aria-label={`The files ${c.short} changed`}>
                  {files.slice(0, FILES_SHOWN).map((f, i) => (
                    <li key={`${f.path ?? ''}-${i}`} className="sb-commit-file">
                      <Chip tone={f.isNew ? 'ok' : 'neutral'}>{f.isNew ? 'New' : 'Changed'}</Chip>
                      <code className="sb-commit-path" title={f.path ?? undefined}>{f.path ?? ''}</code>
                      <span className="sb-commit-lines">{linesWords(f)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {files.length > FILES_SHOWN && <p className="sb-commit-more">{moreFiles(files.length - FILES_SHOWN)}</p>}
              {isOpen && <CommitChanges slug={slug} sha={c.sha} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
