// The Full-mode extras on the page: the quest track in the job header, the boss fight under an L3
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

describe('quest track (Full)', () => {
  it('shows the level as difficulty and the stages as a path, the current stage’s crew member on it', async () => {
    const { container } = pane('full');
    await loaded();
    const track = container.querySelector('.job-header .quest-track')!;
    expect(track).not.toBeNull();
    expect(track.querySelector('.quest-stars')).toHaveTextContent('★★★★');
    expect(track).toHaveTextContent('Difficulty: L3 Large');
    expect(track).toHaveAttribute('title', expect.stringContaining('quest track'));
    const path = within(track as HTMLElement).getByRole('list', { name: 'Quest track: now at Review' });
    const stops = within(path).getAllByRole('listitem');
    expect(stops.map((s) => s.querySelector('.quest-label')!.textContent)).toEqual(['Spec', 'Refine', 'Investigate', 'Plan', 'Build', 'Test', 'Review', 'PR #1']);
    expect(stops[6]).toHaveClass('is-current');
    expect(stops[6]).toHaveTextContent(', now');
    expect(within(stops[6]).getByRole('img', { name: 'Head inspector' })).toHaveClass('is-animated');
    expect(stops[0]).toHaveTextContent('✓');
    expect(stops[7]).toHaveClass('is-goal', 'is-next');
  });

  it('holds still with reduced motion', async () => {
    stubReducedMotion(true);
    const { container } = pane('full');
    await loaded();
    expect(container.querySelector('.quest-track svg.crew')).toHaveClass('is-still');
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
    it(`${mode}: no quest track, no boss, no stamina, no ledger fetched for them`, async () => {
      const { container, get } = pane(mode);
      await loaded();
      expect(container.querySelector('.quest-track, .boss-fight, .stamina')).toBeNull();
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
    const rest = bar('full', { limited: true, blocking: true, resetsAt: at(15, 42) });
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
  const row = (mode: PlayMode) => {
    const usage: Usage = { limited: true, blocking: true, label: '5-hour limit', resetsAt: at(15, 42), jobs: [{ slug: 'boss', title: 'Invoice merge' }] };
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

  it('Subtle keeps the line it had', () => {
    const { container } = row('subtle');
    expect(container.querySelector('.live-row.is-paused')).toHaveTextContent('Tester asleep until the limit resets Asleep until Claude’s usage limit resets.');
    expect(container).not.toHaveTextContent('back at');
  });
});
