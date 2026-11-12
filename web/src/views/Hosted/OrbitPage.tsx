// Settings → Orbit on the hosted site (packet 2C): your own read-only Orbit token, so the site can
// fill your Inbox while your laptop is closed (hosted/site/routes-orbit.js). Paste it once; the
// site checks it with one call to Orbit and keeps it encrypted. After that this page shows only
// "Saved · expires 12 Dec" and Remove: the token is never shown again, and no answer carries it.
// Past its date, or refused by Orbit, the form comes back to paste a new one.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { AutoStartSetting, InboxAnswer, OrbitStatus, Snapshot } from '../../api/types';
import { AutoStartGroup } from '../Settings/AutoStartGroup';
import { AUTO_MAX } from '../../home/autoTab';
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

/** Auto start from the site (I4): the site only queues it for the laptop; these say where it is. */
export const AUTO_START_SENT = 'Sent to your laptop. It takes effect there.';
export const AUTO_START_WAITING = 'Waiting for your laptop.';
export const AUTO_START_NOT_TAKEN = 'Your laptop did not take this change.';
/** After its 10 minutes of looking (M8): the site keeps the command until the laptop collects it. */
export const AUTO_START_KEPT = 'Your laptop has not answered. The change is kept and takes effect when it is back online.';
/** How often the page reads the laptop's mirrored value after a change, and for how long. */
const AUTO_LOOK_MS = 3000;
const AUTO_TAKE_MS = 60_000;
const AUTO_WAIT_MS = 10 * 60_000;
// N counts too (5 when a side has none), so a change of N alone waits for the laptop like any other.
const sameAuto = (a: AutoStartSetting | undefined, b: AutoStartSetting | undefined) => (a?.on === true) === (b?.on === true) && (a?.tag ?? '') === (b?.tag ?? '')
  && (a?.max ?? AUTO_MAX.default) === (b?.max ?? AUTO_MAX.default);

export function OrbitPage({ api, onSignedOut }: HostedProps) {
  const id = useId();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [token, setToken] = useState('');
  const [days, setDays] = useState<Lifetime>('30');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const slow = useDelayedFlag(load.state === 'loading');
  // Auto start: the setting your laptop mirrors, and whether Orbit shows tags to your token (from the inbox the site keeps).
  const [auto, setAuto] = useState<AutoStartSetting | undefined>(undefined);
  const [tagsShown, setTagsShown] = useState<boolean | undefined>(undefined);
  // A change sent to the laptop: what was sent, the laptop's value before the first change still pending,
  // the earlier changes still on their way (a step sent before this one), whether it was there, and when.
  const [autoSent, setAutoSent] = useState<{ want: AutoStartSetting; seq: number; was: AutoStartSetting | undefined; onWay: AutoStartSetting[]; online: boolean; at: number } | null>(null);
  // Each change's number in the order sent, and what the last one sent should leave on the laptop
  // (null once the wait has ended).
  const autoSeq = useRef(0);
  const autoLastWant = useRef<AutoStartSetting | null>(null);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  // Counts the changes reported as not taken, so the group forgets the N it sent (N3).
  const [autoNotTaken, setAutoNotTaken] = useState(0);
  // Until the laptop mirrors it, the switch shows the laptop's own value; then the line goes, or says it
  // was not taken (the value came back different, or nothing changed for a minute while it was there).
  useEffect(() => {
    if (!autoSent) return;
    let live = true;
    const look = async () => {
      const s = await Promise.resolve(api.get<Pick<Snapshot, 'meta'>>('/api/snapshot')).catch(() => null);
      if (!live || !s) return;
      const now = s.meta?.settings?.workflow?.autoStart;
      setAuto(now);
      const waited = Date.now() - autoSent.at;
      // The laptop still on the old value, or on an earlier change on its way: keep waiting.
      const between = sameAuto(now, autoSent.was) || autoSent.onWay.some((w) => sameAuto(now, w));
      if (sameAuto(now, autoSent.want)) { setAutoNote(null); setAutoSent(null); autoLastWant.current = null; }
      else if (!between || (autoSent.online && waited > AUTO_TAKE_MS)) { setAutoNote(AUTO_START_NOT_TAKEN); setAutoSent(null); autoLastWant.current = null; setAutoNotTaken((n) => n + 1); }
      else if (waited > AUTO_WAIT_MS) { setAutoNote(AUTO_START_KEPT); setAutoSent(null); autoLastWant.current = null; }
    };
    void look();
    const timer = setInterval(() => { void look(); }, AUTO_LOOK_MS);
    return () => { live = false; clearInterval(timer); };
  }, [api, autoSent]);
  useEffect(() => {
    let live = true;
    Promise.resolve(api.get<Pick<Snapshot, 'meta'>>('/api/snapshot')).then((s) => { if (live) setAuto(s?.meta?.settings?.workflow?.autoStart); }).catch(() => {});
    Promise.resolve(api.get<InboxAnswer>('/api/orbit/inbox')).then((a) => {
      if (!live || !a?.items?.length) return;
      setTagsShown(a.items.every((i) => i.tagsKnown === true));
    }).catch(() => {});
    return () => { live = false; };
  }, [api]);

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
    if (busy) return;
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
      <AutoStartGroup
        className="hosted-auto-start"
        setting={auto}
        tagsShown={tagsShown}
        laptopNote={autoNote}
        notTaken={autoNotTaken}
        onSave={async (next) => {
          // Numbered, and what to wait for worked out, before it goes, so the wait follows the order the
          // commands were sent, not the order the site answered (B). Only the number box sends max; any
          // other change keeps the laptop's N, or the N still on its way (N2).
          const seq = ++autoSeq.current;
          const before = autoLastWant.current;
          const keptMax = before?.max ?? auto?.max;
          const want = next.max === undefined && keptMax !== undefined ? { ...next, max: keptMax } : next;
          autoLastWant.current = want;
          let r: { laptop?: { online?: boolean } } | undefined;
          try { r = await api.post<{ laptop?: { online?: boolean } } | undefined>('/api/orbit/auto-start', next); } catch (err) {
            if (autoLastWant.current === want) autoLastWant.current = before;
            throw err;
          }
          const online = r?.laptop?.online === true;
          setAutoNote(online ? AUTO_START_SENT : AUTO_START_WAITING);
          setAutoSent((prev) => {
            // Sent before the pending change but answered after it: it is on its way, not the last word.
            if (prev && prev.seq > seq) return { ...prev, onWay: [...prev.onWay, want] };
            // A change while another is pending (N1): keep the first old value, and the earlier change is on its way.
            return { want, seq, was: prev ? prev.was : auto, onWay: prev ? [...prev.onWay, prev.want] : [], online, at: Date.now() };
          });
        }}
      />
    </HostedSettings>
  );
}
