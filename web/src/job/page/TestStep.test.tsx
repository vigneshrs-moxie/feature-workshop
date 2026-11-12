// The Test step's body (design 3.5): three kinds of test (the Tester's checks, the evidence Starbase
// records, your hand test), each with a state, a place and a time; Watch, the hidden browser live;
// Try it with What to check beside it; Starbase's recorder as a row and a feed in the open step.
// Invented jobs, agents and recordings only; no model, no browser, no network (fetch is a stub).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { EvidenceCriterion, EvidenceProgress, EvidenceView, Job, JobDetail, StageAgent, StageView } from '../../api/types';
import { UiProvider, useUi } from '../../app/ui';
import { createStore, WorkshopContext } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { StepPanel } from './StepPanel';
import { recorderAgent, TestStep } from './TestStep';
import { useEvidence } from './useEvidence';
import { WatchPicture } from './WatchPicture';

const NOW = new Date('2026-11-10T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const SLUG = 'pause-a-service';
const AUTO_LINE = 'Auto skips your hand test on this job. The recorded evidence still runs.';

const TESTING: Job = job(SLUG, 'running', { stage: 'test', lane: 'working', working: true, updatedAt: ago(1) });
const BUILDING: Job = job(SLUG, 'running', { stage: 'implement', lane: 'working', working: true });
const REVIEWING: Job = job(SLUG, 'running', { stage: 'review', lane: 'working', working: true });

const agent = (who: string, extra: Partial<StageAgent> = {}): StageAgent => ({
  who, role: 'ignored', model: 'Opus 5.5', doing: null, since: ago(24), lastAt: ago(18), status: 'done',
  terminal: { kind: who === 'conductor' ? 'continue' : 'watch', ready: true, why: null }, ref: who === 'conductor' ? 'foreman' : 'c4.tester', ...extra,
});
const tester = (extra: Partial<StageAgent> = {}) => agent('feature-tester', { model: 'Sonnet 5.5', doing: 'Ran the test plan’s checks', ...extra });

const TEST: StageView = {
  slug: SLUG, stop: 'test', label: 'Test', state: 'now', stateWords: 'Working now', since: ago(30), stages: ['test'],
  agents: [agent('conductor', { status: 'working', since: ago(30), lastAt: ago(1) })], finished: [tester()],
  terminalApp: 'iTerm', terminalApps: ['iTerm'],
  checks: { passed: 46, failed: 0, notRun: 0, at: ago(18) },
  handTest: { startedAt: ago(5) },
};

const TITLES = [
  'Office staff see Pause on a recurring service.', 'A technician doesn’t see Pause.', 'The Pause dialog offers 1 to 12 weeks.',
  'Office staff pause a weekly service for 3 weeks.', 'The next 3 weekly visits leave the route.',
];
const title = (i: number) => TITLES[i] ?? `Acceptance line ${i + 1}.`;

/** 19 lines: 1 to 3 passed (each with its video unless a video is left out), line 4 running, the rest waiting. */
function progress({ noVideo = [] as number[] } = {}): EvidenceProgress {
  return {
    commit: 'abc1234def', startedAt: ago(2), line: 4, of: 19,
    lines: Array.from({ length: 19 }, (_, i) => ({
      id: `AC-${i + 1}`, title: title(i),
      state: i < 3 ? 'passed' as const : i === 3 ? 'running' as const : 'waiting' as const,
      video: i < 3 && !noVideo.includes(i + 1) ? `abc1234/AC-${i + 1}/video.webm` : null,
      at: i < 4 ? ago(2 - i * 0.5) : null,
    })),
  };
}

const criterion = (n: number, status: EvidenceCriterion['status']): EvidenceCriterion => ({ id: `AC-${n}`, title: title(n - 1), status, reason: null, spec: `evidence/specs/AC-${n}.spec.mjs`, screenshots: [], video: null });

const EVIDENCE: EvidenceView = {
  evidence: { version: 1, commit: 'abc1234def', at: ago(40), level: 2, criteria: [...Array.from({ length: 17 }, (_, i) => criterion(i + 1, 'passed')), criterion(18, 'failed'), criterion(19, 'failed')] },
  commit: 'abc1234def', wanted: true, why: 'This job records evidence.', recording: false, problem: null, folder: '/tmp/evidence', folderUrl: 'file:///tmp/evidence',
};
const RECORDING: EvidenceView = { ...EVIDENCE, evidence: null, recording: true, progress: progress(), watch: true };

const DETAIL = {
  slug: SLUG, thread: [], threadMore: false,
  page: { check: { worksWhen: ['Picking 3 weeks takes the next 3 weekly visits off the route.'], mustNot: ['Charge for a paused visit.'] } },
} as JobDetail;

const LOCAL = { slug: SLUG, available: false, reason: 'The job’s folder is on another computer.', presets: [] };

function stores(j: Job, { hosted = false, post }: { hosted?: boolean; post?: (path: string, body?: unknown) => Promise<unknown> } = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [j], meta: { token: 't' } as never }) });
  const api = {
    get: vi.fn(async (path: string): Promise<unknown> => {
      if (path === `/api/job/${SLUG}/local`) return LOCAL;
      if (path === `/api/job/${SLUG}/evidence`) return EVIDENCE;
      throw new Error(`not in this test: ${path}`);
    }),
    post: vi.fn(post ?? (async (): Promise<unknown> => ({ ok: true }))),
    ...(hosted ? { hosted: () => true } : {}),
  } as unknown as ApiClient & { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
  const wrap = (n: ReactNode) => <WorkshopContext.Provider value={{ store, api }}><UiProvider>{n}<DocsProbe /></UiProvider></WorkshopContext.Provider>;
  return { store, api, wrap };
}

/** What the page's reader was asked to open (ui.openDocs). */
function DocsProbe() {
  const ui = useUi();
  return <output data-testid="docs-request">{ui.docsRequest ? ui.docsFile ?? '' : ''}</output>;
}

type Opts = { j?: Job; view?: StageView | null; evidence?: EvidenceView | null; detail?: JobDetail | null; hosted?: boolean; watching?: boolean; tryOpen?: boolean; onRecorded?: () => void };

/** The step's body as the page mounts it: the page owns Watch and Try it (watching, tryOpen). */
function Harness({ j, view, evidence, detail, watching: startWatching = false, tryOpen: startTry = false, onRecorded }: Required<Pick<Opts, 'j'>> & Opts) {
  const [watching, setWatching] = useState(startWatching);
  const [tryOpen, setTryOpen] = useState(startTry);
  return (
    <TestStep
      slug={SLUG} job={j} detail={detail ?? null} view={view ?? null} evidence={evidence ?? null} now={NOW}
      watching={watching} onWatching={setWatching} tryOpen={tryOpen} onTryOpen={setTryOpen} onRecorded={onRecorded}
    />
  );
}

function show(o: Opts = {}) {
  const j = o.j ?? TESTING;
  const s = stores(j, { hosted: o.hosted });
  const r = render(s.wrap(<Harness {...o} j={j} view={o.view === undefined ? TEST : o.view} evidence={o.evidence === undefined ? EVIDENCE : o.evidence} detail={o.detail === undefined ? DETAIL : o.detail} />));
  return { ...s, ...r };
}

const kinds = () => screen.getByRole('region', { name: 'Three kinds of test' });
const kind = (name: 'Checks' | 'Recorded evidence' | 'Your hand test') => within(kinds()).getByRole('article', { name });
const chip = (name: Parameters<typeof kind>[0]) => kind(name).querySelector('.sb-test-chip')?.textContent;
const fact = (name: Parameters<typeof kind>[0], label: 'Where' | 'When') => {
  const dt = [...kind(name).querySelectorAll('dt')].find((d) => d.textContent === label);
  return dt ? dt.nextElementSibling?.textContent ?? null : null;
};
const lineRows = () => [...kind('Recorded evidence').querySelectorAll<HTMLElement>('.sb-test-line')];

/** A stub for fetch: each answer in turn, then the last one again; every call is counted. */
function stubFrames(answers: ('frame' | 404)[]) {
  let n = 0;
  const fetch = vi.fn(async () => {
    const a = answers[Math.min(n++, answers.length - 1)];
    return a === 404
      ? { ok: false, status: 404, blob: async () => new Blob([]) }
      : { ok: true, status: 200, blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) };
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
/** The stub's picture as Watch shows it: a data: address (the page policy refuses blob: pictures). */
const FRAME_SRC = `data:image/jpeg;base64,${btoa('jpeg')}`;
const liveCalls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.filter(([u]) => String(u).startsWith(`/api/job/${SLUG}/evidence/live?`));

function narrow(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('760'), addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('TestStep', () => {
  it('Test names three things, each with a state, a place and a time', () => {
    show();
    expect(within(kinds()).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Checks', 'Recorded evidence', 'Your hand test']);
    expect(kind('Checks')).toHaveTextContent('run by the Tester');
    expect(chip('Checks')).toBe('Passed, 46 of 46');
    expect(fact('Checks', 'Where')).toBe('Commands in the job’s folder');
    expect(fact('Checks', 'When')).toBe('Finished 18 min ago, took 6 min');

    expect(kind('Recorded evidence')).toHaveTextContent('by Starbase');
    expect(chip('Recorded evidence')).toBe('17 passed, 2 failed');
    expect(fact('Recorded evidence', 'Where')).toBe('The job’s app on its own address, in a hidden browser');
    expect(fact('Recorded evidence', 'When')).toBe('Finished 40 min ago');

    expect(kind('Your hand test')).toHaveTextContent('by you');
    expect(chip('Your hand test')).toBe('Started');
    expect(fact('Your hand test', 'Where')).toBe('Try it on your computer');
    expect(fact('Your hand test', 'When')).toBe('Started 5 min ago');
    cleanup();

    // A hand test started before the last test run keeps its own time; the checks keep theirs.
    show({ view: { ...TEST, handTest: { startedAt: ago(90) } } });
    expect(fact('Your hand test', 'When')).toBe('Started 1 h 30 min ago');
    expect(fact('Checks', 'When')).toBe('Finished 18 min ago, took 6 min');
    cleanup();

    // A record from an older laptop: no counts, no hand test, no evidence view, no Tester yet.
    show({ view: { ...TEST, finished: [], checks: undefined, handTest: undefined }, evidence: null });
    expect([chip('Checks'), chip('Recorded evidence'), chip('Your hand test')]).toEqual(['Not started', 'Not started', 'Not started']);
    expect(fact('Checks', 'When')).toBe('After the build');
    expect(fact('Recorded evidence', 'When')).toBe('After the checks');
    expect(fact('Your hand test', 'When')).toBe('Not yet');
    expect(kinds()).not.toHaveTextContent(/NaN|undefined|null/);
    cleanup();

    // Before Test: the hand test is whenever you like; no view at all draws the same three.
    show({ j: BUILDING, view: null, evidence: null });
    expect(fact('Your hand test', 'When')).toBe('When you like');
    expect(fact('Checks', 'When')).toBe('After the build');
    cleanup();

    // A job that doesn't record evidence says so, with the reason as its title.
    show({ evidence: { ...EVIDENCE, evidence: null, wanted: false, why: 'L1 jobs record no evidence.' } });
    const not = kind('Recorded evidence').querySelector('.sb-test-chip')!;
    expect(not).toHaveTextContent('Not for this job');
    expect(not).toHaveAttribute('title', 'L1 jobs record no evidence.');
    expect(fact('Recorded evidence', 'When')).toBeNull();
  });

  it('the checks row counts what passed, and while the Tester works shows its command and the end of its output', () => {
    show({ view: { ...TEST, checks: { passed: 44, failed: 2, notRun: 0, at: ago(18) } } });
    expect(chip('Checks')).toBe('Failed, 2 of 46');
    // The report opens in the reader.
    fireEvent.click(within(kind('Checks')).getByRole('button', { name: 'The command and the end of its output' }));
    expect(screen.getByTestId('docs-request')).toHaveTextContent('test-report.md');
    cleanup();

    const working = tester({ status: 'working', lastAt: ago(0), since: ago(3), command: { command: 'npm test -- services routes', at: ago(1), tail: '✓ pauseRules covers the next 3 weekly visits\nTests  12 passed (12)' } });
    show({ view: { ...TEST, agents: [TEST.agents[0], working], finished: [], checks: null } });
    expect(chip('Checks')).toBe('Running');
    expect(fact('Checks', 'When')).toBe('Running now');
    const out = kind('Checks').querySelector('.sb-test-out')!;
    expect(out).toHaveTextContent('$ npm test -- services routes');
    expect(out).toHaveTextContent('Tests 12 passed (12)');
    expect(kind('Checks')).not.toHaveTextContent('Its output shows on your laptop.');
  });

  it('on the website the output stays on the laptop', () => {
    const working = tester({ status: 'working', lastAt: ago(0), since: ago(3), command: { command: 'npm test -- services routes', at: ago(1), tail: null } });
    show({ hosted: true, view: { ...TEST, agents: [TEST.agents[0], working], finished: [], checks: null } });
    expect(chip('Checks')).toBe('Running');
    expect(kind('Checks')).toHaveTextContent('$ npm test -- services routes');
    expect(kind('Checks')).toHaveTextContent('Its output shows on your laptop.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('while it records, the row says the line and lists each line’s state; waiting lines fold to a count; Starbase’s recorder is a row and a feed, with no terminal button', () => {
    const p = progress();
    const recorder = recorderAgent(p)!;
    expect(recorder).toMatchObject({ role: 'Starbase', model: 'recorder', doing: 'Recording evidence: line 4 of 19', status: 'working', ref: 'recorder', terminal: { kind: 'watch', ready: false, why: 'Starbase records this itself.' } });
    expect(recorderAgent(null)).toBeNull();
    expect(recorderAgent(undefined)).toBeNull();
    expect(recorderAgent({ ...p, line: 0, lines: p.lines.map((l) => ({ ...l, state: 'waiting' as const, at: null, video: null })) })?.doing).toBe('Recording evidence: starting, 19 lines');

    const j = { ...TESTING, testing: 'Recording evidence: line 4 of 19' };
    const s = stores(j);
    render(s.wrap(
      <StepPanel job={j} stop="test" view={TEST} error={null} onRetry={() => {}} now={NOW} extraAgents={[recorder]}>
        <TestStep slug={SLUG} job={j} detail={DETAIL} view={TEST} evidence={RECORDING} now={NOW} watching={false} onWatching={() => {}} tryOpen={false} onTryOpen={() => {}} />
      </StepPanel>,
    ));
    expect(chip('Recorded evidence')).toBe('Running, line 4 of 19');
    expect(fact('Recorded evidence', 'When')).toBe('Started 2 min ago');
    const states = lineRows().map((r) => r.querySelector('.sb-test-line-state')?.textContent);
    expect(states).toEqual(['Passed', 'Passed', 'Passed', 'Running', 'Waiting', 'Waiting', 'Waiting', 'Waiting']);
    expect(lineRows()[3]).toHaveTextContent('Office staff pause a weekly service for 3 weeks.');
    expect(within(kind('Recorded evidence')).getByText('11 more waiting')).toBeInTheDocument();
    expect(within(kind('Recorded evidence')).getByRole('button', { name: 'Each line and its video' })).toBeInTheDocument();

    // Starbase's own row, after the rest, with no terminal button; the Tester's keeps its own.
    const who = screen.getByRole('region', { name: 'Who worked on it' });
    const rows = [...who.querySelectorAll<HTMLElement>('.sb-who-row')];
    const sb = rows.find((r) => r.querySelector('.sb-who-role')?.textContent === 'Starbase')!;
    expect(sb).toBe(rows[rows.length - 1]);
    expect(within(sb).getByText('recorder')).toHaveClass('chip');
    expect(sb).toHaveTextContent('Recording evidence: line 4 of 19');
    expect(within(sb).getByText('Working')).toHaveClass('chip');
    expect(within(sb).queryByRole('button')).toBeNull();
    const testerRow = rows.find((r) => r.querySelector('.sb-who-role')?.textContent === 'Tester')!;
    expect(within(testerRow).getByRole('button', { name: /Watch in terminal/ })).toBeInTheDocument();
    expect(rows[0].querySelector('.sb-who-status')).toHaveTextContent('Waiting for the evidence');

    // Its feed, newest first (as every feed block): the line it runs now, then the last three it finished.
    const feed = screen.getByRole('region', { name: 'Live: what they’re doing' });
    const block = within(feed).getByRole('article', { name: 'Starbase' });
    expect([...block.querySelectorAll('.sb-feed-text')].map((t) => t.textContent)).toEqual([
      `Line 4: ${TITLES[3]}`, `Line 3 passed: ${TITLES[2]}`, `Line 2 passed: ${TITLES[1]}`, `Line 1 passed: ${TITLES[0]}`,
    ]);
  });

  it('holes in the evidence’s lines and criteria are left out, never a crash', () => {
    const p = progress();
    const holed = { ...p, lines: [p.lines[0], null, ...p.lines.slice(2)] } as unknown as EvidenceProgress;
    // Starbase's row: the lines it has, each by its own number.
    const recorder = recorderAgent(holed)!;
    expect(recorder.doing).toBe('Recording evidence: line 4 of 19');
    expect(recorder.feed!.map((l) => l.text)).toEqual([`Line 1 passed: ${TITLES[0]}`, `Line 3 passed: ${TITLES[2]}`, `Line 4: ${TITLES[3]}`]);
    for (const hosted of [false, true]) {
      show({ hosted, evidence: { ...RECORDING, watch: !hosted, progress: holed } });
      expect(chip('Recorded evidence')).toBe('Running, line 4 of 19');
      expect(lineRows().map((r) => r.querySelector('.sb-test-line-n')?.textContent)).toEqual(['1', '3', '4', '5', '6', '7', '8']);
      cleanup();
      // A recording with a hole in its criteria counts the rest.
      const ev = EVIDENCE.evidence!;
      show({ hosted, evidence: { ...EVIDENCE, evidence: { ...ev, criteria: [null, ...ev.criteria] as unknown as EvidenceCriterion[] } } });
      expect(chip('Recorded evidence')).toBe('17 passed, 2 failed');
      cleanup();
    }
  });

  it('a finished line plays its video while the rest still record', () => {
    show({ evidence: { ...RECORDING, progress: progress({ noVideo: [2] }) } });
    const [one, two, three, four] = lineRows();
    // Line 2 ended a moment ago and its video isn't there yet: no button, and no error.
    expect(within(two).queryByRole('button')).toBeNull();
    expect(within(four).queryByRole('button')).toBeNull();
    expect(within(three).getByRole('button', { name: 'Play video' })).toBeInTheDocument();
    fireEvent.click(within(one).getByRole('button', { name: 'Play video' }));
    expect(one.querySelector('video')).toHaveAttribute('src', `/api/job/${SLUG}/evidence/file?path=${encodeURIComponent('abc1234/AC-1/video.webm')}`);
    expect(within(one).getByRole('button', { name: 'Hide video' })).toBeInTheDocument();
    expect(chip('Recorded evidence')).toBe('Running, line 4 of 19');
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    // On a phone the button says Video.
    narrow(true);
    show({ evidence: RECORDING });
    expect(within(lineRows()[0]).getByRole('button', { name: 'Video' })).toBeInTheDocument();
  });

  it('Watch shows the picture and asks for a new frame about twice a second; Stop watching ends the requests', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    // The first ask marks the recording watched and has no picture yet.
    const fetch = stubFrames([404, 'frame']);
    show({ evidence: RECORDING });
    const row = kind('Recorded evidence');
    expect(row).toHaveTextContent('The hidden browser, live, in this page.');
    expect(liveCalls(fetch)).toHaveLength(0);
    // The words carry the state (Watch, Stop watching): no pressed state on top.
    expect(within(row).getByRole('button', { name: 'Watch' })).not.toHaveAttribute('aria-pressed');
    fireEvent.click(within(row).getByRole('button', { name: 'Watch' }));
    await act(async () => {});
    expect(liveCalls(fetch)).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(row).queryByRole('img')).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(liveCalls(fetch)).toHaveLength(2);
    const img = within(row).getByRole('img', { name: 'The hidden browser, live' });
    expect(img).toHaveAttribute('src', FRAME_SRC);
    expect(row).toHaveTextContent('Line 4 of 19: Office staff pause a weekly service for 3 weeks. The picture updates about twice a second.');

    // About twice a second: 4 asks in the first 2 seconds, each a new address.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    const calls = liveCalls(fetch);
    expect(calls).toHaveLength(4);
    expect(new Set(calls.map(([u]) => u)).size).toBe(4);
    expect(calls.every(([, init]) => (init as RequestInit | undefined)?.cache === 'no-store')).toBe(true);

    fireEvent.click(within(row).getByRole('button', { name: 'Stop watching' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(liveCalls(fetch)).toHaveLength(4);
    expect(within(row).queryByRole('img')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Watch' })).toBeInTheDocument();
  });

  it('while frames keep coming it never says there is no picture', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const fetch = stubFrames(['frame']);
    show({ evidence: RECORDING, watching: true });
    await act(async () => {});
    for (let s = 0; s < 8; s += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(kind('Recorded evidence')).not.toHaveTextContent('No picture right now.');
    }
    expect(within(kind('Recorded evidence')).getByRole('img', { name: 'The hidden browser, live' })).toBeInTheDocument();
    expect(liveCalls(fetch).length).toBeGreaterThanOrEqual(16);
  });

  it('asks nothing while the tab is hidden, and starts again when it shows', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    let state: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    try {
      const fetch = stubFrames(['frame']);
      show({ evidence: RECORDING, watching: true });
      await act(async () => {});
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(liveCalls(fetch)).toHaveLength(3);
      state = 'hidden';
      // The ask already planned finds the tab hidden and rests; nothing more for a minute.
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      const resting = liveCalls(fetch).length;
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(liveCalls(fetch)).toHaveLength(resting);
      state = 'visible';
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(liveCalls(fetch)).toHaveLength(resting + 1);
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(liveCalls(fetch)).toHaveLength(resting + 2);
    } finally {
      delete (document as unknown as { visibilityState?: unknown }).visibilityState;
    }
  });

  it('another job’s Watch drops the old picture and asks for the new job', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const fetch = vi.fn(async (url: string) => (String(url).startsWith(`/api/job/${SLUG}/`)
      ? { ok: true, status: 200, blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) }
      : { ok: false, status: 404, blob: async () => new Blob([]) }));
    vi.stubGlobal('fetch', fetch);
    const p = progress();
    const view = render(<WatchPicture slug={SLUG} progress={p} />);
    await act(async () => {});
    expect(screen.getByRole('img', { name: 'The hidden browser, live' })).toBeInTheDocument();
    view.rerender(<WatchPicture slug="other-job" progress={p} />);
    expect(screen.queryByRole('img')).toBeNull();
    await act(async () => {});
    expect(screen.queryByRole('img')).toBeNull();
    expect(fetch.mock.calls.some(([u]) => String(u).startsWith('/api/job/other-job/evidence/live?'))).toBe(true);
    // The old job's "no picture" line goes too.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    expect(screen.getByText('No picture right now. The recording may be between lines.')).toBeInTheDocument();
    const before = fetch.mock.calls.filter(([u]) => String(u).startsWith(`/api/job/${SLUG}/`)).length;
    view.rerender(<WatchPicture slug={SLUG} progress={p} />);
    expect(screen.queryByText('No picture right now. The recording may be between lines.')).toBeNull();
    await act(async () => {});
    expect(fetch.mock.calls.filter(([u]) => String(u).startsWith(`/api/job/${SLUG}/`)).length).toBe(before + 1);
  });

  it('with no frame for 5 seconds it says so and keeps asking', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const fetch = stubFrames([404]);
    const view = show({ evidence: RECORDING, watching: true });
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(4_900); });
    const row = kind('Recorded evidence');
    expect(row).not.toHaveTextContent('No picture right now.');
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(row).toHaveTextContent('No picture right now. The recording may be between lines.');
    expect(screen.queryByRole('alert')).toBeNull();
    const asked = liveCalls(fetch).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(liveCalls(fetch).length).toBeGreaterThan(asked);

    // Gone from the page: no more asks.
    view.unmount();
    const before = liveCalls(fetch).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(liveCalls(fetch)).toHaveLength(before);
  });

  it('the website has no Watch', async () => {
    const fetch = stubFrames(['frame']);
    show({ hosted: true, evidence: { ...RECORDING, watch: false }, watching: true });
    const row = kind('Recorded evidence');
    expect(within(row).queryByRole('button', { name: 'Watch' })).toBeNull();
    expect(row).not.toHaveTextContent('The hidden browser, live, in this page.');
    expect(within(row).queryByRole('img')).toBeNull();
    // The same list and videos.
    expect(chip('Recorded evidence')).toBe('Running, line 4 of 19');
    expect(lineRows()).toHaveLength(8);
    expect(within(lineRows()[0]).getByRole('button', { name: 'Play video' })).toBeInTheDocument();
    expect(within(row).getByText('11 more waiting')).toBeInTheDocument();
    await act(async () => {});
    expect(fetch).not.toHaveBeenCalled();
    cleanup();

    // A laptop from before Watch (no watch field): no Watch either, and no error.
    show({ evidence: { ...RECORDING, watch: undefined } });
    expect(within(kind('Recorded evidence')).queryByRole('button', { name: 'Watch' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a recording that could not finish shows the problem and Record again, and no line number', async () => {
    const onRecorded = vi.fn();
    const died: EvidenceView = {
      ...EVIDENCE, evidence: null, recording: false, watch: false,
      // A progress left behind by the run that died is never read once it stopped.
      progress: progress(),
      problem: { commit: 'abc1234def', message: 'The app stopped before the recording finished.', fix: 'npm run dev', at: ago(1) },
    };
    const { api } = show({ evidence: died, watching: true, onRecorded });
    const row = kind('Recorded evidence');
    expect(row).toHaveTextContent('The app stopped before the recording finished.');
    expect(row).toHaveTextContent('npm run dev');
    expect(chip('Recorded evidence')).toBe('Stopped');
    expect(kinds()).not.toHaveTextContent(/line \d+ of \d+/i);
    expect(lineRows()).toHaveLength(0);
    expect(within(row).queryByRole('button', { name: /Watch/ })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Record again' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/api/job/${SLUG}/evidence/record`, {}));
    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
    cleanup();

    // On the website the problem shows, and recording again is the laptop's.
    const hosted = show({ hosted: true, evidence: died });
    expect(kind('Recorded evidence')).toHaveTextContent('The app stopped before the recording finished.');
    expect(within(kind('Recorded evidence')).queryByRole('button', { name: 'Record again' })).toBeNull();
    expect(kind('Recorded evidence')).toHaveTextContent('Evidence is recorded on your laptop. Open the job there to record again.');
    expect(kinds()).not.toHaveTextContent(/line \d+ of \d+/i);
    expect(hosted.api.post).not.toHaveBeenCalled();
  });

  it('Open Try it shows Try it with What to check beside it', async () => {
    const { api } = show();
    const hand = kind('Your hand test');
    expect(hand).toHaveTextContent('Run the branch on your computer, with what to check beside it.');
    expect(within(hand).queryByRole('heading', { name: 'What to check' })).toBeNull();
    fireEvent.click(within(hand).getByRole('button', { name: 'Open Try it' }));
    expect(await within(hand).findByText(LOCAL.reason)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/api/job/${SLUG}/local`);
    const check = within(hand).getByRole('region', { name: 'What to check' });
    expect(check).toHaveTextContent('Picking 3 weeks takes the next 3 weekly visits off the route.');
    expect(check).toHaveTextContent('Charge for a paused visit.');
    fireEvent.click(within(hand).getByRole('button', { name: 'Close Try it' }));
    expect(within(hand).queryByText(LOCAL.reason)).toBeNull();
    expect(within(hand).queryByRole('region', { name: 'What to check' })).toBeNull();
    cleanup();

    // An older laptop with no list: What to check says it isn't written yet.
    show({ detail: null, tryOpen: true });
    expect(within(kind('Your hand test')).getByRole('region', { name: 'What to check' })).toHaveTextContent('Not written yet.');
    cleanup();

    // The website: one sentence, no button, and Try it never opens there.
    const site = show({ hosted: true, tryOpen: true });
    expect(kind('Your hand test')).toHaveTextContent('Try it runs on your laptop. Open the job there to use it.');
    expect(within(kind('Your hand test')).queryByRole('button')).toBeNull();
    expect(site.api.get).not.toHaveBeenCalledWith(`/api/job/${SLUG}/local`);
  });

  it('a job past Test whose hand test never started says Skipped by you', () => {
    show({ j: REVIEWING, view: { ...TEST, state: 'done', handTest: { startedAt: null } } });
    expect(chip('Your hand test')).toBe('Skipped by you');
    expect(fact('Your hand test', 'When')).toBe('You went ahead without it');
    cleanup();
    // Not known (an older laptop): its plain state, and no When.
    show({ j: REVIEWING, view: { ...TEST, state: 'done', handTest: undefined } });
    expect(chip('Your hand test')).toBe('Not started');
    expect(fact('Your hand test', 'When')).toBeNull();
    cleanup();
    // At Test it is Not yet.
    show({ view: { ...TEST, handTest: { startedAt: null } } });
    expect(chip('Your hand test')).toBe('Not started');
    expect(fact('Your hand test', 'When')).toBe('Not yet');
  });

  it('an Auto job that is on says the hand test is skipped', () => {
    const auto = { ...TESTING, auto: { on: true, ran: true } };
    show({ j: auto, view: { ...TEST, handTest: { startedAt: null } } });
    expect(fact('Your hand test', 'When')).toBe(AUTO_LINE);
    expect(within(kind('Your hand test')).queryByRole('button', { name: 'Open Try it' })).toBeNull();
    cleanup();
    show({ j: auto, hosted: true, view: { ...TEST, handTest: { startedAt: null } } });
    expect(fact('Your hand test', 'When')).toBe(AUTO_LINE);
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
    // He wrote to the job while the step waited: the step is his.
    show({ j: { ...auto, auto: { on: true, ran: true, yours: true } }, view: { ...TEST, handTest: { startedAt: null } } });
    expect(fact('Your hand test', 'When')).toBe('Not yet');
    expect(within(kind('Your hand test')).getByRole('button', { name: 'Open Try it' })).toBeInTheDocument();
  });

  it('a stopped Auto job offers Open Try it', () => {
    const stopped = { ...TESTING, auto: { on: true, ran: true, stopped: { reason: 'a database change needs you.', rule: 'database', at: ago(3) } } };
    show({ j: stopped, view: { ...TEST, handTest: { startedAt: null } } });
    expect(fact('Your hand test', 'When')).toBe('Not yet');
    expect(within(kind('Your hand test')).getByRole('button', { name: 'Open Try it' })).toBeInTheDocument();
    expect(kind('Your hand test')).not.toHaveTextContent(AUTO_LINE);
    cleanup();
    // Auto off: the same.
    show({ j: { ...TESTING, auto: { on: false } }, view: { ...TEST, handTest: { startedAt: null } } });
    expect(within(kind('Your hand test')).getByRole('button', { name: 'Open Try it' })).toBeInTheDocument();
  });

  it('the recorder’s feed has only the last three lines it finished', () => {
    const p = progress();
    // Lines 1 to 6 finished (line 5 failed), line 7 runs.
    const later: EvidenceProgress = {
      ...p, line: 7,
      lines: p.lines.map((l, i) => (i < 6 ? { ...l, state: i === 4 ? 'failed' as const : 'passed' as const, at: ago(6 - i) } : i === 6 ? { ...l, state: 'running' as const, at: ago(0.5) } : l)),
    };
    const feed = recorderAgent(later)!.feed!.map((f) => f.text);
    expect(feed).toEqual([`Line 4 passed: ${TITLES[3]}`, `Line 5 failed: ${TITLES[4]}`, `Line 6 passed: ${title(5)}`, `Line 7: ${title(6)}`]);
    expect(recorderAgent(later)!.doing).toBe('Recording evidence: line 7 of 19');
  });

  it('the plain states for what an older record leaves out: Done, Recorded, Skipped', () => {
    // The Tester finished but the view has no counts.
    show({ view: { ...TEST, checks: undefined } });
    expect(chip('Checks')).toBe('Done');
    expect(fact('Checks', 'When')).toBe('Finished 18 min ago, took 6 min');
    expect(within(kind('Checks')).queryByRole('button', { name: 'The command and the end of its output' })).toBeNull();
    cleanup();
    // Evidence with no lines in it.
    show({ evidence: { ...EVIDENCE, evidence: { ...EVIDENCE.evidence!, criteria: [] } } });
    expect(chip('Recorded evidence')).toBe('Recorded');
    expect(fact('Recorded evidence', 'When')).toBe('Finished 40 min ago');
    cleanup();
    // Past Test on an Auto job that decides: Auto skipped the hand test, not you.
    show({ j: { ...REVIEWING, auto: { on: true, ran: true } }, view: { ...TEST, state: 'done', handTest: { startedAt: null } } });
    expect(chip('Your hand test')).toBe('Skipped');
    expect(fact('Your hand test', 'When')).toBe(AUTO_LINE);
    expect(kind('Your hand test')).not.toHaveTextContent('Skipped by you');
  });

  it('Each line and its video opens the evidence strip below', async () => {
    show();
    fireEvent.click(within(kind('Recorded evidence')).getByRole('button', { name: 'Each line and its video' }));
    expect(await screen.findByRole('list', { name: 'Each acceptance line' })).toBeInTheDocument();
  });
});

describe('useEvidence', () => {
  function Probe({ slug }: { slug: string }) {
    const { view } = useEvidence(slug);
    return <output data-testid="ev">{view ? `${view.why}${view.recording ? ' recording' : ''}` : 'none'}</output>;
  }
  const calls = (get: ReturnType<typeof vi.fn>, slug = SLUG) => get.mock.calls.filter(([p]) => p === `/api/job/${slug}/evidence`).length;

  it('asks every 3 seconds while it records, else every 30, keeps the last view when a request fails, and stops when it goes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    let answer: EvidenceView | Error = RECORDING;
    const s = stores(TESTING);
    s.api.get.mockImplementation(async () => { if (answer instanceof Error) throw answer; return answer; });
    const view = render(s.wrap(<Probe slug={SLUG} />));
    await act(async () => {});
    expect(calls(s.api.get)).toBe(1);
    expect(screen.getByTestId('ev')).toHaveTextContent('recording');
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(calls(s.api.get)).toBe(2);
    // A failed request keeps what it showed.
    answer = new Error('Starbase isn’t answering');
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(calls(s.api.get)).toBe(3);
    expect(screen.getByTestId('ev')).toHaveTextContent('recording');
    // Done recording: every 30 seconds.
    answer = EVIDENCE;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(calls(s.api.get)).toBe(4);
    expect(screen.getByTestId('ev')).not.toHaveTextContent('recording');
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
    expect(calls(s.api.get)).toBe(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(calls(s.api.get)).toBe(5);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(calls(s.api.get)).toBe(5);
  });

  it('an older answer never overwrites a newer one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const answers: ((v: EvidenceView) => void)[] = [];
    const s = stores(TESTING);
    s.api.get.mockImplementation(() => new Promise((r) => { answers.push(r as (v: EvidenceView) => void); }));
    render(s.wrap(<Probe slug={SLUG} />));
    await act(async () => {});
    expect(calls(s.api.get)).toBe(1);
    // Nothing answered yet: the next ask comes at 30 s.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(calls(s.api.get)).toBe(2);
    // The second (newer) answers first, then the slow first one.
    await act(async () => { answers[1]({ ...EVIDENCE, why: 'The newer answer.' }); });
    expect(screen.getByTestId('ev')).toHaveTextContent('The newer answer.');
    await act(async () => { answers[0]({ ...EVIDENCE, why: 'The older answer.' }); });
    expect(screen.getByTestId('ev')).toHaveTextContent('The newer answer.');
  });

  it('an answer for another job never lands', async () => {
    let late: (v: EvidenceView) => void = () => {};
    const s = stores(TESTING);
    s.api.get.mockImplementation(async (path: string) => {
      if (path === '/api/job/old-job/evidence') return new Promise((r) => { late = r as (v: EvidenceView) => void; });
      return { ...EVIDENCE, why: 'The new job’s.' };
    });
    const view = render(s.wrap(<Probe slug="old-job" />));
    expect(screen.getByTestId('ev')).toHaveTextContent('none');
    view.rerender(s.wrap(<Probe slug={SLUG} />));
    await waitFor(() => expect(screen.getByTestId('ev')).toHaveTextContent('The new job’s.'));
    await act(async () => { late({ ...EVIDENCE, why: 'The old job’s.' }); });
    expect(screen.getByTestId('ev')).toHaveTextContent('The new job’s.');
  });
});
