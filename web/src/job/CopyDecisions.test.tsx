// "Copy decisions": the panel shows what will be copied, Copy puts exactly that on the clipboard,
// and the button sits in the job's details and at the top of the Decisions tab.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
  it('the full list of decisions is one fold under what it copies, with one Copy decisions button', async () => {
    const get = vi.fn(async (url: string): Promise<unknown> => (url.endsWith('decisions.md')
      ? { file: 'decisions.md', path: '/x', text: '| table |', orbit: { text: TEXT, count: 1 } }
      : { decisions: [{ at: '2026-11-10T10:00:00Z', kind: 'approve', text: 'Approved brief 2' }] }));
    const api = { get, post: vi.fn() } as unknown as ApiClient;
    // A header that passes the full list: the fold holds it.
    render(<WorkshopContext.Provider value={{ store: createStore(), api }}><CopyDecisions slug="orbit-472-roster" all={<DecisionsTab slug="orbit-472-roster" active copy={false} />} /></WorkshopContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Copy decisions' }));
    const text = await screen.findByLabelText('The text that will be copied');
    const sheet = screen.getByRole('dialog', { name: 'Copy decisions' });
    const folds = sheet.querySelectorAll('details');
    expect(folds).toHaveLength(1);
    const fold = folds[0];
    expect(fold).toHaveClass('sb-copy-decisions-all');
    // Not read until the fold is opened.
    expect(get).not.toHaveBeenCalledWith('/api/job/orbit-472-roster/decisions');
    expect(fold.querySelector('summary')).toHaveTextContent('Everything decided on this job');
    // Under the text it copies.
    expect(text.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => { fireEvent.click(fold.querySelector('summary')!); });
    expect(await within(fold).findByText('Approved brief 2')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/job/orbit-472-roster/decisions');
    // One Copy decisions button on the whole screen: the one that opened this panel.
    expect(screen.getAllByRole('button', { name: 'Copy decisions' })).toHaveLength(1);
  });

  it('without the full list there is no fold: the Decisions tab’s own Copy decisions sheet does not repeat the list behind it', async () => {
    setup(<DecisionsTab slug="orbit-472-roster" active />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy decisions' }));
    await screen.findByLabelText('The text that will be copied');
    const sheet = screen.getByRole('dialog', { name: 'Copy decisions' });
    expect(sheet.querySelector('details')).toBeNull();
    expect(within(sheet).queryByText('Everything decided on this job')).toBeNull();
    // And no import cycle: Copy decisions does not import the Decisions tab (which imports it).
    expect(readFileSync(path.join(process.cwd(), 'src/job/CopyDecisions.tsx'), 'utf8')).not.toMatch(/from '\.\.\/panes\/Preview\/DecisionsTab'/);
  });

  it('the button is on the Decisions tab', () => {
    setup(<DecisionsTab slug="orbit-472-roster" active />);
    expect(screen.getByRole('button', { name: 'Copy decisions' })).toBeInTheDocument();
  });
});
