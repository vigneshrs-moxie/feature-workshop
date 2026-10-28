// The integration board (#/integrate, packet Z): the packet worktrees this dashboard finds, each
// with its branch, how far ahead and behind the main checkout it is, its last commit, its tests
// and whether it changed files outside its brief's "Owns" list; the integration order (up and
// down); "packets at once" with how many slots are in use; one primary button, Merge next (key m),
// which merges the next packet in the order into the main checkout and runs both test suites;
// and the running step's output underneath. Every state is a word; colour only repeats it.
// Data: GET /api/integrate, live output from GET /api/integrate/stream (dashboard/lib/integrate.js).
// It never pushes: nothing here can.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { dialogOpen, isTypingTarget } from '../app/keyRegistry';
import { readKeysSetting } from '../app/keysSetting';
import type { EventSourceLike } from '../state/live';
import { useWorkshop } from '../state/store';

export type TestsState = 'unknown' | 'running' | 'green' | 'red';
export type MergeState = 'waiting' | 'merged' | 'empty' | 'missing' | 'unknown';

export interface IntegratePacket {
  id: string;
  name: string;
  path: string;
  branch: string;
  base: string;
  ahead: number | null;
  behind: number | null;
  state: MergeState;
  lastCommit: { sha: string; short: string; subject: string; time: string } | null;
  testsState: TestsState;
  testsAt: string | null;
  brief: string | null;
  owned: string[] | null;
  touchedOutsideOwned: string[] | null;
}

export interface IntegrateOrderItem { id: string; branch: string | null; state: MergeState; ahead: number | null; name: string | null }

export interface IntegrateResult {
  outcome: 'refused' | 'blocked' | 'nothing' | 'conflict' | 'failed' | 'merged' | 'tests';
  message: string;
  at: string;
  id?: string;
  name?: string;
  branch?: string;
  sha?: string | null;
  files?: string[];
  tests?: { ok: boolean; steps: { label: string; code: number | null; ok: boolean; ms: number }[] };
}

export interface IntegrateStep { kind: 'merge' | 'tests'; id?: string; stage: string; startedAt: string }

export interface IntegrateView {
  root: string;
  base: string;
  packets: IntegratePacket[];
  order: IntegrateOrderItem[];
  next: IntegrateOrderItem | null;
  slots: number;
  inUse: number;
  last: IntegrateResult | null;
  running: IntegrateStep | null;
  log: string;
}

export const TESTS_WORDS: Record<TestsState, string> = { unknown: 'Not run yet', running: 'Running…', green: 'Passed', red: 'Failed' };
export const STATE_WORDS: Record<MergeState, string> = { waiting: 'Not merged yet', merged: 'Merged', empty: 'No commits yet', missing: 'No branch yet', unknown: 'Can’t tell' };
const TONE: Record<string, string> = { ok: 'var(--status-ok)', bad: 'var(--status-error)', warn: 'var(--status-warn)', info: 'var(--status-info)', quiet: 'var(--text-3)' };
const testsTone = (s: TestsState) => (s === 'green' ? 'ok' : s === 'red' ? 'bad' : s === 'running' ? 'info' : 'quiet');
const stateTone = (s: MergeState) => (s === 'merged' ? 'ok' : s === 'waiting' ? 'info' : 'quiet');

/** "2 of 3 slots in use"; over the number set, it says so. */
export function slotsLine(inUse: number, slots: number): string {
  const line = `${inUse} of ${slots} ${slots === 1 ? 'slot' : 'slots'} in use`;
  return inUse > slots ? `${line}: more packets are open than the number set` : line;
}

/** What the last result was, in two or three words. */
export function outcomeWords(r: IntegrateResult): string {
  if (r.outcome === 'merged') return r.tests?.ok ? 'Merged, tests passed' : 'Merged, tests failed';
  if (r.outcome === 'tests') return r.tests?.ok ? 'Tests passed' : 'Tests failed';
  return { refused: 'Not started', blocked: 'Waiting', nothing: 'Nothing to merge', conflict: 'Conflict', failed: 'Stopped' }[r.outcome];
}
const outcomeTone = (r: IntegrateResult) => (r.outcome === 'merged' || r.outcome === 'tests' ? (r.tests?.ok ? 'ok' : 'bad') : r.outcome === 'conflict' || r.outcome === 'failed' ? 'bad' : r.outcome === 'nothing' ? 'ok' : 'warn');

/** "3 ahead · 1 behind". */
export function aheadBehindText(p: Pick<IntegratePacket, 'ahead' | 'behind'>): string {
  if (p.ahead === null || p.behind === null) return 'Can’t tell';
  return `${p.ahead} ahead · ${p.behind} behind`;
}

/** A file in VS Code (the dashboard opens vscode:// links). */
export const editorHref = (file: string) => `vscode://file${file.startsWith('/') ? '' : '/'}${file.split('/').map(encodeURIComponent).join('/')}`;

function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function Word({ tone, children, title }: { tone: string; children: ReactNode; title?: string }) {
  return <span className="chip" title={title} style={{ color: TONE[tone], borderColor: TONE[tone] }}>{children}</span>;
}

const cell: CSSProperties = { padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-1)', textAlign: 'left', verticalAlign: 'top' };

function Outside({ p }: { p: IntegratePacket }) {
  const list = p.touchedOutsideOwned;
  if (list === null) return <Word tone="quiet" title="Its brief’s Owns list couldn’t be read, so this can’t be checked.">Unknown</Word>;
  if (list.length === 0) return <Word tone="ok" title="Every changed file is in its brief’s Owns list.">None</Word>;
  return (
    <details>
      <summary><Word tone="warn">{list.length === 1 ? '1 file' : `${list.length} files`}</Word></summary>
      <ul className="muted" style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-4)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
        {list.map((f) => <li key={f}>{f}</li>)}
      </ul>
    </details>
  );
}

export interface IntegrateViewProps {
  /** Opens the live output (tests pass a fake). */
  openStream?: (url: string) => EventSourceLike;
}

export function IntegrateBoard({ openStream }: IntegrateViewProps) {
  const { api } = useWorkshop();
  const [view, setView] = useState<IntegrateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [log, setLog] = useState('');
  const [running, setRunning] = useState<IntegrateStep | null>(null);
  const [slotsDraft, setSlotsDraft] = useState<string>('');
  const [adding, setAdding] = useState('');
  const logRef = useRef<HTMLPreElement>(null);
  const runningRef = useRef<IntegrateStep | null>(null);

  const load = useCallback(async () => {
    try {
      const v = await api.get<IntegrateView>('/api/integrate');
      setView(v);
      setError(null);
      setSlotsDraft(String(v.slots));
      if (!runningRef.current) setRunning(v.running);
      setLog((now) => (now ? now : v.log));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  // The running step's output, live.
  useEffect(() => {
    const open = openStream ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike);
    let es: EventSourceLike;
    try { es = open('/api/integrate/stream'); } catch { return undefined; }
    es.onmessage = (ev: MessageEvent) => {
      let msg: { type: string; text?: string; step?: IntegrateStep | null; log?: string; result?: IntegrateResult };
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.type === 'hello') {
        runningRef.current = msg.step ?? null;
        setRunning(msg.step ?? null);
        if (msg.log) setLog(msg.log);
      } else if (msg.type === 'step') {
        const step = msg.step ?? null;
        if (step && step.startedAt !== runningRef.current?.startedAt) setLog('');
        runningRef.current = step;
        setRunning(step);
      } else if (msg.type === 'line' && msg.text) {
        setLog((now) => now + msg.text);
      } else if (msg.type === 'done') {
        runningRef.current = null;
        setRunning(null);
        void load();
      }
    };
    return () => es.close();
  }, [openStream, load]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const attempt = useCallback(async (p: Promise<unknown>) => {
    setProblem(null);
    try { await p; } catch (err) { setProblem(err instanceof Error ? err.message : String(err)); }
  }, []);

  const busy = running !== null;
  const mergeNext = useCallback(() => {
    if (busy) return;
    void attempt((async () => {
      setLog('');
      const r = await api.post<{ step: IntegrateStep | null }>('/api/integrate/merge-next', {});
      if (r?.step) { runningRef.current = r.step; setRunning(r.step); }
    })());
  }, [api, attempt, busy]);

  // m: Merge next. Never while typing, with a dialog open, with keys turned off, or with ⌘, Ctrl or Alt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'm' || e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return;
      if (isTypingTarget(e.target) || dialogOpen() || !readKeysSetting().enabled) return;
      e.preventDefault();
      mergeNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mergeNext]);

  const saveOrder = (order: string[]) => attempt(api.post('/api/integrate/order', { order }).then(load));
  const move = (i: number, by: -1 | 1) => {
    if (!view) return;
    const ids = view.order.map((o) => o.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void saveOrder(ids);
  };
  const remove = (i: number) => { if (view) void saveOrder(view.order.map((o) => o.id).filter((_, k) => k !== i)); };
  const add = (id: string) => { if (view && id) void saveOrder([...view.order.map((o) => o.id), id]); setAdding(''); };

  const saveSlots = (raw: string) => {
    setSlotsDraft(raw);
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 20 || n === view?.slots) return;
    void attempt(api.post('/api/integrate/slots', { slots: n }).then(load));
  };

  const runTests = (id: string) => attempt((async () => {
    setLog('');
    const r = await api.post<{ step: IntegrateStep | null }>('/api/integrate/run-tests', { id });
    if (r?.step) { runningRef.current = r.step; setRunning(r.step); }
    await load();
  })());

  const notInOrder = view ? view.packets.filter((p) => !view.order.some((o) => o.id === p.id)) : [];
  const last = view?.last ?? null;
  const next = view?.next ?? null;

  return (
    <main className="screens-view" aria-label="Integration board" style={{ overflow: 'auto' }}>
      <div className="screens-view-head">
        <h2 className="pane-title screens-view-title">Integration board</h2>
        {view && <span className="muted">Merges into <strong>{view.base}</strong> in {view.root}. It never pushes.</span>}
      </div>

      {error && (
        <p className="thread-error" role="alert">
          Couldn’t load the board: {error}{' '}
          <button type="button" className="btn btn-quiet" onClick={() => void load()} title="Ask the dashboard again.">Try again</button>
        </p>
      )}
      {!view && !error && <p className="muted">Loading the packets…</p>}

      {view && (
        <>
          <section aria-labelledby="integrate-next" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' }}>
            <h3 id="integrate-next" className="settings-heading" style={{ margin: 0 }}>Next</h3>
            <span>
              {next ? <>Packet <strong>{next.id}</strong>{next.name ? ` · ${next.name}` : ''} <Word tone={stateTone(next.state)}>{STATE_WORDS[next.state]}</Word></> : 'Every packet in the order is merged.'}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={mergeNext}
              disabled={busy || !next}
              aria-keyshortcuts="m"
              title="Merge the next packet in the order into the main checkout, then run npm test and the web tests there (key: m). Nothing is pushed."
            >
              Merge next <kbd className="kbd">m</kbd>
            </button>
            {running && (
              <span role="status">
                <Word tone="info">{running.kind === 'merge' ? (running.stage === 'testing' ? `Running the tests after merging ${running.id ?? ''}…` : running.stage === 'merging' ? `Merging ${running.id ?? ''}…` : 'Checking…') : `Running the tests for ${running.id}…`}</Word>
              </span>
            )}
          </section>

          {problem && <p className="field-problem" role="alert">{problem}</p>}

          {last && (
            <section aria-labelledby="integrate-last" role="status">
              <h3 id="integrate-last" className="settings-heading">Last result <Word tone={outcomeTone(last)}>{outcomeWords(last)}</Word> <span className="muted" title={last.at}>{ago(last.at)}</span></h3>
              <p style={{ margin: 0 }}>{last.message}</p>
              {last.tests && (
                <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-4)' }}>
                  {last.tests.steps.map((s) => <li key={s.label}>{s.label}: <Word tone={s.ok ? 'ok' : 'bad'}>{s.ok ? 'Passed' : 'Failed'}</Word></li>)}
                </ul>
              )}
              {last.files && last.files.length > 0 && (
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <p style={{ margin: 0 }}>Files with a conflict:</p>
                  <ul style={{ margin: 'var(--space-1) 0', paddingLeft: 'var(--space-4)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
                    {last.files.map((f) => <li key={f}><a href={editorHref(`${view.root}/${f}`)} title={`Open ${f} in VS Code.`}>{f}</a></li>)}
                  </ul>
                  <a className="btn" href={editorHref(view.root)} title="Open the main checkout in VS Code to settle the conflict.">Open in editor</a>
                </div>
              )}
            </section>
          )}

          <section aria-labelledby="integrate-packets">
            <h3 id="integrate-packets" className="settings-heading">Packets <span className="muted">{slotsLine(view.inUse, view.slots)}</span></h3>
            {view.packets.length === 0 ? (
              <p className="muted">No packet worktrees found. A packet is a worktree on a branch named packet/&lt;id&gt;-&lt;name&gt;.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 'var(--text-sm)' }}>
                  <thead>
                    <tr>
                      {['Packet', 'State', 'Branch', 'Ahead / behind', 'Last commit', 'Tests', 'Outside its files', ''].map((h, i) => <th key={i} scope="col" style={{ ...cell, color: 'var(--text-2)', fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'] }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {view.packets.map((p) => (
                      <tr key={p.id} data-packet={p.id}>
                        <th scope="row" style={cell}><strong>{p.id}</strong> <span>{p.name}</span></th>
                        <td style={cell}><Word tone={stateTone(p.state)}>{STATE_WORDS[p.state]}</Word></td>
                        <td style={{ ...cell, fontFamily: 'var(--font-mono)' }} title={p.path}>{p.branch}</td>
                        <td style={cell}>{aheadBehindText(p)}</td>
                        <td style={cell}>
                          {p.lastCommit ? <><span className="num" style={{ fontFamily: 'var(--font-mono)' }}>{p.lastCommit.short}</span> {p.lastCommit.subject.length > 90 ? `${p.lastCommit.subject.slice(0, 89)}…` : p.lastCommit.subject} <span className="muted" title={p.lastCommit.time}>{ago(p.lastCommit.time)}</span></> : <span className="muted">None</span>}
                        </td>
                        <td style={cell}><Word tone={testsTone(p.testsState)} title={p.testsAt ? `Last run ${ago(p.testsAt)}, by this dashboard.` : 'This dashboard hasn’t run them since it started.'}>{TESTS_WORDS[p.testsState]}</Word></td>
                        <td style={cell}><Outside p={p} /></td>
                        <td style={cell}>
                          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void runTests(p.id)} title={`Run npm test and the web tests in ${p.path}.`}>Run tests</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-5)', alignItems: 'flex-start' }}>
            <section aria-labelledby="integrate-order" style={{ minWidth: '18rem' }}>
              <h3 id="integrate-order" className="settings-heading">Order</h3>
              <p className="muted" style={{ marginTop: 0 }}>Merge next takes the first one that isn’t merged yet.</p>
              <ol aria-label="Integration order" style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
                {view.order.map((o, i) => (
                  <li key={o.id} data-order={o.id} style={{ padding: 'var(--space-1) 0' }}>
                    <strong>{o.id}</strong>{o.name ? ` · ${o.name}` : ''} <Word tone={stateTone(o.state)}>{STATE_WORDS[o.state]}</Word>{' '}
                    <button type="button" className="btn btn-quiet" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${o.id} up`} title={`Move ${o.id} one place earlier.`}>↑</button>
                    <button type="button" className="btn btn-quiet" disabled={i === view.order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${o.id} down`} title={`Move ${o.id} one place later.`}>↓</button>
                    <button type="button" className="btn btn-quiet" onClick={() => remove(i)} aria-label={`Take ${o.id} out of the order`} title={`Take ${o.id} out of the order (its branch stays).`}>Remove</button>
                  </li>
                ))}
              </ol>
              {notInOrder.length > 0 && (
                <p>
                  <label>
                    Add to the order{' '}
                    <select value={adding} onChange={(e) => setAdding(e.target.value)}>
                      <option value="">Pick a packet</option>
                      {notInOrder.map((p) => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}
                    </select>
                  </label>{' '}
                  <button type="button" className="btn btn-quiet" disabled={!adding} onClick={() => add(adding)} title="Put it at the end of the order.">Add</button>
                </p>
              )}
            </section>

            <section aria-labelledby="integrate-slots">
              <h3 id="integrate-slots" className="settings-heading">Packets at once</h3>
              <label>
                Packets at once{' '}
                <input type="number" min={1} max={20} step={1} value={slotsDraft} onChange={(e) => saveSlots(e.target.value)} style={{ width: '5rem' }} />
              </label>
              <p className="muted">{slotsLine(view.inUse, view.slots)}. A slot is in use while a packet’s branch isn’t merged.</p>
            </section>
          </div>

          <section aria-labelledby="integrate-log">
            <h3 id="integrate-log" className="settings-heading">Output</h3>
            <pre
              ref={logRef}
              role="log"
              aria-label="Output of the running step"
              style={{ maxHeight: '24rem', minHeight: '4rem', overflow: 'auto', margin: 0, padding: 'var(--space-3)', background: 'var(--bg-1)', color: 'var(--text-1)', border: '1px solid var(--border-1)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', whiteSpace: 'pre-wrap' }}
            >
              {log || 'Nothing has run yet.'}
            </pre>
          </section>
        </>
      )}
    </main>
  );
}
