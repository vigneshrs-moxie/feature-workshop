// "Copy for the ticket" on the Decisions tab: reads decisions.md, copies its plain text, says how
// many lines, and says so when only the last 40 were copied.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { createStore, WorkshopContext } from '../../state/store';
import { CopyForTicket } from './CopyForTicket';

afterEach(cleanup);

const TEXT = '# ORBIT-479 · Feedback API\n\n| id | question | options | choice | who | when | why |\n|---|---|---|---|---|---|---|\n| ORBIT-479.D1 | Brief 1: go ahead? | approve · send back · stop | approve | Vignesh | 2026-10-27 | ok |\n\n## Not doing\n- CSV import';

function setup(copy: { text: string; lines: number; total: number; cut: boolean }, get = vi.fn(async () => ({ file: 'decisions.md', path: '/f/x/decisions.md', text: TEXT, copy }))) {
  const api = { get, post: vi.fn() } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store: createStore(), api }}><CopyForTicket slug="orbit-479-feedback" active /></WorkshopContext.Provider>);
  return get;
}

function clipboard(writeText = vi.fn(async () => {})) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('CopyForTicket', () => {
  it('reads the file and copies its plain text, pipes kept', async () => {
    const writeText = clipboard();
    const get = setup({ text: TEXT, lines: 8, total: 8, cut: false });
    expect(await screen.findByText(/decisions\.md in the job folder · 8 lines/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/jobs/orbit-479-feedback/decisions.md');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy for the ticket' })); });
    expect(writeText).toHaveBeenCalledWith(TEXT);
    expect(screen.getByRole('status')).toHaveTextContent('Copied 8 lines.');
  });
  it('says so when a long file gave only its last 40 lines', async () => {
    clipboard();
    setup({ text: 'last part', lines: 40, total: 57, cut: true });
    await screen.findByText(/57 lines/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy for the ticket' })); });
    expect(screen.getByRole('status')).toHaveTextContent('Copied the last 40 of 57 lines. The whole list is in decisions.md in the job folder.');
  });
  it('says when the browser refused the copy, and when the file could not be read', async () => {
    clipboard(vi.fn(async () => { throw new Error('denied'); }));
    setup({ text: TEXT, lines: 8, total: 8, cut: false });
    await screen.findByText(/8 lines/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy for the ticket' })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn’t copy/);
    cleanup();
    setup({ text: '', lines: 0, total: 0, cut: false }, vi.fn(async () => { throw new Error('No job by that name.'); }));
    expect(await screen.findByText('Couldn’t read decisions.md: No job by that name.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy for the ticket' })).toBeDisabled();
  });
});
