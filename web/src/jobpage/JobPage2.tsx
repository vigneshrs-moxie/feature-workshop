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
// them in place. The left pane and the reader here are the frame: Tasks 8 to 14 fill each part.
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
import { Icon } from '../components/Icon';
import { useMinWidth, useNarrow } from '../components/page/Page';
import { STOPS } from '../components/stops/stops';
import { statesOf } from '../job/page/stepWords';
import { useWorkshop } from '../state/store';
import { createJobStore, type JobPageState, type JobStore } from './jobStore';
import { recentPage, rememberPage } from './recent';
import type { JobPagePayload, Output, ReaderKind, ReaderTarget, StepRow, StopId } from './types';
import { Header } from './left/Header';
import { sinceWords, YourMove } from './left/YourMove';
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

const CONVERSATION: ReaderTarget = { kind: 'conversation', id: 'conversation' };
const TICKET: ReaderTarget = { kind: 'ticket', id: 'ticket' };
const DECISIONS: ReaderTarget = { kind: 'decisions', id: 'decisions' };
const DETAILS: ReaderTarget = { kind: 'details', id: 'details' };

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
  const make = () => { const store = createJobStore(slug, { api, initial: recentPage(slug) }); first(store); return { store, ended: false }; };
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
  useEffect(() => { if (step) store.setStep(step); }, [store, step]);
  const named = addressTarget(view, read);
  useEffect(() => { if (named) store.setReader(named); }, [store, named?.kind, named?.id]);

  const pickStep = useCallback((id: StopId) => {
    store.setStep(id);
    replaceHash(stageHref(slug, id));
  }, [store, slug]);

  const pickReader = useCallback((t: ReaderTarget, from?: HTMLElement | null) => {
    store.setReader(t);
    replaceHash(readHref(slug, t));
    const was = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    // The reader itself (g c, g t or / pressed inside it) is never where Back returns to.
    if (!was || !reader.current?.contains(was)) opener.current = was;
    // Under 1100 px the reader comes over the left pane and takes the focus.
    flushSync(() => setCovered(true));
    if (layout !== 'wide') reader.current?.focus();
  }, [store, slug, layout]);

  const back = useCallback(() => {
    flushSync(() => setCovered(false));
    const to = opener.current;
    if (to && to.isConnected) to.focus();
  }, []);

  const lines = useMemo(() => leftLines(store.getState().payload, job), [store, job, hasPayload]);
  const openLine = useCallback((i: number) => {
    const line = lines[i];
    if (!line) return;
    if (line.step) pickStep(line.step);
    else if (line.target) pickReader(line.target, null);
  }, [lines, pickStep, pickReader]);

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
            <Steps job={job} cursor={cursor} onStep={pickStep} onOpen={pickReader} />
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
          <Reader job={job} searchRef={search} />
        </section>
      </div>
    </main>
  );
}

// ---------- What the parts read ----------

const readerOf = (s: JobPageState): ReaderTarget | null => s.ui.reader ?? s.payload?.open ?? null;

type StepMark = StepRow['state'];
/** The seven steps before the payload, from the snapshot row. */
function stepsFromRow(job: Job | null): { id: StopId; label: string; state: StepMark }[] {
  const states = job ? statesOf(job) : null;
  return STOPS.map((s) => {
    const st = states?.[s.id];
    const state: StepMark = st === 'done' ? 'done' : st === 'now' || st === 'waiting' ? 'current' : st === 'skipped' ? 'skipped' : 'todo';
    return { id: s.id, label: s.label, state };
  });
}

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

const OUTPUT_READER: Record<Output['kind'], ReaderKind> = {
  doc: 'doc', screens: 'doc', changes: 'changes', checks: 'checks', recording: 'checks', 'hand-test': 'checks', findings: 'findings', walkthrough: 'walkthrough', pr: 'pr',
};

// ---------- The left pane (Tasks 9, 10, 11 fill it) ----------

const Steps = memo(function Steps({ job, cursor, onStep, onOpen }: { job: Job | null; cursor: number | null; onStep(id: StopId): void; onOpen(t: ReaderTarget, el: HTMLElement): void }) {
  const steps = useJob((s) => s.payload?.steps ?? null);
  const open = useJob((s) => openStepOf(s, job));
  const rows = steps ?? stepsFromRow(job).map((s) => ({ ...s, word: null, durationMs: null, startedAt: null, outputs: [] as Output[] }));
  return (
    <nav className="jp2-st" aria-label="Steps">
      {rows.map((s, i) => {
        const isOpen = s.id === open;
        return (
          <div key={s.id} className="jp2-step">
            <button
              type="button"
              className={`jp2-row jp2-st-row is-${s.state}${isOpen ? ' is-open' : ''}${cursor === i ? ' is-cursor' : ''}`}
              data-jp-line={i}
              aria-expanded={isOpen}
              onClick={() => onStep(s.id)}
            >
              <span className="jp2-st-mark" aria-hidden="true">{s.state === 'done' ? <Icon name="check" size={14} /> : s.state === 'current' ? <i className="jp2-dot" /> : s.state === 'skipped' ? <Icon name="minus" size={14} /> : <i className="jp2-ring" />}</span>
              <span className="jp2-st-name">{s.label}</span>
              {s.word && <span className="jp2-st-word">{s.word}</span>}
            </button>
            {isOpen && s.outputs.length > 0 && (
              <ul className="jp2-st-outs">
                {s.outputs.map((o) => (
                  <li key={`${o.kind}:${o.id}`}>
                    <button type="button" className="jp2-row jp2-st-out" onClick={(e) => onOpen({ kind: OUTPUT_READER[o.kind], id: o.id }, e.currentTarget)}>
                      <span className="jp2-out-label">{o.label}</span>
                      {(o.meta || o.version) && <span className="jp2-out-meta">{o.meta ?? `v${o.version}`}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
});

const JobRows = memo(function JobRows({ cursor, first, onOpen }: { cursor: number | null; first: number; onOpen(t: ReaderTarget, el: HTMLElement): void }) {
  const target = useJob(readerOf);
  const convo = useJob((s) => s.payload?.rows.conversation.count ?? null);
  const decided = useJob((s) => s.payload?.rows.decisions.count ?? null);
  const rows: { t: ReaderTarget; name: string; more: string | null }[] = [
    { t: TICKET, name: 'Ticket and goal', more: null },
    { t: CONVERSATION, name: 'Conversation', more: convo !== null ? `· ${convo}` : null },
    { t: DECISIONS, name: 'Decisions', more: decided !== null ? `· ${decided} made for you` : null },
    { t: DETAILS, name: 'Details', more: null },
  ];
  return (
    <div className="jp2-jrs" role="group" aria-label="The job">
      {rows.map((r, i) => (
        <button
          key={r.t.kind}
          type="button"
          className={`jp2-row jp2-jr${target?.kind === r.t.kind ? ' is-sel' : ''}${cursor === first + i ? ' is-cursor' : ''}`}
          data-jp-line={first + i}
          aria-label={r.more ? `${r.name} ${r.more}` : undefined}
          onClick={(e) => onOpen(r.t, e.currentTarget)}
        >
          {r.name}{r.more && <span className="jp2-dim">{r.more}</span>}
        </button>
      ))}
    </div>
  );
});

const MessageBox = memo(function MessageBox({ boxRef }: { boxRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const store = useJobStore();
  const draft = useJob((s) => s.ui.draft);
  return (
    <div className="jp2-mb">
      <textarea
        ref={boxRef}
        className="jp2-mb-ta"
        aria-label="Message to the Foreman"
        placeholder="Write to the Foreman…"
        rows={1}
        value={draft}
        onChange={(e) => store.setDraft(e.target.value)}
      />
      <Button kind="primary" size="sm" disabled title="Sending from the new page comes in a later build. The old job page (⋯ menu) sends for now.">Send</Button>
    </div>
  );
});

// ---------- The reader (Tasks 12 to 14 fill it) ----------

const BODY_KINDS = new Set<ReaderKind>(['message', 'brief', 'doc', 'decisions']);

const TITLES: Partial<Record<ReaderKind, string>> = {
  conversation: 'Conversation', ticket: 'Ticket and goal', decisions: 'Decisions', details: 'Details', changes: 'Changes',
  checks: 'Checks and recording', findings: 'Findings', walkthrough: 'Walkthrough', ship: 'Ship', permission: 'Permission', 'not-yet': 'Not yet',
};

/** The reader's title row words: what it is, and a dim line of facts. */
function titleOf(t: ReaderTarget, payload: JobPagePayload | null): { title: string; meta: string | null } {
  if (t.kind === 'message' || t.kind === 'brief') {
    const line = payload?.thread.find((l) => l.id === t.id);
    return { title: line?.headline ?? (t.kind === 'brief' ? 'Brief' : 'Message'), meta: line?.at ? sinceWords(line.at) : null };
  }
  if (t.kind === 'doc') {
    for (const s of payload?.steps ?? []) {
      const o = s.outputs.find((x) => x.id === t.id);
      if (o) return { title: o.label, meta: [o.version ? `v${o.version}` : null, s.label].filter(Boolean).join(' · ') };
    }
    return { title: t.id.split('/').pop() ?? t.id, meta: null };
  }
  if (t.kind === 'pr') return { title: `PR #${t.id}`, meta: null };
  if (t.kind === 'conversation') return { title: 'Conversation', meta: payload ? `${payload.rows.conversation.count} items` : null };
  if (t.kind === 'decisions') return { title: 'Decisions', meta: payload ? `${payload.rows.decisions.count} made for you` : null };
  if (t.kind === 'ticket') return { title: 'Ticket and goal', meta: payload?.key ?? null };
  if (t.kind === 'details') return { title: 'Details', meta: 'every piece of work, newest first' };
  return { title: TITLES[t.kind] ?? 'Reader', meta: null };
}

const Reader = memo(function Reader({ job, searchRef }: { job: Job | null; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const target = useJob(readerOf);
  // Only the title row's words: a new thread line elsewhere does not redraw the reader.
  const head = useJob((s) => (target ? titleOf(target, s.payload) : null), (a, b) => a?.title === b?.title && a?.meta === b?.meta);
  if (!target || !head) {
    return (
      <>
        <div className="jp2-rv-top"><h2 className="jp2-rv-title">{job?.title ?? ''}</h2></div>
        <div className="jp2-rv-body" />
      </>
    );
  }
  const { title, meta } = head;
  return (
    <>
      <div className="jp2-rv-top">
        <h2 className="jp2-rv-title">{title}</h2>
        {meta && <span className="jp2-rv-meta">{meta}</span>}
      </div>
      {target.kind === 'conversation'
        ? <ConversationFrame searchRef={searchRef} />
        : <div className="jp2-rv-body">{BODY_KINDS.has(target.kind) ? <BodyText id={target.id} /> : <p className="jp2-dim">This view comes in a later build of the new page.</p>}</div>}
    </>
  );
});

/** A body's plain words (Task 12 typesets it); nothing until it lands, so nothing above it moves. */
function BodyText({ id }: { id: string }) {
  const store = useJobStore();
  const body = useJob((s) => s.bodies[id]);
  const error = useJob((s) => s.error);
  useEffect(() => { if (!body) void store.loadBody(id); }, [store, id, body]);
  if (!body) return error ? <p className="jp2-dim" role="alert">{error}</p> : null;
  return <div className="jp2-plain">{body.text}</div>;
}

/** The conversation's lines, one each, with a filter (Task 13 groups and opens them). */
function ConversationFrame({ searchRef }: { searchRef: React.RefObject<HTMLInputElement | null> }) {
  const thread = useJob((s) => s.payload?.thread ?? null);
  const [words, setWords] = useState('');
  const shown = useMemo(() => {
    const all = (thread ?? []).filter((l) => l.kind !== 'small');
    const q = words.trim().toLowerCase();
    return q ? all.filter((l) => l.headline.toLowerCase().includes(q)) : all;
  }, [thread, words]);
  return (
    <>
      <div className="jp2-cv-tools">
        <label className="jp2-cv-sbox">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            className="jp2-cv-search"
            type="search"
            aria-label="Search the conversation"
            placeholder="Search the conversation"
            value={words}
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && words) { e.stopPropagation(); setWords(''); } }}
          />
        </label>
        {thread && <span className="jp2-dim jp2-cv-count">{shown.length} shown</span>}
      </div>
      <div className="jp2-rv-body jp2-cv-body">
        <ul className="jp2-cv-lines">
          {shown.map((l) => (
            <li key={l.id} className={`jp2-cv-line${l.mine ? ' is-you' : ''}`}>
              <span className="jp2-cv-h">{l.headline}</span>
              {l.at && <time className="jp2-dim" dateTime={l.at}>{sinceWords(l.at)}</time>}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
