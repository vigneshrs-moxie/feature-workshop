import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { EvidenceView, Gate, JobDetail } from '../../api/types';
import { UiProvider } from '../../app/ui';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job, LEVELS, REVIEWERS, snapshot } from '../../state/test-fixtures';
import { EvidenceStrip, resultOf } from './EvidenceStrip';
import { GateSlot } from './GateCard';

// An invented job and its evidence; no real job names.
const EVIDENCE: NonNullable<EvidenceView['evidence']> = {
  version: 1, commit: 'abc1234def5', at: '2026-10-28T12:00:00.000Z', level: 2,
  criteria: [
    {
      id: 'AC-1', title: 'Managers see the Hours column', status: 'passed', reason: null, spec: 'evidence/specs/AC-1.spec.mjs',
      screenshots: [
        { file: 'abc1234def5/AC-1/01.png', description: 'The home page, signed in as the dev user' },
        { file: 'abc1234def5/AC-1/02.png', description: 'The Team page, with the Hours column next to Name' },
      ],
      video: 'abc1234def5/AC-1/video.webm',
    },
    {
      id: 'AC-2', title: 'The export button is hidden from technicians', status: 'failed', reason: 'expect(locator).toBeHidden() failed', spec: 'evidence/specs/AC-2.spec.mjs',
      screenshots: [{ file: 'abc1234def5/AC-2/01.png', description: 'How the page looked when the check ended' }], video: 'abc1234def5/AC-2/video.webm',
    },
    { id: 'AC-3', title: 'The export API refuses other offices', status: 'skipped', reason: 'Nothing to see: API only; the route test covers it.', spec: null, screenshots: [], video: null },
  ],
};
const VIEW: EvidenceView = {
  evidence: EVIDENCE, commit: 'abc1234def5', wanted: true, why: 'Evidence is recorded at L2.', recording: false, problem: null,
  folder: '/home/me/feature-work/alpha/evidence/abc1234def5', folderUrl: 'file:///home/me/feature-work/alpha/evidence/abc1234def5/',
};

function setup({ view = VIEW, get = vi.fn(async (): Promise<unknown> => view), post = vi.fn(), tested = null as string | null } = {}) {
  const store: Store = createStore();
  const api = { get, post } as unknown as ApiClient;
  const utils = render(
    <WorkshopContext.Provider value={{ store, api }}>
      <EvidenceStrip slug="alpha" tested={tested} />
    </WorkshopContext.Provider>,
  );
  return { ...utils, get, post };
}

const strip = () => screen.queryByRole('region', { name: /^Evidence/ });
const rows = () => within(strip()!).getAllByRole('listitem').filter((li) => li.classList.contains('evidence-row'));

afterEach(() => { vi.restoreAllMocks(); });

describe('EvidenceStrip', () => {
  it('shows one row per acceptance line: its id, its title and its result in words with an icon', async () => {
    const { get } = setup();
    await screen.findByRole('region', { name: /^Evidence at abc1234/ });
    expect(get).toHaveBeenCalledWith('/api/job/alpha/evidence');
    const [one, two, three] = rows();
    expect(one.textContent).toContain('AC-1');
    expect(one.textContent).toContain('Managers see the Hours column');
    expect(within(one).getByText('Passed')).toBeTruthy();
    expect(within(two).getByText('Failed')).toBeTruthy();
    expect(two.textContent).toContain('expect(locator).toBeHidden() failed');
    expect(within(three).getByText('Not recorded: nothing to see')).toBeTruthy();
    expect(three.textContent).toContain('API only; the route test covers it.');
    // The icon is never the only sign, and is hidden from screen readers.
    for (const r of [one, two, three]) expect(r.querySelector('.evidence-result [aria-hidden="true"]')).not.toBeNull();
    expect(strip()!.textContent).toContain('1 passed, 1 failed, 1 not recorded');
    expect(resultOf({ status: 'skipped', spec: 'evidence/specs/AC-4.spec.mjs' }).word).toBe('Skipped');
  });

  it('shows the first picture small with its words, and opens the rest, each with its words', async () => {
    setup();
    await screen.findByRole('region', { name: /^Evidence/ });
    const [one] = rows();
    const thumb = within(one).getByRole('button', { name: /Open all 2 pictures/ });
    const img = within(thumb).getByRole('img', { name: 'The home page, signed in as the dev user' });
    expect(img.getAttribute('src')).toBe('/api/job/alpha/evidence/file?path=abc1234def5%2FAC-1%2F01.png');
    expect(thumb.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(thumb);
    expect(thumb.getAttribute('aria-expanded')).toBe('true');
    const shots = within(one).getByRole('list', { name: 'Pictures of AC-1' });
    expect(within(shots).getByText(/2\. The Team page, with the Hours column next to Name/)).toBeTruthy();
    expect(within(shots).getAllByRole('img').map((i) => i.getAttribute('alt'))).toEqual(['The home page, signed in as the dev user', 'The Team page, with the Hours column next to Name']);
    // Every picture in the strip has words.
    for (const i of strip()!.querySelectorAll('img')) expect(i.getAttribute('alt')).toBeTruthy();
  });

  it('plays the video in the card, named for its line', async () => {
    setup();
    await screen.findByRole('region', { name: /^Evidence/ });
    const [one] = rows();
    expect(one.querySelector('video')).toBeNull();
    fireEvent.click(within(one).getByRole('button', { name: 'Play video' }));
    const video = one.querySelector('video')!;
    expect(video.getAttribute('src')).toBe('/api/job/alpha/evidence/file?path=abc1234def5%2FAC-1%2Fvideo.webm');
    expect(video.getAttribute('aria-label')).toBe('The recording of AC-1: Managers see the Hours column');
    expect(within(one).getByRole('button', { name: 'Hide video' })).toBeTruthy();
    expect(within(rows()[2]).queryByRole('button', { name: 'Play video' }), 'nothing to see: no video').toBeNull();
  });

  it('Copy link copies the evidence folder’s address for the ticket', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();
    await screen.findByRole('region', { name: /^Evidence/ });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })); });
    expect(writeText).toHaveBeenCalledWith('file:///home/me/feature-work/alpha/evidence/abc1234def5/');
    expect(screen.getByRole('status').textContent).toBe('Link copied. Paste it on the ticket.');
  });

  it('evidence for an older commit says so, and can be recorded again for the commit now', async () => {
    const post = vi.fn(async () => ({ ...VIEW, ok: true, started: true, recording: true, evidence: EVIDENCE, commit: 'fed9876cba1' }));
    setup({ view: { ...VIEW, commit: 'fed9876cba1' }, post });
    await screen.findByRole('region', { name: /^Evidence/ });
    expect(screen.getByText('From an earlier commit (abc1234)')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Record again' })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/evidence/record', {});
    expect(screen.getByText(/Recording the evidence now/)).toBeTruthy();
  });

  it('the gate’s proof stamp decides which commit counts as now', async () => {
    setup({ tested: 'fed9876cba1' });
    await screen.findByRole('region', { name: /^Evidence/ });
    expect(screen.getByText('From an earlier commit (abc1234)')).toBeTruthy();
  });

  it('for the commit now, it offers no Record again; a refusal says why in the dashboard’s words', async () => {
    setup();
    await screen.findByRole('region', { name: /^Evidence/ });
    expect(screen.queryByRole('button', { name: /Record/ })).toBeNull();
    expect(screen.queryByText(/From an earlier commit/)).toBeNull();

    const post = vi.fn(async () => { throw new ApiError(503, 'The local database copy isn’t running. Start it from Try it, then press Record again.'); });
    setup({ view: { ...VIEW, evidence: null }, post });
    const button = await screen.findByRole('button', { name: 'Record' });
    await act(async () => { fireEvent.click(button); });
    expect(screen.getByText('The local database copy isn’t running. Start it from Try it, then press Record again.')).toBeTruthy();
  });

  it('Record spins on the click and cannot be pressed twice', async () => {
    let answer: () => void = () => {};
    const post = vi.fn(() => new Promise((res) => { answer = () => res({ ...VIEW, ok: true, started: true, recording: true }); }));
    setup({ view: { ...VIEW, evidence: null }, post });
    const record = await screen.findByRole('button', { name: 'Record' });
    fireEvent.click(record);
    fireEvent.click(record);
    expect(record).toHaveAttribute('aria-busy', 'true');
    expect(record.querySelector('.spin-ring')).not.toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => { answer(); });
    expect(screen.getByText(/Recording the evidence now/)).toBeTruthy();
  });

  it('a recording that couldn’t finish shows what to do and the line to run', async () => {
    setup({ view: { ...VIEW, evidence: null, problem: { commit: 'abc1234def5', message: 'Playwright’s Chromium isn’t installed on this computer. Run npx playwright install chromium, then press Record again.', fix: 'Run npx playwright install chromium', at: '2026-10-28T12:00:00Z' } } });
    await screen.findByRole('region', { name: /^Evidence/ });
    expect(screen.getByText('Run npx playwright install chromium', { selector: 'code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record again' })).toBeTruthy();
  });

  it('shows nothing for a job that records no evidence (an L0 tweak)', async () => {
    const get = vi.fn(async () => ({ ...VIEW, evidence: null, wanted: false, why: 'An L0 tweak never records evidence.' }));
    const { container } = setup({ get });
    await act(async () => {});
    expect(get).toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });

  it('every control is a button or a link, so Tab reaches it', async () => {
    setup();
    await screen.findByRole('region', { name: /^Evidence/ });
    fireEvent.click(within(rows()[0]).getByRole('button', { name: /Open all 2 pictures/ }));
    const controls = strip()!.querySelectorAll('button, a, [tabindex]');
    expect(controls.length).toBeGreaterThan(0);
    for (const el of controls) expect(['BUTTON', 'A']).toContain(el.tagName);
    for (const el of controls) expect(el.getAttribute('tabindex')).not.toBe('-1');
  });
});

// The slot on the gate card: the test gate and every later one show the strip; earlier ones don't.
const GATE: Gate = {
  briefNumber: 5, briefFile: 'briefs/005-test.md', headline: 'Checks done', stage: 'test', nextStage: 'review', nextProposed: 'Review',
  questions: [], decided: [], versions: null, raisedVersions: null, stale: false, waitingSince: null, runActive: false, parked: false,
  level: 2, suggestedLevel: null, levelReason: null, usage: null, proof: { tested: 'abc1234def5', head: 'abc1234def5', stale: false, reportAt: null },
};
const detail = (gate: Partial<Gate>): JobDetail => ({
  slug: 'alpha', thread: [], threadMore: false, options: { level: 2 }, statusForCompose: { questions: [], decidedOnYourBehalf: [], nextProposed: 'Review', spec: null, artifacts: [], brief: { number: 5 } },
  drive: { mode: 'workshop', model: 'claude-opus-5-5' }, gate: { ...GATE, ...gate }, answeredBriefs: [], heldReply: null,
});

function gateSetup(d: JobDetail) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', levels: LEVELS, models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }], jobOptions: { reviewers: REVIEWERS } }, jobs: [job('alpha', 'needs-you', { level: 2 })] }) });
  const get = vi.fn(async (p: string): Promise<unknown> => (p.endsWith('/evidence') ? VIEW : null));
  const api = { get, post: vi.fn() } as unknown as ApiClient;
  render(
    <WorkshopContext.Provider value={{ store, api }}>
      <UiProvider>
        <GateSlot job={store.getState().jobs[0]} detail={d} now={new Date()} reload={vi.fn()} />
      </UiProvider>
    </WorkshopContext.Provider>,
  );
  return { get };
}

describe('the gate card’s evidence slot', () => {
  it('shows the strip at the test gate and at a later gate', async () => {
    gateSetup(detail({ stage: 'test' }));
    expect(await screen.findByRole('region', { name: /^Evidence: 1 passed, 1 failed, 1 not recorded$/ })).toBeTruthy();
  });

  it('shows it at the review gate too', async () => {
    gateSetup(detail({ stage: 'review', nextStage: 'pr1' }));
    expect(await screen.findByRole('region', { name: /^Evidence: 1 passed, 1 failed, 1 not recorded$/ })).toBeTruthy();
  });

  it('shows nothing before the test gate', async () => {
    const { get } = gateSetup(detail({ stage: 'plan', nextStage: 'implement', proof: null }));
    await act(async () => {});
    expect(screen.queryByRole('region', { name: /^Evidence/ })).toBeNull();
    expect(get.mock.calls.some(([p]) => String(p).endsWith('/evidence'))).toBe(false);
  });
});

// Task 8 (design 3.3): on the gate card the evidence folds to one line with its counts.
describe('the evidence folded to one line', () => {
  function foldSetup(view: EvidenceView, post = vi.fn()) {
    const store: Store = createStore();
    const get = vi.fn(async (): Promise<unknown> => view);
    const api = { get, post } as unknown as ApiClient;
    const utils = render(<WorkshopContext.Provider value={{ store, api }}><EvidenceStrip slug="alpha" fold /></WorkshopContext.Provider>);
    return { ...utils, get, post };
  }
  const recorded = (over: Partial<NonNullable<EvidenceView['evidence']>> = {}): EvidenceView => ({ ...VIEW, commit: 'c3e8a51ff', evidence: { ...EVIDENCE, commit: 'c3e8a51ff', at: new Date(Date.now() - 40 * 60_000).toISOString(), ...over } });

  it('the evidence is one line with its counts until it is opened', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { unmount } = foldSetup(recorded());
    const region = await screen.findByRole('region', { name: 'Evidence: 1 passed, 1 failed, 1 not recorded' });
    expect(region).toHaveTextContent('recorded 40 min ago for commit c3e8a51');
    const toggle = within(region).getByRole('button', { name: 'Show' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Closed: no rows, no Copy link.
    expect(within(region).queryByRole('list', { name: 'Each acceptance line' })).toBeNull();
    expect(within(region).queryByRole('button', { name: 'Copy link' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent('Hide');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(region).getByRole('list', { name: 'Each acceptance line' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(region).getByRole('button', { name: 'Copy link' })); });
    expect(writeText).toHaveBeenCalledWith(VIEW.folderUrl);
    unmount();
    // Every line recorded: no "not recorded".
    const passed = foldSetup(recorded({ criteria: EVIDENCE.criteria.slice(0, 2) }));
    expect(await screen.findByRole('region', { name: 'Evidence: 1 passed, 1 failed' })).toBeInTheDocument();
    passed.unmount();
    // For an older commit, Record again is inside and records.
    const post = vi.fn(async () => ({ ...VIEW, ok: true, started: true, recording: true, evidence: EVIDENCE, commit: 'fed9876cba1' }));
    foldSetup({ ...VIEW, commit: 'fed9876cba1' }, post);
    const older = await screen.findByRole('region', { name: /^Evidence: 1 passed/ });
    // An earlier commit's evidence opens by itself (fix round 1, M4).
    expect(within(older).getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
    await act(async () => { fireEvent.click(within(older).getByRole('button', { name: 'Record again' })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/evidence/record', {});
  });

  it('while it records the line says the line number', async () => {
    const progress = { commit: 'abc1234def5', startedAt: new Date().toISOString(), line: 4, of: 19, lines: [] };
    const first = foldSetup({ ...VIEW, recording: true, progress });
    expect(await screen.findByRole('region', { name: 'Evidence: recording, line 4 of 19' })).toBeInTheDocument();
    first.unmount();
    // Nothing recorded yet: says so, and Record is inside.
    const post = vi.fn(async () => ({ ...VIEW, ok: true, started: true, recording: true, evidence: null }));
    foldSetup({ ...VIEW, evidence: null }, post);
    const none = await screen.findByRole('region', { name: 'Evidence: not recorded yet' });
    fireEvent.click(within(none).getByRole('button', { name: 'Show' }));
    await act(async () => { fireEvent.click(within(none).getByRole('button', { name: 'Record' })); });
    expect(post).toHaveBeenCalledWith('/api/job/alpha/evidence/record', {});
    expect(screen.getByRole('region', { name: /^Evidence: recording/ })).toBeInTheDocument();
  });
});

describe('the folded evidence opens by itself when something is wrong', () => {
  function foldSetup(view: EvidenceView) {
    const store: Store = createStore();
    const api = { get: vi.fn(async (): Promise<unknown> => view), post: vi.fn() } as unknown as ApiClient;
    return render(<WorkshopContext.Provider value={{ store, api }}><EvidenceStrip slug="alpha" fold /></WorkshopContext.Provider>);
  }

  it('evidence for an earlier commit, or a recording that failed, starts open; Hide still folds it', async () => {
    const first = foldSetup({ ...VIEW, commit: 'fed9876cba1' });
    const older = await screen.findByRole('region', { name: 'Evidence: 1 passed, 1 failed, 1 not recorded' });
    expect(within(older).getByText('From an earlier commit (abc1234)')).toBeVisible();
    const hide = within(older).getByRole('button', { name: 'Hide' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(hide);
    expect(within(older).getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(older).getByText('From an earlier commit (abc1234)')).not.toBeVisible();
    first.unmount();
    const problem = { commit: 'abc1234def5', message: 'Playwright’s Chromium isn’t installed on this computer.', fix: 'Run npx playwright install chromium', at: '2026-10-28T12:00:00Z' };
    const second = foldSetup({ ...VIEW, evidence: null, problem });
    const none = await screen.findByRole('region', { name: 'Evidence: not recorded yet' });
    expect(within(none).getByText('Playwright’s Chromium isn’t installed on this computer.', { exact: false })).toBeVisible();
    expect(within(none).getByRole('button', { name: 'Record again' })).toBeInTheDocument();
    second.unmount();
    // Evidence for the commit now, with no problem: closed.
    foldSetup(VIEW);
    const now = await screen.findByRole('region', { name: 'Evidence: 1 passed, 1 failed, 1 not recorded' });
    expect(within(now).getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
  });
});

// Task 8, follow-up round: Record again never folds the evidence over the button he pressed.
describe('Record again inside the open fold', () => {
  it('a failed recording opens the fold; Record again keeps it open and shows the recording note', async () => {
    const problem = { commit: 'abc1234def5', message: 'Playwright’s Chromium isn’t installed on this computer.', fix: null, at: '2026-10-28T12:00:00Z' };
    const post = vi.fn(async () => ({ ...VIEW, evidence: null, problem: null, ok: true, started: true, recording: true }));
    const store: Store = createStore();
    const api = { get: vi.fn(async (): Promise<unknown> => ({ ...VIEW, evidence: null, problem })), post } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store, api }}><EvidenceStrip slug="alpha" fold /></WorkshopContext.Provider>);
    const region = await screen.findByRole('region', { name: 'Evidence: not recorded yet' });
    const again = within(region).getByRole('button', { name: 'Record again' });
    expect(again).toBeVisible();
    await act(async () => { fireEvent.click(again); });
    const recording = screen.getByRole('region', { name: /^Evidence: recording/ });
    expect(within(recording).getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(recording).getByText('Recording now. The rows fill in when it is done.')).toBeVisible();
  });
});

// The new job page asks for the evidence once and hands the view to every strip on it.
describe('a strip given the page’s evidence view', () => {
  function shared(view: EvidenceView | null, post = vi.fn(async (): Promise<unknown> => ({ ...VIEW, evidence: null, recording: true, started: true }))) {
    const get = vi.fn(async (): Promise<unknown> => VIEW);
    const api = { get, post } as unknown as ApiClient;
    const ui = (v: EvidenceView | null) => <WorkshopContext.Provider value={{ store: createStore(), api }}><EvidenceStrip slug="alpha" view={v} /></WorkshopContext.Provider>;
    const utils = render(ui(view));
    return { ...utils, get, post, rerenderWith: (v: EvidenceView | null) => utils.rerender(ui(v)) };
  }

  it('draws the view it is given and asks for nothing, not even while it records', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const { get, rerenderWith } = shared(null);
      await act(async () => {});
      expect(strip()).toBeNull();
      rerenderWith({ ...VIEW, evidence: null, recording: true, progress: { commit: 'abc1234def5', startedAt: '2026-10-28T12:00:00.000Z', line: 1, of: 3, lines: [] } });
      expect(strip()).toHaveTextContent('Recording the evidence now');
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      rerenderWith(VIEW);
      expect(rows()).toHaveLength(3);
      expect(get).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Record shows the answer until the page’s view next changes', async () => {
    const problem = { ...VIEW, problem: { message: 'The app stopped before the recording finished.', fix: null } } as EvidenceView;
    const { post, get, rerenderWith } = shared(problem);
    fireEvent.click(screen.getByRole('button', { name: 'Record again' }));
    expect(await screen.findByText(/Recording the evidence now/)).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/job/alpha/evidence/record', {});
    rerenderWith(VIEW);
    expect(screen.queryByText(/Recording the evidence now/)).toBeNull();
    expect(rows()).toHaveLength(3);
    expect(get).not.toHaveBeenCalled();
  });
});

// On the website (the hosted client): Record and Copy link only work on the laptop, and a video plays
// only once the laptop has put it on the site (the evidence answer's onSite list).
describe('the strip on the website', () => {
  function hosted(view: EvidenceView, post = vi.fn()) {
    const store: Store = createStore();
    const api = { get: vi.fn(async () => view), post, hosted: () => true } as unknown as ApiClient;
    render(<WorkshopContext.Provider value={{ store, api }}><EvidenceStrip slug="alpha" /></WorkshopContext.Provider>);
    return { post };
  }
  // As hosted/site/routes-files.js answers it: no folder, and the files on the site.
  const SITE = { ...VIEW, folder: null, folderUrl: null, hosted: true, watch: false, onSite: ['abc1234def5/AC-1/01.png', 'abc1234def5/AC-1/video.webm'] } as unknown as EvidenceView;

  it('offers no Copy link and no Record again', async () => {
    hosted({ ...SITE, commit: 'fed9876cba1', problem: { commit: 'fed9876cba1', message: 'The app stopped before the recording finished.', fix: null, at: '2026-10-28T12:00:00.000Z' } });
    await screen.findByRole('region', { name: /^Evidence/ });
    expect(screen.getByText('From an earlier commit (abc1234)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Record/ })).toBeNull();
    cleanup();
    hosted({ ...SITE, evidence: null });
    await screen.findByRole('region', { name: /^Evidence/ });
    expect(screen.queryByRole('button', { name: /Record/ })).toBeNull();
  });

  it('offers Play video only for a video the site has', async () => {
    hosted(SITE);
    await screen.findByRole('region', { name: /^Evidence/ });
    const [one, two] = rows();
    expect(within(one).getByRole('button', { name: 'Play video' })).toBeTruthy();
    expect(within(two).queryByRole('button', { name: 'Play video' }), 'not uploaded yet').toBeNull();
    cleanup();
    // An answer with no list: nothing is known to be on the site.
    hosted({ ...SITE, onSite: undefined } as EvidenceView);
    await screen.findByRole('region', { name: /^Evidence/ });
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
  });
});

// What else the record says (dashboard/lib/evidence.js notes, laptop only): one quiet line each.
describe('a recording’s notes', () => {
  const NOTES = [
    'Auto’s app asked for the database app and Starbase refused it: Auto only uses its own copy.',
    'A setting in app/.env.local (LEGACY_JDBC) may be what names it.',
  ];
  const given = (view: EvidenceView, { fold = false } = {}) => render(<WorkshopContext.Provider value={{ store: createStore(), api: { get: vi.fn(), post: vi.fn() } as unknown as ApiClient }}><EvidenceStrip slug="alpha" view={view} fold={fold} /></WorkshopContext.Provider>);

  it('a recording’s notes show on the gate card with the evidence fold closed', () => {
    given({ ...VIEW, evidence: { ...EVIDENCE, notes: NOTES } }, { fold: true });
    const region = strip()!;
    const head = region.querySelector('.gate-evidence-head')!;
    expect(within(region).getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
    const lines = within(region).getAllByText(/^Note: /);
    expect(lines.map((l) => l.textContent)).toEqual(NOTES.map((n) => `Note: ${n}`));
    // Each its own plain line, in the strip's quiet notice style: no heading, no button, no icon.
    for (const l of lines) {
      expect(l.tagName).toBe('P');
      expect(l.className).toBe('muted gate-evidence-note');
      expect(l.children).toHaveLength(0);
    }
    // Directly under the fold's summary line, outside the folded body, so they show while it is closed.
    expect(head.nextElementSibling).toBe(lines[0]);
    expect(lines[0].nextElementSibling).toBe(lines[1]);
    expect(lines[1].nextElementSibling).toBe(region.querySelector('.sb-gate-evidence-body'));
    expect(within(region).queryByRole('heading', { name: /note/i })).toBeNull();
    // Opened, each still shows once, above the criteria.
    fireEvent.click(within(region).getByRole('button', { name: 'Show' }));
    const list = within(region).getByRole('list', { name: 'Each acceptance line' });
    expect(within(region).getAllByText(/^Note: /)).toHaveLength(NOTES.length);
    for (const l of lines) expect(l.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('no notes: nothing is rendered', () => {
    // The markup with React's own ids made the same, so two renders compare.
    const markup = (el: HTMLElement) => el.innerHTML.replace(/_r_[0-9a-z]+_/g, 'ID');
    // The open strip of the Test step, the gate card's fold closed, and that fold opened.
    for (const [fold, open] of [[false, false], [true, false], [true, true]]) {
      const draw = (view: EvidenceView) => {
        const r = given(view, { fold });
        if (open) fireEvent.click(within(strip()!).getByRole('button', { name: 'Show' }));
        return r;
      };
      const first = draw(VIEW);
      const before = markup(first.container);
      expect(before).not.toContain('Note:');
      first.unmount();
      // A record with an empty list is drawn exactly as one with none: no empty element, no extra space.
      const again = draw({ ...VIEW, evidence: { ...EVIDENCE, notes: [] } });
      expect(markup(again.container)).toBe(before);
      expect(again.container.querySelector('.gate-evidence-head')!.nextElementSibling!.className).toBe('sb-gate-evidence-body');
      again.unmount();
    }
  });
});
