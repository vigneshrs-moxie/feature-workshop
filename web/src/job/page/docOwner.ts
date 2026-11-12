// Which step owns one of the job's documents: the step whose list in the job's page facts
// (JobPageFacts.docs, by step) has the file. One rule for the laptop page and the phone's screens,
// where a document link (a Foreman message, the Tester's report, ⌘K Open docs) opens the document
// under its step.
import type { JobPageFacts, StopId } from '../../api/types';
import { STOPS } from '../../components/stops/stops';

/** The step whose documents list a file; null when no step does, there is no file, or it is not known. */
export function docOwner(docs: JobPageFacts['docs'], file: string | null): StopId | null {
  if (!file || !docs || typeof docs !== 'object') return null;
  return STOPS.find((s) => Array.isArray(docs[s.id]) && docs[s.id]!.some((d) => d?.file === file))?.id ?? null;
}
