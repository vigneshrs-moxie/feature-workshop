// One job's page: what's happening, what the Foreman said, your move, and the details.

import { $, $$, esc, since, ago, duration, when, plural, usd, fmtTokens, modelLabel, vscodeHref, prefs, getJson, postJson, toast, modal } from './ui.js';
import { sprite, renderMap, stageShort, STAGE_CHARACTER } from './crew.js';
import { permissionCard, bindPermissionCards, optionsFields, readOptionsForm, bindOptionsForm } from './panels.js';
import { composeReply } from '/shared/compose.js';
import { mountLocal } from './local.js';

let ctx = null; // { meta, agentName, situation }
let current = null; // the job detail being shown
let draft = { slug: null, answers: {}, verdicts: {}, message: '' }; // survives live refreshes
let tab = 'briefs';

const RUN_WORDS = { starting: 'Starting up', running: 'Working', waiting_permission: 'Waiting for your click', stopping: 'Pausing…', done: 'Finished', stopped: 'Paused', error: 'Hit a problem', limited: 'Paused for the usage limit' };

export function initJob(c) { ctx = { describeTool, ...c }; }

function describeTool(name, input = {}) {
  const base = (p) => String(p ?? '').split('/').pop();
  if (name === 'Read') return `Reading ${base(input.file_path)}`;
  if (name === 'Write') return `Writing ${base(input.file_path)}`;
  if (name === 'Edit' || name === 'MultiEdit') return `Editing ${base(input.file_path)}`;
  if (name === 'Bash') return input.description || `Running ${String(input.command ?? '').slice(0, 60)}`;
  if (name === 'Agent' || name === 'Task') return `Sending work to ${input.subagent_type ?? 'a helper'}`;
  if (name === 'Grep' || name === 'Glob') return 'Searching the code';
  return `Using ${name}`;
}

export async function showJob(slug, { quiet = false } = {}) {
  const app = $('#app');
  let detail;
  try {
    detail = await getJson(`/api/job/${encodeURIComponent(slug)}`);
  } catch (err) {
    if (err.status === 404) return showStarting(slug);
    app.innerHTML = `<div class="empty gbox">${sprite('feature-investigator', { size: 110, state: 'idle' })}<h2>Couldn’t open this job</h2><p>${esc(err.message)}</p><p><a href="#/">◀ Back to the map</a></p></div>`;
    return;
  }
  if (draft.slug !== slug) draft = { slug, answers: {}, verdicts: {}, message: '' };
  const first = !quiet || !$('.job');
  current = detail;
  if (first) {
    tab = prefs.get('jobTab', 'files');
    app.innerHTML = skeleton(detail);
    bindStatic();
    mountLocal(detail.slug, $('#job-local'));
  }
  renderTop(detail);
  renderOverview(detail);
  renderThread(detail);
  renderMove(detail);
  renderOptions(detail);
  if ($('#job-details')?.open && !$('.tab-panel').contains(document.activeElement)) await renderTab({ soft: !first });
}

// A job started from the dashboard before its folder exists.
async function showStarting(slug) {
  const { runs, permissions } = await getJson('/api/runs');
  const run = runs.filter((r) => r.slug === slug).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const app = $('#app');
  if (!run) {
    app.innerHTML = `<div class="empty gbox">${sprite('feature-investigator', { size: 110, state: 'idle' })}<h2>No job called “${esc(slug)}”</h2><p><a href="#/">◀ Back to the map</a></p></div>`;
    return;
  }
  const perms = permissions.filter((p) => p.runId === run.id);
  app.innerHTML = `<div class="job">
    <a class="back" href="#/">◀ Back to the map</a>
    <header class="job-head gbox"><div class="job-title"><h2>${esc(run.title)}</h2><span class="pill pill-working"><i class="led"></i>Starting</span></div>
    <p class="job-meta">The Foreman is reading your request. This page fills in once it creates the job’s folder.</p></header>
    <div class="job-perms">${perms.map((p) => permissionCard(p, { agentName: ctx.agentName, showJob: false })).join('')}</div>
    <section class="move gbox">${runPanel(run)}</section>
  </div>`;
  bindPermissionCards($('.job-perms'), { onDone: () => showJob(slug, { quiet: true }) });
  bindRunPanel(run);
}

function skeleton(d) {
  return `<div class="job" data-slug="${esc(d.slug)}">
    <a class="back" href="#/">◀ Back to the map</a>
    <header class="job-head gbox" id="job-head"></header>
    <div class="job-perms" id="job-perms"></div>
    <section class="job-scene" id="job-scene"></section>
    <div class="job-main">
      <div class="col-talk">
        <section class="overview gbox" id="job-overview" aria-label="The Foreman’s overview"></section>
        <section class="thread gbox" id="job-thread" aria-label="Your conversation with the Foreman"></section>
      </div>
      <aside class="move gbox" id="job-move" aria-label="Your move"></aside>
    </div>
    <section class="jobopts gbox" id="job-opts" aria-label="How this job runs"></section>
    <section class="local gbox" id="job-local" aria-label="Try it on your computer"></section>
    <details class="details gbox" id="job-details">
      <summary><span class="details-title">Details</span><span class="muted">Files, code, approvals, costs and crew, for when you want to dig in</span></summary>
      <nav class="tabs" role="tablist" aria-label="Job details" id="job-tabs"></nav>
      <section class="tab-panel" id="tab-panel" role="tabpanel"></section>
    </details>
  </div>`;
}

// ---------- Top: header, permissions, scene ----------

function renderTop(d) {
  const sit = ctx.situation(d);
  const pill = `<span class="pill pill-${sit.tone}"><i class="led" aria-hidden="true"></i>${esc(ctx.pillText(sit.tone))}</span>`;
  const where = d.repoPath
    ? `<span title="${esc(d.locate?.source ? `Found from ${d.locate.source}` : '')}"><b>${esc(d.repoPath.split('/').pop())}</b></span>${d.branch ? `<span>branch <code>${esc(d.branch)}</code>${d.locate?.branchExists === false ? ' <span class="muted">(not created yet)</span>' : ''}</span>` : ''}${d.worktree ? `<a href="${esc(vscodeHref(d.worktree))}">Open the job’s worktree in VS Code</a>` : `<a href="${esc(vscodeHref(d.repoPath))}">Open in VS Code</a>`}<button type="button" class="linklike" data-change-repo>Change</button>`
    : '<span class="warn-text">Repository not known yet</span><button type="button" class="linklike" data-change-repo>Choose it</button>';
  const meta = [
    where,
    d.spec?.version ? `<span>Spec v${esc(d.spec.version)}${d.spec.status ? ` · ${esc(d.spec.status)}` : ''}</span>` : '',
    `<span title="${d.costDetail.source === 'estimate' ? 'Estimated from token counts' : 'Claude Code’s own figure'}">${esc(usd(d.cost.totalUsd, d.cost.source))} so far</span>`,
  ].filter(Boolean).join('<span class="dot-sep" aria-hidden="true">·</span>');
  setHtml('#job-head', `<div class="job-title"><span class="types"><span class="type type-${d.kind}">${d.kind === 'bug' ? 'Bug' : 'Feature'}</span>${d.route ? `<span class="type type-${d.route}">${esc(d.route)}</span>` : ''}</span><h2>${esc(d.title)}</h2>${pill}</div><p class="job-meta">${meta}</p>`);
  $('#job-head').className = `job-head gbox state-${sit.tone}`;

  const perms = d.permissionsPending ?? [];
  setHtml('#job-perms', perms.map((p) => permissionCard(p, { agentName: ctx.agentName, showJob: false })).join(''));
  bindPermissionCards($('#job-perms'), { onDone: () => showJob(d.slug, { quiet: true }) });

  setHtml('#job-scene', renderMap(ctx.meta.stages, d, sit, { agentName: ctx.agentName, size: 128, long: true }), () => ctx.walk?.($('#job-scene'), d.slug, $('#job-scene .map')));
}

// ---------- How this job runs (its options) ----------

function renderOptions(d) {
  const lines = d.optionsSummary;
  const closed = d.closedEarlier ? `<p class="notice closed-note">You marked this job ${d.closedEarlier.as === 'done' ? 'done' : 'dropped'} ${esc(when(d.closedEarlier.at))}, but it has changed since, so it’s back on the board. <button class="btn small" type="button" data-opts="reopen">Keep it open</button></p>`
    : d.closed ? `<p class="notice closed-note"><b>${d.closed.as === 'done' ? 'Marked done' : 'Dropped'}</b> ${esc(when(d.closed.at))}${d.closed.note ? `: “${esc(d.closed.note)}”` : ''}.${d.closed.worktreeRemoved ? ` Its worktree was removed; the branch is kept.` : ''} It’s off the board, in Finished. <button class="btn small" type="button" data-opts="reopen">Reopen</button></p>` : '';
  setHtml('#job-opts', `${closed}<h3>How this job runs</h3>
    ${lines ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : `<p class="muted">No options set: the Foreman follows its usual flow${d.route ? ` (${esc(d.route)})` : ''}. Set them to skip stages, pick reviewers or ask for Fable checks.</p>`}
    <div class="opts-actions">
      <button class="btn small" type="button" data-opts="edit">${lines ? 'Change' : 'Set options'}</button>
      <button class="btn small ghost" type="button" data-opts="fable">Have Fable check something</button>
      ${d.closed ? '' : '<button class="btn small ghost" type="button" data-opts="close" title="Take it off the board when it’s finished, waiting on someone else’s merge, or not going ahead">Mark as done…</button>'}
    </div>
    <p class="fineprint">Changes take effect from the next stage; the Foreman reads them before every stage.</p>`);
}

function editOptions(d) {
  const catalog = ctx.meta.jobOptions;
  const m = modal(`<form class="newjob"><h2>How this job runs</h2>${optionsFields(catalog, d.options, { open: true })}
    <p class="form-error" role="alert" hidden></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">Save</button></div></form>`, { label: 'How this job runs' });
  const form = $('form', m.box);
  bindOptionsForm(form, catalog);
  $('[data-close]', form).addEventListener('click', () => m.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      await postJson(`/api/job/${encodeURIComponent(d.slug)}/options`, { options: readOptionsForm(form) });
      m.close();
      toast('Saved. The Foreman follows these from the next stage.', { tone: 'good' });
      showJob(d.slug, { quiet: true });
    } catch (err) {
      const box = $('.form-error', form);
      box.hidden = false;
      box.textContent = err.message;
      btn.disabled = false;
    }
  });
}

function closeJob(d) {
  const m = modal(`<form class="newjob"><h2>Mark this job as done</h2>
    <p class="lede">It moves off the board into <b>Finished</b>. Nothing is deleted, the Foreman isn’t contacted, and you can reopen it any time (sending the Foreman a message reopens it too).</p>
    <fieldset class="field">
      <label class="opt"><input type="radio" name="as" value="done" checked><span><b>Done</b><small>Shipped, merged, or only waiting on someone else’s merge or release. Counts as done.</small></span></label>
      <label class="opt"><input type="radio" name="as" value="dropped"><span><b>Dropped</b><small>Not going ahead (or replaced by another job). Doesn’t count as done.</small></span></label>
    </fieldset>
    <label class="field"><span>Note (optional)</span><input type="text" name="note" maxlength="300" placeholder="e.g. PR #2 waiting on Raj’s approval"></label>
    ${d.worktree ? `<label class="check-line"><input type="checkbox" name="removeWorktree"> Also remove its worktree (<code>${esc(d.worktree.replace(/^\/Users\/[^/]+/, '~'))}</code>)</label>
    <p class="fineprint">Frees the folder. Only happens when nothing would be lost: no uncommitted changes, and its latest commit is already on GitHub (pushed or merged). The branch itself is kept. If it can’t be removed safely, the job isn’t marked and you’re told why.</p>` : ''}
    <p class="form-error" role="alert" hidden></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">Mark it</button></div></form>`, { label: 'Mark this job as done' });
  const form = $('form', m.box);
  $('[data-close]', form).addEventListener('click', () => m.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    btn.textContent = fd.get('removeWorktree') ? 'Checking the worktree…' : 'Marking…';
    try {
      await postJson(`/api/job/${encodeURIComponent(d.slug)}/close`, { as: fd.get('as'), note: fd.get('note'), removeWorktree: fd.get('removeWorktree') === 'on' });
      m.close();
      toast(fd.get('as') === 'dropped' ? 'Dropped. It’s in Finished at the bottom of the board.' : 'Marked done. It’s in Finished at the bottom of the board.', { tone: 'good' });
      showJob(d.slug, { quiet: true });
    } catch (err) {
      const box = $('.form-error', form);
      box.hidden = false;
      box.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Mark it';
    }
  });
}

async function reopenJob(d) {
  try { await postJson(`/api/job/${encodeURIComponent(d.slug)}/reopen`, {}); toast('Reopened. It’s back on the board.', { tone: 'good' }); showJob(d.slug, { quiet: true }); }
  catch (err) { toast(esc(err.message), { tone: 'bad' }); }
}

const FABLE_TARGETS = [
  { id: 'plan', label: 'The plan', text: 'the implementation plan and test plan' },
  { id: 'code', label: 'The code changes so far', text: 'the code changes on the feature branch so far (base..HEAD)' },
  { id: 'spec', label: 'The spec', text: 'the product spec' },
  { id: 'review', label: 'The review findings', text: 'the consolidated review and whether its verdicts hold' },
  { id: 'other', label: 'Something else', text: null },
];

function askFable(d) {
  const m = modal(`<form class="newjob"><h2>Have Fable check something</h2>
    <p class="lede">The Foreman asks Fable for a short, separate second look and tells you what it found. It costs much less than running the whole job on Fable.</p>
    <fieldset class="field">${FABLE_TARGETS.map((t, i) => `<label class="opt"><input type="radio" name="target" value="${t.id}"${i === 0 ? ' checked' : ''}><span><b>${esc(t.label)}</b></span></label>`).join('')}</fieldset>
    <label class="field"><span>What should it look at or worry about? (optional for the first four)</span><textarea name="note" rows="2" maxlength="1500" placeholder="e.g. Is the permission check on the new route right for evaluators?"></textarea></label>
    <p class="form-error" role="alert" hidden></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">Ask</button></div></form>`, { label: 'Have Fable check something' });
  const form = $('form', m.box);
  $('[data-close]', form).addEventListener('click', () => m.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const t = FABLE_TARGETS.find((x) => x.id === fd.get('target'));
    const note = String(fd.get('note') ?? '').trim();
    const box = $('.form-error', form);
    if (!t.text && !note) { box.hidden = false; box.textContent = 'Say what Fable should look at.'; return; }
    const text = `Please ask Fable for a second look (dispatch the feature-fable-check agent) at ${t.text ?? 'this'}${note ? `. Focus: ${note}` : '.'} Then brief me on what it found and what you'd do about it.`;
    try {
      await postJson(`/api/job/${encodeURIComponent(d.slug)}/send`, { kind: 'fable-check', text });
      m.close();
      toast('Asked. The Foreman gets Fable’s second look and briefs you.', { tone: 'good' });
      showJob(d.slug, { quiet: true });
    } catch (err) { box.hidden = false; box.textContent = err.message; }
  });
}

// ---------- The Foreman's overview ----------

const SOURCE_WORDS = {
  summary: 'The Foreman’s summary',
  brief: 'From the Foreman’s latest brief',
  record: 'From the job’s record (this job has no briefs yet)',
};

function renderOverview(d) {
  const o = d.overview;
  const list = (title, items, cls = '') => (items?.length ? `<div class="ov-block ${cls}"><h4>${esc(title)}</h4><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
  const running = d.drive.mode === 'running' && d.run;
  const now = running
    ? `<p class="ov-now"><span class="dot-live" aria-hidden="true"></span><b>Right now:</b> ${esc(d.run.lastAction ?? 'reading your message')}${d.run.backgroundTasks?.length ? ` · in the background: ${esc(d.run.backgroundTasks.map((x) => ctx.agentName(x.agentType ?? '') || x.description).join(', '))}` : ''}</p>`
    : d.drive.terminalSession && !d.drive.terminalSession.stopped
      ? `<p class="ov-now"><span class="dot-live" aria-hidden="true"></span><b>Right now (in your terminal):</b> ${esc(d.drive.terminalSession.lastTool ? ctx.describeTool(d.drive.terminalSession.lastTool.name, d.drive.terminalSession.lastTool.input) : 'working')}</p>`
      : '';
  const headsUp = o.headsUp?.length ? `<ul class="ov-heads">${o.headsUp.map((h) => `<li class="hu-${esc(h.kind)}">${esc(h.text)}</li>`).join('')}</ul>` : '';
  const html = `<div class="ov-top">
      <span class="ov-face">${sprite('conductor', { state: running ? 'working' : d.needsYou ? 'waiting' : 'idle', size: 84, label: 'Foreman' })}</span>
      <div><p class="speaker">The Foreman’s overview</p>
      <p class="ov-headline">${esc(o.headline ?? (d.stageState === 'done' ? 'This job is done.' : 'No overview yet. Ask the Foreman for one.'))}</p>
      ${now}</div>
    </div>
    ${headsUp}
    <div class="ov-grid">
      ${list('Where it stands', o.standing)}
      ${list('What it needs from you', o.needs, 'needs')}
      ${list('Watch out for', o.concerns, 'concerns')}
      ${o.next ? `<div class="ov-block"><h4>Next</h4><p>${esc(o.next)}</p></div>` : ''}
    </div>
    <p class="ov-foot"><span class="muted">${esc(SOURCE_WORDS[o.source] ?? 'Overview')}${o.at ? ` · ${esc(ago(o.at))}` : ''}</span><button type="button" class="btn small" data-quick="overview">Ask the Foreman for a fresh overview</button></p>`;
  setHtml('#job-overview', html);
}

// ---------- The conversation ----------

const QUICK = {
  overview: 'Give me a short, plain-language overview of this job: what it is, where it stands, what you need from me, and what’s next. Don’t start or continue any stage.',
  where: 'Where are we? Answer in two or three plain sentences. Don’t start or continue any stage.',
  needs: 'What do you need from me right now? Keep it short.',
  plan: 'Summarise the plan in plain words: what will change for users, and the main steps. No file-by-file detail.',
  risks: 'Any risks or open problems I should know about? Short list, most important first.',
};

function renderThread(d) {
  // Older briefs fold into one line; the latest brief stays a full bubble.
  const raw = d.thread ?? [];
  const briefs = raw.filter((x) => x.kind === 'brief');
  const latestBrief = briefs.at(-1);
  const older = briefs.slice(0, -1);
  const items = raw.filter((x) => x.kind !== 'brief' || x === latestBrief);
  if (older.length) items.unshift({ kind: 'older-briefs', at: older[0].at, briefs: older });
  const running = d.drive.mode === 'running' && d.run;
  const row = (it, i) => {
    const time = it.at ? `<span class="t-time">${esc(when(it.at))}</span>` : '';
    if (it.kind === 'brief') return `<li class="t-item t-foreman"><span class="t-who">The Foreman</span>${time}<p><b>${esc(it.headline ?? `Brief #${it.number} · ${stageShort(it.stage)}`)}</b></p>${it.point ? `<p class="t-text">${esc(it.point)}</p>` : ''}<button type="button" class="linklike" data-brief="${esc(it.file)}">Read the whole brief</button><div class="md t-body" hidden></div></li>`;
    if (it.kind === 'older-briefs') return `<li class="t-note"><details><summary>${plural(it.briefs.length, 'earlier brief')}</summary><ul class="older">${it.briefs.map((b) => `<li><button type="button" class="linklike" data-brief="${esc(b.file)}">#${b.number} ${esc(b.headline ?? stageShort(b.stage))}</button><div class="md t-body" hidden></div></li>`).join('')}</ul></details></li>`;
    if (it.kind === 'reply') return `<li class="t-item t-foreman"><span class="t-who">The Foreman</span>${time}<div class="md">${it.html}</div>${it.stopped ? '<p class="muted">(paused before it finished)</p>' : ''}</li>`;
    if (it.kind === 'you') return `<li class="t-item t-you"><span class="t-who">You</span>${time}<p class="t-text">${esc(it.text)}</p></li>`;
    if (it.kind === 'auto') return `<li class="t-note"><details><summary>Handled for you: ${plural(it.items.length, 'routine step')}</summary><ul>${it.items.map((x) => `<li>${esc(ctx.agentName(x.who))}: ${esc(x.headline)} <span class="muted">· ${esc(x.reason ?? '')}</span></li>`).join('')}</ul></details></li>`;
    if (it.kind === 'problem') return `<li class="t-item t-problem"><span class="t-who">Problem</span>${time}<p>${esc(it.text)}</p><button type="button" class="btn small" data-advise="${i}">Ask the Foreman what to do</button></li>`;
    return `<li class="t-note">${esc(it.text)}${it.at ? ` <span class="muted">· ${esc(when(it.at))}</span>` : ''}</li>`;
  };
  const live = running ? `<li class="t-item t-foreman t-live"><span class="t-who">The Foreman</span><span class="t-time">now</span>${d.run.lastText ? `<p class="t-text">${esc(d.run.lastText)}</p>` : ''}<p class="typing" aria-label="Working"><i></i><i></i><i></i></p></li>` : '';
  const shown = items.slice(-25);
  const html = `<header class="panel-head"><span class="speaker">Your conversation with the Foreman</span>${items.length > shown.length ? `<span class="muted">last ${shown.length} of ${items.length}</span>` : ''}</header>
    ${items.length || running ? `<ol class="t-list">${shown.map((it, i) => row(it, items.length - shown.length + i)).join('')}${live}</ol>` : '<p class="muted">Nothing yet. Messages you send from here, and the Foreman’s briefs and replies, show up here.</p>'}`;
  const list = $('#job-thread .t-list');
  const atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  setHtml('#job-thread', html, () => {
    // Keep the newest message in view, unless you've scrolled up to read something.
    const l = $('#job-thread .t-list');
    if (l && atBottom) l.scrollTop = l.scrollHeight;
  });
}

// Only touch the DOM when something changed, so animations and focus survive refreshes.
function setHtml(sel, html, after) {
  const el = $(sel);
  if (!el || el._html === html) return;
  el.innerHTML = html;
  el._html = html;
  after?.();
}

// ---------- Your move ----------

function renderMove(d) {
  const el = $('#job-move');
  if (el.contains(document.activeElement) && el._mode === moveMode(d)) return; // don't yank the form while typing
  el._mode = moveMode(d);
  if (d.drive.mode === 'running' && d.run) { el.innerHTML = runPanel(d.run) + policyLine(d); bindRunPanel(d.run); return; }
  if (d.drive.mode === 'terminal') { el.innerHTML = takeoverPanel(d); bindTakeover(d); return; }
  if (!d.repoPath) { el.innerHTML = repoPanel(d); bindRepoPanel(d); return; }
  const terminalNote = d.drive.mode === 'terminal-open' ? terminalOpenNote(d) : '';
  el.innerHTML = terminalNote + (d.needsYou ? replyPanel(d) : messagePanel(d)) + quickRow() + policyLine(d);
  bindReply(d);
}
const moveMode = (d) => `${d.drive.mode}:${d.needsYou}:${d.run?.id ?? ''}:${d.latestBrief?.number ?? ''}:${d.repoPath ?? ''}:${d.policy}`;

function quickRow() {
  return `<div class="quick"><p class="muted">Ask the Foreman:</p>
    <button type="button" class="chip-btn" data-quick="where">Where are we?</button>
    <button type="button" class="chip-btn" data-quick="needs">What do you need from me?</button>
    <button type="button" class="chip-btn" data-quick="plan">Explain the plan simply</button>
    <button type="button" class="chip-btn" data-quick="risks">Any risks?</button></div>`;
}

function policyLine(d) {
  if (d.policy === 'auto') return '<p class="policy-line">Auto mode: Claude Code’s safety model decides each step; pushes, PRs, deletes and migrations still ask you. Change it in the new view (/next). <button type="button" class="linklike" data-policy="ask-all">Ask me about every step instead</button></p>';
  return d.policy === 'ask-all'
    ? '<p class="policy-line">You approve every step. <button type="button" class="linklike" data-policy="hands-off">Let routine steps run on their own</button></p>'
    : '<p class="policy-line">Routine steps run on their own; you’re asked only about risky ones. <button type="button" class="linklike" data-policy="ask-all">Ask me about every step instead</button></p>';
}

function terminalOpenNote(d) {
  const list = d.drive.terminals.map((t) => `<li>Since ${esc(when(t.started))} <span class="muted">(process ${t.pid})</span></li>`).join('');
  return `<div class="notice"><p><b>Claude Code is open in this repository</b> in ${plural(d.drive.terminals.length, 'terminal')}:</p><ul>${list}</ul>
    <p>If one of them is this job’s Foreman, keep talking to it there (or close it with <code>/exit</code>) so two Foremen don’t work on the same job. Sending from here starts a Foreman that picks the job up from its files.</p></div>`;
}

function repoPanel(d) {
  return `<header class="panel-head"><span class="speaker">Your move</span></header>
    <form class="reply repo-form" novalidate>
      <p class="hint"><b>Which repository is this job in?</b> I couldn’t tell from its files. Pick it once and I’ll remember.</p>
      <label class="field"><span>Repository</span><select name="repo"><option value="">Loading…</option></select></label>
      <label class="field other-repo" hidden><span>Folder path</span><input type="text" name="repoPath" placeholder="/Users/you/Projects/your-repo"></label>
      <label class="field"><span>Branch <span class="muted">(optional)</span></span><input type="text" name="branch" placeholder="e.g. feature/${esc(d.slug)}" value="${esc(d.branch ?? '')}"></label>
      <p class="form-error" role="alert" hidden></p>
      <div class="reply-actions"><button type="submit" class="btn primary">Save</button></div>
    </form>`;
}

async function bindRepoPanel(d) {
  const form = $('#job-move .repo-form');
  const sel = $('select[name=repo]', form);
  let repos = [];
  try { repos = (await getJson('/api/repos')).repos; } catch { /* typing a path still works */ }
  sel.innerHTML = `${repos.map((r) => `<option value="${esc(r.path)}">${esc(r.name)} — ${esc(r.path)}</option>`).join('')}<option value="__other">Another folder…</option>`;
  const toggle = () => { $('.other-repo', form).hidden = sel.value !== '__other'; };
  sel.addEventListener('change', toggle);
  toggle();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const repoPath = sel.value === '__other' ? String(fd.get('repoPath') ?? '').trim() : sel.value;
    try {
      await postJson(`/api/job/${encodeURIComponent(d.slug)}/repo`, { repoPath, branch: String(fd.get('branch') ?? '').trim() });
      toast('Saved. The Foreman will work in that repository.', { tone: 'good' });
      showJob(d.slug, { quiet: true });
    } catch (err) {
      const box = $('.form-error', form);
      box.hidden = false;
      box.textContent = err.message;
    }
  });
}

function runPanel(run) {
  const bg = run.backgroundTasks ?? [];
  return `<header class="panel-head"><span class="speaker">Working on it</span><span class="muted">${esc(RUN_WORDS[run.status] ?? run.status)} · ${esc(since(run.startedAt))}</span></header>
    <div class="run-now">
      ${sprite('conductor', { state: 'working', size: 64, label: 'Foreman, working' })}
      <div><p class="run-doing"><b>The Foreman</b> ${esc(run.lastAction ? `· ${run.lastAction}` : 'is reading your message')}</p>
      ${bg.length ? `<p class="run-bg">In the background: ${bg.map((t) => esc(ctx.agentName(t.agentType ?? '') || t.description)).join(', ')}</p>` : ''}
      ${run.pending ? `<p class="run-wait">${plural(run.pending, 'permission')} waiting for your click above.</p>` : ''}</div>
    </div>
    <span class="wip" aria-hidden="true"><i></i></span>
    <div class="reply-actions"><button type="button" class="btn" data-pause>Pause</button></div>
    <p class="fineprint"><b>Pause</b> stops this reply right away. Nothing is lost: send the Foreman a message later and it carries on from where it stopped.</p>`;
}

function bindRunPanel(run) {
  $('[data-pause]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await postJson(`/api/runs/${run.id}/stop`, {}); toast('Pausing. The Foreman stops after its current step.'); }
    catch (err) { toast(esc(err.message), { tone: 'bad' }); e.target.disabled = false; }
  });
}

function takeoverPanel(d) {
  return `<header class="panel-head"><span class="speaker">Your move</span></header>
    <div class="takeover">
      ${sprite('conductor', { state: 'idle', size: 64, label: 'Foreman' })}
      <div>
        <h3>This job’s Foreman lives in your terminal</h3>
        <p>It was last used from a terminal ${esc(ago(d.drive.lastTerminalAt))}. Only one place drives a Foreman at a time, so nothing gets mixed up.</p>
        <ol><li>If it’s still open in a terminal, type <code>/exit</code> there.</li><li>Then take it over here. You can go back later with <code>claude --resume ${esc(d.drive.sessionId)}</code>.</li></ol>
        <label class="check"><input type="checkbox" id="closed-check"> I’ve closed it in the terminal</label>
        <div class="reply-actions"><button type="button" class="btn primary" id="takeover" disabled>Take over here</button></div>
      </div>
    </div>`;
}

function bindTakeover(d) {
  const box = $('#closed-check');
  const btn = $('#takeover');
  box?.addEventListener('change', () => { btn.disabled = !box.checked; });
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    try { await postJson(`/api/job/${encodeURIComponent(d.slug)}/takeover`, {}); toast('Taken over. You can answer from here now.', { tone: 'good' }); showJob(d.slug, { quiet: true }); }
    catch (err) { toast(esc(err.message), { tone: 'bad' }); btn.disabled = false; }
  });
}

function questionHtml(q, i) {
  const saved = draft.answers[q.id] ?? (q.recommendation ? { choice: q.recommendation } : {});
  if (!q.options.length) {
    return `<fieldset class="q" data-q="${esc(q.id)}"><legend><span class="qn">${i + 1}</span>${esc(q.text)}</legend><textarea rows="2" data-other placeholder="Your answer">${esc(saved.other ?? '')}</textarea></fieldset>`;
  }
  return `<fieldset class="q" data-q="${esc(q.id)}"><legend><span class="qn">${i + 1}</span>${esc(q.text)}</legend>
    ${q.options.map((o) => `<label class="opt"><input type="radio" name="q-${esc(q.id)}" value="${esc(o.id)}"${saved.choice === o.id ? ' checked' : ''}><span><b>${esc(o.label)}</b>${q.recommendation === o.id ? '<em class="rec">Recommended</em>' : ''}</span></label>`).join('')}
    <label class="opt other"><input type="radio" name="q-${esc(q.id)}" value="__other"${saved.choice === '__other' ? ' checked' : ''}><span>Something else <input type="text" data-other value="${esc(saved.other ?? '')}" aria-label="Your own answer"></span></label>
  </fieldset>`;
}

function decidedHtml(list) {
  const open = list.filter((x) => !x.confirmed);
  if (!open.length) return '';
  return `<div class="decided"><h4>★ Decided for you <span class="muted">(please check)</span></h4>
    ${open.map((x) => {
      const key = x.id ?? x.decision;
      const v = draft.verdicts[key]?.verdict ?? '';
      return `<div class="dec" data-dec="${esc(key)}"><p><b>${esc(x.id ?? '')}</b> ${esc(x.decision)}${x.reason || x.where ? `<small>${esc([x.reason, x.where].filter(Boolean).join(' · '))}</small>` : ''}</p>
        <div class="seg small" role="group" aria-label="Your verdict on ${esc(x.id ?? 'this decision')}">
          <label><input type="radio" name="dec-${esc(key)}" value="confirm"${v === 'confirm' ? ' checked' : ''}><span>Confirm</span></label>
          <label><input type="radio" name="dec-${esc(key)}" value="change"${v === 'change' ? ' checked' : ''}><span>Change</span></label>
          <label><input type="radio" name="dec-${esc(key)}" value=""${!v ? ' checked' : ''}><span>Later</span></label>
        </div>
        <input type="text" class="dec-note" placeholder="What should it be instead?" value="${esc(draft.verdicts[key]?.note ?? '')}"${v === 'change' ? '' : ' hidden'}>
      </div>`;
    }).join('')}
    <button type="button" class="btn ghost small" data-confirm-all>Confirm all</button></div>`;
}

function replyPanel(d) {
  const noSession = d.drive.mode === 'none';
  return `<header class="panel-head"><span class="speaker">Your move</span>${d.waitingSince ? `<span class="muted">waiting ${esc(since(d.waitingSince))}</span>` : ''}</header>
    <form class="reply" novalidate>
      ${d.questionsFull.length ? `<p class="hint">Your answers (the recommended ones are picked for you):</p>${d.questionsFull.map(questionHtml).join('')}` : ''}
      ${decidedHtml(d.decidedOnYourBehalf)}
      ${d.nextProposed ? `<p class="next-line">If you approve, next: <b>${esc(d.nextProposed)}</b></p>` : ''}
      <div class="reply-actions">
        <button type="button" class="btn primary big" data-kind="approve">Approve and continue</button>
        <button type="button" class="btn" data-kind="changes">Ask for changes</button>
        <button type="button" class="btn ghost danger" data-kind="stop">Stop this job</button>
      </div>
      <details class="msg"><summary>Or send the Foreman a message</summary><textarea rows="3" data-message placeholder="e.g. Explain finding 3 in plain words">${esc(draft.message)}</textarea><button type="button" class="btn" data-kind="message">Send message</button></details>
      ${noSession ? '<p class="fineprint">No Foreman session is attached to this job yet. Sending starts a new one that picks the job up from its files.</p>' : ''}
    </form>`;
}

function messagePanel(d) {
  const s = ctx.situation(d);
  const lines = { working: 'The crew is working. You can still message the Foreman.', blocked: 'This job is blocked on someone else.', done: 'This job is done.', idle: 'Nothing is running right now.' };
  return `<header class="panel-head"><span class="speaker">Your move</span></header>
    <form class="reply" novalidate>
      <p class="hint">${esc(lines[s.tone] ?? 'Nothing needs you right now.')} ${d.drive.mode === 'none' ? 'No Foreman session is attached yet; sending starts one that picks the job up from its files.' : ''}</p>
      <textarea rows="3" data-message placeholder="Message the Foreman, e.g. “where are we?” or “go ahead with the plan”">${esc(draft.message)}</textarea>
      <div class="reply-actions"><button type="button" class="btn primary" data-kind="message">Send to the Foreman</button>${s.tone !== 'done' ? '<button type="button" class="btn ghost danger" data-kind="stop">Stop this job</button>' : ''}</div>
    </form>`;
}

function readForm(form) {
  for (const fs of $$('fieldset.q', form)) {
    const id = fs.dataset.q;
    const picked = $('input[type=radio]:checked', fs)?.value ?? null;
    const other = $('[data-other]', fs)?.value ?? '';
    draft.answers[id] = picked === '__other' || !$('input[type=radio]', fs) ? { choice: picked === '__other' ? '__other' : null, other } : { choice: picked };
  }
  for (const dec of $$('.dec', form)) {
    const key = dec.dataset.dec;
    const verdict = $('input[type=radio]:checked', dec)?.value ?? '';
    draft.verdicts[key] = { verdict, note: $('.dec-note', dec).value };
    $('.dec-note', dec).hidden = verdict !== 'change';
  }
  draft.message = $('[data-message]', form)?.value ?? '';
}

function bindReply(d) {
  const form = $('#job-move form.reply');
  if (!form) return;
  form.addEventListener('input', () => readForm(form));
  form.addEventListener('change', () => readForm(form));
  $('[data-confirm-all]', form)?.addEventListener('click', () => {
    $$('.dec', form).forEach((dec) => { $('input[value=confirm]', dec).checked = true; });
    readForm(form);
  });
  form.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-kind]')?.dataset.kind;
    if (!kind) return;
    readForm(form);
    reviewAndSend(d, kind);
  });
}

const AFTER = {
  approve: 'The Foreman starts the next stage. You’ll see the crew working here, and it stops again at the next gate.',
  changes: 'The Foreman sends your changes back to the crew and stays in this stage.',
  stop: 'The Foreman records where things stand and stops. You can pick the job up again later.',
  message: 'The Foreman reads your message and replies here.',
};
const TITLES = { approve: 'Approve and continue', changes: 'Ask for changes', stop: 'Stop this job', message: 'Message the Foreman' };

function reviewAndSend(d, kind, presetText = null) {
  const answers = {};
  for (const [id, a] of Object.entries(draft.answers)) answers[id] = a.choice === '__other' ? { other: a.other } : a.choice ? { choice: a.choice } : a.other ? { other: a.other } : null;
  const build = (note) => composeReply({ kind, status: d.statusForCompose, answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => v)), verdicts: draft.verdicts, note });
  const needsNote = kind === 'changes';
  const initialNote = kind === 'message' ? (presetText ?? draft.message) : '';
  const models = ctx.meta.models;
  const currentModel = d.drive.model ?? models[0].id;
  const m = modal(`
    <form class="send">
      <h2>${esc(TITLES[kind])}</h2>
      ${kind !== 'message' ? `<label class="field"><span>${needsNote ? 'What should change?' : 'Anything to add? (optional)'}</span><textarea rows="${needsNote ? 3 : 2}" data-note${needsNote ? ' required autofocus' : ''}></textarea></label>` : ''}
      <div class="field"><span>This is exactly what the Foreman will receive:</span><textarea class="preview" rows="9" data-text>${esc(build(initialNote))}</textarea><small class="muted">You can edit it. It’s also saved in the job’s activity log.</small></div>
      <p class="after"><b>What happens next:</b> ${esc(AFTER[kind])}</p>
      ${d.drive.mode === 'terminal-open' ? `<label class="check"><input type="checkbox" data-confirm-terminal> None of the open terminals is this job’s Foreman</label>` : ''}
      <label class="field inline"><span>Foreman model</span><select data-model>${models.map((x) => `<option value="${esc(x.id)}"${x.id === currentModel ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}${models.some((x) => x.id === currentModel) ? '' : `<option value="${esc(currentModel)}" selected>${esc(modelLabel(currentModel))}</option>`}</select></label>
      <p class="form-error" role="alert" hidden></p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>Back</button><button type="submit" class="btn primary big">Send to the Foreman</button></div>
    </form>`, { label: TITLES[kind] });
  const form = $('form', m.box);
  const text = $('[data-text]', form);
  let edited = false;
  text.addEventListener('input', () => { edited = true; });
  $('[data-note]', form)?.addEventListener('input', (e) => { if (!edited) text.value = build(e.target.value); });
  $('[data-close]', form).addEventListener('click', () => m.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    if (needsNote && !$('[data-note]', form).value.trim() && !edited) { err.hidden = false; err.textContent = 'Say what should change first.'; return; }
    const confirmBox = $('[data-confirm-terminal]', form);
    if (confirmBox && !confirmBox.checked) { err.hidden = false; err.textContent = 'Please check the open terminals first, then tick the box.'; return; }
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await postJson(`/api/job/${encodeURIComponent(d.slug)}/send`, { kind, text: text.value, model: $('[data-model]', form).value, confirmNoTerminal: Boolean(confirmBox?.checked) });
      draft = { slug: d.slug, answers: {}, verdicts: {}, message: '' };
      m.close();
      toast('Sent. The Foreman is on it.', { tone: 'good' });
      showJob(d.slug, { quiet: true });
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.data?.code === 'terminal' ? 'This job’s Foreman was last used in your terminal. Take it over first (see the Your move panel).' : ex.message;
      btn.disabled = false;
      btn.textContent = 'Send to the Foreman';
    }
  });
}

// ---------- Tabs ----------

function tabsHtml(d) {
  const tabs = [
    ['briefs', 'Briefs', d.briefs.length],
    ['files', 'Files', d.artifacts.length + (d.specFile ? 1 : 0)],
    ['code', 'Code', null],
    ['approvals', 'Approvals', d.approvals.length],
    ['costs', 'Costs', null],
    ['crew', 'Crew', d.activity.filter((a) => a.state === 'running').length || null],
  ];
  return tabs.map(([id, label, n]) => `<button type="button" role="tab" id="tab-${id}" aria-selected="${tab === id}" data-tab="${id}">${esc(label)}${n ? ` <span class="count">${n}</span>` : ''}</button>`).join('');
}

function bindStatic() {
  const root = $('.job');
  bindIdLinks($('#job-overview'));
  bindIdLinks($('#job-thread'));
  root.addEventListener('click', async (e) => {
    const opt = e.target.closest('[data-opts]');
    if (opt) return ({ edit: editOptions, fable: askFable, close: closeJob, reopen: reopenJob })[opt.dataset.opts]?.(current);
    const q = e.target.closest('[data-quick]');
    if (q) return reviewAndSend(current, 'message', QUICK[q.dataset.quick]);
    const brief = e.target.closest('[data-brief]');
    if (brief) {
      const body = brief.nextElementSibling;
      if (!body.hidden) { body.hidden = true; brief.textContent = brief.dataset.label ?? 'Read the whole brief'; return; }
      brief.dataset.label ??= brief.textContent;
      body.hidden = false;
      body.innerHTML = '<p class="muted">Opening…</p>';
      brief.textContent = 'Hide';
      try { body.innerHTML = (await getJson(`/api/job/${encodeURIComponent(current.slug)}/doc?file=${encodeURIComponent(brief.dataset.brief)}`)).html; }
      catch (err) { body.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
      return;
    }
    const advise = e.target.closest('[data-advise]');
    if (advise) {
      const item = current.thread[Number(advise.dataset.advise)];
      return reviewAndSend(current, 'message', `That last step hit a problem: “${item?.text ?? ''}”. What happened, and what do you suggest? Don’t retry anything risky without asking me.`);
    }
    if (e.target.closest('[data-change-repo]')) {
      const el = $('#job-move');
      el.innerHTML = repoPanel(current);
      el._mode = 'repo';
      bindRepoPanel(current);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const pol = e.target.closest('[data-policy]');
    if (pol) {
      try { await postJson('/api/settings', { policy: pol.dataset.policy }); toast(pol.dataset.policy === 'ask-all' ? 'You’ll be asked about every step.' : 'Routine steps now run on their own.', { tone: 'good' }); showJob(current.slug, { quiet: true }); }
      catch (err) { toast(esc(err.message), { tone: 'bad' }); }
    }
  });
  $('#job-details').addEventListener('toggle', (e) => { if (e.target.open) renderTab(); });
  const panel = $('#tab-panel');
  bindIdLinks(panel);
  panel.addEventListener('click', (e) => {
    const doc = e.target.closest('[data-doc]');
    if (doc) return openDoc(panel, doc);
    const sha = e.target.closest('[data-sha]');
    if (sha) return openCommit(panel, sha);
  });
  $('#job-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]')?.dataset.tab;
    if (!t || t === tab) return;
    tab = t;
    prefs.set('jobTab', t);
    renderTab();
  });
  $('#job-tabs').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const btns = $$('[data-tab]', $('#job-tabs'));
    const i = btns.findIndex((b) => b.dataset.tab === tab);
    const next = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
    next.click();
    next.focus();
  });
}

async function renderTab({ soft = false } = {}) {
  const d = current;
  setHtml('#job-tabs', tabsHtml(d));
  const panel = $('#tab-panel');
  panel.setAttribute('aria-labelledby', `tab-${tab}`);
  if (soft && ['files', 'code'].includes(tab) && panel.dataset.tab === tab) return; // keep the open file or commit
  panel.dataset.tab = tab;
  if (tab === 'briefs') return renderBriefs(panel, d);
  if (tab === 'files') return renderFiles(panel, d);
  if (tab === 'code') return renderCode(panel, d);
  if (tab === 'approvals') return renderApprovals(panel, d);
  if (tab === 'costs') return renderCosts(panel, d);
  return renderCrew(panel, d);
}

function renderBriefs(panel, d) {
  if (!d.briefs.length) { panel.innerHTML = '<p class="muted">No saved briefs yet. The Foreman saves each brief here from now on.</p>'; return; }
  const list = [...d.briefs].reverse();
  panel.innerHTML = `<div class="split"><ol class="list">${list.map((b) => `<li><button type="button" data-doc="${esc(b.file)}"><b>#${b.number}</b> ${esc(stageShort(b.stage))}</button></li>`).join('')}</ol><article class="reader md" id="reader"><p class="muted">Pick a brief.</p></article></div>`;
  $('[data-doc]', panel)?.click();
}

function renderFiles(panel, d) {
  const versions = Object.fromEntries((d.recordedArtifacts ?? []).map((a) => [a.path, a.version]));
  const items = [
    ...(d.specFile ? [{ file: 'spec', name: 'Product spec', version: d.spec?.version }] : []),
    ...d.artifacts.map((a) => ({ ...a, version: versions[a.file] })),
  ];
  if (!items.length) { panel.innerHTML = '<p class="muted">No files yet.</p>'; return; }
  panel.innerHTML = `<div class="split"><ol class="list">${items.map((a) => `<li><button type="button" data-doc="${esc(a.file)}"><b>${esc(a.name)}</b>${a.version ? ` <span class="muted">v${esc(a.version)}</span>` : ''}</button></li>`).join('')}</ol><article class="reader md" id="reader"><p class="muted">Pick a file to read it here. Requirement IDs like FR-001 are clickable.</p></article></div>`;
}

async function openDoc(panel, btn) {
  $$('[data-doc]', panel).forEach((b) => b.classList.toggle('on', b === btn));
  const reader = $('#reader', panel);
  reader.innerHTML = '<p class="muted">Opening…</p>';
  try {
    const doc = await getJson(`/api/job/${encodeURIComponent(current.slug)}/doc?file=${encodeURIComponent(btn.dataset.doc)}`);
    reader.innerHTML = `<header class="reader-head"><h3>${esc(doc.name)}</h3>${doc.vscode ? `<a href="${esc(vscodeHref(doc.vscode))}">Open in VS Code</a>` : ''}</header>${doc.html}`;
  } catch (err) {
    reader.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

let codeDir = null;
async function openCommit(panel, btn) {
  $$('[data-sha]', panel).forEach((b) => b.classList.toggle('on', b === btn));
  const box = $('#diff', panel);
  box.innerHTML = '<p class="muted">Loading the diff…</p>';
  try {
    const c = await getJson(`/api/job/${encodeURIComponent(current.slug)}/commit/${btn.dataset.sha}`);
    box.innerHTML = `<header class="reader-head"><h3>${esc(c.message.split('\n')[0])}</h3><small class="muted">${esc(c.author)} · ${esc(when(c.date))} · ${esc(c.sha.slice(0, 10))}</small></header>
      <ul class="files">${c.files.map((f) => `<li><a href="${esc(vscodeHref(`${codeDir}/${f.path}`))}">${esc(f.path)}</a> <span class="add">+${f.added ?? '?'}</span> <span class="del">−${f.removed ?? '?'}</span></li>`).join('')}</ul>
      ${c.patchFiles.map((f) => `<details class="diff" open><summary>${esc(f.path)}</summary><pre>${f.lines.map((l) => `<span class="${l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}">${esc(l)}</span>`).join('\n')}</pre></details>`).join('')}
      ${c.truncated ? '<p class="muted">This change is very large; the rest is cut off here. Open it in VS Code to see everything.</p>' : ''}`;
  } catch (err) {
    box.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

function bindIdLinks(root) {
  if (!root || root._idBound) return;
  root._idBound = true;
  root.addEventListener('click', async (e) => {
    const a = e.target.closest('a.id-link');
    if (!a) return;
    e.preventDefault();
    const id = a.dataset.id;
    try {
      const info = await getJson(`/api/job/${encodeURIComponent(current.slug)}/ids/${encodeURIComponent(id)}`);
      const def = info.definition;
      const m = modal(`<div class="idbox"><h2>${esc(id)}</h2>
        ${def ? `<p class="muted">Defined in <b>${esc(def.doc)}</b>, line ${def.line}</p><blockquote>${esc(def.text)}</blockquote>` : '<p class="muted">Not found in this job’s files.</p>'}
        ${info.mentions.length > 1 ? `<h3>Mentioned in</h3><ul>${info.mentions.map((x) => `<li><b>${esc(x.doc)}</b> line ${x.line}: <span>${esc(x.text)}</span></li>`).join('')}</ul>` : ''}
        <div class="modal-actions"><button type="button" class="btn primary" data-close>Close</button></div></div>`, { label: id });
      $('[data-close]', m.box).addEventListener('click', () => m.close());
    } catch (err) {
      toast(esc(err.message), { tone: 'bad' });
    }
  });
}

async function renderCode(panel, d) {
  panel.innerHTML = '<p class="muted">Reading the branch…</p>';
  let data;
  try { data = await getJson(`/api/job/${encodeURIComponent(d.slug)}/commits`); } catch (err) { panel.innerHTML = `<p class="muted">${esc(err.message)}</p>`; return; }
  const head = `<header class="reader-head"><p>${d.branch ? `Branch <code>${esc(d.branch)}</code>` : 'No branch yet'}${data.dir ? ` in <code>${esc(data.dir)}</code>` : ''}</p>${data.dir ? `<a href="${esc(vscodeHref(data.dir))}">Open in VS Code</a>` : ''}</header>`;
  if (!data.commits.length) { panel.innerHTML = `${head}<p class="muted">${esc(data.note ?? 'No commits on this branch yet.')}</p>`; return; }
  codeDir = data.dir;
  panel.innerHTML = `${head}<div class="split"><ol class="list commits">${data.commits.map((c) => `<li><button type="button" data-sha="${esc(c.sha)}">${c.step ? `<span class="step">${esc(c.step)}</span>` : ''}<b>${esc(c.subject)}</b><small>${esc(c.short)} · ${esc(when(c.date))}</small></button></li>`).join('')}</ol><article class="reader" id="diff"><p class="muted">Pick a commit to see its changes.</p></article></div>`;
}

function renderApprovals(panel, d) {
  const sent = (d.audit ?? []).filter((a) => ['send', 'permission', 'takeover', 'stop-now', 'new-job'].includes(a.action)).reverse();
  const actionWords = { send: 'Sent to the Foreman', permission: 'Permission', takeover: 'Took over from the terminal', 'stop-now': 'Paused a reply', 'new-job': 'Started the job' };
  panel.innerHTML = `
    <h3>Approvals in the job’s record</h3>
    ${d.approvals.length ? `<div class="table-wrap"><table class="approvals"><thead><tr><th>When</th><th>Who</th><th>What they said</th><th>About</th><th>Allows</th><th>State</th></tr></thead><tbody>
      ${d.approvals.map((a) => `<tr class="${a.superseded ? 'superseded' : ''}"><td>${esc(a.date ?? '')}</td><td>${esc(a.who ?? '')}</td><td><q>${esc(a.said ?? '')}</q></td><td>${esc(a.artifact ?? '')}</td><td>${esc([a.authorizes, a.scope].filter(Boolean).join(' · '))}</td><td>${a.superseded ? `<span class="badge-old" title="${esc(a.state ?? '')}">Replaced</span>` : esc(a.state ?? '')}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No approvals recorded yet.</p>'}
    <h3>Sent from the workshop</h3>
    ${sent.length ? `<ul class="audit">${sent.map((a) => `<li><span class="muted">${esc(when(a.at))}</span> <b>${esc(actionWords[a.action] ?? a.action)}</b>${a.action === 'permission' ? `: ${esc(a.decision === 'deny' ? 'Denied' : a.decision === 'allow-run' ? 'Allowed for that reply' : 'Allowed once')} · ${esc(a.headline ?? a.tool ?? '')}${a.note ? ` · “${esc(a.note)}”` : ''}` : ''}${a.text ? `<pre>${esc(a.text)}</pre>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Nothing sent from here yet.</p>'}`;
}

function bar(value, max) {
  const pct = max ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return `<progress max="100" value="${pct}" aria-hidden="true"></progress>`;
}

function renderCosts(panel, d) {
  const c = d.costDetail;
  const byStage = {};
  for (const a of c.agents) byStage[a.stage] = (byStage[a.stage] ?? 0) + a.usd;
  const stageRows = ctx.meta.stages.map((s) => s.id).concat('other').filter((s) => byStage[s]);
  const maxStage = Math.max(0, ...Object.values(byStage));
  const w = c.whatIf;
  panel.innerHTML = `
    <p class="cost-total"><b>${esc(usd(c.totalUsd, c.source))}</b> so far · ${c.source === 'claude-code' ? 'Claude Code’s own figure' : c.source === 'estimate' ? 'estimated from token counts' : 'no sessions found yet'}</p>
    ${stageRows.length ? `<h3>By stage</h3><ul class="bars">${stageRows.map((s) => `<li><span>${esc(stageShort(s))}</span>${bar(byStage[s], maxStage)}<b>${esc(usd(byStage[s]))}</b></li>`).join('')}</ul>` : ''}
    ${c.agents.length ? `<h3>By crew member</h3><div class="table-wrap"><table><thead><tr><th>Who</th><th>Stage</th><th>Model</th><th>Tokens out</th><th>Cost</th></tr></thead><tbody>${c.agents.map((a) => `<tr><td>${esc(ctx.agentName(a.agentType))}</td><td>${esc(stageShort(a.stage))}</td><td>${esc(modelLabel(a.model))}</td><td>${esc(fmtTokens(a.tokens.output))}</td><td>${esc(usd(a.usd))}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${w ? `<h3>What if the Foreman ran on another model?</h3><p class="muted">The Foreman’s share here was ${esc(usd(w.actual))} on ${esc(w.actualModels.join(', '))}. The same work re-priced:</p>
      <ul class="bars">${Object.entries(w.alternatives).map(([k, v]) => `<li><span>${esc(ctx.meta.prices.models[k].label)}</span>${bar(v, Math.max(...Object.values(w.alternatives)))}<b>≈${esc(usd(v))}</b></li>`).join('')}</ul>` : ''}
    <p class="fineprint">These are estimates for comparing setups, not a bill. <a href="#/costs">All jobs’ costs and the export →</a></p>`;
}

function renderCrew(panel, d) {
  const words = { running: 'Working', finished: 'Finished', delegating: 'Waiting on a worker', stopped: 'Stopped when you paused' };
  const people = [...d.activity].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  panel.innerHTML = `
    ${people.length ? `<ul class="crew-list">${people.map((a) => `<li class="${a.state === 'running' ? 'busy' : ''}">${sprite(a.who === 'conductor' ? 'conductor' : a.who, { state: a.state === 'running' ? 'working' : 'idle', size: 48, label: ctx.agentName(a.who) })}<div><b>${esc(ctx.agentName(a.who))}</b> <span class="muted">${esc(words[a.state] ?? a.state)}${a.lastAt ? ` · last active ${esc(ago(a.lastAt))}` : ''}</span>${a.description ? `<small>${esc(a.description)}</small>` : ''}${a.doing ? `<small>Last: ${esc(a.doing)}</small>` : ''}${a.quiet ? `<small class="hint-warn">Quiet for ${esc(duration(a.quiet.quietMs))}. If it’s waiting for a permission click, that’s in its terminal.</small>` : ''}</div></li>`).join('')}</ul>` : '<p class="muted">No Claude Code sessions found for this job yet.</p>'}
    ${d.prs?.some((p) => p.state && p.state !== 'not_started') ? `<h3>Pull requests</h3><ul class="prs">${d.prs.map((p) => `<li><b>PR #${p.number}</b> ${esc(p.label ?? '')} · ${esc((p.state ?? '').replace(/_/g, ' '))}${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>` : ''}</li>`).join('')}</ul>` : ''}
    ${d.runs?.length ? `<h3>Replies sent from here</h3><ul class="audit">${d.runs.map((r) => `<li><span class="muted">${esc(when(r.startedAt))}</span> <b>${esc(RUN_WORDS[r.status] ?? r.status)}</b>${r.costUsd != null ? ` · ${esc(usd(r.costUsd))}` : ''}${r.error ? `<small class="hint-warn">${esc(r.error)}</small>` : ''}</li>`).join('')}</ul>` : ''}
    ${d.warnings?.length ? `<details class="warnings"><summary>Notes about this job’s files</summary><ul>${d.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}`;
}

export const currentJobSlug = () => current?.slug ?? null;
