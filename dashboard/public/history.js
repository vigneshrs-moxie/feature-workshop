// History: past Claude Code conversations on this computer, newest first. Pick one to turn it into
// a job; the crew picks up where you left off through the usual workflow.

import { $, $$, esc, ago, when, plural, prefs, getJson, toast } from './ui.js';
import { openNewJob } from './panels.js';

const KIND_TIPS = {
  job: 'A job already uses this conversation. Open the job instead of starting another.',
  workflow: 'This conversation already ran the /feature workflow.',
  dashboard: 'A conversation the dashboard itself ran (a Foreman or a test). Hidden unless you ask for it.',
  test: 'Ran in a temporary folder, usually a test. Hidden unless you ask for it.',
};
const short = (p) => String(p ?? '').replace(/^\/Users\/[^/]+/, '~');
const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n ?? 0));

export async function showHistory(meta, { onStarted } = {}) {
  const app = $('#app');
  app.innerHTML = `<div class="history">
    <a class="back" href="#/">◀ Back to the map</a>
    <header class="gbox pad history-head">
      <h2>Start from a past conversation</h2>
      <p>Every conversation you’ve had with Claude Code on this computer, newest first. Pick one to turn it into a job: the crew picks up where you left off, through the usual workflow (you still approve every plan).</p>
      <details class="explain"><summary>How it works</summary><ul>
        <li><b>Open a row</b> to see what was asked, which files changed and how it ended.</li>
        <li><b>Make it a job</b> opens New job filled in from that conversation. You choose how much process it gets, as usual.</li>
        <li><b>Fresh Foreman with a summary</b> (recommended): the Foreman reads a short extract of the conversation (<code>history.md</code> in the job’s private folder). Cheap, and a clean start.</li>
        <li><b>Continue that conversation</b>: a copy of it becomes the Foreman, so it remembers everything. The original stays untouched. Costs more on every reply, because the whole conversation is re-read.</li>
        <li>Conversations are read from <code>~/.claude/projects</code> and never leave your computer. Some terminal setups don’t save conversations; those show at the bottom as “no saved log” and can’t be used.</li>
      </ul></details>
    </header>
    <div class="history-filters gbox pad">
      <label class="field inline"><span>Search</span><input type="search" id="h-q" placeholder="Words from the title or the first message" spellcheck="false"></label>
      <label class="field inline"><span>Repository</span><select id="h-repo"><option value="">All</option></select></label>
      <label class="check-line" title="${esc(KIND_TIPS.job)}"><input type="checkbox" id="h-linked"> Show conversations a job already uses</label>
      <label class="check-line" title="${esc(KIND_TIPS.dashboard)}"><input type="checkbox" id="h-dash"> Show the dashboard’s own runs</label>
      <label class="check-line" title="${esc(KIND_TIPS.test)}"><input type="checkbox" id="h-test"> Show test runs</label>
    </div>
    <p class="muted" id="h-count">Reading your conversations…</p>
    <ul class="history-list" id="h-list"></ul>
    <div id="h-missing"></div>
  </div>`;
  // Everything below belongs to this copy of the page: leaving and coming back builds a new one.
  const root = $('.history', app);
  const at = (sel) => $(sel, root);
  for (const [id, key] of [['#h-linked', 'histLinked'], ['#h-dash', 'histDash'], ['#h-test', 'histTest']]) at(id).checked = prefs.get(key, 'no') === 'yes';
  let data = null;
  let asked = 0;
  const load = async () => {
    const mine = ++asked;
    const qs = new URLSearchParams({ q: at('#h-q').value.trim(), repo: at('#h-repo').value, linked: at('#h-linked').checked ? '1' : '', dashboard: at('#h-dash').checked ? '1' : '', test: at('#h-test').checked ? '1' : '' });
    let got;
    try { got = await getJson(`/api/history?${qs}`); } catch (err) { if (root.isConnected) at('#h-count').textContent = err.message; return; }
    if (!root.isConnected || mine !== asked) return; // left the page, or a newer search is on its way
    const first = !data;
    data = got;
    if (first) {
      at('#h-repo').insertAdjacentHTML('beforeend', data.repos.map((r) => `<option value="${esc(r)}">${esc(short(r))}</option>`).join(''));
      if (data.missing.length) {
        at('#h-missing').innerHTML = `<details class="gbox pad"><summary>${esc(plural(data.missing.length, 'conversation'))} with no saved log</summary>
          <p class="fineprint">Claude Code ran these but kept no conversation log (some terminal setups don’t save one), so they can’t be turned into jobs.</p>
          <ul>${data.missing.slice(0, 50).map((m) => `<li>${esc(when(m.lastAt))} · <code>${esc(m.id.slice(0, 8))}</code>${m.job ? ` · used by <a href="#/job/${encodeURIComponent(m.job)}">a job</a>` : ''}</li>`).join('')}</ul></details>`;
      }
    }
    at('#h-count').textContent = !data.total ? 'No saved conversations yet. Have one with Claude Code in a terminal, and it shows up here.'
      : !data.matched ? 'Nothing matches. Try the filters above.'
        : data.matched > data.rows.length ? `Showing the newest ${data.rows.length} of ${data.matched} matching conversations (${data.total} in all). Search to narrow it down.`
          : `${plural(data.matched, 'conversation')} (of ${data.total}). Open one to see it.`;
    at('#h-list').innerHTML = data.rows.map(rowHtml).join('');
  };
  let typing = null;
  at('.history-filters').addEventListener('input', (e) => {
    const key = { 'h-linked': 'histLinked', 'h-dash': 'histDash', 'h-test': 'histTest' }[e.target.id];
    if (key) prefs.set(key, e.target.checked ? 'yes' : 'no');
    clearTimeout(typing);
    typing = setTimeout(load, e.target.id === 'h-q' ? 300 : 0);
  });
  await load();

  at('#h-list').addEventListener('click', async (e) => {
    const make = e.target.closest('[data-make]');
    if (make) {
      const d = make.closest('.hrow')._detail;
      return openNewJob(meta, { from: d, canContinue: data?.canContinue ?? false, onStarted });
    }
    const head = e.target.closest('[data-open]');
    if (!head) return;
    const li = head.closest('.hrow');
    const box = $('.hrow-detail', li);
    const open = box.hidden;
    head.setAttribute('aria-expanded', String(open));
    box.hidden = !open;
    if (!open || li._detail) return;
    box.innerHTML = '<p class="muted">Reading the conversation…</p>';
    try {
      li._detail = await getJson(`/api/history/${encodeURIComponent(head.dataset.open)}`);
      box.innerHTML = detailHtml(li._detail);
    } catch (err) { box.innerHTML = `<p class="warn-text">${esc(err.message)}</p>`; toast(esc(err.message), { tone: 'bad' }); }
  });
}

function rowHtml(r) {
  const badges = [
    r.job ? `<span class="hbadge" title="${esc(KIND_TIPS.job)}">Job</span>` : '',
    r.workflow ? `<span class="hbadge" title="${esc(KIND_TIPS.workflow)}">Workflow</span>` : '',
    r.kind === 'dashboard' ? `<span class="hbadge" title="${esc(KIND_TIPS.dashboard)}">Dashboard</span>` : '',
    r.kind === 'test' ? `<span class="hbadge" title="${esc(KIND_TIPS.test)}">Test</span>` : '',
  ].join('');
  const facts = [
    r.repo ? short(r.repo) : r.cwd ? short(r.cwd) : null,
    r.branch ? `branch ${r.branch}` : null,
    r.lastAt ? `active ${ago(r.lastAt)}` : null,
    plural(r.messages, 'message'),
    r.filesChanged ? plural(r.filesChanged, 'file') + ' changed' : null,
    r.chain.length > 1 ? `${r.chain.length} parts` : null,
  ].filter(Boolean).map(esc).join(' · ');
  return `<li class="hrow gbox">
    <button type="button" class="hrow-head" data-open="${esc(r.id)}" aria-expanded="false">
      <span class="hrow-title"><b>${esc(r.title)}</b>${badges}</span>
      <span class="muted">${facts}</span>
      ${r.firstPrompt && r.firstPrompt !== r.title ? `<small class="hrow-first">${esc(r.firstPrompt.slice(0, 220))}</small>` : ''}
    </button>
    <div class="hrow-detail" hidden></div></li>`;
}

function detailHtml(d) {
  const asked = d.prompts.map((p) => (p.gap ? `<li class="muted">…${esc(plural(p.gap, 'message'))} in between…</li>` : `<li>${p.at ? `<small class="muted">${esc(when(p.at))}</small> ` : ''}${esc(p.text)}</li>`)).join('');
  const files = d.filesEdited.length ? `<ul class="hfiles">${d.filesEdited.map((f) => `<li><code>${esc(short(f))}</code></li>`).join('')}${d.moreFiles ? `<li class="muted">…and ${d.moreFiles} more</li>` : ''}</ul>` : '<p class="muted">No file changes recorded.</p>';
  const action = d.job
    ? `<a class="btn primary" href="#/job/${encodeURIComponent(d.job)}">Open its job</a><span class="fineprint">A job already uses this conversation.</span>`
    : `<button class="btn primary" type="button" data-make>Make it a job</button><span class="fineprint">Opens New job filled in from this conversation; nothing starts until you press Start.</span>`;
  return `<div class="hdetail">
    <div><h4>What was asked</h4><ol class="hasked">${asked}</ol></div>
    <div><h4>Files changed</h4>${files}
      ${d.prs.length ? `<h4>Pull requests</h4><ul>${d.prs.map((p) => `<li>${/^https:\/\//.test(p.url) ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">` : '<span>'}${esc(p.repo ?? p.url)}${p.number ? ` #${esc(p.number)}` : ''}${/^https:\/\//.test(p.url) ? '</a>' : '</span>'}</li>`).join('')}</ul>` : ''}
      <h4>How it ended</h4><p class="hlast">${d.lastAnswer ? esc(d.lastAnswer) : '<span class="muted">Not recorded.</span>'}</p>
      <p class="fineprint">Folder: <code>${esc(short(d.cwd))}</code>${d.contextTokens ? ` · about ${esc(fmtTokens(d.contextTokens))} tokens of conversation` : ''}${d.models.length ? ` · ${esc(d.models.join(', '))}` : ''}</p>
    </div>
    <div class="hactions">${action}</div></div>`;
}
