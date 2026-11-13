// Changes in the reader (job page rebuild, Task 14; design brief "Changes"): the commits as a small list,
// the files of the picked commit on the left, the diff of the picked file on the right at full width.
// The newest commit's diff is fetched ahead, so its first file shows with no click; a file pick paints
// at once and never moves the file list; a huge diff (5,000 lines) draws in chunks and never freezes
// the reader. On the website the commits stay on the laptop. Built against the made-up long job.
import { act, fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { createStore, WorkshopContext } from '../../state/store';
import { longJob } from '../fixtures/longJob';
import { createJobStore, type JobStore } from '../jobStore';
import type { JobPagePayload } from '../types';
import { JobStoreContext } from '../useJob';
import { ChangesView, DIFF_FIRST_LINES } from './ChangesView';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const CSS = readFileSync(path.join(process.cwd(), 'src/jobpage/jobpage.css'), 'utf8');
const rule = (sel: string) => {
  const at = CSS.indexOf(`${sel} {`);
  return at < 0 ? '' : CSS.slice(at + sel.length + 2, CSS.indexOf('}', at));
};
/** git log's order: newest first. */
const COMMITS = [...longJob.commits].reverse();

/** A commit's diff as GET /api/job/:slug/commit/:sha answers it: each file's lines, `lines` long when given. */
function diffOf(sha: string, size: Record<string, number> = {}) {
  const c = longJob.commits.find((x) => x.sha === sha)!;
  return {
    sha, message: c.subject, author: c.author, date: c.date, truncated: false,
    files: c.files.map((f) => ({ path: f.path, added: f.added, removed: f.removed })),
    patchFiles: c.files.map((f) => {
      const n = size[f.path] ?? f.added;
      return { path: f.path, lines: [`@@ -0,0 +1,${n} @@`, ...Array.from({ length: n }, (_, i) => `+export const ${f.path.replace(/\W/g, '_')}_${i} = ${i};`)] };
    }),
  };
}

interface Opened { store: JobStore; get: ReturnType<typeof vi.fn>; view: ReturnType<typeof render>; release(): void }

function open({ hosted = false, sizes = {}, hold = false, answer }: { hosted?: boolean; sizes?: Record<string, number>; hold?: boolean; answer?: (url: string) => Promise<unknown> } = {}): Opened {
  const p = clone(longJob.payload) as unknown as JobPagePayload;
  p.hosted = hosted;
  const store = createJobStore(SLUG, { api: { page: async () => ({ same: true as const, v: p.v }), item: async () => { throw new Error('no'); } }, events: () => () => {}, viewer: () => null, initial: p });
  let release = () => {};
  const held = hold ? new Promise<void>((r) => { release = r; }) : null;
  const get = vi.fn(async (url: string) => {
    if (answer) return answer(url);
    if (url === `/api/job/${SLUG}/commits`) return { commits: COMMITS };
    const m = /\/commit\/([0-9a-f]+)$/.exec(url);
    if (m) { if (held) await held; return diffOf(m[1], sizes); }
    throw new Error(`Not asked for: ${url}`);
  });
  const api = { get, post: vi.fn(), hosted: () => hosted } as unknown as ApiClient;
  const view = render(
    <WorkshopContext.Provider value={{ api, store: createStore() }}>
      <JobStoreContext.Provider value={store}><ChangesView /></JobStoreContext.Provider>
    </WorkshopContext.Provider>,
  );
  return { store, get, view, release: () => release() };
}

const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const diffAsks = (get: ReturnType<typeof vi.fn>) => get.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/commit/'));

afterEach(() => { document.body.innerHTML = ''; });

describe('Changes', () => {
  it('lists the commits as a small list, newest first, the newest one picked, its files on the left', async () => {
    open();
    await settle();
    const rows = qa('.jp2-ch-c');
    expect(rows).toHaveLength(COMMITS.length);
    expect(rows[0].textContent).toContain(COMMITS[0].short);
    expect(rows[0].textContent).toContain(COMMITS[0].subject);
    expect(rows[0].getAttribute('aria-current')).toBe('true');
    const files = qa('.jp2-ch-f');
    expect(files.map((f) => f.getAttribute('data-path'))).toEqual(COMMITS[0].files.map((f) => f.path));
    // Each file says its name, its folder and the lines added and removed.
    const f0 = COMMITS[0].files[0];
    expect(files[0].textContent).toContain(f0.path.split('/').pop());
    expect(files[0].textContent).toContain(`+${f0.added}`);
    expect(CSS).toMatch(/\.jp2-ch-commits \{[^}]*max-height: 150px/);
  });

  it('fetches the newest commit’s diff ahead: the first file’s diff shows with no click', async () => {
    const { get } = open();
    await settle();
    expect(diffAsks(get)).toEqual([`/api/job/${SLUG}/commit/${COMMITS[0].sha}`]);
    expect(q('.jp2-ch-dh')?.textContent).toContain(COMMITS[0].files[0].path);
    expect(qa('.jp2-dl').length).toBe(COMMITS[0].files[0].added + 1);
    expect(q('.jp2-dl.is-add')).not.toBeNull();
  });

  it('a file pick paints at once, asks for nothing, and never moves the file list', async () => {
    const { get } = open();
    await settle();
    const list = q('.jp2-ch-files')!;
    list.scrollTop = 37;
    const before = qa('.jp2-ch-f');
    const asked = get.mock.calls.length;
    const second = COMMITS[0].files[1];
    fireEvent.click(before[1]);
    // Same frame: no await between the click and the check.
    expect(q('.jp2-ch-dh')?.textContent).toContain(second.path);
    expect(get.mock.calls.length).toBe(asked);
    expect(q('.jp2-ch-files')).toBe(list);
    expect(list.scrollTop).toBe(37);
    const after = qa('.jp2-ch-f');
    expect(after).toHaveLength(before.length);
    after.forEach((el, i) => expect(el).toBe(before[i]));
    expect(after[1].getAttribute('aria-current')).toBe('true');
    expect(after[0].getAttribute('aria-current')).toBe(null);
  });

  it('a commit pick shows its files at once and asks for its diff once; hovering a commit fetches it ahead', async () => {
    const { get } = open();
    await settle();
    const rows = qa('.jp2-ch-c');
    fireEvent.mouseEnter(rows[2]);
    await settle();
    expect(diffAsks(get)).toContain(`/api/job/${SLUG}/commit/${COMMITS[2].sha}`);
    fireEvent.click(rows[2]);
    expect(qa('.jp2-ch-f').map((f) => f.getAttribute('data-path'))).toEqual(COMMITS[2].files.map((f) => f.path));
    expect(q('.jp2-ch-dh')?.textContent).toContain(COMMITS[2].files[0].path);
    fireEvent.click(rows[0]);
    fireEvent.click(rows[2]);
    await settle();
    expect(diffAsks(get).filter((u) => u.endsWith(COMMITS[2].sha))).toHaveLength(1);
  });

  it('while a diff is on its way the files show and the diff says it is reading', async () => {
    const { release } = open({ hold: true });
    await settle();
    expect(qa('.jp2-ch-f').length).toBe(COMMITS[0].files.length);
    expect(q('.jp2-ch-diff')?.textContent).toMatch(/Reading the change/);
    release();
    await settle();
    expect(qa('.jp2-dl').length).toBeGreaterThan(0);
  });

  it('a 5,000-line diff draws its first lines in chunks and never freezes the reader', async () => {
    const big = COMMITS[0].files[0].path;
    const { view } = open({ sizes: { [big]: 5000 } });
    const t0 = performance.now();
    await settle();
    const took = performance.now() - t0;
    console.info(`5,000-line diff: first paint ${took.toFixed(1)} ms with ${qa('.jp2-dl').length} lines drawn`);
    expect(qa('.jp2-dl').length).toBe(DIFF_FIRST_LINES);
    expect(took).toBeLessThan(1000);
    const more = view.getByRole('button', { name: /Show the next/ });
    expect(more.textContent).toMatch(/4,601 more lines/);
    const first = q('.jp2-dl');
    const t1 = performance.now();
    fireEvent.click(more);
    console.info(`5,000-line diff: next chunk ${(performance.now() - t1).toFixed(1)} ms`);
    expect(qa('.jp2-dl').length).toBe(DIFF_FIRST_LINES * 2);
    // Earlier chunks are not drawn again: the first line is the same node.
    expect(q('.jp2-dl')).toBe(first);
    expect(CSS).toMatch(/\.jp2-dl-chunk \{[^}]*content-visibility: auto/);
  });

  it('a change cut short by Starbase says so', async () => {
    open({ answer: async (url) => (url.endsWith('/commits') ? { commits: COMMITS } : { ...diffOf(COMMITS[0].sha), truncated: true }) });
    await settle();
    expect(document.body.textContent).toMatch(/Only the start of this change is shown/);
  });

  it('a branch with no commits says the server’s note', async () => {
    open({ answer: async () => ({ commits: [], note: 'No feature branch yet. Commits show up here once building starts.' }) });
    await settle();
    expect(document.body.textContent).toMatch(/No feature branch yet/);
  });

  it('a failed read says why, with Try again', async () => {
    let fail = true;
    const b = open({
      answer: async (url) => {
        if (url.endsWith('/commits')) { if (fail) throw new Error('Starbase answered 500.'); return { commits: COMMITS }; }
        return diffOf(/\/commit\/([0-9a-f]+)$/.exec(url)![1]);
      },
    });
    await settle();
    expect(document.body.textContent).toMatch(/Couldn’t read the commits: Starbase answered 500\./);
    fail = false;
    fireEvent.click(b.view.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(qa('.jp2-ch-c')).toHaveLength(COMMITS.length);
  });

  it('on the website the commits stay on the laptop: one line, nothing asked', async () => {
    const { get } = open({ hosted: true });
    await settle();
    expect(get).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/The commits show on your laptop\./);
    expect(q('.jp2-ch-c')).toBeNull();
  });

  it('the file list and the diff scroll on their own; the diff is full width, in the code font', () => {
    expect(rule('.jp2-ch-files')).toMatch(/overflow-y: auto/);
    expect(rule('.jp2-ch-diff')).toMatch(/overflow: auto/);
    expect(rule('.jp2-ch-p')).toMatch(/grid-template-columns: 250px minmax\(0, 1fr\)/);
    expect(rule('.jp2-dl')).toMatch(/white-space: pre/);
  });
});
