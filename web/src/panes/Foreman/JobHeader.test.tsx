// The job header (JobHeader.tsx): still while the conversation scrolls (app.css, "Job view and
// Desk (light round 2)"), and one quiet facts line (the cost only over 10 cents, the permission
// setting only when it isn't the default).
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job } from '../../api/types';
import { createStore, WorkshopContext, type Store } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { JobHeader } from './JobHeader';

// vitest runs from web/ (jsdom gives import.meta.url an http scheme, so the paths are from there).
const css = readFileSync(path.join(process.cwd(), 'src/app/app.css'), 'utf8');
const theme = (id: string) => readFileSync(path.join(process.cwd(), `src/theme/themes/${id}.css`), 'utf8');

function show(j: Job, settings: Record<string, unknown> = { policy: 'hands-off', jobPolicy: {} }, dir = '/f/alpha', container?: HTMLElement) {
  const store: Store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [j], meta: { token: 't', settings: settings as never } }) });
  const api = { get: async () => ({}), post: async () => ({}) } as unknown as ApiClient;
  return render(<WorkshopContext.Provider value={{ store, api }}><JobHeader job={j} dir={dir} /></WorkshopContext.Provider>, container ? { container } : undefined);
}

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('the job header stays still', () => {
  it('is sticky at the top of the Foreman pane, above the thread, on the theme’s background', () => {
    const rule = /\.pane-foreman \.job-header \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule, 'flush with the pane edge, over its top padding').toMatch(/top:\s*calc\(-1 \* var\(--space-3\)\)/);
    expect(rule).toMatch(/z-index:\s*6/);
    expect(rule).toMatch(/background:\s*var\(--bg-0\)/);
    // The composer keeps its place at the bottom, under the header's layer.
    expect(/\.composer \{([^}]*)\}/.exec(css)?.[1]).toMatch(/position:\s*sticky;\s*bottom:\s*0;\s*z-index:\s*5/);
  });

  it('is a solid float in both Glass themes: the float tint over an opaque base, so the thread never shows through', () => {
    for (const id of ['glass', 'light-glass']) {
      expect(theme(id), id).toMatch(new RegExp(`html\\[data-theme="${id}"\\] \\.pane-foreman \\.job-header \\{[^}]*background: linear-gradient\\(var\\(--glass-float\\), var\\(--glass-float\\)\\), oklch\\([\\d. ]+\\);`));
    }
  });

  it('keeps a band of its own background under its line, so the thread stops short of it', () => {
    const rule = /\.pane-foreman \.job-header \{([^}]*)\}/.exec(css)?.[1] ?? '';
    const line = /\.pane-foreman \.job-header::after \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/padding:[^;]*calc\(var\(--space-2\) \+ 1px \+ var\(--space-3\)\)/);
    expect(line).toMatch(/bottom:\s*var\(--space-3\)/);
    expect(line).toMatch(/height:\s*1px/);
  });

  it('goes compact once the room it frees is scrolled out of sight, and full again on any scroll back up', () => {
    // jsdom has no layout: the header is 270 px tall, 90 px compact.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const h = this.classList.contains('job-header') ? (this.classList.contains('is-compact') ? 90 : 270) : 0;
      return { height: h, width: 0, top: 0, left: 0, right: 0, bottom: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const pane = document.body.appendChild(document.createElement('div'));
    pane.className = 'pane-foreman';
    const { container } = show(job('alpha', 'running'), undefined, undefined, pane);
    const header = container.querySelector<HTMLElement>('header.job-header')!;
    expect(pane.style.getPropertyValue('--job-header-h'), 'the real height, for scroll-padding').toBe('270px');
    const scrollTo = (y: number) => act(() => { pane.scrollTop = y; fireEvent.scroll(pane); });

    scrollTo(100); // the freed room (270 - about 90) would still show: stays full
    expect(header).not.toHaveClass('is-compact');
    scrollTo(400);
    expect(header).toHaveClass('is-compact');
    scrollTo(600);
    expect(header).toHaveClass('is-compact');
    scrollTo(550); // any scroll back up, anywhere: the full header again
    expect(header).not.toHaveClass('is-compact');
    scrollTo(700);
    expect(header).toHaveClass('is-compact');
    scrollTo(0);
    expect(header).not.toHaveClass('is-compact');
    expect(header.style.marginBottom).toBe('');
  });

  it('compact: one slim row (title, thin trail, level, menu) and the "Your move" line; the facts wait', () => {
    expect(css).toMatch(/\.pane-foreman \.job-header\.is-compact \{[^}]*display: grid/);
    expect(css).toMatch(/\.job-header\.is-compact :is\([^)]*\.job-facts[^)]*\) \{ display: none; \}/);
    expect(css).toMatch(/\.job-header\.is-compact \.trail-now \{ grid-area: 2 \/ 1 \/ 3 \/ -1;/);
  });

  it('renders as one header block: the title line, then the facts line (the trail and the lines between them with Play on)', () => {
    const { container } = show(job('alpha', 'running', { kind: 'feature', repo: { name: 'sample-repo', branch: 'feat/sample' } }));
    const header = container.querySelector('header.job-header')!;
    expect(header).not.toBeNull();
    const classes = [...header.children].map((c) => c.className);
    expect(classes[0]).toBe('job-header-line');
    expect(classes.at(-1)).toBe('job-facts muted');
    expect(classes.slice(1, -1), 'Play on by default: the trail between them').toEqual(['job-trail is-header']);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Job alpha');
  });
});

describe('the facts line', () => {
  it('shows the cost only over 10 cents, and the permission setting only when it isn’t the default', () => {
    const base = job('alpha', 'running', { kind: 'bug', repo: { name: 'sample-repo', branch: 'fix/sample' } });
    const { unmount } = show({ ...base, cost: { totalUsd: 0.08, source: 'estimate' } });
    const facts = () => document.querySelector('.job-facts')!.textContent;
    expect(facts()).toBe('RunningBug fixsample-repofix/sample');
    unmount();
    show({ ...base, cost: { totalUsd: 1.5, source: 'claude-code' } }).unmount();
    expect(document.querySelector('.job-facts')).toBeNull();
    const two = show({ ...base, cost: { totalUsd: 1.5, source: 'claude-code' } });
    expect(facts()).toBe('RunningBug fixsample-repofix/sample$1.50');
    two.unmount();
    // Your global setting isn't the default: it is named.
    const three = show(base, { policy: 'ask-all', jobPolicy: {} });
    expect(facts()).toContain('Ask about everything');
    three.unmount();
    // This job has its own setting: named, with "this job".
    show(base, { policy: 'hands-off', jobPolicy: { '/f/alpha': 'auto' } });
    expect(screen.getByText('Auto mode · this job')).toHaveAttribute('title', expect.stringContaining('this job’s own setting'));
  });
});
