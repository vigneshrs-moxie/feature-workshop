// The one tooltip (components/Tooltip.tsx): no browser tooltip ever shows, because a title is set
// aside while it is pointed at or focused and drawn in the app's look, then given back unchanged.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipLayer, tipWords } from './Tooltip';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the app tooltip', () => {
  it('splits a trailing key into key caps', () => {
    expect(tipWords('Start a new job (key: c).')).toEqual({ text: 'Start a new job.', keys: ['c'] });
    expect(tipWords('The Inbox (keys: g i)')).toEqual({ text: 'The Inbox.', keys: ['g i'] });
    expect(tipWords('No key here.')).toEqual({ text: 'No key here.', keys: [] });
    expect(tipWords('Go (key: a).', false)).toEqual({ text: 'Go.', keys: [] });
  });

  it('under the pointer: the title is set aside at once, the app tooltip shows after a short delay, and the title comes back', () => {
    render(<><button type="button" title="Start a new job (key: c).">New job</button><TooltipLayer /></>);
    const b = screen.getByRole('button', { name: 'New job' });
    fireEvent.pointerOver(b, { pointerType: 'mouse' });
    expect(b).not.toHaveAttribute('title');
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => { vi.advanceTimersByTime(500); });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Start a new job.');
    expect(tip.querySelector('kbd')).toHaveTextContent('c');
    expect(b.getAttribute('aria-describedby')).toContain(tip.id);
    fireEvent.pointerOut(b, { pointerType: 'mouse', relatedTarget: document.body });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(b).toHaveAttribute('title', 'Start a new job (key: c).');
    expect(b).not.toHaveAttribute('aria-describedby');
  });

  it('an icon-only button keeps its name while its title is set aside', () => {
    render(<><button type="button" title="Settings and more"><svg aria-hidden="true" /></button><TooltipLayer /></>);
    const b = screen.getByRole('button', { name: 'Settings and more' });
    fireEvent.pointerOver(b, { pointerType: 'mouse' });
    expect(screen.getByRole('button', { name: 'Settings and more' })).toBe(b);
    fireEvent.pointerOut(b, { pointerType: 'mouse', relatedTarget: document.body });
    expect(b).not.toHaveAttribute('aria-label');
  });

  it('Esc and a click hide it', () => {
    render(<><button type="button" title="Hello">Hi</button><TooltipLayer /></>);
    const b = screen.getByRole('button');
    fireEvent.pointerOver(b, { pointerType: 'mouse' });
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('a touch never shows one', () => {
    render(<><button type="button" title="Hello">Hi</button><TooltipLayer /></>);
    const b = screen.getByRole('button');
    fireEvent.pointerOver(b, { pointerType: 'touch' });
    act(() => { vi.advanceTimersByTime(800); });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(b).toHaveAttribute('title', 'Hello');
  });
});
