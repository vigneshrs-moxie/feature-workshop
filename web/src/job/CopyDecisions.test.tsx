// "Copy decisions": the panel shows what will be copied, Copy puts exactly that on the clipboard,
// and the button sits in the job's details and at the top of the Decisions tab.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { createStore, WorkshopContext } from '../state/store';
import { DecisionsTab } from '../panes/Preview/DecisionsTab';
import { CopyDecisions } from './CopyDecisions';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const TEXT = 'ORBIT-472 decisions, 10 Nov\n1. Who can add team members? Managers only.\n   Why: sent back at PR #1.\nNot doing: roster import';

function setup(ui = <CopyDecisions slug="orbit-472-roster" />) {
  const get = vi.fn(async (url: string) => (url.endsWith('decisions.md') ? { file: 'decisions.md', path: '/x', text: '| table |', orbit: { text: TEXT, count: 1 } } : { decisions: [] }));
  const api = { get, post: vi.fn() } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store: createStore(), api }}>{ui}</WorkshopContext.Provider>);
  return get;
}

function clipboard(writeText = vi.fn(async () => {})) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('CopyDecisions', () => {
  it('Copy decisions shows what will be copied', async () => {
    const get = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy decisions' }));
    const text = await screen.findByLabelText('The text that will be copied');
    expect(text.textContent).toBe(TEXT);
    expect(get).toHaveBeenCalledWith('/api/jobs/orbit-472-roster/decisions.md');
  });
  it('Copy puts that exact text on the clipboard, then says Copied for two seconds', async () => {
    const writeText = clipboard();
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy decisions' }));
    await screen.findByLabelText('The text that will be copied');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(writeText).toHaveBeenCalledWith(TEXT);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
  it('says so when the browser refused the copy', async () => {
    clipboard(vi.fn(async () => { throw new Error('denied'); }));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy decisions' }));
    await screen.findByLabelText('The text that will be copied');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn’t copy/);
  });
  it('the button is on the Decisions tab (the header has it too, see JobPage.test.tsx)', () => {
    setup(<DecisionsTab slug="orbit-472-roster" active />);
    expect(screen.getByRole('button', { name: 'Copy decisions' })).toBeInTheDocument();
  });
});
