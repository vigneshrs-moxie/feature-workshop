// The Auto switch (spec: Turning it on and off): a checkbox on the New job form and in the job
// header, off and explained at L3, one POST with a spinner in the header, and the header line.
// Invented jobs only.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import type { Job } from '../api/types';
import { clearAllSent } from '../lib/sentState';
import { createStore, WorkshopContext, type Store } from '../state/store';
import { job, snapshot } from '../state/test-fixtures';
import { AutoSwitch, AUTO_HINT, AUTO_L3, AUTO_LABEL } from './AutoSwitch';

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
    expect(screen.getByText(AUTO_HINT)).toBeInTheDocument();
    expect(AUTO_HINT).toBe('A Fable agent approves each step for you and takes the recommended answers. It stops and asks you when something is risky. It never merges.');
  });

  it('the switch is off at L3 and says why', () => {
    show(job('alpha', 'needs-you', { level: 3, auto: { on: true } }));
    const box = screen.getByRole('checkbox', { name: /Auto: run to PR #1/ });
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    // The server's own sentence (dashboard/lib/auto.js AUTO_L3).
    expect(AUTO_L3).toBe('Auto works up to L2. An L3 job needs you to approve each step.');
    expect(screen.getByText(AUTO_L3)).toBeInTheDocument();
  });

  it('is off too while the Foreman suggests L3', () => {
    show(job('alpha', 'needs-you', { level: null, suggestedLevel: 3 }));
    expect(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ })).toBeDisabled();
    expect(screen.getByText(AUTO_L3)).toBeInTheDocument();
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
    const post = vi.fn(async () => { throw new ApiError(409, 'Auto works up to L2. An L3 job needs you to approve each step.', { code: 'auto-level' }); });
    show(job('alpha', 'needs-you', { level: 1 }), post);
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Auto works up to L2. An L3 job needs you to approve each step.');
    expect(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ })).not.toBeChecked();
  });

  it('says Auto is on, and who started it when a tag did', () => {
    show(job('alpha', 'running', { level: 1, auto: { on: true, by: 'tag', tag: 'auto-ok' } }));
    expect(screen.getByText('Auto is on')).toBeInTheDocument();
    expect(screen.getByText('Started by Auto (tag: auto-ok)')).toBeInTheDocument();
  });

  it('a stopped job shows the reason', () => {
    show(job('alpha', 'needs-you', { level: 1, auto: { on: true, stopped: 'The plan touches the database.' } }));
    expect(screen.getByText('Auto stopped: The plan touches the database.')).toBeInTheDocument();
    expect(screen.queryByText('Auto is on')).toBeNull();
  });

  it('keeps its line in place so the page does not move when the line appears', () => {
    const { container, rerender } = show(job('alpha', 'running', { level: 1 }));
    const line = container.querySelector('.auto-line')!;
    expect(line).toBeInTheDocument();
    expect(line.textContent?.trim()).toBe('');
    expect(rerender).toBeTruthy();
  });

  it('on the form it is controlled and sends nothing itself', () => {
    const onChange = vi.fn();
    const post = vi.fn();
    render(<AutoSwitch level={2} checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Auto: run to PR #1/ }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(post).not.toHaveBeenCalled();
  });

  it('on the form at L3 it is off, disabled, and says why', () => {
    render(<AutoSwitch level={3} checked onChange={vi.fn()} />);
    const box = screen.getByRole('checkbox', { name: /Auto: run to PR #1/ });
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(screen.getByText(AUTO_L3)).toBeInTheDocument();
  });
});
