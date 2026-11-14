// The PR lines (job page rebuild, Task 20; design brief R2; dashboard/lib/pr-lines.js): PR #1, PR #2 and
// PR #3, each one line with its state as GitHub last told Starbase and at most ONE button, the line's next
// action. The first click opens the line in place with what will go (the commits, from which branch to
// which, the title); the second (`Push and open`, `Push`, …) is his yes: the server sends that action's
// fixed sentence to the Foreman only while the line still says the same (`check`), and the line says it
// went. A refusal says why in place and gives the button back.
//
// Shown in the Ship step while it is open (left/Steps.tsx), in the reader's Ship view, and one line in a
// PR's own view (Task 21 puts its comments there). Under the lines: when GitHub was read, `Pull now`, or
// why it could not be read. GitHub is read when the page opens if the last read is old (usePrOpeningRead:
// one GET …/pr/1?read=old; the server decides) and on Pull now: never on a timer. The website shows the
// lines without buttons and without the read line.
//
// The asks row (left/AsksRow.tsx) carries the PR's next action first while the Ship step is not the open
// step (usePrLead; plan "Open with the owner"); its click opens the reader's Ship with that line open.

import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../../api/client';
import { BRAND } from '../../app/brand';
import { Button } from '../../components/Button';
import { WorkshopContext } from '../../state/store';
import type { Ask } from '../asks';
import type { GithubRead, PrLine, PrNext, ReaderTarget, StopId } from '../types';
import { JobStoreContext, useJob, useJobStore } from '../useJob';
import { roundDrafts } from '../reader/prComments';
import './prlines.css';

/** The reader's Ship view says how the lines come to be. */
export const READ_NOTE = `${BRAND.name} reads GitHub itself: a PR merged, reviewed or opened by hand shows here, and the Foreman is told.`;
const SENT_WORDS: Record<PrNext['id'], string> = {
  'push-open': 'Sent · the Foreman pushes to your fork and opens PR #1',
  'open-pr1': 'Sent · the Foreman opens PR #1',
  'push-update': 'Sent · the Foreman pushes to your fork; PR #1 updates',
  'push-fixes': 'Sent · the Foreman pushes the fixes to your fork; PR #1 updates',
  'open-pr2': 'Sent · the Foreman opens PR #2',
  'request-review': 'Sent · the Foreman asks Raj to review PR #2',
};
const UNREACHABLE = `Not sent: ${BRAND.name} didn’t answer. Try again.`;
/** Push the fixes while a review round is ready: Starbase sends the round back itself. */
const SENT_BACK = `Sending back · ${BRAND.name} pushes, posts the replies and asks for a review again`;
export const SHIP: ReaderTarget = { kind: 'ship', id: 'ship' };

/** `2:02 pm` today, `Tue 2:02 pm` on another day. */
export function clockWords(at: string | null | undefined, now: Date = new Date()): string {
  const d = new Date(at ?? '');
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
}

// ---------- One line asked open from elsewhere (the asks row's lead) ----------

let asked: { slug: string; n: number } | null = null;
const askedHeard = new Set<() => void>();
/** The asks row's lead: open this PR's line (where it is shown next) with what will go. */
export function openPrLine(slug: string, n: number) {
  asked = { slug, n };
  for (const l of [...askedHeard]) l();
}
const takeAsked = (slug: string, n: number) => {
  if (asked?.slug !== slug || asked.n !== n) return false;
  asked = null;
  return true;
};

// ---------- The lines ----------

export interface PrLinesProps {
  /** Only this PR (a PR's own reader view). */
  only?: 1 | 2 | 3;
  /** The reader's Ship view: the note on how the lines come to be. */
  note?: boolean;
  /** Task 21, the PR view: the line without this action's button (it is in the view's bar instead). */
  skip?: PrNext['id'];
  /** Task 21, the PR view's bar: only this action (its button, what will go, the yes), no line and no read line. */
  action?: PrNext['id'];
}

export const PrLines = memo(function PrLines({ only, note = false, skip, action }: PrLinesProps) {
  const slug = useJob((s) => s.slug);
  const prs = useJob((s) => s.payload?.prs ?? null);
  const github = useJob((s) => s.payload?.github ?? null);
  const hosted = useJob((s) => s.payload?.hosted === true);
  if (!prs) return null;
  const lines = prs.filter((l) => !only || l.n === only);
  if (action) {
    const l = lines.find((x) => x.next?.id === action);
    return l && !hosted ? <div className="jp2-prl jp2-prl-bar"><Line slug={slug} line={l} hosted={hosted} bare /></div> : null;
  }
  return (
    <div className="jp2-prl">
      {lines.map((l) => <Line key={l.n} slug={slug} line={l} hosted={hosted} skip={skip} />)}
      {!hosted && github && <ReadLine slug={slug} github={github} />}
      {note && <p className="jp2-prl-note">{READ_NOTE}</p>}
    </div>
  );
});

type Sending = null | { check: string; words: string };

function Line({ slug, line, hosted, skip, bare = false }: { slug: string; line: PrLine; hosted: boolean; skip?: PrNext['id']; bare?: boolean }) {
  // No app around it (a part drawn on its own): the lines show, with no button.
  const api = useContext(WorkshopContext)?.api ?? null;
  const store = useContext(JobStoreContext);
  const next = hosted || !api || (skip && line.next?.id === skip) ? null : line.next;
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<Sending>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [terminal, setTerminal] = useState(false);
  // The focus goes to what will go, never to the yes: a held Enter on the line's button must not confirm.
  const panelRef = useRef<HTMLDivElement>(null);
  // The asks row's lead asked for this line: open it here.
  const heard = useSyncExternalStore((l) => { askedHeard.add(l); return () => { askedHeard.delete(l); }; }, () => asked);
  useEffect(() => {
    if (next && takeAsked(slug, line.n)) { setOpen(true); setProblem(null); }
  }, [heard, next, slug, line.n]);
  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);
  // What was sent shows until the server's line moves on to something else.
  const showSent = sent && ((next && next.check === sent.check) || line.why === 'Sent to the Foreman') ? sent : null;
  const nextCheck = next?.check ?? null;
  useEffect(() => { if (sent && nextCheck && nextCheck !== sent.check) setSent(null); }, [sent, nextCheck]);

  const go = useCallback(async (confirmNoTerminal = false) => {
    if (!next) return;
    setOpen(false);
    setProblem(null);
    setTerminal(false);
    setSent({ check: next.check, words: next.round ? SENT_BACK : SENT_WORDS[next.id] ?? 'Sent to the Foreman' });
    try {
      // A review round's Push the fixes: his edits of its drafted replies (the PR view) go with it.
      const replies = next.round && store ? roundDrafts(store) : {};
      await api!.post(`/api/job/${encodeURIComponent(slug)}/pr/${line.n}/go`, { id: next.id, check: next.check, ...(confirmNoTerminal ? { confirmNoTerminal: true } : {}), ...(Object.keys(replies).length ? { replies } : {}) });
    } catch (err) {
      setSent(null);
      const code = err instanceof ApiError ? err.body.code : null;
      if (code === 'terminal-open') setTerminal(true);
      setProblem(err instanceof ApiError ? err.message : UNREACHABLE);
    }
  }, [api, slug, line.n, next, store]);

  const when = line.state === 'merged' && line.at ? ` ${clockWords(line.at)}` : '';
  const why = showSent ? null : line.why ?? null;
  return (
    <div className={`jp2-prl-line${open ? ' is-open' : ''}`}>
      <div className="jp2-prl-l">
        {!bare && <b className="jp2-prl-n">PR #{line.n}</b>}
        {!bare && <span className="jp2-prl-s">{line.word}{when}{why ? ` · ${why}` : ''}</span>}
        {next && !open && !showSent && (
          <Button size="sm" className="jp2-prl-b" onClick={() => { setOpen(true); setProblem(null); }} title={next.round ? `Shows the steps first. ${BRAND.name} then does them itself, on GitHub.` : `Shows what will go first. Sends the Foreman: “${next.sends}”`}>{next.label}</Button>
        )}
        {!next && !bare && line.url && <Button kind="quiet" size="sm" className="jp2-prl-b" href={line.url} target="_blank" rel="noreferrer">Open on GitHub</Button>}
      </div>
      {next && open && (
        <div ref={panelRef} tabIndex={-1} className="jp2-prl-x" role="group" aria-label={`What ${next.label} will do`}>
          <ul className="jp2-prl-says">{next.says.map((s, i) => <li key={i} className={/^[0-9a-f]{7} /.test(s) ? 'is-commit' : undefined}>{s}</li>)}</ul>
          <div className="jp2-prl-acts">
            <Button kind="primary" size="sm" onClick={() => { void go(); }} title={next.round ? `${BRAND.name} does these steps itself, on GitHub, now.` : `Sends the Foreman: “${next.sends}”`}>{next.go}</Button>
            <Button kind="quiet" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {showSent && <p className="jp2-prl-done" role="status">{showSent.words}</p>}
      {problem && (
        <div className="jp2-prl-problem" role="alert">
          <span>{problem}</span>
          {terminal && <Button size="sm" onClick={() => { void go(true); }}>None of them is the Foreman: send</Button>}
        </div>
      )}
    </div>
  );
}

/** When GitHub was read, Pull now; or why it could not be read. */
function ReadLine({ slug, github }: { slug: string; github: GithubRead }) {
  const api = useContext(WorkshopContext)?.api ?? null;
  const [asking, setAsking] = useState<string | null>(null);
  // Pull now shows Reading… until the payload says a newer read (or that one is going).
  const reading = github.reading || (asking !== null && asking === (github.triedAt ?? ''));
  const pull = async () => {
    setAsking(github.triedAt ?? '');
    try { await api!.post(`/api/job/${encodeURIComponent(slug)}/pr/1/pull`, {}); } catch { setAsking(null); }
  };
  return (
    <div className="jp2-prl-read">
      {github.problem
        ? <span className="jp2-prl-gh is-problem" role="alert">{github.problem}{github.at ? ` Last read ${clockWords(github.at)}.` : ''}</span>
        : <span className="jp2-prl-gh">{reading ? 'Reading GitHub…' : github.at ? readWords(github.at) : 'not read from GitHub yet'}</span>}
      {!reading && api && <Button kind="quiet" size="sm" onClick={() => { void pull(); }} title="Reads the pull requests from GitHub now.">Pull now</Button>}
    </div>
  );
}

/** `read just now` within a minute of the read (Pull now's answer), else `read from GitHub 2:04 pm`. Drawn when the line is; no timer. */
export function readWords(at: string, now: number = Date.now()): string {
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t < 60_000 && now >= t - 5_000 ? 'read just now' : `read from GitHub ${clockWords(at)}`;
}

/**
 * The phone's PR line on the job screen (Task 21; plan "Open with the owner"): each PR with comments, ending in
 * `Comments · 3 new` (or `Comments · 4` when none is new), which opens the PR view.
 */
export const PhonePrLines = memo(function PhonePrLines({ onOpen }: { onOpen(t: ReaderTarget, from?: HTMLElement | null): void }) {
  const lines = useJob((s) => s.payload?.prs ?? null);
  const shown = (lines ?? []).filter((l) => (l.comments?.total ?? 0) > 0);
  if (!shown.length) return null;
  return (
    <div className="jp2-prl-phone">
      {shown.map((l) => (
        <button key={l.n} type="button" className="jp2-prl-ph" onClick={(e) => onOpen({ kind: 'pr', id: String(l.n) }, e.currentTarget)}>
          <b className="jp2-prl-n">PR #{l.n}</b>
          <span className="jp2-prl-s">{l.word}</span>
          <span className="jp2-prl-c">Comments · {l.comments!.fresh > 0 ? `${l.comments!.fresh} new` : l.comments!.total}</span>
        </button>
      ))}
    </div>
  );
});

// ---------- The page's part ----------

/** The page opening a job: one read of GitHub when the last is old (the server decides; jobStore readGithubIfOld). Never on the website, never again on a timer. */
export function usePrOpeningRead() {
  const store = useJobStore();
  useEffect(() => { store.readGithubIfOld(); }, [store]);
}

/**
 * The asks row's first ask: the PR's next action, while the Ship step is not the open step (plan "Open
 * with the owner"). Its click opens the reader's Ship with that line open (two clicks still: what will
 * go first, then his yes).
 */
export function usePrLead(onOpen: (t: ReaderTarget) => void): { lead: Ask | null; onLead: (a: Ask) => void } {
  const slug = useJob((s) => s.slug);
  const shipOpen = useJob((s) => (s.ui.step ?? s.payload?.steps.find((x) => x.state === 'current')?.id ?? null) === ('ship' as StopId));
  const first = useJob((s) => (s.payload?.hosted ? null : s.payload?.prs.find((l) => l.next) ?? null));
  const lead = useMemo<Ask | null>(() => (!shipOpen && first?.next
    ? { id: `pr-${first.n}-${first.next.id}`, label: first.next.label, text: first.next.sends, steps: ['any'], inRow: true, needsWord: false, kind: 'send' }
    : null), [shipOpen, first]);
  const n = first?.n ?? null;
  const onLead = useCallback(() => {
    if (n === null) return;
    openPrLine(slug, n);
    onOpen(SHIP);
  }, [slug, n, onOpen]);
  return { lead, onLead };
}
