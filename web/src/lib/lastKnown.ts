// The last answer each address gave, kept for as long as the page is open (packet R, principle 5):
// a screen that fetches when it opens starts from what it showed last time, at once, and the fresh
// answer fills in quietly. Kept per API client, so each test (and each app) has its own.

const byOwner = new WeakMap<object, Map<string, unknown>>();

/** What `key` (an API path) last answered for this client, or undefined. */
export function lastKnown<T>(owner: object, key: string): T | undefined {
  return byOwner.get(owner)?.get(key) as T | undefined;
}

/** Remember `value` as what `key` last answered for this client. */
export function remember<T>(owner: object, key: string, value: T): T {
  let map = byOwner.get(owner);
  if (!map) { map = new Map(); byOwner.set(owner, map); }
  map.set(key, value);
  return value;
}
