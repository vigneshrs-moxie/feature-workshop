// Settings → Laptops: the laptops paired with your account (GET /api/laptops): name, system, when
// paired, last seen, and online or not (seen in the last minute), in words with an icon. Remove
// asks once more, then revokes the laptop's token: it can't call in again, and its jobs leave the
// site (they stay on the laptop). Pairing one is done from the laptop.
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { fullTime, relativeTime, useNow } from '../../lib/time';
import { useDelayedFlag } from '../../lib/useDelayedFlag';
import { HostedSettings } from './SettingsRail';
import { isSignedOut, words, type HostedProps } from './shared';
import type { Laptop } from './types';

type Load = { state: 'loading' } | { state: 'ready'; laptops: Laptop[] } | { state: 'error'; message: string };

function LaptopRow({ laptop, now, onRemove }: { laptop: Laptop; now: Date; onRemove: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <li className="rule-row hosted-laptop-row" data-laptop={laptop.name}>
      <div className="rule-row-main">
        <p className="rule-row-label"><strong>{laptop.name}</strong> <span className="muted">· {laptop.os}{laptop.version ? ` · version ${laptop.version}` : ''}</span></p>
        <p className="rule-row-meta muted">
          {laptop.online
            ? <span className="hosted-online is-online"><Icon name="circle-dot" size={12} />Online</span>
            : <span className="hosted-online is-offline"><Icon name="circle-dashed" size={12} />Offline{laptop.lastSeenAt ? ` · last seen ${relativeTime(laptop.lastSeenAt, now)}` : ' · not seen yet'}</span>}
          <span title={fullTime(laptop.pairedAt)}>Paired {relativeTime(laptop.pairedAt, now)}</span>
        </p>
        {asking && (
          <div className="hosted-confirm" role="alert">
            <p>Remove {laptop.name}? Its token stops working at once and its jobs leave the site. They stay on the laptop; run ground-control login there to pair it again.</p>
            <div className="doc-actions">
              <Button kind="danger" busy={busy} onClick={async () => { setBusy(true); await onRemove(); setBusy(false); setAsking(false); }} title="Remove this laptop from the site now.">Remove it</Button>
              <Button kind="quiet" disabled={busy} onClick={() => setAsking(false)}>Keep it</Button>
            </div>
          </div>
        )}
      </div>
      {!asking && (
        <div className="doc-actions">
          <Button kind="quiet" onClick={() => setAsking(true)} aria-label={`Remove ${laptop.name}`} title="Unpair this laptop: its token stops working and its jobs leave the site.">Remove</Button>
        </div>
      )}
    </li>
  );
}

export function LaptopsPage({ api, onSignedOut }: HostedProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [problem, setProblem] = useState<string | null>(null);
  const now = useNow(30_000);
  const slow = useDelayedFlag(load.state === 'loading');
  const read = useCallback(async () => {
    try { setLoad({ state: 'ready', laptops: (await api.get<{ laptops: Laptop[] }>('/api/laptops')).laptops }); } catch (err) {
      if (isSignedOut(err)) return onSignedOut();
      setLoad({ state: 'error', message: words(err) });
    }
  }, [api, onSignedOut]);
  useEffect(() => {
    void read();
    const t = setInterval(() => { void read(); }, 15_000);
    return () => clearInterval(t);
  }, [read]);

  async function remove(l: Laptop) {
    setProblem(null);
    try { setLoad({ state: 'ready', laptops: (await api.del<{ laptops: Laptop[] }>(`/api/laptops/${l.id}`)).laptops }); } catch (err) {
      if (isSignedOut(err)) return onSignedOut();
      setProblem(`${l.name} wasn’t removed: ${words(err)}`);
    }
  }

  return (
    <HostedSettings at="laptops">
      <h3 className="settings-heading">Laptops</h3>
      <p className="muted">Each laptop you paired sends its jobs here. To pair one, run this on it, then open the link it prints:</p>
      <pre className="hosted-command"><code>ground-control login --site {window.location.origin}</code></pre>
      {load.state === 'loading' && slow && <p className="muted" role="status">Loading your laptops…</p>}
      {load.state === 'error' && <p className="field-problem" role="alert">Couldn’t load your laptops: {load.message}</p>}
      {load.state === 'ready' && (load.laptops.length
        ? <ul className="rule-list hosted-laptop-list" aria-label="Your laptops">{load.laptops.map((l) => <LaptopRow key={l.id} laptop={l} now={now} onRemove={() => remove(l)} />)}</ul>
        : <p className="muted">No laptops paired yet.</p>)}
      {problem && <p className="field-problem" role="alert">{problem}</p>}
      <p className="muted hosted-small">A laptop counts as online when it called in during the last minute; a running laptop calls in at least every 25 seconds. On the laptop, ground-control logout unpairs it too.</p>
    </HostedSettings>
  );
}
