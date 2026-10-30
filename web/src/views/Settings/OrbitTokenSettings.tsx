// Settings → Workflow → Orbit token: Orbit's address and your read-only Portal Feedback token
// (orbfb_…, made on Orbit's API tokens page), for the Inbox and for the Foreman reading tickets.
// POST /api/orbit/token keeps the token in this computer's credential store and adds the Foreman's
// Orbit entry to Claude Code's settings (with a variable, never the token); DELETE forgets both.
// The token is never shown again: the field only says whether one is saved, where, and until when.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useWorkshop } from '../../state/store';
import { fullTime, relativeTime, useNow } from '../../lib/time';
import type { OrbitStatus } from '../Inbox';
import { Select } from '../../components/Select';
import { Button } from '../../components/Button';
import { TextInput } from '../../components/Field';

const STORE_WORDS: Record<string, string> = {
  keytar: 'in this computer’s credential store',
  keychain: 'in your macOS Keychain',
  file: 'in a file only you can read, in the dashboard’s own folder',
};

export const LIFETIMES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const dateWords = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function OrbitTokenSettings() {
  const { api } = useWorkshop();
  const now = useNow();
  const id = useId();
  const [status, setStatus] = useState<OrbitStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [days, setDays] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.get<OrbitStatus>('/api/orbit/status')
      .then((s) => { if (!live) return; setStatus(s); setUrl((u) => u || s.url || ''); })
      .catch((err) => { if (live) setLoadError(message(err)); });
    return () => { live = false; };
  }, [api]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const s = await api.post<OrbitStatus>('/api/orbit/token', { token, url, expiresInDays: days ? Number(days) : null });
      setStatus(s);
      setToken('');
      setSaved(s.lastError ? `Saved, but Orbit said: ${s.lastError}` : 'Saved. Orbit took the token: your tickets are in the Inbox.');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      setStatus(await api.del<OrbitStatus>('/api/orbit/token'));
      setSaved('Forgotten. The token is gone from this computer, and the Foreman no longer reads Orbit.');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Orbit token" data-setting="orbit-token">
      <h3 className="settings-heading">Orbit token</h3>
      <p className="muted">
        Your Portal Feedback tickets come into the Inbox with your own token, and the Foreman reads a ticket with it too. It can only read: nothing is ever changed on Orbit.
        Make one on Orbit’s API tokens page (7, 30 or 90 days), then paste it here.
      </p>
      {loadError && <p className="field-problem" role="alert">Couldn’t read the token’s state: {loadError}</p>}
      {status && (
        <p role="status">
          {status.tokenPresent ? <>A token is saved {STORE_WORDS[status.store ?? 'file'] ?? ''}.</> : <>No token saved.</>}
          {status.tokenPresent && status.expiresAt && (
            <> {status.expired ? <strong>It expired on {dateWords(status.expiresAt)}: paste a new one.</strong> : <>It lasts until {dateWords(status.expiresAt)}.</>}</>
          )}
          {status.tokenPresent && !status.expiresAt && <> When it expires isn’t known.</>}
          {status.tokenPresent && status.lastPoll && <span className="muted" title={fullTime(status.lastPoll)}> Last read {relativeTime(status.lastPoll, now)}{/^\d+[mhd]$/.test(relativeTime(status.lastPoll, now)) ? ' ago' : ''}.</span>}
          {status.tokenPresent && status.lastError && <span className="perm-warn" style={{ display: 'block' }}>{status.lastError}</span>}
        </p>
      )}
      <form onSubmit={(e) => void save(e)} className="rule-options">
        <label htmlFor={`${id}-url`}>Orbit’s address</label>
        <TextInput id={`${id}-url`} type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://orbit.example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
        <label htmlFor={`${id}-token`}>{status?.tokenPresent ? 'A new token' : 'Your token'}</label>
        <TextInput id={`${id}-token`} type="password" autoComplete="off" spellCheck={false} placeholder="orbfb_…" value={token} onChange={(e) => setToken(e.target.value)} />
        <label htmlFor={`${id}-days`}>How long it lasts</label>
        <Select id={`${id}-days`} value={days} onChange={setDays} options={[{ value: '', label: 'I don’t know' }, ...LIFETIMES.map((l) => ({ value: String(l.days), label: l.label }))]} />
        <div className="doc-actions">
          <Button type="submit" disabled={busy || !token.trim()} title="Keep the token on this computer and check it with Orbit.">{busy ? 'Saving…' : 'Save the token'}</Button>
          {status?.tokenPresent && (
            <Button kind="quiet" disabled={busy} onClick={() => void forget()} title="Remove the token from this computer and the Foreman’s Orbit entry from Claude Code’s settings.">Forget the token</Button>
          )}
        </div>
      </form>
      {saved && <p role="status">{saved}</p>}
      {error && <p className="field-problem" role="alert">{error}</p>}
    </section>
  );
}
