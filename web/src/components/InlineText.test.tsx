import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { inlinePlain, parseInline, readLine, withoutBlockMark } from '../lib/inlineMarkdown';
import { InlineText, ShortMarkdown } from './InlineText';

describe('parseInline', () => {
  it('reads code, bold, emphasis and https links; leaves other text alone', () => {
    expect(parseInline('Run `npm test` **now**, *please*: see [the plan](https://example.com/p).')).toEqual([
      { kind: 'text', text: 'Run ' }, { kind: 'code', text: 'npm test' }, { kind: 'text', text: ' ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'now' }] }, { kind: 'text', text: ', ' },
      { kind: 'em', children: [{ kind: 'text', text: 'please' }] }, { kind: 'text', text: ': see ' },
      { kind: 'link', href: 'https://example.com/p', children: [{ kind: 'text', text: 'the plan' }] }, { kind: 'text', text: '.' },
    ]);
    expect(parseInline('plain words')).toEqual([{ kind: 'text', text: 'plain words' }]);
  });

  it('never makes a link of anything but http(s), and leaves snake_case and lone stars alone', () => {
    expect(inlinePlain(parseInline('[x](javascript:alert(1))'))).toBe('[x](javascript:alert(1))');
    expect(parseInline('[x](javascript:alert(1))').some((p) => p.kind === 'link')).toBe(false);
    expect(parseInline('merged_into_id and 2 * 3 * 4')).toEqual([{ kind: 'text', text: 'merged_into_id and 2 * 3 * 4' }]);
    expect(parseInline('\\*not em\\*')).toEqual([{ kind: 'text', text: '*not em*' }]);
  });

  it('reads a line’s block mark', () => {
    expect(readLine('## Plan v2')).toEqual({ kind: 'heading', text: 'Plan v2' });
    expect(readLine('- [x] done')).toEqual({ kind: 'bullet', text: 'done' });
    expect(readLine('2. Second')).toEqual({ kind: 'numbered', marker: '2', text: 'Second' });
    expect(readLine('> quoted')).toEqual({ kind: 'quote', text: 'quoted' });
    expect(readLine('---').kind).toBe('rule');
    expect(withoutBlockMark('### Ready for you')).toBe('Ready for you');
  });
});

describe('InlineText and ShortMarkdown', () => {
  it('shows marks as formatting, never as raw characters or HTML', () => {
    const { container } = render(<p><InlineText text={'## **Plan v2** ready: run `npm test` <img src=x onerror=alert(1)>'} /></p>);
    expect(container.textContent).toBe('Plan v2 ready: run npm test <img src=x onerror=alert(1)>');
    expect(container.querySelector('strong')).toHaveTextContent('Plan v2');
    expect(container.querySelector('code.inline-code')).toHaveTextContent('npm test');
    expect(container.querySelector('img')).toBeNull();
  });

  it('a link opens in a new tab without a referrer', () => {
    render(<InlineText text="See [the PR](https://example.com/pull/1)" />);
    const a = screen.getByRole('link', { name: 'the PR' });
    expect(a).toHaveAttribute('href', 'https://example.com/pull/1');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('ShortMarkdown shows a few lines with headings, bullets and quotes, and no fences or rules', () => {
    const { container } = render(<div><ShortMarkdown text={'## Plan\n- **S1** the data\n> careful\n```\n---\nDone.'} /></div>);
    expect(container.textContent).toBe('Plan• S1 the datacarefulDone.');
    expect(container.querySelector('.short-heading strong')).toHaveTextContent('Plan');
    expect(container.querySelectorAll('.short-line')).toHaveLength(4);
  });
});
