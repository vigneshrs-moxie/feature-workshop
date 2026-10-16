import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Achievement, PlayMode, QuestDone } from '../api/types';
import { createStore, WorkshopContext, type Store } from '../state/store';
import { ev, job, snapshot } from '../state/test-fixtures';
import { burstPieces, celebrate } from './celebrate';
import { MAX_VISIBLE, PlayToasts, TOAST_MS, toastOf } from './PlayToasts';
import { playBlip } from './sound';

vi.mock('./sound', () => ({ playBlip: vi.fn(() => true), hasInteracted: vi.fn(() => true) }));

const ach = (id: string, name: string, extra: Partial<Achievement> = {}): Achievement => ({ id, name, howTo: `How to get ${name}.`, secret: false, unlockedAt: '2026-10-16T10:00:00.000Z', ...extra });
const quest = (slug: string, extra: Partial<QuestDone> = {}): QuestDone => ({ slug, doneAt: '2026-10-16T10:00:00.000Z', kind: 'feature', level: 2, rule: 'first-pr', ...extra });

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q.includes('reduce'), media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
}

function setup({ mode = 'subtle', sounds = false }: { mode?: PlayMode; sounds?: boolean } = {}) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'done', { title: 'Alpha feature' })], meta: { token: 't', settings: { policy: 'hands-off', play: { mode, questDone: 'first-pr', sounds } } } }) });
  render(<WorkshopContext.Provider value={{ store, api: {} as ApiClient }}><PlayToasts /></WorkshopContext.Provider>);
  let seq = 10;
  const news = (data: object) => act(() => { store.dispatch({ type: 'event', event: ev(++seq, 'play', null, data) }); });
  return { store, news };
}

const region = () => document.querySelector('.play-toasts') as HTMLElement;
const toasts = () => [...document.querySelectorAll('.play-toast')] as HTMLElement[];

beforeEach(() => { vi.useFakeTimers(); reducedMotion(false); vi.mocked(playBlip).mockClear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('play toasts', () => {
  it('sits in the bottom-right corner (over the Preview pane) as a polite live region, there before anything arrives', () => {
    setup();
    expect(region()).toBeInTheDocument();
    expect(region()).toHaveClass('play-toasts', 'at-bottom-end');
    expect(region()).toHaveAttribute('aria-live', 'polite');
    expect(region()).toBeEmptyDOMElement();
    // Never inside the middle pane's cards or composer.
    expect(region().closest('.composer, .perm-card, .gate-card, .pane-foreman')).toBeNull();
  });

  it('an achievement unlocked: the badge, the name and one line on how it was earned', () => {
    const { news } = setup();
    news({ achievement: ach('first-quest', 'First Quest', { howTo: 'Finish your first quest.' }) });
    const [t] = toasts();
    expect(t).toHaveTextContent('Achievement unlocked');
    expect(t).toHaveTextContent('First Quest');
    expect(t).toHaveTextContent('Finish your first quest.');
    expect(t.querySelector('svg.ach-medal')).toHaveAttribute('aria-hidden', 'true');
    expect(within(region()).getByRole('button', { name: 'Dismiss: First Quest' })).toBeInTheDocument();
  });

  it('a quest done: the job’s title and how it counted; a secret says it was found', () => {
    const { news } = setup();
    news({ quest: quest('alpha', { level: 3 }) });
    news({ quest: quest('gone-job', { kind: 'bug', level: null, rule: 'marked-done' }) });
    news({ achievement: ach('secret-teapot', 'Short and Stout', { secret: true, howTo: 'Found the teapot.' }) });
    const [a, b, c] = toasts();
    expect(a).toHaveClass('is-quest');
    expect(a).toHaveTextContent('Quest done');
    expect(a).toHaveTextContent('Alpha feature');
    expect(a).toHaveTextContent('L3 feature: its first PR was created.');
    expect(b).toHaveTextContent('gone-job');
    expect(b).toHaveTextContent('Bug fix: you marked it done.');
    expect(c).toHaveClass('is-secret');
    expect(c).toHaveTextContent('Secret found');
    expect(toastOf({ seq: 1 }, () => undefined)).toBeNull();
  });

  it('queues: at most three at once, the rest wait and step up as one goes', () => {
    const { news } = setup();
    for (let i = 1; i <= 5; i++) news({ achievement: ach(`a${i}`, `Award ${i}`) });
    expect(toasts()).toHaveLength(MAX_VISIBLE);
    expect(region()).toHaveTextContent('2 more');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Award 1' }));
    expect(toasts()).toHaveLength(3);
    expect(toasts().map((t) => t.querySelector('.play-toast-name')!.textContent)).toEqual(['Award 2', 'Award 3', 'Award 4']);
    expect(region()).toHaveTextContent('1 more');
  });

  it('goes by itself after about five seconds, but not while you point at it', () => {
    const { news } = setup();
    news({ achievement: ach('first-quest', 'First Quest') });
    act(() => { vi.advanceTimersByTime(TOAST_MS - 100); });
    expect(toasts()).toHaveLength(1);
    fireEvent.mouseEnter(toasts()[0]);
    act(() => { vi.advanceTimersByTime(TOAST_MS * 2); });
    expect(toasts()).toHaveLength(1);
    fireEvent.mouseLeave(toasts()[0]);
    act(() => { vi.advanceTimersByTime(TOAST_MS); });
    expect(toasts()).toHaveLength(0);
    expect(TOAST_MS).toBeGreaterThanOrEqual(4000);
    expect(TOAST_MS).toBeLessThanOrEqual(6000);
  });

  it('never toasts what was already in the page when it mounted, nor a play event with nothing in it', () => {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings: { policy: 'hands-off' } } }) });
    act(() => { store.dispatch({ type: 'event', event: ev(11, 'play', null, { achievement: ach('first-quest', 'First Quest') }) }); });
    render(<WorkshopContext.Provider value={{ store, api: {} as ApiClient }}><PlayToasts /></WorkshopContext.Provider>);
    expect(toasts()).toHaveLength(0);
    act(() => { store.dispatch({ type: 'event', event: ev(12, 'play', null, {}) }); });
    expect(toasts()).toHaveLength(0);
  });

  it('Play Off: nothing at all', () => {
    const { news } = setup({ mode: 'off' });
    news({ achievement: ach('first-quest', 'First Quest') });
    expect(region()).toBeNull();
  });
});

describe('celebrations', () => {
  it('Subtle: a plain toast, no burst and no sound, even with sounds on', () => {
    const { news } = setup({ mode: 'subtle', sounds: true });
    news({ quest: quest('alpha') });
    expect(toasts()[0]).not.toHaveClass('has-burst');
    expect(document.querySelector('.play-burst')).toBeNull();
    expect(playBlip).not.toHaveBeenCalled();
  });

  it('Full: a small burst around the badge; no sound unless Sounds is on', () => {
    const { news } = setup({ mode: 'full', sounds: false });
    news({ quest: quest('alpha') });
    expect(toasts()[0]).toHaveClass('has-burst');
    const burst = document.querySelector('.play-burst')!;
    expect(burst).toHaveAttribute('aria-hidden', 'true');
    expect(burst).toHaveClass('burst-quest');
    expect(burst.querySelectorAll('.play-burst-piece').length).toBeGreaterThan(0);
    expect(playBlip).not.toHaveBeenCalled();
  });

  it('Full with Sounds on: the kind’s blip, once per toast as it shows', () => {
    const { news } = setup({ mode: 'full', sounds: true });
    news({ quest: quest('alpha') });
    news({ achievement: ach('first-quest', 'First Quest') });
    expect(vi.mocked(playBlip).mock.calls).toEqual([['quest'], ['achievement']]);
  });

  it('Full under reduced motion: no burst (the words stay)', () => {
    reducedMotion(true);
    const { news } = setup({ mode: 'full' });
    news({ achievement: ach('first-quest', 'First Quest') });
    expect(toasts()[0]).toHaveTextContent('First Quest');
    expect(document.querySelector('.play-burst')).toBeNull();
  });

  it('celebrate(kind) decides from the settings alone', () => {
    const base = { on: true, full: false, reducedMotion: false, sounds: false };
    expect(celebrate('quest', base)).toEqual({ kind: 'quest', burst: false, pieces: 0, sound: false });
    expect(celebrate('quest', { ...base, full: true })).toMatchObject({ burst: true, sound: false });
    expect(celebrate('quest', { ...base, full: true }).pieces).toBeGreaterThan(celebrate('achievement', { ...base, full: true }).pieces);
    expect(celebrate('achievement', { ...base, full: true, sounds: true })).toMatchObject({ burst: true, sound: true });
    expect(celebrate('boss', { ...base, full: true, reducedMotion: true, sounds: true })).toMatchObject({ burst: false, pieces: 0, sound: true });
    expect(celebrate('quest', { ...base, sounds: true })).toMatchObject({ sound: false });
    expect(celebrate('quest', { ...base, on: false, full: true, sounds: true })).toMatchObject({ burst: false, sound: false });
    const pieces = burstPieces(8);
    expect(pieces).toHaveLength(8);
    expect(Math.max(...pieces.map((p) => p.delay))).toBeLessThanOrEqual(200);
  });
});
