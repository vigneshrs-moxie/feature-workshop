// The note box (Task 17, R4): three calls on a block, one on a pin; Change needs words; Enter is
// Change; Escape and × close it and add nothing.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteBox } from './NoteBox';

const PLACE = 'Implementation plan v2 · step S1 "The row limit adds a second" · paragraph 1';

describe('the note box', () => {
  it('names the place and the words pointed at, puts the cursor in its field, and offers Change, Drop this and Explain', () => {
    render(<NoteBox place={PLACE} quote="The schedule page waits" onNote={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'A note on this place' })).toHaveTextContent(PLACE);
    expect(screen.getByText('“The schedule page waits”')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'What should change' })).toHaveFocus();
    expect(screen.getAllByRole('button').map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['Change', 'Drop this', 'Explain', 'Close the note without adding it']);
  });

  it('Change carries his words (Enter too); with none it asks for them and calls nothing', () => {
    const onNote = vi.fn();
    render(<NoteBox place={PLACE} quote={null} onNote={onNote} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(onNote).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Write what should change, then press Change.');
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  use the existing badge ' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onNote).toHaveBeenCalledWith('change', 'use the existing badge');
  });

  it('Drop this and Explain need no words', () => {
    const onNote = vi.fn();
    render(<NoteBox place={PLACE} quote={null} onNote={onNote} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drop this' }));
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }));
    expect(onNote.mock.calls).toEqual([['drop', ''], ['explain', '']]);
  });

  it('Escape and × close it; nothing is added', () => {
    const onNote = vi.fn();
    const onClose = vi.fn();
    render(<NoteBox place={PLACE} quote={null} onNote={onNote} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close the note without adding it' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onNote).not.toHaveBeenCalled();
  });

  it('on a pin it has one call, Add the note, which needs words', () => {
    const onNote = vi.fn();
    render(<NoteBox place="Recording AC-3 at 0:14 (ac-3.webm) · pin 1 at 62% across, 18% down" quote={null} pin onNote={onNote} onClose={vi.fn()} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['Add the note', 'Close the note without adding it']);
    expect(screen.getByRole('textbox', { name: 'What is wrong here' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add the note' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Write what is wrong here, then press Add the note.');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'the Apply button sits on top of the table' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add the note' }));
    expect(onNote).toHaveBeenCalledWith('change', 'the Apply button sits on top of the table');
  });

  it('on the phone it is a sheet over a scrim; a tap on the scrim closes it', () => {
    const onClose = vi.fn();
    const { container } = render(<NoteBox place={PLACE} quote={null} sheet onNote={vi.fn()} onClose={onClose} />);
    expect(container.querySelector('.jp2-nb-sheet .jp2-nb.is-sheet')).not.toBeNull();
    fireEvent.click(container.querySelector('.jp2-nb-scrim')!);
    expect(onClose).toHaveBeenCalled();
  });
});
