// Which step owns one of the job's documents: the step whose list in the job's page facts
// (JobPageFacts.docs, by step) has the file. One rule for the laptop page and the phone's screens,
// where a document link (a Foreman message, the Tester's report, ⌘K Open docs) opens the document
// under its step.
import type { JobPageFacts, StopId } from '../../api/types';
import { STOPS } from '../../components/stops/stops';

/**
 * The step whose documents list a file; null when no step does, there is no file, or it is not
 * known. A file two steps own (the implementation plan: Plan and Build) goes to `prefer` (the step
 * open on the page) when it is one of them, else to the first in order.
 */
export function docOwner(docs: JobPageFacts['docs'], file: string | null, prefer: StopId | null = null): StopId | null {
  if (!file || !docs || typeof docs !== 'object') return null;
  const owns = (stop: StopId) => Array.isArray(docs[stop]) && docs[stop]!.some((d) => d?.file === file);
  if (prefer && owns(prefer)) return prefer;
  return STOPS.find((s) => owns(s.id))?.id ?? null;
}
