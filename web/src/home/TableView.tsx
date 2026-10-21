// The Table (Home): the same jobs as the map, as rows you can sort, filter and search. Click a job
// (or press Enter on it) to open it; ↑ and ↓ move between rows. The sort and filter are remembered
// in this browser.
import { useMemo, useRef, useState } from 'react';
import type { FlowPr } from '../api/types';
import { useKeyScope } from '../app/keyRegistry';
import { jobHref } from '../app/router';
import { KeyLegend } from '../components/Kbd';
import { useStored } from '../lib/stored';
import { relativeTime } from '../lib/time';
import { jobHueStyle } from '../theme/hue';
import { countsText, countsWords, filterRows, prText, prTone, sortRows, type SortKey, type TableFilter, type TableRow } from './homeModel';

export const TABLE_FILTER_KEY = 'fw.home.table.filter';
export const TABLE_SORT_KEY = 'fw.home.table.sort';

const FILTERS: { id: TableFilter; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Every job the dashboard knows.' },
  { id: 'needs-you', label: 'Needs you', hint: 'Waiting for your go-ahead, an answer or a click.' },
  { id: 'running', label: 'Running', hint: 'The Foreman or its crew are working on it now.' },
  { id: 'idle', label: 'Idle', hint: 'Nothing happening and nothing asked of you.' },
  { id: 'review', label: 'In review', hint: 'It has a PR open on GitHub.' },
  { id: 'shipping', label: 'Shipping', hint: 'Past the finish line you set, on its way to main; nothing asks you anything.' },
  { id: 'done', label: 'Done', hint: 'Finished, or marked done or dropped.' },
];

const COLUMNS: { key: SortKey | null; label: string; hint: string }[] = [
  { key: 'job', label: 'Job', hint: 'The job’s title. Click it to open the job.' },
  { key: 'repo', label: 'Repo', hint: 'The repository it changes.' },
  { key: null, label: 'Branch', hint: 'The job’s branch.' },
  { key: 'level', label: 'Level', hint: 'L0 Tweak to L3 Large.' },
  { key: 'stage', label: 'Stage', hint: 'The workflow stage it is on.' },
  { key: 'status', label: 'Status', hint: 'What it is doing or waiting for, as in the Jobs list.' },
  { key: 'where', label: 'Where', hint: 'How far its work has got, in the map’s words: your worktree, your fork, the Moxie branch, staging, main, and the PR it is on.' },
  { key: 'main', label: 'vs main', hint: 'Commits ahead of (↑) and behind (↓) main. Behind means main has moved on since the branch started.' },
  { key: null, label: 'PR #1', hint: 'Your fork → the Moxie branch.' },
  { key: null, label: 'PR #2', hint: 'The Moxie branch → staging (or into main where there is no staging).' },
  { key: 'updated', label: 'Updated', hint: 'When the job last changed.' },
];

function PrCell({ pr }: { pr: FlowPr | null }) {
  if (!pr) return <span className="muted">—</span>;
  const text = prText(pr);
  return pr.url
    ? <a className={`flow-pr is-${prTone(pr)}`} href={pr.url} target="_blank" rel="noreferrer" title={`${pr.title || text}. Opens on GitHub.`}>{text}</a>
    : <span className={`flow-pr is-${prTone(pr)}`}>{text}</span>;
}

export function TableView({ rows, now }: { rows: TableRow[]; now: Date }) {
  const [filterRaw, setFilter] = useStored(TABLE_FILTER_KEY);
  const [sortRaw, setSort] = useStored(TABLE_SORT_KEY);
  const [query, setQuery] = useState('');
  const filter = (FILTERS.some((f) => f.id === filterRaw) ? filterRaw : 'all') as TableFilter;
  const [sortKey, sortDir] = (sortRaw ?? 'status:asc').split(':') as [SortKey, 'asc' | 'desc'];
  const shown = useMemo(() => sortRows(filterRows(rows, filter, query), sortKey, sortDir === 'desc' ? 'desc' : 'asc'), [rows, filter, query, sortKey, sortDir]);
  const body = useRef<HTMLTableSectionElement>(null);
  const count = (id: TableFilter) => filterRows(rows, id).length;

  function sortBy(key: SortKey) {
    setSort(`${key}:${key === sortKey && sortDir === 'asc' ? 'desc' : 'asc'}`);
  }
  // ↑ and ↓ move between the rows' job links while the focus is in the table (the 'table' scope).
  const step = (e: KeyboardEvent, by: 1 | -1) => {
    if (!(e.target instanceof Node) || !body.current?.contains(e.target)) return false;
    const links = [...(body.current?.querySelectorAll<HTMLAnchorElement>('a.table-job') ?? [])];
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = links[Math.max(0, Math.min(links.length - 1, at + by))];
    if (!next) return false;
    next.focus();
  };
  useKeyScope('table', { 'table-down': (e) => step(e, 1), 'table-up': (e) => step(e, -1) });

  return (
    <div className="home-table">
      <div className="home-table-tools">
        <div className="home-seg" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={`home-seg-btn${filter === f.id ? ' is-on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} title={f.hint}>
              {f.label} <span className="count">{count(f.id)}</span>
            </button>
          ))}
        </div>
        <label className="home-search">
          <span className="sr-only">Search jobs</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, branch, repo…" title="Search the jobs’ titles, branches, repos, stages and statuses." />
        </label>
      </div>
      <div className="home-table-scroll">
        <table>
          <caption className="sr-only">Jobs, {shown.length} of {rows.length}. Sorted by {COLUMNS.find((c) => c.key === sortKey)?.label}.</caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.label} scope="col" aria-sort={c.key === sortKey ? (sortDir === 'desc' ? 'descending' : 'ascending') : undefined} title={c.hint}>
                  {c.key ? (
                    <button type="button" className="th-sort" onClick={() => sortBy(c.key as SortKey)}>
                      {c.label}<span aria-hidden="true">{c.key === sortKey ? (sortDir === 'desc' ? ' ▾' : ' ▴') : ''}</span>
                    </button>
                  ) : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={body}>
            {shown.map((r) => (
              <tr key={r.slug} data-group={r.group}>
                <th scope="row">
                  <span className="hue-dot" style={jobHueStyle(r.slug)} aria-hidden="true" />
                  <a className="table-job" href={jobHref(r.slug)} title={`Open ${r.title}.`}>{r.title}</a>
                </th>
                <td>{r.repo || <span className="muted">—</span>}</td>
                <td>{r.branch ? <code className="flow-branch">{r.branch}</code> : <span className="muted">—</span>}</td>
                <td>{r.level === null ? <span className="muted">—</span> : `L${r.level}`}</td>
                <td>{r.stage || <span className="muted">—</span>}</td>
                <td><span className={`job-status status-${r.group}`} title={r.statusHint}>{r.status}</span></td>
                <td className="table-where">{r.where || <span className="muted">—</span>}</td>
                <td>{r.vsMain ? <span className={`flow-count${r.vsMain.behind > 0 ? ' is-behind' : ''}`} title={countsWords(r.vsMain, 'main')}>{countsText(r.vsMain)}</span> : <span className="muted">—</span>}</td>
                <td><PrCell pr={r.pr1} /></td>
                <td><PrCell pr={r.pr2} /></td>
                <td className="muted">{relativeTime(r.updatedAt, now) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="muted home-empty">No jobs match. Try another filter or clear the search.</p>}
      </div>
      <KeyLegend ids={['table-down', 'table-up', 'table-open']} className="table-keys" />
    </div>
  );
}
