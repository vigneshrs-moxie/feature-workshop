// The job menu's two requests for the job page (and the Screens chips that send the same one): "Try
// it on your computer" and "Review the screens". Each page layout calls this once (the laptop's and
// the phone's never both), so one request is handled once. `onTry` is the layout's own way to the
// Test step with Try it open; Review the screens goes to the job's full-width Screens page, which
// takes the request as it mounts. A request made before the page mounted is not acted on.
import { useEffect, useRef } from 'react';
import type { JobPageFacts, StopId } from '../../api/types';
import { navigate } from '../../app/router';
import { useUi } from '../../app/ui';
import { STOPS } from '../../components/stops/stops';
import { docOwner } from './docOwner';

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

/** A request for the job's documents, with the step it opens under (StepPanel acts on each `n` once). */
export interface DocAsk { n: number; file: string | null; stop: StopId }

/**
 * A request for one of the job's documents (a link in a message or a document, the Tester's report,
 * ⌘K Open docs), for both layouts: one rule for the step it opens under. The step that owns the
 * file, the step on screen first when it is one of its owners (docOwner); else the step on screen;
 * else the job's own step; else the first. `onAsk` is the layout's own way there: the laptop opens
 * that step (a request with no file is not a pick), the phone that step's screen. A request made
 * before the page was there is not acted on.
 */
export function useDocRequests(docs: JobPageFacts['docs'] | undefined, here: StopId | null, jobStep: StopId | null, onAsk: (ask: DocAsk) => void): void {
  const ui = useUi();
  const latest = useRef({ docs, here, jobStep, onAsk });
  useEffect(() => { latest.current = { docs, here, jobStep, onAsk }; });
  const handled = useRef(ui.docsRequest);
  useEffect(() => {
    if (ui.docsRequest === handled.current) return;
    handled.current = ui.docsRequest;
    const { docs: d, here: h, jobStep: j, onAsk: ask } = latest.current;
    const stop = docOwner(d, ui.docsFile, h) ?? h ?? j ?? STOPS[0].id;
    ask({ n: ui.docsRequest, file: ui.docsFile, stop });
  }, [ui.docsRequest, ui.docsFile]);
}
