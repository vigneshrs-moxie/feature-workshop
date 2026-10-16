import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { Job, JobDetail, RulesLevel } from '../../api/types';
import { levelCardKey } from '../../lib/levels';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job, LEVELS, REVIEWERS, snapshot } from '../../state/test-fixtures';
import { LevelCard } from './LevelCard';
import { LevelChip } from './LevelChip';

// Invented job; no real job names.
const RULES: RulesLevel = { level: 2, floor: 0, reasons: ['Not obviously a one-line change, so L2.'], floorReasons: [], triggers: [], fromDiff: false, changedFiles: null };
const MODELS = { foreman: 'claude-opus-5-5', build: 'claude-sonnet-5-5', checks: 'claude-haiku-5-5' };
const OPTIONS = { level: 2 as const, flow: 'small', skip: ['refine'], provided: { plan: '/tmp/fw-test/plan.md' }, notes: 'Keep it small.', review_rounds: 2, manual_test: false, models: MODELS };
// What a level change keeps (as the gate card's level chip does): everything but the level's own stages, reviewers and Fable points.
const KEPT = { provided: { plan: '/tmp/fw-test/plan.md' }, notes: 'Keep it small.', review_rounds: 2, manual_test: false, models: MODELS };
const detail = (extra: Partial<JobDetail> = {}): JobDetail => ({ slug: 'alpha', thread: [], threadMore: false, options: OPTIONS, rulesLevel: RULES, ...extra });

function setup(jobExtra: Partial<Job>, { post = vi.fn(async () => ({ ok: true, options: {}, summary: [] })), det = detail() } = {}) {
  const store: Store = createStore();
  const jobs = [job('alpha', 'needs-you', { rulesLevel: RULES, ...jobExtra })];
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', levels: LEVELS, jobOptions: { reviewers: REVIEWERS } }, jobs }) });
  const api = { get: vi.fn(), post } as unknown as ApiClient;
  const view = (j: Job = store.getState().jobs[0]) => (
    <WorkshopContext.Provider value={{ store, api }}><LevelCard job={j} detail={det} /><LevelChip job={j} options={det.options} /></WorkshopContext.Provider>
  );
  const utils = render(view());
  const setJob = (extra: Partial<Job>) => utils.rerender(view({ ...store.getState().jobs[0], ...extra }));
  return { ...utils, post, store, setJob };
}

const card = () => screen.queryByRole('region', { name: /Foreman suggests|Pick a level|Level changed/ });

afterEach(() => { localStorage.clear(); });

describe('LevelCard', () => {
  it('shows both sources side by side when the Foreman suggests another level, with the consequence', () => {
    setup({ level: 2, suggestedLevel: 3, levelReason: 'It changes who can see which offices.' });
    const c = card()!;
    expect(within(c).getByRole('heading')).toHaveTextContent('The Foreman suggests L3 Large');
    expect(within(c).getByText('Rules')).toBeInTheDocument();
    expect(c).toHaveTextContent('L2 · Not obviously a one-line change, so L2.');
    expect(c).toHaveTextContent('L3 · It changes who can see which offices.');
    expect(c).toHaveTextContent('Chosen: L2 Standard');
    expect(c).toHaveTextContent('If you use L3: L2→L3 adds: product interview, Fable at plan + review, Stickler + Fuse + Mason + Stopwatch + Painter lenses.');
    expect(within(c).getByRole('button', { name: 'Use L3' })).toHaveAttribute('title', expect.stringContaining('from the next stage'));
    expect(within(c).getByRole('button', { name: 'Keep L2' })).toHaveAttribute('title', expect.stringContaining('different level'));
  });

  it('stays hidden when the levels agree, or there is a level and no Foreman suggestion, or the job is closed', () => {
    const { setJob } = setup({ level: 3, suggestedLevel: 3 });
    expect(card()).toBeNull();
    setJob({ level: 1, suggestedLevel: null });
    expect(card()).toBeNull();
    setJob({ level: 1, suggestedLevel: 3, closed: { as: 'done' } });
    expect(card()).toBeNull();
    setJob({ level: 1, suggestedLevel: 3, closed: null });
    expect(card()).not.toBeNull();
  });

  it('Keep hides it for that suggestion only, remembered per job', () => {
    const { setJob } = setup({ level: 2, suggestedLevel: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Keep L2' }));
    expect(card()).toBeNull();
    expect(localStorage.getItem(levelCardKey('alpha'))).toBe('2>3');
    setJob({ level: 2, suggestedLevel: 3 });
    expect(card(), 'still kept').toBeNull();
    setJob({ level: 2, suggestedLevel: 1 });
    expect(card(), 'a different suggestion shows again').not.toBeNull();
  });

  it('with no level yet, offers the Foreman’s and the rules’ levels, and Not now', () => {
    const { setJob } = setup({ level: null, suggestedLevel: 1, levelReason: 'One button.' });
    const c = card()!;
    expect(within(c).getByRole('heading')).toHaveTextContent('Pick a level for this job');
    expect(c).toHaveTextContent('Chosen: none yet');
    expect(within(c).getByRole('button', { name: 'Use L1' })).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Use L2' })).toHaveAttribute('title', expect.stringContaining('as the rules suggest'));
    expect(c).toHaveTextContent('If you use L1: L1 Small runs: plan, tester, review, you test, Head inspector lens.');
    fireEvent.click(within(c).getByRole('button', { name: 'Not now' }));
    expect(card()).toBeNull();
    setJob({ level: null, suggestedLevel: null });
    expect(card(), 'now the rules’ L2 is offered: a new situation').not.toBeNull();
  });

  it('Use posts the job’s options with the new level and says what changed', async () => {
    const { post } = setup({ level: 2, suggestedLevel: 3 });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use L3' })); });
    // The provided documents, notes, fix rounds, manual test and models are kept; the level brings its own stages and reviewers.
    expect(post).toHaveBeenCalledWith('/api/job/alpha/options', { options: { ...KEPT, level: 3 } });
    const c = card()!;
    expect(within(c).getByRole('status')).toHaveTextContent('Level set to L3 Large, from the next stage. L2→L3 adds: product interview, Fable at plan + review, Stickler + Fuse + Mason + Stopwatch + Painter lenses.');
    fireEvent.click(within(c).getByRole('button', { name: 'Got it' }));
  });

  it('shows the dashboard’s refusal', async () => {
    const post = vi.fn(async () => { throw new ApiError(400, 'Plan: there’s no file at /tmp/fw-test/plan.md.'); });
    setup({ level: 2, suggestedLevel: 3 }, { post });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use L3' })); });
    expect(within(card()!).getByRole('alert')).toHaveTextContent('there’s no file at');
  });
});

describe('Level chip (job header)', () => {
  it('shows the level, with what runs and moving up or down in its hint and panel', async () => {
    const { post } = setup({ level: 2, suggestedLevel: 2 });
    const chip = screen.getByRole('button', { name: 'L2 Standard' });
    expect(chip).toHaveAttribute('title', expect.stringContaining('A short spec and plan you approve'));
    expect(chip).toHaveAttribute('title', expect.stringContaining('Up: L2→L3 adds: product interview'));
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(chip);
    const pop = screen.getByRole('dialog', { name: 'This job’s level' });
    expect(pop).toHaveTextContent('Up: L2→L3 adds: product interview, Fable at plan + review, Stickler + Fuse + Mason + Stopwatch + Painter lenses.');
    expect(pop).toHaveTextContent('Down: L2→L1 drops: spec, investigation, spec update, Locksmith + Gauge lenses.');
    expect(within(pop).getByRole('button', { name: '✓ L2 Standard (now)' })).toBeDisabled();
    expect(within(pop).getByRole('button', { name: 'Use L0 Tweak' })).toHaveFocus();
    await act(async () => { fireEvent.click(within(pop).getByRole('button', { name: 'Use L1 Small' })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/options', { options: { ...KEPT, level: 1 } });
    expect(within(pop).getByRole('status')).toHaveTextContent('Level set to L1 Small, from the next stage. L2→L1 drops: spec, investigation, spec update, Locksmith + Gauge lenses.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip).toHaveFocus();
  });

  it('says when there is no level yet', () => {
    setup({ level: null, suggestedLevel: null }, { det: detail({ rulesLevel: null, options: null }) });
    const chip = screen.getByRole('button', { name: 'No level yet' });
    expect(chip).toHaveAttribute('title', expect.stringContaining('the Foreman suggests one in its first brief'));
  });
});
