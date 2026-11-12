// Watch (design 3.5, laptop only): the hidden browser that records the evidence, live in the page.
// It asks GET /api/job/<slug>/evidence/live for the newest picture, then again 500 ms after that
// answer arrived or failed: one request at a time, each a new address (the server says no-store
// too), so nothing is kept and nothing piles up. A 404 means no picture yet (the first ask marks
// the recording watched and may itself be one): never an error. After 5 s with no picture it says
// so and keeps asking. It stops when it goes from the page (Stop watching unmounts it), and it
// rests while the tab is hidden, asking again when the tab shows.
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

export function WatchPicture({ slug, progress }: { slug: string; progress: EvidenceProgress | null | undefined }) {
  const [src, setSrc] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let on = true;
    let n = 0;
    let shown: string | null = null;
    let next: ReturnType<typeof setTimeout> | undefined;
    let none: ReturnType<typeof setTimeout> | undefined;
    let resting = false;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const waitForPicture = () => {
      clearTimeout(none);
      none = setTimeout(() => { if (on) setStale(true); }, NO_FRAME_MS);
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
          const blob = await res.blob();
          if (on) {
            const url = URL.createObjectURL(blob);
            if (shown) URL.revokeObjectURL(shown);
            shown = url;
            setSrc(url);
            setStale(false);
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
      if (shown) URL.revokeObjectURL(shown);
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
