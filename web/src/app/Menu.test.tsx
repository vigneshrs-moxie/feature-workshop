// The menu button (Menu.tsx): after an action or a choice, the focus goes back to the button (16 Nov).
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MenuButton } from './Menu';

describe('MenuButton', () => {
  it('after an action or a choice the focus is on the menu’s button again, not lost', () => {
    const run = vi.fn();
    render(<MenuButton label="More" hint="More things" entries={[
      { kind: 'action', id: 'a', label: 'Do it', run },
      { kind: 'choices', id: 'c', label: 'Pick', options: [{ id: 'x', label: 'X', run, checked: false }] },
    ]} />);
    const button = screen.getByRole('button', { name: 'More' });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Do it' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'X' }));
    expect(document.activeElement).toBe(button);
  });

  it('an action that moves the focus itself keeps it there', () => {
    render(<><input aria-label="Box" /><MenuButton label="More" hint="More things" entries={[
      { kind: 'action', id: 'a', label: 'Write', run: () => (screen.getByRole('textbox', { name: 'Box' }) as HTMLInputElement).focus() },
    ]} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Write' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Box' }));
  });
});
