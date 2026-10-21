// "Try it on your computer": the job page panel for testing a job's work by hand.
// One big button sets up whatever is missing and starts the app on the job's own port; the steps
// underneath show each part (settings file, database, app) with its own button; quick commands, a
// command box and the output sit below. The panel fetches its own state and updates live.

import { $, esc, when, prefs, getJson, postJson, toast, modal } from './ui.js';

let panel = null; // { slug, el, view, wasRunning }
let refreshTimer = null;

const STATUS_WORDS = { running: 'Running…', done: 'Finished', failed: 'Failed', stopped: 'Stopped' };
const short = (p) => String(p ?? '').replace(/^\/Users\/[^/]+/, '~');
const list = (names) => names.map((n) => `<code>${esc(n)}</code>`).join(', ');

export async function mountLocal(slug, el) {
  panel = { slug, el, view: null, wasRunning: false };
  el.innerHTML = `<div class="lc-head"><h3>Try it on your computer</h3><p class="muted">Run this job’s branch from its own folder, next to your main app, and click around yourself.</p></div>
    <div id="lc-body"><p class="muted">Looking at the job’s folder…</p></div>`;
  bind(el);
  await load();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if (panel?.el.isConnected) load(); else clearInterval(refreshTimer); }, 15000);
}

/** Live events from the server: output chunks and "something changed". */
export function onLocalEvent(type, data) {
  if (!panel?.el.isConnected || data.slug !== panel.slug) return;
  if (type === 'local-state') { clearTimeout(panel.soon); panel.soon = setTimeout(load, 200); return; }
  const pre = $(data.stream === 'server' ? '#lc-server-log' : '#lc-out-pre', panel.el);
  if (pre) append(pre, data.chunk);
}

function append(pre, text) {
  const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  pre.textContent = (pre.textContent + text).slice(-200000);
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

async function load(fresh = false) {
  if (!panel) return;
  try {
    const v = await getJson(`/api/job/${encodeURIComponent(panel.slug)}/local${fresh ? '?fresh=1' : ''}`);
    if (!panel || v.slug !== panel.slug) return;
    const ready = v.server?.status === 'running';
    if (ready && !panel.wasRunning && panel.view) toast(`The app is ready: <a href="${esc(v.url)}" target="_blank" rel="noopener">open ${esc(v.url)} ↗</a>`, { tone: 'good', timeout: 12000 });
    panel.wasRunning = ready;
    panel.view = v;
    render(v);
  } catch (err) {
    $('#lc-body', panel.el).innerHTML = `<p class="warn-text">${esc(err.message)}</p>`;
  }
}

// ---------- Rendering ----------

function render(v) {
  const body = $('#lc-body', panel.el);
  if (!v.available) { body.innerHTML = `<p class="muted">${esc(v.reason)}</p>`; return; }
  if (!$('#lc-steps', body)) body.innerHTML = skeleton(v);
  set('#lc-demo', v.demo ? '<p class="banner gbox">Demo mode: the buttons show what would happen; nothing runs.</p>' : '');
  set('#lc-where', whereHtml(v));
  set('#lc-steps', stepsHtml(v));
  set('#lc-go', goHtml(v));
  set('#lc-presets', presetsHtml(v));
  set('#lc-out-head', outHeadHtml(v));
  // Live chunks append while a command runs; the saved copy wins when a new one starts or it ends.
  const pre = $('#lc-out-pre', body);
  const out = v.cmd?.output ?? '';
  const id = v.cmd?.startedAt ?? null;
  if (pre._id !== id || (v.cmd?.status !== 'running' && pre.textContent !== out)) { pre.textContent = out; pre.scrollTop = pre.scrollHeight; pre._id = id; }
  $('#lc-out', body).hidden = !v.cmd;
  const log = $('#lc-server-log', body);
  const sid = v.server?.startedAt ?? null;
  if (log._id !== sid || (v.server?.status !== 'starting' && v.server?.status !== 'running' && log.textContent !== (v.serverOutput ?? ''))) { log.textContent = v.serverOutput ?? ''; log.scrollTop = log.scrollHeight; log._id = sid; }
  $('#lc-log', body).hidden = !v.server;
  const whereSel = $('[data-lc-where]', body);
  whereSel.closest('label').hidden = !v.app || v.app.rel === '.';
}

function set(sel, html) {
  const el = $(sel, panel.el);
  if (!el || el._html === html) return;
  const active = el.contains(document.activeElement) ? document.activeElement : null;
  const key = active ? ['data-lc', 'data-db', 'data-what', 'data-preset'].map((a) => active.getAttribute(a) ?? '').join('|') : null;
  const opened = [...el.querySelectorAll('details[open]')].map((d) => d.className);
  el.innerHTML = html;
  el._html = html;
  for (const d of el.querySelectorAll('details')) if (opened.includes(d.className)) d.open = true;
  if (key !== null) {
    const same = [...el.querySelectorAll('button, a, select, input')].find((x) => ['data-lc', 'data-db', 'data-what', 'data-preset'].map((a) => x.getAttribute(a) ?? '').join('|') === key);
    (same ?? el.querySelector('button, a, select, input'))?.focus();
  }
}

function skeleton(v) {
  return `<div id="lc-demo"></div>
    <div class="lc-where" id="lc-where"></div>
    <div class="lc-go" id="lc-go"></div>
    <ol class="lc-steps" id="lc-steps"></ol>
    <div class="lc-run">
      <div class="lc-presets" id="lc-presets"></div>
      <form class="lc-cmd" id="lc-cmd" autocomplete="off">
        <label class="lc-where-pick">Run in <select data-lc-where><option value="app">the app folder</option><option value="root">the whole repo</option></select></label>
        <div class="lc-cmd-row"><span class="lc-prompt" aria-hidden="true">$</span><input type="text" name="command" spellcheck="false" placeholder="Type a command, for example: npm test -- feedback" aria-label="Command to run in the job’s folder"><button class="btn primary" type="submit">Run</button></div>
        <p class="fineprint">Runs in the job’s folder. Commands can’t ask you questions here; for those, use <b>Open terminal here</b>. ↑ and ↓ bring back earlier commands.</p>
      </form>
      <div class="lc-out" id="lc-out" hidden><div class="lc-out-head" id="lc-out-head"></div><pre class="lc-pre" id="lc-out-pre" tabindex="0" aria-label="Command output" aria-live="off"></pre></div>
      <details class="lc-log" id="lc-log" hidden><summary>App log</summary><pre class="lc-pre" id="lc-server-log" tabindex="0" aria-label="The app’s own output"></pre></details>
    </div>`;
}

function whereHtml(v) {
  const dir = v.app?.dir ?? v.root;
  return `<span class="lc-folder" title="${esc(dir)}">📁 <code>${esc(short(dir))}</code></span>
    ${v.branch ? `<span>branch <code>${esc(v.branch)}</code></span>` : ''}
    ${v.port ? `<span>port <b>${esc(v.port)}</b></span>` : ''}
    <span class="lc-open">
      <button class="btn small" type="button" data-lc="open" data-what="terminal">Open terminal here</button>
      <button class="btn small ghost" type="button" data-lc="open" data-what="vscode">VS Code</button>
      <button class="btn small ghost" type="button" data-lc="open" data-what="finder">Finder</button>
      <label class="lc-term">in <select data-lc-term aria-label="Terminal app"><option${v.terminalApp === 'iTerm' ? ' selected' : ''}>iTerm</option><option${v.terminalApp === 'Terminal' ? ' selected' : ''}>Terminal</option></select></label>
    </span>`;
}

function goHtml(v) {
  if (!v.app) return '<p class="muted">No app to start here (no package.json with a “dev” script in the job’s folder). You can still run commands below.</p>';
  const s = v.server?.status;
  if (s === 'running') return `<a class="btn big primary" href="${esc(v.url)}" target="_blank" rel="noopener">Open the app ↗</a><p>Running at <a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.url)}</a>. ${signInWords(v)}</p>`;
  if (s === 'starting') return `<button class="btn big" type="button" disabled>Starting…</button><p>Starting the app on port ${esc(v.port)}. The first start takes a little while. A link appears here when it’s ready.</p>`;
  return `<button class="btn big primary" type="button" data-lc="go">▶ Try it</button><p>Sets up anything missing, starts the app on port ${esc(v.port)} and gives you the link. ${signInWords(v)}</p>`;
}

function signInWords(v) {
  if (v.env?.signInSkipped) return 'You’re signed in as an admin automatically; use “View as” in the app to test as someone else.';
  return '';
}

function step(state, n, title, text, actions = '') {
  const mark = state === 'ok' ? '✓' : state === 'busy' ? '…' : state === 'off' ? '–' : n;
  return `<li class="lc-step lc-${state}"><span class="lc-mark" aria-hidden="true">${mark}</span><div class="lc-step-text"><b>${esc(title)}</b><span>${text}</span></div><div class="lc-step-actions">${actions}</div></li>`;
}

function stepsHtml(v) {
  const out = [];
  // Steps are numbered as shown: with no database step the app is 2, not 3.
  const dbN = v.env ? 2 : 1;
  const appN = dbN + (v.db ? 1 : 0);
  if (v.env) {
    const e = v.env;
    const notes = e.notes.length ? `<br><span class="muted">${e.notes.map(esc).join(' ')}</span>` : '';
    if (!e.exists) {
      out.push(step('todo', 1, 'Settings file', e.sourceExists ? `Not set up yet. Copies your main folder’s <code>.env.local</code>, points it at port ${esc(v.port)} and skips sign-in.` : `Your main folder has no <code>.env.local</code> to copy. Create <code>${esc(e.file)}</code> yourself.`, e.sourceExists ? '<button class="btn small primary" type="button" data-lc="env">Set up</button>' : ''));
    } else if (e.ready) {
      out.push(step('ok', 1, 'Settings file', `Ready: port ${esc(v.port)}${e.signInSkipped ? ', sign-in skipped' : ''}.${notes}`, '<button class="btn small ghost" type="button" data-lc="env">Redo</button>'));
    } else {
      out.push(step('todo', 1, 'Settings file', `There, but not pointed at port ${esc(v.port)}${e.signInSkipped === false ? ' and sign-in isn’t skipped' : ''}.${notes}`, '<button class="btn small primary" type="button" data-lc="env">Fix it</button>'));
    }
  }
  if (v.db) out.push(dbStep(v.db, dbN));
  if (v.app) {
    const s = v.server;
    if (s?.status === 'running') out.push(step('ok', appN, 'App', `Running at <a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.url)}</a>.`, '<button class="btn small" type="button" data-lc="stop">Stop</button>'));
    else if (s?.status === 'starting') out.push(step('busy', appN, 'App', `Starting on port ${esc(v.port)}…`, '<button class="btn small" type="button" data-lc="stop">Stop</button>'));
    else out.push(step('todo', appN, 'App', s?.status === 'exited' ? 'It stopped by itself. The app log below says why.' : 'Not running.', '<button class="btn small primary" type="button" data-lc="start">Start</button>'));
  }
  return out.join('');
}

function dbStep(d, n = 2) {
  if (!d.available) return step('off', n, 'Database', esc(d.reason));
  if (d.busy) return step('busy', n, 'Database', `Switching ${esc(d.name)}… (progress is in the output below)`);
  if (d.gone) return step('todo', n, 'Database', `Your local database <code>${esc(d.name)}</code> isn’t there (a switch may have stopped half-way). The saved original is safe.`, '<button class="btn small primary" type="button" data-lc="db" data-db="original">Put the original back</button>');
  const now = d.matches?.kind === 'job'
    ? `Your local database was last matched to <b>${esc(d.matches.title ?? d.matches.slug)}</b>${d.matches.partial ? ' <span class="warn-text">(not finished)</span>' : ''}.`
    : d.matches?.kind === 'original' ? 'Your local database is the original.' : '';
  const conn = d.connections ? ` <span class="muted">${d.connections} connection${d.connections === 1 ? '' : 's'} open (probably your main app); switching needs them closed.</span>` : '';
  const back = d.original.exists ? `<button class="btn small ghost" type="button" data-lc="db" data-db="original">Put the original back</button>` : '';
  const more = d.original.exists ? `<details class="lc-more"><summary>More</summary><button class="linklike" type="button" data-lc="db" data-db="save-original">Make the database as it is now the new original</button><p class="fineprint">Original saved ${esc(when(d.original.savedAt))}.</p></details>` : '';
  if (d.missing.length) return step('todo', n, 'Database', `Missing this job’s database changes: ${list(d.missing)}. ${now}${conn}`, `<button class="btn small primary" type="button" data-lc="db" data-db="match">Match this job</button>${back}${more}`);
  const extra = d.extra.length ? ` It also has changes from elsewhere (${list(d.extra)}), which is usually fine for testing.` : '';
  return step('ok', n, 'Database', `Has everything this job needs.${extra} ${now}${conn}`, `${back}${more}`);
}

function presetsHtml(v) {
  if (!v.presets.length) return '';
  return `<p>Quick commands</p>${v.presets.map((p) => `<button class="chip-btn" type="button" data-lc="preset" data-preset="${esc(p.id)}" title="${esc(`${p.hint ? `${p.hint}. ` : ''}Runs: ${p.command}`)}">${esc(p.label)}</button>`).join('')}`;
}

function outHeadHtml(v) {
  const c = v.cmd;
  if (!c) return '';
  const tone = c.status === 'done' ? 'ok' : c.status === 'failed' ? 'bad' : c.status === 'running' ? 'busy' : '';
  const words = c.status === 'failed' && c.exitCode != null ? `Failed (exit ${esc(c.exitCode)})` : STATUS_WORDS[c.status] ?? esc(c.status);
  return `<b>${esc(c.label ?? c.command)}</b><span class="lc-badge lc-${tone}">${words}</span>
    <span class="lc-out-actions">${c.status === 'running' && c.stoppable ? '<button class="btn small danger" type="button" data-lc="stop-cmd">Stop</button>' : ''}<button class="btn small ghost" type="button" data-lc="copy">Copy</button></span>`;
}

// ---------- Actions ----------

async function act(slug, action, extra = {}) {
  return postJson(`/api/job/${encodeURIComponent(slug)}/local`, { action, ...extra });
}
const stillOn = (slug) => panel?.slug === slug && panel.el.isConnected;

function ask(html, buttons) {
  return new Promise((resolve) => {
    let answered = false;
    let close = null;
    const gone = () => { if (!answered) { answered = true; resolve('cancel'); close?.(); } };
    window.addEventListener('hashchange', gone, { once: true }); // leaving the page cancels the question
    const m = modal(`<div class="lc-ask">${html}<div class="modal-actions">${buttons.map((b) => `<button class="btn ${b.cls ?? ''}" type="button" data-answer="${esc(b.value)}">${esc(b.label)}</button>`).join('')}</div></div>`, {
      label: 'Please confirm', onClose: () => { window.removeEventListener('hashchange', gone); if (!answered) { answered = true; resolve('cancel'); } },
    });
    close = m.close;
    const box = m.box;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-answer]');
      if (!b) return;
      answered = true;
      resolve(b.dataset.answer);
      close();
    });
  });
}

function dbExplain(d, what) {
  const lose = 'Anything changed in the local database since the last switch (test data included) is lost.';
  const stop = 'Apps started from this page stop first. If your main app’s dev server is running, stop it (Ctrl+C in its terminal), or the switch waits and then gives up.';
  if (what === 'original') return `<h3>Put the original database back?</h3><p>Your local database <code>${esc(d.name)}</code> goes back to the original saved ${esc(when(d.original.savedAt))}.</p><ul><li>${stop}</li><li>${lose}</li></ul>`;
  if (what === 'save-original') return `<h3>Make this the new original?</h3><p>The saved original is replaced by <code>${esc(d.name)}</code> as it is right now, including any job changes it has. “Put the original back” then returns to this point.</p>`;
  return `<h3>Match your local database to this job?</h3><p>This job’s branch has database changes your local database doesn’t: ${list(d.missing)}.</p><ul>
    <li>${stop}</li>
    ${d.original.exists ? '' : `<li>First time only: your database is saved as it is now, as the original, before anything changes. That copy is never touched by switching.</li>`}
    <li>Your local database is rebuilt from the original, then this job’s changes are added.</li>
    <li>${lose} “Put the original back” returns to the original at any time.</li></ul>`;
}

async function runDb(slug, what) {
  const d = panel.view.db;
  const go = await ask(dbExplain(d, what), [{ label: what === 'match' ? 'Match this job' : what === 'original' ? 'Put it back' : 'Save as the original', value: 'yes', cls: 'primary' }, { label: 'Cancel', value: 'cancel', cls: 'ghost' }]);
  if (go !== 'yes' || !stillOn(slug)) return false;
  toast('Switching the database. Progress shows in the output.', { tone: 'info' });
  setTimeout(() => load(), 300);
  await act(slug, 'db', { db: what });
  toast('Database switched.', { tone: 'good' });
  return true;
}

async function tryIt(slug) {
  const v = panel.view;
  if (v.env && !v.env.ready) {
    if (!v.env.exists && !v.env.sourceExists) throw new Error('The app needs a .env.local and your main folder has none to copy.');
    const r = await act(slug, 'env');
    toast(r.copied ? 'Settings file copied from your main folder and pointed at this job’s port.' : 'Settings file updated for this job’s port.', { tone: 'good' });
  }
  if (v.db?.available && v.db.missing.length && !v.db.busy) {
    const choice = await ask(`${dbExplain(v.db, 'match')}<p>You can also start without switching: pages that use the new database changes will then fail.</p>`,
      [{ label: 'Match and start', value: 'match', cls: 'primary' }, { label: 'Start without switching', value: 'skip' }, { label: 'Cancel', value: 'cancel', cls: 'ghost' }]);
    if (choice === 'cancel' || !stillOn(slug)) return;
    if (choice === 'match') {
      toast('Switching the database first. Progress shows in the output.', { tone: 'info' });
      setTimeout(() => load(), 300);
      await act(slug, 'db', { db: 'match' });
    }
  }
  if (!stillOn(slug)) return;
  await act(slug, 'start');
  toast('Starting the app. The Open button lights up when it’s ready.', { tone: 'info' });
}

function history() { try { return JSON.parse(prefs.get('localHistory', '[]')); } catch { return []; } }

function bind(el) {
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lc]');
    if (!b || !panel) return;
    const what = b.dataset.lc;
    const slug = panel.slug;
    if (what === 'copy') {
      try { await navigator.clipboard.writeText($('#lc-out-pre', el).textContent); toast('Output copied.', { tone: 'good' }); } catch { toast('Couldn’t copy. Select the text instead.', { tone: 'bad' }); }
      return;
    }
    b.disabled = true;
    try {
      if (what === 'go') await tryIt(slug);
      else if (what === 'env') { const r = await act(slug, 'env'); toast(r.copied ? 'Settings file copied from your main folder and pointed at this job’s port.' : 'Settings file updated.', { tone: 'good' }); }
      else if (what === 'start') { await act(slug, 'start'); toast('Starting the app. The Open button lights up when it’s ready.', { tone: 'info' }); }
      else if (what === 'stop') { await act(slug, 'stop'); toast('Stopping the app.'); }
      else if (what === 'stop-cmd') await act(slug, 'stop-cmd');
      else if (what === 'preset') await act(slug, 'run', { preset: b.dataset.preset });
      else if (what === 'open') {
        const r = await act(slug, 'open', { what: b.dataset.what });
        toast(b.dataset.what === 'terminal' ? `Opened a terminal in ${esc(short(r.dir))}.` : 'Opened.', { tone: 'good' });
      } else if (what === 'db') await runDb(slug, b.dataset.db);
    } catch (err) {
      toast(esc(err.message), { tone: 'bad', timeout: 10000 });
    } finally {
      b.disabled = false;
      if (stillOn(slug)) load(what === 'db');
    }
  });
  el.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-lc-term]')) return;
    try { await act(panel.slug, 'terminal-app', { name: e.target.value }); toast(`“Open terminal here” now uses ${esc(e.target.value)}.`, { tone: 'good' }); } catch (err) { toast(esc(err.message), { tone: 'bad' }); }
  });
  el.addEventListener('submit', async (e) => {
    if (!e.target.matches('#lc-cmd')) return;
    e.preventDefault();
    const input = e.target.elements.command;
    const command = input.value.trim();
    if (!command) return;
    const where = $('[data-lc-where]', el).value;
    const slug = panel.slug;
    try {
      await act(slug, 'run', { command, where });
      prefs.set('localHistory', JSON.stringify([command, ...history().filter((c) => c !== command)].slice(0, 30)));
      input.value = '';
      input._at = -1;
      load();
    } catch (err) { toast(esc(err.message), { tone: 'bad' }); }
  });
  el.addEventListener('keydown', (e) => {
    const input = e.target;
    if (input.name !== 'command' || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const h = history();
    if (!h.length) return;
    e.preventDefault();
    input._at = Math.max(-1, Math.min(h.length - 1, (input._at ?? -1) + (e.key === 'ArrowUp' ? 1 : -1)));
    input.value = input._at < 0 ? '' : h[input._at];
  });
}
