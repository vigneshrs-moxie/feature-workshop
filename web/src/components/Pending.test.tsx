// A load keeps its space but shows nothing for 200 ms, then its indicator for at least 400 ms, and
// only then the content (principle 5).
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pending, Skeleton } from './Pending';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('Pending', () => {
  it('keeps the space but shows nothing at first, then the words', () => {
    const { container } = render(<Pending loading say="Reading the list…"><p>The list</p></Pending>);
    const box = container.querySelector('.pending')!;
    expect(box).toHaveClass('is-waiting');
    expect(screen.queryByText('The list')).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.querySelector('.pending')).not.toHaveClass('is-waiting');
    expect(screen.getByRole('status')).toHaveTextContent('Reading the list…');
  });

  it('a quick load goes straight to the content', () => {
    const { container, rerender } = render(<Pending loading say="Reading the list…"><p>The list</p></Pending>);
    rerender(<Pending loading={false} say="Reading the list…"><p>The list</p></Pending>);
    expect(container.querySelector('.pending')).toBeNull();
    expect(screen.getByText('The list')).toBeInTheDocument();
  });

  it('once shown, the indicator holds its minimum before the content replaces it', () => {
    const { rerender } = render(<Pending loading say="Reading the list…" skeleton={<Skeleton rows={2} />}><p>The list</p></Pending>);
    act(() => { vi.advanceTimersByTime(250); });
    rerender(<Pending loading={false} say="Reading the list…" skeleton={<Skeleton rows={2} />}><p>The list</p></Pending>);
    expect(screen.queryByText('The list')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Reading the list…');
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByText('The list')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
