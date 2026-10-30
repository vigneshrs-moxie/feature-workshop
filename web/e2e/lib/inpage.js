// The theme sweep's helpers inside the page (web/e2e/themeSweep.mjs). Loaded before the app with
// Playwright's addInitScript, which the page's CSP does not apply to, so it defines everything on
// window.__sweep instead of importing. No app code reads it.
//
//   parse(css)            a CSS colour (rgb, oklch, oklab, color(), anything via a 1×1 canvas) as
//                         sRGB 0..1 with alpha
//   bare(on, root)        while on: every word under root (default <html>) is drawn transparent, small
//                         icons are hidden, and gradient text loses its paint, so a screenshot shows
//                         only what is behind the words. Motion is always off while the sweep runs.
//   collect(opts)         what the sweep measures on the screen as it stands: words, marks, controls,
//                         overlays, drawn pieces (svg), and the layout facts (scroll, clipping)
(() => {
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
          out = fromLinear(1.2249401 * R - 0.2249404 * G, -0.0420569 * R + 1.0420571 * G, -0.0196376 * R - 0.0786361 * G + 1.0982735 * B, alpha);
        } else out = viaCanvas(str);
      } else out = viaCanvas(str);
    }
    cache.set(str, out);
    return out;
  };

  // ---- Compositing over the parent chain (for words that are off screen, read from styles) ----
  const WHITE = { r: 1, g: 1, b: 1, a: 1 };
  const over = (c, B) => ({ r: c.r * c.a + B.r * (1 - c.a), g: c.g * c.a + B.g * (1 - c.a), b: c.b * c.a + B.b * (1 - c.a), a: 1 });
  const mix = (A, B, t) => ({ r: A.r * t + B.r * (1 - t), g: A.g * t + B.g * (1 - t), b: A.b * t + B.b * (1 - t), a: 1 });
  const lum = (c) => 0.2126 * dec(c.r) + 0.7152 * dec(c.g) + 0.0722 * dec(c.b);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const chainOf = (el) => {
    const out = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      out.unshift({ bg: parse(cs.backgroundColor), op: parseFloat(cs.opacity), img: cs.backgroundImage !== 'none' && n !== el });
    }
    return out;
  };
  const render = (chain, top) => {
    const rec = (i, B) => {
      if (i === chain.length) return top ? over(top, B) : B;
      const L = chain[i];
      const inner = rec(i + 1, over(L.bg, B));
      return L.op >= 1 ? inner : mix(inner, B, L.op);
    };
    return rec(0, WHITE);
  };

  // ---- Motion off, and the bare view ----
  let sheet = null;
  const STILL = `*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }`;
  const BARE = `
    [data-sweep-bare], [data-sweep-bare] *, [data-sweep-bare] *::before, [data-sweep-bare] *::after, [data-sweep-bare] *::marker {
      color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important;
      text-decoration-color: transparent !important; caret-color: transparent !important; }
    [data-sweep-bare] ::placeholder { color: transparent !important; }
    [data-sweep-bare] [data-sweep-gtext] { background-image: none !important; }
    [data-sweep-bare] [data-sweep-icon] { visibility: hidden !important; }`;
  const ensureSheet = () => {
    if (sheet) return sheet;
    sheet = new CSSStyleSheet();
    sheet.replaceSync(STILL);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return sheet;
  };
  const still = () => { ensureSheet(); };
  const bare = (on, rootSel) => {
    ensureSheet();
    for (const el of document.querySelectorAll('[data-sweep-bare]')) el.removeAttribute('data-sweep-bare');
    if (!on) { sheet.replaceSync(STILL); return; }
    sheet.replaceSync(STILL + BARE);
    const roots = rootSel ? [...document.querySelectorAll(rootSel)] : [document.documentElement];
    for (const r of roots) {
      r.setAttribute('data-sweep-bare', '');
      for (const el of r.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') el.setAttribute('data-sweep-gtext', '');
      }
      // Small icons go too, so the chip or button under them shows (their own colour is a mark).
      for (const svg of r.querySelectorAll('svg')) {
        const b = svg.getBoundingClientRect();
        if (b.width <= 48 && b.height <= 48) svg.setAttribute('data-sweep-icon', '');
      }
    }
  };

  // ---- What is on screen ----
  const pathOf = (el) => {
    const bits = [];
    for (let n = el, k = 0; n && n !== document.body && k < 3; n = n.parentElement, k++) {
      const cls = typeof n.className === 'string' ? n.className : n.className?.baseVal ?? '';
      bits.unshift(n.tagName.toLowerCase() + cls.split(/\s+/).filter((c) => c && !c.startsWith('data-')).slice(0, 2).map((c) => '.' + c).join(''));
    }
    return bits.join(' > ');
  };
  const disabled = (el) => !!el.closest(':disabled, [aria-disabled="true"], [inert]');
  const shown = (el) => el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }) ?? true;
  const opacityOf = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  const rectOf = (b) => ({ x: b.left, y: b.top, w: b.width, h: b.height });
  const hidden = (el) => {
    const cs = getComputedStyle(el);
    return cs.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\(50%/.test(cs.clipPath);
  };
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());

  // The box an element's ancestors let it show in (overflow other than visible), in window pixels.
  const clipOf = (el) => {
    let box = { x: -1e6, y: -1e6, w: 2e6, h: 2e6 };
    // The element itself too: words cut off with an ellipsis stop at its own edge.
    for (let p = el; p && p !== document.documentElement && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = p.getBoundingClientRect();
      box = cut(box, rectOf(b)) ?? { x: 0, y: 0, w: 0, h: 0 };
      if (cs.position === 'fixed') break;
    }
    return box;
  };
  const cut = (a, b) => {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
    return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null;
  };

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'OPTION', 'HEAD']);
  function collect(opts = {}) {
    const W = innerWidth, H = innerHeight;
    const scope = opts.scope ? [...document.querySelectorAll(opts.scope)] : [document.body];
    const offset = scrolled();
    const inScope = (el) => scope.some((s) => s.contains(el));
    const texts = [];
    let n = 0;
    for (const root of scope) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (SKIP.has(el.tagName) || el.closest('svg, canvas')) continue;
        const nodes = ownText(el);
        if (!nodes.length || !shown(el) || hidden(el)) continue;
        // A closed <details> draws only its summary: its own loose words are not on screen.
        if (el.closest('details:not([open])') && !el.closest('summary')) continue;
        if (disabled(el)) continue;
        const rects = [];
        for (const node of nodes) {
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) if (r.width >= 2 && r.height >= 2) rects.push(rectOf(r));
        }
        // Only what its scrolling and clipping boxes let show.
        const clip = clipOf(el);
        const vis = rects.map((r) => cut(r, clip)).filter((r) => r && r.w >= 2 && r.h >= 2);
        if (!vis.length) continue;
        // Half under a scroller's edge (or a sticky bar): measured where it is whole, or from styles.
        const partial = vis.reduce((a, r) => a + r.h, 0) < rects.reduce((a, r) => a + r.h, 0) * 0.9;
        const origTop = Math.min(...rects.map((r) => r.y));
        rects.length = 0; rects.push(...vis);
        const left = Math.min(...rects.map((r) => r.x)), right = Math.max(...rects.map((r) => r.x + r.w));
        const top = Math.min(...rects.map((r) => r.y)), bottom = Math.max(...rects.map((r) => r.y + r.h));
        if (right < 0 || left > W) continue;
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize), weight = parseFloat(cs.fontWeight) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        // Words painted by a gradient clipped to the text (on the element or a parent): no single colour to measure.
        let gradient = false;
        for (let x = el, k = 0; x && k < 4; x = x.parentElement, k++) { const xs = getComputedStyle(x); if (xs.backgroundClip === 'text' || xs.webkitBackgroundClip === 'text') { gradient = true; break; } }
        const c = parse(cs.color);
        const op = opacityOf(el);
        const chain = chainOf(el);
        const fgC = render(chain, c), bgC = render(chain, null);
        const r0 = rects[0];
        const hit = document.elementFromPoint(r0.x + r0.w / 2, r0.y + r0.h / 2);
        const occluded = !!hit && !(el.contains(hit) || hit.contains(el));
        texts.push({ occluded,
          i: n++, path: pathOf(el), sample: nodes.map((x) => x.textContent.trim()).join(' ').replace(/\s+/g, ' ').slice(0, 48),
          fg: { r: c.r, g: c.g, b: c.b, a: c.a * op }, need: large ? 3 : 4.5, rects,
          inView: !partial && top >= 0 && bottom <= H && left >= 0 && right <= W, docY: origTop + offset,
          gradient, styleRatio: Math.round(ratio(fgC, bgC) * 100) / 100, styleImg: chain.some((l) => l.img),
          size,
        });
      }
    }

    // Marks: status dots, chip and lane icons, checkbox and radio boxes, the primary fill. Each is a
    // paint with where to compare it: 'ring' (just outside the element) or 'under' (inside it, which
    // the bare view leaves without its icon).
    const marks = [];
    const visibleBox = (el) => {
      if (!shown(el) || disabled(el)) return null;
      const b = el.getBoundingClientRect();
      return b.width >= 1 && b.height >= 1 && b.right > 0 && b.left < W && b.top >= 0 && b.bottom <= H ? b : null;
    };
    const seen = new Set();
    const DOT = '.dot, .status-dot, [class*="-dot"], .job-light, .stack-light';
    for (const root of scope) for (const el of root.querySelectorAll(DOT)) {
      const b = visibleBox(el);
      if (!b || b.width > 40 || b.height > 40 || (el.closest('svg') && !el.matches('svg')) || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      const op = opacityOf(el);
      const tries = [];
      if (el instanceof SVGElement) {
        const paint = cs.fill !== 'none' && !cs.fill.startsWith('url') ? cs.fill : cs.stroke !== 'none' ? cs.stroke : cs.color;
        tries.push({ k: 'fill', paint: parse(paint), where: 'ring' });
      } else {
        const bg = parse(cs.backgroundColor);
        if (bg.a > 0.01) tries.push({ k: 'fill', paint: bg, where: 'ring' });
        if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') tries.push({ k: 'ring', paint: parse(cs.borderTopColor), where: 'ring' });
        const icon = el.querySelector('svg') || (ownText(el).length ? el : null);
        if (icon) {
          const ics = getComputedStyle(icon);
          const paint = icon instanceof SVGElement && ics.stroke !== 'none' && !ics.stroke.startsWith('url') ? ics.stroke : ics.color;
          tries.push({ k: 'icon', paint: parse(paint), where: 'under' });
        }
      }
      if (!tries.length) continue;
      for (const t of tries) t.paint = { ...t.paint, a: t.paint.a * op };
      marks.push({ kind: 'dot', path: pathOf(el), box: rectOf(b), tries });
    }
    for (const root of scope) for (const el of root.querySelectorAll('.chip svg, .lane-icon, .more-chevron')) {
      const b = visibleBox(el);
      if (!b || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      const svg = el.matches('svg') ? el : el.querySelector('svg');
      let paint = cs.color;
      if (svg) {
        const s = getComputedStyle(svg);
        paint = s.stroke !== 'none' && !s.stroke.startsWith('url') ? s.stroke : s.fill !== 'none' && !s.fill.startsWith('url') ? s.fill : s.color;
      }
      const p = parse(paint);
      marks.push({ kind: 'icon', path: pathOf(el), box: rectOf(b), tries: [{ k: 'icon', paint: { ...p, a: p.a * opacityOf(el) }, where: 'under' }] });
    }
    for (const root of scope) for (const el of root.querySelectorAll('.choice')) {
      const b = visibleBox(el);
      if (!b || seen.has(el) || hidden(el) || opacityOf(el) < 0.1) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      const p = el.checked ? parse(cs.backgroundColor) : parse(cs.borderTopColor);
      marks.push({ kind: el.checked ? 'choice-on' : 'choice-edge', path: pathOf(el), box: rectOf(b), tries: [{ k: el.checked ? 'fill' : 'edge', paint: { ...p, a: p.a * opacityOf(el) }, where: 'ring' }] });
    }

    // Controls that must be told from the page: their edge or their fill, against what is around them.
    const controls = [];
    const CONTROL = '.btn:not(.btn-quiet), .text-input, .text-area, .select, .choice, .segmented, .chip-btn, .seg-tabs, .btn-group, [role="switch"]';
    for (const root of scope) for (const el of root.querySelectorAll(CONTROL)) {
      const b = visibleBox(el);
      if (!b || b.width < 8 || b.height < 8 || hidden(el) || opacityOf(el) < 0.1) continue;
      // Under something else (a sticky bar, a sheet): not on screen to be told apart.
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (hit && !(el.contains(hit) || hit.contains(el))) continue;
      // A button inside a group is told apart by the group's edge (the group is checked itself).
      if (el.matches('.btn') && el.parentElement?.closest('.btn-group, .segmented, .seg-tabs')) continue;
      // A Select set inside a chip: the chip is its edge.
      if (el.matches('.select') && el.closest('.chip')) continue;
      const field = el.matches('.text-input, .text-area, .select');
      controls.push({ path: pathOf(el), box: rectOf(b), field, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) });
    }

    // Everything that floats over the page.
    const overlays = [];
    const OVER = '.sheet, .palette, .peek, .menu, [role="menu"], .select-menu, [role="tooltip"], .toast, .play-toast, .drawer, .level-pop-list, .job-menu-list, .usage-panel, .how-body, [role="dialog"], [role="alertdialog"], [role="listbox"]';
    for (const el of document.querySelectorAll(OVER)) {
      if (!shown(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 8 || b.height < 8) continue;
      const pos = getComputedStyle(el).position;
      if (el.matches('[role="listbox"]') && !el.matches('.select-menu') && pos !== 'absolute' && pos !== 'fixed') continue;
      if (el.matches('[role="dialog"]') && !['fixed', 'absolute', 'sticky'].includes(pos) && !el.closest('.sheet-backdrop')) continue;
      const cs = getComputedStyle(el);
      const bg = parse(cs.backgroundColor);
      const blur = /blur\(\s*([\d.]+)px/.exec(cs.backdropFilter || cs.webkitBackdropFilter || '');
      overlays.push({ path: pathOf(el), box: rectOf(b), alpha: bg.a * opacityOf(el), blur: blur ? parseFloat(blur[1]) : 0, image: cs.backgroundImage !== 'none' });
    }

    // Drawn pieces: shapes in graphs and maps (svg wider or taller than an icon), and their words.
    const shapes = [];
    const QUIET = /grid|axis|tick|track|guide|halo|shadow|glow|backdrop|\bbg\b|band|hit|focus|rail|base|empty|ghost|sky|ground|field|star|tree|trunk|cloud|road/i;
    for (const root of scope) for (const svg of root.querySelectorAll('svg')) {
      if (svg.parentElement?.closest('svg')) continue;
      const sb = svg.getBoundingClientRect();
      if (sb.width <= 48 && sb.height <= 48) continue;
      if (!shown(svg) || sb.bottom < 0 || sb.top > H || sb.right < 0 || sb.left > W) continue;
      if (svg.closest('.crew, [class*="crew"], .dex-portrait, .ach-medal, .brand-mascot, .floor-foreman-face')) continue;
      const svgOp = opacityOf(svg);
      for (const el of svg.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse, text')) {
        if (!shown(el)) continue;
        let quiet = false;
        for (let x = el; x && x !== svg.parentElement; x = x.parentElement) {
          const cls = typeof x.className === 'string' ? x.className : x.className?.baseVal ?? '';
          if (QUIET.test(cls)) { quiet = true; break; }
        }
        if (quiet) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 1 && b.height < 1) continue;
        const cs = getComputedStyle(el);
        let op = svgOp;
        for (let x = el; x && x !== svg; x = x.parentElement) op *= parseFloat(getComputedStyle(x).opacity);
        const isText = el.tagName === 'text';
        const sw = parseFloat(cs.strokeWidth) || 0;
        let paint = null, k = '';
        if (!isText && cs.stroke !== 'none' && !cs.stroke.startsWith('url') && sw >= 1) { paint = parse(cs.stroke); paint = { ...paint, a: paint.a * (parseFloat(cs.strokeOpacity) || 1) }; k = 'stroke'; }
        if ((!paint || paint.a < 0.05) && cs.fill !== 'none' && !cs.fill.startsWith('url')) { paint = parse(cs.fill); paint = { ...paint, a: paint.a * (parseFloat(cs.fillOpacity) || 1) }; k = 'fill'; }
        if (!paint) continue;
        paint = { ...paint, a: paint.a * op };
        if (paint.a < 0.35) continue;
        const size = parseFloat(cs.fontSize);
        shapes.push({ path: pathOf(el), box: rectOf(b), svgBox: rectOf(sb), paint, k, text: isText ? (el.textContent || '').trim().slice(0, 30) : null, need: isText ? (size >= 24 ? 3 : 4.5) : 3 });
      }
    }

    // Layout: sideways scroll, words cut off, things sticking out of the window.
    const se = document.scrollingElement || document.documentElement;
    const hscroll = se.scrollWidth > se.clientWidth + 1 ? se.scrollWidth - se.clientWidth : 0;
    const cutOff = [];
    const out = [];
    const clipsX = (el) => { for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== 'visible') return true; } return false; };
    for (const root of scope) for (const el of [root, ...root.querySelectorAll('*')]) {
      if (SKIP.has(el.tagName) || el.closest('svg') || !shown(el)) continue;
      const cs = getComputedStyle(el);
      if (ownText(el).length && !hidden(el) && cs.position !== 'fixed') {
        const ox = cs.overflowX, oy = cs.overflowY;
        const clampOn = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
        if ((ox === 'hidden' || ox === 'clip') && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && el.clientWidth > 0) cutOff.push({ path: pathOf(el), sample: el.textContent.trim().slice(0, 40), by: el.scrollWidth - el.clientWidth, dir: 'x' });
        else if ((oy === 'hidden' || oy === 'clip') && el.scrollHeight > el.clientHeight + 2 && !clampOn && el.clientHeight > 0 && cs.textOverflow !== 'ellipsis') cutOff.push({ path: pathOf(el), sample: el.textContent.trim().slice(0, 40), by: el.scrollHeight - el.clientHeight, dir: 'y' });
      }
      const b = el.getBoundingClientRect();
      if (b.width > 1 && b.height > 1 && (b.right > W + 1 || b.left < -1) && cs.position !== 'fixed' && !hidden(el) && !clipsX(el)) {
        if (!out.some((o) => el.parentElement && o.el === el.parentElement)) out.push({ el, path: pathOf(el), right: Math.round(b.right), left: Math.round(b.left) });
      }
    }
    return {
      theme: document.documentElement.getAttribute('data-theme'), W, H, scrollY: offset, docH: se.scrollHeight,
      texts, marks, controls, overlays, shapes, hscroll, cut: cutOff.slice(0, 20), out: out.slice(0, 10).map(({ el, ...o }) => o),
      inScope: scope.length,
    };
  }

  // The page's own scroller: on a phone the page scrolls inside .page, not the window. The biggest
  // scrolling box that covers much of the window, else the window.
  function mainScroller() {
    const big = [...document.querySelectorAll('body *')].filter((e) => {
      const cs = getComputedStyle(e);
      return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 4 && e.clientWidth * e.clientHeight > innerWidth * innerHeight * 0.4;
    }).sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
    return big[0] ?? document.scrollingElement ?? document.documentElement;
  }
  /** Scroll to the i-th screenful (85% steps); false once past the end. */
  function scrollStep(i) {
    const s = mainScroller();
    const step = Math.round(Math.min(innerHeight, s.clientHeight || innerHeight) * 0.85);
    const max = s.scrollHeight - s.clientHeight;
    if (i > 0 && (i - 1) * step >= max) return false;
    s.scrollTop = Math.min(i * step, max);
    return true;
  }
  const scrolled = () => { const s = mainScroller(); return s === document.scrollingElement ? scrollY : s.scrollTop + scrollY; };

  // The element with the keyboard focus: its box and what it is, for the focus-ring check.
  function focused() {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    // The gallery's "Focus" samples draw their ring all the time: nothing to compare.
    if (el.matches('.is-focus')) return null;
    const b = el.getBoundingClientRect();
    return { path: pathOf(el), box: rectOf(b), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), visible: b.width > 0 && b.height > 0 && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth };
  }

  // The tokens' own values, for the drawn pieces read straight from them (chart series, stop hues).
  function tokens(names) {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, parse(cs.getPropertyValue(n))]));
  }

  // Tooltips off while focus rings are compared (a tooltip shows at once on keyboard focus).
  let tipSheet = null;
  function tips(on) {
    tipSheet ??= new CSSStyleSheet();
    tipSheet.replaceSync(on ? '' : '[role="tooltip"], .app-tip { visibility: hidden !important; }');
    if (!document.adoptedStyleSheets.includes(tipSheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, tipSheet];
  }
  let held = null;
  function unfocus() { held = document.activeElement; held?.blur?.(); }
  function refocus() { held?.focus?.({ preventScroll: true }); held = null; }

  window.__sweep = { parse, still, bare, collect, focused, tokens, ratio, tips, unfocus, refocus, scrollStep, mainScroller };
})();
