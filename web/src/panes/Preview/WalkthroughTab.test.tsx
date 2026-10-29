// The review walkthrough (WalkthroughTab.tsx, folded under the Job page's Review tab when the job's branch has one): framed
// from the screens server's origin, with the published link when there is one. Invented jobs only.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job } from '../../api/types';
import { UiProvider } from '../../app/ui';
import { createStore, WorkshopContext } from '../../state/store';
import { job, SCREENS_ORIGIN, snapshot } from '../../state/test-fixtures';
import { WalkthroughTab } from './WalkthroughTab';

const WALK = { updatedAt: new Date().toISOString(), size: 10, url: 'https://claude.ai/code/artifact/abc' };

function setup(extra: Partial<Job>) {
  const store = createStore();
  const alpha = job('alpha', 'needs-you', extra);
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', wireframesOrigin: SCREENS_ORIGIN }, jobs: [alpha] }) });
  const api = { get: vi.fn(async () => ({ docs: [] })), post: vi.fn() } as unknown as ApiClient;
  return render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><WalkthroughTab slug="alpha" job={alpha} active /></UiProvider></WorkshopContext.Provider>);
}

describe('Walkthrough tab', () => {
  it('frames the page from the screens origin, links open outside, and the published page is one click away', () => {
    const { container } = setup({ walkthrough: WALK });
    const frame = container.querySelector('iframe')!;
    expect(frame).toHaveAttribute('src', `${SCREENS_ORIGIN}/job/alpha/walkthrough`);
    expect(frame.getAttribute('sandbox')).toContain('allow-popups');
    expect(screen.getByRole('link', { name: 'Open the published page' })).toHaveAttribute('href', WALK.url);
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', `${SCREENS_ORIGIN}/job/alpha/walkthrough?download=1`);
    expect(screen.queryByText(/isn’t published yet/)).toBeNull();
  });

  it('Copy link puts the published page’s link on the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup({ walkthrough: WALK });
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Link copied.');
    expect(writeText).toHaveBeenCalledWith(WALK.url);
  });

  it('not published: says notes stay in this browser', () => {
    setup({ walkthrough: { ...WALK, url: null } });
    expect(screen.getByText(/isn’t published yet/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open the published page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument();
  });
});
