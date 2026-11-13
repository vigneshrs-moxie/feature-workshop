// Tests only: the new job page under the router at a phone's width, on the made-up long job, for the
// phone's three screens (PhoneJob2, PhoneStep, PhoneReader tests).
import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job } from '../../api/types';
import { useRoute } from '../../app/router';
import { createStore, WorkshopContext } from '../../state/store';
import { job as jobRow } from '../../state/test-fixtures';
import { longJob } from './longJob';
import { JobPage2 } from '../JobPage2';
import type { JobBody, JobPagePayload } from '../types';

export const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export const payload = () => clone(longJob.payload) as unknown as JobPagePayload;

/** The snapshot's row for the job. */
export const ROW: Job = jobRow(SLUG, 'needs-you', {
  title: 'Crew schedule export', lane: 'needs-you', laneReason: 'Waiting for your go-ahead on PR #1',
  headline: 'Review 4 is ready. Go ahead with PR #1?', stage: 'review', stageState: 'waiting', needsYou: true, level: 3,
  repo: { name: 'fieldbook' }, cost: { totalUsd: 96.4 },
});

/** The app's client, answering the page's two reads. */
export function client(make: () => JobPagePayload = payload) {
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path.includes('/page')) return make();
    const id = decodeURIComponent(/[?&]id=([^&]+)/.exec(path)?.[1] ?? '');
    const b = longJob.bodies[id];
    if (!b) throw new Error('No such body.');
    return { ...b, version: String(b.meta.hash ?? b.id) } satisfies JobBody;
  });
  const api = { get, post: vi.fn(), hosted: () => false } as unknown as ApiClient;
  return { api, get };
}

const media = { width: 390, heard: new Set<() => void>() };
/** The window's width, as the page's media queries read it. */
export function windowWidth(px: number) {
  media.width = px;
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    return {
      get matches() { return (!min || media.width >= Number(min[1])) && (!max || media.width <= Number(max[1])); },
      media: q,
      addEventListener(_: string, fn: () => void) { media.heard.add(fn); },
      removeEventListener(_: string, fn: () => void) { media.heard.delete(fn); },
    };
  });
}
export const resizeTo = (px: number) => act(() => { media.width = px; for (const fn of [...media.heard]) fn(); });

/** The page under the router, as App mounts it. */
function Routed() {
  const route = useRoute();
  if (route.name !== 'job' && route.name !== 'stage') return <p>Not the job</p>;
  return <JobPage2 key={route.slug} slug={route.slug} job={ROW} step={route.name === 'stage' ? route.stop : undefined} view={route.name === 'job' ? route.view : undefined} read={route.name === 'job' ? route.read : undefined} />;
}

/** Opens the page at `hash` with nothing of the page's in the history behind it (a new entry, so
 *  history.length counts from here: entries left ahead by an earlier test's Back are dropped). */
export function openAt(hash: string, make?: () => JobPagePayload) {
  window.history.pushState(null, '', `/${hash}`);
  const c = client(make);
  const utils = render(<WorkshopContext.Provider value={{ api: c.api, store: createStore() }}><Routed /></WorkshopContext.Provider>);
  return { ...c, ...utils };
}

export const page = () => screen.getByRole('main', { name: 'Job' });
export const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
/** History moves (Back) land a moment later in a browser and in jsdom: wait for the address to change. */
export async function afterHistory(from: string) {
  for (let i = 0; i < 50 && window.location.hash === from; i++) await settle();
  await settle();
}
export const stepRow = (name: string) => {
  const row = [...document.querySelectorAll<HTMLButtonElement>('.jp2-st-row')].find((b) => b.querySelector('.jp2-st-name')?.textContent === name);
  if (!row) throw new Error(`No step row ${name}`);
  return row;
};
