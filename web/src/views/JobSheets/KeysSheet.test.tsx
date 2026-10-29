import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyListener, KEY_IDS, KEYS, registerKeys, SCOPES, type KeyScope } from '../../app/keyRegistry';
import { writeKeysSetting } from '../../app/keysSetting';
import { GROUP_ORDER, KeysSheet } from './KeysSheet';

let off = () => {};
beforeEach(() => {
  const uninstall = installKeyListener();
  const reg = registerKeys('global', { current: { 'keys': () => {} } });
  off = () => { reg.unregister(); uninstall(); };
});
afterEach(() => { off(); localStorage.clear(); });

describe('the ? sheet', () => {
  it('lists every key from the registry, grouped by where it works, marking the groups not on this page', () => {
    const onClose = vi.fn();
    render(<KeysSheet onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveAttribute('aria-modal', 'true');
    const everywhere = screen.getByRole('region', { name: 'Everywhere' });
    expect(within(everywhere).getByRole('heading')).toHaveTextContent(/^Everywhere$/);
    expect(within(everywhere).getByText(/Where it works:/)).toHaveTextContent('On every page, outside a text box.');
    expect(within(everywhere).getByText('Start a new job').closest('.key-row')).toHaveTextContent('c');
    expect(within(everywhere).getByText('Go to the Table').closest('.key-row')).toHaveTextContent('g t');
    expect(within(everywhere).getByText(/Close the menu, sheet or drawer/).closest('.key-row')).toHaveTextContent('Esc');
    const desk = screen.getByRole('region', { name: 'The Desk' });
    expect(within(desk).getByRole('heading')).toHaveTextContent('(not on this page)');
    expect(within(desk).getByText('Approve, or Allow once').closest('.key-row')).toHaveTextContent('Never for a hard line, a risky step or a question.');
    const gate = screen.getByRole('region', { name: 'The gate card' });
    expect(within(gate).getByText(/Pick that answer/).closest('.key-row')).toHaveTextContent('1 / 2 / 3');
    // The Desk's o (open the job) outranks the gate's: the sheet says so instead of promising it there.
    expect(within(gate).getByText('Other guidance').closest('.key-row')).toHaveTextContent('On the job only: on the Desk, o opens the job.');
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says so when keys are off', () => {
    writeKeysSetting({ enabled: false });
    render(<KeysSheet onClose={() => {}} />);
    expect(screen.getByRole('note')).toHaveTextContent('Keyboard shortcuts are off (Settings → Keys)');
  });

  it('every key in the registry is listed once, under its scope: the Inbox, the stop and the alert too', () => {
    render(<KeysSheet onClose={() => {}} />);
    expect([...new Set(KEY_IDS.map((id) => KEYS[id].scope))].filter((s) => !GROUP_ORDER.includes(s))).toEqual([]);
    for (const id of KEY_IDS) {
      const group = screen.getByRole('region', { name: SCOPES[KEYS[id].scope as KeyScope].title });
      expect(within(group).getAllByText(KEYS[id].label).length, id).toBeGreaterThan(0);
    }
    expect(within(screen.getByRole('region', { name: 'The Inbox' })).getByText('Start a job on the ticket').closest('.key-row')).toHaveTextContent(/^s/);
    const stage = screen.getByRole('region', { name: 'A stop of a job' });
    expect(within(stage).getByText('The stop before this one').closest('.key-row')).toHaveTextContent('[');
    expect(within(stage).getByText('The stop after this one').closest('.key-row')).toHaveTextContent(']');
    expect(within(screen.getByRole('region', { name: 'The permission alert' })).getByText('Allow once')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'The Jobs page' })).getByText(/Open the job the next-step bar names/)).toBeInTheDocument();
  });
});
