// A gate decision on its way (spec 1.2). The gate card, the job page's bar and the Desk's calls read
// one send per job (lib/sentState.ts, key gate:<slug>), so whichever button was pressed, it spins,
// the others are off, and none can send twice. The card sends through send(); every place that uses this
// watches the job and clears the send once the job moves on: a new run, or a different waitingFor or
// stage than at the click. Try again (retry) sends the same decision once more.
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
const lastSent = new Map<string, { body: GateRequest; marks: string }>();

export interface GateSent {
  state: SentPhase;
  /** The kind of the decision out or last sent (which call spins). */
  kind: GateKind | null;
  /** Send a decision: sending until it answers, then sent if it went to the Foreman, else idle. Refusals throw. */
  send(api: ApiClient, body: GateRequest): Promise<GateResult>;
  /** Try again: the same decision once more (throws when there is none, or on a refusal). */
  retry(api: ApiClient): Promise<GateResult>;
}

/** `run`: the job's live run, else the one its page was fetched with. */
export function useGateSent(job: Job, run: Run | null | undefined): GateSent {
  const slug = job.slug;
  const sent = useSent(gateSentKey(slug));
  const marks = jobMarks(job, run);
  const { state, clear } = sent;

  useEffect(() => {
    if (state !== 'sent' && state !== 'stuck') return;
    if (lastSent.get(slug)?.marks !== marks) clear();
  }, [state, marks, slug, clear]);

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
    // Held for the usage limit, given back to the message box, or queued by the website for the
    // laptop (its card says so): nothing went to the Foreman, so nothing waits for it to start.
    if (r?.sent) sent.accepted(); else sent.clear();
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

/** Whether there is a decision to send again for this job (Try again). */
export const canRetry = (slug: string) => lastSent.has(slug);

/** Forget every decision sent (between tests). */
export function clearGateSent() {
  lastSent.clear();
}
