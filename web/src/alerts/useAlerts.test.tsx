import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { createStore, useWorkshopState, WorkshopContext, type Store } from '../state/store';
import { ev, job, permission, snapshot } from '../state/test-fixtures';
import { AlertSettings } from './AlertSettings';
import { alertOutputs, CHIME_KEY, NOTIFY_KEY, type Alert } from './alerts';
import { titleFor, useAlerts } from './useAlerts';

// A stand-in for the browser's Notification API.
class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async () => FakeNotification.answer);
  static answer: NotificationPermission = 'granted';
  constructor(public title: string, public options: NotificationOptions) {}
  onclick: (() => void) | null = null;
  close() {}
}

function Harness() {
  useAlerts(useWorkshopState());
  return <button type="button">Somewhere on the page</button>;
}

function renderWith(store: Store, ui = <Harness />) {
  return render(<WorkshopContext.Provider value={{ store, api: {} as ApiClient }}>{ui}</WorkshopContext.Provider>);
}

const ready = (jobs = [job('alpha', 'idle'), job('beta', 'running')]) => {
  const store = createStore();
  store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs }) });
  return store;
};

let chime: ReturnType<typeof vi.fn<() => void>>;
let notify: ReturnType<typeof vi.fn<(a: Alert) => void>>;
let hasFocus: ReturnType<typeof vi.spyOn>;
const original = { ...alertOutputs };

beforeEach(() => {
  FakeNotification.permission = 'default';
  FakeNotification.answer = 'granted';
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal('Notification', FakeNotification);
  chime = vi.fn<() => void>();
  notify = vi.fn<(a: Alert) => void>();
  alertOutputs.chime = chime;
  alertOutputs.notify = notify;
  hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  hasFocus.mockRestore();
  Object.assign(alertOutputs, original);
  localStorage.clear();
  document.title = '';
});

describe('tab title', () => {
  it('carries the Needs-you count', () => {
    expect(titleFor(0)).toBe('Dashboard');
    expect(titleFor(2)).toBe('(2) Dashboard');
    expect(titleFor(2, 'Jobs · Dashboard')).toBe('(2) Jobs · Dashboard');
    const store = ready([job('alpha', 'needs-you'), job('beta', 'needs-you'), job('gamma', 'idle')]);
    renderWith(store);
    expect(document.title).toBe('(2) Dashboard');
    act(() => store.dispatch({ type: 'snapshot', snapshot: snapshot({ jobs: [job('alpha', 'idle')] }) }));
    expect(document.title).toBe('Dashboard');
  });
});

describe('asking for notification permission', () => {
  it('asks on the first click and remembers the answer', async () => {
    renderWith(ready());
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Somewhere on the page' })); });
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(NOTIFY_KEY)).toBe('on');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Somewhere on the page' })); });
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('remembers a no, and never asks again on a later visit', async () => {
    FakeNotification.answer = 'denied';
    const { unmount } = renderWith(ready());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Somewhere on the page' })); });
    expect(localStorage.getItem(NOTIFY_KEY)).toBe('off');
    unmount();
    renderWith(ready());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Somewhere on the page' })); });
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('takes an answer already given to the browser without asking', async () => {
    FakeNotification.permission = 'granted';
    renderWith(ready());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Somewhere on the page' })); });
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(localStorage.getItem(NOTIFY_KEY)).toBe('on');
  });
});

describe('alerting', () => {
  const permissionEvent = (seq: number, id: string, slug: string) => ({ type: 'event' as const, event: ev(seq, 'permission', slug, permission(id, slug)) });

  it('stays quiet about what was already waiting when the page loaded', () => {
    localStorage.setItem(NOTIFY_KEY, 'on');
    localStorage.setItem(CHIME_KEY, 'on');
    FakeNotification.permission = 'granted';
    renderWith(ready([job('alpha', 'needs-you')]));
    expect(chime).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('chimes and notifies when a permission card arrives, if both are on', () => {
    localStorage.setItem(NOTIFY_KEY, 'on');
    localStorage.setItem(CHIME_KEY, 'on');
    const store = ready();
    renderWith(store);
    act(() => store.dispatch(permissionEvent(11, 'p1', 'alpha')));
    expect(chime).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ slug: 'alpha', title: 'Permission needed: Job alpha', body: 'Run a command. Open the job to allow or deny it.' });
    // The snapshot that follows says the same thing: no second alert.
    act(() => store.dispatch({ type: 'snapshot', snapshot: snapshot({ seq: 12, jobs: [job('alpha', 'needs-you', { permissions: 1 })], permissions: [permission('p1', 'alpha')] }) }));
    expect(chime).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('alerts when a job newly enters Needs you', () => {
    localStorage.setItem(NOTIFY_KEY, 'on');
    const store = ready();
    renderWith(store);
    act(() => store.dispatch({ type: 'snapshot', snapshot: snapshot({ seq: 12, jobs: [job('alpha', 'idle'), job('beta', 'needs-you', { waitingFor: 'answers' })] }) }));
    expect(notify).toHaveBeenCalledWith({ slug: 'beta', title: 'Needs you: Job beta', body: 'The Foreman asked you something.' });
    expect(chime).not.toHaveBeenCalled(); // the chime is off unless you turn it on
  });

  it('only chimes while you are looking at the page', () => {
    localStorage.setItem(NOTIFY_KEY, 'on');
    localStorage.setItem(CHIME_KEY, 'on');
    hasFocus.mockReturnValue(true);
    const store = ready();
    renderWith(store);
    act(() => store.dispatch(permissionEvent(11, 'p1', 'alpha')));
    expect(chime).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does neither when both are off', () => {
    localStorage.setItem(NOTIFY_KEY, 'off');
    const store = ready();
    renderWith(store);
    act(() => store.dispatch(permissionEvent(11, 'p1', 'alpha')));
    expect(chime).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('Alerts switches', () => {
  it('turns notifications on after the browser says yes, without the page asking twice', async () => {
    renderWith(ready(), <><Harness /><AlertSettings /></>);
    const btn = screen.getByRole('button', { name: /Notifications/ });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await act(async () => { fireEvent.click(btn); });
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(NOTIFY_KEY)).toBe('on');
    // The fake browser now remembers the yes too.
    FakeNotification.permission = 'granted';
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Chime/ })); });
    expect(screen.getByRole('button', { name: /Notifications/ })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Notifications/ })); });
    expect(localStorage.getItem(NOTIFY_KEY)).toBe('off');
  });

  it('explains when the browser blocks notifications', async () => {
    FakeNotification.permission = 'denied';
    renderWith(ready(), <AlertSettings />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Notifications/ })); });
    // Two quiet lines live here (packet R): the note, and the Saved one beside the buttons, which stays empty: nothing changed.
    const said = screen.getAllByRole('status').map((s) => s.textContent);
    expect(said).toContainEqual(expect.stringContaining('Your browser blocks notifications'));
    expect(said).not.toContain('Saved');
    expect(localStorage.getItem(NOTIFY_KEY)).toBe('off');
  });

  it('plays the chime once when you turn it on, and remembers it', () => {
    renderWith(ready(), <AlertSettings />);
    fireEvent.click(screen.getByRole('button', { name: /Chime/ }));
    expect(chime).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CHIME_KEY)).toBe('on');
    expect(screen.getByRole('button', { name: /Chime/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Chime/ }));
    expect(localStorage.getItem(CHIME_KEY)).toBe('off');
  });

  it('is disabled, with the reason, where the browser has no notifications', () => {
    vi.stubGlobal('Notification', undefined);
    renderWith(ready(), <AlertSettings />);
    const btn = screen.getByRole('button', { name: /Notifications/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'This browser can’t show notifications.');
  });
});
