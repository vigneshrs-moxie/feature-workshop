// The GitHub line (packet Q, step 7): one small line in the Jobs header and on a job's Ship stop.
// "GitHub checked 3 min ago · Check now (u)". Check now reads every repository's pull requests
// again (POST /api/flow/refresh, read-only), says "Checking GitHub…", then the new time. When a
// check didn't work it says why in words, with the exact line to run, Copy and Try again (u); it
// stays until a check works, and everything else keeps what it last knew. Checks also happen on
// their own: every minute while a job waits on a reviewer or its checks (Settings → Workflow),
// every ten minutes otherwise, and right after any push or reply.
import { useCallback, useEffect, useState } from 'react';
import type { FlowView, GithubLine as Line } from '../../api/types';
import { useKeyScope } from '../../app/keyRegistry';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import { useWorkshop, useWorkshopState } from '../../state/store';
import './review.css';

/** "40 s ago", "3 min ago", "2 h ago", "just now". */
export function agoWords(iso: string | null | undefined, now: number): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** "every minute while a job waits" / "every 10 minutes": how often it is checked now, in words. */
export function everyWords(line: Line): string {
  const min = Math.max(1, Math.round(line.everyMs / 60000));
  const every = min === 1 ? 'every minute' : `every ${min} minutes`;
  return line.waiting ? `${every} while a job waits on someone` : every;
}

/**
 * The flow view (as home/useFlow.ts: fetched once if the page doesn't have it yet, then kept up by
 * 'flow' events) and Check now. An answer that isn't a flow view is ignored.
 */
function useGithub(): { flow: FlowView | null; refresh(): Promise<void>; problem: string | null } {
  const { api, store } = useWorkshop();
  const { flow } = useWorkshopState();
  const [problem, setProblem] = useState<string | null>(null);
  const missing = flow === null;
  useEffect(() => {
    if (!missing) return;
    let live = true;
    Promise.resolve().then(() => api.get<FlowView>('/api/flow'))
      .then((f) => { if (live && f && Array.isArray(f.repos)) store.dispatch({ type: 'flow', flow: f }); })
      .catch(() => { /* the line just doesn't show until the flow view arrives */ });
    return () => { live = false; };
  }, [api, store, missing]);
  const refresh = useCallback(async () => {
    setProblem(null);
    try {
      const f = await api.post<FlowView>('/api/flow/refresh', {});
      if (f && Array.isArray(f.repos)) store.dispatch({ type: 'flow', flow: f });
    } catch (err) { setProblem(err instanceof Error ? err.message : String(err)); }
  }, [api, store]);
  return { flow, refresh, problem };
}

function useTick(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

/** The line. keys: u checks now (off where another view owns the page's keys). */
export function GithubLine({ keys = true, className = '', onlyStale = false }: { keys?: boolean; className?: string; /** Jobs (packet R): only when the last check is over ten minutes old, or failed; u still checks. */ onlyStale?: boolean }) {
  const { flow, refresh, problem: askProblem } = useGithub();
  const now = useTick(5000);
  const [asked, setAsked] = useState(false);
  const [copied, setCopied] = useState(false);
  const line = flow?.github ?? null;
  const checking = Boolean(line?.checking || flow?.refreshing) || asked;
  const check = async () => {
    if (checking) return;
    setAsked(true);
    try { await refresh(); } finally { setAsked(false); }
  };
  useKeyScope('global', { 'github-check': () => { if (!line) return false; void check(); } }, keys && Boolean(line));
  if (!line) return null;

  const trouble = askProblem ? { words: `GitHub didn’t answer: ${askProblem}`, run: null } : line.problem;
  if (trouble && !checking) {
    const run = trouble.run;
    const words = run && trouble.words.endsWith(run) ? trouble.words.slice(0, -run.length).replace(/[\s:]+$/, '').concat(': run') : trouble.words;
    const copy = async () => {
      try { await navigator.clipboard?.writeText(run ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the line is on screen to copy by hand */ }
    };
    return (
      <p className={`gh-line is-problem ${className}`.trim()} role="status" aria-label="GitHub">
        <Icon name="alert" size={16} />
        <span className="gh-line-words">{words}</span>
        {run && <code className="gh-line-run">{run}</code>}
        {run && (
          <Button kind="quiet" size="sm" icon="copy" className="gh-line-btn" onClick={() => void copy()} title={`Copy “${run}” to paste in a terminal.`}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
        <Button kind="quiet" size="sm" keyId="github-check" className="gh-line-btn" onClick={() => void check()} title="Read every repository’s pull requests on GitHub again (key: u). Nothing is written.">
          Try again
        </Button>
      </p>
    );
  }
  const ago = agoWords(line.checkedAt, now);
  const age = line.checkedAt ? now - Date.parse(line.checkedAt) : Infinity;
  if (onlyStale && !checking && age < 10 * 60_000) return null;
  return (
    <p className={`gh-line ${className}`.trim()} role="status" aria-label="GitHub" title={`GitHub is read ${everyWords(line)}, and right after any push or reply.`}>
      <Icon name={checking ? 'loader' : 'refresh'} size={14} />
      <span className="gh-line-words">{checking ? 'Checking GitHub…' : ago ? `GitHub checked ${ago}` : 'GitHub not checked yet'}</span>
      {!checking && (
        <>
          <Button kind="quiet" size="sm" keyId="github-check" className="gh-line-btn" onClick={() => void check()} title="Read every repository’s pull requests on GitHub now, read-only, instead of waiting (key: u).">
            Check now
          </Button>
        </>
      )}
    </p>
  );
}
