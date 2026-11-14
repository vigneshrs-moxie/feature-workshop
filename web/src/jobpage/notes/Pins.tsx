// Pins on pictures (R4, Task 17): a click on a recording's frame (or a picture he pasted) drops a
// numbered pin there with a note box (one call, `Add the note`). The pin is a note like the others: a
// chip in the message box, in the notes block as
//   3. [pin] Recording AC-3 at 0:14 (evidence/ac-3.webm) · pin 1 at 62% across, 18% down
// The place names the picture so the Foreman can open it (the skills review's M7): the check, the time
// in the video and its file; a still picture's file; a pasted picture says it stays in this browser.
// The spot is in per cent from the picture's own top left (the letterbox around a video is left out).
// Pins already made on the picture show as numbered dots; a chip's click flashes its pin.
//
// Pasting a picture into the message box (⌘V) keeps it in this browser (smaller, as a JPEG, under
// sb.pasted.<slug>.<id>; in memory only when storage is full) and opens it in the reader to pin on
// (reader kind `picture`). Starbase cannot send a picture to the Foreman yet: the pin's note carries
// what he sees.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { pinPlace } from '../../../../dashboard/lib/notes-block.js';
import { readStored, writeStored } from '../../lib/stored';
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

/** Where a pasted picture is kept in this browser. */
export const pastedKey = (slug: string, id: string) => `sb.pasted.${slug}.${id}`;
const inMemory = new Map<string, string>();
/** Largest side of a kept picture, and the most characters storage is asked to keep. */
const MAX_SIDE = 1600;
const MAX_KEPT = 1_500_000;

export function readPasted(slug: string, id: string): string | null {
  return inMemory.get(pastedKey(slug, id)) ?? readStored(pastedKey(slug, id));
}

/** A picture file as a data URL, smaller when it is large (a JPEG at most MAX_SIDE across) where the browser can draw it. */
async function shrink(file: Blob): Promise<string> {
  const raw = await new Promise<string>((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(String(r.result));
    r.onerror = () => fail(r.error ?? new Error('Couldn’t read the picture.'));
    r.readAsDataURL(file);
  });
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

/** Keep a pasted picture for the job; its id (`p1`, `p2`, …) opens it in the reader. */
export async function keepPasted(slug: string, file: Blob): Promise<string> {
  const url = await shrink(file);
  let n = 1;
  while (readPasted(slug, `p${n}`) !== null) n++;
  const id = `p${n}`;
  inMemory.set(pastedKey(slug, id), url);
  if (url.length <= MAX_KEPT) writeStored(pastedKey(slug, id), url);
  return id;
}

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
  const url = readPasted(slug, id);
  const n = id.replace(/^p/, '');
  const picture: Picture = {
    key: `pasted:${id}`,
    name: () => `Pasted picture ${n} (it stays in his browser: you can’t open it)`,
    chip: () => `Pasted picture ${n}`,
    target: { kind: 'picture', id },
  };
  return (
    <ReaderBody view="picture" place={`picture:${id}`}>
      {url ? (
        <>
          <p className="jp2-dim">Click the picture where something is wrong: each click drops a numbered pin with a note.</p>
          <Pins picture={picture}><img className="jp2-pic" src={url} alt={`Pasted picture ${n}`} /></Pins>
        </>
      ) : <NotLoaded error="This pasted picture isn’t kept in this browser any more. Its notes still go, with their words." />}
    </ReaderBody>
  );
}
