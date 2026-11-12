// Watch's live picture (design 3.5): the laptop app's page policy allows pictures only from the
// app itself and data: addresses (img-src 'self' data:), so a blob: address would be refused and
// show a broken image. Each fetched picture is shown from a data: address instead. The rest of
// Watch (its pace, Stop watching, a hidden tab, another job) is tested with the Test step in
// TestStep.test.tsx. No network: fetch is a stub.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WatchPicture } from './WatchPicture';

const SLUG = 'pause-a-service';
const jpeg = (text: string) => new Blob([text], { type: 'image/jpeg' });

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('WatchPicture', () => {
  it('the picture’s address is a data: address, never blob:', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const frames = ['one', 'two'];
    let n = 0;
    const fetch = vi.fn(async () => ({ ok: true, status: 200, blob: async () => jpeg(frames[Math.min(n++, frames.length - 1)]) }));
    vi.stubGlobal('fetch', fetch);
    const made = vi.spyOn(URL, 'createObjectURL');

    const view = render(<WatchPicture slug={SLUG} progress={null} />);
    await act(async () => {});
    const img = screen.getByRole('img', { name: 'The hidden browser, live' });
    expect(img.getAttribute('src')).toBe(`data:image/jpeg;base64,${btoa('one')}`);

    // The next picture replaces it, still a data: address.
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByRole('img').getAttribute('src')).toBe(`data:image/jpeg;base64,${btoa('two')}`);
    expect(made).not.toHaveBeenCalled();
    expect(document.querySelector('img[src^="blob:"]')).toBeNull();

    // A picture with no type still shows (the live picture is a JPEG).
    view.unmount();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(['three']) })));
    render(<WatchPicture slug={SLUG} progress={null} />);
    await act(async () => {});
    expect(screen.getByRole('img').getAttribute('src')).toBe(`data:image/jpeg;base64,${btoa('three')}`);
    expect(made).not.toHaveBeenCalled();
  });

  it('a picture that answers after Watch is turned off is dropped, and no new request starts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    let answer: (v: unknown) => void = () => {};
    const fetch = vi.fn(() => new Promise((r) => { answer = r; }));
    vi.stubGlobal('fetch', fetch);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(<WatchPicture slug={SLUG} progress={null} />);
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    // Stop watching (it unmounts), then the answer lands.
    view.unmount();
    const blob = vi.fn(async () => jpeg('late'));
    await act(async () => { answer({ ok: true, status: 200, blob }); });
    // Its picture is never read, and nothing waits to run: no next ask, no "no picture" timer.
    expect(blob).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(document.querySelector('img')).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it('Watch turned off while a picture is being read sets nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    // The answer is in; reading its picture is held open until the test lets it finish.
    let finish: (b: Blob) => void = () => {};
    const fetch = vi.fn(async () => ({ ok: true, status: 200, blob: () => new Promise<Blob>((r) => { finish = r; }) }));
    vi.stubGlobal('fetch', fetch);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(<WatchPicture slug={SLUG} progress={null} />);
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    // Stop watching mid-read, then the read finishes.
    view.unmount();
    await act(async () => { finish(jpeg('late')); });
    // The read's picture is dropped: nothing waits to run (no next ask, no "no picture" timer).
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(document.querySelector('img')).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });
});
