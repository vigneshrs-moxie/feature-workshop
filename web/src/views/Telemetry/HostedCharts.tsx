// The hosted site's two private Telemetry graphs (packet 2E): your own jobs, with their names, shown
// only to you. Usage by day, by job: one column per day, each job its own hue and pattern with its
// name in the key; cost per ticket and per stage: two lists of bars, tickets in the accent and stages
// in their stop's hue, each with its name and number beside it. Colour never works alone.
import { useId, useState } from 'react';
import { MenuButton, type MenuEntry } from '../../app/Menu';
import { Icon } from '../../components/Icon';
import { GraphTable, hasTodo } from './Card';
import { Legend, Swatch } from './charts';
import type { ByDayData, PrivateGraph, TicketStageData } from './hostedTypes';
import { niceMax, ONE, pct, slotClass, stopClass, usd } from './words';

const Empty = ({ children }: { children: string }) => <p className="muted tele-empty">{children}</p>;
const ofWeek = (p: number | null) => (p === null ? '' : ` · ${pct(p)} of a week`);

export function ByDayChart({ data }: { data: ByDayData }) {
  const max = niceMax(Math.max(0, ...data.days.map((d) => d.usd)));
  if (!data.days.some((d) => d.usd > 0)) return <Empty>Nothing recorded for your jobs in the last two weeks.</Empty>;
  const job = new Map(data.jobs.map((j) => [j.key, j]));
  return (
    <div className="tele-plot">
      <Legend items={data.jobs.map((j) => ({ key: j.key, mark: <Swatch slot={j.slot} />, label: j.label }))} />
      <ol className="tele-team-days" aria-label="Your spend by day, by job">
        {data.days.map((d) => (
          <li key={d.key} className="tele-team-day" aria-label={`${d.label}: ${usd(d.usd)}${ofWeek(d.percent)}${d.parts.length ? `: ${d.parts.map((p) => `${job.get(p.key)?.label ?? p.key} ${usd(p.usd)}`).join(', ')}` : ''}`}>
            <span className="tele-team-day-col" aria-hidden="true">
              {d.parts.map((p) => (
                <span key={p.key} className={`tele-team-day-part ${slotClass(job.get(p.key)?.slot ?? 8)}`} style={{ height: `${(p.usd / max) * 100}%` }} title={`${job.get(p.key)?.label ?? p.key}: ${usd(p.usd)}`} />
              ))}
            </span>
            <span className="tele-team-day-label" aria-hidden="true">{d.label.replace(/ \w+$/, '')}</span>
          </li>
        ))}
      </ol>
      <p className="muted tele-team-scale" aria-hidden="true">Tallest column: {usd(max)} a day</p>
    </div>
  );
}

export function TicketStageChart({ data }: { data: TicketStageData }) {
  if (!data.tickets.length) return <Empty>Nothing recorded for your jobs in the last 30 days.</Empty>;
  const tMax = Math.max(...data.tickets.map((t) => t.usd)) || 1;
  const sMax = Math.max(...data.stages.map((s) => s.usd)) || 1;
  return (
    <div className="tele-plot tele-team-two">
      <div>
        <h4 className="tele-team-sub">By ticket <span className="muted">· spend, and its share of a week’s limit</span></h4>
        <ul className="tele-hbars" aria-label="Spend by ticket, the last 30 days">
          {data.tickets.map((t) => (
            <li key={t.key} className="tele-hbar" aria-label={`${t.label}: ${usd(t.usd)}${ofWeek(t.percent)}`}>
              <span className="tele-bar-label" title={t.label}>{t.label}</span>
              <span className="tele-bar-track" aria-hidden="true"><span className={`tele-bar ${ONE}`} style={{ width: `calc((100% - 7em) * ${(t.usd / tMax).toFixed(4)})` }} /><span className="tele-bar-value">{usd(t.usd)}{t.percent === null ? '' : ` · ${pct(t.percent)}`}</span></span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="tele-team-sub">By stage <span className="muted">· spend, and its share of your spend</span></h4>
        <ul className="tele-hbars" aria-label="Spend by stage, the last 30 days">
          {data.stages.map((s) => (
            <li key={s.label} className="tele-hbar" aria-label={`${s.label}: ${usd(s.usd)}, ${pct(s.share * 100)} of your spend`}>
              <span className="tele-bar-label">{s.label}</span>
              <span className="tele-bar-track" aria-hidden="true"><span className={`tele-bar ${stopClass(s.stage)}`} style={{ width: `calc((100% - 7em) * ${(s.usd / sMax).toFixed(4)})` }} /><span className="tele-bar-value">{usd(s.usd)} · {pct(s.share * 100)}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Picture({ graph }: { graph: PrivateGraph }) {
  if (graph.id === 'by-day') return <ByDayChart data={graph.data} />;
  return <TicketStageChart data={graph.data} />;
}

/** One of your own graphs: as the laptop's cards (Card.tsx), with the lock, Table and Fold. */
export function PrivateCard({ graph, folded, onFold }: { graph: PrivateGraph; folded: boolean; onFold: () => void }) {
  const [table, setTable] = useState(false);
  const id = useId();
  const menu: MenuEntry[] = [
    ...(folded ? [] : [{ kind: 'action' as const, id: 'table', label: table ? 'Show the chart' : 'Show the table', icon: 'table' as const, run: () => setTable((v) => !v), hint: table ? 'Back to the picture.' : 'The numbers behind this graph as a table (for copying, and for screen readers).' }]),
    { kind: 'action', id: 'fold', label: folded ? 'Unfold' : 'Fold', icon: folded ? 'chevron-down' : 'minus', run: onFold, hint: folded ? 'Show the whole graph again.' : 'Keep only the headline. Remembered in this browser.' },
  ];
  return (
    <section className={`tele-card${folded ? ' is-folded' : ''}`} id={`tele-graph-${graph.id}`} data-graph={graph.id} data-audience={graph.audience} data-state={graph.state} aria-labelledby={`${id}-h`}>
      <header className="tele-card-head">
        <span className="tele-num" aria-hidden="true">{graph.n}</span>
        <div className="tele-card-titles">
          <span className="tele-card-kicker"><small className="tele-card-name">{graph.title}</small><span className="tele-audience" title="Your own jobs, with their names. Only you see this."><Icon name="lock" size={12} /> Only yours</span></span>
          <h3 id={`${id}-h`} className="tele-headline">
            {folded ? <button type="button" className="tele-headline-btn" onClick={onFold} title="Open this graph again.">{graph.headline}</button> : graph.headline}
          </h3>
        </div>
        <MenuButton className="tele-card-menu" label={`More for ${graph.title}`} icon="dots" hint="Table and Fold for this graph." entries={menu} />
      </header>
      {!folded && (
        <>
          <div className="tele-card-body">
            {/* GraphTable only reads the table. */}
            {table ? <GraphTable graph={graph as unknown as Parameters<typeof GraphTable>[0]['graph']} /> : <Picture graph={graph} />}
            {graph.sub && <p className="tele-card-sub">{graph.sub}</p>}
          </div>
          {graph.notes.length > 0 && <ul className="tele-notes">{graph.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          {hasTodo(graph as unknown as Parameters<typeof hasTodo>[0]) && <p className="tele-todo"><b><Icon name="flame" size={14} /> What to do</b> <span>{graph.todo}</span></p>}
        </>
      )}
    </section>
  );
}
