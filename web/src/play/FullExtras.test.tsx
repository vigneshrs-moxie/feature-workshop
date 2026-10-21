// The Full-mode extras on the page: the trail in the job header (Subtle too, without the stars), the boss fight under an L3
// job's latest review brief, stamina in the top bar and the crew asleep in a usage pause. Nothing
// of it renders in Subtle or Off; with reduced motion everything holds still. Invented jobs only.
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import type { Job, JobDetail, PlayMode, PlayView, ThreadItem, Usage } from '../api/types';
import { LiveRow } from '../panes/Foreman/LiveRow';
import { ForemanPane } from '../panes/Foreman/ForemanPane';
import { createStore, WorkshopContext, type Store } from '../state/store';
import { job, LEVELS, snapshot } from '../state/test-fixtures';
import { CREW_SIZE } from './crewSizes';
import { StaminaBar } from './FullExtras';

const NOW = new Date(2026, 9, 16, 15, 0);
const at = (h: number, m: number) => new Date(2026, 9, 16, h, m).toISOString();

const THREAD: ThreadItem[] = [
  { id: 'brief:briefs/7-review.md', kind: 'brief', at: at(12, 0), number: 7, stage: 'review', file: 'briefs/7-review.md', headline: 'Review round 1 done', point: null },
  { id: 'brief:briefs/8-review.md', kind: 'brief', at: at(14, 0), number: 8, stage: 'review', file: 'briefs/8-review.md', headline: 'Review round 2 done', point: null },
];
const BOSS: Job = job('boss', 'needs-you', { title: 'Invoice merge', level: 3, stage: 'review' });

function ledger(hp: number): PlayView {
  return {
    schema: 1, mode: 'full', questDone: 'first-pr', crew: {}, crewMet: 0, crewTotal: 15,
    quests: { done: 0, bugs: 0, recent: [] }, achievements: [], secrets: { found: [], total: 13 }, themesTried: [], unlocks: { crt: false, gold: false },
    reviews: { boss: hp ? { at: at(14, 0), blockers: 1, majors: 1, minors: 0, hp, startHp: 12, defeatedAt: null } : { at: at(14, 30), blockers: 0, majors: 0, minors: 0, hp: 0, startHp: 12, defeatedAt: at(14, 30) } },
  };
}

function stubReducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce'), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
}

function store(mode: PlayMode, jobs: Job[] = [BOSS], usage?: Partial<Usage>) {
  const s: Store = createStore();
  const snap = snapshot({ jobs, meta: { token: 't', levels: LEVELS, settings: { policy: 'hands-off', play: { mode, questDone: 'first-pr', sounds: false } } } });
  if (usage) snap.usage = { ...snap.usage, ...usage };
  s.dispatch({ type: 'snapshot', snapshot: snap });
  return s;
}

function pane(mode: PlayMode, { hp = 8, jobs = [BOSS] }: { hp?: number; jobs?: Job[] } = {}) {
  const detail: JobDetail = { slug: jobs[0].slug, title: jobs[0].title, thread: THREAD, threadMore: false, activity: [], gate: null, answeredBriefs: [7, 8], run: null, level: jobs[0].level ?? null } as unknown as JobDetail;
  const routes: Record<string, unknown> = { [`/api/job/${jobs[0].slug}`]: detail, '/api/play': ledger(hp) };
  const get = vi.fn(async (p: string) => {
    if (routes[p] === undefined) throw new ApiError(404, 'Not there.');
    return routes[p];
  });
  const s = store(mode, jobs);
  const utils = render(<WorkshopContext.Provider value={{ store: s, api: { get, post: vi.fn() } as unknown as ApiClient }}><ForemanPane slug={jobs[0].slug} /></WorkshopContext.Provider>);
  return { ...utils, get };
}

const loaded = () => screen.findByText('Review round 2 done');
const briefCard = (n: number) => screen.getByRole('article', { name: `Brief #${n} · Review` });

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); stubReducedMotion(false); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('the trail in the job header (Play on)', () => {
  it('Full: the level as difficulty, the stages as a path, the current stage’s crew member on it, a “!” when it needs you', async () => {
    const { container } = pane('full');
    await loaded();
    const trail = container.querySelector('.job-header .job-trail')!;
    expect(trail).toHaveClass('is-full', 'is-ask');
    expect(trail.querySelector('.trail-stars')).toHaveTextContent('★★★★');
    expect(trail).toHaveTextContent('Difficulty: L3 Large');
    expect(trail).toHaveAttribute('title', expect.stringContaining('The trail'));
    const path = within(trail as HTMLElement).getByRole('list', { name: 'Stages: now at Review' });
    const stops = within(path).getAllByRole('listitem');
    expect(stops.map((s) => s.querySelector('.trail-label')!.textContent)).toEqual(['Clarify', 'Spec', 'Refine', 'Screens', 'Investigate', 'Plan', 'Build', 'Test', 'Review', 'PR #1', 'PR #2', 'Staging QA', 'PR #3']);
    // Only the current stop, the goal and the first stop after it show their names; the rest keep theirs for hover and screen readers.
    expect(stops.filter((s) => s.classList.contains('is-named')).map((s) => s.querySelector('.trail-label')!.textContent)).toEqual(['Review', 'PR #1', 'PR #2']);
    expect(stops[0]).toHaveClass('is-quiet');
    expect(stops[0]).toHaveAttribute('title', 'Clarify');
    // After the finish line (PR #1 by default): drawn smaller.
    expect(stops[10]).toHaveClass('is-after');
    expect(stops[9]).not.toHaveClass('is-after');
    expect(stops[8]).toHaveClass('is-current', 'is-here');
    expect(stops[8]).toHaveTextContent(', now');
    const who = within(stops[8]).getByRole('img', { name: 'Head inspector, waiting' });
    expect(who).toHaveClass('is-animated');
    expect(who).toHaveAttribute('width', String(CREW_SIZE.trail[1]));
    expect(stops[8].querySelector('.trail-ask')).toHaveTextContent('!');
    expect(stops[0]).toHaveTextContent('✓');
    expect(stops[9]).toHaveClass('is-goal', 'is-next');
    expect(trail.querySelector('.trail-now')).toHaveTextContent('Your move: the Foreman is waiting for your reply.');
    expect(trail.querySelector('.trail-next')).toHaveTextContent('Then: The Foreman opens PR #1, the quest’s goal.');
  });

  it('Subtle: the same trail and line, the crew still, no difficulty stars', async () => {
    const { container } = pane('subtle');
    await loaded();
    const trail = container.querySelector('.job-header .job-trail')!;
    expect(trail).not.toHaveClass('is-full');
    expect(trail.querySelector('.trail-stars')).toBeNull();
    const who = within(trail as HTMLElement).getByRole('img', { name: 'Head inspector, waiting' });
    expect(who).toHaveClass('is-still');
    expect(who).toHaveAttribute('width', String(CREW_SIZE.trail[0]));
    expect(trail.querySelector('.trail-now')).toHaveTextContent('Your move:');
  });

  it('holds still with reduced motion', async () => {
    stubReducedMotion(true);
    const { container } = pane('full');
    await loaded();
    expect(container.querySelector('.job-trail svg.crew')).toHaveClass('is-still');
  });
});

describe('boss fight (Full, L3 review)', () => {
  it('sits under the latest review brief: hit points left of where it started, and what is left', async () => {
    pane('full', { hp: 8 });
    await loaded();
    const boss = await within(briefCard(8)).findByText('Boss: 8 of 12 hit points left · 1 blocker, 1 major');
    const fight = boss.closest('.boss-fight')!;
    expect(fight.querySelector('.boss-bar-fill')).toHaveStyle({ width: '67%' });
    expect(fight.querySelector('.boss-bar')).toHaveAttribute('aria-hidden', 'true');
    expect(fight).toHaveAttribute('title', expect.stringContaining('blockers 5, majors 3, minors 1'));
    expect(briefCard(7).querySelector('.boss-fight')).toBeNull();
  });

  it('says Boss defeated at zero', async () => {
    pane('full', { hp: 0 });
    await loaded();
    const won = await within(briefCard(8)).findByText('Boss defeated');
    expect(won.closest('.boss-fight')).toHaveClass('is-defeated');
    expect(won.closest('.boss-fight')!.querySelector('.boss-bar-fill')).toHaveStyle({ width: '0%' });
  });

  it('only for an L3 job at its review stage', async () => {
    const l2 = pane('full', { jobs: [{ ...BOSS, level: 2 }] });
    await loaded();
    expect(document.querySelector('.boss-fight')).toBeNull();
    expect(l2.get).not.toHaveBeenCalledWith('/api/play');
    l2.unmount();
    pane('full', { jobs: [{ ...BOSS, stage: 'pr1' }] });
    await loaded();
    expect(document.querySelector('.boss-fight')).toBeNull();
  });
});

describe('Subtle and Off draw none of it', () => {
  for (const mode of ['subtle', 'off'] as PlayMode[]) {
    it(`${mode}: no boss, no stamina, no difficulty, no ledger fetched for them`, async () => {
      const { container, get } = pane(mode);
      await loaded();
      expect(container.querySelector('.boss-fight, .stamina, .trail-stars')).toBeNull();
      if (mode === 'off') expect(container.querySelector('.job-trail')).toBeNull();
      expect(container).not.toHaveTextContent('Difficulty');
      expect(get).not.toHaveBeenCalledWith('/api/play');
      expect(screen.queryByText('Full mode extras:', { exact: false })).toBeNull();
    });
  }
});

describe('stamina (Full, top bar)', () => {
  const bar = (mode: PlayMode, usage?: Partial<Usage>) => render(<WorkshopContext.Provider value={{ store: store(mode, [BOSS], usage), api: {} as ApiClient }}><StaminaBar /></WorkshopContext.Provider>);

  it('Fresh, Warning or Resting until the reset, in words, with a simple bar', () => {
    const fresh = bar('full');
    expect(fresh.container.querySelector('.stamina')).toHaveClass('is-fresh');
    expect(fresh.container).toHaveTextContent('Stamina: Fresh');
    expect(fresh.container.querySelector('.stamina-fill')).toHaveStyle({ width: '100%' });
    fresh.unmount();
    const warn = bar('full', { warning: { label: '5-hour limit', percent: 92, resetsAt: at(15, 42) } });
    expect(warn.container).toHaveTextContent('Stamina: Warning');
    expect(warn.container).not.toHaveTextContent('92');
    warn.unmount();
    const rest = bar('full', { limited: true, blocking: true, autoResume: true, resetKnown: true, resetsAt: at(15, 42) });
    expect(rest.container.querySelector('.stamina')).toHaveClass('is-resting');
    expect(rest.container).toHaveTextContent('Stamina: Resting until 3:42pm');
    expect(rest.container.querySelector('.stamina')).toHaveAttribute('title', expect.stringContaining('crew are asleep'));
  });

  it('nothing in Subtle or Off', () => {
    expect(bar('subtle').container).toBeEmptyDOMElement();
    expect(bar('off').container).toBeEmptyDOMElement();
  });
});

describe('the crew asleep in a usage pause (Full)', () => {
  const paused = job('boss', 'paused', { limitPaused: at(14, 50), nowDoing: [{ who: 'feature-tester', name: 'Tester' }] });
  const row = (mode: PlayMode, extra: Partial<Usage> = {}) => {
    const usage: Usage = { limited: true, blocking: true, label: '5-hour limit', resetsAt: at(15, 42), autoResume: true, resetKnown: true, jobs: [{ slug: 'boss', title: 'Invoice merge' }], ...extra };
    return render(<WorkshopContext.Provider value={{ store: store(mode, [paused], usage), api: {} as ApiClient }}><LiveRow run={null} job={paused} usage={usage} /></WorkshopContext.Provider>);
  };

  it('Full: the Foreman and the workers asleep, back at the reset time with a countdown', () => {
    const { container } = row('full');
    const line = container.querySelector('.live-row.is-paused')!;
    expect(line).toHaveTextContent('Foreman and Tester are asleep · back at 3:42pm (in 42m).');
    const faces = [...line.querySelectorAll('svg.crew')];
    expect(faces.map((f) => f.getAttribute('data-crew'))).toEqual(['conductor', 'feature-tester']);
    for (const f of faces) expect(f).toHaveAttribute('data-state', 'asleep');
  });

  it('Full, automatic carry-on off: no wake-up time promised', () => {
    const { container } = row('full', { autoResume: false });
    const line = container.querySelector('.live-row.is-paused')!;
    expect(line).toHaveTextContent('are asleep · waiting for Carry on now (automatic carry-on is off).');
    expect(line).not.toHaveTextContent('3:42pm');
  });

  it('Subtle keeps the line it had', () => {
    const { container } = row('subtle');
    expect(container.querySelector('.live-row.is-paused')).toHaveTextContent('Tester asleep until the limit resets Asleep until Claude’s usage limit resets.');
    expect(container).not.toHaveTextContent('back at');
  });
});
