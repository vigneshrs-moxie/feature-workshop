// The flow map (Home) as rows (Light, round 3; dashboard/lib/flow.js is the data). One section per
// repo with its release train on the header line; inside it the rows under Needs you · Running ·
// Idle · Shipping · Done (Done folded by default). One row per job: its crew member, title, the ship
// track (worktree · fork · Moxie branch · staging · main as dots, filled up to where the work is,
// the finish-line flag on the stop you chose), one line of words under it with the counts as a
// muted suffix, and one "what to do next" hint on the right.
//
// Nothing here depends on colour: filled stops are discs, empty ones rings, the current one bigger;
// every row says in words where its work is, and the track has a hidden sentence for screen
// readers. Clicking a job opens it; clicking a PR opens it on GitHub.
//
// Above the rows: filter chips with counts, "With recently closed", the layer toggles and Refresh.
// Keys (the 'map' scope, app/keyRegistry.ts): j/k move the highlighted row, Enter opens the job,
// o its newest PR, / jumps to the chips, 1–4 pick them.
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { FinishLine, FlowLane, FlowPosition, FlowPr, FlowRepo, Job } from '../api/types';
import { useKeyScope } from '../app/keyRegistry';
import { jobHref, navigate } from '../app/router';
import { KeyLegend } from '../components/Kbd';
import { useStored } from '../lib/stored';
import { RowCrew } from '../play/RowCrew';
import { jobHueStyle } from '../theme/hue';
import { Icon } from '../components/Icon';
import {
  activePr, countsSuffix, countsWords, filterRepos, finishStop, groupLanes, knownChip, type MapLane, type MapRepo, mapChips,
  newestPr, nextHint, POSITION_LABELS, prPhrase, prText, prTone, releaseLine, trackStops, whereText,
} from './homeModel';

export const MAP_CHIP_KEY = 'fw.home.map.chip';
export const MAP_DONE_KEY = 'fw.home.map.done';
export const MAP_SHOW_KEY = 'fw.home.map.show';

type Layer = 'counts' | 'branches';
const LAYERS: { id: Layer; label: string; hint: string }[] = [
  { id: 'counts', label: 'counts', hint: 'The muted counts after the words: main ↑ ↓, not pushed, uncommitted.' },
  { id: 'branches', label: 'branches', hint: 'Each job’s branch name.' },
];
const DEFAULT_LAYERS = 'counts';

function readLayers(raw: string | null): Set<Layer> {
  return new Set((raw ?? DEFAULT_LAYERS).split(',').filter((x): x is Layer => x === 'counts' || x === 'branches'));
}

// ---------- the ship track ----------

export function ShipTrack({ lane, repo, finishLine }: { lane: FlowLane; repo: FlowRepo; finishLine: FinishLine | null | undefined }) {
  const stops = trackStops(repo);
  const flag = finishStop(finishLine, repo);
  const here = stops.indexOf(lane.position);
  const said = `Ship track: ${whereText(lane, repo).toLowerCase()}, stop ${here + 1} of ${stops.length}.${flag ? ` Finish line: ${POSITION_LABELS[flag].toLowerCase()}.` : ''}`;
  return (
    <span className="ship-track" title={said}>
      <span className="sr-only">{said}</span>
      {stops.map((stop: FlowPosition, i) => {
        const filled = i <= here;
        const state = i === here ? 'is-here' : filled ? 'is-filled' : 'is-empty';
        return (
          <span key={stop} className={`ship-stop ${state}${stop === flag ? ' has-flag' : ''}`} data-stop={stop} aria-hidden="true" title={`${POSITION_LABELS[stop]}${i === here ? ': the work is here.' : filled ? ': passed.' : ': not yet.'}${stop === flag ? ' The finish line.' : ''}`}>
            {i > 0 && <span className={`ship-line${filled ? ' is-filled' : ''}`} />}
            <span className="ship-dot" />
            {stop === flag && <span className="ship-flag">⚑</span>}
          </span>
        );
      })}
    </span>
  );
}

// ---------- a row ----------

function PrLink({ label, pr, repo }: { label: string; pr: FlowPr; repo: FlowRepo }) {
  const text = `${label} (#${pr.number})`;
  const tip = `${label === 'PR #1' ? 'Your fork → the Moxie branch' : label === 'PR #2' ? `The Moxie branch → ${repo.staging?.ref ?? repo.main?.ref ?? 'main'}` : `Into ${repo.main?.ref ?? 'main'}`}: ${pr.title || prText(pr)}.${pr.url ? ' Opens on GitHub.' : ''}`;
  return pr.url
    ? <a className={`map-pr is-${prTone(pr)}`} href={pr.url} target="_blank" rel="noreferrer" title={tip}>{text}</a>
    : <span className={`map-pr is-${prTone(pr)}`} title={tip}>{text}</span>;
}

function MapRow({ lane, job, repo, now, finishLine, layers, highlighted, onHighlight }: {
  lane: FlowLane; job: Job | null; repo: FlowRepo; now: Date; finishLine: FinishLine | null | undefined; layers: Set<Layer>;
  highlighted: boolean; onHighlight(slug: string): void;
}) {
  const title = job?.title || lane.title || lane.slug;
  const pr = activePr(lane, repo);
  const where = whereText(lane, repo);
  const suffix = layers.has('counts') ? countsSuffix(lane) : '';
  const hint = nextHint(lane, job, { repo, release: repo.release, now });
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted]);
  return (
    <li ref={ref} className={`map-row${highlighted ? ' is-highlighted' : ''}`} data-group={job?.group ?? 'done'} data-slug={lane.slug} aria-current={highlighted ? 'true' : undefined}>
      <span className="map-row-crew">{job && <RowCrew job={job} now={now} />}</span>
      <span className="map-row-head">
        <span className="hue-dot" style={jobHueStyle(lane.slug)} aria-hidden="true" />
        <a className="map-row-title" href={jobHref(lane.slug)} title={`Open ${title}.`} onFocus={() => onHighlight(lane.slug)}>{title}</a>
      </span>
      <ShipTrack lane={lane} repo={repo} finishLine={finishLine} />
      <p className="map-row-words">
        <span className="map-row-where">{where}</span>
        {pr && <> · <PrLink label={pr.label} pr={pr.pr} repo={repo} /> {prPhrase(pr.pr)}</>}
        {suffix && <span className="muted map-row-counts" title={lane.vsMain ? countsWords(lane.vsMain, 'main') : undefined}> · {suffix}</span>}
        {layers.has('branches') && lane.branch && <code className="flow-branch map-row-branch" title={lane.worktree ? `Worktree: ${lane.worktree}` : 'No worktree on this machine'}>{lane.branch}</code>}
      </p>
      {hint && <p className="map-row-hint" title="What to do next, from the branch and PR facts.">{hint}</p>}
    </li>
  );
}

// ---------- a repo ----------

function ReleaseTrain({ repo, lanes }: { repo: FlowRepo; lanes: readonly MapLane[] }) {
  const line = releaseLine(repo);
  const aboard = lanes.filter((l) => l.lane.position === 'staging');
  const [open, setOpen] = useState(false);
  const parts: ReactNode[] = [];
  if (line.staging) parts.push(<span key="s" title="Commits in staging that main doesn’t have yet: they go out with the next release.">{line.staging}</span>);
  if (line.release) {
    const { pr, text } = line.release;
    parts.push(pr.url
      ? <a key="r" className={`map-pr is-${prTone(pr)}`} href={pr.url} target="_blank" rel="noreferrer" title={`The release PR, staging → main: ${pr.title || prText(pr)}. Opens on GitHub.`}>{text}</a>
      : <span key="r" title="The release PR, staging → main.">{text}</span>);
  }
  if (line.last) parts.push(<span key="l" title={repo.main?.tip ? `${repo.main.ref}: ${repo.main.tip.subject}` : undefined}>{line.last}</span>);
  if (!parts.length && !aboard.length) return null;
  const listId = `aboard-${repo.name}`;
  return (
    <span className="release-train">
      <span className="muted release-line">
        {parts.map((p, i) => <span key={i}>{i > 0 && <span aria-hidden="true"> · </span>}{p}</span>)}
      </span>
      {aboard.length > 0 && (
        <button type="button" className="btn btn-quiet release-aboard" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)} title="The jobs whose work is in staging, waiting for the release.">
          {aboard.length} aboard <Icon name="chevron-down" size={14} className={`fold-chevron${open ? ' is-up' : ''}`} />
        </button>
      )}
      {open && aboard.length > 0 && (
        <ul id={listId} className="release-aboard-list" aria-label={`Jobs in staging, ${repo.name}`}>
          {aboard.map((l) => <li key={l.lane.slug}><a href={jobHref(l.lane.slug)}>{l.job?.title || l.lane.title || l.lane.slug}</a></li>)}
        </ul>
      )}
    </span>
  );
}

function RepoSection({ repo, lanes, now, finishLine, layers, doneOpen, setDoneOpen, highlighted, onHighlight }: {
  repo: FlowRepo; lanes: MapLane[]; now: Date; finishLine: FinishLine | null | undefined; layers: Set<Layer>;
  doneOpen: boolean; setDoneOpen(on: boolean): void; highlighted: string | null; onHighlight(slug: string): void;
}) {
  const headId = `flow-${repo.name}`;
  const groups = groupLanes(lanes);
  return (
    <section className="flow-repo" aria-labelledby={headId}>
      <header className="flow-repo-head">
        <h3 id={headId}>{repo.name}</h3>
        <ReleaseTrain repo={repo} lanes={lanes} />
        {!repo.prsKnown && <span className="flow-warn" title="The PRs haven’t been read yet (the first refresh may still be running, or the gh command isn’t signed in).">PRs not read yet</span>}
        {repo.errors.length > 0 && <span className="flow-warn" title={repo.errors.join('\n')}>Couldn’t refresh everything</span>}
      </header>
      {groups.map(({ group, label, lanes: rows }) => {
        const folded = group === 'done' && !doneOpen;
        const listId = `${headId}-${group}`;
        return (
          <section key={group} className="map-group" data-group={group} aria-label={`${label}, ${repo.name}`}>
            <h4 className="map-group-title" data-group={group}>
              {group === 'done' ? (
                <button type="button" className="map-group-toggle" aria-expanded={!folded} aria-controls={listId} onClick={() => setDoneOpen(folded)} title={folded ? 'Show the done jobs.' : 'Fold the done jobs away.'}>
                  <Icon name="chevron-right" size={14} className={`fold-chevron${folded ? '' : ' is-down'}`} /> {label} <span className="count">{rows.length}</span>
                </button>
              ) : (
                <><span>{label}</span> <span className="count">{rows.length}</span></>
              )}
            </h4>
            {!folded && (
              <ol id={listId} className="map-rows" aria-label={`${label} jobs in ${repo.name}`}>
                {rows.map(({ lane, job }) => (
                  <MapRow key={lane.slug} lane={lane} job={job} repo={repo} now={now} finishLine={finishLine} layers={layers} highlighted={highlighted === lane.slug} onHighlight={onHighlight} />
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </section>
  );
}

// ---------- the map ----------

export interface FlowMapProps {
  repos: MapRepo[];
  now: Date;
  finishLine: FinishLine | null | undefined;
  /** The "With recently closed" toggle (HomeView keeps it, in fw.home.map.filter). */
  withClosed: boolean;
  setWithClosed(on: boolean): void;
  /** When the branches and PRs were read, and Refresh. */
  read: string;
  refreshing: boolean;
  onRefresh(): void;
}

export function FlowMap({ repos, now, finishLine, withClosed, setWithClosed, read, refreshing, onRefresh }: FlowMapProps) {
  const [chipRaw, setChip] = useStored(MAP_CHIP_KEY);
  const [doneRaw, setDoneRaw] = useStored(MAP_DONE_KEY);
  const [showRaw, setShowRaw] = useStored(MAP_SHOW_KEY);
  const chips = useMemo(() => mapChips(repos), [repos]);
  const chip = knownChip(chipRaw, chips);
  const shown = useMemo(() => filterRepos(repos, chip), [repos, chip]);
  const doneOpen = doneRaw === 'open';
  const layers = useMemo(() => readLayers(showRaw), [showRaw]);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // The rows j and k move through, top to bottom, folded Done rows left out.
  const order = useMemo(
    () => shown.flatMap((r) => groupLanes(r.lanes).filter((g) => g.group !== 'done' || doneOpen).flatMap((g) => g.lanes.map((l) => ({ ...l, repo: r.repo })))),
    [shown, doneOpen],
  );
  useEffect(() => {
    if (highlighted && !order.some((l) => l.lane.slug === highlighted)) setHighlighted(null);
  }, [order, highlighted]);

  const toggleLayer = (id: Layer) => {
    const next = new Set(layers);
    if (next.has(id)) next.delete(id); else next.add(id);
    setShowRaw([...next].join(','));
  };
  // No rows: the key passes on (the Jobs list's j and k step through the jobs instead).
  const step = (by: 1 | -1) => {
    if (!order.length) return false;
    const at = order.findIndex((l) => l.lane.slug === highlighted);
    const next = at < 0 ? (by > 0 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, at + by));
    setHighlighted(order[next].lane.slug);
  };
  const current = () => order.find((l) => l.lane.slug === highlighted) ?? null;
  useKeyScope('map', {
    'map-next': () => step(1),
    'map-prev': () => step(-1),
    'map-open': () => { const c = current(); if (!c) return false; navigate({ name: 'job', slug: c.lane.slug }); },
    'map-pr': () => { const c = current(); const url = c ? newestPr(c.lane, c.repo)?.url : null; if (!url) return false; window.open(url, '_blank', 'noreferrer'); },
    'map-filter': () => { chipsRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); },
    'map-chip': (e) => { const c = chips[Number(e.key) - 1]; if (!c) return false; setChip(c.id); },
  });

  return (
    <div className="flow-map">
      <div className="map-tools">
        <div ref={chipsRef} className="home-seg map-chips" role="group" aria-label="Which jobs">
          {chips.map((c) => (
            <button key={c.id} type="button" className={`home-seg-btn${chip === c.id ? ' is-on' : ''}`} aria-pressed={chip === c.id} onClick={() => setChip(c.id)} title={c.hint}>
              {c.label} <span className="count">{c.count}</span>
            </button>
          ))}
        </div>
        <button type="button" className={`home-seg-btn map-closed${withClosed ? ' is-on' : ''}`} aria-pressed={withClosed} onClick={() => setWithClosed(!withClosed)} title="Also the jobs marked done or dropped in the last 30 days: their work may still be on its way to main.">
          With recently closed
        </button>
        <span className="map-layers" role="group" aria-label="Show">
          <span className="muted">Show:</span>
          {LAYERS.map((l) => (
            <button key={l.id} type="button" className={`home-seg-btn${layers.has(l.id) ? ' is-on' : ''}`} aria-pressed={layers.has(l.id)} onClick={() => toggleLayer(l.id)} title={l.hint}>{l.label}</button>
          ))}
        </span>
        <span className="spacer" />
        <span className="muted home-read" role="status">{refreshing ? 'Reading branches and PRs…' : read}</span>
        <button type="button" className="btn" onClick={onRefresh} disabled={refreshing} title="Fetch the branches and read the PRs now (read-only: git fetch and gh).">Refresh</button>
      </div>
      {repos.length > 0 && shown.length === 0 && <p className="muted home-empty">No job matches this chip.</p>}
      {shown.map(({ repo, lanes }) => (
        <RepoSection key={repo.repo} repo={repo} lanes={lanes} now={now} finishLine={finishLine} layers={layers} doneOpen={doneOpen} setDoneOpen={(on) => setDoneRaw(on ? 'open' : null)} highlighted={highlighted} onHighlight={setHighlighted} />
      ))}
      <KeyLegend ids={['map-next', 'map-prev', 'map-open', 'map-pr', 'map-filter', 'map-chip']} className="map-keys" />
    </div>
  );
}
