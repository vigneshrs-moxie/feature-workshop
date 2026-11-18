// Starting Try it from outside the hand test (the header's `Try it`, 18 Nov): the header asks for a
// start for its job's slug and opens Your hand test in the reader; the hand test (reader/ChecksView.tsx
// HandTest) listens for its slug and, when asked, does what its own `Start the app` does. An ask made
// before the hand test is drawn waits as a per-slug flag and is taken when it mounts. Nothing else is
// kept: the flag goes once taken, and a listener goes when its hand test unmounts.

const pending = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

/** Ask the job's hand test to start Try it (now if it is drawn, else when it is). */
export function askTryStart(slug: string): void {
  const fns = listeners.get(slug);
  if (fns && fns.size > 0) {
    for (const fn of [...fns]) fn();
    return;
  }
  pending.add(slug);
}

/** Listen for asks for this slug; an ask already waiting is taken at once. Returns the unsubscribe. */
export function onTryStart(slug: string, fn: () => void): () => void {
  let fns = listeners.get(slug);
  if (!fns) listeners.set(slug, (fns = new Set()));
  fns.add(fn);
  if (pending.delete(slug)) fn();
  return () => {
    fns.delete(fn);
    if (fns.size === 0 && listeners.get(slug) === fns) listeners.delete(slug);
  };
}

/** For tests: forget every waiting ask. */
export function clearTryStarts(): void {
  pending.clear();
}
