import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { inlinePlain, parseInline, plainInline, readLine, shortLines, SHORT_MAX_LINES, withoutBlockMark } from '../lib/inlineMarkdown';
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

  it('never puts emphasis inside a name: __pycache__, __init__.py, a*b*c, snake_case', () => {
    for (const s of [
      '__pycache__', 'rm -rf __pycache__/', 'edit __init__.py now', 'a*b*c', 'x = a*b*c;', 'glob src/*.ts and lib/*.js',
      'src/**/a.ts and lib/**/b.ts', 'my__var__name', 'merged_into_id', 'path/_tmp_/x',
    ]) {
      expect(parseInline(s), s).toEqual([{ kind: 'text', text: s }]);
    }
    // Marks around words still work.
    expect(parseInline('a __bold move__ here')[1]).toEqual({ kind: 'strong', children: [{ kind: 'text', text: 'bold move' }] });
    expect(parseInline('an *aside* here')[1]).toEqual({ kind: 'em', children: [{ kind: 'text', text: 'aside' }] });
  });

  it('plainInline gives the words only, for titles and aria labels', () => {
    expect(plainInline('## **Plan v2** ready: run `npm test` [here](https://example.com)')).toBe('Plan v2 ready: run npm test here');
    expect(plainInline('Keep __pycache__ out')).toBe('Keep __pycache__ out');
    expect(plainInline(null)).toBe('');
  });

  it('shortLines keeps the first few lines, code from fences as written, table cells without pipes', () => {
    const lines = shortLines('## Plan\n\n```sh\nnpm run **build**\n```\n| Step | What |\n|---|:--:|\n| S1 | Data |\n---\nDone.');
    expect(lines).toEqual([
      { kind: 'heading', text: 'Plan' }, { kind: 'code', text: 'npm run **build**' },
      { kind: 'text', text: 'Step · What' }, { kind: 'text', text: 'S1 · Data' }, { kind: 'text', text: 'Done.' },
    ]);
    const many = Array.from({ length: 50 }, (_, i) => `line ${i}\n`).join('\n');
    expect(shortLines(many)).toHaveLength(SHORT_MAX_LINES);
    expect(shortLines(many).at(-1)).toEqual({ kind: 'text', text: `line ${SHORT_MAX_LINES - 1}` });
    // A huge unbroken text is read only up to a bound, quickly.
    const started = performance.now();
    const huge = shortLines('*a _b `c '.repeat(100_000));
    expect(huge).toHaveLength(1);
    expect(huge[0].text.length).toBeLessThanOrEqual(400);
    parseInline(huge[0].text);
    expect(performance.now() - started).toBeLessThan(500);
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

  it('ShortMarkdown shows a few lines with headings, bullets and quotes, and no fence marks or rules', () => {
    const { container } = render(<div><ShortMarkdown text={'## Plan\n- **S1** the data\n> careful\n```\n---\nDone.'} /></div>);
    // An unclosed fence: what follows it is code, shown as written (a "---" in code is not a rule).
    expect(container.textContent).toBe('Plan• S1 the datacareful---Done.');
    expect(container.querySelector('.short-heading strong')).toHaveTextContent('Plan');
    expect(container.querySelectorAll('.short-line')).toHaveLength(5);
    expect(container.querySelectorAll('.short-code code')).toHaveLength(2);
  });

  it('ShortMarkdown shows code from a fence as code, never formatted, and a table without pipes', () => {
    const { container } = render(<div><ShortMarkdown text={'Run:\n```\nrm -rf __pycache__ **x**\n```\n| a | b |\n|---|---|\n| 1 | 2 |'} /></div>);
    expect(container.querySelector('.short-code code')!.textContent).toBe('rm -rf __pycache__ **x**');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).not.toContain('|');
    expect(container.textContent).toContain('1 · 2');
  });
});
