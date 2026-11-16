// The ids in a decision explain themselves (left/Refs.tsx; the glance layout, 16 Nov).
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RefMeaning } from '../types';
import { firstMentions, gistOf, RefOpen, RefText, refTarget } from './Refs';

const REFS: Record<string, RefMeaning> = {
  'R-2': { id: 'R-2', title: 'The file name’s date', text: 'Major · the file name’s date. The name is built on the server.', where: { kind: 'doc', id: 'review.md', name: 'Review (combined)' } },
  'D-005': { id: 'D-005', title: 'Export is limited to 10,000 rows', text: 'Export is limited to 10,000 rows — investigation found no paging', where: { kind: 'decisions', id: 'decisions', name: 'Decisions' } },
};

describe('RefText', () => {
  it('follows a known id with its meaning in brackets; an unknown id stays as it is', () => {
    const { container } = render(<p><RefText text="Fix R-2 and R-9 now?" refs={REFS} /></p>);
    expect(container.textContent).toBe('Fix R-2 (the file name’s date) and R-9 now?');
  });

  it('explains an id once: not again later in the same text, nor where the card told it already, nor where the Foreman wrote a meaning', () => {
    const a = render(<p><RefText text="R-2 first, then R-2 again" refs={REFS} /></p>);
    expect(a.container.textContent).toBe('R-2 (the file name’s date) first, then R-2 again');
    const b = render(<p><RefText text="Until R-2 is fixed" refs={REFS} told={new Set(['R-2'])} /></p>);
    expect(b.container.textContent).toBe('Until R-2 is fixed');
    const c = render(<p><RefText text="R-2 (the date) stays" refs={REFS} /></p>);
    expect(c.container.textContent).toBe('R-2 (the date) stays');
  });

  it('in a question an id is a button that says whether its words are open', () => {
    const pick = vi.fn();
    render(<p><RefText text="Per D-005, stop?" refs={REFS} open="D-005" onPick={pick} /></p>);
    const b = screen.getByRole('button', { name: 'D-005' });
    expect(b).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(b);
    expect(pick).toHaveBeenCalledWith('D-005');
  });

  it('no meanings: the text as it is', () => {
    const { container } = render(<p><RefText text="Fix R-2?" refs={undefined} /></p>);
    expect(container.textContent).toBe('Fix R-2?');
  });
});

describe('the helpers', () => {
  it('firstMentions gives each text the ids its earlier texts mention', () => {
    expect(firstMentions(['R-2 and D-005', 'R-2 again', 'AC-1']).map((s) => [...s].sort())).toEqual([[], ['D-005', 'R-2'], ['D-005', 'R-2']]);
  });

  it('gistOf lower-cases a sentence start, keeps an acronym, and cuts a long meaning', () => {
    expect(gistOf('The file name’s date')).toBe('the file name’s date');
    expect(gistOf('CSV only')).toBe('CSV only');
    expect(gistOf('x'.repeat(80))).toHaveLength(56);
  });

  it('refTarget opens a document, the decisions or the findings', () => {
    expect(refTarget(REFS['R-2'])).toEqual({ kind: 'doc', id: 'review.md' });
    expect(refTarget(REFS['D-005'])).toEqual({ kind: 'decisions', id: 'decisions' });
  });
});

describe('RefOpen', () => {
  it('shows the words, opens where they are, and closes', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<RefOpen meaning={REFS['R-2']} onOpen={onOpen} onClose={onClose} />);
    expect(screen.getByRole('note', { name: 'R-2' })).toHaveTextContent('R-2 Major · the file name’s date. The name is built on the server.');
    fireEvent.click(screen.getByRole('button', { name: 'Open in Review (combined)' }));
    expect(onOpen).toHaveBeenCalledWith({ kind: 'doc', id: 'review.md' }, expect.any(HTMLElement));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
