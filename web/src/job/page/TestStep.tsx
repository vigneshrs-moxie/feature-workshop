// The Test step's body (design 3.5): three kinds of test, each with a state, where it runs and when.
//   Checks, run by the Tester: its counts from test-report.md; while it works, its command and the end
//     of its output (on the website, the command; the output stays on the laptop).
//   Recorded evidence, by Starbase: the line it records and each line's state, a finished line's
//     video, and Watch, the hidden browser live in the page (laptop only). A recording that could
//     not finish shows the problem and Record again, never a line number.
//   Your hand test, by you: Try it with What to check beside it (laptop only). While Auto decides
//     the job, it says Auto skips the hand test.
// Every fact may be missing (a record from an older laptop): each row then says its plain state.
// Once Test is done or skipped, a row with nothing to show says Not run, with no When.
// The evidence not known yet is never a state: the row says Loading… until the first answer, and
// Couldn’t read the evidence. with Try again when the asks failed before any view came.
// recorderAgent gives the open step Starbase's own row and feed while it records. Watch and Try it
// open and close through the page (watching, tryOpen), which keeps them.
import { useId, useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import type { EvidenceCriterion, EvidenceProgress, EvidenceRecordResult, EvidenceView, FeedLine, Job, JobDetail, StageAgent, StageView } from '../../api/types';
import { BRAND } from '../../app/brand';
import { useUi } from '../../app/ui';
import { Button } from '../../components/Button';
import { useNarrow } from '../../components/page/Page';
import { canPlay, EvidenceStrip } from '../../panes/Foreman/EvidenceStrip';
import { TryTab } from '../../panes/Preview/TryTab';
import { useWorkshop } from '../../state/store';
import { AUTO_SKIPS_HAND_TEST } from '../../views/JobDrawer/OptionsEditor';
import { spentWords, statesOf } from './stepWords';
import { listOf } from '../../lib/lists';
import { ms } from './StepPanel';
import type { EvidenceState } from './useEvidence';
import { WatchPicture } from './WatchPicture';
import { WhatToCheck } from './WhatToCheck';
import './page.css';

/** How many waiting lines show before the rest fold into one row ("11 more waiting"). */
const WAITING_SHOWN = 4;

type Line = EvidenceProgress['lines'][number];

const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const fileUrl = (slug: string, file: string) => `/api/job/${encodeURIComponent(slug)}/evidence/file?path=${encodeURIComponent(file)}`;
const errorWords = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** "18 min ago"; null when the time can't be read or lies ahead (a clock a minute off reads as now). */
function agoWords(iso: string | null | undefined, now: Date): string | null {
  const past = now.getTime() - ms(iso);
  if (!Number.isFinite(past) || past < -60_000) return null;
  return `${spentWords(Math.max(0, past))} ago`;
}

const LINE_WORDS: Record<Line['state'], string> = { passed: 'Passed', failed: 'Failed', running: 'Running', waiting: 'Waiting', skipped: 'Skipped' };
/** A line of the evidence's progress, not a hole in the list. */
const isLine = (l: unknown): l is Line => l !== null && typeof l === 'object';
const isFinished = (l: Line) => l.state === 'passed' || l.state === 'failed' || l.state === 'skipped';

/**
 * Starbase's own row in the open step while it records the evidence: role Starbase, `recorder` where
 * the model goes, what it does and a feed of the lines (the last three it finished, then the one it
 * runs now, oldest first as every feed is). No terminal: it has no session or log of its own to
 * follow. null with no progress (pass the progress only while the view says it records).
 */
export function recorderAgent(progress: EvidenceProgress | null | undefined): StageAgent | null {
  if (!progress || !Array.isArray(progress.lines)) return null;
  // Each line by its own number; a hole in the list (a half-written answer) is left out.
  const lines = progress.lines.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => isLine(l));
  const of = count(progress.of) || progress.lines.length;
  const line = count(progress.line);
  const order = (a: { l: Line; n: number }, b: { l: Line; n: number }) => (ms(a.l.at) || 0) - (ms(b.l.at) || 0) || a.n - b.n;
  const done = lines.filter(({ l }) => isFinished(l)).sort(order).slice(-3);
  const running = lines.filter(({ l }) => l.state === 'running');
  const feed: FeedLine[] = [
    ...done.map(({ l, n }) => ({ text: `Line ${n} ${l.state}: ${l.title}`, at: l.at ?? null })),
    ...running.map(({ l, n }) => ({ text: `Line ${n}: ${l.title}`, at: l.at ?? null })),
  ];
  const times = lines.map(({ l }) => ms(l.at)).filter(Number.isFinite);
  return {
    who: 'starbase-recorder',
    role: BRAND.name,
    model: 'recorder',
    doing: line >= 1 ? `Recording evidence: line ${line} of ${of}` : `Recording evidence: starting, ${of} ${of === 1 ? 'line' : 'lines'}`,
    since: progress.startedAt ?? null,
    lastAt: times.length ? new Date(Math.max(...times)).toISOString() : progress.startedAt ?? null,
    status: 'working',
    terminal: { kind: 'watch', ready: false, why: `${BRAND.name} records this itself.` },
    ref: 'recorder',
    feed,
  };
}

export function TestStep({ slug, job, detail, view, evidence, evidenceState, watching, onWatching, tryOpen, onTryOpen, now, onRecorded }: {
  slug: string;
  job: Job;
  detail: JobDetail | null;
  /** The Test step's view (useStage); null while it loads. */
  view: StageView | null;
  /** The job's evidence view (useEvidence); null while it loads, or from a Starbase before it. */
  evidence: EvidenceView | null;
  /** Whether the evidence is known (useEvidence): an answer came, the last failure, and asking again. Left out: known. */
  evidenceState?: Pick<EvidenceState, 'loaded' | 'error' | 'reload'>;
  /** Watch is on (the page keeps it). */
  watching: boolean;
  onWatching(on: boolean): void;
  /** Try it is open (the page keeps it). */
  tryOpen: boolean;
  onTryOpen(open: boolean): void;
  /** The page's clock, for "18 min ago"; now when left out. */
  now?: Date;
  /** After Record again: ask for the evidence again (useEvidence's reload). */
  onRecorded?(): void;
}) {
  const { api } = useWorkshop();
  const hosted = Boolean(api.hosted?.());
  const clock = now ?? new Date();
  const [stripOpen, setStripOpen] = useState(false);
  const id = useId();
  const stripId = `${id}-strip`;
  const at = statesOf(job).test;
  const past = at === 'done' || at === 'skipped';
  return (
    <section className="sb-test" aria-labelledby={`${id}-head`}>
      <h3 id={`${id}-head`}>Three kinds of test</h3>
      <div className="sb-test-rows">
        <ChecksRow view={view} now={clock} hosted={hosted} past={past} />
        <EvidenceRow slug={slug} evidence={evidence} known={evidenceState} now={clock} hosted={hosted} past={past} watching={watching} onWatching={onWatching} stripOpen={stripOpen} onStrip={() => setStripOpen(!stripOpen)} stripId={stripId} onRecorded={onRecorded} />
        <HandRow slug={slug} job={job} detail={detail} view={view} now={clock} hosted={hosted} tryOpen={tryOpen} onTryOpen={onTryOpen} />
      </div>
      {/* The page's evidence view: the strip asks nothing of its own. */}
      {stripOpen && <div id={stripId} className="sb-test-strip"><EvidenceStrip slug={slug} view={evidence} /></div>}
    </section>
  );
}

type Tone = 'ok' | 'err' | 'now' | '';

/** One kind of test: its name and who runs it, its state, Where and When, and what goes under them. */
function Kind({ name, by, state, tone = '', stateTitle, where, when, children }: { name: string; by: string; /** null: no state to show (not known yet). */ state: string | null; tone?: Tone; stateTitle?: string; where: string; when: ReactNode | null; children?: ReactNode }) {
  return (
    <article className="sb-test-row" aria-label={name}>
      <div className="sb-test-head">
        <h4 className="sb-test-name">{name}</h4>
        <span className="muted sb-test-by">{by}</span>
        {state !== null && <span className={`chip sb-test-chip${tone ? ` is-${tone}` : ''}`} title={stateTitle}>{state}</span>}
      </div>
      <dl className="sb-test-facts">
        <div><dt>Where</dt><dd>{where}</dd></div>
        {when !== null && <div><dt>When</dt><dd>{when}</dd></div>}
      </dl>
      {children}
    </article>
  );
}

/** The Tester at this step: the one working now, else the last one to finish. */
function testerOf(view: StageView | null): StageAgent | null {
  const all = [...listOf<StageAgent>(view?.agents), ...listOf<StageAgent>(view?.finished)].filter((a) => a.who === 'feature-tester');
  const live = all.find((a) => a.status === 'working' || a.status === 'waiting');
  if (live) return live;
  return all.sort((a, b) => (ms(b.lastAt) || 0) - (ms(a.lastAt) || 0))[0] ?? null;
}

function ChecksRow({ view, now, hosted, past }: { view: StageView | null; now: Date; hosted: boolean; /** Test is done or skipped. */ past: boolean }) {
  const ui = useUi();
  const tester = testerOf(view);
  const working = tester !== null && (tester.status === 'working' || tester.status === 'waiting');
  const checks = view?.checks ?? null;
  const passed = count(checks?.passed);
  const failed = count(checks?.failed);
  const total = passed + failed + count(checks?.notRun);
  const finished = !working && (total > 0 || tester?.status === 'done');

  let state = past ? 'Not run' : 'Not started';
  let tone: Tone = '';
  if (working) { state = 'Running'; tone = 'now'; } else if (total > 0) {
    state = failed > 0 ? `Failed, ${failed} of ${total}` : `Passed, ${passed} of ${total}`;
    tone = failed > 0 ? 'err' : 'ok';
  } else if (tester?.status === 'done') { state = 'Done'; tone = 'ok'; }

  let when: string | null = past ? null : 'After the build';
  if (working) when = 'Running now';
  else if (finished) {
    const ago = agoWords(checks?.at ?? tester?.lastAt, now);
    const took = tester?.status === 'done' ? ms(tester.lastAt) - ms(tester.since) : NaN;
    when = ago ? (Number.isFinite(took) && took >= 0 ? `Finished ${ago}, took ${spentWords(took)}` : `Finished ${ago}`) : null;
  }

  const cmd = working ? tester?.command ?? null : null;
  const tail = !hosted && typeof cmd?.tail === 'string' && cmd.tail.trim() ? cmd.tail.replace(/\s+$/, '') : null;
  return (
    <Kind name="Checks" by="run by the Tester" state={state} tone={tone} where="Commands in the job’s folder" when={when}>
      {cmd && typeof cmd.command === 'string' && cmd.command && (
        <>
          <pre className="sb-test-out" tabIndex={0} aria-label="The Tester’s command and the end of its output"><code>{`$ ${cmd.command}${tail ? `\n${tail}` : ''}`}</code></pre>
          {hosted && <p className="muted sb-test-note">Its output shows on your laptop.</p>}
        </>
      )}
      {checks && (
        <button type="button" className="link-button sb-test-link" onClick={() => ui.openDocs('test-report.md')} title="Open the Tester’s report, test-report.md.">
          The command and the end of its output
        </button>
      )}
    </Kind>
  );
}

function EvidenceRow({ slug, evidence, known, now, hosted, past, watching, onWatching, stripOpen, onStrip, stripId, onRecorded }: {
  slug: string; evidence: EvidenceView | null; known?: Pick<EvidenceState, 'loaded' | 'error' | 'reload'>; now: Date; hosted: boolean; past: boolean; watching: boolean; onWatching(on: boolean): void;
  stripOpen: boolean; onStrip(): void; stripId: string; onRecorded?(): void;
}) {
  const recording = evidence?.recording === true;
  // Line by line only while it records: a run that ended says no line number anywhere.
  const progress = recording && evidence?.progress && Array.isArray(evidence.progress.lines) ? evidence.progress : null;
  const problem = !recording ? evidence?.problem ?? null : null;
  const ev = evidence?.evidence ?? null;
  const canWatch = recording && !hosted && evidence?.watch === true;
  const where = 'The job’s app on its own address, in a hidden browser';

  // Not known: no view yet, from an ask still out or asks that failed. Never Not started.
  if (!evidence && known && (!known.loaded || known.error)) {
    return (
      <Kind name="Recorded evidence" by={`by ${BRAND.name}`} state={null} where={where} when={null}>
        {!known.loaded
          ? <p className="muted sb-test-note" role="status">Loading…</p>
          : (
            <div className="sb-test-problem">
              <p className="thread-error" role="alert" title={known.error ?? undefined}>Couldn’t read the evidence.</p>
              <div className="sb-test-action">
                <Button kind="secondary" size="sm" icon="refresh" onClick={known.reload} title={`Ask ${BRAND.name} for the evidence again.`}>Try again</Button>
              </div>
            </div>
          )}
      </Kind>
    );
  }

  let state = past ? 'Not run' : 'Not started';
  let tone: Tone = '';
  let title: string | undefined;
  let when: string | null = past ? null : 'After the checks';
  if (recording) {
    const line = count(progress?.line);
    state = progress && line >= 1 ? `Running, line ${line} of ${count(progress.of) || progress.lines.length}` : 'Running';
    tone = 'now';
    const ago = agoWords(progress?.startedAt, now);
    when = ago ? `Started ${ago}` : null;
  } else if (problem) {
    state = 'Stopped';
    tone = 'err';
    when = null;
  } else if (ev) {
    const criteria = listOf<EvidenceCriterion>(ev.criteria);
    const n = (s: string) => criteria.filter((c) => c.status === s).length;
    const parts = [[n('passed'), 'passed'], [n('failed'), 'failed'], [n('skipped'), 'not recorded']].filter(([k]) => (k as number) > 0).map(([k, w]) => `${k} ${w}`);
    state = parts.length ? parts.join(', ') : 'Recorded';
    tone = n('failed') > 0 ? 'err' : 'ok';
    const ago = agoWords(ev.at, now);
    when = ago ? `Finished ${ago}` : null;
  } else if (evidence && !evidence.wanted) {
    state = 'Not for this job';
    title = evidence.why || undefined;
    when = null;
  }

  return (
    <Kind name="Recorded evidence" by={`by ${BRAND.name}`} state={state} tone={tone} stateTitle={title} where={where} when={when}>
      {canWatch && (
        <div className="sb-test-action">
          <Button kind="secondary" size="sm" icon={watching ? 'eye-off' : 'eye'} onClick={() => onWatching(!watching)}>
            {watching ? 'Stop watching' : 'Watch'}
          </Button>
          <span className="muted sb-test-note">The hidden browser, live, in this page.</span>
        </div>
      )}
      {canWatch && watching && <WatchPicture slug={slug} progress={progress} />}
      {progress && <Lines slug={slug} lines={progress.lines} playable={(video) => canPlay(video, { hosted, onSite: evidence?.onSite })} />}
      {problem && <Problem slug={slug} problem={problem} hosted={hosted} onRecorded={onRecorded} />}
      {(ev || evidence?.wanted) && (
        <button type="button" className="link-button sb-test-link" aria-expanded={stripOpen} aria-controls={stripId} onClick={onStrip} title="Open the evidence for each acceptance line below, with its pictures and video.">
          Each line and its video
        </button>
      )}
    </Kind>
  );
}

/**
 * Each line in order: the finished ones, the one it runs, the first few waiting and the rest as one
 * row. A finished line's video has Play video only where it can play (on the website, once it is on
 * the site).
 */
function Lines({ slug, lines, playable }: { slug: string; lines: Line[]; playable(video: string | null | undefined): boolean }) {
  const waiting = lines.filter((l) => isLine(l) && l.state === 'waiting').length;
  const keep = waiting - WAITING_SHOWN > 1 ? WAITING_SHOWN : waiting;
  let seen = 0;
  const rows: { l: Line; n: number }[] = [];
  lines.forEach((l, i) => {
    // A hole in the list is left out; the lines after it keep their own numbers.
    if (!isLine(l)) return;
    if (l.state === 'waiting' && seen++ >= keep) return;
    rows.push({ l, n: i + 1 });
  });
  return (
    <ol className="sb-test-lines" aria-label="Each line">
      {rows.map(({ l, n }) => <LineRow key={l.id || n} slug={slug} line={l} n={n} video={playable(l.video) ? l.video : null} />)}
      {waiting > keep && <li className="muted sb-test-more">{waiting - keep} more waiting</li>}
    </ol>
  );
}

function LineRow({ slug, line, n, video }: { slug: string; line: Line; n: number; /** The video it can play here, else null. */ video: string | null }) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const videoId = useId();
  const state = LINE_WORDS[line.state] ?? 'Waiting';
  return (
    <li className={`sb-test-line is-${line.state}`}>
      <span className="muted num sb-test-line-n">{n}</span>
      <span className={`chip sb-test-line-state is-${line.state}`}>{state}</span>
      <span className="sb-test-line-title">{line.title}</span>
      {video && (
        <button type="button" className="link-button sb-test-play" aria-expanded={open} aria-controls={videoId} onClick={() => setOpen(!open)} title={`Watch the recording of line ${n}.`}>
          {open ? 'Hide video' : narrow ? 'Video' : 'Play video'}
        </button>
      )}
      {open && video && (
        <video className="sb-test-video" id={videoId} src={fileUrl(slug, video)} controls autoPlay muted aria-label={`The recording of line ${n}: ${line.title}`} />
      )}
    </li>
  );
}

/** The last recording that couldn't finish: what went wrong, and Record again on the laptop. */
function Problem({ slug, problem, hosted, onRecorded }: { slug: string; problem: NonNullable<EvidenceView['problem']>; hosted: boolean; onRecorded?(): void }) {
  const { api } = useWorkshop();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null);
  async function record() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api.post<EvidenceRecordResult>(`/api/job/${encodeURIComponent(slug)}/evidence/record`, {});
      if (r?.started) setNote({ bad: false, text: 'Recording now. The rows fill in when it is done.' });
      onRecorded?.();
    } catch (err) {
      setNote({ bad: true, text: err instanceof ApiError ? err.message : `Couldn’t record: ${errorWords(err)}` });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sb-test-problem">
      <p className="perm-warn sb-test-problem-text">
        {problem.message}
        {problem.fix && <> <code>{problem.fix}</code></>}
      </p>
      {hosted
        ? <p className="muted sb-test-note">Evidence is recorded on your laptop. Open the job there to record again.</p>
        : (
          <div className="sb-test-action">
            <Button kind="secondary" size="sm" icon="refresh" busy={busy} busyLabel="Recording…" onClick={() => void record()} title="Record the evidence again for the commit the test report names now.">
              Record again
            </Button>
          </div>
        )}
      {note && <p className={note.bad ? 'thread-error' : 'muted sb-test-note'} role={note.bad ? 'alert' : 'status'}>{note.text}</p>}
    </div>
  );
}

function HandRow({ slug, job, detail, view, now, hosted, tryOpen, onTryOpen }: {
  slug: string; job: Job; detail: JobDetail | null; view: StageView | null; now: Date; hosted: boolean; tryOpen: boolean; onTryOpen(open: boolean): void;
}) {
  const checkId = useId();
  const at = statesOf(job).test;
  const before = at === 'next';
  const past = at === 'done' || at === 'skipped';
  // handTest missing (or null): not known. Its startedAt null: known, never started.
  const hand = view?.handTest ?? null;
  const startedAgo = hand ? agoWords(hand.startedAt, now) : null;
  const started = startedAgo !== null;
  // Auto on and not stopped decides the step, unless he wrote to it (then it is his).
  const auto = job.auto;
  const autoDecides = auto?.on === true && !auto.stopped && auto.yours !== true;

  let state = 'Not started';
  let tone: Tone = '';
  let when: string | null;
  if (started) { state = 'Started'; tone = 'ok'; when = `Started ${startedAgo}`; } else if (past && hand) {
    state = autoDecides ? 'Skipped' : 'Skipped by you';
    when = 'You went ahead without it';
  } else when = before ? 'When you like' : past ? null : 'Not yet';
  if (autoDecides) when = AUTO_SKIPS_HAND_TEST;

  const open = tryOpen && !hosted && !autoDecides;
  return (
    <Kind name="Your hand test" by="by you" state={state} tone={tone} where="Try it on your computer" when={when}>
      {!autoDecides && (hosted
        ? <p className="muted sb-test-note">Try it runs on your laptop. Open the job there to use it.</p>
        : (
          <div className="sb-test-action">
            <Button kind={open ? 'quiet' : 'secondary'} size="sm" icon="terminal" aria-expanded={open} onClick={() => onTryOpen(!open)}>
              {open ? 'Close Try it' : 'Open Try it'}
            </Button>
            <span className="muted sb-test-note">Run the branch on your computer, with what to check beside it.</span>
          </div>
        ))}
      {open && (
        <div className="sb-test-try">
          <section className="sb-test-try-app" aria-label="Try it"><TryTab slug={slug} active /></section>
          <section className="sb-test-check" aria-labelledby={checkId}>
            <h4 id={checkId}>What to check</h4>
            <WhatToCheck check={detail?.page?.check} />
          </section>
        </div>
      )}
    </Kind>
  );
}
