import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { createStore, WorkshopContext } from '../../state/store';
import { snapshot } from '../../state/test-fixtures';
import { TEXT_SIZE_KEY } from '../../theme/textSize';
import { currentTheme, initTheme, setThemeUnlocks, THEME_FOLLOW_KEY, THEME_KEY } from '../../theme/theme';
import { followLine, LookSettings } from './LookSettings';

// The system's colour scheme, as matchMedia reports it (jsdom has none); tests flip it and fire 'change'.
// The listener set is kept across tests: initTheme installs its listener once per module.
let systemLight = false;
const changeListeners = new Set<() => void>();
beforeEach(() => {
  systemLight = false;
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() { return query.includes('light') ? systemLight : !systemLight; },
    addEventListener: (_: string, fn: () => void) => { changeListeners.add(fn); },
    removeEventListener: (_: string, fn: () => void) => { changeListeners.delete(fn); },
  })) as unknown as typeof window.matchMedia;
});

function setup() {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings: { policy: 'hands-off', play: { mode: 'off', questDone: 'first-pr', sounds: false } } } }) });
  initTheme(); // as main.tsx does: the theme, and the listener for the system's scheme
  render(<WorkshopContext.Provider value={{ store, api: { post: vi.fn(async () => ({})) } as unknown as ApiClient }}><LookSettings /></WorkshopContext.Provider>);
}

afterEach(() => {
  setThemeUnlocks({});
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-text');
});

describe('Settings → Look', () => {
  it('is one section, Look, holding the theme swatches, the text size and Follow the system', () => {
    setup();
    const look = screen.getByRole('region', { name: 'Look' });
    expect(within(look).getByRole('heading', { name: 'Look' })).toBeInTheDocument();
    expect(within(look).getByRole('group', { name: 'How the Workshop looks' })).toBeInTheDocument();
    expect(within(look).getByRole('group', { name: 'Text size' })).toBeInTheDocument();
    expect(within(look).getByRole('checkbox', { name: /Follow the system/ })).toBeInTheDocument();
  });

  it('text size: four buttons, S M L XL, the one on pressed; a pick sets html[data-text], is remembered, and the sample line follows', () => {
    setup();
    const group = screen.getByRole('group', { name: 'Text size' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['S', 'M', 'L', 'XL']);
    expect(within(group).getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/The quick brown fox/)).toBeInTheDocument();
    expect(screen.getByText(/Medium: body text 13 px/)).toBeInTheDocument();

    fireEvent.click(within(group).getByRole('button', { name: 'XL' }));
    expect(document.documentElement.getAttribute('data-text')).toBe('xl');
    expect(localStorage.getItem(TEXT_SIZE_KEY)).toBe('xl');
    expect(within(group).getByRole('button', { name: 'XL' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/Extra large: body text 16.3 px/)).toBeInTheDocument();
    expect(screen.getByText(/The quick brown fox/)).toHaveAttribute('data-size', 'xl');
  });

  it('Follow the system is off by default and says which pair it switches for the chosen theme', () => {
    setup();
    const box = screen.getByRole('checkbox', { name: /Follow the system/ });
    expect(box).not.toBeChecked();
    expect(screen.getByText(/Switches between Default when your system is dark and Light in daylight/)).toBeInTheDocument();
    expect(followLine('glass')).toBe('Switches between Glass when your system is dark and Light glass in daylight.');
    expect(followLine('light-glass')).toBe('Switches between Glass when your system is dark and Light glass in daylight.');
    expect(followLine('sunset-paper')).toMatch(/Sunset paper has no dark or light twin/);
  });

  it('turning it on swaps the chosen theme for its twin by the system scheme, now and when the system changes; a theme with no twin stays', () => {
    setup();
    systemLight = true;
    fireEvent.click(screen.getByRole('checkbox', { name: /Follow the system/ }));
    expect(localStorage.getItem(THEME_FOLLOW_KEY)).toBe('on');
    expect(currentTheme(), 'Default follows a light system to Light').toBe('light');
    expect(screen.getByRole('radio', { name: /^Light Chosen/ })).toBeChecked();
    expect(localStorage.getItem(THEME_KEY), 'the choice itself is not rewritten').toBeNull();

    // The system turns dark: the listener initTheme installed re-applies, back to Default.
    systemLight = false;
    act(() => { for (const fn of changeListeners) fn(); });
    expect(currentTheme()).toBe('default');
    systemLight = true;
    act(() => { for (const fn of changeListeners) fn(); });
    expect(currentTheme()).toBe('light');

    // Picking Glass while the system is light shows Light glass; the line names the pair.
    fireEvent.click(screen.getByRole('radio', { name: /^Glass/ }));
    expect(localStorage.getItem(THEME_KEY)).toBe('glass');
    expect(currentTheme()).toBe('light-glass');
    expect(screen.getByText(/Switches between Glass when your system is dark and Light glass in daylight/)).toBeInTheDocument();

    // A theme with no twin is left alone.
    fireEvent.click(screen.getByRole('radio', { name: /Sunset paper/ }));
    expect(currentTheme()).toBe('sunset-paper');
    expect(screen.getByText(/Sunset paper has no dark or light twin/)).toBeInTheDocument();

    // Off again: the chosen theme as chosen, whatever the system says.
    fireEvent.click(screen.getByRole('radio', { name: /^Glass/ }));
    act(() => { fireEvent.click(screen.getByRole('checkbox', { name: /Follow the system/ })); });
    expect(localStorage.getItem(THEME_FOLLOW_KEY)).toBe('off');
    expect(currentTheme()).toBe('glass');
  });
});
