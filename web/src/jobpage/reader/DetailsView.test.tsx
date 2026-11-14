// Details in the reader (job page rebuild, Task 14; plan decision 4, design brief "Details"): one table,
// one row per piece of work, newest first (step, who, the task it was given, how long, how it ended),
// cost by step under it; `Open in terminal` only on a running row and never on the website. The rows
// are read (GET /api/job/:slug/work, Task 5) when Details opens and again on the job's `job-page` event
// (the website: on `thread`), since the work moves without the payload's v.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { LiveEvent } from '../../api/types';
import { createStore, WorkshopContext } from '../../state/store';
import { longJob } from '../fixtures/longJob';
import { createJobStore } from '../jobStore';
import type { JobPagePayload } from '../types';
import { JobStoreContext } from '../useJob';
import { DetailsView } from './DetailsView';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const CSS = readFileSync(path.join(process.cwd(), 'src/jobpage/jobpage.css'), 'utf8');
const rule = (sel: string) => {
  const at = CSS.indexOf(`${sel} {`);
  return at < 0 ? '' : CSS.slice(at + sel.length + 2, CSS.indexOf('}', at));
};

const WORK = {
  rows: [
    { id: 'feature-implementer-0', step: 'build', stepLabel: 'Build', who: 'feature-implementer', role: 'Builder', model: 'Opus 5.5', task: 'S5: the sync keeps an admin’s Mark inactive', startedAt: '2026-11-04T14:00:00.000Z', endedAt: null, durationMs: 9 * 60_000, ended: 'Running', state: 'running', ref: 'feature-implementer-0' },
    { id: 'feature-tester-1', step: 'test', stepLabel: 'Test', who: 'feature-tester', role: 'Tester', model: 'Sonnet 5.5', task: 'Run the browser checks and write the test report', startedAt: '2026-11-04T12:00:00.000Z', endedAt: '2026-11-04T12:40:00.000Z', durationMs: 40 * 60_000, ended: 'Failed: the reply ended with an error', state: 'failed', ref: null },
    { id: 'feature-planner-2', step: 'plan', stepLabel: 'Plan', who: 'feature-planner', role: 'Planner', model: null, task: null, startedAt: '2026-11-03T10:00:00.000Z', endedAt: '2026-11-03T11:05:00.000Z', durationMs: 65 * 60_000, ended: 'Done', state: 'done', ref: null },
  ],
  costs: { steps: [{ step: 'plan', label: 'Plan', usd: 12.5 }, { step: 'build', label: 'Build', usd: 40.25 }, { step: 'other', label: 'Between steps and second looks', usd: 3 }], totalUsd: 55.75 },
  note: null,
};

function open({ hosted = false, work = WORK as unknown }: { hosted?: boolean; work?: unknown } = {}) {
  const p = clone(longJob.payload) as unknown as JobPagePayload;
  p.hosted = hosted;
  const store = createJobStore(SLUG, { api: { page: async () => ({ same: true as const, v: p.v }), item: async () => { throw new Error('no'); } }, events: () => () => {}, viewer: () => null, initial: p });
  let answer: () => Promise<unknown> = async () => work;
  const get = vi.fn(async (url: string) => {
    if (url.startsWith(`/api/job/${SLUG}/work`)) return answer();
    throw new Error(`Not asked for: ${url}`);
  });
  const post = vi.fn(async () => ({ ok: true }));
  const api = { get, post, hosted: () => hosted } as unknown as ApiClient;
  const taps = new Set<(e: LiveEvent) => void>();
  const view = render(
    <WorkshopContext.Provider value={{ api, store: createStore() }}>
      <JobStoreContext.Provider value={store}><DetailsView events={(fn) => { taps.add(fn); return () => taps.delete(fn); }} /></JobStoreContext.Provider>
    </WorkshopContext.Provider>,
  );
  return {
    view, get, post,
    answer: (fn: () => Promise<unknown>) => { answer = fn; },
    emit: (e: Partial<LiveEvent>) => act(() => { for (const t of taps) t(e as LiveEvent); }),
  };
}

const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const workAsks = (get: ReturnType<typeof vi.fn>) => get.mock.calls.filter((c) => String(c[0]).startsWith(`/api/job/${SLUG}/work`)).length;
const bodyRows = () => [...document.querySelectorAll<HTMLTableRowElement>('.jp2-dt-t tbody tr')];

afterEach(() => { document.body.innerHTML = ''; });

describe('Details', () => {
  it('reads the work when it opens: one row per piece of work, newest first, step, who, the task, how long, how it ended', async () => {
    const { get } = open();
    await settle();
    expect(workAsks(get)).toBe(1);
    expect([...document.querySelectorAll('.jp2-dt-t thead th')].map((th) => th.textContent)).toEqual(['Step', 'Who', 'Asked to', 'Took', 'Ended']);
    const rows = bodyRows();
    expect(rows).toHaveLength(3);
    const cells = (r: HTMLTableRowElement) => [...r.cells].map((c) => c.textContent);
    expect(cells(rows[0])[0]).toBe('Build');
    expect(cells(rows[0])[1]).toBe('BuilderOpus 5.5');
    expect(cells(rows[0])[2]).toBe('S5: the sync keeps an admin’s Mark inactive');
    expect(cells(rows[0])[3]).toBe('9 min');
    expect(cells(rows[0])[4]).toMatch(/^Running/);
    expect(cells(rows[1])[4]).toMatch(/^Failed: the reply ended with an error/);
    expect(cells(rows[2])[2]).toBe('Not known');
    expect(cells(rows[2])[3]).toBe('1 h 5 min');
    // No tool-call lists, no crew telemetry.
    expect(document.body.textContent).not.toMatch(/SubagentHandback|What they did last|Who worked on it/);
  });

  it('cost by step under the table, with the whole job’s total', async () => {
    open();
    await settle();
    const costs = [...document.querySelectorAll<HTMLTableRowElement>('.jp2-dt-c tr')].map((r) => [...r.cells].map((c) => c.textContent));
    expect(costs).toEqual([['Plan', '$12.50'], ['Build', '$40.25'], ['Between steps and second looks', '$3.00'], ['All', '$55.75']]);
    expect(screen.getByRole('heading', { name: 'Cost by step' })).toBeInTheDocument();
  });

  it('Open in terminal only on the running row; it opens that crew member through the step’s terminal route', async () => {
    const { post } = open();
    await settle();
    const buttons = screen.getAllByRole('button', { name: 'Open in terminal' });
    expect(buttons).toHaveLength(1);
    expect(within(bodyRows()[0]).getByRole('button', { name: 'Open in terminal' })).toBe(buttons[0]);
    fireEvent.click(buttons[0]);
    await settle();
    expect(post).toHaveBeenCalledWith(`/api/job/${SLUG}/stage/build/terminal`, { ref: 'feature-implementer-0' });
    expect(document.body.textContent).toMatch(/Opened the Builder in a terminal/);
  });

  it('never Open in terminal on the website, even on a running row', async () => {
    open({ hosted: true });
    await settle();
    expect(bodyRows()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Open in terminal' })).toBeNull();
  });

  it('reads the work again on the job’s job-page event, not another job’s; on the website on thread', async () => {
    const a = open();
    await settle();
    a.emit({ type: 'job-page', job: 'another-job', data: { slug: 'another-job', v: 9 } });
    await settle();
    expect(workAsks(a.get)).toBe(1);
    a.answer(async () => ({ ...WORK, rows: WORK.rows.slice(1) }));
    a.emit({ type: 'job-page', job: SLUG, data: { slug: SLUG, v: 9 } });
    await settle();
    expect(workAsks(a.get)).toBe(2);
    expect(bodyRows()).toHaveLength(2);
    a.view.unmount();
    const b = open({ hosted: true });
    await settle();
    b.emit({ type: 'thread', job: SLUG, data: {} });
    await settle();
    expect(workAsks(b.get)).toBe(2);
  });

  it('says the server’s note when there is no work; a failed read says why, keeps the rows, and has Try again', async () => {
    const a = open({ work: { rows: [], costs: { steps: [], totalUsd: null }, note: 'No crew has worked on this job yet.' } });
    await settle();
    expect(document.body.textContent).toMatch(/No crew has worked on this job yet\./);
    a.view.unmount();
    const b = open();
    await settle();
    b.answer(async () => { throw new Error('Starbase answered 500.'); });
    b.emit({ type: 'job-page', job: SLUG, data: { slug: SLUG, v: 2 } });
    await settle();
    expect(bodyRows()).toHaveLength(3);
    expect(document.body.textContent).toMatch(/Couldn’t read the work: Starbase answered 500\./);
    b.answer(async () => WORK);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(document.body.textContent).not.toMatch(/Couldn’t read the work/);
  });

  it('a wide table that scrolls on its own, numbers to the right', () => {
    expect(rule('.jp2-dt')).toMatch(/max-width: 1000px/);
    expect(rule('.jp2-dt-wrap')).toMatch(/overflow-x: auto/);
    expect(CSS).toMatch(/\.jp2-dt td\.jp2-num \{[^}]*text-align: right/);
  });
});

describe('Details, fix round 1', () => {
  it('follows the store’s event test: a job-page event that names the job only in its data counts; on the website a change for no job counts', async () => {
    const a = open();
    await settle();
    a.emit({ type: 'job-page', data: { slug: SLUG, v: 3 } } as unknown as Partial<LiveEvent>);
    await settle();
    expect(workAsks(a.get)).toBe(2);
    a.view.unmount();
    const b = open({ hosted: true });
    await settle();
    b.emit({ type: 'change', job: null, data: {} } as unknown as Partial<LiveEvent>);
    await settle();
    expect(workAsks(b.get)).toBe(2);
    b.emit({ type: 'change', job: 'another-job', data: {} } as unknown as Partial<LiveEvent>);
    await settle();
    expect(workAsks(b.get)).toBe(2);
  });
});
