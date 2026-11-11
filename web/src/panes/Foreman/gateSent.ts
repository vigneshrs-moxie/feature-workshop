// A gate decision on its way (spec 1.2). The gate card, the job page's bar and the Desk's calls read
// one send per job (lib/sentState.ts, key gate:<slug>), so whichever button was pressed, it spins,
// the others are off, and none can send twice. The card sends through send(); every place that uses this
// watches the job and clears the send once the job moves on: a new run, or a different waitingFor or
// stage than at the click. Try again (retry) sends the same decision once more. On the website the
// site queues a decision for the laptop: the send stays out (sending) until the page shows that
// queued decision, so no call can be pressed again before its card says it waits.
import { useEffect } from 'react';
import type { ApiClient } from '../../api/client';
import type { GateRequest, GateResult, Job, Run } from '../../api/types';
import { sendGate } from '../../app/jobActions';
import type { GateKind } from '../../lib/compose';
import { useSent, type SentPhase } from '../../lib/sentState';

export const gateSentKey = (slug: string) => `gate:${slug}`;

/** Where the job stands, as a send compares it: its run, what it waits for, its stage. */
export function jobMarks(job: Job, run: Run | null | undefined): string {
  return JSON.stringify([run?.id ?? null, job.waitingFor ?? null, job.stage ?? null]);
}

/** The decision last sent for each job, and where the job stood at its click. */
const lastSent = new Map<string, { body: GateRequest; marks: string; queuedId?: string }>();

/** The id of the decision the website queued for the laptop, from a gate answer. */
function queuedIdOf(r: unknown): string | null {
  const q = (r as { queued?: unknown } | null)?.queued;
  const id = q && typeof q === 'object' ? (q as { id?: unknown }).id : null;
  return typeof id === 'string' ? id : null;
}

export interface GateSent {
  state: SentPhase;
  /** The kind of the decision out or last sent (which call spins). */
  kind: GateKind | null;
  /**
   * Send a decision: sending until it answers, then sent if it went to the Foreman; queued by the
   * website, still sending until the page shows it; else idle. Refusals throw.
   */
  send(api: ApiClient, body: GateRequest): Promise<GateResult>;
  /** Try again: the same decision once more (throws when there is none, or on a refusal). */
  retry(api: ApiClient): Promise<GateResult>;
}

/**
 * `run`: the job's live run, else the one its page was fetched with. `queuedId`: the decision the
 * page shows as queued for the laptop (the website), if any.
 */
export function useGateSent(job: Job, run: Run | null | undefined, queuedId: string | null = null): GateSent {
  const slug = job.slug;
  const sent = useSent(gateSentKey(slug));
  const marks = jobMarks(job, run);
  const { state, clear } = sent;
  // Read here, so a page drawn again after the answer checks it against what it shows.
  const awaited = lastSent.get(slug)?.queuedId ?? null;

  useEffect(() => {
    const last = lastSent.get(slug);
    if (state === 'sending') {
      // Queued by the website: over once the page shows it (or the job moved on meanwhile).
      if (last?.queuedId && (queuedId === last.queuedId || last.marks !== marks)) clear();
      return;
    }
    if (state !== 'sent' && state !== 'stuck') return;
    if (last?.marks !== marks) clear();
  }, [state, marks, slug, clear, queuedId, awaited]);

  async function send(api: ApiClient, body: GateRequest): Promise<GateResult> {
    lastSent.set(slug, { body, marks });
    sent.start();
    let r: GateResult;
    try {
      r = await sendGate(api, slug, body);
    } catch (err) {
      sent.failed();
      throw err;
    }
    const queued = queuedIdOf(r);
    if (r?.sent) sent.accepted();
    else if (queued) lastSent.set(slug, { body, marks, queuedId: queued });
    // Held for the usage limit or given back to the message box: nothing went to the Foreman.
    else sent.clear();
    return r;
  }

  return {
    state,
    kind: lastSent.get(slug)?.body.kind ?? null,
    send,
    retry: (api) => {
      const last = lastSent.get(slug);
      return last ? send(api, last.body) : Promise.reject(new Error('Nothing to send again.'));
    },
  };
}

/** Forget every decision sent (between tests). */
export function clearGateSent() {
  lastSent.clear();
}
