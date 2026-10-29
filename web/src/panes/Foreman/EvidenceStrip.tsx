// The evidence strip (packet L): on the gate card at the test gate and every later one, one row per
// acceptance line of the job's evidence (dashboard/lib/evidence.js, GET /api/job/:slug/evidence):
// its id and title, the result in words with an icon, the first picture small (it opens the rest,
// each with the words the spec gave it) and "Play video". "Copy link" copies the evidence folder's
// address for the ticket. Evidence for an older commit than the one the checks ran on says so.
// Record (again) asks the dashboard to record for the commit the test report names now.
//
// Everything here is a button or a link, so it is reached with Tab; it has no keys of its own.
import { useEffect, useId, useState } from 'react';
import { ApiError } from '../../api/client';
import type { EvidenceCriterion, EvidenceRecordResult, EvidenceView } from '../../api/types';
import { useWorkshop } from '../../state/store';

/** The gates that show the strip: the test gate and every one after it. */
export const EVIDENCE_STAGES = ['test', 'review', 'pr1', 'pr2', 'staging-qa', 'pr3'];

const short = (sha: string | null | undefined) => String(sha ?? '').slice(0, 7);
const sameCommit = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && (a.startsWith(b) || b.startsWith(a)));
const fileUrl = (slug: string, file: string) => `/api/job/${encodeURIComponent(slug)}/evidence/file?path=${encodeURIComponent(file)}`;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** While a recording is under way, look again this often (ms). */
const POLL_MS = 3000;

/** A line's result in words, with its icon (the icon is never the only sign). */
export function resultOf(c: Pick<EvidenceCriterion, 'status' | 'spec'>): { icon: string; word: string } {
  if (c.status === 'passed') return { icon: '✓', word: 'Passed' };
  if (c.status === 'failed') return { icon: '✗', word: 'Failed' };
  if (!c.spec) return { icon: '–', word: 'Not recorded: nothing to see' };
  return { icon: '–', word: 'Skipped' };
}

/** The reason worth showing under a row: why it failed, why there is nothing to see, why it skipped. */
function reasonOf(c: EvidenceCriterion): string | null {
  if (!c.reason) return null;
  if (c.status === 'skipped' && !c.spec) return c.reason.replace(/^Nothing to see:?\s*/, '').replace(/^\.$/, '') || null;
  return c.reason;
}

function Row({ slug, c }: { slug: string; c: EvidenceCriterion }) {
  const uid = useId();
  const [shotsOpen, setShotsOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const { icon, word } = resultOf(c);
  const reason = reasonOf(c);
  const first = c.screenshots[0] ?? null;
  const many = c.screenshots.length;
  return (
    <li className="evidence-row" data-status={c.status}>
      <p className="evidence-line">
        <span className="evidence-id num">{c.id}</span>{' '}
        <span className="evidence-title">{c.title}</span>{' '}
        <span className={`chip evidence-result is-${c.status}`}><span aria-hidden="true">{icon} </span>{word}</span>
      </p>
      {reason && <p className="muted evidence-reason">{reason}</p>}
      {(first || c.video) && (
        <div className="evidence-media">
          {first && (
            <button
              type="button" className="evidence-thumb" aria-expanded={shotsOpen} aria-controls={`${uid}-shots`}
              onClick={() => setShotsOpen(!shotsOpen)}
              title={shotsOpen ? 'Fold the pictures away.' : `Open ${many === 1 ? 'the picture' : `all ${many} pictures`} of ${c.id}.`}
            >
              <img src={fileUrl(slug, first.file)} alt={first.description} width={160} height={100} loading="lazy" />
              <span className="evidence-thumb-label">{shotsOpen ? 'Fold the pictures' : many === 1 ? 'Open the picture' : `Open all ${many} pictures`}</span>
            </button>
          )}
          {c.video && (
            <button type="button" className="link-button evidence-play" aria-expanded={videoOpen} aria-controls={`${uid}-video`} onClick={() => setVideoOpen(!videoOpen)} title={`Watch the recording of ${c.id} in the card.`}>
              {videoOpen ? 'Hide video' : 'Play video'}
            </button>
          )}
        </div>
      )}
      {shotsOpen && (
        <ol className="evidence-shots" id={`${uid}-shots`} aria-label={`Pictures of ${c.id}`}>
          {c.screenshots.map((s, i) => (
            <li key={s.file}>
              <figure className="evidence-shot">
                <a href={fileUrl(slug, s.file)} target="_blank" rel="noreferrer" title="Open this picture at full size in a new tab.">
                  <img src={fileUrl(slug, s.file)} alt={s.description} width={640} height={400} loading="lazy" />
                </a>
                <figcaption>{i + 1}. {s.description}</figcaption>
              </figure>
            </li>
          ))}
        </ol>
      )}
      {videoOpen && c.video && (
        <video className="evidence-video" id={`${uid}-video`} src={fileUrl(slug, c.video)} controls autoPlay muted width={640} aria-label={`The recording of ${c.id}: ${c.title}`}>
          <a href={fileUrl(slug, c.video)}>Open the video</a>
        </video>
      )}
    </li>
  );
}

/**
 * The strip. tested: the commit the checks ran on (the gate's proof stamp), else the one the test
 * report names; refresh: anything that changes when the job is fetched again (it reads again then).
 */
export function EvidenceStrip({ slug, tested = null, refresh = null }: { slug: string; tested?: string | null; refresh?: unknown }) {
  const { api } = useWorkshop();
  const headId = useId();
  const [view, setView] = useState<EvidenceView | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'problem'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(api.get<EvidenceView>(`/api/job/${encodeURIComponent(slug)}/evidence`)).then(
      (v) => { if (!cancelled) setView(v && typeof v === 'object' ? v : null); },
      // The strip is extra to the card: when it can't be read, the card shows without it (or with the last one read).
      () => {},
    );
    return () => { cancelled = true; };
  }, [api, slug, refresh, tick]);

  // While it records, look again now and then until it is done.
  useEffect(() => {
    if (!view?.recording) return;
    const t = setTimeout(() => setTick((n) => n + 1), POLL_MS);
    return () => clearTimeout(t);
  }, [view]);

  if (!view) return null;
  const ev = view.evidence;
  if (!ev && !view.wanted) return null;

  const against = tested ?? view.commit;
  const earlier = Boolean(ev && against && !sameCommit(ev.commit, against));
  const canRecord = view.wanted && !view.recording && (!ev || earlier || Boolean(view.problem));

  async function copyLink() {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(view.folderUrl);
      setNote({ tone: 'ok', text: 'Link copied. Paste it on the ticket.' });
    } catch {
      setNote({ tone: 'problem', text: `Couldn’t copy. The evidence folder is ${view.folder}` });
    }
  }

  async function record() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.post<EvidenceRecordResult>(`/api/job/${encodeURIComponent(slug)}/evidence/record`, {});
      if (r && typeof r === 'object') setView(r);
      setNote({ tone: 'ok', text: r?.started ? 'Recording now. The rows fill in when it is done.' : 'Recorded.' });
    } catch (err) {
      setNote({ tone: 'problem', text: err instanceof ApiError ? err.message : `Couldn’t record: ${message(err)}` });
      setTick((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  const counts = ev ? (['passed', 'failed', 'skipped'] as const).map((s) => [s, ev.criteria.filter((c) => c.status === s).length] as const) : [];
  const summary = counts.filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s === 'passed' ? 'passed' : s === 'failed' ? 'failed' : 'not recorded'}`).join(', ');

  return (
    <section className="gate-evidence" aria-labelledby={headId} aria-busy={view.recording || busy}>
      <h4 className="gate-evidence-head" id={headId}>
        Evidence{ev ? <> at <code className="num">{short(ev.commit)}</code></> : ''}
        {summary && <span className="muted gate-evidence-count"> · {summary}</span>}
      </h4>
      {earlier && ev && (
        <p className="perm-warn gate-evidence-earlier" title={`These pictures were recorded at ${short(ev.commit)}; the checks ran on ${short(against)}.`}>
          <span aria-hidden="true">⚠ </span>From an earlier commit ({short(ev.commit)})
        </p>
      )}
      {view.recording && <p className="muted gate-evidence-recording" role="status">Recording the evidence now: the app runs on its own port and each acceptance line is played in a browser. This takes a minute or two.</p>}
      {!view.recording && view.problem && (
        <p className="perm-warn gate-evidence-problem" role="status">
          {view.problem.message}
          {view.problem.fix && <> <code>{view.problem.fix}</code></>}
        </p>
      )}
      {!ev && !view.recording && !view.problem && (
        <p className="muted gate-evidence-none">Not recorded yet. The dashboard records it once the tester’s report names the commit it tested.</p>
      )}
      {ev && ev.criteria.length > 0 && (
        <ul className="evidence-list" aria-label="Each acceptance line">
          {ev.criteria.map((c) => <Row key={c.id} slug={slug} c={c} />)}
        </ul>
      )}
      <p className="gate-evidence-actions">
        {ev && (
          <button type="button" className="link-button" onClick={copyLink} title="Copy the evidence folder’s address, to paste on the ticket.">Copy link</button>
        )}
        {canRecord && (
          <button type="button" className="link-button" disabled={busy} onClick={record} title="Record the evidence for the commit the test report names now: starts this job’s app, plays each acceptance line in a browser and keeps the pictures and video.">
            {ev || view.problem ? 'Record again' : 'Record'}
          </button>
        )}
      </p>
      {note && <p className={note.tone === 'ok' ? 'muted gate-evidence-note' : 'perm-warn gate-evidence-note'} role="status">{note.text}</p>}
    </section>
  );
}
