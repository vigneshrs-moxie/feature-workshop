// The lock on the page (packet M step 6): the lock card shows in the message box and on the gate card
// when the job is held elsewhere (the snapshot's lock) or a send or gate answer comes back refused
// with the lock error; while it shows, the box and the gate's buttons are off, with the reason.
// Invented jobs only.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { Gate, JobDetail, JobLockInfo } from '../../api/types';
import { UiProvider } from '../../app/ui';
import { Composer } from '../../panes/Foreman/Composer';
import { GateSlot } from '../../panes/Foreman/GateCard';
import { createStore, WorkshopContext } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';

const LOCK: JobLockInfo = { owner: 'terminal', pid: 4182, branch: 'feature/orbit-479-x', acquiredAt: new Date().toISOString() };
const GATE: Gate = {
  briefNumber: 2, briefFile: 'briefs/002-plan.md', headline: 'Plan v2 ready', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
  questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: new Date().toISOString(), runActive: false, parked: false,
  level: 1, suggestedLevel: null, levelReason: null, usage: null,
};
const DETAIL = { slug: 'alpha', thread: [], threadMore: false, run: null, gate: GATE, answeredBriefs: [], heldReply: null, options: { level: 1 } } as unknown as JobDetail;

function setup({ lock = null as JobLockInfo | null, post = vi.fn(async (): Promise<unknown> => ({ ok: true })) } = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }] }, jobs: [job('alpha', 'needs-you', { lock, level: 1 })] } as never) });
  const api = { get: vi.fn(), post } as unknown as ApiClient;
  render(
    <WorkshopContext.Provider value={{ store, api }}>
      <UiProvider>
        <GateSlot job={store.getState().jobs[0]} detail={DETAIL} now={new Date()} reload={vi.fn()} />
        <Composer slug="alpha" detail={DETAIL} run={null} />
      </UiProvider>
    </WorkshopContext.Provider>,
  );
  return { post, store };
}

afterEach(() => { cleanup(); localStorage.clear(); });

describe('the lock on the page', () => {
  it('held in a terminal: the card in the message box and on the gate card; the box and the gate’s buttons are off, with why', () => {
    setup({ lock: LOCK });
    const cards = screen.getAllByRole('status', { name: 'Job open elsewhere' });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('This job is open in a terminal (pid 4182');
    expect(cards[0]).toHaveTextContent('feature/orbit-479-x');
    expect(screen.getByRole('textbox', { name: /Your message to the Foreman/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Approve/ })).toBeDisabled();
    expect(screen.getByText('Approve is off:').closest('.gate-off')).toHaveTextContent('Only one place can work on a job at a time');
    expect(document.querySelector('[data-gate="revise"]')).toBeDisabled();
    expect(document.querySelector('[data-gate="guidance"]')).toBeDisabled();
  });

  it('a send refused with the lock error shows the card and turns the box off until you say it’s closed', async () => {
    const post = vi.fn(async () => { throw new ApiError(409, 'This job is open in a terminal.', { code: 'job-locked', lock: LOCK }); });
    setup({ post });
    const box = screen.getByRole('textbox', { name: /Your message to the Foreman/ });
    fireEvent.change(box, { target: { value: 'Go on.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to the Foreman' })); });
    const composer = screen.getByRole('region', { name: 'Message the Foreman' });
    expect(within(composer).getByRole('status', { name: 'Job open elsewhere' })).toHaveTextContent('pid 4182');
    expect(box).toBeDisabled();
    expect(box).toHaveValue('Go on.');
    fireEvent.click(within(composer).getByRole('button', { name: 'It’s closed there now' }));
    expect(within(composer).queryByRole('status', { name: 'Job open elsewhere' })).toBeNull();
    expect(box).not.toBeDisabled();
  });

  it('a gate answer refused with the lock error shows the card on the gate', async () => {
    const post = vi.fn(async () => { throw new ApiError(409, 'This job is open in a terminal.', { code: 'job-locked', lock: LOCK }); });
    setup({ post });
    fireEvent.click(screen.getByRole('button', { name: /^Approve/ }));
    await waitFor(() => expect(screen.getAllByRole('status', { name: 'Job open elsewhere' }).length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /^Approve/ })).toBeDisabled();
  });
});
