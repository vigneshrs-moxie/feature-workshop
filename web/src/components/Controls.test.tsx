// The shared controls (packet R): Button, Select, Choice, Field and Chip.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Chip } from './Chip';
import { Choice, OptionRow } from './Choice';
import { Field, TextInput } from './Field';
import { Select } from './Select';
import { optionWords, pickOption } from './Select.testing';

afterEach(() => cleanup());

describe('Button', () => {
  it('draws its kind and size with the theme hooks, its words as one run, and a link that looks the same', () => {
    render(<><Button kind="primary" size="lg" onClick={() => {}}>No go<span>: send back</span></Button><Button href="#/desk" kind="quiet">Desk</Button><Button>Plain</Button></>);
    const go = screen.getByRole('button', { name: 'No go: send back' });
    expect(go).toHaveClass('btn', 'btn-primary', 'btn-lg');
    expect(go).toHaveAttribute('type', 'button');
    expect(go.querySelector('.btn-label')).toHaveTextContent('No go: send back');
    expect(screen.getByRole('link', { name: 'Desk' })).toHaveClass('btn', 'btn-quiet');
    expect(screen.getByRole('button', { name: 'Plain' }).className).toBe('btn');
  });

  it('busy: a spinner in place, the button off and marked busy; disabled stays a real disabled button', () => {
    const click = vi.fn();
    render(<><Button busy onClick={click}>Save</Button><Button disabled onClick={click}>Off</Button></>);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(save).toHaveClass('is-busy');
    expect(save.querySelector('.spin-ring')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Off' }));
    expect(click).not.toHaveBeenCalled();
  });
});

function Pick({ onChange }: { onChange(v: string): void }) {
  const [v, setV] = useState('opus');
  return (
    <label>Model
      <Select value={v} onChange={(x) => { setV(x); onChange(x); }} options={[{ value: 'opus', label: 'Opus 5.5' }, { value: 'sonnet', label: 'Sonnet 5.5' }, { value: 'haiku', label: 'Haiku 5.5', disabled: true }]} />
    </label>
  );
}

describe('Select', () => {
  it('is a combobox named by its label, says the choice, and lists the choices in a listbox', () => {
    render(<Pick onChange={() => {}} />);
    const box = screen.getByRole('combobox', { name: /Model/ });
    expect(box).toHaveTextContent('Opus 5.5');
    expect(box).toHaveAttribute('data-value', 'opus');
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(optionWords(box)).toEqual(['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5']);
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });

  it('picks with the mouse; a disabled choice can’t be picked', () => {
    const change = vi.fn();
    render(<Pick onChange={change} />);
    const box = screen.getByRole('combobox', { name: /Model/ });
    pickOption(box, 'sonnet');
    expect(change).toHaveBeenCalledWith('sonnet');
    expect(box).toHaveAttribute('data-value', 'sonnet');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('option', { name: 'Haiku 5.5' }));
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('works from the keyboard: ↓ opens, ↓ moves past a disabled choice, Enter picks, Esc closes without a change, and its keys stay with it', () => {
    const change = vi.fn();
    const pageKeys = vi.fn();
    document.addEventListener('keydown', pageKeys);
    render(<Pick onChange={change} />);
    const box = screen.getByRole('combobox', { name: /Model/ });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: 'Opus 5.5' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Sonnet 5.5' }).id);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(change).not.toHaveBeenCalled();
    expect(box).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(change).toHaveBeenCalledWith('sonnet');
    fireEvent.keyDown(box, { key: 'o' });
    expect(change).toHaveBeenLastCalledWith('opus');
    expect(pageKeys).not.toHaveBeenCalled();
    document.removeEventListener('keydown', pageKeys);
  });

  it('closes on a click elsewhere', () => {
    render(<><Pick onChange={() => {}} /><p>Elsewhere</p></>);
    fireEvent.click(screen.getByRole('combobox', { name: /Model/ }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    act(() => { fireEvent.mouseDown(screen.getByText('Elsewhere')); });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Choice, Field and Chip', () => {
  it('a Choice is the native input with the shared look, its whole label clickable; an option row too', () => {
    const change = vi.fn();
    render(<><label><Choice type="checkbox" onChange={change} /> Remember it</label><OptionRow type="radio" name="q" value="a" onChange={change}>a) One go</OptionRow></>);
    fireEvent.click(screen.getByText('Remember it'));
    expect(screen.getByRole('checkbox', { name: 'Remember it' })).toBeChecked();
    expect(screen.getByRole('checkbox')).toHaveClass('choice');
    fireEvent.click(screen.getByText('a) One go'));
    expect(screen.getByRole('radio', { name: 'a) One go' })).toBeChecked();
    expect(screen.getByRole('radio').closest('label')).toHaveClass('option-row');
  });

  it('a Field labels its input and says a problem in words; a Chip always carries its word', () => {
    render(<><Field label="Folder path" problem="That folder isn’t there."><TextInput /></Field><Chip tone="needs-you" icon="hand">Needs you</Chip></>);
    expect(screen.getByRole('textbox', { name: /Folder path/ })).toHaveClass('text-input');
    expect(screen.getByRole('alert')).toHaveTextContent('That folder isn’t there.');
    expect(screen.getByText('Needs you')).toHaveClass('chip', 'chip-needs-you');
  });
});
