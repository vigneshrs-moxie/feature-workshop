// The phone's own three screens (Task 15): the job screen's order, screens by address, and the back
// rows following history. On the made-up long job, at 390 px.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyListener, resetChord } from '../../app/keyRegistry';
import { forgetRecentPages } from '../recent';
import { afterHistory, openAt, page, payload, resizeTo, settle, SLUG, stepRow, windowWidth } from '../fixtures/phonePage';
import { phoneScreenOf } from './PhoneJob2';

let offKeys: () => void = () => {};
beforeEach(() => { windowWidth(390); forgetRecentPages(); offKeys = installKeyListener(); resetChord(); });
afterEach(() => { offKeys(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const reader = () => document.querySelector<HTMLElement>('.jp2-reader')!;

describe('phoneScreenOf', () => {
  it('names the screen from the address: a step is its screen, a reader address or a view the reader, else the job', () => {
    expect(phoneScreenOf(undefined, undefined, undefined)).toBe('job');
    expect(phoneScreenOf('plan', undefined, undefined)).toBe('step');
    expect(phoneScreenOf(undefined, 'conversation', undefined)).toBe('reader');
    expect(phoneScreenOf(undefined, 'overview', undefined)).toBe('reader');
    expect(phoneScreenOf(undefined, undefined, { kind: 'doc', id: 'spec' })).toBe('reader');
  });
});

describe('the job screen', () => {
  it('top to bottom: back to Jobs, the title, the state word, Your move in full, the steps, the job rows; the message box below the scroll area', async () => {
    openAt(`#/job/${SLUG}`);
    await settle();
    expect(page()).toHaveAttribute('data-layout', 'phone');
    expect(page()).toHaveAttribute('data-screen', 'job');
    const scroll = document.querySelector('.jp2-left > .jp2-lscroll')!;
    const parts = [
      within(page()).getByRole('link', { name: 'Jobs' }),
      within(page()).getByRole('heading', { level: 1, name: 'Crew schedule export' }),
      page().querySelector('.jp2-state')!,
      page().querySelector('.jp2-ym')!,
      within(page()).getByRole('navigation', { name: 'Steps' }),
      within(page()).getByRole('group', { name: 'The job' }),
    ];
    for (const p of parts) expect(scroll).toContainElement(p as HTMLElement);
    for (let i = 1; i < parts.length; i++) expect(before(parts[i - 1], parts[i])).toBe(true);
    // The header scrolls with the screen: nothing of it stays above the panes.
    expect(document.querySelector('.jp2 > .jp2-head')).toBeNull();
    // The box comes after the scroll area (the asks row between them, Task 19), so it never lies over the last row.
    const box = screen.getByRole('textbox', { name: 'Message to the Foreman' });
    expect(scroll.nextElementSibling).toHaveClass('jp2-asks');
    expect(scroll.nextElementSibling!.nextElementSibling).toContainElement(box);
    expect(scroll).not.toContainElement(box);
    // The reader is not on this screen.
    expect(reader()).toHaveAttribute('aria-hidden', 'true');
  });

  it('Your move is in full: the whole ask, no More', async () => {
    openAt(`#/job/${SLUG}`);
    await settle();
    const ask = document.querySelector('.jp2-card-ask')!;
    expect(ask).toHaveClass('is-whole');
    expect(within(page()).queryByRole('button', { name: 'More' })).toBeNull();
    expect(within(page()).getByRole('button', { name: /^Go · all recommended/ })).toBeInTheDocument();
  });

  it('the seven steps are one line each, each opening its own screen: no outputs listed under the current one', async () => {
    openAt(`#/job/${SLUG}`);
    await settle();
    const rows = within(screen.getByRole('navigation', { name: 'Steps' })).getAllByRole('button');
    expect(rows).toHaveLength(7);
    expect(document.querySelector('.jp2-st-outs')).toBeNull();
    for (const r of rows) {
      expect(r).not.toHaveAttribute('aria-expanded');
      expect(r.querySelector('.jp2-chev')).not.toBeNull();
    }
    expect(stepRow('Plan')).toHaveTextContent('v2');
  });
});

describe('screens by address, the back rows following history', () => {
  it('a step opens its screen and a row there the reader, each a new history entry; Back walks back through them', async () => {
    openAt(`#/job/${SLUG}`);
    await settle();
    const start = window.history.length;
    const plan = stepRow('Plan');
    plan.focus();
    fireEvent.click(plan);
    await settle();
    expect(window.location.hash).toBe(`#/job/${SLUG}/stage/plan`);
    expect(window.history.length).toBe(start + 1);
    expect(page()).toHaveAttribute('data-screen', 'step');
    const step = screen.getByRole('region', { name: 'Step' });
    expect(within(step).getByRole('heading', { level: 2, name: 'Plan' })).toBeInTheDocument();
    // The job screen is behind it, out of reach.
    expect(document.querySelector('.jp2-left')).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(within(step).getByRole('button', { name: /^Test plan/ }));
    await settle();
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/doc/${encodeURIComponent('test-plan.md')}`);
    expect(window.history.length).toBe(start + 2);
    expect(page()).toHaveAttribute('data-screen', 'reader');
    expect(reader()).not.toHaveAttribute('aria-hidden');
    expect(within(reader()).getByRole('heading', { level: 2 })).toHaveTextContent(/Test plan/);

    const at = window.location.hash;
    fireEvent.click(within(reader()).getByRole('button', { name: 'Back' }));
    await afterHistory(at);
    expect(window.location.hash).toBe(`#/job/${SLUG}/stage/plan`);
    expect(page()).toHaveAttribute('data-screen', 'step');

    const at2 = window.location.hash;
    fireEvent.click(within(screen.getByRole('region', { name: 'Step' })).getByRole('button', { name: /^Back to the job/ }));
    await afterHistory(at2);
    expect(window.location.hash).toBe(`#/job/${SLUG}`);
    expect(page()).toHaveAttribute('data-screen', 'job');
    expect(screen.queryByRole('region', { name: 'Step' })).toBeNull();
    // The focus is back on the step that opened the screens.
    expect(document.activeElement).toBe(stepRow('Plan'));
  });

  it('opened at a reader address with nothing behind it, Back goes to the job screen in place', async () => {
    openAt(`#/job/${SLUG}/conversation`);
    await settle();
    expect(page()).toHaveAttribute('data-screen', 'reader');
    const start = window.history.length;
    fireEvent.click(within(reader()).getByRole('button', { name: 'Back' }));
    await settle();
    expect(window.location.hash).toBe(`#/job/${SLUG}`);
    expect(window.history.length).toBe(start);
    expect(page()).toHaveAttribute('data-screen', 'job');
  });

  it('a job row opens the reader screen; a pick inside the reader changes the address in place', async () => {
    openAt(`#/job/${SLUG}`);
    await settle();
    const start = window.history.length;
    fireEvent.click(screen.getByRole('button', { name: 'Ticket and goal' }));
    await settle();
    expect(page()).toHaveAttribute('data-screen', 'reader');
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/ticket/ticket`);
    expect(window.history.length).toBe(start + 1);
    // g c inside the reader: the conversation, in the same entry.
    fireEvent.keyDown(reader(), { key: 'g' });
    fireEvent.keyDown(reader(), { key: 'c' });
    await settle();
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/conversation/conversation`);
    expect(window.history.length).toBe(start + 1);
    // Back still goes to where the reader was opened from.
    const at = window.location.hash;
    fireEvent.click(within(reader()).getByRole('button', { name: 'Back' }));
    await afterHistory(at);
    expect(window.location.hash).toBe(`#/job/${SLUG}`);
    expect(page()).toHaveAttribute('data-screen', 'job');
  });

  it('Escape on the reader screen is its Back', async () => {
    openAt(`#/job/${SLUG}/read/ticket/ticket`);
    await settle();
    fireEvent.keyDown(reader(), { key: 'Escape' });
    await settle();
    expect(window.location.hash).toBe(`#/job/${SLUG}`);
    expect(page()).toHaveAttribute('data-screen', 'job');
  });

  it('wider than a phone the screens go: the step screen becomes the step open on the left, its output in the reader', async () => {
    openAt(`#/job/${SLUG}/stage/plan`);
    await settle();
    expect(page()).toHaveAttribute('data-screen', 'step');
    resizeTo(1512);
    expect(page()).toHaveAttribute('data-layout', 'wide');
    expect(page()).not.toHaveAttribute('data-screen');
    expect(screen.queryByRole('region', { name: 'Step' })).toBeNull();
    expect(document.querySelector('.jp2-left')).not.toHaveAttribute('aria-hidden');
    expect(within(reader()).getByRole('heading', { level: 2 })).toHaveTextContent(/Implementation plan/);
    // And back to the phone: the step's screen again.
    resizeTo(390);
    expect(page()).toHaveAttribute('data-screen', 'step');
  });
});

describe('Task 15 fix round 1', () => {
  const left = () => document.querySelector('.jp2-left')!;

  it('a document open on the phone stays open when the phone turns sideways (760 to 1100 px), and comes back as the reader screen', async () => {
    openAt(`#/job/${SLUG}`);
    await settle();
    fireEvent.click(stepRow('Plan'));
    await settle();
    fireEvent.click(within(screen.getByRole('region', { name: 'Step' })).getByRole('button', { name: /^Test plan/ }));
    await settle();
    expect(page()).toHaveAttribute('data-screen', 'reader');
    resizeTo(900);
    expect(page()).toHaveAttribute('data-layout', 'mid');
    expect(page()).toHaveAttribute('data-covered');
    expect(reader()).not.toHaveAttribute('aria-hidden');
    expect(within(reader()).getByRole('heading', { level: 2 })).toHaveTextContent(/Test plan/);
    resizeTo(390);
    expect(page()).toHaveAttribute('data-screen', 'reader');
    expect(reader()).not.toHaveAttribute('aria-hidden');
  });

  it('after Back in place to the job screen, turning sideways shows the left pane, not the reader over it', async () => {
    openAt(`#/job/${SLUG}/conversation`);
    await settle();
    fireEvent.click(within(reader()).getByRole('button', { name: 'Back' }));
    await settle();
    expect(window.location.hash).toBe(`#/job/${SLUG}`);
    resizeTo(900);
    expect(page()).not.toHaveAttribute('data-covered');
    expect(reader()).toHaveAttribute('aria-hidden', 'true');
    expect(left()).not.toHaveAttribute('aria-hidden');
    resizeTo(390);
    expect(page()).toHaveAttribute('data-screen', 'job');
  });

  it('a fast double tap, before the page has drawn the new screen, adds one history entry', async () => {
    openAt(`#/job/${SLUG}`);
    await settle();
    const start = window.history.length;
    const ticket = screen.getByRole('button', { name: 'Ticket and goal' });
    const plan = stepRow('Plan');
    act(() => { plan.click(); ticket.click(); });
    await settle();
    expect(window.history.length).toBe(start + 1);
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/ticket/ticket`);
  });
});

describe('Phase 2 fixes: the cover follows the address between 760 and 1100 px', () => {
  it('an address changed while the page is open (a link, a typed address) puts its reader target over the left pane', async () => {
    windowWidth(900);
    openAt(`#/job/${SLUG}/stage/review`);
    await settle();
    expect(page()).toHaveAttribute('data-layout', 'mid');
    expect(page()).not.toHaveAttribute('data-covered');
    await act(async () => { window.location.hash = `#/job/${SLUG}/conversation`; await new Promise((r) => setTimeout(r, 0)); });
    await settle();
    expect(page()).toHaveAttribute('data-covered');
    expect(reader()).not.toHaveAttribute('aria-hidden');
    expect(within(reader()).getByRole('heading', { level: 2 })).toHaveTextContent('Conversation');
  });

  it('Back to the job writes the job’s address, so narrowing to a phone shows the job screen', async () => {
    windowWidth(900);
    openAt(`#/job/${SLUG}`);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Ticket and goal' }));
    expect(page()).toHaveAttribute('data-covered');
    fireEvent.click(within(reader()).getByRole('button', { name: 'Back to the job' }));
    await settle();
    expect(window.location.hash).toBe(`#/job/${SLUG}`);
    expect(page()).not.toHaveAttribute('data-covered');
    resizeTo(390);
    expect(page()).toHaveAttribute('data-screen', 'job');
    expect(reader()).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Task 21: the phone’s PR line', () => {
  it('ends in `Comments · 3 new` under the steps, and opens the PR view', async () => {
    const withComments = () => {
      const p = payload();
      p.prs = [
        { n: 1, number: 247, url: null, title: null, state: 'open', word: 'open · checks passed', at: null, next: null, why: null, comments: { fresh: 3, total: 4, fixed: 0, failing: 0, v: 'v1' } },
        { n: 2, number: null, url: null, title: null, state: 'not-started', word: 'not open', at: null, next: null, why: null, comments: null },
        { n: 3, number: null, url: null, title: null, state: 'not-started', word: 'not open', at: null, next: null, why: null, comments: null },
      ];
      return p;
    };
    openAt(`#/job/${SLUG}`, withComments);
    await settle();
    const line = await screen.findByRole('button', { name: /^PR #1/ });
    expect(line.textContent).toBe('PR #1open · checks passedComments · 3 new');
    expect(line.querySelector('.jp2-prl-c')!.textContent).toBe('Comments · 3 new');
    expect(before(document.querySelector('.jp2-st')!, line)).toBe(true);
    expect(screen.queryByRole('button', { name: /^PR #2/ })).toBeNull();
    fireEvent.click(line);
    await afterHistory(`#/job/${SLUG}`);
    expect(window.location.hash).toBe(`#/job/${SLUG}/read/pr/1`);
    expect(page()).toHaveAttribute('data-screen', 'reader');
  });
});
