// What you asked (Task 18; design brief R5 "See the answer to each request"): when the Foreman comes
// back from his notes, Your move shows `What you asked · 3 of 3 done` and one line per note, read from
// the `--- Notes answered ---` block at the end of its reply (the payload's `asked`,
// dashboard/lib/job-payload.js askedOf). In Your move's slot when nothing else waits; under the card
// when a gate (or a question, a permission) waits too.
//
// - A line: his note, then what changed (`Plan v3 · step 4 removed`, `commit abc1234 ·
//   EmployeesTable.tsx`), the answer to an Explain, or why it was not done. A click opens that exact
//   change in the reader: the document's version, or the commit and its file in Changes; an answer
//   in words, or a note not done, opens the place he pointed at. The words are the Foreman's (the
//   heading says so); a commit it names that is not on the branch says so and opens nothing.
// - A note not done has `Ask again`: the note goes back into the message box as a chip, as he sent
//   it, once.

import { memo, useEffect, useState } from 'react';
import { BRAND } from '../../app/brand';
import { Button } from '../../components/Button';
import '../answers.css';
import { addNote, oneLine } from '../notes/chips';
import { useWorkshop } from '../../state/store';
import { findCommit, loadCommits, setPick, useBranch } from '../reader/branch';
import type { JobPagePayload, NoteAnswer, ReaderTarget } from '../types';
import { useJob, useJobStore } from '../useJob';

type Asked = NonNullable<JobPagePayload['asked']>;

const CHIP_MOST = 48;
/** A chip's words for a place as sent (`Product spec v0.5 · acceptance line 6` → `Product spec v0.5 acceptance line 6`). */
export function chipOfPlace(place: string): string {
  const s = place.split(' · ').slice(0, 2).join(' ').trim();
  return s.length > CHIP_MOST ? `${s.slice(0, CHIP_MOST - 1).trimEnd()}…` : s;
}

const tagOf = (a: NoteAnswer) => (!a.done ? 'Not done' : a.explained ? 'Answered' : 'Done');
const titleOf = (a: NoteAnswer) => (!a.target ? undefined
  : a.done && !a.explained ? (a.commit ? `Open commit ${a.commit.sha}${a.commit.file ? ` at ${a.commit.file}` : ''} in Changes.` : `Open ${a.what.split(' · ')[0]}.`)
    : 'Open the place this note is on.');

export interface AskedProps {
  asked: Asked;
  onOpen?(t: ReaderTarget, from?: HTMLElement | null): void;
}

export const AskedList = memo(function AskedList({ asked, onOpen }: AskedProps) {
  const key = asked.notes.map((a) => `${a.n}:${a.done ? 1 : 0}:${a.what}`).join('|');
  return <AskedLines key={key} asked={asked} onOpen={onOpen} />;
});

function AskedLines({ asked, onOpen }: AskedProps) {
  const store = useJobStore();
  const { api } = useWorkshop();
  const slug = useJob((s) => s.slug);
  const hosted = useJob((s) => Boolean(s.payload?.hosted)) || Boolean(api.hosted?.());
  const named = asked.notes.some((a) => a.commit);
  // A commit the Foreman names is looked for on the branch (the list Changes reads), so a line never
  // links to a commit that is not there as if it proved the change.
  useEffect(() => { if (named && !hosted) void loadCommits(store, api, slug); }, [store, api, slug, hosted, named]);
  const commits = useBranch(store).commits;
  const gone = (a: NoteAnswer) => Boolean(a.commit && commits && !findCommit(commits, a.commit.sha));
  // The notes put back with Ask again (by number), for this answer only.
  const [again, setAgain] = useState<ReadonlySet<number>>(() => new Set());

  function open(a: NoteAnswer, from: HTMLElement) {
    if (!a.target) return;
    if (a.commit) setPick(store, { sha: a.commit.sha, path: a.commit.file });
    if (onOpen) onOpen(a.target, from);
    else store.setReader(a.target);
  }

  function askAgain(a: NoteAnswer) {
    const ask = a.ask;
    if (!ask) return;
    const s = store.getState();
    const there = s.ui.notes.some((x) => x.kind === ask.kind && x.place === ask.place && oneLine(x.note) === oneLine(ask.note));
    if (!there) store.setNotes(addNote(s.ui.notes, { kind: ask.kind, target: a.target, place: ask.place, chip: chipOfPlace(ask.place), quote: ask.quote, note: ask.note ?? '', block: null }, s.explains));
    setAgain((prev) => new Set(prev).add(a.n));
  }

  return (
    <section className="jp2-asked" aria-label="What you asked">
      <p className="jp2-asked-h" title={`As the Foreman reports it: ${BRAND.name} doesn’t check each answer.`}>What you asked · the Foreman says {asked.done} of {asked.total} done</p>
      <ul className="jp2-asked-l">
        {asked.notes.map((a) => {
          const missing = gone(a);
          const words = (
            <>
              <span className={`jp2-asked-tag${a.done ? '' : ' is-not'}`}>{tagOf(a)}</span>
              <span className="jp2-asked-note">{a.note}</span>
              <span className="jp2-asked-what">{a.what}</span>
              {missing && <span className="jp2-asked-warn">Commit {a.commit!.sha} is not on this branch</span>}
            </>
          );
          return (
            <li key={a.n} className={`jp2-asked-i ${a.done ? 'is-done' : 'is-not'}`}>
              {a.target && !missing
                ? <button type="button" className="jp2-asked-open" title={titleOf(a)} onClick={(e) => open(a, e.currentTarget)}>{words}</button>
                : <div className="jp2-asked-open is-static">{words}</div>}
              {!a.done && a.ask && (again.has(a.n)
                ? <p className="jp2-asked-back" role="status">Back in your notes. Send it when you’re ready.</p>
                : <Button size="sm" className="jp2-asked-again" title="Put this note back in the message box as it was sent." onClick={() => askAgain(a)}>Ask again</Button>)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** What you asked, when the payload has it (null otherwise). */
export function useAsked(): Asked | null {
  return useJob((s) => s.payload?.asked ?? null);
}
