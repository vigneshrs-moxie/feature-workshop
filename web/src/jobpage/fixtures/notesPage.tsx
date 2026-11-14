// Tests only: the new job page on the made-up long job, wide, with a client that answers sends, for
// the notes tests (notes/*.test.tsx, Task 17).
import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { UiProvider } from '../../app/ui';
import { createStore, WorkshopContext } from '../../state/store';
import { browserDrafts, createJobStore, type JobStore } from '../jobStore';
import { JobPage2 } from '../JobPage2';
import type { JobBody, JobPagePayload, ReaderTarget } from '../types';
import { longJob } from './longJob';

export const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export const payload = () => clone(longJob.payload) as unknown as JobPagePayload;
export const PLAN = 'implementation-plan.md';

/** A held body as the item route answers it. */
export const bodyOf = (id: string): JobBody | undefined => {
  const b = longJob.bodies[id];
  return b ? { ...b, version: String(b.meta.hash ?? b.id) } : undefined;
};

export type Post = ReturnType<typeof vi.fn>;
export const okPost = (): Post => vi.fn(async (path: string): Promise<unknown> => (path.endsWith('/gate') ? { ok: true, sent: true, text: 'ok', run: { id: 'r1' } } : { run: { id: 'r1' } }));

export interface NotesPage {
  store: JobStore;
  post: Post;
  /** The payload the next load answers, and the bodies the item route answers from now on. */
  serve(p: JobPagePayload, bodies?: Record<string, JobBody>): Promise<void>;
  unmount(): void;
}

/** The page, reading `read` in the reader, with a store kept in this browser (drafts, notes). */
export function openNotes({ read = { kind: 'doc', id: PLAN }, patch, post = okPost(), bodies = {} }: {
  read?: ReaderTarget | null; patch?: (p: JobPagePayload) => void; post?: Post; bodies?: Record<string, JobBody>;
} = {}): NotesPage {
  let current = payload();
  patch?.(current);
  let extra: Record<string, JobBody> = { ...bodies };
  window.history.replaceState(null, '', `/#/job/${SLUG}`);
  const store = createJobStore(SLUG, {
    api: {
      page: async (_slug: string, v: number | null) => (v === current.v ? { same: true as const, v } : current),
      item: async (_slug: string, id: string) => {
        const b = extra[id] ?? bodyOf(id);
        if (!b) throw new Error('Not found (404).');
        return b;
      },
    },
    events: () => () => {}, viewer: () => null, initial: current, drafts: browserDrafts,
  });
  if (read) store.setReader(read);
  const api = { get: vi.fn(async () => { throw new Error('not here'); }), post, hosted: () => false } as unknown as ApiClient;
  const utils = render(
    <WorkshopContext.Provider value={{ api, store: createStore() }}>
      <UiProvider><JobPage2 slug={SLUG} job={null} store={store} /></UiProvider>
    </WorkshopContext.Provider>,
  );
  return {
    store, post, unmount: utils.unmount,
    async serve(p, more = {}) {
      current = p;
      extra = { ...extra, ...more };
      await act(async () => { await store.loadPage(); });
    },
  };
}

export const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
export const reader = () => document.querySelector<HTMLElement>('.jp2-reader')!;
export const host = () => reader().querySelector<HTMLElement>('.jp2-rv-body')!;
export const plus = () => reader().querySelector<HTMLButtonElement>('.jp2-pt-plus');
export const noteBox = () => reader().querySelector<HTMLElement>('.jp2-nb');
export const chips = () => [...document.querySelectorAll<HTMLElement>('.jp2-chip')];
export const chipText = () => chips().map((c) => c.querySelector('.jp2-chip-l')!.textContent);
export const box = () => screen.getByRole('textbox', { name: 'Message to the Foreman', hidden: true }) as HTMLTextAreaElement;
/** A paragraph of the reader's prose by its first words. */
export function para(start: string): HTMLElement {
  const el = [...reader().querySelectorAll<HTMLElement>('.jp2-prose p, .jp2-prose li, .jp2-prose h3, .jp2-prose h4, .jp2-prose h5, .jp2-prose h6')].find((p) => (p.textContent ?? '').trim().startsWith(start));
  if (!el) throw new Error(`No block starting “${start}”`);
  return el;
}
