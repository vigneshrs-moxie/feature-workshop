// The job page's steps row (design 3.2): seven large steps, each with its icon, its name, its state
// in words and how long; one is open, a click asks for another. Invented jobs only.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job, JobPageFacts, StopId } from '../../api/types';
import type { GateKind } from '../../lib/compose';
import { createStore, WorkshopContext } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { StepsRow } from './StepsRow';

const NOW = new Date('2026-11-10T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

const BUILDING: Job = job('pause-a-service', 'running', { stage: 'implement', lane: 'working', working: true, skipped: ['investigate', 'spec-update'] });
const TIMES: JobPageFacts['times'] = {
  spec: { startedAt: ago(300), endedAt: ago(230) },
  plan: { startedAt: ago(230), endedAt: ago(32) },
  build: { startedAt: ago(32), endedAt: null },
};

function setup({ play = 'subtle', hosted = false, open = 'build' as StopId, sent = null as { kind: GateKind | null } | null, j = BUILDING, times = TIMES } = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [j], meta: { token: 't', settings: { play: { mode: play } } } as never }) });
  const api = { get: vi.fn(), post: vi.fn(), ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
  const onOpen = vi.fn();
  const view = render(<WorkshopContext.Provider value={{ store, api }}><StepsRow job={j} times={times} open={open} sent={sent} now={NOW} onOpen={onOpen} /></WorkshopContext.Provider>);
  return { onOpen, api, ...view };
}

const row = () => screen.getByRole('tablist', { name: 'The job’s seven steps' });
const tabs = () => within(row()).getAllByRole('tab');
const tab = (name: string) => within(row()).getByRole('tab', { name: new RegExp(`^${name}`) });

afterEach(() => { cleanup(); });

describe('StepsRow', () => {
  it('seven steps, each with its name, its state in words and how long', () => {
    for (const hosted of [false, true]) {
      const { api } = setup({ hosted });
      expect(row()).toHaveClass('sb-steps');
      expect(tabs().map((t) => t.querySelector('.sb-step-name')?.textContent)).toEqual(['Spec', 'Investigate', 'Plan', 'Build', 'Test', 'Review', 'Ship']);
      for (const t of tabs()) expect(t).toHaveClass('sb-step');
      expect(tab('Spec')).toHaveTextContent('SpecDone1 h 10 min');
      expect(tab('Investigate')).toHaveTextContent('InvestigateSkipped');
      expect(tab('Plan')).toHaveTextContent('PlanDone3 h 18 min');
      expect(tab('Build')).toHaveTextContent('BuildWorking now32 min so far');
      expect(tab('Test')).toHaveTextContent(/^TestNot yet$/);
      expect(tab('Ship')).toHaveTextContent(/^ShipNot yet$/);
      expect(tab('Spec')).toHaveAttribute('title', 'Open Spec here');
      expect(tab('Spec')).toHaveAccessibleName('Spec: Done, 1 h 10 min');
      expect(tab('Test')).toHaveAccessibleName('Test: Not yet');
      expect(tab('Build')).toHaveClass('is-now');
      expect(tab('Spec')).toHaveClass('is-done');
      expect(tab('Build').querySelector('svg')).toHaveAttribute('width', '36');
      expect(api.get).not.toHaveBeenCalled();
      cleanup();
    }
    // An older Starbase: no times at all; every step still has its name and words.
    setup({ times: null });
    expect(tab('Spec')).toHaveTextContent(/^SpecDone$/);
    expect(tab('Build')).toHaveTextContent(/^BuildWorking now$/);
  });

  it('the open one is marked and a click asks for another', () => {
    const { onOpen } = setup({ open: 'plan' });
    expect(tab('Plan')).toHaveClass('is-open');
    expect(tab('Plan')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Plan')).toHaveAttribute('tabindex', '0');
    expect(tab('Build')).not.toHaveClass('is-open');
    expect(tab('Build')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Build')).toHaveAttribute('tabindex', '-1');
    fireEvent.click(tab('Test'));
    expect(onOpen).toHaveBeenLastCalledWith('test');
    // The keyboard: the arrows move along the steps and open the next one.
    tab('Plan').focus();
    fireEvent.keyDown(tab('Plan'), { key: 'ArrowRight' });
    expect(onOpen).toHaveBeenLastCalledWith('build');
    expect(document.activeElement).toBe(tab('Build'));
    fireEvent.keyDown(tab('Plan'), { key: 'ArrowLeft' });
    expect(onOpen).toHaveBeenLastCalledWith('investigate');
    cleanup();
    const first = setup({ open: 'spec' });
    fireEvent.keyDown(tab('Spec'), { key: 'ArrowLeft' });
    expect(first.onOpen).toHaveBeenLastCalledWith('ship');
  });

  it('after your Go the job’s step reads Approved', () => {
    const waiting = job('pause-a-service', 'needs-you', { stage: 'plan', lane: 'needs-you', needsYou: true, waitingSince: ago(65) });
    setup({ j: waiting, open: 'plan', sent: { kind: 'approve' }, times: { plan: { startedAt: ago(200), endedAt: ago(65) } } });
    // How long the step took, never for how long it has waited.
    expect(tab('Plan')).toHaveTextContent(/^PlanApproved2 h 15 min$/);
    expect(tab('Plan')).toHaveAccessibleName('Plan: Approved, 2 h 15 min');
    expect(tab('Plan')).toHaveClass('is-done');
    cleanup();
    setup({ j: waiting, open: 'plan', sent: { kind: 'changes' }, times: { plan: { startedAt: ago(200), endedAt: ago(65) } } });
    expect(tab('Plan')).toHaveTextContent(/^PlanWaiting for youfor 1 h 5 min$/);
    expect(tab('Plan')).toHaveClass('is-wait');
  });

  it('a skipped step and a stopped job’s step have their own classes', () => {
    setup();
    expect(tab('Investigate')).toHaveClass('is-skipped');
    expect(tab('Investigate')).not.toHaveClass('is-stop');
    cleanup();
    const stopped = job('pause-a-service', 'idle', { stage: 'implement', stageState: 'paused', paused: true, lane: 'resting' });
    setup({ j: stopped });
    expect(tab('Build')).toHaveTextContent(/^BuildStopped32 min so far$/);
    expect(tab('Build')).toHaveClass('is-stop');
  });

  it('Play full shows the crew’s faces', () => {
    setup({ play: 'full' });
    expect(row().querySelectorAll('.sb-step svg.crew')).toHaveLength(7);
    expect(tab('Build').querySelector('svg.crew')).toHaveAttribute('width', '36');
    cleanup();
    setup({ play: 'subtle' });
    expect(row().querySelectorAll('svg.crew')).toHaveLength(0);
    expect(row().querySelectorAll('.sb-step-icon svg')).toHaveLength(7);
  });
});
