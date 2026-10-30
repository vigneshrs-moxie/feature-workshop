// The Inbox (#/inbox): your Portal Feedback tickets, read from Orbit with your own read-only token
// (dashboard/lib/orbit.js). Tabs: Mine (assigned to you, or watched by you, open ones only), then
// your saved views from Orbit. Most severe first, then oldest; severity only (no priority here).
// Each row: severity (icon and word), key and title, age, who is on it, and Start, or the way to
// the job already on that ticket. A row opens the ticket: its facts, description, links (branches,
// PRs) and timeline, read again every minute while open.
//
// The next-step bar names one ticket: the most severe with no job, nobody on it first. Start (key s)
// works on the open ticket, the row with the focus, else the bar's ticket. It opens New job with the
// ticket filled in (read-only) and "ORBIT-<n>: <title>" as the description. The s key is the
// registry's (inbox-start, app/keyRegistry.ts): never while typing, with a dialog open, or with keys off.
// Start as stack (Shift+S, inbox-start-stack) sits beside Start on every row, the open ticket and the
// bar, and says when to use one: New job on the same ticket, to run as a stack (views/Stack).
//
// While this page is open it holds /api/orbit/events, so the dashboard checks Orbit every 3 minutes
// instead of every 15; the stream also brings each new list. Nothing here writes to Orbit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useKeyScope } from '../app/keyRegistry';
import { jobHref, settingsHref } from '../app/router';
import { useUi, type SheetState } from '../app/ui';
import { Icon, type IconName } from '../components/Icon';
import { Button } from '../components/Button';
import { More } from '../components/More';
import { Peek, usePeekAddress, usePeekKeys } from '../components/Peek';
import { Pending, Skeleton } from '../components/Pending';
import { Hero, NextBar, Page, type GuideSpec } from '../components/page/Page';
import { useDelayedFlag } from '../lib/useDelayedFlag';
import { clockTime, fullTime, relativeTime, useNow } from '../lib/time';
import { useWorkshop, useWorkshopState } from '../state/store';

// ---------- What the dashboard sends (GET /api/orbit/*) ----------

export type { InboxAnswer, InboxItem, OrbitStatus } from '../api/types';
import type { InboxAnswer, InboxItem, Job, OrbitStatus } from '../api/types';
import { BRAND } from '../app/brand';

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
/** Severity in words (never a colour alone); "Not set" when Orbit has none, "Hidden" when it doesn't show it to you. */
export const levelWord = (v: string | null, hidden = false) => (hidden ? 'Hidden' : v ? capital(v) : 'Not set');
const person = (p: { fullName: string | null; email: string } | null | undefined) => (p ? p.fullName || p.email : 'Someone');
const minutes = (ms: number) => Math.round(ms / 60_000);

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What New job is filled in with: the ticket's key and title. */
export const startText = (item: Pick<InboxItem, 'key' | 'title'>) => `${item.key}: ${item.title}`;

/** When to use Start as stack, in one sentence (its button says it). */
export const STACK_WHEN = 'For a big ticket: the work is split into parts that are built side by side, then joined in order.';

/** New job on a ticket, to run as a stack (Start as stack, S). */
export function stackSheet(item: Pick<InboxItem, 'key' | 'title' | 'url'>): SheetState {
  return { kind: 'new-job', description: startText(item), ticket: { key: item.key, title: item.title, url: item.url }, stack: true };
}

// ---------- Severity, and the order ----------

/** Orbit's severities, most severe first (dashboard/lib/orbit.js). */
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_ICON: Record<string, IconName> = { critical: 'flame', high: 'alert', medium: 'circle-dot', low: 'circle' };
const rankOf = (sev: string | null) => (sev && sev in SEVERITY_RANK ? SEVERITY_RANK[sev] : 9);
const opened = (i: InboxItem) => (i.createdAt ? Date.parse(i.createdAt) || Infinity : Infinity);

/** A participant's rows come without severity: their address is the public one, not /admin/. */
export const severityHidden = (i: Pick<InboxItem, 'severity' | 'url'>) => !i.severity && Boolean(i.url) && !i.url!.includes('/admin/feedback/');

/** The Inbox's order: most severe first, then the oldest. */
export function sortInbox(items: readonly InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => rankOf(a.severity) - rankOf(b.severity) || opened(a) - opened(b));
}

/** The ticket the next-step bar names: no job on it yet, nobody on it first, then the order above. */
export function nextTicket(items: readonly InboxItem[]): InboxItem | null {
  const free = sortInbox(items).filter((i) => !i.job);
  return free.find((i) => !i.assignee) ?? free[0] ?? null;
}

/**
 * The two groups (like Linear's Priority tab): a ticket needs a decision while it has no job yet and
 * is critical, high, not triaged, or its severity is hidden from you; everything else can wait.
 */
export function needsDecision(i: Pick<InboxItem, 'job' | 'severity' | 'url'>): boolean {
  if (i.job) return false;
  if (severityHidden(i)) return true;
  return !i.severity || i.severity === 'critical' || i.severity === 'high';
}

export function Severity({ item, hidden = severityHidden(item) }: { item: Pick<InboxItem, 'severity' | 'url'>; hidden?: boolean }) {
  const sev = hidden ? null : item.severity;
  const icon: IconName = hidden ? 'eye-off' : sev ? SEVERITY_ICON[sev] ?? 'circle' : 'minus';
  return (
    <span className={`sev sev-${hidden ? 'hidden' : sev ?? 'none'}`}>
      <Icon name={icon} size={16} />
      <span className="sev-word">{levelWord(sev, hidden)}</span>
    </span>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

function WhoIsOn({ who }: { who: InboxItem['assignee'] }) {
  if (!who) return <span className="who-on"><span className="avatar is-empty" aria-hidden="true">?</span>No one</span>;
  return <span className="who-on"><span className={`avatar${who.you ? ' is-you' : ''}`} aria-hidden="true">{initials(who.name)}</span>{who.you ? 'You' : who.name}</span>;
}

const INBOX_GUIDE: GuideSpec = {
  id: 'inbox',
  title: 'How the Inbox works',
  done: 'Show me my tickets',
  cards: [
    { icons: ['inbox'], title: 'Your Orbit tickets', say: 'The Portal Feedback tickets assigned to you or that you watch, most severe first, then oldest.' },
    { icons: ['inbox', 'clipboard'], title: 'Start makes a job', say: 'Start opens a new job on the ticket. The Foreman reads the ticket first and writes a brief.' },
    { icons: ['hand', 'check'], title: 'You say go at each step', say: 'Nothing moves on without you: each step waits on the Desk for your go or no go.' },
  ],
};

// ---------- The page ----------

type Load<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; message: string };

function defaultOpenStream(url: string): OrbitStream | null {
  return typeof EventSource === 'undefined' ? null : new EventSource(url);
}

export function InboxView({ openStream = defaultOpenStream }: { openStream?: (url: string) => OrbitStream | null }) {
  const { api } = useWorkshop();
  const { jobs } = useWorkshopState();
  const ui = useUi();
  const now = useNow();
  const [tab, setTab] = useState<string>('mine');
  const [mine, setMine] = useState<Load<InboxAnswer>>({ state: 'loading' });
  const [viewList, setViewList] = useState<Load<InboxAnswer> | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [peek, setPeek] = usePeekAddress();
  const [refreshing, setRefreshing] = useState(false);
  const focused = useRef<InboxItem | null>(null);

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
    ui.openSheet({ kind: 'new-job', description: startText(item), ticket: { key: item.key, title: item.title, url: item.url } });
  }, [ui]);
  // Start as stack (S): New job with the ticket filled in, to run as a stack (views/Stack).
  const startStack = useCallback((item: InboxItem) => {
    if (item.job) return;
    ui.openSheet(stackSheet(item));
  }, [ui]);

  const shown = tab === 'mine' ? mine : viewList ?? { state: 'loading' as const };
  const items = useMemo(() => (shown.state === 'ready' ? sortInbox(shown.data.items) : []), [shown]);
  const pick = useMemo(() => nextTicket(items), [items]);
  // The ticket in the quick look (#/inbox?peek=ORBIT-12): from this list, else the last one seen.
  const lastOpen = useRef<InboxItem | null>(null);
  const open = peek ? items.find((i) => i.key === peek) ?? (lastOpen.current?.key === peek ? lastOpen.current : null) : null;
  lastOpen.current = open;
  const showLoading = useDelayedFlag(mine.state === 'loading', 200, 400);
  const showListLoading = useDelayedFlag(shown.state === 'loading', 200, 400);

  // s: Start on the open ticket, else the row with the focus, else the bar's ticket.
  useKeyScope('inbox', {
    'inbox-start': () => {
      const item = open ?? focused.current ?? pick;
      if (!item || item.job) return false;
      start(item);
    },
    'inbox-start-stack': () => {
      const item = open ?? focused.current ?? pick;
      if (!item || item.job) return false;
      startStack(item);
    },
  });

  async function refresh() {
    setRefreshing(true);
    try { await loadMine(true); } finally { setRefreshing(false); }
  }

  const lists = [{ id: 'mine', name: 'Mine' }, ...views];
  const head = configured ? (
    <>
      <div className="seg" role="tablist" aria-label="Inbox lists">
        {lists.map((v) => {
          const count = v.id === 'mine' ? ready?.items.length : v.id === tab && viewList?.state === 'ready' ? viewList.data.items.length : undefined;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              className="tab seg-tab"
              aria-selected={tab === v.id}
              onClick={() => setTab(v.id)}
              title={v.id === 'mine' ? 'Open tickets assigned to you or that you watch.' : `Your saved view on Orbit: ${v.name}.`}
            >
              <span className="seg-name">{v.name}</span>
              {count !== undefined && <span className="seg-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
            </button>
          );
        })}
      </div>
      <span className="spacer" />
      {ready && <ReadLine status={ready} now={now} />}
      <Button kind="quiet" size="sm" icon="refresh" busy={refreshing} onClick={() => void refresh()} title="Read your tickets from Orbit now instead of at the next check.">
        Read now
      </Button>
    </>
  ) : null;

  const decide = items.filter(needsDecision);
  const wait = items.filter((i) => !needsDecision(i));
  const order = [...decide, ...wait].map((i) => i.key);
  const table = (rows: InboxItem[], caption: string) => (
    <TicketTable
      items={rows}
      caption={caption}
      jobs={jobs}
      pick={pick}
      now={now}
      peeked={open?.key ?? null}
      onOpen={(item) => setPeek(item.key)}
      onStart={start}
      onStartStack={startStack}
      onFocusRow={(item) => { focused.current = item; }}
    />
  );

  return (
    <Page label="Inbox" title="Inbox" className="page-inbox" head={head} guide={INBOX_GUIDE}>
      {showLoading && <p className="muted" role="status">Reading your tickets…</p>}
      {mine.state === 'error' && <p className="field-problem" role="alert">The dashboard couldn’t give the inbox: {mine.message}</p>}
      {ready && !configured && <NoToken />}
      {ready && configured && (
        <>
          <StatusLine status={ready} now={now} />
          {shown.state === 'ready' && (pick ? (
            <NextBar
              tone="stop"
              icon={SEVERITY_ICON[pick.severity ?? ''] ?? 'inbox'}
              say={`${pick.key} is ${pick.severity ? levelWord(pick.severity).toLowerCase() : 'not triaged yet'}${pick.assignee ? pick.assignee.you ? ' and yours' : `, with ${pick.assignee.name}` : ' and nobody is on it'}`}
              sub="Start a job and the Foreman reads the ticket first."
            >
              <Button size="lg" keyId="inbox-start-stack" onClick={() => startStack(pick)} title={`${STACK_WHEN} Opens New job on ${pick.key}, run as a stack (key: Shift+S).`}>
                Start as stack
              </Button>
              <Button kind="primary" size="lg" keyId="inbox-start" keyShown onClick={() => start(pick)} title={`Start a job on ${pick.key}: opens New job with the key and title filled in (key: s).`}>
                Start {pick.key}
              </Button>
            </NextBar>
          ) : items.length > 0 ? (
            <NextBar tone="quiet" icon="circle-check" say="Every ticket here already has a job" sub="Open a job from its row to see where it is." />
          ) : null)}
          {shown.state === 'loading' && showListLoading && <p className="muted" role="status">Reading the list…</p>}
          {shown.state === 'error' && <p className="field-problem" role="alert">{shown.message}</p>}
          {shown.state === 'ready' && (items.length ? (
            <>
              <section className="inbox-group" aria-labelledby="inbox-decide">
                <h3 className="inbox-group-head" id="inbox-decide">
                  <Icon name="hand" size={16} className="inbox-group-icon is-decide" />
                  Needs a decision <span className="inbox-group-count num">{decide.length}</span>
                  <span className="inbox-group-note">No job yet, and severe or not triaged</span>
                </h3>
                {decide.length ? table(decide, `Tickets that need a decision, ${decide.length}, most severe first, then oldest.`) : <p className="lane-empty">Nothing needs a decision right now</p>}
              </section>
              {wait.length > 0 && (
                <More screen="inbox" id="can-wait" label="Can wait" count={wait.length} icon="clock" note="Already on a job, or less severe" className="inbox-wait">
                  {table(wait, `Tickets that can wait, ${wait.length}, most severe first, then oldest.`)}
                </More>
              )}
            </>
          ) : (
            <Hero
              icon="circle-check"
              quiet
              title="Nothing for you right now"
              actions={<Button size="lg" keyId="new-job" onClick={() => ui.openSheet({ kind: 'new-job' })} title="Start a new job of your own (key: c).">New job</Button>}
            >
              {tab === 'mine' ? 'Nothing open is assigned to you or watched by you.' : 'No tickets in this view.'}
            </Hero>
          ))}
          {open && <TicketPeek key={open.key} item={open} order={order} onPick={(key) => setPeek(key)} onClose={() => setPeek(null)} onStart={start} onStartStack={startStack} />}
        </>
      )}
    </Page>
  );
}

const SETUP_STEPS = [
  { title: 'Make a token', say: 'On Orbit’s API tokens page. It can only read: nothing here writes to Orbit.' },
  { title: 'Paste it in Settings', say: 'With Orbit’s address, in Settings → Workflow. It is kept in your Keychain.' },
  { title: 'Your tickets show here', say: 'Most severe first, then oldest, checked every few minutes while this page is open.' },
] as const;

/** Before a token: what the Inbox is, the three steps as a numbered list, and the one action. */
function NoToken() {
  return (
    <section className="inbox-setup" aria-label="Connect Orbit">
      <span className="inbox-setup-pic" aria-hidden="true"><Icon name="inbox" size={24} /></span>
      <h2 className="inbox-setup-title">Connect Orbit to see your tickets</h2>
      <p className="inbox-setup-say">Your Portal Feedback tickets show here once {BRAND.name} has your Orbit token.</p>
      <ol className="setup-steps">
        {SETUP_STEPS.map((step, n) => (
          <li key={step.title} className="setup-step">
            <span className="setup-n num" aria-hidden="true">{n + 1}</span>
            <span className="setup-words"><b className="setup-title">{step.title}</b><span className="setup-say">{step.say}</span></span>
          </li>
        ))}
      </ol>
      <Button kind="primary" size="lg" href={settingsHref('workflow')} className="inbox-setup-go">Open Settings → Workflow</Button>
    </section>
  );
}

/** How often the list is read, and what went wrong (the last list stays). */
function StatusLine({ status, now }: { status: OrbitStatus; now: Date }) {
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
    </>
  );
}

/** When the list was read and how often, quietly in the page's header (beside Read now). */
function ReadLine({ status, now }: { status: OrbitStatus; now: Date }) {
  const read = status.lastPoll ? `Read ${relativeTime(status.lastPoll, now)}${/^\d+[mhd]$/.test(relativeTime(status.lastPoll, now)) ? ' ago' : ''}` : 'Not read yet';
  return (
    <span className="muted page-note inbox-read" title={status.lastPoll ? fullTime(status.lastPoll) : undefined}>
      {read} · checked every {minutes(status.everyMs)} minutes while this page is open
      {status.waitingMs > 0 && <> · Orbit asked to wait, next check in about {Math.max(1, minutes(status.waitingMs))} minutes</>}
    </span>
  );
}

function TicketTable({ items, caption, jobs, pick, now, peeked, onOpen, onStart, onStartStack, onFocusRow }: {
  items: InboxItem[]; caption: string; jobs: readonly Job[]; pick: InboxItem | null; now: Date; peeked: string | null;
  onOpen: (item: InboxItem) => void; onStart: (item: InboxItem) => void; onStartStack: (item: InboxItem) => void; onFocusRow: (item: InboxItem | null) => void;
}) {
  return (
    <div className="data-table inbox-table">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" aria-sort="ascending">Severity</th>
            <th scope="col">Ticket</th>
            <th scope="col">Age</th>
            <th scope="col">Who’s on it</th>
            <th scope="col"><span className="sr-only">Start, or its job</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const job = i.job ? jobs.find((j) => j.slug === i.job!.slug) : undefined;
            const isPick = pick?.key === i.key;
            return (
              <tr
                key={i.key}
                data-ticket={i.key}
                className={[isPick ? 'is-next' : '', peeked === i.key ? 'is-peeked' : ''].filter(Boolean).join(' ') || undefined}
                onFocus={() => onFocusRow(i)}
                onBlur={() => onFocusRow(null)}
              >
                <td className="cell-sev"><Severity item={i} /></td>
                <th scope="row" className="cell-ticket">
                  <button
                    type="button"
                    className="row-link"
                    onClick={() => onOpen(i)}
                    onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); onOpen(i); } }}
                    title={`Take a quick look at ${i.key}: its description, links and timeline (key: Space).`}
                  >
                    <span className="num ticket-key">{i.key}</span>
                    <span className="ticket-title">{i.title}</span>
                  </button>
                  {i.job && <span className="muted ticket-job">You are already on this: <a href={jobHref(i.job.slug)} title="Open the job on this ticket.">{i.job.title}</a></span>}
                </th>
                <td className="cell-age num" title={i.createdAt ? `Opened ${fullTime(i.createdAt)}` : undefined}>{relativeTime(i.createdAt, now) || '—'}</td>
                <td className="cell-who"><WhoIsOn who={i.assignee} /></td>
                <td className="cell-act">
                  {i.job ? (
                    <Button size="sm" href={jobHref(i.job.slug)} icon={job?.lane === 'needs-you' ? 'hand' : undefined} title={job?.laneReason ?? 'Open the job on this ticket.'}>
                      {job?.lane === 'needs-you' ? 'Needs you' : 'Open its job'}
                    </Button>
                  ) : (
                    <>
                      <Button
                        kind="quiet"
                        size="sm"
                        className="inbox-stack-start"
                        onClick={() => onStartStack(i)}
                        aria-label={`Start ${i.key} as a stack`}
                        title={`${STACK_WHEN} Opens New job on ${i.key}, run as a stack (key: Shift+S, with the focus on this row).`}
                      >
                        Start as stack
                      </Button>
                      <Button
                        size="sm"
                        keyId={isPick ? 'inbox-start' : undefined}
                        onClick={() => onStart(i)}
                        aria-label={`Start a job on ${i.key}`}
                        title={`Start a job on ${i.key}: opens New job with the key and title filled in (key: s, with the focus on this row).`}
                      >
                        Start
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const DETAIL_EVERY_MS = 60_000;

function TicketPeek({ item, order, onPick, onClose, onStart, onStartStack }: {
  item: InboxItem; order: readonly string[]; onPick: (key: string) => void; onClose: () => void;
  onStart: (item: InboxItem) => void; onStartStack: (item: InboxItem) => void;
}) {
  const { api } = useWorkshop();
  const now = useNow();
  const [detail, setDetail] = useState<Load<TicketAnswer>>({ state: 'loading' });
  const [refs, setRefs] = useState<Load<Reference[]>>({ state: 'loading' });
  usePeekKeys({ current: item.key, order, onPick, onClose });

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
    <Peek
      label={`${current.key}: ${current.title}`}
      className="ticket-peek"
      title={<span className="num ticket-key">{current.key}</span>}
      actions={current.url ? <Button kind="quiet" size="sm" icon="external" href={current.url} target="_blank" rel="noreferrer noopener" title="Open the ticket on Orbit, in a new tab.">Open on Orbit</Button> : null}
      keys={[['j k', 'the next or previous ticket'], ['s', 'start a job'], ['Esc', 'close']]}
      onClose={onClose}
    >
      <p className="ticket-peek-title">{current.title}</p>
      <dl className="ticket-facts">
        <div><dt>Status</dt><dd>{statusWord(current.status)}</dd></div>
        <div><dt>Severity</dt><dd><Severity item={current} hidden={hidden} /></dd></div>
        <div><dt>Opened</dt><dd className="num" title={current.createdAt ? fullTime(current.createdAt) : undefined}>{relativeTime(current.createdAt, now) || '—'}</dd></div>
        <div><dt>Assigned to</dt><dd><WhoIsOn who={current.assignee} /></dd></div>
      </dl>
      <div className="ticket-act">
        {current.job ? (
          <p className="ticket-on">You are already on this: <a href={jobHref(current.job.slug)}>{current.job.title}</a></p>
        ) : (
          <>
            <Button size="md" keyId="inbox-start-stack" onClick={() => onStartStack(current)} title={`${STACK_WHEN} Opens New job on this ticket, run as a stack (key: Shift+S).`}>
              Start as stack
            </Button>
            <Button kind="primary" keyId="inbox-start" keyShown onClick={() => onStart(current)} title="Start a job on this ticket: opens New job with the key and title filled in (key: s).">
              Start
            </Button>
          </>
        )}
      </div>
      {!current.job && <p className="muted inbox-stack-when">Start as stack: {STACK_WHEN.charAt(0).toLowerCase()}{STACK_WHEN.slice(1)}</p>}
      {detail.state === 'loading' && <Pending loading say="Reading the ticket…" skeleton={<Skeleton rows={3} className="ticket-skeleton" />} />}
      {detail.state === 'error' && <p className="field-problem" role="alert">{detail.message}</p>}
      {description && <p className="ticket-description">{description}</p>}

      <h4 className="ticket-part">Links on the ticket</h4>
      {refs.state === 'error' && <p className="field-problem">{refs.message}</p>}
      {refs.state === 'ready' && (refs.data.length ? (
        <ul className="ticket-links">
          {refs.data.map((r) => <li key={r.id}><span className="chip">{capital(r.kind)}</span> <a href={r.url} target="_blank" rel="noreferrer noopener">{r.label}</a></li>)}
        </ul>
      ) : <p className="muted">No branches, PRs or links yet.</p>)}

      <h4 className="ticket-part">Timeline</h4>
      {detail.state === 'ready' && !timeline.length && <p className="muted">Nothing has happened on this ticket yet.</p>}
      <ol className="ticket-timeline">
        {timeline.map((e, n) => (
          <li key={`${e.at}-${n}`} className="ticket-event">
            <p className="ticket-event-meta"><span className="who">{e.type === 'comment' ? person(e.comment?.author) : e.type === 'status' ? person(e.by) : person(e.event?.actor)}</span><span className="num" title={fullTime(e.at)}>{relativeTime(e.at, now)}</span></p>
            {e.type === 'comment' && <p className="ticket-comment">{e.comment?.deletedAt ? <span className="muted">This comment was deleted.</span> : e.comment?.body ?? ''}</p>}
            {e.type === 'status' && <p className="ticket-event-line">Status: {e.from ? `${statusWord(e.from)} → ` : ''}{statusWord(e.to ?? null)}</p>}
            {e.type === 'event' && <p className="ticket-event-line">{capital(e.event?.kind ?? 'change')}</p>}
          </li>
        ))}
      </ol>
    </Peek>
  );
}
