// Try it: the classic page's "Try it on your computer" (dashboard/public/local.js) in the Preview
// pane. Runs the job's branch from its own folder next to your main app: one button sets up what is
// missing and starts the app on the job's port; the steps under it (settings file, database, app)
// each have their own button; quick commands, a command box and the output sit below. Same server
// routes as the classic page (GET and POST /api/job/:slug/local); it polls while something runs.
// Switching the database asks first, in place, saying what is lost.
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { settingsHref } from '../../app/router';
import { useWorkshop } from '../../state/store';

interface LocalView {
  slug: string;
  available: boolean;
  reason?: string;
  demo?: boolean;
  root?: string;
  branch?: string | null;
  port?: number | null;
  url?: string | null;
  /** The chosen terminal app, one of terminalApps (this computer's: iTerm and Terminal on a Mac). */
  terminalApp?: string;
  terminalApps?: string[];
  /** The folder button: "Finder" on a Mac, "Open folder" elsewhere. */
  folderLabel?: string;
  app?: { dir: string; rel: string } | null;
  env?: { exists: boolean; ready: boolean; sourceExists: boolean; signInSkipped?: boolean | null; file: string; notes: string[] } | null;
  /** The repository's profile (Settings → Repos), or null when it has none: Try it then guesses as it always did. */
  profile?: { name: string; github?: string | null; file?: string | null; source?: 'repo' | 'registry' | null } | null;
  profileErrors?: string[];
  db?: {
    available: boolean; reason?: string; busy?: boolean; gone?: boolean; name?: string;
    missing: string[]; extra: string[]; connections?: number;
    matches?: { kind: 'job' | 'original'; slug?: string; title?: string; partial?: boolean } | null;
    original: { exists: boolean; savedAt?: string | null };
  } | null;
  server?: { status: 'starting' | 'running' | 'exited' | 'stopped'; startedAt?: string } | null;
  serverOutput?: string;
  cmd?: { label?: string; command: string; status: 'running' | 'done' | 'failed' | 'stopped'; exitCode?: number | null; stoppable?: boolean; output?: string; startedAt?: string } | null;
  presets: { id: string; label: string; command: string; hint?: string }[];
}

type DbAction = 'match' | 'original' | 'save-original';
const HISTORY_KEY = 'fw.tryHistory';
const short = (p: string | undefined | null) => String(p ?? '').replace(/^\/Users\/[^/]+/, '~');
const STATUS_WORDS: Record<string, string> = { running: 'Running…', done: 'Finished', failed: 'Failed', stopped: 'Stopped' };

function readHistory(): string[] {
  try { const h = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); return Array.isArray(h) ? h.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
function saveHistory(h: string[]) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 30))); } catch { /* a convenience */ } }

function Step({ state, n, title, children, actions }: { state: 'ok' | 'todo' | 'busy' | 'off'; n: number; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  const mark = state === 'ok' ? '✓' : state === 'busy' ? '…' : state === 'off' ? '–' : String(n);
  const words = state === 'ok' ? 'Done' : state === 'busy' ? 'Working' : state === 'off' ? 'Not available' : 'To do';
  return (
    <li className={`try-step is-${state}`}>
      <span className="try-mark" aria-hidden="true">{mark}</span>
      <div className="try-step-text"><b>{title}</b> <span className="sr-only">({words})</span><span>{children}</span></div>
      {actions && <div className="try-step-actions">{actions}</div>}
    </li>
  );
}

export function TryTab({ slug, active }: { slug: string; active: boolean }) {
  const { api } = useWorkshop();
  const [v, setV] = useState<LocalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; tone: 'good' | 'bad' | 'info' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ what: DbAction; thenStart?: boolean } | null>(null);
  const [where, setWhere] = useState<'app' | 'root'>('app');
  const [command, setCommand] = useState('');
  // Commands and logs are folded; they open while a command runs.
  const [moreOpen, setMoreOpen] = useState(false);
  const cmdRunning = v?.cmd?.status === 'running';
  useEffect(() => { if (cmdRunning) setMoreOpen(true); }, [cmdRunning]);
  const histAt = useRef(-1);
  const outRef = useRef<HTMLPreElement>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const base = `/api/job/${encodeURIComponent(slug)}/local`;

  const load = useCallback(async (fresh = false) => {
    try {
      const view = await api.get<LocalView>(`${base}${fresh ? '?fresh=1' : ''}`);
      setV((prev) => {
        if (prev?.server?.status !== 'running' && view.server?.status === 'running' && prev) setNote({ text: 'The app is ready.', tone: 'good' });
        return view;
      });
      setError(null);
    } catch (err) { setError((err as Error).message); }
  }, [api, base]);

  const working = v?.server?.status === 'starting' || v?.cmd?.status === 'running' || Boolean(v?.db?.busy) || busy !== null;
  useEffect(() => {
    if (!active) return undefined;
    load();
    const id = setInterval(() => load(), working ? 1500 : 10000);
    return () => clearInterval(id);
  }, [active, load, working]);

  // The output follows its end while you're at the bottom.
  useEffect(() => {
    for (const el of [outRef.current, logRef.current]) if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [v?.cmd?.output, v?.serverOutput]);

  const act = (action: string, extra: Record<string, unknown> = {}) => api.post<Record<string, unknown>>(base, { action, ...extra });
  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try { await fn(); } catch (err) { setNote({ text: (err as Error).message, tone: 'bad' }); } finally { setBusy(null); load(key === 'db'); }
  }

  const setupEnv = async () => {
    const r = await act('env');
    setNote({ text: r.copied ? 'Settings file copied from your main folder and pointed at this job’s port.' : 'Settings file updated for this job’s port.', tone: 'good' });
  };
  const start = async () => { await act('start'); setNote({ text: 'Starting the app. The Open button appears when it’s ready.', tone: 'info' }); };
  async function tryIt() {
    if (!v) return;
    if (v.env && !v.env.ready) {
      if (!v.env.exists && !v.env.sourceExists) throw new Error(`The app needs ${v.env.file} and your main folder has none to copy.`);
      await setupEnv();
    }
    if (v.db?.available && v.db.missing.length && !v.db.busy) { setConfirm({ what: 'match', thenStart: true }); return; }
    await start();
  }
  async function switchDb(what: DbAction, thenStart = false) {
    setConfirm(null);
    setNote({ text: 'Switching the database. Progress shows in the output.', tone: 'info' });
    await act('db', { db: what });
    setNote({ text: 'Database switched.', tone: 'good' });
    if (thenStart) await start();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const c = command.trim();
    if (!c) return;
    run('cmd', async () => {
      await act('run', { command: c, where });
      saveHistory([c, ...readHistory().filter((x) => x !== c)]);
      setCommand('');
      histAt.current = -1;
    });
  }
  function onCmdKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const h = readHistory();
    if (!h.length) return;
    e.preventDefault();
    histAt.current = Math.max(-1, Math.min(h.length - 1, histAt.current + (e.key === 'ArrowUp' ? 1 : -1)));
    setCommand(histAt.current < 0 ? '' : h[histAt.current]);
  }
  async function copyOut() {
    try { await navigator.clipboard.writeText(v?.cmd?.output ?? ''); setNote({ text: 'Output copied.', tone: 'good' }); } catch { setNote({ text: 'Couldn’t copy. Select the text instead.', tone: 'bad' }); }
  }

  if (error && !v) return <p className="try-note is-bad" role="alert">{error}</p>;
  if (!v) return <p className="muted doc-empty">Looking at the job’s folder…</p>;
  if (!v.available) return <p className="muted doc-empty">{v.reason}</p>;

  const signIn = v.env?.signInSkipped ? 'You’re signed in as an admin automatically; use “View as” in the app to test as someone else.' : '';
  const s = v.server?.status;
  const dbN = v.env ? 2 : 1;
  const appN = dbN + (v.db ? 1 : 0);
  const d = v.db;
  const btn = (key: string, label: string, fn: () => Promise<void>, cls = 'btn') => (
    <button type="button" className={cls} disabled={busy !== null} onClick={() => run(key, fn)}>{busy === key ? '…' : label}</button>
  );
  const dbButtons = d && d.available && !d.busy ? (
    <>
      {d.missing.length > 0 && <button type="button" className="btn btn-primary" onClick={() => setConfirm({ what: 'match' })}>Match this job</button>}
      {(d.gone || d.original.exists) && <button type="button" className={d.gone ? 'btn btn-primary' : 'btn btn-quiet'} onClick={() => setConfirm({ what: 'original' })}>Put the original back</button>}
    </>
  ) : null;
  // This computer's terminal apps and folder button, as the job's local view names them.
  const terminals = v.terminalApps?.length ? v.terminalApps : ['iTerm', 'Terminal'];
  const folder = v.folderLabel ?? 'Finder';

  return (
    <div className="try-tab">
      {v.demo && <p className="try-note is-info">Demo mode: the buttons show what would happen; nothing runs.</p>}
      {v.profile === null && (
        <p className="try-note is-info" role="note">This repository has no profile yet: <a href={settingsHref('repos')}>Settings → Repos</a>.{v.profileErrors?.length ? ` Its profile has ${v.profileErrors.length === 1 ? 'a problem' : 'problems'}: ${v.profileErrors.join(' ')}` : ''}</p>
      )}

      <div className="try-go">
        {!v.app ? (
          <p className="muted">No app to start here (no package.json with a “dev” script in the job’s folder). You can still run commands below.</p>
        ) : s === 'running' ? (
          <><a className="btn btn-primary try-big" href={v.url ?? '#'} target="_blank" rel="noopener noreferrer">Open the app ↗</a>
            <p>Running at <a href={v.url ?? '#'} target="_blank" rel="noopener noreferrer">{v.url}</a>. {signIn}</p></>
        ) : s === 'starting' ? (
          <><button type="button" className="btn try-big" disabled>Starting…</button><p>Starting the app on port {v.port}. The first start takes a little while.</p></>
        ) : (
          <><button type="button" className="btn btn-primary try-big" disabled={busy !== null} onClick={() => run('go', tryIt)}>▶ Try it</button>
            <p>Sets up anything missing, starts the app on port {v.port} and gives you the link. {signIn}</p></>
        )}
      </div>

      {note && <p className={`try-note is-${note.tone}`} role="status">{note.text}</p>}

      {confirm && d && (
        <div className="try-confirm" role="group" aria-label="Please confirm">
          <b>{confirm.what === 'match' ? 'Match your local database to this job?' : confirm.what === 'original' ? 'Put the original database back?' : 'Make this the new original?'}</b>
          <ul>
            {confirm.what === 'match' && <li>This job’s branch has database changes yours doesn’t: {d.missing.map((m) => <code key={m}>{m} </code>)}.</li>}
            {confirm.what === 'match' && !d.original.exists && <li>First time only: your database is saved as it is now, as the original, before anything changes.</li>}
            {confirm.what !== 'save-original' && <li>Apps started from here stop first. If your main app’s dev server is running, stop it, or the switch waits and then gives up.</li>}
            {confirm.what !== 'save-original' && <li>Anything changed in the local database since the last switch (test data included) is lost. “Put the original back” returns to the original at any time.</li>}
            {confirm.what === 'save-original' && <li>The saved original is replaced by <code>{d.name}</code> as it is right now.</li>}
            {confirm.thenStart && <li>You can also start without switching: pages that use the new database changes will then fail.</li>}
          </ul>
          <div className="try-confirm-actions">
            {btn('db', confirm.what === 'match' ? (confirm.thenStart ? 'Match and start' : 'Match this job') : confirm.what === 'original' ? 'Put it back' : 'Save as the original', () => switchDb(confirm.what, confirm.thenStart), 'btn btn-primary')}
            {confirm.thenStart && btn('go', 'Start without switching', async () => { setConfirm(null); await start(); })}
            <button type="button" className="btn btn-quiet" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}

      <ol className="try-steps" aria-label="Steps">
        {v.env && (
          !v.env.exists ? (
            <Step state="todo" n={1} title="Settings file" actions={v.env.sourceExists ? btn('env', 'Set up', setupEnv, 'btn btn-primary') : undefined}>
              {v.env.sourceExists ? <>Not set up yet. Copies your main folder’s <code>{v.env.file}</code>, points it at port {v.port} and skips sign-in.</> : <>Your main folder has no <code>{v.env.file}</code> to copy. Create <code>{v.env.file}</code> yourself.</>}
            </Step>
          ) : v.env.ready ? (
            <Step state="ok" n={1} title="Settings file" actions={btn('env', 'Redo', setupEnv, 'btn btn-quiet')}>
              Ready: port {v.port}{v.env.signInSkipped ? ', sign-in skipped' : ''}.{v.env.notes.length > 0 && <span className="muted"> {v.env.notes.join(' ')}</span>}
            </Step>
          ) : (
            <Step state="todo" n={1} title="Settings file" actions={btn('env', 'Fix it', setupEnv, 'btn btn-primary')}>
              There, but not pointed at port {v.port}{v.env.signInSkipped === false ? ' and sign-in isn’t skipped' : ''}.{v.env.notes.length > 0 && <span className="muted"> {v.env.notes.join(' ')}</span>}
            </Step>
          )
        )}
        {d && (
          !d.available ? <Step state="off" n={dbN} title="Database">{d.reason}</Step>
            : d.busy ? <Step state="busy" n={dbN} title="Database">Switching {d.name}… (progress is in the output below)</Step>
              : d.gone ? <Step state="todo" n={dbN} title="Database" actions={dbButtons}>Your local database <code>{d.name}</code> isn’t there (a switch may have stopped half-way). The saved original is safe.</Step>
                : (
                  <Step state={d.missing.length ? 'todo' : 'ok'} n={dbN} title="Database" actions={dbButtons}>
                    {d.missing.length ? <>Missing this job’s database changes: {d.missing.map((m) => <code key={m}>{m} </code>)}.</> : <>Has everything this job needs.{d.extra.length > 0 && ` It also has changes from elsewhere (${d.extra.join(', ')}), which is usually fine for testing.`}</>}
                    {d.matches?.kind === 'job' && <> Last matched to <b>{d.matches.title ?? d.matches.slug}</b>{d.matches.partial ? ' (not finished)' : ''}.</>}
                    {d.matches?.kind === 'original' && <> It is the original.</>}
                    {d.connections ? <span className="muted"> {d.connections} connection{d.connections === 1 ? '' : 's'} open (probably your main app); switching needs them closed.</span> : null}
                    {d.original.exists && <> <button type="button" className="link-button" onClick={() => setConfirm({ what: 'save-original' })}>Make the database as it is now the new original</button></>}
                  </Step>
                )
        )}
        {v.app && (
          s === 'running' ? <Step state="ok" n={appN} title="App" actions={btn('stop', 'Stop', async () => { await act('stop'); setNote({ text: 'Stopping the app.', tone: 'info' }); })}>Running at <a href={v.url ?? '#'} target="_blank" rel="noopener noreferrer">{v.url}</a>.</Step>
            : s === 'starting' ? <Step state="busy" n={appN} title="App" actions={btn('stop', 'Stop', async () => { await act('stop'); })}>Starting on port {v.port}…</Step>
              : <Step state="todo" n={appN} title="App" actions={btn('start', 'Start', start, 'btn btn-primary')}>{s === 'exited' ? 'It stopped by itself. The app log below says why.' : 'Not running.'}</Step>
        )}
      </ol>

      <div className="try-where">
        <span title={v.app?.dir ?? v.root}>Folder <code>{short(v.app?.dir ?? v.root)}</code></span>
        {v.branch && <span>Branch <code>{v.branch}</code></span>}
        {v.port && <span>Port <b>{v.port}</b></span>}
      </div>
      <div className="try-open">
        {btn('open-terminal', 'Open terminal here', async () => { const r = await act('open', { what: 'terminal' }); setNote({ text: `Opened a terminal in ${short(r.dir as string)}.`, tone: 'good' }); })}
        {btn('open-vscode', 'VS Code', async () => { await act('open', { what: 'vscode' }); setNote({ text: 'Opened in VS Code.', tone: 'good' }); }, 'btn btn-quiet')}
        {btn('open-finder', folder, async () => { await act('open', { what: 'finder' }); setNote({ text: folder === 'Finder' ? 'Opened in Finder.' : 'Opened the folder.', tone: 'good' }); }, 'btn btn-quiet')}
        {terminals.length > 1 && (
          <label className="try-term">in{' '}
            <select value={v.terminalApp ?? terminals[0]} aria-label="Terminal app" onChange={(e) => run('term', async () => { await act('terminal-app', { name: e.target.value }); setNote({ text: `“Open terminal here” now uses ${e.target.value}.`, tone: 'good' }); })}>
              {terminals.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        )}
      </div>

      <details className="try-more" open={moreOpen} onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Commands and logs{v.cmd?.status === 'running' ? ' · running' : ''}</summary>
        {v.presets.length > 0 && (
          <div className="try-presets">
            <h4 className="kp-label">Quick commands</h4>
            {v.presets.map((p) => (
              <button key={p.id} type="button" className="btn" disabled={busy !== null} title={`${p.hint ? `${p.hint}. ` : ''}Runs: ${p.command}`} onClick={() => run('preset', async () => { await act('run', { preset: p.id }); })}>{p.label}</button>
            ))}
          </div>
        )}

        <form className="try-cmd" onSubmit={onSubmit} autoComplete="off">
          {v.app && v.app.rel !== '.' && (
            <label>Run in{' '}
              <select value={where} onChange={(e) => setWhere(e.target.value as 'app' | 'root')}><option value="app">the app folder</option><option value="root">the whole repo</option></select>
            </label>
          )}
          <div className="try-cmd-row">
            <span aria-hidden="true">$</span>
            <input type="text" value={command} spellCheck={false} placeholder="Type a command, for example: npm test" aria-label="Command to run in the job’s folder" onChange={(e) => setCommand(e.target.value)} onKeyDown={onCmdKey} />
            <button type="submit" className="btn btn-primary" disabled={busy !== null || !command.trim()}>Run</button>
          </div>
          <p className="muted try-fine">Runs in the job’s folder. Commands can’t ask you questions here; for those, use Open terminal here. ↑ and ↓ bring back earlier commands.</p>
        </form>

        {v.cmd && (
          <div className="try-out">
            <div className="try-out-head">
              <b>{v.cmd.label ?? v.cmd.command}</b>
              <span className={`chip is-${v.cmd.status}`}>{v.cmd.status === 'failed' && v.cmd.exitCode != null ? `Failed (exit ${v.cmd.exitCode})` : STATUS_WORDS[v.cmd.status] ?? v.cmd.status}</span>
              {v.cmd.status === 'running' && v.cmd.stoppable && btn('stop-cmd', 'Stop', async () => { await act('stop-cmd'); }, 'btn btn-danger')}
              <button type="button" className="btn btn-quiet" onClick={copyOut}>Copy</button>
            </div>
            <pre ref={outRef} className="try-pre" tabIndex={0} aria-label="Command output">{v.cmd.output}</pre>
          </div>
        )}
        {v.server && (
          <details className="try-log">
            <summary>App log</summary>
            <pre ref={logRef} className="try-pre" tabIndex={0} aria-label="The app’s own output">{v.serverOutput}</pre>
          </details>
        )}
      </details>
    </div>
  );
}
