// What the Test step made, in the reader (job page rebuild, Task 14; design brief "Recording and checks",
// R7). One view for the step's three outputs, by id:
//   checks     the Tester's counts as one short line, which commit they ran on, the test report;
//   recording  the picked check's video or pictures large, every check one row beside them (failed
//              first, nothing-to-see folded), `Record again`, which commit it was recorded on;
//   hand-test  Your hand test: `Start the app` (Try it, in place), `Open it` (the app, once Try it says
//              it runs), the list to check, `It works` and `Something is wrong…`.
// A commit older than the final one is said plainly: "That is 3 commits before the final one, dbd2cbb4."
// The final commit is the branch's newest (reader/branch.ts, laptop only); on the website, where commits
// stay on the laptop, the recording is compared with the commit the test report names.
//
// The counts and the list to check come from the `checks` body; the recording from today's evidence
// route (GET /api/job/:slug/evidence), held per open job so coming back paints at once, and read again
// on open. On the website Record again, Start the app and Open it are not drawn (plan decision 8;
// today's page hides them there too) and a video plays only once the laptop has put it on the site.
// `It works` and `Something is wrong…` send fixed words that come with Task 22: until then they are
// off and their titles say what they will do.

import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import type { EvidenceCriterion, EvidenceView, LiveEvent } from '../../api/types';
import { BRAND } from '../../app/brand';
import { Button } from '../../components/Button';
import { canPlay } from '../../panes/Foreman/EvidenceStrip';
import { TryTab } from '../../panes/Preview/TryTab';
import { onLiveEvent } from '../../state/live';
import { useWorkshop } from '../../state/store';
import { AUTO_SKIPS_HAND_TEST } from '../../views/JobDrawer/OptionsEditor';
import type { JobStore } from '../jobStore';
import { sinceWords } from '../left/YourMove';
import type { ReaderTarget } from '../types';
import { useJob, useJobStore } from '../useJob';
import { loadCommits, useBranch, type BranchCommit } from './branch';
import { NotLoaded, ReaderBody, useBody } from './ReaderBody';

export interface ChecksViewProps {
  id: string;
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
  /** The app's event stream (state/live.ts onLiveEvent when left out): Try it's changes (local-state). */
  events?: (fn: (e: LiveEvent) => void) => () => void;
}

interface Counts { passed: number; failed: number; notRun: number; at: string | null }
interface Check { version: string | null; worksWhen: string[]; mustNot: string[] }

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const fileUrl = (slug: string, file: string) => `/api/job/${encodeURIComponent(slug)}/evidence/file?path=${encodeURIComponent(file)}`;
const sameCommit = (a: string, b: string) => a.length > 0 && b.length > 0 && (a.startsWith(b) || b.startsWith(a));
const shortSha = (s: string) => s.slice(0, 8);
const errorWords = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : String(err));

/**
 * Which commit something was made on, in plain words. `final`: the branch's newest commit (laptop);
 * `later`: on the website, the commit the test report names (null when not known).
 */
export function commitWords(verb: string, made: string | null, commits: BranchCommit[] | null, later: string | null = null, when: string | null = null): string | null {
  if (!made) return null;
  const at = `${verb} on ${shortSha(made)}`;
  const final = commits?.[0] ?? null;
  if (final) {
    if (sameCommit(final.sha, made) || sameCommit(final.short, made)) return `${at}, the final commit${when ? `, ${when}` : ''}.`;
    const i = commits!.findIndex((c) => sameCommit(c.sha, made) || sameCommit(c.short, made));
    const before = i > 0 ? `That is ${i} ${i === 1 ? 'commit' : 'commits'} before the final one, ${final.short}.` : `That is an older commit than the final one, ${final.short}.`;
    return `${at}${when ? `, ${when}` : ''}. ${before}`;
  }
  if (later && !sameCommit(later, made)) return `${at}${when ? `, ${when}` : ''}. The checks ran on a later commit, ${shortSha(later)}.`;
  return `${at}${when ? `, ${when}` : ''}.`;
}

// ---------- The evidence view, held per open job ----------

interface HeldEvidence { view: EvidenceView | null; error: string | null; listeners: Set<() => void>; ask: Promise<void> | null }
const evidenceHeld = new WeakMap<JobStore, HeldEvidence>();
function heldOf(store: JobStore): HeldEvidence {
  let h = evidenceHeld.get(store);
  if (!h) { h = { view: null, error: null, listeners: new Set(), ask: null }; evidenceHeld.set(store, h); }
  return h;
}

function useEvidence(store: JobStore, slug: string, on: boolean) {
  const { api } = useWorkshop();
  const h = heldOf(store);
  const [, redraw] = useState(0);
  useEffect(() => {
    const l = () => redraw((n) => n + 1);
    h.listeners.add(l);
    return () => { h.listeners.delete(l); };
  }, [h]);
  const load = () => {
    if (h.ask) return h.ask;
    h.ask = (async () => {
      try {
        const v = await api.get<EvidenceView>(`/api/job/${encodeURIComponent(slug)}/evidence`);
        h.view = v && typeof v === 'object' ? v : null;
        h.error = null;
      } catch (err) {
        h.error = errorWords(err);
      } finally {
        h.ask = null;
        for (const l of [...h.listeners]) l();
      }
    })();
    return h.ask;
  };
  useEffect(() => { if (on) void load(); }, [on, slug]);
  return { view: h.view, error: h.error, load };
}

// ---------- The view ----------

export function ChecksView({ id, onOpen, events = onLiveEvent }: ChecksViewProps) {
  const store = useJobStore();
  const { api } = useWorkshop();
  const slug = useJob((s) => s.slug);
  const hosted = useJob((s) => Boolean(s.payload?.hosted)) || Boolean(api.hosted?.());
  const branch = useBranch(store);
  // The final commit (laptop only): the branch's newest.
  useEffect(() => { if (!hosted) void loadCommits(store, api, slug); }, [store, api, slug, hosted]);
  const evidence = useEvidence(store, slug, id !== 'hand-test');
  const commits = hosted ? null : branch.commits;
  const place = `checks:${id}`;
  if (id === 'recording') return <ReaderBody view="checks" place={place}><Recording slug={slug} hosted={hosted} ev={evidence} commits={commits} /></ReaderBody>;
  return <BodyPart id={id} place={place} slug={slug} hosted={hosted} ev={evidence} commits={commits} onOpen={onOpen} events={events} />;
}

function BodyPart({ id, place, slug, hosted, ev, commits, onOpen, events }: { id: string; place: string; slug: string; hosted: boolean; ev: ReturnType<typeof useEvidence>; commits: BranchCommit[] | null; onOpen: ChecksViewProps['onOpen']; events: NonNullable<ChecksViewProps['events']> }) {
  const { body, error } = useBody('checks');
  if (!body) return <ReaderBody view="checks" place={place} ready={false}><NotLoaded error={error} /></ReaderBody>;
  const meta = body.meta ?? {};
  const c = meta.counts as Partial<Counts> | null | undefined;
  const counts: Counts | null = c && typeof c === 'object' ? { passed: Number(c.passed) || 0, failed: Number(c.failed) || 0, notRun: Number(c.notRun) || 0, at: typeof c.at === 'string' ? c.at : null } : null;
  const k = (meta.check ?? {}) as Partial<Check>;
  const check: Check = { version: typeof k.version === 'string' ? k.version : null, worksWhen: strings(k.worksWhen), mustNot: strings(k.mustNot) };
  return (
    <ReaderBody view="checks" place={place}>
      {id === 'hand-test'
        ? <HandTest slug={slug} hosted={hosted} check={check} commits={commits} events={events} />
        : <Checks counts={counts} made={ev.view?.commit ?? null} commits={commits} onOpen={onOpen} />}
    </ReaderBody>
  );
}

function Checks({ counts, made, commits, onOpen }: { counts: Counts | null; made: string | null; commits: BranchCommit[] | null; onOpen: ChecksViewProps['onOpen'] }) {
  const report = useJob((s) => s.payload?.steps.find((x) => x.id === 'test')?.outputs.some((o) => o.kind === 'doc' && o.id === 'test-report.md') ?? false);
  if (!counts) return <p className="jp2-notyet">No test report yet. The Tester writes it after the build.</p>;
  const ran = commitWords('Run', made, commits);
  return (
    <div className="jp2-prose">
      <p className="jp2-ck-big"><strong>{counts.passed} passed</strong> · {counts.failed} failed · {counts.notRun} not run</p>
      {ran && <p>{ran}</p>}
      {counts.at && <p className="jp2-dim">The report was written {sinceWords(counts.at)}.</p>}
      {report && <p><button type="button" className="link-button" onClick={(e) => onOpen({ kind: 'doc', id: 'test-report.md' }, e.currentTarget)}>Open the test report</button></p>}
    </div>
  );
}

const STATE_WORDS: Record<string, string> = { passed: 'Passed', failed: 'Failed', skipped: 'Nothing to see' };

function Recording({ slug, hosted, ev, commits }: { slug: string; hosted: boolean; ev: ReturnType<typeof useEvidence>; commits: BranchCommit[] | null }) {
  const { api } = useWorkshop();
  const [pick, setPick] = useState<string | null>(null);
  const [quietOpen, setQuietOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null);
  const view = ev.view;
  if (!view) return ev.error ? <p className="jp2-dim" role="alert">Couldn’t read the recording: {ev.error}</p> : null;
  const record = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api.post<{ started?: boolean }>(`/api/job/${encodeURIComponent(slug)}/evidence/record`, {});
      setNote({ bad: false, text: r?.started ? 'Recording now. The checks fill in when it is done.' : 'Recording now.' });
    } catch (err) {
      setNote({ bad: true, text: `Couldn’t record: ${errorWords(err)}` });
    } finally {
      setBusy(false);
      void ev.load();
    }
  };
  const evd = view.evidence;
  const criteria: EvidenceCriterion[] = Array.isArray(evd?.criteria) ? evd!.criteria.filter((c) => c && typeof c.id === 'string') : [];
  const failed = criteria.filter((c) => c.status === 'failed');
  const passed = criteria.filter((c) => c.status === 'passed');
  const quiet = criteria.filter((c) => c.status !== 'failed' && c.status !== 'passed');
  const shown = criteria.find((c) => c.id === pick) ?? failed[0] ?? passed[0] ?? quiet[0] ?? null;
  // No check has a picture or a video (a recording of checks with nothing to see): the list alone, no empty frame.
  const visual = criteria.some((c) => Boolean(c.video) || (Array.isArray(c.screenshots) && c.screenshots.length > 0));
  const made = evd ? commitWords('Recorded', evd.commit, commits, view.commit, sinceWords(evd.at)) : null;
  const again = hosted
    ? <p className="jp2-dim jp2-rec-laptop">Evidence is recorded on your laptop. Open the job there to record again.</p>
    : <Button size="sm" icon="refresh" busy={busy} busyLabel="Recording…" disabled={view.recording} onClick={() => void record()} title="Record the browser checks again, on the commit the test report names now.">Record again</Button>;
  const row = (c: EvidenceCriterion) => (
    <button key={c.id} type="button" className={`jp2-rec-r is-${c.status}`} aria-current={visual && c.id === shown?.id ? 'true' : undefined} onClick={() => setPick(c.id)}>
      <span className="jp2-rec-w">{STATE_WORDS[c.status] ?? c.status}</span>
      <span className="jp2-rec-id">{c.id}</span>
      <span className="jp2-rec-t">{c.title}</span>
    </button>
  );
  return (
    <div className="jp2-rec">
      <div className="jp2-rec-head">
        <div className="jp2-rec-said">
          {view.recording && <p>{progressWords(view)}</p>}
          {!view.recording && view.problem && <p className="jp2-rec-problem">{view.problem.message}{view.problem.fix && <> <code>{view.problem.fix}</code></>}</p>}
          {made && <p>{made}</p>}
          {!evd && !view.recording && !view.problem && <p>{view.wanted ? `Not recorded yet. ${BRAND.name} records it once the test report names the commit it tested.` : view.why || 'This job records no evidence.'}</p>}
          {note && <p className={note.bad ? 'jp2-rec-problem' : 'jp2-dim'} role={note.bad ? 'alert' : 'status'}>{note.text}</p>}
        </div>
        {(evd || view.problem || view.wanted) && again}
      </div>
      {criteria.length > 0 && (
        <div className={`jp2-rec-grid${visual ? '' : ' is-list'}`}>
          {visual && <div className="jp2-rec-player">{shown && <Player slug={slug} c={shown} hosted={hosted} onSite={view.onSite} />}</div>}
          <div className="jp2-rec-list" aria-label="Each check">
            {failed.length > 0 && <><div className="jp2-rec-g">{`Failed · ${failed.length}`}</div>{failed.map(row)}</>}
            {passed.length > 0 && <><div className="jp2-rec-g">{`Passed · ${passed.length}`}</div>{passed.map(row)}</>}
            {quiet.length > 0 && (
              <>
                <div className="jp2-rec-g"><button type="button" className="jp2-fd-fold" aria-expanded={quietOpen} onClick={() => setQuietOpen((o) => !o)}>{`Nothing to see · ${quiet.length}`}</button></div>
                {quietOpen && quiet.map(row)}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function progressWords(view: EvidenceView): string {
  const p = view.progress;
  if (p && Number(p.line) >= 1) return `Recording now: line ${p.line} of ${p.of || p.lines?.length || '?'}.`;
  return 'Recording now.';
}

/** The picked check, large: its video where it can play, else its pictures, else why there is none. */
function Player({ slug, c, hosted, onSite }: { slug: string; c: EvidenceCriterion; hosted: boolean; onSite: unknown }) {
  const shots = Array.isArray(c.screenshots) ? c.screenshots.filter((s) => s && typeof s.file === 'string') : [];
  const video = c.video && canPlay(c.video, { hosted, onSite }) ? c.video : null;
  const state = c.status === 'failed' ? `Failed: ${c.reason ?? 'no reason given.'}` : c.status === 'passed' ? 'Passed' : c.reason ?? 'Nothing to see.';
  return (
    <>
      {video
        ? <video key={video} className="jp2-rec-frame" src={fileUrl(slug, video)} controls muted aria-label={`The recording of ${c.id}: ${c.title}`} />
        : shots.length
          ? <img key={shots[0].file} className="jp2-rec-frame" src={fileUrl(slug, shots[0].file)} alt={shots[0].description} />
          : <div className="jp2-rec-frame jp2-rec-none">No recording for this check.</div>}
      <div className="jp2-rec-under">
        <b className="jp2-rec-id">{c.id}</b> {c.title}
        <div className="jp2-rec-state">{state}</div>
        {shots.length > (video ? 0 : 1) && (
          <ul>{shots.slice(video ? 0 : 1).map((s) => <li key={s.file}><a href={fileUrl(slug, s.file)} target="_blank" rel="noreferrer">{s.description || 'A picture'}</a></li>)}</ul>
        )}
      </div>
    </>
  );
}

// ---------- Your hand test (R7) ----------

function HandTest({ slug, hosted, check, commits, events }: { slug: string; hosted: boolean; check: Check; commits: BranchCommit[] | null; events: NonNullable<ChecksViewProps['events']> }) {
  const { api } = useWorkshop();
  const auto = useJob((s) => s.payload?.auto ?? null);
  const autoDecides = auto?.on === true && !auto.stopped && auto.yours !== true;
  const [tryOpen, setTryOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  // Try it's app: its address once it runs (laptop only); read on open and when Try it changes.
  useEffect(() => {
    if (hosted) return undefined;
    let off = false;
    const read = () => {
      api.get<{ server?: { status?: string } | null; url?: string | null }>(`/api/job/${encodeURIComponent(slug)}/local`).then(
        (v) => { if (!off) setUrl(v?.server?.status === 'running' && typeof v.url === 'string' && v.url ? v.url : null); },
        () => { /* Open it stays off */ },
      );
    };
    read();
    const stop = events((e) => { if (e?.type === 'local-state' && e.job === slug) read(); });
    return () => { off = true; stop(); };
  }, [api, slug, hosted, events]);
  const final = commits?.[0] ?? null;
  return (
    <div className="jp2-prose jp2-hand">
      {final && <p>On the final commit, {final.short}.</p>}
      {autoDecides && <p className="jp2-dim">{AUTO_SKIPS_HAND_TEST}</p>}
      {hosted
        ? <p className="jp2-dim">Try it runs on your laptop. Open the job there to start the app.</p>
        : (
          <div className="jp2-hand-acts">
            <Button size="sm" icon="terminal" aria-expanded={tryOpen} onClick={() => setTryOpen((o) => !o)} title="Open Try it here: it sets up and starts this job’s app on your computer.">Start the app</Button>
            {url
              ? <Button kind="quiet" size="sm" href={url} target="_blank" rel="noopener noreferrer" title={`Open the app at ${url} in a new tab.`}>Open it</Button>
              : <Button kind="quiet" size="sm" disabled title="Opens the app in your browser once Try it has started it.">Open it</Button>}
          </div>
        )}
      {tryOpen && !hosted && <div className="jp2-hand-try"><TryTab slug={slug} active /></div>}
      <h4>What to check{check.version ? ` · v${check.version}` : ''}</h4>
      {check.worksWhen.length === 0 && check.mustNot.length === 0 && <p className="jp2-dim">Not written yet. The Foreman writes this list with the plan.</p>}
      {check.worksWhen.length > 0 && <><p><strong>It works when</strong></p><ol>{check.worksWhen.map((w, i) => <li key={i}>{w}</li>)}</ol></>}
      {check.mustNot.length > 0 && <><p><strong>It must not</strong></p><ul>{check.mustNot.map((w, i) => <li key={i}>{w}</li>)}</ul></>}
      <div className="jp2-hand-acts">
        <Button kind="primary" size="sm" disabled title="Tells the Foreman it works: you tested it by hand. Comes in a later build of the new page.">It works</Button>
        <Button size="sm" disabled title="Opens a note to say what is wrong, with a pasted screenshot, for the Foreman. Comes in a later build of the new page.">Something is wrong…</Button>
      </div>
    </div>
  );
}
