// The Inbox on the hosted site (packet 2C): the laptop's own Inbox screen (views/Inbox.tsx) in hosted
// mode, reading the inbox the site keeps for you (GET /api/orbit/inbox). Start sends the ticket to
// your laptop (POST /api/orbit/start). Start opens the same New job form as on the laptop, filled in
// from the ticket (the repository is one of the laptop's, by name; with several laptops the form
// asks which). Starting it, the row says "Starting on <laptop>…", or "Starts when your laptop is
// back" while the laptop is off, with Cancel until it is picked up. With no laptop paired, a sheet
// says how to pair one.
// A 401 from any of it (the session ended) brings the sign-in page back.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../../api/client';
import type { AutoStartSetting, InboxAnswer, InboxItem, InboxLaptop, Snapshot } from '../../api/types';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { createStore, WorkshopContext } from '../../state/store';
import { NewJobSheet, type StartChoices } from '../JobSheets/NewJobSheet';
import { InboxView, kindOfTicket, startText, type HostedInbox } from '../Inbox';
import { isSignedOut, words, type HostedProps } from './shared';

export const ORBIT_SETTINGS_HREF = '#/settings/orbit';
const NO_STREAM = () => null;

/** The API, with a 401 telling the page the session ended. */
function watched(api: ApiClient, onSignedOut: () => void): ApiClient {
  const wrap = <A extends unknown[], T>(fn: (...a: A) => Promise<T>) => async (...a: A): Promise<T> => {
    try { return await fn(...a); } catch (err) { if (isSignedOut(err)) onSignedOut(); throw err; }
  };
  return { ...api, get: wrap(api.get.bind(api)), post: wrap(api.post.bind(api)), del: wrap(api.del.bind(api)) } as ApiClient;
}

/** No laptop is paired: say how to pair one. */
export function PairFirstSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Pair a laptop first" onClose={onClose} className="hosted-start-sheet">
      <p>A job runs on one of your laptops, and none is paired yet. Settings → Laptops shows the one command to run on the laptop; then press Start again.</p>
      <div className="sheet-actions">
        <Button kind="quiet" onClick={onClose}>Not now</Button>
        <Button kind="primary" href="#/settings/laptops" onClick={onClose} data-autofocus>Open Settings → Laptops</Button>
      </div>
    </Sheet>
  );
}

export function HostedInboxPage({ api: given, onSignedOut }: HostedProps) {
  const api = useMemo(() => watched(given, onSignedOut), [given, onSignedOut]);
  const workshop = useMemo(() => ({ api, store: createStore() }), [api]);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<{ item: InboxItem; laptops: InboxLaptop[] } | null>(null);
  const [pairing, setPairing] = useState(false);
  // The ticket whose Start or Cancel is out: its button spins, and nothing else starts meanwhile.
  const [sending, setSending] = useState<string | null>(null);
  const out = useRef(false);
  // Auto start's setting, from the laptop's settings the site mirrors: it marks the rows that start by themselves.
  const [autoStart, setAutoStart] = useState<AutoStartSetting | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve(api.get<Pick<Snapshot, 'meta'>>('/api/snapshot')).then((s) => { if (live) setAutoStart(s?.meta?.settings?.workflow?.autoStart ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [api, version]);

  const send = useCallback(async (item: InboxItem, choices: StartChoices) => {
    await api.post('/api/orbit/start', { key: item.key, ...choices });
    setVersion((v) => v + 1);
  }, [api]);

  /** Run one Start or Cancel at a time, its button spinning meanwhile. */
  const sendingFor = useCallback(async (item: InboxItem, fn: () => Promise<void>) => {
    if (out.current) return;
    out.current = true;
    setSending(item.key);
    try { await fn(); } finally { out.current = false; setSending(null); }
  }, []);

  const onStart = useCallback((item: InboxItem) => sendingFor(item, async () => {
    setNotice(null);
    let laptops: InboxLaptop[];
    try { laptops = (await api.get<InboxAnswer>('/api/orbit/inbox')).laptops ?? []; } catch (err) {
      if (!isSignedOut(err)) setNotice(`${item.key} wasn’t started: ${words(err)}`);
      return;
    }
    if (!laptops.length) { setPairing(true); return; }
    setForm({ item, laptops });
  }), [api, sendingFor]);

  const onCancel = useCallback((item: InboxItem) => sendingFor(item, async () => {
    const start = item.start;
    if (!start) return;
    setNotice(null);
    try { await api.del(`/api/orbit/start/${start.id}`); } catch (err) {
      if (!isSignedOut(err)) setNotice(`${item.key} wasn’t cancelled: ${words(err)}`);
    }
    setVersion((v) => v + 1);
  }), [api, sendingFor]);

  // Built once per form: a new object on every render would reset the repository the person picked.
  const startForm = useMemo(() => (form ? { laptops: form.laptops, onStart: (choices: StartChoices) => send(form.item, choices) } : null), [form, send]);
  const hosted: HostedInbox = { settingsHref: ORBIT_SETTINGS_HREF, onStart: (i) => { void onStart(i); }, onCancel: (i) => { void onCancel(i); }, version, notice, sending, autoStart };
  return (
    <WorkshopContext.Provider value={workshop}>
      <InboxView hosted={hosted} openStream={NO_STREAM} />
      {form && startForm && (
        <NewJobSheet
          description={startText(form.item)}
          ticket={{ key: form.item.key, title: form.item.title, url: form.item.url }}
          kind={kindOfTicket(form.item)}
          hosted={startForm}
          onClose={() => setForm(null)}
        />
      )}
      {pairing && <PairFirstSheet onClose={() => setPairing(false)} />}
    </WorkshopContext.Provider>
  );
}
