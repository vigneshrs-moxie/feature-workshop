// Telemetry on the hosted site (#/telemetry, packet 2E, decision G30's v2 half): one picture of the
// shared Claude account's limit, from every paired laptop, the same for everyone on the site (the
// manager too), then your own two graphs, which only you see.
//   - The top: the two limits as dials (the laptop's Dial, Top.tsx), from the newest reading any
//     laptop sent, each split into the app's use, Claude Code use outside it and Other use.
//   - The shared account (the people icon, "Whole account"): the gauge over this plan week with the
//     forecast (the week starts Wednesday 4 pm), Share by model, and Who used this week's limit: each
//     person in the app and in Claude Code apart, Other use once for the account, adding up to the
//     total. The laptop's own cards and charts (Card.tsx, charts.tsx) draw them.
//   - Your own jobs (the lock, "Only yours"): usage by day by job and cost per ticket and stage
//     (HostedCharts.tsx). The site answers them for you only.
//   - Fold and Hide, remembered in this browser for you; the guide says what the page is the first time.
// Data: GET /api/telemetry/team?tz= and GET /api/telemetry/people/<you>?tz=, read again every minute.
// A 401 (the session ended) brings the sign-in page back. Status is in words and patterns, never
// colour alone.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type ApiClient } from '../../api/client';
import type { GraphId, TelemetryGraph } from '../../api/types';
import { Button } from '../../components/Button';
import { HiddenSlot } from '../../components/More';
import { Hero, Page, useNarrow, type GuideSpec } from '../../components/page/Page';
import { useStored } from '../../lib/stored';
import { clockTime, useNow } from '../../lib/time';
import { GraphCard } from './Card';
import { PrivateCard } from './HostedCharts';
import type { MyTelemetry, PrivateGraph, TeamMeter, TeamTelemetry } from './hostedTypes';
import { Dial } from './Top';
import { parsePrefs, type Prefs } from './words';
import '../Telemetry.css';
import './hostedTelemetry.css';

const REFRESH_MS = 60_000;

const GUIDE: GuideSpec = {
  id: 'team-telemetry',
  title: 'How Telemetry works here',
  cards: [
    { icons: ['users'], title: 'One shared limit', say: 'Everyone on the Claude account sees the same picture: how much of this week’s limit is used, by whom, and when it fills at this pace. The week starts on Wednesday at 4 pm.' },
    { icons: ['gauge', 'activity'], title: 'Who used it', say: 'Each person’s use in the app and in Claude Code outside it, kept apart. Other use (claude.ai, the Claude app, other people) is estimated from the meters, once for the account.' },
    { icons: ['lock'], title: 'Your jobs stay yours', say: 'The two graphs about your own jobs show their names to you only. Laptops send numbers only: never prompts, replies, code or file names.' },
  ],
  done: 'Show me the limit',
};

/** The browser's own time zone, for the plan week's Wednesday 4 pm. */
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
const tzQuery = () => { const z = zone(); return z ? `?tz=${encodeURIComponent(z)}` : ''; };

type Hideable = GraphId | PrivateGraph['id'];

export function HostedTelemetryPage({ api, person, onSignedOut }: { api: ApiClient; person: { id: number; name: string }; onSignedOut: () => void }) {
  const now = useNow(30_000);
  const narrow = useNarrow();
  const [team, setTeam] = useState<TeamTelemetry | null>(null);
  const [mine, setMine] = useState<MyTelemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const asked = useRef(0);

  const load = useCallback(async () => {
    const n = ++asked.current;
    setLoading(true);
    try {
      const [t, m] = await Promise.all([
        api.get<TeamTelemetry>(`/api/telemetry/team${tzQuery()}`),
        api.get<MyTelemetry>(`/api/telemetry/people/${person.id}${tzQuery()}`),
      ]);
      if (n !== asked.current) return;
      setTeam(t);
      setMine(m);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onSignedOut(); return; }
      if (n === asked.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (n === asked.current) setLoading(false);
    }
  }, [api, person.id, onSignedOut]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const [stored, setStored] = useStored(`gc.telemetry.team.${person.id}`);
  const prefs = parsePrefs(stored);
  const save = (next: Prefs) => setStored(JSON.stringify(next));
  const folded = (id: Hideable, first: boolean) => (prefs.folded as Record<string, boolean | undefined>)[id] ?? (narrow && !first);
  const hidden = new Set<string>(prefs.hidden);
  const toggleFold = (id: Hideable, was: boolean) => save({ ...prefs, folded: { ...prefs.folded, [id]: !was } });
  const hide = (id: Hideable) => save({ ...prefs, hidden: [...new Set([...prefs.hidden, id as GraphId])] });
  const show = (id: Hideable) => save({ folded: { ...prefs.folded, [id]: false }, hidden: prefs.hidden.filter((x) => x !== id) });

  const nothing = team && team.lines === 0 && !team.meters.week && !team.meters.fiveHour && !(mine && mine.lines > 0);
  const graph = (id: GraphId) => team?.graphs.find((g) => g.id === id) ?? null;
  const card = (g: TelemetryGraph | null, first = false) => {
    if (!g) return null;
    if (hidden.has(g.id)) return <HiddenSlot key={g.id} name={g.title} onShow={() => show(g.id)} className="tele-hidden-slot" />;
    const f = folded(g.id, first);
    return <GraphCard key={g.id} graph={g} folded={f} onFold={() => toggleFold(g.id, f)} onHide={() => hide(g.id)} />;
  };

  return (
    <Page label="Telemetry" title="Telemetry" className="page-telemetry tele tele-team" guide={GUIDE}>
      <p className="muted tele-team-lead">One picture of the shared Claude account’s limit, from every laptop paired with this site. {team ? `${team.weekLabel}.` : 'The week starts on Wednesday at 4 pm.'}</p>
      {error && (
        <p className="thread-error" role="alert">
          Couldn’t read Telemetry from the site: {error}{' '}
          <Button kind="quiet" size="sm" onClick={() => void load()} title="Ask the site again.">Try again</Button>
        </p>
      )}
      {!team && loading && !error && <p className="muted" role="status">Reading…</p>}
      {team && nothing && (
        <Hero icon="gauge" title="Nothing from any laptop yet" actions={<Button kind="primary" href="#/settings/laptops" title="Pair a laptop with the site.">Open Settings → Laptops</Button>}>
          Telemetry fills in once a paired laptop sends its usage: each turn of its jobs, and the limit’s reading every few minutes. Laptops send numbers only, never prompts, replies, code or file names.
        </Hero>
      )}
      {team && !nothing && (
        <>
          <section className="tele-dials" aria-label="The Claude limits now">
            <Dial name="5-hour limit" unread="No reading in this five hours yet" meter={live(team.meters.fiveHour)} split={team.limits.fiveHour} when={readWords(team.meters.fiveHour, now)} />
            <Dial name="Weekly limit" unread="No reading this week yet" meter={live(team.meters.week)} split={team.limits.week} when={readWords(team.meters.week, now)} />
          </section>

          <section className="tele-team-part" aria-labelledby="tele-team-shared">
            <h3 id="tele-team-shared" className="tele-team-part-title">The shared account</h3>
            <p className="muted tele-team-part-say">The same for everyone on this site. Names only, never job names.</p>
            <div className={`tele-team-graphs${loading ? ' is-loading' : ''}`} aria-busy={loading}>
              <div className="tele-team-wide">{card(graph('limit'), true)}</div>
              {card(graph('people'), true)}
              {card(graph('models'))}
            </div>
          </section>

          <section className="tele-team-part" aria-labelledby="tele-team-mine">
            <h3 id="tele-team-mine" className="tele-team-part-title">Your own jobs</h3>
            <p className="muted tele-team-part-say">Only you see these, as on your laptop.</p>
            <div className={`tele-team-graphs${loading ? ' is-loading' : ''}`} aria-busy={loading}>
              {(mine?.graphs ?? []).map((g) => (hidden.has(g.id)
                ? <HiddenSlot key={g.id} name={g.title} onShow={() => show(g.id)} className="tele-hidden-slot" />
                : <PrivateCard key={g.id} graph={g} folded={folded(g.id, false)} onFold={() => toggleFold(g.id, folded(g.id, false))} />))}
            </div>
          </section>

          <p className="muted tele-foot">
            {team.newest ? `The newest numbers are from ${clockTime(team.newest, now)}. ` : ''}
            Each paired laptop sends its usage numbers only: never prompts, replies, code or file names. Other use is estimated from the meters. Fold and Hide are remembered in this browser, for you only.
          </p>
        </>
      )}
    </Page>
  );
}

/** A meter for the dial when its reading is of the window running now. */
const live = (m: TeamMeter | null) => (m && m.current ? { percent: m.percent, resetsAt: m.resetsAt } : null);
const readWords = (m: TeamMeter | null, now: Date) => (m && m.current ? `Last read ${clockTime(m.at, now)}${m.resetsAt ? ` · resets ${clockTime(m.resetsAt, now)}` : ''}` : '');
