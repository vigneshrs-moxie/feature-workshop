// "Pair this laptop?" (#/pair/<code>): the link `ground-control login --site` printed. It shows the
// laptop's name, OS and the same code, so you can check it is yours, and one button. The laptop
// finishes by itself a few seconds after you press it (it is polling the site).
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Page } from '../../components/page/Page';
import { useDelayedFlag } from '../../lib/useDelayedFlag';
import { isSignedOut, words, type HostedProps } from './shared';
import type { Pairing } from './types';

type Load = { state: 'loading' } | { state: 'ready'; pairing: Pairing } | { state: 'missing'; message: string } | { state: 'error'; message: string };

export function PairPage({ code, api, onSignedOut, person }: HostedProps & { code: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const slow = useDelayedFlag(load.state === 'loading');
  const read = useCallback(async () => {
    try { setLoad({ state: 'ready', pairing: await api.get<Pairing>(`/api/pair/${encodeURIComponent(code)}`) }); } catch (err) {
      if (isSignedOut(err)) return onSignedOut();
      setLoad(err instanceof ApiError && err.status === 404 ? { state: 'missing', message: words(err) } : { state: 'error', message: words(err) });
    }
  }, [api, code, onSignedOut]);
  useEffect(() => { void read(); }, [read]);

  async function pair() {
    setBusy(true);
    setProblem(null);
    try {
      const p = await api.post<Pairing>(`/api/pair/${encodeURIComponent(code)}/approve`, {});
      setLoad({ state: 'ready', pairing: p });
    } catch (err) {
      if (isSignedOut(err)) return onSignedOut();
      setProblem(words(err));
      void read();
    } finally { setBusy(false); }
  }

  let body;
  if (load.state === 'loading') body = slow ? <p className="muted" role="status">Looking up the code…</p> : null;
  else if (load.state === 'missing') body = <div className="hosted-problem" role="alert"><Icon name="alert" size={16} /><div><p className="hosted-problem-title">No laptop is waiting with code {code}</p><p className="muted">{load.message}</p></div></div>;
  else if (load.state === 'error') body = <div role="alert"><p className="field-problem">Couldn’t look up the code: {load.message}</p><Button onClick={() => void read()}>Try again</Button></div>;
  else {
    const p = load.pairing;
    body = (
      <section className="hosted-pair" aria-label={`Pair ${p.name}`}>
        <dl className="hosted-pair-facts">
          <div><dt>Laptop</dt><dd>{p.name}</dd></div>
          <div><dt>System</dt><dd>{p.os}</dd></div>
          <div><dt>Code</dt><dd className="hosted-code" aria-label={`Code ${p.code.split('').join(' ')}`}>{p.code}</dd></div>
        </dl>
        {p.state === 'waiting' && (
          <>
            <p>Check the laptop’s terminal shows the same code. Pairing lets this laptop send its jobs to the site for <strong>{person.email}</strong>.</p>
            <div className="doc-actions">
              <Button kind="primary" size="lg" icon="lock" busy={busy} onClick={() => void pair()} title="Pair this laptop with your account: its jobs show under Jobs.">Pair this laptop</Button>
              <Button kind="quiet" href="#/" title="Leave it unpaired. The code runs out by itself in ten minutes.">Not mine</Button>
            </div>
          </>
        )}
        {p.state === 'approved' && <p className="hosted-done" role="status"><Icon name="circle-check" size={16} />Paired. The laptop finishes by itself in a few seconds; its jobs then show under <a href="#/">Jobs</a>.</p>}
        {p.state === 'paired' && <p className="hosted-done" role="status"><Icon name="circle-check" size={16} />This laptop is paired. Its jobs show under <a href="#/">Jobs</a>.</p>}
        {p.state === 'expired' && <div className="hosted-problem" role="alert"><Icon name="clock" size={16} /><div><p className="hosted-problem-title">This code has run out</p><p className="muted">Codes last ten minutes. Run ground-control login on the laptop again for a new one.</p></div></div>}
        {problem && <p className="field-problem" role="alert">{problem}</p>}
      </section>
    );
  }
  return <Page label="Pair this laptop" title="Pair this laptop?">{body}</Page>;
}
