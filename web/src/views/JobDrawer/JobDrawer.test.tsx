import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { JobDetail, JobOptions } from '../../api/types';
import { focusables } from '../../components/Drawer';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job, LEVELS, REVIEWERS, snapshot } from '../../state/test-fixtures';
import { JobDrawer } from './JobDrawer';
import { NOTES_HINT } from './NotesEditor';

// Invented job, notes and paths only.
const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';
const L1: JobOptions = {
  schema_version: 2, level: 1, flow: 'quick', skip: ['spec', 'refine', 'investigate', 'spec-update'], provided: {}, reviewers: ['feature-reviewer'],
  review_rounds: 2, manual_test: true, fable_checks: [], models: { foreman: OPUS, build: OPUS, checks: OPUS }, notes: 'Keep it small.',
};
const LISTS = {
  reviewers: REVIEWERS.map((r) => ({ ...r, what: r.id === 'feature-review-permissions' ? 'who can see and do what' : 'its area' })),
  models: {
    foreman: [OPUS, 'claude-fable-5-1', HAIKU], crew: [OPUS, 'claude-fable-5-1', SONNET, HAIKU],
    choices: [{ id: OPUS, label: 'Opus 5.5', note: 'Everyday.' }, { id: 'claude-fable-5-1', label: 'Fable 5.1' }, { id: SONNET, label: 'Sonnet 5.5' }, { id: HAIKU, label: 'Haiku 5.5' }],
  },
  notesMax: 60,
};

interface Setup {
  options?: JobOptions | null;
  notes?: { text: string; updatedAt: string | null } | Error;
  post?: ReturnType<typeof vi.fn>;
  put?: ReturnType<typeof vi.fn>;
  tab?: 'notes' | 'options';
}

function setup({ options = L1, notes = { text: 'Ask before renaming the API.', updatedAt: null }, post, put, tab }: Setup = {}) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', levels: LEVELS, jobOptions: LISTS }, jobs: [job('alpha', 'idle', { level: 1 })] }) });
  const detail: JobDetail = { slug: 'alpha', thread: [], threadMore: false, level: 1, options };
  const get = vi.fn(async (path: string) => {
    if (path === '/api/job/alpha/notes') { if (notes instanceof Error) throw notes; return notes; }
    if (path === '/api/job/alpha') return detail;
    throw new ApiError(404, 'Not found');
  });
  const postFn = post ?? vi.fn(async (_p: string, body: { options: JobOptions }) => ({ ok: true, options: { ...body.options, schema_version: 2 }, summary: ['Level: L1 Small (quick flow).', 'Reviewers: Head inspector, at most 3 fix rounds.'] }));
  const putFn = put ?? vi.fn(async (_p: string, body: { text: string }) => ({ ok: true, text: body.text, updatedAt: '2026-10-16T10:00:00.000Z' }));
  const api = { get, post: postFn, put: putFn } as unknown as ApiClient;
  const onClose = vi.fn();
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><JobDrawer slug="alpha" job={store.getState().jobs[0]} tab={tab} onClose={onClose} /></WorkshopContext.Provider>);
  return { ...utils, get, post: postFn, put: putFn, onClose, store };
}

const drawer = () => screen.getByRole('dialog', { name: 'Notes and options' });
const notesBox = () => screen.findByRole('textbox', { name: /Notes for the Foreman/ });

afterEach(() => { localStorage.clear(); });

describe('Job drawer', () => {
  it('opens on the Notes tab with focus there, and Escape or Close closes it when nothing is unsaved', async () => {
    const { onClose } = setup();
    expect(drawer()).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
    await notesBox();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close the drawer' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Close the drawer' })).toHaveAttribute('title');
  });

  it('keeps Tab inside: the last control wraps to the first, Shift+Tab the other way; hidden tabs are skipped', async () => {
    setup();
    await notesBox();
    const list = focusables(drawer());
    expect(list.length).toBeGreaterThan(3);
    expect(list.some((el) => el.closest('#drawer-panel-options'))).toBe(false); // the Options tab is hidden
    const first = list[0];
    const last = list[list.length - 1];
    act(() => last.focus());
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    // Focus that lands outside comes back in.
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    act(() => outside.focus());
    expect(drawer().contains(document.activeElement)).toBe(true);
    outside.remove();
  });

  it('gives focus back to what had it when it closes', async () => {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 't', levels: LEVELS } }) });
    const api = { get: vi.fn(async () => ({ text: '', updatedAt: null, slug: 'alpha', thread: [], threadMore: false })) } as unknown as ApiClient;
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open drawer</button>
          {open && <JobDrawer slug="alpha" job={null} onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<WorkshopContext.Provider value={{ store, api }}><Host /></WorkshopContext.Provider>);
    const opener = screen.getByRole('button', { name: 'Open drawer' });
    act(() => opener.focus());
    fireEvent.click(opener);
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveFocus();
    await screen.findByRole('textbox', { name: /Notes for the Foreman/ });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('arrow keys move between the tabs', async () => {
    setup();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Notes' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Options' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Options' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Options' })).toBeVisible();
    await screen.findByRole('button', { name: 'Save options' });
  });
});

describe('Job drawer · notes', () => {
  it('loads notes.md, says what they are for, and saves them with PUT', async () => {
    const { put, get } = setup();
    const box = await notesBox();
    expect(get).toHaveBeenCalledWith('/api/job/alpha/notes');
    expect(box).toHaveValue('Ask before renaming the API.');
    expect(screen.getByText(NOTES_HINT)).toBeInTheDocument();
    expect(NOTES_HINT).toBe('The Foreman reads these notes at the start of every session; they shape how it works, never approve anything.');
    expect(screen.getByText('No notes yet')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save notes' });
    expect(save).toBeDisabled();
    fireEvent.change(box, { target: { value: 'Ask before renaming the API. Keep the CSV header.' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByText('49 / 60 characters')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Notes (unsaved changes)' })).toBeInTheDocument();
    fireEvent.click(save);
    await screen.findByText('✓ Saved');
    expect(put).toHaveBeenCalledWith('/api/job/alpha/notes', { text: 'Ask before renaming the API. Keep the CSV header.' });
    expect(screen.getByRole('button', { name: 'Save notes' })).toBeDisabled();
    expect(await screen.findByRole('tab', { name: 'Notes' })).toBeInTheDocument(); // the unsaved mark is gone
  });

  it('won’t save over the cap and says by how much', async () => {
    const { put } = setup();
    const box = await notesBox();
    fireEvent.change(box, { target: { value: 'x'.repeat(65) } });
    expect(screen.getByText('65 / 60 characters')).toHaveClass('is-over');
    expect(screen.getByRole('alert')).toHaveTextContent('at most 60 characters. Shorten them by 5 to save.');
    expect(screen.getByRole('button', { name: 'Save notes' })).toBeDisabled();
    expect(put).not.toHaveBeenCalled();
  });

  it('shows the dashboard’s refusal and keeps your text', async () => {
    setup({ put: vi.fn(async () => { throw new ApiError(413, 'The notes are too long (at most 20,000 characters).'); }) });
    const box = await notesBox();
    fireEvent.change(box, { target: { value: 'New notes.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The notes are too long');
    expect(box).toHaveValue('New notes.');
  });

  it('says so when the notes can’t be loaded, with Try again', async () => {
    setup({ notes: new ApiError(404, 'This job’s notes.md isn’t a plain file, so it isn’t shown.') });
    expect(await screen.findByRole('alert')).toHaveTextContent('isn’t a plain file');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('asks before closing with unsaved notes: Keep editing, or Discard and close', async () => {
    const { onClose } = setup();
    const box = await notesBox();
    fireEvent.change(box, { target: { value: 'Half-written thought' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    const ask = within(drawer()).getByRole('alert');
    expect(ask).toHaveTextContent('Your notes have unsaved changes. Close without saving?');
    expect(within(ask).getByRole('button', { name: 'Keep editing' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' }); // Escape on the question keeps editing
    expect(within(drawer()).queryByRole('alert')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(box).toHaveValue('Half-written thought');
    // The backdrop asks too.
    fireEvent.mouseDown(drawer().parentElement!);
    fireEvent.click(within(within(drawer()).getByRole('alert')).getByRole('button', { name: 'Discard and close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Job drawer · options', () => {
  async function openOptions(s: Setup = {}) {
    const r = setup({ tab: 'options', ...s });
    await screen.findByRole('button', { name: 'Save options' });
    return r;
  }

  it('shows the job’s options, says they choose process not permission, and posts exactly what you set', async () => {
    const { post } = await openOptions();
    const panel = screen.getByRole('tabpanel', { name: 'Options' });
    expect(panel).toHaveTextContent('never what it may do without asking');
    expect(panel).toHaveTextContent('applies from the next stage; a worker already running finishes first');
    expect(screen.getByRole('radio', { name: /^L1 Small/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Spec' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Plan' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Pick them' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^Head inspector/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: '2' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'I test it by hand before review' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: /Foreman/ })).toHaveValue(OPUS);
    expect(within(screen.getByRole('combobox', { name: /Checks/ })).getAllByRole('option').map((o) => o.textContent)).toEqual(['Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 5.5']);
    expect(within(screen.getByRole('combobox', { name: /Foreman/ })).getAllByRole('option').map((o) => o.textContent)).toEqual(['Opus 5.5', 'Fable 5.1', 'Haiku 5.5']);
    expect(screen.getByRole('textbox', { name: 'Process notes' })).toHaveValue('Keep it small.');
    const save = screen.getByRole('button', { name: 'Save options' });
    expect(save).toBeDisabled();
    // Every control has a hover hint.
    for (const el of panel.querySelectorAll('label:not(.sr-only), button, legend, select, textarea')) expect(el.closest('[title]'), el.textContent ?? '').not.toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: /^Locksmith/ }));
    fireEvent.click(screen.getByRole('radio', { name: '3' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Before PR #1 opens' }));
    fireEvent.change(screen.getByRole('combobox', { name: /Checks/ }), { target: { value: HAIKU } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Plan' }));
    expect(screen.getByRole('tab', { name: 'Options (unsaved changes)' })).toBeInTheDocument();
    fireEvent.click(save);
    expect(await screen.findByText(/The Foreman reads this from its next stage/)).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/api/job/alpha/options', {
      options: {
        level: 1, skip: ['spec', 'refine', 'investigate', 'spec-update', 'plan'], provided: {},
        reviewers: ['feature-reviewer', 'feature-review-permissions'], review_rounds: 3, manual_test: true,
        fable_checks: ['pr'], models: { foreman: OPUS, build: OPUS, checks: HAIKU }, notes: 'Keep it small.',
      },
    });
    const summary = screen.getByText(/The Foreman reads this from its next stage/).closest('.drawer-summary')!;
    expect(summary).toHaveTextContent('Reviewers: Head inspector, at most 3 fix rounds.');
    expect(screen.getByRole('button', { name: 'Save options' })).toBeDisabled();
  });

  it('a new level brings its defaults and names the consequence; Reset puts the level’s defaults back', async () => {
    const { post } = await openOptions();
    fireEvent.click(screen.getByRole('radio', { name: /^L2 Standard/ }));
    expect(screen.getByText(/^If you save: L1→L2 adds:/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Spec' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^Refine/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Auto' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: /Checks/ })).toHaveValue(SONNET);
    expect(screen.getByRole('radio', { name: '2' })).toBeChecked(); // fix rounds kept
    // Change a few things, then Reset to L2's defaults (fix rounds back to 1, notes kept).
    fireEvent.click(screen.getByRole('checkbox', { name: 'After the spec is written' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'I test it by hand before review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to level defaults' }));
    expect(screen.getByRole('checkbox', { name: 'After the spec is written' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'I test it by hand before review' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save options' }));
    await screen.findByText(/The Foreman reads this from its next stage/);
    expect(post).toHaveBeenCalledWith('/api/job/alpha/options', {
      options: {
        level: 2, skip: ['refine'], provided: {}, reviewers: 'auto', review_rounds: 1, manual_test: true,
        fable_checks: [], models: { foreman: OPUS, build: OPUS, checks: SONNET }, notes: 'Keep it small.',
      },
    });
  });

  it('shows the dashboard’s refusal inline and keeps your changes', async () => {
    await openOptions({ post: vi.fn(async () => { throw new ApiError(400, 'Models: “x” isn’t a model the crew can use for the build.'); }) });
    fireEvent.click(screen.getByRole('radio', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save options' }));
    expect(await within(screen.getByRole('tabpanel', { name: 'Options' })).findByRole('alert')).toHaveTextContent('isn’t a model the crew can use');
    expect(screen.getByRole('radio', { name: '1' })).toBeChecked();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('lists provided documents read only, with a link to the classic view, and their stages stay skipped', async () => {
    await openOptions({ options: { ...L1, level: 2, skip: ['refine', 'plan'], provided: { plan: '/tmp/fw-test/plan.md' }, reviewers: 'auto' } });
    const docs = screen.getByRole('region', { name: 'Documents you provided' });
    expect(docs).toHaveTextContent('Implementation plan /tmp/fw-test/plan.md');
    expect(within(docs).getByRole('link', { name: 'open this job in classic view' })).toHaveAttribute('href', '/#/job/alpha');
    const plan = screen.getByRole('checkbox', { name: /^Plan/ });
    expect(plan).toBeChecked();
    expect(plan).toBeDisabled();
  });

  it('with unsaved options (and notes), closing asks first, naming both', async () => {
    const { onClose } = await openOptions();
    fireEvent.click(screen.getByRole('radio', { name: '3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close the drawer' }));
    expect(within(drawer()).getByRole('alert')).toHaveTextContent('Your options have unsaved changes');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('tab', { name: /^Options/ })).toHaveFocus(); // back where you were
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    fireEvent.change(await notesBox(), { target: { value: 'Something new.' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(within(drawer()).getByRole('alert')).toHaveTextContent('Your notes and options have unsaved changes');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a job with no options yet starts from its level’s defaults', async () => {
    const { post } = await openOptions({ options: null });
    expect(screen.getByRole('radio', { name: /^L1 Small/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: '1' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'When the review is wrapped up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save options' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1].options).toMatchObject({ level: 1, fable_checks: ['review'], notes: '' });
  });
});
