// Settings → Orbit on the hosted site (packet 2C): your own read-only Orbit token, so the site can
// fill your Inbox while your laptop is closed (hosted/site/routes-orbit.js). Paste it once; the
// site checks it with one call to Orbit and keeps it encrypted. After that this page shows only
// "Saved · expires 12 Dec" and Remove: the token is never shown again, and no answer carries it.
// Past its date, or refused by Orbit, the form comes back to paste a new one.
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import type { OrbitStatus } from '../../api/types';
import { Button } from '../../components/Button';
import { Segmented } from '../../components/Choice';
import { TextInput } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { useDelayedFlag } from '../../lib/useDelayedFlag';
import { HostedSettings } from './SettingsRail';
import { isSignedOut, words, type HostedProps } from './shared';

type Load = { state: 'loading' } | { state: 'ready'; status: OrbitStatus } | { state: 'error'; message: string };
type Lifetime = '7' | '30' | '90' | 'unknown';

const LIFETIMES: readonly { value: Lifetime; label: string; title: string }[] = [
  { value: '7', label: '7 days', title: 'You made it to last 7 days.' },
  { value: '30', label: '30 days', title: 'You made it to last 30 days.' },
  { value: '90', label: '90 days', title: 'You made it to last 90 days.' },
  { value: 'unknown', label: 'Not sure', title: 'The site finds out when Orbit stops taking it.' },
];

/** "12 Dec", with the year when it isn't this year's. */
export function dayWords(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

/** The one line a saved token gets. */
export function savedWords(status: Pick<OrbitStatus, 'expiresAt'>, now = new Date()): string {
  return status.expiresAt ? `Saved · expires ${dayWords(status.expiresAt, now)}` : 'Saved · when it expires isn’t known';
}

export function OrbitPage({ api, onSignedOut }: HostedProps) {
  const id = useId();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [token, setToken] = useState('');
  const [days, setDays] = useState<Lifetime>('30');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const slow = useDelayedFlag(load.state === 'loading');

  const fail = useCallback((err: unknown) => { if (isSignedOut(err)) { onSignedOut(); return true; } return false; }, [onSignedOut]);
  useEffect(() => {
    let live = true;
    api.get<OrbitStatus>('/api/orbit/status')
      .then((status) => { if (live) setLoad({ state: 'ready', status }); })
      .catch((err) => { if (live && !fail(err)) setLoad({ state: 'error', message: words(err) }); });
    return () => { live = false; };
  }, [api, fail]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try {
      const status = await api.post<OrbitStatus>('/api/orbit/token', { token, expiresInDays: days === 'unknown' ? null : Number(days) });
      setLoad({ state: 'ready', status });
      setToken('');
      setSaid('Orbit took it. Your tickets fill the Inbox within a few minutes.');
    } catch (err) {
      if (!fail(err)) setProblem(words(err));
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try {
      setLoad({ state: 'ready', status: await api.del<OrbitStatus>('/api/orbit/token') });
      setSaid('Removed. The site no longer has your token, and your inbox here is empty until you paste one again.');
    } catch (err) {
      if (!fail(err)) setProblem(words(err));
    } finally { setBusy(false); }
  }

  const status = load.state === 'ready' ? load.status : null;
  const setup = status?.setup ?? [];
  const saved = Boolean(status?.tokenPresent && !status.expired);
  return (
    <HostedSettings at="orbit">
      <h3 className="settings-heading">Orbit</h3>
      <p className="muted">
        Your Portal Feedback tickets come into the Inbox here with your own Orbit token, even while your laptop is closed. It can only read: nothing is ever changed on Orbit.
        The site keeps it encrypted and uses it for your inbox only. The Foreman on your laptop still reads tickets with the laptop’s own token.
      </p>
      {load.state === 'loading' && slow && <p className="muted" role="status">Loading…</p>}
      {load.state === 'error' && <p className="field-problem" role="alert">Couldn’t read whether a token is saved: {load.message}</p>}
      {setup.length > 0 && (
        <p className="perm-warn" role="status">The site isn’t set up for Orbit yet: whoever runs it sets {setup.join(' and ')} in Vercel first.</p>
      )}
      {status && saved && (
        <div className="hosted-orbit-saved" data-orbit="saved">
          <span className="hosted-orbit-saved-words" role="status"><Icon name="circle-check" size={16} />{savedWords(status)}</span>
          <Button kind="quiet" busy={busy} onClick={() => void remove()} title="Remove your token from the site. The Inbox here stops filling until you paste one again.">Remove</Button>
        </div>
      )}
      {status && !saved && (
        <form className="hosted-orbit-form" onSubmit={(e) => void save(e)} data-orbit={status.tokenPresent ? 'expired' : 'empty'}>
          {status.tokenPresent && status.expired && (
            <p className="inbox-token-banner" role="status"><Icon name="clock" size={16} /><span>Your Orbit token expired. Paste a new one below.</span></p>
          )}
          <p className="muted">Make one on Orbit’s API tokens page (7, 30 or 90 days), then paste it here.</p>
          <div className="hosted-orbit-field">
            <label htmlFor={`${id}-token`}>{status.tokenPresent ? 'A new token' : 'Your token'}</label>
            <TextInput id={`${id}-token`} type="password" autoComplete="off" spellCheck={false} placeholder="orbfb_…" value={token} onChange={(e) => setToken(e.target.value)} disabled={busy || setup.length > 0} />
          </div>
          <div className="hosted-orbit-field">
            <span aria-hidden="true">How long it lasts</span>
            <Segmented label="How long it lasts" value={days} options={LIFETIMES} onChange={(v) => setDays(v as Lifetime)} disabled={busy || setup.length > 0} />
          </div>
          <div className="doc-actions">
            <Button type="submit" kind="primary" busy={busy} disabled={!token.trim() || setup.length > 0} title="The site checks it with Orbit, then keeps it encrypted.">Save the token</Button>
          </div>
        </form>
      )}
      {said && <p role="status">{said}</p>}
      {problem && <p className="field-problem" role="alert">{problem}</p>}
    </HostedSettings>
  );
}
