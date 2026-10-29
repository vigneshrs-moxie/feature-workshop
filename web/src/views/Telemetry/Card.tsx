// One insight graph's card: its name small, its finding as the heading, who sees it (the lock or
// the people), the picture, a What to do line, and Table ▸, Fold and Hide. Fold keeps only the
// headline (tap it to open again); Hide moves the card to "Show hidden graphs" at the end.
import { useId, useState } from 'react';
import type { TelemetryAudience, TelemetryGraph } from '../../api/types';
import { Icon } from '../../components/Icon';
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

export function GraphCard({ graph, folded, onFold, onHide }: { graph: TelemetryGraph; folded: boolean; onFold: () => void; onHide: () => void }) {
  const [table, setTable] = useState(false);
  const id = useId();
  const aud = AUDIENCE[graph.audience];
  return (
    <section className={`tele-card${folded ? ' is-folded' : ''}`} id={`tele-graph-${graph.id}`} data-graph={graph.id} data-audience={graph.audience} data-state={graph.state} aria-labelledby={`${id}-h`}>
      <header className="tele-card-head">
        <span className="tele-num" aria-hidden="true">{graph.n}</span>
        <div className="tele-card-titles">
          <small className="tele-card-name">{graph.title}</small>
          <h3 id={`${id}-h`} className="tele-headline">
            {folded ? <button type="button" className="tele-headline-btn" onClick={onFold} title="Open this graph again.">{graph.headline}</button> : graph.headline}
          </h3>
        </div>
        <span className="chip tele-audience" title={aud.hint}><Icon name={aud.icon} size={12} /> {aud.label}</span>
      </header>
      {!folded && (
        <>
          <div className="tele-card-body">
            <GraphPicture graph={graph} />
            {graph.sub && <p className="tele-card-sub">{graph.sub}</p>}
          </div>
          {table && <GraphTable graph={graph} />}
          {graph.notes.length > 0 && <ul className="tele-notes">{graph.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          <p className="tele-todo"><b><Icon name="flame" size={14} /> What to do</b> <span>{graph.todo}</span></p>
        </>
      )}
      <div className="tele-card-actions">
        {!folded && (
          <button type="button" className="btn btn-quiet" aria-expanded={table} onClick={() => setTable((v) => !v)} title={table ? 'Hide the numbers.' : 'Show the numbers behind this graph as a table (for copying, and for screen readers).'}>
            Table {table ? '▾' : '▸'}
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" aria-pressed={folded} onClick={onFold} title={folded ? 'Show the whole graph again.' : 'Keep only the headline. Remembered in this browser.'}>
          <Icon name={folded ? 'chevron-down' : 'minus'} size={16} /> {folded ? 'Unfold' : 'Fold'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onHide} title="Move this graph to “Show hidden graphs” at the end of the page. Remembered in this browser.">
          <Icon name="eye-off" size={16} /> Hide
        </button>
      </div>
    </section>
  );
}
