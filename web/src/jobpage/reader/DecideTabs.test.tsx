// The tabs over the reader while a decision waits (a laptop, 16 Nov): the brief, what the picked step
// (else the current one) made, the spec. Built against the made-up long job, which waits at the review's gate.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { longJob } from '../fixtures/longJob';
import { createJobStore, type JobStore } from '../jobStore';
import type { JobPagePayload, Output, ReaderTarget, StopId } from '../types';
import { JobStoreContext } from '../useJob';
import { DecideTabs, tabsOf } from './DecideTabs';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const payload = () => clone(longJob.payload) as unknown as JobPagePayload;
const labels = (p: JobPagePayload | null, picked?: string | null) => tabsOf(p, picked).map((t) => t.label);
const step = (p: JobPagePayload, id: string) => p.steps.find((s) => s.id === id)!;

describe('tabsOf', () => {
  it('the brief first, then what the current step made, then the spec', () => {
    const tabs = tabsOf(payload());
    expect(tabs.map((t) => t.label)).toEqual(['Brief #15', 'Findings', 'Review (combined)', 'Spec']);
    expect(tabs[0].t).toEqual({ kind: 'brief', id: 'brief:briefs/015-review.md' });
    expect(tabs[1].meta).toBe('1 open');
    expect(tabs[3].t).toEqual({ kind: 'doc', id: 'spec' });
  });

  it('no payload, no tabs', () => {
    expect(tabsOf(null)).toEqual([]);
  });

  it('the brief is the page’s open one; when the page opens on something else, the newest brief', () => {
    const p = payload();
    p.open = { kind: 'ticket', id: 'ticket' };
    const newest = [...p.thread].reverse().find((l) => l.kind === 'brief')!;
    expect(tabsOf(p)[0].t).toEqual({ kind: 'brief', id: newest.id });
    // No brief at all: the tabs start at the step's outputs.
    p.thread = p.thread.filter((l) => l.kind !== 'brief');
    expect(labels(p)[0]).toBe('Findings');
  });

  it('a picked step’s outputs stand in for the current step’s', () => {
    expect(labels(payload(), 'plan')).toEqual(['Brief #15', 'Implementation plan', 'Test plan', 'Acceptance criteria', 'Spec']);
    // A step id the payload does not have: the current step's.
    expect(labels(payload(), 'nowhere')).toEqual(['Brief #15', 'Findings', 'Review (combined)', 'Spec']);
  });

  it('Ship: one PR lines tab for its main view, not a tab per PR', () => {
    const tabs = tabsOf(payload(), 'ship');
    expect(tabs.map((t) => t.label)).toEqual(['Brief #15', 'PR lines', 'Spec']);
    expect(tabs[1].t).toEqual({ kind: 'ship', id: 'ship' });
  });

  it('a step with no outputs: one tab for its main output, its word beside it', () => {
    const p = payload();
    step(p, 'build').outputs = [];
    const tabs = tabsOf(p, 'build');
    expect(tabs.map((t) => t.label)).toEqual(['Brief #15', 'Build', 'Spec']);
    expect(tabs[1]).toMatchObject({ t: step(p, 'build').main, meta: '9 commits' });
    // Not started (nothing to show): no tab for it.
    step(p, 'build').main = { kind: 'not-yet', id: 'build' } as never;
    expect(labels(p, 'build')).toEqual(['Brief #15', 'Spec']);
  });

  it('the spec last, and only once: not at the Spec step, nor when the step’s own outputs have it', () => {
    expect(labels(payload(), 'spec')).toEqual(['Brief #15', 'Product spec', 'Screens']);
    const p = payload();
    step(p, 'plan').outputs.push({ kind: 'doc', id: 'spec', label: 'The spec it planned from', meta: null, version: null } as Output);
    const tabs = labels(p, 'plan');
    expect(tabs.filter((l) => l === 'Spec' || l === 'The spec it planned from')).toEqual(['The spec it planned from']);
    // No spec yet: no Spec tab.
    const q = payload();
    step(q, 'spec').main = { kind: 'not-yet', id: 'spec' } as never;
    expect(labels(q)).toEqual(['Brief #15', 'Findings', 'Review (combined)']);
  });

  it('at most six', () => {
    // The Test step made four things: the brief, four, and the spec are six.
    expect(labels(payload(), 'test')).toEqual(['Brief #15', 'Checks', 'Recording', 'Your hand test', 'Test report', 'Spec']);
    const p = payload();
    for (let i = 0; i < 6; i++) step(p, 'review').outputs.push({ kind: 'doc', id: `extra-${i}.md`, label: `Extra ${i}`, meta: null, version: null } as Output);
    const tabs = labels(p);
    expect(tabs).toHaveLength(6);
    expect(tabs.slice(0, 3)).toEqual(['Brief #15', 'Findings', 'Review (combined)']);
  });
});

function mount(p: JobPagePayload | null = payload()) {
  const api = { get: async () => ({}), post: async () => ({}), hosted: () => false } as unknown as ApiClient;
  const store: JobStore = createJobStore(SLUG, { api, initial: p, events: () => () => {} });
  const onOpen = vi.fn((t: ReaderTarget) => { store.setReader(t); });
  const utils = render(<JobStoreContext.Provider value={store}><DecideTabs onOpen={onOpen} /></JobStoreContext.Provider>);
  return { store, onOpen, ...utils };
}
const list = () => screen.getByRole('tablist', { name: 'About this decision' });
const selected = () => within(list()).getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent);

describe('DecideTabs', () => {
  it('a tab row named About this decision; the brief is the selected tab as the page opens', () => {
    mount();
    expect(within(list()).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Brief #15', 'Findings1 open', 'Review (combined)', 'Spec']);
    expect(selected()).toEqual(['Brief #15']);
  });

  it('a click opens the tab’s target, from the tab', () => {
    const { onOpen } = mount();
    const tab = within(list()).getByRole('tab', { name: /^Findings/ });
    fireEvent.click(tab);
    expect(onOpen).toHaveBeenCalledWith({ kind: 'findings', id: 'findings' }, tab);
    expect(selected()).toEqual(['Findings1 open']);
  });

  it('the selected tab follows the reader, however it moved; nothing is selected when the reader shows something else', () => {
    const { store } = mount();
    act(() => { store.setReader({ kind: 'doc', id: 'spec' }); });
    expect(selected()).toEqual(['Spec']);
    act(() => { store.setReader({ kind: 'ticket', id: 'ticket' }); });
    expect(selected()).toEqual([]);
  });

  it('a step pick changes the tabs to that step’s outputs, its main output selected', () => {
    const { store } = mount();
    act(() => { store.setStep('plan' as StopId); });
    expect(within(list()).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Brief #15', 'Implementation plan5 steps', 'Test plan', 'Acceptance criteria', 'Spec']);
    expect(selected()).toEqual(['Implementation plan5 steps']);
  });

  it('fewer than two tabs: no row', () => {
    const p = payload();
    p.thread = p.thread.filter((l) => l.kind !== 'brief');
    for (const s of p.steps) { s.outputs = []; s.main = { kind: 'not-yet', id: s.id } as never; }
    const { container } = mount(p);
    expect(container).toBeEmptyDOMElement();
    mount(null);
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
