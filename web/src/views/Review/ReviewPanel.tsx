// The review panel on a job's Ship stop (packet Q): the round's whole life in one place, under the
// next-step bar (ReviewBar), on the Job page's Ship tab and on the Ship Stage.
//   Changes asked for · the Foreman fixes it: the round, grouped by file in GitHub's order, the
//     checks on the same commit last. Each item: a tick (untick to leave it out), its kind (the
//     Foreman's first guess, a menu to change it), the reviewer's words, file:line, who and when,
//     On GitHub ↗, the Foreman's plan for it, and its state in words on the right. A note for the
//     Foreman. Comments that joined while the Foreman works wait under "New while it works".
//   Ready to send back · sending · stopped: exactly what the one button does, in order, each step
//     with the exact command under it and its state in words; the drafted replies in step 3, each
//     with Edit and Drop; the follow-up PR #1's "I'll merge PR #1 myself". The round folds below.
//   Waiting · after: the round from start to end, each step with its time.
//   Approved: what is in place (approved, checks, conflicts) and who merges it, from the route.
// Everything is words from the dashboard (GET /api/review/:slug); every change is a POST that
// answers with the job's view. Nothing here writes to GitHub: only Send back's go, Merge's ask and
// the reminder do, through the bar.
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ReviewItemKind, ReviewItemView, ReviewRoundPanel, ReviewSendStep, ReviewView } from '../../api/types';
import { Button } from '../../components/Button';
import { Icon, type IconName } from '../../components/Icon';
import { More } from '../../components/More';
import { InlineText } from '../../components/InlineText';
import { Fold, GuideCards, guideFirstVisit, guideSeen, markGuideSeen } from '../../components/page/Page';
import { useWorkshop } from '../../state/store';
import { GithubLine } from './GithubLine';
import { bodyFor, panelId } from './ReviewBar';
import { useReview } from './useReview';
import { EDITABLE, ITEM_ICON, KIND_HINT, KIND_ICON, KIND_WORDS, REVIEW_GUIDE, ROUND_FIRST, STEP_ICON } from './words';
import './review.css';
import { Choice } from '../../components/Choice';
import { Select } from '../../components/Select';

type Act = (action: string, body?: Record<string, unknown>) => Promise<boolean>;

/** "11:48", in your own clock. */
export function clockOf(iso: string | null | undefined): string | null {
  const t = iso ? new Date(iso) : null;
  return t && Number.isFinite(t.getTime()) ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : null;
}

const base = (file: string) => file.split('/').pop() ?? file;
/** "FeedbackForm.tsx:42", "the lint check", "the whole pull request". */
export function whereOf(i: ReviewItemView): string {
  if (i.file) return `${base(i.file)}${i.line ? `:${i.line}` : ''}`;
  if (i.type === 'check') return `the ${i.name ?? 'failed'} check`;
  if (i.type === 'sync') return 'bringing in the base';
  return 'the whole pull request';
}

const PLAN_WORDS = { fix: 'Fix', answer: 'Answer', wont_change: 'Won’t change' } as const;
const DONE = new Set(['fixed', 'answered', 'wont_change']);
const allItems = (r: ReviewRoundPanel) => r.groups.flatMap((g) => g.items);

export function ReviewPanel({ slug, line = false }: { slug: string; line?: boolean }) {
  const { view, act, reload } = useReview(slug);
  const [guide, setGuide] = useState(false);
  // The first round ever: the three pictures open by themselves, once.
  const first = view?.state === 'asked';
  useEffect(() => { if (first && guideFirstVisit() && !guideSeen(REVIEW_GUIDE.id)) setGuide(true); }, [first]);
  if (!view) return null;
  const state = view.heldState ?? view.state;
  const live = view.state !== 'held';
  const round = view.round;
  return (
    <section className="review-panel" id={panelId(slug)} tabIndex={-1} aria-label={round ? round.title : `${view.pr.label} in review`}>
      {line && <GithubLine className="review-gh" />}
      <ReviewStatus view={view} act={act} />
      <ReviewProblems view={view} />
      {round && state && ROUND_FIRST.has(state) && <RoundBlock round={round} view={view} act={act} editable={live && EDITABLE.has(state)} />}
      {view.send && <SendBlock view={view} act={act} reload={reload} />}
      {view.merge && <MergeBlock view={view} />}
      {round && state && !ROUND_FIRST.has(state) && !view.send && !view.merge && round.timeline.length > 0 && <Timeline round={round} />}
      {round && state && !ROUND_FIRST.has(state) && (
        <Fold icon="message" name={round.title} note={foldNote(view)} id={`review-round-${slug}`}>
          <RoundBlock round={round} view={view} act={act} editable={false} folded />
        </Fold>
      )}
      <p className="review-how">
        <Button kind="quiet" size="sm" icon="help" onClick={() => setGuide(true)} title="Three pictures: what a round is, the one yes, the one go.">How review rounds work</Button>
      </p>
      {guide && <ReviewGuide onClose={() => { markGuideSeen(REVIEW_GUIDE.id); setGuide(false); }} />}
    </section>
  );
}

// ---------- The status line, and what went wrong ----------

const isComment = (i: ReviewItemView) => i.type !== 'check' && i.type !== 'sync';

/** "Round 2 · 3 comments to answer · checks passing", each part an icon and words, and the one next action. */
export function ReviewStatus({ view, act }: { view: ReviewView; act?: Act }) {
  const [busy, setBusy] = useState(false);
  const r = view.round;
  const pr = view.pr;
  const parts: { icon: IconName; words: string; tone?: 'ok' | 'warn' | 'error' }[] = [];
  if (r) parts.push({ icon: 'message', words: `Round ${r.round}` });
  if (r) {
    const comments = allItems(r).filter((i) => i.included && isComment(i));
    const open = comments.filter((i) => !DONE.has(i.state)).length;
    if (open) parts.push({ icon: 'message', words: `${open} ${open === 1 ? 'comment' : 'comments'} to answer`, tone: 'warn' });
    else if (comments.length) parts.push({ icon: 'circle-check', words: 'every comment answered', tone: 'ok' });
  }
  if (pr.review === 'approved') parts.push({ icon: 'circle-check', words: 'approved', tone: 'ok' });
  if (pr.checks === 'passing') parts.push({ icon: 'circle-check', words: 'checks passing', tone: 'ok' });
  else if (pr.checks === 'failing') parts.push({ icon: 'x', words: 'checks failing', tone: 'error' });
  else if (pr.checks === 'pending') parts.push({ icon: 'clock', words: 'checks running' });
  if (pr.mergeable === 'CONFLICTING') parts.push({ icon: 'alert', words: `conflicts with ${pr.base ?? 'its base'}`, tone: 'error' });
  if (!parts.length) return null;
  // The one next action: the bar's yes when it is a plain one (Merge asks first, so it stays in the bar).
  const go = act && view.state !== 'held' ? view.bar?.actions.find((a) => a.go === true && a.enabled && !a.confirm && !a.client && a.id !== 'ask-review' && a.id !== 'remind') : undefined;
  return (
    <div className="review-status">
      <p className="review-status-line">
        {parts.map((p, n) => (
          <span key={p.words} className={`review-status-part${p.tone ? ` is-${p.tone}` : ''}`}>
            {n > 0 && <span className="review-status-sep" aria-hidden="true">·</span>}
            <Icon name={p.icon} size={14} />
            {p.words}
          </span>
        ))}
      </p>
      {go && (
        <Button size="sm" busy={busy} onClick={async () => { setBusy(true); try { await act!(go.id, bodyFor(go, view)); } finally { setBusy(false); } }} title={`${go.label}: the same as the next-step bar’s yes.`}>
          {go.label}
        </Button>
      )}
    </div>
  );
}

/** Each thing that went wrong, in its own space with what happened and where to see it. */
function ReviewProblems({ view }: { view: ReviewView }) {
  const r = view.round;
  const pr = view.pr;
  const state = view.heldState ?? view.state;
  const failed = r ? allItems(r).filter((i) => i.type === 'check' && i.included && !DONE.has(i.state)) : [];
  const checksFail = (pr.checks === 'failing' || state === 'check-failed') && failed.length > 0;
  const conflicts = pr.mergeable === 'CONFLICTING';
  const prev = view.rounds.length > 1 ? view.rounds[view.rounds.length - 2] : null;
  const newRound = Boolean(r && prev && (state === 'asked' || state === 'left'));
  if (!checksFail && !conflicts && !newRound) return null;
  const first = failed.find((i) => i.log)?.log?.split('\n').find((l) => l.trim()) ?? null;
  const asked = r ? allItems(r).filter((i) => i.included && isComment(i)).length : 0;
  return (
    <div className="review-problems">
      {newRound && r && prev && (
        <div className="review-problem is-round" role="group" aria-label={`New round: round ${r.round}`}>
          <Icon name="refresh" size={16} className="review-problem-icon" />
          <div className="review-problem-words">
            <b>New round: {asked} {asked === 1 ? 'change' : 'changes'} requested</b>
            <span className="muted">Round {prev.round} went back{prev.sentAt ? ` at ${clockOf(prev.sentAt)}` : ''}; {view.who.reviewer ?? 'the reviewer'} asked again.</span>
          </div>
          {pr.url && <Button kind="quiet" size="sm" icon="external" href={pr.url} target="_blank" rel="noopener noreferrer" title="Open the pull request on GitHub, in a new tab.">Open {pr.label}</Button>}
        </div>
      )}
      {checksFail && (
        <div className="review-problem is-fail" role="group" aria-label="Checks failing">
          <Icon name="x" size={16} className="review-problem-icon" />
          <div className="review-problem-words">
            <b>{failed.map((i) => i.name ?? 'A check').join(', ')} failed</b>
            {first && <code className="review-problem-first">{first}</code>}
          </div>
          {(failed[0].link ?? pr.url) && <Button kind="quiet" size="sm" icon="external" href={(failed[0].link ?? pr.url)!} target="_blank" rel="noopener noreferrer" title="Open the check and its whole log on GitHub, in a new tab.">The whole log</Button>}
        </div>
      )}
      {conflicts && (
        <div className="review-problem is-fail" role="group" aria-label="Conflicts">
          <Icon name="alert" size={16} className="review-problem-icon" />
          <div className="review-problem-words">
            <b>Conflicts with {pr.base ?? 'its base'}</b>
            <span className="muted">{pr.base ?? 'The base'} changed under {pr.label}. Nothing merges until it is brought in.</span>
          </div>
          {pr.url && <Button kind="quiet" size="sm" icon="external" href={pr.url} target="_blank" rel="noopener noreferrer" title="See the conflicting files on GitHub, in a new tab.">Open {pr.label}</Button>}
        </div>
      )}
    </div>
  );
}

function foldNote(view: ReviewView): string {
  const r = view.round!;
  const sent = view.rounds.find((x) => x.round === r.round)?.sentAt ?? null;
  const done = allItems(r).filter((i) => i.included && DONE.has(i.state));
  const parts = [`${r.counts.items} ${r.counts.items === 1 ? 'item' : 'items'}`];
  if (sent) parts.push(`sent back ${clockOf(sent)}`);
  else if (done.length) parts.push(`${done.length} of ${r.counts.included} done`);
  return parts.join(' · ');
}

// ---------- The round ----------

function RoundBlock({ round, view, act, editable, folded = false }: { round: ReviewRoundPanel; view: ReviewView; act: Act; editable: boolean; folded?: boolean }) {
  const state = view.heldState ?? view.state;
  const bar = view.bar;
  let line: ReactNode = round.from;
  if (editable) line = <>{round.from} · <b>{round.includedWords}</b> · {round.kindsWords}</>;
  else if (!folded && (state === 'fixing' || state === 'fix-stalled' || state === 'new-comment')) {
    line = bar?.phase === 'plan' || !bar?.progress
      ? <><b>{round.counts.done} of {round.counts.included} done</b> · The Foreman says what it will do with each item before changing anything.</>
      : <><b>{bar.progress}</b>{bar.replies ? ` · ${bar.replies}` : ''}{bar.next ? ` · Next: ${bar.next}` : ''}</>;
  }
  return (
    <div className={`review-round${folded ? ' is-folded' : ''}`}>
      {!folded && (
        <header className="review-round-head">
          <Icon name="message" size={20} />
          <h3>{round.title}</h3>
        </header>
      )}
      <p className="review-from muted">{line}</p>
      {folded ? round.groups.map((g) => (
        <section key={g.heading} className="review-group" aria-label={g.heading}>
          <h4 className="review-group-head"><Icon name={g.file ? 'file' : g.heading.startsWith('Checks') ? 'x' : 'message'} size={14} /> <span className={g.file ? 'num' : ''}>{g.heading}</span> <span className="muted">· {countOf(g.items)}</span></h4>
          <ul className="review-items">
            {g.items.map((i) => <ItemRow key={i.id} item={i} act={act} editable={editable} who={round.reviewer} />)}
          </ul>
        </section>
      )) : (
        <>
          {round.groups.map((g) => {
            const open = g.items.filter((i) => !DONE.has(i.state));
            if (!open.length) return null;
            return (
              <More
                key={g.heading}
                screen="review"
                id={`file:${g.heading}`}
                label={g.heading}
                note={countOf(open)}
                icon={g.file ? 'file' : g.heading.startsWith('Checks') ? 'x' : 'message'}
                simpleOpen={editable}
                className={`review-group${g.file ? ' is-file' : ''}`}
              >
                <ul className="review-items">
                  {open.map((i) => <ItemRow key={i.id} item={i} act={act} editable={editable} who={round.reviewer} />)}
                </ul>
              </More>
            );
          })}
          {(() => {
            const answered = round.groups.flatMap((g) => g.items.filter((i) => DONE.has(i.state)));
            if (!answered.length) return null;
            return (
              <More screen="review" id="answered" label="Answered" count={answered.length} note="fixed, answered or kept as is" icon="circle-check" className="review-group is-answered">
                <ul className="review-items">
                  {answered.map((i) => <ItemRow key={i.id} item={i} act={act} editable={editable} who={round.reviewer} />)}
                </ul>
              </More>
            );
          })()}
        </>
      )}
      {round.pending.length > 0 && (
        <section className="review-group is-new" aria-label="New while the Foreman works">
          <h4 className="review-group-head"><Icon name="plus" size={14} /> New while the Foreman works <span className="muted">· {round.pending.length}</span></h4>
          <ul className="review-items">{round.pending.map((i) => <ItemRow key={i.id} item={i} act={act} editable={false} who={round.reviewer} />)}</ul>
        </section>
      )}
      {editable && <NoteBox note={round.note} act={act} />}
      {!editable && round.note && <p className="review-note-read"><Icon name="pencil" size={14} /> Your note for the Foreman: {round.note}</p>}
      {!folded && <p className="review-footer muted"><Icon name="alert" size={14} /> {round.footer}</p>}
    </div>
  );
}

function countOf(items: ReviewItemView[]): string {
  const checks = items.filter((i) => i.type === 'check').length;
  if (checks === items.length) return `${checks} failed ${checks === 1 ? 'check' : 'checks'}`;
  return `${items.length} ${items.length === 1 ? 'comment' : 'comments'}`;
}

function ItemRow({ item: i, act, editable, who }: { item: ReviewItemView; act: Act; editable: boolean; who: ReviewRoundPanel['reviewer'] }) {
  const [busy, setBusy] = useState(false);
  const doIt = async (action: string, body: Record<string, unknown>) => { setBusy(true); try { await act(action, body); } finally { setBusy(false); } };
  const quote = i.type === 'check' ? (i.quote ?? `${i.name ?? 'A check'} failed`) : i.quote ?? '(no words)';
  const done = DONE.has(i.state);
  const time = clockOf(i.at);
  return (
    <li className={`review-item is-${i.state}${i.included ? '' : ' is-out'}${i.newWords ? ' is-late' : ''}`}>
      {editable && (
        <Choice
          type="checkbox"
          className="review-tick"
          checked={i.included}
          disabled={busy}
          onChange={(e) => void doIt('item', { id: i.id, included: e.currentTarget.checked })}
          aria-label={`${i.included ? 'Included' : 'Left out'}: ${quote}`}
          title={i.included ? 'Untick to leave this one out: no fix, no reply, not resolved. You can tick it again until Send back.' : 'Tick to put it back in the round.'}
        />
      )}
      <KindChip item={i} editable={editable && i.type !== 'check' && !busy} onPick={(kind) => void doIt('item', { id: i.id, kind })} />
      <div className="review-item-body">
        <p className="review-quote"><InlineText text={quote} /></p>
        <p className="review-meta">
          <span className="num">{whereOf(i)}</span>
          {i.outdated && <span className="chip review-outdated" title={i.outdatedWords ?? undefined}><Icon name="clock" size={12} /> Outdated</span>}
          {i.author && <span> · {who.login && i.author.toLowerCase() === who.login.toLowerCase() ? who.name : i.author}</span>}
          {time && <span> · {time}</span>}
          {i.link && <> · <a href={i.link} target="_blank" rel="noopener noreferrer" title="Open it on GitHub, in a new tab.">On GitHub ↗</a></>}
          {i.newWords && <span className="chip review-new"><Icon name="plus" size={12} /> {i.newWords}</span>}
        </p>
        {i.log && <pre className="review-log">{i.log}</pre>}
        {i.plan && i.planText && i.included && (
          <p className="review-plan"><span className="next-label">{done ? 'Done' : 'Plan'}</span> {PLAN_WORDS[i.plan]}: <InlineText text={i.planText} /></p>
        )}
        {i.state === 'wont_change' && i.reason && <p className="review-plan"><span className="next-label">Why</span> <InlineText text={i.reason} /> <span className="muted">It is never resolved by us: the reviewer decides.</span></p>}
        {i.changeAfterAll && (
          <Button kind="quiet" size="sm" disabled={busy} onClick={() => void doIt('change-after-all', { id: i.id })} title="Turn this into a fix after all: the Foreman fixes it and the reply says so.">
            {i.changeAfterAll.label}
          </Button>
        )}
      </div>
      <span className={`chip review-state is-${i.state}`}><Icon name={ITEM_ICON[i.state]} size={14} /> {i.stateWords}</span>
    </li>
  );
}

function KindChip({ item: i, editable, onPick }: { item: ReviewItemView; editable: boolean; onPick(kind: ReviewItemKind): void }) {
  const by = i.kindBy === 'you' ? 'you set it' : i.kindBy === 'foreman' ? 'the Foreman’s call' : 'the Foreman’s first guess';
  if (!editable) {
    return <span className={`chip review-kind is-${i.kind}`} title={`${KIND_HINT[i.kind]} (${by})`}><Icon name={KIND_ICON[i.kind]} size={14} /> {i.kindWords || KIND_WORDS[i.kind]}</span>;
  }
  return (
    <label className={`chip review-kind is-${i.kind} is-menu`} title={`${KIND_HINT[i.kind]} It is ${by}: pick another to change it.`}>
      <Icon name={KIND_ICON[i.kind]} size={14} />
      <Select value={i.kind} onChange={(k) => onPick(k as ReviewItemKind)} aria-label={`Kind of “${i.quote ?? i.name ?? 'this item'}”: ${KIND_WORDS[i.kind]}, ${by}`} options={(['change', 'question', 'nit'] as const).map((k) => ({ value: k, label: KIND_WORDS[k] }))} />
    </label>
  );
}

function NoteBox({ note, act }: { note: string | null; act: Act }) {
  const [text, setText] = useState(note ?? '');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  useEffect(() => { setText(note ?? ''); }, [note]);
  const save = async () => {
    if ((note ?? '') === text.trim()) return;
    setSaved('saving');
    const ok = await act('note', { note: text.trim() });
    setSaved(ok ? 'saved' : 'idle');
  };
  return (
    <label className="review-note">
      <span className="sr-only">A note for the Foreman</span>
      <Icon name="pencil" size={14} />
      <textarea
        className="text-input"
        rows={2}
        value={text}
        onChange={(e) => { setText(e.target.value); setSaved('idle'); }}
        onBlur={() => void save()}
        placeholder="A note for the Foreman (optional): what to keep in mind, how to word the replies…"
        aria-label="A note for the Foreman (optional)"
      />
      {saved !== 'idle' && <span className="muted" role="status">{saved === 'saving' ? 'Saving…' : 'Saved: it goes with the round.'}</span>}
    </label>
  );
}

// ---------- Send back ----------

function SendBlock({ view, act, reload }: { view: ReviewView; act: Act; reload(): Promise<void> }) {
  const send = view.send!;
  const round = view.round;
  const state = view.heldState ?? view.state;
  const ready = state === 'ready' && view.state !== 'held';
  const who = round?.reviewer.name ?? 'the reviewer';
  const heading = state === 'ready' ? `What Send back to ${who} will do, in this order`
    : state === 'after-pr1' ? `Round ${round?.round ?? 1}: the rest runs once PR #1 is merged`
      : `Sending round ${round?.round ?? 1} back`;
  const replies = round ? allItems(round).filter((i) => i.included && i.reply !== null && i.type !== 'check' && i.type !== 'sync') : [];
  return (
    <section className="review-send" aria-label={heading}>
      <h3 className="next-label review-send-head">{heading}</h3>
      <ol className="review-steps">
        {send.steps.map((s) => (
          <li key={s.id} className={`review-step-row is-${s.state}`}>
            <span className="review-step-n" aria-hidden="true">{s.state === 'done' || s.state === 'stopped' ? <Icon name={STEP_ICON[s.state]} size={16} /> : s.number}</span>
            <div className="review-step-body">
              <b className="review-step-words">{s.words}</b>
              <code className="review-step-detail">{s.detail}</code>
              {s.id === 'follow-up' && <FollowUpChoice step={s} ready={ready} reload={reload} />}
              {s.waiting && <p className="muted"><Icon name="hourglass" size={14} /> {s.waiting}</p>}
              {s.id === 'replies' && <Replies items={replies} act={act} ready={ready} />}
              {s.state === 'stopped' && (
                <p className="review-fail" role="alert"><Icon name="alert" size={14} /> <b>{s.failWords ?? `Step ${s.number} didn’t work.`}</b> {s.error ? `GitHub said: “${s.error}”.` : ''} Nothing after it ran.</p>
              )}
            </div>
            <span className={`review-step-state is-${s.state}`}><Icon name={STEP_ICON[s.state]} size={14} /> {s.stateWords}</span>
          </li>
        ))}
      </ol>
      {send.questionOnly && <p className="muted"><Icon name="message" size={14} /> A question only: nothing is pushed and no pull request is opened.</p>}
      {state === 'sending' && send.stopAfter && <p className="muted" role="status">It stops once the step it is on is done.</p>}
      {ready && <p className="muted review-never"><Icon name="lock" size={14} /> Nothing is written to GitHub before your go, and nothing is ever force-pushed.</p>}
    </section>
  );
}

function FollowUpChoice({ step, ready, reload }: { step: ReviewSendStep; ready: boolean; reload(): Promise<void> }) {
  const { api } = useWorkshop();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Once it is going, only “I’ll merge PR #1 myself” needs saying again.
  if (!ready) return step.mergeFollowUp === false && step.choice ? <p className="muted">{step.choice}</p> : null;
  const on = step.mergeFollowUp !== false;
  const flip = async (merge: boolean) => {
    setBusy(true);
    setProblem(null);
    try { await api.post('/api/review/settings', { mergeFollowUp: merge }); await reload(); } catch (err) { setProblem(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  return (
    <div className="review-choice">
      <label className="review-switch">
        <Choice type="checkbox" role="switch" checked={on} disabled={busy} onChange={(e) => void flip(e.currentTarget.checked)} aria-label="This go also merges PR #1 once its checks pass" />
        <span>{on ? 'This go also merges PR #1 once its checks pass' : 'I’ll merge PR #1 myself: the replies and the review request wait until it is merged'}</span>
      </label>
      {on && <button type="button" className="link-button" disabled={busy} onClick={() => void flip(false)} title="Stop after opening PR #1. Steps 3 to 5 run on their own once GitHub shows it merged.">I’ll merge PR #1 myself</button>}
      <span className="muted review-choice-note">Remembered for the next round too.</span>
      {problem && <p className="field-problem" role="alert">{problem}</p>}
    </div>
  );
}

function Replies({ items, act, ready }: { items: ReviewItemView[]; act: Act; ready: boolean }) {
  return (
    <ul className="review-replies">
      {items.map((i) => <ReplyCard key={i.id} item={i} act={act} ready={ready} />)}
    </ul>
  );
}

const REPLY_ICON: Record<string, 'circle-check' | 'x' | 'clock' | 'minus'> = { Posted: 'circle-check', 'Didn’t post': 'x', 'Not posted yet': 'clock', Dropped: 'minus' };

function ReplyCard({ item: i, act, ready }: { item: ReviewItemView; act: Act; ready: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(i.reply ?? '');
  const [busy, setBusy] = useState(false);
  const doIt = async (body: Record<string, unknown>) => { setBusy(true); try { return await act('item', { id: i.id, ...body }); } finally { setBusy(false); } };
  const save = async () => { if (await doIt({ reply: text.trim() })) setEditing(false); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save(); }
    if (e.key === 'Escape') { e.preventDefault(); setText(i.reply ?? ''); setEditing(false); }
  };
  const failed = i.replyState === 'Didn’t post';
  return (
    <li className={`review-reply${i.replyDropped ? ' is-dropped' : ''}${failed ? ' is-fail' : ''}${editing ? ' is-editing' : ''}`}>
      <p className="review-reply-where muted"><span className="num">↳ {whereOf(i)}</span> · {i.kindWords}</p>
      {editing ? (
        <textarea className="text-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} aria-label={`Your reply on ${whereOf(i)}`} autoFocus />
      ) : (
        <p className="review-reply-text">{i.replyDropped ? <s><InlineText text={i.reply ?? ''} /></s> : <InlineText text={i.reply ?? ''} />}</p>
      )}
      <div className="review-reply-acts">
        {ready && editing && (
          <>
            <Button kind="quiet" size="sm" disabled={busy} onClick={() => { setText(i.reply ?? ''); setEditing(false); }} title="Keep the reply as it was (Esc).">Cancel</Button>
            <Button kind="primary" size="sm" disabled={busy || !text.trim()} onClick={() => void save()} title="Save this reply (Enter; Shift+Enter for a new line).">Save <kbd className="kbd key-hint" aria-hidden="true">↵</kbd></Button>
          </>
        )}
        {ready && !editing && !i.replyDropped && (
          <>
            <Button kind="quiet" size="sm" icon="pencil" disabled={busy} onClick={() => { setText(i.reply ?? ''); setEditing(true); }} title="Change the words before they are posted.">Edit</Button>
            <Button kind="quiet" size="sm" icon="x" disabled={busy} onClick={() => void doIt({ replyDropped: true })} title="Don’t post this reply. The comment stays open; you can put it back.">Drop</Button>
          </>
        )}
        {ready && i.replyDropped && <Button kind="quiet" size="sm" disabled={busy} onClick={() => void doIt({ replyDropped: false })} title="Post this reply after all.">Put it back</Button>}
        {!ready && i.replyState && <span className={`review-reply-state${failed ? ' is-fail' : ''}`}><Icon name={REPLY_ICON[i.replyState] ?? 'clock'} size={14} /> {i.replyState}</span>}
      </div>
    </li>
  );
}

// ---------- Waiting, and after ----------

function Timeline({ round }: { round: ReviewRoundPanel }) {
  return (
    <section className="review-timeline" aria-label={round.timelineHeading}>
      <h3 className="next-label">{round.timelineHeading}</h3>
      <ol>
        {round.timeline.map((t, n) => (
          <li key={`${t.at}-${n}`}><time className="num muted" dateTime={t.at}>{t.time}</time> <span>{t.words}</span></li>
        ))}
      </ol>
    </section>
  );
}

function MergeBlock({ view }: { view: ReviewView }) {
  const pr = view.pr;
  const m = view.merge!;
  const rows: { ok: boolean; words: string; at?: string | null }[] = [
    { ok: pr.review === 'approved', words: pr.review === 'approved' ? `${view.who.reviewer ?? 'The reviewer'} approved ${pr.label}${view.rounds.length ? ` · round ${view.rounds[view.rounds.length - 1].round}` : ''}` : `${pr.label} is yours to review`, at: pr.approvedAt },
    { ok: pr.checks !== 'failing', words: pr.checks === 'passing' ? `${pr.checkCount} ${pr.checkCount === 1 ? 'check' : 'checks'} passed` : pr.checks === null ? 'No checks run on this pull request' : 'Checks still running' },
    { ok: pr.mergeable !== 'CONFLICTING', words: pr.mergeable === 'MERGEABLE' ? `No conflicts with ${pr.base ?? 'its base'}` : `GitHub hasn’t said yet whether it conflicts with ${pr.base ?? 'its base'}` },
  ];
  return (
    <section className="review-merge" aria-label="Ready to merge">
      <h3 className="next-label">Ready to merge</h3>
      <ul className="review-merge-rows">
        {rows.map((r) => (
          <li key={r.words}><Icon name={r.ok ? 'check' : 'clock'} size={14} /> <span>{r.words}</span>{r.at && <time className="num muted" dateTime={r.at}>{clockOf(r.at)}</time>}</li>
        ))}
      </ul>
      <dl className="review-who">
        <dt>Who merges {pr.label}</dt><dd>{m.who === 'you' ? 'You' : m.who} · <span className="muted">{m.line.replace(/^[^·]*·\s*/, '')}</span></dd>
        <dt>Into</dt><dd>{pr.base ?? 'its base'}</dd>
        <dt>How</dt><dd>{m.method === 'squash' ? 'Squashed into one commit' : 'A merge commit'} · <code>{m.command}</code></dd>
      </dl>
    </section>
  );
}

// ---------- The guide ----------

/** The three picture cards, opened by How review rounds work (and on the first round, by the Desk card). */
export function ReviewGuide({ onClose }: { onClose(): void }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop guide-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="guide" role="dialog" aria-modal="true" aria-label={REVIEW_GUIDE.title}>
        <header className="guide-head">
          <h3>{REVIEW_GUIDE.title}</h3>
          <Button kind="quiet" onClick={onClose} title="Close this; How review rounds work opens it again.">Skip</Button>
        </header>
        <GuideCards cards={REVIEW_GUIDE.cards} />
        <footer className="guide-foot">
          <span className="muted">Open this again any time with How review rounds work.</span>
          <Button kind="primary" size="lg" onClick={onClose} autoFocus>{REVIEW_GUIDE.done}</Button>
        </footer>
      </section>
    </div>
  );
}
