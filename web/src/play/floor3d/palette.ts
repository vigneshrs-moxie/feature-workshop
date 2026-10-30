// The 3D floor's colours: every one is read from the theme's tokens at run time (readPalette), so
// the floor fits all eleven themes and changes when the theme does. Nothing here picks a colour of
// its own: derivePalette() only chooses which token each part wears and mixes two tokens where a
// part sits between them (a bench edge, a figure's clay). Pure apart from readPalette().

/** The tokens the floor reads, and nothing else. */
export const FLOOR_TOKENS = [
  '--bg-0', '--bg-1', '--bg-2', '--bg-3', '--bg-4',
  '--text-1', '--text-2', '--text-3',
  '--accent',
  '--group-needs-you-fg', '--group-running-fg', '--group-paused-fg', '--group-idle-fg', '--group-shipping-fg', '--group-done-fg',
  '--status-error', '--ask-permission-line',
] as const;
export type FloorToken = (typeof FLOOR_TOKENS)[number];

/** A colour in sRGB, each channel 0..1. */
export interface Rgb { r: number; g: number; b: number; a: number }

export type LampGroup = 'needs-you' | 'running' | 'paused' | 'idle' | 'shipping' | 'done';

export interface FloorPalette {
  scheme: 'light' | 'dark';
  /** The floor's top, its front edge, the back wall and the door's opening and frame. */
  floor: Rgb; floorEdge: Rgb; wall: Rgb; doorway: Rgb; doorFrame: Rgb;
  /** The bench top, its legs and shelf, a crate. */
  bench: Rgb; benchLeg: Rgb; crate: Rgb;
  /** The figures: one clay for body, head and hands, and the small badge on the chest (the front). */
  clay: Rgb; badge: Rgb;
  /** Props and things on the bench. */
  paper: Rgb; ink: Rgb; metal: Rgb; handle: Rgb; glass: Rgb; liquid: Rgb;
  /** Shadows: the colour and how strong they fall. */
  shadow: Rgb; shadowStrength: number;
  /** The status lamp on each bench, by the job's group (the words beside it say the same). */
  lamp: Record<LampGroup, Rgb>;
  /** The "!" sign of a stopped figure, and the card a figure holds up to ask. */
  stop: Rgb; ask: Rgb;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const num = (s: string, pct = 1) => (s.trim().endsWith('%') ? parseFloat(s) / 100 * pct : parseFloat(s));

/** sRGB transfer, both ways. */
export const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** OKLab → sRGB (Björn Ottosson's matrices), clamped into the gamut. */
export function oklabToRgb(L: number, a: number, b: number, alpha = 1): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return { r: clamp01(toSrgb(r)), g: clamp01(toSrgb(g)), b: clamp01(toSrgb(bl)), a: clamp01(alpha) };
}

function alphaOf(rest: string | undefined): number {
  if (!rest) return 1;
  const v = rest.trim();
  return v === '' || v === 'none' ? 1 : clamp01(num(v));
}

/**
 * A computed CSS colour as sRGB: rgb()/rgba(), #hex, color(srgb …), oklch() and oklab(), the forms a
 * browser's getComputedStyle gives for the tokens. Null for anything else (the caller falls back to
 * a canvas to convert it).
 */
export function parseCssColor(text: string | null | undefined): Rgb | null {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return null;
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    const h = m[1];
    const full = h.length <= 4 ? h.split('').map((c) => c + c).join('') : h;
    if (full.length !== 6 && full.length !== 8) return null;
    const v = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
    return { r: v(0), g: v(2), b: v(4), a: full.length === 8 ? v(6) : 1 };
  }
  m = /^rgba?\(\s*([^)]*)\)$/.exec(t);
  if (m) {
    const [chan, al] = m[1].split('/');
    const parts = chan.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const c = (s: string) => clamp01(s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s) / 255);
    const alpha = al !== undefined ? alphaOf(al) : parts[3] !== undefined ? alphaOf(parts[3]) : 1;
    const out = { r: c(parts[0]), g: c(parts[1]), b: c(parts[2]), a: alpha };
    return [out.r, out.g, out.b].some(Number.isNaN) ? null : out;
  }
  m = /^color\(\s*srgb\s+([^)]*)\)$/.exec(t);
  if (m) {
    const [chan, al] = m[1].split('/');
    const parts = chan.trim().split(/\s+/);
    if (parts.length < 3) return null;
    const out = { r: clamp01(num(parts[0])), g: clamp01(num(parts[1])), b: clamp01(num(parts[2])), a: alphaOf(al) };
    return [out.r, out.g, out.b].some(Number.isNaN) ? null : out;
  }
  m = /^okl(ch|ab)\(\s*([^)]*)\)$/.exec(t);
  if (m) {
    const [chan, al] = m[2].split('/');
    const parts = chan.trim().split(/\s+/);
    if (parts.length < 3) return null;
    const L = num(parts[0]);
    if (m[1] === 'ch') {
      const C = parts[1] === 'none' ? 0 : num(parts[1], 0.4);
      const h = parts[2] === 'none' ? 0 : (parseFloat(parts[2]) * Math.PI) / 180;
      if ([L, C, h].some(Number.isNaN)) return null;
      return oklabToRgb(L, C * Math.cos(h), C * Math.sin(h), alphaOf(al));
    }
    const a = num(parts[1], 0.4);
    const b = num(parts[2], 0.4);
    if ([L, a, b].some(Number.isNaN)) return null;
    return oklabToRgb(L, a, b, alphaOf(al));
  }
  return null;
}

/** a toward b by t, in linear light (how paint mixes), alpha mixed straight. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  if (t <= 0) return { ...a };
  if (t >= 1) return { ...b };
  const f = (x: number, y: number) => toSrgb(toLinear(x) + (toLinear(y) - toLinear(x)) * t);
  return { r: f(a.r, b.r), g: f(a.g, b.g), b: f(a.b, b.b), a: a.a + (b.a - a.a) * t };
}

/** A colour with its alpha laid over a solid ground, as the page shows it. */
export function over(top: Rgb, ground: Rgb): Rgb {
  if (top.a >= 1) return { ...top, a: 1 };
  return { ...mix(ground, { ...top, a: 1 }, top.a), a: 1 };
}

/** Relative luminance (WCAG), 0..1. */
export const luminance = (c: Rgb) => 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);

const GREY: Rgb = { r: 0.5, g: 0.5, b: 0.5, a: 1 };

/**
 * Which token each part wears. raw: the tokens as read (any missing one falls back to its nearest
 * neighbour, never to a colour of our own). The rules, in words:
 * - the floor is --bg-2, a step off the page (--bg-0), with an edge and a wall from --bg-3/--bg-4;
 * - benches are the neutral furthest from the floor on the page's side: --bg-0 in light themes,
 *   --bg-4 a step toward --text-3 in dark ones, with legs a step darker;
 * - the figures are one clay, part way from the floor to --text-3 (light) or --text-2 (dark), so
 *   they stand clear of the floor in both schemes, and
 *   wear one dot of --accent on the chest (it marks their front: they have no faces);
 * - paper is the lightest neutral (--bg-0 or --text-1), ink and metal are --text-2 and --text-3;
 * - lamps wear their group's colour, the "!" sign --status-error, the asking card --ask-permission-line.
 */
export function derivePalette(raw: Partial<Record<FloorToken, Rgb>>, schemeHint?: 'light' | 'dark' | null): FloorPalette {
  const pick = (...names: FloorToken[]): Rgb => {
    for (const n of names) { const c = raw[n]; if (c) return c; }
    return GREY;
  };
  const bg0 = over(pick('--bg-0', '--bg-1'), GREY);
  const ground = (c: Rgb) => over(c, bg0);
  const bg2 = ground(pick('--bg-2', '--bg-1', '--bg-0'));
  const bg3 = ground(pick('--bg-3', '--bg-2', '--bg-1'));
  const bg4 = ground(pick('--bg-4', '--bg-3', '--bg-2'));
  const text1 = ground(pick('--text-1', '--text-2'));
  const text2 = ground(pick('--text-2', '--text-1'));
  const text3 = ground(pick('--text-3', '--text-2'));
  const accent = ground(pick('--accent', '--text-2'));
  const scheme: 'light' | 'dark' = schemeHint ?? (luminance(bg0) > luminance(text1) ? 'light' : 'dark');
  const light = scheme === 'light';
  const floor = bg2;
  const bench = light ? bg0 : mix(bg4, text3, 0.16);
  const clay = light ? mix(floor, text3, 0.42) : mix(floor, text2, 0.58);
  const paper = luminance(bg0) > luminance(text1) ? bg0 : text1;
  const lamp = (name: FloorToken, ...more: FloorToken[]) => ground(pick(name, ...more, '--text-2'));
  return {
    scheme,
    floor,
    floorEdge: light ? bg4 : bg3,
    wall: light ? bg0 : bg3,
    doorway: mix(floor, text1, light ? 0.32 : 0.06),
    doorFrame: bench,
    bench,
    benchLeg: mix(bench, text3, light ? 0.18 : 0.12),
    crate: mix(bench, text3, light ? 0.3 : 0.22),
    clay,
    badge: accent,
    paper,
    ink: text2,
    metal: mix(text3, paper, 0.35),
    handle: mix(clay, text1, 0.25),
    glass: mix(paper, accent, 0.15),
    liquid: accent,
    shadow: light ? text1 : bg0,
    shadowStrength: light ? 0.16 : 0.42,
    lamp: {
      'needs-you': lamp('--group-needs-you-fg'),
      running: lamp('--group-running-fg'),
      paused: lamp('--group-paused-fg'),
      idle: lamp('--group-idle-fg'),
      shipping: lamp('--group-shipping-fg', '--group-running-fg'),
      done: lamp('--group-done-fg'),
    },
    stop: ground(pick('--status-error', '--text-1')),
    ask: ground(pick('--ask-permission-line', '--accent')),
  };
}

// ---------- Reading the tokens (the only part that touches the page) ----------

let canvasCtx: CanvasRenderingContext2D | null | undefined;
/** The browser's own conversion, for a colour form parseCssColor doesn't know. */
function viaCanvas(text: string): Rgb | null {
  if (canvasCtx === undefined) {
    try {
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      canvasCtx = c.getContext('2d', { willReadFrequently: true });
    } catch { canvasCtx = null; }
  }
  const ctx = canvasCtx;
  if (!ctx) return null;
  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = text;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
  } catch { return null; }
}

/**
 * The tokens as the page has them now, resolved through every var() and color-mix(): a hidden probe
 * wears each token as its colour and getComputedStyle answers. Then derivePalette().
 */
export function readPalette(root: HTMLElement = document.documentElement): FloorPalette {
  const raw: Partial<Record<FloorToken, Rgb>> = {};
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.hidden = true;
  (document.body ?? root).appendChild(probe);
  try {
    for (const name of FLOOR_TOKENS) {
      probe.style.color = '';
      probe.style.color = `var(${name})`;
      const text = getComputedStyle(probe).color;
      if (!text || !getComputedStyle(root).getPropertyValue(name).trim()) continue;
      const c = parseCssColor(text) ?? viaCanvas(text);
      if (c) raw[name] = c;
    }
  } finally {
    probe.remove();
  }
  const cs = getComputedStyle(root).colorScheme;
  const scheme = /light/.test(cs) && !/dark/.test(cs) ? 'light' : /dark/.test(cs) && !/light/.test(cs) ? 'dark' : null;
  return derivePalette(raw, scheme);
}

/** Calls back whenever the theme may have changed (the html element's theme, text size or class, or the system's scheme). */
export function watchTheme(onChange: () => void, root: HTMLElement = document.documentElement): () => void {
  const mo = new MutationObserver(() => onChange());
  mo.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  mq?.addEventListener?.('change', onChange);
  return () => { mo.disconnect(); mq?.removeEventListener?.('change', onChange); };
}
