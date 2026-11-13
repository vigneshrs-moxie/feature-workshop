// Findings in the reader (job page rebuild, Task 14; design brief "Findings"):
//   - the open ones first, one line each: its severity, its file, its words cut to the line; a click
//     opens its detail in place, a second folds it;
//   - then `Fixed · n` and `Not doing · n`, folded;
//   - then one line for the reviewers who found nothing else (`6 reviewers found nothing else`), which
//     opens the review step's reader-only documents (its `more`: each lens's rounds, the review facts,
//     the second looks; the Task 10 ruling). No card per reviewer.
// The rows and each one's status come from the findings body (the server's lib/play.js reviewRows and
// its findingStatus): nothing here decides a status again.

import { memo, useState } from 'react';
import { Icon } from '../../components/Icon';
import type { Output, ReaderTarget } from '../types';
import { useJob } from '../useJob';
import { NotLoaded, ReaderBody, useBody } from './ReaderBody';

interface Finding { lens: string | null; severity: 'blocker' | 'major' | 'minor'; text: string; status: 'open' | 'fixed' | 'not-doing' }

const SEVERITY: Record<Finding['severity'], string> = { blocker: 'Blocker', major: 'Major', minor: 'Minor' };
const STATUS: Record<Finding['status'], string> = { open: 'open', fixed: 'Fixed', 'not-doing': 'Not doing' };
const LENS_WORDS: Record<string, string> = { db: 'database', ui: 'screens and wording' };
const ROUND = /^review\/(.+?)(?:-r\d+)?\.md$/;

/** A lens id as the rows carry it (lib/play.js lensType): 'feature-reviewer', 'feature-review-db'. */
const lensIdOf = (fileLens: string) => (fileLens === 'spec' ? 'feature-reviewer' : `feature-review-${fileLens}`);
/** The lens in a word: 'feature-review-db' → 'database', 'feature-reviewer' → 'spec'. */
export function lensWord(lens: string | null): string {
  if (!lens) return '';
  if (lens === 'feature-reviewer') return 'spec';
  const w = lens.replace(/^(feature|bug)-review-?/, '');
  return LENS_WORDS[w] ?? w;
}

const PATH_IN_TICKS = /`([^`\s]*[\w-]\.[a-z]{1,5}(?::\d+)?)`/i;
const BARE_FILE = /(?:^|[\s(])((?:[\w.-]+\/)*[\w-]+\.(?:tsx?|jsx?|mjs|cjs|css|scss|sql|md|json|ya?ml|py|go|rb|rs|java|kt|swift|sh|html)(?::\d+)?)\b/i;

/** Where a finding is: the file a path in backticks names (its last part, with a line), else a bare file name, else its lens. */
export function fileOf(text: string, lens: string | null): string {
  const m = PATH_IN_TICKS.exec(text) ?? BARE_FILE.exec(text);
  if (m) return m[1].split('/').pop() ?? m[1];
  return lensWord(lens);
}

const plain = (text: string) => text.replace(/`/g, '');

function rowsOf(meta: Record<string, unknown> | undefined): Finding[] {
  const rows = Array.isArray(meta?.rows) ? meta.rows : [];
  return rows.filter((r): r is Finding => Boolean(r) && typeof r.text === 'string')
    .map((r) => ({ lens: typeof r.lens === 'string' ? r.lens : null, severity: r.severity in SEVERITY ? r.severity : 'minor', text: r.text, status: r.status in STATUS ? r.status : 'open' }));
}

const reviewMore = (s: { payload: { steps: { id: string; more?: Output[] }[] } | null }) => s.payload?.steps.find((x) => x.id === 'review')?.more ?? EMPTY;
const EMPTY: Output[] = [];

export interface FindingsViewProps {
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

export function FindingsView({ onOpen }: FindingsViewProps) {
  const { body, error } = useBody('findings');
  const more = useJob(reviewMore);
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (k: string) => setFolds((f) => ({ ...f, [k]: !f[k] }));
  if (!body) return <ReaderBody view="findings" place="findings:findings" ready={false}><NotLoaded error={error} /></ReaderBody>;
  const rows = rowsOf(body.meta);
  if (body.meta?.known === false) return <ReaderBody view="findings" place="findings:findings"><p className="jp2-notyet">No review yet. The findings show once the review is written.</p></ReaderBody>;
  const indexed = rows.map((r, i) => ({ r, i }));
  const opened = indexed.filter((x) => x.r.status === 'open');
  const fixed = indexed.filter((x) => x.r.status === 'fixed');
  const notDoing = indexed.filter((x) => x.r.status === 'not-doing');
  // The reviewers: one per lens with a report among the review step's documents (not the facts).
  const lenses = [...new Set(more.map((o) => ROUND.exec(o.id)?.[1]).filter((l): l is string => Boolean(l) && l !== 'facts'))];
  const found = new Set(rows.map((r) => r.lens).filter(Boolean));
  const allNamed = rows.every((r) => r.lens);
  const quiet = lenses.filter((l) => !found.has(lensIdOf(l))).length;
  const restWords = allNamed && quiet > 0 ? `${quiet} ${quiet === 1 ? 'reviewer' : 'reviewers'} found nothing else` : `Each reviewer’s report · ${lenses.length}`;
  return (
    <ReaderBody view="findings" place="findings:findings">
      <div className="jp2-fds">
        <h3 className="jp2-fd-g">{`Open · ${opened.length}`}</h3>
        {opened.length === 0 && <p className="jp2-fd-none">Nothing open.</p>}
        {opened.map(({ r, i }) => (
          <OpenRow key={i} r={r} open={open.has(i)} onToggle={() => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
        ))}
        {fixed.length > 0 && <Fold label={`Fixed · ${fixed.length}`} open={!!folds.fixed} onToggle={() => toggle('fixed')} rows={fixed.map((x) => x.r)} />}
        {notDoing.length > 0 && <Fold label={`Not doing · ${notDoing.length}`} open={!!folds.notDoing} onToggle={() => toggle('notDoing')} rows={notDoing.map((x) => x.r)} />}
        {more.length > 0 && (
          <>
            <button type="button" className="link-button jp2-fd-rest" aria-expanded={!!folds.rest} onClick={() => toggle('rest')}>{restWords}</button>
            {folds.rest && (
              <ul className="jp2-fd-lenses" aria-label="Rounds and lenses">
                {more.map((o) => (
                  <li key={o.id}>
                    <button type="button" className="link-button jp2-fd-lens" onClick={(e) => onOpen({ kind: 'doc', id: o.id }, e.currentTarget)}>{o.label}</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </ReaderBody>
  );
}

const OpenRow = memo(function OpenRow({ r, open, onToggle }: { r: Finding; open: boolean; onToggle(): void }) {
  return (
    <div className="jp2-fd">
      <button type="button" className="jp2-fd-line" aria-expanded={open} onClick={onToggle}>
        <span className="jp2-fd-sev">{SEVERITY[r.severity]}</span>
        <span className="jp2-fd-w">{fileOf(r.text, r.lens)}</span>
        <span className="jp2-fd-t">{plain(r.text)}</span>
      </button>
      {open && (
        <div className="jp2-fd-more jp2-prose">
          <p>{plain(r.text)}</p>
          <p className="jp2-dim">{[SEVERITY[r.severity], lensWord(r.lens), STATUS[r.status]].filter(Boolean).join(' · ')}</p>
        </div>
      )}
    </div>
  );
});

function Fold({ label, open, onToggle, rows }: { label: string; open: boolean; onToggle(): void; rows: Finding[] }) {
  return (
    <>
      <h3 className="jp2-fd-g">
        <button type="button" className="jp2-fd-fold" aria-expanded={open} onClick={onToggle}>{label}<Icon name="chevron-down" size={14} className={open ? 'jp2-fd-turn' : undefined} /></button>
      </h3>
      {open && rows.map((r, i) => (
        <div key={i} className="jp2-fd-flat">
          <span className="jp2-fd-sev">{SEVERITY[r.severity]}</span>
          <span className="jp2-fd-w">{fileOf(r.text, r.lens)}</span>
          <span className="jp2-fd-t">{plain(r.text)}</span>
          <span className="jp2-fd-x">{STATUS[r.status]}</span>
        </div>
      ))}
    </>
  );
}
