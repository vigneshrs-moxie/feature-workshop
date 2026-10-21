import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyListener, registerKeys } from '../../app/keyRegistry';
import { writeKeysSetting } from '../../app/keysSetting';
import { KeysSheet } from './KeysSheet';

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
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says so when keys are off', () => {
    writeKeysSetting({ enabled: false });
    render(<KeysSheet onClose={() => {}} />);
    expect(screen.getByRole('note')).toHaveTextContent('Keyboard shortcuts are off (Settings → Keys)');
  });
});
