import { describe, expect, it } from 'vitest';
import { withoutLeadHeadline } from './BriefCard';

describe('withoutLeadHeadline', () => {
  const body = '<p><strong>What happened</strong></p>\n<ul>\n<li>Seven reviewers.</li>\n</ul>\n';

  it('drops a first paragraph that is the headline the card already shows', () => {
    const html = `<p><strong>Widget Export · review done</strong> · spec v0.3 · review.md v1</p>\n${body}`;
    expect(withoutLeadHeadline(html, 'Widget Export · review done · spec v0.3 · review.md v1')).toBe(body);
  });

  it('also when the line only adds a short tag', () => {
    const html = `<p><strong>Saved Filters · plan done</strong> (demo)</p>\n${body}`;
    expect(withoutLeadHeadline(html, 'Saved Filters · plan done')).toBe(body);
  });

  it('keeps a first paragraph that says more than the headline', () => {
    const html = `<p><strong>Saved Filters · plan done</strong> and here is a long first paragraph with real content in it.</p>\n${body}`;
    expect(withoutLeadHeadline(html, 'Saved Filters · plan done')).toBe(html);
  });

  it('keeps everything when the brief starts some other way', () => {
    expect(withoutLeadHeadline(body, 'Saved Filters · plan done')).toBe(body);
    expect(withoutLeadHeadline(`<h1>Plan</h1>${body}`, 'Plan')).toBe(`<h1>Plan</h1>${body}`);
  });
});
