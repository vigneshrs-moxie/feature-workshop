// Each job gets its own hue, worked out from its name so it is the same on every page and every
// visit. It tints the job's dot in the Jobs pane (later also its branch chip and stepper). The hue
// only helps you spot a job again; it never carries meaning on its own.
//
// Components set it as the CSS variable --job-hue; the colour itself is decided in CSS from the
// job-hue-l and job-hue-c tokens (tokens.ts), so every hue has the same lightness and chroma.
import type { CSSProperties } from 'react';

/** A hue from 0 to 359 for this job, from a small string hash (FNV-1a) of its slug. */
export function jobHue(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 360;
}

/** The style that hands an element its job's hue. */
export function jobHueStyle(slug: string): CSSProperties {
  return { '--job-hue': String(jobHue(slug)) } as CSSProperties;
}
