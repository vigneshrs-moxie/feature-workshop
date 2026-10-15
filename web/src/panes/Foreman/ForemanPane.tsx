// Foreman pane: the open job's header and its conversation with the Foreman, oldest first, with
// "Load older" at the top, then the permission and question cards waiting for you, and the live
// row at the foot while it replies. With no job open it lists every card waiting for you (Needs
// you). Plan step 8 adds the composer.
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
import { shownItems } from './thread';
import { ThreadItemView } from './ThreadItems';
import { useJobThread } from './useJobThread';

const HOW = 'This is your conversation with the job’s Foreman, the Claude session that plans the work and runs the crew. Its briefs, questions and permission requests appear here for you to answer.';

function JobThread({ job }: { job: Job }) {
  const state = useWorkshopState();
  const now = useNow();
  // Both only ever grow, so their sum changes whenever either does.
  const thread = useJobThread(job.slug, (state.threadVersions[job.slug] ?? 0) + state.threadEpoch);
  const run = state.runs[job.slug] ?? thread.detail?.run ?? null;
  const shown = shownItems(thread.items);

  // Open a job at its newest message.
  const end = useRef<HTMLDivElement>(null);
  const loaded = thread.detail !== null;
  useEffect(() => {
    if (loaded) end.current?.scrollIntoView?.({ block: 'end' });
  }, [loaded]);

  return (
    <>
      <JobHeader job={job} branch={thread.detail?.branch} />
      <HowThisWorks id="foreman">
        <p>{HOW}</p>
        <p>A brief opens in full while it waits for you and folds to its headline once you’ve answered; click a headline to open it again. Steps the Foreman took by itself are folded into one “routine steps” line.</p>
        <p>When it wants to do something that isn’t routine, a card appears at the foot of the conversation: <strong>Allow once</strong>, <strong>Allow for this reply</strong> (when offered), <strong>Deny…</strong> with a note, or <strong>Always allow…</strong>, which saves a narrow rule you check first (listed in Settings). Questions come as a short form.</p>
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
            : <ThreadItemView key={s.id} item={s.item} now={now} />,
        )}
        <JobCards slug={job.slug} now={now} />
        <LiveRow run={run} />
        <div ref={end} />
      </section>
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
