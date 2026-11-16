import { act, render, screen } from '@testing-library/react';
import { lazy, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { lazyPage, Pages, PageSlot, preloadNav } from './pages';

describe('the pages in their own chunks', () => {
  it('holds the page’s place with an empty page while its chunk loads, then shows the page', async () => {
    let done: (v: { default: () => ReactElement }) => void = () => {};
    const Slow = lazy(() => new Promise<{ default: () => ReactElement }>((r) => { done = r; }));
    render(<PageSlot at="slow"><Slow /></PageSlot>);
    const holder = screen.getByRole('main', { name: 'Opening the page' });
    expect(holder).toHaveClass('page');
    expect(holder).toHaveAttribute('aria-busy', 'true');
    // "Opening…" is there from the start (it fades in after 300 ms in CSS), so nothing moves when it shows.
    expect(screen.getByRole('status')).toHaveTextContent('Opening…');
    await act(async () => { done({ default: () => <main aria-label="Slow">Here</main> }); });
    expect(await screen.findByRole('main', { name: 'Slow' })).toHaveTextContent('Here');
    expect(screen.queryByRole('main', { name: 'Opening the page' })).toBeNull();
  });

  it('a chunk that does not load says so with Reload, and another page tries again', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    const { rerender } = render(<PageSlot at="broken"><Broken /></PageSlot>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/This page did not open/);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    rerender(<PageSlot at="other"><main aria-label="Other">Fine</main></PageSlot>);
    expect(screen.getByRole('main', { name: 'Other' })).toBeInTheDocument();
    quiet.mockRestore();
  });

  it('a top bar link fetches its page’s chunk ahead (pointer or focus on it)', () => {
    const desk = vi.spyOn(Pages.desk, 'preload').mockResolvedValue(undefined);
    const stacks = vi.spyOn(Pages.stacks, 'preload').mockResolvedValue(undefined);
    preloadNav('desk');
    preloadNav('stacks');
    preloadNav('jobs');
    expect(desk).toHaveBeenCalledTimes(1);
    expect(stacks).toHaveBeenCalledTimes(1);
  });

  it('a page whose chunk is already in draws at once, with no empty page first', async () => {
    const ready = lazyPage(() => Promise.resolve(() => <main aria-label="Ready">Here</main>));
    await ready.preload();
    render(<PageSlot at="ready"><ready.Component /></PageSlot>);
    expect(screen.getByRole('main', { name: 'Ready' })).toHaveTextContent('Here');
    expect(screen.queryByRole('main', { name: 'Opening the page' })).toBeNull();
  });
});
