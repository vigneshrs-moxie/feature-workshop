// Permission cards, the "Start a job" dialog, and alerts (notifications and a chime).

import { $, $$, esc, ago, postJson, getJson, toast, modal, prefs } from './ui.js';
import { sprite, icon } from './crew.js';

// ---------- Permission cards ----------

export function permissionCard(p, { agentName, showJob = true, compact = false } = {}) {
  const who = p.agentType ? agentName(p.agentType) : 'The Foreman';
  const charType = p.agentType ?? 'conductor';
  const risky = p.plain.risk === 'high';
  const head = `<header class="perm-head">
      <span class="perm-face">${sprite(charType, { state: 'waiting', size: compact ? 44 : 60, label: who })}</span>
      <div><p class="perm-who"><b>${esc(who)}</b> wants to</p><h3>${esc(p.plain.headline)}</h3>${showJob ? `<p class="perm-job">Job: <a href="#/job/${encodeURIComponent(p.slug)}">${esc(p.title)}</a> · asked ${esc(ago(p.createdAt))}</p>` : `<p class="perm-job">Asked ${esc(ago(p.createdAt))}</p>`}</div>
    </header>`;
  if (p.kind === 'question') {
    const qs = Array.isArray(p.input?.questions) ? p.input.questions : [];
    return `<article class="perm gbox" data-perm="${esc(p.id)}" data-kind="question">${head}
      <form class="perm-q">${qs.map((q, i) => `<fieldset><legend>${esc(q.question)}</legend>${(q.options ?? []).map((o, k) => `<label class="opt"><input type="${q.multiSelect ? 'checkbox' : 'radio'}" name="q${i}" value="${esc(o.label)}"${k === 0 && !q.multiSelect ? ' checked' : ''}><span><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span></label>`).join('')}<label class="opt other"><input type="radio" name="q${i}" value="__other"><span>Something else: <input type="text" class="other-text" aria-label="Your own answer"></span></label></fieldset>`).join('')}
      <div class="perm-actions"><button type="submit" class="btn primary">Send answers</button><button type="button" class="btn ghost" data-act="deny">Don’t answer</button></div></form>
    </article>`;
  }
  const explain = `<b>Allow once:</b> it does exactly this, one time.${p.canAllowForRun ? ' <b>Allow for this reply:</b> it won’t ask again for this kind of action until this reply is finished.' : ''} <b>Deny:</b> it doesn’t do this and carries on without it. Nothing is saved to your Claude Code settings.`;
  return `<article class="perm gbox${risky ? ' risky' : ''}${compact ? ' compact' : ''}" data-perm="${esc(p.id)}">${head}
    ${p.plain.detail ? `<p class="perm-detail">${esc(p.plain.detail)}</p>` : ''}
    ${p.plain.preview ? `<pre class="perm-preview">${esc(p.plain.preview)}</pre>` : ''}
    ${risky ? '<p class="perm-warn">Take a careful look: this may be hard to undo.</p>' : ''}
    <div class="perm-actions">
      <button type="button" class="btn primary" data-act="allow"${risky ? '' : ' autofocus'}>Allow once</button>
      ${p.canAllowForRun ? '<button type="button" class="btn" data-act="allow-run">Allow for this reply</button>' : ''}
      <button type="button" class="btn danger" data-act="deny-open"${risky ? ' autofocus' : ''}>Deny…</button>
    </div>
    <div class="perm-deny" hidden><label>Tell it why (optional)<input type="text" class="deny-note" placeholder="e.g. Don't touch the database"></label><button type="button" class="btn danger" data-act="deny">Deny</button></div>
    ${compact ? `<details class="perm-explain"><summary>What do these do?</summary>${explain}</details>` : `<p class="perm-explain">${explain}</p>`}
  </article>`;
}

// Wire up any permission cards inside `root`. onDone is called after a decision is sent.
export function bindPermissionCards(root, { onDone } = {}) {
  for (const card of $$('[data-perm]', root)) {
    if (card._bound) continue;
    card._bound = true;
    const id = card.dataset.perm;
    const decide = async (decision, extra = {}) => {
      $$('button', card).forEach((b) => { b.disabled = true; });
      try {
        await postJson(`/api/permissions/${encodeURIComponent(id)}`, { decision, ...extra });
        card.classList.add('decided');
        onDone?.();
      } catch (err) {
        $$('button', card).forEach((b) => { b.disabled = false; });
        toast(esc(err.message), { tone: 'bad' });
      }
    };
    card.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'deny-open') { const box = $('.perm-deny', card); box.hidden = false; $('.deny-note', box).focus(); return; }
      if (act === 'deny') return decide('deny', { note: $('.deny-note', card)?.value ?? '' });
      decide(act);
    });
    $('.deny-note', card)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); decide('deny', { note: e.target.value }); } });
    $('form.perm-q', card)?.addEventListener('submit', (e) => {
      e.preventDefault();
      const answers = {};
      $$('fieldset', card).forEach((fs) => {
        const q = $('legend', fs).textContent;
        const picked = $$('input:checked', fs).map((i) => (i.value === '__other' ? $('.other-text', fs).value.trim() : i.value)).filter(Boolean);
        if (picked.length) answers[q] = picked.join(', ');
      });
      decide('allow', { answers });
    });
  }
}

// ---------- Job options (shared by New job and the job page) ----------

/** The options form's fields. catalog: meta.jobOptions. o: the current options (or null for defaults). */
export function optionsFields(catalog, o, { open = false } = {}) {
  const flow = o?.flow ?? 'auto';
  const cur = o ?? catalog.flows.find((f) => f.id === flow).defaults;
  const checked = (on) => (on ? ' checked' : '');
  const reviewersAuto = cur.reviewers === 'auto';
  return `
    <fieldset class="field flows"><legend>How much process?</legend>
      ${catalog.flows.map((f) => `<label class="opt"><input type="radio" name="flow" value="${esc(f.id)}"${checked(f.id === flow)}><span><b>${esc(f.label)}</b><small>${esc(f.note)}</small></span></label>`).join('')}
    </fieldset>
    <details class="more-opts"${open ? ' open' : ''}><summary>Fine-tune: documents you have, stages to skip, reviewers, Fable checks</summary>
      <p class="fineprint">Picking a flow above resets these to its defaults.</p>
      <fieldset class="field"><legend>I already have…</legend>
        <p class="fineprint">Give the full path to the file. The crew uses yours instead of writing one, and skips that stage.</p>
        ${catalog.providable.map((d) => `<label class="field inline"><span>${esc(d.label)}</span><input type="text" name="provided.${esc(d.id)}" value="${esc(cur.provided?.[d.id] ?? '')}" placeholder="/Users/you/…/${esc(d.id.replace('_', '-'))}.md" spellcheck="false"></label>`).join('')}
      </fieldset>
      <fieldset class="field checks"><legend>Skip these stages</legend>
        ${catalog.skippable.map((st) => `<label><input type="checkbox" name="skip" value="${esc(st.id)}"${checked(cur.skip.includes(st.id))}> ${esc(st.label)}</label>`).join('')}
        <p class="fineprint">You still approve what gets built before any code changes, and every push and PR.</p>
      </fieldset>
      <fieldset class="field"><legend>Reviewers</legend>
        <label><input type="radio" name="reviewersMode" value="auto"${checked(reviewersAuto)}> The usual ones for this kind of change (the Foreman picks)</label>
        <label><input type="radio" name="reviewersMode" value="list"${checked(!reviewersAuto)}> Only these:</label>
        <div class="checks reviewer-list">${catalog.reviewers.map((r) => `<label title="${esc(r.what)}"><input type="checkbox" name="reviewers" value="${esc(r.id)}"${checked(!reviewersAuto && cur.reviewers.includes(r.id))}> ${esc(r.label)} <small>${esc(r.what)} · ${esc(r.model)}</small></label>`).join('')}</div>
        <label class="field inline"><span>Fix rounds after review</span><select name="review_rounds"><option value="1"${cur.review_rounds === 1 ? ' selected' : ''}>1</option><option value="2"${cur.review_rounds === 2 ? ' selected' : ''}>2</option></select></label>
      </fieldset>
      <label class="check-line"><input type="checkbox" name="manual_test"${checked(cur.manual_test)}> I’ll try it myself on my computer before review (the <b>Try it on your computer</b> panel)</label>
      <fieldset class="field checks"><legend>Ask Fable for a second look</legend>
        ${catalog.fablePoints.map((x) => `<label><input type="checkbox" name="fable_checks" value="${esc(x.id)}"${checked(cur.fable_checks.includes(x.id))}> ${esc(x.label)}</label>`).join('')}
        <p class="fineprint">Each check is a short, separate Fable read of just that document or change, not a Fable Foreman. You can also ask for one any time from the job page.</p>
      </fieldset>
      <label class="field"><span>Notes for the Foreman (optional)</span><textarea name="notes" rows="2" maxlength="1000" placeholder="e.g. Keep the PR small. Don’t touch the email templates.">${esc(cur.notes ?? '')}</textarea></label>
    </details>`;
}

/** Read the options form back into an options object. */
export function readOptionsForm(form) {
  const fd = new FormData(form);
  const provided = {};
  for (const [k, v] of fd.entries()) if (k.startsWith('provided.') && String(v).trim()) provided[k.slice(9)] = String(v).trim();
  return {
    flow: fd.get('flow') ?? 'auto',
    skip: fd.getAll('skip'),
    provided,
    reviewers: fd.get('reviewersMode') === 'list' ? fd.getAll('reviewers') : 'auto',
    review_rounds: Number(fd.get('review_rounds') ?? 1),
    manual_test: fd.get('manual_test') === 'on',
    fable_checks: fd.getAll('fable_checks'),
    notes: String(fd.get('notes') ?? ''),
  };
}

/** Wire the form: picking a flow resets the fine-tuning to its defaults; ticking a reviewer picks "only these". */
export function bindOptionsForm(form, catalog, { onFlow } = {}) {
  form.addEventListener('change', (e) => {
    if (e.target.name === 'flow') {
      const d = catalog.flows.find((f) => f.id === e.target.value)?.defaults;
      if (!d) return;
      for (const box of $$('input[name=skip]', form)) box.checked = d.skip.includes(box.value);
      for (const box of $$('input[name=fable_checks]', form)) box.checked = d.fable_checks.includes(box.value);
      for (const box of $$('input[name=reviewers]', form)) box.checked = Array.isArray(d.reviewers) && d.reviewers.includes(box.value);
      $(`input[name=reviewersMode][value=${d.reviewers === 'auto' ? 'auto' : 'list'}]`, form).checked = true;
      $('input[name=manual_test]', form).checked = d.manual_test;
      $('select[name=review_rounds]', form).value = String(d.review_rounds);
      onFlow?.(catalog.flows.find((f) => f.id === e.target.value));
    }
    if (e.target.name === 'reviewers') $('input[name=reviewersMode][value=list]', form).checked = true;
  });
}

// ---------- Start a job ----------

export async function openNewJob(meta, { onStarted } = {}) {
  let repos = [];
  try { repos = (await getJson('/api/repos')).repos; } catch { /* still allow typing a path */ }
  const lastRepo = prefs.get('lastRepo', repos[0]?.path ?? '');
  const lastModel = meta.models[0].id; // follows the flow you pick; change it here for this job
  const m = modal(`
    <form class="newjob">
      <h2>Start a new job</h2>
      <p class="lede">Describe it in a line and pick how much process it gets. Nothing in your code changes until you approve what will be built.</p>
      <label class="field"><span>What should the crew build or fix?</span>
        <textarea name="description" rows="2" required minlength="4" maxlength="600" autofocus placeholder="e.g. Add a Copy ID button next to the ticket ID on the admin ticket page"></textarea></label>
      <fieldset class="field seg"><legend>Kind</legend>
        <label><input type="radio" name="kind" value="feature" checked><span>Feature</span></label>
        <label><input type="radio" name="kind" value="bug"><span>Bug fix</span></label>
      </fieldset>
      <label class="field"><span>Repository</span>
        <select name="repo">${repos.map((r) => `<option value="${esc(r.path)}"${r.path === lastRepo ? ' selected' : ''}>${esc(r.name)} — ${esc(r.path)}</option>`).join('')}<option value="__other"${repos.length ? '' : ' selected'}>Another folder…</option></select></label>
      <label class="field other-repo" ${repos.length ? 'hidden' : ''}><span>Folder path</span><input name="repoPath" type="text" placeholder="/Users/you/Projects/your-repo"></label>
      ${optionsFields(meta.jobOptions, null)}
      <fieldset class="field models"><legend>Foreman model</legend>
        ${meta.models.map((x) => `<label class="opt"><input type="radio" name="model" value="${esc(x.id)}"${x.id === lastModel ? ' checked' : ''}><span><b>${esc(x.label)}</b><small>${esc(x.note)}</small></span></label>`).join('')}
      </fieldset>
      <p class="fineprint">Runs with your own Claude Code login. Workers use the models set in their agent files.${meta.demo ? ' <b>Demo mode:</b> a pretend Foreman answers; nothing real runs.' : ''}</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary big">Start job</button></div>
    </form>`, { label: 'Start a new job' });
  const form = $('form', m.box);
  const sel = $('select[name=repo]', form);
  sel.addEventListener('change', () => { $('.other-repo', form).hidden = sel.value !== '__other'; });
  let modelTouched = false;
  form.addEventListener('change', (e) => { if (e.target.name === 'model') modelTouched = true; });
  bindOptionsForm(form, meta.jobOptions, { onFlow: (f) => { if (!modelTouched) { const r = $(`input[name=model][value="${f.model}"]`, form); if (r) r.checked = true; } } });
  $('[data-close]', form).addEventListener('click', () => m.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const repoPath = sel.value === '__other' ? String(fd.get('repoPath') ?? '').trim() : sel.value;
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    btn.textContent = 'Starting…';
    try {
      const res = await postJson('/api/jobs', { description: fd.get('description'), kind: fd.get('kind'), repoPath, model: fd.get('model'), options: readOptionsForm(form) });
      prefs.set('lastRepo', repoPath);
      m.close();
      toast(`${icon('bolt', 18)} Job started. The Foreman is reading your request.`, { tone: 'good' });
      onStarted?.(res);
    } catch (err) {
      const box = $('.form-error', form);
      box.hidden = false;
      box.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Start job';
    }
  });
}

// ---------- Alerts: browser notifications and a soft chime ----------

export const alerts = {
  get notify() { return prefs.get('notify', 'off') === 'on'; },
  get sound() { return prefs.get('sound', 'off') === 'on'; },
};

let audio = null;
export function chime() {
  if (!alerts.sound) return;
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    // Two soft rising notes.
    [[784, 0], [1175, 0.14]].forEach(([freq, at]) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.12, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.5);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.55);
    });
  } catch { /* audio not available */ }
}

export function notify(title, body, href) {
  chime();
  if (!alerts.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: href, silent: true });
    n.onclick = () => { window.focus(); if (href) location.hash = href; n.close(); };
  } catch { /* some browsers block notifications from plain http */ }
}

export function openAlerts(anchor, meta = {}) {
  const supported = typeof Notification !== 'undefined';
  const m = modal(`
    <div class="alerts-box">
      <h2>Alerts and settings</h2>
      <p class="lede">Get a nudge when a job needs you: a question, a go-ahead, or a permission click. Alerts only work while this page is open in a tab.</p>
      <label class="toggle"><input type="checkbox" name="notify"${alerts.notify ? ' checked' : ''}${supported ? '' : ' disabled'}><span><b>Browser notifications</b><small>${supported ? 'Your browser will ask once for permission.' : 'Not supported in this browser.'}</small></span></label>
      <label class="toggle"><input type="checkbox" name="sound"${alerts.sound ? ' checked' : ''}><span><b>Sound</b><small>A short, soft chime.</small></span></label>
      <h3 class="settings-h">Routine steps</h3>
      <fieldset class="field models"><legend class="visually-hidden">How to handle routine steps</legend>
        <label class="opt"><input type="radio" name="policy" value="hands-off"${meta.settings?.policy !== 'ask-all' ? ' checked' : ''}><span><b>Handle them for me</b><small>Reading, updating the job’s own records, and (once you’ve approved a plan) building, committing and running checks in the job’s own worktree happen on their own and are listed in the conversation. Pushing, PRs, merges, migrations, database writes, installs, deleting and anything outside the job’s folders still come to you.</small></span></label>
        <label class="opt"><input type="radio" name="policy" value="ask-all"${meta.settings?.policy === 'ask-all' ? ' checked' : ''}><span><b>Ask me about every step</b><small>Every action that needs permission comes to you as an Allow / Deny card.</small></span></label>
      </fieldset>
      <h3 class="settings-h">Live link to terminal sessions</h3>
      <p class="fineprint">${meta.liveLink?.enabled ? '<b>On.</b> Claude Code sessions in your terminals report what they’re doing, so their jobs show up here live.' : '<b>Off.</b> The dashboard sees open terminals but not what they’re doing. Turning it on adds a small hook to your Claude Code settings that records session events for this dashboard only. Ask Claude Code to add it for you; the README has the details.'}</p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-test>Try it</button><button type="button" class="btn primary" data-close>Done</button></div>
    </div>`, { label: 'Alerts' });
  $('[name=notify]', m.box).addEventListener('change', async (e) => {
    if (e.target.checked) {
      const result = await Notification.requestPermission().catch(() => 'denied');
      if (result !== 'granted') { e.target.checked = false; toast('Your browser said no to notifications. You can change that in the browser’s site settings.', { tone: 'bad' }); return; }
    }
    prefs.set('notify', e.target.checked ? 'on' : 'off');
    anchor?.dispatchEvent(new Event('alerts-changed'));
  });
  $('[name=sound]', m.box).addEventListener('change', (e) => { prefs.set('sound', e.target.checked ? 'on' : 'off'); anchor?.dispatchEvent(new Event('alerts-changed')); });
  $$('[name=policy]', m.box).forEach((r) => r.addEventListener('change', async (e) => {
    try { await postJson('/api/settings', { policy: e.target.value }); toast(e.target.value === 'ask-all' ? 'You’ll be asked about every step.' : 'Routine steps now run on their own.', { tone: 'good' }); }
    catch (err) { toast(esc(err.message), { tone: 'bad' }); }
  }));
  $('[data-test]', m.box).addEventListener('click', () => notify('Feature Workshop', 'This is what an alert looks like.', '#/'));
  $('[data-close]', m.box).addEventListener('click', () => m.close());
}
