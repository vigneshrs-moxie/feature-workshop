// Watch (design 3.5, laptop only): the hidden browser that records the evidence, live in the page.
// It asks GET /api/job/<slug>/evidence/live for the newest picture, then again 500 ms after that
// answer arrived or failed: one request at a time, each a new address (the server says no-store
// too), so nothing is kept and nothing piles up. A 404 means no picture yet (the first ask marks
// the recording watched and may itself be one): never an error. After 5 s with no picture it says
// so and keeps asking. It stops when it goes from the page (Stop watching unmounts it), and it
// rests while the tab is hidden, asking again when the tab shows. Each picture shows from a data:
// address (the page policy refuses blob: pictures); the last one stays until the next is read.
import { useEffect, useState } from 'react';
import type { EvidenceProgress } from '../../api/types';
import './page.css';

/** The gap after one answer before the next ask, and how long with no picture before it says so. */
export const FRAME_GAP_MS = 500;
export const NO_FRAME_MS = 5_000;
export const NO_PICTURE = 'No picture right now. The recording may be between lines.';
export const UPDATES = 'The picture updates about twice a second.';

/** "Line 4 of 19: {title}. The picture updates about twice a second." (the line only once one has begun). */
export function captionOf(progress: EvidenceProgress | null | undefined): string {
  const n = progress?.line ?? 0;
  const of = progress?.of ?? 0;
  const line = n >= 1 && Array.isArray(progress?.lines) ? progress!.lines[n - 1] : null;
  if (!line || !(of >= n)) return UPDATES;
  const title = String(line.title ?? '').trim().replace(/[.\s]+$/, '');
  return title ? `Line ${n} of ${of}: ${title}. ${UPDATES}` : `Line ${n} of ${of}. ${UPDATES}`;
}

/** A fetched picture as a data: address. The laptop app's page policy allows pictures only from
 *  the app itself and data: addresses (img-src 'self' data:), so a blob: address would be refused.
 *  The live picture is a JPEG, so a picture with no type is read as one. */
export async function dataUrlOf(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

export function WatchPicture({ slug, progress }: { slug: string; progress: EvidenceProgress | null | undefined }) {
  // The picture and the "no picture" line belong to one job: another job starts with neither (the
  // old picture is dropped with its chain; a data: address holds nothing to let go).
  const [held, setHeld] = useState<{ slug: string; src: string | null; stale: boolean }>({ slug, src: null, stale: false });
  let current = held;
  if (held.slug !== slug) {
    current = { slug, src: null, stale: false };
    setHeld(current);
  }
  const { src, stale } = current;

  useEffect(() => {
    const setSrc = (u: string) => setHeld((h) => (h.slug === slug ? { ...h, src: u, stale: false } : h));
    const setStale = () => setHeld((h) => (h.slug === slug ? { ...h, stale: true } : h));
    let on = true;
    let n = 0;
    let next: ReturnType<typeof setTimeout> | undefined;
    let none: ReturnType<typeof setTimeout> | undefined;
    let resting = false;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const waitForPicture = () => {
      clearTimeout(none);
      none = setTimeout(() => { if (on) setStale(); }, NO_FRAME_MS);
    };

    async function ask() {
      if (!on) return;
      // A hidden tab asks nothing; it starts again when it shows.
      if (hidden()) { resting = true; return; }
      try {
        const res = await fetch(`/api/job/${encodeURIComponent(slug)}/evidence/live?frame=${Date.now().toString(36)}-${++n}`, {
          cache: 'no-store', credentials: 'same-origin', signal: ctrl?.signal,
        });
        if (on && res.ok) {
          const url = await dataUrlOf(await res.blob());
          if (on) {
            setSrc(url);
            waitForPicture();
          }
        }
      } catch {
        // No answer this time (the laptop busy, the run between lines): the next ask tries again.
      }
      if (on) next = setTimeout(() => void ask(), FRAME_GAP_MS);
    }
    const onVisible = () => {
      if (!on || !resting || hidden()) return;
      resting = false;
      void ask();
    };

    document.addEventListener('visibilitychange', onVisible);
    waitForPicture();
    void ask();
    return () => {
      on = false;
      clearTimeout(next);
      clearTimeout(none);
      ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [slug]);

  return (
    <figure className="sb-watch" aria-busy={!src && !stale}>
      <div className="sb-watch-frame">
        {stale
          ? <p className="muted sb-watch-none" role="status">{NO_PICTURE}</p>
          : src && <img className="sb-watch-img" src={src} alt="The hidden browser, live" />}
      </div>
      <figcaption className="muted sb-watch-caption">{captionOf(progress)}</figcaption>
    </figure>
  );
}
