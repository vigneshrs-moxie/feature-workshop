import { character, STAGE_CHARACTER } from './characters.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Per-viewer preferences. Storage can be unavailable (private windows); the page works without it.
const prefs = {
  get(key, fallback) { try { return localStorage.getItem(`workshop.${key}`) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`workshop.${key}`, value); } catch { /* ignore */ } },
};

let meta = null;
let board = null;

// ---------- Clock ----------

function startClock() {
  const timeEl = $('#clock-time');
  const dateEl = $('#clock-date');
  const labelEl = $('#clock-label');
  let use24 = prefs.get('clock24', 'no') === 'yes';
  const pad = (n) => String(n).padStart(2, '0');
  const render = () => {
    const now = new Date();
    let h = now.getHours();
    let ampm = '';
    if (!use24) { ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; }
    timeEl.innerHTML = `${use24 ? pad(h) : h}<span class="colon">:</span>${pad(now.getMinutes())}<span class="colon">:</span>${pad(now.getSeconds())}${ampm ? `<span class="ampm">${ampm}</span>` : ''}`;
    timeEl.dateTime = now.toISOString();
    dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    labelEl.textContent = `Local time ${now.toLocaleTimeString(undefined, { hour12: !use24 })}. Click to switch to ${use24 ? '12' : '24'}-hour time.`;
  };
  $('#clock').addEventListener('click', () => { use24 = !use24; prefs.set('clock24', use24 ? 'yes' : 'no'); render(); });
  render();
  // Tick on the second boundary so the seconds stay in step with the system clock.
  setTimeout(() => { render(); setInterval(render, 1000); }, 1000 - (Date.now() % 1000));
}

// ---------- Theme ----------

function startTheme() {
  const btn = $('#theme');
  const order = ['auto', 'light', 'dark'];
  const names = { auto: 'automatic (follows your system)', light: 'daylight', dark: 'evening lamplight' };
  let theme = prefs.get('theme', 'auto');
  const apply = () => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    btn.setAttribute('aria-label', `Theme: ${names[theme]}. Click to change.`);
    btn.title = `Theme: ${names[theme]}`;
  };
  btn.addEventListener('click', () => { theme = order[(order.indexOf(theme) + 1) % order.length]; prefs.set('theme', theme); apply(); });
  apply();
}

// ---------- Formatting ----------

function since(isoTime) {
  if (!isoTime) return '';
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(isoTime)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ${mins % 60 ? `${mins % 60} min` : ''}`.trim();
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}
const usd = (n, source) => {
  if (!n) return source === 'none' ? 'no cost yet' : '$0.00';
  const s = n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;
  return source === 'estimate' ? `≈${s}` : s;
};
const stageLabel = (id) => meta?.stages.find((s) => s.id === id)?.label ?? 'Not started';
const stageTip = (id) => meta?.stages.find((s) => s.id === id)?.tip ?? '';
const agentName = (type) => meta?.agents[type]?.name ?? type;

const WAITING_TEXT = {
  answers: 'Needs your answers',
  approval: 'Needs your go-ahead',
  permission: 'Needs a permission click',
};
const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const lower1 = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const who = (a) => (a.who === 'conductor' ? 'Foreman' : a.name);

// ---------- Headline numbers ----------

function statTile(label, value, sub, tone = '', tip = '') {
  return `<div class="stat ${tone}"${tip ? ` title="${esc(tip)}"` : ''}><span class="stat-label">${esc(label)}</span><span class="stat-value">${value}</span><span class="stat-sub">${sub}</span></div>`;
}

function renderStats(s) {
  return `<section class="stats" aria-label="Headline numbers">
    ${statTile('Spent today', esc(usd(s.today.usd, 'estimate')), `${esc(fmtTokens(s.today.tokens))} tokens`, '', 'All Claude Code sessions on this computer since midnight, estimated from token counts')}
    ${statTile('Last 7 days', esc(usd(s.week.usd, 'estimate')), `${esc(fmtTokens(s.week.tokens))} tokens`, '', 'All Claude Code sessions on this computer, estimated from token counts')}
    ${statTile('Needs you', String(s.needsYou), s.needsYou ? 'waiting on your answer or go-ahead' : 'nothing waiting', s.needsYou ? 'tone-needs' : '')}
    ${statTile('Working now', String(s.workingAgents), `agent${s.workingAgents === 1 ? '' : 's'} on ${s.workingFeatures} feature${s.workingFeatures === 1 ? '' : 's'}`, s.workingAgents ? 'tone-working' : '')}
    ${statTile('Possibly stuck', String(s.stalled), s.stalled ? 'quiet mid-task: check the terminal' : 'none', s.stalled ? 'tone-blocked' : '', 'An agent asked to use a tool and nothing has happened since. Often a permission prompt waiting in a terminal.')}
    ${statTile('On the bench', String(s.inProgress), `${s.done} done · ${esc(usd(s.featuresUsd))} all-time`)}
  </section>`;
}

// ---------- Lanes ----------

function statusLine(f) {
  if (f.needsYou) {
    const what = f.waitingFor === 'answers' && f.firstQuestion ? f.firstQuestion : f.headline ?? f.nextProposed;
    return { tone: 'needs', title: WAITING_TEXT[f.waitingFor] ?? 'Waiting for you', detail: what, time: since(f.waitingSince) };
  }
  const stalled = f.nowDoing.filter((a) => a.state === 'stalled');
  if (stalled.length) {
    const a = stalled[0];
    return { tone: 'blocked', title: `${who(a)} may be stuck`, detail: `Asked to ${lower1(a.doing) || 'use a tool'} and has been quiet since. Check its terminal for a permission prompt.`, time: since(a.lastAt) };
  }
  const running = f.nowDoing.filter((a) => a.state === 'running');
  if (running.length > 1) {
    const workers = running.filter((a) => a.who !== 'conductor');
    return { tone: 'working', title: `${workers.length || running.length} working`, detail: workers.map(who).join(', ') || null, time: since(running[0].since) };
  }
  if (running.length) {
    const a = running[0];
    return { tone: 'working', title: `${who(a)} is working`, detail: a.doing, time: since(a.since) };
  }
  if (f.stageState === 'working') return { tone: 'working', title: 'Working', detail: f.nextProposed, time: '' };
  if (f.stageState === 'blocked') return { tone: 'blocked', title: 'Blocked', detail: f.nextProposed, time: '' };
  if (f.stageState === 'done') return { tone: 'done', title: 'Done', detail: null, time: '' };
  return { tone: 'idle', title: 'Paused', detail: f.nextProposed ? `Next: ${f.nextProposed}` : 'Nothing running', time: '' };
}

function track(f, line) {
  const ids = meta.stages.map((s) => s.id);
  const at = ids.indexOf(f.stage);
  const running = f.nowDoing.filter((a) => a.who !== 'conductor');
  return `<ol class="track" aria-label="Stages">${meta.stages.map((st, i) => {
    let cls = 'todo';
    let label = 'not started';
    if (f.skipped.includes(st.id)) { cls = 'skipped'; label = 'skipped on this route'; }
    else if (i === at && f.stageState !== 'done') { cls = `current tone-${line.tone}`; label = 'current stage'; }
    else if (at > -1 && (i < at || (i === at && f.stageState === 'done'))) { cls = 'done'; label = 'done'; }
    let body = '';
    if (cls.startsWith('current')) {
      const crew = running.length ? running.slice(0, 3) : [{ who: STAGE_CHARACTER[st.id] ?? 'conductor', state: null }];
      const state = (a) => (a.state === 'running' ? 'working' : line.tone === 'blocked' ? 'idle' : line.tone === 'needs' ? 'idle' : 'asleep');
      body = `<span class="crew n${crew.length}">${crew.map((a) => character(a.who, { state: state(a), size: 44, label: `${agentName(a.who)}${a.state === 'running' ? ', working' : ''}` })).join('')}</span>${line.tone === 'needs' ? '<span class="bubble" aria-hidden="true">!</span>' : line.tone === 'blocked' ? '<span class="bubble warn" aria-hidden="true">?</span>' : ''}`;
    } else if (cls === 'done' && i === at) {
      body = character(STAGE_CHARACTER[st.id] ?? 'conductor', { state: 'celebrating', size: 40, label: 'Finished' });
    }
    return `<li class="slot ${cls}" title="${esc(`${st.label}: ${label}. ${st.tip}`)}"><span class="pip">${body}</span><span class="slot-name">${esc(st.label)}</span></li>`;
  }).join('')}</ol>`;
}

function lane(f) {
  const line = statusLine(f);
  const flags = [];
  if (f.questions) flags.push(`${f.questions} question${f.questions === 1 ? '' : 's'}`);
  if (f.unconfirmed) flags.push(`${f.unconfirmed} decided for you`);
  const kind = `<span class="chip kind-${f.kind}" title="${f.kindGuessed ? 'Guessed from the branch or folder name' : ''}">${f.kind === 'bug' ? 'Bug' : 'Feature'}</span>`;
  const route = f.route ? `<span class="chip" title="${f.route === 'small' ? 'Small: no refine interview' : 'Large: includes the refine interview'}">${f.route === 'small' ? 'Small' : 'Large'}</span>` : '';
  return `<a class="lane tone-${line.tone}" href="#/feature/${encodeURIComponent(f.slug)}">
    <div class="lane-id">
      <div class="lane-chips">${kind}${route}</div>
      <h3>${esc(f.title)}</h3>
      <div class="lane-cost" title="${f.cost.source === 'estimate' ? 'Estimated from token counts' : f.cost.source === 'claude-code' ? 'Claude Code’s own cost figure' : ''}">${esc(usd(f.cost.totalUsd, f.cost.source))}${flags.length ? ` · <span class="flag">${esc(flags.join(' · '))}</span>` : ''}</div>
    </div>
    ${track(f, line)}
    <div class="lane-status status-${line.tone}">
      <span class="status-title"><span class="dot"></span>${esc(line.title)}${line.time ? `<small>${esc(line.time)}</small>` : ''}</span>
      ${line.detail ? `<span class="status-detail">${esc(line.detail)}</span>` : ''}
    </div>
  </a>`;
}

const HOWTO = `<details class="howto" id="howto">
  <summary>How this works</summary>
  <div class="howto-body">
    <div>${character('conductor', { size: 40 })}<p><strong>You talk to the Foreman.</strong> Run <code>/feature</code> in Claude Code. The Foreman (the conductor) hands each stage to a specialist and checks their work.</p></div>
    <div>${character('feature-planner', { size: 40 })}<p><strong>Each row is one feature or bug.</strong> Its stages run left to right; the character stands at the current stage. Nothing moves on until you say go.</p></div>
    <div>${character('feature-reviewer', { size: 40 })}<p><strong>Orange rows need you</strong> (answers or a go-ahead). <strong>Yellow</strong> ones may be stuck, often on a permission prompt in a terminal.</p></div>
    <div>${character('feature-implementer', { size: 40, state: 'working' })}<p><strong>Moving characters are working now.</strong> Sleeping ones are paused. This page only reads files; it never changes your code.</p></div>
  </div>
</details>`;

function renderBoard() {
  const app = $('#app');
  const list = board.features;
  const howOpen = prefs.get('howto', list.length ? 'closed' : 'open') === 'open';

  // Group by project; projects with something needing you come first (the list is already sorted).
  const projects = [];
  for (const f of list) {
    let p = projects.find((x) => x.name === f.project.name);
    if (!p) { p = { name: f.project.name, path: f.project.path, features: [] }; projects.push(p); }
    p.features.push(f);
  }
  const body = list.length
    ? projects.map((p) => {
      const needs = p.features.filter((f) => f.needsYou).length;
      const cost = p.features.reduce((a, f) => a + f.cost.totalUsd, 0);
      return `<section class="project" aria-label="${esc(p.name)}">
        <div class="project-head"><h2>${esc(p.name)}</h2><span class="count">${p.features.length} item${p.features.length === 1 ? '' : 's'}${needs ? ` · <strong class="flag">${needs} need${needs === 1 ? 's' : ''} you</strong>` : ''} · ${esc(usd(cost))}</span>${p.path ? `<code class="project-path">${esc(p.path)}</code>` : ''}</div>
        <div class="lanes">${p.features.map(lane).join('')}</div>
      </section>`;
    }).join('')
    : `<div class="empty">${character('conductor', { size: 84, state: 'asleep' })}<h2>The bench is empty</h2><p>No features yet in <code>${esc(meta.featuresDir)}</code>. Start one in Claude Code with <code>/feature &lt;one-line description&gt;</code> and it will appear here.</p></div>`;

  app.innerHTML = `${meta.demo ? '<p class="banner">Demo mode: these features are invented.</p>' : ''}${renderStats(board.stats)}${HOWTO.replace('<details class="howto"', `<details class="howto"${howOpen ? ' open' : ''}`)}${body}
    <footer class="site-footer"><span>≈ = estimated from token counts</span><span>Reading <code>${esc(meta.featuresDir)}</code></span><span>Prices as of ${esc(meta.prices.asOf)}</span><span>Updated ${esc(new Date(board.generatedAt).toLocaleTimeString())}</span></footer>`;
  $('#howto').addEventListener('toggle', (e) => prefs.set('howto', e.target.open ? 'open' : 'closed'));
}

function renderFeaturePlaceholder(slug) {
  const f = board.features.find((x) => x.slug === slug);
  const app = $('#app');
  if (!f) {
    app.innerHTML = `<div class="empty">${character('feature-investigator', { size: 84 })}<h2>No feature called “${esc(slug)}”</h2><p><a href="#/">Back to the board</a></p></div>`;
    return;
  }
  app.innerHTML = `<div class="empty">${character(STAGE_CHARACTER[f.stage] ?? 'conductor', { size: 84 })}<h2>${esc(f.title)}</h2><p>The full feature page (timeline, brief, artifacts, code, costs) arrives in the next milestone.</p><p><a href="#/">Back to the board</a></p></div>`;
}

function updateCounter() {
  const n = board.needsYou;
  $('#needs-num').textContent = n;
  $('#needs-label').textContent = n === 1 ? 'needs you' : 'need you';
  $('#needs-counter').dataset.count = n;
  document.title = n ? `(${n}) Feature Workshop` : 'Feature Workshop';
}

function route() {
  if (!board || !meta) return;
  const m = /^#\/feature\/(.+)$/.exec(location.hash);
  if (m) renderFeaturePlaceholder(decodeURIComponent(m[1]));
  else renderBoard();
}

async function refresh() {
  try {
    const res = await fetch('/api/features');
    if (!res.ok) throw new Error((await res.json()).error);
    board = await res.json();
    updateCounter();
    route();
  } catch (err) {
    $('#app').innerHTML = `<div class="empty">${character('conductor', { size: 84, state: 'asleep' })}<h2>Can’t read the workshop right now</h2><p>${esc(err.message || 'The dashboard server may have stopped. Start it again with npm start.')}</p></div>`;
  }
}

async function init() {
  startClock();
  startTheme();
  $('#foreman').innerHTML = character('conductor', { size: 40, label: 'Foreman' });
  meta = await (await fetch('/api/meta')).json();
  await refresh();
  window.addEventListener('hashchange', route);
  // Live updates when files change; a slow poll keeps "how long" times fresh and covers missed events.
  const events = new EventSource('/api/events');
  events.addEventListener('change', refresh);
  setInterval(refresh, 30000);
}

init();
