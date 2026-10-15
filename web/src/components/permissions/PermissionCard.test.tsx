import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { Permission } from '../../api/types';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { JobCards, NeedsYouCards } from './PendingCards';

// Invented jobs and requests only.
const NOW = new Date('2026-10-15T12:10:00Z');

function bash(extra: Partial<Permission> = {}): Permission {
  return {
    id: 'p1', slug: 'alpha', title: 'Job alpha', kind: 'permission', toolName: 'Bash', createdAt: '2026-10-15T12:05:00Z',
    input: { command: 'npm run test:db' },
    plain: { headline: 'Run a command in the terminal', detail: 'Run the database tests (demo)', preview: 'npm run test:db', risk: 'normal' },
    canAllowForRun: true,
    draft: { tool: 'Bash', options: [{ kind: 'exact', value: 'npm run test:db', label: 'run exactly “npm run test:db”' }, { kind: 'prefix', value: 'npm run test:db', label: 'run any command starting with “npm run test:db”' }] },
    ...extra,
  };
}

function setup(perms: Permission[], post: (path: string, body: unknown) => Promise<unknown> = async () => ({ ok: true })) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'needs-you'), job('beta', 'needs-you')], permissions: perms }) });
  const api = { post: vi.fn(post), get: vi.fn(), del: vi.fn() } as unknown as ApiClient;
  const utils = render(
    <WorkshopContext.Provider value={{ store, api }}>
      <JobCards slug="alpha" now={NOW} />
    </WorkshopContext.Provider>,
  );
  return { ...utils, store, post: api.post as ReturnType<typeof vi.fn> };
}

afterEach(() => { localStorage.clear(); });

describe('PermissionCard', () => {
  it('shows what it wants to do and every choice, each with a hint', () => {
    setup([bash()]);
    const card = screen.getByRole('article', { name: 'Permission: Run a command in the terminal' });
    expect(within(card).getByText('The Foreman')).toBeInTheDocument();
    expect(within(card).getByText('Run the database tests (demo)')).toBeInTheDocument();
    expect(card.querySelector('pre')).toHaveTextContent('npm run test:db');
    for (const name of ['Allow once', 'Allow for this reply', 'Deny…', 'Always allow…']) {
      expect(within(card).getByRole('button', { name })).toHaveAttribute('title');
    }
  });

  it('Allow once sends allow and the card goes at once', async () => {
    const { post, store } = setup([bash()]);
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(store.getState().permissions).toEqual([]));
    expect(post).toHaveBeenCalledWith('/api/permissions/p1', { decision: 'allow' });
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('offers Allow for this reply only when Claude Code does, and Always allow only with a draft', async () => {
    setup([bash({ canAllowForRun: false, draft: null })]);
    expect(screen.queryByRole('button', { name: 'Allow for this reply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Always allow…' })).toBeNull();
  });

  it('Allow for this reply sends allow-run', async () => {
    const { post } = setup([bash()]);
    fireEvent.click(screen.getByRole('button', { name: 'Allow for this reply' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/p1', { decision: 'allow-run' }));
  });

  it('Deny… asks for an optional note and sends it', async () => {
    const { post } = setup([bash()]);
    fireEvent.click(screen.getByRole('button', { name: 'Deny…' }));
    const note = screen.getByRole('textbox', { name: 'Tell it why (optional)' });
    expect(note).toHaveFocus();
    fireEvent.change(note, { target: { value: 'Not the database, please' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/p1', { decision: 'deny', note: 'Not the database, please' }));
  });

  it('keeps the card and says why when the answer can’t be sent', async () => {
    setup([bash()], async () => { throw new ApiError(404, 'That request was already answered or has expired.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already answered');
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeEnabled();
  });

  it('warns about risky steps', () => {
    setup([bash({ plain: { headline: 'Run a command in the terminal', preview: 'rm -rf build', risk: 'high' } })]);
    expect(screen.getByRole('note')).toHaveTextContent('may be hard to undo');
  });
});

describe('Always allow…', () => {
  it('drafts the narrowest rule, lets you edit a wider one, then confirms before saving', async () => {
    const { post, store } = setup([bash()], async (path) => (path === '/api/rules' ? { rule: { id: 'r1' }, added: true, allowed: true, alsoAllowed: 0, active: true } : { ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Always allow…' }));
    const sheet = screen.getByRole('dialog', { name: 'Always allow' });
    const [exact, prefix] = within(sheet).getAllByRole('radio');
    expect(exact).toBeChecked();
    expect(within(sheet).getByText('Narrowest')).toBeInTheDocument();

    // A wider choice is editable; a value that wouldn't cover the waiting command can't go on.
    fireEvent.click(prefix);
    const box = within(sheet).getByRole('textbox', { name: 'What the rule covers' });
    fireEvent.change(box, { target: { value: 'npm run lint' } });
    expect(within(sheet).getByRole('alert')).toHaveTextContent('doesn’t start with this');
    expect(within(sheet).getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.change(box, { target: { value: 'npm' } });
    expect(within(sheet).getByRole('alert')).toHaveTextContent('at least two words');
    fireEvent.change(box, { target: { value: 'npm run' } });
    expect(within(sheet).queryByRole('alert')).toBeNull();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Next' }));
    expect(sheet).toHaveTextContent('every job the dashboard runs');
    expect(sheet).toHaveTextContent('run any command starting with “npm run”');
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save rule and allow' }));
    await waitFor(() => expect(store.getState().permissions).toEqual([]));
    expect(post).toHaveBeenCalledWith('/api/rules', { rule: { tool: 'Bash', kind: 'prefix', value: 'npm run' }, permissionId: 'p1' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the dashboard’s refusal and keeps the card', async () => {
    const { store } = setup([bash()], async () => { throw new ApiError(400, 'That rule wouldn’t cover this request, so it wasn’t saved.'); });
    fireEvent.click(screen.getByRole('button', { name: 'Always allow…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save rule and allow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('wasn’t saved');
    expect(store.getState().permissions).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getAllByRole('radio')[0]).toBeChecked();
  });

  it('Cancel and Escape close it without saving', () => {
    const { post } = setup([bash()]);
    fireEvent.click(screen.getByRole('button', { name: 'Always allow…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Always allow…' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Always allow…' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('QuestionCard', () => {
  const question = (extra: Partial<Permission> = {}): Permission => ({
    id: 'q1', slug: 'alpha', kind: 'question', toolName: 'AskUserQuestion', createdAt: '2026-10-15T12:06:00Z',
    plain: { headline: 'Asks you a question' },
    input: {
      questions: [
        { question: 'Which colour?', header: 'Colour', options: [{ label: 'Blue', description: 'The usual' }, { label: 'Green' }] },
        { question: 'Which sizes?', multiSelect: true, options: [{ label: 'Small' }, { label: 'Large' }] },
      ],
    },
    ...extra,
  });

  it('sends your answers once every question has one', async () => {
    const { post } = setup([question()]);
    const card = screen.getByRole('article', { name: 'Question: Which colour?' });
    const send = within(card).getByRole('button', { name: 'Send answers' });
    expect(send).toBeDisabled();
    fireEvent.click(within(card).getByRole('radio', { name: /Green/ }));
    expect(send).toBeDisabled();
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Small' }));
    fireEvent.click(within(card).getByRole('checkbox', { name: 'Large' }));
    fireEvent.change(within(card).getByRole('textbox', { name: 'Your own answer to: Which sizes?' }), { target: { value: 'Huge' } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/q1', { decision: 'allow', answers: { 'Which colour?': 'Green', 'Which sizes?': 'Small, Large, Huge' } }));
  });

  it('“Something else” replaces the choice in a single-choice question', async () => {
    const { post } = setup([question({ input: { questions: [{ question: 'Which colour?', options: [{ label: 'Blue' }] }] } })]);
    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your own answer to: Which colour?' }), { target: { value: 'Teal' } });
    expect(screen.getByRole('radio', { name: 'Blue' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/q1', { decision: 'allow', answers: { 'Which colour?': 'Teal' } }));
  });

  it('Don’t answer… says no, with a note', async () => {
    const { post } = setup([question()]);
    fireEvent.click(screen.getByRole('button', { name: 'Don’t answer…' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Tell it why (optional)' }), { target: { value: 'Ask me tomorrow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Don’t answer' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/permissions/q1', { decision: 'deny', note: 'Ask me tomorrow' }));
  });
});

describe('PermissionCard: hard lines and auto mode', () => {
  it('a hard line says so and offers no way to stop it asking', () => {
    setup([bash({
      input: { command: 'git push -u origin feature/x' }, plain: { headline: 'Run a command in the terminal', preview: 'git push -u origin feature/x' },
      hardLine: { line: 'git-push', reason: 'Pushing is a hard line: it always asks you, whatever the setting.' },
      canAllowForRun: false, draft: null,
    })]);
    const card = screen.getByRole('article', { name: 'Permission: Run a command in the terminal' });
    expect(within(card).getByText('Hard line')).toBeInTheDocument();
    expect(within(card).getByText(/always asks you, whatever the setting/).closest('p')).toHaveAttribute('title');
    expect(within(card).getByRole('button', { name: 'Allow once' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Always allow…' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Allow for this reply' })).toBeNull();
  });

  it('a step auto mode couldn’t decide is marked as such', () => {
    setup([bash({ fromAutoMode: true, decisionReason: 'Auto mode couldn’t tell whether this is safe.' })]);
    const card = screen.getByRole('article', { name: 'Permission: Run a command in the terminal' });
    const why = within(card).getByText(/couldn’t tell whether this is safe/).closest('p')!;
    expect(within(why).getByText('Auto mode')).toBeInTheDocument();
    expect(why).toHaveAttribute('title', expect.stringMatching(/safety model couldn’t decide/));
    expect(within(card).getByRole('button', { name: 'Always allow…' })).toBeInTheDocument();
  });
});

describe('Needs-you cards', () => {
  it('lists every job’s waiting cards, grouped by job, oldest first', () => {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({
      jobs: [job('alpha', 'needs-you'), job('beta', 'needs-you')],
      permissions: [bash({ id: 'p2', slug: 'beta', createdAt: '2026-10-15T12:07:00Z' }), bash(), bash({ id: 'p3', slug: 'beta', createdAt: '2026-10-15T12:01:00Z', plain: { headline: 'Change a file: a.ts' } })],
    }) });
    render(<WorkshopContext.Provider value={{ store, api: {} as ApiClient }}><NeedsYouCards now={NOW} /></WorkshopContext.Provider>);
    const groups = screen.getAllByRole('region');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Waiting in Job beta', 'Waiting in Job alpha']);
    expect(within(groups[0]).getByRole('link', { name: 'Job beta' })).toHaveAttribute('href', '#/job/beta');
    expect(within(groups[0]).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Permission: Change a file: a.ts', 'Permission: Run a command in the terminal']);
  });

  it('says so when nothing waits', () => {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot() });
    render(<WorkshopContext.Provider value={{ store, api: {} as ApiClient }}><NeedsYouCards now={NOW} /></WorkshopContext.Provider>);
    expect(screen.getByText('No permission or question is waiting for you.')).toBeInTheDocument();
  });
});
