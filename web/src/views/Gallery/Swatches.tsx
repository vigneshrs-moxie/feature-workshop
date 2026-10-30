// The colour tokens as swatches, with their contrast against what is behind them (packet R, more
// colour): text needs 4.5:1, marks (dots, icons, bars) 3:1. Read from the theme that is on.
import { useEffect, useState } from 'react';

type Rgb = [number, number, number];

/** A computed colour (oklch(), rgb() or color(srgb …)) as linear sRGB and its alpha. */
function parse(css: string): { rgb: Rgb; a: number } | null {
  const ok = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)/.exec(css);
  if (ok) {
    const L = Number(ok[1]) / (ok[2] ? 100 : 1);
    const C = Number(ok[3]);
    const h = (Number(ok[4]) * Math.PI) / 180;
    const a = C * Math.cos(h); const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((x) => Math.min(1, Math.max(0, x))) as Rgb;
    return { rgb, a: ok[5] ? Number(ok[5]) / (ok[6] ? 100 : 1) : 1 };
  }
  const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(css);
  if (rgb) {
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return { rgb: [lin(+rgb[1]), lin(+rgb[2]), lin(+rgb[3])], a: rgb[4] ? Number(rgb[4]) : 1 };
  }
  return null;
}

const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The contrast of a colour (blended over its background when see-through) against that background. */
export function contrastOf(fg: string, bg: string): number | null {
  const f = parse(fg); const b = parse(bg);
  if (!f || !b) return null;
  const mixed = f.rgb.map((c, i) => c * f.a + b.rgb[i] * (1 - f.a)) as Rgb;
  const [x, y] = [lum(mixed), lum(b.rgb)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** A token's colour as the browser resolves it (custom properties stay as written, so draw it first). */
function resolved(token: string, probe: HTMLElement): string {
  probe.style.color = `var(${token})`;
  return getComputedStyle(probe).color;
}

const ROWS: { token: string; on: string; kind: 'text' | 'mark' }[] = [
  ...['--text-1', '--text-2', '--text-3'].map((token) => ({ token, on: '--surface-1', kind: 'text' as const })),
  { token: '--accent-strong', on: '--surface-1', kind: 'text' },
  { token: '--btn-primary-fg', on: '--btn-primary-bg', kind: 'text' },
  ...['ok', 'warn', 'error', 'info', 'review'].map((s) => ({ token: `--status-${s}`, on: `--status-${s}-bg`, kind: 'text' as const })),
  ...['ok', 'warn', 'error', 'info', 'review'].map((s) => ({ token: `--status-${s}`, on: '--surface-1', kind: 'mark' as const })),
  { token: '--needs-solid', on: '--surface-1', kind: 'mark' },
  ...['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship'].map((s) => ({ token: `--stop-${s}`, on: '--surface-1', kind: 'mark' as const })),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ token: `--chart-${n}`, on: '--surface-1', kind: 'mark' as const })),
  { token: '--border-3', on: '--surface-1', kind: 'mark' },
];

export function Swatches() {
  const [rows, setRows] = useState<{ token: string; on: string; kind: 'text' | 'mark'; ratio: number | null }[]>([]);
  useEffect(() => {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    setRows(ROWS.map((r) => ({ ...r, ratio: contrastOf(resolved(r.token, probe), resolved(r.on, probe)) })));
    probe.remove();
  }, []);
  return (
    <ul className="gallery-swatches">
      {rows.map((r) => {
        const need = r.kind === 'text' ? 4.5 : 3;
        const ok = r.ratio !== null && r.ratio >= need;
        return (
          <li key={`${r.token}-${r.on}`} className="gallery-swatch">
            <span className="gallery-swatch-box" style={{ background: `var(${r.on})` }}>
              {r.kind === 'text' ? <b style={{ color: `var(${r.token})` }}>Aa</b> : <i style={{ background: `var(${r.token})` }} />}
            </span>
            <code className="gallery-swatch-name">{r.token}</code>
            <span className="muted gallery-swatch-on">on {r.on.replace(/^--/, '')}</span>
            <span className={`gallery-swatch-ratio${ok ? '' : ' is-low'}`}>{r.ratio === null ? 'n/a' : `${r.ratio.toFixed(2)}:1`} · {ok ? 'passes' : 'too low'} ({r.kind} {need}:1)</span>
          </li>
        );
      })}
    </ul>
  );
}
