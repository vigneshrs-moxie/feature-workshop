import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Meta, Settings } from '../../api/types';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { snapshot } from '../../state/test-fixtures';
import { finishLineLabel, WorkflowSettings } from './WorkflowSettings';

const FINISH_LINES: NonNullable<Meta['finishLines']> = [
  { id: 'pr1-open', label: 'PR #1 open', hint: 'Done when the Foreman has opened PR #1 from your fork.' },
  { id: 'pr1-merged', label: 'PR #1 merged', hint: 'Done when your work is on the Moxie branch. From here on it waits on other people.' },
  { id: 'staging', label: 'In staging', hint: 'Done when PR #2 is merged and QA can see it.' },
  { id: 'main', label: 'In main', hint: 'Done when the release PR has carried it to main.' },
  { id: 'marked', label: 'When I mark it done', hint: 'Only Mark done counts.' },
];

function setup(settings: Settings, finishLines: Meta['finishLines'] = FINISH_LINES, post?: (path: string, body: unknown) => Promise<unknown>) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', settings, finishLines } }) });
  // The dashboard answers with the settings merged, as POST /api/settings does.
  const answer = post ?? (async (_p: string, body: unknown) => {
    const now = store.getState().meta!.settings!;
    const b = body as { workflow?: Partial<Settings['workflow']> };
    return { ...now, workflow: { ...now.workflow, ...b.workflow } };
  });
  const api = { post: vi.fn(answer) } as unknown as ApiClient;
  render(<WorkshopContext.Provider value={{ store, api }}><WorkflowSettings /></WorkshopContext.Provider>);
  return { store, post: api.post as ReturnType<typeof vi.fn> };
}

afterEach(() => { localStorage.clear(); });

describe('Settings → Workflow', () => {
  it('offers the finish line’s choices in the dashboard’s words, the default marked, and saves a pick', async () => {
    const { post, store } = setup({ policy: 'hands-off', workflow: { finishLine: 'pr1-merged' } });
    const group = screen.getByRole('group', { name: 'Finish line' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['pr1-open', 'pr1-merged', 'staging', 'main', 'marked']);
    expect(within(group).getByRole('radio', { name: /PR #1 merged/ })).toBeChecked();
    expect(within(group).getByRole('radio', { name: /PR #1 merged/ }).closest('label')).toHaveTextContent('Default');
    expect(within(group).getByText('Done when PR #2 is merged and QA can see it.')).toBeInTheDocument();
    for (const r of radios) expect(r.closest('label')).toHaveAttribute('title');
    fireEvent.click(within(group).getByRole('radio', { name: /In main/ }));
    await waitFor(() => expect(within(group).getByRole('radio', { name: /In main/ })).toBeChecked());
    expect(post).toHaveBeenCalledWith('/api/settings', { workflow: { finishLine: 'main' } });
    expect(store.getState().meta?.settings?.workflow?.finishLine).toBe('main');
  });

  it('Screens and Clarify for new jobs: Auto by default, each with what Auto means, saved on their own', async () => {
    const { post } = setup({ policy: 'hands-off', workflow: { finishLine: 'pr1-merged' } });
    const screens = screen.getByRole('radiogroup', { name: 'Screens (wireframes) for new jobs' });
    const clarify = screen.getByRole('radiogroup', { name: 'Clarify questions for new jobs' });
    for (const g of [screens, clarify]) {
      expect(within(g).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['auto', 'always', 'off']);
      expect(within(g).getByRole('radio', { name: 'Auto' })).toBeChecked();
    }
    expect(screen.getByText('Auto: At L2 and L3, when the spec names a screen.')).toBeInTheDocument();
    expect(screen.getByText('Auto: When the request leaves a product decision open.')).toBeInTheDocument();
    fireEvent.click(within(screens).getByRole('radio', { name: 'Always' }));
    await waitFor(() => expect(within(screens).getByRole('radio', { name: 'Always' })).toBeChecked());
    expect(post).toHaveBeenLastCalledWith('/api/settings', { workflow: { wireframes: 'always' } });
    fireEvent.click(within(clarify).getByRole('radio', { name: 'Off' }));
    await waitFor(() => expect(within(clarify).getByRole('radio', { name: 'Off' })).toBeChecked());
    expect(post).toHaveBeenLastCalledWith('/api/settings', { workflow: { clarify: 'off' } });
    // Screens kept its own value: the dashboard merged, the page followed.
    expect(within(screens).getByRole('radio', { name: 'Always' })).toBeChecked();
  });

  it('reads a stored choice, and says when the dashboard sent no finish line choices', () => {
    setup({ policy: 'hands-off', workflow: { finishLine: 'staging', wireframes: 'off', clarify: 'always' } }, []);
    expect(screen.getByRole('note')).toHaveTextContent('didn’t send the finish line’s choices');
    expect(screen.getByRole('note')).toHaveTextContent('In staging');
    expect(within(screen.getByRole('radiogroup', { name: /Screens/ })).getByRole('radio', { name: 'Off' })).toBeChecked();
    expect(within(screen.getByRole('radiogroup', { name: /Clarify/ })).getByRole('radio', { name: 'Always' })).toBeChecked();
  });

  it('says what went wrong when a save fails', async () => {
    setup({ policy: 'hands-off', workflow: { finishLine: 'pr1-merged' } }, FINISH_LINES, async () => { throw new Error('The dashboard is away.'); });
    fireEvent.click(screen.getByRole('radio', { name: /In main/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The dashboard is away.');
    expect(screen.getByRole('radio', { name: /PR #1 merged/ })).toBeChecked();
  });

  it('finishLineLabel prefers the dashboard’s words and falls back before they arrive', () => {
    expect(finishLineLabel('main', FINISH_LINES)).toBe('In main');
    expect(finishLineLabel(undefined, FINISH_LINES)).toBe('PR #1 merged');
    expect(finishLineLabel('marked', undefined)).toBe('When I mark it done');
    expect(finishLineLabel('staging', [{ id: 'staging', label: 'Staging, says the server' }])).toBe('Staging, says the server');
  });

  it('Choose the level for me: off by default, saves autoLevel when ticked', async () => {
    const { post, store } = setup({ policy: 'hands-off', workflow: { finishLine: 'pr1-merged' } });
    const box = screen.getByRole('checkbox', { name: 'Choose the level for me' });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/settings', { workflow: { autoLevel: true } }));
    await waitFor(() => expect(store.getState().meta?.settings?.workflow?.autoLevel).toBe(true));
  });

  it('Sections at once across every stack: 3 until set, saved through the stacks cap, a plain refusal outside 1 to 20', async () => {
    const answer = async (p: string, body: unknown) => {
      const b = body as { cap: number };
      expect(p).toBe('/api/stacks/cap');
      return { settings: { policy: 'hands-off', workflow: { finishLine: 'pr1-merged', sectionsAtOnce: b.cap } }, stacks: [], globalCap: b.cap, globalRunning: 0 };
    };
    const { post, store } = setup({ policy: 'hands-off', workflow: { finishLine: 'pr1-merged' } }, FINISH_LINES, answer);
    const box = screen.getByRole('spinbutton', { name: 'Sections at once, across every stack' });
    expect(box).toHaveValue('3');
    expect(screen.getByText(/A stack can set a lower number on its own page/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: '5' } });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/stacks/cap', { cap: 5 }));
    await waitFor(() => expect(store.getState().meta?.settings?.workflow?.sectionsAtOnce).toBe(5));
    expect(box).toHaveValue('5');
    post.mockClear();
    fireEvent.change(box, { target: { value: '25' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Sections at once must be a whole number from 1 to 20.');
    expect(post).not.toHaveBeenCalled();
  });

  it('Sections at once: reads a stored number', () => {
    setup({ policy: 'hands-off', workflow: { finishLine: 'pr1-merged', sectionsAtOnce: 7 } });
    expect(screen.getByRole('spinbutton', { name: 'Sections at once, across every stack' })).toHaveValue('7');
  });
});
