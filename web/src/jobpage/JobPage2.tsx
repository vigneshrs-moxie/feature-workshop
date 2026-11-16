// The new job page's frame (plan Task 7): the store, the layout by width, the address and the keys.
// App.tsx and the website's HostedWorkshop.tsx mount it instead of the old page while the switch is
// on (switch.ts), with the job's slug as the key, so a pick never mounts it again.
//
// Layout by width (plan "Decisions already made" 1; the laptop's changed 16 Nov, the glance layout:
// docs/superpowers/specs/2026-11-16-job-page-glance-layout-design.md):
//   - 1100 px and wider ('wide'): the header row; the steps as a row of cells across the page with
//     the job's rows at its end; under it Your move, then the reader with the step panel
//     (left/StepPanel.tsx: what the picked step made) beside it; and on the right the conversation
//     in its own column, the asks row and the message box at its foot. The left pane's wrappers are
//     display: contents there (jobpage.css), so the parts sit in the page's grid.
//   - Over 760 and under 1100 px ('mid'): the left pane takes the width; opening something puts the
//     reader over it with a back row, and the focus moves into the reader.
//   - 760 px and under ('phone'): three screens by address (phone/PhoneJob2.tsx): the job screen is
//     the left pane with the header inside its scroll area; a step's screen (phone/PhoneStep.tsx) and
//     the reader (with phone/PhoneReader.tsx's back row) each take the whole page. data-screen on
//     .jp2 names the one shown. Moving to a screen is a history entry; the back rows follow history.
// It is one tree in every layout: a width change only changes classes (and moves the header into the
// left pane on the phone), so the draft, the picks, the reader's target, the focus and every scroll
// stay where they were.
//
// The address (app/router.ts): #/job/<slug> opens the job; /stage/<stop> opens that step;
// /conversation and /overview open the conversation and the ticket and goal in the reader;
// /read/<kind>/<id> opens that thing in the reader. Wider than a phone a pick rewrites the address in
// place (replaceHash: no history entry), so Back leaves the page and a reload comes back to it; on the
// phone moving to another screen is a history entry (phone/PhoneJob2.tsx), so Back walks the screens.
//
// First paint: from the Jobs snapshot's row for the job (the `job` prop: title, state, steps), so the
// header, Your move and the steps paint before the page's own payload lands; the payload then fills
// them in place. The reader is reader/Reader.tsx.
//
// Keys (app/keyRegistry.ts, scope 'jobpage', which wins over the others while the page is mounted):
// [ ] the step before and after; j k the next and previous line on the left (in the conversation, its
// lines, when that is where he is); Enter opens that line;
// / searches the conversation; g c the conversation; g t the ticket and goal; c i the message box;
// n adds a note on the block under the pointer (notes/Pointable.tsx registers it); ⌘K the asks and
// places (Palette.tsx; on the phone ⌘K stays the app's). Their other meanings come back when the page goes.
// The asks row (left/AsksRow.tsx) sits above the message box; it, ⌘K and the hand test's two calls in
// the reader (AsksContext) share one runner.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Job } from '../api/types';
import { BRAND } from '../app/brand';
import { useKeyScope } from '../app/keyRegistry';
import { jobHref, readHref, replaceHash, stageHref, type JobView } from '../app/router';
import { Button } from '../components/Button';
import { useMinWidth, useNarrow } from '../components/page/Page';
import { PhoneReader } from './phone/PhoneReader';
import { phoneScreenOf, usePhoneMoves } from './phone/PhoneJob2';
import { PhoneStep } from './phone/PhoneStep';
import { useWorkshop } from '../state/store';
import { browserDrafts, createJobStore, type JobPageState, type JobStore } from './jobStore';
import { recentPage, rememberPage } from './recent';
import { CONVERSATION, DECISIONS, DETAILS, readerBesideConvo, sameTarget, TICKET } from './targets';
import type { JobPagePayload, ReaderTarget, StopId } from './types';
import { Header } from './left/Header';
import { JobRows } from './left/JobRows';
import { AsksContext, AsksRow, useAskRunner } from './left/AsksRow';
import { MessageBox } from './left/MessageBox';
import { Steps, stepsFromRow } from './left/Steps';
import { PhonePrLines, usePrLead, usePrOpeningRead } from './left/PrLines';
import { YourMove } from './left/YourMove';
import { branchOf, loadCommits, loadDiff } from './reader/branch';
import { ConversationView, stepLine } from './reader/ConversationView';
import { StepPanel } from './left/StepPanel';
import { stateFromRow } from './left/Header';
import { briefTarget, DecideTabs } from './reader/DecideTabs';
import { Splitter } from './Splitter';
import { Reader } from './reader/Reader';
import { Palette } from './Palette';
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
    void mine.store.loadPage().then(() => {
      if (mine.ended) return;
      idle(() => {
        if (mine.ended) return;
        void mine.store.prefetch();
        // The Build step's commit list too (laptop only): its first pick shows at once (speed rule 2).
        const p = mine.store.getState().payload;
        // With the newest commit's diff, which Changes shows first.
        if (p && !p.hosted && !api.hosted?.() && p.steps.some((st) => st.outputs.some((o) => o.kind === 'changes'))) {
          void loadCommits(mine.store, api, slug).then(() => {
            const newest = branchOf(mine.store).commits?.[0];
            if (newest && !mine.ended) void loadDiff(mine.store, api, slug, newest.sha);
          });
        }
      });
    });
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

/**
 * The jobs whose open page holds its payload. From then on the snapshot row is not drawn from (Frame
 * keeps the first one), so a newer row (the app's snapshot comes again whenever any job changes) does
 * not even run the page: only the part that changed draws (speed rule 5).
 */
const settled = new Map<string, number>();
function sameProps(a: JobPage2Props, b: JobPage2Props): boolean {
  return a.slug === b.slug && a.step === b.step && a.view === b.view && a.read === b.read && a.store === b.store
    && (a.job === b.job || (a.job != null && b.job != null && (settled.get(b.slug) ?? 0) > 0));
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
}, sameProps);

function Frame({ slug, job: row, step, view, read }: Omit<JobPage2Props, 'store'>) {
  const store = useJobStore();
  const layout = useLayout();
  const hasPayload = useJob((s) => s.payload !== null);
  // The snapshot row is for the first paint only: once the payload is in, a newer row redraws nothing.
  const firstRow = useRef(row);
  if (!hasPayload) firstRow.current = row;
  const job = firstRow.current;
  useEffect(() => {
    if (!hasPayload) return undefined;
    settled.set(slug, (settled.get(slug) ?? 0) + 1);
    return () => { const n = (settled.get(slug) ?? 1) - 1; if (n > 0) settled.set(slug, n); else settled.delete(slug); };
  }, [slug, hasPayload]);
  // Over the left pane under 1100 px: open from a pick (or an address that names a reader target).
  const [covered, setCovered] = useState(() => addressTarget(view, read) !== null);
  const [cursor, setCursor] = useState<number | null>(null);
  const reader = useRef<HTMLElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const search = useRef<HTMLInputElement>(null);
  /** The control that opened the reader, for the back row to give the focus back to. */
  const opener = useRef<HTMLElement | null>(null);
  const single = layout !== 'wide';
  const phone = layout === 'phone';
  /** The glance layout: the conversation has its own column, so the reader never shows it. */
  const wide = layout === 'wide';
  const convo = useRef<HTMLElement>(null);
  const page = useRef<HTMLElement>(null);
  // A decision waits (a laptop): the decision and the brief side by side, each the page's full height
  // (16 Nov). From the Jobs row before the payload, so the first paint is already laid out that way.
  const moveWaits = useJob((s) => (s.payload ? s.payload.move?.kind === 'gate' || s.payload.move?.kind === 'question' : null));
  const deciding = wide && (moveWaits ?? (job !== null && stateFromRow(job) === 'needs-you' && job.waitingFor !== 'permission'));
  // The conversation's column can be hidden (its message box stays, along the foot); kept in this browser.
  const [convoShown, setConvoShown] = useState(readConvoShown);
  const showConvo = useCallback((on: boolean) => { flushSync(() => setConvoShown(on)); keepConvoShown(on); }, []);
  /** As of this draw, for pickReader to read without being made again when it changes. */
  const convoShownRef = useRef(convoShown);
  convoShownRef.current = convoShown;
  const decidingRef = useRef(deciding);
  decidingRef.current = deciding;
  // The phone's screen, from the address (null wider than a phone).
  const screenNow = phone ? phoneScreenOf(step, view, read) : null;
  const moves = usePhoneMoves(slug, screenNow);
  /** On the phone: the line on the job screen that opened another screen, for Back to give the focus back to. */
  const phoneOpener = useRef<HTMLElement | null>(null);
  // The screen as of this draw, for the callbacks below to read without being made again on every
  // screen change (only what changed redraws: speed rule 5).
  const screenRef = useRef(screenNow);
  screenRef.current = screenNow;
  const leavingJob = useCallback((from?: HTMLElement | null) => {
    if (screenRef.current === 'job') phoneOpener.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }, []);

  // A later change of the address (a link, Back) is a pick of what it names; the page's own picks
  // write the address first, so this finds them already done.
  useEffect(() => { if (step) { store.setStep(step); store.setReader(null); } }, [store, step]);
  const named = addressTarget(view, read);
  useEffect(() => { if (named) store.setReader(named); }, [store, named?.kind, named?.id]);
  // The cover follows the address. On the phone it is the screen, so turning a phone sideways (or a
  // tablet, 760 to 1100 px) shows what the address names: the reader over the left pane on a reader
  // screen, the left pane after Back. Wider, an address that names a reader target (a link, a typed
  // address, Back and Forward) puts the reader over the pane, and the job's own address takes it off;
  // a step's address leaves it as it is (a step pick shows the reader itself).
  const namedKey = named ? `${named.kind}:${named.id}` : null;
  useLayoutEffect(() => {
    if (phone) { setCovered(screenNow === 'reader'); return; }
    if (namedKey) setCovered(true);
    else if (!step) setCovered(false);
  }, [phone, screenNow, namedKey, step]);

  // A step pick opens the step and shows its main output (targets.ts readerOf): his own reader pick
  // goes, so the address /stage/<stop> brings the same view back on a reload.
  const pickStep = useCallback((id: StopId) => {
    store.setStep(id);
    store.setReader(null);
    // On the phone a step is its own screen.
    if (phone) moves.toStep(id);
    else replaceHash(stageHref(slug, id));
  }, [store, slug, phone, moves]);

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

  /**
   * A second pick of what the reader shows (a laptop; 16 Nov, "clicking it again should unshow it"):
   * the reader goes back to what it showed before, the picked step's main output (else what the page
   * opened on), or the brief while a decision waits. False when there is nothing to go back to.
   */
  const unpickReader = useCallback((t: ReaderTarget): boolean => {
    const s = store.getState();
    const brief = decidingRef.current ? briefTarget(s.payload) : null;
    if (brief && !sameTarget(brief, t)) {
      // The brief is what the page opened on with no step picked: the job's own address then.
      const plain = !s.ui.step && sameTarget(readerBesideConvo({ ...s, ui: { ...s.ui, reader: null } }), brief);
      store.setReader(plain ? null : brief);
      replaceHash(plain ? jobHref(slug) : readHref(slug, brief));
      return true;
    }
    if (brief) return false;
    if (!s.ui.reader) return false;
    store.setReader(null);
    replaceHash(s.ui.step ? stageHref(slug, s.ui.step) : jobHref(slug));
    return true;
  }, [store, slug]);

  const pickReader = useCallback((t: ReaderTarget, from?: HTMLElement | null) => {
    // A control marked data-jp-toggle (the job's rows, the tabs, the step panel's rows) toggles: a
    // pick of what shows un-shows it. A key, a link in what he reads, or ⌘K always shows.
    const toggles = wide && !!from && from.hasAttribute('data-jp-toggle');
    // A laptop: the conversation is its own column, always there; its pick goes to its search box.
    if (wide && t.kind === 'conversation') {
      if (toggles && convoShownRef.current) { showConvo(false); return; }
      showConvo(true); search.current?.focus(); return;
    }
    if (toggles && sameTarget(readerBesideConvo(store.getState()), t)) { unpickReader(t); return; }
    store.setReader(t);
    // On the phone the reader is its own screen.
    if (phone) { leavingJob(from); moves.toReader(t); return; }
    replaceHash(readHref(slug, t));
    showReader(from);
  }, [store, slug, showReader, phone, moves, leavingJob, wide, showConvo, unpickReader]);

  // R2 (Task 20, left/PrLines.tsx): GitHub is read as the page opens (when the last read is old), and the
  // PR's next action leads the asks row while the Ship step is not the open one.
  usePrOpeningRead();
  const prLead = usePrLead(pickReader);
  /** The asks' runner: the row, ⌘K and the hand test's two calls send through it (R6, R7). */
  const asks = useAskRunner(box, pickReader);
  const asksHere = useMemo(() => ({ runner: asks, phone }), [asks, phone]);

  /** A click (or Enter) on a step: it opens, and its main output shows in the reader (on the phone: the step's screen). */
  const openStep = useCallback((id: StopId, from?: HTMLElement | null) => {
    // A laptop: a second click on the picked step, while its main output shows, un-picks it.
    if (wide && from?.hasAttribute('data-jp-toggle')) {
      const ui = store.getState().ui;
      if (ui.step === id && !ui.reader) { store.setStep(null); replaceHash(jobHref(slug)); return; }
    }
    if (phone) leavingJob(from);
    pickStep(id);
    if (!phone) showReader(from);
  }, [pickStep, showReader, phone, leavingJob, wide, store, slug]);

  // The back row (760 to 1100 px): the reader goes, and the address is the job's again, so a reload or
  // a narrowing to the phone shows the job, not the thing that was open.
  const back = useCallback(() => {
    flushSync(() => setCovered(false));
    replaceHash(jobHref(slug));
    const to = opener.current;
    if (to && to.isConnected) to.focus();
  }, [slug]);

  const lines = useMemo(() => leftLines(store.getState().payload, job), [store, job, hasPayload]);
  const openLine = useCallback((i: number, from: HTMLElement | null = null) => {
    const line = lines[i];
    if (!line) return;
    if (line.step) openStep(line.step, from);
    else if (line.target) pickReader(line.target, from);
  }, [lines, openStep, pickReader]);

  const leftHidden = phone ? screenNow !== 'job' : single && covered;
  const readerShown = phone ? screenNow === 'reader' : !single || covered;
  /** The reader lies over the left pane (under 1100 px), or is the phone's screen. */
  const readerOver = single && readerShown;
  // Crossing from two panes to one while the reader is open, or the phone's reader screen opening:
  // the focus goes into it, not to the page.
  useEffect(() => {
    if (!readerOver) return;
    const at = document.activeElement;
    if (!at || at === document.body || !reader.current?.contains(at)) reader.current?.focus();
  }, [readerOver]);
  // Back on the phone's job screen: the focus goes to the line that opened the other screens.
  const lastScreen = useRef(screenNow);
  useEffect(() => {
    const was = lastScreen.current;
    lastScreen.current = screenNow;
    if (screenNow !== 'job' || !was || was === 'job') return;
    const to = phoneOpener.current;
    if (to && to.isConnected) to.focus();
  }, [screenNow]);
  useKeyScope('jobpage', {
    'jp-step-prev': () => { uncover(); stepBy(-1); },
    'jp-step-next': () => { uncover(); stepBy(1); },
    // In the conversation (the focus in the reader, or the reader over the left pane): its lines.
    'jp-line-next': () => { if (stepLine(convo.current, 1, false) || stepLine(reader.current, 1, leftHidden)) return; if (!leftHidden) moveCursor(1); },
    'jp-line-prev': () => { if (stepLine(convo.current, -1, false) || stepLine(reader.current, -1, leftHidden)) return; if (!leftHidden) moveCursor(-1); },
    // Enter on a line opens that line (j and k move the focus to it); elsewhere it belongs to the control.
    'jp-open': (e) => {
      if (leftHidden) return false;
      const on = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-jp-line]') : null;
      if (on) { openLine(Number(on.dataset.jpLine), on); return; }
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
      // The phone: the box is on the job screen (an ask that needs a word, from the reader's hand
      // test); the screen's own focus rule then gives the focus to the box.
      if (phone && screenRef.current !== 'job') {
        phoneOpener.current = box.current;
        replaceHash(jobHref(slug));
        return;
      }
      uncover();
      box.current?.focus();
    },
  });

  /** Under 1100 px: take the reader off the left pane, so a key that acts there is seen (the phone's screens go by address). */
  function uncover() {
    if (leftHidden && !phone) flushSync(() => setCovered(false));
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
    <main ref={page} className="jp2" aria-label="Job" data-layout={layout} data-deciding={deciding ? '' : undefined} data-convo={wide && !convoShown ? 'hidden' : undefined} data-screen={screenNow ?? undefined} data-covered={(phone ? screenNow === 'reader' : covered) ? '' : undefined}>
      {!phone && <Header job={job} />}
      <div className="jp2-panes">
        <div className="jp2-left" aria-hidden={leftHidden || undefined} inert={leftHidden || undefined}>
          <div className="jp2-lscroll">
            {/* On the phone the header is the top of the job screen and scrolls with it. */}
            {phone && <Header job={job} />}
            <div className="jp2-movewrap">
              <PageProblem />
              <YourMove job={job} onOpen={pickReader} />
            </div>
            <Steps job={job} cursor={cursor} onStep={openStep} onOpen={pickReader} phone={phone} across={wide} />
            {/* Task 21: the phone's PR line, ending in `Comments · 3 new` (it opens the PR view). */}
            {phone && <PhonePrLines onOpen={pickReader} />}
            <JobRows cursor={cursor} first={lines.findIndex((l) => l.target)} onOpen={pickReader} wide={wide} convoShown={wide && convoShown} />
          </div>
          {!wide && <AsksRow runner={asks} job={job} phone={phone} lead={prLead.lead} onLead={prLead.onLead} />}
          {!wide && <MessageBox boxRef={box} onOpen={pickReader} />}
        </div>
        {screenNow === 'step' && step && <PhoneStep id={step} job={job} onBack={moves.back} onOpen={pickReader} />}
        <section
          ref={reader}
          className="jp2-reader"
          aria-label="Reader"
          tabIndex={-1}
          onKeyDown={single ? (e) => {
            if (e.key !== 'Escape' || !readerShown || e.defaultPrevented) return;
            e.preventDefault();
            if (phone) moves.back(); else back();
          } : undefined}
          aria-hidden={readerShown ? undefined : true}
          inert={readerShown ? undefined : true}
        >
          {layout === 'mid' && (
            <div className="jp2-back">
              <Button kind="quiet" size="sm" icon="chevron-left" onClick={back} title="Close the reader and go back to the job.">Back to the job</Button>
            </div>
          )}
          {phone && <PhoneReader onBack={moves.back} />}
          {deciding && <DecideTabs onOpen={pickReader} />}
          <AsksContext.Provider value={asksHere}>
            <Reader fallback={job?.title ?? ''} searchRef={search} onOpen={pickReader} convoBeside={wide} />
          </AsksContext.Provider>
        </section>
        {wide && !deciding && <StepPanel onOpen={pickReader} />}
        {deciding && <Splitter className="is-decide" page={page} prop={WIDTH.decide} measure={() => page.current?.querySelector<HTMLElement>('.jp2-movewrap') ?? null} side="left" min={380} max={1100} label="the decision" />}
        {wide && convoShown && <Splitter className="is-convo" page={page} prop={WIDTH.convo} measure={() => convo.current} side="right" min={280} max={820} label="the conversation" />}
        {wide && (
          <section ref={convo} className="jp2-convo" aria-label="Conversation">
            <div className="jp2-convo-top">
              <h2 className="jp2-convo-h">Conversation</h2>
              <Button kind="quiet" size="sm" onClick={() => { showConvo(false); page.current?.querySelector<HTMLElement>('.jp2-jrs [data-jp-convo]')?.focus(); }} title="Hide the conversation; its message box stays along the foot. The Conversation link brings it back.">Hide</Button>
            </div>
            <AsksContext.Provider value={asksHere}>
              <ConversationView searchRef={search} onOpen={pickReader} column />
            </AsksContext.Provider>
            <AsksRow runner={asks} job={job} phone={false} lead={prLead.lead} onLead={prLead.onLead} />
            <MessageBox boxRef={box} onOpen={pickReader} />
          </section>
        )}
      </div>
      <Palette runner={asks} job={job} phone={phone} onStep={openStep} onOpen={pickReader} />
    </main>
  );
}

/** The widths the drag handles set on the page (Splitter.tsx), read by the grid in jobpage.css. */
const WIDTH = {
  decide: '--jp2-decide-w',
  convo: '--jp2-convo-w',
} as const;

const CONVO_KEY = 'sb.jobPage.convo';
function readConvoShown(): boolean {
  try { return localStorage.getItem(CONVO_KEY) !== 'hidden'; } catch { return true; }
}
function keepConvoShown(on: boolean) {
  try { if (on) localStorage.removeItem(CONVO_KEY); else localStorage.setItem(CONVO_KEY, 'hidden'); } catch { /* storage off: for this visit */ }
}

/** The job failed to load and nothing of it is held: why, in plain words, and Try again (final fix W3). */
function PageProblem() {
  const store = useJobStore();
  const problem = useJob((s) => (s.payload ? null : s.pageProblem));
  const [trying, setTrying] = useState(false);
  if (!problem) return null;
  const tryAgain = () => {
    setTrying(true);
    void store.loadPage().finally(() => setTrying(false));
  };
  return (
    <div className="jp2-pageproblem" role="alert">
      <p className="jp2-pageproblem-says">{problem}</p>
      <Button size="sm" onClick={tryAgain} disabled={trying} title={`Ask ${BRAND.name} for this job again.`}>{trying ? 'Trying again…' : 'Try again'}</Button>
    </div>
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
