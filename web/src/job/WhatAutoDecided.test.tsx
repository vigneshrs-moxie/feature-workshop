// What Auto decided: a button where Auto has run, and the panel it opens. Invented jobs only.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import type { AutoDecided } from '../api/types';
import { createStore, WorkshopContext } from '../state/store';
import { WhatAutoDecided, AUTO_EMPTY } from './WhatAutoDecided';

const DECIDED: AutoDecided = {
  on: true, stopped: null, tag: null,
  summary: ['2 steps approved for you.', '3 questions answered with the recommendation.', 'Nothing stopped it so far.'],
  entries: [
    { at: '2026-11-10T09:00:00Z', stage: 'Spec', chose: 'Approved the spec', asked: 'Approve the spec?', why: 'It matches the ticket.' },
    { at: '2026-11-10T11:00:00Z', stage: 'Plan', chose: 'Approved the plan', asked: 'Approve the plan?', why: 'Small and reversible.', risk: 'Touches one table', answers: [{ question: 'Keep the old column?', choice: 'Yes', reason: 'Recommended' }] },
  ],
};

function show(get: ReturnType<typeof vi.fn>, auto: { on: boolean; ran?: boolean } | undefined = { on: true, ran: true }) {
  const api = { get, post: vi.fn() } as unknown as ApiClient;
  return render(<WorkshopContext.Provider value={{ store: createStore(), api }}><WhatAutoDecided slug="alpha" auto={auto} /></WorkshopContext.Provider>);
}

describe('WhatAutoDecided', () => {
  it('is only there when Auto has run on the job', () => {
    show(vi.fn(), { on: false, ran: false });
    expect(screen.queryByRole('button', { name: 'What Auto decided' })).toBeNull();
  });

  it('What Auto decided shows the summary and entries newest first', async () => {
    const get = vi.fn(async () => DECIDED);
    show(get);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    expect(get).toHaveBeenCalledWith('/api/job/alpha/auto');
    const panel = screen.getByRole('dialog', { name: 'What Auto decided' });
    for (const l of DECIDED.summary) expect(within(panel).getByText(l)).toBeInTheDocument();
    const entries = within(panel).getAllByRole('listitem').filter((li) => li.classList.contains('auto-entry'));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('Plan');
    expect(entries[0]).toHaveTextContent('Approved the plan');
    expect(entries[0]).toHaveTextContent('Approve the plan?');
    expect(entries[0]).toHaveTextContent('Small and reversible.');
    expect(entries[0]).toHaveTextContent('Touches one table');
    expect(entries[0]).toHaveTextContent('Keep the old column?');
    expect(entries[1]).toHaveTextContent('Spec');
  });

  // m8: each entry reads with labels and "ago", not bare words.
  it('each entry says Why: and Risk: and how long ago', async () => {
    const at = new Date(Date.now() - 14 * 60_000).toISOString();
    show(vi.fn(async () => ({ ...DECIDED, entries: [{ at, stage: 'Review', chose: 'Allowed', asked: 'Run a command in the terminal', why: 'An ordinary step of this job.', risk: 'low' }] })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    const panel = screen.getByRole('dialog', { name: 'What Auto decided' });
    const entry = within(panel).getAllByRole('listitem').find((li) => li.classList.contains('auto-entry'))!;
    expect(within(entry).getByText('Why: An ordinary step of this job.')).toBeInTheDocument();
    expect(within(entry).getByText('Risk: low')).toBeInTheDocument();
    expect(within(entry).getByText('14m ago')).toBeInTheDocument();
  });

  it('an entry with an unreadable time keeps the order it was given in', async () => {
    const entries = [
      { at: 'not a time', stage: 'Build', chose: 'First', asked: 'a', why: 'w' },
      { at: '2026-11-10T09:00:00Z', stage: 'Spec', chose: 'Second', asked: 'a', why: 'w' },
      { at: '2026-11-10T11:00:00Z', stage: 'Plan', chose: 'Third', asked: 'a', why: 'w' },
    ];
    show(vi.fn(async () => ({ ...DECIDED, entries })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    const panel = screen.getByRole('dialog', { name: 'What Auto decided' });
    const items = within(panel).getAllByRole('listitem').filter((li) => li.classList.contains('auto-entry'));
    expect(items.map((li) => li.querySelector('strong')?.textContent)).toEqual(['First', 'Second', 'Third']);
  });

  it('says it has decided nothing yet when there are no entries', async () => {
    show(vi.fn(async () => ({ ...DECIDED, summary: ['', '', ''], entries: [] })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    expect(screen.getByText('Auto hasn\'t decided anything on this job yet.')).toBeInTheDocument();
    expect(AUTO_EMPTY).toBe('Auto hasn\'t decided anything on this job yet.');
  });

  it('L6: with no entries yet, the summary lines still show: a stop on the first gate says so', async () => {
    const summary = ['Auto made 0 decisions on this job. The Approver cost $0.00.', 'Auto stopped: the plan adds a migration.', 'No decisions yet.'];
    show(vi.fn(async () => ({ ...DECIDED, stopped: null, summary, entries: [] })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    const panel = screen.getByRole('dialog', { name: 'What Auto decided' });
    expect(within(panel).getByText('Auto stopped: the plan adds a migration.')).toBeInTheDocument();
    expect(within(panel).queryByText(AUTO_EMPTY)).toBeNull();
  });

  it('a 404 or an error shows the empty line, not a crash', async () => {
    for (const err of [new ApiError(404, 'Not found'), new Error('boom')]) {
      const { unmount } = show(vi.fn(async () => { throw err; }));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
      expect(screen.getByText(AUTO_EMPTY)).toBeInTheDocument();
      unmount();
    }
  });

  it('closes with Escape', async () => {
    show(vi.fn(async () => DECIDED));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes with Escape pressed from inside the panel, where the focus is', async () => {
    show(vi.fn(async () => DECIDED));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing the panel gives focus back to its button', async () => {
    show(vi.fn(async () => DECIDED));
    const button = screen.getByRole('button', { name: 'What Auto decided' });
    act(() => button.focus());
    await act(async () => { fireEvent.click(button); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('keeps all three summary lines, even two that are the same', async () => {
    const same = 'Nothing stopped it.';
    show(vi.fn(async () => ({ ...DECIDED, summary: [same, same, ''] })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    const lines = screen.getByRole('dialog').querySelectorAll('.auto-summary li');
    expect([...lines].map((l) => l.textContent)).toEqual([same, same, '']);
  });

  // Task 9: each entry with its step as a chip and what it chose as a chip; the foot.
  const panelEntries = () => within(screen.getByRole('dialog', { name: 'What Auto decided' })).getAllByRole('listitem').filter((li) => li.classList.contains('auto-entry'));
  const FOOT_2 = 'The same decisions show in Copy decisions, marked (Auto).';

  it('each entry says when, which step, what was asked, what it chose and why', async () => {
    const at = new Date(Date.now() - 14 * 60_000).toISOString();
    const older = new Date(Date.now() - 30 * 60_000).toISOString();
    show(vi.fn(async () => ({ ...DECIDED, entries: [
      { at, stage: 'Plan', chose: 'Went ahead', asked: 'Approve plan v1 and start Build?', why: 'Small and reversible.', kind: 'approve', stop: 'plan' },
      // From an older laptop: no kind, no step. It draws as before: no step chip, the done look.
      { at: older, stage: 'Spec', chose: 'Approved the spec', asked: 'Approve the spec?', why: 'It matches the ticket.' },
    ] })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    const [entry, old] = panelEntries();
    expect(within(entry).getByText('14m ago')).toBeInTheDocument();
    const step = within(entry).getByText('Plan');
    expect(step.closest('.chip')).not.toBeNull();
    expect(within(entry).getByText('Asked: Approve plan v1 and start Build?')).toBeInTheDocument();
    expect(within(entry).getByText(/^Chose:/)).toBeInTheDocument();
    const chose = within(entry).getByText('Went ahead').closest('.chip')!;
    expect(chose).toHaveClass('chip-ok');
    expect(within(entry).getByText('Why: Small and reversible.')).toBeInTheDocument();
    // The older entry.
    expect(old).toHaveTextContent('Spec');
    expect(within(old).getByText('Spec').closest('.chip')).toBeNull();
    expect(within(old).getByText('Approved the spec').closest('.chip')).toHaveClass('chip-ok');
    expect(within(old).getByText('Why: It matches the ticket.')).toBeInTheDocument();
  });

  it('a stop entry’s Chose chip has the stop look', async () => {
    const reason = 'The plan adds a notes column to the visit list query. A database change always waits for you.';
    show(vi.fn(async () => ({ ...DECIDED, entries: [{ at: '2026-11-10T10:05:00Z', stage: 'Plan', chose: reason, asked: '', why: reason, kind: 'stop', stop: 'plan' }] })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    const [entry] = panelEntries();
    const chip = within(entry).getByText('Stopped').closest('.chip')!;
    expect(chip).toHaveClass('chip-needs-you');
    expect(chip).not.toHaveClass('chip-ok');
    expect(within(entry).getByText(`Why: ${reason}`)).toBeInTheDocument();
    // The reason once, never twice in one entry.
    expect(entry.textContent!.split(reason)).toHaveLength(2);
    // The summary lines stay as the server sends them.
    for (const l of DECIDED.summary) expect(screen.getByText(l)).toBeInTheDocument();
  });

  it('a job a tag started says so at the foot', async () => {
    // Built in the viewer's own time zone, so the words are the same wherever the test runs.
    const startedAt = new Date(2026, 10, 10, 9, 14).toISOString();
    show(vi.fn(async () => ({ ...DECIDED, tag: 'auto', startedAt, ticket: 'ORBIT-907' })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    const panel = screen.getByRole('dialog', { name: 'What Auto decided' });
    expect(within(panel).getByText(`Started by Auto on Nov 10 at 9:14 am: ORBIT-907 carries the tag auto. ${FOOT_2}`)).toBeInTheDocument();
  });

  it('with no start time the foot has only the second sentence', async () => {
    // An older laptop's record: no startedAt, no ticket.
    const { unmount } = show(vi.fn(async () => ({ ...DECIDED, tag: 'auto' })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    expect(within(screen.getByRole('dialog', { name: 'What Auto decided' })).getByText(FOOT_2)).toBeInTheDocument();
    expect(screen.queryByText(/Started by Auto on/)).toBeNull();
    unmount();
    // A start time and a ticket, but no tag known: still only the second sentence.
    show(vi.fn(async () => ({ ...DECIDED, tag: null, startedAt: '2026-11-10T09:14:00Z', ticket: 'ORBIT-907' })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    expect(screen.getByText(FOOT_2)).toBeInTheDocument();
    expect(screen.queryByText(/Started by Auto on/)).toBeNull();
  });

  it('a click or key inside the button and panel does not reach what holds them', async () => {
    const outer = vi.fn();
    const api = { get: vi.fn(async () => DECIDED), post: vi.fn() } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store: createStore(), api }}><div onClick={outer} onKeyDown={outer}><WhatAutoDecided slug="alpha" auto={{ ran: true }} /></div></WorkshopContext.Provider>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'What Auto decided' })); });
    fireEvent.click(screen.getByText('2 steps approved for you.'));
    fireEvent.keyDown(screen.getByText('2 steps approved for you.'), { key: ' ' });
    fireEvent.click(document.querySelector('.sheet-backdrop')!);
    expect(outer).not.toHaveBeenCalled();
  });
});
