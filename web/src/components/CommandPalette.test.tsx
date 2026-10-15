import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Command } from '../app/commands';
import { CommandPalette } from './CommandPalette';

const cmd = (id: string, label: string, extra: Partial<Command> = {}): Command => ({ id, label, hint: `Hint for ${label}.`, section: 'Go to', run: vi.fn(), ...extra });

function setup() {
  const commands = [cmd('new-job', 'New job…', { section: 'Jobs', keys: 'c' }), cmd('settings', 'Settings'), cmd('classic-costs', 'Costs (classic view)')];
  const onClose = vi.fn();
  render(<CommandPalette commands={commands} onClose={onClose} />);
  return { commands, onClose, box: screen.getByRole('combobox', { name: 'Search actions' }) };
}

describe('CommandPalette', () => {
  it('is an ARIA combobox over a listbox, focused, with the first action highlighted', () => {
    const { box } = setup();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toHaveAttribute('aria-modal', 'true');
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('listbox');
    expect(box).toHaveAttribute('aria-controls', list.id);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', options[0].id);
    expect(options[0]).toHaveAttribute('title', 'Hint for New job….');
    expect(options[0]).toHaveTextContent('c');
  });

  it('moves with the arrow keys, wrapping round', () => {
    const { box } = setup();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    let options = screen.getAllByRole('option');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', options[1].id);
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    options = screen.getAllByRole('option');
    expect(options[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('narrows as you type, and Enter runs the highlighted action after closing', () => {
    const { box, commands, onClose } = setup();
    fireEvent.change(box, { target: { value: 'cost' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onClose).toHaveBeenCalled();
    expect(commands[2].run).toHaveBeenCalled();
    expect(commands[0].run).not.toHaveBeenCalled();
  });

  it('says so when nothing matches', () => {
    const { box } = setup();
    fireEvent.change(box, { target: { value: 'nothing like this' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(box).not.toHaveAttribute('aria-activedescendant');
    expect(screen.getByRole('status')).toHaveTextContent('Nothing matches');
  });

  it('runs an action you click, and Esc closes without running anything', () => {
    const { box, commands, onClose } = setup();
    fireEvent.click(screen.getByRole('option', { name: /Settings/ }));
    expect(commands[1].run).toHaveBeenCalled();
    onClose.mockClear();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
