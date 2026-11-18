// The conversation's list (ThreadList), as a stack part's page and the quick look use it: Load older
// keeps the keyboard focus, and the new line above the first message since the last look. Moved
// from the old job page's conversation panel tests when that page went (plan Task 26).
// Invented jobs and messages only; no model calls.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { JobDetail, ThreadItem } from '../../api/types';
import { jobBySlug } from '../../state/reducer';
import { createStore, useWorkshopState, WorkshopContext, type Store } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { ThreadList, useJobConversation } from './ForemanPane';

const NOW = new Date(Date.UTC(2026, 10, 10, 12, 0));
const at = (m: number) => new Date(Date.UTC(2026, 10, 10, 9, m)).toISOString();
const reply = (n: number, m = n): ThreadItem => ({ id: `reply:${n}`, kind: 'reply', at: at(m), html: `<p>Message ${n} from the Foreman.</p>` });
const you = (n: number, m = n): ThreadItem => ({ id: `you:${n}`, kind: 'you', at: at(m), text: `Message ${n} from you.` });
const THREAD: ThreadItem[] = [reply(3), reply(5), you(6), { id: 'decision:7', kind: 'decision', at: at(7), text: 'You allowed: Run the tests' }, reply(8), reply(9)];
const LONG: ThreadItem[] = Array.from({ length: 30 }, (_, i) => reply(i + 11, i + 11));
const OLDER: ThreadItem[] = Array.from({ length: 10 }, (_, i) => reply(i + 1, i + 1));

/** What the test's server holds: the newest page, whether older pages exist, and the older page. */
const server = { thread: [] as ThreadItem[], more: false, older: [] as ThreadItem[] };

function List({ newFrom }: { newFrom?: string | null }) {
  const j = jobBySlug(useWorkshopState(), 'alpha')!;
  const conversation = useJobConversation(j);
  return <ThreadList job={j} conversation={conversation} now={NOW} cards={false} newFrom={newFrom} name="Messages" />;
}

function setup({ thread = THREAD, more = false, older = [] as ThreadItem[], hosted = false, newFrom = undefined as string | null | undefined } = {}) {
  server.thread = thread;
  server.more = more;
  server.older = older;
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'running')] }) });
  const get = vi.fn(async (path: string): Promise<unknown> => {
    if (path.includes('?before=')) return { thread: server.older, threadMore: false };
    if (path === '/api/job/alpha') return { slug: 'alpha', thread: server.thread, threadMore: server.more, run: null } as JobDetail;
    throw new ApiError(404, 'Not here.');
  });
  const api = { get, post: vi.fn(async () => ({ ok: true })), ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
  return { ...render(<WorkshopContext.Provider value={{ store, api }}><List newFrom={newFrom} /></WorkshopContext.Provider>), get };
}

/** The conversation is in and its loading line has gone. */
async function loaded(text: string) {
  await screen.findByText(text);
  await waitFor(() => expect(document.querySelector('.thread .pending')).toBeNull());
}

afterEach(() => { cleanup(); localStorage.clear(); });

describe('ThreadList', () => {
  // Final review A6 (calls Minor 6): Load older keeps the keyboard focus.
  it('Load older keeps the focus while it loads, then gives it to the first message loaded', async () => {
    for (const hosted of [false, true]) {
      const { get } = setup({ thread: LONG, more: true, older: OLDER, hosted });
      await loaded('Message 40 from the Foreman.');
      let release = () => {};
      const held = new Promise<void>((r) => { release = r; });
      const answer = get.getMockImplementation()!;
      get.mockImplementation((path: string) => (path.includes('?before=') ? held.then(() => answer(path)) : answer(path)));
      const older = screen.getByRole('button', { name: 'Load older' });
      older.focus();
      fireEvent.click(older);
      // While it loads the button stays, enabled and busy, with the focus.
      await waitFor(() => expect(older).toHaveAttribute('aria-busy', 'true'));
      expect(older).toBeEnabled();
      expect(older).toHaveFocus();
      // A second press while it loads asks for nothing more.
      fireEvent.click(older);
      expect(get.mock.calls.filter(([p]) => String(p).includes('?before=')).length).toBe(1);
      await act(async () => { release(); });
      await screen.findByText('Message 1 from the Foreman.');
      expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
      await waitFor(() => expect(document.activeElement).toHaveTextContent('Message 1 from the Foreman.'));
      expect(document.activeElement).not.toHaveTextContent('Message 2 from the Foreman.');
      cleanup();
    }
  });

  it('with newFrom, the new line sits above the first new message that is not his own', async () => {
    setup({ newFrom: at(5) });
    await loaded('Message 9 from the Foreman.');
    const line = screen.getByRole('separator', { name: '2 new since you last looked' });
    expect(line).toHaveClass('sb-convo-new');
    // Above reply 8: his own message 6 and his decision 7 are not new.
    expect(line.nextElementSibling).toHaveTextContent('Message 8 from the Foreman.');
    expect(screen.getAllByText(/^\d+ new$/)).toHaveLength(1);
    cleanup();
    // Without it, no line.
    setup();
    await loaded('Message 9 from the Foreman.');
    expect(screen.queryByRole('separator')).toBeNull();
  });
});
