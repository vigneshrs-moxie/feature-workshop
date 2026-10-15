// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jobHue, jobHueStyle } from './hue';
import { colorTokens, DARK } from './tokens';

describe('job hues', () => {
  it('is the same for the same job and within 0–359', () => {
    expect(jobHue('alpha')).toBe(jobHue('alpha'));
    for (const s of ['alpha', 'beta', 'gamma', '', 'a-much-longer-job-name']) {
      const h = jobHue(s);
      expect(Number.isInteger(h) && h >= 0 && h < 360).toBe(true);
    }
  });

  it('spreads different jobs around the wheel', () => {
    const hues = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map(jobHue));
    expect(hues.size).toBe(5);
  });

  it('hands the hue to CSS, which colours it from the theme’s lightness and chroma', () => {
    expect(jobHueStyle('alpha')).toEqual({ '--job-hue': String(jobHue('alpha')) });
    expect(colorTokens(DARK)['job-hue-l']).toBe('.74');
    expect(colorTokens(DARK)['job-hue-c']).toBe('.13');
  });
});
