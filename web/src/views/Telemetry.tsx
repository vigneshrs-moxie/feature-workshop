// Telemetry (#/telemetry, packet P): the Claude limits and up to ten insight graphs for deciding about
// the product, how it's used and which plan to be on.
//   - The top: the two limits as dials (Read now, r, reads them again; the keys are tele-read and
//     tele-step in app/keyRegistry.ts, so Settings → Keys lists them), each split into this app's use
//     and Other use, then "Who used this week's limit": one segment per person in this app plus Other
//     use (estimated: the limit's rise this app's own work doesn't explain), each with a name, a percent
//     and a pattern, and a plain note on what Other use means. A segment opens People on the account.
//   - The next-step bar: plenty left, near the limit (⚠) or full (⛔), in words.
//   - The window (this five hours, this week, 30 days) changes the dials' graph 1 and People; the other
//     graphs keep their own spans.
//   - Ten cards, two columns wide (one on a phone, folded to their headlines but the first): each headed
//     by its finding, with What to do, Table ▸, Fold and Hide. Fold and Hide are remembered in this
//     browser, per person; hidden cards come back from "Show hidden graphs (n)".
// Data: GET /api/telemetry?window= (dashboard/lib/telemetry.js, lib/insights.js), read again every
// minute while the page is open and after Read now. Colours follow the colour rule (packet R): a single
// series in the accent with grey for what it is compared with; people, models and stages in the
// theme's status and stop hues, each with a pattern or its name on the mark (Telemetry.css); colour
// never works alone.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { GraphId, LimitSplit, PlanUsage, TelemetryGraph, TelemetryResponse, TelemetryWindow, UsageMeter } from '../api/types';
import { useKeyScope } from '../app/keyRegistry';
import { Button } from '../components/Button';
import { Segmented } from '../components/Choice';
import { Hero, NextBar, Page, useMinWidth, useNarrow, type GuideSpec } from '../components/page/Page';
import { resetsIn } from '../components/UsageMeters';
import { useStored } from '../lib/stored';
import { clockTime, useNow } from '../lib/time';
import { useWorkshop, useWorkshopState } from '../state/store';
import { GraphCard } from './Telemetry/Card';
import { Dial, levelOf, WhoLine } from './Telemetry/Top';
import { parsePrefs, pct, prefsKey, type Prefs } from './Telemetry/words';
import './Telemetry.css';
import { HiddenSlot, More } from '../components/More';

export type { TelemetryResponse, TelemetryWindow };

export const WINDOWS: { id: TelemetryWindow; label: string; short: string }[] = [
  { id: '5h', label: 'This five hours', short: '5 hours' },
  { id: 'week', label: 'This week', short: 'Week' },
  { id: '30d', label: '30 days', short: '30 days' },
];
const WINDOW_KEY = 'workshop.telemetryWindow';
const REFRESH_MS = 60_000;

const GUIDE: GuideSpec = {
  id: 'telemetry',
  title: 'How Telemetry works',
  cards: [
    { icons: ['gauge'], title: 'Two limits', say: 'Claude limits use over five hours and over a week, for everyone on the account. The dials show how much is used, and by whom: this app, or other use.' },
    { icons: ['activity', 'check'], title: 'Each graph says what it found', say: 'And one line on what to do about it. Table shows the numbers.' },
    { icons: ['minus', 'eye-off'], title: 'Fold or hide', say: 'Keep the ones you use. Hidden graphs come back from the end of the page.' },
  ],
  done: 'Show me the graphs',
};

function readWindow(): TelemetryWindow {
  try {
    const w = window.localStorage.getItem(WINDOW_KEY);
    if (w === '5h' || w === 'week' || w === '30d') return w;
  } catch { /* storage blocked: this week */ }
  return 'week';
}

export function TelemetryView() {
  const { api, store } = useWorkshop();
  const { planUsage } = useWorkshopState();
  const now = useNow(30_000);
  const narrow = useNarrow();
  const [win, setWin] = useState<TelemetryWindow>(readWindow);
  const [data, setData] = useState<TelemetryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const asked = useRef(0);

  const load = useCallback(async (w: TelemetryWindow) => {
    const n = ++asked.current;
    setLoading(true);
    try {
      const body = await api.get<TelemetryResponse>(`/api/telemetry?window=${w}`);
      if (n !== asked.current) return;
      setData(body);
      setError(null);
    } catch (err) {
      if (n === asked.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (n === asked.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load(win);
    const id = setInterval(() => void load(win), REFRESH_MS);
    return () => clearInterval(id);
  }, [load, win]);

  // Fold and Hide, per person (the computer's user name the dashboard says this page is for).
  const me = data?.me ?? null;
  const [stored, setStored] = useStored(prefsKey(me));
  const prefs = parsePrefs(stored);
  const save = (next: Prefs) => setStored(JSON.stringify(next));

  const pick = (w: TelemetryWindow) => {
    setWin(w);
    try { window.localStorage.setItem(WINDOW_KEY, w); } catch { /* only this visit, then */ }
  };

  const u: PlanUsage | null = planUsage ?? data?.meters ?? null;
  const canRead = Boolean(u?.enabled);
  const readNow = useCallback(async () => {
    if (!canRead || reading) return;
    setReading(true);
    try {
      const fresh = await api.post<PlanUsage>('/api/usage/check', {});
      store.dispatch({ type: 'plan-usage', planUsage: fresh });
      void load(win);
    } catch { /* the next minute's reading tries again */ } finally {
      setReading(false);
    }
  }, [api, store, load, win, canRead, reading]);
  // r: Read now (app/keyRegistry.ts tele-read), while this page is open and the limits are read here.
  useKeyScope('global', { 'tele-read': () => { void readNow(); } }, canRead);

  // Each dial: the live reading, else the newest reading in the usage log (plan usage off for a while, or demo mode).
  const weekMeter = u?.week ?? (data ? fromLog(data.limits.week, 7 * 864e5) : null);
  const fiveMeter = u?.fiveHour ?? (data ? fromLog(data.limits.fiveHour, 5 * 3600e3) : null);
  const graphs = data?.graphs ?? [];
  const limit = graphs.find((g) => g.id === 'limit');
  const hidden = new Set(prefs.hidden);
  const folded = (g: TelemetryGraph) => prefs.folded[g.id] ?? (narrow && g.n !== 1);
  const toggleFold = (id: GraphId, was: boolean) => save({ ...prefs, folded: { ...prefs.folded, [id]: !was } });
  const hide = (id: GraphId) => save({ ...prefs, hidden: [...new Set([...prefs.hidden, id])] });
  const show = (id: GraphId) => save({ folded: { ...prefs.folded, [id]: false }, hidden: prefs.hidden.filter((x) => x !== id) });
  const openPeople = () => {
    if (hidden.has('people')) show('people');
    else if (prefs.folded.people ?? narrow) toggleFold('people', true);
    requestAnimationFrame(() => document.getElementById('tele-graph-people')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const readButton = (
    <Button kind="primary" size="lg" keyId="tele-read" onClick={() => void readNow()} disabled={!canRead || reading} title={canRead ? 'Read the limits from Claude now (they are read every minute by themselves).' : 'The limits aren’t read on this computer.'}>
      {reading ? 'Reading…' : 'Read now'}
    </Button>
  );
  // The window, one of three (packet R: the shared segmented choice; the short words on a phone).
  const head = (
    <Segmented<TelemetryWindow>
      className="tele-windows"
      label="Window: what the dials’ graph and People cover"
      value={win}
      onChange={pick}
      options={WINDOWS.map((w) => ({ value: w.id, label: <><span className="tele-long">{w.label}</span><span className="tele-short">{w.short}</span></>, title: `Show ${w.label.toLowerCase()} in the weekly graph and People.` }))}
    />
  );

  // Nothing recorded and no reading of the limits: the empty state.
  const nothing = data && data.lines === 0 && !graphs.some((g) => g.state === 'ok' && g.id !== 'limit') && !u?.week && !u?.fiveHour && !(limit && limit.data.points.length);

  return (
    <Page label="Telemetry" title="Telemetry" className="page-telemetry tele" head={head} guide={GUIDE}>
      {error && (
        <p className="thread-error" role="alert">
          Couldn’t read the usage log: {error}{' '}
          <Button kind="quiet" size="sm" onClick={() => void load(win)} title="Ask the dashboard again.">Try again</Button>
        </p>
      )}
      {!data && loading && <p className="muted" role="status">Reading…</p>}
      {data && nothing && (
        <Hero icon="gauge" title="No readings yet" actions={readButton}>
          The meters fill in after the first Foreman turn on this computer. Each graph appears once it has enough to say: cost per ticket after two finished tickets, the weekday map after a week.
        </Hero>
      )}
      {data && !nothing && (
        <>
          <section className="tele-dials" aria-label="The Claude limits now">
            <Dial name="5-hour limit" unread="No reading in this five hours yet" meter={fiveMeter} split={data.limits.fiveHour} when={dialWhen(fiveMeter, u?.fiveHour ?? null, data.limits.fiveHour, (r) => `Resets ${resetsIn(r, now)}`, now)} />
            <Dial name="Weekly limit" meter={weekMeter} split={data.limits.week} when={dialWhen(weekMeter, u?.week ?? null, data.limits.week, (r) => `Resets ${clockTime(r, now)}`, now)} />
          </section>
          <WhoLine split={data.limits.week} note={data.limits.note} onPick={openPeople} />
          <LimitBar usage={u} logged={weekMeter} limit={limit} now={now}>{readButton}</LimitBar>
          <GraphColumns
            graphs={graphs}
            loading={loading}
            hidden={hidden}
            folded={folded}
            onFold={(g, f) => toggleFold(g.id, f)}
            onHide={(g) => hide(g.id)}
            onShow={(g) => show(g.id)}
          />
          <p className="muted tele-foot">Fold, Hide and More graphs are remembered in this browser, for you only. Every Foreman turn on this computer is one line in {data.file ? <code>{data.file}</code> : 'the usage log'}; nothing is sent anywhere.</p>
        </>
      )}
    </Page>
  );
}

/**
 * The graphs as columns of their own (packet R): two, three from 1600 px. Folding or hiding a card
 * changes only its own column; a hidden card leaves a slim line with Show in its place. Simple shows
 * the three with the most to say first, then "More graphs (n)"; Full opens them all.
 */
function GraphColumns({ graphs, loading, hidden, folded, onFold, onHide, onShow }: {
  graphs: TelemetryGraph[]; loading: boolean; hidden: ReadonlySet<GraphId>;
  folded(g: TelemetryGraph): boolean; onFold(g: TelemetryGraph, was: boolean): void; onHide(g: TelemetryGraph): void; onShow(g: TelemetryGraph): void;
}) {
  const wide = useMinWidth(1600);
  const narrow = useNarrow();
  const cols = narrow ? 1 : wide ? 3 : 2;
  const said = graphs.filter((g) => g.state === 'ok' && g.id !== 'limit');
  const first = new Set((said.length >= 3 ? said : graphs).slice(0, 3).map((g) => g.id));
  const top = graphs.filter((g) => first.has(g.id));
  const rest = graphs.filter((g) => !first.has(g.id));
  const lay = (list: TelemetryGraph[]) => (
    <div className={`tele-graphs cols-${cols}${loading ? ' is-loading' : ''}`} aria-busy={loading}>
      {Array.from({ length: cols }, (_, c) => (
        <div key={c} className="tele-graph-col">
          {list.filter((_, i) => i % cols === c).map((g) => (hidden.has(g.id)
            ? <HiddenSlot key={g.id} name={g.title} onShow={() => onShow(g)} className="tele-hidden-slot" />
            : <GraphCard key={g.id} graph={g} folded={folded(g)} onFold={() => onFold(g, folded(g))} onHide={() => onHide(g)} />))}
        </div>
      ))}
    </div>
  );
  return (
    <>
      {lay(top)}
      {rest.length > 0 && (
        <More screen="telemetry" id="more-graphs" label={`More graphs (${rest.length})`} note={rest.map((g) => g.title.toLowerCase()).slice(0, 3).join(', ') + (rest.length > 3 ? '…' : '')} icon="activity" className="tele-more">
          {lay(rest)}
        </More>
      )}
    </>
  );
}

/** A meter from the newest reading in the usage log, when the live one isn't there. */
function fromLog(split: LimitSplit, span: number): UsageMeter | null {
  if (split.total === null || (split.state !== 'split' && split.state !== 'no-ratio')) return null;
  return { percent: split.total, resetsAt: split.from ? new Date(Date.parse(split.from) + span).toISOString() : null };
}
const dialWhen = (shown: UsageMeter | null, live: UsageMeter | null, split: LimitSplit, resets: (iso: string) => string, now: Date) => {
  if (!shown) return '';
  if (!live && split.to) return `Last read ${clockTime(split.to, now)}`;
  return shown.resetsAt ? resets(shown.resetsAt) : '';
};

/** The next-step bar: plenty left, near the limit, full, or the limits not read here. */
function LimitBar({ usage, logged, limit, now, children }: { usage: PlanUsage | null; logged: UsageMeter | null; limit: TelemetryGraph | undefined; now: Date; children: ReactNode }) {
  const week = usage?.week ?? null;
  if (!usage?.enabled) {
    return <NextBar tone="quiet" icon="gauge" say="The limits aren’t read on this computer" sub={logged ? `Demo mode, or reading the plan’s usage is turned off: the dials show the newest reading in the usage log (${pct(logged.percent)} of the week).` : 'Demo mode, or reading the plan’s usage is turned off. The graphs show dollars only.'}>{children}</NextBar>;
  }
  if (!week) return <NextBar tone="quiet" icon="gauge" say="The weekly limit isn’t read yet" sub={usage.error ? `The last read failed: ${usage.error}` : 'Read now reads it.'}>{children}</NextBar>;
  const level = levelOf(week.percent);
  const reset = week.resetsAt ? clockTime(week.resetsAt, now) : null;
  if (level === 'full') return <NextBar tone="warn" icon="octagon" say="⛔ The weekly limit is reached" sub={`Jobs are paused${reset ? ` until ${reset}` : ' until the reset'}. Go-aheads you give now wait and go then.`}>{children}</NextBar>;
  if (level === 'warn') return <NextBar tone="warn" icon="warn" say={`⚠ The week is at ${pct(week.percent)}`} sub={limit?.headline}>{children}</NextBar>;
  return <NextBar tone="quiet" icon="gauge" say="Plenty left this week" sub={limit?.headline}>{children}</NextBar>;
}
