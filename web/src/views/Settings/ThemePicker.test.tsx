import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { createStore, WorkshopContext } from '../../state/store';
import { snapshot } from '../../state/test-fixtures';
import { currentTheme, setThemeUnlocks } from '../../theme/theme';
import { ThemePicker } from './ThemePicker';

function setup() {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings: { policy: 'hands-off', play: { mode: 'subtle', questDone: 'first-pr', sounds: false } } } }) });
  const post = vi.fn(async () => ({}));
  render(<WorkshopContext.Provider value={{ store, api: { post } as unknown as ApiClient }}><ThemePicker /></WorkshopContext.Provider>);
  return { post };
}

afterEach(() => { setThemeUnlocks({}); localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });

describe('theme picker and the hidden themes', () => {
  it('lists the seven; CRT Terminal and Gold only once unlocked, each with an “Unlocked” tag', () => {
    setup();
    const radios = () => screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value);
    expect(radios()).toEqual(['default', 'neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop', 'glass']);
    expect(screen.queryByText('CRT Terminal')).toBeNull();
    expect(screen.queryByText('Unlocked')).toBeNull();

    act(() => setThemeUnlocks({ crt: true }));
    expect(radios()).toContain('crt');
    expect(radios()).not.toContain('gold');
    const crt = screen.getByRole('radio', { name: /CRT Terminal/ }).closest('label')!;
    expect(within(crt).getByText('Unlocked')).toHaveAttribute('title');

    act(() => setThemeUnlocks({ crt: true, gold: true }));
    expect(radios()).toEqual(['default', 'neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop', 'glass', 'crt', 'gold']);
    expect(screen.getAllByText('Unlocked')).toHaveLength(2);
  });

  it('picking an unlocked hidden theme puts it on and tells the ledger it was tried', async () => {
    const { post } = setup();
    act(() => setThemeUnlocks({ gold: true }));
    fireEvent.click(screen.getByRole('radio', { name: /Gold/ }));
    expect(currentTheme()).toBe('gold');
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/api/play/event', { kind: 'theme', id: 'gold' }));
    // Locked again (Play turned Off): it gives way to the default and leaves the list.
    act(() => setThemeUnlocks({}));
    expect(currentTheme()).toBe('default');
    expect(screen.queryByRole('radio', { name: /Gold/ })).toBeNull();
  });
});
