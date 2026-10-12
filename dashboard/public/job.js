// One job's page: what's happening, what the Foreman said, your move, and the details.

import { $, $$, esc, since, ago, duration, when, plural, usd, fmtTokens, modelLabel, vscodeHref, prefs, getJson, postJson, toast, modal } from './ui.js';
import { sprite, renderMap, stageShort, STAGE_CHARACTER } from './crew.js';
import { permissionCard, bindPermissionCards } from './panels.js';
import { composeReply } from '/shared/compose.js';

let ctx = null; // { meta, agentName, situation }
let current = null; // the job detail being shown
let draft = { slug: null, answers: {}, verdicts: {}, message: '' }; // survives live refreshes
let tab = 'briefs';

const RUN_WORDS = { starting: 'Starting up', running: 'Working', waiting_permission: 'Waiting for your click', stopping: 'Pausing…', done: 'Finished', stopped: 'Paused', error: 'Hit a problem' };

export function initJob(c) { ctx = c; }

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
    tab = prefs.get('jobTab', 'briefs');
    app.innerHTML = skeleton(detail);
    bindStatic();
  }
  renderTop(detail);
  renderMove(detail);
  if (first) await renderTab();
  else if (!$('.tab-panel').contains(document.activeElement)) await renderTab({ soft: true });
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
      <section class="brief gbox" id="job-brief" aria-label="What the Foreman said"></section>
      <aside class="move gbox" id="job-move" aria-label="Your move"></aside>
    </div>
    <nav class="tabs" role="tablist" aria-label="Job details" id="job-tabs"></nav>
    <section class="tab-panel gbox" id="tab-panel" role="tabpanel"></section>
  </div>`;
}

// ---------- Top: header, permissions, scene, brief ----------

function renderTop(d) {
  const sit = ctx.situation(d);
  const pill = `<span class="pill pill-${sit.tone}"><i class="led" aria-hidden="true"></i>${esc(ctx.pillText(sit.tone))}</span>`;
  const meta = [
    d.project?.name ? `<span>${esc(d.project.name)}</span>` : '',
    d.branch ? `<span>Branch <code>${esc(d.branch)}</code></span>` : '',
    d.worktree ? `<a href="${esc(vscodeHref(d.worktree))}">Open the job’s folder in VS Code</a>` : d.repoPath ? `<a href="${esc(vscodeHref(d.repoPath))}">Open the repository in VS Code</a>` : '',
    d.spec?.version ? `<span>Spec v${esc(d.spec.version)}${d.spec.status ? ` · ${esc(d.spec.status)}` : ''}</span>` : '',
    `<span title="${d.costDetail.source === 'estimate' ? 'Estimated from token counts' : 'Claude Code’s own figure'}">${esc(usd(d.cost.totalUsd, d.cost.source))} so far</span>`,
  ].filter(Boolean).join('<span class="dot-sep" aria-hidden="true">·</span>');
  setHtml('#job-head', `<div class="job-title"><span class="types"><span class="type type-${d.kind}">${d.kind === 'bug' ? 'Bug' : 'Feature'}</span>${d.route ? `<span class="type type-${d.route}">${esc(d.route)}</span>` : ''}</span><h2>${esc(d.title)}</h2>${pill}</div><p class="job-meta">${meta}</p>`);
  $('#job-head').className = `job-head gbox state-${sit.tone}`;

  const perms = d.permissionsPending ?? [];
  setHtml('#job-perms', perms.map((p) => permissionCard(p, { agentName: ctx.agentName, showJob: false })).join(''));
  bindPermissionCards($('#job-perms'), { onDone: () => showJob(d.slug, { quiet: true }) });

  setHtml('#job-scene', renderMap(ctx.meta.stages, d, sit, { agentName: ctx.agentName, size: 136, long: true }), () => ctx.walk?.($('#job-scene'), d.slug, $('#job-scene .map')));

  const running = d.drive.mode === 'running' && d.run;
  let briefHtml;
  if (running && d.run.lastText) {
    briefHtml = `<header class="panel-head"><span class="speaker">The Foreman · live</span><span class="muted">${esc(since(d.run.startedAt))}</span></header><div class="md live">${esc(d.run.lastText).replace(/\n/g, '<br>')}</div>`;
  } else if (d.latestBrief) {
    briefHtml = `<header class="panel-head"><span class="speaker">The Foreman’s brief${d.latestBrief.number ? ` #${d.latestBrief.number}` : ''}</span>${d.waitingSince ? `<span class="muted">${esc(ago(d.waitingSince))}</span>` : ''}</header><div class="md">${d.latestBrief.html}</div>`;
  } else if (d.currentText) {
    briefHtml = `<header class="panel-head"><span class="speaker">Where things stand</span></header><div class="md"><p>${esc(d.currentText)}</p>${d.nextProposed ? `<p><b>Next proposed:</b> ${esc(d.nextProposed)}</p>` : ''}<p class="muted">This job doesn’t save its briefs yet, so this comes from its workflow-status.md. Full briefs appear here once the Foreman writes them.</p></div>`;
  } else {
    briefHtml = '<header class="panel-head"><span class="speaker">The Foreman’s brief</span></header><p class="muted">No brief yet.</p>';
  }
  setHtml('#job-brief', briefHtml);
  bindIdLinks($('#job-brief'));
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
  if (d.drive.mode === 'running' && d.run) { el.innerHTML = runPanel(d.run); bindRunPanel(d.run); return; }
  if (d.drive.mode === 'terminal') { el.innerHTML = takeoverPanel(d); bindTakeover(d); return; }
  el.innerHTML = d.needsYou && (d.questionsFull.length || d.waitingFor || d.decidedOnYourBehalf.some((x) => !x.confirmed)) ? replyPanel(d) : messagePanel(d);
  bindReply(d);
}
const moveMode = (d) => `${d.drive.mode}:${d.needsYou}:${d.run?.id ?? ''}:${d.latestBrief?.number ?? ''}`;

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

function reviewAndSend(d, kind) {
  const answers = {};
  for (const [id, a] of Object.entries(draft.answers)) answers[id] = a.choice === '__other' ? { other: a.other } : a.choice ? { choice: a.choice } : a.other ? { other: a.other } : null;
  const build = (note) => composeReply({ kind, status: d.statusForCompose, answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => v)), verdicts: draft.verdicts, note });
  const needsNote = kind === 'changes';
  const initialNote = kind === 'message' ? draft.message : '';
  const models = ctx.meta.models;
  const currentModel = d.drive.model ?? models[0].id;
  const m = modal(`
    <form class="send">
      <h2>${esc(TITLES[kind])}</h2>
      ${kind !== 'message' ? `<label class="field"><span>${needsNote ? 'What should change?' : 'Anything to add? (optional)'}</span><textarea rows="${needsNote ? 3 : 2}" data-note${needsNote ? ' required autofocus' : ''}></textarea></label>` : ''}
      <div class="field"><span>This is exactly what the Foreman will receive:</span><textarea class="preview" rows="9" data-text>${esc(build(initialNote))}</textarea><small class="muted">You can edit it. It’s also saved in the job’s activity log.</small></div>
      <p class="after"><b>What happens next:</b> ${esc(AFTER[kind])}</p>
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
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await postJson(`/api/job/${encodeURIComponent(d.slug)}/send`, { kind, text: text.value, model: $('[data-model]', form).value });
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
  const words = { running: 'Working', finished: 'Finished', delegating: 'Waiting on a worker' };
  const people = [...d.activity].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  panel.innerHTML = `
    ${people.length ? `<ul class="crew-list">${people.map((a) => `<li class="${a.state === 'running' ? 'busy' : ''}">${sprite(a.who === 'conductor' ? 'conductor' : a.who, { state: a.state === 'running' ? 'working' : 'idle', size: 48, label: ctx.agentName(a.who) })}<div><b>${esc(ctx.agentName(a.who))}</b> <span class="muted">${esc(words[a.state] ?? a.state)}${a.lastAt ? ` · last active ${esc(ago(a.lastAt))}` : ''}</span>${a.description ? `<small>${esc(a.description)}</small>` : ''}${a.doing ? `<small>Last: ${esc(a.doing)}</small>` : ''}${a.quiet ? `<small class="hint-warn">Quiet for ${esc(duration(a.quiet.quietMs))}. If it’s waiting for a permission click, that’s in its terminal.</small>` : ''}</div></li>`).join('')}</ul>` : '<p class="muted">No Claude Code sessions found for this job yet.</p>'}
    ${d.prs?.some((p) => p.state && p.state !== 'not_started') ? `<h3>Pull requests</h3><ul class="prs">${d.prs.map((p) => `<li><b>PR #${p.number}</b> ${esc(p.label ?? '')} · ${esc((p.state ?? '').replace(/_/g, ' '))}${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open on GitHub</a>` : ''}</li>`).join('')}</ul>` : ''}
    ${d.runs?.length ? `<h3>Replies sent from here</h3><ul class="audit">${d.runs.map((r) => `<li><span class="muted">${esc(when(r.startedAt))}</span> <b>${esc(RUN_WORDS[r.status] ?? r.status)}</b>${r.costUsd != null ? ` · ${esc(usd(r.costUsd))}` : ''}${r.error ? `<small class="hint-warn">${esc(r.error)}</small>` : ''}</li>`).join('')}</ul>` : ''}
    ${d.warnings?.length ? `<details class="warnings"><summary>Notes about this job’s files</summary><ul>${d.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}`;
}

export const currentJobSlug = () => current?.slug ?? null;
