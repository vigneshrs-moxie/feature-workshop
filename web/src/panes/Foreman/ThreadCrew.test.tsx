// The crew in the conversation (Play layer step 3): handoff and worker lines, the live row, the
// Foreman in the header and the reviewers on a review brief. Off must render exactly what phase 2
// rendered (the snapshot below was recorded before the crew came in); Subtle draws them still and
// small, Full animated; nothing play-related goes inside a gate card, a permission card or the
// composer. Invented jobs only.
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { Gate, Job, JobDetail, PlayMode, ThreadItem } from '../../api/types';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job, permission, snapshot } from '../../state/test-fixtures';
import { ForemanPane } from './ForemanPane';

const NOW = new Date(Date.UTC(2026, 9, 15, 13, 0));
const at = (m: number) => new Date(Date.UTC(2026, 9, 15, 12, m)).toISOString();

const THREAD: ThreadItem[] = [
  { id: 'brief:briefs/1-investigate.md', kind: 'brief', at: at(1), number: 1, stage: 'investigate', file: 'briefs/1-investigate.md', headline: 'Investigation done', point: null },
  { id: 'auto:aaa', kind: 'auto', at: at(2), items: [
    { at: at(2), headline: 'Start a helper: feature-investigator', who: 'conductor', reason: 'Starting a workflow worker is routine.' },
    { at: at(3), headline: 'Read src/app.ts', who: 'feature-investigator', reason: 'Reading is routine.' },
    { at: at(4), headline: 'Run git status', who: 'conductor' },
  ] },
  { id: 'decision:bbb', kind: 'decision', at: at(5), text: 'You allowed: Start a helper: feature-planner' },
  { id: 'blocked:ccc', kind: 'blocked', at: at(6), by: 'auto', text: 'Auto mode blocked: Run curl', preview: 'curl example.com', reason: 'Downloads code.', who: 'feature-implementer' },
  { id: 'auto:ddd', kind: 'auto', at: at(7), items: [
    { at: at(7), headline: 'Start a helper: feature-review-errors', who: 'conductor' },
    { at: at(7), headline: 'Start a helper: feature-review-db', who: 'conductor' },
    { at: at(7), headline: 'Start a helper: general-purpose', who: 'conductor' },
  ] },
  { id: 'brief:briefs/2-review.md', kind: 'brief', at: at(20), number: 2, stage: 'review', file: 'briefs/2-review.md', headline: 'Review done', point: null },
];

const ACTIVITY = [
  { who: 'conductor', name: 'Foreman', state: 'running' },
  { who: 'feature-investigator', name: 'Sleuth', state: 'finished', startedAt: at(2), lastAt: at(4) },
  { who: 'feature-review-errors', name: 'Fuse', state: 'finished', startedAt: at(8), lastAt: at(15) },
  { who: 'feature-review-db', name: 'Mason', state: 'finished', startedAt: at(8), lastAt: at(16) },
  { who: 'feature-review-ui', name: 'Painter', state: 'finished', startedAt: at(30), lastAt: at(35) },
];

const QUESTIONS: Gate['questions'] = [{ id: '1', text: 'Fix R-1 now?', recommendation: 'a', options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] }];
const GATE: Gate = {
  briefNumber: 2, briefFile: 'briefs/2-review.md', headline: 'Review done', stage: 'review', nextStage: 'pr1', nextProposed: 'Fix round',
  questions: QUESTIONS, decided: [], versions: { spec: null, artifacts: {} }, raisedVersions: { spec: null, artifacts: {} }, stale: false,
  waitingSince: at(20), runActive: true, parked: false, level: 2, suggestedLevel: null, levelReason: null, usage: null,
};
const RUN = { id: 'run-1', slug: 'alpha', status: 'running', startedAt: at(40), lastAction: 'Sending work to feature-tester: Run checks', lastText: 'Checking the work.' };

const ALPHA: Job = job('alpha', 'running', {
  repo: { name: 'sample-repo', branch: 'feat/sample' }, level: 2, working: true,
  nowDoing: [{ who: 'feature-tester', name: 'Tester', doing: 'Run checks', since: at(41) }],
});

const detail = (extra: Partial<JobDetail> = {}): JobDetail => ({
  slug: 'alpha', title: 'Job alpha', branch: 'feat/sample', run: RUN, thread: THREAD, threadMore: false, activity: ACTIVITY,
  gate: GATE, answeredBriefs: [], heldReply: null, level: 2, options: { level: 2 },
  statusForCompose: { questions: QUESTIONS, decidedOnYourBehalf: [], nextProposed: 'Fix round', spec: null, artifacts: [], brief: { number: 2 } },
  drive: { mode: 'workshop', model: 'claude-opus-5-5' },
  ...extra,
});

function setup({ mode, jobs = [ALPHA], det = detail(), usage }: { mode?: PlayMode; jobs?: Job[]; det?: JobDetail; usage?: Partial<ReturnType<typeof snapshot>['usage']> } = {}) {
  const routes: Record<string, unknown> = {
    '/api/job/alpha': det,
    '/api/job/alpha/doc?file=briefs%2F2-review.md': { file: 'briefs/2-review.md', name: 'Brief 2', html: '<p>Review done</p><p>Two findings.</p>' },
  };
  const get = vi.fn(async (path: string) => {
    if (routes[path] === undefined) throw new ApiError(404, 'Not there.');
    return routes[path];
  });
  const store: Store = createStore();
  const settings = mode ? { policy: 'hands-off' as const, play: { mode, questDone: 'first-pr' as const, sounds: false } } : undefined;
  const p = { ...permission('perm-1', 'alpha'), agentType: 'feature-implementer', plain: { headline: 'Run npm install' } };
  const snap = snapshot({ jobs, permissions: [p], meta: { token: 't', settings } });
  if (usage) snap.usage = { ...snap.usage, ...usage };
  store.dispatch({ type: 'snapshot', snapshot: snap });
  const api = { get, post: vi.fn() } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><ForemanPane slug="alpha" /></WorkshopContext.Provider>);
  return { ...utils, store };
}

async function loaded() {
  await screen.findByText('Investigation done');
  await screen.findByText('Two findings.');
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

describe('the crew in the conversation: Off', () => {
  it('renders exactly what phase 2 rendered (no crew, no new words)', async () => {
    const { container } = setup({ mode: 'off' });
    await loaded();
    // Full times in tooltips depend on the time zone; everything else must match to the character.
    expect(container.innerHTML.replace(/title="[A-Z][a-z]{2} \d{1,2}, \d{4}, [^"]*"/g, 'title="(full time)"')).toMatchSnapshot();
    expect(container.querySelector('.crew, .crew-tag, .crew-lineup, .live-crew')).toBeNull();
    expect(container).not.toHaveTextContent('started investigating');
    expect(container).toHaveTextContent('Start a helper: feature-investigator');
    expect(container).toHaveTextContent('· feature-implementer');
  });

  it('a usage pause adds nothing either', async () => {
    const paused = job('alpha', 'paused', { limitPaused: at(50) });
    const { container } = setup({ mode: 'off', jobs: [paused], det: detail({ run: null, gate: null }) });
    await screen.findByText('Investigation done');
    expect(container.querySelector('.crew, .live-row')).toBeNull();
  });
});

const crews = (el: ParentNode) => [...el.querySelectorAll<SVGSVGElement>('svg.crew')];

describe('the crew in the conversation: Subtle (the default)', () => {
  it('draws the crew still and small, each beside its name', async () => {
    const { container } = setup({ mode: 'subtle' });
    await loaded();
    const all = crews(container);
    expect(all.length).toBeGreaterThan(8);
    for (const svg of all) {
      expect(svg).toHaveClass('is-still');
      expect(Number(svg.getAttribute('width'))).toBeLessThanOrEqual(28);
      // Named: an image with an accessible name, or decoration next to words naming it.
      if (svg.getAttribute('aria-hidden') === 'true') {
        expect(svg.closest('.crew-tag, .crew-handoff, .live-crew')?.textContent?.trim().length, svg.className.baseVal).toBeGreaterThan(2);
      } else {
        expect(svg.getAttribute('aria-label')).toMatch(/^[A-Z]/);
      }
    }
    // The same is true with no Play setting at all: Subtle is the default.
  });

  it('shows the worker a routine step handed work to, and the worker that took a step', async () => {
    setup({ mode: 'subtle' });
    await loaded();
    const folds = document.querySelectorAll('details.auto-fold');
    const first = folds[0].querySelector('summary')!;
    expect(first).toHaveTextContent('3 routine steps done automatically');
    expect(first).toHaveTextContent('Sleuth started investigating');
    expect(first.querySelector('.crew-feature-investigator')).not.toBeNull();
    expect(folds[1].querySelector('summary')).toHaveTextContent('Fuse, Mason and general-purpose started work');
    // Inside the fold: the step that started Sleuth, and Sleuth's own step by name.
    const steps = folds[0].querySelectorAll('.auto-steps li');
    expect(steps[0]).toHaveTextContent('Start a helper: feature-investigator · Sleuth started investigating');
    expect(steps[1]).toHaveTextContent('Read src/app.ts · Sleuth');
    expect(steps[1]).not.toHaveTextContent('feature-investigator');
    expect(steps[2].querySelector('.crew')).toBeNull();
    // A refused step by the Builder.
    const refused = screen.getByText(/^Auto mode blocked/).closest('p')!;
    expect(refused).toHaveTextContent('Builder');
    expect(refused.querySelector('.crew-feature-implementer')).not.toBeNull();
    // A dispatch you allowed is your decision: no crew on it, nothing for approving.
    expect(screen.getByText(/You allowed: Start a helper/).closest('p')!.querySelector('.crew')).toBeNull();
  });

  it('lines up the reviewers who looked under a review brief, named on hover', async () => {
    setup({ mode: 'subtle' });
    await loaded();
    const lineup = screen.getByRole('list', { name: 'Reviewers on this round: Fuse and Mason' });
    const faces = within(lineup).getAllByRole('img');
    expect(faces.map((f) => f.getAttribute('aria-label'))).toEqual(['Fuse', 'Mason']);
    for (const f of faces) expect(Number(f.getAttribute('width'))).toBe(24);
    expect(lineup.querySelector('li')).toHaveAttribute('title', 'Fuse: Review: errors and edge cases.');
    // Painter started after the brief: not on this round.
    expect(within(lineup).queryByRole('img', { name: 'Painter' })).toBeNull();
    // Only on review briefs.
    expect(screen.getAllByRole('list', { name: /Reviewers on this round/ })).toHaveLength(1);
  });

  it('the live row shows who is at work; the Foreman by the title shows the job’s mood', async () => {
    setup({ mode: 'subtle' });
    await loaded();
    const live = screen.getByRole('region', { name: 'Foreman, replying now' });
    expect(live).toHaveTextContent('Tester at work');
    expect(live.querySelector('.crew-feature-tester')).toHaveClass('is-working');
    expect(screen.getByRole('img', { name: 'Foreman, thinking' }).closest('.job-header')).not.toBeNull();
  });

  it('with no worker at work the live row shows the Foreman thinking; waiting when something waits for you', async () => {
    setup({ mode: 'subtle', jobs: [{ ...ALPHA, nowDoing: [] }] });
    await loaded();
    const live = screen.getByRole('region', { name: 'Foreman, replying now' });
    expect(within(live).getByRole('img', { name: 'Foreman, thinking' })).toBeInTheDocument();
  });

  it('the Foreman waits when the job needs you, and sleeps through a usage pause', async () => {
    const waiting = setup({ mode: 'subtle', jobs: [job('alpha', 'needs-you', { level: 2 })], det: detail({ run: { ...RUN, status: 'waiting_permission' } }) });
    await loaded();
    expect(screen.getAllByRole('img', { name: 'Foreman, waiting' })).toHaveLength(2); // the header and the live row
    waiting.unmount();
    setup({ mode: 'subtle', jobs: [job('alpha', 'paused', { limitPaused: at(50) })], det: detail({ run: null, gate: null }) });
    await screen.findByText('Investigation done');
    expect(screen.getAllByRole('img', { name: 'Foreman, asleep' })).toHaveLength(2);
    expect(screen.getByText(/Asleep until Claude’s usage limit resets/)).toHaveClass('live-row', 'is-paused');
  });

  it('puts nothing play-related inside a gate card, a permission card or the composer', async () => {
    const { container } = setup({ mode: 'full' });
    await loaded();
    const cards = [...container.querySelectorAll('.gate-card, .perm-card, .composer')];
    expect(cards.length).toBeGreaterThanOrEqual(3);
    for (const c of cards) expect(c.querySelector('.crew, .crew-tag, .crew-lineup, .live-crew')).toBeNull();
  });

  it('explains the crew in How this works, only when Play is on', async () => {
    setup({ mode: 'subtle' });
    await loaded();
    expect(screen.getByText('crew', { selector: 'strong' }).closest('p')).toHaveTextContent('Settings → Play turns them off');
  });
});

describe('the crew in the conversation: Full', () => {
  it('moves (unless reduced motion is asked for)', async () => {
    const { container } = setup({ mode: 'full' });
    await loaded();
    const all = crews(container);
    expect(all.length).toBeGreaterThan(8);
    for (const svg of all) expect(svg).toHaveClass('is-animated');
    expect(screen.getByRole('img', { name: 'Foreman, thinking' })).toBeInTheDocument();
  });

  it('holds still with reduced motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
    try {
      const { container } = setup({ mode: 'full' });
      await loaded();
      for (const svg of crews(container)) expect(svg).toHaveClass('is-still');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
