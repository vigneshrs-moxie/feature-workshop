import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Settings } from '../../api/types';
import { playOf, PLAY_DEFAULTS } from '../../play/settings';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { ev, snapshot } from '../../state/test-fixtures';
import { PlaySettings } from './PlaySettings';
import { ThemePicker } from './ThemePicker';

function setup(settings: Settings, post?: (path: string, body: unknown) => Promise<unknown>, ui = <PlaySettings />) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings } }) });
  // The dashboard answers with the settings merged, as POST /api/settings does.
  const answer = post ?? (async (_p: string, body: unknown) => {
    const now = store.getState().meta!.settings!;
    const b = body as { play?: Partial<Settings['play']> };
    return b.play ? { ...now, play: { ...playOf(now), ...b.play } } : { ok: true };
  });
  const api = { post: vi.fn(answer) } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}>{ui}</WorkshopContext.Provider>);
  return { store, post: api.post as ReturnType<typeof vi.fn> };
}

afterEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });

describe('playOf', () => {
  it('fills in the defaults, so a dashboard without them reads as Subtle', () => {
    expect(playOf(undefined)).toEqual(PLAY_DEFAULTS);
    expect(playOf({ policy: 'hands-off' })).toEqual({ mode: 'subtle', sounds: false });
    expect(playOf({ policy: 'hands-off', play: { mode: 'full', sounds: true } })).toEqual({ mode: 'full', sounds: true });
    // The quest rule from an older dashboard is ignored: the finish line (Settings → Workflow) decides now.
    expect(playOf({ policy: 'hands-off', play: { mode: 'full', questDone: 'marked-done', sounds: true } })).toEqual({ mode: 'full', sounds: true });
  });
});

describe('Settings → Play', () => {
  it('offers Full, Subtle and Off with hints, Subtle by default, and explains itself', () => {
    setup({ policy: 'hands-off' });
    const group = screen.getByRole('group', { name: 'Play mode' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['full', 'subtle', 'off']);
    expect(within(group).getByRole('radio', { name: /Subtle/ })).toBeChecked();
    for (const r of radios) expect(r.closest('label')).toHaveAttribute('title');
    expect(within(group).getByText(/exactly as it was/)).toBeInTheDocument();
    expect(screen.getByText('How this works')).toBeInTheDocument();
    expect(screen.getByText(/approving something earns nothing/)).toBeInTheDocument();
  });

  it('no longer asks when a quest counts as done: that is the finish line, under Workflow', () => {
    setup({ policy: 'hands-off' });
    expect(screen.queryByRole('group', { name: /quest counts as done/ })).toBeNull();
    expect(screen.getByText(/finish line you set under Workflow/)).toBeInTheDocument();
  });

  it('sounds are only for Full mode: off and disabled in Subtle, available once Full is picked', async () => {
    const { post } = setup({ policy: 'hands-off' });
    const sounds = screen.getByRole('checkbox', { name: /Sounds/ });
    expect(sounds).toBeDisabled();
    expect(sounds).not.toBeChecked();
    expect(sounds.closest('label')).toHaveAttribute('title', expect.stringContaining('Full mode'));
    fireEvent.click(screen.getByRole('radio', { name: /Full/ }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Sounds/ })).toBeEnabled());
    expect(post).toHaveBeenCalledWith('/api/settings', { play: { mode: 'full' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Sounds/ }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Sounds/ })).toBeChecked());
    expect(post).toHaveBeenLastCalledWith('/api/settings', { play: { sounds: true } });
  });

  it('says why when the setting can’t be saved', async () => {
    setup({ policy: 'hands-off' }, async () => { throw new Error('Play mode: pick Full, Subtle or Off.'); });
    fireEvent.click(screen.getByRole('radio', { name: /Off/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Play mode: pick Full, Subtle or Off.');
  });

  it('follows a change made elsewhere (the settings event)', () => {
    const { store } = setup({ policy: 'hands-off' });
    act(() => store.dispatch({ type: 'event', event: ev(11, 'settings', null, { policy: 'hands-off', play: { mode: 'off', sounds: false } }) }));
    expect(screen.getByRole('radio', { name: /Off/ })).toBeChecked();
  });
});

describe('Theme picker → the play ledger', () => {
  it('tells the dashboard which theme you tried, unless Play is Off', async () => {
    const { post } = setup({ policy: 'hands-off' }, undefined, <ThemePicker />);
    fireEvent.click(screen.getByRole('radio', { name: /Blueprint/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/play/event', { kind: 'theme', id: 'blueprint' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('blueprint');
  });

  it('records nothing with Play mode Off, and the pick still applies', async () => {
    const { post } = setup({ policy: 'hands-off', play: { mode: 'off', sounds: false } }, undefined, <ThemePicker />);
    fireEvent.click(screen.getByRole('radio', { name: /Candy pop/ }));
    await Promise.resolve();
    expect(post).not.toHaveBeenCalled();
    expect(document.documentElement.getAttribute('data-theme')).toBe('candy-pop');
  });
});
