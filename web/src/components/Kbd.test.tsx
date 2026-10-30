import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { installKeyListener, registerKeys } from '../app/keyRegistry';
import { writeKeysSetting } from '../app/keysSetting';
import { Kbd, KeyLegend } from './Kbd';

const offs: (() => void)[] = [];
const live = () => {
  const off = installKeyListener();
  const reg = registerKeys('global', { current: { 'new-job': () => {} } });
  const desk = registerKeys('desk', { current: { 'desk-next': () => {} } });
  offs.push(() => { desk.unregister(); reg.unregister(); off(); });
};

afterEach(() => { for (const f of offs.splice(0)) f(); cleanup(); localStorage.clear(); });

describe('Kbd', () => {
  it('shows the key, hidden from screen readers, only where the key works', () => {
    const { rerender } = render(<button type="button">New job <Kbd id="new-job" /></button>);
    expect(document.querySelector('kbd')).toBeNull(); // no listener: the key would do nothing
    live();
    rerender(<button type="button">New job <Kbd id="new-job" /><Kbd id="gate-approve" /></button>);
    const hints = document.querySelectorAll('kbd');
    expect(hints).toHaveLength(1); // the gate scope is not active here
    expect(hints[0]).toHaveTextContent('c');
    expect(hints[0]).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'New job' })).toBeInTheDocument();
  });

  it('goes when hints are off, or keys are off', () => {
    live();
    render(<Kbd id="new-job" />);
    expect(document.querySelector('kbd')).toHaveTextContent('c');
    act(() => writeKeysSetting({ hints: false }));
    expect(document.querySelector('kbd')).toBeNull();
    act(() => writeKeysSetting({ hints: true, enabled: false }));
    expect(document.querySelector('kbd')).toBeNull();
  });

  it('is quiet (packet R) unless it is the main action’s key or every button shows its key; ? held shows them all', () => {
    live();
    const { rerender } = render(<Kbd id="new-job" />);
    expect(document.querySelector('kbd')).toHaveClass('key-hint', 'is-quiet');
    rerender(<Kbd id="new-job" shown />);
    expect(document.querySelector('kbd')).not.toHaveClass('is-quiet');
    rerender(<Kbd id="new-job" />);
    act(() => writeKeysSetting({ everywhere: true }));
    expect(document.querySelector('kbd')).not.toHaveClass('is-quiet');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })); });
    expect(document.documentElement).toHaveAttribute('data-keys-held');
    act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: '?' })); });
    expect(document.documentElement).not.toHaveAttribute('data-keys-held');
  });

  it('the legend lists each key with what it does, and goes when keys are off', () => {
    render(<KeyLegend ids={['desk-next', 'desk-prev']} />);
    expect(screen.getByText(/Next decision/).closest('p')).toHaveTextContent('j Next decision · k Previous decision');
    act(() => writeKeysSetting({ enabled: false }));
    expect(screen.queryByText(/Next decision/)).toBeNull();
  });
});
