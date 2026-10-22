// Walkthrough tab: the review walkthrough built for the job's branch (the review-walkthrough skill),
// framed from the screens server's origin like the Screens page (dashboard/lib/docs.js
// readWalkthrough), so its script never shares this one's. Its links open in a new tab. Verdicts
// and notes made here stay in this browser; the published page (its claude.ai link, when there is
// one) is where they are shared, so that link sits on the bar.
import type { Job } from '../../api/types';
import { relativeTime, useNow } from '../../lib/time';
import { useWorkshopState } from '../../state/store';
import { NO_ORIGIN } from './ScreensTab';

export const walkthroughUrl = (origin: string, slug: string) => `${origin.replace(/\/+$/, '')}/job/${encodeURIComponent(slug)}/walkthrough`;

export function WalkthroughTab({ slug, job, active }: { slug: string; job: Job | null | undefined; active: boolean }) {
  const origin = useWorkshopState().meta?.wireframesOrigin ?? null;
  const now = useNow();
  const w = job?.walkthrough ?? null;
  if (!w) return <p className="muted doc-empty">No review walkthrough for this job’s branch yet. Ask the Foreman to “prep this for review” and it appears here.</p>;
  return (
    <div className="screens-tab walkthrough-tab">
      <div className="screens-bar">
        <span className="screens-title">Review walkthrough</span>
        <span className="muted">built {relativeTime(w.updatedAt, now)}</span>
        <span className="doc-spacer" />
        {w.url && (
          <a className="btn btn-quiet" href={w.url} target="_blank" rel="noopener noreferrer" title="Open the published walkthrough on claude.ai, where verdicts and notes are saved and shared.">
            Open the published page
          </a>
        )}
      </div>
      {!w.url && <p className="muted walkthrough-note">Notes you make here stay in this browser: it isn’t published yet.</p>}
      {origin
        ? active && (
          <iframe
            className="screens-frame"
            title="Review walkthrough"
            // Updated when the page is rebuilt: the frame reloads.
            key={w.updatedAt}
            src={walkthroughUrl(origin, slug)}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
          />
        )
        : <p className="field-problem" role="alert">{NO_ORIGIN}</p>}
    </div>
  );
}
