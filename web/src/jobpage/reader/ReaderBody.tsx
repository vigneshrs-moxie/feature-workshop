// The reader's body (job page rebuild, Task 12): the one scroll area under the title row, shared by
// every view, and the hook that reads a body from the page's store.
//
// - Each thing read keeps its own scroll place: leaving it remembers where it was, coming back puts it
//   there again (kept per job page, so a width change or a reader that draws again keeps them too).
//   A body that lands later is put at its place when it lands.
// - A body not held yet shows nothing under the title row, and reserves no height: the title row is
//   there at once, and the words land in place (speed rules 2 and 3).
// - A body already held paints in the same frame as the pick: useBody reads the store's body cache
//   synchronously, and asks the server only for one it does not hold.

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { JobStore } from '../jobStore';
import { Pointable } from '../notes/Pointable';
import type { JobBody } from '../types';
import { useJob, useJobStore } from '../useJob';

const places = new WeakMap<JobStore, Map<string, number>>();
function placesOf(store: JobStore): Map<string, number> {
  let m = places.get(store);
  if (!m) { m = new Map(); places.set(store, m); }
  return m;
}

/** Whether this thing read has a scroll place kept from an earlier visit (the conversation's arrival scroll waits for none). */
export function hasPlace(store: JobStore, place: string): boolean {
  return placesOf(store).has(place);
}

export interface ReaderBodyProps {
  /** The view's kind (data-view): one view shows at a time. */
  view: string;
  /** What is read (`<kind>:<id>`), so its scroll place is its own. */
  place: string;
  /** False while the body is not held: its place is put back once it lands. */
  ready?: boolean;
  className?: string;
  children?: ReactNode;
}

export function ReaderBody({ view, place, ready = true, className = '', children }: ReaderBodyProps) {
  const store = useJobStore();
  const ref = useRef<HTMLDivElement>(null);
  const kept = placesOf(store);
  // Before the paint, so a view comes back where he left it without a jump.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && ready) el.scrollTop = kept.get(place) ?? 0;
  }, [place, ready]);
  return (
    <div
      ref={ref}
      className={`jp2-rv-body${className ? ` ${className}` : ''}`}
      data-view={view}
      onScroll={ready ? (e) => { kept.set(place, e.currentTarget.scrollTop); } : undefined}
    >
      {/* Every block in it can be pointed at (R4): the `+`, the note box and the margin notes. */}
      <Pointable hostRef={ref} place={place} ready={ready}>{children}</Pointable>
    </div>
  );
}

/** One body from the store: held → at once; not held → asked for once, and null until it lands. */
export function useBody(id: string): { body: JobBody | null; error: string | null } {
  const store = useJobStore();
  const body = useJob((s) => s.bodies[id] ?? null);
  const error = useJob((s) => (s.bodies[id] ? null : s.error));
  useEffect(() => { if (!body) void store.loadBody(id); }, [store, id, body]);
  return { body, error };
}

/** What shows in place of a body that could not be loaded: the store's one error line. */
export function NotLoaded({ error }: { error: string | null }) {
  return error ? <p className="jp2-dim" role="alert">{error}</p> : null;
}
