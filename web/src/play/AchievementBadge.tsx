// An achievement's badge: a station mission patch (packet SB): a hexagonal patch with a stitched
// rim over a two-part banner, and a small glyph for what it is for (a flag for a quest, a check for
// Clean Sweep, a key for a secret). Drawn inline as SVG, coloured only through tokens
// (achievements.css): gold for unlocked, grey for locked. Decoration only: the name and "Locked" /
// the unlock date always sit next to it as text. The hooks keep their names (.ach-rim, .ach-face,
// .ach-ribbon-l and -r: the banner's two halves).
import type { ReactNode } from 'react';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const F = { fill: 'currentColor', stroke: 'none' } as const;

const flag = <path {...S} d="M4 14.5V2.5M4 3h8.5l-2.2 3 2.2 3H4" />;

// Each glyph in a 16 × 16 box.
const GLYPHS: Record<string, ReactNode> = {
  'first-quest': flag,
  quest: flag,
  'clean-sweep': <path {...S} d="M3 8.5l3.2 3.2L13 4.5" />,
  speedrun: <path {...F} d="M9.2 1.2 3.4 9.2h4.4l-1 5.6 5.8-8H8.2z" />,
  'full-panel': (
    <g {...F}>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return <circle key={i} cx={8 + Math.cos(a) * 5.2} cy={8 + Math.sin(a) * 5.2} r={1.35} />;
      })}
    </g>
  ),
  'boss-slayer': <path {...S} d="M2.5 12.5h11M2.6 12.3 2 4.8l3.4 2.8L8 2.8l2.6 4.8L14 4.8l-.6 7.5" />,
  'bug-hunter': (
    <g>
      <ellipse {...F} cx={8} cy={9.2} rx={3} ry={4} />
      <path {...S} strokeWidth={1.4} d="M5 7.4 2.6 6M5 10H2.4M5.2 12.4 3.2 14M11 7.4 13.4 6M11 10h2.6M10.8 12.4l2 1.6M6.7 5.4 5.6 3M9.3 5.4l1.1-2.4" />
    </g>
  ),
  'night-owl': <path {...F} d="M10.2 2.2a6.2 6.2 0 1 0 3.8 10 5.2 5.2 0 0 1-3.8-10z" />,
  comeback: <path {...S} d="M13 8.5A5 5 0 1 1 11.4 4.4M11.8 1.6v3.2H8.6" />,
  explorer: (
    <g>
      <circle {...S} cx={8} cy={8} r={6.2} />
      <path {...F} d="M8 3.6 9.6 8 8 12.4 6.4 8z" />
    </g>
  ),
  collector: <path {...F} d="m8 1.6 1.9 4 4.3.5-3.2 3 .8 4.3L8 11.3l-3.8 2.1.8-4.3-3.2-3 4.3-.5z" />,
  secret: (
    <g>
      <circle {...S} cx={5} cy={8} r={2.8} />
      <path {...S} d="M7.8 8H14M12 8v2.6M14.2 8v2" />
    </g>
  ),
};

/** A hexagon round (cx, cy), flat sides left and right, as a path. */
function hexPath(cx: number, cy: number, r: number): string {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${pts.join('L')}Z`;
}

/** The glyph a badge shows: by achievement id, every secret a key, 'quest' a flag. */
export function badgeGlyph(id: string): string {
  if (id.startsWith('secret-')) return 'secret';
  return id in GLYPHS ? id : 'collector';
}

export function AchievementBadge({ id, unlocked = true, size = 40 }: { id: string; unlocked?: boolean; size?: number }) {
  const glyph = badgeGlyph(id);
  const kind = glyph === 'secret' ? 'is-secret' : glyph === 'quest' ? 'is-quest' : '';
  return (
    <svg
      className={`ach-medal ${unlocked ? 'is-unlocked' : 'is-locked'} ${kind}`.trim()}
      width={size}
      height={size * 1.2}
      viewBox="0 0 40 48"
      aria-hidden="true"
      focusable="false"
    >
      <path className="ach-ribbon ach-ribbon-l" d="M3 33.5 20 36.5V45L3 42 6 37.8z" />
      <path className="ach-ribbon ach-ribbon-r" d="M37 33.5 20 36.5V45L37 42 34 37.8z" />
      <path className="ach-rim" d={hexPath(20, 19, 17.5)} />
      <path className="ach-face" d={hexPath(20, 19, 13.6)} />
      <path className="ach-stitch" d={hexPath(20, 19, 15.6)} />
      <g className="ach-glyph" transform="translate(12 11)">{GLYPHS[glyph]}</g>
    </svg>
  );
}
