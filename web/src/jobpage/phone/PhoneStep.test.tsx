// The phone's step screen (Task 15): the step's name, where it stands, and what it made, one row each.
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { forgetRecentPages } from '../recent';
import { openAt, page, settle, SLUG, windowWidth } from '../fixtures/phonePage';

let offKeys: () => void = () => {};
beforeEach(() => { windowWidth(390); forgetRecentPages(); offKeys = installKeyListener(); resetChord(); });
afterEach(() => { offKeys(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

const step = () => screen.getByRole('region', { name: 'Step' });
const rows = () => within(step()).getAllByRole('button').filter((b) => b.classList.contains('jp2-ps-out'));

describe('the step screen', () => {
  it('a done step: its back row names the job, then the step, then Done with how long it took, then each thing it made with its version', async () => {
    openAt(`#/job/${SLUG}/stage/plan`);
    await settle();
    expect(within(step()).getByRole('button', { name: 'Back to the job: ORBIT-905' })).toBeInTheDocument();
    expect(within(step()).getByRole('heading', { level: 2, name: 'Plan' })).toBeInTheDocument();
    expect(step().querySelector('.jp2-ps-state')).toHaveTextContent(/^Done · /);
    expect(rows().map((r) => r.textContent)).toEqual(['Implementation planv2 · 5 steps', 'Test planv2', 'Acceptance criteriav3']);
    for (const r of rows()) expect(r.querySelector('.jp2-chev')).not.toBeNull();
  });

  it('the current step says what it waits for; a row opens that thing on the reader screen', async () => {
    openAt(`#/job/${SLUG}/stage/review`);
    await settle();
    expect(step().querySelector('.jp2-ps-state')).toHaveTextContent(/^Needs you/);
    expect(rows().map((r) => r.querySelector('.jp2-out-label')?.textContent)).toEqual(['Findings', 'Review (combined)']);
    fireEvent.click(rows()[0]);
    await settle();
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/findings/findings`);
    expect(page()).toHaveAttribute('data-screen', 'reader');
  });

  it('a step not reached yet says Not yet', async () => {
    openAt(`#/job/${SLUG}/stage/ship`);
    await settle();
    expect(within(step()).getByRole('heading', { level: 2, name: 'Ship' })).toBeInTheDocument();
    expect(step().querySelector('.jp2-ps-state')).toHaveTextContent(/^Not yet$/);
  });

  it('takes the focus when it opens, so a screen reader starts at the step', async () => {
    openAt(`#/job/${SLUG}`);
    await settle();
    fireEvent.click(document.querySelector('.jp2-st-row')!);
    await settle();
    expect(step()).toContainElement(document.activeElement as HTMLElement);
  });
});
