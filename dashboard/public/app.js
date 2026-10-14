import { $, $$, esc, prefs, since, duration, plural, usd, fmtTokens, modelLabel, getJson, postJson, setToken, toast } from './ui.js';
import { sprite, icon, renderMap, STAGE_CHARACTER } from './crew.js';
import { pixelText } from './pixelfont.js';
import { initJob, showJob, currentJobSlug } from './job.js';
import { permissionCard, bindPermissionCards, openNewJob, openAlerts, notify, alerts } from './panels.js';
import { showCosts } from './costs.js';

let meta = null;
let board = null;
let lastNeeds = null; // slugs that needed you at the last refresh, for alerts
let seenPermissions = new Set();

const agentName = (type) => (type === 'conductor' ? 'Foreman' : meta?.agents[type]?.name ?? type ?? 'A helper');

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
  setTimeout(() => { render(); setInterval(render, 1000); }, 1000 - (Date.now() % 1000));
}

// ---------- Theme ----------

function startTheme() {
  const btn = $('#theme');
  const order = ['auto', 'light', 'dark'];
  const names = { auto: 'automatic (follows your system)', light: 'day', dark: 'night' };
  const forced = new URLSearchParams(location.search).get('theme'); // ?theme=light|dark previews without saving
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

// ---------- What is going on with a job (shared by the board and the job page) ----------

const PILL = { needs: 'Your turn', working: 'Working', blocked: 'Blocked', done: 'Done', idle: 'Resting' };
const VERB = {
  conductor: 'is checking the work', 'feature-spec-writer': 'is writing the spec', 'feature-investigator': 'is investigating the code',
  'feature-planner': 'is drawing up the plan', 'feature-implementer': 'is building', 'feature-tester': 'is running the checks',
};
const verbFor = (type) => VERB[type] ?? 'is reviewing';

export function situation(f) {
  const running = f.nowDoing ?? [];
  const workers = running.filter((a) => a.who !== 'conductor');
  const quiet = running.find((a) => a.quietMs);
  const hint = quiet ? `${agentName(quiet.who)} has been quiet for ${duration(quiet.quietMs)}. If it’s waiting for a permission click, that’s in its terminal.` : null;
  if (f.waitingFor === 'permission') {
    return { tone: 'needs', main: `<b>Your turn:</b> ${esc(plural(f.permissions || 1, 'permission'))} to approve`, detail: 'A crew member is waiting for your Allow or Deny.', time: f.waitingSince ? `waiting ${since(f.waitingSince)}` : '', crew: running, bubble: 'key' };
  }
  if (f.needsYou) {
    const main = f.waitingFor === 'answers' ? `${plural(f.questions || 1, 'question')} for you` : 'waiting for your go-ahead';
    const detail = (f.waitingFor === 'answers' && f.firstQuestion) || f.headline || (f.nextProposed ? `Next: ${f.nextProposed}` : null);
    return { tone: 'needs', main: `<b>Your turn:</b> ${esc(main)}`, detail, time: f.waitingSince ? `waiting ${since(f.waitingSince)}` : '', crew: [], bubble: 'bang' };
  }
  if (workers.length > 1) return { tone: 'working', main: `<b>${workers.length} crew</b> at work`, detail: workers.map((a) => agentName(a.who)).join(', '), time: since(workers[0].since), crew: workers, bubble: 'dots', hint };
  if (running.length) {
    const a = workers[0] ?? running[0];
    return { tone: 'working', main: `<b>${esc(agentName(a.who))}</b> ${esc(verbFor(a.who))}`, detail: a.doing, time: since(a.since), crew: [a], bubble: quiet ? 'quiet' : 'dots', hint };
  }
  if (f.limitPaused) return { tone: 'idle', main: '<b>Paused</b> for Claude’s usage limit.', detail: `It carries on by itself at about ${clockTime(f.limitPaused)}.`, crew: [], bubble: null };
  if (f.paused) return { tone: 'idle', main: '<b>Paused.</b> Nothing is running.', detail: 'You paused this from the workshop. Send the Foreman a message to carry on.', crew: [], bubble: null };
  if (f.stageState === 'working') return { tone: 'working', main: '<b>The crew</b> is working', detail: f.nextProposed, crew: [], bubble: 'dots' };
  if (f.stageState === 'blocked') return { tone: 'blocked', main: '<b>Blocked:</b> waiting on someone else', detail: f.nextProposed, crew: [], bubble: null };
  if (f.stageState === 'done') return { tone: 'done', main: '<b>Done!</b> This job is finished.', detail: null, crew: [], bubble: 'badge' };
  return { tone: 'idle', main: '<b>Resting.</b> Nothing is running.', detail: f.nextProposed ? `Next: ${f.nextProposed}` : null, crew: [], bubble: null };
}

const clockTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// ---------- Usage limit (shown on every page) ----------

function renderUsage() {
  const u = board?.usage;
  let html = '';
  if (u?.limited) {
    const t = u.resetsAt ? clockTime(u.resetsAt) : null;
    const left = u.resetsAt ? duration(Date.parse(u.resetsAt) - Date.now()) : null;
    const jobs = u.jobs.length ? `${esc(plural(u.jobs.length, 'job'))} paused: ${u.jobs.map((j) => esc(j.title)).join(', ')}.` : 'Nothing was running from here.';
    const plan = !u.autoResume ? 'Automatic carry-on is off, so use <b>Carry on now</b> when you’re ready.'
      : u.resetKnown ? `${u.jobs.length ? 'They carry on' : 'Jobs can start again'} by themselves at about <b>${esc(t)}</b> (in ${esc(left)}).`
        : `Claude didn’t say when it resets, so the workshop tries again at about <b>${esc(t)}</b>.`;
    html = `<section class="usage-banner gbox" role="status" aria-label="Usage limit">
      <p><b>Claude’s ${esc(u.label)} is reached.</b> ${jobs} ${plan}</p>
      <p class="fineprint">Jobs you run in a terminal can’t be paused from here: they stop with a limit message instead.</p>
      <div class="usage-actions">
        <button class="btn small primary" type="button" data-usage="resume">Carry on now</button>
        <label class="usage-auto"><input type="checkbox" data-usage="auto"${u.autoResume ? ' checked' : ''}> Carry on automatically when it resets</label>
      </div></section>`;
  } else if (u?.warning) {
    const w = u.warning;
    html = `<p class="banner gbox usage-warn" role="status"><b>Heads-up:</b> you’ve used ${w.percent != null ? `${esc(w.percent)}% of` : 'most of'} Claude’s ${esc(w.label)}${w.resetsAt ? ` (it resets at about ${esc(clockTime(w.resetsAt))})` : ''}. If it runs out, running jobs pause and carry on after it resets.</p>`;
  }
  const el = $('#usage');
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}

function bindUsage() {
  const el = $('#usage');
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-usage="resume"]');
    if (!btn) return;
    btn.disabled = true;
    try {
      const r = await postJson('/api/usage/resume', {});
      toast(r.resumed.length ? `Carrying on: ${esc(plural(r.resumed.length, 'job'))}.` : 'Unpaused. Nothing was waiting.', { tone: 'good' });
      refreshSoon();
    } catch (err) { toast(esc(err.message), { tone: 'bad' }); btn.disabled = false; }
  });
  el.addEventListener('change', async (e) => {
    const box = e.target.closest('[data-usage="auto"]');
    if (!box) return;
    try { await postJson('/api/usage/auto', { on: box.checked }); toast(box.checked ? 'Paused jobs will carry on by themselves.' : 'Paused jobs will wait for you.', { tone: 'good' }); refreshSoon(); }
    catch (err) { toast(esc(err.message), { tone: 'bad' }); box.checked = !box.checked; }
  });
}

// When a job moves to a later stage, its crew walks there instead of jumping.
const lastStage = new Map();
function walk(container, slug, mapEl) {
  const at = Number(mapEl?.dataset.at ?? -1);
  const key = `${container.id || 'board'}:${slug}`;
  const prev = lastStage.get(key);
  lastStage.set(key, at);
  if (prev === undefined || prev < 0 || at <= prev || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const actor = $('.actor', mapEl);
  const stations = $$('.station', mapEl);
  if (!actor || !stations[prev] || !stations[at]) return;
  const dx = stations[prev].getBoundingClientRect().left - stations[at].getBoundingClientRect().left;
  $$('.ch', actor).forEach((c) => c.classList.add('is-walking'));
  const anim = actor.animate([{ transform: `translateX(calc(-50% + ${dx}px))` }, { transform: 'translateX(-50%)' }], { duration: Math.min(2600, 500 + Math.abs(dx) * 4), easing: 'cubic-bezier(.45,.05,.4,1)' });
  anim.onfinish = () => $$('.ch', actor).forEach((c) => c.classList.remove('is-walking'));
}

// ---------- Board ----------

function statsHtml() {
  const s = board.stats;
  const tile = (ic, label, value, sub, tone = '', tip = '') => `<div class="stat gbox ${tone}"${tip ? ` title="${esc(tip)}"` : ''}>
    <span class="stat-top">${icon(ic, 26)}<span class="stat-label">${esc(label)}</span></span>
    <span class="stat-value">${esc(value)}</span><span class="stat-sub">${sub}</span></div>`;
  return [
    tile('coin', 'Spent today', usd(s.today.usd, 'estimate'), `${esc(fmtTokens(s.today.tokens))} tokens`, '', 'Every Claude Code session on this computer since midnight, estimated from token counts'),
    tile('calendar', 'Last 7 days', usd(s.week.usd, 'estimate'), `${esc(fmtTokens(s.week.tokens))} tokens`, '', 'Every Claude Code session on this computer, estimated from token counts'),
    tile('bang', 'Need you', String(s.needsYou), s.needsYou ? 'answers, go-aheads or clicks' : 'nothing waiting', s.needsYou ? 'tone-needs' : ''),
    tile('bolt', 'Working now', String(s.workingAgents), `on ${plural(s.workingFeatures, 'job')}`, s.workingAgents ? 'tone-working' : ''),
    tile('badge', 'Done', String(s.done), `${s.inProgress} still on the bench`, '', 'Jobs finished'),
    tile('coin', 'All jobs', usd(s.featuresUsd), '<a href="#/costs">See costs and export →</a>', '', 'Cost of every job on the board'),
  ].join('');
}

function foreman() {
  const list = board.features;
  const needs = list.filter((f) => f.needsYou);
  const quiet = list.filter((f) => !f.needsYou && f.quiet);
  const working = list.filter((f) => f.working);
  let line;
  if (needs.length) line = needs.length === 1 ? 'One job needs you. Here it is:' : `${needs.length} jobs need you. Longest wait first:`;
  else if (quiet.length) line = 'Nothing needs your answer, but a crew member has gone quiet. Maybe a permission prompt in a terminal?';
  else if (working.length) line = `All good! ${plural(board.stats.workingAgents, 'crew member')} at work. Nothing needs you right now.`;
  else if (list.length) line = 'All quiet. Nothing is running and nothing needs you.';
  else line = 'Welcome! Start your first job with the New job button.';
  const choices = [
    ...needs.slice(0, 4).map((f) => {
      const what = f.waitingFor === 'permission' ? `approve ${plural(f.permissions || 1, 'permission')}` : f.waitingFor === 'answers' ? `answer ${plural(f.questions || 1, 'question')}` : 'give the go-ahead';
      return `<li><a href="#/job/${encodeURIComponent(f.slug)}"><span class="c-title">${esc(f.title)}</span><span class="c-what">${esc(what)}${f.waitingSince ? ` · waiting ${esc(since(f.waitingSince))}` : ''}</span></a></li>`;
    }),
    ...quiet.slice(0, 2).map((f) => {
      const a = f.nowDoing.find((x) => x.quietMs);
      return `<li class="soft"><a href="#/job/${encodeURIComponent(f.slug)}"><span class="c-title">${esc(f.title)}</span><span class="c-what">${esc(agentName(a?.who))} quiet ${esc(duration(a?.quietMs ?? 0))} · check its terminal</span></a></li>`;
    }),
  ];
  const mood = needs.length ? 'waiting' : working.length ? 'idle' : 'asleep';
  return { line, choicesHtml: choices.join(''), mood };
}

function card(f) {
  const sit = situation(f);
  const type = `<span class="type type-${f.kind}" title="${f.kindGuessed ? 'Guessed from the branch or folder name' : ''}">${f.kind === 'bug' ? 'Bug' : 'Feature'}</span>`;
  const size = f.route ? `<span class="type type-${f.route}" title="${f.route === 'small' ? 'Small: no refine interview' : 'Large: includes the refine interview'}">${esc(f.route)}</span>` : '';
  const coins = `<span class="coins" title="${esc(f.cost.source === 'estimate' ? 'Cost so far, estimated from token counts' : 'Cost so far')}">${icon('coin', 18)}${esc(usd(f.cost.totalUsd, f.cost.source))}</span>`;
  const flags = f.unconfirmed ? `<p class="say-flag">★ ${esc(plural(f.unconfirmed, 'thing'))} decided for you. Please check.</p>` : '';
  return `<a class="route gbox state-${sit.tone}" href="#/job/${encodeURIComponent(f.slug)}" data-key="${esc(f.slug)}">
    <div class="route-head"><span class="types">${type}${size}</span><h3>${esc(f.title)}</h3><span class="pill pill-${sit.tone}"><i class="led" aria-hidden="true"></i>${esc(f.starting ? 'Starting' : PILL[sit.tone])}</span></div>
    ${f.repo?.branch ? `<p class="route-sub">branch <code>${esc(f.repo.branch)}</code></p>` : !f.repo && !f.starting ? '<p class="route-sub warn-text">Repository not known yet: open the job to pick it</p>' : ''}
    ${renderMap(meta.stages, f, sit, { agentName, size: 104, coins })}
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

// Replace a container's keyed children only where their HTML changed (keeps animations running).
function patchChildren(container, items, after) {
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
      after?.(el, key);
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
  <summary>How it works</summary>
  <div class="howto-body">
    <div>${sprite('conductor', { size: 64 })}<p><strong>You talk to the Foreman.</strong> Start a job with <b>New job</b> (or <code>/feature</code> in Claude Code). The Foreman hands each stage to a crew member and checks their work.</p></div>
    <div>${sprite('feature-planner', { size: 64, state: 'working' })}<p><strong>Each card is one job.</strong> The crew walks the path from Spec to PR 3 and stops after each stage so you can check it.</p></div>
    <div>${sprite('feature-reviewer', { size: 64, state: 'waiting' })}<p><strong>Red card with “!”: your turn.</strong> Open it to answer, approve, or click Allow or Deny for something a worker wants to do.</p></div>
    <div>${sprite('feature-implementer', { size: 64, state: 'asleep' })}<p><strong>Green: working. Grey: resting. Gold: done.</strong> Nothing changes in your code without your click. <a href="#/crew">Meet the crew</a>.</p></div>
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
        <div class="speaker">Foreman</div>
        <p class="line"></p>
        <ul class="choices" hidden></ul>
        <span class="more" aria-hidden="true">▼</span>
      </section>
      <div id="howto-slot"></div>
      <div id="towns"></div>
      <footer class="site-footer" id="footer"></footer>
    </div>`;
  }
  $('#banner').innerHTML = meta.demo ? '<p class="banner gbox">Demo mode: these jobs are invented and a pretend Foreman answers. Try every button.</p>' : '';
  const stats = $('#stats');
  const s = statsHtml();
  if (stats._html !== s) { stats.innerHTML = s; stats._html = s; }
  const fm = foreman();
  const portrait = $('#dialog .portrait');
  if (portrait._mood !== fm.mood) { portrait.innerHTML = sprite('conductor', { state: fm.mood, size: 84, label: 'Foreman' }); portrait._mood = fm.mood; }
  const line = $('#dialog .line');
  if (line._text !== fm.line) { line.innerHTML = `<span class="typed">${esc(fm.line)}</span>`; line._text = fm.line; }
  const choices = $('#dialog .choices');
  if (choices._html !== fm.choicesHtml) { choices.innerHTML = fm.choicesHtml; choices._html = fm.choicesHtml; choices.hidden = !fm.choicesHtml; }
  if (!$('#howto')) {
    $('#howto-slot').innerHTML = HOWTO();
    $('#howto').addEventListener('toggle', (e) => prefs.set('howto', e.target.open ? 'open' : 'closed'));
  }

  const towns = [];
  for (const f of board.features) {
    let t = towns.find((x) => x.name === f.project.name);
    if (!t) { t = { name: f.project.name, path: f.project.path, features: [] }; towns.push(t); }
    t.features.push(f);
  }
  const townsEl = $('#towns');
  if (!board.features.length) {
    townsEl.innerHTML = `<div class="empty gbox">${sprite('conductor', { size: 120, state: 'asleep' })}<h2>No jobs yet</h2><p>Click <b>New job</b> at the top to start one, or run <code>/feature &lt;one-line description&gt;</code> in Claude Code.</p><p class="muted">Reading jobs from <code>${esc(meta.featuresDir)}</code></p></div>`;
  } else {
    if (townsEl.querySelector('.empty')) townsEl.innerHTML = '';
    patchChildren(townsEl, towns.map((t) => {
      const needs = t.features.filter((f) => f.needsYou).length;
      const cost = t.features.reduce((a, f) => a + f.cost.totalUsd, 0);
      return {
        key: `town:${t.name}`,
        html: `<section class="town" data-key="town:${esc(t.name)}" aria-label="${esc(t.name)}">
          <div class="town-sign" title="${esc(t.path ?? '')}"><h2>${esc(t.name)}</h2><span class="count">${plural(t.features.length, 'job')}${needs ? ` · <strong class="flag">${needs} need${needs === 1 ? 's' : ''} you</strong>` : ''} · ${esc(usd(cost))}</span></div>
          <div class="routes" data-town="${esc(t.name)}"></div></section>`,
      };
    }));
    for (const t of towns) {
      const container = [...townsEl.querySelectorAll('.routes')].find((el) => el.dataset.town === t.name);
      patchChildren(container, t.features.map((f) => ({ key: f.slug, html: card(f) })), (el, slug) => walk(container, slug, $('.map', el)));
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
    <a class="back" href="#/">◀ Back to the map</a>
    <div class="crew-head gbox"><h2 class="display">Crew-dex</h2><p>Everyone in the workshop. Hover over a crew member to see them at work. A green light means they’re on a job right now.</p></div>
    <ol class="crew-grid">${order.map((type, i) => {
      const a = meta.agents[type];
      const m = meta.crewModels[type];
      const model = type === 'conductor' ? 'Your Claude Code session (designed for Fable 5.1)' : `${modelLabel(m?.model)}${m?.effort ? ` · effort ${m.effort}` : ''}`;
      return `<li class="crew-card gbox${busy.has(type) ? ' busy' : ''}">
        <span class="dex-no">${pixelText(`#${String(i + 1).padStart(3, '0')}`, { px: 2 })}</span>
        <span class="dex-sprite"><span class="still">${sprite(type, { state: busy.has(type) ? 'working' : 'idle', size: 120, label: a.name })}</span><span class="moving">${sprite(type, { state: 'working', size: 120, label: '' })}</span></span>
        <h3>${esc(a.name)}</h3><p>${esc(a.role)}</p><p class="dex-model">${esc(model)}</p>
        ${busy.has(type) ? '<p class="dex-busy"><i class="led"></i> Working now</p>' : ''}
      </li>`;
    }).join('')}</ol>
  </section>`;
}

// ---------- Permission tray (on every page except the job it belongs to) ----------

function renderTray() {
  const openSlug = currentJobSlug();
  const onJobPage = location.hash.startsWith('#/job/');
  const items = (board?.permissions ?? []).filter((p) => !(onJobPage && p.slug === openSlug));
  let tray = $('#tray');
  if (!tray) { tray = document.createElement('aside'); tray.id = 'tray'; tray.setAttribute('aria-label', 'Waiting for your click'); document.body.append(tray); }
  const folded = sessionStorage.getItem('workshop.trayFolded') === 'yes';
  const html = items.length ? `<button type="button" class="tray-title" aria-expanded="${!folded}">${icon('bang', 18)} ${plural(items.length, 'thing')} waiting for your click <span aria-hidden="true">${folded ? '▴' : '▾'}</span></button>${folded ? '' : items.slice(0, 2).map((p) => permissionCard(p, { agentName, compact: true })).join('')}${!folded && items.length > 2 ? `<p class="tray-more">+${items.length - 2} more: open the jobs to see them</p>` : ''}` : '';
  if (tray._html === html) return;
  tray._html = html;
  tray.innerHTML = html;
  tray.hidden = !items.length;
  $('.tray-title', tray)?.addEventListener('click', () => { sessionStorage.setItem('workshop.trayFolded', folded ? 'no' : 'yes'); renderTray(); });
  bindPermissionCards(tray, { onDone: refresh });
}

// ---------- Routing and live updates ----------

function updateCounter() {
  const n = board.needsYou;
  $('#needs-num').textContent = n;
  $('#needs-label').textContent = n === 1 ? 'needs you' : 'need you';
  $('#needs-badge').dataset.count = n;
  document.title = n ? `(${n}) Feature Workshop` : 'Feature Workshop';
}

function alertOnChanges() {
  const needs = new Set(board.features.filter((f) => f.needsYou).map((f) => f.slug));
  if (lastNeeds) {
    for (const f of board.features) {
      if (needs.has(f.slug) && !lastNeeds.has(f.slug) && f.waitingFor !== 'permission') notify(`${f.title} needs you`, f.waitingFor === 'answers' ? 'The Foreman has questions for you.' : 'The Foreman is waiting for your go-ahead.', `#/job/${encodeURIComponent(f.slug)}`);
    }
  }
  lastNeeds = needs;
  for (const p of board.permissions ?? []) {
    if (seenPermissions.has(p.id)) continue;
    seenPermissions.add(p.id);
    notify(`${p.title}: permission needed`, `${agentName(p.agentType ?? 'conductor')} wants to: ${p.plain.headline}`, `#/job/${encodeURIComponent(p.slug)}`);
  }
}

async function show() {
  if (!meta || !board) return;
  const h = location.hash;
  const m = /^#\/job\/([^/]+)/.exec(h);
  document.body.dataset.page = m ? 'job' : h === '#/crew' ? 'crew' : h === '#/costs' ? 'costs' : 'board';
  if (m) await showJob(decodeURIComponent(m[1]), { quiet: Boolean($('.job')) && $('.job')?.dataset.slug === decodeURIComponent(m[1]) });
  else if (h === '#/crew') { if (!$('.crewdex')) renderCrew(); }
  else if (h === '#/costs') { if (!$('.costs')) await showCosts(meta); }
  else renderBoard();
  renderTray();
}

let refreshing = false;
let again = false;
async function refresh() {
  if (refreshing) { again = true; return; }
  refreshing = true;
  try {
    board = await getJson('/api/features');
    updateCounter();
    alertOnChanges();
    renderUsage();
    await show();
  } catch (err) {
    if (!board) $('#app').innerHTML = `<div class="empty gbox">${sprite('conductor', { size: 120, state: 'asleep' })}<h2>Can’t reach the workshop</h2><p>${esc(err.message || 'The dashboard may have stopped. Start it again with npm start.')}</p></div>`;
  } finally {
    refreshing = false;
    if (again) { again = false; setTimeout(refresh, 50); }
  }
}
let soon = null;
const refreshSoon = () => { clearTimeout(soon); soon = setTimeout(refresh, 250); };

async function init() {
  startClock();
  startTheme();
  $('#foreman').innerHTML = sprite('conductor', { size: 52, label: 'Foreman', state: 'idle' });
  $('#title-text').innerHTML = pixelText('Feature Workshop', { px: 3 });
  meta = await getJson('/api/meta');
  setToken(meta.token);
  initJob({ meta, agentName, situation, pillText: (tone) => PILL[tone], walk });
  $('#new-job').addEventListener('click', () => openNewJob(meta, { onStarted: (res) => { location.hash = `#/job/${encodeURIComponent(res.slug)}`; refreshSoon(); } }));
  const bell = $('#alerts');
  const paintBell = () => { bell.classList.toggle('on', alerts.notify || alerts.sound); bell.setAttribute('aria-label', `Alerts: ${alerts.notify || alerts.sound ? 'on' : 'off'}. Click to change.`); };
  bell.addEventListener('click', async () => { meta = await getJson('/api/meta'); openAlerts(bell, meta); });
  bell.addEventListener('alerts-changed', paintBell);
  paintBell();
  bindUsage();
  await refresh();
  window.addEventListener('hashchange', () => { $('#app').innerHTML = ''; window.scrollTo(0, 0); show(); });
  const events = new EventSource('/api/events');
  events.addEventListener('change', refreshSoon);
  events.addEventListener('run', refreshSoon);
  events.addEventListener('permission', refreshSoon);
  events.addEventListener('permission-gone', refreshSoon);
  setInterval(refresh, 30000); // keeps the "how long" times fresh
}

init().catch((err) => toast(esc(err.message), { tone: 'bad', timeout: 0 }));
