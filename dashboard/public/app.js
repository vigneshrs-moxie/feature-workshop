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

function stateLine(f) {
  if (f.needsYou) {
    return `<div class="state needs"><span class="dot"></span>${esc(WAITING_TEXT[f.waitingFor] ?? 'Waiting for you')}<small>${esc(since(f.waitingSince))}</small></div>`;
  }
  if (f.working || f.stageState === 'working') {
    const w = f.nowDoing[0];
    const who = w ? (w.who === 'conductor' ? 'Foreman' : w.name) : 'Working';
    return `<div class="state working"><span class="dot"></span>${esc(who)}<span class="doing">${esc(w?.doing ? `· ${w.doing}` : '')}</span><small>${esc(w ? since(w.since) : '')}</small></div>`;
  }
  if (f.stageState === 'blocked') return `<div class="state blocked"><span class="dot"></span>Blocked<span class="doing">${esc(f.nextProposed ? `· ${f.nextProposed}` : '')}</span></div>`;
  if (f.stageState === 'done') return '<div class="state done"><span class="dot"></span>Done</div>';
  return '<div class="state unknown"><span class="dot"></span>Paused · nothing running</div>';
}

function rail(f) {
  const ids = meta.stages.map((s) => s.id);
  const at = ids.indexOf(f.stage);
  const skipped = f.route === 'small' ? ['refine'] : [];
  return `<div class="rail" aria-hidden="true">${ids.map((id, i) => {
    let cls = '';
    if (skipped.includes(id)) cls = 'skipped';
    else if (i === at) cls = `current${f.working || f.stageState === 'working' ? ' working' : ''}`;
    else if (at > -1 && (i < at || f.stageState === 'done')) cls = 'done';
    return `<i class="${cls}" title="${esc(meta.stages[i].label)}"></i>`;
  }).join('')}</div>`;
}

function ticket(f) {
  const running = f.nowDoing.find((w) => w.who !== 'conductor') ?? f.nowDoing[0];
  const who = running?.who ?? STAGE_CHARACTER[f.stage] ?? 'conductor';
  const charState = running ? 'working' : f.stageState === 'done' ? 'celebrating' : f.needsYou ? 'idle' : 'asleep';
  const flags = [];
  if (f.questions) flags.push(`<span class="flag">${f.questions} question${f.questions === 1 ? '' : 's'}</span>`);
  if (f.unconfirmed) flags.push(`<span class="flag">${f.unconfirmed} decided for you</span>`);
  const route = f.route ? `<span class="chip" title="${f.route === 'small' ? 'Small enhancement: no refine interview' : 'Large feature: includes the refine interview'}">${f.route === 'small' ? 'Small' : 'Large'}</span>` : '';
  return `<a class="ticket${f.needsYou ? ' needs-you' : ''}" href="#/feature/${encodeURIComponent(f.slug)}">
    <span class="avatar">${character(who, { state: charState, size: 58, label: `${agentName(who)}${running ? ', working' : ''}` })}</span>
    <h3>${esc(f.title)}</h3>
    <div class="meta">${route}<span class="chip" title="${esc(stageTip(f.stage))}">${esc(stageLabel(f.stage))}</span></div>
    ${rail(f)}
    ${stateLine(f)}
    <div class="footer"><span class="flags">${flags.join('')}</span><span title="${f.cost.source === 'estimate' ? 'Estimated from token counts' : f.cost.source === 'claude-code' ? 'Claude Code’s own cost figure' : ''}">${esc(usd(f.cost.totalUsd, f.cost.source))}</span></div>
  </a>`;
}

const HOWTO = `<details class="howto" id="howto">
  <summary>How this works</summary>
  <div class="howto-body">
    <div>${character('conductor', { size: 40 })}<p><strong>You talk to the Foreman.</strong> Run <code>/feature</code> in Claude Code. The Foreman (the conductor) hands each stage to a specialist and checks their work.</p></div>
    <div>${character('feature-planner', { size: 40 })}<p><strong>Stages, with a gate after each.</strong> Spec, investigate, plan, build, test, review, then three PRs. Nothing moves on until you say go.</p></div>
    <div>${character('feature-reviewer', { size: 40 })}<p><strong>Pinned tickets need you.</strong> They are waiting for your answers or go-ahead. Open one to read the brief.</p></div>
    <div>${character('feature-implementer', { size: 40, state: 'working' })}<p><strong>Moving characters are working now.</strong> Sleeping ones are paused. This page only reads files; it never changes your code.</p></div>
  </div>
</details>`;

function renderBoard() {
  const app = $('#app');
  const list = board.features;
  const needs = list.filter((f) => f.needsYou);
  const working = list.filter((f) => !f.needsYou && (f.working || f.stageState === 'working'));
  const rest = list.filter((f) => !needs.includes(f) && !working.includes(f));

  const howOpen = prefs.get('howto', list.length ? 'closed' : 'open') === 'open';
  const bench = (title, items, hint) => items.length
    ? `<section class="bench" aria-label="${esc(title)}"><div class="bench-head"><h2>${esc(title)}</h2><span class="count">${items.length}${hint ? ` · ${esc(hint)}` : ''}</span></div><div class="tickets">${items.map(ticket).join('')}</div></section>`
    : '';

  const body = list.length
    ? bench('Needs you', needs, 'longest wait first') + bench('In the works', working) + bench('Paused, blocked or done', rest)
    : `<div class="empty">${character('conductor', { size: 84, state: 'asleep' })}<h2>The bench is empty</h2><p>No features yet in <code>${esc(meta.featuresDir)}</code>. Start one in Claude Code with <code>/feature &lt;one-line description&gt;</code> and it will appear here.</p></div>`;

  app.innerHTML = `${meta.demo ? '<p class="banner">Demo mode: these features are invented.</p>' : ''}${HOWTO.replace('<details class="howto"', `<details class="howto"${howOpen ? ' open' : ''}`)}${body}
    <footer class="site-footer"><span>All features: ${esc(usd(board.totalUsd))}${list.some((f) => f.cost.source === 'estimate') ? ' (≈ = estimated from tokens)' : ''}</span><span>Reading <code>${esc(meta.featuresDir)}</code></span><span>Prices as of ${esc(meta.prices.asOf)}</span><span>Updated ${esc(new Date(board.generatedAt).toLocaleTimeString())}</span></footer>`;
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
