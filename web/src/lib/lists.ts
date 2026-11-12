// Lists read from an answer the page did not write (a step view, a job's page facts, the evidence,
// a commit): a missing one, one that is not a list (an older laptop, a half-written answer) and any
// hole in it count as none, never as a crash.

/** The objects in a list; anything else (a missing value, a non-list, a hole) is left out. */
export function listOf<T extends object>(v: unknown): T[] {
  return Array.isArray(v) ? v.filter((x): x is T => x !== null && typeof x === 'object') : [];
}

/** The strings in a list (lines of text); anything else is left out. */
export function textsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
