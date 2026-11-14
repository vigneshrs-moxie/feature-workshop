// Pins on pictures (R4, Task 17): a click on a recording's frame (or a picture he pasted) drops a
// numbered pin there with a note box (one call, `Add the note`). The pin is a note like the others: a
// chip in the message box, in the notes block as
//   3. [pin] Recording AC-3 at 0:14 (evidence/ac-3.webm) · pin 1 at 62% across, 18% down
// The place names the picture so the Foreman can open it (the skills review's M7): the check, the time
// in the video and its file; a still picture's file; a pasted picture says it stays in this browser.
// The spot is in per cent from the picture's own top left (the letterbox around a video is left out).
// Pins already made on the picture show as numbered dots; a chip's click flashes its pin.
//
// Pasting a picture into the message box (⌘V) saves it in the job's own folder on the laptop
// (pictures/<sha256>.<ext>; the website keeps it in the tab) and opens it in the reader to pin on
// (reader kind `picture`): see Pasted pictures below.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { pinPlace } from '../../../../dashboard/lib/notes-block.js';
import { ApiError } from '../../api/client';
import { readStored, writeStored } from '../../lib/stored';
import type { JobStore } from '../jobStore';
import type { ReaderTarget } from '../types';
import { useJob, useJobStore } from '../useJob';
import { addNote } from './chips';
import { NoteBox } from './NoteBox';
import { NotLoaded, ReaderBody } from '../reader/ReaderBody';

/** A picture pins can go on: its key (pins belong to it) and what a pin's place calls it. */
export interface Picture {
  /** `rec:<check id>:<file>`, `shot:<file>`, `pasted:<id>`. */
  key: string;
  /** Its name in a pin's place, given the frame (a video: the time it shows). */
  name(frame: HTMLElement | null): string;
  /** The chip's short name. */
  chip(frame: HTMLElement | null): string;
  /** Where the reader shows it (a chip jumps there). */
  target: ReaderTarget;
}

/** m:ss of a video's time now. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The picture's own box inside its element (object-fit: contain leaves bands around it). */
function pictureBox(el: HTMLElement): DOMRect {
  const r = el.getBoundingClientRect();
  const w = el instanceof HTMLVideoElement ? el.videoWidth : el instanceof HTMLImageElement ? el.naturalWidth : 0;
  const h = el instanceof HTMLVideoElement ? el.videoHeight : el instanceof HTMLImageElement ? el.naturalHeight : 0;
  if (!w || !h || !r.width || !r.height) return r;
  const scale = Math.min(r.width / w, r.height / h);
  const pw = w * scale;
  const ph = h * scale;
  return new DOMRect(r.left + (r.width - pw) / 2, r.top + (r.height - ph) / 2, pw, ph);
}

const pct = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;

export interface PinsProps {
  picture: Picture;
  children: ReactNode;
}

/** The frame with its pins: a click drops the next one, with a note box beside it. */
export function Pins({ picture, children }: PinsProps) {
  const store = useJobStore();
  const notes = useJob((s) => s.ui.notes);
  const seek = useJob((s) => s.seek);
  const wrap = useRef<HTMLDivElement>(null);
  /** x, y: on the picture (what the note says); fx, fy: on the frame's box (where the dot is drawn). */
  const [draft, setDraft] = useState<{ x: number; y: number; fx: number; fy: number; n: number; name: string; chip: string } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const mine = notes.filter((n) => n.kind === 'pin' && n.pin?.picture === picture.key);

  // A chip's click: its pin flashes.
  useEffect(() => {
    if (!seek) return undefined;
    const note = mine.find((n) => n.n === seek.n);
    if (!note) return undefined;
    store.setSeek(null);
    setFlash(note.n);
    wrap.current?.scrollIntoView?.({ block: 'nearest' });
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [seek]);

  const frameEl = () => wrap.current?.querySelector<HTMLElement>('video, img, [data-pin-frame]') ?? null;

  function drop(e: ReactMouseEvent<HTMLDivElement>) {
    const frame = frameEl();
    if (!frame) return;
    const r = pictureBox(frame);
    const x = r.width ? pct(((e.clientX - r.left) / r.width) * 100) : 50;
    const y = r.height ? pct(((e.clientY - r.top) / r.height) * 100) : 50;
    const box = wrap.current!.getBoundingClientRect();
    const fx = box.width ? pct(((e.clientX - box.left) / box.width) * 100) : x;
    const fy = box.height ? pct(((e.clientY - box.top) / box.height) * 100) : y;
    const n = Math.max(0, ...mine.map((m) => m.pin?.n ?? 0)) + 1;
    setDraft({ x, y, fx, fy, n, name: picture.name(frame), chip: picture.chip(frame) });
  }

  function add(words: string) {
    if (!draft) return;
    const s = store.getState();
    store.setNotes(addNote(s.ui.notes, {
      kind: 'pin', target: picture.target, place: draft.name, chip: `${draft.chip}`, quote: null, note: words,
      pin: { n: draft.n, x: draft.x, y: draft.y, fx: draft.fx, fy: draft.fy, picture: picture.key },
    }, s.explains));
    setDraft(null);
  }

  const place = draft ? pinPlace(draft.name, draft) : '';
  return (
    <div ref={wrap} className="jp2-pins">
      {children}
      {/* The video's controls stay his: the band at its foot is left out of the click area. */}
      <div className="jp2-pins-hit" data-pt-skip="" onClick={drop} title="Click to drop a pin here with a note" aria-hidden="true" />
      {mine.map((m) => (
        <span key={m.n} className={`jp2-pin${flash === m.n ? ' is-flash' : ''}`} style={{ left: `${m.pin!.fx ?? m.pin!.x}%`, top: `${m.pin!.fy ?? m.pin!.y}%` }} title={`Pin ${m.pin!.n}: ${m.note}`} aria-label={`Pin ${m.pin!.n}: ${m.note}`} role="img">{m.pin!.n}</span>
      ))}
      {draft && <span className="jp2-pin is-new" style={{ left: `${draft.fx}%`, top: `${draft.fy}%` }} aria-hidden="true">{draft.n}</span>}
      {draft && (
        <div className={`jp2-pins-box${draft.fy > 55 ? ' is-up' : ''}`} style={{ left: `${Math.min(draft.fx, 60)}%`, top: `${draft.fy}%` }}>
          <NoteBox key={`${draft.n}|${draft.x}|${draft.y}`} place={place} quote={null} pin onNote={(_c, w) => add(w)} onClose={() => setDraft(null)} />
        </div>
      )}
    </div>
  );
}

// ---------- Pasted pictures ----------
//
// On the laptop a pasted picture goes to the job's own folder (POST /api/job/:slug/pictures,
// site/routes-pictures.js) as pictures/<sha256>.<ext>: the pin's place names that file, so the Foreman
// can open it, and this browser keeps only the name (the reader's address and the note). The website
// keeps the picture in this tab only (it can't reach the laptop's folder), and the pin's line says the
// Foreman can't open it. Pictures an earlier build kept in this browser (sb.pasted.<slug>.p<n>) are
// sent to the job's folder the next time the job is open on the laptop, their notes pointed at the
// saved file, and the browser's copies removed (adoptPasted).

/** A picture saved in the job's folder: its name there (pictures/<name>). */
export const SAVED_PICTURE = /^[0-9a-f]{64}\.(png|jpg|webp|gif)$/;
/** Where an earlier build kept a pasted picture in this browser. */
export const pastedKey = (slug: string, id: string) => `sb.pasted.${slug}.${id}`;
/** The website's pasted pictures, for this tab only. */
const inTab = new Map<string, string>();
const tabKey = (slug: string, id: string) => `sb.pasted.tab.${slug}.${id}`;
/** Largest side of a picture the website keeps, and the most the job's folder takes. */
const MAX_SIDE = 1600;
const MAX_BYTES = 10 * 1024 * 1024;

const readSession = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const writeSession = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* the tab's memory has it */ } };

/** Where the reader shows a pasted picture from: the job's folder (laptop), or this tab (website); null when gone. */
export function pictureSrc(slug: string, id: string): string | null {
  if (SAVED_PICTURE.test(id)) return `/api/job/${encodeURIComponent(slug)}/pictures/${id}`;
  return inTab.get(tabKey(slug, id)) ?? readSession(tabKey(slug, id));
}
/** What an earlier build kept in this browser for a picture, if anything (adoptPasted's input). */
export function readPasted(slug: string, id: string): string | null {
  return SAVED_PICTURE.test(id) ? null : readStored(pastedKey(slug, id)) ?? inTab.get(tabKey(slug, id)) ?? readSession(tabKey(slug, id));
}

const asDataUrl = (file: Blob) => new Promise<string>((done, fail) => {
  const r = new FileReader();
  r.onload = () => done(String(r.result));
  r.onerror = () => fail(r.error ?? new Error('Couldn’t read the picture.'));
  r.readAsDataURL(file);
});
const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

/** A picture file as a data URL, smaller when it is large (a JPEG at most MAX_SIDE across) where the browser can draw it. */
async function shrink(file: Blob): Promise<string> {
  const raw = await asDataUrl(file);
  try {
    if (typeof createImageBitmap !== 'function') return raw;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const g = c.getContext('2d');
    if (!g) return raw;
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const jpeg = c.toDataURL('image/jpeg', 0.85);
    return jpeg.length < raw.length ? jpeg : raw;
  } catch {
    return raw;
  }
}

/** The client a picture is saved through (the laptop's): null on the website. */
type Poster = { post<T>(path: string, body?: unknown): Promise<T> } | null;

/** Save a picture's data URL in the job's folder: its name there. */
async function upload(slug: string, dataUrl: string, api: NonNullable<Poster>): Promise<string> {
  const r = await api.post<{ path?: unknown }>(`/api/job/${encodeURIComponent(slug)}/pictures`, { data: base64Of(dataUrl) });
  const name = typeof r?.path === 'string' ? r.path.replace(/^pictures\//, '') : '';
  if (!SAVED_PICTURE.test(name)) throw new Error('The picture wasn’t saved.');
  return name;
}

/**
 * Keep a pasted picture for the job; its id opens it in the reader. On the laptop (`api`) it is saved in
 * the job's folder and the id is its name there; on the website (no `api`) it stays in this tab (`p1`, …).
 */
export async function keepPasted(slug: string, file: Blob, api: Poster): Promise<string> {
  if (api) {
    if (file.size > MAX_BYTES) throw new Error('The picture is too big: at most 10 MB.');
    return upload(slug, await asDataUrl(file), api);
  }
  const url = await shrink(file);
  let n = 1;
  while (inTab.has(tabKey(slug, `p${n}`)) || readSession(tabKey(slug, `p${n}`)) !== null) n++;
  const id = `p${n}`;
  inTab.set(tabKey(slug, id), url);
  writeSession(tabKey(slug, id), url);
  return id;
}

/** The answers that mean a kept picture will never be taken. */
const GIVE_UP = new Set([400, 413, 415]);

/**
 * Pictures an earlier build kept in this browser for this job (sb.pasted.<slug>.p<n>): each is saved in
 * the job's folder, the notes pinned on it now name the saved file, and the browser's copy goes. One
 * refused for what it is (GIVE_UP) is given up; one that can't be saved now stays for the next time. Laptop only.
 */
export async function adoptPasted(slug: string, api: NonNullable<Poster>, store: JobStore): Promise<number> {
  const prefix = `sb.pasted.${slug}.`;
  let keys: string[] = [];
  try { keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix) && /^p\d+$/.test(k.slice(prefix.length))); } catch { return 0; }
  let moved = 0;
  for (const key of keys) {
    const old = key.slice(prefix.length);
    const url = readStored(key);
    if (!url) { writeStored(key, null); continue; }
    let name: string;
    try { name = await upload(slug, url, api); } catch (err) {
      // Refused for what it is (400 not a picture it takes, 413 too big, 415 not a kind it takes): it
      // never will be, so it is given up and its pins say so. Anything else (403 a token gone stale after
      // a restart, 404/405 an older Starbase, no answer) may pass later: kept for next time.
      if (!(err instanceof ApiError && GIVE_UP.has(err.status))) continue;
      store.setNotes(store.getState().ui.notes.map((n) => (n.pin?.picture === `pasted:${old}` ? { ...n, place: `Pasted picture ${old.slice(1)} (it could not be saved for the Foreman: you can’t open it)` } : n)));
      writeStored(key, null);
      continue;
    }
    const notes = store.getState().ui.notes.map((n) => (n.pin?.picture === `pasted:${old}`
      ? { ...n, target: { kind: 'picture' as const, id: name }, place: savedName(name), chip: SAVED_CHIP, pin: { ...n.pin, picture: `pasted:${name}` } }
      : n));
    store.setNotes(notes);
    writeStored(key, null);
    moved++;
  }
  return moved;
}

/** A saved picture's name in a pin's place: the file in the job's folder, for the Foreman to open. */
const savedName = (name: string) => `Pasted picture (pictures/${name} in the job’s folder)`;
const SAVED_CHIP = 'Pasted picture';

/** The first picture in a paste, or null. */
export function pastedPicture(data: DataTransfer | null): File | null {
  for (const item of [...(data?.items ?? [])]) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
}

/** A pasted picture in the reader, to pin on. */
export function PictureView({ id }: { id: string }) {
  const slug = useJob((s) => s.slug);
  const src = pictureSrc(slug, id);
  const saved = SAVED_PICTURE.test(id);
  const n = id.replace(/^p/, '');
  const picture: Picture = saved
    ? { key: `pasted:${id}`, name: () => savedName(id), chip: () => SAVED_CHIP, target: { kind: 'picture', id } }
    : { key: `pasted:${id}`, name: () => `Pasted picture ${n} (it stays in his browser: you can’t open it)`, chip: () => `Pasted picture ${n}`, target: { kind: 'picture', id } };
  return (
    <ReaderBody view="picture" place={`picture:${id}`}>
      {src ? (
        <>
          <p className="jp2-dim">Click the picture where something is wrong: each click drops a numbered pin with a note.</p>
          <Pins picture={picture}><img className="jp2-pic" src={src} alt={saved ? 'The picture you pasted' : `Pasted picture ${n}`} /></Pins>
        </>
      ) : <NotLoaded error="This pasted picture was kept only in a tab that has closed. Its notes still go, with their words." />}
    </ReaderBody>
  );
}
