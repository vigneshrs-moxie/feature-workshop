// The Inbox on the hosted site (packet 2C): the laptop's own Inbox screen (views/Inbox.tsx) in hosted
// mode, reading the inbox the site keeps for you (GET /api/orbit/inbox). Start sends the ticket to
// your laptop (POST /api/orbit/start):
//   one laptop       it goes at once; the row then says "Starting on <laptop>…", or "Starts when
//                    your laptop is back" while the laptop is off, with Cancel until it is picked up
//   several          a sheet asks which, one row each (R's Choice control), saying which are on
//   none             the sheet says how to pair one
// A 401 from any of it (the session ended) brings the sign-in page back.
import { useCallback, useMemo, useState } from 'react';
import { ApiError, type ApiClient } from '../../api/client';
import type { InboxItem } from '../../api/types';
import { Button } from '../../components/Button';
import { OptionRow } from '../../components/Choice';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { relativeTime, useNow } from '../../lib/time';
import { createStore, WorkshopContext } from '../../state/store';
import { InboxView, type HostedInbox } from '../Inbox';
import { isSignedOut, words, type HostedProps } from './shared';
import type { Laptop } from './types';

export const ORBIT_SETTINGS_HREF = '#/settings/orbit';
const NO_STREAM = () => null;

/** The API, with a 401 telling the page the session ended. */
function watched(api: ApiClient, onSignedOut: () => void): ApiClient {
  const wrap = <A extends unknown[], T>(fn: (...a: A) => Promise<T>) => async (...a: A): Promise<T> => {
    try { return await fn(...a); } catch (err) { if (isSignedOut(err)) onSignedOut(); throw err; }
  };
  return { ...api, get: wrap(api.get.bind(api)), post: wrap(api.post.bind(api)), del: wrap(api.del.bind(api)) } as ApiClient;
}

type Choosing = { item: InboxItem; laptops: Laptop[]; picked: number | null; busy: boolean; problem: string | null };

/** Which laptop starts it: one row each, online ones first. */
export function ChooseLaptopSheet({ choosing, onPick, onStart, onClose }: {
  choosing: Choosing; onPick: (id: number) => void; onStart: () => void; onClose: () => void;
}) {
  const now = useNow(30_000);
  const { item, laptops, picked, busy, problem } = choosing;
  if (!laptops.length) {
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
  const sorted = [...laptops].sort((a, b) => Number(b.online) - Number(a.online));
  const pickedLaptop = laptops.find((l) => l.id === picked) ?? null;
  return (
    <Sheet title={`Which laptop starts ${item.key}?`} onClose={onClose} busy={busy} className="hosted-start-sheet">
      <p className="hosted-start-ticket"><span className="num ticket-key">{item.key}</span> {item.title}</p>
      <fieldset className="hosted-laptop-choice" disabled={busy}>
        <legend className="sr-only">Your laptops</legend>
        {sorted.map((l) => (
          <OptionRow key={l.id} type="radio" name="start-laptop" value={String(l.id)} checked={picked === l.id} onChange={() => onPick(l.id)} data-autofocus={picked === l.id ? true : undefined}>
            <span className="hosted-choice-words">
              <span className="hosted-choice-name">{l.name}</span>
              <span className="muted hosted-choice-meta">
                {l.online
                  ? <span className="hosted-online is-online"><Icon name="circle-dot" size={12} />Online: it starts in a moment</span>
                  : <span className="hosted-online is-offline"><Icon name="circle-dashed" size={12} />Off{l.lastSeenAt ? ` · seen ${relativeTime(l.lastSeenAt, now)}` : ''}: it starts when the laptop is back</span>}
                {' · '}{l.os}
              </span>
            </span>
          </OptionRow>
        ))}
      </fieldset>
      {problem && <p className="field-problem" role="alert">{problem}</p>}
      <div className="sheet-actions">
        <Button kind="quiet" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button kind="primary" onClick={onStart} busy={busy} disabled={!pickedLaptop} title={pickedLaptop ? `Send ${item.key} to ${pickedLaptop.name}.` : 'Pick a laptop first.'}>
          {pickedLaptop ? `Start on ${pickedLaptop.name}` : 'Start'}
        </Button>
      </div>
    </Sheet>
  );
}

export function HostedInboxPage({ api: given, onSignedOut }: HostedProps) {
  const api = useMemo(() => watched(given, onSignedOut), [given, onSignedOut]);
  const workshop = useMemo(() => ({ api, store: createStore() }), [api]);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<Choosing | null>(null);

  const send = useCallback(async (item: InboxItem, laptopId?: number) => {
    await api.post('/api/orbit/start', laptopId === undefined ? { key: item.key } : { key: item.key, laptopId });
    setVersion((v) => v + 1);
  }, [api]);

  const onStart = useCallback(async (item: InboxItem) => {
    setNotice(null);
    let laptops: Laptop[];
    try { laptops = (await api.get<{ laptops: Laptop[] }>('/api/laptops')).laptops; } catch (err) {
      if (!isSignedOut(err)) setNotice(`${item.key} wasn’t started: ${words(err)}`);
      return;
    }
    if (laptops.length === 1) {
      try { await send(item, laptops[0].id); } catch (err) { if (!isSignedOut(err)) setNotice(`${item.key} wasn’t started: ${words(err)}`); }
      return;
    }
    const online = laptops.filter((l) => l.online);
    setChoosing({ item, laptops, picked: online.length === 1 ? online[0].id : null, busy: false, problem: null });
  }, [api, send]);

  const startPicked = useCallback(async () => {
    if (!choosing || choosing.picked === null) return;
    setChoosing({ ...choosing, busy: true, problem: null });
    try {
      await send(choosing.item, choosing.picked);
      setChoosing(null);
    } catch (err) {
      if (isSignedOut(err)) return;
      setChoosing((c) => (c ? { ...c, busy: false, problem: err instanceof ApiError || err instanceof Error ? err.message : String(err) } : c));
    }
  }, [choosing, send]);

  const onCancel = useCallback(async (item: InboxItem) => {
    if (!item.start) return;
    setNotice(null);
    try { await api.del(`/api/orbit/start/${item.start.id}`); } catch (err) {
      if (!isSignedOut(err)) setNotice(`${item.key} wasn’t cancelled: ${words(err)}`);
    }
    setVersion((v) => v + 1);
  }, [api]);

  const hosted: HostedInbox = { settingsHref: ORBIT_SETTINGS_HREF, onStart: (i) => { void onStart(i); }, onCancel: (i) => { void onCancel(i); }, version, notice };
  return (
    <WorkshopContext.Provider value={workshop}>
      <InboxView hosted={hosted} openStream={NO_STREAM} />
      {choosing && (
        <ChooseLaptopSheet
          choosing={choosing}
          onPick={(id) => setChoosing((c) => (c ? { ...c, picked: id } : c))}
          onStart={() => void startPicked()}
          onClose={() => setChoosing(null)}
        />
      )}
    </WorkshopContext.Provider>
  );
}
