// The Screens tab: the page in a sandboxed iframe from the screens server's own origin
// (meta.wireframesOrigin), the bar above it, Copy feedback through postMessage (copied, and added to
// your message between marker lines while a gate waits), the Enter key and the page's Esc message,
// a request to open a section (also one made before the tab mounted), and the tab's place in the
// Preview pane (only for a job with screens). Messages from any other origin are ignored. The
// iframe never loads here (jsdom fetches nothing); its window is stubbed. Invented jobs only.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { Job } from '../../api/types';
import { installKeyListener } from '../../app/keyRegistry';
import { UiProvider, useUi } from '../../app/ui';
import { readStored, writeStored } from '../../lib/stored';
import { createStore, WorkshopContext } from '../../state/store';
import { job, SCREENS_ORIGIN, snapshot } from '../../state/test-fixtures';
import { draftKey } from '../Foreman/Composer';
import { PreviewPane } from './PreviewPane';
import { addFeedbackToDraft, gateWaiting, NO_ORIGIN, ScreensTab, wireframesUrl } from './ScreensTab';
import { clearWireframes, frameMounted } from './wireframes';

const WITH_SCREENS: Partial<Job> = { wireframes: { version: '2' } };
const REPORT = {
  type: 'wireframes', version: '2', current: 's-list',
  screens: [{ key: 's-list', name: 'The list', kind: 'screen', status: 'fix', choice: '' }, { key: 'c-entry', name: 'Where the button goes', kind: 'choice', status: '', choice: '' }],
};

function setup({ jobExtra = WITH_SCREENS, active = true, full = false, origin = SCREENS_ORIGIN }: { jobExtra?: Partial<Job>; active?: boolean; full?: boolean; origin?: string | null } = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 'tok-1', ...(origin ? { wireframesOrigin: origin } : {}) }, jobs: [job('alpha', 'needs-you', jobExtra)] }) });
  const api = { get: vi.fn() } as unknown as ApiClient;
  const utils = render(
    <WorkshopContext.Provider value={{ store, api }}>
      <UiProvider><ScreensTab slug="alpha" job={store.getState().jobs[0]} active={active} full={full} /></UiProvider>
    </WorkshopContext.Provider>,
  );
  const iframe = utils.container.querySelector('iframe');
  return { ...utils, iframe: iframe!, win: iframe?.contentWindow as Window };
}

/** A message from the page: from the iframe's own window, from the screens server's origin (anything else is ignored). */
const fromPage = (win: Window, data: unknown, origin = SCREENS_ORIGIN) => {
  act(() => { window.dispatchEvent(new MessageEvent('message', { data, source: win, origin })); });
};

// Unmount first: a tab still mounted when the module is cleared would take the cleared request again.
afterEach(() => { cleanup(); localStorage.clear(); clearWireframes(); vi.restoreAllMocks(); });

describe('ScreensTab', () => {
  it('shows the page in a sandboxed iframe from the screens server’s own origin, with the bar and the version', () => {
    const { iframe, container } = setup();
    expect(iframe).toHaveAttribute('src', 'http://127.0.0.1:4478/job/alpha/wireframes');
    expect(wireframesUrl('http://127.0.0.1:4478/', 'a b')).toBe('http://127.0.0.1:4478/job/a%20b/wireframes');
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

  it('says so, with no iframe, when the dashboard named no screens origin', () => {
    const { container } = setup({ origin: null });
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(NO_ORIGIN);
    expect(frameMounted('alpha')).toBe(true);
  });

  it('shows the section in view from the page’s report, ignoring other windows and origins (the dashboard’s own included)', () => {
    const { win } = setup();
    fromPage(win, REPORT, 'https://elsewhere.example');
    expect(screen.getByRole('group', { name: 'Screens' })).toHaveTextContent('Loading the screens…');
    fromPage(win, REPORT, window.location.origin);
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
    expect(post).toHaveBeenCalledWith({ type: 'wireframes-feedback' }, SCREENS_ORIGIN);
    fromPage(win, { type: 'wireframes-feedback', version: '2', text: 'Pick A for c-entry\ns-list: needs change: the empty state' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied, and added to your message to the Foreman.'));
    expect(write).toHaveBeenCalledWith('Pick A for c-entry\ns-list: needs change: the empty state');
    const block = (text: string, v = '2') => `--- Screens feedback (v${v}) ---\n${text}\n--- end ---`;
    expect(readStored(draftKey('alpha'))).toBe(`Hello Foreman\n\n${block('Pick A for c-entry\ns-list: needs change: the empty state')}`);
    // Asked again with the same text: copied, not added twice.
    fireEvent.click(screen.getByRole('button', { name: 'Copy feedback' }));
    fromPage(win, { type: 'wireframes-feedback', version: '2', text: 'Pick A for c-entry\ns-list: needs change: the empty state' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied.'));
    expect(readStored(draftKey('alpha'))).toBe(`Hello Foreman\n\n${block('Pick A for c-entry\ns-list: needs change: the empty state')}`);
    // A changed verdict replaces the block (between its marker lines), never a second one.
    writeStored(draftKey('alpha'), `${readStored(draftKey('alpha'))}\n\nAnd one more thing.`);
    fireEvent.click(screen.getByRole('button', { name: 'Copy feedback' }));
    fromPage(win, { type: 'wireframes-feedback', version: '2', text: 'Pick B for c-entry\ns-list: good' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied, and added to your message to the Foreman.'));
    expect(readStored(draftKey('alpha'))).toBe(`Hello Foreman\n\n${block('Pick B for c-entry\ns-list: good')}\n\nAnd one more thing.`);
    // A new version's feedback replaces the old version's block too.
    expect(addFeedbackToDraft('alpha', 'Pick B for c-entry', '3')).toBe(true);
    expect(readStored(draftKey('alpha'))).toBe(`Hello Foreman\n\n${block('Pick B for c-entry', '3')}\n\nAnd one more thing.`);
    // No version: the marker says so plainly.
    expect(addFeedbackToDraft('beta', 'Pick A for c-entry')).toBe(true);
    expect(readStored(draftKey('beta'))).toBe('--- Screens feedback ---\nPick A for c-entry\n--- end ---');
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

  it('Enter with nothing focused steps into the page; the page’s Esc message comes back to the bar', () => {
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
      // Esc inside the page: the page posts it (its keys can't be heard across origins). From
      // anywhere but the page's origin it is ignored.
      fromPage(win, { type: 'wireframes-escape' }, window.location.origin);
      expect(screen.getByRole('button', { name: 'Copy feedback' })).not.toHaveFocus();
      expect(screen.queryByRole('status')).toBeNull();
      fromPage(win, { type: 'wireframes-escape' });
      expect(screen.getByRole('button', { name: 'Copy feedback' })).toHaveFocus();
      expect(screen.getByRole('status')).toHaveTextContent('Back on the page.');
    } finally {
      off();
    }
  });

  it('a request to open a section goes to the page once it has reported', () => {
    function Opener() {
      const ui = useUi();
      return <button type="button" onClick={() => ui.openScreens('alpha', 'c-entry')}>go</button>;
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
    expect(post).toHaveBeenCalledWith({ type: 'wireframes-goto', key: 'c-entry' }, SCREENS_ORIGIN);
    post.mockClear();
    fromPage(win, REPORT);
    expect(post).toHaveBeenCalledWith({ type: 'wireframes-goto', key: 'c-entry' }, SCREENS_ORIGIN);
  });

  it('a request made before the tab mounted (the Desk’s screen chips open the full view) is sent by the tab that mounts next, once', () => {
    function Desk() {
      const ui = useUi();
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => { ui.openScreens('alpha', 'c-entry'); setOpen(true); }}>chip</button>
          {open && <ScreensTab slug="alpha" job={null} active full />}
        </>
      );
    }
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'needs-you', WITH_SCREENS)] }) });
    const { container, unmount } = render(
      <WorkshopContext.Provider value={{ store, api: { get: vi.fn() } as unknown as ApiClient }}>
        <UiProvider><Desk /></UiProvider>
      </WorkshopContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'chip' }));
    const win = container.querySelector('iframe')!.contentWindow!;
    const post = vi.spyOn(win, 'postMessage');
    // The page reports: the request made before the tab existed goes to it now.
    fromPage(win, REPORT);
    expect(post).toHaveBeenCalledWith({ type: 'wireframes-goto', key: 'c-entry' }, SCREENS_ORIGIN);
    expect(post).toHaveBeenCalledTimes(1);
    unmount();
    // A tab mounted later again (back on the job) doesn't replay that request.
    const { container: again } = render(
      <WorkshopContext.Provider value={{ store, api: { get: vi.fn() } as unknown as ApiClient }}>
        <UiProvider><ScreensTab slug="alpha" job={null} active /></UiProvider>
      </WorkshopContext.Provider>,
    );
    const win2 = again.querySelector('iframe')!.contentWindow!;
    const post2 = vi.spyOn(win2, 'postMessage');
    fromPage(win2, REPORT);
    expect(post2).not.toHaveBeenCalled();
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
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Plan', 'Briefs', 'Review', 'Try it', 'Decisions']);
    unmount();
    clearWireframes();
    pane(WITH_SCREENS);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Plan', 'Briefs', 'Review', 'Screens', 'Try it', 'Decisions']);
    const tab = screen.getByRole('tab', { name: 'Screens' });
    expect(tab).toHaveAttribute('aria-selected', 'false');
    // Mounted even while hidden, so the page's report reaches the gate card.
    expect(document.querySelector('iframe.screens-frame')).not.toBeNull();
    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('preview-panel-screens')).not.toHaveAttribute('hidden');
    // ] from the Screens tab goes on to Try it; [ back.
    fireEvent.keyDown(tab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Try it' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the feedback block’s markers are whole lines', () => {
  afterEach(() => { cleanup(); clearWireframes(); try { localStorage.clear(); } catch { /* fine */ } });
  const block = (text: string, v = '2') => `--- Screens feedback (v${v}) ---\n${text}\n--- end ---`;

  it('a note that mentions the end marker mid-line keeps the whole note, and a later copy replaces the whole block', () => {
    const note = 'Pick A for c-entry\n--- end --- is what the page says; ignore it\ns-list: needs change';
    expect(addFeedbackToDraft('alpha', note)).toBe(true);
    expect(readStored(draftKey('alpha'))).toBe(`--- Screens feedback ---\n${note}\n--- end ---`);
    expect(addFeedbackToDraft('alpha', 'Pick B for c-entry', '3')).toBe(true);
    expect(readStored(draftKey('alpha')), 'the old block, with its end marker look-alike, is gone whole').toBe(block('Pick B for c-entry', '3'));
  });

  it('a line of your own that quotes the start marker is not the block', () => {
    const mine = 'Everything after --- Screens feedback (v2) --- below is from the page:';
    writeStored(draftKey('alpha'), `${mine}\n\n${block('Pick A for c-entry')}`);
    expect(addFeedbackToDraft('alpha', 'Pick B for c-entry', '2')).toBe(true);
    expect(readStored(draftKey('alpha'))).toBe(`${mine}\n\n${block('Pick B for c-entry')}`);
  });
});

describe('a request to open the screens names its job', () => {
  afterEach(() => { cleanup(); clearWireframes(); });

  it('a tab showing another job leaves the request for that job’s tab, which takes it when it mounts', () => {
    function Desk() {
      const ui = useUi();
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => { ui.openScreens('alpha', 'c-entry'); setOpen(true); }}>chip</button>
          <ScreensTab slug="beta" job={null} active />
          {open && <ScreensTab slug="alpha" job={null} active full />}
        </>
      );
    }
    const store = createStore();
    store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'needs-you', WITH_SCREENS), job('beta', 'idle', WITH_SCREENS)] }) });
    const { container } = render(
      <WorkshopContext.Provider value={{ store, api: { get: vi.fn() } as unknown as ApiClient }}>
        <UiProvider><Desk /></UiProvider>
      </WorkshopContext.Provider>,
    );
    const betaWin = container.querySelector('iframe')!.contentWindow!;
    const betaPost = vi.spyOn(betaWin, 'postMessage');
    fireEvent.click(screen.getByRole('button', { name: 'chip' }));
    const frames = container.querySelectorAll('iframe');
    expect(frames).toHaveLength(2);
    const alphaWin = frames[1].contentWindow!;
    const alphaPost = vi.spyOn(alphaWin, 'postMessage');
    expect(betaPost).not.toHaveBeenCalledWith({ type: 'wireframes-goto', key: 'c-entry' }, SCREENS_ORIGIN);
    // The mounted frame is the newest one (wireframes.ts keeps one); alpha's page reports, and the request goes to it.
    fromPage(alphaWin, REPORT);
    expect(alphaPost).toHaveBeenCalledWith({ type: 'wireframes-goto', key: 'c-entry' }, SCREENS_ORIGIN);
    expect(betaPost).not.toHaveBeenCalledWith({ type: 'wireframes-goto', key: 'c-entry' }, SCREENS_ORIGIN);
  });
});
