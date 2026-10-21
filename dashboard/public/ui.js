// Small shared helpers for the page.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Per-viewer preferences. Storage can be unavailable (private windows); the page works without it.
export const prefs = {
  get(key, fallback) { try { return localStorage.getItem(`workshop.${key}`) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`workshop.${key}`, value); } catch { /* ignore */ } },
};

// The new view's themes (web/src/theme/theme.ts): the ones everyone has, and the two the play
// ledger unlocks; the dark/light pairs Follow the system switches between; the four text sizes
// (web/src/theme/textSize.ts). theme-boot.js keeps its own copy of each; a test checks all agree.
export const THEMES = ['default', 'neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop', 'glass', 'light', 'light-glass'];
export const HIDDEN_THEMES = ['crt', 'gold'];
export const THEME_PAIRS = [['default', 'light'], ['glass', 'light-glass']];
export const TEXT_SIZES = ['s', 'm', 'l', 'xl'];

/** `id` as Follow the system shows it: its pair's member for the system's colour scheme while 'workshop.themeFollow' is on. */
export function followTheme(id) {
  if (prefs.get('themeFollow', 'off') !== 'on' || typeof matchMedia !== 'function') return id;
  const pair = THEME_PAIRS.find((p) => p.includes(id));
  return pair ? pair[matchMedia('(prefers-color-scheme: light)').matches ? 1 : 0] : id;
}

/** Puts the text size picked in the new view ('workshop.textSize') on html[data-text]; medium when unset. */
export function applyTextSize() {
  const size = prefs.get('textSize', 'm');
  document.documentElement.dataset.text = TEXT_SIZES.includes(size) ? size : 'm';
}

/** The new view's address for where you are here (a location hash): the same job, the Crew-dex, or home. */
export function newViewHref(hash = '') {
  const m = /^#\/job\/([^/?]+)/.exec(hash);
  if (m) return `/next/#/job/${m[1]}`;
  return /^#\/crew\/?$/.test(hash) ? '/next/#/crew' : '/next/';
}

export function duration(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h${mins % 60 ? ` ${mins % 60} min` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}
export const since = (iso) => (iso ? duration(Date.now() - Date.parse(iso)) : '');
// "5 min ago", or "just now" (never "just now ago").
export const ago = (iso) => { const s = since(iso); return !s || s === 'just now' ? s : `${s} ago`; };
export const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export function usd(n, source) {
  if (!n) return '$0';
  const s = n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;
  return source === 'estimate' ? `≈${s}` : s;
}
export const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n ?? 0));
export const modelLabel = (m) => (m ? m.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^\w/, (c) => c.toUpperCase()) : 'unknown');
export const vscodeHref = (p) => (p ? `vscode://file${p.startsWith('/') ? '' : '/'}${encodeURI(p)}` : null);

// ---------- Talking to the server ----------

let token = null;
export const setToken = (t) => { token = t; };

export async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

export async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workshop-Token': token ?? '' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

// ---------- Toasts and modals ----------

export function toast(html, { tone = 'info', timeout = 5000 } = {}) {
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('aria-live', 'polite'); document.body.append(host); }
  const el = document.createElement('div');
  el.className = `toast gbox tone-${tone}`;
  el.innerHTML = html;
  host.append(el);
  if (timeout) setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 300); }, timeout);
  return el;
}

// A dialog that traps focus, closes on Escape, and restores focus when done.
export function modal(html, { label = 'Dialog', onClose = null } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal gbox" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
  const prevFocus = document.activeElement;
  document.body.append(back);
  document.body.classList.add('has-modal');
  const box = back.firstElementChild;
  const close = () => {
    back.classList.add('leaving');
    document.body.classList.remove('has-modal');
    setTimeout(() => back.remove(), 200);
    prevFocus?.focus?.();
    onClose?.();
  };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const items = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', box).filter((x) => !x.disabled && x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  setTimeout(() => ($('[autofocus]', box) ?? $('button, input, textarea, select', box))?.focus(), 30);
  return { box, close };
}
