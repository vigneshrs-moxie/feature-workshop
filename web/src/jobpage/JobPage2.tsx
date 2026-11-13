// The new job page's frame (plan Task 7): the store, the layout by width, the address and the keys.
// App.tsx and the website's HostedWorkshop.tsx mount it instead of the old page while the switch is
// on (switch.ts), with the job's slug as the key, so a pick never mounts it again.
//
// Layout by width (plan "Decisions already made" 1):
//   - 1100 px and wider ('wide'): the header row, then two panes: the left pane 440 px (Your move,
//     the steps, the job's rows, the message box docked at its foot) and the reader beside it.
//   - Over 760 and under 1100 px ('mid'): the left pane takes the width; opening something puts the
//     reader over it with a back row, and the focus moves into the reader.
//   - 760 px and under ('phone'): the same parts, at phone sizes (Task 15 gives the phone its own
//     screens by address).
// It is one tree in every layout: a width change only changes classes, so the draft, the picks, the
// reader's target, the focus and every scroll stay where they were.
//
// The address (app/router.ts): #/job/<slug> opens the job; /stage/<stop> opens that step;
// /conversation and /overview open the conversation and the ticket and goal in the reader;
// /read/<kind>/<id> opens that thing in the reader. A pick rewrites the address in place
// (replaceHash: no history entry), so Back leaves the page and a reload comes back to it.
//
// First paint: from the Jobs snapshot's row for the job (the `job` prop: title, state, steps), so the
// header, Your move and the steps paint before the page's own payload lands; the payload then fills
// them in place. The reader is reader/Reader.tsx.
//
// Keys (app/keyRegistry.ts, scope 'jobpage', which wins over the others while the page is mounted):
// [ ] the step before and after; j k the next and previous line on the left; Enter opens that line;
// / searches the conversation; g c the conversation; g t the ticket and goal; c i the message box;
// n is kept for notes (Task 17). Their other meanings come back when the page goes.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Job } from '../api/types';
import { useKeyScope } from '../app/keyRegistry';
import { readHref, replaceHash, stageHref, type JobView } from '../app/router';
import { Button } from '../components/Button';
import { useMinWidth, useNarrow } from '../components/page/Page';
import { useWorkshop } from '../state/store';
import { browserDrafts, createJobStore, type JobPageState, type JobStore } from './jobStore';
import { recentPage, rememberPage } from './recent';
import { CONVERSATION, DECISIONS, DETAILS, TICKET } from './targets';
import type { JobPagePayload, ReaderTarget, StopId } from './types';
import { Header } from './left/Header';
import { JobRows } from './left/JobRows';
import { MessageBox } from './left/MessageBox';
import { Steps, stepsFromRow } from './left/Steps';
import { YourMove } from './left/YourMove';
import { Reader } from './reader/Reader';
import { JobStoreContext, useJob, useJobStore } from './useJob';
import './jobpage.css';

/** Two panes from this width; the reader covers the left pane under it. */
export const TWO_PANES_PX = 1100;

export type Layout = 'wide' | 'mid' | 'phone';

/** The page's layout for the window's width, live as it changes. */
export function useLayout(): Layout {
  const wide = useMinWidth(TWO_PANES_PX);
  const phone = useNarrow();
  return phone ? 'phone' : wide ? 'wide' : 'mid';
}

export interface JobPage2Props {
  slug: string;
  /** The Jobs snapshot's row for this job (the first paint); null when the snapshot has none. */
  job: Job | null;
  /** The step the address names (#/job/<slug>/stage/<stop>). */
  step?: StopId;
  /** /conversation or /overview. */
  view?: JobView;
  /** /read/<kind>/<id>. */
  read?: ReaderTarget;
  /** A store made elsewhere (tests); otherwise the page makes one for the job and ends it when it goes. */
  store?: JobStore;
}

/** What the address asks the reader to show, or null. */
function addressTarget(view: JobView | undefined, read: ReaderTarget | undefined): ReaderTarget | null {
  if (read) return read;
  if (view === 'conversation') return CONVERSATION;
  if (view === 'overview') return TICKET;
  return null;
}

/** The page's store for the job: made once, ended when the page goes (made again after StrictMode's test unmount). */
function usePageStore(slug: string, given: JobStore | undefined, first: (s: JobStore) => void): JobStore {
  const { api } = useWorkshop();
  const made = useRef<{ store: JobStore; ended: boolean } | null>(null);
  // A job opened lately (or fetched ahead from Jobs) paints complete at once; the first load checks it.
  const make = () => { const store = createJobStore(slug, { api, initial: recentPage(slug), drafts: browserDrafts }); first(store); return { store, ended: false }; };
  if (!given && !made.current) made.current = make();
  const [store, setStore] = useState<JobStore>(() => given ?? made.current!.store);
  useEffect(() => {
    if (given) { void given.loadPage(); return undefined; }
    if (made.current!.ended) { made.current = make(); setStore(made.current.store); }
    const mine = made.current!;
    const keep = () => { const p = mine.store.getState().payload; if (p) rememberPage(p); };
    const unkeep = mine.store.subscribe(keep);
    void mine.store.loadPage().then(() => { if (!mine.ended) idle(() => { if (!mine.ended) void mine.store.prefetch(); }); });
    return () => { mine.ended = true; unkeep(); mine.store.destroy(); };
    // The page is keyed by the slug: the store lives as long as the page does.
  }, []);
  return store;
}

/** Runs `fn` once the browser is idle (fetching ahead never competes with the first paint). */
function idle(fn: () => void) {
  const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn);
  else fn();
}

export const JobPage2 = memo(function JobPage2({ slug, job, step, view, read, store: given }: JobPage2Props) {
  const store = usePageStore(slug, given, (s) => {
    // What the address names, before the first paint.
    if (step) s.setStep(step);
    const target = addressTarget(view, read);
    if (target) s.setReader(target);
  });
  return (
    <JobStoreContext.Provider value={store}>
      <Frame slug={slug} job={job} step={step} view={view} read={read} />
    </JobStoreContext.Provider>
  );
});

function Frame({ slug, job: row, step, view, read }: Omit<JobPage2Props, 'store'>) {
  const store = useJobStore();
  const layout = useLayout();
  const hasPayload = useJob((s) => s.payload !== null);
  // The snapshot row is for the first paint only: once the payload is in, a newer row redraws nothing.
  const firstRow = useRef(row);
  if (!hasPayload) firstRow.current = row;
  const job = firstRow.current;
  // Over the left pane under 1100 px: open from a pick (or an address that names a reader target).
  const [covered, setCovered] = useState(() => addressTarget(view, read) !== null);
  const [cursor, setCursor] = useState<number | null>(null);
  const reader = useRef<HTMLElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const search = useRef<HTMLInputElement>(null);
  /** The control that opened the reader, for the back row to give the focus back to. */
  const opener = useRef<HTMLElement | null>(null);
  const single = layout !== 'wide';

  // A later change of the address (a link, Back) is a pick of what it names; the page's own picks
  // write the address first, so this finds them already done.
  useEffect(() => { if (step) { store.setStep(step); store.setReader(null); } }, [store, step]);
  const named = addressTarget(view, read);
  useEffect(() => { if (named) store.setReader(named); }, [store, named?.kind, named?.id]);

  // A step pick opens the step and shows its main output (targets.ts readerOf): his own reader pick
  // goes, so the address /stage/<stop> brings the same view back on a reload.
  const pickStep = useCallback((id: StopId) => {
    store.setStep(id);
    store.setReader(null);
    replaceHash(stageHref(slug, id));
  }, [store, slug]);

  /** The reader takes what was picked: under 1100 px it comes over the left pane with the focus. */
  const showReader = useCallback((from?: HTMLElement | null) => {
    const was = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    // The reader itself (g c, g t or / pressed inside it) is never where Back returns to.
    if (!was || !reader.current?.contains(was)) opener.current = was;
    // Under 1100 px the reader comes over the left pane and takes the focus (a pick made inside the
    // reader, its previous and next, keeps the focus where it is).
    flushSync(() => setCovered(true));
    if (layout !== 'wide' && !reader.current?.contains(document.activeElement)) reader.current?.focus();
  }, [layout]);

  const pickReader = useCallback((t: ReaderTarget, from?: HTMLElement | null) => {
    store.setReader(t);
    replaceHash(readHref(slug, t));
    showReader(from);
  }, [store, slug, showReader]);

  /** A click (or Enter) on a step: it opens, and its main output shows in the reader. */
  const openStep = useCallback((id: StopId, from?: HTMLElement | null) => {
    pickStep(id);
    showReader(from);
  }, [pickStep, showReader]);

  const back = useCallback(() => {
    flushSync(() => setCovered(false));
    const to = opener.current;
    if (to && to.isConnected) to.focus();
  }, []);

  const lines = useMemo(() => leftLines(store.getState().payload, job), [store, job, hasPayload]);
  const openLine = useCallback((i: number) => {
    const line = lines[i];
    if (!line) return;
    if (line.step) openStep(line.step, null);
    else if (line.target) pickReader(line.target, null);
  }, [lines, openStep, pickReader]);

  const leftHidden = single && covered;
  // Crossing from two panes to one while the reader is open: the focus goes into it, not to the page.
  useEffect(() => {
    if (!leftHidden) return;
    const at = document.activeElement;
    if (!at || at === document.body || !reader.current?.contains(at)) reader.current?.focus();
  }, [leftHidden]);
  useKeyScope('jobpage', {
    'jp-step-prev': () => { uncover(); stepBy(-1); },
    'jp-step-next': () => { uncover(); stepBy(1); },
    'jp-line-next': () => { if (!leftHidden) moveCursor(1); },
    'jp-line-prev': () => { if (!leftHidden) moveCursor(-1); },
    // Enter on a line opens that line (j and k move the focus to it); elsewhere it belongs to the control.
    'jp-open': (e) => {
      if (leftHidden) return false;
      const on = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-jp-line]') : null;
      if (on) { openLine(Number(on.dataset.jpLine)); return; }
      if (e.target instanceof Element && e.target.closest('button, a, summary, [role="button"], [role="option"], [role="tab"], input, textarea, select')) return false;
      if (cursor === null) return false;
      openLine(cursor);
    },
    'jp-search': () => {
      pickReader(CONVERSATION);
      search.current?.focus();
    },
    'jp-convo': () => { pickReader(CONVERSATION); },
    'jp-ticket': () => { pickReader(TICKET); },
    'jp-write': () => {
      uncover();
      box.current?.focus();
    },
    // Kept for a note on the part under the pointer (Task 17): it does nothing yet, and no longer
    // opens Notes and options.
    'jp-note': () => {},
  });

  /** Under 1100 px: take the reader off the left pane, so a key that acts there is seen. */
  function uncover() {
    if (leftHidden) flushSync(() => setCovered(false));
  }

  function stepBy(by: 1 | -1) {
    const s = store.getState();
    const ids = stepIds(s.payload, job);
    const at = ids.indexOf(openStepOf(s, job) ?? ids[0]);
    const next = ids[Math.max(0, Math.min(ids.length - 1, at + by))];
    if (next) pickStep(next);
  }

  function moveCursor(by: 1 | -1) {
    if (!lines.length) return;
    // From the line with the focus (a click leaves it there), else from the last cursor line.
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-jp-line]') : null;
    const now = focused ? Number(focused.dataset.jpLine) : cursor ?? (by > 0 ? -1 : lines.length);
    const next = Math.max(0, Math.min(lines.length - 1, now + by));
    flushSync(() => setCursor(next));
    // Roving focus: the line takes the focus, so Enter and a screen reader are on the same line.
    const el = document.querySelector<HTMLElement>(`.jp2 [data-jp-line="${next}"]`);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
  }

  return (
    <main className="jp2" aria-label="Job" data-layout={layout} data-covered={covered ? '' : undefined}>
      <Header job={job} />
      <div className="jp2-panes">
        <div className="jp2-left" aria-hidden={leftHidden || undefined} inert={leftHidden || undefined}>
          <div className="jp2-lscroll">
            <YourMove job={job} onOpen={pickReader} />
            <Steps job={job} cursor={cursor} onStep={openStep} onOpen={pickReader} />
            <JobRows cursor={cursor} first={lines.findIndex((l) => l.target)} onOpen={pickReader} />
          </div>
          <MessageBox boxRef={box} />
        </div>
        <section
          ref={reader}
          className="jp2-reader"
          aria-label="Reader"
          tabIndex={-1}
          onKeyDown={single ? (e) => { if (e.key === 'Escape' && covered && !e.defaultPrevented) { e.preventDefault(); back(); } } : undefined}
          aria-hidden={single && !covered ? true : undefined}
          inert={single && !covered ? true : undefined}
        >
          {single && (
            <div className="jp2-back">
              <Button kind="quiet" size="sm" icon="chevron-left" onClick={back} title="Close the reader and go back to the job.">Back to the job</Button>
            </div>
          )}
          <Reader fallback={job?.title ?? ''} searchRef={search} onOpen={pickReader} />
        </section>
      </div>
    </main>
  );
}

// ---------- What the parts read ----------

const stepIds = (payload: JobPagePayload | null, job: Job | null): StopId[] => (payload ? payload.steps.map((s) => s.id) : stepsFromRow(job).map((s) => s.id));

/** The step shown open: his pick, else the job's current step. */
function openStepOf(s: JobPageState, job: Job | null): StopId | null {
  if (s.ui.step) return s.ui.step;
  const steps = s.payload ? s.payload.steps : stepsFromRow(job);
  return steps.find((x) => x.state === 'current')?.id ?? null;
}

interface Line { step?: StopId; target?: ReaderTarget }
/** The lines j and k move over: the steps, then the job's four rows. */
function leftLines(payload: JobPagePayload | null, job: Job | null): Line[] {
  return [...stepIds(payload, job).map((step) => ({ step })), ...[TICKET, CONVERSATION, DECISIONS, DETAILS].map((target) => ({ target }))];
}
