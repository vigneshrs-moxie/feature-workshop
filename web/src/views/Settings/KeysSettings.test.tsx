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
    render(<KeysSettings />);
    const all = screen.getByRole('region', { name: 'Every key' });
    // A key kept for later (keyDef(id).hidden) is bound but not listed, here as in the ? sheet.
    for (const id of KEY_IDS) if (!keyDef(id).hidden) expect(within(all).getAllByText(KEYS[id].label).length, id).toBeGreaterThan(0);
    // The job page's n (Task 17) adds a note now, so it is listed.
    expect(within(all).getAllByText(KEYS['jp-note'].label).length).toBeGreaterThan(0);
    expect(within(all).getByRole('region', { name: 'The Inbox' })).toHaveTextContent('Start a job on the ticket');
    expect(within(all).getByRole('region', { name: 'The job page' })).toHaveTextContent('Open the step after');
    expect(all).toHaveTextContent('never work while you type');
  });

  it('lists the job page’s keys with no switch: a stored sb.jobPage changes nothing', () => {
    for (const stored of [null, 'new', 'old']) {
      if (stored) localStorage.setItem('sb.jobPage', stored); else localStorage.removeItem('sb.jobPage');
      const { unmount } = render(<KeysSettings />);
      const all = screen.getByRole('region', { name: 'Every key' });
      expect(within(all).getAllByText(KEYS['jp-step-prev'].label).length, String(stored)).toBeGreaterThan(0);
      unmount();
    }
    localStorage.removeItem('sb.jobPage');
  });
});
