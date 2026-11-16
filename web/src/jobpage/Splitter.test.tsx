// The drag handles between the job page's columns on a laptop (16 Nov): a drag, the arrows, Home and a
// double click set or clear one custom property on the page, kept in this browser.
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Splitter } from './Splitter';

const PROP = '--jp2-decide-w';
const KEY = 'sb.jobPage.decide-w';

/** A page with one column and its handle. The column's width is what the page's custom property says
 *  (as the grid makes it), else `start`. */
function Harness({ side = 'left', start = 500 }: { side?: 'left' | 'right'; start?: number }) {
  const page = useRef<HTMLElement>(null);
  const measure = () => {
    const el = page.current;
    if (!el) return null;
    return { getBoundingClientRect: () => ({ width: parseFloat(el.style.getPropertyValue(PROP)) || start }) } as unknown as HTMLElement;
  };
  return (
    <main ref={page} aria-label="Job">
      <Splitter page={page} prop={PROP} measure={measure} side={side} min={380} max={1100} label="the decision" className="is-decide" />
    </main>
  );
}

const handle = () => screen.getByRole('separator', { name: 'Resize the decision' });
const width = () => screen.getByRole('main').style.getPropertyValue(PROP);

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('Splitter', () => {
  it('a separator a screen reader can name, with its limits, that the keyboard can reach', () => {
    render(<Harness />);
    expect(handle()).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle()).toHaveAttribute('aria-valuemin', '380');
    expect(handle()).toHaveAttribute('aria-valuemax', '1100');
    expect(handle()).toHaveAttribute('tabindex', '0');
    expect(handle()).toHaveClass('jp2-split', 'is-decide');
    expect(width()).toBe('');
  });

  it('a drag sets the width within its limits, marks the page while it lasts, and keeps the width when it ends', () => {
    render(<Harness />);
    fireEvent.pointerDown(handle(), { button: 0, clientX: 100, pointerId: 1 });
    expect(screen.getByRole('main')).toHaveAttribute('data-dragging');
    fireEvent.pointerMove(handle(), { clientX: 160, pointerId: 1 });
    expect(width()).toBe('560px');
    fireEvent.pointerMove(handle(), { clientX: 2000, pointerId: 1 });
    expect(width()).toBe('1100px');
    fireEvent.pointerMove(handle(), { clientX: -1000, pointerId: 1 });
    expect(width()).toBe('380px');
    fireEvent.pointerMove(handle(), { clientX: 140, pointerId: 1 });
    expect(width()).toBe('540px');
    expect(localStorage.getItem(KEY)).toBeNull();
    fireEvent.pointerUp(handle(), { clientX: 140, pointerId: 1 });
    expect(screen.getByRole('main')).not.toHaveAttribute('data-dragging');
    expect(localStorage.getItem(KEY)).toBe('540');
    // After the drag a move does nothing.
    fireEvent.pointerMove(handle(), { clientX: 400, pointerId: 1 });
    expect(width()).toBe('540px');
  });

  it('a column right of its handle widens as the handle goes left', () => {
    render(<Harness side="right" />);
    fireEvent.pointerDown(handle(), { button: 0, clientX: 800, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 700, pointerId: 1 });
    expect(width()).toBe('600px');
    fireEvent.pointerUp(handle(), { pointerId: 1 });
    expect(localStorage.getItem(KEY)).toBe('600');
  });

  it('a button other than the main one does not start a drag', () => {
    render(<Harness />);
    fireEvent.pointerDown(handle(), { button: 2, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 300, pointerId: 1 });
    expect(width()).toBe('');
    expect(screen.getByRole('main')).not.toHaveAttribute('data-dragging');
  });

  it('the arrows move it by 24 px, Shift by 96, within its limits, and keep it', () => {
    render(<Harness />);
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(width()).toBe('524px');
    expect(localStorage.getItem(KEY)).toBe('524');
    fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true });
    expect(width()).toBe('620px');
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(width()).toBe('596px');
    for (let i = 0; i < 12; i++) fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true });
    expect(width()).toBe('1100px');
    expect(localStorage.getItem(KEY)).toBe('1100');
    // Another key is not the handle's.
    fireEvent.keyDown(handle(), { key: 'a' });
    expect(width()).toBe('1100px');
  });

  it('a column right of its handle: the left arrow widens it', () => {
    render(<Harness side="right" />);
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(width()).toBe('524px');
    fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true });
    expect(width()).toBe('428px');
  });

  it('an arrow on the handle is not the page’s too', () => {
    const outer = vi.fn();
    render(<div onKeyDown={outer}><Harness /></div>);
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(outer).not.toHaveBeenCalled();
  });

  it('Home and a double click give back the default: the property and the kept width go', () => {
    render(<Harness />);
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    fireEvent.keyDown(handle(), { key: 'Home' });
    expect(width()).toBe('');
    expect(localStorage.getItem(KEY)).toBeNull();
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(width()).toBe('524px');
    fireEvent.doubleClick(handle());
    expect(width()).toBe('');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a width kept from an earlier visit is set as it mounts, within the limits; one that is not a width is not', () => {
    localStorage.setItem(KEY, '640');
    const first = render(<Harness />);
    expect(width()).toBe('640px');
    first.unmount();
    localStorage.setItem(KEY, '5000');
    const second = render(<Harness />);
    expect(width()).toBe('1100px');
    second.unmount();
    localStorage.setItem(KEY, 'wide');
    render(<Harness />);
    expect(width()).toBe('');
  });

  it('storage that throws breaks nothing: the width lasts for this visit', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage off'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage off'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage off'); });
    render(<Harness />);
    expect(width()).toBe('');
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(width()).toBe('524px');
    fireEvent.pointerDown(handle(), { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle(), { clientX: 120, pointerId: 1 });
    fireEvent.pointerUp(handle(), { pointerId: 1 });
    expect(width()).toBe('544px');
    fireEvent.doubleClick(handle());
    expect(width()).toBe('');
  });
});
