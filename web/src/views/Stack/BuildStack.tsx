// The build stack (#/stacks/build, packet K2): this app's own packet worktrees as one read-only
// stack, in place of the old integration board. Its parts are the packet/<id>-* branches in the
// saved order (dashboard/lib/integrate.js finds and merges them, unchanged); the one next step is
// Merge next (m), which merges the next packet into the main checkout and runs both test suites.
// Each part: its state, its tests and whether it changed files outside its brief's Owns list, in
// words; Details has the branch, the last commit, Run tests and its place in the order. Packets at
// once is behind the gear; the running step's output is under Output. Nothing here pushes: when
// every packet is merged, push by hand from the terminal.
// Data: GET /api/integrate and its POSTs, the live output from /api/integrate/stream.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IntegrateOrderItem, IntegratePacket, IntegrateResult, IntegrateStep, IntegrateView, PacketMergeState, PacketTestsState, StackStep } from '../../api/types';
import { ApiError } from '../../api/client';
import { BRAND } from '../../app/brand';
import { useKeyScope } from '../../app/keyRegistry';
import { stacksHref } from '../../app/router';
import { Icon } from '../../components/Icon';
import { Kbd } from '../../components/Kbd';
import { NextBar, Page } from '../../components/page/Page';
import { Sheet } from '../../components/Sheet';
import type { EventSourceLike } from '../../state/live';
import { useWorkshop } from '../../state/store';
import { editorHref, type SummaryTone } from './stackModel';
import './stack.css';

/** The build stack's name: this app's own build. */
export const BUILD_NAME = `${BRAND.name} build`;

export const PACKET_WORDS: Record<PacketMergeState, string> = { waiting: 'Not merged yet', merged: 'Merged', empty: 'No commits yet', missing: 'No branch yet', unknown: 'Can’t tell' };
export const TESTS_WORDS: Record<PacketTestsState, string> = { unknown: 'Tests not run yet', running: 'Tests running…', green: 'Tests passed', red: 'Tests failed' };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** "3 ahead · 1 behind". */
export function aheadBehind(p: Pick<IntegratePacket, 'ahead' | 'behind'>): string {
  return p.ahead === null || p.behind === null ? 'Can’t tell' : `${p.ahead} ahead · ${p.behind} behind`;
}

/** The parts in merge order: the saved order, then any packet not in it yet. */
export function buildParts(view: IntegrateView): { item: IntegrateOrderItem | null; packet: IntegratePacket | null; id: string; inOrder: boolean }[] {
  const inOrder = view.order.map((o) => ({ item: o, packet: view.packets.find((p) => p.id === o.id) ?? null, id: o.id, inOrder: true }));
  const rest = view.packets.filter((p) => !view.order.some((o) => o.id === p.id)).map((p) => ({ item: null, packet: p, id: p.id, inOrder: false }));
  return [...inOrder, ...rest];
}

/** The four dots and the word for the build stack's row on the Stacks list. */
export function buildSummary(view: IntegrateView): { steps: StackStep[]; word: string; tone: SummaryTone; parts: number } {
  const states = view.order.length ? view.order.map((o) => o.state) : view.packets.map((p) => p.state);
  const allMerged = states.length > 0 && states.every((s) => s === 'merged');
  const unbuilt = states.some((s) => s === 'empty' || s === 'missing');
  const step = (id: StackStep['id'], label: string, state: StackStep['state']): StackStep => ({ id, label, state, words: state === 'done' ? 'Done' : state === 'now' ? 'Now' : 'Not yet' });
  const steps = [
    step('plan', 'Plan', 'done'),
    step('build', 'Build', unbuilt ? 'now' : 'done'),
    step('merge', 'Merge', allMerged ? 'done' : unbuilt ? 'next' : 'now'),
    step('push', 'Push', allMerged ? 'now' : 'next'),
  ];
  const word = view.running ? 'Merging' : allMerged ? 'Merged: push by hand' : view.next ? 'Needs you: merge next' : 'Building';
  return { steps, word, tone: view.running ? 'working' : allMerged ? 'done' : view.next ? 'needs-you' : 'working', parts: buildParts(view).length };
}

/** The last result in a few words. */
export function resultWords(r: IntegrateResult): string {
  if (r.outcome === 'merged') return r.tests?.ok ? 'Merged, tests passed' : 'Merged, tests failed';
  if (r.outcome === 'tests') return r.tests?.ok ? 'Tests passed' : 'Tests failed';
  return { refused: 'Not started', blocked: 'Waiting', nothing: 'Nothing to merge', conflict: 'Conflict', failed: 'Stopped' }[r.outcome];
}

/** GET /api/integrate (null until it answers; unavailable when the dashboard has no packets board here). */
export function useIntegrate({ live = false, openStream }: { live?: boolean; openStream?: (url: string) => EventSourceLike } = {}) {
  const { api } = useWorkshop();
  const [view, setView] = useState<IntegrateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [log, setLog] = useState('');
  const [running, setRunning] = useState<IntegrateStep | null>(null);
  const runningRef = useRef<IntegrateStep | null>(null);
  const load = useCallback(async () => {
    try {
      const v = await Promise.resolve().then(() => api.get<IntegrateView>('/api/integrate'));
      if (!v || !Array.isArray(v.packets)) { setUnavailable(true); return; }
      setView(v);
      setError(null);
      if (!runningRef.current) setRunning(v.running);
      setLog((now) => now || v.log || '');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 405)) setUnavailable(true);
      else setError(message(err));
    }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (live) return undefined;
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [live, load]);
  // The running step's output, live (the build stack's page only).
  useEffect(() => {
    if (!live) return undefined;
    const open = openStream ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike);
    let es: EventSourceLike;
    try { es = open('/api/integrate/stream'); } catch { return undefined; }
    es.onmessage = (ev: MessageEvent) => {
      let msg: { type: string; text?: string; step?: IntegrateStep | null; log?: string };
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.type === 'hello') { runningRef.current = msg.step ?? null; setRunning(msg.step ?? null); if (msg.log) setLog(msg.log); }
      else if (msg.type === 'step') {
        const step = msg.step ?? null;
        if (step && step.startedAt !== runningRef.current?.startedAt) setLog('');
        runningRef.current = step;
        setRunning(step);
      } else if (msg.type === 'line' && msg.text) setLog((now) => now + msg.text);
      else if (msg.type === 'done') { runningRef.current = null; setRunning(null); void load(); }
    };
    return () => es.close();
  }, [live, openStream, load]);
  const started = (step: IntegrateStep | null | undefined) => { if (step) { runningRef.current = step; setRunning(step); } };
  return { view, error, unavailable, log, setLog, running, started, load };
}

export function BuildStackPage({ openStream }: { openStream?: (url: string) => EventSourceLike }) {
  const { api } = useWorkshop();
  const { view, error, unavailable, log, setLog, running, started, load } = useIntegrate({ live: true, openStream });
  const [problem, setProblem] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [log]);

  const attempt = useCallback(async (p: Promise<unknown>) => {
    setProblem(null);
    try { await p; } catch (err) { setProblem(message(err)); }
  }, []);
  const busy = running !== null;
  const canMerge = Boolean(view?.next) && view?.next?.state !== 'missing' && view?.next?.state !== 'empty';
  const mergeNext = () => {
    if (busy || !canMerge) return;
    setOutputOpen(true);
    void attempt((async () => { setLog(''); const r = await api.post<{ step: IntegrateStep | null }>('/api/integrate/merge-next', {}); started(r?.step); })());
  };
  const runTests = (id: string) => {
    setOutputOpen(true);
    void attempt((async () => { setLog(''); const r = await api.post<{ step: IntegrateStep | null }>('/api/integrate/run-tests', { id }); started(r?.step); await load(); })());
  };
  const saveOrder = (order: string[]) => attempt(api.post('/api/integrate/order', { order }).then(load));
  useKeyScope('stack', { 'stack-merge': () => { if (busy || !canMerge) return false; mergeNext(); } }, !settings);

  const title = BUILD_NAME;
  if (!view) {
    return (
      <Page label="Stack" title={title} className="page-stack">
        {unavailable ? <p className="muted">There are no packets to build here: the build stack lists this app’s own packet worktrees, on the computer that runs the dashboard.</p>
          : error ? (
            <section className="stack-empty" role="alert">
              <p>Couldn’t load the packets: {error}</p>
              <button type="button" className="btn btn-lg" onClick={() => void load()}>Try again</button>
            </section>
          ) : <p className="muted" role="status">Loading the packets…</p>}
      </Page>
    );
  }

  const parts = buildParts(view);
  const last = view.last;
  const next = view.next;
  const nextName = next ? `Packet ${next.id}${next.name ? ` (${next.name})` : ''}` : '';
  let bar;
  if (running) {
    const what = running.kind === 'merge'
      ? running.stage === 'testing' ? `Running both test suites after merging ${running.id ?? ''}…` : running.stage === 'merging' ? `Merging packet ${running.id ?? ''}…` : 'Checking the packets…'
      : `Running the tests for packet ${running.id}…`;
    bar = <NextBar tone="quiet" icon="loader" say={what} sub="This takes a few minutes. The output is under Output, live." />;
  } else if (last?.outcome === 'conflict') {
    bar = (
      <NextBar tone="stop" icon="warn" className="stack-bar-problem" say={`Packet ${last.id ?? ''} clashes with ${view.base}`.replace('  ', ' ')} sub={`${last.files?.length ? `${last.files.join(', ')}. ` : ''}Settle it in the packet’s worktree, then Merge next again.`}>
        <a className="btn btn-lg" href={editorHref(view.root, '')} title="Open the main checkout in your editor.">Open in editor</a>
        <button type="button" className="btn btn-primary btn-lg" disabled={!next} onClick={mergeNext} title="Try the merge again (key: m).">Merge next <Kbd id="stack-merge" /></button>
      </NextBar>
    );
  } else if (last?.outcome === 'merged' && last.tests && !last.tests.ok) {
    bar = (
      <NextBar tone="stop" icon="warn" className="stack-bar-problem" say={`Packet ${last.id ?? ''} merged, but the tests failed`} sub={`Fix ${view.base} before merging the next packet: the output says what failed.`}>
        <button type="button" className="btn btn-lg" onClick={() => setOutputOpen(true)}>See what failed</button>
      </NextBar>
    );
  } else if (next && (next.state === 'missing' || next.state === 'empty')) {
    bar = (
      <NextBar tone="warn" icon="clock" say={`${nextName} is next in the order, but ${next.state === 'missing' ? 'has no branch yet' : 'has no commits yet'}`} sub="Merge next waits for it. If it isn’t coming soon, take it out of the order (its Details), and the next one moves up." />
    );
  } else if (next) {
    bar = (
      <NextBar tone="go" icon="merge" say={`${nextName} is next to merge`} sub={`Merge next merges it into ${view.base}, then runs npm test and the web tests. Nothing is pushed.`}>
        <button type="button" className="btn btn-primary btn-lg" onClick={mergeNext} title={`Merge ${nextName} into ${view.base}, then run both test suites (key: m).`}>Merge next <Kbd id="stack-merge" /></button>
      </NextBar>
    );
  } else if (parts.length) {
    bar = <NextBar tone="go" icon="rocket" say="Every packet in the order is merged" sub={`Push ${view.base} by hand from the terminal when you are ready: nothing here pushes.`} />;
  } else {
    bar = <NextBar tone="quiet" icon="layers" say="No packets yet" sub="A packet is a worktree on a branch named packet/<id>-<name>. They show here as parts." />;
  }

  return (
    <Page
      label="Stack"
      title={title}
      className="page-stack"
      head={(
        <>
          <span className="chip">Read-only stack</span>
          <span className="spacer" />
          <a className="btn btn-quiet" href={stacksHref()}><Icon name="chevron-left" size={16} /> Stacks</a>
          <button type="button" className="btn btn-quiet" onClick={() => setSettings(true)} title="Packets at once."><Icon name="settings" size={16} /> Stack settings</button>
        </>
      )}
    >
      <p className="muted stack-intro">
        This app’s own packets, one part each, merged in the saved order into <b className="num">{view.base}</b> in <span className="num">{view.root}</span>, with both test suites after each merge. Nothing here pushes.
      </p>
      {bar}
      {problem && <p className="field-problem stack-problem" role="alert">{problem} <button type="button" className="btn btn-quiet" onClick={() => setProblem(null)}>Dismiss</button></p>}
      {last && !running && <p className="muted stack-note" role="status">Last: {resultWords(last)}. {last.message}</p>}
      <ol className="stack-parts play-off" aria-label="The packets, in merge order">
        {parts.map((x, i) => (
          <PacketCard
            key={x.id}
            n={i + 1}
            part={x}
            busy={busy}
            first={i === 0}
            last={i === view.order.length - 1}
            onTests={() => runTests(x.id)}
            onMove={(by) => { const ids = view.order.map((o) => o.id); const j = i + by; [ids[i], ids[j]] = [ids[j], ids[i]]; void saveOrder(ids); }}
            onOrder={() => void saveOrder(x.inOrder ? view.order.map((o) => o.id).filter((id) => id !== x.id) : [...view.order.map((o) => o.id), x.id])}
          />
        ))}
      </ol>
      <details className="fold" open={outputOpen} onToggle={(e) => setOutputOpen(e.currentTarget.open)}>
        <summary className="fold-head"><Icon name="terminal" size={16} /><span className="fold-name">Output</span><span className="muted fold-note">· {running ? 'running now' : log ? 'the last step' : 'nothing has run yet'}</span><span className="fold-show" aria-hidden="true"><span className="when-closed">Show ▸</span><span className="when-open">Hide ▾</span></span></summary>
        <div className="fold-body"><pre ref={logRef} className="stack-tail" role="log" aria-label="Output of the running step">{log || 'Nothing has run yet.'}</pre></div>
      </details>
      {settings && <SlotsSheet view={view} onClose={() => setSettings(false)} onSave={(n) => void attempt(api.post('/api/integrate/slots', { slots: n }).then(load)).then(() => setSettings(false))} />}
    </Page>
  );
}

function PacketCard({ n, part, busy, first, last, onTests, onMove, onOrder }: {
  n: number; part: ReturnType<typeof buildParts>[number]; busy: boolean; first: boolean; last: boolean;
  onTests: () => void; onMove: (by: -1 | 1) => void; onOrder: () => void;
}) {
  const p = part.packet;
  const state = part.item?.state ?? p?.state ?? 'unknown';
  const tone = state === 'merged' ? 'merged' : state === 'waiting' ? 'ready' : 'waiting';
  const outside = p?.touchedOutsideOwned;
  return (
    <li className={`stack-part tone-${tone}`}>
      <div className="stack-part-top">
        <span className="part-n">{n}</span>
        <b className="stack-part-title">Packet {part.id}{(part.item?.name ?? p?.name) ? ` · ${part.item?.name ?? p?.name}` : ''}</b>
      </div>
      <div className="stack-part-foot">
        <span className={`chip part-chip tone-${tone}`}><Icon name={state === 'merged' ? 'check' : state === 'waiting' ? 'merge' : 'circle-dashed'} size={13} /> {PACKET_WORDS[state]}</span>
        {!part.inOrder && <span className="chip">Not in the order</span>}
      </div>
      {p && (
        <div className="stack-part-foot muted stack-readout">
          <span>{TESTS_WORDS[p.testsState]}</span>
          <span>{outside === null || outside === undefined ? 'Its files: can’t tell' : outside.length ? `${outside.length === 1 ? '1 file' : `${outside.length} files`} outside its own` : 'Stayed in its own files'}</span>
        </div>
      )}
      <details className="stack-details">
        <summary title={`Packet ${part.id}’s branch, last commit, tests and place in the order.`}>Details</summary>
        <dl>
          {p ? <>
            <dt>Branch</dt><dd className="num">{p.branch}</dd>
            <dt>Worktree</dt><dd className="num">{p.path}</dd>
            <dt>Ahead / behind</dt><dd>{aheadBehind(p)}</dd>
            <dt>Last commit</dt><dd>{p.lastCommit ? <><span className="num">{p.lastCommit.short}</span> {p.lastCommit.subject}</> : 'None'}</dd>
            {outside?.length ? <><dt>Outside its own</dt><dd><ul className="stack-files">{outside.map((f) => <li key={f} className="num">{f}</li>)}</ul></dd></> : null}
          </> : <><dt>Branch</dt><dd>No worktree for this packet yet.</dd></>}
        </dl>
        <div className="stack-part-actions">
          {p && <button type="button" className="btn btn-quiet" disabled={busy} onClick={onTests} title={`Run npm test and the web tests in ${p.path}.`}>Run tests</button>}
          {part.inOrder && <button type="button" className="btn btn-quiet" disabled={first} onClick={() => onMove(-1)} aria-label={`Move packet ${part.id} up`} title="One place earlier in the order.">↑</button>}
          {part.inOrder && <button type="button" className="btn btn-quiet" disabled={last} onClick={() => onMove(1)} aria-label={`Move packet ${part.id} down`} title="One place later in the order.">↓</button>}
          <button type="button" className="btn btn-quiet" onClick={onOrder}>{part.inOrder ? 'Take out of the order' : 'Add to the order'}</button>
        </div>
      </details>
    </li>
  );
}

function SlotsSheet({ view, onClose, onSave }: { view: IntegrateView; onClose: () => void; onSave: (n: number) => void }) {
  const [raw, setRaw] = useState(String(view.slots));
  const n = Number(raw);
  const ok = Number.isInteger(n) && n >= 1 && n <= 20;
  return (
    <Sheet title="Stack settings" onClose={onClose}>
      <form className="stack-settings" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(n); }}>
        <label className="field">
          <span>Packets at once</span>
          <input className="text-input" type="number" min={1} max={20} value={raw} onChange={(e) => setRaw(e.target.value)} />
        </label>
        <p className="muted">{view.inUse} of {view.slots} in use: a packet holds a place while its branch isn’t merged.</p>
        {!ok && <p className="field-problem">Pick a whole number from 1 to 20.</p>}
        <div className="sheet-actions">
          <button type="button" className="btn btn-lg" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-lg" disabled={!ok}>Save</button>
        </div>
      </form>
    </Sheet>
  );
}
