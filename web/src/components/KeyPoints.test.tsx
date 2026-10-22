// Key points (KeyPoints.tsx): the Foreman's short summary of a document or brief, shown above it;
// and, where there is none, the Summarise button that asks for one through your message box. Also
// how the brief card (In short, the whole brief folded under it) and the Docs reader use it.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import type { BriefItem, DocSummary, JobDocEntry } from '../api/types';
import { readStored } from '../lib/stored';
import { draftKey } from '../panes/Foreman/Composer';
import { BriefCard } from '../panes/Foreman/BriefCard';
import { DocsTab } from '../panes/Preview/DocsTab';
import { createStore, WorkshopContext } from '../state/store';
import { job, snapshot } from '../state/test-fixtures';
import { addSummaryRequest, KeyPoints } from './KeyPoints';

// Invented documents only.
const SUMMARY: DocSummary = {
  outcome: ['Three steps, one commit each.'],
  risks: ['Step 2 touches the **shared** query.'],
  decisions: [{ text: 'Keep the old column?', recommendation: 'No' }, { text: 'Name the export?', recommendation: null }],
  changed: [],
  written: null,
  version: '2',
  stale: false,
  file: 'summaries/implementation-plan.v2.json',
};

afterEach(() => { localStorage.clear(); });

describe('Key points', () => {
  it('shows each part with a word label, leaves empty parts out, and keeps inline marks', () => {
    render(<KeyPoints summary={SUMMARY} kind="doc" slug="alpha" file="implementation-plan.md" version="2" />);
    const box = screen.getByRole('region', { name: 'Key points' });
    expect(within(box).getByRole('heading', { name: 'Outcome' })).toBeInTheDocument();
    expect(within(box).getByRole('heading', { name: 'Risks and surprises' })).toBeInTheDocument();
    expect(within(box).getByRole('heading', { name: 'Decisions for you' })).toBeInTheDocument();
    expect(within(box).queryByRole('heading', { name: 'What changed' })).toBeNull();
    expect(within(box).getByText('shared').tagName).toBe('STRONG');
    expect(box).toHaveTextContent('Keep the old column? Recommended: No');
    expect(box).not.toHaveTextContent('Name the export? Recommended');
    expect(box).not.toHaveTextContent(/older|Summary of/);
  });

  it('a brief’s is called In short; a summary of an older version says so', () => {
    render(<KeyPoints summary={{ ...SUMMARY, stale: true }} kind="brief" slug="alpha" file="spec" version="3" />);
    const box = screen.getByRole('region', { name: 'In short' });
    expect(box).toHaveTextContent('Summary of v2; this is now v3. Some of it may have changed.');
  });

  it('none: Summarise asks for it in the job’s draft, once per document, after what you wrote', () => {
    localStorage.setItem(draftKey('alpha'), 'My own words.');
    render(<KeyPoints summary={null} kind="doc" slug="alpha" file="findings.md" version="1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Summarise' }));
    expect(screen.getByRole('status')).toHaveTextContent('Added to your message');
    const draft = readStored(draftKey('alpha'))!;
    expect(draft.startsWith('My own words.\n\n--- Summaries wanted ---\n')).toBe(true);
    expect(draft).toContain('- findings.md (v1)\n--- end ---');
    fireEvent.click(screen.getByRole('button', { name: 'Summarise' }));
    expect(screen.getByRole('status')).toHaveTextContent('Already in your message');
    // Another document joins the same block.
    expect(addSummaryRequest('alpha', 'briefs/006-review.md', null)).toBe(true);
    const next = readStored(draftKey('alpha'))!;
    expect(next.match(/--- Summaries wanted ---/g)).toHaveLength(1);
    expect(next).toContain('- findings.md (v1)\n- briefs/006-review.md\n--- end ---');
  });
});

function withApi(get: (path: string) => Promise<unknown>, ui: React.ReactNode) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'needs-you')] }) });
  const api = { get: vi.fn(get), post: vi.fn() } as unknown as ApiClient;
  return render(<WorkshopContext.Provider value={{ store, api }}>{ui}</WorkshopContext.Provider>);
}

const BRIEF: BriefItem = { kind: 'brief', id: 'brief:briefs/006-review.md', at: null, number: 6, stage: 'review', file: 'briefs/006-review.md', headline: 'Review done', point: null };

describe('Key points on a brief', () => {
  it('an open brief shows In short first and the whole brief folded under it', async () => {
    withApi(async () => ({ file: BRIEF.file, name: 'Brief', html: '<p>The whole long brief.</p>', summary: SUMMARY }),
      <BriefCard slug="alpha" brief={{ item: BRIEF, detailFile: null, answered: false }} now={new Date()} />);
    const box = await screen.findByRole('region', { name: 'In short' });
    expect(box).toHaveTextContent('Three steps, one commit each.');
    const whole = screen.getByText('Read the whole brief').closest('details')!;
    expect(whole).not.toHaveAttribute('open');
    expect(within(whole).getByText('The whole long brief.')).toBeInTheDocument();
  });

  it('with none, the whole brief as before and a Summarise button under it', async () => {
    withApi(async () => ({ file: BRIEF.file, name: 'Brief', html: '<p>The whole long brief.</p>', summary: null }),
      <BriefCard slug="alpha" brief={{ item: BRIEF, detailFile: null, answered: false }} now={new Date()} />);
    expect(await screen.findByText('The whole long brief.')).toBeVisible();
    expect(screen.queryByText('Read the whole brief')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Summarise' }));
    expect(readStored(draftKey('alpha'))).toContain('- briefs/006-review.md\n--- end ---');
  });
});

describe('Key points in the Docs tab', () => {
  const NOW = new Date().toISOString();
  const DOCS: JobDocEntry[] = [
    { file: 'implementation-plan.md', name: 'Implementation plan', group: 'plan', version: '2', updatedAt: NOW, size: 10, type: 'md', summary: 'current' },
    { file: 'findings.md', name: 'Findings', group: 'plan', version: '3', updatedAt: NOW, size: 10, type: 'md', summary: 'stale' },
    { file: 'test-plan.md', name: 'Test plan', group: 'plan', version: null, updatedAt: NOW, size: 10, type: 'md', summary: null },
    { file: 'notes.md', name: 'Notes', group: 'notes', version: null, updatedAt: NOW, size: 10, type: 'md', summary: null },
  ];
  const get = async (path: string) => {
    if (path === '/api/job/alpha/docs') return { docs: DOCS };
    const file = decodeURIComponent(/file=(.+)$/.exec(path)![1]);
    return { file, name: file, type: 'md', html: `<p>Body of ${file}</p>`, text: '', summary: file === 'implementation-plan.md' ? SUMMARY : null };
  };

  it('the list marks documents that have key points (and older ones); a document opens with them on top', async () => {
    withApi(get, <DocsTab slug="alpha" />);
    const plan = await screen.findByRole('button', { name: /Implementation plan/ });
    expect(within(plan).getByText('Key points')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Findings/ })).getByText('Key points (older)')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Test plan/ })).queryByText(/Key points/)).toBeNull();
    fireEvent.click(plan);
    const box = await screen.findByRole('region', { name: 'Key points' });
    expect(box.compareDocumentPosition(screen.getByText('Body of implementation-plan.md')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a plan without them offers Summarise; your notes never do', async () => {
    withApi(get, <DocsTab slug="alpha" />);
    fireEvent.click(await screen.findByRole('button', { name: /Test plan/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Summarise' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /All documents/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Notes/ }));
    await screen.findByText('Body of notes.md');
    expect(screen.queryByRole('button', { name: 'Summarise' })).toBeNull();
  });
});
