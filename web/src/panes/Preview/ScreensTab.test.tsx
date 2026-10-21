// The Screens tab: the page in a sandboxed iframe, the bar above it, Copy feedback through
// postMessage (copied, and added to your message while a gate waits), the Enter and Esc keys, and
// the tab's place in the Preview pane (only for a job with screens). The iframe never loads here
// (jsdom fetches nothing); its window is stubbed. Invented jobs only.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job } from '../../api/types';
import { installKeyListener } from '../../app/keyRegistry';
import { UiProvider, useUi } from '../../app/ui';
import { readStored, writeStored } from '../../lib/stored';
import { createStore, WorkshopContext } from '../../state/store';
import { job, snapshot } from '../../state/test-fixtures';
import { draftKey } from '../Foreman/Composer';
import { PreviewPane } from './PreviewPane';
import { addFeedbackToDraft, gateWaiting, ScreensTab, wireframesUrl } from './ScreensTab';
import { clearWireframes, frameMounted } from './wireframes';

const WITH_SCREENS: Partial<Job> = { wireframes: { version: '2' } };
const REPORT = {
  type: 'wireframes', version: '2', current: 's-list',
  screens: [{ key: 's-list', name: 'The list', kind: 'screen', status: 'fix', choice: '' }, { key: 'c-entry', name: 'Where the button goes', kind: 'choice', status: '', choice: '' }],
};

function setup({ jobExtra = WITH_SCREENS, active = true, full = false }: { jobExtra?: Partial<Job>; active?: boolean; full?: boolean } = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'needs-you', jobExtra)] }) });
  const api = { get: vi.fn() } as unknown as ApiClient;
  const utils = render(
    <WorkshopContext.Provider value={{ store, api }}>
      <UiProvider><ScreensTab slug="alpha" job={store.getState().jobs[0]} active={active} full={full} /></UiProvider>
    </WorkshopContext.Provider>,
  );
  const iframe = utils.container.querySelector('iframe')!;
  return { ...utils, iframe, win: iframe.contentWindow! };
}

/** A message from the page: from the iframe's own window, same origin (anything else is ignored). */
const fromPage = (win: Window, data: unknown, origin = window.location.origin) => {
  act(() => { window.dispatchEvent(new MessageEvent('message', { data, source: win, origin })); });
};

afterEach(() => { localStorage.clear(); clearWireframes(); vi.restoreAllMocks(); });

describe('ScreensTab', () => {
  it('shows the page in a sandboxed iframe at its own route, with the bar and the version', () => {
    const { iframe, container } = setup();
    expect(iframe).toHaveAttribute('src', '/api/job/alpha/wireframes');
    expect(wireframesUrl('a b')).toBe('/api/job/a%20b/wireframes');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
    expect(iframe).toHaveAttribute('title', 'Job alpha: screens');
    const bar = screen.getByRole('group', { name: 'Screens' });
    expect(bar).toHaveTextContent('Loading the screens…');
    expect(within(bar).getByText('v2')).toBeInTheDocument();
    expect(within(bar).getByRole('link', { name: 'Open full screen' })).toHaveAttribute('href', '#/job/alpha/screens');
    expect(within(bar).getByRole('button', { name: 'Copy feedback' })).toBeInTheDocument();
    expect(frameMounted('alpha'), 'this is the frame for the job').toBe(true);
    expect(container.querySelector('.screens-tab')).not.toHaveClass('is-full');
  });

  it('shows the section in view from the page’s report, ignoring other windows and origins', () => {
    const { win } = setup();
    fromPage(win, REPORT, 'https://elsewhere.example');
    expect(screen.getByRole('group', { name: 'Screens' })).toHaveTextContent('Loading the screens…');
    act(() => { window.dispatchEvent(new MessageEvent('message', { data: REPORT, source: window, origin: window.location.origin })); });
    expect(screen.getByRole('group', { name: 'Screens' })).toHaveTextContent('Loading the screens…');
    fromPage(win, REPORT);
    expect(screen.getByRole('group', { name: 'Screens' })).toHaveTextContent('The list');
    fromPage(win, { ...REPORT, current: 'c-entry' });
    expect(screen.getByRole('group', { name: 'Screens' })).toHaveTextContent('Where the button goes');
  });

  it('Copy feedback asks the page, copies its answer and adds it to your message while the Foreman waits', async () => {
    const { win } = setup({ jobExtra: { ...WITH_SCREENS, needsYou: true, waitingFor: 'answers' } });
    const post = vi.spyOn(win, 'postMessage');
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    writeStored(draftKey('alpha'), 'Hello Foreman');
    fireEvent.click(screen.getByRole('button', { name: 'Copy feedback' }));
    expect(post).toHaveBeenCalledWith({ type: 'wireframes-feedback' }, window.location.origin);
    fromPage(win, { type: 'wireframes-feedback', version: '2', text: 'Pick A for c-entry\ns-list: needs change: the empty state' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied, and added to your message to the Foreman.'));
    expect(write).toHaveBeenCalledWith('Pick A for c-entry\ns-list: needs change: the empty state');
    expect(readStored(draftKey('alpha'))).toBe('Hello Foreman\n\nPick A for c-entry\ns-list: needs change: the empty state');
    // Asked again with the same text: copied, not added twice.
    fireEvent.click(screen.getByRole('button', { name: 'Copy feedback' }));
    fromPage(win, { type: 'wireframes-feedback', version: '2', text: 'Pick A for c-entry\ns-list: needs change: the empty state' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied.'));
    expect(readStored(draftKey('alpha'))).toBe('Hello Foreman\n\nPick A for c-entry\ns-list: needs change: the empty state');
  });

  it('Copy feedback only copies when nothing waits for you, and says so when the browser refuses', async () => {
    const { win } = setup({ jobExtra: { ...WITH_SCREENS, needsYou: false, waitingFor: null } });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('no'); }) }, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Copy feedback' }));
    fromPage(win, { type: 'wireframes-feedback', version: '2', text: 'Pick A for c-entry' });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t copy: this browser didn’t allow it. Use the page’s own Copy feedback button.'));
    expect(readStored(draftKey('alpha'))).toBeNull();
    expect(gateWaiting({ ...job('a', 'needs-you'), needsYou: true, waitingFor: 'permission' }), 'a permission is not a gate').toBe(false);
    expect(gateWaiting({ ...job('a', 'needs-you'), needsYou: true, waitingFor: 'approval' })).toBe(true);
    expect(addFeedbackToDraft('alpha', '   ')).toBe(false);
  });

  it('Enter with nothing focused steps into the page; Esc inside it comes back to the bar', () => {
    const off = installKeyListener();
    try {
      const { iframe, win } = setup();
      const focus = vi.spyOn(iframe, 'focus');
      // On a button, Enter is the button's.
      screen.getByRole('button', { name: 'Copy feedback' }).focus();
      fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
      expect(focus).not.toHaveBeenCalled();
      (document.activeElement as HTMLElement).blur();
      fireEvent.keyDown(document.body, { key: 'Enter' });
      expect(focus).toHaveBeenCalledTimes(1);
      // The page has loaded: Esc inside its window brings focus back to the bar's first button.
      fireEvent.load(iframe);
      act(() => { win.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
      expect(screen.getByRole('button', { name: 'Copy feedback' })).toHaveFocus();
      expect(screen.getByRole('status')).toHaveTextContent('Back on the page.');
    } finally {
      off();
    }
  });

  it('a request to open a section goes to the page once it has reported', () => {
    function Opener() {
      const ui = useUi();
      return <button type="button" onClick={() => ui.openScreens('c-entry')}>go</button>;
    }
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'needs-you', WITH_SCREENS)] }) });
    const { container } = render(
      <WorkshopContext.Provider value={{ store, api: { get: vi.fn() } as unknown as ApiClient }}>
        <UiProvider><Opener /><ScreensTab slug="alpha" job={store.getState().jobs[0]} active /></UiProvider>
      </WorkshopContext.Provider>,
    );
    const win = container.querySelector('iframe')!.contentWindow!;
    const post = vi.spyOn(win, 'postMessage');
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    // Sent right away (the frame is there), and again once the page has posted, in case it wasn't ready.
    expect(post).toHaveBeenCalledWith({ type: 'wireframes-goto', key: 'c-entry' }, window.location.origin);
    post.mockClear();
    fromPage(win, REPORT);
    expect(post).toHaveBeenCalledWith({ type: 'wireframes-goto', key: 'c-entry' }, window.location.origin);
  });

  it('the full-width view has no Open full screen link', () => {
    const { container } = setup({ full: true });
    expect(screen.queryByRole('link', { name: 'Open full screen' })).toBeNull();
    expect(container.querySelector('.screens-tab')).toHaveClass('is-full');
  });
});

describe('PreviewPane with screens', () => {
  function pane(extra: Partial<Job>) {
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'needs-you', extra)] }) });
    const api = { get: vi.fn(async () => ({ docs: [] })) } as unknown as ApiClient;
    return render(<WorkshopContext.Provider value={{ store, api }}><UiProvider><PreviewPane slug="alpha" /></UiProvider></WorkshopContext.Provider>);
  }

  it('has a Screens tab only for a job with screens, between Docs and Classic view', () => {
    const { unmount } = pane({});
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Docs', 'Classic view']);
    unmount();
    clearWireframes();
    pane(WITH_SCREENS);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Docs', 'Screens', 'Classic view']);
    const tab = screen.getByRole('tab', { name: 'Screens' });
    expect(tab).toHaveAttribute('aria-selected', 'false');
    // Mounted even while hidden, so the page's report reaches the gate card.
    expect(document.querySelector('iframe.screens-frame')).not.toBeNull();
    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('preview-panel-screens')).not.toHaveAttribute('hidden');
    // ] from the Screens tab goes on to Classic view; [ back.
    fireEvent.keyDown(tab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Classic view' })).toHaveAttribute('aria-selected', 'true');
  });
});
