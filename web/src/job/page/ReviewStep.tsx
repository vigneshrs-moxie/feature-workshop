// The Review step's body in the open step (design 3.2): each reviewer that ran (job.page.review
// through the step's view) with its model, how many findings and each one Fixed, Not doing or Open;
// a reviewer with none says No findings. Then the review walkthrough, folded, when the job has one.
// A record from an older laptop (review not known) says nothing about findings; the rest draws.
// On the website the walkthrough is not served (it lives on the laptop): the fold says so in one
// sentence and links the published page when there is one. Never an alert.
import type { Job, ReviewRow, StageReviewer, StageView } from '../../api/types';
import { Button } from '../../components/Button';
import { Chip, type ChipTone } from '../../components/Chip';
import type { IconName } from '../../components/Icon';
import { Fold } from '../../components/page/Page';
import { listOf } from '../../lib/lists';
import { WalkthroughTab } from '../../panes/Preview/WalkthroughTab';
import { useWorkshop } from '../../state/store';
import { isWebUrl } from './ShipStep';
import { StepAutoLine } from './stepAuto';
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
  const { api } = useWorkshop();
  const hosted = Boolean(api.hosted?.());
  const review = view?.review;
  const reviewers = listOf<StageReviewer>(review?.reviewers);
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
          {hosted ? <OnTheLaptop url={job.walkthrough.url} /> : <WalkthroughTab slug={slug} job={job} active />}
        </Fold>
      )}
    </div>
  );
}

/** The website's walkthrough fold: where it opens, and its published page when it has one. */
function OnTheLaptop({ url }: { url: string | null | undefined }) {
  const published = isWebUrl(url) ? url.trim() : null;
  return (
    <div className="sb-block">
      <p className="sb-step-note">The review walkthrough opens on your laptop.</p>
      {published && (
        <div>
          <Button kind="quiet" href={published} target="_blank" rel="noopener noreferrer" title="Open the published walkthrough, where verdicts and notes are saved and shared, in a new tab.">
            Open the published page
          </Button>
        </div>
      )}
    </div>
  );
}

function Reviewer({ reviewer }: { reviewer: StageReviewer }) {
  const rows = listOf<ReviewRow>(reviewer.rows);
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
