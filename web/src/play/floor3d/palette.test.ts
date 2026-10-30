import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLOOR_TOKENS, STOP_HUES, contrast, derivePalette, luminance, mix, parseCssColor, readPalette, watchTheme, type FloorToken, type Rgb } from './palette';

const close = (a: Rgb | null, b: Partial<Rgb>, d = 0.01) => {
  expect(a).not.toBeNull();
  for (const k of Object.keys(b) as (keyof Rgb)[]) expect(Math.abs((a as Rgb)[k] - (b[k] as number))).toBeLessThan(d);
};

describe('parseCssColor', () => {
  it('reads the forms getComputedStyle gives', () => {
    close(parseCssColor('rgb(255, 0, 0)'), { r: 1, g: 0, b: 0, a: 1 });
    close(parseCssColor('rgba(0, 0, 255, 0.5)'), { b: 1, a: 0.5 });
    close(parseCssColor('rgb(0 128 0 / 25%)'), { g: 128 / 255, a: 0.25 });
    close(parseCssColor('#fff'), { r: 1, g: 1, b: 1 });
    close(parseCssColor('#00000080'), { r: 0, a: 128 / 255 });
    close(parseCssColor('color(srgb 0.2 0.4 0.6)'), { r: 0.2, g: 0.4, b: 0.6 });
    close(parseCssColor('color(srgb 0.2 0.4 0.6 / 0.3)'), { a: 0.3 });
  });

  it('converts oklch and oklab to sRGB', () => {
    close(parseCssColor('oklch(1 0 0)'), { r: 1, g: 1, b: 1 });
    close(parseCssColor('oklch(0 0 0)'), { r: 0, g: 0, b: 0 });
    // oklch(0.628 0.2577 29.23) is sRGB red.
    close(parseCssColor('oklch(0.62796 0.25768 29.2339)'), { r: 1, g: 0, b: 0 }, 0.02);
    close(parseCssColor('oklab(0.62796 0.22486 0.12585)'), { r: 1, g: 0, b: 0 }, 0.02);
    close(parseCssColor('oklch(.7 .15 275 / .16)'), { a: 0.16 });
    close(parseCssColor('oklch(50% 0 none)'), { r: 0.389, g: 0.389, b: 0.389 }, 0.02);
  });

  it('answers null for what it doesn’t know', () => {
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor('hsl(10 50% 50%)')).toBeNull();
    expect(parseCssColor('var(--x)')).toBeNull();
    expect(parseCssColor(null)).toBeNull();
  });
});

const grey = (v: number): Rgb => ({ r: v, g: v, b: v, a: 1 });
function tokens(dark: boolean): Partial<Record<FloorToken, Rgb>> {
  const L = (x: number) => grey(dark ? x : 1 - x);
  return {
    '--bg-0': L(0.1), '--bg-1': L(0.13), '--bg-2': L(0.16), '--bg-3': L(0.2), '--bg-4': L(0.24),
    '--text-1': L(0.95), '--text-2': L(0.72), '--text-3': L(0.58),
    '--accent': { r: 0.4, g: 0.4, b: 0.9, a: 1 },
    '--group-needs-you-fg': { r: 0.9, g: 0.6, b: 0.1, a: 1 },
    '--group-running-fg': { r: 0.1, g: 0.7, b: 0.9, a: 1 },
    '--group-paused-fg': { r: 0.8, g: 0.6, b: 0.2, a: 1 },
    '--group-idle-fg': L(0.72),
    '--group-done-fg': { r: 0.2, g: 0.8, b: 0.4, a: 1 },
    '--status-error': { r: 0.9, g: 0.3, b: 0.3, a: 1 },
    '--ask-permission-line': { r: 0.4, g: 0.4, b: 0.9, a: 1 },
  };
}

describe('derivePalette', () => {
  it('takes every colour from the tokens, by rule', () => {
    const raw = tokens(true);
    const p = derivePalette(raw, 'dark');
    expect(p.floor).toEqual(raw['--bg-2']);
    expect(p.badge).toEqual(raw['--accent']);
    expect(p.lamp['needs-you']).toEqual(raw['--group-needs-you-fg']);
    expect(p.lamp.running).toEqual(raw['--group-running-fg']);
    // Shipping has no token here: it borrows running's.
    expect(p.lamp.shipping).toEqual(raw['--group-running-fg']);
    // The "!" is stopped red; the waiting hand and the asking card are needs-you amber.
    expect(p.stop).toEqual(raw['--status-error']);
    expect(p.ask).toEqual(raw['--group-needs-you-fg']);
    expect(p.needsYou).toEqual(raw['--group-needs-you-fg']);
  });

  it('gives each stop its own hue from its --stop-* token, the accent where a theme has none', () => {
    const build = { r: 0.1, g: 0.6, b: 0.7, a: 1 };
    const test = { r: 0.2, g: 0.7, b: 0.4, a: 1 };
    const p = derivePalette({ ...tokens(true), '--stop-build': build, '--stop-test': test }, 'dark');
    expect(p.hue.build).toEqual(build);
    expect(p.hue.test).toEqual(test);
    expect(p.hue.spec).toEqual(tokens(true)['--accent']);
    // What is drawn on a hue is whichever of the page's lightest and darkest reads best on it.
    for (const k of STOP_HUES) expect(contrast(p.hue[k], p.onHue[k])).toBeGreaterThan(2.5);
  });

  it('keeps big areas neutral: floor, benches and clay carry no stop hue', () => {
    for (const dark of [true, false]) {
      const p = derivePalette({ ...tokens(dark), '--stop-ship': { r: 0.9, g: 0.6, b: 0.1, a: 1 } }, dark ? 'dark' : 'light');
      for (const c of [p.floor, p.bench, p.clay]) expect(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)).toBeLessThan(0.06);
    }
  });

  it('warms the key light and cools the rim, both near white', () => {
    const p = derivePalette({ ...tokens(false), '--stop-ship': { r: 0.9, g: 0.6, b: 0.1, a: 1 } }, 'light');
    expect(p.key.r).toBeGreaterThan(p.key.b);
    expect(p.rim.b).toBeGreaterThan(p.rim.r);
    expect(Math.min(p.key.b, p.rim.r)).toBeGreaterThan(0.8);
  });

  it('keeps the figures clear of the floor in both schemes', () => {
    for (const dark of [true, false]) {
      const p = derivePalette(tokens(dark), dark ? 'dark' : 'light');
      expect(Math.abs(luminance(p.clay) - luminance(p.floor))).toBeGreaterThan(0.08);
      expect(Math.abs(luminance(p.bench) - luminance(p.floor))).toBeGreaterThan(0.005);
    }
  });

  it('works out the scheme from the tokens when not told', () => {
    expect(derivePalette(tokens(false)).scheme).toBe('light');
    expect(derivePalette(tokens(true)).scheme).toBe('dark');
  });

  it('lays a see-through token over the page, and mixes in linear light', () => {
    const raw = { ...tokens(true), '--accent': { r: 1, g: 1, b: 1, a: 0 } };
    expect(derivePalette(raw, 'dark').badge).toEqual({ ...raw['--bg-0'], a: 1 });
    const m = mix(grey(0), grey(1), 0.5);
    expect(m.r).toBeGreaterThan(0.7);
  });
});

describe('readPalette', () => {
  afterEach(() => { vi.restoreAllMocks(); document.documentElement.removeAttribute('style'); });

  it('reads each token through a probe, resolved, and leaves nothing behind', () => {
    const values: Record<string, string> = {
      '--bg-0': 'rgb(250, 250, 250)', '--bg-2': 'rgb(240, 240, 240)', '--text-1': 'rgb(20, 20, 20)', '--accent': 'oklch(0.46 0.17 275)',
    };
    for (const k of Object.keys(values)) document.documentElement.style.setProperty(k, 'x');
    const real = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const cs = real(el);
      if (el === document.documentElement) return { getPropertyValue: (n: string) => (values[n] ? 'set' : ''), colorScheme: 'light' } as unknown as CSSStyleDeclaration;
      const want = /var\((--[\w-]+)\)/.exec((el as HTMLElement).style.color)?.[1];
      return { ...cs, color: want ? values[want] ?? '' : '' } as CSSStyleDeclaration;
    });
    const before = document.body.childElementCount;
    const p = readPalette();
    expect(document.body.childElementCount).toBe(before);
    expect(p.scheme).toBe('light');
    expect(p.floor.r).toBeCloseTo(240 / 255, 2);
    expect(p.badge.b).toBeGreaterThan(p.badge.r);
    expect(FLOOR_TOKENS).toContain('--accent');
  });

  it('calls back when the theme changes', async () => {
    const cb = vi.fn();
    const stop = watchTheme(cb);
    document.documentElement.setAttribute('data-theme', 'light');
    await Promise.resolve();
    expect(cb).toHaveBeenCalled();
    stop();
    document.documentElement.removeAttribute('data-theme');
  });
});
