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
    expect(withoutLeadHeadline(`<h1 id="h-plan">Plan for the merge screen and the undo window</h1>${body}`, 'Plan'))
      .toBe(`<h1 id="h-plan">Plan for the merge screen and the undo window</h1>${body}`);
    expect(withoutLeadHeadline(`<h3 id="h-plan">Plan</h3>${body}`, 'Plan')).toBe(`<h3 id="h-plan">Plan</h3>${body}`);
  });

  it('compares plain words: a headline with **marks** or `code`, and a lead # or ## heading', () => {
    const html = '<p><strong>Plan ready</strong> for <code>merge_into</code> &amp; undo</p>\n' + body;
    expect(withoutLeadHeadline(html, '**Plan ready** for `merge_into` & undo')).toBe(body);
    expect(withoutLeadHeadline(`<h1 id="h-plan-ready">Plan ready</h1>\n${body}`, '## **Plan ready**')).toBe(body);
    expect(withoutLeadHeadline(`<h2 id="h-plan-ready">Plan ready (demo)</h2>\n${body}`, 'Plan ready')).toBe(body);
  });
});
