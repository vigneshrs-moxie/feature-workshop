import { sprite, icon, STAGE_CHARACTER } from './sprites.js';
import { pixelText } from './pixelfont.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Per-viewer preferences. Storage can be unavailable (private windows); the page works without it.
const prefs = {
  get(key, fallback) { try { return localStorage.getItem(`workshop.${key}`) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`workshop.${key}`, value); } catch { /* ignore */ } },
};

let meta = null;
let board = null;

// ---------- Clock (Game Boy style) ----------

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
    const colon = `<span class="colon">${pixelText(':', { px: 3, label: ':' })}</span>`;
    timeEl.innerHTML = `${pixelText(use24 ? pad(h) : String(h), { px: 3 })}${colon}${pixelText(pad(now.getMinutes()), { px: 3 })}${colon}${pixelText(pad(now.getSeconds()), { px: 3 })}${ampm ? `<span class="ampm">${pixelText(ampm, { px: 1.6 })}</span>` : ''}`;
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
  const names = { auto: 'automatic (follows your system)', light: 'day', dark: 'night' };
  // ?theme=light|dark previews a theme without saving it.
  const forced = new URLSearchParams(location.search).get('theme');
  let theme = order.includes(forced) ? forced : prefs.get('theme', 'auto');
  const apply = () => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    btn.setAttribute('aria-label', `Theme: ${names[theme]}. Click to change.`);
    btn.title = `Theme: ${names[theme]}`;
  };
  btn.addEventListener('click', () => { theme = order[(order.indexOf(theme) + 1) % order.length]; prefs.set('theme', theme); apply(); });
  apply();
}

// ---------- Words ----------

const since = (isoTime) => (isoTime ? duration(Date.now() - Date.parse(isoTime)) : '');
function duration(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h${mins % 60 ? ` ${mins % 60} min` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}
const usd = (n, source) => {
  if (!n) return '$0';
  const s = n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;
  return source === 'estimate' ? `≈${s}` : s;
};
const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const agentName = (type) => (type === 'conductor' ? 'Foreman' : meta?.agents[type]?.name ?? type);
const modelLabel = (m) => (m ? m.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^\w/, (c) => c.toUpperCase()) : 'not set');

const SHORT = { spec: 'Spec', refine: 'Refine', investigate: 'Invest.', 'spec-update': 'Update', plan: 'Plan', implement: 'Build', test: 'Test', review: 'Review', pr1: 'PR 1', pr2: 'PR 2', 'staging-qa': 'QA', pr3: 'PR 3' };
const VERB = {
  conductor: 'is checking the work',
  'feature-spec-writer': 'is writing the spec',
  'feature-investigator': 'is investigating the code',
  'feature-planner': 'is drawing up the plan',
  'feature-implementer': 'is building',
  'feature-tester': 'is running the checks',
};
const verbFor = (type) => VERB[type] ?? 'is reviewing';

// ---------- What is going on with a job ----------

const PILL = {
  needs: 'Your turn!',
  working: 'Working',
  blocked: 'Blocked',
  done: 'Done',
  idle: 'Resting',
};

function situation(f) {
  const running = f.nowDoing;
  const workers = running.filter((a) => a.who !== 'conductor');
  const quiet = running.find((a) => a.quietMs);
  const hint = quiet
    ? `${agentName(quiet.who)} has been quiet for ${duration(quiet.quietMs)}. If it’s waiting for a permission click, that’s in its terminal.`
    : null;
  if (f.needsYou) {
    const main = f.waitingFor === 'answers' ? `${plural(f.questions || 1, 'question')} for you` : f.waitingFor === 'permission' ? 'A permission needs your click' : 'Waiting for your go-ahead';
    const detail = (f.waitingFor === 'answers' && f.firstQuestion) || f.headline || (f.nextProposed ? `Next: ${f.nextProposed}` : null);
    return { tone: 'needs', main: `<b>Your turn!</b> ${esc(main)}`, detail, time: `waiting ${since(f.waitingSince)}`, crew: [], bubble: 'bang' };
  }
  if (workers.length > 1) {
    return { tone: 'working', main: `<b>${workers.length} crew</b> are at work!`, detail: workers.map((a) => agentName(a.who)).join(', '), time: since(workers[0].since), crew: workers, bubble: 'dots', hint };
  }
  if (running.length) {
    const a = workers[0] ?? running[0];
    return { tone: 'working', main: `<b>${esc(agentName(a.who))}</b> ${esc(verbFor(a.who))}!`, detail: a.doing, time: since(a.since), crew: [a], bubble: quiet ? 'quiet' : 'dots', hint };
  }
  if (f.stageState === 'working') return { tone: 'working', main: '<b>The crew</b> is working', detail: f.nextProposed, crew: [], bubble: 'dots' };
  if (f.stageState === 'blocked') return { tone: 'blocked', main: '<b>Blocked:</b> waiting on someone else', detail: f.nextProposed, crew: [], bubble: null };
  if (f.stageState === 'done') return { tone: 'done', main: '<b>Badge earned!</b> This job is done.', detail: null, crew: [], bubble: 'badge' };
  return { tone: 'idle', main: '<b>Resting.</b> Nothing is running.', detail: f.nextProposed ? `Next: ${f.nextProposed}` : null, crew: [], bubble: 'zzz' };
}

const BUBBLES = {
  bang: '<span class="bubble bang" aria-hidden="true">!</span>',
  dots: '<span class="bubble dots" aria-hidden="true"><i></i><i></i><i></i></span>',
  quiet: '<span class="bubble quiet" aria-hidden="true">…?</span>',
  zzz: '<span class="bubble zzz" aria-hidden="true">Zz</span>',
  badge: '<span class="bubble badge" aria-hidden="true">★</span>',
};

const SPRITE_STATE = { working: 'working', needs: 'waiting', done: 'celebrating', blocked: 'idle', idle: 'asleep' };

function map(f, sit) {
  const ids = meta.stages.map((s) => s.id);
  const at = f.stageState === 'done' ? ids.length - 1 : ids.indexOf(f.stage);
  const costTip = f.cost.source === 'estimate' ? 'Estimated from token counts' : f.cost.source === 'claude-code' ? 'Claude Code’s own cost figure' : 'No sessions found yet';
  return `<div class="map">
    <span class="coins" title="${esc(`Cost so far. ${costTip}`)}">${icon('coin', 16)}${pixelText(usd(f.cost.totalUsd, f.cost.source), { px: 2 })}</span>
    <ol class="stations" aria-label="Stages">${meta.stages.map((st, i) => {
      let cls = 'todo';
      let label = 'not started yet';
      if (f.skipped.includes(st.id)) { cls = 'skipped'; label = 'skipped on this route'; }
      else if (i === at) { cls = f.stageState === 'done' ? 'done current' : 'current'; label = 'current stage'; }
      else if (at > -1 && i < at) { cls = 'done'; label = 'done'; }
      let actor = '';
      if (i === at) {
        const crew = sit.crew.length ? sit.crew.slice(0, 3).map((a) => a.who) : [STAGE_CHARACTER[st.id] ?? 'conductor'];
        const state = SPRITE_STATE[sit.tone];
        actor = `<span class="actor n${crew.length}">${crew.map((w) => sprite(w, { state, size: 72, label: `${agentName(w)}${state === 'working' ? ', working' : ''}` })).join('')}${sit.bubble ? BUBBLES[sit.bubble] : ''}${state === 'working' ? '<span class="puffs" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}</span>`;
      }
      return `<li class="station ${cls}" title="${esc(`${st.label}: ${label}. ${st.tip}`)}">${actor}<span class="tile"></span><span class="name">${esc(SHORT[st.id])}</span></li>`;
    }).join('')}</ol>
  </div>`;
}

function card(f) {
  const sit = situation(f);
  const type = `<span class="type type-${f.kind}" title="${f.kindGuessed ? 'Guessed from the branch or folder name' : ''}">${f.kind === 'bug' ? 'Bug' : 'Feature'}</span>`;
  const size = f.route ? `<span class="type type-${f.route}" title="${f.route === 'small' ? 'Small: no refine interview' : 'Large: includes the refine interview'}">${f.route}</span>` : '';
  const flags = f.unconfirmed ? `<p class="say-flag">★ ${esc(plural(f.unconfirmed, 'thing'))} decided for you. Please check.</p>` : '';
  return `<a class="route gbox state-${sit.tone}" href="#/feature/${encodeURIComponent(f.slug)}" data-key="${esc(f.slug)}">
    <div class="route-head">
      <span class="types">${type}${size}</span>
      <h3>${esc(f.title)}</h3>
      <span class="pill pill-${sit.tone}"><i class="led" aria-hidden="true"></i>${pixelText(PILL[sit.tone], { px: 2 })}</span>
    </div>
    ${map(f, sit)}
    <div class="say gbox say-${sit.tone}">
      <p class="say-main">${sit.main}${sit.time ? ` <span class="say-time">· ${esc(sit.time)}</span>` : ''}</p>
      ${sit.detail ? `<p class="say-detail">${esc(sit.detail)}</p>` : ''}
      ${sit.hint ? `<p class="say-hint">${esc(sit.hint)}</p>` : ''}
      ${flags}
      ${sit.tone === 'working' ? '<span class="wip" aria-hidden="true"><i></i></span>' : ''}
      <span class="next" aria-hidden="true">▼</span>
    </div>
  </a>`;
}

// ---------- Top of the page: numbers, then the Foreman ----------

function statsHtml() {
  const s = board.stats;
  const tile = (ic, label, value, sub, tone = '', tip = '') => `<div class="stat gbox ${tone}"${tip ? ` title="${esc(tip)}"` : ''}>
    <span class="stat-top">${icon(ic, 22)}<span class="stat-label">${esc(label)}</span></span>
    <span class="stat-value">${pixelText(value, { px: 4 })}</span>
    <span class="stat-sub">${sub}</span></div>`;
  return [
    tile('coin', 'Spent today', usd(s.today.usd, 'estimate'), `${esc(fmtTokens(s.today.tokens))} tokens`, '', 'Every Claude Code session on this computer since midnight, estimated from token counts'),
    tile('calendar', 'Last 7 days', usd(s.week.usd, 'estimate'), `${esc(fmtTokens(s.week.tokens))} tokens`, '', 'Every Claude Code session on this computer, estimated from token counts'),
    tile('bang', 'Need you', String(s.needsYou), s.needsYou ? 'answers or a go-ahead' : 'nothing waiting', s.needsYou ? 'tone-needs' : ''),
    tile('bolt', 'Working now', String(s.workingAgents), `on ${plural(s.workingFeatures, 'job')}`, s.workingAgents ? 'tone-working' : ''),
    tile('badge', 'Badges', String(s.done), `${s.inProgress} still on the bench`, '', 'Jobs finished'),
    tile('coin', 'All jobs', usd(s.featuresUsd), 'since each one started', '', 'Cost of every job on the board'),
  ].join('');
}

function foreman() {
  const list = board.features;
  const needs = list.filter((f) => f.needsYou);
  const quiet = list.filter((f) => !f.needsYou && f.quiet);
  const working = list.filter((f) => f.working);
  let line;
  if (needs.length) line = needs.length === 1 ? 'One job needs you! Here it is:' : `${needs.length} jobs need you! Longest wait first:`;
  else if (quiet.length) line = 'Nothing needs your answer, but a crew member has gone quiet. Maybe a permission prompt?';
  else if (working.length) line = `All good! ${plural(board.stats.workingAgents, 'crew member')} hard at work. Nothing needs you.`;
  else if (list.length) line = 'Quiet in the workshop. Nothing is running and nothing needs you.';
  else line = 'Welcome! Start a job in Claude Code with /feature and your crew will show up here.';

  const choices = [
    ...needs.slice(0, 4).map((f) => {
      const what = f.waitingFor === 'answers' ? `answer ${plural(f.questions || 1, 'question')}` : f.waitingFor === 'permission' ? 'approve a permission' : 'give the go-ahead';
      return `<li><a href="#/feature/${encodeURIComponent(f.slug)}"><span class="c-title">${esc(f.title)}</span><span class="c-what">${esc(what)} · waiting ${esc(since(f.waitingSince))}</span></a></li>`;
    }),
    ...quiet.slice(0, 2).map((f) => {
      const a = f.nowDoing.find((x) => x.quietMs);
      return `<li class="soft"><a href="#/feature/${encodeURIComponent(f.slug)}"><span class="c-title">${esc(f.title)}</span><span class="c-what">${esc(agentName(a?.who))} quiet ${esc(duration(a?.quietMs ?? 0))} · check its terminal</span></a></li>`;
    }),
  ];
  const mood = needs.length ? 'waiting' : working.length ? 'idle' : 'asleep';
  return { line, choicesHtml: choices.join(''), mood };
}

function renderTop() {
  const stats = $('#stats');
  const s = statsHtml();
  if (stats._html !== s) { stats.innerHTML = s; stats._html = s; }

  const f = foreman();
  const portrait = $('#dialog .portrait');
  if (portrait._mood !== f.mood) { portrait.innerHTML = sprite('conductor', { state: f.mood, size: 72, label: 'Foreman' }); portrait._mood = f.mood; }
  const line = $('#dialog .line');
  if (line._text !== f.line) {
    // A fresh span replays the "typing" reveal only when the words change.
    line.innerHTML = `<span class="typed">${esc(f.line)}</span>`;
    line._text = f.line;
  }
  const choices = $('#dialog .choices');
  if (choices._html !== f.choicesHtml) { choices.innerHTML = f.choicesHtml; choices._html = f.choicesHtml; choices.hidden = !f.choicesHtml; }
}

// ---------- Rendering without restarting animations ----------

// Replace a container's keyed children only where their HTML changed.
function patchChildren(container, items) {
  const existing = new Map([...container.children].map((el) => [el.dataset.key, el]));
  let prev = null;
  for (const { key, html } of items) {
    let el = existing.get(key);
    if (!el || el._html !== html) {
      const tpl = document.createElement('template');
      tpl.innerHTML = html.trim();
      const fresh = tpl.content.firstElementChild;
      fresh._html = html;
      if (el) el.replaceWith(fresh); else container.append(fresh);
      el = fresh;
    }
    existing.delete(key);
    if (prev ? prev.nextElementSibling !== el : container.firstElementChild !== el) {
      if (prev) prev.after(el); else container.prepend(el);
    }
    prev = el;
  }
  for (const el of existing.values()) el.remove();
}

const HOWTO = () => `<details class="howto gbox" id="howto"${prefs.get('howto', board.features.length ? 'closed' : 'open') === 'open' ? ' open' : ''}>
  <summary>${pixelText('How to play', { px: 2 })}</summary>
  <div class="howto-body">
    <div>${sprite('conductor', { size: 56 })}<p><strong>You talk to the Foreman.</strong> Run <code>/feature</code> in Claude Code. The Foreman hands each stage to a crew member and checks their work.</p></div>
    <div>${sprite('feature-planner', { size: 56 })}<p><strong>Each card is one job</strong>, a feature or a bug. The crew walks the path from Spec to PR 3 and stops after each stage for you.</p></div>
    <div>${sprite('feature-reviewer', { size: 56, state: 'waiting' })}<p><strong>Red “!” and a red card: your turn.</strong> Answers or a go-ahead. Click the card to see what’s needed.</p></div>
    <div>${sprite('feature-implementer', { size: 56, state: 'working' })}<p><strong>Hammering, “…” and a green card: working.</strong> “Zz” is resting, ★ is done. <a href="#/crew">Meet the crew</a>. This page only reads files; it never changes your code.</p></div>
  </div>
</details>`;

function renderBoard() {
  const app = $('#app');
  if (!$('#board')) {
    app.innerHTML = `<div id="board">
      <div id="banner"></div>
      <section class="stats" id="stats" aria-label="Headline numbers"></section>
      <section class="dialog gbox" id="dialog" aria-label="The Foreman says" aria-live="polite">
        <div class="portrait"></div>
        <div class="speaker">${pixelText('Foreman', { px: 2 })}</div>
        <p class="line"></p>
        <ul class="choices" hidden></ul>
        <span class="more" aria-hidden="true">▼</span>
      </section>
      <div id="howto-slot"></div>
      <div id="towns"></div>
      <footer class="site-footer" id="footer"></footer>
    </div>`;
  }
  $('#banner').innerHTML = meta.demo ? '<p class="banner gbox">Demo mode: these jobs are invented.</p>' : '';
  renderTop();
  if (!$('#howto')) {
    $('#howto-slot').innerHTML = HOWTO();
    $('#howto').addEventListener('toggle', (e) => prefs.set('howto', e.target.open ? 'open' : 'closed'));
  }

  // Towns (projects), in board order: the list is sorted with jobs needing you first.
  const towns = [];
  for (const f of board.features) {
    let t = towns.find((x) => x.name === f.project.name);
    if (!t) { t = { name: f.project.name, path: f.project.path, features: [] }; towns.push(t); }
    t.features.push(f);
  }
  const townsEl = $('#towns');
  if (!board.features.length) {
    townsEl.innerHTML = `<div class="empty gbox">${sprite('conductor', { size: 96, state: 'asleep' })}<h2>No jobs yet</h2><p>Nothing in <code>${esc(meta.featuresDir)}</code>. Start one in Claude Code with <code>/feature &lt;one-line description&gt;</code>.</p></div>`;
  } else {
    if (townsEl.querySelector('.empty')) townsEl.innerHTML = '';
    patchChildren(townsEl, towns.map((t) => {
      const needs = t.features.filter((f) => f.needsYou).length;
      const cost = t.features.reduce((a, f) => a + f.cost.totalUsd, 0);
      return {
        key: `town:${t.name}`,
        html: `<section class="town" data-key="town:${esc(t.name)}" aria-label="${esc(t.name)}">
          <div class="town-sign" title="${esc(t.path ?? '')}"><h2>${pixelText(t.name, { px: 3 })}</h2><span class="count">${plural(t.features.length, 'job')}${needs ? ` · <strong class="flag">${needs} need${needs === 1 ? 's' : ''} you</strong>` : ''} · ${esc(usd(cost))}</span></div>
          <div class="routes" data-town="${esc(t.name)}"></div></section>`,
      };
    }));
    for (const t of towns) {
      const container = [...townsEl.querySelectorAll('.routes')].find((el) => el.dataset.town === t.name);
      patchChildren(container, t.features.map((f) => ({ key: f.slug, html: card(f) })));
    }
  }
  $('#footer').innerHTML = `<span>≈ means estimated from token counts</span><span>Reading <code>${esc(meta.featuresDir)}</code></span><span>Prices as of ${esc(meta.prices.asOf)}</span><span>Updated ${esc(new Date(board.generatedAt).toLocaleTimeString())}</span>`;
}

// ---------- Crew-dex ----------

function renderCrew() {
  const order = ['conductor', 'feature-spec-writer', 'feature-investigator', 'feature-planner', 'feature-implementer', 'feature-tester',
    'feature-reviewer', 'feature-review-permissions', 'feature-review-tests', 'feature-review-conventions', 'feature-review-errors',
    'feature-review-db', 'feature-review-performance', 'feature-review-ui'];
  const busy = new Set(board.features.flatMap((f) => f.nowDoing.map((a) => a.who)));
  $('#app').innerHTML = `<section class="crewdex">
    <div class="crew-head gbox"><h2>${pixelText('Crew-dex', { px: 4 })}</h2><p>Everyone in the workshop. Hover a crew member to see them work. A green light means they’re working on a job right now.</p><a class="back" href="#/">◀ Back to the map</a></div>
    <ol class="crew-grid">${order.map((type, i) => {
      const a = meta.agents[type];
      const m = meta.crewModels[type];
      const model = type === 'conductor' ? 'Your main Claude Code session (meant for Fable 5.1)' : `${modelLabel(m?.model)}${m?.effort ? ` · effort ${m.effort}` : ''}`;
      return `<li class="crew-card gbox${busy.has(type) ? ' busy' : ''}">
        <span class="dex-no">${pixelText(`#${String(i + 1).padStart(3, '0')}`, { px: 2 })}</span>
        <span class="dex-sprite"><span class="still">${sprite(type, { state: busy.has(type) ? 'working' : 'idle', size: 96, label: a.name })}</span><span class="moving">${sprite(type, { state: 'working', size: 96, label: '' })}</span></span>
        <h3>${pixelText(a.name, { px: 2 })}</h3>
        <p>${esc(a.role)}</p>
        <p class="dex-model">${esc(model)}</p>
        ${busy.has(type) ? `<p class="dex-busy"><i class="led"></i> Working now</p>` : ''}
      </li>`;
    }).join('')}</ol>
  </section>`;
}

function renderFeaturePlaceholder(slug) {
  const f = board.features.find((x) => x.slug === slug);
  const app = $('#app');
  if (!f) {
    app.innerHTML = `<div class="empty gbox">${sprite('feature-investigator', { size: 96 })}<h2>No job called “${esc(slug)}”</h2><p><a href="#/">◀ Back to the map</a></p></div>`;
    return;
  }
  app.innerHTML = `<div class="empty gbox">${sprite(STAGE_CHARACTER[f.stage] ?? 'conductor', { size: 96 })}<h2>${esc(f.title)}</h2><p>The full job page (brief, answers, artifacts, code, costs) comes next.</p><p><a href="#/">◀ Back to the map</a></p></div>`;
}

function updateCounter() {
  const n = board.needsYou;
  $('#needs-num').textContent = n;
  $('#needs-label').textContent = n === 1 ? 'needs you' : 'need you';
  $('#needs-badge').dataset.count = n;
  document.title = n ? `(${n}) Feature Workshop` : 'Feature Workshop';
}

function show() {
  if (!board || !meta) return;
  const m = /^#\/feature\/(.+)$/.exec(location.hash);
  if (m) renderFeaturePlaceholder(decodeURIComponent(m[1]));
  else if (location.hash === '#/crew') renderCrew();
  else renderBoard();
}

async function refresh() {
  try {
    const res = await fetch('/api/features');
    if (!res.ok) throw new Error((await res.json()).error);
    board = await res.json();
    updateCounter();
    // The crew page is static once drawn; don't redraw it under the pointer.
    if (location.hash !== '#/crew' || !$('.crewdex')) show();
  } catch (err) {
    $('#app').innerHTML = `<div class="empty gbox">${sprite('conductor', { size: 96, state: 'asleep' })}<h2>Can’t reach the workshop</h2><p>${esc(err.message || 'The dashboard server may have stopped. Start it again with npm start.')}</p></div>`;
  }
}

async function init() {
  startClock();
  startTheme();
  $('#foreman').innerHTML = sprite('conductor', { size: 48, label: 'Foreman', state: 'idle' });
  $('#title-text').innerHTML = pixelText('Feature Workshop', { px: 3 });
  meta = await (await fetch('/api/meta')).json();
  await refresh();
  window.addEventListener('hashchange', () => { $('#app').innerHTML = ''; show(); window.scrollTo(0, 0); });
  // Live updates when files change; a slow poll keeps the "how long" times fresh.
  const events = new EventSource('/api/events');
  events.addEventListener('change', refresh);
  setInterval(refresh, 30000);
}

init();
