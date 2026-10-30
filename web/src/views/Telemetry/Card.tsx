// One insight graph's card: its name small, its finding as the heading, who sees it (the lock or
// the people), the picture, a What to do line when there is something to do, and one ⋯ menu with
// Show the table, Fold and Hide. Fold keeps only the headline (tap it to open again); Hide leaves a
// slim line in the card's place with Show (components/More.tsx HiddenSlot), so nothing moves.
import { useId, useState } from 'react';
import type { TelemetryAudience, TelemetryGraph } from '../../api/types';
import { Icon } from '../../components/Icon';
import { MenuButton, type MenuEntry } from '../../app/Menu';
import { GraphPicture } from './charts';

const AUDIENCE: Record<TelemetryAudience, { icon: 'lock' | 'users'; label: string; hint: string }> = {
  private: { icon: 'lock', label: 'Only yours', hint: 'Your own jobs, with their names. Only you see this.' },
  common: { icon: 'users', label: 'Whole account', hint: 'About the shared Claude account, with names and no job names: the kind of graph the whole team can see.' },
};

export function GraphTable({ graph }: { graph: TelemetryGraph }) {
  const { caption, head, rows } = graph.table;
  return (
    <div className="tele-table-wrap">
      <table className="tele-table">
        {caption && <caption>{caption}</caption>}
        <thead><tr>{head.map((h, i) => <th key={h} scope="col" className={i ? 'n' : undefined}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j ? <td key={j} className="n">{c}</td> : <th key={j} scope="row">{c}</th>))}</tr>)
            : <tr><td colSpan={Math.max(1, head.length)} className="muted">Nothing to show yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Whether a graph's What to do says something to do (not "Nothing to do yet…"). */
export const hasTodo = (g: TelemetryGraph) => Boolean(g.todo) && !/^nothing (to do|to change)/i.test(g.todo.trim());

export function GraphCard({ graph, folded, onFold, onHide }: { graph: TelemetryGraph; folded: boolean; onFold: () => void; onHide: () => void }) {
  const [table, setTable] = useState(false);
  const id = useId();
  const aud = AUDIENCE[graph.audience];
  // One ⋯ menu per card (packet R): Chart or Table, Fold, Hide.
  const menu: MenuEntry[] = [
    ...(folded ? [] : [{ kind: 'action' as const, id: 'table', label: table ? 'Show the chart' : 'Show the table', icon: 'table' as const, run: () => setTable((v) => !v), hint: table ? 'Back to the picture.' : 'The numbers behind this graph as a table (for copying, and for screen readers).' }]),
    { kind: 'action', id: 'fold', label: folded ? 'Unfold' : 'Fold', icon: folded ? 'chevron-down' : 'minus', run: onFold, hint: folded ? 'Show the whole graph again.' : 'Keep only the headline. Remembered in this browser.' },
    { kind: 'action', id: 'hide', label: 'Hide', icon: 'eye-off', run: onHide, hint: 'Leave a slim line in its place with Show. Remembered in this browser.' },
  ];
  return (
    <section className={`tele-card${folded ? ' is-folded' : ''}`} id={`tele-graph-${graph.id}`} data-graph={graph.id} data-audience={graph.audience} data-state={graph.state} aria-labelledby={`${id}-h`}>
      <header className="tele-card-head">
        <span className="tele-num" aria-hidden="true">{graph.n}</span>
        <div className="tele-card-titles">
          <span className="tele-card-kicker"><small className="tele-card-name">{graph.title}</small><span className="tele-audience" title={aud.hint}><Icon name={aud.icon} size={12} /> {aud.label}</span></span>
          <h3 id={`${id}-h`} className="tele-headline">
            {folded ? <button type="button" className="tele-headline-btn" onClick={onFold} title="Open this graph again.">{graph.headline}</button> : graph.headline}
          </h3>
        </div>
        <MenuButton className="tele-card-menu" label={`More for ${graph.title}`} icon="dots" hint="Table, Fold and Hide for this graph." entries={menu} />
      </header>
      {!folded && (
        <>
          <div className="tele-card-body">
            {table ? <GraphTable graph={graph} /> : <GraphPicture graph={graph} />}
            {graph.sub && <p className="tele-card-sub">{graph.sub}</p>}
          </div>
          {graph.notes.length > 0 && <ul className="tele-notes">{graph.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          {hasTodo(graph) && <p className="tele-todo"><b><Icon name="flame" size={14} /> What to do</b> <span>{graph.todo}</span></p>}
        </>
      )}
    </section>
  );
}
