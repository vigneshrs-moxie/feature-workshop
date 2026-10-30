import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { createStore, WorkshopContext } from '../../state/store';
import { snapshot } from '../../state/test-fixtures';
import { currentTheme, initTheme, setThemeUnlocks, THEME_FOLLOW_KEY, THEME_KEY } from '../../theme/theme';
import { ThemePicker } from './ThemePicker';

function setup() {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings: { policy: 'hands-off', play: { mode: 'subtle', questDone: 'first-pr', sounds: false } } } }) });
  const post = vi.fn(async () => ({}));
  render(<WorkshopContext.Provider value={{ store, api: { post } as unknown as ApiClient }}><ThemePicker /></WorkshopContext.Provider>);
  return { post };
}

afterEach(() => { setThemeUnlocks({}); localStorage.clear(); document.documentElement.removeAttribute('data-theme'); vi.unstubAllGlobals(); });

/** A system that prefers `scheme`, for Follow the system (theme.ts systemScheme asks matchMedia). */
function systemPrefers(scheme: 'dark' | 'light') {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('light') ? scheme === 'light' : scheme === 'dark', addEventListener() {}, removeEventListener() {} }));
}

// Light and Default come first, beside Follow the system; All themes holds the rest in two groups.
const FIRST = ['light', 'default'];
const DARK = ['neon-arcade', 'blueprint', 'pixel-crew', 'candy-pop', 'glass'];
const LIGHT = ['sunset-paper', 'light-glass'];

describe('theme picker and the hidden themes', () => {
  it('lists Light and Default first, then All themes: the rest in two groups, Dark then Light; CRT Terminal and Gold only once unlocked, each with an “Unlocked” tag', () => {
    setup();
    const radios = () => screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value);
    expect(radios()).toEqual([...FIRST, ...DARK, ...LIGHT]);
    expect(screen.getByRole('button', { name: /^All themes \(7\)/ })).toHaveAttribute('aria-expanded', 'true');
    // Light is what a new browser opens in: it carries the Default tag.
    expect(within(screen.getByRole('radio', { name: /^Light( Chosen)? Default$/ }).closest('label')!).getByText('Default')).toBeInTheDocument();
    const inGroup = (name: string) => within(screen.getByRole('group', { name })).getAllByRole('radio').map((r) => (r as HTMLInputElement).value);
    expect(inGroup('Dark')).toEqual(DARK);
    expect(inGroup('Light')).toEqual(LIGHT);
    expect(screen.queryByText('CRT Terminal')).toBeNull();
    expect(screen.queryByText('Unlocked')).toBeNull();

    act(() => setThemeUnlocks({ crt: true }));
    expect(radios()).toContain('crt');
    expect(radios()).not.toContain('gold');
    const crt = screen.getByRole('radio', { name: /CRT Terminal/ }).closest('label')!;
    expect(within(crt).getByText('Unlocked')).toHaveAttribute('title');

    act(() => setThemeUnlocks({ crt: true, gold: true }));
    expect(radios()).toEqual([...FIRST, ...DARK, 'crt', 'gold', ...LIGHT]);
    expect(screen.getByRole('button', { name: /^All themes \(9\)/ })).toBeInTheDocument();
    expect(inGroup('Dark')).toEqual([...DARK, 'crt', 'gold']);
    expect(screen.getAllByText('Unlocked')).toHaveLength(2);
  });

  it('draws each theme as a swatch in its own tokens, the name under it, and marks the chosen one with a word and a ring; its description is the line under the grid, and every card’s title', () => {
    localStorage.setItem(THEME_KEY, 'default');
    setup();
    const option = (id: string) => screen.getByRole('radio', { name: new RegExp(`^${id === 'default' ? 'Default' : 'Light glass'}`) }).closest('label')!;
    const swatch = option('default').querySelector('.theme-swatch')!;
    expect(swatch).toHaveAttribute('data-theme', 'default');
    expect(swatch).toHaveAttribute('aria-hidden', 'true');
    expect(option('light-glass').querySelector('.theme-swatch')).toHaveAttribute('data-theme', 'light-glass');
    expect(option('default')).toHaveClass('is-picked');
    expect(within(option('default')).getByText('Chosen')).toBeInTheDocument();
    expect(screen.getAllByText('Chosen')).toHaveLength(1);
    // The description is not on the card (the grid is compact): it is the card's title, and the chosen one's line under the grid.
    expect(option('light-glass')).toHaveAttribute('title', expect.stringMatching(/Frosted white panes/));
    expect(within(option('light-glass')).queryByText(/Frosted white panes/)).toBeNull();
    expect(screen.getByTestId('theme-chosen-line')).toHaveTextContent(/^Chosen: Default — The plain dark look/);
    fireEvent.click(screen.getByRole('radio', { name: /^Light glass/ }));
    expect(currentTheme()).toBe('light-glass');
    expect(option('light-glass')).toHaveClass('is-picked');
    expect(within(option('light-glass')).getByText('Chosen')).toBeInTheDocument();
    expect(option('default')).not.toHaveClass('is-picked');
    expect(screen.getByTestId('theme-chosen-line')).toHaveTextContent(/^Chosen: Light glass — Frosted white panes/);
    expect(screen.getAllByText(/Frosted white panes/)).toHaveLength(1);
  });

  it('with Follow the system on, a pick the system would swap is put on and turns Follow off', () => {
    systemPrefers('dark');
    localStorage.setItem(THEME_FOLLOW_KEY, 'on');
    setup();
    const option = (name: RegExp) => screen.getByRole('radio', { name }).closest('label')!;
    const light = /^Light( Chosen)? Default$/; // the radio's name: label, the Chosen mark and the Default tag (the description is the card's title)
    fireEvent.click(screen.getByRole('radio', { name: light }));
    // A dark system would show Default (Light's twin); the pick wins and Follow the system goes off.
    expect(currentTheme()).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(localStorage.getItem(THEME_FOLLOW_KEY)).toBe('off');
    expect(option(light)).toHaveClass('is-picked');
    expect(within(option(light)).getByText('Chosen')).toBeInTheDocument();
    expect(option(/^Default/)).not.toHaveClass('is-picked');
    expect(screen.getAllByText('Chosen')).toHaveLength(1);
    // A theme with no pair is shown as chosen and is on screen.
    fireEvent.click(screen.getByRole('radio', { name: /Blueprint/ }));
    expect(currentTheme()).toBe('blueprint');
    expect(within(option(/Blueprint/)).getByText('Chosen')).toBeInTheDocument();
  });

  it('clicking the chosen theme while Follow the system shows its twin puts it on and turns Follow off', () => {
    systemPrefers('dark');
    localStorage.setItem(THEME_KEY, 'light');
    localStorage.setItem(THEME_FOLLOW_KEY, 'on');
    initTheme();
    setup();
    expect(currentTheme()).toBe('default');
    fireEvent.click(screen.getByRole('radio', { name: /^Light Chosen Default$/ }));
    expect(currentTheme()).toBe('light');
    expect(localStorage.getItem(THEME_FOLLOW_KEY)).toBe('off');
  });

  it('picking an unlocked hidden theme puts it on and tells the ledger it was tried', async () => {
    const { post } = setup();
    act(() => setThemeUnlocks({ gold: true }));
    fireEvent.click(screen.getByRole('radio', { name: /Gold/ }));
    expect(currentTheme()).toBe('gold');
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/api/play/event', { kind: 'theme', id: 'gold' }));
    // Locked again (Play turned Off): it gives way to the default (Light) and leaves the list.
    act(() => setThemeUnlocks({}));
    expect(currentTheme()).toBe('light');
    expect(screen.queryByRole('radio', { name: /Gold/ })).toBeNull();
  });
});
