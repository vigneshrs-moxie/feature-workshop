// A review round's card on the Desk (packet Q): short, like every Desk card, and it takes the yes.
// "Raj asked for changes on PR #2 · 4 comments, 1 question", the line under it, what is in the
// round one line each (its kind as a word and an icon, the reviewer's words, file:line), or, when
// the round is ready, the steps Send back will run. Then Open the round (o: the job's Ship stop,
// where items can be left out and a note added), No go (r) and Go (a). Play off says "Waiting for
// you" with the plain words; Play full and subtle say Go / No go. The answer goes through the
// card itself (POST /api/permissions/:id), so the dashboard takes the card away as it acts.
// The first round ever shows the three-card guide over the Desk.
import { useState } from 'react';
import type { Permission, ReviewCardFields, ReviewItemView } from '../../api/types';
import { jobHref } from '../../app/router';
import { Icon } from '../../components/Icon';
import { InlineText } from '../../components/InlineText';
import { Kbd } from '../../components/Kbd';
import { guideFirstVisit, guideSeen, markGuideSeen, useNarrow } from '../../components/page/Page';
import { useAnswer } from '../../components/permissions/useAnswer';
import { ReviewGuide, whereOf } from './ReviewPanel';
import { useReview } from './useReview';
import { KIND_ICON, REVIEW_GUIDE } from './words';
import './review.css';

/** How many items the card shows at phone width before "n more ▸". */
const PHONE_ITEMS = 3;

export function ReviewDeskCard({ permission: p, call }: { permission: Permission; call: boolean }) {
  const { view } = useReview(p.slug);
  const { busy, error, send } = useAnswer(p);
  const narrow = useNarrow();
  const [more, setMore] = useState(false);
  const [guide, setGuide] = useState(() => guideFirstVisit() && !guideSeen(REVIEW_GUIDE.id));
  const fields = p as Permission & Partial<ReviewCardFields>;
  const [go, noGo] = fields.actions ?? [];
  const question = p.input?.questions?.[0]?.question ?? '';
  const answer = (label: string) => void send({ decision: 'allow', answers: { [question]: label } });
  const desk = view?.desk ?? null;
  const playOf = (id: string | undefined, fallback: string) => (call ? desk?.actions.find((a) => a.id === id)?.playLabel ?? fallback : fallback);
  const headline = desk?.headline ?? p.plain?.headline ?? 'A review round waits for you';
  const detail = [view?.bar?.detail ?? p.plain?.detail ?? null, desk?.sentence ?? null].filter(Boolean).join(' ');
  const state = view?.heldState ?? view?.state ?? fields.review?.state ?? null;
  const round = view?.round ?? null;
  const items: ReviewItemView[] = round
    ? (state === 'new-comment' ? round.pending : round.groups.flatMap((g) => g.items)).filter((i) => i.included || state === 'new-comment')
    : [];
  const steps = state === 'ready' || state === 'stopped' ? view?.send?.steps ?? [] : [];
  const shown = narrow && !more ? items.slice(0, PHONE_ITEMS) : items;
  const off = fields.disabled ?? null;
  const closeGuide = () => { markGuideSeen(REVIEW_GUIDE.id); setGuide(false); };
  return (
    <article className="review-desk" aria-label={headline}>
      <p className="review-desk-top">
        <span className="next-label">{call ? 'Go / no go' : 'Waiting for you'}</span>
        <span className="spacer" />
        {view?.pr.url && <a href={view.pr.url} target="_blank" rel="noopener noreferrer" title="Open the pull request on GitHub, in a new tab."><Icon name="external" size={14} /> {view.pr.label} on GitHub</a>}
      </p>
      <h3 className="desk-head">{headline}</h3>
      {detail && <p className="desk-sub">{detail}</p>}
      {shown.length > 0 && (
        <ul className="review-desk-items" aria-label="What is in the round">
          {shown.map((i) => (
            <li key={i.id}>
              <span className={`chip review-kind is-${i.kind}`}><Icon name={KIND_ICON[i.kind]} size={14} /> {i.kindWords}</span>
              <span className="review-desk-quote"><InlineText text={i.type === 'check' ? i.quote ?? `${i.name ?? 'A check'} failed` : i.quote ?? ''} /></span>
              <span className="num muted review-desk-where">{whereOf(i)}</span>
            </li>
          ))}
          {narrow && !more && items.length > PHONE_ITEMS && (
            <li><button type="button" className="link-button" onClick={() => setMore(true)}>{items.length - PHONE_ITEMS} more</button></li>
          )}
        </ul>
      )}
      {steps.length > 0 && (
        <ol className="review-desk-steps" aria-label="What the one go will do, in order">
          {steps.map((s) => <li key={s.id}><span className="num">{s.number}</span> {s.words}</li>)}
        </ol>
      )}
      <p className="muted review-desk-note">
        {steps.length ? 'The replies are read and edited on the job’s Ship stop: Open the round (o).' : 'To leave one out or add a note, Open the round (o): it opens on the job’s Ship stop.'}
      </p>
      {error && <p className="field-problem" role="alert">{error}</p>}
      <div className={`desk-calls review-desk-calls${call ? ' is-call' : ''}`}>
        <a className="btn btn-lg" href={jobHref(p.slug)} data-review-open title="The round on the job’s Ship stop: leave items out, change a kind, add a note, read the replies (key: o).">
          Open the round <Kbd id="desk-open" />
        </a>
        {noGo && (
          <button type="button" className="btn btn-lg" data-review-nogo disabled={busy} onClick={() => answer(noGo.label)} title={`${noGo.label}: nothing is sent to the Foreman or to GitHub; the round stays on the job (key: r).`}>
            {playOf(noGo.id, noGo.label)} <Kbd id="desk-send-back" />
          </button>
        )}
        {go && (
          <button type="button" className="btn btn-primary btn-lg" data-review-go disabled={busy || Boolean(off)} onClick={() => answer(go.label)} title={off ?? `${go.label} (key: a).`}>
            {playOf(go.id, go.label)} <Kbd id="desk-approve" />
          </button>
        )}
      </div>
      {off && <p className="muted review-reason"><Icon name="lock" size={14} /> {off}</p>}
      {guide && <ReviewGuide onClose={closeGuide} />}
    </article>
  );
}
