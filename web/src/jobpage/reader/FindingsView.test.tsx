// Findings in the reader (job page rebuild, Task 14; design brief "Findings"): the open ones first, one
// line each with its severity and file, opening to its detail; fixed and not doing folded; one line for
// the reviewers who found nothing else, which opens the review step's reader-only documents (lens
// rounds, facts, second looks: the Task 10 ruling); no card per reviewer. Each finding's status is the
// server's (lib/play.js findingStatus through the findings body), never decided again here.
import { act, fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { createStore, WorkshopContext } from '../../state/store';
import { longJob } from '../fixtures/longJob';
import { createJobStore } from '../jobStore';
import type { JobBody, JobPagePayload, ReaderTarget } from '../types';
import { JobStoreContext } from '../useJob';
import { fileOf, FindingsView } from './FindingsView';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const CSS = readFileSync(path.join(process.cwd(), 'src/jobpage/jobpage.css'), 'utf8');
const rule = (sel: string) => {
  const at = CSS.indexOf(`${sel} {`);
  return at < 0 ? '' : CSS.slice(at + sel.length + 2, CSS.indexOf('}', at));
};
const FIXTURE = longJob.bodies.findings as unknown as JobBody;

interface Row { lens: string | null; severity: string; text: string; status: string }
const bodyWith = (rows: Row[], known = true): JobBody => ({ id: 'findings', kind: 'findings', version: 'f1', html: '', text: '', meta: { at: '2026-11-04T13:55:00.000Z', known, rows } });

function open({ body = { ...FIXTURE, version: 'f0' } as JobBody, hold = false }: { body?: JobBody; hold?: boolean } = {}) {
  const p = clone(longJob.payload) as unknown as JobPagePayload;
  let release = () => {};
  const held = hold ? new Promise<void>((r) => { release = r; }) : null;
  const item = vi.fn(async (_s: string, id: string) => { if (held) await held; if (id === 'findings') return body; throw new Error('no'); });
  const store = createJobStore(SLUG, { api: { page: async () => ({ same: true as const, v: p.v }), item }, events: () => () => {}, viewer: () => null, initial: p });
  const onOpen = vi.fn<(t: ReaderTarget) => void>();
  const api = { get: vi.fn(), post: vi.fn(), hosted: () => false } as unknown as ApiClient;
  const view = render(
    <WorkshopContext.Provider value={{ api, store: createStore() }}>
      <JobStoreContext.Provider value={store}><FindingsView onOpen={onOpen} /></JobStoreContext.Provider>
    </WorkshopContext.Provider>,
  );
  return { view, onOpen, item, release: () => release(), payload: p };
}

const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const groups = () => qa('.jp2-fd-g').map((g) => g.textContent?.trim());

afterEach(() => { document.body.innerHTML = ''; });

describe('Findings', () => {
  it('the open ones first, one line each with severity and file; fixed and not doing folded', async () => {
    open({ body: bodyWith([
      { lens: 'feature-review-errors', severity: 'minor', text: 'A failed save in `app/export/csv.ts:88` says nothing.', status: 'fixed' },
      { lens: 'feature-review-db', severity: 'major', text: 'The `week.ts` query reads every shift.', status: 'open' },
      { lens: 'feature-review-db', severity: 'minor', text: 'A second index on shifts.', status: 'not-doing' },
      { lens: 'feature-reviewer', severity: 'blocker', text: 'The CSV leaves out night shifts in `rows.ts`.', status: 'open' },
    ]) });
    await settle();
    expect(groups()).toEqual(['Open · 2', 'Fixed · 1', 'Not doing · 1']);
    const lines = qa('.jp2-fd-line');
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.querySelector('.jp2-fd-sev')?.textContent)).toEqual(['Major', 'Blocker']);
    expect(lines.map((l) => l.querySelector('.jp2-fd-w')?.textContent)).toEqual(['week.ts', 'rows.ts']);
    expect(lines[0].querySelector('.jp2-fd-t')?.textContent).toBe('The week.ts query reads every shift.');
    // Folded: the fixed and not-doing rows are not drawn until opened.
    expect(document.body.textContent).not.toMatch(/A failed save/);
    const fixed = qa('.jp2-fd-fold')[0];
    expect(fixed.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fixed);
    expect(fixed.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.textContent).toMatch(/A failed save in app\/export\/csv\.ts:88 says nothing\./);
    expect(qa('.jp2-fd-flat .jp2-fd-x').map((x) => x.textContent)).toEqual(['Fixed']);
    fireEvent.click(qa('.jp2-fd-fold')[1]);
    expect(qa('.jp2-fd-flat .jp2-fd-x').map((x) => x.textContent)).toEqual(['Fixed', 'Not doing']);
  });

  it('a line opens to its detail in place, and a second click folds it', async () => {
    open({ body: bodyWith([{ lens: 'feature-review-db', severity: 'major', text: 'The `week.ts` query reads every shift.', status: 'open' }]) });
    await settle();
    const line = qa('.jp2-fd-line')[0];
    expect(line.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('true');
    const more = document.querySelector('.jp2-fd-more')!;
    expect(more.textContent).toMatch(/The week\.ts query reads every shift\./);
    expect(more.textContent).toMatch(/Major · database · open/);
    fireEvent.click(line);
    expect(document.querySelector('.jp2-fd-more')).toBeNull();
  });

  it('each finding keeps the server’s status: words that say fixed do not move an open row', async () => {
    open({ body: bodyWith([
      { lens: null, severity: 'major', text: 'Fixed the sort, but the totals row still drops a shift.', status: 'open' },
      { lens: null, severity: 'minor', text: 'Still open in the notes column.', status: 'fixed' },
    ]) });
    await settle();
    expect(groups()).toEqual(['Open · 1', 'Fixed · 1']);
    expect(qa('.jp2-fd-line')[0].textContent).toMatch(/totals row still drops/);
  });

  it('the long job: 1 open, 1 fixed, and one line for the 6 reviewers who found nothing else', async () => {
    const { onOpen, payload } = open();
    await settle();
    expect(groups()).toEqual(['Open · 1', 'Fixed · 1']);
    const rest = qa('.jp2-fd-rest');
    expect(rest).toHaveLength(1);
    expect(rest[0].textContent).toBe('6 reviewers found nothing else');
    // No card per reviewer: nothing for the lenses is drawn until the line is opened.
    expect(qa('.jp2-fd-lens')).toHaveLength(0);
    fireEvent.click(rest[0]);
    expect(rest[0].getAttribute('aria-expanded')).toBe('true');
    const more = payload.steps.find((s) => s.id === 'review')!.more;
    const items = qa('.jp2-fd-lens');
    expect(items.map((i) => i.textContent)).toEqual(more.map((o) => o.label));
    fireEvent.click(items[0]);
    expect(onOpen).toHaveBeenCalledWith({ kind: 'doc', id: more[0].id }, items[0]);
  });

  it('with nothing open it says so; before review.md is read it says there is no review yet', async () => {
    open({ body: bodyWith([{ lens: 'feature-review-db', severity: 'minor', text: 'Fine.', status: 'fixed' }]) });
    await settle();
    expect(document.body.textContent).toMatch(/Nothing open\./);
    document.body.innerHTML = '';
    open({ body: bodyWith([], false) });
    await settle();
    expect(document.body.textContent).toMatch(/No review yet\./);
    expect(qa('.jp2-fd-g')).toHaveLength(0);
  });

  it('a body still on its way shows nothing under the title row', async () => {
    const { release } = open({ hold: true });
    await settle();
    expect(document.querySelector('[data-view="findings"]')!.textContent).toBe('');
    release();
    await settle();
    expect(groups()[0]).toBe('Open · 1');
  });

  it('the file of a finding: a path in backticks, else a bare file name, else the lens', () => {
    expect(fileOf('Breaks in `app/export/csv.ts:88` on save', null)).toBe('csv.ts:88');
    expect(fileOf('The status-control.tsx button has no name', null)).toBe('status-control.tsx');
    expect(fileOf('Page glue is only proven in the browser', 'feature-review-tests')).toBe('tests');
    expect(fileOf('Plain words', 'feature-reviewer')).toBe('spec');
    expect(fileOf('Plain words', null)).toBe('');
  });

  it('reads at the prose width; a line is one row, its words cut with an ellipsis', () => {
    expect(rule('.jp2-fds')).toMatch(/max-width: 760px/);
    expect(rule('.jp2-fd-t')).toMatch(/text-overflow: ellipsis/);
  });
});
