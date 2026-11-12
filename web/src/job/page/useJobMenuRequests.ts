// The job menu's two requests for the job page (and the Screens chips that send the same one): "Try
// it on your computer" and "Review the screens". Each page layout calls this once (the laptop's and
// the phone's never both), so one request is handled once. `onTry` is the layout's own way to the
// Test step with Try it open; Review the screens goes to the job's full-width Screens page, which
// takes the request as it mounts. A request made before the page mounted is not acted on.
import { useEffect, useRef } from 'react';
import { navigate } from '../../app/router';
import { useUi } from '../../app/ui';

export function useJobMenuRequests(slug: string, onTry: () => void): void {
  const ui = useUi();
  const latestTry = useRef(onTry);
  useEffect(() => { latestTry.current = onTry; });
  const handledTry = useRef(ui.tryRequest);
  useEffect(() => {
    if (ui.tryRequest === handledTry.current) return;
    handledTry.current = ui.tryRequest;
    if (ui.trySlug === slug) latestTry.current();
  }, [ui.tryRequest, ui.trySlug, slug]);
  const handledScreens = useRef(ui.screensRequest);
  useEffect(() => {
    if (ui.screensRequest === handledScreens.current) return;
    handledScreens.current = ui.screensRequest;
    if (ui.screensSlug === slug) navigate({ name: 'screens', slug });
  }, [ui.screensRequest, ui.screensSlug, slug]);
}
