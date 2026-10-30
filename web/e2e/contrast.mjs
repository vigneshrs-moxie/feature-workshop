// Every word and every mark has enough contrast (packet R), checked in a real browser.
//
// On Jobs, a Job, the Desk, a Stage, Telemetry, the Inbox and Settings → Look, in the Light
// and Default themes at 1512×945, it measures:
//   Text: each visible element with its own words (a non-empty direct text node) against what is
//     really behind it: its colour, faded by its own and its ancestors' opacity, over the ancestors'
//     background colours composited from the page down until opaque. 4.5:1, or 3:1 for large text
//     (24 px and up, or 18.66 px and up at weight 700). Skipped: text that is visually hidden
//     (clipped to a pixel, zero size, visibility hidden, opacity 0, off the side of the window),
//     disabled controls (:disabled, aria-disabled="true", which WCAG exempts), placeholders, and
//     anything inside svg or canvas.
//   Marks: 3:1 for status dots and stop marks (any small [class*="-dot"], .job-light,
//     .stack-light), chip and lane icons, the More chevron, checkbox and radio boxes (.choice: the
//     border, or the fill when checked), the primary button's fill and the focus ring token, each
//     against the page behind it. The edges of text inputs, text areas and select triggers are
//     borders, which the brief keeps quiet (about L 0.32–0.36 in dark): they are listed under
//     "Field edges" for reading, and don't fail the run; a field is found by its label, its
//     placeholder and, once in it, the 3:1 focus ring.
//   Colours are read from getComputedStyle and converted by hand (rgb, color(srgb|srgb-linear|
//   display-p3), oklab, oklch; anything else is painted onto a 1×1 canvas and read back), and
//   composited in sRGB the way the browser blends. Background images (gradients, patterns) are
//   not composited; a row marked "img" sits on one, so read it by eye.
//
// Run it against a running app (the demo is best):
//   PORT=4493 WORKSHOP_DEMO=1 node dashboard/demo/run-demo.js      # in one terminal
//   node web/e2e/contrast.mjs                                       # in another
// Environment: BASE (default http://127.0.0.1:4493/next/), THEMES (comma list, default
// light,default; THEMES=all runs every theme in theme.ts, the hidden two included: the page is told
// they are unlocked, as web/e2e/themeSweep.mjs does), SCREENS (comma list of screen names to limit the run, e.g. Jobs,Desk),
// OUT (a path to also write every failure as JSON), PLAYWRIGHT (the path to playwright's
// index.mjs, when it isn't installed here).
// It prints a table of failures and a summary line per screen and theme, and exits 1 if any fail.
import { readFileSync, writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:4493/next/';
const ALL_THEMES = [...readFileSync(new URL('../src/theme/theme.ts', import.meta.url), 'utf8').matchAll(/\{ id: '([a-z-]+)', label:/g)].map((m) => m[1]);
const THEMES = (process.env.THEMES || 'light,default').trim() === 'all'
  ? ALL_THEMES
  : (process.env.THEMES || 'light,default').split(',').map((t) => t.trim()).filter(Boolean);
const ALL_SCREENS = [
  ['Jobs', '#/'],
  ['Job', '#/job/customer-merge'],
  ['Desk', '#/desk'],
  ['Stage', '#/job/customer-merge/stage/build'],
  ['Telemetry', '#/telemetry'],
  ['Inbox', '#/inbox'],
  ['Settings', '#/settings/look'],
  // Stacks is packet V's to redo (its step dots are V's); add it with SCREENS=Stacks.
];
const EXTRA_SCREENS = [['Stacks', '#/stacks']];
const only = process.env.SCREENS ? process.env.SCREENS.split(',').map((s) => s.trim().toLowerCase()) : null;
const SCREENS = only ? [...ALL_SCREENS, ...EXTRA_SCREENS].filter(([n]) => only.includes(n.toLowerCase())) : ALL_SCREENS;
const GUIDES = ['jobs', 'desk', 'stage', 'job', 'inbox', 'telemetry', 'stack', 'stacks', 'review', 'review-round'];

// What counts as a mark, and how its colour is read (see measure() below).
const MARKS = {
  dot: '.dot, .status-dot, [class*="-dot"], .job-light, .stack-light',
  icon: '.chip svg, .lane-icon, .more-chevron',
  choice: '.choice',
  primary: '.btn-primary',
  field: '.text-input, .text-area, .select, .field input, .field textarea, .select-trigger',
};

// Runs in the page: returns every failure (and the counts) for the current screen.
function measure(MARKS) {
  // ---- Colour parsing: to sRGB 0..1 with alpha ----
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const enc = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  const dec = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  const num = (t, scale = 1) => {
    if (t === undefined || t === 'none') return 0;
    if (t.endsWith('%')) return (parseFloat(t) / 100) * scale;
    return parseFloat(t);
  };
  const fromLinear = (r, g, b, a) => ({ r: clamp(enc(r)), g: clamp(enc(g)), b: clamp(enc(b)), a });
  const oklabToSrgb = (L, A, B, alpha) => {
    const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
    const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
    const s_ = L - 0.0894841775 * A - 1.291485548 * B;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    return fromLinear(
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      alpha,
    );
  };
  let cv;
  const viaCanvas = (str) => {
    cv ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
    cv.clearRect(0, 0, 1, 1);
    cv.fillStyle = '#000';
    cv.fillStyle = str;
    cv.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cv.getImageData(0, 0, 1, 1).data;
    return a ? { r: r / a, g: g / a, b: b / a, a: a / 255 } : { r: 0, g: 0, b: 0, a: 0 };
  };
  const cache = new Map();
  const parse = (str) => {
    str = (str || '').trim();
    if (cache.has(str)) return cache.get(str);
    let out;
    const m = str.match(/^([a-z-]+)\((.*)\)$/i);
    if (!str || str === 'transparent' || str === 'none') out = { r: 0, g: 0, b: 0, a: 0 };
    else if (!m) out = viaCanvas(str);
    else {
      const fn = m[1].toLowerCase();
      const [main, alphaT] = m[2].replace(/,/g, ' ').split('/');
      let parts = main.trim().split(/\s+/);
      let alpha = alphaT !== undefined ? clamp(num(alphaT.trim(), 1)) : 1;
      if ((fn === 'rgb' || fn === 'rgba') && parts.length === 4) { alpha = clamp(num(parts[3], 1)); parts = parts.slice(0, 3); }
      if (fn === 'rgb' || fn === 'rgba') out = { r: clamp(num(parts[0], 255) / 255), g: clamp(num(parts[1], 255) / 255), b: clamp(num(parts[2], 255) / 255), a: alpha };
      else if (fn === 'oklab') out = oklabToSrgb(num(parts[0], 1), num(parts[1], 0.4), num(parts[2], 0.4), alpha);
      else if (fn === 'oklch') {
        const L = num(parts[0], 1), C = num(parts[1], 0.4), H = (num(parts[2]) * Math.PI) / 180;
        out = oklabToSrgb(L, C * Math.cos(H), C * Math.sin(H), alpha);
      } else if (fn === 'color') {
        const space = parts[0];
        const [x, y, z] = parts.slice(1).map((p) => num(p, 1));
        if (space === 'srgb') out = { r: clamp(x), g: clamp(y), b: clamp(z), a: alpha };
        else if (space === 'srgb-linear') out = fromLinear(x, y, z, alpha);
        else if (space === 'display-p3') {
          const [R, G, B] = [dec(x), dec(y), dec(z)];
          out = fromLinear(
            1.2249401 * R - 0.2249404 * G + 0 * B,
            -0.0420569 * R + 1.0420571 * G + 0 * B,
            -0.0196376 * R - 0.0786361 * G + 1.0982735 * B,
            alpha,
          );
        } else out = viaCanvas(str);
      } else out = viaCanvas(str);
    }
    cache.set(str, out);
    return out;
  };
  // ---- Compositing and contrast ----
  const WHITE = { r: 1, g: 1, b: 1, a: 1 };
  const over = (c, B) => ({ r: c.r * c.a + B.r * (1 - c.a), g: c.g * c.a + B.g * (1 - c.a), b: c.b * c.a + B.b * (1 - c.a), a: 1 });
  const mix = (A, B, t) => ({ r: A.r * t + B.r * (1 - t), g: A.g * t + B.g * (1 - t), b: A.b * t + B.b * (1 - t), a: 1 });
  const lum = (c) => 0.2126 * dec(c.r) + 0.7152 * dec(c.g) + 0.0722 * dec(c.b);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  // The chain from <html> down to el: each layer's background colour and opacity.
  const chainOf = (el) => {
    const out = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      out.unshift({ bg: parse(cs.backgroundColor), op: parseFloat(cs.opacity), img: cs.backgroundImage !== 'none' && n !== el });
    }
    return out;
  };
  // Paint the chain over white; `top` is painted inside the last layer (after its background).
  const render = (chain, top) => {
    const rec = (i, B) => {
      if (i === chain.length) return top ? over(top, B) : B;
      const L = chain[i];
      const inner = rec(i + 1, over(L.bg, B));
      return L.op >= 1 ? inner : mix(inner, B, L.op);
    };
    return rec(0, WHITE);
  };
  const pathOf = (el) => {
    const bits = [];
    for (let n = el, k = 0; n && n !== document.body && k < 3; n = n.parentElement, k++) {
      const cls = typeof n.className === 'string' ? n.className : n.className?.baseVal ?? '';
      bits.unshift(n.tagName.toLowerCase() + cls.split(/\s+/).filter(Boolean).slice(0, 2).map((c) => '.' + c).join(''));
    }
    return bits.join(' > ');
  };
  const disabled = (el) => !!el.closest(':disabled, [aria-disabled="true"]');
  const inGraphic = (el) => !!el.closest('svg, canvas') && !el.matches('svg');
  const shown = (el) => el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }) ?? true;
  const fails = [];
  let texts = 0, marks = 0;
  const push = (kind, el, sample, fg, bg, need, chain) => {
    const r = ratio(fg, bg);
    if (r + 1e-6 < need) fails.push({ kind, path: pathOf(el), sample, ratio: Math.round(r * 100) / 100, need, fg: hex(fg), bg: hex(bg), img: chain.some((l) => l.img) });
  };

  // ---- Text ----
  const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'OPTION']);
  for (const el of document.body.querySelectorAll('*')) {
    if (skipTags.has(el.tagName) || inGraphic(el) || el.closest('svg')) continue;
    const nodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!nodes.length || !shown(el) || disabled(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(nodes[0]);
    const rect = range.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2 || rect.right < 0 || rect.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\(50%/.test(cs.clipPath)) continue;
    const size = parseFloat(cs.fontSize), weight = parseFloat(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const chain = chainOf(el);
    texts += 1;
    push('text', el, nodes.map((n) => n.textContent.trim()).join(' ').replace(/\s+/g, ' ').slice(0, 40), render(chain, parse(cs.color)), render(chain, null), large ? 3 : 4.5, chain);
  }

  // ---- Marks ----
  const seen = new Set();
  const markIn = (kind, el, colour, own) => {
    // own: the mark is the element's own fill or border, so it is painted inside its own layer and
    // compared with what is behind the element (its parent chain, with the element's opacity).
    const chain = chainOf(el);
    const inner = chain.slice(0, -1);
    const me = chain[chain.length - 1];
    const behind = render(inner, null);
    const shownColour = own
      ? render([...inner, { bg: colour, op: me.op, img: false }], null)
      : render(chain, colour);
    const against = own ? behind : render(chain, null);
    marks += 1;
    push(kind, el, '', shownColour, against, 3, chain);
  };
  const visibleBox = (el) => {
    if (!shown(el) || disabled(el)) return null;
    const b = el.getBoundingClientRect();
    return b.width >= 1 && b.height >= 1 && b.right > 0 && b.left < innerWidth ? b : null;
  };
  // A dot is told apart by its fill, its ring or the icon inside it: it passes when any one of them
  // reaches 3:1 (fill and ring against what is behind the dot, the icon against the dot's own fill).
  // Only small things count (wrappers such as .step-dots are wider than 40 px).
  for (const el of document.querySelectorAll(MARKS.dot)) {
    const b = visibleBox(el);
    if (!b || b.width > 40 || b.height > 40 || el.closest('svg') && !el.matches('svg')) continue;
    if (seen.has(el)) continue; seen.add(el);
    const cs = getComputedStyle(el);
    const chain = chainOf(el);
    const inner = chain.slice(0, -1);
    const op = chain[chain.length - 1].op;
    const behind = render(inner, null);
    const tries = [];
    const paintOwn = (c) => render([...inner, { bg: c, op, img: false }], null);
    if (el instanceof SVGElement) {
      const paint = cs.fill !== 'none' && !cs.fill.startsWith('url') ? cs.fill : cs.stroke !== 'none' ? cs.stroke : cs.color;
      tries.push(['fill', render(chain, parse(paint)), render(chain, null)]);
    } else {
      const bg = parse(cs.backgroundColor);
      if (bg.a > 0.01) tries.push(['fill', paintOwn(bg), behind]);
      if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') tries.push(['ring', paintOwn(parse(cs.borderTopColor)), behind]);
      const icon = el.querySelector('svg') || ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) ? el : null);
      if (icon) {
        const ics = getComputedStyle(icon);
        const paint = icon instanceof SVGElement && ics.stroke !== 'none' && !ics.stroke.startsWith('url') ? ics.stroke : ics.color;
        tries.push(['icon', render(chain, parse(paint)), render(chain, null)]);
      }
    }
    if (!tries.length) continue;
    const best = tries.map(([k, fg, bg]) => ({ k, fg, bg, r: ratio(fg, bg) })).sort((p, q) => q.r - p.r)[0];
    marks += 1;
    if (best.r + 1e-6 < 3) fails.push({ kind: `mark:dot (${tries.map((t) => t[0]).join('/')})`, path: pathOf(el), sample: '', ratio: Math.round(best.r * 100) / 100, need: 3, fg: hex(best.fg), bg: hex(best.bg), img: chain.some((l) => l.img) });
  }
  for (const el of document.querySelectorAll(MARKS.icon)) {
    if (!visibleBox(el) || seen.has(el)) continue; seen.add(el);
    const cs = getComputedStyle(el);
    const svg = el.matches('svg') ? el : el.querySelector('svg');
    let paint = cs.color;
    if (svg) {
      const s = getComputedStyle(svg);
      paint = s.stroke !== 'none' && !s.stroke.startsWith('url') ? s.stroke : s.fill !== 'none' && !s.fill.startsWith('url') ? s.fill : s.color;
    }
    markIn('mark:icon', el, parse(paint), false);
  }
  for (const el of document.querySelectorAll(MARKS.choice)) {
    if (!visibleBox(el) || seen.has(el)) continue; seen.add(el);
    const cs = getComputedStyle(el);
    if (el.checked) markIn('mark:choice-on', el, parse(cs.backgroundColor), true);
    else markIn('mark:choice-edge', el, parse(cs.borderTopColor), true);
  }
  for (const el of document.querySelectorAll(MARKS.primary)) {
    if (!visibleBox(el) || seen.has(el)) continue; seen.add(el);
    markIn('mark:primary-fill', el, parse(getComputedStyle(el).backgroundColor), true);
  }
  for (const el of document.querySelectorAll(MARKS.field)) {
    if (!visibleBox(el) || seen.has(el)) continue; seen.add(el);
    const cs = getComputedStyle(el);
    if (!(parseFloat(cs.borderTopWidth) > 0) || cs.borderTopStyle === 'none') continue;
    markIn('mark:field-edge', el, parse(cs.borderTopColor), true);
  }
  // The focus ring token, against the page and a card.
  const root = getComputedStyle(document.documentElement);
  const ring = parse(root.getPropertyValue('--focus-ring'));
  if (ring.a > 0) {
    const page = render(chainOf(document.body), null);
    for (const [where, bgTok] of [['page', null], ['card', '--surface-1'], ['raised', '--bg-3']]) {
      const behind = bgTok ? over(parse(root.getPropertyValue(bgTok)), page) : page;
      const r = ratio(over(ring, behind), behind);
      marks += 1;
      if (r < 3) fails.push({ kind: 'mark:focus-ring', path: `--focus-ring on ${bgTok ?? 'page'}`, sample: '', ratio: Math.round(r * 100) / 100, need: 3, fg: hex(over(ring, behind)), bg: hex(behind), img: false });
    }
  }
  return { fails, texts, marks, theme: document.documentElement.getAttribute('data-theme') };
}

const browser = await chromium.launch();
const all = [];
const edges = [];
const summary = [];
for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 945 } });
  await ctx.addInitScript(([t, g]) => {
    try {
      localStorage.setItem('workshop.theme', t);
      localStorage.setItem('workshop.themeFollow', 'off');
      localStorage.setItem('gc.guide.seen', JSON.stringify(g));
    } catch { /* storage off */ }
  }, [theme, GUIDES]);
  // CRT Terminal and Gold need their unlocks: only this page is told they are there.
  await ctx.route(/\/api\/play(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const json = await res.json();
    json.unlocks = { ...(json.unlocks ?? {}), crt: true, gold: true };
    return route.fulfill({ response: res, json });
  });
  const page = await ctx.newPage();
  for (const [name, hash] of SCREENS) {
    await page.goto(BASE + hash, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const res = await page.evaluate(measure, MARKS);
    // One row per distinct problem: the same path, colours and ratio on many rows count once.
    const groups = new Map();
    const fails = res.fails.filter((f) => f.kind !== 'mark:field-edge');
    for (const f of res.fails) if (f.kind === 'mark:field-edge' && !edges.some((e) => e.theme === theme && e.fg === f.fg && e.bg === f.bg)) edges.push({ theme, fg: f.fg, bg: f.bg, ratio: f.ratio });
    for (const f of fails) {
      const key = `${f.kind}|${f.path}|${f.fg}|${f.bg}`;
      const g = groups.get(key);
      if (g) g.count += 1; else groups.set(key, { screen: name, theme, ...f, count: 1 });
    }
    all.push(...groups.values());
    const warn = res.theme && res.theme !== theme ? ` (page says data-theme="${res.theme}")` : '';
    summary.push(`${name.padEnd(10)} ${theme.padEnd(12)} ${fails.length ? `${fails.length} failing (${groups.size} distinct)` : 'pass'}: ${res.texts} texts, ${res.marks} marks${warn}`);
  }
  await ctx.close();
}
await browser.close();

const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s).padEnd(n);
if (all.length) {
  console.log(`${cut('screen', 10)} ${cut('theme', 8)} ${cut('kind', 22)} ${cut('selector path', 62)} ${cut('text', 26)} ${'ratio'.padStart(5)} need  fg      bg      n`);
  for (const f of all) {
    console.log(`${cut(f.screen, 10)} ${cut(f.theme, 8)} ${cut(f.kind, 22)} ${cut(f.path, 62)} ${cut(f.sample, 26)} ${String(f.ratio).padStart(5)} ${String(f.need).padEnd(4)}  ${f.fg} ${f.bg} ${f.count}${f.img ? ' img' : ''}`);
  }
  console.log('');
}
console.log(summary.join('\n'));
if (edges.length) console.log(`Field edges (borders, not failing): ${edges.map((e) => `${e.theme} ${e.fg} on ${e.bg} ${e.ratio}:1`).join('; ')}`);
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(all, null, 2));
console.log(all.length ? `Contrast: ${all.length} distinct failures.` : 'Contrast: everything passes.');
process.exit(all.length ? 1 : 0);
