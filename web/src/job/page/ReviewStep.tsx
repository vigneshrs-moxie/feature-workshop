// The Review step's body in the open step (design 3.2): each reviewer that ran (job.page.review
// through the step's view) with its model, how many findings and each one Fixed, Not doing or Open;
// a reviewer with none says No findings. Then the review walkthrough, folded, when the job has one.
// A record from an older Starbase (review not known) says nothing about findings; the rest draws.
import type { Job, ReviewRow, StageReviewer, StageView } from '../../api/types';
import { Chip, type ChipTone } from '../../components/Chip';
import type { IconName } from '../../components/Icon';
import { Fold } from '../../components/page/Page';
import { WalkthroughTab } from '../../panes/Preview/WalkthroughTab';
import { StepAutoLine } from './SpecStep';
import './page.css';

const STATUS: Record<NonNullable<ReviewRow['status']>, { words: string; tone: ChipTone; icon: IconName }> = {
  fixed: { words: 'Fixed', tone: 'ok', icon: 'check' },
  'not-doing': { words: 'Not doing', tone: 'outline', icon: 'minus' },
  open: { words: 'Open', tone: 'warn', icon: 'circle-dot' },
};

const findings = (n: number) => `${n} ${n === 1 ? 'finding' : 'findings'}`;
const nameOf = (r: StageReviewer) => r.name || r.lens || 'Other findings';
/** "SR" for Spec reviewer: the first letters of its first two words. */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

export function ReviewStep({ slug, job, view }: { slug: string; job: Job; view: StageView | null | undefined }) {
  const review = view?.review;
  const reviewers = review && Array.isArray(review.reviewers) ? review.reviewers.filter((r) => r && typeof r === 'object') : [];
  return (
    <div className="sb-step-body">
      <StepAutoLine slug={slug} job={job} step="review" />
      {review && (
        <section className="sb-block" aria-label="The reviewers">
          <h3 className="eyebrow">The reviewers and what they found</h3>
          {reviewers.length === 0 ? <p className="sb-step-note">No findings.</p> : (
            <ul className="sb-reviewers" aria-label="The reviewers and what they found">
              {reviewers.map((r, i) => <Reviewer key={`${r.lens ?? 'other'}-${i}`} reviewer={r} />)}
            </ul>
          )}
        </section>
      )}
      {job.walkthrough && (
        <Fold icon="eye" name="Review walkthrough" note="every change, by zoom level">
          <WalkthroughTab slug={slug} job={job} active />
        </Fold>
      )}
    </div>
  );
}

function Reviewer({ reviewer }: { reviewer: StageReviewer }) {
  const rows = Array.isArray(reviewer.rows) ? reviewer.rows.filter((r) => r && typeof r === 'object') : [];
  const name = nameOf(reviewer);
  return (
    <li className="sb-reviewer">
      <div className="sb-reviewer-head">
        <span className="sb-reviewer-face" aria-hidden="true">{initials(name)}</span>
        <b className="sb-reviewer-name">{name}</b>
        {reviewer.model && <Chip>{reviewer.model}</Chip>}
        <span className="sb-reviewer-count">{findings(rows.length)}</span>
      </div>
      {rows.length === 0 ? <p className="sb-step-note">No findings.</p> : (
        <ul className="sb-findings">
          {rows.map((f, i) => {
            const st = f.status ? STATUS[f.status] : null;
            return (
              <li key={i} className="sb-finding">
                {st && <Chip tone={st.tone} icon={st.icon} className="sb-finding-status">{st.words}</Chip>}
                <span className="sb-finding-text">{f.text ?? ''}</span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
