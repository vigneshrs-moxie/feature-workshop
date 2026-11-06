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
import { addFeedbackToDraft, addNotesToDraft, gateWaiting, NO_ORIGIN, noNewNotes, ON_LAPTOP_LINE, ScreensTab, wireframesUrl } from './ScreensTab';
import { clearWireframes, frameMounted } from './wireframes';

const WITH_SCREENS: Partial<Job> = { wireframes: { version: '2' } };
const REPORT = {
  type: 'wireframes', version: '2', current: 's-list',
  screens: [{ key: 's-list', name: 'The list', kind: 'screen', status: 'fix', choice: '' }, { key: 'c-entry', name: 'Where the button goes', kind: 'choice', status: '', choice: '' }],
};

function setup({ jobExtra = WITH_SCREENS, active = true, full = false, origin = SCREENS_ORIGIN, metaExtra = {}, post = vi.fn(), hosted = false }: { metaExtra?: Record<string, unknown>; post?: ReturnType<typeof vi.fn>; hosted?: boolean; jobExtra?: Partial<Job>; active?: boolean; full?: boolean; origin?: string | null } = {}) {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ meta: { token: 'tok-1', ...(origin ? { wireframesOrigin: origin } : {}), ...metaExtra }, jobs: [job('alpha', 'needs-you', jobExtra)] }) });
  const api = { get: vi.fn(), post, hosted: () => hosted } as unknown as ApiClient;
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

describe('ScreensTab: Publish and Pull notes', () => {
  const SET_UP = { prototypes: { site: 'https://prototypes.example.test' } };
  const WHY = 'Publishing isn’t set up on this laptop: see the prototypes plan §9 step 10.';

  it('with this laptop not set up, both buttons are off and the tab says why', () => {
    const post = vi.fn();
    setup({ metaExtra: { prototypes: null, prototypesWhy: WHY }, post });
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pull notes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Publish' })).toHaveAttribute('title', WHY);
    expect(screen.getByText(WHY)).toBeInTheDocument();
  });

  it('Publish says which revision, with the link, and keeps the link beside the version', async () => {
    const url = 'https://prototypes.example.test/f/alpha';
    const post = vi.fn(async () => ({ revision: 4, url, warnings: [] }));
    setup({ metaExtra: SET_UP, post });
    expect(screen.queryByRole('link', { name: 'Revision 4 on the site' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Published revision 4. Open on the site'));
    expect(post).toHaveBeenCalledWith('/api/jobs/alpha/prototype/publish');
    expect(screen.getByRole('link', { name: 'Open on the site' })).toHaveAttribute('href', url);
    const beside = within(screen.getByRole('group', { name: 'Screens' })).getByRole('link', { name: 'Revision 4 on the site' });
    expect(beside).toHaveAttribute('href', url);
    expect(beside).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('the job’s own record shows the link from the start, and a failed publish says why', async () => {
    const post = vi.fn(async () => { throw new Error('The site refused the token.'); });
    setup({ metaExtra: SET_UP, post, jobExtra: { ...WITH_SCREENS, prototype: { url: 'https://prototypes.example.test/f/alpha', revision: 3 } } });
    expect(screen.getByRole('link', { name: 'Revision 3 on the site' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t publish: The site refused the token.'));
  });

  it('Pull notes puts the lines in your message inside the feedback block, even with no gate waiting', async () => {
    const lines = ['Pick A for c-nav', 's-team (laptop): question: Who sees this?'];
    const post = vi.fn(async () => ({ lines, since: null, revision: 3, warnings: ['people picked differently on c-nav'] }));
    setup({ metaExtra: SET_UP, post, jobExtra: { ...WITH_SCREENS, needsYou: false, waitingFor: null } });
    writeStored(draftKey('alpha'), 'Hello Foreman');
    fireEvent.click(screen.getByRole('button', { name: 'Pull notes' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Added 2 lines to your message to the Foreman. Note: people picked differently on c-nav.'));
    expect(post).toHaveBeenCalledWith('/api/jobs/alpha/prototype/notes');
    expect(readStored(draftKey('alpha'))).toBe(`Hello Foreman\n\n--- Screens feedback (v3) ---\n${lines.join('\n')}\n--- end ---`);
  });

  it('nothing new says since when, and leaves your message alone', async () => {
    const since = '2026-11-05T22:10:04.120Z';
    const post = vi.fn(async () => ({ lines: [], since, revision: 3, warnings: [] }));
    setup({ metaExtra: SET_UP, post });
    fireEvent.click(screen.getByRole('button', { name: 'Pull notes' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(noNewNotes(since)));
    expect(noNewNotes(since)).toMatch(/^No new notes since .+\.$/);
    expect(noNewNotes(null)).toBe('No notes yet.');
    expect(readStored(draftKey('alpha'))).toBeNull();
  });

  it('a second pull adds to a block still in the draft: the site won’t send those lines again', () => {
    expect(addNotesToDraft('alpha', ['s-a (laptop): note: first'], '3')).toBe(true);
    writeStored(draftKey('alpha'), `Hello\n\n${readStored(draftKey('alpha'))}\n\nMore words.`);
    expect(addNotesToDraft('alpha', ['s-a (laptop): note: first', 's-b (laptop): note: costs $& more'], '4')).toBe(true);
    expect(readStored(draftKey('alpha'))).toBe('Hello\n\n--- Screens feedback (v4) ---\ns-a (laptop): note: first\ns-b (laptop): note: costs $& more\n--- end ---\n\nMore words.');
    expect(addNotesToDraft('alpha', ['s-a (laptop): note: first'], '4'), 'nothing new').toBe(false);
  });

  it('Copy feedback after a pull replaces the page’s lines and keeps the pulled ones', () => {
    addFeedbackToDraft('alpha', 'Pick A for c-entry', '2');
    addNotesToDraft('alpha', ['s-a (laptop): note: from the site'], '2');
    expect(addFeedbackToDraft('alpha', 'Pick B for c-entry', '2')).toBe(true);
    expect(readStored(draftKey('alpha'))).toBe('--- Screens feedback (v2) ---\nPick B for c-entry\ns-a (laptop): note: from the site\n--- end ---');
    expect(addFeedbackToDraft('alpha', 'Pick B for c-entry', '2'), 'the same again changes nothing').toBe(false);
    // Taken out of the message by hand, it stays out.
    writeStored(draftKey('alpha'), '--- Screens feedback (v2) ---\nPick B for c-entry\n--- end ---');
    addFeedbackToDraft('alpha', 'Pick A for c-entry', '2');
    expect(readStored(draftKey('alpha'))).toBe('--- Screens feedback (v2) ---\nPick A for c-entry\n--- end ---');
  });

  it('on the hosted site: no page and no buttons, the laptop line and the published link', () => {
    const url = 'https://prototypes.example.test/f/alpha';
    const { container } = setup({ origin: null, hosted: true, jobExtra: { ...WITH_SCREENS, prototype: { url, revision: 4 } } });
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('.screens-status')).toHaveTextContent(`${ON_LAPTOP_LINE} Published: revision 4 on the prototypes site`);
    expect(screen.getByRole('link', { name: 'revision 4 on the prototypes site' })).toHaveAttribute('href', url);
  });

  it('on the hosted site with nothing published: the laptop line alone', () => {
    const { container } = setup({ origin: null, hosted: true });
    expect(container.querySelector('.screens-status')).toHaveTextContent(new RegExp(`^${ON_LAPTOP_LINE}$`));
  });
});

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
