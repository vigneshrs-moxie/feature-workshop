// Auto start's group on its own (AutoStartGroup.tsx): Up to N jobs at a time, saved as max on leaving
// the box, on Enter, or at once for a step; a number outside 1 to 10 is not saved. Only the number box
// sends max. The laptop's settings route and the site's queued command each send what onSave is given
// (WorkflowSettings.test.tsx, HostedInbox.test.tsx).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_START_WORDS, AutoStartGroup } from './AutoStartGroup';

afterEach(() => { cleanup(); });

const HINT = 'Only tickets assigned to you, in Inbox order. Nothing starts while the Claude limit warning shows.';
const settle = () => new Promise((r) => setTimeout(r, 20));

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

    // Typing saves nothing until he leaves the box.
    fireEvent.change(box, { target: { value: '7' } });
    await settle();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.focusOut(box);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ on: true, tag: 'auto', max: 7 }));
    rerender(<AutoStartGroup setting={{ on: true, tag: 'auto', max: 7 }} onSave={onSave} />);
    onSave.mockClear();

    // Outside 1 to 10, or no number: nothing is saved, and leaving the box shows the saved number again.
    for (const v of ['0', '11', '', '-2']) {
      fireEvent.change(box, { target: { value: v } });
      fireEvent.focusOut(box);
      expect(box).toHaveValue('7');
    }
    await settle();
    expect(onSave).not.toHaveBeenCalled();

    // One more: 8, at once.
    fireEvent.click(within(group).getByRole('button', { name: 'One more' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ on: true, tag: 'auto', max: 8 }));
    rerender(<AutoStartGroup setting={{ on: true, tag: 'auto', max: 8 }} onSave={onSave} />);
    onSave.mockClear();

    // The switch sends no max (M4): the server keeps the saved N.
    fireEvent.click(within(group).getByRole('checkbox', { name: AUTO_START_WORDS.switch }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ on: false, tag: 'auto' }));
  });

  it('with no max known the box says 5, and the switch sends no max', async () => {
    const onSave = vi.fn(async () => {});
    render(<AutoStartGroup setting={{ on: true, tag: 'auto' }} onSave={onSave} />);
    const group = screen.getByRole('group', { name: 'Auto start' });
    expect(within(group).getByRole('spinbutton', { name: 'Jobs at a time' })).toHaveValue('5');
    fireEvent.click(within(group).getByRole('checkbox', { name: AUTO_START_WORDS.switch }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ on: false, tag: 'auto' }));
  });

  // Task 16 fix round 1 (I1): typing saves on leaving the box or on Enter; a step saves at once.
  it('typing 1 then 0 and leaving the box saves only 10', async () => {
    const onSave = vi.fn(async () => {});
    render(<AutoStartGroup setting={{ on: true, tag: 'auto', max: 3 }} onSave={onSave} />);
    const box = screen.getByRole('spinbutton', { name: 'Jobs at a time' });
    fireEvent.change(box, { target: { value: '1' } });
    fireEvent.change(box, { target: { value: '10' } });
    await settle();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.focusOut(box);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ on: true, tag: 'auto', max: 10 });
    expect(box).toHaveValue('10');
  });

  it('typing 25 and leaving saves nothing, and the box shows the saved number', async () => {
    const onSave = vi.fn(async () => {});
    render(<AutoStartGroup setting={{ on: true, tag: 'auto', max: 3 }} onSave={onSave} />);
    const box = screen.getByRole('spinbutton', { name: 'Jobs at a time' });
    fireEvent.change(box, { target: { value: '2' } });
    fireEvent.change(box, { target: { value: '25' } });
    fireEvent.focusOut(box);
    await settle();
    expect(onSave).not.toHaveBeenCalled();
    expect(box).toHaveValue('3');
    // Enter with a number outside 1 to 10 saves nothing either.
    fireEvent.change(box, { target: { value: '0' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await settle();
    expect(onSave).not.toHaveBeenCalled();
    expect(box).toHaveValue('3');
  });

  it('Enter saves, and leaving the box after it saves nothing more', async () => {
    const onSave = vi.fn(async () => {});
    render(<AutoStartGroup setting={{ on: true, tag: 'auto', max: 3 }} onSave={onSave} />);
    const box = screen.getByRole('spinbutton', { name: 'Jobs at a time' });
    fireEvent.change(box, { target: { value: '4' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ on: true, tag: 'auto', max: 4 }));
    fireEvent.focusOut(box);
    await settle();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('a step saves at once (the buttons and the arrow keys); 3 to 6 and back to 3 ends with 3 sent', async () => {
    const onSave = vi.fn(async () => {});
    // The setting stays at 3 throughout, as on the website before the laptop's value comes back.
    render(<AutoStartGroup setting={{ on: true, tag: 'auto', max: 3 }} onSave={onSave} laptopNote={null} />);
    const group = screen.getByRole('group', { name: 'Auto start' });
    const box = within(group).getByRole('spinbutton', { name: 'Jobs at a time' });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith({ on: true, tag: 'auto', max: 4 }));
    for (let i = 0; i < 2; i++) fireEvent.click(within(group).getByRole('button', { name: 'One more' }));
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    for (let i = 0; i < 2; i++) fireEvent.click(within(group).getByRole('button', { name: 'One less' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(6));
    expect(onSave.mock.calls.map((c) => (c as unknown as [{ max: number }])[0].max)).toEqual([4, 5, 6, 5, 4, 3]);
    expect(box).toHaveValue('3');
  });

  it('a save that fails is tried again when the same number is entered again', async () => {
    const onSave = vi.fn(async () => { throw new Error('The laptop said no.'); });
    render(<AutoStartGroup setting={{ on: true, tag: 'auto', max: 3 }} onSave={onSave} />);
    const box = screen.getByRole('spinbutton', { name: 'Jobs at a time' });
    fireEvent.change(box, { target: { value: '6' } });
    fireEvent.focusOut(box);
    expect(await screen.findByText('The laptop said no.')).toBeInTheDocument();
    expect(box).toHaveValue('3');
    fireEvent.change(box, { target: { value: '6' } });
    fireEvent.focusOut(box);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  });

  it('the tag sends no max', async () => {
    const onSave = vi.fn(async () => {});
    render(<AutoStartGroup setting={{ on: true, tag: 'auto', max: 3 }} onSave={onSave} />);
    const tag = screen.getByLabelText('Orbit tag');
    fireEvent.change(tag, { target: { value: 'robot' } });
    fireEvent.keyDown(tag, { key: 'Enter' });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ on: true, tag: 'robot' }));
  });

  // M5: an older laptop refuses a command with max, so the website shows the box only when the laptop's
  // mirrored setting has N. On the laptop the box always shows.
  it('on the website the box shows only when the laptop’s setting has a number; on the laptop always', () => {
    const onSave = vi.fn(async () => {});
    const { rerender } = render(<AutoStartGroup setting={{ on: true, tag: 'auto' }} onSave={onSave} laptopNote={null} />);
    expect(screen.queryByRole('spinbutton', { name: 'Jobs at a time' })).toBeNull();
    expect(screen.queryByText('Up to')).toBeNull();
    rerender(<AutoStartGroup setting={undefined} onSave={onSave} laptopNote={null} />);
    expect(screen.queryByRole('spinbutton', { name: 'Jobs at a time' })).toBeNull();
    rerender(<AutoStartGroup setting={{ on: true, tag: 'auto', max: 4 }} onSave={onSave} laptopNote={null} />);
    expect(screen.getByRole('spinbutton', { name: 'Jobs at a time' })).toHaveValue('4');
    cleanup();
    render(<AutoStartGroup setting={{ on: true, tag: 'auto' }} onSave={onSave} />);
    expect(screen.getByRole('spinbutton', { name: 'Jobs at a time' })).toHaveValue('5');
  });
});
