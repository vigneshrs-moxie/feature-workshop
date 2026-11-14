// The job's four rows on the left (job page rebuild, Task 10): Ticket and goal, Conversation with its
// count and what is new since his last look, Decisions made for him, Details. Built against the
// made-up long job.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '../../api/client';
import { writeStored } from '../../lib/stored';
import { longJob } from '../fixtures/longJob';
import { createJobStore, type JobStore } from '../jobStore';
import { readerOf } from '../targets';
import type { JobPagePayload, ReaderTarget, ThreadLine } from '../types';
import { JobStoreContext } from '../useJob';
import { freshCount, JobRows, seenKey } from './JobRows';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const payload = (over: Partial<JobPagePayload> = {}): JobPagePayload => ({ ...(clone(longJob.payload) as unknown as JobPagePayload), ...over });

function mount(p: JobPagePayload | null = payload()) {
  const api = { get: async () => ({}), post: async () => ({}), hosted: () => false } as unknown as ApiClient;
  const store: JobStore = createJobStore(SLUG, { api, initial: p, events: () => () => {} });
  const onOpen = (t: ReaderTarget) => { store.setReader(t); };
  render(<JobStoreContext.Provider value={store}><JobRows cursor={null} first={7} onOpen={onOpen} /></JobStoreContext.Provider>);
  return store;
}

const names = () => [...document.querySelectorAll('.jp2-jr')].map((b) => b.getAttribute('aria-label') ?? b.textContent);

afterEach(() => { localStorage.clear(); });

describe('the job rows', () => {
  it('four rows: Ticket and goal, Conversation · 52, Decisions · 13 made for you, Details', () => {
    mount();
    expect(names()).toEqual(['Ticket and goal', 'Conversation · 52', 'Decisions · 13 made for you', 'Details']);
  });

  it('Conversation counts what is new since his last look (sb.convo.seen.<slug>), never his own lines', () => {
    // Between his last message (14:46) and the Foreman's reply after it (14:52).
    writeStored(seenKey(SLUG), '2026-11-04T14:30:00.000Z');
    mount();
    expect(screen.getByRole('button', { name: 'Conversation · 52 · 1 new' })).toBeInTheDocument();
    // His look moves on (the conversation marks it): the count goes, in place.
    act(() => { writeStored(seenKey(SLUG), '2026-11-04T15:00:00.000Z'); });
    expect(screen.getByRole('button', { name: 'Conversation · 52' })).toBeInTheDocument();
  });

  it('freshCount: newer than the look and not his; never looked, or a line with no time, is not new', () => {
    const line = (at: string | null, mine = false): ThreadLine => ({ id: `x${at}`, kind: 'reply', at, step: null, headline: 'h', mine, hash: 'h' });
    const thread = [line('2026-11-04T10:00:00Z'), line('2026-11-04T12:00:00Z'), line('2026-11-04T13:00:00Z', true), line(null)];
    expect(freshCount(thread, '2026-11-04T11:00:00Z')).toBe(1);
    expect(freshCount(thread, null)).toBe(0);
    expect(freshCount(thread, 'not a time')).toBe(0);
  });

  it('a job with no thread and no decisions yet: the rows are there, with no counts', () => {
    mount(payload({ thread: [], rows: { conversation: { count: 0 }, decisions: { count: 0 } } }));
    expect(names()).toEqual(['Ticket and goal', 'Conversation', 'Decisions', 'Details']);
  });

  it('each row opens its view in the reader and is marked while it shows', () => {
    const store = mount();
    for (const [name, kind] of [['Ticket and goal', 'ticket'], ['Conversation · 52', 'conversation'], ['Decisions · 13 made for you', 'decisions'], ['Details', 'details']] as const) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(readerOf(store.getState())?.kind).toBe(kind);
      expect(screen.getByRole('button', { name })).toHaveClass('is-sel');
    }
  });

  it('the website, which keeps the newest 60 lines, says there are more', () => {
    mount(payload({ rows: { conversation: { count: 60, more: true }, decisions: { count: 13 } } }));
    expect(screen.getByRole('button', { name: 'Conversation · 60+' })).toBeInTheDocument();
  });

  it('before the payload: the four rows with no counts', () => {
    mount(null);
    expect(names()).toEqual(['Ticket and goal', 'Conversation', 'Decisions', 'Details']);
  });
});

describe('Task 23 fix round: a new line in the conversation', () => {
  /** A store whose next page read answers `next`. */
  function mountWithNext(next: JobPagePayload) {
    const api = { get: async () => next, post: async () => ({}), hosted: () => false } as unknown as ApiClient;
    const store: JobStore = createJobStore(SLUG, { api, initial: payload(), events: () => () => {} });
    render(<JobStoreContext.Provider value={store}><JobRows cursor={null} first={7} onOpen={() => {}} /></JobStoreContext.Provider>);
    return store;
  }
  const withOneMore = (): JobPagePayload => {
    const p = payload();
    const last = p.thread[p.thread.length - 1];
    p.thread = [...p.thread, { ...last, id: 'reply:speed-check', kind: 'reply', mine: false, at: '2026-11-04T23:00:00.000Z', headline: 'One more reply', hash: 'h1' }];
    p.rows = { ...p.rows, conversation: { ...p.rows.conversation, count: p.rows.conversation.count + 1 } };
    p.v += 1;
    return p;
  };

  it('what is new sits after the row\'s name, and the count stays at the end of the row, so neither moves the other (speed rule 3)', async () => {
    writeStored(seenKey(SLUG), '2026-11-04T15:00:00.000Z');
    const store = mountWithNext(withOneMore());
    await act(async () => { await store.loadPage(); });
    const row = screen.getByRole('button', { name: 'Conversation · 53 · 1 new' });
    const parts = [...row.children].map((c) => c.className);
    expect(parts.indexOf('jp2-jr-new')).toBeGreaterThanOrEqual(0);
    expect(parts.indexOf('jp2-jr-new')).toBeLessThan(parts.indexOf('jp2-jr-more'));
    expect(row.querySelector('.jp2-jr-more')!.textContent).toBe('53');
    expect(row.querySelector('.jp2-jr-new')!.textContent).toBe('1 new');
  });
});
