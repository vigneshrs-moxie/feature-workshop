// The Inbox (#/inbox): your Portal Feedback tickets, read from Orbit with your own read-only token
// (dashboard/lib/orbit.js). Tabs: Mine (assigned to you, or watched by you, open ones only), then
// your saved views from Orbit. Each row: key, title, priority, severity, age, assignee, and "You are
// already on this" when an open job is on that ticket. A row opens the ticket: its facts,
// description, links (branches, PRs) and timeline, read again every minute while open.
//
// One action: Start (key s, on the open ticket or the row with the focus). Until jobs know their
// ticket, it opens New job and puts "ORBIT-<n>: <title>" on the clipboard to paste as the
// description (New job has no way yet to be opened with one filled in). The s key is this page's
// own listener, with the page's rules: never while typing, with a dialog open, or with keys off.
//
// While this page is open it holds /api/orbit/events, so the dashboard checks Orbit every 3 minutes
// instead of every 15; the stream also brings each new list. Nothing here writes to Orbit.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { dialogOpen, isTypingTarget } from '../app/keyRegistry';
import { useKeysSetting } from '../app/keysSetting';
import { jobHref, settingsHref } from '../app/router';
import { useUi } from '../app/ui';
import { clockTime, fullTime, relativeTime, useNow } from '../lib/time';
import { useWorkshop } from '../state/store';

// ---------- What the dashboard sends (GET /api/orbit/*) ----------

export interface OrbitStatus {
  tokenPresent: boolean;
  /** Where the token is kept: keytar or keychain (the OS store), or file (a file only you can read). */
  store: 'keytar' | 'keychain' | 'file' | null;
  url: string | null;
  savedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  lastPoll: string | null;
  lastTryAt?: string | null;
  lastError: string | null;
  errorKind: string | null;
  everyMs: number;
  watchers: number;
  waitingMs: number;
  mcp?: { name: string; file: string };
}

export interface InboxItem {
  key: string;
  number: number;
  title: string;
  type: string | null;
  status: string | null;
  priority: string | null;
  severity: string | null;
  createdAt: string | null;
  changedAt: string | null;
  assignee: { name: string; you: boolean } | null;
  why: string[];
  url: string | null;
  /** The open job already on this ticket. */
  job: { slug: string; title: string } | null;
}

export type InboxAnswer = OrbitStatus & { items: InboxItem[]; view?: string; checkedAt?: string; truncated?: boolean };

interface SavedView { id: string; name: string; isDefault: boolean }

interface TimelineEntry {
  type: 'comment' | 'event' | 'status';
  at: string;
  comment?: { body: string | null; author: { fullName: string | null; email: string } | null; deletedAt: string | null };
  event?: { kind: string; actor: { fullName: string | null; email: string } | null };
  from?: string | null;
  to?: string;
  by?: { fullName: string | null; email: string } | null;
}

interface TicketAnswer {
  audience: 'tech' | 'participant';
  ticket: { ticket?: { description?: string; subject?: string }; timeline?: TimelineEntry[]; description?: string } & Record<string, unknown>;
  item: InboxItem | null;
}

interface Reference { id: string; kind: string; label: string; url: string }

/** A stream with named events (EventSource); tests pass a fake. */
export interface OrbitStream {
  addEventListener(type: string, fn: (ev: MessageEvent) => void): void;
  close(): void;
}

// ---------- Words ----------

export const STATUS_WORDS: Record<string, string> = {
  open: 'New', backlog: 'Backlog', planning: 'Planning', ready_for_development: 'Ready for development', in_progress: 'In progress',
  code_review: 'Code review', testing: 'Testing', uat: 'UAT', ready_for_release: 'Ready for release', resolved: 'Resolved', closed: 'Closed',
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
export const statusWord = (s: string | null) => (s ? STATUS_WORDS[s] ?? capital(s) : 'Unknown');
/** Priority and severity in words (never a colour alone); "Not set" when Orbit has none, "Hidden" when it doesn't show them to you. */
export const levelWord = (v: string | null, hidden = false) => (hidden ? 'Hidden' : v ? capital(v) : 'Not set');
const person = (p: { fullName: string | null; email: string } | null | undefined) => (p ? p.fullName || p.email : 'Someone');
const minutes = (ms: number) => Math.round(ms / 60_000);

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What New job is filled in with: the ticket's key and title. */
export const startText = (item: Pick<InboxItem, 'key' | 'title'>) => `${item.key}: ${item.title}`;

// ---------- The page ----------

type Load<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; message: string };

function defaultOpenStream(url: string): OrbitStream | null {
  return typeof EventSource === 'undefined' ? null : new EventSource(url);
}

export function InboxView({ openStream = defaultOpenStream }: { openStream?: (url: string) => OrbitStream | null }) {
  const { api } = useWorkshop();
  const ui = useUi();
  const now = useNow();
  const [tab, setTab] = useState<string>('mine');
  const [mine, setMine] = useState<Load<InboxAnswer>>({ state: 'loading' });
  const [viewList, setViewList] = useState<Load<InboxAnswer> | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [open, setOpen] = useState<InboxItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState<{ text: string; onClipboard: boolean } | null>(null);
  const focused = useRef<InboxItem | null>(null);
  const [{ enabled: keysOn }] = useKeysSetting();

  const loadMine = useCallback(async (refresh = false) => {
    try {
      const data = await api.get<InboxAnswer>(`/api/orbit/inbox${refresh ? '?refresh=1' : ''}`);
      setMine({ state: 'ready', data });
    } catch (err) {
      setMine((m) => (m.state === 'ready' ? m : { state: 'error', message: message(err) }));
    }
  }, [api]);

  useEffect(() => { void loadMine(); }, [loadMine]);

  // The live stream: an open Inbox makes the dashboard check every 3 minutes, and brings each list.
  useEffect(() => {
    const es = openStream('/api/orbit/events');
    if (!es) return;
    es.addEventListener('inbox', (ev) => {
      try { setMine({ state: 'ready', data: JSON.parse(String(ev.data)) as InboxAnswer }); } catch { /* a bad line: the next one will do */ }
    });
    return () => es.close();
  }, [openStream]);

  const ready = mine.state === 'ready' ? mine.data : null;
  const configured = Boolean(ready?.tokenPresent && ready?.url);

  // The saved views, for the tabs (Orbit gives them to the feedback team only: none is fine).
  useEffect(() => {
    if (!configured) return;
    let live = true;
    api.get<{ views: SavedView[] }>('/api/orbit/views').then((r) => { if (live) setViews(r.views ?? []); }).catch(() => { if (live) setViews([]); });
    return () => { live = false; };
  }, [api, configured]);

  useEffect(() => {
    if (tab === 'mine') { setViewList(null); return; }
    let live = true;
    setViewList({ state: 'loading' });
    api.get<InboxAnswer>(`/api/orbit/inbox?view=${encodeURIComponent(tab)}`)
      .then((data) => { if (live) setViewList({ state: 'ready', data }); })
      .catch((err) => { if (live) setViewList({ state: 'error', message: message(err) }); });
    return () => { live = false; };
  }, [api, tab]);

  const start = useCallback((item: InboxItem) => {
    if (item.job) return;
    const text = startText(item);
    setCopied({ text, onClipboard: false });
    try {
      void navigator.clipboard?.writeText(text).then(() => setCopied({ text, onClipboard: true }), () => {});
    } catch { /* no clipboard here: the line below the status says the words to type */ }
    ui.openSheet({ kind: 'new-job' });
  }, [ui]);

  // s: Start on the open ticket, else the row with the focus. Same rules as every page key.
  useEffect(() => {
    if (!keysOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 's' || e.repeat || e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e.target) || dialogOpen()) return;
      const item = open ?? focused.current;
      if (!item || item.job) return;
      e.preventDefault();
      start(item);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [keysOn, open, start]);

  async function refresh() {
    setRefreshing(true);
    try { await loadMine(true); } finally { setRefreshing(false); }
  }

  const shown = tab === 'mine' ? mine : viewList ?? { state: 'loading' as const };

  return (
    <main className="pane pane-foreman" data-pane="inbox" aria-label="Inbox">
      <div className="foreman-column">
        <div className="pane-head">
          <h2 className="pane-title">Inbox</h2>
          {configured && !open && (
            <button type="button" className="btn btn-quiet" disabled={refreshing} onClick={() => void refresh()} title="Read your tickets from Orbit now instead of at the next check.">
              {refreshing ? 'Reading…' : 'Refresh'}
            </button>
          )}
        </div>
        {mine.state === 'loading' && <p className="muted" role="status">Reading your tickets…</p>}
        {mine.state === 'error' && <p className="field-problem" role="alert">The dashboard couldn’t give the inbox: {mine.message}</p>}
        {ready && !configured && <NoToken />}
        {ready && configured && (
          <>
            <StatusLine status={ready} now={now} />
            {copied && <p className="muted" role="status">{copied.onClipboard ? <>Copied “{copied.text}”: paste it into New job as the description.</> : <>Describe the job in New job as “{copied.text}”.</>}</p>}
            {open ? (
              <TicketDetail key={open.key} item={open} onBack={() => setOpen(null)} onStart={start} />
            ) : (
              <>
                {views.length > 0 && (
                  <div className="preview-tabs" role="tablist" aria-label="Inbox lists">
                    {[{ id: 'mine', name: 'Mine' }, ...views].map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        role="tab"
                        className="preview-tab"
                        aria-selected={tab === v.id}
                        onClick={() => setTab(v.id)}
                        title={v.id === 'mine' ? 'Open tickets assigned to you or that you watch.' : `Your saved view on Orbit: ${v.name}.`}
                      >
                        {v.name}
                      </button>
                    ))}
                  </div>
                )}
                {shown.state === 'loading' && <p className="muted" role="status">Reading the list…</p>}
                {shown.state === 'error' && <p className="field-problem" role="alert">{shown.message}</p>}
                {shown.state === 'ready' && (
                  <TicketTable
                    items={shown.data.items}
                    now={now}
                    empty={tab === 'mine' ? 'Nothing open is assigned to you or watched by you.' : 'No tickets in this view.'}
                    onOpen={setOpen}
                    onStart={start}
                    onFocusRow={(item) => { focused.current = item; }}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function NoToken() {
  return (
    <div className="how-body">
      <p>Your Portal Feedback tickets show here once Ground Control has your Orbit token.</p>
      <p className="muted">Make a token on Orbit’s API tokens page (it can only read), then paste it with Orbit’s address in <a href={settingsHref('workflow')}>Settings → Workflow</a>.</p>
    </div>
  );
}

/** When the list was read, how often it is read, and what went wrong (the last list stays). */
function StatusLine({ status, now }: { status: OrbitStatus; now: Date }) {
  const read = status.lastPoll ? `Read ${relativeTime(status.lastPoll, now)}${/^\d+[mhd]$/.test(relativeTime(status.lastPoll, now)) ? ' ago' : ''}` : 'Not read yet';
  const lasting = status.errorKind === 'auth' || status.errorKind === 'scope' || status.errorKind === 'token';
  return (
    <>
      {status.expired && (
        <p className="perm-warn" role="alert">Your Orbit token expired, paste a new one in <a href={settingsHref('workflow')}>Settings → Workflow</a>.</p>
      )}
      {status.lastError && (
        <p className={lasting ? 'perm-warn' : 'field-problem'} role="alert">
          {status.lastError}
          {lasting && <> <a href={settingsHref('workflow')}>Open Settings</a>.</>}
          {status.lastPoll && <> Showing the list as it was at {clockTime(status.lastPoll, now)}.</>}
        </p>
      )}
      <p className="muted" title={status.lastPoll ? fullTime(status.lastPoll) : undefined}>
        {read} · checked every {minutes(status.everyMs)} minutes while this page is open
        {status.waitingMs > 0 && <> · Orbit asked to wait, next check in about {Math.max(1, minutes(status.waitingMs))} minutes</>}
      </p>
    </>
  );
}

function TicketTable({ items, now, empty, onOpen, onStart, onFocusRow }: {
  items: InboxItem[]; now: Date; empty: string;
  onOpen: (item: InboxItem) => void; onStart: (item: InboxItem) => void; onFocusRow: (item: InboxItem | null) => void;
}) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <div className="home-table">
      <div className="home-table-scroll">
        <table style={{ minWidth: 0 }}>
          <caption className="sr-only">Your tickets, {items.length}.</caption>
          <thead>
            <tr>
              <th scope="col">Ticket</th>
              <th scope="col">Priority</th>
              <th scope="col">Severity</th>
              <th scope="col">Age</th>
              <th scope="col">Assigned to</th>
              <th scope="col"><span className="sr-only">Start</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.key} data-ticket={i.key} onFocus={() => onFocusRow(i)} onBlur={() => onFocusRow(null)}>
                <th scope="row" style={{ whiteSpace: 'normal' }}>
                  <button type="button" className="btn btn-quiet" style={{ height: 'auto', textAlign: 'left', whiteSpace: 'normal' }} onClick={() => onOpen(i)} title={`Open ${i.key}: its description, links and timeline.`}>
                    <span className="num">{i.key}</span>&nbsp;{i.title}
                  </button>
                  {i.job && (
                    <span className="muted" style={{ display: 'block', paddingLeft: 'var(--space-3)' }}>
                      You are already on this: <a href={jobHref(i.job.slug)} title="Open the job on this ticket.">{i.job.title}</a>
                    </span>
                  )}
                </th>
                <td>{levelWord(i.priority)}</td>
                <td>{levelWord(i.severity)}</td>
                <td title={i.createdAt ? `Opened ${fullTime(i.createdAt)}` : undefined}>{relativeTime(i.createdAt, now) || '—'}</td>
                <td>{i.assignee?.name ?? 'No one'}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    disabled={Boolean(i.job)}
                    onClick={() => onStart(i)}
                    aria-label={`Start a job on ${i.key}`}
                    title={i.job ? 'You are already on this: open its job instead.' : `Start a job on ${i.key}: opens New job, with the key and title copied to paste in (key: s, with the focus on this row).`}
                  >
                    Start
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const DETAIL_EVERY_MS = 60_000;

function TicketDetail({ item, onBack, onStart }: { item: InboxItem; onBack: () => void; onStart: (item: InboxItem) => void }) {
  const { api } = useWorkshop();
  const now = useNow();
  const [detail, setDetail] = useState<Load<TicketAnswer>>({ state: 'loading' });
  const [refs, setRefs] = useState<Load<Reference[]>>({ state: 'loading' });
  const [{ enabled: keysOn, hints }] = useKeysSetting();

  useEffect(() => {
    let live = true;
    const read = () => api.get<TicketAnswer>(`/api/orbit/tickets/${encodeURIComponent(item.key)}`)
      .then((d) => { if (live) setDetail({ state: 'ready', data: d }); })
      .catch((err) => { if (live) setDetail((was) => (was.state === 'ready' && !(err instanceof ApiError && err.status === 404) ? was : { state: 'error', message: message(err) })); });
    void read();
    api.get<{ references: Reference[] }>(`/api/orbit/tickets/${encodeURIComponent(item.key)}/references`)
      .then((r) => { if (live) setRefs({ state: 'ready', data: r.references ?? [] }); })
      .catch((err) => { if (live) setRefs({ state: 'error', message: message(err) }); });
    const id = setInterval(() => void read(), DETAIL_EVERY_MS); // a ticket open here is read again every minute
    return () => { live = false; clearInterval(id); };
  }, [api, item.key]);

  const current = detail.state === 'ready' && detail.data.item ? { ...item, ...detail.data.item } : item;
  const body = detail.state === 'ready' ? detail.data.ticket : null;
  const description = String(body?.ticket?.description ?? body?.description ?? '');
  const timeline = Array.isArray(body?.timeline) ? body.timeline : [];
  const hidden = detail.state === 'ready' && detail.data.audience === 'participant';

  return (
    <section aria-label={`${current.key}: ${current.title}`}>
      <div className="doc-reader-head">
        <button type="button" className="btn btn-quiet doc-back" onClick={onBack} title="Back to the list."><span className="doc-back-arrow" aria-hidden="true">←</span>All tickets</button>
        <h3 className="doc-title"><span className="num">{current.key}</span> {current.title}</h3>
        <p className="job-facts muted">
          <span>Status: {statusWord(current.status)}</span>
          <span>Priority: {levelWord(current.priority, hidden)}</span>
          <span>Severity: {levelWord(current.severity, hidden)}</span>
          <span title={current.createdAt ? fullTime(current.createdAt) : undefined}>Opened {relativeTime(current.createdAt, now) || '—'}</span>
          <span>Assigned to: {current.assignee?.name ?? 'No one'}</span>
        </p>
        <div className="doc-actions">
          <button
            type="button"
            className="btn"
            disabled={Boolean(current.job)}
            onClick={() => onStart(current)}
            title={current.job ? 'You are already on this: open its job instead.' : 'Start a job on this ticket: opens New job, with the key and title copied to paste in (key: s).'}
          >
            Start {keysOn && hints && <kbd className="kbd key-hint" aria-hidden="true">s</kbd>}
          </button>
          {current.job && <span>You are already on this: <a href={jobHref(current.job.slug)}>{current.job.title}</a></span>}
          {current.url && <a className="btn btn-quiet" href={current.url} target="_blank" rel="noreferrer noopener" title="Open the ticket on Orbit, in a new tab.">Open on Orbit</a>}
        </div>
      </div>
      {detail.state === 'loading' && <p className="muted" role="status">Reading the ticket…</p>}
      {detail.state === 'error' && <p className="field-problem" role="alert">{detail.message}</p>}
      {description && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{description}</p>}

      <h4 className="doc-group-title">Links on the ticket</h4>
      {refs.state === 'loading' && <p className="muted">Reading the links…</p>}
      {refs.state === 'error' && <p className="field-problem">{refs.message}</p>}
      {refs.state === 'ready' && (refs.data.length ? (
        <ul>
          {refs.data.map((r) => <li key={r.id}><span className="chip">{capital(r.kind)}</span> <a href={r.url} target="_blank" rel="noreferrer noopener">{r.label}</a></li>)}
        </ul>
      ) : <p className="muted">No branches, PRs or links yet.</p>)}

      <h4 className="doc-group-title">Timeline</h4>
      {detail.state === 'ready' && !timeline.length && <p className="muted">Nothing has happened on this ticket yet.</p>}
      <ol className="thread" style={{ listStyle: 'none', padding: 0 }}>
        {timeline.map((e, n) => (
          <li key={`${e.at}-${n}`} className="thread-item">
            <p className="thread-meta"><span className="who">{e.type === 'comment' ? person(e.comment?.author) : e.type === 'status' ? person(e.by) : person(e.event?.actor)}</span><span className="thread-time" title={fullTime(e.at)}>{relativeTime(e.at, now)}</span></p>
            {e.type === 'comment' && <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.comment?.deletedAt ? <span className="muted">This comment was deleted.</span> : e.comment?.body ?? ''}</p>}
            {e.type === 'status' && <p className="thread-line">Status: {e.from ? `${statusWord(e.from)} → ` : ''}{statusWord(e.to ?? null)}</p>}
            {e.type === 'event' && <p className="thread-line">{capital(e.event?.kind ?? 'change')}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
