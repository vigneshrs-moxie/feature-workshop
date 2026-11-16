// A plain Stop while the Foreman replies (16 Nov: the page had no Stop in view; it was only in ⌘K,
// the message box's "Stop it and send now" and the asks row's "Stop here"). It sits on Your move's
// working line, on a laptop and on the phone, and does what ⌘K's "Stop the reply" does
// (app/jobActions.ts stopRun), in the same words. Once pressed it is busy until the reply ends, so a
// second click sends nothing; a refusal says why on the line.

import { memo, useState } from 'react';
import { ApiError } from '../../api/client';
import { BRAND } from '../../app/brand';
import { stopRun } from '../../app/jobActions';
import { Button } from '../../components/Button';
import { useWorkshop } from '../../state/store';
import { useJob } from '../useJob';
import { LOCKED, RUN_ACTIVE, useForemanRun } from './MessageBox';

export const STOP_HINT = 'End the Foreman’s reply now. Anything waiting for your answer is declined, your draft is kept, and the job waits for your next message.';

/** `line`: on a line of its own (when Your move shows no working line, only what he asked). */
export const StopReply = memo(function StopReply({ line = false }: { line?: boolean }) {
  const { api } = useWorkshop();
  const run = useForemanRun();
  const locked = useJob((s) => Boolean(s.payload?.lock));
  const [asked, setAsked] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const id = run?.id ?? null;
  if (!id || !RUN_ACTIVE.has(run?.status ?? '')) return null;
  const stopping = run?.status === 'stopping' || asked === id;
  const stop = async () => {
    if (stopping) return;
    setAsked(id);
    setProblem(null);
    try {
      await stopRun(api, id);
    } catch (err) {
      // Ended by itself meanwhile (404 "already finished"): nothing to say.
      if (err instanceof ApiError && err.status === 404) return;
      setAsked(null);
      setProblem(`Not stopped: ${err instanceof TypeError ? `couldn’t reach ${BRAND.name}` : err instanceof Error ? err.message.replace(/[.!?]$/, '') : String(err)}. Try again.`);
    }
  };
  const inner = (
    <>
      {' '}
      <Button kind="quiet" size="sm" className="jp2-ym-stop" busy={stopping} busyLabel="Stopping…" disabled={locked} onClick={() => void stop()} title={locked ? `Off: ${LOCKED}` : STOP_HINT}>Stop</Button>
      {problem && <span className="jp2-ym-stopwhy" role="alert">{problem}</span>}
    </>
  );
  return line ? <p className="jp2-ym-one">The Foreman is replying.{inner}</p> : inner;
});
