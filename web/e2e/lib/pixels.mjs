// The theme sweep's measures on screenshots (web/e2e/themeSweep.mjs). Every check compares what is
// really painted: words against the pixels behind them (the "bare" screenshot, with the words made
// transparent), so a see-through pane over the aurora is measured over the aurora, not over a token.
// Colours are sRGB 0..1; contrast is WCAG 2's ratio.
const dec = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
const LIN = Array.from({ length: 256 }, (_, i) => dec(i / 255));
export const lum = (c) => 0.2126 * dec(c.r) + 0.7152 * dec(c.g) + 0.0722 * dec(c.b);
export const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const over = (c, B) => ({ r: c.r * c.a + B.r * (1 - c.a), g: c.g * c.a + B.g * (1 - c.a), b: c.b * c.a + B.b * (1 - c.a), a: 1 });
export const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const round = (x) => Math.round(x * 100) / 100;

function px(img, x, y) {
  const o = (y * img.width + x) * 4;
  return { r: img.data[o] / 255, g: img.data[o + 1] / 255, b: img.data[o + 2] / 255, a: 1, L: 0.2126 * LIN[img.data[o]] + 0.7152 * LIN[img.data[o + 1]] + 0.0722 * LIN[img.data[o + 2]] };
}

/** Pixels in a box (clamped to the image), at most about `max` of them, evenly strided. */
function pixelsIn(img, box, max = 4000) {
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(img.width, Math.ceil(box.x + box.w)), y1 = Math.min(img.height, Math.ceil(box.y + box.h));
  const area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const step = Math.max(1, Math.floor(Math.sqrt(area / max)));
  const out = [];
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) out.push([x, y]);
  return out;
}

/** The pixels in a band around a box, from `from` px outside its edge to `to` px outside (negative: inside). */
function band(img, box, from, to) {
  const out = [];
  const add = (x, y) => { if (x >= 0 && y >= 0 && x < img.width && y < img.height) out.push([x, y]); };
  for (let d = from; d < to; d++) {
    const x0 = Math.round(box.x - d - 1), x1 = Math.round(box.x + box.w + d), y0 = Math.round(box.y - d - 1), y1 = Math.round(box.y + box.h + d);
    const stepX = Math.max(1, Math.floor((x1 - x0) / 120)), stepY = Math.max(1, Math.floor((y1 - y0) / 60));
    for (let x = x0; x <= x1; x += stepX) { add(x, y0); add(x, y1); }
    for (let y = y0 + 1; y < y1; y += stepY) { add(x0, y); add(x1, y); }
  }
  return out;
}

/** The middle pixel by luminance: a colour that is really there (not an average of two). */
function median(img, pts) {
  if (!pts.length) return null;
  const list = pts.map(([x, y]) => px(img, x, y)).sort((p, q) => p.L - q.L);
  return list[Math.floor(list.length / 2)];
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];

/**
 * Words: the text colour over each pixel behind it. `contrast` is the 10th percentile (the darkest
 * tenth of the background still counts, a stray pixel of an edge does not); `worst` the lowest.
 * `drawn` is the strongest difference between the real screenshot and the bare one inside the
 * words' boxes: near 1 means the words are not really on screen (covered, or the same colour).
 */
export function textContrast(item, shot, bareShot, p = 0.1) {
  const pts = [];
  // The ink sits in the middle of the line box: its top and bottom sixth (where a chip's border or
  // an underline may run) are left out.
  for (const r of item.rects) pts.push(...pixelsIn(bareShot, { x: r.x, y: r.y + r.h / 6, w: r.w, h: (r.h * 2) / 3 }, 1500));
  if (!pts.length) return null;
  const ratios = [];
  let drawn = 1, bgWorst = null, worst = Infinity;
  for (const [x, y] of pts) {
    const bg = px(bareShot, x, y);
    const r = ratio(over(item.fg, bg), bg);
    ratios.push(r);
    if (r < worst) { worst = r; bgWorst = bg; }
    const real = px(shot, x, y);
    const d = ratio(real, bg);
    if (d > drawn) drawn = d;
  }
  ratios.sort((a, b) => a - b);
  const contrast = pct(ratios, p);
  const mid = pct(ratios, 0.5);
  return { contrast: round(contrast), worst: round(worst), mid: round(mid), drawn: round(drawn), bg: hex(bgWorst), fg: hex(over(item.fg, bgWorst)) };
}

/** A mark: its paint against just outside it ('ring') or against what is under it ('under'). Best try wins. */
export function markContrast(mark, bareShot) {
  let best = null;
  for (const t of mark.tries) {
    const bg = t.where === 'ring' ? median(bareShot, band(bareShot, mark.box, 1, 3)) : median(bareShot, pixelsIn(bareShot, mark.box, 400));
    if (!bg) continue;
    const shown = over(t.paint, bg);
    const r = ratio(shown, bg);
    if (!best || r > best.ratio) best = { ratio: round(r), k: t.k, fg: hex(shown), bg: hex(bg) };
  }
  return best;
}

/** A control: its edge (the band just inside its box) or its fill (the middle), against the page around it. */
export function controlVisibility(ctrl, bareShot) {
  const outside = median(bareShot, band(bareShot, ctrl.box, 2, 4));
  const inner = { x: ctrl.box.x + ctrl.box.w * 0.3, y: ctrl.box.y + ctrl.box.h * 0.3, w: ctrl.box.w * 0.4, h: ctrl.box.h * 0.4 };
  const fill = median(bareShot, pixelsIn(bareShot, inner, 300));
  if (!outside || !fill) return null;
  // The edge: the strongest quarter of the two pixel rings just inside the box (a 1 px border lands
  // in one of them, whatever the rounding; the corners of a rounded box don't pull it down).
  const ring = band(bareShot, ctrl.box, -2, 0).map(([x, y]) => px(bareShot, x, y)).map((c) => ({ c, r: ratio(c, outside) })).sort((a, b) => a.r - b.r);
  if (!ring.length) return null;
  const edgeAt = ring[Math.floor(ring.length * 0.75)];
  const e = edgeAt.r, f = ratio(fill, outside);
  return { edge: round(e), fill: round(f), best: round(Math.max(e, f)), outside: hex(outside), edgeColour: hex(edgeAt.c), fillColour: hex(fill) };
}

/** A drawn shape (svg) or an svg word against what its graph sits on (just outside the svg). */
export function shapeContrast(shape, bareShot) {
  const bg = median(bareShot, band(bareShot, shape.svgBox, 2, 5));
  if (!bg) return null;
  const shown = over(shape.paint, bg);
  return { ratio: round(ratio(shown, bg)), fg: hex(shown), bg: hex(bg) };
}

/**
 * A focus ring: the pixels around the focused element (from 3 px inside to 16 px outside its box) in
 * a screenshot with the focus and one without. `coverage` is the share of the element's perimeter
 * where the two differ by 3:1 or more; `max` the strongest difference.
 */
export function focusRing(box, clip, focusShot, blurShot) {
  const local = { x: box.x - clip.x, y: box.y - clip.y, w: box.w, h: box.h };
  // Up to 16 px out: a card may draw the ring of the link inside it on its own edge.
  const pts = band(focusShot, local, -3, 16);
  let strong = 0, max = 1;
  for (const [x, y] of pts) {
    const r = ratio(px(focusShot, x, y), px(blurShot, x, y));
    if (r >= 3) strong += 1;
    if (r > max) max = r;
  }
  const rings = 19;
  return { coverage: round(strong / Math.max(1, pts.length / rings)), max: round(max) };
}
