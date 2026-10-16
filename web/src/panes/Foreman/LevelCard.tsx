// The LevelCard (decision D5): a card at the foot of the conversation when the Foreman's suggested
// level differs from the job's chosen one, or the job has no level yet. It shows both sources side
// by side (the rules: description and, once there's a branch, its changed files; the Foreman: its
// first brief), the chosen level, and "Use L3" / "Keep L2". Use changes the level from the next
// stage (POST /api/job/:slug/options) and says what that adds or drops; Keep hides the card for
// this same suggestion only (remembered per job in this browser), so a new suggestion shows again.
import type { Job, JobDetail, LevelNumber } from '../../api/types';
import { HowThisWorks } from '../../components/HowThisWorks';
import { InlineText } from '../../components/InlineText';
import { isLevel, levelCardKey, levelCardView, levelChange, levelLabel, lensNames } from '../../lib/levels';
import { useStored } from '../../lib/stored';
import { useWorkshopState } from '../../state/store';
import { useSetLevel } from './useSetLevel';

/** The job's level facts: the live job row first, the job's detail where the row has none. */
export function levelFacts(job: Job, detail: JobDetail | null | undefined) {
  const pick = <T,>(a: T | undefined, b: T | undefined) => (a !== undefined ? a : b);
  return {
    level: pick(job.level, detail?.level) ?? null,
    suggestedLevel: pick(job.suggestedLevel, detail?.suggestedLevel) ?? null,
    levelReason: pick(job.levelReason, detail?.levelReason) ?? null,
    // The detail's reads the branch's changed files too, once there is one.
    rulesLevel: detail?.rulesLevel ?? job.rulesLevel ?? null,
    closed: job.closed ?? null,
  };
}

export function LevelCard({ job, detail }: { job: Job; detail: JobDetail | null }) {
  const { meta } = useWorkshopState();
  const levels = meta?.levels;
  const names = lensNames(meta);
  const facts = levelFacts(job, detail);
  const [dismissed, setDismissed] = useStored(levelCardKey(job.slug));
  const view = levelCardView(facts, dismissed);
  const chosen = isLevel(facts.level) ? facts.level : null;
  // The stage the job is at: what moving adds or drops leaves out the stages already finished.
  const stage = job.stage ?? detail?.gate?.stage ?? null;
  const choice = useSetLevel(job.slug, chosen, stage);

  if (!view.show && !choice.done) return null;

  const label = (n: LevelNumber) => levelLabel(n, levels);
  const rules = facts.rulesLevel;
  const foreman = isLevel(facts.suggestedLevel) ? facts.suggestedLevel : null;
  const target = view.target;
  // With no level yet and the rules saying something else than the Foreman, both are offered.
  const other = chosen === null && rules && isLevel(rules.level) && rules.level !== target ? rules.level : null;
  const consequence = (to: LevelNumber) => levelChange(chosen, to, levels, names, stage).text;
  const headId = `level-card-${job.slug}`;

  return (
    // A question card (data-ask="question") to the themes: the level is yours to choose.
    <section className="perm-card question-card level-card" data-ask="question" aria-labelledby={headId}>
      <h3 className="perm-headline level-card-head" id={headId}>
        {choice.done ? 'Level changed' : chosen === null ? 'Pick a level for this job' : `The Foreman suggests ${label(target as LevelNumber)}`}
      </h3>
      {!choice.done && (
        <>
          <dl className="level-sources">
            <div className="level-source" title={rules?.fromDiff ? `The rules read the description and the ${rules.changedFiles ?? 0} files this branch changes. No AI involved.` : 'The rules read the job’s description for risky areas and for how big the change sounds. No AI involved.'}>
              <dt className="muted">Rules{rules?.fromDiff ? ' (description and changed files)' : ''}</dt>
              <dd>{rules && isLevel(rules.level) ? <><strong>L{rules.level}</strong> · {rules.reasons.join(' ')}</> : 'No suggestion yet.'}</dd>
            </div>
            <div className="level-source" title="The Foreman proposes a level in its first brief, with a one-line reason.">
              <dt className="muted">Foreman</dt>
              <dd>{foreman !== null ? <><strong>L{foreman}</strong> · {facts.levelReason ? <InlineText text={facts.levelReason} /> : 'No reason given.'}</> : 'It suggests one with its first brief.'}</dd>
            </div>
          </dl>
          <p className="level-chosen muted" title="The level the job runs at now. It changes only when you pick one.">
            Chosen: {chosen === null ? 'none yet' : label(chosen)}
          </p>
        </>
      )}
      {choice.done ? (
        <>
          <p className="level-done" role="status">{choice.done}</p>
          <div className="perm-actions">
            <button type="button" className="btn btn-quiet" onClick={choice.clear} title="Close this note. The level stays as you set it; change it any time with the level chip in the job header.">Got it</button>
          </div>
        </>
      ) : (
        <>
          <div className="perm-actions">
            {target !== null && (
              <button type="button" className="btn btn-primary" disabled={choice.busy} onClick={() => void choice.set(target)} title={`Run this job at ${label(target)} from the next stage. ${consequence(target)}.`}>
                Use L{target}
              </button>
            )}
            {other !== null && (
              <button type="button" className="btn" disabled={choice.busy} onClick={() => void choice.set(other)} title={`Run this job at ${label(other)}, as the rules suggest, from the next stage. ${consequence(other)}.`}>
                Use L{other}
              </button>
            )}
            {chosen !== null ? (
              <button type="button" className="btn btn-quiet" disabled={choice.busy} onClick={() => setDismissed(view.signature)} title={`Keep ${label(chosen)} and hide this card. It shows again only if the Foreman suggests a different level.`}>
                Keep L{chosen}
              </button>
            ) : (
              <button type="button" className="btn btn-quiet" disabled={choice.busy} onClick={() => setDismissed(view.signature)} title="Hide this card without picking a level. The Foreman uses its own judgement until you pick one with the level chip in the job header.">
                Not now
              </button>
            )}
          </div>
          {target !== null && <p className="level-consequence muted">If you use L{target}: {consequence(target)}.</p>}
        </>
      )}
      {choice.error && <p className="field-problem" role="alert">{choice.error}</p>}
      <HowThisWorks id="level-card" defaultOpen={false}>
        <p>A <strong>level</strong> sets how much process a job gets, from L0 Tweak (one build and the checks) to L3 Large (the full workflow, every reviewer and Fable second looks). Two sources suggest one: the <strong>rules</strong>, which scan the description and later the branch’s changed files for risky areas such as sign-in, data scoping and migrations, and the <strong>Foreman</strong>, in its first brief.</p>
        <p><strong>Use</strong> changes the level from the next stage: the line under the buttons says which stages and reviewers that adds or drops. It never removes an approval the Foreman still owes you. <strong>Keep</strong> hides this card until the Foreman suggests a different level. You can change the level any time with the level chip in the job header.</p>
      </HowThisWorks>
    </section>
  );
}
