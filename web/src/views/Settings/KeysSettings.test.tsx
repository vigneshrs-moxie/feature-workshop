import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { KEY_IDS, KEYS, keyDef } from '../../app/keyRegistry';
import { readKeysSetting } from '../../app/keysSetting';
import { KeysSettings } from './KeysSettings';

afterEach(() => { localStorage.clear(); });

describe('Settings → Keys', () => {
  it('starts On with hints on; Off is remembered in this browser and turns the hints box off', () => {
    render(<KeysSettings />);
    expect(screen.getByRole('radio', { name: /^On/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Show key hints on buttons' })).toBeChecked();
    expect(screen.getByText(/Off keeps only what any web page has/)).toHaveTextContent(/Esc, Enter, the arrows inside a list or menu/);
    fireEvent.click(screen.getByRole('radio', { name: /^Off/ }));
    expect(readKeysSetting()).toEqual({ enabled: false, hints: true, everywhere: false });
    expect(JSON.parse(localStorage.getItem('fw.keys') ?? '{}')).toEqual({ enabled: false, hints: true, everywhere: false });
    const hints = screen.getByRole('checkbox', { name: 'Show key hints on buttons' });
    expect(hints).toBeDisabled();
    expect(hints).not.toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /^On/ }));
    expect(hints).toBeEnabled();
    fireEvent.click(hints);
    expect(readKeysSetting()).toEqual({ enabled: true, hints: false, everywhere: false });
  });

  it('Show keys on every button: off by default (only the main action shows its key), remembered, and off while hints are off', () => {
    render(<KeysSettings />);
    const every = screen.getByRole('checkbox', { name: 'Show keys on every button' });
    expect(every).not.toBeChecked();
    fireEvent.click(every);
    expect(readKeysSetting()).toEqual({ enabled: true, hints: true, everywhere: true });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show key hints on buttons' }));
    expect(every).toBeDisabled();
    expect(every).not.toBeChecked();
  });

  it('reads a stored setting, and treats a malformed one as the default', () => {
    localStorage.setItem('fw.keys', '{"enabled":false,"hints":false}');
    const { unmount } = render(<KeysSettings />);
    expect(screen.getByRole('radio', { name: /^Off/ })).toBeChecked();
    unmount();
    localStorage.setItem('fw.keys', 'not json');
    render(<KeysSettings />);
    expect(screen.getByRole('radio', { name: /^On/ })).toBeChecked();
  });

  it('lists every key the app has, from the registry, grouped by where it works', () => {
    // The new job page's keys are listed while its switch is on (final W8).
    localStorage.setItem('sb.jobPage', 'new');
    render(<KeysSettings />);
    const all = screen.getByRole('region', { name: 'Every key' });
    // A key kept for later (keyDef(id).hidden: the new job page's n) is bound but not listed, here as in the ? sheet.
    for (const id of KEY_IDS) if (!keyDef(id).hidden) expect(within(all).getAllByText(KEYS[id].label).length, id).toBeGreaterThan(0);
    // The new job page's n (Task 17) adds a note now, so it is listed.
    expect(within(all).getAllByText(KEYS['jp-note'].label).length).toBeGreaterThan(0);
    expect(within(all).getByRole('region', { name: 'The Inbox' })).toHaveTextContent('Start a job on the ticket');
    expect(within(all).getByRole('region', { name: 'The open step' })).toHaveTextContent('The step after this one');
    expect(all).toHaveTextContent('never work while you type');
    localStorage.removeItem('sb.jobPage');
  });

  it('final W8: leaves the new job page’s keys out while its switch is off', () => {
    localStorage.removeItem('sb.jobPage');
    render(<KeysSettings />);
    const all = screen.getByRole('region', { name: 'Every key' });
    expect(within(all).queryByText(KEYS['jp-step-prev'].label)).toBeNull();
  });
});
