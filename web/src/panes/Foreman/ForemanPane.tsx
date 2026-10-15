// Foreman pane: the open job's header and its conversation with the Foreman, oldest first, with
// "Load older" at the top, then the permission and question cards waiting for you, and the live
// row at the foot while it replies. With no job open it lists every card waiting for you (Needs
// you). The composer sits under the conversation: Send, Steer and Stop (Composer.tsx).
import { useEffect, useRef } from 'react';
import type { Job } from '../../api/types';
import { HowThisWorks } from '../../components/HowThisWorks';
import { JobCards, NeedsYouCards } from '../../components/permissions/PendingCards';
import { useNow } from '../../lib/time';
import { jobBySlug } from '../../state/reducer';
import { useWorkshopState } from '../../state/store';
import { BriefCard } from './BriefCard';
import { JobHeader } from './JobHeader';
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
  const shown = shownItems(thread.items);
  const inThread = new Set(thread.items.flatMap((it) => (it.kind === 'you' && it.steerId ? [it.steerId] : [])));
  const justSteered = Object.values(state.steers).filter((s) => s.slug === job.slug && s.runId === run?.id && !inThread.has(s.id));

  // Open a job at its newest message.
  const end = useRef<HTMLDivElement>(null);
  const loaded = thread.detail !== null;
  useEffect(() => {
    if (loaded) end.current?.scrollIntoView?.({ block: 'end' });
  }, [loaded]);

  return (
    <>
      <JobHeader job={job} branch={thread.detail?.branch} dir={thread.detail?.dir} policyOverride={thread.detail?.policyOverride} />
      <HowThisWorks id="foreman">
        <p>{HOW}</p>
        <p>A brief opens in full while it waits for you and folds to its headline once you’ve answered; click a headline to open it again. Steps the Foreman took by itself are folded into one “routine steps” line.</p>
        <p>When it wants to do something that isn’t routine, a card appears at the foot of the conversation: <strong>Allow once</strong>, <strong>Allow for this reply</strong> (when offered), <strong>Deny…</strong> with a note, or <strong>Always allow…</strong>, which saves a narrow rule you check first (listed in Settings). Questions come as a short form.</p>
        <p>Write to the Foreman in the box at the foot. <strong>Send…</strong> shows exactly what it will receive before it goes. While it’s replying the button becomes <strong>Steer</strong>: your message joins the reply in progress and shows <em>Queued</em>, <em>Delivered</em>, then <em>Acted on</em>. <strong>Stop</strong> ends the reply; the job then waits for you. Each job keeps its own unsent draft in this browser.</p>
        <p>How much asks you depends on the job’s permission setting (job menu, or Settings for all jobs). In <strong>Auto mode</strong> Claude Code’s safety model decides most steps; anything it blocks shows as a dim ⊘ line. Pushes, pull requests, rm -rf and migrations always ask, and org or force pushes are refused.</p>
      </HowThisWorks>
      <section className="thread" aria-label="Conversation" aria-busy={thread.loading || thread.loadingOlder}>
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
            // Keyed on `answered` too, so a brief folds back to its headline the moment you answer it.
            ? <BriefCard key={`${s.id}:${s.brief.answered}`} slug={job.slug} brief={s.brief} now={now} />
            : <ThreadItemView key={s.id} item={s.item} now={now} steer={s.item.kind === 'you' ? steerStateOf(s.item.steerId, state.steers, run) : null} />,
        )}
        {/* Steered just now: shown at once, until the conversation (refetched a moment later) has it. */}
        {justSteered.map((s) => <YouMessage key={s.id} text={s.text} at={s.queuedAt ?? null} now={now} steer={s.state} steered />)}
        <JobCards slug={job.slug} now={now} />
        <LiveRow run={run} />
        <div ref={end} />
      </section>
      <Composer key={job.slug} slug={job.slug} detail={thread.detail} run={run} />
    </>
  );
}

export function ForemanPane({ slug }: { slug: string | null }) {
  const state = useWorkshopState();
  const job = jobBySlug(state, slug);
  const now = useNow();
  return (
    <main className="pane pane-foreman" aria-label="Foreman">
      <div className="foreman-column">
        {job ? (
          <JobThread key={job.slug} job={job} />
        ) : (
          <>
            <h2 className="pane-title">Foreman</h2>
            <HowThisWorks id="foreman"><p>{HOW}</p></HowThisWorks>
            {!slug && <p className="muted">Pick a job on the left to see its conversation.</p>}
            {slug && state.status === 'ready' && <p className="muted">There’s no job called “{slug}”. It may have been renamed or removed.</p>}
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
