// The Inbox (#/inbox): your Portal Feedback tickets, read from Orbit with your own read-only token
// (dashboard/lib/orbit.js). Tabs: Mine (assigned to you, open ones only), then
// your saved views from Orbit. In the order of your queue in Orbit (Plan my queue): severity,
// then ranked before unranked, then the queue number, then oldest. Severity only (no priority here).
// Each row: severity (icon and word), key and title, age, who is on it, and Start, or the way to
// the job already on that ticket. A row opens the ticket: its facts, description, links (branches,
// PRs) and timeline, read again every minute while open.
//
// The next-step bar names one ticket: the lowest queue number with no job (else the first free one in order). Start (key s)
// works on the open ticket, the row with the focus, else the bar's ticket. It opens New job with the
// ticket filled in (read-only) and "ORBIT-<n>: <title>" as the description. The s key is the
// registry's (inbox-start, app/keyRegistry.ts): never while typing, with a dialog open, or with keys off.
// Start as stack (Shift+S, inbox-start-stack) sits beside Start on every row, the open ticket and the
// bar, and says when to use one: New job on the same ticket, to run as a stack (views/Stack).
//
// While this page is open it holds /api/orbit/events, so the dashboard checks Orbit every 3 minutes
// instead of every 15; the stream also brings each new list. Nothing here writes to Orbit.
//
// On the hosted site (packet 2C, `hosted`) the same page reads the inbox the site keeps for you
// (hosted/site/routes-orbit.js): the site's cron job reads Orbit every 3 minutes with your token,
// and while this page is open it asks for a fresh read once a minute. Start sends the ticket to
// your laptop (views/Hosted/HostedInboxPage.tsx asks which, when you have more than one); the row
// says how it is going, in words: on its way, starts when your laptop is back, started, or why
// not. Mine only (saved views stay on the laptop), no Start as stack, and the quick look shows
// what the site keeps, with the ticket's links and timeline on Orbit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useKeyScope } from '../app/keyRegistry';
import { jobHref, settingsHref } from '../app/router';
import { useUi, type SheetState } from '../app/ui';
import { Icon, type IconName } from '../components/Icon';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { More } from '../components/More';
import { Peek, usePeekAddress, usePeekKeys } from '../components/Peek';
import { Pending, Skeleton } from '../components/Pending';
import { Hero, NextBar, Page, type GuideSpec } from '../components/page/Page';
import { useDelayedFlag } from '../lib/useDelayedFlag';
import { clockTime, fullTime, relativeTime, useNow } from '../lib/time';
import { useWorkshop, useWorkshopState } from '../state/store';

// ---------- What the dashboard sends (GET /api/orbit/*) ----------

export type { InboxAnswer, InboxItem, InboxSuggestion, OrbitStatus } from '../api/types';
import type { AutoQueue, AutoTicket, InboxAnswer, InboxItem, InboxStart, InboxSuggestion, Job, OrbitStatus } from '../api/types';
import { BRAND } from '../app/brand';
import { AUTO_MAX, AUTO_PAUSED, autoPausedLine, TOO_BIG } from '../home/autoTab';

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

/** A bug ticket opens New job on Bug fix; any other type on Feature. */
export const kindOfTicket = (item: Pick<InboxItem, 'type'>): 'feature' | 'bug' => (item.type === 'bug' ? 'bug' : 'feature');

/** When to use Start as stack, in one sentence (its button says it). */
export const STACK_WHEN = 'For a big ticket: the work is split into parts that are built side by side, then joined in order.';

/** New job on a ticket, to run as a stack (Start as stack, S). */
export function stackSheet(item: Pick<InboxItem, 'key' | 'title' | 'url' | 'type'>): SheetState {
  return { kind: 'new-job', description: startText(item), ticket: { key: item.key, title: item.title, url: item.url }, stack: true, jobKind: kindOfTicket(item) };
}

// ---------- Severity, and the order ----------

/** Orbit's severities, most severe first (dashboard/lib/orbit.js). */
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_ICON: Record<string, IconName> = { critical: 'flame', high: 'alert', medium: 'circle-dot', low: 'circle' };
const rankOf = (sev: string | null) => (sev && sev in SEVERITY_RANK ? SEVERITY_RANK[sev] : 9);

/** A participant's rows come without severity: their address is the public one, not /admin/. */
export const severityHidden = (i: Pick<InboxItem, 'severity' | 'url'>) => !i.severity && Boolean(i.url) && !i.url!.includes('/admin/feedback/');

/**
 * The Inbox's order, the same rule as the server's (dashboard/lib/orbit.js) and Orbit's Plan my queue:
 * severity (critical first, none last), ranked before unranked, queue number ascending, oldest first,
 * then ticket number.
 */
export function queueOrder(a: InboxItem, b: InboxItem): number {
  const ranked = (i: InboxItem) => (Number.isInteger(i.queuePosition) ? 0 : 1);
  return rankOf(a.severity) - rankOf(b.severity)
    || ranked(a) - ranked(b)
    || (ranked(a) === 0 ? a.queuePosition! - b.queuePosition! : 0)
    || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
    || a.number - b.number;
}

export function sortInbox(items: readonly InboxItem[]): InboxItem[] {
  return [...items].sort(queueOrder);
}

/** The ticket the next-step bar offers, and why: by its queue number, by a suggestion, or just first in order. */
export interface NextPick { item: InboxItem; why: 'queue' | 'suggested' | 'order'; reason?: string }

/** Free to start: no job on it, and no Start on its way to a laptop. */
export const toStart = (i: Pick<InboxItem, 'job' | 'start'>) => !i.job && !onItsWay(i);

/**
 * The ticket the bar offers: the free ticket with the lowest queue number (a tie goes to the first in
 * the order above); else the first free one in `picks`; else the first free ticket in the order.
 */
export function nextTicket(items: readonly InboxItem[], picks: readonly InboxItem[] = []): NextPick | null {
  const free = sortInbox(items).filter(toStart);
  // The minimum queue number; `free` is in queueOrder, so a tie keeps the earlier row.
  const byNumber = free.reduce<InboxItem | undefined>((best, i) => (Number.isInteger(i.queuePosition) && (!best || i.queuePosition! < best.queuePosition!) ? i : best), undefined);
  if (byNumber) return { item: byNumber, why: 'queue' };
  const keys = new Set(free.map((i) => i.key));
  const suggested = picks.find((i) => keys.has(i.key));
  if (suggested) return { item: free.find((i) => i.key === suggested.key)!, why: 'suggested' };
  return free[0] ? { item: free[0], why: 'order' } : null;
}

/** Most suggestions shown, and the most tickets the laptop looks at (dashboard/lib/inbox-suggest.js TICKETS_MAX). */
const SHOWN_PICKS = 3;
const SUGGEST_LOOKS_AT = 25;
const SUGGESTED_HOVER = "Picked by Haiku on your laptop, because none of your tickets is ranked in Orbit. Rank them in Orbit's Plan my queue to set the order yourself.";

/** A ticket the laptop could be asked about: free, unranked in a list that knows its queue. */
const suggestible = (i: InboxItem) => Boolean(i.queueKnown) && !Number.isInteger(i.queuePosition) && toStart(i);

/**
 * The suggested tickets to show: the picks whose ticket is in this list, free, unranked and with the
 * queue known, at most 3, in the suggestion's order. Only an answer that is ready shows any.
 */
export function shownPicks(items: readonly InboxItem[], suggest: InboxSuggestion | null | undefined): InboxItem[] {
  if (suggest?.state !== 'ready') return [];
  const out: InboxItem[] = [];
  for (const p of suggest.picks) {
    const i = items.find((x) => x.key === p.key);
    if (i && suggestible(i) && !out.includes(i)) out.push(i);
    if (out.length === SHOWN_PICKS) break;
  }
  return out;
}

/** The list the laptop was asked about, as it is now (the same keys as the suggester's `forList`). */
const askedList = (items: readonly InboxItem[]) => sortInbox(items.filter((i) => i.queueKnown && i.queuePosition === null && !i.job)).slice(0, SUGGEST_LOOKS_AT).map((i) => `${i.key}@${i.changedAt ?? ''}`);

/** "4 minutes", "3 hours", "2 days": for "Suggested <time> ago." */
function agoWords(iso: string | null, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - Date.parse(iso ?? '')) / 60_000));
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (!Number.isFinite(min) || min < 1) return 'less than a minute';
  if (min < 60) return unit(min, 'minute');
  if (min < 48 * 60) return unit(Math.floor(min / 60), 'hour');
  return unit(Math.floor(min / 1440), 'day');
}

/** The line above the table about the suggestion, or null when there is nothing to say. */
export function suggestNote(suggest: InboxSuggestion | null | undefined, items: readonly InboxItem[], shown: number, now: Date, hosted: boolean): string | null {
  if (!suggest) return null;
  if (hosted) {
    if (!shown) return null;
    // The site's own time of receipt: a laptop with a wrong clock can't make an old suggestion look fresh.
    const since = suggest.receivedAt ?? suggest.at;
    const old = now.getTime() - Date.parse(since ?? '') > 2 * 3_600_000;
    return `Suggested by your laptop ${agoWords(since, now)} ago.${old ? ' Your list may have changed since. Your laptop suggests again when it is on.' : ''}`;
  }
  if (suggest.state === 'asking') return 'Picking up to three tickets to suggest…';
  if (suggest.state === 'failed') return `No suggestion this time: ${suggest.why ?? "Haiku couldn't be reached."} It tries again when your list changes.`;
  if (JSON.stringify(askedList(items)) === JSON.stringify(suggest.forList)) return null;
  return `Suggested ${agoWords(suggest.at, now)} ago. Your list has changed since${suggest.nextAt ? `, so a new suggestion comes by ${clockTime(suggest.nextAt, now)}` : ''}.`;
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

const SCOPE_LINE = "Tickets assigned to you. Tickets you only watch or are mentioned on aren't listed.";
const NOT_APPLIED = "Orbit didn't apply 'assigned to me' for this token, so your tickets can't be picked out. The account needs adding to Orbit's feedback-team list.";

const INBOX_GUIDE: GuideSpec = {
  id: 'inbox',
  title: 'How the Inbox works',
  done: 'Show me my tickets',
  cards: [
    { icons: ['inbox'], title: 'Your Orbit tickets', say: 'The Portal Feedback tickets assigned to you, in the order of your queue in Orbit (Plan my queue).' },
    { icons: ['inbox', 'clipboard'], title: 'Start makes a job', say: 'Start opens a new job on the ticket. The Foreman reads the ticket first and writes a brief.' },
    { icons: ['hand', 'check'], title: 'You say go at each step', say: 'Nothing moves on without you: each step waits on the Desk for your go or no go.' },
  ],
};

// ---------- The page ----------

type Load<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; message: string };

function defaultOpenStream(url: string): OrbitStream | null {
  return typeof EventSource === 'undefined' ? null : new EventSource(url);
}

/** Whether a tag name of the ticket equals the tag, ignoring case and spaces: the tag names only, never the title or text. */
export const tagMatches = (item: Pick<InboxItem, 'tags'>, tag: string): boolean => {
  const want = tag.trim().toLowerCase();
  return Boolean(want) && Array.isArray(item.tags) && item.tags.some((t) => typeof t === 'string' && t.trim().toLowerCase() === want);
};

/** Auto start's words on the Inbox, exact: N is the setting's max, 5 when it isn't known. */
export const autoStartLine = (tag: string, max: number = AUTO_MAX.default) => `Auto start is on: tickets tagged "${tag}" start by themselves, up to ${max} at a time.`;
export const STARTS_BY_ITSELF = 'Starts by itself';
/** Mine's mark on a ticket whose job Auto is working on (the queue's `working` group). */
export const AUTO_WORKING = 'Auto is working on this';
export const autoFailedLine = (reason: string) => `Couldn't start by itself: ${reason} Press Start to try.`;

/** Whether this row will start by itself: assigned, open, no job and nothing on its way, the tag on it, not tried before. */
export const startsByItself = (i: InboxItem, auto: { on: boolean; tag: string } | null | undefined): boolean =>
  Boolean(auto?.on && auto.tag.trim()) && toStart(i) && i.why.includes('assigned') && !['closed', 'resolved'].includes(i.status ?? '')
  && !i.autoStartFailed && tagMatches(i, auto!.tag);

/** What the hosted site gives the Inbox (views/Hosted/HostedInboxPage.tsx). */
export interface HostedInbox {
  /** Settings → Orbit on the site. */
  settingsHref: string;
  /** Start: the ticket to one of your laptops. */
  onStart(item: InboxItem): void;
  /** Cancel a Start your laptop hasn't picked up yet. */
  onCancel(item: InboxItem): void;
  /** Bumped when a Start or a Cancel changed the list: it is read again. */
  version: number;
  /** What went wrong with the last Start or Cancel, in words. */
  notice?: string | null;
  /** The ticket whose Start or Cancel is on its way (its button spins and can't be pressed again). */
  sending?: string | null;
  /** Auto start's setting, from the laptop's settings the site mirrors (null while unknown). */
  autoStart?: { on: boolean; tag: string; max?: number } | null;
  /** The Auto queue from the site's snapshot (null or missing: not known, so no Auto tab). */
  autoQueue?: AutoQueue | null;
  /** Called each time the ticket list is read (its tick, Read now, after a Start or Cancel), so the page reads the queue with it. */
  onRead?: () => void;
}

/** The hosted Inbox reads the site's list this often, and asks for a fresh read from Orbit every fourth time (once a minute). */
export const HOSTED_READ_MS = 15_000;
const HOSTED_REFRESH_EVERY = 4;

/** A Start on its way to a laptop, or taken: the ticket isn't free to start again. */
export const onItsWay = (i: Pick<InboxItem, 'start'>) => Boolean(i.start && i.start.state !== 'failed');

const HOSTED_GUIDE: GuideSpec = {
  id: 'hosted-inbox',
  title: 'How the Inbox works here',
  done: 'Show me my tickets',
  cards: [
    { icons: ['inbox'], title: 'Your Orbit tickets, laptop or not', say: 'The site reads the tickets assigned to you every few minutes, with your own token, even while your laptop is closed. They are in the order of your queue in Orbit.' },
    { icons: ['send'], title: 'Start sends it to your laptop', say: 'The job runs on your laptop. If the laptop is off, it starts when the laptop is back.' },
    { icons: ['hand', 'check'], title: 'You say go at each step', say: 'The Foreman reads the ticket first, on the laptop, and nothing moves on without you.' },
  ],
};

export function InboxView({ openStream = defaultOpenStream, hosted }: { openStream?: (url: string) => OrbitStream | null; hosted?: HostedInbox }) {
  const isHosted = Boolean(hosted);
  const hostedVersion = hosted?.version ?? 0;
  const { api } = useWorkshop();
  const { jobs, autoQueue: laptopQueue } = useWorkshopState();
  // The Auto queue: the laptop's store keeps the snapshot's; the site reads its own snapshot. Missing: no Auto tab.
  const queue = (isHosted ? hosted?.autoQueue : laptopQueue) ?? null;
  const ui = useUi();
  const now = useNow();
  const [tab, setTab] = useState<string>('mine');
  // The Auto tab goes when the queue does (an older laptop): back to Mine.
  useEffect(() => { if (tab === 'auto' && !queue) setTab('mine'); }, [tab, queue]);
  const [mine, setMine] = useState<Load<InboxAnswer>>({ state: 'loading' });
  const [viewList, setViewList] = useState<Load<InboxAnswer> | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [peek, setPeek] = usePeekAddress();
  const [refreshing, setRefreshing] = useState(false);
  const focused = useRef<InboxItem | null>(null);
  // The site's queue is read with every read of the list, so it is never staler than the list.
  const onRead = useRef(hosted?.onRead);
  onRead.current = hosted?.onRead;

  const loadMine = useCallback(async (refresh = false) => {
    onRead.current?.();
    try {
      const data = await api.get<InboxAnswer>(`/api/orbit/inbox${refresh ? '?refresh=1' : ''}`);
      setMine({ state: 'ready', data });
    } catch (err) {
      setMine((m) => (m.state === 'ready' ? m : { state: 'error', message: message(err) }));
    }
  }, [api]);

  // On the site, the first look asks for a fresh read too (the site reads Orbit at most once a minute).
  useEffect(() => { void loadMine(isHosted); }, [loadMine, isHosted]);

  // The hosted site: the kept list every 15 seconds (a Start's progress), a fresh read once a minute.
  useEffect(() => {
    if (!isHosted) return;
    let ticks = 0;
    const id = setInterval(() => { ticks++; void loadMine(ticks % HOSTED_REFRESH_EVERY === 0); }, HOSTED_READ_MS);
    return () => clearInterval(id);
  }, [isHosted, loadMine]);
  useEffect(() => { if (hostedVersion) void loadMine(); }, [hostedVersion, loadMine]);

  // The live stream: an open Inbox makes the dashboard check every 3 minutes, and brings each list.
  useEffect(() => {
    if (isHosted) return;
    const es = openStream('/api/orbit/events');
    if (!es) return;
    es.addEventListener('inbox', (ev) => {
      try { setMine({ state: 'ready', data: JSON.parse(String(ev.data)) as InboxAnswer }); } catch { /* a bad line: the next one will do */ }
    });
    return () => es.close();
  }, [openStream, isHosted]);

  const ready = mine.state === 'ready' ? mine.data : null;
  const configured = Boolean(ready?.tokenPresent && ready?.url);

  // The saved views, for the tabs (Orbit gives them to the feedback team only: none is fine).
  useEffect(() => {
    if (!configured || isHosted) return;
    let live = true;
    api.get<{ views: SavedView[] }>('/api/orbit/views').then((r) => { if (live) setViews(r.views ?? []); }).catch(() => { if (live) setViews([]); });
    return () => { live = false; };
  }, [api, configured, isHosted]);

  useEffect(() => {
    if (tab === 'mine' || tab === 'auto') { setViewList(null); return; }
    let live = true;
    setViewList({ state: 'loading' });
    api.get<InboxAnswer>(`/api/orbit/inbox?view=${encodeURIComponent(tab)}`)
      .then((data) => { if (live) setViewList({ state: 'ready', data }); })
      .catch((err) => { if (live) setViewList({ state: 'error', message: message(err) }); });
    return () => { live = false; };
  }, [api, tab]);

  const onHostedStart = hosted?.onStart;
  const start = useCallback((item: InboxItem) => {
    if (item.job || onItsWay(item)) return;
    if (onHostedStart) { onHostedStart(item); return; }
    ui.openSheet({ kind: 'new-job', description: startText(item), ticket: { key: item.key, title: item.title, url: item.url }, jobKind: kindOfTicket(item) });
  }, [ui, onHostedStart]);
  // Start as stack (S): New job with the ticket filled in, to run as a stack (views/Stack). Not on the site.
  const startStack = useCallback((item: InboxItem) => {
    if (item.job || isHosted) return;
    ui.openSheet(stackSheet(item));
  }, [ui, isHosted]);

  // The Auto tab lists the queue's tickets (InboxAuto), not a list from Orbit: no rows, so no bar and no s.
  const onAuto = tab === 'auto';
  const shown = tab === 'mine' || onAuto ? mine : viewList ?? { state: 'loading' as const };
  const items = useMemo(() => (shown.state === 'ready' && !onAuto ? sortInbox(shown.data.items) : []), [shown, onAuto]);
  const suggest = tab === 'mine' ? ready?.suggest : null;
  const picks = useMemo(() => shownPicks(items, suggest), [items, suggest]);
  const next = useMemo(() => nextTicket(items, picks), [items, picks]);
  const pick = next?.item ?? null;
  const reasons = useMemo(() => new Map((suggest?.picks ?? []).filter((p) => picks.some((i) => i.key === p.key)).map((p) => [p.key, p.reason])), [suggest, picks]);
  const showQueue = items.some((i) => i.queueKnown);
  // The ticket in the quick look (#/inbox?peek=ORBIT-12): from this list, else the last one seen.
  // Orbit set "assigned to me" aside for this token: the list is empty on purpose, and we say why.
  const notApplied = tab === 'mine' && ready?.filter?.applied === false;
  const lastOpen = useRef<InboxItem | null>(null);
  const open = peek ? items.find((i) => i.key === peek) ?? (lastOpen.current?.key === peek ? lastOpen.current : null) : null;
  lastOpen.current = open;
  const showLoading = useDelayedFlag(mine.state === 'loading', 200, 400);
  const showListLoading = useDelayedFlag(shown.state === 'loading', 200, 400);

  // s: Start on the open ticket, else the row with the focus, else the bar's ticket.
  useKeyScope('inbox', {
    'inbox-start': () => {
      const item = open ?? focused.current ?? pick;
      if (!item || item.job || onItsWay(item)) return false;
      start(item);
    },
    'inbox-start-stack': () => {
      const item = open ?? focused.current ?? pick;
      if (!item || item.job || isHosted) return false;
      startStack(item);
    },
  });

  async function refresh() {
    setRefreshing(true);
    try { await loadMine(true); } finally { setRefreshing(false); }
  }

  const lists = [{ id: 'mine', name: 'Mine' }, ...(queue ? [{ id: 'auto', name: 'Auto' }] : []), ...views];
  const head = configured ? (
    <>
      <div className="seg" role="tablist" aria-label="Inbox lists">
        {lists.map((v) => {
          const count = v.id === 'mine' ? ready?.items.length : v.id === 'auto' ? (queue ? autoTicketsShown(queue).length : 0) : v.id === tab && viewList?.state === 'ready' ? viewList.data.items.length : undefined;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              className="tab seg-tab"
              aria-selected={tab === v.id}
              onClick={() => setTab(v.id)}
              title={v.id === 'mine' ? 'Open tickets assigned to you.' : v.id === 'auto' ? 'Your tagged tickets: what Auto starts next, works on, or set aside.' : `Your saved view on Orbit: ${v.name}.`}
            >
              <span className="seg-name">{v.name}</span>
              {count !== undefined && <span className="seg-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
            </button>
          );
        })}
      </div>
      <span className="spacer" />
      {ready && <ReadLine status={ready} now={now} hosted={isHosted} />}
      <Button kind="quiet" size="sm" icon="refresh" busy={refreshing} onClick={() => void refresh()} title={isHosted ? 'Read your tickets from Orbit now (at most once a minute) instead of at the next check.' : 'Read your tickets from Orbit now instead of at the next check.'}>
        Read now
      </Button>
    </>
  ) : null;

  const auto = isHosted ? hosted?.autoStart ?? null : ready?.autoStart ?? null;
  const autoMax = typeof auto?.max === 'number' ? auto.max : AUTO_MAX.default;
  // Why Auto start is paused: the laptop's Inbox answer says; on the site, the snapshot's queue. One we have no words for: not paused.
  const paused = isHosted ? queue?.paused : ready?.autoStart?.paused;
  const pausedWhy = paused && Object.hasOwn(AUTO_PAUSED, paused) ? paused : null;
  // Mine marks the tickets whose job Auto is working on (the server's group, never worked out here).
  const autoWorking = useMemo(() => new Set((queue?.tickets ?? []).filter((t) => t.group === 'working').map((t) => t.key)), [queue]);
  const todo = items.filter(toStart);
  const started = items.filter((i) => !toStart(i));
  const order = [...todo, ...started].map((i) => i.key);
  const table = (rows: InboxItem[], caption: string) => (
    <TicketTable
      items={rows}
      caption={caption}
      jobs={jobs}
      pick={pick}
      suggested={reasons}
      showQueue={showQueue}
      now={now}
      peeked={open?.key ?? null}
      onOpen={(item) => setPeek(item.key)}
      onStart={start}
      onStartStack={startStack}
      onFocusRow={(item) => { focused.current = item; }}
      hosted={hosted}
      auto={auto}
      autoWorking={autoWorking}
    />
  );

  return (
    <Page label="Inbox" title="Inbox" className={`page-inbox${isHosted ? ' is-hosted' : ''}`} head={head} guide={isHosted ? HOSTED_GUIDE : INBOX_GUIDE}>
      {showLoading && <p className="muted" role="status">Reading your tickets…</p>}
      {mine.state === 'error' && <p className="field-problem" role="alert">{isHosted ? 'The site' : BRAND.name} couldn’t give the inbox: {mine.message}</p>}
      {ready && !configured && (hosted ? <HostedNoToken settingsHref={hosted.settingsHref} setup={ready.setup ?? []} /> : <NoToken />)}
      {ready && configured && (
        <>
          {hosted ? <HostedStatusLine status={ready} now={now} settingsHref={hosted.settingsHref} /> : <StatusLine status={ready} now={now} />}
          {hosted?.notice && <p className="field-problem" role="alert">{hosted.notice}</p>}
          {tab === 'mine' && auto?.on && auto.tag.trim() && (
            <p className="muted inbox-auto-line" role="status">
              {pausedWhy ? AUTO_PAUSED[pausedWhy] : autoStartLine(auto.tag.trim(), autoMax)}
            </p>
          )}
          {tab === 'mine' && <p className="muted">{SCOPE_LINE}</p>}
          {notApplied && <p className="field-problem" role="alert">{NOT_APPLIED}</p>}
          {onAuto && queue && <InboxAuto queue={queue} />}
          {!onAuto && shown.state === 'ready' && !notApplied && (pick ? (
            <NextBar
              tone="stop"
              icon={SEVERITY_ICON[pick.severity ?? ''] ?? 'inbox'}
              say={next?.why === 'queue' ? `${pick.key} is number ${pick.queuePosition} in your queue` : next?.why === 'suggested' ? `${pick.key} is suggested: ${reasons.get(pick.key) ?? ''}` : `${pick.key} is ${pick.severity ? levelWord(pick.severity).toLowerCase() : 'not triaged yet'}${pick.assignee ? pick.assignee.you ? ' and yours' : `, with ${pick.assignee.name}` : ' and nobody is on it'}`}
              sub={next?.why === 'queue'
                ? (isHosted ? 'The lowest number in your Orbit queue without a job. Start sends it to your laptop, and the Foreman reads the ticket there first.' : 'The lowest number in your Orbit queue without a job. Start a job and the Foreman reads the ticket first.')
                : next?.why === 'suggested'
                  ? (isHosted ? "None of your tickets is ranked in Orbit, so this is your laptop's suggestion. Start sends it to your laptop." : 'None of your tickets is ranked in Orbit, so this is a suggestion. Start a job and the Foreman reads the ticket first.')
                  : (isHosted ? 'Start sends it to your laptop, and the Foreman reads the ticket there first.' : 'Start a job and the Foreman reads the ticket first.')}
            >
              {!isHosted && (
                <Button size="lg" keyId="inbox-start-stack" onClick={() => startStack(pick)} title={`${STACK_WHEN} Opens New job on ${pick.key}, run as a stack (key: Shift+S).`}>
                  Start as stack
                </Button>
              )}
              <Button kind="primary" size="lg" keyId="inbox-start" keyShown busy={hosted?.sending === pick.key} busyLabel="Starting…" onClick={() => start(pick)} title={isHosted ? `Start a job on ${pick.key} on your laptop (key: s).` : `Start a job on ${pick.key}: opens New job with the key and title filled in (key: s).`}>
                Start {pick.key}
              </Button>
            </NextBar>
          ) : items.length > 0 ? (
            <NextBar tone="quiet" icon="circle-check" say={isHosted ? 'Every ticket here has a job, or is on its way to your laptop' : 'Every ticket here already has a job'} sub="Open a job from its row to see where it is." />
          ) : null)}
          {!onAuto && shown.state === 'ready' && !notApplied && <p className="muted inbox-note" role="status">{suggestNote(suggest, items, picks.length, now, isHosted)}</p>}
          {!onAuto && shown.state === 'loading' && showListLoading && <p className="muted" role="status">Reading the list…</p>}
          {!onAuto && shown.state === 'error' && <p className="field-problem" role="alert">{shown.message}</p>}
          {!onAuto && shown.state === 'ready' && !notApplied && (items.length ? (
            <>
              <section className="inbox-group" aria-labelledby="inbox-decide">
                <h3 className="inbox-group-head" id="inbox-decide">
                  <Icon name="hand" size={16} className="inbox-group-icon is-decide" />
                  To start <span className="inbox-group-count num">{todo.length}</span>
                  <span className="inbox-group-note">No job yet, in your Orbit queue order</span>
                </h3>
                {todo.length ? table(todo, `Tickets to start, ${todo.length}, in your queue order.`) : <p className="lane-empty">Nothing left to start</p>}
              </section>
              {started.length > 0 && (
                <More screen="inbox" id="can-wait" label="Already started" count={started.length} icon="clock" note={isHosted ? 'A job is on each of these, or one is on its way' : 'A job is on each of these already'} className="inbox-wait">
                  {table(started, `Tickets already started, ${started.length}, in your queue order.`)}
                </More>
              )}
            </>
          ) : (
            <Hero
              icon="circle-check"
              quiet
              title="Nothing for you right now"
              actions={isHosted ? undefined : <Button size="lg" keyId="new-job" onClick={() => ui.openSheet({ kind: 'new-job' })} title="Start a new job of your own (key: c).">New job</Button>}
            >
              {tab === 'mine' ? 'Nothing open is assigned to you.' : 'No tickets in this view.'}
            </Hero>
          ))}
          {open && (hosted
            ? <HostedTicketPeek key={open.key} item={open} order={order} onPick={(key) => setPeek(key)} onClose={() => setPeek(null)} onStart={start} onCancel={hosted.onCancel} sending={hosted.sending === open.key} />
            : <TicketPeek key={open.key} item={open} order={order} onPick={(key) => setPeek(key)} onClose={() => setPeek(null)} onStart={start} onStartStack={startStack} />)}
        </>
      )}
    </Page>
  );
}

const SETUP_STEPS = [
  { title: 'Make a token', say: 'On Orbit’s API tokens page. It can only read: nothing here writes to Orbit.' },
  { title: 'Paste it in Settings', say: 'With Orbit’s address, in Settings → Workflow. It is kept in your Keychain.' },
  { title: 'Your tickets show here', say: 'In your Orbit queue order, checked every few minutes while this page is open.' },
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
function ReadLine({ status, now, hosted = false }: { status: OrbitStatus; now: Date; hosted?: boolean }) {
  const read = status.lastPoll ? `Read ${relativeTime(status.lastPoll, now)}${/^\d+[mhd]$/.test(relativeTime(status.lastPoll, now)) ? ' ago' : ''}` : 'Not read yet';
  return (
    <span className="muted page-note inbox-read" title={status.lastPoll ? fullTime(status.lastPoll) : undefined}>
      {read} · {hosted ? `checked every ${minutes(status.everyMs)} minutes, and every minute while this page is open` : `checked every ${minutes(status.everyMs)} minutes while this page is open`}
      {status.waitingMs > 0 && <> · Orbit asked to wait, next check in about {Math.max(1, minutes(status.waitingMs))} minutes</>}
    </span>
  );
}

/** A Start on its way, in words with an icon (never colour alone); Cancel while the laptop hasn't taken it. */
export function StartState({ start, onCancel, busy = false }: { start: InboxStart; onCancel?: () => void; /** The Cancel is on its way. */ busy?: boolean }) {
  const laptop = start.laptop.name;
  if (start.state === 'started') {
    return <span className="inbox-start is-started" role="status"><Icon name="check" size={14} />Started on {laptop}</span>;
  }
  const waiting = start.state === 'waiting';
  return (
    <span className="inbox-start-row">
      <span className={`inbox-start ${waiting ? 'is-waiting' : 'is-sending'}`} role="status" title={waiting ? `${laptop} is off. The job starts there as soon as it is back.` : `${laptop} is online: it starts in a moment.`}>
        <Icon name={waiting ? 'hourglass' : 'send'} size={14} />
        {waiting ? 'Starts when your laptop is back' : `Starting on ${laptop}…`}
      </span>
      {onCancel && !start.handedOut && (
        <Button kind="quiet" size="sm" busy={busy} onClick={onCancel} title={`Don’t start it: ${laptop} hasn’t picked it up yet.`}>Cancel</Button>
      )}
    </span>
  );
}

/** Why the laptop didn't start it, under the ticket's title; Start again sits on the right. */
function StartProblem({ start }: { start: InboxStart }) {
  return <span className="inbox-start-problem"><Icon name="warn" size={14} />{start.laptop.name} couldn’t start it: {start.error ?? 'it didn’t say why.'}</span>;
}

const HOSTED_SETUP_STEPS = [
  { title: 'Make a token', say: 'On Orbit’s API tokens page. It can only read: nothing here writes to Orbit.' },
  { title: 'Paste it in Settings → Orbit', say: 'The site keeps it encrypted and uses it for your inbox only.' },
  { title: 'Your tickets show here', say: 'Read every few minutes, even while your laptop is closed.' },
] as const;

/** The hosted Inbox before a token: the three steps, and the way to Settings → Orbit. */
function HostedNoToken({ settingsHref, setup }: { settingsHref: string; setup: readonly string[] }) {
  return (
    <section className="inbox-setup" aria-label="Connect Orbit">
      <span className="inbox-setup-pic" aria-hidden="true"><Icon name="inbox" size={24} /></span>
      <h2 className="inbox-setup-title">Connect Orbit to see your tickets</h2>
      <p className="inbox-setup-say">Your Portal Feedback tickets show here once the site has your Orbit token, even while your laptop is closed.</p>
      {setup.length > 0 && (
        <p className="perm-warn" role="status">The site isn’t set up for Orbit yet: whoever runs it sets {setup.join(' and ')} in Vercel first.</p>
      )}
      <ol className="setup-steps">
        {HOSTED_SETUP_STEPS.map((step, n) => (
          <li key={step.title} className="setup-step">
            <span className="setup-n num" aria-hidden="true">{n + 1}</span>
            <span className="setup-words"><b className="setup-title">{step.title}</b><span className="setup-say">{step.say}</span></span>
          </li>
        ))}
      </ol>
      <Button kind="primary" size="lg" href={settingsHref} className="inbox-setup-go">Open Settings → Orbit</Button>
    </section>
  );
}

/** The hosted Inbox's one banner when the token is past its date or refused; else the last problem. */
function HostedStatusLine({ status, now, settingsHref }: { status: OrbitStatus; now: Date; settingsHref: string }) {
  if (status.expired) {
    return (
      <p className="inbox-token-banner" role="status">
        <Icon name="clock" size={16} />
        <span>Your Orbit token expired. Paste a new one in <a href={settingsHref}>Settings → Orbit</a>.{status.lastPoll && <span className="muted"> The list below is as it was at {clockTime(status.lastPoll, now)}.</span>}</span>
      </p>
    );
  }
  if (!status.lastError) return null;
  return (
    <p className="field-problem" role="alert">
      {status.lastError}
      {status.lastPoll && <> Showing the list as it was at {clockTime(status.lastPoll, now)}.</>}
    </p>
  );
}

/** The Auto tab's groups (design section 3), in this order, each only when it has rows. */
const AUTO_TICKET_GROUPS: readonly { id: AutoTicket['group']; heading: string; icon: IconName }[] = [
  { id: 'next', heading: 'Next up', icon: 'clock' },
  { id: 'working', heading: 'Auto is working on these', icon: 'activity' },
  { id: 'too-big', heading: TOO_BIG, icon: 'layers' },
  { id: 'failed', heading: 'Couldn’t start', icon: 'warn' },
];

/** The words when the tab shows no row (not in the design or the plan: Task 16's words). */
export const AUTO_NONE = 'No tickets for Auto right now.';

/** The queue's tickets the tab shows: those in one of its four groups. The tab's count is these rows. */
const autoTicketsShown = (queue: AutoQueue) => (queue.tickets ?? []).filter((t) => AUTO_TICKET_GROUPS.some((g) => g.id === t.group));

/**
 * The Inbox's Auto tab: the queue's tickets as the server grouped them, in Inbox order, with why Auto
 * is paused at the top as on Jobs. A working or too-big ticket links to its job; too big and
 * couldn't start say why. The same simple list on a phone.
 */
function InboxAuto({ queue }: { queue: AutoQueue }) {
  const tickets = autoTicketsShown(queue);
  const paused = autoPausedLine(queue.paused);
  return (
    <div className="sb-inbox-auto">
      {paused && <p className="sb-auto-paused" role="status"><Icon name="pause" size={16} />{paused}</p>}
      {!tickets.length && <p className="muted">{AUTO_NONE}</p>}
      {AUTO_TICKET_GROUPS.map((g) => {
        const rows = tickets.filter((t) => t.group === g.id);
        if (!rows.length) return null;
        const linked = g.id === 'working' || g.id === 'too-big';
        const why = g.id === 'too-big' || g.id === 'failed';
        return (
          <section key={g.id} className="inbox-group sb-inbox-auto-group" aria-label={g.heading}>
            <div className="inbox-group-head">
              <Icon name={g.icon} size={16} className="inbox-group-icon" />
              <h3 className="sb-inbox-auto-head">{g.heading}</h3>
              <span className="inbox-group-count num">{rows.length}</span>
            </div>
            <ul className="sb-inbox-auto-rows">
              {/* A ticket the server sends twice (one per job) still gets its own key. */}
              {rows.map((t, i) => (
                <li key={`${t.key}:${i}`} className="sb-inbox-auto-row" data-ticket={t.key}>
                  <span className="num ticket-key">{t.key}</span>
                  {linked && t.slug
                    ? <a className="ticket-title" href={jobHref(t.slug)} title={`Open the job on ${t.key}.`}>{t.title}</a>
                    : <span className="ticket-title">{t.title}</span>}
                  {why && t.reason && <span className="sb-inbox-auto-reason">{t.reason}</span>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TicketTable({ items, caption, jobs, pick, suggested, showQueue, now, peeked, onOpen, onStart, onStartStack, onFocusRow, hosted, auto, autoWorking }: {
  items: InboxItem[]; caption: string; jobs: readonly Job[]; pick: InboxItem | null; /** The reason for each suggested ticket, by key. */ suggested: ReadonlyMap<string, string>; /** Some row has a queue number: the Queue column shows. */ showQueue: boolean; now: Date; peeked: string | null;
  onOpen: (item: InboxItem) => void; onStart: (item: InboxItem) => void; onStartStack: (item: InboxItem) => void; onFocusRow: (item: InboxItem | null) => void;
  hosted?: HostedInbox;
  /** Auto start's setting, to mark the rows that start by themselves. */
  auto?: { on: boolean; tag: string } | null;
  /** The tickets whose job Auto is working on (the queue's working group), by key. */
  autoWorking?: ReadonlySet<string>;
}) {
  return (
    <div className="data-table inbox-table">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {showQueue && <th scope="col" aria-sort="ascending">Queue</th>}
            <th scope="col" aria-sort={showQueue ? undefined : 'ascending'}>Severity</th>
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
                {showQueue && (
                  <td className="cell-queue num">
                    {Number.isInteger(i.queuePosition)
                      ? <span title={`Number ${i.queuePosition} in your queue in Orbit (Plan my queue).`}>#{i.queuePosition}</span>
                      : <span className="muted" title="Not ranked in Orbit's Plan my queue yet.">Not ranked</span>}
                  </td>
                )}
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
                    {suggested.has(i.key) && <Chip tone="accent" title={SUGGESTED_HOVER}>Suggested</Chip>}
                    {startsByItself(i, auto) && <Chip tone="accent" title={`It has the tag "${auto!.tag.trim()}", so ${BRAND.name} starts it by itself when it is its turn.`}>{STARTS_BY_ITSELF}</Chip>}
                    {autoWorking?.has(i.key) && <Chip tone="accent" icon="activity">{AUTO_WORKING}</Chip>}
                    <span className="ticket-title">{i.title}</span>
                  </button>
                  {suggested.has(i.key) && <span className="muted ticket-reason">{suggested.get(i.key)}</span>}
                  {i.job && <span className="muted ticket-job">You are already on this: <a href={jobHref(i.job.slug)} title="Open the job on this ticket.">{i.job.title}</a></span>}
                  {!i.job && i.start?.state === 'failed' && <StartProblem start={i.start} />}
                  {!i.job && i.autoStartFailed && <span className="inbox-start-problem"><Icon name="warn" size={14} />{autoFailedLine(i.autoStartFailed)}</span>}
                </th>
                <td className="cell-age num" title={i.createdAt ? `Opened ${fullTime(i.createdAt)}` : undefined}>{relativeTime(i.createdAt, now) || '—'}</td>
                <td className="cell-who"><WhoIsOn who={i.assignee} /></td>
                <td className="cell-act">
                  {i.job ? (
                    <Button size="sm" href={jobHref(i.job.slug)} icon={job?.lane === 'needs-you' || i.job.state === 'needs-you' ? 'hand' : undefined} title={job?.laneReason ?? 'Open the job on this ticket.'}>
                      {job?.lane === 'needs-you' || i.job.state === 'needs-you' ? 'Needs you' : 'Open its job'}
                    </Button>
                  ) : hosted && i.start && onItsWay(i) ? (
                    <StartState start={i.start} onCancel={() => hosted.onCancel(i)} busy={hosted.sending === i.key} />
                  ) : (
                    <>
                      {!hosted && <Button
                        kind="quiet"
                        size="sm"
                        className="inbox-stack-start"
                        onClick={() => onStartStack(i)}
                        aria-label={`Start ${i.key} as a stack`}
                        title={`${STACK_WHEN} Opens New job on ${i.key}, run as a stack (key: Shift+S, with the focus on this row).`}
                      >
                        Start as stack
                      </Button>}
                      <Button
                        size="sm"
                        keyId={isPick ? 'inbox-start' : undefined}
                        busy={hosted?.sending === i.key}
                        busyLabel="Starting…"
                        onClick={() => onStart(i)}
                        aria-label={`Start a job on ${i.key}`}
                        title={hosted ? `Start a job on ${i.key} on your laptop (key: s, with the focus on this row).` : `Start a job on ${i.key}: opens New job with the key and title filled in (key: s, with the focus on this row).`}
                      >
                        {i.start?.state === 'failed' ? 'Start again' : 'Start'}
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

/** The quick look on the hosted site: what the site keeps; the ticket's links and timeline are on Orbit. */
function HostedTicketPeek({ item, order, onPick, onClose, onStart, onCancel, sending = false }: {
  item: InboxItem; order: readonly string[]; onPick: (key: string) => void; onClose: () => void;
  onStart: (item: InboxItem) => void; onCancel: (item: InboxItem) => void;
  /** Its Start or Cancel is on its way. */
  sending?: boolean;
}) {
  const now = useNow();
  usePeekKeys({ current: item.key, order, onPick, onClose });
  return (
    <Peek
      label={`${item.key}: ${item.title}`}
      className="ticket-peek"
      title={<span className="num ticket-key">{item.key}</span>}
      actions={item.url ? <Button kind="quiet" size="sm" icon="external" href={item.url} target="_blank" rel="noreferrer noopener" title="Open the ticket on Orbit, in a new tab.">Open on Orbit</Button> : null}
      keys={[['j k', 'the next or previous ticket'], ['s', 'start a job'], ['Esc', 'close']]}
      onClose={onClose}
    >
      <p className="ticket-peek-title">{item.title}</p>
      <dl className="ticket-facts">
        <div><dt>Status</dt><dd>{statusWord(item.status)}</dd></div>
        <div><dt>Severity</dt><dd><Severity item={item} /></dd></div>
        <div><dt>Opened</dt><dd className="num" title={item.createdAt ? fullTime(item.createdAt) : undefined}>{relativeTime(item.createdAt, now) || '—'}</dd></div>
        <div><dt>Assigned to</dt><dd><WhoIsOn who={item.assignee} /></dd></div>
      </dl>
      <div className="ticket-act">
        {item.job ? (
          <p className="ticket-on">You are already on this: <a href={jobHref(item.job.slug)}>{item.job.title}</a></p>
        ) : item.start && onItsWay(item) ? (
          <StartState start={item.start} onCancel={() => onCancel(item)} busy={sending} />
        ) : (
          <>
            {item.start?.state === 'failed' && <StartProblem start={item.start} />}
            <Button kind="primary" keyId="inbox-start" keyShown busy={sending} busyLabel="Starting…" onClick={() => onStart(item)} title="Start a job on this ticket on your laptop (key: s).">
              {item.start?.state === 'failed' ? 'Start again' : 'Start'}
            </Button>
          </>
        )}
      </div>
      {item.description && <p className="ticket-description">{item.description}</p>}
      <p className="muted">Its links and timeline are on Orbit. Your laptop shows them too, and the Foreman reads the whole ticket there.</p>
    </Peek>
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
