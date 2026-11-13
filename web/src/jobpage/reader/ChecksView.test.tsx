// Checks, the recording and Your hand test in the reader (job page rebuild, Task 14; design brief
// "Recording and checks", R7): the checks as a short list of counts; the video or pictures large with
// each check one row beside them; `Record again`; which commit each was made on, said plainly when it
// is older than the final commit; the hand test's list to check with `Start the app`, `Open it`,
// `It works` and `Something is wrong…`. Try it and Record again stay on the laptop.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { EvidenceView, LiveEvent } from '../../api/types';
import { createStore, WorkshopContext } from '../../state/store';
import { longJob } from '../fixtures/longJob';
import { createJobStore } from '../jobStore';
import type { JobBody, JobPagePayload, ReaderTarget } from '../types';
import { JobStoreContext } from '../useJob';
import { ChecksView } from './ChecksView';

vi.mock('../../panes/Preview/TryTab', () => ({ TryTab: ({ slug }: { slug: string }) => <section aria-label="Try it">Try it for {slug}</section> }));

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const CSS = readFileSync(path.join(process.cwd(), 'src/jobpage/jobpage.css'), 'utf8');
const rule = (sel: string) => {
  const at = CSS.indexOf(`${sel} {`);
  return at < 0 ? '' : CSS.slice(at + sel.length + 2, CSS.indexOf('}', at));
};
/** git log's order: newest first; the final commit is COMMITS[0]. */
const COMMITS = [...longJob.commits].reverse();
const FINAL = COMMITS[0];
const OLDER = COMMITS[3];
const CHECKS = { ...(longJob.bodies.checks as unknown as JobBody), version: 'c0' };

function evidenceView(over: Partial<EvidenceView> = {}, commit = OLDER.short): EvidenceView {
  return {
    evidence: {
      version: 1, commit, at: '2026-11-04T10:00:00.000Z', level: 3,
      criteria: [
        { id: 'AC-1', title: 'The week downloads as a file', status: 'passed', reason: null, spec: 'evidence/specs/AC-1.spec.mjs', screenshots: [{ file: `evidence/${commit}/AC-1/1.png`, description: 'The download starts' }], video: `evidence/${commit}/AC-1/video.webm` },
        { id: 'AC-2', title: 'A night shift sits on its start day', status: 'failed', reason: 'The row did not show in time.', spec: 'evidence/specs/AC-2.spec.mjs', screenshots: [{ file: `evidence/${commit}/AC-2/1.png`, description: 'The week with no night row' }], video: null },
        { id: 'AC-3', title: 'The file name has the week', status: 'skipped', reason: 'Nothing to see: a file name.', spec: null, screenshots: [], video: null },
      ],
    },
    commit: FINAL.short, wanted: true, why: 'Level 3 jobs record their checks.', recording: false, problem: null,
    folder: '/demo/evidence', folderUrl: 'file:///demo/evidence/', progress: null, watch: false,
    ...over,
  };
}

interface Opts { id: 'checks' | 'recording' | 'hand-test'; hosted?: boolean; evidence?: EvidenceView; local?: unknown; body?: JobBody; patch?: (p: JobPagePayload) => void }

function open({ id, hosted = false, evidence = evidenceView(), local = { server: null, url: null }, body = CHECKS, patch }: Opts) {
  const p = clone(longJob.payload) as unknown as JobPagePayload;
  p.hosted = hosted;
  patch?.(p);
  const item = vi.fn(async (_s: string, bid: string) => { if (bid === 'checks') return body; throw new Error('no'); });
  const store = createJobStore(SLUG, { api: { page: async () => ({ same: true as const, v: p.v }), item }, events: () => () => {}, viewer: () => null, initial: p });
  let ev = evidence;
  let loc = local;
  const get = vi.fn(async (url: string) => {
    if (url === `/api/job/${SLUG}/commits`) return { commits: COMMITS };
    if (url === `/api/job/${SLUG}/evidence`) return ev;
    if (url === `/api/job/${SLUG}/local`) return loc;
    throw new Error(`Not asked for: ${url}`);
  });
  const post = vi.fn(async () => ({ ok: true, started: true, ...ev, recording: true }));
  const api = { get, post, hosted: () => hosted } as unknown as ApiClient;
  const taps = new Set<(e: LiveEvent) => void>();
  const onOpen = vi.fn<(t: ReaderTarget) => void>();
  const view = render(
    <WorkshopContext.Provider value={{ api, store: createStore() }}>
      <JobStoreContext.Provider value={store}><ChecksView id={id} onOpen={onOpen} events={(fn) => { taps.add(fn); return () => taps.delete(fn); }} /></JobStoreContext.Provider>
    </WorkshopContext.Provider>,
  );
  return {
    view, get, post, onOpen,
    setEvidence: (v: EvidenceView) => { ev = v; },
    setLocal: (v: unknown) => { loc = v; },
    emit: (e: LiveEvent) => act(() => { for (const t of taps) t(e); }),
  };
}

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const text = () => document.body.textContent ?? '';
const asked = (get: ReturnType<typeof vi.fn>, end: string) => get.mock.calls.filter((c) => String(c[0]).endsWith(end)).length;

afterEach(() => { document.body.innerHTML = ''; });

describe('Checks', () => {
  it('the counts as one short line, and the commit the checks ran on, said plainly when older than the final one', async () => {
    open({ id: 'checks', evidence: evidenceView({ commit: OLDER.short }) });
    await settle();
    expect(document.querySelector('.jp2-ck-big')!.textContent).toBe('14 passed · 0 failed · 0 not run');
    expect(text()).toContain(`Run on ${OLDER.short}. That is 3 commits before the final one, ${FINAL.short}.`);
  });

  it('on the final commit it says so, and the report opens from here', async () => {
    const { onOpen } = open({ id: 'checks', evidence: evidenceView({ commit: FINAL.short }) });
    await settle();
    expect(text()).toContain(`Run on ${FINAL.short}, the final commit.`);
    fireEvent.click(screen.getByRole('button', { name: 'Open the test report' }));
    expect(onOpen).toHaveBeenCalledWith({ kind: 'doc', id: 'test-report.md' }, expect.anything());
  });

  it('no report yet: one plain line', async () => {
    open({ id: 'checks', body: { ...CHECKS, meta: { ...CHECKS.meta, counts: null } } });
    await settle();
    expect(text()).toMatch(/No test report yet\./);
    expect(document.querySelector('.jp2-ck-big')).toBeNull();
  });
});

describe('Recording', () => {
  it('the video large, the checks as a short list beside it, failed first, nothing-to-see folded', async () => {
    open({ id: 'recording' });
    await settle();
    expect([...document.querySelectorAll('.jp2-rec-g')].map((g) => g.textContent?.trim())).toEqual(['Failed · 1', 'Passed · 1', 'Nothing to see · 1']);
    const rows = [...document.querySelectorAll<HTMLElement>('.jp2-rec-r')];
    expect(rows.map((r) => r.querySelector('.jp2-rec-id')?.textContent)).toEqual(['AC-2', 'AC-1']);
    // The first row is picked: its pictures are large in the player (AC-2 has no video).
    expect(rows[0].getAttribute('aria-current')).toBe('true');
    const shot = document.querySelector<HTMLImageElement>('.jp2-rec-player img')!;
    expect(shot.getAttribute('src')).toBe(`/api/job/${SLUG}/evidence/file?path=${encodeURIComponent(`evidence/${OLDER.short}/AC-2/1.png`)}`);
    expect(text()).toContain('Failed: The row did not show in time.');
    fireEvent.click(rows[1]);
    const video = document.querySelector<HTMLVideoElement>('.jp2-rec-player video')!;
    expect(video.getAttribute('src')).toContain(encodeURIComponent(`evidence/${OLDER.short}/AC-1/video.webm`));
    expect(rule('.jp2-rec-grid')).toMatch(/grid-template-columns: minmax\(0, 1fr\) 300px/);
  });

  it('says plainly which commit it was recorded on when that is older than the final one', async () => {
    open({ id: 'recording' });
    await settle();
    expect(text()).toContain(`Recorded on ${OLDER.short}`);
    expect(text()).toContain(`That is 3 commits before the final one, ${FINAL.short}.`);
  });

  it('Record again records for the commit the report names and reads the evidence again', async () => {
    const { post, get } = open({ id: 'recording' });
    await settle();
    const before = asked(get, '/evidence');
    fireEvent.click(screen.getByRole('button', { name: 'Record again' }));
    await settle();
    expect(post).toHaveBeenCalledWith(`/api/job/${SLUG}/evidence/record`, {});
    expect(text()).toMatch(/Recording now/);
    expect(asked(get, '/evidence')).toBeGreaterThan(before);
  });

  it('a recording that could not finish says why, with Record again', async () => {
    open({ id: 'recording', evidence: evidenceView({ evidence: null, problem: { commit: FINAL.short, message: 'The app did not start.', fix: 'npm run dev', at: '2026-11-04T10:00:00.000Z' } }) });
    await settle();
    expect(text()).toMatch(/The app did not start\./);
    expect(screen.getByRole('button', { name: 'Record again' })).toBeEnabled();
  });

  it('on the website: no Record again, a laptop line; a video plays only once it is on the site', async () => {
    const { get } = open({ id: 'recording', hosted: true, evidence: evidenceView({ onSite: [] }) });
    await settle();
    expect(screen.queryByRole('button', { name: 'Record again' })).toBeNull();
    expect(text()).toMatch(/Evidence is recorded on your laptop/);
    expect(asked(get, '/commits')).toBe(0);
    expect(text()).toContain(`Recorded on ${OLDER.short}`);
    expect(text()).toContain(`The checks ran on a later commit, ${FINAL.short}.`);
    fireEvent.click([...document.querySelectorAll<HTMLElement>('.jp2-rec-r')][1]);
    expect(document.querySelector('.jp2-rec-player video')).toBeNull();
  });
});

describe('Recording with nothing to see', () => {
  it('when no check has a picture or a video, the checks are a list alone, with no empty frame', async () => {
    const v = evidenceView();
    v.evidence!.criteria = v.evidence!.criteria.map((c) => ({ ...c, screenshots: [], video: null }));
    open({ id: 'recording', evidence: v });
    await settle();
    expect(document.querySelector('.jp2-rec-player')).toBeNull();
    expect(document.querySelector('.jp2-rec-grid')).toHaveClass('is-list');
    expect(document.querySelectorAll('.jp2-rec-r')).toHaveLength(2);
    expect(document.querySelector('.jp2-rec-r[aria-current]')).toBeNull();
  });
});

describe('Your hand test (R7)', () => {
  it('the list to check, Start the app, Open it, It works, Something is wrong…', async () => {
    open({ id: 'hand-test' });
    await settle();
    const lists = [...document.querySelectorAll('.jp2-hand ol li')].map((li) => li.textContent);
    expect(lists).toHaveLength(14);
    expect(lists[0]).toMatch(/^AC-1: /);
    expect(text()).toContain(`On the final commit, ${FINAL.short}.`);
    for (const name of ['Start the app', 'Open it', 'It works', 'Something is wrong…']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    // What they will send comes later: off, and the title says what each will do.
    expect(screen.getByRole('button', { name: 'It works' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'It works' }).getAttribute('title')).toMatch(/Tells the Foreman/);
    expect(screen.getByRole('button', { name: 'Something is wrong…' })).toBeDisabled();
  });

  it('Start the app opens Try it in place; Open it opens the app once Try it says it runs', async () => {
    const { setLocal, emit } = open({ id: 'hand-test' });
    await settle();
    const openIt = screen.getByRole('button', { name: 'Open it' });
    expect(openIt).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Start the app' }));
    expect(screen.getByRole('region', { name: 'Try it' })).toBeInTheDocument();
    setLocal({ server: { status: 'running' }, url: 'http://127.0.0.1:4610' });
    emit({ type: 'local-state', job: SLUG, data: {} } as unknown as LiveEvent);
    await settle();
    const link = screen.getByRole('link', { name: 'Open it' });
    expect(link.getAttribute('href')).toBe('http://127.0.0.1:4610');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('on the website Try it is hidden: no Start the app or Open it, and nothing asked of Try it', async () => {
    const { get } = open({ id: 'hand-test', hosted: true });
    await settle();
    expect(screen.queryByRole('button', { name: 'Start the app' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open it' })).toBeNull();
    expect(text()).toMatch(/Try it runs on your laptop/);
    expect(asked(get, '/local')).toBe(0);
    expect(document.querySelectorAll('.jp2-hand ol li')).toHaveLength(14);
  });

  it('while Auto decides the job it says Auto skips the hand test', async () => {
    open({ id: 'hand-test', patch: (p) => { p.auto = { on: true, stopped: null, yours: false } as unknown as JobPagePayload['auto']; } });
    await settle();
    expect(text()).toMatch(/Auto skips your hand test on this job/);
  });
});
