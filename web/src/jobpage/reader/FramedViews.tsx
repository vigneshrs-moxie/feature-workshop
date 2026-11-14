// The Spec step's Screens and the Review step's Walkthrough in the reader (final fix W2): the existing
// leaf parts the plan allows (Architecture → Web), panes/Preview/ScreensTab.tsx and WalkthroughTab.tsx,
// each the page the screens server frames from its own origin. They read the job's Jobs row (the
// wireframes and walkthrough facts are on it) while they are open, as they do on the old page.
// On the website the walkthrough is on the laptop (as the old page says); ScreensTab says so itself.

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Button } from '../../components/Button';
import { draftKey } from '../jobStore';
import { useStored } from '../../lib/stored';
import { ScreensTab } from '../../panes/Preview/ScreensTab';
import { WalkthroughTab } from '../../panes/Preview/WalkthroughTab';
import { useWorkshop } from '../../state/store';
import { useJob, useJobStore } from '../useJob';
import { ReaderBody } from './ReaderBody';

/** The job's row in the app's Jobs snapshot (null when the snapshot has none); redraws only when that row changes. */
function useRow(slug: string) {
  const { store } = useWorkshop();
  const get = useCallback(() => store.getState().jobs.find((j) => j.slug === slug) ?? null, [store, slug]);
  return useSyncExternalStore(store.subscribe, get, get);
}

export function ScreensView({ place }: { place: string }) {
  const store = useJobStore();
  const slug = useJob((s) => s.slug);
  const job = useRow(slug);
  // Copy feedback writes the feedback into the job's kept draft (fw.draft.<slug>): the box shows it.
  const [kept] = useStored(draftKey(slug));
  useEffect(() => {
    if (kept !== null && kept !== store.getState().ui.draft) store.setDraft(kept);
  }, [store, kept]);
  return (
    <ReaderBody view="screens" place={place}>
      <ScreensTab slug={slug} job={job} active />
    </ReaderBody>
  );
}

export function WalkthroughView({ place }: { place: string }) {
  const slug = useJob((s) => s.slug);
  const hosted = useJob((s) => Boolean(s.payload?.hosted));
  const job = useRow(slug);
  const url = job?.walkthrough?.url ?? null;
  return (
    <ReaderBody view="walkthrough" place={place}>
      {hosted ? (
        <>
          <p className="jp2-notyet">The review walkthrough opens on your laptop.</p>
          {url && /^https:\/\//i.test(url.trim()) && (
            <p><Button kind="quiet" href={url.trim()} target="_blank" rel="noopener noreferrer" title="Open the published walkthrough, where verdicts and notes are saved and shared, in a new tab.">Open the published page</Button></p>
          )}
        </>
      ) : <WalkthroughTab slug={slug} job={job} active />}
    </ReaderBody>
  );
}
