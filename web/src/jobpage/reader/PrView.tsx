// A PR's own view in the reader (job page rebuild, Task 21; design brief R3; dashboard/lib/pr-comments.js):
// its line (state, what GitHub last said, Pull now), the reviewer's verdict, the failed checks, and every
// comment not answered yet as a row: who, the file and line, the comment in full, the three code lines it
// sits on, and a state (New, Fixing, Fixed in abc1234, Answered, Left).
//
// - New comments are ticked; `x` ticks or unticks the one under the pointer. The bar under the list:
//   `3 ticked · Fix these · What is he asking? · Leave`. Fix these sends one prepared message quoting each
//   ticked comment and the rows turn to Fixing; What is he asking? asks for words only; Leave marks them Left.
// - When the Foreman is done a row shows `Fixed in abc1234` (opens that commit's diff in Changes, or says it
//   is not on this branch) and its drafted reply, editable in place. `Copy` with `Open on GitHub` is the
//   default way (he posts it himself); `Post it` posts it through Starbase (lib/gh-write.js, his click is the
//   yes) and the row says `Posted`.
// - Then the bar carries the PR line's `Push the fixes (2 commits)` (left/PrLines.tsx), and the line above
//   does not: the button is in two places only, here and the PR's line in the Ship step.
// - A failed check shows its failing lines (`Show the failure`) and `Fix it`.
// The rows are asked for when the view opens and again only when the PR line's version moves; nothing on a
// timer, nothing on the website.

import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { useKeyScope } from '../../app/keyRegistry';
import { BRAND } from '../../app/brand';
import { Button } from '../../components/Button';
import { Choice } from '../../components/Choice';
import { WorkshopContext } from '../../state/store';
import { PrLines, clockWords } from '../left/PrLines';
import type { PrCheck, PrRow, ReaderTarget } from '../types';
import { useJob, useJobStore } from '../useJob';
import { findCommit, loadCommits, notOnBranch, setPick, useBranch } from './branch';
import { loadPr, setDraft, setTick, usePrHeld } from './prComments';
import { ReaderBody } from './ReaderBody';
import './prview.css';

const UNREACHABLE = `${BRAND.name} didn’t answer. Try again.`;

/** A row's state in words, as the server's lib/pr-comments.js stateWords. */
export function stateWords(row: Pick<PrRow, 'state' | 'commit'>): string {
  switch (row.state) {
    case 'fixing': return 'Fixing';
    case 'fixed': return row.commit ? `Fixed in ${row.commit.slice(0, 7)}` : 'Fixed';
    case 'answered': return 'Answered';
    case 'left': return 'Left';
    default: return 'New';
  }
}

const VERDICT: Record<string, string> = { changes_requested: 'asked for changes', approved: 'approved', commented: 'commented' };
const whereOf = (r: PrRow) => (r.kind === 'line' ? `${r.file ?? 'a file'}${r.line ? `:${r.line}` : ''}${r.outdated ? ' (outdated)' : ''}` : r.kind === 'review' ? 'review' : 'conversation');

export interface PrViewProps {
  n: 1 | 2 | 3;
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

export const PrView = memo(function PrView({ n, onOpen }: PrViewProps) {
  const store = useJobStore();
  const api = useContext(WorkshopContext)?.api ?? null;
  const slug = useJob((s) => s.slug);
  const hosted = useJob((s) => Boolean(s.payload?.hosted)) || Boolean(api?.hosted?.());
  const v = useJob((s) => s.payload?.prs.find((l) => l.n === n)?.comments?.v ?? null);
  const held = usePrHeld(store);
  useEffect(() => { if (!hosted && api) void loadPr(store, api, slug, n, v); }, [store, api, slug, n, v, hosted]);
  const view = held.views.get(n) ?? null;
  const rows = useMemo(() => view?.rows ?? [], [view]);
  const ticked = useCallback((r: PrRow) => held.ticks.get(r.id) ?? r.state === 'new', [held.ticks]);
  const tickedRows = rows.filter((r) => ticked(r) && r.state !== 'fixing');

  // x ticks the row under the pointer.
  const hover = useRef<string | null>(null);
  useKeyScope('jobpage', {
    'jp-tick': () => {
      const row = rows.find((r) => r.id === hover.current);
      if (!row) return false;
      setTick(store, row.id, !ticked(row));
    },
  }, !hosted);

  const [sending, setSending] = useState<null | { what: string; ids: string[] }>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const act = useCallback(async (what: 'fix' | 'ask' | 'leave') => {
    if (!api || !tickedRows.length) return;
    const ids = tickedRows.map((r) => r.id);
    setProblem(null);
    setSending({ what, ids });
    try {
      await api.post(`/api/job/${encodeURIComponent(slug)}/pr/${n}/${what}`, { ids });
      if (what !== 'ask') for (const id of ids) setTick(store, id, false);
      await loadPr(store, api, slug, n, null, { force: true });
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : UNREACHABLE);
    } finally {
      setSending(null);
    }
  }, [api, slug, n, store, tickedRows]);

  if (hosted) return <ReaderBody view="pr" place={`pr:${n}`}><PrLines only={n} /><p className="jp2-notyet">The comments show on your laptop.</p></ReaderBody>;
  const error = held.errors.get(n) ?? null;
  const fixing = (id: string) => sending?.what === 'fix' && sending.ids.includes(id);
  return (
    <ReaderBody view="pr" place={`pr:${n}`} className="jp2-prv">
      <PrLines only={n} skip="push-fixes" />
      {view?.verdict && <p className="jp2-prv-verdict">{view.verdict.by ?? 'The reviewer'} {VERDICT[view.verdict.state] ?? view.verdict.state}{view.verdict.at ? ` · ${clockWords(view.verdict.at)}` : ''}</p>}
      {view?.problem && <p className="jp2-prv-problem" role="alert">{view.problem}</p>}
      {error && !view && <p className="jp2-prv-problem" role="alert">Couldn’t read the comments: {error}</p>}
      {(view?.checks ?? []).map((c) => <CheckRow key={c.name} slug={slug} n={n} check={c} />)}
      {view && !rows.length && <p className="jp2-notyet">No comments to answer on PR #{n}.</p>}
      <div className="jp2-prc-list">
        {rows.map((r) => (
          <Row key={r.id} slug={slug} n={n} row={r} ticked={ticked(r)} fixing={fixing(r.id)} onHover={(id) => { hover.current = id; }} onOpen={onOpen} />
        ))}
      </div>
      <div className="jp2-prc-bar" role="group" aria-label="The ticked comments">
        {tickedRows.length > 0 ? (
          <>
            <span className="jp2-prc-n">{tickedRows.length} ticked</span>
            <Button kind="primary" size="sm" disabled={Boolean(sending)} onClick={() => { void act('fix'); }} title="Sends the Foreman one message quoting each ticked comment: fix each on the branch, one commit each, and draft a reply. Nothing goes to GitHub.">Fix these</Button>
            <Button size="sm" disabled={Boolean(sending)} onClick={() => { void act('ask'); }} title="Asks the Foreman to explain each ticked comment in words. Nothing is changed.">What is he asking?</Button>
            <Button kind="quiet" size="sm" disabled={Boolean(sending)} onClick={() => { void act('leave'); }} title="Marks the ticked comments Left. Nothing is sent.">Leave</Button>
          </>
        ) : (
          <span className="jp2-prc-n">{rows.length ? 'Nothing ticked' : ''}</span>
        )}
        <PrLines only={n} action="push-fixes" />
      </div>
      {problem && <p className="jp2-prv-problem" role="alert">{problem}</p>}
    </ReaderBody>
  );
});

const Row = memo(function Row({ slug, n, row, ticked, fixing, onHover, onOpen }: { slug: string; n: number; row: PrRow; ticked: boolean; fixing: boolean; onHover(id: string | null): void; onOpen: PrViewProps['onOpen'] }) {
  const store = useJobStore();
  const state = fixing ? 'fixing' : row.state;
  const answered = state === 'fixed' || state === 'answered' || state === 'left';
  return (
    <div className="jp2-prc" data-state={state} onMouseEnter={() => onHover(row.id)} onMouseLeave={() => onHover(null)}>
      <div className="jp2-prc-h">
        {state !== 'fixing' && (
          <label className="jp2-prc-tick" title="Tick it for Fix these (x)">
            <Choice type="checkbox" checked={ticked} onChange={(e) => setTick(store, row.id, e.currentTarget.checked)} aria-label={`Tick ${row.author}’s comment`} />
          </label>
        )}
        <b className="jp2-prc-who">{row.author}{row.mine ? ' (you)' : ''}</b>
        <span className="jp2-prc-w">{whereOf(row)}</span>
        {state === 'fixed' && row.commit
          ? <FixedIn slug={slug} sha={row.commit} file={row.file} onOpen={onOpen} />
          : <span className="jp2-prc-st" data-st={state}>{stateWords({ state, commit: row.commit })}</span>}
      </div>
      {row.context && row.context.length > 0 && (
        <pre className="jp2-prc-code" aria-label={`The code at ${whereOf(row)}`}>{row.context.map((l, i) => `${row.contextAt ? `${String(row.contextAt + i).padStart(4)}  ` : ''}${l}`).join('\n')}</pre>
      )}
      <p className="jp2-prc-b">{row.body}</p>
      {(row.replies ?? []).map((x, i) => <p key={i} className="jp2-prc-re"><b>{x.author}{x.mine ? ' (you)' : ''}</b> {x.body}</p>)}
      {state === 'left' && row.why && <p className="jp2-prc-why">Left: {row.why}</p>}
      {answered && row.reply && <Reply slug={slug} n={n} row={row} />}
    </div>
  );
});

/** `Fixed in abc1234`: opens that commit's diff in Changes; a commit not on this branch is said so, once the server says it. */
function FixedIn({ slug, sha, file, onOpen }: { slug: string; sha: string; file: string | null; onOpen: PrViewProps['onOpen'] }) {
  const store = useJobStore();
  const api = useContext(WorkshopContext)?.api ?? null;
  const branch = useBranch(store);
  useEffect(() => { if (api && !branch.commits) void loadCommits(store, api, slug); }, [store, api, slug, branch.commits]);
  const gone = notOnBranch(branch, sha);
  const words = `Fixed in ${sha.slice(0, 7)}`;
  if (gone) return <span className="jp2-prc-st" data-st="fixed" title={`Commit ${sha} is not on this branch.`}>{words} · not on this branch</span>;
  return (
    <button type="button" className="link-button jp2-prc-st jp2-prc-fixed" data-st="fixed" title="Open this commit’s diff"
      onClick={(e) => { setPick(store, { sha: findCommit(branch.commits ?? [], sha)?.sha ?? sha, path: file }); onOpen({ kind: 'changes', id: 'changes' }, e.currentTarget); }}>
      {words}
    </button>
  );
}

/** The drafted reply, editable in place: Copy with Open on GitHub (the default), or Post it. */
function Reply({ slug, n, row }: { slug: string; n: number; row: PrRow }) {
  const store = useJobStore();
  const api = useContext(WorkshopContext)?.api ?? null;
  const held = usePrHeld(store);
  const text = held.drafts.get(row.id) ?? row.reply?.draft ?? '';
  const [copied, setCopied] = useState(false);
  const [posting, setPosting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const posted = row.reply?.posted ?? null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setProblem('Couldn’t copy: select the reply and copy it.'); }
  };
  const post = async () => {
    if (!api || !text.trim()) return;
    setPosting(true);
    setProblem(null);
    try {
      await api.post(`/api/job/${encodeURIComponent(slug)}/pr/${n}/reply`, { id: row.id, body: text });
      await loadPr(store, api, slug, n, null, { force: true });
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : UNREACHABLE);
    } finally {
      setPosting(false);
    }
  };
  return (
    <div className="jp2-prc-reply">
      <p className="jp2-prc-rl">{posted ? 'Your reply, posted' : 'The Foreman’s draft of a reply: edit it here'}</p>
      <textarea className="jp2-prc-ta" value={text} rows={Math.min(8, Math.max(2, Math.ceil(text.length / 80)))} readOnly={Boolean(posted)}
        onChange={(e) => { setCopied(false); setDraft(store, row.id, e.currentTarget.value); }} aria-label={`Reply to ${row.author}`} />
      <div className="jp2-prc-ra">
        {posted ? <span className="jp2-prc-posted" role="status">Posted</span> : (
          <>
            <Button kind="primary" size="sm" onClick={() => { void copy(); }} title="Copies the reply, to paste on GitHub yourself.">{copied ? 'Copied' : 'Copy'}</Button>
            {row.link && <Button size="sm" href={row.link} target="_blank" rel="noreferrer" title="Opens this comment on GitHub, to paste the reply there.">Open on GitHub</Button>}
            <Button kind="quiet" size="sm" disabled={posting || !text.trim()} onClick={() => { void post(); }} title={`${BRAND.name} posts this reply on GitHub for you, as it is now.`}>{posting ? 'Posting…' : 'Post it'}</Button>
          </>
        )}
      </div>
      {problem && <p className="jp2-prv-problem" role="alert">{problem}</p>}
    </div>
  );
}

/** A failed check: its failing lines folded under `Show the failure`, and `Fix it`. */
function CheckRow({ slug, n, check }: { slug: string; n: number; check: PrCheck }) {
  const store = useJobStore();
  const api = useContext(WorkshopContext)?.api ?? null;
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fixing = sent || check.state === 'fixing';
  const fix = async () => {
    if (!api) return;
    setSent(true);
    setProblem(null);
    try {
      await api.post(`/api/job/${encodeURIComponent(slug)}/pr/${n}/fix-check`, { name: check.name });
      await loadPr(store, api, slug, n, null, { force: true });
    } catch (err) {
      setSent(false);
      setProblem(err instanceof ApiError ? err.message : UNREACHABLE);
    }
  };
  return (
    <div className="jp2-prc jp2-prc-check" data-state={fixing ? 'fixing' : 'failed'}>
      <div className="jp2-prc-h">
        <b className="jp2-prc-who">Check failed: {check.name}</b>
        {check.log && <button type="button" className="link-button jp2-prc-all" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide the failure' : 'Show the failure'}</button>}
        {fixing ? <span className="jp2-prc-st" data-st="fixing">Fixing</span>
          : <Button size="sm" className="jp2-prc-fix" onClick={() => { void fix(); }} title="Sends the Foreman the failing lines: fix it on the branch and commit. Nothing goes to GitHub.">Fix it</Button>}
      </div>
      {open && check.log && <pre className="jp2-prc-code">{check.log}</pre>}
      {problem && <p className="jp2-prv-problem" role="alert">{problem}</p>}
    </div>
  );
}
