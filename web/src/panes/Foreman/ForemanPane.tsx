// Foreman pane: the open job's header and its conversation with the Foreman, oldest first, with
// "Load older" at the top, then the permission and question cards waiting for you, and the live
// row at the foot while it replies. With no job open it lists every card waiting for you (Needs
// you). The composer sits under the conversation: Send, Steer and Stop (Composer.tsx).
import { useEffect, useRef } from 'react';
import type { Job } from '../../api/types';
import { HowThisWorks } from '../../components/HowThisWorks';
import { JobCards, NeedsYouCards } from '../../components/permissions/PendingCards';
import { useUi } from '../../app/ui';
import { useNow } from '../../lib/time';
import { reviewLineup } from '../../play/crewLines';
import { usePlay } from '../../play/usePlay';
import { jobBySlug } from '../../state/reducer';
import { useWorkshopState } from '../../state/store';
import { BriefCard } from './BriefCard';
import { GateSlot } from './GateCard';
import { JobHeader } from './JobHeader';
import { LevelCard } from './LevelCard';
import { LiveRow } from './LiveRow';
import { shownItems, steerStateOf } from './thread';
import { ThreadItemView, YouMessage } from './ThreadItems';
import { Composer } from './Composer';
import { useJobThread } from './useJobThread';

const HOW = 'This is your conversation with the job’s Foreman, the Claude session that plans the work and runs the crew. Its briefs, questions and permission requests appear here for you to answer.';

function JobThread({ job }: { job: Job }) {
  const state = useWorkshopState();
  const now = useNow();
  // Both only ever grow, so their sum changes whenever either does.
  const thread = useJobThread(job.slug, (state.threadVersions[job.slug] ?? 0) + state.threadEpoch);
  const run = state.runs[job.slug] ?? thread.detail?.run ?? null;
  const gate = thread.detail?.gate ?? null;
  const shown = shownItems(thread.items, { answeredBriefs: thread.detail?.answeredBriefs, openBrief: gate ? gate.briefNumber : null });
  const inThread = new Set(thread.items.flatMap((it) => (it.kind === 'you' && it.steerId ? [it.steerId] : [])));
  const justSteered = Object.values(state.steers).filter((s) => s.slug === job.slug && s.runId === run?.id && !inThread.has(s.id));
  // Play: the lenses that ran for each review brief (those that started since the review brief before it).
  const play = usePlay();
  const lenses = new Map<string, string[]>();
  if (play.on) {
    let previousReview: string | null = null;
    for (const s of shown) {
      if (s.kind !== 'brief-card' || s.brief.item.stage !== 'review') continue;
      lenses.set(s.id, reviewLineup(thread.detail?.activity, s.brief.item.at, previousReview));
      previousReview = s.brief.item.at;
    }
  }

  // Tell the shell what only this pane knows, so ⌘K can offer Stop, Mark done and the job's setting.
  const { setCurrent } = useUi();
  const dir = thread.detail?.dir ?? null;
  const worktree = thread.detail?.worktree ?? null;
  const policyOverride = thread.detail?.policyOverride ?? null;
  useEffect(() => {
    setCurrent({ slug: job.slug, run, dir, worktree, policyOverride });
  }, [setCurrent, job.slug, run, dir, worktree, policyOverride]);
  useEffect(() => () => setCurrent(null), [setCurrent]);

  // Open a job at its newest message, and keep following it as replies, cards and steered messages
  // arrive, unless you've scrolled up to read (then it stays where you are). The whole pane
  // scrolls, so it goes to the very bottom: there the sticky composer covers nothing.
  const threadEl = useRef<HTMLElement>(null);
  const loaded = thread.detail !== null;
  useEffect(() => {
    const el = threadEl.current;
    const pane = el?.closest<HTMLElement>('.pane');
    if (!el || !pane) return;
    let follow = true;
    let pinned = -1; // where we last put it: a scroll event for that may arrive after more content did
    const toEnd = () => {
      if (!follow) return;
      pane.scrollTop = pane.scrollHeight;
      pinned = pane.scrollTop;
    };
    // Stop following only when you scroll up from there; start again when you're back at the bottom.
    const onScroll = () => {
      if (pane.scrollHeight - pane.scrollTop - pane.clientHeight < 96) follow = true;
      else if (pane.scrollTop < pinned - 2) follow = false;
    };
    pane.addEventListener('scroll', onScroll, { passive: true });
    const grew = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(toEnd);
    grew?.observe(el.parentElement ?? el); // the column: the thread, and the composer's notes under it
    toEnd();
    return () => { pane.removeEventListener('scroll', onScroll); grew?.disconnect(); };
  }, [loaded]);

  return (
    <>
      <JobHeader job={job} branch={thread.detail?.branch} dir={thread.detail?.dir} policyOverride={thread.detail?.policyOverride} run={run} worktree={thread.detail?.worktree} detailLoaded={Boolean(thread.detail)} />
      <HowThisWorks id="foreman">
        <p>{HOW}</p>
        <p>A brief opens in full while it waits for you and folds to its headline once you’ve answered; click a headline to open it again. Steps the Foreman took by itself are folded into one “routine steps” line.</p>
        <p>When the Foreman waits for your decision, a <strong>gate card</strong> sits above the message box: its questions, what it decided on your behalf, and buttons that say what they do (Approve, Edit then approve, Revise, Other guidance). Its own “How this works” explains it.</p>
        <p>When it wants to do something that isn’t routine, a card appears at the foot of the conversation: <strong>Allow once</strong>, <strong>Allow for this reply</strong> (when offered), <strong>Deny…</strong> with a note, or <strong>Always allow…</strong>, which saves a narrow rule you check first (listed in Settings). Questions come as a short form.</p>
        <p>Write to the Foreman in the box at the foot. <strong>Send…</strong> shows exactly what it will receive before it goes. While it’s replying the button becomes <strong>Steer</strong>: your message joins the reply in progress and shows <em>Queued</em>, <em>Delivered</em>, then <em>Acted on</em>. <strong>Stop</strong> ends the reply; the job then waits for you. Each job keeps its own unsent draft in this browser.</p>
        <p>How much asks you depends on the job’s permission setting (job menu, or Settings for all jobs). In <strong>Auto mode</strong> Claude Code’s safety model decides most steps; anything it blocks shows as a dim ⊘ line. Pushes, pull requests, rm -rf and migrations always ask, and org or force pushes are refused.</p>
        <p>The <strong>level chip</strong> next to the title (L0 Tweak to L3 Large) says how much process the job gets; click it to see what runs and to change it. When the Foreman suggests a different level, or none is chosen yet, a level card in the conversation shows the rules’ and the Foreman’s suggestions side by side.</p>
        <p>The <strong>Job menu</strong> marks the job done or dropped (nothing is deleted; <strong>Reopen</strong> brings it back), opens <strong>Notes and options</strong> (a drawer with the job’s notes for the Foreman and its options: level, stages, reviewers, testing, Fable, models), links to its classic page, and sets its own permission setting. <strong>⌘K</strong> (Ctrl+K) lists the same actions and more; press <strong>?</strong> for the keys.</p>
        {play.on && <p>The <strong>crew</strong> (Play mode): small characters show who did what. The Foreman by the title shows how the job is doing (at work, waiting for you, asleep in a usage pause), routine-step lines show the worker they handed work to, a review brief lines up the reviewers who looked (hover for names), and the live row shows who is at work. Subtle keeps them still; Full lets them move. Settings → Play turns them off.</p>}
      </HowThisWorks>
      <section ref={threadEl} className="thread" aria-label="Conversation" aria-busy={thread.loading || thread.loadingOlder}>
        {thread.more && (
          <button
            type="button"
            className="btn btn-quiet load-older"
            onClick={thread.loadOlder}
            disabled={thread.loadingOlder}
            title="Show the earlier part of this conversation."
          >
            {thread.loadingOlder ? 'Loading…' : 'Load older'}
          </button>
        )}
        {thread.error && <p className="thread-error" role="alert">{thread.error}</p>}
        {thread.loading && <p className="muted">Loading the conversation…</p>}
        {loaded && shown.length === 0 && !run && <p className="muted">Nothing here yet. The Foreman’s briefs and replies appear here as it works.</p>}
        {shown.map((s) =>
          s.kind === 'brief-card'
            // It folds back to its headline itself the moment you answer it (no remount, no refetch).
            ? <BriefCard key={s.id} slug={job.slug} brief={s.brief} now={now} lenses={lenses.get(s.id)} />
            : <ThreadItemView key={s.id} item={s.item} now={now} steer={s.item.kind === 'you' ? steerStateOf(s.item.steerId, state.steers, run) : null} />,
        )}
        {/* Steered just now: shown at once, until the conversation (refetched a moment later) has it. */}
        {justSteered.map((s) => <YouMessage key={s.id} text={s.text} at={s.queuedAt ?? null} now={now} steer={s.state} steered />)}
        {/* The level: when the Foreman's suggestion differs from the chosen one, or none is chosen yet. */}
        {loaded && <LevelCard job={job} detail={thread.detail} />}
        <JobCards slug={job.slug} now={now} />
        <LiveRow run={run} job={job} usage={state.usage} />
      </section>
      {/* The gate card: pinned above the composer while the Foreman waits for your decision. */}
      {thread.detail && <GateSlot job={job} detail={thread.detail} now={now} reload={thread.reload} />}
      <Composer key={job.slug} slug={job.slug} detail={thread.detail} run={run} />
    </>
  );
}

export function ForemanPane({ slug }: { slug: string | null }) {
  const state = useWorkshopState();
  const job = jobBySlug(state, slug);
  const now = useNow();
  return (
    <main className="pane pane-foreman" data-pane="foreman" aria-label="Foreman">
      <div className="foreman-column">
        {job ? (
          <JobThread key={job.slug} job={job} />
        ) : (
          <>
            <h2 className="pane-title">Foreman</h2>
            <HowThisWorks id="foreman"><p>{HOW}</p></HowThisWorks>
            {!slug && <p className="muted">Pick a job on the left to see its conversation.</p>}
            {slug && state.status === 'ready' && (state.runs[slug]
              ? <p className="muted" role="status">Starting the job… It appears here in a moment.</p>
              : <p className="muted">There’s no job called “{slug}”. It may have been renamed or removed.</p>)}
            {!slug && state.status === 'ready' && (
              <section className="needs-you-inbox" aria-label="Waiting for your answer">
                <h3 className="settings-heading" title="Every permission and question waiting for you, across all jobs. You can answer them here or in each job.">Waiting for your answer</h3>
                <NeedsYouCards now={now} />
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
