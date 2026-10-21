import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
    expect(readKeysSetting()).toEqual({ enabled: false, hints: true });
    expect(JSON.parse(localStorage.getItem('fw.keys') ?? '{}')).toEqual({ enabled: false, hints: true });
    const hints = screen.getByRole('checkbox', { name: 'Show key hints on buttons' });
    expect(hints).toBeDisabled();
    expect(hints).not.toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /^On/ }));
    expect(hints).toBeEnabled();
    fireEvent.click(hints);
    expect(readKeysSetting()).toEqual({ enabled: true, hints: false });
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
});
