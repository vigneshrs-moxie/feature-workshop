// The handle between the middle pane and the Preview pane: drag or keys set the Preview width,
// clamped so the Preview keeps PREVIEW_MIN and the middle pane MIDDLE_MIN; remembered in this
// browser; double-click or Enter puts the usual 40% back. jsdom has no layout, so the panes'
// sizes are stubbed.
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { clampPreview, MIDDLE_MIN, PaneResizer, PREVIEW_MIN, PREVIEW_WIDTH_KEY, usePreviewWidth } from './PaneResizer';

const rect = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 800, height: 800, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

// 1400px of panes: Jobs 300, the middle 540, Preview 560 (40%).
function Harness() {
  const panes = useRef<HTMLDivElement>(null);
  const [w] = usePreviewWidth();
  return (
    <div ref={panes} className="panes" data-width={w ?? ''}>
      <nav className="pane pane-jobs" />
      <main className="pane pane-foreman" />
      <aside className="pane pane-preview" />
      <PaneResizer panes={panes} />
    </div>
  );
}

function setup() {
  const utils = render(<Harness />);
  const c = utils.container;
  (c.querySelector('.panes') as HTMLElement).getBoundingClientRect = () => rect(0, 1400);
  (c.querySelector('.pane-jobs') as HTMLElement).getBoundingClientRect = () => rect(0, 300);
  (c.querySelector('.pane-preview') as HTMLElement).getBoundingClientRect = () => rect(840, 560);
  const handle = screen.getByRole('separator', { name: 'Resize the Preview pane' });
  const remembered = () => localStorage.getItem(PREVIEW_WIDTH_KEY);
  return { ...utils, handle, remembered };
}

afterEach(() => localStorage.clear());

describe('PaneResizer', () => {
  it('clamps: the Preview never under its minimum, the middle pane never under its own', () => {
    expect(clampPreview(100, 1400, 300)).toBe(PREVIEW_MIN);
    expect(clampPreview(5000, 1400, 300)).toBe(1400 - 300 - MIDDLE_MIN);
    expect(clampPreview(600, 1400, 300)).toBe(600);
    // A window too small for both: the Preview keeps its minimum.
    expect(clampPreview(600, 700, 300)).toBe(PREVIEW_MIN);
  });

  it('is a focusable vertical separator that reports the Preview width', () => {
    const { handle } = setup();
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('tabindex', '0');
    expect(handle).toHaveAttribute('aria-valuemin', String(PREVIEW_MIN));
  });

  it('dragging sets the width (clamped) and remembers it when you let go', () => {
    const { handle, remembered, container } = setup();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 840 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
    expect((container.querySelector('.panes') as HTMLElement).style.getPropertyValue('--preview-w')).toBe('700px');
    expect(remembered()).toBeNull();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 200 });
    expect(remembered()).toBe(String(1400 - 300 - MIDDLE_MIN));
  });

  it('keys: ← grows the Preview, → shrinks it, Home and End go to the ends, Enter puts it back', () => {
    const { handle, remembered } = setup();
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(remembered()).toBe('576');
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(remembered()).toBe('496');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(remembered()).toBe(String(PREVIEW_MIN));
    fireEvent.keyDown(handle, { key: 'End' });
    expect(remembered()).toBe(String(1400 - 300 - MIDDLE_MIN));
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(remembered()).toBeNull();
  });

  it('a double-click puts the usual width back', () => {
    const { handle, remembered } = setup();
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.doubleClick(handle);
    expect(remembered()).toBeNull();
  });
});
