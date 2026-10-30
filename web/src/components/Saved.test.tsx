// The quiet "Saved" note (packet R): it appears beside the control that changed, is a status a screen
// reader hears, holds about 1.5 s and goes; nothing before a change, and each section shows only the
// newest change's note.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Saved, SAVED_MS, useSaved } from './Saved';

function Two() {
  const saved = useSaved();
  return (
    <>
      <button type="button" onClick={() => saved.mark('a')}>Change A</button>
      <span data-testid="a"><Saved tick={saved.tick('a')} /></span>
      <button type="button" onClick={() => saved.mark('b')}>Change B</button>
      <span data-testid="b"><Saved tick={saved.tick('b')} /></span>
    </>
  );
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Saved', () => {
  it('says nothing until a change, then "Saved" beside that control as a status, gone after about 1.5 s', () => {
    vi.useFakeTimers();
    render(<Two />);
    const a = screen.getByTestId('a').querySelector('[role="status"]')!;
    expect(a).toBeInTheDocument();
    expect(a).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: 'Change A' }));
    expect(a).toHaveTextContent('Saved');
    expect(screen.getByTestId('b')).toHaveTextContent('');
    act(() => { vi.advanceTimersByTime(SAVED_MS - 100); });
    expect(a).toHaveTextContent('Saved');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(a).toHaveTextContent('');
  });

  it('shows only the newest change’s note, and the same change again shows it again', () => {
    vi.useFakeTimers();
    render(<Two />);
    fireEvent.click(screen.getByRole('button', { name: 'Change A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change B' }));
    expect(screen.getByTestId('a')).toHaveTextContent('');
    expect(screen.getByTestId('b')).toHaveTextContent('Saved');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByTestId('b')).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: 'Change B' }));
    expect(screen.getByTestId('b')).toHaveTextContent('Saved');
  });

  it('with less motion it simply goes at 1.5 s (no fade to wait for)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    render(<Two />);
    fireEvent.click(screen.getByRole('button', { name: 'Change A' }));
    act(() => { vi.advanceTimersByTime(SAVED_MS); });
    expect(screen.getByTestId('a')).toHaveTextContent('');
  });
});
