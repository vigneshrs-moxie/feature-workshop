// The open step on the job page (design 3.2), framed in place under the steps row: its head (icon,
// name, state, time, "Step 4 of 7"); who worked on it, each with a role, a model, what it does, how
// long and a status in words, with the terminals on the laptop as on the step page; the live feed of
// their last actions; the step's own body (children); and the documents from this step. The view
// comes from useStage; loading and a failed load stay in the who list's place, so the rest of the
// panel is whole. On the website there is no terminal: one sentence says where the buttons are.
// In Play full the bay at this step, in 3D (StageStrip), sits above who worked on it on a laptop, as
// it did on the step page; the phone's step screen has none.
// Under the step's documents, folded, the job's documents no step owns (notes.md, workflow-status.md,
// the history, a file the server's map does not know), with the same rows and reader.
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { FeedLine, Job, JobDocEntry, StageAgent, StageView, StopId } from '../../api/types';
import { BRAND } from '../../app/brand';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Fold, useNarrow } from '../../components/page/Page';
import { Select } from '../../components/Select';
import { STOPS, stopOf } from '../../components/stops/stops';
import type { GateKind } from '../../lib/compose';
import { initialsOf, ROLE_WORDS, roleOf } from '../../play/crewPack';
import { StageStrip } from '../../play/floor3d/StageStrip';
import { usePlay } from '../../play/usePlay';
import { useWorkshop } from '../../state/store';
import { StepDocs } from './StepDocs';
import { openPr, spentWords, statesOf, stepState, stepTimeWords } from './stepWords';
import { listOf } from '../../lib/lists';
import './page.css';

/** The panel's id, which each step's tab names (aria-controls), and each tab's id. */
export const STEP_PANEL_ID = 'sb-step-panel';
export const stepTabId = (stop: StopId) => `sb-step-${stop}`;

/** What a step not reached says: in the who list's place, or above the step's body with bodyFirst. */
const NOT_YET: Partial<Record<StopId, string>> = {
  test: 'Not yet. The Tester starts when the build is done. These three run then:',
  review: 'Not yet. Four reviewers look at the change after the tests: spec, errors, tests and screens.',
  ship: 'Not yet. PR #1 opens after the review, with its own go-ahead. PR #2 and PR #3 follow, each with yours.',
};

const isLive = (a: StageAgent) => a.status === 'working' || a.status === 'waiting';
/** The role word: the crew pack's, else the one the view sends (a row the step's body adds), else Helper. */
const roleWord = (a: StageAgent) => (a.who === 'conductor' ? roleOf(null) : ROLE_WORDS[a.who] ?? (a.role || roleOf(a.who)));
const initials = (a: StageAgent) => roleWord(a).split(/\s+/).map((w) => w.charAt(0).toUpperCase()).join('').slice(0, 2) || initialsOf(a.who);
/** A time's milliseconds; NaN when it is missing or not a time. The open step's bodies use it too. */
export const ms = (iso: string | null | undefined): number => (typeof iso === 'string' && iso ? Date.parse(iso) : NaN);

/** How long: running, from its start to now; finished, from its start to its last action. */
function rowTime(a: StageAgent, now: Date): string | null {
  const start = ms(a.since);
  const end = isLive(a) ? now.getTime() : ms(a.lastAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? spentWords(end - start) : null;
}

/** "now", or how long ago. */
function agoWords(at: string | null, now: Date): string | null {
  const t = ms(at);
  if (!Number.isFinite(t)) return null;
  const past = now.getTime() - t;
  return past < 60_000 ? 'now' : `${spentWords(past)} ago`;
}

/** A row's status in words. The Foreman's says who it waits for while the crew, Starbase's recorder or a review has the step. */
function statusOf(a: StageAgent, { job, stop, rows }: { job: Job; stop: StopId; rows: StageAgent[] }): { cls: string; words: string } {
  if (a.status === 'waiting') return { cls: 'is-waiting', words: 'Waiting for you' };
  if (a.who === 'conductor' && a.status !== 'done' && stopOf(job.stage) === stop) {
    const recording = (typeof job.testing === 'string' && job.testing.trim() !== '') || rows.some((r) => r.ref === 'recorder' && isLive(r));
    if (recording) return { cls: 'is-waiting-crew', words: 'Waiting for the evidence' };
    const crew = rows.filter((r) => r.who !== 'conductor' && r.ref !== 'recorder' && r.status === 'working');
    if (crew.length) {
      const roles = [...new Set(crew.map(roleWord))];
      return { cls: 'is-waiting-crew', words: roles.length === 1 ? `Waiting for the ${roles[0]}` : 'Waiting for the crew' };
    }
    if (stop === 'ship' && openPr(job) !== null) return { cls: 'is-waiting-crew', words: 'Waiting on the review' };
  }
  if (a.status === 'working') return { cls: 'is-working', words: 'Working' };
  if (a.status === 'done') return { cls: 'is-done', words: 'Done' };
  return a.since ? { cls: 'is-stopped', words: 'Stopped' } : { cls: 'is-stopped', words: 'Not started' };
}

export function StepPanel({ job, stop, view, error, onRetry, now, extraAgents, sent = null, docRequest, bodyFirst = false, regionOf, otherDocs, children }: {
  job: Job;
  stop: StopId;
  /** useStage's answer for this step; null while it loads or when it failed. */
  view: StageView | null;
  error: string | null;
  onRetry(): void;
  now: Date;
  /** Rows the step's body adds after the view's (Starbase's recorder at Test). */
  extraAgents?: StageAgent[];
  /** The bar's sent line (useSentShown), so the head says Approved after your Go as the row does. */
  sent?: { kind: GateKind | null } | null;
  /** A document to open in this step's list (a link, ⌘K): each new `n` opens its file once. */
  docRequest?: { n: number; file: string | null };
  /** The step's body right under the head (and the not-yet line), above who worked on it (the Test step). */
  bodyFirst?: boolean;
  /** The phone's step screen has no tab row: the panel is a region named by that screen's heading (its id). */
  regionOf?: string;
  /** The job's documents no step owns (the job's facts, docs.none); not known or none: no fold. */
  otherDocs?: JobDocEntry[] | null;
  children?: ReactNode;
}) {
  const play = usePlay();
  // The 3D bay is the laptop's: the phone's step screen stays simple, as drawn.
  const narrow = useNarrow();
  const i = STOPS.findIndex((s) => s.id === stop);
  const here = STOPS[i];
  const state = stepState(job, stop, sent);
  // The step's span only, as the steps row reads it: never a time of its own from view.since.
  const time = stepTimeWords(job, stop, view?.time, now, null, sent);
  const reached = (view?.state ?? statesOf(job)[stop]) !== 'next';
  const rows = view ? [...listOf<StageAgent>(view.agents), ...listOf<StageAgent>(view.finished), ...(extraAgents ?? [])] : extraAgents ?? [];
  const title = `${STEP_PANEL_ID}-title`;
  const others = listOf<JobDocEntry>(otherDocs);
  // The last document request handed down: each step's list is its own (keyed by step), so a request
  // already acted on is not handed to the next list, and picking the step again does not reopen it.
  const handled = useRef<number | null>(null);
  const request = docRequest && docRequest.n !== handled.current ? docRequest : undefined;
  useEffect(() => { if (docRequest) handled.current = docRequest.n; }, [docRequest]);
  const notYet = !reached && <p className="muted sb-not-yet">{NOT_YET[stop] ?? 'Not yet.'}</p>;
  const who = <Who key={stop} job={job} stop={stop} view={view} error={error} onRetry={onRetry} now={now} rows={rows} reached={reached} notYet={bodyFirst ? null : notYet} />;
  const box = useRef<HTMLElement>(null);
  const minHeight = useHeldHeight(box, stop, view === null && error === null, !narrow);
  return (
    <section className="sb-panel" id={STEP_PANEL_ID} role={regionOf ? 'region' : 'tabpanel'} aria-labelledby={regionOf ?? title} ref={box} style={minHeight ? { minHeight } : undefined}>
      <header className="sb-panel-head">
        <span className="sb-panel-icon" aria-hidden="true"><Icon name={here.icon} size={24} /></span>
        <h2 className="sb-panel-name" id={title}>{here.label}</h2>
        <span className={`chip sb-step-chip ${state.cls}`.trim()}>{state.words}</span>
        {time && <span className="muted sb-panel-time num">{time}</span>}
        <span className="sb-panel-spacer" />
        <span className="muted sb-panel-count">Step {i + 1} of {STOPS.length}</span>
      </header>
      {bodyFirst && notYet}
      {bodyFirst && children}
      {play.full && !narrow && <StageStrip job={job} stop={stop} agents={view ? listOf<StageAgent>(view.agents) : null} />}
      {who}
      {view && reached && <Feed rows={rows} now={now} />}
      {!bodyFirst && children}
      <section className="sb-panel-docs" aria-labelledby={`${title}-docs`}>
        <h3 id={`${title}-docs`}>Documents from this step</h3>
        <StepDocs key={stop} slug={job.slug} docs={listOf<JobDocEntry>(view?.docs)} request={request} loaded={view !== null || error !== null} known={Array.isArray(view?.docs)} />
      </section>
      {others.length > 0 && (
        <div className="sb-panel-docs" key={`${stop}-others`}>
          <Fold icon="file" name="Other documents of this job">
            <StepDocs slug={job.slug} docs={others} />
          </Fold>
        </div>
      )}
    </section>
  );
}

/**
 * A pick never makes the laptop's work column shorter while the picked step loads: the panel keeps
 * the height it had just before the pick as its minimum, until the step's view (or its error)
 * shows. Without it the panel shrinks to its loading line and the browser pulls the column's
 * scroll back, so the steps row and the bar drop. A pick (another stop) whose view is not in yet
 * measures the panel as it still stands on the page (the draw for the pick is not on the page yet)
 * and holds that. Nothing is held on the first draw, on a load of the same step (Try again), or
 * when `on` is false (the phone's step screen is its own screen). A pick made while another loads
 * measures the panel with the first pick's minimum still on it, so it keeps that height.
 *
 * The panel is measured during render, on purpose (React's rule is not to read a ref in render).
 * The minimum must land in the same commit as the pick. A measure after the commit (a layout
 * effect) comes too late: the shrunk panel is already committed, and any other layout read in that
 * commit forces layout, so the browser clamps `.sb-job-work`'s scroll before the minimum arrives,
 * and a later minimum does not give the scroll back. Revisit this if the hooks lint's refs rule or
 * the React Compiler is turned on.
 */
function useHeldHeight(box: RefObject<HTMLElement | null>, stop: StopId, loading: boolean, on: boolean): number | null {
  const [held, setHeld] = useState<number | null>(null);
  const [seenStop, setSeenStop] = useState(stop);
  let hold = held;
  if (seenStop !== stop) {
    setSeenStop(stop);
    const px = on && loading ? box.current?.getBoundingClientRect().height ?? 0 : 0;
    hold = px > 0 ? px : null;
    setHeld(hold);
  } else if (hold !== null && !loading) {
    hold = null;
    setHeld(null);
  }
  return hold !== null && on ? hold : null;
}

function Who({ job, stop, view, error, onRetry, now, rows, reached, notYet }: { job: Job; stop: StopId; view: StageView | null; error: string | null; onRetry(): void; now: Date; rows: StageAgent[]; reached: boolean; /** The not-yet line, when it sits in the list's place (else drawn above the body). */ notYet: ReactNode }) {
  const { api } = useWorkshop();
  const hosted = Boolean(api.hosted?.());
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const app = picked ?? view?.terminalApp ?? null;
  const local = `/api/job/${encodeURIComponent(job.slug)}/local`;
  const act = useCallback(async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try { setNote({ text: await fn(), bad: false }); } catch (err) { setNote({ text: err instanceof Error ? err.message : String(err), bad: true }); } finally { setBusy(null); }
  }, []);
  const openFolder = () => act('folder', async () => {
    await api.post(local, { action: 'open', what: 'terminal' });
    return `Opened the job’s folder in ${app ?? 'a terminal'}.`;
  });
  const pickApp = (name: string) => act('app', async () => {
    await api.post(local, { action: 'terminal-app', name });
    setPicked(name);
    return `The terminal buttons now use ${name}.`;
  });
  const openAgent = (a: StageAgent) => act(a.ref, async () => {
    const r = await api.post<{ demo?: boolean }>(`/api/job/${encodeURIComponent(job.slug)}/stage/${stop}/terminal`, { ref: a.ref });
    const role = roleWord(a);
    if (r?.demo) return `In the demo nothing opens; on your computer this would ${a.terminal?.kind === 'continue' ? `open the ${role} in a terminal` : `follow the ${role}’s log in a terminal`}.`;
    return a.terminal?.kind === 'continue' ? `Opened the ${role} in ${app ?? 'a terminal'}. Its session carries on there.` : `Following the ${role}’s log in ${app ?? 'a terminal'}. It only reads; nothing you type reaches it.`;
  });

  const heading = reached ? 'Who worked on it' : 'Who will work on it';
  const apps = Array.isArray(view?.terminalApps) ? view.terminalApps.filter((t): t is string => typeof t === 'string') : [];
  const id = `${STEP_PANEL_ID}-who`;
  let body: ReactNode;
  if (!view && error) {
    body = (
      <div className="sb-who-problem">
        <p className="thread-error" role="alert">Couldn’t load this step: {error}</p>
        <Button onClick={onRetry} title={`Ask ${BRAND.name} for this step again.`}>Try again</Button>
      </div>
    );
  } else if (!reached) {
    body = notYet;
  } else if (!view) {
    body = <p className="muted sb-who-empty" role="status">Loading who worked on it…</p>;
  } else if (rows.length === 0) {
    body = <p className="muted sb-who-empty">{view.state === 'skipped' ? 'This job skipped this step.' : 'Nobody is working here now.'}</p>;
  }
  // A heading never stands alone: nothing to say and nobody to list (a step not reached whose
  // not-yet line sits above the body) draws no who section at all.
  if (!body && rows.length === 0 && !note) return null;
  return (
    <section className="sb-who" aria-labelledby={id}>
      <header className="sb-who-head">
        <h3 id={id}>{heading}</h3>
        <span className="sb-panel-spacer" />
        {view && reached && (hosted
          ? <span className="muted sb-who-laptop">The terminal buttons are on your laptop.</span>
          : (
            <>
              <Button kind="quiet" icon="folder" busy={busy === 'folder'} disabled={busy !== null} onClick={() => void openFolder()} title="Open a terminal in the job’s folder (its worktree).">
                Open the job’s folder in a terminal
              </Button>
              {apps.length > 1 && (
                <Select className="stage-app" value={app ?? apps[0]} aria-label="Terminal app" disabled={busy !== null} onChange={(t) => void pickApp(t)} title="Which terminal app the buttons here open." options={apps.map((t) => ({ value: t, label: `in ${t}`, text: t }))} />
              )}
            </>
          ))}
      </header>
      {note && <p className={note.bad ? 'thread-error' : 'muted sb-who-note'} role={note.bad ? 'alert' : 'status'}>{note.text}</p>}
      {body}
      {rows.length > 0 && (
        <ul className="sb-who-rows">
          {rows.map((a) => (
            <WhoRow key={a.ref} a={a} status={statusOf(a, { job, stop, rows })} now={now} hosted={hosted} busy={busy === a.ref} off={busy !== null} onOpen={() => void openAgent(a)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function WhoRow({ a, status, now, hosted, busy, off, onOpen }: { a: StageAgent; status: { cls: string; words: string }; now: Date; hosted: boolean; busy: boolean; off: boolean; onOpen(): void }) {
  const role = roleWord(a);
  const time = rowTime(a, now);
  const cont = a.terminal?.kind === 'continue';
  return (
    <li className={`sb-who-row is-${a.status}`}>
      <span className="sb-who-initials" aria-hidden="true">{initials(a)}</span>
      <div className="sb-who-say">
        <span className="sb-who-name"><b className="sb-who-role">{role}</b>{a.model && <span className="chip num sb-who-model">{a.model}</span>}</span>
        <span className="sb-who-doing">{a.doing || (isLive(a) ? 'Getting started' : a.status === 'done' ? 'Finished its part' : 'Stopped before it finished')}</span>
      </div>
      <span className="muted sb-who-time num">{time && <><Icon name="clock" size={14} /> {time}</>}</span>
      <span className={`chip sb-who-status ${status.cls}`}>{status.words}</span>
      {/* The evidence recorder runs no session and writes no log to follow: no terminal button. */}
      {!hosted && a.ref !== 'recorder' && (
        <div className="sb-who-term">
          <Button
            kind={cont ? 'secondary' : 'quiet'}
            icon={cont ? 'terminal' : 'scroll'}
            busy={busy}
            disabled={!a.terminal?.ready || off}
            onClick={onOpen}
            title={a.terminal?.ready ? (cont ? 'Open the Foreman in a terminal and carry on its session there.' : `Follow the ${role}’s log in a terminal. Read-only: nothing you type reaches it.`) : a.terminal?.why ?? 'Not available now.'}
          >
            {cont ? 'Open in terminal' : 'Watch in terminal'}
          </Button>
          <span className="muted sb-who-term-note">{a.terminal?.ready ? (cont ? 'Continues its session' : 'Read-only: follows its log') : a.terminal?.why}</span>
        </div>
      )}
    </li>
  );
}

/**
 * One block per crew member (never the Foreman: its row says whom it waits for), newest line first:
 * those at work now, or, when none works, those who left lines here. A crew member at work with no
 * lines yet has its block with a sentence; nothing at all is drawn when no crew member has a block
 * (a step only the Foreman worked, a done step whose crew left no lines, a skipped step).
 */
function Feed({ rows, now }: { rows: StageAgent[]; now: Date }) {
  const lines = (a: StageAgent): FeedLine[] => (Array.isArray(a.feed) ? a.feed.filter((l) => l && typeof l.text === 'string' && l.text) : []);
  const crew = rows.filter((a) => a.who !== 'conductor');
  const working = crew.some(isLive);
  const blocks = crew.filter((a) => (working ? isLive(a) : lines(a).length > 0));
  if (blocks.length === 0) return null;
  const id = `${STEP_PANEL_ID}-feed`;
  return (
    <section className="sb-feed" aria-labelledby={id}>
      <h3 id={id}>{working ? 'Live: what they’re doing' : 'What they did last'}</h3>
      <div className="sb-feed-blocks">
        {blocks.map((a) => {
          const newest = [...lines(a)].reverse();
          return (
            <article key={a.ref} className="sb-feed-block" aria-label={roleWord(a)}>
              <header className="sb-feed-head">
                <b className="sb-feed-who">{roleWord(a)}</b>
                {a.model && <span className="chip num sb-who-model">{a.model}</span>}
                <span className={`chip sb-feed-state ${isLive(a) ? 'is-live' : 'is-finished'}`}>{isLive(a) ? 'Live' : 'Finished'}</span>
              </header>
              {newest.length === 0
                ? <p className="muted sb-feed-empty">No actions to show yet.</p>
                : (
                  <ol className="sb-feed-lines">
                    {newest.map((l, n) => {
                      const ago = agoWords(l.at, now);
                      return <li key={n}>{ago && <time className="sb-feed-at num" dateTime={l.at ?? undefined}>{ago}</time>}<span className="sb-feed-text">{l.text}</span></li>;
                    })}
                  </ol>
                )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
