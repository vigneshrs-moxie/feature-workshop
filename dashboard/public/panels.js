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

// ---------- Start a job ----------

export async function openNewJob(meta, { onStarted } = {}) {
  let repos = [];
  try { repos = (await getJson('/api/repos')).repos; } catch { /* still allow typing a path */ }
  const lastRepo = prefs.get('lastRepo', repos[0]?.path ?? '');
  const lastModel = prefs.get('lastModel', meta.models[0].id);
  const m = modal(`
    <form class="newjob">
      <h2>Start a new job</h2>
      <p class="lede">Describe it in a line. The Foreman writes a spec first and stops for your review. Nothing in your code changes until you approve a plan.</p>
      <label class="field"><span>What should the crew build or fix?</span>
        <textarea name="description" rows="2" required minlength="4" maxlength="600" autofocus placeholder="e.g. Add a Copy ID button next to the ticket ID on the admin ticket page"></textarea></label>
      <fieldset class="field seg"><legend>Kind</legend>
        <label><input type="radio" name="kind" value="feature" checked><span>Feature</span></label>
        <label><input type="radio" name="kind" value="bug"><span>Bug fix</span></label>
      </fieldset>
      <label class="field"><span>Repository</span>
        <select name="repo">${repos.map((r) => `<option value="${esc(r.path)}"${r.path === lastRepo ? ' selected' : ''}>${esc(r.name)} — ${esc(r.path)}</option>`).join('')}<option value="__other"${repos.length ? '' : ' selected'}>Another folder…</option></select></label>
      <label class="field other-repo" ${repos.length ? 'hidden' : ''}><span>Folder path</span><input name="repoPath" type="text" placeholder="/Users/you/Projects/your-repo"></label>
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
  $('[data-close]', form).addEventListener('click', () => m.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const repoPath = sel.value === '__other' ? String(fd.get('repoPath') ?? '').trim() : sel.value;
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    btn.textContent = 'Starting…';
    try {
      const res = await postJson('/api/jobs', { description: fd.get('description'), kind: fd.get('kind'), repoPath, model: fd.get('model') });
      prefs.set('lastRepo', repoPath);
      prefs.set('lastModel', String(fd.get('model')));
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

export function openAlerts(anchor) {
  const supported = typeof Notification !== 'undefined';
  const m = modal(`
    <div class="alerts-box">
      <h2>Alerts</h2>
      <p class="lede">Get a nudge when a job needs you: a question, a go-ahead, or a permission click. Alerts only work while this page is open in a tab.</p>
      <label class="toggle"><input type="checkbox" name="notify"${alerts.notify ? ' checked' : ''}${supported ? '' : ' disabled'}><span><b>Browser notifications</b><small>${supported ? 'Your browser will ask once for permission.' : 'Not supported in this browser.'}</small></span></label>
      <label class="toggle"><input type="checkbox" name="sound"${alerts.sound ? ' checked' : ''}><span><b>Sound</b><small>A short, soft chime.</small></span></label>
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
  $('[data-test]', m.box).addEventListener('click', () => notify('Feature Workshop', 'This is what an alert looks like.', '#/'));
  $('[data-close]', m.box).addEventListener('click', () => m.close());
}
