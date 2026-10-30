// The hosted site's live stream (packet 2B), as one EventSource to the store's live sync
// (state/live.ts openStream). Underneath:
//   - each server-sent stream ends by itself before the site's time limit, saying `event: bye`;
//     the next one opens at once from the last event seen (?since=), with nothing shown: no
//     "reconnecting", no fresh snapshot, so nothing on the page flashes or jumps;
//   - when the stream can't be had (three tries in a row fail before any event arrives), it asks
//     /api/events/poll every 5 seconds instead, and tries the stream again every minute.
// A real drop (the site gone) still reaches live.ts as an error, which says so and catches up.
import type { EventSourceLike } from '../../state/live';

const OPEN = 1;
const CLOSED = 2;
export const POLL_MS = 5000;
const STREAM_AGAIN_MS = 60_000;
const TRIES = 3;

interface RawSource {
  readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  addEventListener(type: string, fn: (ev: MessageEvent) => void): void;
  close(): void;
}

export interface HostedStreamOptions {
  open?: (url: string) => RawSource;
  fetchJson?: (url: string) => Promise<{ events: unknown[]; seq: number }>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

const sinceOf = (url: string): number => Number(new URL(url, 'http://x').searchParams.get('since') ?? 0) || 0;
const withSince = (url: string, since: number) => {
  const u = new URL(url, 'http://x');
  u.searchParams.set('since', String(since));
  return `${u.pathname}${u.search}`;
};

export function hostedStream(url: string, options: HostedStreamOptions = {}): EventSourceLike {
  const noStream = !options.open && typeof EventSource === 'undefined';
  return stream(url, options, noStream);
}

function stream(url: string, {
  open = (u) => new EventSource(u) as unknown as RawSource,
  fetchJson = async (u) => { const r = await fetch(u, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }); if (!r.ok) throw new Error(String(r.status)); return r.json(); },
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}: HostedStreamOptions, noStream: boolean): EventSourceLike {
  let seq = sinceOf(url);
  let source: RawSource | null = null;
  let closed = false;
  let failures = 0;
  let polling = false;
  let timer: unknown = null;
  let retry: unknown = null;

  const out: EventSourceLike = { readyState: 0, onopen: null, onmessage: null, onerror: null, close };

  function deliver(data: string) {
    try { const e = JSON.parse(data) as { seq?: number }; if (Number.isInteger(e.seq) && (e.seq as number) > seq) seq = e.seq as number; } catch { /* the store skips it too */ }
    out.onmessage?.(new MessageEvent('message', { data }));
  }

  function connect() {
    if (closed) return;
    const s = open(withSince(url, seq));
    source = s;
    let heard = false;
    s.onopen = (ev) => { if (source !== s) return; out.readyState = OPEN; out.onopen?.(ev); };
    s.onmessage = (ev) => { if (source !== s) return; heard = true; failures = 0; deliver(String(ev.data)); };
    s.addEventListener('bye', () => {
      // The site ends each stream before its time limit: carry on from here, quietly.
      if (source !== s) return;
      failures = 0;
      s.close();
      connect();
    });
    s.onerror = (ev) => {
      if (source !== s || closed) return;
      if (!heard) failures++;
      if (failures >= TRIES) { s.close(); source = null; startPolling(); return; }
      if (s.readyState === CLOSED) { out.readyState = CLOSED; out.onerror?.(ev); }
      // Otherwise the browser reconnects by itself, with Last-Event-ID.
    };
  }

  function startPolling() {
    if (polling || closed) return;
    polling = true;
    out.readyState = OPEN;
    const tick = async () => {
      if (closed || !polling) return;
      try {
        const r = await fetchJson(`/api/events/poll?since=${seq}`);
        for (const e of r.events ?? []) deliver(JSON.stringify(e));
      } catch { /* the next tick tries again */ }
      if (!closed && polling) timer = setTimer(() => { void tick(); }, POLL_MS);
    };
    void tick();
    retry = setTimer(() => { polling = false; if (timer !== null) clearTimer(timer); failures = 0; connect(); }, STREAM_AGAIN_MS);
  }

  function close() {
    closed = true;
    out.readyState = CLOSED;
    source?.close();
    source = null;
    polling = false;
    for (const t of [timer, retry]) if (t !== null) clearTimer(t);
  }

  if (noStream) startPolling();
  else connect();
  return out;
}
