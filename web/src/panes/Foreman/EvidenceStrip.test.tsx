import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(await screen.findByRole('region', { name: /^Evidence at abc1234/ })).toBeTruthy();
  });

  it('shows it at the review gate too', async () => {
    gateSetup(detail({ stage: 'review', nextStage: 'pr1' }));
    expect(await screen.findByRole('region', { name: /^Evidence at abc1234/ })).toBeTruthy();
  });

  it('shows nothing before the test gate', async () => {
    const { get } = gateSetup(detail({ stage: 'plan', nextStage: 'implement', proof: null }));
    await act(async () => {});
    expect(screen.queryByRole('region', { name: /^Evidence/ })).toBeNull();
    expect(get.mock.calls.some(([p]) => String(p).endsWith('/evidence'))).toBe(false);
  });
});
