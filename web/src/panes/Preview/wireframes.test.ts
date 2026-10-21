// The wireframes page's messages (the skill's postMessage contract), checked as data, and the one
// frame the dashboard talks to. Invented pages only; no iframe here (ScreensTab.test has it).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearWireframes, frameMounted, gotoScreen, isEscapeMessage, mountFrame, parseFeedbackMessage, parseWireframesMessage, receive, requestFeedback, reviewable,
  screensFromJson, screenWord, takeScreensRequest, wireframesReport,
} from './wireframes';
import { SCREENS_ORIGIN } from '../../state/test-fixtures';

const REPORT = {
  type: 'wireframes', version: '2', current: 'c-entry',
  screens: [
    { key: 'overview', name: 'What this adds', kind: 'overview', status: '', choice: '' },
    { key: 's-list', name: 'The list', kind: 'screen', status: 'fix', choice: '' },
    { key: 'c-entry', name: 'Where the button goes', kind: 'choice', status: '', choice: 'A' },
    { key: 'questions', name: 'Questions to settle', kind: 'questions', status: '', choice: '' },
  ],
};

afterEach(() => { clearWireframes(); });

describe('the escape message and the open-at-a-section request', () => {
  it('knows the page’s Esc message and nothing else', () => {
    expect(isEscapeMessage({ type: 'wireframes-escape' })).toBe(true);
    expect(isEscapeMessage({ type: 'wireframes' })).toBe(false);
    expect(isEscapeMessage('wireframes-escape')).toBe(false);
    expect(isEscapeMessage(null)).toBe(false);
  });

  it('a request is taken once, by the first tab that asks, however late; never request 0', () => {
    expect(takeScreensRequest(0)).toBe(false);
    expect(takeScreensRequest(1), 'a tab mounted after the request still finds it').toBe(true);
    expect(takeScreensRequest(1), 'the next tab does not replay it').toBe(false);
    expect(takeScreensRequest(2)).toBe(true);
    clearWireframes();
    expect(takeScreensRequest(2), 'tests start clean').toBe(true);
  });
});

describe('the page’s messages', () => {
  it('reads a wireframes report and keeps only what the contract names', () => {
    const r = parseWireframesMessage(REPORT)!;
    expect(r.version).toBe('2');
    expect(r.current).toBe('c-entry');
    expect(r.screens.map((s) => [s.key, s.kind, s.status, s.choice])).toEqual([
      ['overview', 'overview', '', ''], ['s-list', 'screen', 'fix', ''], ['c-entry', 'choice', '', 'A'], ['questions', 'questions', '', ''],
    ]);
    // Odd values are tamed, not kept: an unknown kind is a screen, an unknown status is none, a numeric version is a string.
    const odd = parseWireframesMessage({ type: 'wireframes', version: 3, current: 7, screens: [{ key: 'x', kind: 'weird', status: 'meh', choice: 'ab' }, { name: 'no key' }, 'junk'] })!;
    expect(odd.version).toBe('3');
    expect(odd.current).toBeNull();
    expect(odd.screens).toEqual([{ key: 'x', name: 'x', kind: 'screen', status: '', choice: '' }]);
    // Anything else is not a report.
    for (const m of [null, 'wireframes', { type: 'other' }, { type: 'wireframes-feedback', text: 'x' }]) expect(parseWireframesMessage(m)).toBeNull();
  });

  it('reads a feedback answer', () => {
    expect(parseFeedbackMessage({ type: 'wireframes-feedback', version: '2', text: 'Pick A for c-entry' })).toEqual({ version: '2', text: 'Pick A for c-entry' });
    expect(parseFeedbackMessage({ type: 'wireframes-feedback' })).toEqual({ version: null, text: '' });
    expect(parseFeedbackMessage({ type: 'wireframes' })).toBeNull();
  });

  it('says what the reader marked in a word, and which sections a reviewer goes to', () => {
    const r = parseWireframesMessage(REPORT)!;
    expect(r.screens.map(screenWord)).toEqual(['', 'Needs change', 'Pick A', '']);
    expect(screenWord({ kind: 'screen', status: 'good', choice: '' })).toBe('Good');
    expect(screenWord({ kind: 'screen', status: 'ask', choice: '' })).toBe('Question');
    expect(reviewable(r.screens).map((s) => s.key)).toEqual(['s-list', 'c-entry']);
  });

  it('builds the same list from wireframes.json, with nothing marked yet', () => {
    const json = JSON.stringify({ version: 1, screens: [{ key: 's-list', name: 'The list', states: ['empty'] }], choices: [{ key: 'c-entry', question: 'Where the button goes', options: [] }], questions: [{ kind: 'decide', text: 'x' }] });
    expect(screensFromJson(json)).toEqual([
      { key: 's-list', name: 'The list', kind: 'screen', status: '', choice: '' },
      { key: 'c-entry', name: 'Where the button goes', kind: 'choice', status: '', choice: '' },
    ]);
    expect(screensFromJson('{ not json')).toEqual([]);
    expect(screensFromJson('[]')).toEqual([]);
  });
});

describe('the frame', () => {
  function fakeWindow() {
    return { postMessage: vi.fn() } as unknown as Window;
  }

  it('keeps the latest report per job and tells the gate card', () => {
    expect(receive('alpha', REPORT)).toBe(true);
    expect(wireframesReport('alpha')!.current).toBe('c-entry');
    expect(wireframesReport('beta')).toBeNull();
    expect(receive('alpha', { type: 'nothing' })).toBe(false);
    clearWireframes('alpha');
    expect(wireframesReport('alpha')).toBeNull();
  });

  it('sends goto and feedback requests to the mounted frame only, to the page’s own origin', async () => {
    const win = fakeWindow();
    const focus = vi.fn();
    expect(gotoScreen('alpha', 's-list'), 'no frame yet').toBe(false);
    // A frame with no origin known posts nothing: never to '*'.
    const blind = mountFrame('alpha', () => win, focus);
    expect(gotoScreen('alpha', 's-list')).toBe(false);
    expect(win.postMessage).not.toHaveBeenCalled();
    blind();
    const unmount = mountFrame('alpha', () => win, focus, SCREENS_ORIGIN);
    expect(frameMounted('alpha')).toBe(true);
    expect(frameMounted('beta')).toBe(false);
    expect(gotoScreen('alpha', 's-list')).toBe(true);
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'wireframes-goto', key: 's-list' }, SCREENS_ORIGIN);
    expect(gotoScreen('beta', 's-list'), 'another job’s page isn’t shown here').toBe(false);
    // Feedback: the request goes out; the page's answer settles it.
    const p = requestFeedback('alpha');
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'wireframes-feedback' }, SCREENS_ORIGIN);
    expect(receive('alpha', { type: 'wireframes-feedback', version: '2', text: 'Pick A for c-entry' })).toBe(true);
    await expect(p).resolves.toEqual({ version: '2', text: 'Pick A for c-entry' });
    unmount();
    expect(frameMounted('alpha')).toBe(false);
    await expect(requestFeedback('alpha')).rejects.toThrow(/Open the Screens tab first/);
  });

  it('gives up on a page that doesn’t answer', async () => {
    vi.useFakeTimers();
    try {
      const unmount = mountFrame('alpha', fakeWindow, () => {}, SCREENS_ORIGIN);
      const p = requestFeedback('alpha', 50);
      const outcome = p.then(() => 'answered', (e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(60);
      expect(await outcome).toMatch(/didn’t answer/);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
