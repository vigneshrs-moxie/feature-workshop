// Pins (Task 17, R4): a click on a recording's frame drops a numbered pin with a note box; its note
// names the picture (the check, the time, the file) so the Foreman can open it; pasting a picture into
// the message box opens it in the reader to pin on.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import type { EvidenceView } from '../../api/types';
import { createStore, WorkshopContext } from '../../state/store';
import { box, chipText, openNotes, reader, settle } from '../fixtures/notesPage';
import { longJob } from '../fixtures/longJob';
import { createJobStore, type JobStore } from '../jobStore';
import { forgetRecentPages } from '../recent';
import { ChecksView } from '../reader/ChecksView';
import type { JobBody, JobPagePayload } from '../types';
import { JobStoreContext } from '../useJob';
import { composeFor } from './chips';
import { clock } from './Pins';

const SLUG = longJob.payload.slug;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const VIDEO = 'evidence/abc1234/AC-1/video.webm';
const SHOT = 'evidence/abc1234/AC-2/1.png';
const EVIDENCE: EvidenceView = {
  evidence: {
    version: 1, commit: 'abc1234', at: '2026-11-04T10:00:00.000Z', level: 3,
    criteria: [
      { id: 'AC-1', title: 'The week downloads as a file', status: 'passed', reason: null, spec: null, screenshots: [], video: VIDEO },
      { id: 'AC-2', title: 'A night shift sits on its start day', status: 'failed', reason: 'The row did not show in time.', spec: null, screenshots: [{ file: SHOT, description: 'The week with no night row' }], video: null },
    ],
  },
  commit: 'abc1234', wanted: true, why: '', recording: false, problem: null, folder: '/demo/evidence', folderUrl: 'file:///demo/evidence/', progress: null, watch: false,
} as unknown as EvidenceView;

function openRecording(): JobStore {
  const p = clone(longJob.payload) as unknown as JobPagePayload;
  const store = createJobStore(SLUG, { api: { page: async () => ({ same: true as const, v: p.v }), item: async () => ({ ...(longJob.bodies.checks as unknown as JobBody), version: 'c0' }) }, events: () => () => {}, viewer: () => null, initial: p });
  const get = vi.fn(async (url: string) => {
    if (url.endsWith('/commits')) return { commits: [] };
    if (url.endsWith('/evidence')) return EVIDENCE;
    throw new Error(`Not asked for: ${url}`);
  });
  const api = { get, post: vi.fn(), hosted: () => false } as unknown as ApiClient;
  render(
    <WorkshopContext.Provider value={{ api, store: createStore() }}>
      <JobStoreContext.Provider value={store}><ChecksView id="recording" onOpen={vi.fn()} events={() => () => {}} /></JobStoreContext.Provider>
    </WorkshopContext.Provider>,
  );
  return store;
}

const hit = () => document.querySelector<HTMLElement>('.jp2-pins-hit')!;
const pinBox = () => document.querySelector<HTMLElement>('.jp2-pins-box .jp2-nb')!;

beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear(); forgetRecentPages();
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

describe('pins on the recording', () => {
  it('a click on a frame drops pin 1 with a note box; its note names the picture so the Foreman can find it', async () => {
    const store = openRecording();
    await settle();
    // The failed check shows first: its picture.
    expect(document.querySelector('.jp2-pins img')).not.toBeNull();
    act(() => { fireEvent.click(hit()); });
    expect(document.querySelector('.jp2-pin.is-new')).toHaveTextContent('1');
    expect(pinBox()).toHaveTextContent(`Picture of AC-2 (${SHOT}) · pin 1 at 50% across, 50% down`);
    fireEvent.change(within(pinBox()).getByRole('textbox'), { target: { value: 'the night row is missing here' } });
    act(() => { fireEvent.click(within(pinBox()).getByRole('button', { name: 'Add the note' })); });
    const notes = store.getState().ui.notes;
    expect(notes).toMatchObject([{ kind: 'pin', chip: 'Picture AC-2', target: { kind: 'checks', id: 'recording' }, pin: { n: 1, x: 50, y: 50, picture: `shot:AC-2:${SHOT}` } }]);
    expect(composeFor(notes, '')).toBe([
      '--- Notes (1) ---',
      `1. [pin] Picture of AC-2 (${SHOT}) · pin 1 at 50% across, 50% down`,
      '   Note: the night row is missing here',
      '--- End of notes ---',
    ].join('\n'));
    // The pin stays on the frame, numbered; the next one is 2.
    expect(screen.getByRole('img', { name: 'Pin 1: the night row is missing here' })).toBeInTheDocument();
    act(() => { fireEvent.click(hit()); });
    expect(document.querySelector('.jp2-pin.is-new')).toHaveTextContent('2');
  });

  it('on a video the pin names the check, the time it shows and the file; the video’s controls are left out of the click area', async () => {
    const store = openRecording();
    await settle();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /AC-1/ })); });
    const video = document.querySelector<HTMLVideoElement>('.jp2-pins video')!;
    Object.defineProperty(video, 'currentTime', { value: 14.6, configurable: true });
    act(() => { fireEvent.click(hit()); });
    expect(pinBox()).toHaveTextContent(`Recording AC-1 at 0:14 (${VIDEO}) · pin 1 at 50% across, 50% down`);
    fireEvent.change(within(pinBox()).getByRole('textbox'), { target: { value: 'the Apply button sits on top of the table' } });
    act(() => { fireEvent.click(within(pinBox()).getByRole('button', { name: 'Add the note' })); });
    expect(store.getState().ui.notes[0]).toMatchObject({ chip: 'Recording AC-1 0:14', place: `Recording AC-1 at 0:14 (${VIDEO})` });
    expect(clock(74.9)).toBe('1:14');
  });
});

describe('a pasted picture', () => {
  const NAME = `${'c'.repeat(64)}.png`;
  /** The laptop's client: a picture is saved in the job's folder, any other post answers as a send. */
  const laptopPost = () => vi.fn(async (path: string, _body?: unknown) => (path.endsWith('/pictures') ? { path: `pictures/${NAME}`, size: 4 } : { run: { id: 'r1' } }));
  const paste = async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.paste(box(), { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } });
      await new Promise((r) => setTimeout(r, 20));
    });
    await settle();
  };

  it('on the laptop it is saved in the job’s folder, opens in the reader from there, and its pin names that file; nothing is kept in this browser', async () => {
    const post = laptopPost();
    const o = openNotes({ read: null, post, patch: (p) => { p.move = null; } });
    await settle();
    await paste();
    const call = post.mock.calls.find((c) => String(c[0]).endsWith('/pictures'))!;
    expect(call[0]).toBe(`/api/job/${SLUG}/pictures`);
    expect((call[1] as { data: string }).data).toBe('iVBORw==');
    expect(reader().querySelector('.jp2-rv-top h2')).toHaveTextContent('Pasted picture');
    expect(reader().querySelector<HTMLImageElement>('.jp2-pins img')!.getAttribute('src')).toBe(`/api/job/${SLUG}/pictures/${NAME}`);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('sb.pasted.'))).toEqual([]);
    act(() => { fireEvent.click(hit()); });
    fireEvent.change(within(pinBox()).getByRole('textbox'), { target: { value: 'this button is cut off' } });
    act(() => { fireEvent.click(within(pinBox()).getByRole('button', { name: 'Add the note' })); });
    expect(chipText()).toEqual(['Pasted picture · pin 1']);
    expect(composeFor(o.store.getState().ui.notes, '')).toContain(`1. [pin] Pasted picture (pictures/${NAME} in the job’s folder) · pin 1 at 50% across, 50% down`);
  });

  it('a refused save says why in the message box and opens nothing', async () => {
    const { ApiError } = await import('../../api/client');
    const post = vi.fn(async () => { throw new ApiError(415, 'Only a PNG, JPEG, WebP or GIF picture can be saved.', {}); });
    openNotes({ read: null, post, patch: (p) => { p.move = null; } });
    await settle();
    await paste();
    expect(document.querySelector('.jp2-mbw')).toHaveTextContent('Couldn’t keep that picture: Only a PNG, JPEG, WebP or GIF picture can be saved.');
    expect(reader().querySelector('.jp2-pins img')).toBeNull();
  });

  it('on the website it stays in this tab, and its pin says the Foreman can’t open it', async () => {
    const o = openNotes({ read: null, patch: (p) => { p.move = null; p.hosted = true; } });
    await settle();
    await paste();
    expect(o.post).not.toHaveBeenCalled();
    expect(reader().querySelector<HTMLImageElement>('.jp2-pins img')!.src).toMatch(/^data:image\/png/);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('sb.pasted.'))).toEqual([]);
    act(() => { fireEvent.click(hit()); });
    fireEvent.change(within(pinBox()).getByRole('textbox'), { target: { value: 'cut off' } });
    act(() => { fireEvent.click(within(pinBox()).getByRole('button', { name: 'Add the note' })); });
    expect(composeFor(o.store.getState().ui.notes, '')).toContain('1. [pin] Pasted picture 1 (it stays in his browser: you can’t open it) · pin 1 at 50% across, 50% down');
  });

  it('a picture an earlier build kept in this browser goes to the job’s folder, its notes now name the file, and the browser’s copy goes', async () => {
    localStorage.setItem(`sb.pasted.${SLUG}.p1`, 'data:image/png;base64,iVBORw==');
    localStorage.setItem(`sb.notes.${SLUG}`, JSON.stringify({ explains: [], notes: [{ n: 1, kind: 'pin', target: { kind: 'picture', id: 'p1' }, place: 'Pasted picture 1 (it stays in his browser: you can’t open it)', chip: 'Pasted picture 1', quote: null, note: 'cut off', pin: { n: 1, x: 10, y: 20, picture: 'pasted:p1' } }] }));
    const post = laptopPost();
    const o = openNotes({ read: null, post, patch: (p) => { p.move = null; } });
    await settle();
    await settle();
    expect(post).toHaveBeenCalledWith(`/api/job/${SLUG}/pictures`, { data: 'iVBORw==' });
    expect(localStorage.getItem(`sb.pasted.${SLUG}.p1`)).toBeNull();
    expect(o.store.getState().ui.notes[0]).toMatchObject({ target: { kind: 'picture', id: NAME }, place: `Pasted picture (pictures/${NAME} in the job’s folder)`, pin: { picture: `pasted:${NAME}` } });
  });

  it('an old picture the job’s folder refuses is given up: its copy goes, and its pin says the Foreman can’t open it', async () => {
    const { ApiError } = await import('../../api/client');
    localStorage.setItem(`sb.pasted.${SLUG}.p2`, 'data:image/bmp;base64,Qk0=');
    localStorage.setItem(`sb.notes.${SLUG}`, JSON.stringify({ explains: [], notes: [{ n: 1, kind: 'pin', target: { kind: 'picture', id: 'p2' }, place: 'Pasted picture 2 (it stays in his browser: you can’t open it)', chip: 'Pasted picture 2', quote: null, note: 'cut off', pin: { n: 1, x: 10, y: 20, picture: 'pasted:p2' } }] }));
    const post = vi.fn(async (_path: string, _body?: unknown) => { throw new ApiError(415, 'Only a PNG, JPEG, WebP or GIF picture can be saved.', {}); });
    const o = openNotes({ read: null, post, patch: (p) => { p.move = null; } });
    await settle();
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`sb.pasted.${SLUG}.p2`)).toBeNull();
    expect(o.store.getState().ui.notes[0].place).toBe('Pasted picture 2 (it could not be saved for the Foreman: you can’t open it)');
  });

  it('an old picture is kept for next time when Starbase can’t be reached', async () => {
    localStorage.setItem(`sb.pasted.${SLUG}.p3`, 'data:image/png;base64,iVBORw==');
    const post = vi.fn(async (_path: string, _body?: unknown) => { throw new TypeError('Failed to fetch'); });
    openNotes({ read: null, post, patch: (p) => { p.move = null; } });
    await settle();
    await settle();
    expect(localStorage.getItem(`sb.pasted.${SLUG}.p3`)).not.toBeNull();
  });

  it('a paste with only words stays a paste of words', async () => {
    openNotes({ read: null });
    await settle();
    const ev = fireEvent.paste(box(), { clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] } });
    expect(ev).toBe(true);
  });
});

describe('final W6: a picture kept in the browser is given up only when refused for what it is', () => {
  it('400, 413 and 415 give it up; 403, 404, 405 and no answer keep it for next time', async () => {
    const { ApiError } = await import('../../api/client');
    const { adoptPasted } = await import('./Pins');
    const PNG = 'data:image/png;base64,iVBORw0KGgo=';
    const outcome = async (err: unknown) => {
      localStorage.clear();
      localStorage.setItem(`sb.pasted.${SLUG}.p1`, PNG);
      const store = createJobStore(SLUG, { api: { page: () => new Promise(() => {}), item: async () => { throw new Error('no'); } }, events: () => () => {}, viewer: () => null });
      const api = { post: vi.fn(async () => { throw err; }) };
      await adoptPasted(SLUG, api, store);
      return localStorage.getItem(`sb.pasted.${SLUG}.p1`) === null ? 'given up' : 'kept';
    };
    for (const status of [400, 413, 415]) expect(await outcome(new ApiError(status, 'No.')), String(status)).toBe('given up');
    for (const status of [403, 404, 405]) expect(await outcome(new ApiError(status, 'No.')), String(status)).toBe('kept');
    expect(await outcome(new TypeError('Failed to fetch')), 'network').toBe('kept');
    localStorage.clear();
  });
});
