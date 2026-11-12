// Auto start's group on its own (AutoStartGroup.tsx): Up to N jobs at a time, saved as max with the
// rest of the setting; a number outside 1 to 10 is not saved. The laptop's settings route and the
// site's queued command each send what onSave is given (WorkflowSettings.test.tsx, HostedInbox.test.tsx).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_START_WORDS, AutoStartGroup } from './AutoStartGroup';

afterEach(() => { cleanup(); });

const HINT = 'Only tickets assigned to you, in Inbox order. Nothing starts while the Claude limit warning shows.';

describe('AutoStartGroup', () => {
  it('Up to N jobs at a time saves max; outside 1 to 10 is not saved', async () => {
    const onSave = vi.fn(async () => {});
    const { rerender } = render(<AutoStartGroup setting={{ on: true, tag: 'auto', max: 3 }} onSave={onSave} />);
    const group = screen.getByRole('group', { name: 'Auto start' });
    const box = within(group).getByRole('spinbutton', { name: 'Jobs at a time' });
    expect(box).toHaveValue('3');
    // The box sits between "Up to" and "jobs at a time".
    const line = box.closest('.sb-auto-start-max')!;
    expect(line.firstElementChild).toHaveTextContent('Up to');
    expect(line.lastElementChild).toHaveTextContent('jobs at a time');
    expect(AUTO_START_WORDS.hint).toBe(HINT);
    expect(group).toHaveTextContent(HINT);

    fireEvent.change(box, { target: { value: '7' } });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ on: true, tag: 'auto', max: 7 }));
    rerender(<AutoStartGroup setting={{ on: true, tag: 'auto', max: 7 }} onSave={onSave} />);
    onSave.mockClear();

    // Outside 1 to 10, or no number: nothing is saved, and leaving the box shows the saved number again.
    for (const v of ['0', '11', '', '-2']) fireEvent.change(box, { target: { value: v } });
    await new Promise((r) => setTimeout(r, 20));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.focusOut(box);
    expect(box).toHaveValue('7');

    // One more: 8.
    fireEvent.click(within(group).getByRole('button', { name: 'One more' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ on: true, tag: 'auto', max: 8 }));
    rerender(<AutoStartGroup setting={{ on: true, tag: 'auto', max: 8 }} onSave={onSave} />);
    onSave.mockClear();

    // The switch and the tag keep the number.
    fireEvent.click(within(group).getByRole('checkbox', { name: AUTO_START_WORDS.switch }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ on: false, tag: 'auto', max: 8 }));
  });

  it('with no max known the box says 5, and the switch sends no max', async () => {
    const onSave = vi.fn(async () => {});
    render(<AutoStartGroup setting={{ on: true, tag: 'auto' }} onSave={onSave} />);
    const group = screen.getByRole('group', { name: 'Auto start' });
    expect(within(group).getByRole('spinbutton', { name: 'Jobs at a time' })).toHaveValue('5');
    fireEvent.click(within(group).getByRole('checkbox', { name: AUTO_START_WORDS.switch }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ on: false, tag: 'auto' }));
  });
});
