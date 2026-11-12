// What to check (design 3.1): the It works when and It must not lists from the job's acceptance.md.
// Shown in the overview card and beside Try it. Missing (an older Starbase, or no list yet) reads as
// not written yet.
import type { JobPageFacts } from '../../api/types';
import { Icon } from '../../components/Icon';
import './page.css';

export const CHECK_NOT_WRITTEN = 'Not written yet. The Foreman writes this list with the plan.';

export function WhatToCheck({ check }: { check: JobPageFacts['check'] }) {
  const worksWhen = check?.worksWhen ?? [];
  const mustNot = check?.mustNot ?? [];
  if (!worksWhen.length && !mustNot.length) return <p className="sb-ov-empty">{CHECK_NOT_WRITTEN}</p>;
  return (
    <div className="sb-check">
      {worksWhen.length > 0 && (
        <>
          <b className="sb-ov-label">It works when</b>
          <ul className="sb-ov-list">
            {worksWhen.map((line, i) => (
              <li key={i}><Icon name="circle-check" size={14} className="sb-ov-mark is-ok" /><span>{line}</span></li>
            ))}
          </ul>
        </>
      )}
      {mustNot.length > 0 && (
        <>
          <b className="sb-ov-label">It must not</b>
          <ul className="sb-ov-list">
            {mustNot.map((line, i) => (
              <li key={i}><Icon name="x" size={14} className="sb-ov-mark is-err" /><span>{line}</span></li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
