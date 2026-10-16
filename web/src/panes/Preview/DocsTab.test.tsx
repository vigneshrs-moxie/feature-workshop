import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../../api/client';
import type { JobDoc, JobDocEntry } from '../../api/types';
import { UiProvider, useUi } from '../../app/ui';
import { createStore, WorkshopContext } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { DocsTab } from './DocsTab';
import { groupDocs, sizeLabel, versionLabel } from './docs';
import { PreviewPane } from './PreviewPane';

// Invented job and documents only.
const NOW = new Date().toISOString();
const DOCS: JobDocEntry[] = [
  { file: 'spec', name: 'Product spec', group: 'plan', version: '0.3', updatedAt: NOW, size: 900, type: 'md' },
  { file: 'implementation-plan.md', name: 'Implementation plan', group: 'plan', version: '2', updatedAt: NOW, size: 2048, type: 'md' },
  { file: 'briefs/002-plan.md', name: 'Brief #2 · plan', group: 'briefs', version: null, updatedAt: NOW, size: 300, type: 'md' },
  { file: 'review.md', name: 'Review (combined)', group: 'review', version: null, updatedAt: NOW, size: 400, type: 'md' },
  { file: 'fable/005-plan.md', name: 'Fable second look #5 · plan', group: 'review', version: null, updatedAt: NOW, size: 200, type: 'md' },
  { file: 'notes.md', name: 'Notes', group: 'notes', version: null, updatedAt: NOW, size: 20, type: 'md' },
  { file: 'status.json', name: 'Status (status.json)', group: 'other', version: null, updatedAt: NOW, size: 120, type: 'json' },
];
const PLAN: JobDoc = {
  file: 'implementation-plan.md', name: 'Implementation plan', type: 'md', updatedAt: NOW, size: 2048,
  html: '<h1 id="h-plan">Plan v2</h1><div class="table-wrap"><table><thead><tr><th>Step</th></tr></thead><tbody><tr><td>S1</td></tr></tbody></table></div><pre><code class="language-js">const x = 1;\n</code></pre>',
  text: '# Plan v2\n\n| Step |\n|---|\n| S1 |\n\n```js\nconst x = 1;\n```\n',
};

function setup({ docs = DOCS, list, doc }: { docs?: JobDocEntry[]; list?: () => Promise<unknown>; doc?: (file: string) => Promise<unknown> } = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'idle')] }) });
  const get = vi.fn(async (path: string) => {
    if (path === '/api/job/alpha/docs') return list ? list() : { docs };
    const m = /^\/api\/job\/alpha\/doc\?file=(.+)$/.exec(path);
    if (m) {
      const file = decodeURIComponent(m[1]);
      if (doc) return doc(file);
      if (file === 'implementation-plan.md') return PLAN;
      return { file, name: file, type: file.endsWith('.json') ? 'json' : 'md', html: `<p>${file}</p>`, text: `text of ${file}`, updatedAt: NOW, size: 10 };
    }
    throw new ApiError(404, 'Not found');
  });
  const api = { get } as unknown as ApiClient;
  const utils = render(<WorkshopContext.Provider value={{ store, api }}><DocsTab slug="alpha" /></WorkshopContext.Provider>);
  return { ...utils, get, store };
}

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('Docs tab helpers', () => {
  it('groups in order, leaves empty groups out, and labels versions and sizes', () => {
    expect(groupDocs(DOCS).map((g) => g.label)).toEqual(['Plan & spec', 'Briefs', 'Review', 'Notes', 'Other']);
    expect(groupDocs(DOCS.filter((d) => d.group === 'review')).map((g) => g.id)).toEqual(['review']);
    expect(versionLabel('2')).toBe('v2');
    expect(versionLabel('v0.3')).toBe('v0.3');
    expect(versionLabel(null)).toBe('');
    expect(sizeLabel(840)).toBe('840 bytes');
    expect(sizeLabel(12 * 1024)).toBe('12 KB');
  });
});

describe('Docs tab', () => {
  it('lists every document by group, with versions and times, and a folded How this works', async () => {
    setup();
    for (const [group, names] of [
      ['Plan & spec', ['Product spec', 'Implementation plan']], ['Briefs', ['Brief #2 · plan']],
      ['Review', ['Review (combined)', 'Fable second look #5 · plan']], ['Notes', ['Notes']], ['Other', ['Status (status.json)']],
    ] as const) {
      const region = await screen.findByRole('region', { name: new RegExp(`^${group}`) });
      for (const n of names) expect(within(region).getByRole('button', { name: new RegExp(`^${n.replace(/[()#.]/g, '\\$&')}`) })).toHaveAttribute('title');
    }
    expect(screen.getByRole('button', { name: /^Implementation plan/ })).toHaveTextContent('v2');
    expect(screen.getByRole('button', { name: /^Product spec/ })).toHaveTextContent('v0.3');
    expect(screen.getByRole('button', { name: /^Status/ })).toHaveTextContent('JSON');
    expect(screen.getByRole('button', { name: /^Notes/ })).toHaveTextContent('just now');
    expect(screen.getByText('7 documents')).toBeInTheDocument();
    const how = screen.getByText('How this works').closest('details')!;
    expect(how).not.toHaveAttribute('open');
    expect(how).toHaveTextContent('Every document the crew writes for this job, shown as a clean page.');
  });

  it('opens a document as a clean page (the dashboard’s HTML), and Back returns to the list with focus on it', async () => {
    const { get } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /^Implementation plan/ }));
    const reader = await screen.findByRole('article', { name: 'Implementation plan' });
    expect(get).toHaveBeenCalledWith('/api/job/alpha/doc?file=implementation-plan.md');
    expect(await within(reader).findByRole('heading', { name: 'Plan v2' })).toBeInTheDocument();
    expect(within(reader).getByRole('table')).toBeInTheDocument();
    expect(reader.querySelector('.prose.doc-page pre code')).toHaveTextContent('const x = 1;');
    expect(reader).toHaveTextContent('implementation-plan.md');
    expect(within(reader).getByRole('link', { name: 'Open in classic view' })).toHaveAttribute('href', '/#/job/alpha');
    const back = within(reader).getByRole('button', { name: /All documents/ });
    expect(back).toHaveFocus();
    fireEvent.click(back);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Implementation plan/ })).toHaveFocus());
  });

  it('Source shows the Markdown as written, Page the clean page; the choice is remembered', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /^Implementation plan/ }));
    const reader = await screen.findByRole('article', { name: 'Implementation plan' });
    await within(reader).findByRole('table');
    const page = within(reader).getByRole('button', { name: 'Page' });
    const source = within(reader).getByRole('button', { name: 'Source' });
    expect(page).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(source);
    expect(source).toHaveAttribute('aria-pressed', 'true');
    expect(within(reader).queryByRole('table')).toBeNull();
    expect(reader.querySelector('pre.doc-source')!.textContent).toBe(PLAN.text);
    expect(localStorage.getItem('fw.docs.view')).toBe('source');
    fireEvent.click(page);
    expect(within(reader).getByRole('table')).toBeInTheDocument();
    expect(localStorage.getItem('fw.docs.view')).toBeNull();
  });

  it('Copy as markdown copies the source text', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /^Implementation plan/ }));
    const reader = await screen.findByRole('article', { name: 'Implementation plan' });
    await within(reader).findByRole('table');
    await act(async () => { fireEvent.click(within(reader).getByRole('button', { name: 'Copy as markdown' })); });
    expect(writeText).toHaveBeenCalledWith(PLAN.text);
    expect(within(reader).getByRole('status')).toHaveTextContent('Copied');
  });

  it('a JSON document offers Copy JSON', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /^Status/ }));
    const reader = await screen.findByRole('article', { name: 'status.json' });
    expect(await within(reader).findByRole('button', { name: 'Copy JSON' })).toBeEnabled();
  });

  it('says so when the job has no documents yet', async () => {
    setup({ docs: [] });
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument();
    expect(screen.getByText(/show up here as the crew writes them/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toHaveAttribute('title');
  });

  it('a list or document that fails to load says why, with Try again', async () => {
    let fail = true;
    setup({ list: async () => { if (fail) throw new ApiError(500, 'The dashboard is busy.'); return { docs: DOCS }; } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the documents: The dashboard is busy.');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /^Implementation plan/ })).toBeInTheDocument();
  });

  it('a document too big to show says so', async () => {
    setup({ doc: async () => { throw new ApiError(413, 'That document is too big to show here.'); } });
    fireEvent.click(await screen.findByRole('button', { name: /^Review/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load it: That document is too big to show here.');
  });
});

describe('Preview pane', () => {
  function Opener() {
    const ui = useUi();
    return <button type="button" onClick={ui.openDocs}>open docs</button>;
  }

  function renderPane(slug: string | null) {
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'idle')] }) });
    const api = { get: vi.fn(async (p: string) => (p.endsWith('/docs') ? { docs: DOCS } : PLAN)) } as unknown as ApiClient;
    return render(
      <WorkshopContext.Provider value={{ store, api }}>
        <UiProvider><Opener /><PreviewPane slug={slug} /></UiProvider>
      </WorkshopContext.Provider>,
    );
  }

  it('opens on Docs; the Classic view tab keeps the classic links; arrow keys move between tabs', async () => {
    renderPane('alpha');
    const docs = screen.getByRole('tab', { name: 'Docs' });
    expect(docs).toHaveAttribute('aria-selected', 'true');
    expect(docs).toHaveAttribute('title');
    expect(await screen.findByRole('button', { name: /^Implementation plan/ })).toBeInTheDocument();
    fireEvent.keyDown(docs, { key: 'ArrowRight' });
    const classic = screen.getByRole('tab', { name: 'Classic view' });
    expect(classic).toHaveAttribute('aria-selected', 'true');
    expect(classic).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Open this job in classic view' })).toHaveAttribute('href', '/#/job/alpha');
  });

  it('⌘K “Open docs” brings back the Docs tab, on the list, with focus on the first document', async () => {
    renderPane('alpha');
    fireEvent.click(await screen.findByRole('button', { name: /^Implementation plan/ }));
    await screen.findByRole('article', { name: 'Implementation plan' });
    fireEvent.click(screen.getByRole('tab', { name: 'Classic view' }));
    fireEvent.click(screen.getByRole('button', { name: 'open docs' }));
    expect(screen.getByRole('tab', { name: 'Docs' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Product spec/ })).toHaveFocus());
  });

  it('with no job open, says to open one', () => {
    renderPane(null);
    expect(screen.getByText(/Open a job to read its documents here/)).toBeInTheDocument();
  });
});
