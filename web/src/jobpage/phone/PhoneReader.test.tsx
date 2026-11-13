// The phone's reader screen (Task 15): one thing, full width, with one back row.
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { forgetRecentPages } from '../recent';
import { openAt, page, resizeTo, settle, SLUG, windowWidth } from '../fixtures/phonePage';

let offKeys: () => void = () => {};
beforeEach(() => { windowWidth(390); forgetRecentPages(); offKeys = installKeyListener(); resetChord(); });
afterEach(() => { offKeys(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

const reader = () => screen.getByRole('region', { name: 'Reader' });

describe('the reader screen', () => {
  it('shows the one thing with a single back row, Back, and takes the focus', async () => {
    openAt(`#/job/${SLUG}/read/ticket/ticket`);
    await settle();
    expect(page()).toHaveAttribute('data-screen', 'reader');
    expect(within(reader()).getByRole('heading', { level: 2 })).toHaveTextContent('Ticket and goal');
    expect(within(reader()).getAllByRole('button', { name: /^Back/ })).toHaveLength(1);
    expect(within(reader()).getByRole('button', { name: 'Back' }).closest('.jp2-pback')).not.toBeNull();
    expect(reader()).toContainElement(document.activeElement as HTMLElement);
  });

  it('between 760 and 1100 px the reader keeps its own back row, Back to the job', async () => {
    openAt(`#/job/${SLUG}/read/ticket/ticket`);
    await settle();
    resizeTo(900);
    expect(within(reader()).getByRole('button', { name: 'Back to the job' })).toBeInTheDocument();
    expect(reader().querySelector('.jp2-pback')).toBeNull();
  });
});
