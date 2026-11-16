// Jobs (#/): four lanes from the dashboard's lane, Resting and Done folded, the next-step bar with
// Open (o), stop dots with their own tooltip, cards that hold their lane under the pointer, Play's
// three dressings, One list, and the empty state.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { Gate, Job, JobDetail } from '../api/types';
import { installKeyListener } from '../app/keyRegistry';
import { UiProvider } from '../app/ui';
import { createStore, WorkshopContext, type Store } from '../state/store';
import { job, snapshot } from '../state/test-fixtures';
import { JobsPage, laneOf, nextJob, stateChip } from './JobsPage';
import { setDefaultDetail } from '../app/detail';
import { loadScene } from '../play/floor3d/loadScene';
import { setWebGLForTests } from '../play/floor3d/webgl';
import type { FloorScene } from '../play/floor3d/types';

vi.mock('../play/floor3d/loadScene', () => ({ loadScene: vi.fn() }));

function fakeScene(): FloorScene {
  return {
    setLayout: vi.fn(), setBenches: vi.fn(), setPalette: vi.fn(), setReducedMotion: vi.fn(), setHover: vi.fn(), setPointer: vi.fn(),
    zoomAt: vi.fn(), fitAll: vi.fn(), zoomed: vi.fn(() => false), setActive: vi.fn(), onFrame: vi.fn(), setBusy: vi.fn(),
    stats: vi.fn(() => ({ frames: 0, avgMs: 0, p95Ms: 0, maxMs: 0, fps: 0, figures: 0, benches: 0 })), dispose: vi.fn(),
  };
}

const JOBS: Job[] = [
  job('alpha', 'needs-you', { title: 'Customer notes', stage: 'plan', lane: 'needs-you', laneReason: 'Waiting for your go-ahead on the plan', waitingFor: 'approval', waitingSince: '2026-10-21T09:00:00Z' }),
  job('older', 'needs-you', { title: 'Weekly hours email', stage: 'spec', lane: 'needs-you', laneReason: 'The Foreman asks 2 questions', waitingFor: 'answers', waitingSince: '2026-10-21T08:00:00Z' }),
  job('beta', 'running', { title: 'Technician photo', stage: 'implement', lane: 'working', laneReason: 'Building step 3', updatedAt: '2026-10-21T11:40:00Z' }),
  job('gamma', 'shipping', { title: 'Gate code', stage: 'pr1', lane: 'in-review', laneReason: 'PR #1 is open, waiting on a review' }),
  job('delta', 'shipping', { title: 'Cancellation email', stage: 'pr2', lane: 'ready', laneReason: 'Checks passed and PR #2 is approved' }),
  job('idle', 'idle', { title: 'Old idea', stage: 'spec', lane: 'resting', laneReason: 'Nothing happening; waits for your next message' }),
  job('fin', 'done', { title: 'Shipped thing', stage: 'pr3', lane: 'done', laneReason: 'In main' }),
];

function setup(jobs = JOBS, play: 'full' | 'subtle' | 'off' = 'subtle') {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, meta: { token: 't', settings: { play: { mode: play } } } as never }) });
  const api = { get: vi.fn(() => new Promise(() => {})), post: vi.fn() } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><JobsPage /></UiProvider></WorkshopContext.Provider>);
  return { ...utils, store };
}

let off = () => {};
beforeEach(() => { off = installKeyListener(); window.location.hash = '#/'; });
afterEach(() => { off(); cleanup(); localStorage.clear(); window.location.hash = ''; });

describe('Jobs: What Auto decided on a card', () => {
  it('opening it, reading it and closing it by the backdrop never opens the quick look', async () => {
    setup([job('alpha', 'running', { title: 'Customer notes', stage: 'plan', lane: 'working', auto: { on: true, ran: true } })]);
    const card = screen.getByRole('link', { name: 'Customer notes' }).closest('li')!;
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'What Auto decided' })); });
    fireEvent.click(screen.getByText('Loading…'));
    fireEvent.keyDown(screen.getByText('Loading…'), { key: ' ' });
    const backdrop = document.querySelector('.sheet-backdrop')!;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).not.toContain('peek=');
  });
});

describe('Jobs', () => {
  it('has four lanes, each with a word and a count; Resting and Done are folded under the board', () => {
    setup();
    for (const [name, titles] of [['Working, 1', ['Technician photo']], ['Needs you, 2', ['Weekly hours email', 'Customer notes']], ['In review, 1', ['Gate code']], ['Ready to merge, 1', ['Cancellation email']]] as const) {
      const lane = screen.getByRole('region', { name });
      expect(within(lane).getAllByRole('link').map((a) => a.textContent)).toEqual(titles);
    }
    const folds = [...document.querySelectorAll('.jobs-folded details')] as HTMLDetailsElement[];
    expect(folds.map((d) => d.querySelector('.fold-name')?.textContent)).toEqual(['Resting', 'Done']);
    expect(folds.map((d) => d.open)).toEqual([false, false]);
    expect(folds[0].querySelector('summary')).toHaveTextContent('1 idle');
  });

  it('the next-step bar names the job that waited longest for you; o opens it', () => {
    setup();
    const bar = screen.getByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Weekly hours email needs you');
    expect(bar).toHaveTextContent('2 jobs need you. This one has waited longest.');
    expect(within(bar).getByRole('link', { name: /Open/ })).toHaveAttribute('href', '#/job/older');
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(window.location.hash).toBe('#/job/older');
  });

  it('with nothing for you the bar says so, with no button', () => {
    setup(JOBS.filter((j) => j.lane !== 'needs-you'));
    const bar = screen.getByRole('region', { name: 'Next step' });
    expect(bar).toHaveTextContent('Nothing needs you right now');
    expect(within(bar).queryByRole('link')).toBeNull();
  });

  it('the button is on the card in Jobs', () => {
    setup([
      job('alpha', 'needs-you', { title: 'Customer notes', stage: 'plan', lane: 'needs-you', auto: { on: true, ran: true } }),
      job('beta', 'running', { title: 'Technician photo', stage: 'implement', lane: 'working' }),
    ]);
    const card = screen.getByRole('link', { name: 'Customer notes' }).closest('li')!;
    expect(within(card).getByRole('button', { name: 'What Auto decided' })).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: 'Technician photo' }).closest('li')!).queryByRole('button', { name: 'What Auto decided' })).toBeNull();
  });

  it('each stop dot takes the focus and has its own tooltip in words; each card says its state in a word', () => {
    setup();
    const card = screen.getByRole('link', { name: 'Customer notes' }).closest('li')!;
    const dots = within(card).getByRole('list', { name: 'Customer notes: its stops' });
    const plan = within(dots).getAllByRole('listitem')[2].querySelector('[tabindex="0"]') as HTMLElement;
    expect(plan).toHaveAccessibleDescription('Plan · waiting for you');
    expect(within(dots).getAllByRole('tooltip').map((t) => t.textContent)).toEqual([
      'Spec · done', 'Investigate · done', 'Plan · waiting for you', 'Build · not yet', 'Test · not yet', 'Review · not yet', 'Ship · not yet',
    ]);
    expect(card).toHaveTextContent('Go-ahead');
    expect(screen.getByRole('link', { name: 'Weekly hours email' }).closest('li')).toHaveTextContent('Question');
  });

  it('a card keeps its lane while the pointer is over the board, and moves when it leaves', () => {
    const { store } = setup();
    const board = document.querySelector('.jobs-board')!;
    fireEvent.mouseEnter(board);
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: JOBS.map((j) => (j.slug === 'beta' ? { ...j, lane: 'needs-you' as const } : j)), meta: { token: 't' } }) }); });
    expect(within(screen.getByRole('region', { name: /^Working/ })).getByRole('link', { name: 'Technician photo' })).toBeInTheDocument();
    fireEvent.mouseLeave(board);
    expect(within(screen.getByRole('region', { name: /^Needs you/ })).getByRole('link', { name: 'Technician photo' })).toBeInTheDocument();
  });

  it('cards keep their order within a lane while the pointer is over the board too', () => {
    const { store } = setup();
    const titles = () => within(screen.getByRole('region', { name: /^Needs you/ })).getAllByRole('link').map((a) => a.textContent);
    expect(titles()).toEqual(['Weekly hours email', 'Customer notes']);
    const board = document.querySelector('.jobs-board')!;
    fireEvent.mouseEnter(board);
    // Customer notes now has waited longest: it would go first, but not under the pointer.
    const swapped = JOBS.map((j) => (j.slug === 'alpha' ? { ...j, waitingSince: '2026-10-21T07:00:00Z', laneReason: 'Asks 1 question' } : j));
    act(() => { store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: swapped, meta: { token: 't' } }) }); });
    expect(titles()).toEqual(['Weekly hours email', 'Customer notes']);
    expect(screen.getByText('Asks 1 question')).toBeInTheDocument();
    fireEvent.mouseLeave(board);
    expect(titles()).toEqual(['Customer notes', 'Weekly hours email']);
  });

  it('Play full: console cards with a readout and a blinking light; off: plain cards, the same dots and words', () => {
    setup(JOBS, 'full');
    const card = screen.getByRole('link', { name: 'Technician photo' }).closest('li')!;
    expect(card.querySelector('.job-light.is-blink')).not.toBeNull();
    expect(card.querySelector('.job-readout')).toHaveTextContent('Build');
    cleanup();
    setup(JOBS, 'off');
    const plain = screen.getByRole('link', { name: 'Technician photo' }).closest('li')!;
    expect(plain.querySelector('.job-light')).toBeNull();
    expect(plain.querySelector('.job-readout')).toBeNull();
    expect(plain).toHaveTextContent('Working');
  });

  it('One list (Settings → Look) puts every open job in one list with its lane in words', () => {
    localStorage.setItem('gc.jobs.layout', 'list');
    setup();
    expect(document.querySelector('.jobs-board')).toBeNull();
    const rows = document.querySelectorAll('.jobs-list-row');
    expect([...rows].map((r) => r.querySelector('.state-chip')?.textContent?.trim())).toEqual(['Working', 'Needs you', 'Needs you', 'In review', 'Ready to merge']);
  });

  it('Floor (Play full only) shows the 3D floor, and a click on a bench takes the quick look', async () => {
    localStorage.setItem('gc.jobs.layout', 'floor');
    setWebGLForTests(true);
    vi.mocked(loadScene).mockReset().mockResolvedValue({ createFloorScene: () => fakeScene() } as never);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    try {
      setup(JOBS, 'full');
      expect(document.querySelector('.jobs-board')).toBeNull();
      const floor = screen.getByRole('region', { name: 'The station' });
      // The heading's switch, with Floor picked.
      expect(screen.getByRole('radio', { name: 'Station' })).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(within(floor).getByRole('link', { name: /^Feature: Building · Customer notes/ }));
      expect(screen.getByRole('dialog', { name: 'Customer notes: a quick look' })).toBeInTheDocument();
      expect(window.location.hash).toContain('peek=alpha');
      // The switch goes back to the lanes, and remembers it.
      fireEvent.click(screen.getByRole('radio', { name: 'Four lanes' }));
      expect(document.querySelector('.jobs-board')).not.toBeNull();
      expect(localStorage.getItem('gc.jobs.layout')).toBeNull();
    } finally { setWebGLForTests(null); vi.restoreAllMocks(); }
  });

  it('Floor in Play subtle or off: Four lanes, no switch and no 3D', () => {
    localStorage.setItem('gc.jobs.layout', 'floor');
    vi.mocked(loadScene).mockReset();
    for (const play of ['subtle', 'off'] as const) {
      setup(JOBS, play);
      expect(document.querySelector('.jobs-board')).not.toBeNull();
      expect(document.querySelector('.floor3d')).toBeNull();
      expect(screen.queryByRole('radiogroup', { name: 'Jobs layout' })).toBeNull();
      cleanup();
    }
    expect(loadScene).not.toHaveBeenCalled();
  });

  it('with no jobs: the three picture cards and the way to the Inbox', () => {
    setup([]);
    expect(screen.getByRole('heading', { name: 'No jobs yet. Start one from a ticket.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pick a ticket in the Inbox/ })).toHaveAttribute('href', '#/inbox');
  });

  it('lanes and picks from the model', () => {
    expect(laneOf(job('x', 'running'))).toBe('working');
    expect(laneOf(job('x', 'idle', { closed: { as: 'done', at: 'x' } as never }))).toBe('done');
    expect(nextJob(JOBS)?.slug).toBe('older');
    expect(stateChip(job('x', 'needs-you', { lane: 'needs-you', permissions: 1 })).word).toBe('Permission');
  });
});

describe('Jobs, simple by default (packet R)', () => {
  beforeEach(() => setDefaultDetail('simple'));

  it('a card shows its title, one line, the state chip and the time; the stop dots wait behind it, over the time', () => {
    setup();
    const card = screen.getByRole('link', { name: 'Technician photo' }).closest('li')!;
    expect(card).toHaveTextContent('Building step 3');
    expect(card.querySelector('.state-chip')).toHaveTextContent('Working');
    expect(card.querySelector('.job-card-peek .stop-map')).not.toBeNull();
    expect(card.querySelector(':scope > .stop-map')).toBeNull();
  });

  it('Space on a card takes a quick look over the list; j moves to the next job, Esc closes it and the list is as it was', () => {
    const { container } = setup();
    const lanes = container.querySelector('.jobs-board')!.innerHTML;
    fireEvent.keyDown(screen.getByRole('link', { name: 'Technician photo' }), { key: ' ' });
    expect(screen.getByRole('dialog', { name: 'Technician photo: a quick look' })).toBeInTheDocument();
    expect(screen.getByLabelText('Now')).toHaveTextContent('The crew');
    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getByRole('dialog', { name: /a quick look/ })).toHaveAccessibleName('Weekly hours email: a quick look');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('.jobs-board')!.innerHTML.replace(/ is-peeked/g, '')).toBe(lanes);
  });

  it('the open quick look is in the address: opening sets it, j changes it, Esc clears it, with nothing added to Back', () => {
    window.location.hash = '#/?theme=glass';
    const before = window.history.length;
    setup();
    fireEvent.keyDown(screen.getByRole('link', { name: 'Technician photo' }), { key: ' ' });
    expect(window.location.hash).toBe('#/?theme=glass&peek=beta');
    fireEvent.keyDown(window, { key: 'j' });
    expect(window.location.hash).toBe('#/?theme=glass&peek=older');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(window.location.hash).toBe('#/?theme=glass');
    expect(window.history.length).toBe(before);
  });

  it('an address with ?peek=<slug> opens that quick look; one for a job that isn’t here is dropped', () => {
    window.location.hash = '#/jobs?peek=gamma';
    setup();
    expect(screen.getByRole('dialog', { name: 'Gate code: a quick look' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(window.location.hash).toBe('#/jobs');
    cleanup();
    window.location.hash = '#/?peek=nobody';
    setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe('#/');
  });

  it('a click on a card’s empty area opens its quick look and puts it in the address', () => {
    setup();
    const card = screen.getByRole('link', { name: 'Gate code' }).closest('li')!;
    fireEvent.click(card);
    expect(screen.getByRole('dialog', { name: 'Gate code: a quick look' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/?peek=gamma');
  });
});

describe('Jobs: Yours and Auto (design section 2)', () => {
  // Two jobs the server put in Auto's groups, and one with Auto on that it put in none (Yours).
  const AUTO_JOBS: Job[] = [
    ...JOBS,
    job('a-work', 'running', { title: 'Auto builds this', stage: 'implement', lane: 'working', laneReason: 'Building step 2', auto: { on: true, ran: true, group: 'working' } }),
    job('a-stop', 'needs-you', { title: 'Auto stopped here', stage: 'plan', lane: 'needs-you', laneReason: 'Auto stopped: the Foreman says it is blocked', waitingFor: 'approval', waitingSince: '2026-10-21T07:00:00Z', auto: { on: true, ran: true, stopped: { reason: 'the Foreman says it is blocked' }, group: 'needs-you' } }),
    job('a-none', 'running', { title: 'From an older laptop', stage: 'implement', lane: 'working', auto: { on: true, ran: true } }),
  ];
  const tab = (name: string) => screen.getByRole('tab', { name });
  const count = (name: string) => tab(name).querySelector('.seg-count')?.textContent;

  it('two tabs with counts; Yours leaves out Auto\'s jobs', () => {
    setup(AUTO_JOBS);
    const list = screen.getByRole('tablist', { name: 'Jobs' });
    expect(within(list).getAllByRole('tab').map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    // Yours: the four lanes' jobs (six, the older laptop's Auto job among them); Auto: its two.
    expect(count('Yours')).toBe('6');
    expect(count('Auto')).toBe('2');
    expect(screen.getByRole('region', { name: 'Working, 2' })).toHaveTextContent('From an older laptop');
    expect(screen.queryByRole('link', { name: 'Auto builds this' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Auto stopped here' })).toBeNull();
    // The bar names Yours' longest wait first, though Auto stopped here waited longer.
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('Weekly hours email needs you');
    fireEvent.click(tab('Auto'));
    expect(tab('Auto')).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('.jobs-board')).toBeNull();
    expect(within(screen.getByRole('region', { name: /^Working ·/ })).getByRole('link', { name: 'Auto builds this' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Needs you, 1' })).getByRole('link', { name: 'Auto stopped here' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Customer notes' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'From an older laptop' })).toBeNull();
  });

  it('the chosen tab is remembered', () => {
    setup(AUTO_JOBS);
    fireEvent.click(tab('Auto'));
    expect(localStorage.getItem('gc.jobs.tab')).toBe('auto');
    cleanup();
    setup(AUTO_JOBS);
    expect(tab('Auto')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: /^Working ·/ })).toBeInTheDocument();
    fireEvent.click(tab('Yours'));
    expect(localStorage.getItem('gc.jobs.tab')).toBeNull();
    expect(document.querySelector('.jobs-board')).not.toBeNull();
    cleanup();
    // Remembered even with no Auto job today: Auto 0, and its empty lines.
    localStorage.setItem('gc.jobs.tab', 'auto');
    setup();
    expect(tab('Auto')).toHaveAttribute('aria-selected', 'true');
    expect(count('Auto')).toBe('0');
    expect(screen.getByText('No Auto job is working.')).toBeInTheDocument();
  });

  it('the layout switch shows under Yours only', () => {
    setup(AUTO_JOBS, 'full');
    expect(screen.getByRole('radiogroup', { name: 'Jobs layout' })).toBeInTheDocument();
    fireEvent.click(tab('Auto'));
    expect(screen.queryByRole('radiogroup', { name: 'Jobs layout' })).toBeNull();
    fireEvent.click(tab('Yours'));
    expect(screen.getByRole('radiogroup', { name: 'Jobs layout' })).toBeInTheDocument();
  });

  it('the bar\'s three calls are not hidden for an Auto job', async () => {
    const GATE: Gate = {
      briefNumber: 2, briefFile: 'briefs/002-plan.md', headline: 'Plan v2 ready', stage: 'plan', nextStage: 'implement', nextProposed: 'Build step 1',
      questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: '2026-10-21T09:00:00Z', runActive: false, parked: false,
      level: 1, suggestedLevel: null, levelReason: null, usage: null,
    };
    // Waiting at the plan's gate: stopped (Needs you), deciding (Working), set aside (Needs you), and at Ready.
    const waits = (slug: string, title: string, extra: Partial<Job>) => job(slug, 'needs-you', { title, stage: 'plan', lane: 'needs-you', waitingFor: 'approval', headline: 'The plan is ready. Start building?', ...extra });
    const jobs: Job[] = [
      waits('a-stop', 'Auto stopped here', { laneReason: 'Auto stopped: the Foreman says it is blocked', auto: { on: true, ran: true, stopped: { reason: 'the Foreman says it is blocked' }, group: 'needs-you' } }),
      waits('a-deciding', 'Auto decides this', { lane: 'working', laneReason: 'Auto is deciding: the plan', auto: { on: true, ran: true, group: 'working' } }),
      waits('a-wait', 'Auto waits to test', { lane: 'working', laneReason: 'Waiting for its turn to test', auto: { on: true, ran: true, group: 'working', waitingToTest: true } }),
      waits('a-big', 'Auto set this aside', { auto: { on: false, ran: true, tooBig: { at: '2026-10-21T09:00:00Z', reason: 'Big.' }, group: 'needs-you' } }),
      waits('a-ready', 'Auto finished this', { auto: { on: false, ran: true, finished: '2026-10-21T09:00:00Z', risky: 1, group: 'ready' } }),
    ];
    for (const hosted of [false, true]) {
      localStorage.setItem('gc.jobs.tab', 'auto');
      const store: Store = createStore();
      store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs, meta: { token: 't', settings: { play: { mode: 'subtle' } } } as never }) });
      const get = vi.fn(async (path: string): Promise<unknown> => {
        if (path.endsWith('/evidence')) return { runs: [] };
        if (path.startsWith('/api/review')) return null;
        const slug = path.split('/')[3];
        return { slug, thread: [], threadMore: false, gate: GATE, answeredBriefs: [], heldReply: null, options: { level: 1 }, page: undefined, queued: null } as unknown as JobDetail;
      });
      const api = { get, post: vi.fn(async () => ({ ok: true })), ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
      render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><JobsPage /></UiProvider></WorkshopContext.Provider>);
      const autoTab = document.querySelector<HTMLElement>('.sb-auto-tab')!;
      expect(autoTab).not.toBeNull();
      for (const j of jobs) {
        // From its place on the Auto tab, the quick look has the job's bar.
        fireEvent.keyDown(within(autoTab).getByRole('link', { name: j.title }), { key: ' ' });
        const peek = screen.getByRole('dialog', { name: `${j.title}: a quick look` });
        await waitFor(() => expect(peek.querySelector('[data-gate="approve"]')).not.toBeNull());
        const bar = within(peek).getByRole('region', { name: 'Next step' });
        for (const name of [/^No go: send back/, 'Reply', /^Go: /] as const) {
          await waitFor(() => expect(within(bar).getByRole('button', { name }), `${j.title}${hosted ? ', website' : ''}`).toBeEnabled());
        }
        fireEvent.keyDown(window, { key: 'Escape' });
      }
      cleanup();
      localStorage.clear();
    }
  }, 30_000);
});

describe('Jobs: Yours and Auto, review fixes', () => {
  const yourWorking = job('beta', 'running', { title: 'Technician photo', stage: 'implement', lane: 'working', laneReason: 'Building step 3' });
  const yourWaiting = job('alpha', 'needs-you', { title: 'Customer notes', stage: 'plan', lane: 'needs-you', waitingFor: 'approval', waitingSince: '2026-10-21T09:00:00Z' });
  const autoWorking = job('a-work', 'running', { title: 'Auto builds this', stage: 'implement', lane: 'working', laneReason: 'Building step 2', auto: { on: true, ran: true, group: 'working' } });
  const autoStopped = job('a-stop', 'needs-you', { title: 'Auto stopped here', stage: 'plan', lane: 'needs-you', laneReason: 'Auto stopped: the Foreman says it is blocked', waitingFor: 'approval', waitingSince: '2026-10-21T07:00:00Z', auto: { on: true, ran: true, stopped: { reason: 'the Foreman says it is blocked' }, group: 'needs-you' } });
  const olderLaptop = job('a-none', 'running', { title: 'From an older laptop', stage: 'implement', lane: 'working', auto: { on: true, ran: true } });
  const tab = (name: string) => screen.getByRole('tab', { name });
  const bar = () => screen.getByRole('region', { name: 'Next step' });

  it('one bar on both tabs: with nothing of yours waiting it points at a stopped Auto job, and o opens it', () => {
    setup([yourWorking, autoWorking, autoStopped]);
    expect(bar()).toHaveTextContent('Auto stopped here needs you');
    expect(bar()).toHaveTextContent('It is the only one.');
    expect(screen.queryByText('Nothing needs you right now')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(window.location.hash).toBe('#/job/a-stop');
    window.location.hash = '#/';
    fireEvent.click(tab('Auto'));
    expect(bar()).toHaveTextContent('Auto stopped here needs you');
    expect(within(bar()).getByRole('link', { name: /Open/ })).toHaveAttribute('href', '#/job/a-stop');
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(window.location.hash).toBe('#/job/a-stop');
  });

  it('with nothing waiting anywhere the quiet line shows on both tabs', () => {
    setup([yourWorking, autoWorking]);
    expect(bar()).toHaveTextContent('Nothing needs you right now');
    fireEvent.click(tab('Auto'));
    expect(bar()).toHaveTextContent('Nothing needs you right now');
    expect(within(bar()).queryByRole('link')).toBeNull();
  });

  it('one of yours and one of Auto\'s waiting: yours comes first and the count is 2', () => {
    setup([yourWorking, yourWaiting, autoStopped]);
    for (const name of ['Yours', 'Auto']) {
      fireEvent.click(tab(name));
      expect(bar()).toHaveTextContent('Customer notes needs you');
      expect(bar()).toHaveTextContent('2 jobs need you.');
    }
  });

  it('the station under Yours has no bay for an Auto job; the older laptop\'s job has one', () => {
    localStorage.setItem('gc.jobs.layout', 'floor');
    setWebGLForTests(true);
    vi.mocked(loadScene).mockReset().mockResolvedValue({ createFloorScene: () => fakeScene() } as never);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    try {
      setup([yourWorking, autoWorking, olderLaptop], 'full');
      const floor = screen.getByRole('region', { name: 'The station' });
      expect(within(floor).getByRole('link', { name: /Technician photo/ })).toBeInTheDocument();
      expect(within(floor).getByRole('link', { name: /From an older laptop/ })).toBeInTheDocument();
      expect(within(floor).queryByRole('link', { name: /Auto builds this/ })).toBeNull();
    } finally { setWebGLForTests(null); vi.restoreAllMocks(); }
  });

  it('One list under Yours leaves Auto\'s jobs out; the older laptop\'s job is in it', () => {
    localStorage.setItem('gc.jobs.layout', 'list');
    setup([yourWorking, autoWorking, olderLaptop]);
    const rows = [...document.querySelectorAll('.jobs-list-row .job-card-title')].map((a) => a.textContent);
    expect(rows).toEqual(['Technician photo', 'From an older laptop']);
  });

  it('after a reload the quick look never shows a job from the other tab', () => {
    localStorage.setItem('gc.jobs.tab', 'auto');
    window.location.hash = '#/?peek=beta';
    setup([yourWorking, autoWorking]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe('#/');
    cleanup();
    localStorage.removeItem('gc.jobs.tab');
    window.location.hash = '#/?peek=a-work';
    setup([yourWorking, autoWorking]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe('#/');
    cleanup();
    // Its own tab's job still opens.
    localStorage.setItem('gc.jobs.tab', 'auto');
    window.location.hash = '#/?peek=a-work';
    setup([yourWorking, autoWorking]);
    expect(screen.getByRole('dialog', { name: 'Auto builds this: a quick look' })).toBeInTheDocument();
  });

  it('at phone width the Auto tab\'s cards and rows open their job, with no quick look', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: /max-width:\s*760px/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
    try {
      localStorage.setItem('gc.jobs.tab', 'auto');
      setup([yourWorking, autoWorking, autoStopped]);
      for (const name of ['Auto builds this', 'Auto stopped here']) {
        const link = within(document.querySelector<HTMLElement>('.sb-auto-tab')!).getByRole('link', { name });
        expect(link).toHaveAttribute('href', `#/job/${name === 'Auto builds this' ? 'a-work' : 'a-stop'}`);
        expect(link.closest('li')).not.toHaveClass('can-peek');
        fireEvent.keyDown(link, { key: ' ' });
        fireEvent.click(link.closest('li')!);
        expect(screen.queryByRole('dialog')).toBeNull();
      }
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('Jobs: the bar says "waited longest" only when it is true', () => {
  const mine = (since: string) => job('alpha', 'needs-you', { title: 'Customer notes', stage: 'plan', lane: 'needs-you', waitingFor: 'approval', waitingSince: since });
  const autoStopped = job('a-stop', 'needs-you', { title: 'Auto stopped here', stage: 'plan', lane: 'needs-you', laneReason: 'Auto stopped: the Foreman says it is blocked', waitingFor: 'approval', waitingSince: '2026-10-21T08:00:00Z', auto: { on: true, ran: true, stopped: { reason: 'the Foreman says it is blocked' }, group: 'needs-you' } });
  const sub = () => screen.getByRole('region', { name: 'Next step' }).querySelector('.next-sub')!.textContent ?? '';

  it('yours waited a short time and a stopped Auto job longer: yours is named, and the line stops after the count', () => {
    setup([mine('2026-10-21T09:00:00Z'), autoStopped]);
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('Customer notes needs you');
    expect(sub()).toMatch(/2 jobs need you\.$/);
    expect(sub()).not.toContain('This one has waited longest.');
  });

  it('yours waited longer than the Auto job: the full sentence', () => {
    setup([mine('2026-10-21T07:00:00Z'), autoStopped]);
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('Customer notes needs you');
    expect(sub()).toMatch(/2 jobs need you\. This one has waited longest\.$/);
  });
});

// The search (home/JobSearch.tsx; 16 Nov).
describe('finding a job', () => {
  beforeEach(() => { window.location.hash = '#/'; });

  it('/ puts the focus in the box; words show the matches in place of the board; ↓ and Enter open one; Escape clears', () => {
    const off = installKeyListener();
    setup();
    fireEvent.keyDown(document.body, { key: '/' });
    const box = screen.getByRole('searchbox', { name: 'Find a job' });
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: 'email' } });
    const list = screen.getByRole('listbox', { name: 'Matching jobs' });
    expect(within(list).getAllByRole('option').map((o) => o.querySelector('.job-card-title')?.textContent)).toEqual(['Weekly hours email', 'Cancellation email']);
    expect(screen.getByRole('status')).toHaveTextContent('2 of 7 jobs');
    expect(screen.queryByRole('region', { name: 'Working, 1' })).toBeNull();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(within(list).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(window.location.hash).toBe('#/job/delta');
    window.location.hash = '#/';
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveValue('');
    expect(screen.getByRole('region', { name: 'Working, 1' })).toBeInTheDocument();
    off();
  });

  it('finds Resting and Done jobs too, and says so when nothing matches', () => {
    setup();
    const box = screen.getByRole('searchbox', { name: 'Find a job' });
    fireEvent.change(box, { target: { value: 'shipped' } });
    expect(screen.getByRole('link', { name: 'Shipped thing' })).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'zebra' } });
    expect(screen.getByRole('status')).toHaveTextContent('No job has “zebra”.');
  });
});

describe('missing moves on Jobs (16 Nov)', () => {
  const card = (title: string) => screen.getByRole('link', { name: title }).closest('li')!;
  const peekOf = () => screen.queryByRole('dialog', { name: /a quick look$/ });
  beforeEach(() => { sessionStorage.clear(); });

  it('a second click on the same card closes its quick look; a click on another card switches it', () => {
    setup();
    fireEvent.click(card('Technician photo'));
    expect(peekOf()).toHaveAccessibleName('Technician photo: a quick look');
    fireEvent.click(card('Gate code'));
    expect(peekOf()).toHaveAccessibleName('Gate code: a quick look');
    fireEvent.click(card('Gate code'));
    expect(peekOf()).toBeNull();
    expect(window.location.hash).not.toContain('peek=');
  });

  it('Escape after a click gives the focus to that card’s title, not to the page', () => {
    setup();
    fireEvent.click(card('Technician photo'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(peekOf()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Technician photo' }));
  });

  it('a press on the page outside the quick look closes it; one inside it, or on a card, does not', () => {
    setup();
    fireEvent.click(card('Technician photo'));
    fireEvent.mouseDown(peekOf()!);
    expect(peekOf()).not.toBeNull();
    fireEvent.mouseDown(card('Gate code'));
    expect(peekOf()).not.toBeNull();
    fireEvent.mouseDown(screen.getByRole('heading', { level: 2 }));
    expect(peekOf()).toBeNull();
  });

  it('the words in the find box are still there when he comes back to Jobs', () => {
    const first = setup();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a job' }), { target: { value: 'email' } });
    first.unmount();
    setup();
    expect(screen.getByRole('searchbox', { name: 'Find a job' })).toHaveValue('email');
    expect(within(screen.getByRole('listbox', { name: 'Matching jobs' })).getAllByRole('option')).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Find a job' }), { key: 'Escape' });
    cleanup();
    setup();
    expect(screen.getByRole('searchbox', { name: 'Find a job' })).toHaveValue('');
  });

  it('the page’s scroll is where he left it when he comes back', () => {
    const tops = new WeakMap<Element, number>();
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get() { return tops.get(this) ?? 0; }, set(v: number) { tops.set(this, v); } });
    try {
      const first = setup();
      const main = document.querySelector<HTMLElement>('main.page')!;
      main.scrollTop = 640;
      fireEvent.scroll(main);
      first.unmount();
      setup();
      expect(document.querySelector<HTMLElement>('main.page')!.scrollTop).toBe(640);
    } finally {
      Object.defineProperty(Element.prototype, 'scrollTop', desc);
    }
  });
});
