// The Auto switch (spec: Turning it on and off): a checkbox on the New job form and in the job
// header, on or off at every level, one POST with a spinner in the header, and the header line.
// Invented jobs only.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import type { Job } from '../api/types';
import { clearAllSent } from '../lib/sentState';
import { createStore, WorkshopContext, type Store } from '../state/store';
import { job, snapshot } from '../state/test-fixtures';
import { AutoSwitch, AUTO_HINT, AUTO_LABEL } from './AutoSwitch';

function show(j: Job, post: ReturnType<typeof vi.fn> = vi.fn(async () => ({ ok: true })), onChange?: (on: boolean) => void) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [j] }) });
  const api = { get: vi.fn(), post } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><AutoSwitch job={j} onChange={onChange} /></WorkshopContext.Provider>);
  return { post, ...utils };
}

afterEach(() => { clearAllSent(); });

describe('AutoSwitch', () => {
  it('the switch says what it does, in the agreed words', () => {
    show(job('alpha', 'needs-you', { level: 1 }));
    expect(AUTO_LABEL).toBe('Auto: run to PR #1 without asking me.');
    expect(screen.getByRole('checkbox', { name: new RegExp(AUTO_LABEL.replace(/[#.]/g, '\\$&')) })).not.toBeChecked();
    expect(AUTO_HINT).toBe('A Fable agent approves each step for you and takes the recommended answers, up to PR #1. When something is risky it takes the safer option and lists it under What Auto decided. It never merges.');
  });

  it('turning it on in the header posts once and spins', async () => {
    let finish: (v: unknown) => void = () => {};
    const post = vi.fn(() => new Promise((r) => { finish = r; }));
    const onChange = vi.fn();
    show(job('alpha', 'needs-you', { level: 1 }), post, onChange);
    const box = screen.getByRole('checkbox', { name: /Auto: run to PR #1/ });
    fireEvent.click(box);
    fireEvent.click(box);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/job/alpha/auto', { on: true });
    expect(screen.getByRole('status', { name: 'Turning Auto on…' })).toBeInTheDocument();
    await act(async () => { finish({ ok: true }); });
    expect(screen.queryByRole('status', { name: 'Turning Auto on…' })).toBeNull();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ })).toBeChecked();
  });

  it('shows the server\'s sentence when it refuses', async () => {
    const post = vi.fn(async () => { throw new ApiError(409, 'The job is marked done.', { code: 'closed' }); });
    show(job('alpha', 'needs-you', { level: 1 }), post);
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ })); });
    expect(document.querySelector('.auto-line')).toHaveTextContent('The job is marked done.');
    expect(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ })).not.toBeChecked();
  });

  // Minor 13: the header switch's small faults, fixed as it goes on the job page.
  it('the status line is a polite live region, so a refusal or a stop is heard', () => {
    const { container } = show(job('alpha', 'running', { level: 1 }));
    const line = container.querySelector('.auto-line')!;
    expect(line).toHaveAttribute('role', 'status');
    expect(line).toHaveAttribute('aria-live', 'polite');
  });

  it('a refusal\'s words clear when the job\'s Auto state next changes', async () => {
    const post = vi.fn(async () => { throw new ApiError(409, 'The laptop said no.', { code: 'x' }); });
    const j = job('alpha', 'needs-you', { level: 1 });
    const { container, rerender } = show(j, post);
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ })); });
    expect(container.querySelector('.auto-line')).toHaveTextContent('The laptop said no.');
    const store: Store = createStore();
    const api = { get: vi.fn(), post } as unknown as ApiClient;
    rerender(<WorkshopContext.Provider value={{ store, api }}><AutoSwitch job={{ ...j, auto: { on: true } } as Job} /></WorkshopContext.Provider>);
    expect(container.querySelector('.auto-line')).not.toHaveTextContent('The laptop said no.');
    expect(container.querySelector('.auto-line')).toHaveTextContent('Auto is on');
  });

  it('while it spins, the spinner\'s words are not part of the checkbox\'s name', async () => {
    let finish: (v: unknown) => void = () => {};
    show(job('alpha', 'needs-you', { level: 1 }), vi.fn(() => new Promise((r) => { finish = r; })));
    fireEvent.click(screen.getByRole('checkbox', { name: AUTO_LABEL }));
    expect(screen.getByRole('status', { name: 'Turning Auto on…' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toHaveAccessibleName(AUTO_LABEL);
    await act(async () => { finish({ ok: true }); });
  });

  it('says Auto is on, and who started it when a tag did', () => {
    show(job('alpha', 'running', { level: 1, auto: { on: true, by: 'tag', tag: 'auto-ok' } }));
    expect(screen.getByText('Auto is on')).toBeInTheDocument();
    expect(screen.getByText('Started by Auto (tag: auto-ok)')).toBeInTheDocument();
  });

  it('with tagLine off the switch leaves the tag line to the header', () => {
    const store: Store = createStore();
    const api = { get: vi.fn(), post: vi.fn() } as unknown as ApiClient;
    const j = job('alpha', 'running', { level: 1, auto: { on: true, by: 'tag', tag: 'auto-ok' } });
    render(<WorkshopContext.Provider value={{ store, api }}><AutoSwitch job={j} tagLine={false} /></WorkshopContext.Provider>);
    expect(screen.queryByText(/Started by Auto/)).toBeNull();
    expect(screen.getByText('Auto is on')).toBeInTheDocument();
    // Without word, nothing is drawn beside the switch.
    expect(screen.queryByText('On')).toBeNull();
  });

  it('L5: a job you started says nothing about a tag, even with an old tag left on the record', () => {
    show(job('alpha', 'running', { level: 1, auto: { on: true, by: 'you', tag: 'old' } }));
    expect(screen.queryByText(/Started by Auto/)).toBeNull();
  });

  it('a stopped job shows the reason', () => {
    // The record's own shape, as the laptop and the website send it: { reason, rule, at }.
    show(job('alpha', 'needs-you', { level: 1, auto: { on: true, stopped: { reason: 'a database change needs you.', rule: 'database', at: '2026-11-11T08:00:00.000Z' } } }));
    expect(screen.getByText('Auto stopped: a database change needs you.')).toBeInTheDocument();
    expect(screen.queryByText('Auto is on')).toBeNull();
  });

  it('keeps its line in place: the same element is still there once it has text', () => {
    const j = job('alpha', 'running', { level: 1 });
    const { container, rerender } = show(j);
    const line = container.querySelector('.auto-line')!;
    expect(line.textContent?.trim()).toBe('');
    const store: Store = createStore();
    const api = { get: vi.fn(), post: vi.fn() } as unknown as ApiClient;
    const next = { ...j, auto: { on: true, stopped: 'The plan touches the database.' } } as Job;
    rerender(<WorkshopContext.Provider value={{ store, api }}><AutoSwitch job={next} /></WorkshopContext.Provider>);
    expect(container.querySelector('.auto-line')).toBe(line);
    expect(line).toHaveTextContent('Auto stopped: The plan touches the database.');
  });

  it('shows a stop reason as the characters it holds, not as markup', () => {
    const { container } = show(job('alpha', 'needs-you', { level: 1, auto: { on: true, stopped: 'It wrote <b>x</b> to disk.' } }));
    expect(screen.getByText('Auto stopped: It wrote <b>x</b> to disk.')).toBeInTheDocument();
    expect(container.querySelector('.auto-line b')).toBeNull();
  });

  it('on the header the hint is not text: it describes the checkbox and is its title', () => {
    const { container } = show(job('alpha', 'needs-you', { level: 1 }));
    const box = screen.getByRole('checkbox', { name: AUTO_LABEL });
    expect(box).toHaveAccessibleDescription(AUTO_HINT);
    expect(box.closest('label')).toHaveAttribute('title', AUTO_HINT);
    expect(container.querySelector('.auto-switch-hint')).toBeNull();
    const hidden = container.querySelector(`#${CSS.escape(box.getAttribute('aria-describedby')!)}`)!;
    expect(hidden.className).toContain('sr-only');
  });

  it('on the form the hint stays as text', () => {
    render(<AutoSwitch checked={false} onChange={vi.fn()} />);
    expect(screen.getByText(AUTO_HINT)).toBeInTheDocument();
  });

  it('the header checkbox is disabled while its post is under way', async () => {
    let finish: (v: unknown) => void = () => {};
    show(job('alpha', 'needs-you', { level: 1 }), vi.fn(() => new Promise((r) => { finish = r; })));
    fireEvent.click(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ }));
    expect(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ })).toBeDisabled();
    await act(async () => { finish({ ok: true }); });
    expect(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ })).not.toBeDisabled();
  });

  it('long words in the line wrap instead of widening the header, and the row wraps', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/job/auto.css'), 'utf8');
    expect(/\.auto-line span \{([^}]*)\}/.exec(css)?.[1]).toMatch(/overflow-wrap:\s*anywhere[^}]*min-width:\s*0|min-width:\s*0[^}]*overflow-wrap:\s*anywhere/);
    expect(/\.job-auto \{([^}]*)\}/.exec(css)?.[1]).toMatch(/flex-wrap:\s*wrap/);
  });

  // m9: a disabled row is greyed, but its sentence is fully readable.
  it('a disabled row stays greyed but its sentence is at full opacity, in the second text colour', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/job/auto.css'), 'utf8');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.()*+?[\]\\^$|{}]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(rule('.option-row.auto-switch-row.is-off:has(.choice:disabled)')).toMatch(/opacity:\s*1\b/);
    expect(rule('.auto-switch-row.is-off > .choice, .auto-switch-row.is-off .auto-switch-label')).toMatch(/opacity:\s*\.7/);
    expect(rule('.auto-switch-row.is-off .auto-switch-hint')).toMatch(/opacity:\s*1\b/);
    expect(rule('.auto-switch-row.is-off .auto-switch-hint')).toMatch(/color:\s*var\(--text-2\)/);
    render(<AutoSwitch checked disabled onChange={vi.fn()} />);
    expect(screen.getByText(AUTO_HINT)).toHaveClass('auto-switch-hint');
    expect(screen.getByText(AUTO_HINT).closest('.auto-switch-row')).toHaveClass('is-off');
  });

  // Round 2, M4: in the job page's head, a long line under the switch wraps inside the switch's own width.
  it('in the page head the switch keeps its own width and its line wraps inside it', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/job/auto.css'), 'utf8');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.()*+?[\]\\^$|{}]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(rule('.page-head .job-auto .auto-switch-row')).toMatch(/width:\s*auto/);
    const line = rule('.page-head .job-auto .auto-line');
    expect(line).toMatch(/width:\s*0/);
    expect(line).toMatch(/min-width:\s*100%/);
    expect(rule('.page-head .job-auto .auto-switch.is-inline')).toMatch(/display:\s*inline-grid/);
    expect(line).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    // What Auto decided goes under the switch, so the head keeps one row at 1280 px.
    expect(rule('.page-head .job-auto')).toMatch(/grid-template-columns:\s*auto\b/);
  });

  it('on the form it is controlled and sends nothing itself', () => {
    const onChange = vi.fn();
    const post = vi.fn();
    render(<AutoSwitch checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(post).not.toHaveBeenCalled();
  });

  // The Auto queue (Task 17): Auto runs L3 jobs, so the switch is on or off at every level, on the
  // laptop and on the website (where the change is queued for the laptop).
  function showAt(j: Job, hosted: boolean) {
    const store: Store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [j] }) });
    const queued = { id: 'd_abcdefgh1234', kind: 'auto', state: 'waiting', words: 'Auto on or off: waiting for your laptop. It runs when the laptop is back.', at: '2026-11-12T09:00:00Z', expiresAt: null, waiting: true, canCancel: true, permissionId: null };
    const post = vi.fn(async (): Promise<unknown> => (hosted ? { ok: true, sent: false, held: true, queued, text: '', message: queued.words } : { ok: true }));
    const api = { get: vi.fn(), post, ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
    const utils = render(<WorkshopContext.Provider value={{ store, api }}><AutoSwitch job={j} /></WorkshopContext.Provider>);
    return { post, ...utils };
  }

  it('the switch works at L3', async () => {
    for (const hosted of [false, true]) {
      for (const levels of [{ level: 3 }, { level: null, suggestedLevel: 3 }] as const) {
        const { post, unmount, container } = showAt(job('alpha', 'needs-you', { ...levels }), hosted);
        const box = screen.getByRole('checkbox', { name: AUTO_LABEL });
        expect(box).toBeEnabled();
        expect(box).not.toBeChecked();
        expect(box.closest('.auto-switch-row')).not.toHaveClass('is-off');
        expect(container).not.toHaveTextContent('Auto works up to L2');
        await act(async () => { fireEvent.click(box); });
        expect(post).toHaveBeenCalledWith('/api/job/alpha/auto', { on: true });
        // The laptop turns it on; the website queues it for the laptop.
        if (hosted) expect(screen.getByText('Auto on or off: waiting for your laptop. It runs when the laptop is back.')).toBeInTheDocument();
        else expect(screen.getByRole('checkbox', { name: AUTO_LABEL })).toBeChecked();
        unmount();
        clearAllSent();
      }
    }
  });

  it('an L3 job in Auto can be switched off', async () => {
    for (const hosted of [false, true]) {
      const { post, unmount } = showAt(job('alpha', 'running', { level: 3, auto: { on: true, by: 'you', ran: true } }), hosted);
      const box = screen.getByRole('checkbox', { name: AUTO_LABEL });
      expect(box).toBeEnabled();
      expect(box).toBeChecked();
      expect(screen.getByText('Auto is on')).toBeInTheDocument();
      await act(async () => { fireEvent.click(box); });
      expect(post).toHaveBeenCalledWith('/api/job/alpha/auto', { on: false });
      if (hosted) expect(screen.getByText('Auto on or off: waiting for your laptop. It runs when the laptop is back.')).toBeInTheDocument();
      else expect(screen.getByRole('checkbox', { name: AUTO_LABEL })).not.toBeChecked();
      unmount();
      clearAllSent();
    }
  });
});

// The new job page's header (job page rebuild, Task 8): optimistic and short. Other screens keep the spinner.
describe('AutoSwitch on the new job page (optimistic, short)', () => {
  function showFast(j: Job, post: ReturnType<typeof vi.fn>, hosted = false) {
    const store: Store = createStore();
    const api = { get: vi.fn(), post, ...(hosted ? { hosted: () => true } : {}) } as unknown as ApiClient;
    return render(<WorkshopContext.Provider value={{ store, api }}><AutoSwitch job={j} word tagLine={false} optimistic short /></WorkshopContext.Provider>);
  }

  it('flips at once, with no spinner and nothing greyed, and stays flipped when the server takes it', async () => {
    let finish: (v: unknown) => void = () => {};
    const post = vi.fn(() => new Promise((r) => { finish = r; }));
    showFast(job('alpha', 'needs-you', { level: 1 }), post);
    const box = screen.getByRole('checkbox', { name: AUTO_LABEL });
    fireEvent.click(box);
    expect(post).toHaveBeenCalledWith('/api/job/alpha/auto', { on: true });
    expect(box).toBeChecked();
    expect(box).toBeEnabled();
    expect(screen.queryByRole('status', { name: 'Turning Auto on…' })).toBeNull();
    await act(async () => { finish({ ok: true }); });
    expect(box).toBeChecked();
  });

  it('flips back with one plain line when the server refuses', async () => {
    let refuse: (e: unknown) => void = () => {};
    const post = vi.fn(() => new Promise((_, no) => { refuse = no; }));
    const { container } = showFast(job('alpha', 'needs-you', { level: 1 }), post);
    const box = screen.getByRole('checkbox', { name: AUTO_LABEL });
    fireEvent.click(box);
    expect(box).toBeChecked();
    await act(async () => { refuse(new ApiError(409, 'The job is marked done.', { code: 'closed' })); });
    expect(box).not.toBeChecked();
    expect(container.querySelector('.auto-line .is-refused')).toHaveTextContent(/^Auto stayed off: The job is marked done\.$/);
  });

  it('turning it off flips back on when refused, and says so', async () => {
    const post = vi.fn(async () => { throw new ApiError(500, 'Starbase could not save it.', { code: 'x' }); });
    const { container } = showFast(job('alpha', 'running', { level: 1, auto: { on: true, by: 'you' } }), post);
    const box = screen.getByRole('checkbox', { name: AUTO_LABEL });
    await act(async () => { fireEvent.click(box); });
    expect(box).toBeChecked();
    expect(container.querySelector('.auto-line .is-refused')).toHaveTextContent('Auto stayed on: Starbase could not save it.');
  });

  it('shows the short word Auto, while its name stays the full sentence', () => {
    const { container } = showFast(job('alpha', 'needs-you', { level: 1 }), vi.fn());
    expect(screen.getByRole('checkbox', { name: AUTO_LABEL })).toBeInTheDocument();
    expect(container.querySelector('.auto-switch-row')).toHaveTextContent(/^Auto: run to PR #1 without asking me\.AutoOff$/);
    expect(container.querySelector('.auto-switch-short')).toHaveTextContent('Auto');
    expect(container.querySelector('.auto-switch-short')).toHaveAttribute('aria-hidden', 'true');
  });

  it('on the website it waits for the laptop as today: no flip before the laptop does it', async () => {
    const queued = { id: 'd_abcdefgh1234', kind: 'auto', state: 'waiting', words: 'Auto on or off: waiting for your laptop. It runs when the laptop is back.', at: '2026-11-12T09:00:00Z', expiresAt: null, waiting: true, canCancel: true, permissionId: null };
    const post = vi.fn(async () => ({ ok: true, sent: false, held: true, queued, text: '', message: queued.words }));
    showFast(job('alpha', 'needs-you', { level: 1 }), post, true);
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: AUTO_LABEL })); });
    expect(screen.getByRole('checkbox', { name: AUTO_LABEL })).not.toBeChecked();
    expect(screen.getByText(queued.words)).toBeInTheDocument();
  });
});
